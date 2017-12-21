// Copyright 2017 Yoav Seginer, Theo Vosse, Gil Harari, and Uri Kolodny.
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


// This object allows to partially sort a set of elements (with a comparison
// function) depending on the information required from the sorting of
// these elements. For example, if one only needs to know which element is
// the first, it is enough to create a heap of the elements and there is
// no need to actually fully sort the elements. This object also supports
// incremental addition and removal of elements and incremental
// changes to the underlying ordering (that is, updates to some of the
// values used for the comparison by the comparison function).
//
// Elements and Comparison Function
// --------------------------------
//
// It is assumed that the comparison function provides a complete ordering
// of the elements, so that for any two different elements being compared,
// one is larger than the other (it is up to the comparison function to
// ensure this property). The comparison function should return a number < 0
// if its first argument is smaller and a number > 0 if the second argument
// is smaller (for a function comparing two numbers, cmp(a,b) this could
// be implemented by a - b.
// The comparison function should only return 0 when comparing an element
// with itself. However it is expected here that such a comparison will
// never take place, as each element should only be added once.
//
// The elements stored here may be any object. The amount of information stored
// in the element objects should be enough for the comparison function to
// perform the comparison correctly (e.g. one may simply store an element ID
// where the comparison function has access to tables storing the comparison
// keys for these IDs, or one may store the full comparison keys in each
// element object stored here).
//
// It is assumed here that no element is added twice and that an element
// is removed only if it is actually stored in this structure.

// Requirements
// ------------
//
// One may register several types of requirements on this object:
// 1. Absolute position requirements: these requirements request to
//    keep track of the elements which are at a certain absolute
//    position (or range of positions) in the ordered set. Absolute
//    positions may be specified either from the beginning or from the
//    end of the set.
// 2. Relative position requirements: these requirements request to keep
//    track of the elements which are at a certain position
//    relative to a given element. Currently, it is assumed that only
//    'short distance' relative position requirements are registered
//    (but the documentation below also explains how longer distance
//    relative position requirements could be supported).
// 3. Element position requirements: these requirements request to
//    keep track of the absolute position of a given element. The
//    requirement may simply track the position of the element
//    (number of elements between it and the beginning/end of the set)
//    or also keep track of the set of elements between this element
//    and the beginning/end (this is for next*/prev* functions).
//
// This object assumes that when the ordered set is large, the requirements
// registered on it usually only refer to a relatively small subset of
// positions or elements. Therefore, there is no need to fully sort
// the elements.
//
// Implementation
// ==============
//
// This object is based on a binary tree structure. The sorted elements
// are stored at the nodes of the tree (sorted using the comparison
// function) and the nodes of the tree may also store a heap
// (min/max or min-max heap) which stores multiple elements.
// In addition to the tree structure, we also keep all nodes chained in
// a bi-directional list of prev/next pointers.
//
// Requirement Nodes
// -----------------
//
// In addition to the elements of the ordered set itself, this tree also
// stores the requirement nodes and information required to properly update
// them. For example, if there is a requirement for absolute position N
// (from the beginning of the ordering) this requirement is stored on
// the node in the tree which stores the Nth element (and if the set
// does not contain N elements, on a virtual node after the end of the tree).
// When elements are added and removed (or moved, because of ordering changes),
// the requirement node may have to be moved from one node to the other
// (and this also generates an update to the listener of the requirement node).
//
// For every requirement type (see above) there is a different requirement
// node, which we will refer to by the following (shortened) name:
// absolute requirement nodes, relative requirement nodes and
// element requirement nodes. We will refer to each of these as a
// forward/backward requirement node (of whatever type) to indicate
// whether it refers to the forward ordering (position from the start or
// forward relative position from an element) or the backward ordering
// (position from the end or backward relative position from an element).
// Absolute and relative requirement nodes may be moved from one element node
// to the other, while element requirement nodes stay attached to the same
// element node (but have to keep track of their position relative to
// the beginning or end and possibly of the list of elements between them
// and the beginning/end).
//
// When a requirement specifies a whole range of positions (e.g. [10,50])
// a single range requirement node is registered for the full range. This
// range requirement is registered on the first and last node of the range.
// Both registrations receive notifications from the trace mechanisms
// (see below).
//
// When a requirement node cannot be placed on a matching element node
// (which means that the ordered set does not consist of sufficiently
// many elements) a virtual node is created either before the first node or
// after the last node and the requirement is registered on these nodes.
// These nodes are stored on the PartialOrderTree structure, but are not
// part of the tree structure itself (the left/right/parent/next/prev
// pointers). Once the requirements can be moved to an existing element
// node, the virtual node is removed.
//
// Traces
// ------
//
// Since insertion or removal of elements elsewhere in the tree may
// affect the requirement nodes, the requirement nodes need to leave
// a trace on other nodes such that updates occuring at these nodes
// result in updates to the requirement nodes. We will refer to these
// as 'traces'.
//
// There are several types of requirement traces:
//
// forward/backward position traces:
//
// for every node on which an absolute requirement is registered (in
// case of a range requirement this means the first and last node of
// the range) there are traces on the highest nodes in each sub-tree
// where adding or removing elements may affect the element at the
// required position.
//
// For forward positions, we look at the path from the root of the
// tree to the requirement node and place a trace at every node where
// this path continues to the right branch under that node (these
// nodes, together with the sub-trees under their left branch and the
// sub-tree under the left branch of the requirement node constitute
// all nodes which are before the given requirement node). This means
// that a forward absolute position trace must be created on every
// node such that the right branch contains a forward absolute/element
// requirement node.
//
// For backward absolute/element requirements, the construction is
// similar, but with left and right exchanged, that is, a trace must
// be created at every node such that the left branch contains a
// backward absolute requirement node.
//
// Each node with a forward/backward absolute trace keeps track of the
// number of nodes under its left/right branch (respectively). When
// this number changes, the node notifies the requirement nodes it
// dominates.  These must then move to find the new node at the
// required position, using the next/prev pointers.
//
// Each trace has a reference count for the number of requirement
// nodes under it. This not only allows the trace to be removed when
// no longer needed, but also indicates when the propagation of the
// update can stop (after reaching the appropriate number of
// requirement nodes).
//
// Element position requirements also use forward/backward absolute
// traces. In this way they are notified on each element which is
// added before/after them (depending on whether they track forward
// or backward position).
//
// For relative position requirements we could use the same traces as for
// absolute requirements, except that the path which defines them is
// not the path to the root of the tree, but the paths to the root of
// the smallest sub-tree containing both the anchor node (the node
// relative to which the position needs to be determined) and the
// requirement node. If the requirement is a backward relative
// requirement, the traces on the path to the anchor node are forward
// position traces and the traces on the path from the requirement
// node to the root of the common sub-tree are backward position
// traces. For forward relative position requirements, the exact
// opposite holds.
//
// This is not currently implemented, as the it is assumed that all
// relative position requirements are for small distances and therefore
// are more eficiently handled by prev-next traces (see below).
//
// prev-next traces:
//
// The position traces should only be used for larger relative position
// requirements (where the distance from the anchor which needs to be tracked
// is large) and are not currently implemented for relative requirements.
// For small relative position requirements (which are the most common),
// the update is performed through the prev-next node chain rather than
// through the tree structure.
//
// When a relative position requirement with a small relative position
// is registered, all nodes between the anchor (the element relative to
// which the position is defined) and the relative position requirement node
// are marked by a prev/next trace as being inside a relative position range.
// Nodes inside a forward relative requirement range are marked by a
// 'next trace' while nodes inside a backward requirement range are marked
// by a 'prev trace'. These traces are also placed on the anchor node
// of the requirement, but not on the node carrying the relative requirement
// itself.
//
// Inserting an element at or directly after a node carrying
// a 'next trace' requires the system to propagate a notification of
// this insertion down the 'next' node chain, until the notification
// reaches the affected requirement nodes. To determine whether a certain
// requirement node is affected by this update or not, the propagation
// keeps track of the distance from the insertion point. A requirement is
// affected by an insertion when the distance defined in the requirement is
// larger or equal the distance from the insertion point to the requirement
// node. Each trace carries a reference count (the number of relative
// requirement ranges which this trace falls inside). When the number of
// requirements notified (and to which the notification applies) reaches
// the reference count of the of the trace, the propagation may be terminated.
//
// The same holds for backward relative requirements, using the
// 'prev trace' and with insertion before the trace and propagation taking
// place down the 'prev' chain.
//
// Tree Object
// -----------
//
// The tree object uses a red-black tree class as its base class. However,
// the actual key insertion and node removal functions are re-implemented
// here, since requirements need to be updated as the insertion or removal
// proceeds along the tree path. Moreover, often we do not need to create
// a new node for an inserted key but may simply insert it into the heap
// stored at a node reached by the insertion search process.
// For both these reasons, the base class insertion and removal functions
// cannot be used. However, after insertion or removal has taken place,
// rebalancing of the tree may take place using the functions defined
// in the red-black tree class (the rotation functions are also
// re-implemented here, to make sure the tracing information is properly
// updated).

//
// API
// ===
//
// insertElement(<element>)
// removeElement(<element>)
// removeAllElements()
// updateCompareFunc()
// refreshOrder()
// updateComparison()
// addAbsRequirement()
// addAnchoredRequirement()
// addComplementRequirement()
// xxxxxxxxxxxx document xxxxxxxxxxxxx
//
// xxxxxxxxxxxx requirement addition and removal functions xxxxxxxxxxxxx
// 

//
// Object structures
//

// PartialOrderTree:
//
// This class inherits the RedBlackTree structure. This means that it can use
// some of the fields already defined in the BinaryTree object (which is
// the base object of the RedBlackTree) such as 'root', 'first' and 'last'
// but mainly this allows this object access to the rebalancing functions
// implemented in the red-black tree. In most other respects, this class
// redefines most of the functionality.
//
// The PartialOrderTree object has the following structure:
//
// {
//    uniqueValueAttr: <string>
//    noHeapNodes: <count>
//
//    heapCompare: <comparison function>
//
//    root: <PartialOrderNode>  // inherited from BinaryTree
//    first: <PartialOrderNode>  // inherited from BinaryTree
//    last: <PartialOrderNode>  // inherited from BinaryTree
//    virtualFirst: <VirtualPartialOrderNode>
//    virtualLast: <VirtualPartialOrderNode>
//
//    // queued transfers of requirements
//    queuedForward: <PartialOrderNode>,
//    queuedBackward: <PartialOrderNode>
//
//    nodeBeingRemoved: <PartialOrderNode> // set temporarily during removal
//
//    // requirements
//
//    allRequirements: <RequirementList>
//    complementRequirements: <RequirementList>
//    orderedRangeRequirements: <RequirementList>
//
//    suspendedRequirements: <Map>{
//         <anchor element unique value>: <RequirementList>
//         ......
//    }
//
//    requirementsPendingReordering: <array of anchored requirements>
// }
//
// uniqueValueAttr: this is the name of the attribute inside the
//     objects added here as elements which is used to identify the
//     object uniquely (e.g. if the objects have an 'id' field, this
//     string should be "id"). This may be set to be undefined. In this case,
//     the elements added here must be atomic values (numbers of strings)
//     and must be unique (so that their value also identifies them).
// noHeapNodes: when this property is not zero, no heap nodes are created
//     and all elements are stored on element nodes. This counter is currently
//     increased by 1 when a complement requirement which has 'isOrderedRange'
//     set to 'true' is added. This allows the full ordering of the elements
//     to be determined (it is assumed that a complement range covers
//     the full set except for a small number of elements, so there is
//     little use in creating a heap if the internal ordering of the
//     elements in the range needs to be maintained). This counter is
//     decreased by 1 for every such complement node which is removed.
//     It is also possible to increase this counter by calling the
//     incNoHeapNodes() function. This may turn out to be more efficient in
//     some cases.
// heapCompare: this is the comparison function set on the heaps at nodes
//     of this tree. This function is a closure function which calls
//     the this.compare() function of this tree. In this way, when
//     the comparison function assigned to the tree changes, it also
//     changes for all heap nodes.
// root: the root node of the tree (undefined when the tree is empty)
// first: the first real node in the tree (a node carrying elements).
// last: the last real node in the tree (a node carrying elements).
// virtualFirst: if there are backward requirements which cannot be
//     satisfied by the tree (because there are not enough elements,
//     e.g. the 100th from the end when the set only has 80 elements)
//     they are registered on this node (which is not part of the node
//     tree structure of the node prev/next chain).
// virtualLast: if there are forward requirements which cannot be
//     satisfied by the tree (because there are not enough elements,
//     e.g. the 100th from the beginning when the set only has 80 elements)
//     they are registered on this node (which is not part of the node
//     tree structure of the node prev/next chain).
// queuedForward: this fields holds an array of nodes which carry
//     forward absolute requirements which need to be moved to
//     the previous or next node. These nodes are queued here during
//     an insertion or removal operation. At the end of the insertion
//     or removal operation, the requirements are moved to the previous
//     or next node. Whether the requirements are transferred to the
//     previous or next node depends on the operation. If it is an insertion
//     operation, the requirements need to be moved to the previous node
//     and if it is a removal operation, the requirements need to be moved
//     to the next node (the relevant insertion/removal operation always
//     takes place before the nodes on which the requirements are registered).
//     When the requirements are transferred to the previous node,
//     the transfer should begin at the requirements at the end of the
//     ordering and progress to requirements at the beginning of the ordering
//     (to avoid a requirement being moved twice). Similarly, When
//     the requirements are transferred to the next node,
//     the transfer should begin at the requirements at the beginning of the
//     ordering and progress to requirements at the end of the ordering.
//     An undefined entry in the array indicates a transfer of forward
//     requirements from the virtual last node.
//     The nodes are added here always in reverse order, that is, nodes
//     later in the ordering are earlier in this queue. This holds both to
//     insertion and to removal operations (this is implied by the order
//     in which the nodes are traversed during a search through the tree).
//     This means that when moving nodes to the previous node (upon
//     insertion) they have to be added from the end of the queue
//     first while when being moved to the next node (upon removal)
//     they have to be moved in the oder in which they are queued.
// queuedBackward: this is similar to 'queuedForward', but for backward
//     absolute requirements. The directions here are reversed (where
//     queuedForward has 'next' we have 'prev' here etc.).
//     An undefined entry in the array indicates a transfer of backward
//     requirements from the virtual first node.
//
// nodeBeingRemoved: during a removal operation, the node being removed
//     is stored on this field so that other functions which are called
//     within this operation (before the node is actually removed) are
///    aware that this node is about to be removed (and, for example,
//     cannot be merged with another node).
//
// allRequirements: this is a list of all requirements currently registered
//     to this tree. This is used when global operations apply to all
//     requirements. For example, when all elements are cleared, all
//     requirements are suspended or placed on a virtual node (there is no
//     need to go over all tree nodes and look for the requirements).
//     Similarly, when the tree is notified that an update cycle has completed
//     it can notify its requirements that it is time to notify their listeners
//     of any changes which took place.
// complementRequirements: this is a list of requirements which are
//     'complement' requirements. These are absolute range requirements
//     such that one end of the range is specified relative to the beginning of
//     the the set and the other end of the range is specified relative to
//     the end of the set (e.g. a range such as (2,-2) which is from the
//     where 2 is forward position and -2 is backward position). Such
//     requirements are complement requirements because the requirement nodes
//     are notified of the elements which are not in the range (together with
//     the elements which are the end-points of the range). Since the
//     requirement nodes are not notified of the elements inside the range,
//     the requirements in this table are notified of each and every element
//     added.
// orderedRangeRequirements: this object stores all non-suspended
//     requirements registered to this tree which track the order inside
//     a range. This includes absolute range requirements, complement
//     requirement and element range requirements which need to track the
//     ordering inside their range.
// suspendedRequirements: this table stores relative and element requirements
//     which were registered to the tree but whose anchor is not found in
//     the tree. These requirements are stored here under the unique value
//     of their anchor element (the unique value of an element is the value
//     found in the element object under the unique value attribute, which is
//     specified by <PartialOrderTree>.uniqueValueAttr. If the anchor element
//     is later added to the tree, the requirement is activated again and
//     inserted back into the tree.
//
// requirementsPendingReordering: this is an array whcih is used to
//     temporarily store anchored requirement objects during a re-ordering
//     operation. When the set is re-ordered, every anchored requirement
//     whose anchor element is moved from its place, is removed from the
//     tree and pushed on this list. After the re-ordering has been completed,
//     the requirements are added again to the tree (their anchor must be in
//     the tree since it was there before the re-ordering).

// %%include%%: <scripts/utils/minMaxPosHeap.js>
// %%include%%: <scripts/utils/intervalUtils.js>
// %%include%%: "orderRequirements.js"
// %%include%%: "redBlackTree.js"

inherit(PartialOrderTree, RedBlackTree);

// A string 'uniqueValueAttr' may be provided. This is the attribute
// inside the objects added here as elements which is used to identify
// the object uniquely (e.g. if the objects have an 'id' field, this
// string should be "id"). If such a string is not provided, the elements
// added must be atomic values (numbers or strings) and they must
// be unique (so that their value also identifies them).
// The constructor also takes an optional comparison function as argument.

function PartialOrderTree(uniqueValueAttr, compareFunc)
{
    this.RedBlackTree(compareFunc);

    if(compareFunc !== undefined)
        this.updateCompareFunc(compareFunc);
    
    this.uniqueValueAttr = uniqueValueAttr;
    this.noHeapNodes = 0;
    
    this.virtualFirst = undefined;
    this.virtualLast = undefined;

    this.queuedForward = [];
    this.queuedBackward = [];

    this.nodeBeingRemoved = undefined;
    
    this.allRequirements = new RequirementList();
    this.complementRequirements = new RequirementList();
    this.orderedRangeRequirements = new RequirementList();
    
    this.suspendedRequirements = new Map();
}

// This function returns the number of elements currently in the tree.
// This is the sub-tree size of the root of the tree (and 0 if there is
// no root node).

PartialOrderTree.prototype.getSize = partialOrderTreeGetSize;

function partialOrderTreeGetSize()
{
    if(this.root === undefined)
        return 0;

    return this.root.getSubTreeSize();
}

// Given a forward offset, this function will return the backward offset
// which points at the same position in the ordered set and given a backward
// offset, this function returns the forward offset which points at the
// same position in the ordered set. This is dependent on the size of the
// set. For example, if the set contains 10 elements (offsets, 0, ..., 9)
// then the inverse of offset 9 is offset 0, but if the set contains
// 11 elements, the inverse of offset 9 is 1.
// If the given offset is outside the set (e.g. offset 10 in a set of length
// <= 10) this function returns a negative number (-1 indicates one position
// before the 0 offset of the opposite direction).

PartialOrderTree.prototype.invertOffset = partialOrderTreeInvertOffset;

function partialOrderTreeInvertOffset(offset)
{
    return this.getSize() - offset - 1;
}

/////////////////////
// Adding Elements //
/////////////////////

// This function inserts the given element. It is assumed that
// this element is not yet stored in the tree. Since no two elements are
// allowed to be equal under the comparison function this function must
// always add a new element to the tree.
// The function goes down the tree to find the node at which the new element
// should be inserted. When it reaches a heap node such that the new
// element is inside the range of elements in the heap or when it reaches
// the last node along this path, it needs to determine whether a new node
// should be created for the new element or whether it could be pushed onto
// a heap stored under the node it reached. In case a heap node has been
// reached, it may still be that the new element is not stored on the heap
// node (or that some other element is popped off the heap as a result of
// adding the new element) as a result of requirements having to be added
// to that element (for more details, see 'addToHeapNode()' which actually
// handles this case).
// If an element node has been reached by the search process, a new node
// needs to be created for the new element. This node may either be a heap node
// (which may store additional elements added later) or an element node. 
// An element node needs to be created in several cases:
// 1. The element is the anchor of an anchored requirement (relative or
//    element requirement).
// 2. The node before or after the insertion point indicate that a node
//    inserted next to it may not be a heap node (this is indicated by the
//    'noHeapNext' and 'noHeapPrev' properties of the nodes). This is
//    used when a range absolute requirement wants the ordering of the
//    elements inside the range to be accessible.
// 3. If a requirement is about to be moved to the new node, that is, 
//    if the node following the insertion point is a forward position
//    requirement node (and therefore will be moved to the new inserted node)
//    or if the node preceding the insertion point is a backward position
//    requirement node (this may be either a absolute or relative position
//    requirement but not an element position node).
// As the node is being inserted, notifications are sent to requirement
// nodes.

PartialOrderTree.prototype.insertElement = partialOrderTreeInsertElement;

function partialOrderTreeInsertElement(element)
{
    var parent;
    var node;
    var cmp;
    // position of insertion, relative to start. Is accurate only when inserted
    // as a terminal element node.
    var pos = 0;
    
    // notify the virtual nodes
    if(this.virtualFirst !== undefined)
        this.queuedBackward.push(undefined); // queue transfer from virtual
    if(this.virtualLast !== undefined)
        this.queuedForward.push(undefined); // queue transfer from virtual
    
    // find insertion position
    var node = this.root;
    while(node) {

        if(parent !== undefined)
            // parent of current node, so we know this 'parent' has children
            parent.subTreeSize++;
        
        if(node.heap !== undefined) {
            // compare with min and max of heap
            cmp = this.compare(element, node.heap.getMin());
            if(cmp > 0) {
                // new element larger than minimal element in heap
                if(node.heap.getSize() > 1 &&
                   (cmp = this.compare(element, node.heap.getMax())) < 0) {
                    // new element internal to heap range
                    if(node.left !== undefined)
                        pos += node.left.getSubTreeSize();
                    this.addInsideHeapNode(node, element, pos);
                    return;
                } else if(node.right === undefined) {
                    // larger than maximal value in heap, but can be added to it
                    if(node.left !== undefined)
                        pos += node.left.getSubTreeSize();
                    this.suffixToHeapNode(node, element, pos);
                    return;
                }
            } else if(node.left === undefined) {
                // smaller than minimal value in heap, but can be added to it
                this.prefixToHeapNode(node, element, pos);
                return;
            }
            // in other case, continue down the tree
        } else
            cmp = this.compare(element, node.element);

        parent = node; // before advancing to the left or right child

        if(cmp < 0) {
            if(node.posTraceForward > 0)
                this.notifyAbsForward(node, node.posTraceForward, true, true,
                                      element);
            if(node.absForward !== undefined)
                // queue transfer of requirements to previous node
                this.queuedForward.push(node);
            if(node.elementForward !== undefined)
                // element added before element requirement
                node.elementForward.updateAddElement(element);
            node = node.left;
        } else {
            // advance the insertion position by the size of the left
            // branch + node size for 'node'
            if(node.left !== undefined)
                pos += node.left.getSubTreeSize();
            pos += node.getSize();

            if(node.posTraceBackward > 0)
                this.notifyAbsBackward(node, node.posTraceBackward, true, true,
                                       element);
            if(node.absBackward !== undefined)
                // queue transfer of requirements to next node
                this.queuedBackward.push(node);
            if(node.elementBackward !== undefined)
                // element added after element requirement
                node.elementBackward.updateAddElement(element);
            node = node.right;
        }
    }

    if(cmp < 0)
        this.addBeforeNode(parent, element, pos);
    else
        this.addAfterNode(parent, element, pos);
}

// This function is called with a new element 'element' which needs
// to be added to the tree at the node 'node' which is a heap node.
// This function is called in cases where the given element has been
// determined to be internal to the heap (which means it is larger than
// the smallest element stored in the heap and smaller than the largest
// element stored in the heap). The element is simply pushed into
// the heap and notifications are sent to nodes which are affected by this
// change.

PartialOrderTree.prototype.addInsideHeapNode =
    partialOrderTreeAddInsideHeapNode;

function partialOrderTreeAddInsideHeapNode(node, element, insertPos)
{
    // notify nodes carrying requirements affected by this addition
    if(node.posTraceForward > 0)
        this.notifyAbsForward(node, node.posTraceForward, true, true,
                              element);
    if(node.posTraceBackward > 0)
        this.notifyAbsBackward(node, node.posTraceBackward, true, true,
                               element);

    // check whether there are any anchored requirements at this element.
    // If yes, need to split the heap and create an element node for
    // the element. The requirements can then be unsuspended
    if(this.isSuspendedRequirementAnchor(element)) {
        var posInHeap = []; // array to store return value
        node = this.splitHeapNodeAroundElement(node, element, posInHeap);
        // update insert position now we know where among the heap elements
        // the insertion tok place.
        insertPos += posInHeap[0];
        this.unsuspendRequirements(element, node, insertPos);
    } else {
        node.heap.add(element);
        if(node.subTreeSize !== undefined)
            // if non-terminal, update the size of the sub-tree
            node.subTreeSize++;
    }

    // transfer requirements which were queued to be moved
    this.transferRequirementsAfterInsertion(element, node, insertPos);
}

// This function is called with a new element 'element' which needs
// to be added to the tree at the node 'node' which is a heap node.
// This function is called in cases where the given element has been
// determined to be smaller than the smallest element in the heap
// but the heap node does not have a left child (so the inserted element
// is larger than the next smaller element already in the tree).
// This function first notifies nodes which are affected by this change.
// Usually, this function then adds the element to the heap. However,
// before doing so, it checks whether this element will immediately have to
// be popped again (because it is the anchor of a requirement or
// requirements on an adjacent node need to be transferred to it).
// In this case, instead of pushing on the heap and popping out again,
// a new element node is created to store the new element and it is
// added as the left child of the heap node. 

PartialOrderTree.prototype.prefixToHeapNode = partialOrderTreePrefixToHeapNode;

function partialOrderTreePrefixToHeapNode(node, element, insertPos)
{
    // notify nodes carrying requirements affected by this addition
    if(node.posTraceForward > 0)
        this.notifyAbsForward(node, node.posTraceForward, true, true,
                              element);
    if(node.posTraceBackward > 0)
        this.notifyAbsBackward(node, node.posTraceBackward, true, true,
                               element);

    var prev = node.prev;
    var requirementTarget =
        ((prev !== undefined &&
          (prev.absBackward !== undefined || prev.relBackward !== undefined)) ||
         (prev === undefined && this.virtualFirst !== undefined &&
          // absolute and relative gaps not yet updated
          (this.virtualFirst.absoluteGap == 1 ||
           this.virtualFirst.relativeGap == 1)));
    var isAnchor = this.isSuspendedRequirementAnchor(element);
    
    if(requirementTarget || isAnchor) {

        // the element needs to be stored on an element node, so a new left
        // child of the heap node is created to store the element

        node = this.insertNewLeftChild(node, element, false);
        if(isAnchor)
            this.unsuspendRequirements(element, node, insertPos);
    } else {
        node.heap.add(element);
        if(node.subTreeSize !== undefined)
            // if non-terminal, update the size of the sub-tree
            node.subTreeSize++;
    }

    // transfer requirements which were queued to be moved
    this.transferRequirementsAfterInsertion(element, node, insertPos);
}

// This function is called with a new element 'element' which needs
// to be added to the tree at the node 'node' which is a heap node.
// This function is called in cases where the given element has been
// determined to be larger than the largesr element in the heap
// but the heap node does not have a right child (so the inserted element
// is smaller than the next larger element already in the tree).
// This function first notifies nodes which are affected by this change.
// Usually, this function then adds the element to the heap. However,
// before doing so, it checks whether this element will immediately have to
// be popped again (because it is the anchor of a requirement or
// requirements on an adjacent node need to be transferred to it).
// In this case, instead of pushing on the heap and popping out again,
// a new element node is created to store the new element and it is
// added as the right child of the heap node. 

PartialOrderTree.prototype.suffixToHeapNode = partialOrderTreeSuffixToHeapNode;

function partialOrderTreeSuffixToHeapNode(node, element, insertPos)
{
    // notify nodes carrying requirements affected by this addition
    if(node.posTraceForward > 0)
        this.notifyAbsForward(node, node.posTraceForward, true, true,
                              element);
    if(node.posTraceBackward > 0)
        this.notifyAbsBackward(node, node.posTraceBackward, true, true,
                               element);

    insertPos += node.heap.getSize();
    
    var next = node.next;
    var requirementTarget =
        ((next !== undefined &&
          (next.absForward !== undefined || next.relForward !== undefined)) ||
         (next === undefined && this.virtualLast !== undefined &&
          // absolute and relative gaps not yet updated
          (this.virtualLast.absoluteGap == 1 ||
           this.virtualLast.relativeGap == 1)));
    var isAnchor = this.isSuspendedRequirementAnchor(element);
    
    if(requirementTarget || isAnchor) {

        // the element needs to be stored on an element node, so a new right
        // child of the heap node is created to store the element

        node = this.insertNewRightChild(node, element, false);
        if(isAnchor)
            this.unsuspendRequirements(element, node, insertPos);
    } else {
        node.heap.add(element);
        if(node.subTreeSize !== undefined)
            // if non-terminal, update the size of the sub-tree
            node.subTreeSize++;
    }

    // transfer requirements which were queued to be moved
    this.transferRequirementsAfterInsertion(element, node, insertPos);
}

// This function is called when the element 'element' is added to the
// tree and the calling function has determined the place it should
// be inserted: just before the node 'node', which is an element node.
// Moreover, this function is called only if 'node' does not have
// a left child. 
// 'insertPos' is the forward offset at which the element is added.
// This function then creates a new node for the given element and
// adds it as a left child of 'node'. If there are suspended requirements
// whose anchor is 'element', these requirements are unsuspended.
// The new node created is, by default, a heap node, but may be an element
// node if 'element' is the anchor of a (suspended) requirement or
// if the neightboring nodes forbid the creation of a heap.
// Even if the node is created as a heap node, it may later be converted
// into an element node (when requirements are transferred to it).

PartialOrderTree.prototype.addBeforeNode = partialOrderTreeAddBeforeNode;

function partialOrderTreeAddBeforeNode(node, element, insertPos)
{
    // are there suspended requirement anchored at this element?
    var isAnchor = this.isSuspendedRequirementAnchor(element);
    
    var newNode;
    
    if(isAnchor || node.noHeapPrev > 0 ||
       (node.prev !== undefined && node.prev.noHeapNext > 0) ||
       node.absForward !== undefined || node.relForward !== undefined)
        // create a new element node to the left
        newNode = this.insertNewLeftChild(node, element, false);
    else // create a new heap node and store the value in the heap
        newNode = this.insertNewLeftChild(node, element, true);

    if(isAnchor) // unsuspend requirements anchored at the element just added
        this.unsuspendRequirements(element, newNode, insertPos);
    
    // transfer requirements which were queued to be moved
    this.transferRequirementsAfterInsertion(element, newNode, insertPos);
}

// This function is called when the element 'element' is added to the
// tree and the calling function has determined the place it should
// be inserted: just after the node 'node', which is an element node.
// Moreover, this function is called only if 'node' does not have
// a right child.
// 'insertPos' is the forward offset at which the element is added.
// This function then creates a new node for the given element and
// adds it as a right child of 'node'. If there are suspended requirements
// whose anchor is 'element', these requirements are unsuspended.
// The new node created is, by default, a heap node, but may be an element
// node if 'element' is the anchor of a (suspended) requirement or
// if the neightboring nodes forbid the creation of a heap.
// Even if the node is created as a heap node, it may later be converted
// into an element node (when requirements are transferred to it).

PartialOrderTree.prototype.addAfterNode = partialOrderTreeAddAfterNode;

function partialOrderTreeAddAfterNode(node, element, insertPos)
{
    // are there suspended requirement anchored at this element?
    var isAnchor = this.isSuspendedRequirementAnchor(element);
    
    var newNode;
    
    if(isAnchor ||
       (node !== undefined  &&
        (node.noHeapNext > 0 || 
         (node.next !== undefined && node.next.noHeapPrev > 0) ||
         node.absBackward !== undefined ||
         node.relBackward !== undefined)))
        // create a new element node to the right
        newNode = this.insertNewRightChild(node, element, false);
    else // create a new heap node and store the value in the heap
        newNode = this.insertNewRightChild(node, element, true);

    if(isAnchor) // unsuspend requirements anchored at the element just added
        this.unsuspendRequirements(element, newNode, insertPos);
    
    // transfer requirements which were queued to be moved
    this.transferRequirementsAfterInsertion(element, newNode, insertPos);
}

///////////////////////////////////////
// Node Search and Element Retrieval //
///////////////////////////////////////

// This function finds the node which stores the element at offset 'offset'
// (a non-negative integer) in the ordering. 'isBackward' indicates whether
// the offset is for the forward or backward ordering. Offset 0 is the
// first element (in forward order) or last element (in backward order).
// If the function returns an element node, this is the element at the required
// offset. If it returns a heap node, the heap contains the element at the
// required offset and if it returns undefined, the offset is outside the
// tree.
// 'splitHeapNode' is used to indicate what the function should do if the
// the element at the given offset is stored in a heap node.
// If 'splitHeapNode' is false, the heap node is returned, as is.
// If 'splitHeapNode' is true, the heap node is split so that an element
// node is created for the element at the given offset and this is the node
// returned by the function.

PartialOrderTree.prototype.findNodeByOffset = partialOrderTreeFindNodeByOffset;

function partialOrderTreeFindNodeByOffset(offset, isBackward, splitHeapNode)
{
    if(!isBackward)
        return this.findNodeByForwardOffset(offset, splitHeapNode);
    else
        return this.findNodeByBackwardOffset(offset, splitHeapNode);
}

// This function implements findNodeByOffset for the case 'isBackward' is
// false (that is, the offset is  forward offset). This function may also
// be called directly by any function which needs to perform this lookup.

PartialOrderTree.prototype.findNodeByForwardOffset =
    partialOrderTreeFindNodeByForwardOffset;

function partialOrderTreeFindNodeByForwardOffset(offset, splitHeapNode)
{
    if(this.getSize() <= offset)
        return undefined; // offset outside the tree

    var node = this.root;
    var nodeOffset;
    
    while(node) {

        // the offset of 'node' in the subsets it covers
        nodeOffset = (node.left !== undefined) ?
            node.left.getSubTreeSize() : 0;
        if(offset == nodeOffset)
            break; // found
        
        if(nodeOffset > offset)
            node = node.left;
        else {
            var nodeLastOffset = nodeOffset;
            if(node.heap !== undefined) { // highest offset in heap node
                nodeLastOffset += node.heap.getSize() - 1;
                if(offset <= nodeLastOffset)
                    break; // found (offset is inside the heap)
            }
            node = node.right;
            // calculate the offset relative to the sub-tree under the node
            offset -= (nodeLastOffset + 1); 
        }
    }
    
    if(node.heap !== undefined && splitHeapNode)
        // the offset is somewhere inside the heap, split the heap node
        // to create an element node at the required offset.
        node = this.splitHeapNodeAtPos(node, offset - nodeOffset, false);

    return node;
}

// This function implements findNodeByOffset for the case 'isBackward' is
// false (that is, the offset is  forward offset). This function may also
// be called directly by any function which needs to perform this lookup.

PartialOrderTree.prototype.findNodeByBackwardOffset =
    partialOrderTreeFindNodeByBackwardOffset;

function partialOrderTreeFindNodeByBackwardOffset(offset, splitHeapNode)
{
    if(this.getSize() <= offset)
        return undefined; // offset outside the tree

    var node = this.root;
    var nodeOffset;
        
    while(node) {

        // the offset of 'node' in the subsets it covers
        nodeOffset = (node.right !== undefined) ?
            node.right.getSubTreeSize() : 0;
        if(nodeOffset == offset)
            break; // found
        
        if(nodeOffset > offset)
            node = node.right;
        else {
            var nodeLastOffset = nodeOffset;
            if(node.heap !== undefined) {
                nodeLastOffset += node.heap.getSize() - 1;
                if(offset <= nodeLastOffset)
                    break; // found (offset is inside the heap)
            }
            node = node.left;
            // calculate the offset relative to the sub-tree under the node
            offset -= (nodeLastOffset + 1); 
        }
    }
    
    if(node.heap !== undefined && splitHeapNode)
        // the offset is somewhere inside the heap, split the heap node
        // to create an element node at the required offset.
        node = this.splitHeapNodeAtPos(node, offset - nodeOffset, true);

    return node;
}

// This function receives an element 'element' and searches for the node
// which stores this element in the tree. If no such node is found,
// the function returns undefined. If such a node is found, the function
// returns an object:
// {
//    node: <node>,
//    pos: <number>
// }
// where the field 'node' stores the node which holds the element and
// 'pos' stores the forward offset of that node. If the node is a heap node,
// 'pos' stores the offset of the minimal element in the heap (that is, the
// smallest offset occupied by an element in the heap).
// If 'splitHeapNode' is true and the element is found inside a heap node,
// that heap node is either converted into an element node (if it stores
// a single element) or split into several nodes such that 'element' is
// stored on an element node. It is then this element node (and its forward
// offset) which are returned.

PartialOrderTree.prototype.findNodeByElement =
    partialOrderTreeFindNodeByElement;

function partialOrderTreeFindNodeByElement(element, splitHeapNode)
{
    var cmp;
    var pos = 0;
    var node = this.root;
    while(node) {

        if(node.heap !== undefined) {
            // compare with min and max of heap
            cmp = this.compare(element, node.heap.getMin());
            if(cmp == 0) {
                if(node.left !== undefined) // left branch not counted yet
                    pos += node.left.getSubTreeSize();
                return {
                    node: (splitHeapNode ?
                           this.convertMinElementToNode(node) : node),
                    pos: pos
                }
            }
            if(cmp > 0 && node.heap.getSize() > 1 &&
               (cmp = this.compare(element, node.heap.getMax())) <= 0) {
                if(node.left !== undefined) // left branch not counted yet
                    pos += node.left.getSubTreeSize();
                if(cmp == 0) {
                    if(splitHeapNode) {
                        pos += node.getSize() - 1;
                        node = this.convertMaxElementToNode(node);
                    }
                    return { node: node, pos: pos };
                }
                if(!node.heap.inHeap(this.uniqueValueAttr === undefined ?
                                     element : element[this.uniqueValueAttr]))
                    return undefined; // element not in heap
                if(splitHeapNode) {
                    node = this.splitHeapNodeAtElement(node, element);
                    pos += node.prev.getSize();
                }
                return { node: node, pos: pos }; 
            }
            // otherwise, continue below with the value of cmp
        } else {
            cmp = this.compare(element, node.element);
            if(cmp === 0) {
                if(node.left !== undefined) // left branch not counted yet
                    pos += node.left.getSubTreeSize();
                return { node: node, pos: pos }; // found
            }
        }

        if(cmp < 0)
            node = node.left;
        else {
            // advance the insertion position by the size of the left
            // branch + 1 for the element node 'node'
            if(node.left !== undefined)
                pos += node.left.getSubTreeSize() + node.getSize();
            else
                pos += node.getSize();
            
            node = node.right;
        }
    }

    return undefined; // not found
}

// This function returns an array consisting of the elements in the range
// which begins at the node 'node' and is of size 'rangeSize' (this is
// the total number of elements in the range and includes the element(s)
// stored on 'node', which is also returned). 'isBackward' indicates
// whether the range is specified in the forward or backward ordering.
// This function returns the elements in the order of the nodes which
// store them. This means that elements stored on separate nodes are returned
// in their correct relative order (and, specifically, elements stored
// on element nodes are returned in their correct position) while
// elements stored inside a heap node are returned at an arbitrary order
// relative to each other.
// If the range, as specified, ends inside a heap node, all elements
// in the heap node are returned, which means that the returned array may
// be longer than 'rangeSize'. If 'rangeSize' specifies a range which ends
// beyond the end of the set, the array of elements returned may be shorter
// than 'rangeSize'.

PartialOrderTree.prototype.getRangeElements =
    partialOrderTreeGetRangeElements;

function partialOrderTreeGetRangeElements(node, rangeSize, isBackward)
{
    // array of elements in the range
    var rangeElements = [];
    
    // loop from the node where the requirement begins to the node
    // where the requirement ends (where to stop is determined by the
    // offset). Create an array of all elements on the nodes in-between.
    while(node !== undefined && rangeSize > 0) {

        if(node.heap === undefined) {
            rangeElements.push(node.element);
            rangeSize--;
        } else { // a heap node
            rangeSize -= node.getSize();
            // push the elements of the heap on the list, the order
            // is the order in the heap array
            var heapArray = node.heap.heap;
            for(var i = 1, l = heapArray.length ; i < l ; ++i)
                rangeElements.push(heapArray[i]);
        }

        node = isBackward ? node.prev : node.next;
    }

    return rangeElements;
}

// This function returns an array of elements which are at the range specified
// by the offsets 'lowOffset' and 'highOffset' ('lowOffset' <= 'highOffset')
// which are forward or backward offsets, as specified by 'isBackward'
// (which is true or false). If 'lowOffset' is beyond the end of the
// set, an empty array is returned. If 'highOffset' is beyond the end of
// the set, those elements in the set which fall inside the range are returned).
// This function returns the elements in the order of the nodes which
// store them. This means that elements stored on separate nodes are returned
// in their correct relative order (and, specifically, elements stored
// on element nodes are returned in their correct position) while
// elements stored inside a heap node are returned at an arbitrary order
// relative to each other.
// If 'lowOffset' falls inside a heap node (not at its beginning)
// the heap node is split so that the only elements beginning at
// 'lowOffset' are returned. If 'highOffset' falls inside a heap node
// (not at its end) the set of elements returned may be larger than requested.

PartialOrderTree.prototype.getRangeElementsByOffsets =
    partialOrderTreeGetRangeElementsByOffsets;

function partialOrderTreeGetRangeElementsByOffsets(lowOffset, highOffset,
                                                   isBackward)
{
    // get the node storing the element at position 'lowOffset'

    var firstNode = this.findNodeByOffset(lowOffset, isBackward, true);

    if(firstNode === undefined)
        return []; // offset beyond set end 

    return this.getRangeElements(firstNode, highOffset - lowOffset + 1,
                                 isBackward);
}

////////////////////
// Node Insertion //
////////////////////

// This function is called to insert a new node into an empty tree.
// The function creates the node, stores 'element' on that node and
// inserts the node into the tree structure. If 'createHeap' is true,
// 'element' is stored inside a heap structure inside the node.
// Otherwise, 'element' is stored directly in the node (and no more
// elements can be stored under the same node).
// This function should only be called when the tree is empty.
// The function returns the node constructed.

PartialOrderTree.prototype.insertNewRootNode =
    partialOrderTreeInsertNewRootNode;

function partialOrderTreeInsertNewRootNode(element, createHeap)
{
    if(this.noHeapNodes > 0)
        createHeap = false;
    
    var node = this.root =
        new PartialOrderNode(undefined, undefined, undefined,
                             element, this.uniqueValueAttr,
                             createHeap ? this.heapCompare : undefined);
    this.first = node;
    this.last = node;

    this.fixAfterInsertion(node); // colors the node black
    
    return node;
}

// This function is called to insert a new node as the left child of the
// node given by 'parent'. 'parent' may be undefined (in which case the node is
// the first node to be added to the tree and is added as a root).
// The element 'element' is stored in the new node and the new node stores
// the element in a heap iff 'createHeap' is true (otherwise, the node
// can only store a single element). If the parent does not yet
// have a left child, the new node is simply added as its left child.
// Otherwise, the parent's previous node does not have a right child
// and the new node is added as the right child of that node.
// The next/prev traces on the new node are set to be equal to those on the
// previous node (for next traces) or next node (for prev traces). There are
// no position traces to update because the new node is a leaf node
// (in which case it carries no position traces).

PartialOrderTree.prototype.insertNewLeftChild =
    partialOrderTreeInsertNewLeftChild;

function partialOrderTreeInsertNewLeftChild(parent, element, createHeap)
{
    if(parent === undefined)
        return this.insertNewRootNode(element, createHeap);

    if(this.noHeapNodes > 0)
        createHeap = false;

    if(parent.subTreeSize === undefined) // was a terminal until now
        parent.subTreeSize = 1 + parent.getSize();
    else
        parent.subTreeSize++;
    
    var node;
    
    if(parent.left === undefined) {
        node = parent.left =
            new PartialOrderNode(parent, parent.prev, parent, element,
                                 this.uniqueValueAttr,
                                 createHeap ? this.heapCompare : undefined);
    } else { // insert as right child of the previous node
        node = parent.prev.right =
            new PartialOrderNode(parent.prev, parent.prev, parent, element,
                                 this.uniqueValueAttr,
                                 createHeap ? this.heapCompare : undefined);
        if(parent.prev.subTreeSize === undefined)
            parent.prev.subTreeSize = parent.prev.getSize();
        for(var p = parent.prev ; p != parent ; p = p.parent)
            p.subTreeSize++;
    }

    // update the prev/next pointers of the neighbors of 'node'
    
    if(parent.prev)
        parent.prev.next = node;
    else
        this.first = node;
    
    parent.prev = node;

    // update prev/next traces
    
    if(node.prev)
        node.nextTrace = node.prev.nextTrace;
    if(node.next)
        node.prevTrace = node.next.prevTrace;

    // update 'no heap' counters
    if(node.prev !== undefined)
        node.noHeapNext = node.prev.noHeapNext;
    if(node.next !== undefined)
        node.noHeapPrev = node.next.noHeapPrev;
    
    this.fixAfterInsertion(node);

    return node;
}

// This function is called to insert a new node as the right child of the
// node given by 'parent'. 'parent' may be undefined (in which case the node is
// the first node to be added to the tree and is added as a root).
// The element 'element' is stored in the new node and the new node stores
// the element in a heap iff 'createHeap' is true (otherwise, the node
// can only store a single element). If the parent does not yet
// have a right child, the new node is simply added as its right child.
// Otherwise, the parent's next node does not have a left child
// and the new node is added as the left child of that node.
// The next/prev traces on the new node are set to be equal to those on the
// previous node (for next traces) or next node (for prev traces). There are
// no position traces to update because the new node is a leaf node
// (in which case it carries no position traces).

PartialOrderTree.prototype.insertNewRightChild =
    partialOrderTreeInsertNewRightChild;

function partialOrderTreeInsertNewRightChild(parent, element, createHeap)
{
    if(parent === undefined)
        return this.insertNewRootNode(element, createHeap);

    if(this.noHeapNodes > 0)
        createHeap = false;

    if(parent.subTreeSize === undefined) // was a terminal node until now
        parent.subTreeSize = 1 + parent.getSize();
    else
        parent.subTreeSize++;

    var node;

    if(parent.right === undefined) {
        node = parent.right =
            new PartialOrderNode(parent, parent, parent.next, element,
                                 this.uniqueValueAttr,
                                 createHeap ? this.heapCompare : undefined);
    } else { // insert as left child of the next node
        node = parent.next.left =
            new PartialOrderNode(parent.next, parent, parent.next, element,
                                 this.uniqueValueAttr,
                                 createHeap ? this.heapCompare : undefined);
        if(parent.next.subTreeSize === undefined)
            parent.next.subTreeSize = parent.next.getSize();
        for(var p = parent.next ; p != parent ; p = p.parent)
            p.subTreeSize++;
    }

    // update the prev/next pointers of the neighbors of 'node'
    
    if(parent.next)
        parent.next.prev = node;
    else
        this.last = node;
    
    parent.next = node;

    // update prev/next traces
    
    if(node.prev)
        node.nextTrace = node.prev.nextTrace;
    if(node.next)
        node.prevTrace = node.next.prevTrace;

    // update 'no heap' counters
    if(node.prev !== undefined)
        node.noHeapNext = node.prev.noHeapNext;
    if(node.next !== undefined)
        node.noHeapPrev = node.next.noHeapPrev;
    
    this.fixAfterInsertion(node);

    return node;
}

// This function performs the right rotation of node y in the tree:
//
//       |                 |
//      (y)               (x)
//     /   \             /   \
//   (x)    c      =>   a    (y)
//  /   \                   /   \
// a     b                 b     c
//
// This function assumes that the given node y (see diagram) has 
// a left child.
// In addition to performing the actual rotation (updating the links
// among the nodes) this function also has to take care of several
// additional properties:
// 1. Position traces:
//    a. forward traces of y need to be added to x, and this sum needs
//       to be further increased by the number of absolute and element forward
//       requirements on y.
//    b. backward traces on y need to be decreased by the backward traces
//       of x and by the number of absolute and element backward
//       requirements on x.
// 2. The sub-tree size under x is increased with the sub-tree size of c
//    (if exists) + 1 (for the node y).
//    The sub-tree size of y is decreased by the sub-tree size of 'a' +
//    the node size of x.

PartialOrderTree.prototype.rotateRight =
    partialOrderTreeRotateRight;

function partialOrderTreeRotateRight(y)
{
    // rotate the nodes
    
    // x is rotated together with y (see diagram above)
    var x = y.left;
    y.left = x.right;

    if(x.right !== undefined)
        x.right.parent = y;

    // set x under the former parent of y
    x.parent = y.parent;
    if(y.parent === undefined)
        this.root = x;
    else if(y == y.parent.left)
        y.parent.left = x;
    else
        y.parent.right = x;
    
    // re-connect y and x
    x.right = y;
    y.parent = x;

    // adjust position traces and create node heap (if possible)

    x.posTraceForward += y.posTraceForward;
    if(y.absForward !== undefined)
        x.posTraceForward += y.absForward.length;
    if(y.elementForward)
        x.posTraceForward++;

    y.posTraceBackward -= x.posTraceBackward;
    if(x.absBackward !== undefined)
        y.posTraceBackward -= x.absBackward.length;
    if(x.elementBackward)
        y.posTraceBackward--;
    
    // adjust sub-tree size
    
    if(x.subTreeSize === undefined)
        x.subTreeSize = x.getSize();
    x.subTreeSize +=
        y.getSize() + (y.right === undefined ? 0 : y.right.getSubTreeSize());

    if(y.left === undefined && y.right === undefined)
        y.subTreeSize = undefined;
    else {
        y.subTreeSize -= x.getSize() +
            (x.left === undefined ? 0 : x.left.getSubTreeSize());
    }
}

// This function performs the left rotation of node x in the tree:
//
//       |                 |
//      (x)               (y)
//     /   \             /   \
//    a    (y)     =>  (x)    c
//        /   \       /   \
//       b     c     a     b
//
// This function assumes that the given node x (see diagram) has 
// a right child.
// In addition to performing the actual rotation (updating the links
// among the nodes) this function also has to take care of several
// additional properties:
// 1. Position traces:
//    a. backward traces of x need to be added to y, and this sum needs
//       to be further increased by the number of absolute and element backward
//       requirements on x.
//    b. forward traces on x need to be decreased by the forward traces
//       of y and by the number of absolute and element forward
//       requirements on y.
// 2. The sub-tree size under y is increased with the sub-tree size of a
//    (if exists) + 1 (for the node x).
//    The sub-tree size of x is decreased by the sub-tree size of 'c' +
//    the node size of y. 

PartialOrderTree.prototype.rotateLeft =
    partialOrderTreeRotateLeft;

function partialOrderTreeRotateLeft(x)
{
    // y is rotated together with x (see diagram above)
    var y = x.right;
    x.right = y.left;
    
    if(y.left !== undefined)
        y.left.parent = x;

    // set y under the former parent of x
    y.parent = x.parent;
    if(x.parent === undefined)
        this.root = y;
    else if(x == x.parent.left)
        x.parent.left = y;
    else
        x.parent.right = y;
    
    // re-connect x and y
    y.left = x;
    x.parent = y;

    // adjust position traces and create node heap (if possible)

    y.posTraceBackward += x.posTraceBackward;
    if(x.absBackward !== undefined)
        y.posTraceBackward += x.absBackward.length;
    if(y.elementBackward !== undefined)
        y.posTraceBackward++;

    x.posTraceForward -= y.posTraceForward;
    if(y.absForward !== undefined)
        x.posTraceForward -= y.absForward.length;
    if(y.elementForward)
        x.posTraceForward--;

    // adjust sub-tree size
    if(y.subTreeSize === undefined)
        y.subTreeSize = y.getSize();
    y.subTreeSize +=
        x.getSize() + (x.left === undefined ? 0 : x.left.getSubTreeSize());
    
    if(x.left === undefined && x.right === undefined)
        x.subTreeSize = undefined;
    else {
        x.subTreeSize -= y.getSize() +
            (y.right === undefined ? 0 : y.right.getSubTreeSize());
    }
}

// This function returns one of the two virtual nodes. If 'isFirst' is true,
// the virtual first node is returned and if it is false, the virtual last
// node is returned. If the node does not exist, it is created

PartialOrderTree.prototype.getVirtualNode =
    partialOrderTreeGetVirtualNode;

function partialOrderTreeGetVirtualNode(isFirst)
{
    if(isFirst) {
        if(this.virtualFirst === undefined)
            this.virtualFirst = new VirtualPartialOrderNode(this);
        return this.virtualFirst;
    } else {
        if(this.virtualLast === undefined)
            this.virtualLast = new VirtualPartialOrderNode(this);
        return this.virtualLast;
    }
}

/////////////////////////
// Heap Node Splitting //
/////////////////////////

// This function splits the elements stored in the heap under the node
// 'heapNode' into several nodes. The split takes place at the element
// given by 'atElement' (which is assumed to be in the heap, that is, there
// needs to be an element in the heap which has the same identity, as
// determined by the attribute 'this.uniqueValueAttr').
// In addition, if 'offset' is not undefined (in which case it should be
// an integer >= 1) the heap is again split at an offset of 'offset'
// from 'atElement' where 'isBackward' determines whether this offset
// is in the forward or backward direction on the ordered set (an
// offset of 1 refers to the element following 'atElement' if
// 'isBackward' is false and refers to the element before 'atElement'
// if 'isBackward' is true). The split creates an element node for
// 'atElement', and, if 'offset' is not undefined, also for the element
// at the given offset (if that offset is inside the heap node being split)
// All other elements continue to be stored in heap nodes. All these
// nodes are added to the tree by this function.  The function returns
// the element node storing the element 'atElement'.
// 'posInHeap' is an optional argument. If provided, this should be an
// array. The function places in posInHeap[0] the forward offset of 'atElement'
// inside the set of elements in the heap. In other words, posInHeap[0]
// is the number of elements in the heap smaller (in teh ordering comparison)
// than 'atElement'. 

PartialOrderTree.prototype.splitHeapNodeAtElement =
    partialOrderTreeSplitHeapNodeAtElement;

function partialOrderTreeSplitHeapNodeAtElement(heapNode, atElement, offset,
                                                isBackward, posInHeap)
{
    if(heapNode.heap.getSize() == 1) {
        heapNode.convertHeapToElement();
        if(posInHeap !== undefined)
            posInHeap[0] = 0;
        return heapNode;
    }
    
    var atElementUniqueValue = this.uniqueValueAttr === undefined ?
        atElement : atElement[this.uniqueValueAttr];    
    var elementNode;
    
    if(!isBackward) { // split from beginning
        var beforeSplit = [];
        if(this.uniqueValueAttr === undefined)
            while(heapNode.heap.getMin() != atElementUniqueValue)
                beforeSplit.push(heapNode.heap.popMin());
        else
            while(heapNode.heap.getMin()[this.uniqueValueAttr] !=
                  atElementUniqueValue)
                beforeSplit.push(heapNode.heap.popMin());

        if(posInHeap !== undefined)
            posInHeap[0] = beforeSplit.length;
        
        var heap = new MinMaxPosHeap(this.heapCompare, this.uniqueValueAttr);
        heap.initWithSortedArray(beforeSplit, true);
        this.insertSplitHeapNodeJustBefore(heapNode, undefined, heap);

        // pop the first element off the heap and add it as a separate node
        elementNode = this.convertMinElementToNode(heapNode);

    } else { // split from the end

        var afterSplit = [];
        var element;
        if(this.uniqueValueAttr === undefined)
            while(heapNode.heap.getMax() != atElementUniqueValue)
                afterSplit.push(heapNode.heap.popMax());
        else
            while(heapNode.heap.getMax()[this.uniqueValueAttr] !=
                  atElementUniqueValue)
                afterSplit.push(heapNode.heap.popMax());

        if(posInHeap !== undefined)
            posInHeap[0] = heapNode.heap.getSize() - 1;
        
        var heap = new MinMaxPosHeap(this.heapCompare, this.uniqueValueAttr);
        heap.initWithSortedArray(afterSplit, false);
        this.insertSplitHeapNodeJustAfter(heapNode, undefined, heap);
        
        // pop the last element off the heap and add it as a separate node
        elementNode = this.convertMaxElementToNode(heapNode);
    }

    if(offset)
        this.splitHeapNodeAtPos(heapNode, offset-1, isBackward);

    return elementNode;
}

// This function is given a heap node and an element which could have been
// added to this heap node. This function then creates an element node for the
// new element and splits the heap node (if necessary) into a node holding
// elements from the original heap node which appear before 'element'
// and a node holding elements from the original heap node which appear after
// 'element'. The original heap node becomes an element node storing 'element'
// while the nodes holding the elements from the orginal heap are inserted
// into the tree under this node.
// This function returns the element node storing 'element' (this is
// actually the original heap node)
// 'posInHeap' is an optional argument. If provided, this should be an
// array. The function places in posInHeap[0] the forward offset of 'element'
// inside the set of elements in the heap. In other words, posInHeap[0]
// is the number of elements in the heap smaller (in the ordering comparison)
// than 'atElement'.

PartialOrderTree.prototype.splitHeapNodeAroundElement =
    partialOrderTreeSplitHeapNodeAroundElement;

function partialOrderTreeSplitHeapNodeAroundElement(heapNode, element,
                                                    posInHeap)
{
    // if defined, increase the heap node size by 1 (functions used below
    // assume the size already includes 'element').

    if(this.compare(element, heapNode.heap.getMax()) > 0) {
        // new element larger than all heap elements, no need to split heap
        if(posInHeap !== undefined)
            posInHeap[0] = heapNode.getSize();
        return this.insertNewRightChild(heapNode, element, false);
    }

    if(this.compare(element, heapNode.heap.getMin()) < 0) {
        // new element smaller than all heap elements, no need to split heap
        if(posInHeap !== undefined)
            posInHeap[0] = 0;
        return this.insertNewLeftChild(heapNode, element, false);
    }

    // element's position is inside the heap. Add it to the heap and then
    // split the heap at that element
    heapNode.heap.add(element);
    if(heapNode.subTreeSize !== undefined)
        heapNode.subTreeSize++;

    // split the heap node at the element
    return this.splitHeapNodeAtElement(heapNode, element, undefined, undefined,
                                       posInHeap);
}

// This function splits the elements stored in the heap under the node
// 'heapNode' into several nodes. This split takes place at the
// position in the ordered set of elements stored in the heap which is
// given by 'offset', where if 'isBackward' is true the offset is from the
// end of the ordered set stored in the heap and otherwise from the
// beginning of this ordered set. The function creates and returns
// an element node storing the element at the given position while all
// remaining elements are stored in heap nodes.
// If 'isBackward' is false, an 'offset' of 0 refers to the first element
// in the heap and if 'isBackward' is true, an offset of 0 refers to
// the last element in the heap.

PartialOrderTree.prototype.splitHeapNodeAtPos =
    partialOrderTreeSplitHeapNodeAtPos;

function partialOrderTreeSplitHeapNodeAtPos(heapNode, offset, isBackward)
{
    if(heapNode.heap.getSize() == 1) {
        heapNode.convertHeapToElement();
        return heapNode;
    }

    if(heapNode.subTreeSize === undefined)
        // about to become a non-terminal covering the same set of elements
        heapNode.subTreeSize = heapNode.heap.getSize();

    // if the offset is closer to the other end of the heap, use the offset
    // in the opposite direction
    if(offset > heapNode.getSize() / 2) {
        offset = heapNode.getSize() - offset - 1;
        isBackward = !isBackward;
    }

    var heap;
    
    if(!isBackward) { // split from beginning
        
        if(offset > 0) {
            var beforeSplit = [];
            for(var i = 0 ; i < offset ; ++i)
                beforeSplit.push(heapNode.heap.popMin());

            heap = new MinMaxPosHeap(this.heapCompare, this.uniqueValueAttr);
            heap.initWithSortedArray(beforeSplit, true);
            this.insertSplitHeapNodeJustBefore(heapNode, undefined, heap);
        }

        heapNode.element = heapNode.heap.popMin(); // element at the offset
        heap = heapNode.heap;
        heapNode.heap = undefined; // no longer a heap node
        
        if(heap.getSize() != 0) // has elements after split point
            this.insertSplitHeapNodeJustAfter(heapNode, undefined, heap);
        
    } else { // split from the end
        
        if(offset > 0) {
            var afterSplit = []; // elements before the backward offset
            for(var i = 0 ; i < offset ; ++i)
                afterSplit.push(heapNode.heap.popMax());
            heap = new MinMaxPosHeap(this.heapCompare, this.uniqueValueAttr);
            heap.initWithSortedArray(afterSplit, false);
            this.insertSplitHeapNodeJustAfter(heapNode, undefined, heap);
        }

        heapNode.element = heapNode.heap.popMax(); // element at the offset
        heap = heapNode.heap;
        heapNode.heap = undefined; // no longer a heap node
        
        if(heap.getSize() != 0) // has elements after split point
            this.insertSplitHeapNodeJustBefore(heapNode, undefined, heap);


    }

    return heapNode;
}

// This function receives a heap node 'node' in the tree such that
// some elements now have to be inserted as a separate node just
// before 'node'. These elements are either provided in 'element' (a single
// element) or in 'heap' (a heap structure already containing the required
// elements). If 'element' is provided, an element node is created and,
// otherwise, a heap node (which uses the heap provided). It is assumed
// that the 'subTreeSize' of 'node' has already been updated to agree with
// the result of adding the elements under it. This function
// then creates a new node and inserts it into the tree. If 'node' does
// not have a left child, the new node is added as its left child.
// Otherwise, 'node' must have a 'prev' node and that 'prev' node cannot
// have a right child, so the new node is added as the right child of
// the 'prev' node. In this second case, this function updates the sub-tree
// size of the 'prev' node and all its parents up to 'node'.
// It also updates the next/prev traces of the new node to be equal to
// those of 'node' (as these two nodes now occupy adjacent positions
// in the ordered chain of nodes).
// The function returns the new node added.

PartialOrderTree.prototype.insertSplitHeapNodeJustBefore =
    partialOrderTreeInsertSplitHeapNodeJustBefore;

function partialOrderTreeInsertSplitHeapNodeJustBefore(node, element, heap)
{
    var numElements = (heap === undefined) ? 1 : heap.getSize();
    
    var beforeNode;
    // determine where to insert this node
    if(node.left === undefined) {
        node.left = beforeNode =
            new PartialOrderNode(node, node.prev, node,
                                 undefined, this.uniqueValueAttr, undefined);
        if(node.subTreeSize === undefined) // was a terminal until now
            node.subTreeSize = node.getSize() + numElements;
    } else {
        // The node needs to be inserted as the right child of the previous
        // node (which is dominated by 'node' and cannot have
        // a right child).
        node.prev.right = beforeNode =
            new PartialOrderNode(node.prev, node.prev, node,
                                 undefined, this.uniqueValueAttr, undefined);
        // update the tree size on all parents up to 'node'.
        if(node.prev.subTreeSize === undefined)
            node.prev.subTreeSize = node.prev.getSize();
        for(var p = node.prev ; p != node ; p = p.parent)
            p.subTreeSize += numElements;
    }

    // update the prev/next pointers of the neighbors of 'beforeNode'
    if(node.prev)
        node.prev.next = beforeNode;
    else
        this.first = beforeNode;
    
    node.prev = beforeNode;
    
    // copy next/prev traces (there are not forward/backward traces,
    // since this is a leaf node)
    beforeNode.nextTrace = node.nextTrace;
    beforeNode.prevTrace = node.prevTrace;

    // copy no heap counts
    beforeNode.noHeapPrev = node.noHeapPrev;
    if(beforeNode.prev !== undefined)
        beforeNode.noHeapNext = beforeNode.prev.noHeapNext;

    if(heap)
        beforeNode.heap = heap;
    else
        beforeNode.element = element;
    
    this.fixAfterInsertion(beforeNode);

    return beforeNode;
}

// This function receives a heap node 'node' in the tree such that
// some elements now have to be inserted as a separate node just
// after 'node'. These elements are either provided in 'element' (a single
// element) or in 'heap' (a heap structure already containing the required
// elements). If 'element' is provided, an element node is created and,
// otherwise, a heap node (which uses the heap provided). It is assumed
// that the 'subTreeSize' of 'node' has already been updated to agree with
// the result of adding these elements under it. This function
// then creates a new node and inserts it into the tree. If 'node' does
// not have a right child, the new node is added as its right child.
// Otherwise, 'node' must have a 'next' node and that 'next' node cannot
// have a left child, so the new node is added as the left child of
// the 'next' node. In this second case, this function updates the sub-tree
// size of the 'next' node and all its parents up to 'node'.
// It also updates the next/prev traces of the new node to be equal to
// those of 'node' (as these two nodes now occupy adjacent positions
// in the ordered chain of nodes).
// The function returns the new node added.

PartialOrderTree.prototype.insertSplitHeapNodeJustAfter =
    partialOrderTreeInsertSplitHeapNodeJustAfter;

function partialOrderTreeInsertSplitHeapNodeJustAfter(node, element, heap)
{
    var numElements = (heap === undefined) ? 1 : heap.getSize();
    
    var afterNode;
    
    // determine where to insert this node
    if(node.right === undefined) {
        node.right = afterNode =
            new PartialOrderNode(node, node, node.next,
                                 undefined, this.uniqueValueAttr, undefined);
        if(node.subTreeSize === undefined) // was a terminal until now
            node.subTreeSize = node.getSize() + numElements;
    } else {
        // The node needs to be inserted as the left child of the next
        // node (which is dominated by 'node' and cannot have
        // a left child).
        node.next.left = afterNode =
            new PartialOrderNode(node.next, node, node.next,
                                 undefined, this.uniqueValueAttr, undefined);
        // update the tree size on all parents up to 'node'.
        if(node.next.subTreeSize === undefined)
            node.next.subTreeSize = node.next.getSize();
            for(var p = node.next ; p != node ; p = p.parent)
                p.subTreeSize += numElements;
    }

    // update the prev/next pointers of the neighbors of 'beforeNode'
    if(node.next)
        node.next.prev = afterNode;
    else
        this.last = afterNode;
    
    node.next = afterNode;
    
    // copy next/prev traces (there are not forward/backward traces,
    // since this is a leaf node)
    afterNode.nextTrace = node.nextTrace;
    afterNode.prevTrace = node.prevTrace;

    // copy no heap counts
    afterNode.noHeapNext = node.noHeapNext;
    if(afterNode.next !== undefined)
        afterNode.noHeapPrev = afterNode.next.noHeapPrev;
    
    if(heap)
        afterNode.heap = heap;
    else
        afterNode.element = element;
    
    this.fixAfterInsertion(afterNode);

    return afterNode;
}

// This function receives a node 'node' and returns an element node
// which stores only the minimal element of 'node'. If 'node' is an element
// node or a heap node containing only a single element, the returned node
// is the same as the input node (which may have been converted from
// a heap node to an element node). If 'node' is a heap node storing more
// than one element, the minimal element is popped off the node and a new
// element node is created to store this element. This element node is
// inserted into the tree and returned.

PartialOrderTree.prototype.convertMinElementToNode =
    partialOrderTreeConvertMinElementToNode;

function partialOrderTreeConvertMinElementToNode(node)
{
    if(node.convertHeapToElement())
        // already element node or heap with single element converted
        // to element node
        return node;

    // pop the minimal element
    var minElement = node.heap.popMin();
    var minElementNode = this.insertSplitHeapNodeJustBefore(node, minElement);

    return minElementNode;
}

// This function receives a node 'node' and returns an element node
// which stores only the maximal element of 'node'. If 'node' is an element
// node or a heap node containing only a single element, the returned node
// is the same as the input node (which may have been converted from
// a heap node to an element node). If 'node' is a heap node storing more
// that one element, the maximal element is popped off the node and a new
// element node is created to store this element. This element node is
// inserted into the tree and returned.

PartialOrderTree.prototype.convertMaxElementToNode =
    partialOrderTreeConvertMaxElementToNode;

function partialOrderTreeConvertMaxElementToNode(node)
{
    if(node.convertHeapToElement())
        // already element node or heap with single element converted
        // to element node
        return node;

    // pop the maximal element
    var maxElement = node.heap.popMax();
    var maxElementNode = this.insertSplitHeapNodeJustAfter(node, maxElement);

    return maxElementNode;
}

// This function receives a heap node as input and needs to replace it
// by a sub-tree of element nodes (containing the same elements). The
// function returns the first node in this sub-tree, where if 'isBackward'
// is false, this is the first node in the forward direction and if
// 'isBackward' is true, this is the first node in the backward direction. 
// This function pops the elements off the heap and creates a single element
// node for each of them.

PartialOrderTree.prototype.convertHeapNodeToElements =
    partialOrderTreeConvertHeapNodeToElements;

function partialOrderTreeConvertHeapNodeToElements(heapNode, isBackward)
{
    // pop the elements off the heap node, one by one, and insert a new
    // node for each of them
    var first;

    if(!isBackward) {
        while(heapNode.getSize() > 1) {
            var element = heapNode.heap.popMin();
            var inserted =
                this.insertSplitHeapNodeJustBefore(heapNode, element);
            if(first === undefined)
                first = inserted;
        }
    } else {
        while(heapNode.getSize() > 1) {
            var element = heapNode.heap.popMax();
            var inserted =
                this.insertSplitHeapNodeJustAfter(heapNode, element);
            if(first === undefined)
                first = inserted;
        }
    }

    heapNode.convertHeapToElement();

    if(first === undefined)
        first = heapNode; // single element heap, so node remain the same
    return first;
}

/////////////////////
// Element Removal //
/////////////////////

// This function removes the given element. It is assumed that
// this element is currently stored in the tree. 
// The function goes down the tree to find the node at which the element
// is stored and removes it from that node. If the node does not store
// any elements after the removal of this element, the node is removed.
// As the element is being removed, traces are used to notify requirements
// which are affected by this removal.

PartialOrderTree.prototype.removeElement = partialOrderTreeRemoveElement;

function partialOrderTreeRemoveElement(element)
{    
    var cmp;
    // position of removal, relative to start. Is not accurate if the removal
    // is from a heap node.
    var pos = 0;

    // find the node
    var node = this.root;
    while(node) {

        if(node.heap !== undefined) {
            // compare with min and max of heap
            cmp = this.compare(element, node.heap.getMin());
            if(cmp == 0 ||
               (cmp > 0 && node.heap.getSize() > 1 &&
                (cmp = this.compare(element, node.heap.getMax())) <= 0)) {
                if(node.left !== undefined)
                    pos += node.left.getSubTreeSize();
                this.removeElementFromHeap(node, element, pos);
                return;
            }
            // otherwise, continue below with the value of cmp
        } else {
            cmp = this.compare(element, node.element);
            if(cmp === 0) {
                if(node.left !== undefined)
                    pos += node.left.getSubTreeSize();
                this.removeElementNode(node, element, pos);
                return;
            }
        }

        if(cmp < 0) {

            if(node.posTraceForward > 0)
                this.notifyAbsForward(node, node.posTraceForward, true, false,
                                      element);
            if(node.absForward !== undefined)
                // queue transfer of requirements to next node
                this.queuedForward.push(node);
            if(node.elementForward !== undefined)
                // element removed before element requirement
                node.elementForward.updateRemoveElement(element);
            
            node = node.left;
        } else { // cmp > 0

            // advance the removal position by the size of the left
            // branch + the size of the node 'node'
            if(node.left !== undefined)
                pos += node.left.getSubTreeSize() + node.getSize();
            else
                pos += node.getSize();

            if(node.posTraceBackward > 0)
                this.notifyAbsBackward(node, node.posTraceBackward, true,
                                       false, element);
            if(node.absBackward !== undefined)
                // queue transfer of requirements to next node
                this.queuedBackward.push(node);
            if(node.elementBackward !== undefined)
                // element removed after element requirement
                node.elementBackward.updateRemoveElement(element);
            
            node = node.right;
        }
    }
}

// This function is called when the element 'element' is to be removed
// from the set and the element was found to be stored on the node 'node'
// which stores its elements in a heap. This function first performs all
// requirement transfers implied by this removal and then removes the
// element from the heap. If this is the last node in the heap, the node
// is removed from the tree.
// 'removalPos' is the forward position of the the first element in the
// range covered by the heap node. Since the element is removed from a
// heap node, this must be sufficient for the needs of the requirements
// which are intersted in this removal.

PartialOrderTree.prototype.removeElementFromHeap =
    partialOrderTreeRemoveElementFromHeap;

function partialOrderTreeRemoveElementFromHeap(node, element, removalPos)
{
    // queue transfer of absolute requirements from lower nodes
    if(node.posTraceForward > 0)
        this.notifyAbsForward(node, node.posTraceForward, true,
                              false, element);
    if(node.posTraceBackward > 0)
        this.notifyAbsBackward(node, node.posTraceBackward, true,
                               false, element);
    
    // transfer requirements which need to be trasferred as a result of
    // this removal.
    this.transferRequirementsAfterRemoval(element, node, removalPos);

    if(node.subTreeSize === 0)
        // node spliced and its content transferred to the node stored under
        // 'parent' (must be a heap node)
        node = node.parent;
    
    // decrease sub-tree count on dominating chain
    for(var parent = node.parent ; parent !== undefined ;
        parent = parent.parent) {
        parent.subTreeSize--;
    }
    
    if(node.heap.getSize() == 1) {
        // last element on the heap, need to remove the node
        this.removeNode(node);
    } else {

        if(node.subTreeSize !== undefined)
            node.subTreeSize--;
        
        // remove the element from the heap
        if(this.uniqueValueAttr === undefined)
            node.heap.removeIndex(element);
        else
            node.heap.removeIndex(element[this.uniqueValueAttr]);
    }
}

// This function is called when the element 'element' is to be removed
// from the set and the element was found to be stored on the node 'node'
// which is a single element node (that is, does not store a heap of
// elements). This function first suspends any element requirements
// anchored at this element and performs all requirement transfers
// implied by this removal and then removes the node from the tree.
// 'removalPos' is the forward position of the removal (0 in case the
// element removed is the first in the ordering).

PartialOrderTree.prototype.removeElementNode =
    partialOrderTreeRemoveElementNode;

function partialOrderTreeRemoveElementNode(node, element, removalPos)
{
    this.nodeBeingRemoved = node;
    
    // queue transfer of absolute requirements from lower nodes. 
    if(node.posTraceForward > 0)
        this.notifyAbsForward(node, node.posTraceForward, true,
                              false, element);
    if(node.posTraceBackward > 0)
        this.notifyAbsBackward(node, node.posTraceBackward, true,
                               false, element);
    
    // queue transfer of requirements from this node
    if(node.absForward !== undefined)
        this.queuedForward.push(node);
    if(node.absBackward !== undefined)
        this.queuedBackward.push(node);
    
    // suspend element requirements anchored at this element
    if(node.elementForward !== undefined) {
        // remove tracing for this requirement (if any was added)
        this.removeElementRequirementTracing(node.elementForward, node);
        this.suspendRequirement(node.elementForward);
        node.elementForward = undefined;
    }
    if(node.elementBackward !== undefined) {
        // remove tracing for this requirement (if any was added)
        this.removeElementRequirementTracing(node.elementBackward, node);
        this.suspendRequirement(node.elementBackward);
        node.elementBackward = undefined;
    }
    
    // transfer absolute and relative requirements
    this.transferRequirementsAfterRemoval(element, node, removalPos);

    // decrease sub-tree count on dominating chain
    for(var parent = node.parent ; parent !== undefined ;
        parent = parent.parent) {
        parent.subTreeSize--;
    }
    
    // remove the node from the tree
    this.removeNode(node);

    this.nodeBeingRemoved = undefined;
}

// This function is called to remove the node 'node' from the tree after
// the last element stored on this node was removed (this applies both
// to heap nodes which may store multiple elements and to element nodes
// which store a single element). This function only performs the operations
// which are needed to remove the node from the tree structure.
// The removal is the same as in a red-black tree.  A node is chosen for
// splicing (removing out of the tree structure) which has at most one
// child. The child of the spliced node is then inserted in the
// position previously occupied by the spliced node. If the spliced
// node is not the removed node, the content of the spliced node is
// copied to the removed node (which remains in the tree).

PartialOrderTree.prototype.removeNode =
    partialOrderTreeRemoveNode;

function partialOrderTreeRemoveNode(node)
{
    var splice;

    if(node.left === undefined || node.right === undefined)
        splice = node;
    else
        splice = node.next;

    if(splice != node) {
        // the node spliced is not the node that is removed, so the spliced
        // node will be copied to the removed node (which remains in the tree).
        // The removed node must dominated the spliced node, so the
        // forward/backward traces due to the spliced node have to be removed
        // from all dominating node up to (and including) the removed node,
        // since these requirements will now be moved up to the removed node.
        var numForward =
            (splice.absForward !== undefined ? splice.absForward.length : 0) +
            (splice.elementForward !== undefined ? 1 : 0);
        if(numForward > 0)
            this.removeForwardTraceUpTo(splice, numForward, node);
        var numBackward =
            (splice.absBackward !== undefined ? splice.absBackward.length : 0) +
            (splice.elementBackward !== undefined ? 1 : 0);
        if(numBackward > 0)
            this.removeBackwardTraceUpTo(splice, numBackward, node);
        // in this case we also need to decrease the sub-tree counts for the
        // chain of dominating nodes from the spliced node to the removed node
        // (not including)
        var spliceSize = splice.getSize();
        for(var parent = splice.parent ; parent !== node ;
            parent = parent.parent) {
            parent.subTreeSize -= spliceSize;
        }
    }
    
    // splice the spliced node out of the linked list
    if(splice.prev)
        splice.prev.next = splice.next;
    else
        this.first = splice.next;
    if(splice.next)
        splice.next.prev = splice.prev;
    else
        this.last = splice.prev;

    // spliced node can have at most one child. This child needs
    // to be inserted in the position where the splice node was
    var child = (splice.left !== undefined) ? splice.left : splice.right;

    if(child !== undefined)
        child.parent = splice.parent;
    if(splice.parent === undefined)
        this.root = child;
    else if(splice == splice.parent.left) {
        splice.parent.left = child;
        if(child === undefined && splice.parent.right === undefined)
            splice.parent.subTreeSize = undefined;
    } else {
        splice.parent.right = child;
        if(child === undefined && splice.parent.left === undefined)
            splice.parent.subTreeSize = undefined;
    }
 
    if(splice != node) {
        // if the node spliced was not the node deleted, we need to copy
        // the content of the spliced node (which should remain in the tree)
        // to the removed node (which remains in the tree, but should not).
        // This consists of the elements, the requirements and the next/prev
        // traces, but not the forward/backward traces (these were updated
        // above). Before doing so, decrease the sub-tree size of the
        // node by its current size
        node.subTreeSize -= node.getSize();
        node.copyContentFromNode(splice);
    }

    // fix the red-black property
    this.fixAfterRemoval(splice);
}

// This function is called to remove all elements. Basically, all this
// function needs to do is destroy the tree. However, before doing so,
// the function needs to store the requirement nodes which are currently
// in the tree. Anchored requirements are suspended an absolute requirements
// are transferred to the virtual nodes (which must be created, if necessary).

PartialOrderTree.prototype.removeAllElements =
    partialOrderTreeRemoveAllElements;

function partialOrderTreeRemoveAllElements()
{
    // go over all requirements. Suspend the anchored requirements and
    // place the absolute requirements on the virtual nodes. Notify the
    // requirements to clear their matches.

    // duplicate the list of requirements, as it may be modified by the
    // operations below.
    var numElements = this.getSize();
    var requirements = [].concat(this.allRequirements.requirements);
    var l = requirements.length;
    
    for(var i = 0 ; i < l ; ++i) {
        var requirement = requirements[i];
        // notify the requirement that it should clear all its matches
        // (if there are multiple simple requirements which belong to the
        // same compound requirement, they are all notified an it is
        // up to the requirement object to handle this correctly)
        requirement.clearAllElements();
        
        if(requirement.anchor !== undefined) {
            // anchor requirement (suspend it)
            this.suspendRequirement(requirement);
        } else if(requirement.offset !== undefined &&
                  requirement.offset < numElements) {
            // absolute requirement (simple/begin/end): transfer the
            // requirement to the appropriate virtual node (except for
            // end requirements which should not be registered to the tree
            // until the begin requirement is satisfied by some element)
            if(!requirement.isEnd) {
                var virtualNode = this.getVirtualNode(requirement.isBackward);
                virtualNode.addAbsRequirement(requirement,
                                              requirement.offset + 1);
            }
            // for complement requirements, there is nothing more to do here
            // (their end-point absolute requirements were already handled
            // above).
        }
    }

    // clear the tree
    this.root = undefined;
    this.first = undefined;
    this.last = undefined;
    // reset the virtual nodes
    if(this.virtualFirst !== undefined)
        this.virtualFirst.resetAfterClearElements();
    if(this.virtualLast !== undefined)
        this.virtualLast.resetAfterClearElements();
}

// This function returns true if the given node is allowed to be made into
// a heap node (possibly by merging it with another node, which is also
// allowed to be a heap node).

// currently, we use this only when absolute requirements are moved or
// removed, should call this also elsewhere xxxxxxxxxxxxx

PartialOrderTree.prototype.allowsHeap = partialOrderTreeAllowsHeap;

function partialOrderTreeAllowsHeap(node)
{
    return (this.noHeapNodes == 0 && node !== this.nodeBeingRemoved &&
            node.allowsHeap());
}

// This function can be called to merge 'node' with 'node.next' into a single
// heap node. It is assumed that the calling function has already determined
// that these nodes may be merged. The elements of one node are copied to
// the other node (all stored together in one heap) and the other node is
// removed.
// In case the calling function holds a pointer to the node being spliced
// by this function, this function sets the subTreeSize of the node
// spliced here to 0 (even if it was a leaf node and therefore had an
// undefined subTreeSize) and sets the 'parent' pointer of the spliced
// node to the node it was merged with.

PartialOrderTree.prototype.mergeWithNextNode =
    partialOrderTreeMergeWithNextNode;

function partialOrderTreeMergeWithNextNode(node)
{
    // determine which node to splice (one of the nodes has at most one child)

    var splice;
    var remains;
    
    if(node.right == undefined) {
        splice = node;
        remains = node.next;
    } else {
        splice = node.next;
        remains = node;
    }

    // remove the count of the spliced node elements from intermediate nodes

    var spliceSize = splice.getSize();
    for(var parent = splice.parent ; parent != remains ; parent = parent.parent)
        parent.subTreeSize -= spliceSize;
    
    // splice the spliced node out of the linked list
    if(splice.prev)
        splice.prev.next = splice.next;
    else
        this.first = splice.next;
    if(splice.next)
        splice.next.prev = splice.prev;
    else
        this.last = splice.prev;

    // spliced node can have at most one child. This child needs
    // to be inserted in the position where the splice node was
    var child = (splice.left !== undefined) ? splice.left : splice.right;

    if(child !== undefined)
        child.parent = splice.parent;
    if(splice.parent === undefined)
        this.root = child;
    else {
        if(splice == splice.parent.left)
            splice.parent.left = child;
        else
            splice.parent.right = child;
        if(splice.parent.left === undefined &&
           splice.parent.right === undefined)
            splice.parent.subTreeSize = undefined;
    }

    // copy the elements of both nodes to a single heap. If at least one
    // of the nodes already carries a heap, the elements are copied into
    // the heap which contains more elements
    
    var heap;
    if(splice.heap === undefined) {
        if(remains.heap !== undefined) {
            heap = remains.heap;
            heap.add(splice.element);
        } else {
            heap = new MinMaxPosHeap(this.heapCompare, this.uniqueValueAttr);
            heap.add(splice.element);
            heap.add(remains.element);
        }
    } else if(remains.heap === undefined) {
        heap = splice.heap;
        heap.add(remains.element);
    } else {
        var fromHeap;
        if(splice.getSize() >= remains.getSize()) {
            heap = splice.heap;
            fromHeap = remains.heap;
        } else {
            fromHeap = splice.heap;
            heap = remains.heap;
        }
        for(var i = 1, l = fromHeap.heap.length ; i < l ; ++i)
            heap.add(fromHeap.heap[i]);
    }
    
    // set the heap on the node which remains
    remains.heap = heap;
    if(remains.element !== undefined)
        remains.element = undefined;
    
    // fix the red-black property
    this.fixAfterRemoval(splice);

    // store the information of this operation on the spliced node
    // such that any function holding a pointer to this node would be
    // able to transfer it to the node where its values were trasferred to 
    splice.subTreeSize = 0; // indicate this node was spliced
    splice.parent = remains;
}

//////////////////////////
// Change Notifications //
//////////////////////////

// This function is called when an element is added or removed before 'node'.
// If 'elementUnderNode' is true, the element is added or removed under the left
// branch under node 'node' and otherwise the element is not added or removed
// under 'node' (neither under the left nor under the right branch).
// This is true only for the topmost call of the recursion (since
// the recursion continues to nodes under the right branch of the node
// under whose left branch the element is added or removed).
// 'refCount' is the number of absolute forward requirement nodes under
// 'node' which need to be notified of this change.
// 'added' is true if an element was added and false if it was removed
// and 'element' is the element which was added or removed.
// If the node itself has absolute/element forward requirements and
// 'elementUnderNode' is false, the element requirement is notified of the
// addition/removal of the element and the absolute requirements are queued
// to be moved to the previous/next node(whether to the previous or next node
// depends on whether this is an insertion or removal operation and does not
// matter here, as the queue is the same). The number of requirements
// updated or queued for movement is subtracted from 'refCount'. The function
// continues recursively down the left and right children of this
// node. It continues down the right branch with a reference count
// equal to 'node.posTraceForward' and down the left branch with the
// remaining reference count (that is, what remains of 'refCount'
// after subtracting the forward absolute/element requirements on
// 'node' and 'node.posTraceForward'). The recursion stops when the
// reference count reaches zero.
// When requirements are queued to be moved, we need to queue the requirements
// which are later in the ordering before requirements which are earlier
// in the ordering (as when they are moved we need them to be ordered in the
// queue and this is the ordering implied by the search through the tree).
// This means that we first perform the recursive call down the right branch,
// then queue the requirements on this node (if they need to be queued,
// see above) and only then go down the left branch.

PartialOrderTree.prototype.notifyAbsForward =
    partialOrderTreeNotifyAbsForward;

function partialOrderTreeNotifyAbsForward(node, refCount, elementUnderNode,
                                          adding, element)
{
    if(node.posTraceForward > 0)
        this.notifyAbsForward(node.right, node.posTraceForward, false,
                              adding, element);

    if(!elementUnderNode) {
        if(node.absForward !== undefined) {
            // queue the transfer of the requirements to the previous node
            this.queuedForward.push(node);
            refCount -= node.absForward.length;
        }
        if(node.elementForward !== undefined) {
            if(adding) // notify the element requirement that element was added
                node.elementForward.updateAddElement(element);
            else // notify the element requirement that element was removed
                node.elementForward.updateRemoveElement(element);
            refCount--;
        }
    }

    if(refCount == 0)
        return; // notified all requirement nodes
    
    if(refCount > node.posTraceForward)
        this.notifyAbsForward(node.left, refCount - node.posTraceForward,
                              false, adding, element);
}

// This function is called when a new element is added or removed after 'node'.
// If 'elementUnderNode' is true, the element is added or removed under the
// right branch under node 'node' and otherwise the element is not added or
// removed under 'node' (neither under the right nor under the left branch).
// This is true only for the topmost call of the recursion (since
// the recursion continues to nodes under the left branch of the node
// under whose right branch the element is added or removed).
// 'refCount' is the number of absolute backward requirement nodes under
// 'node' which need to be notified of this change.
// 'added' is true if an element was added and false if it was removed
// and 'element' is the element which was added or removed.
// If the node itself has absolute/element backward requirements and
// 'elementUnderNode' is false, the element requirement is notified of the
// addition/removal of the element and the absolute requirements are queued
// to be moved to the next or previous node (whether to the next or previous
// node depends on whether this is an insertion or removal operation and
// does not matter here, as the queue is the same). The number of requirements
// updated or queued for movement is subtracted from 'refCount'. The function
// continues recursively down the left and right children of this node.
// It continues down the left branch with a reference count equal to
// 'node.posTraceBackward' and down the right branch with the
// remaining reference count (that is, what remains of 'refCount'
// after subtracting the backward absolute/element requirements on
// 'node' and 'node.posTraceBackward'). The recursion stops when the
// reference count reaches zero.
// When requirements are queued to be moved, we need to queue the requirements
// which are earlier in the ordering before requirements which are later
// in the ordering (as when they are moved we need them to be ordered in the
// queue and this is the ordering implied by the search through the tree).
// This means that we first perform the recursive call down the left branch,
// then queue the requirements on this node (if they need to be queued,
// see above) and only then go down the right branch.

PartialOrderTree.prototype.notifyAbsBackward =
    partialOrderTreeNotifyAbsBackward;

function partialOrderTreeNotifyAbsBackward(node, refCount, elementUnderNode,
                                           adding, element)
{
    if(node.posTraceBackward > 0)
        this.notifyAbsBackward(node.left, node.posTraceBackward, false,
                               adding, element);

    if(!elementUnderNode) {
        if(node.absBackward !== undefined) {
            // queue the transfer of the requirements to the next node
            this.queuedBackward.push(node);
            refCount -= node.absBackward.length;
        }
        if(node.elementBackward !== undefined) {
            if(adding) // notify the element requirement that element was added
                node.elementBackward.updateAddElement(element);
            else // notify the element requirement that element was removed
                node.elementBackward.updateRemoveElement(element);
            refCount--;
        }
    }

    if(refCount == 0)
        return; // notified all requirement nodes
    
    if(refCount > node.posTraceBackward)
        this.notifyAbsBackward(node.right, refCount - node.posTraceBackward,
                               false, adding, element);
}

// This function is called when an element is added at a position where
// 'next tracing' is active. This function is called on each of the nodes
// to which the notification should be sent. The function is called with
// the node ('node') to which the notification is being sent. This is allowed
// to be undefined, which mean that this notification is sent to the virtual
// last node. 'distance' is the distance between the inserted node and 'node'
// ('distance' === 1 means that the inserted node is just before 'node' and
// in case of the virtual last node, a distance of 1 means that the last node
// in the tree was just inserted). 'traceCount' is the number of relative
// requirement nodes which need to be notified of this change.
// When the node is a tree node (not the virtual last node) the function
// performs the following operation:
//    The function first checks whether 'node' has forward relative
//    requirements whose distance from the anchor is at least 'distance'.
//    If it does, each of these requirements is moved to the previous node
//    (as the insertion took place between the requirement node and the
//    anchor). 'traceCount' is decrease by 1 for each requirement node which
//    is thus moved. If at the end of this operation 'traceCount' is not yet
//    zero, this function is called recursively for the next node with the
//    remaining trace count and the distance increased by 1.
//    (if the next node is undefined, this function is called with undefined
//    node which represents the virtual last node).
// When 'node' is undefined, the function is applied to the virtual last
// node, as follows:
//    The function goes over the relative requirements on the virtual node.
//    For each requirement it checks whether 'distance' + the gap of
//    the requirement - 1 is no larger than the relative position (required
//    distance from the anchor) of the requirement. If this holds, the
//    gap of the requiremen is decreased by 1. If the gap became 0,
//    the requirement is transferred to the last node in the tree.

PartialOrderTree.prototype.notifyAddRelForward =
    partialOrderTreeNotifyAddRelForward;

function partialOrderTreeNotifyAddRelForward(node, distance, traceCount)
{
    if(node === undefined) { // apply to the virtual last node
        if(this.virtualLast !== undefined) {
            var popped = this.virtualLast.notifyAddRel(distance);
            if(popped.length == 0)
                return;

            // make sure the last element is stored in an element node
            this.convertMaxElementToNode(this.last);
            
            for(var i = 0, l = popped.length ; i < l ; ++i) {
                var requirement = popped[i];
                if(this.last.relForward === undefined)
                    this.last.relForward = [requirement];
                else
                    this.last.relForward.push(requirement);
                requirement.updateElement(this.last.element);
            }
            if(this.virtualLast.isEmpty()) // remove the virtual node
                this.virtualLast = undefined;
        }
    } else {
        if(node.relForward !== undefined) {
            // make sure the previous node is an element node
            this.convertMaxElementToNode(node.prev);
            
            // loop over the forward relative requirements
            var i = 0;
            var l = node.relForward.length;
            while(i < l) {
                var requirement = node.relForward[i];
                if(requirement.offset < distance) {
                    i++;
                    continue;
                }
                // transfer the requirement to the previous node
                if(node.prev.relForward === undefined)
                    node.prev.relForward = [requirement];
                else
                    node.prev.relForward.push(requirement);
                // replace the requirement by the last requirement and make
                // the list shorter
                if(i < l - 1)
                    node.relForward[i] = node.relForward[l-1];
                node.relForward.length--;
                l--;
                requirement.updateElement(node.prev.element);
                traceCount--;
            }
            if(node.relForward.length == 0)
                node.relForward = undefined;
        }
        if(traceCount > 0)
            this.notifyAddRelForward(node.next, distance + node.getSize(),
                                     traceCount);
    }
}

// This function is called when an element is added at a position where
// 'prev tracing' is active. This function is called on each of the nodes
// to which the notification should be sent. The function is called with
// the node ('node') to which the notification is being sent. This is allowed
// to be undefined, which mean that this notification is sent to the virtual
// first node. 'distance' is the distance between the inserted node and 'node'
// ('distance' === 1 means that the inserted node is just before 'node' and
// in case of the virtual first node, a distance of 1 means that the first node
// in the tree was just inserted). 'traceCount' is the number of relative
// requirement nodes which need to be notified of this change.
// When the node is a tree node (not the virtual first node) the function
// performs the following operation:
//    The function first checks whether 'node' has backward relative
//    requirements whose distance from the anchor is at least 'distance'.
//    If it does, each of these requirements is moved to the next node
//    (as the insertion took place between the requirement node and the
//    anchor). 'traceCount' is decrease by 1 for each requirement node which
//    is thus moved. If at the end of this operation 'traceCount' is not yet
//    zero, this function is called recursively for the previous node with the
//    remaining trace count and the distance increased by 1.
//    (if the next node is undefined, this function is called with undefined
//    node which represents the virtual first node).
// When 'node' is undefined, the function is applied to the virtual first
// node, as follows:
//    The function goes over the relative requirements on the virtual node.
//    For each requirement it checks whether 'distance' + the gap of
//    the requirement -1 is no larger than the relative position (required
//    distance from the anchor) of the requirement. If this holds, the
//    gap of the requiremen is decreased by 1. If the gap became 0,
//    the requirement is transferred to the first node in the tree.

PartialOrderTree.prototype.notifyAddRelBackward =
    partialOrderTreeNotifyAddRelBackward;

function partialOrderTreeNotifyAddRelBackward(node, distance, traceCount)
{
    if(node === undefined) { // apply to the virtual first node
        if(this.virtualFirst !== undefined) {
            var popped = this.virtualFirst.notifyAddRel(distance);
            if(popped.length == 0)
                return;

            // make sure the first node is an element node
            this.convertMinElementToNode(this.first);
            
            for(var i = 0, l = popped.length ; i < l ; ++i) {
                var requirement = popped[i];
                if(this.first.relBackward === undefined)
                    this.first.relBackward = [requirement];
                else
                    this.first.relBackward.push(requirement);
                requirement.updateElement(this.first.element);
            }
            if(this.virtualFirst.isEmpty()) // remove the virtual node
                this.virtualFirst = undefined;
        }
    } else {
        if(node.relBackward !== undefined) {

            // make sure the next node is an element node
            this.convertMinElementToNode(node.next);
            
            // loop over the backward relative requirements
            var i = 0;
            var l = node.relBackward.length;
            while(i < l) {
                var requirement = node.relBackward[i];
                if(requirement.offset < distance) {
                    i++;
                    continue;
                }
                // transfer the requirement to the previous node
                if(node.next.relBackward === undefined)
                    node.next.relBackward = [requirement];
                else
                    node.next.relBackward.push(requirement);
                // replace the requirement by the last requirement and make
                // the list shorter
                if(i < l - 1)
                    node.relBackward[i] = node.relBackward[l-1];
                node.relBackward.length--;
                l--;
                requirement.updateElement(node.next.element);
                traceCount--;
            }
            if(node.relBackward.length == 0)
                node.relBackward = undefined;
        }
        
        if(traceCount > 0)
            this.notifyAddRelBackward(node.prev, distance + node.getSize(),
                                      traceCount);
    }
}

// This function is called when an element is removed at a position where
// next tracing is active. This function is called (recursively) on each of
// the nodes to which the notification should be sent. 'node' is the node
// to which the notification is sent, that is, this is a node which potentially
// carries a relative forward requirement (which needs to be moved to the next
// node as a result of the removal of the element) or is between the
// place of removal and the node which carries relative forward requirements
// which are affected by this removal (these nodes will be down the 'next'
// chain from 'node'). This function is originally called with 'node' being
// the node from which the element was removed. 'distance' is the distance
// between the position of the node fro which the element was removed
// and 'node' (in the initial call, where 'node' is the node from which the
// element was removed, this distance is 0). As the function is called
// on consecutive nodes in the chain this distance is increased by
// the number of elements stored on each node. The distance is used to
// determine which requirements this applies to. A requirement for an offset
// of n is not affected by a change which took place at a distance > n even
// if the node on which it is registered receives this notification (if the
// removal took place at a distance of exactly n, the requirement should not
// be registered anymore because it is a requirement relative to the element
// which was just removed).
// 'traceCount' is the number of relative requirements which still need to
// be notified of the removal. This is equal to the 'next trace' count on
// the node at which the element was removed, minus the number of relative
// requirements which were already moved (by previous calls to this function
// for the same removal). 'traceCount' is decreased by this function for
// each relative requirement moved by this function, except for those
// requirements moved from the node from which the element was removed
// (this is because a relative requirement sets a trace on all node between
// it and its anchor, including the anchor node but excluding the node
// on which the relative requirement is registered). The recursive call
// terminates when 'traceCount' reaches zero.
// For each node this function is called on, the function loops over all
// relative forward requirements stored on that node and checks which of
// them has an offset larger than 'distance'. These requirements are moved
// to the next node. If the next node is a heap node, the first element in
// the heap node must first be popped and stored on a new node, which now
// becomes the next node (a requirement may not be stored an a heap node).
// If the node does not have a next node (this is the last node in the tree)
// the requirements are moved to the virtual last node (which may have to
// be created).
// When requirements are moved, the next traces are updated (on the node
// from which the requirement was moved, if that node is not where the
// element was removed from).
// When a relative requirement has an offset exactly equal to 'distance'
// (meaning that its anchor element was removed) that requirement is
// destroyed.

PartialOrderTree.prototype.notifyRemoveRelForward =
    partialOrderTreeNotifyRemoveRelForward;

function partialOrderTreeNotifyRemoveRelForward(node, distance, traceCount)
{
    if(node === undefined) {
        // this affects some requirements on the virtual node
        if(this.virtualLast !== undefined)
            this.virtualLast.notifyRemoveRel(distance);
        return;
    }
    
    if(node.relForward !== undefined) {
        // loop over the forward relative requirements
        var i = 0;
        var l = node.relForward.length;
        while(i < l) {
            var requirement = node.relForward[i];
            if(requirement.offset < distance) {
                i++;
                continue;
            }
            if(requirement.offset == distance) {
                // remove the requirement (its anchor was removed)
                this.suspendRequirement(requirement);
            } else { // transfer the requirement to the next node
                if(node.next === undefined) {
                    //transfer to the virtual last node
                    this.getVirtualNode(false).addRelRequirement(requirement,
                                                                 1);
                } else {
                    // make sure the next node is an element node
                    this.convertMinElementToNode(node.next);
                    if(node.next.relForward === undefined)
                        node.next.relForward = [requirement];
                    else
                        node.next.relForward.push(requirement);
                }
                // moving the requirement increases the trace on this node
                if(distance > 0)
                    node.nextTrace++;
                requirement.updateElement(node.next ?
                                          node.next.element : undefined);
            }
            // replace the requirement by the last requirement and make
            // the list shorter
            if(i < l - 1)
                node.relForward[i] = node.relForward[l-1];
            node.relForward.length--;
            l--;
            if(distance > 0) // is 0 if at node where element was removed
                traceCount--;
        }
        if(node.relForward.length == 0)
            node.relForward = undefined;
    }
    if(traceCount > 0)
        this.notifyRemoveRelForward(node.next, distance + node.getSize(),
                                    traceCount);
}

// This function is called when an element is removed at a position where
// prev tracing is active. This function is called (recursively) on each of
// the nodes to which the notification should be sent. 'node' is the node
// to which the notification is sent, that is, this is a node which potentially
// carries a relative backward requirement (which needs to be moved to the
// previous node as a result of the removal of the element) or is between the
// place of removal and the node which carries relative backward requirements
// which are affected by this removal (these nodes will be down the 'prev'
// chain from 'node'). This function is originally called with 'node' being
// the node from which the element was removed. 'distance' is the distance
// between the position of the node from which the element was removed
// and 'node' (in the initial call, where 'node' is the node from which the
// element was removed, this distance is 0). As the function is called
// on consecutive nodes in the chain this distance is increased by
// the number of elements stored on each node. The distance is used to
// determine which requirements this applies to. A requirement for an offset
// of n is not affected by a change which took place at a distance > n even
// if the node on which it is registered receives this notification (if the
// removal took place at a distance of exactly n, the requirement should not
// be registered anymore because it is a requirement relative to the element
// which was just removed).
// 'traceCount' is the number of relative requirements which still need to
// be notified of the removal. This is equal to the 'prev trace' count on
// the node at which the element was removed, minus the number of relative
// requirements which were already moved (by previous calls to this function
// for the same removal). 'traceCount' is decreased by this function for
// each relative requirement moved by this function, except for those
// requirements moved from the node from which the element was removed
// (this is because a relative requirement sets a trace on all node between
// it and its anchor, including the anchor node but excluding the node
// on which the relative requirement is registered). The recursive call
// terminates when 'traceCount' reaches zero.
// For each node this function is called on, the function loops over all
// relative backward requirements stored on that node and checks which of
// them has an offset larger than 'distance'. These requirements are moved
// to the previous node. If the previous node is a heap node, the last
// element in the heap node must first be popped and stored on a new node,
// which now becomes the new previous node (a requirement may not be stored
// on a heap node). If the node does not have a previous node (this is
// the first node in the tree) the requirements are moved to the virtual first
// node (which may have to be created).
// When requirements are moved, the prev traces are updated (on the node
// from which the requirement was moved, if that node is not where the
// element was removed from).
// When a relative requirement has an offset exactly equal to 'distance'
// (meaning that its anchor element was removed) that requirement is
// destroyed.

PartialOrderTree.prototype.notifyRemoveRelBackward =
    partialOrderTreeNotifyRemoveRelBackward;

function partialOrderTreeNotifyRemoveRelBackward(node, distance, traceCount)
{
    if(node === undefined) {
        // this affects some requirements on the virtual node
        if(this.virtualFirst !== undefined)
            this.virtualFirst.notifyRemoveRel(distance);
        return;
    }
    
    if(node.relBackward !== undefined) {
        // loop over the backward relative requirements
        var i = 0;
        var l = node.relBackward.length;
        while(i < l) {
            var requirement = node.relBackward[i];
            if(requirement.offset < distance) {
                i++;
                continue;
            }
            if(requirement.offset == distance) {
                // suspend the requirement (its anchor was removed)
                this.suspendRequirement(requirement);
            } else { // transfer the requirement to the previous node
                if(node.prev === undefined) {
                    //transfer to the virtual first node
                    this.getVirtualNode(true).addRelRequirement(requirement, 1);
                } else {
                    // make sure the previous node is an element node
                    this.convertMaxElementToNode(node.prev);

                    if(node.prev.relBackward === undefined)
                        node.prev.relBackward = [requirement];
                    else
                        node.prev.relBackward.push(requirement);
                }
                // moving the requirement increases the trace on this node
                if(distance > 0)
                    node.prevTrace++;
                requirement.updateElement(node.prev ?
                                          node.prev.element : undefined);
            }
            // replace the requirement by the last requirement and make
            // the list shorter
            if(i < l - 1)
                node.relBackward[i] = node.relBackward[l-1];
            node.relBackward.length--;
            l--;
            if(distance > 0) // is 0 if at node where element was removed
                traceCount--;
        }
        if(node.relBackward.length == 0)
            node.relBackward = undefined;
    }
    if(traceCount > 0)
        this.notifyRemoveRelBackward(node.prev, distance + node.getSize(),
                                     traceCount);
}

// This function is called when the element stored at a node at distance
// 'distance' from 'node' is replaced by another element (typically
// during reordering). 'distance' is the difference between the forward
// offset of 'node' and the forward offset of the node at which the
// element was replaced. This function removes all forward relative
// requirements at 'node' whose offset is equal to 'distance' (which
// means that they are anchored at the element which was replaced).
// The requirements removed from 'node' are pushed onto the array
// 'removed' which is also returned by this function. If 'removed'
// does not yet exist, it is created.
// When the requirements are removed, the 'nextTrace' added for them is
// also removed.
// This function continues recursively to the next node, continuing to
// remove relative requirements whose anchor was just replaced. These
// removed requirements are added to the same 'removed' array.
// 'traceCount' is the 'nextTrace' of the node at which the element was
// replaced minus the number of relative forward requirements on nodes
// between the node at which the replacement (including) and 'node'
// (excluding) whose offset is <= the distance of those nodes from the
// node on which the replacement took place. This is the number of
// relative requirements such that the node at which the replacement
// took place is between the anchor of the requirement and the node satisfying
// the requirement. When this number drops to zero there is no need to
// continue recursively to the next node.

PartialOrderTree.prototype.notifyReplaceRelForward =
    partialOrderTreeNotifyReplaceRelForward;

function partialOrderTreeNotifyReplaceRelForward(node, distance, traceCount,
                                                 removed)
{
    if(node === undefined) {
        // this affects some requirements on the virtual node
        if(this.virtualLast !== undefined) {
            removed = this.virtualLast.notifyReplaceRel(distance, removed);
            if(this.virtualLast.isEmpty())
                this.virtualLast = undefined;
        }
        return removed ? removed : [];
    }

    if(removed === undefined)
        removed = [];
    
    if(node.relForward !== undefined) {
        // loop over the forward relative requirements and check which are
        // at for given distance.
        var i = 0;
        var l = node.relForward.length;
        while(i < l) {
            var requirement = node.relForward[i];
            if(requirement.offset < distance) {
                i++;
                continue;
            }
            if(distance > 0) // is 0 if at node where element was replaced
                traceCount--;
            if(requirement.offset == distance) {
                // remove the requirement (its anchor was removed)
                if(i < l - 1)
                    node.relForward[i] = node.relForward[l-1];
                node.relForward.length--;
                l--;
                removed.push(requirement);
            }
        }

        if(node.relForward.length == 0)
            node.relForward = undefined;
    }
    
    if(traceCount > 0) {
        var removedAtOrBeforeThisNode = removed.length;
        removed = this.notifyReplaceRelForward(node.next,
                                               distance + node.getSize(),
                                               traceCount, removed);
        // decrease trace for requirements removed on the right
        node.nextTrace -= (removed.length - removedAtOrBeforeThisNode);
    }
    
    return removed;
}

// This function is identical to notifyReplaceRelForward() except that it
// is handles the replacement of the anchor element of backward relative
// requirements rather than forward relative requirements.

PartialOrderTree.prototype.notifyReplaceRelBackward =
    partialOrderTreeNotifyReplaceRelBackward;

function partialOrderTreeNotifyReplaceRelBackward(node, distance, traceCount,
                                                  removed)
{
    if(node === undefined) {
        // this affects some requirements on the virtual node
        if(this.virtualFirst !== undefined) {
            removed = this.virtualFirst.notifyReplaceRel(distance, removed);
            if(this.virtualFirst.isEmpty())
                this.virtualFirst = undefined;
        }
        return removed ? removed : [];
    }

    if(removed === undefined)
        removed = [];
    
    if(node.relBackward !== undefined) {
        // loop over the backward relative requirements and check which are
        // at for given distance.
        var i = 0;
        var l = node.relBackward.length;
        while(i < l) {
            var requirement = node.relBackward[i];
            if(requirement.offset < distance) {
                i++;
                continue;
            }
            if(distance > 0) // is 0 if at node where element was replaced
                traceCount--;
            if(requirement.offset == distance) {
                // remove the requirement (its anchor was removed)
                if(i < l - 1)
                    node.relBackward[i] = node.relBackward[l-1];
                node.relBackward.length--;
                l--;
                removed.push(requirement);
            }
        }

        if(node.relBackward.length == 0)
            node.relBackward = undefined;
    }
    
    if(traceCount > 0) {
        var removedAtOrBeforeThisNode = removed.length;
        removed = this.notifyReplaceRelBackward(node.next,
                                                distance + node.getSize(),
                                                traceCount, removed);
        // decrease trace for requirements removed on the left
        node.prevTrace -= (removed.length - removedAtOrBeforeThisNode);
    }
    
    return removed;
}

//////////////////
// Trace Update //
//////////////////

// This function increases the forward trace by the given 'count'
// (the number of absolute requirements which were added at or under the node)
// on the nodes dominating this node. This function checks whether the
// give node (if it is not the root node) is the right child of its
// parent. If it is, it increases the posTraceForward property of the parent
// by the given count. It then continues recursively to the parent node.

PartialOrderTree.prototype.addForwardTrace =
    partialOrderTreeAddForwardTrace;

function partialOrderTreeAddForwardTrace(node, count)
{
    if(node.parent === undefined)
        return; // reached the root

    if(node.parent.right == node)
        node.parent.posTraceForward += count;

    this.addForwardTrace(node.parent, count);
}

// This function decreases the forward trace by the given 'count'
// (the number of absolute requirements which were removed at or under the node)
// on the nodes dominating this node. This function checks whether the
// give node (if it is not the root node) is the right child of its
// parent. If it is, it decreases the posTraceForward property of the parent
// by the given count. It then continues recursively to the parent node.

PartialOrderTree.prototype.removeForwardTrace =
    partialOrderTreeRemoveForwardTrace;

function partialOrderTreeRemoveForwardTrace(node, count)
{
    if(node.parent === undefined)
        return; // reached the root

    if(node.parent.right == node)
        node.parent.posTraceForward -= count;

    this.removeForwardTrace(node.parent, count);
}

// This function decreases the forward trace by the given 'count'
// (the number of absolute requirements which were removed at or under the node)
// on the nodes dominating this node, up to and including the node
// 'upToNode', which must be a node dominating 'node'. This function is
// identical to removeForwardTrace() except that it stops the update when
// reaching the node 'upToNode'.

PartialOrderTree.prototype.removeForwardTraceUpTo =
    partialOrderTreeRemoveForwardTraceUpTo;

function partialOrderTreeRemoveForwardTraceUpTo(node, count, upToNode)
{
    if(node.parent === undefined)
        return; // reached the root

    if(node.parent.right == node)
        node.parent.posTraceForward -= count;

    if(node.parent !== upToNode)
        this.removeForwardTraceUpTo(node.parent, count, upToNode);
}

// This function increases the backward trace by the given 'count'
// (the number of absolute requirements which were added at or under the node)
// on the nodes dominating this node. This function checks whether the
// give node (if it is not the root node) is the left child of its
// parent. If it is, it increases the posTraceBackward property of the parent
// by the given count. It then continues recursively to the parent node.

PartialOrderTree.prototype.addBackwardTrace =
    partialOrderTreeAddBackwardTrace;

function partialOrderTreeAddBackwardTrace(node, count)
{
    if(node.parent === undefined)
        return; // reached the root

    if(node.parent.left == node)
        node.parent.posTraceBackward += count;

    this.addBackwardTrace(node.parent, count);
}

// This function decreases the backward trace by the given 'count'
// (the number of absolute requirements which were removed at or under the node)
// on the nodes dominating this node. This function checks whether the
// give node (if it is not the root node) is the left child of its
// parent. If it is, it decreases the posTraceBackward property of the parent
// by the given count. It then continues recursively to the parent node.

PartialOrderTree.prototype.removeBackwardTrace =
    partialOrderTreeRemoveBackwardTrace;

function partialOrderTreeRemoveBackwardTrace(node, count)
{
    if(node.parent === undefined)
        return; // reached the root

    if(node.parent.left == node)
        node.parent.posTraceBackward -= count;

    this.removeBackwardTrace(node.parent, count);
}

// This function decreases the backward trace by the given 'count'
// (the number of absolute requirements which were removed at or under the node)
// on the nodes dominating this node, up to and including the node
// 'upToNode', which must be a node dominating 'node'. This function is
// identical to removeBackwardTrace() except that it stops the update when
// reaching the node 'upToNode'.

PartialOrderTree.prototype.removeBackwardTraceUpTo =
    partialOrderTreeRemoveBackwardTraceUpTo;

function partialOrderTreeRemoveBackwardTraceUpTo(node, count, upToNode)
{
    if(node.parent === undefined)
        return; // reached the root

    if(node.parent.left == node)
        node.parent.posTraceBackward -= count;

    if(node.parent !== upToNode)
        this.removeBackwardTraceUpTo(node.parent, count);
}

//////////////////////////
// Requirement Transfer //
//////////////////////////

// This function is called at the end of an element insertion operation.
// When this function is called, the element has already been inserted
// into the tree, at the node 'insertNode'.  The node 'insertNode' may be
// a new node or an existing node (before the operation).
// 'insertPos' is the position at which the node was inserted (the position
// is in the forward direction of the ordering and 0 is the beginning of
// the ordered set). This is only accurate if the insertion took place under
// an element node, rather than under a heap node (but if insertion took
// place under the heap node, the exact position cannot be interesting for the
// requirements). If the insertion took place into a heap, this is the position
// at which this heap begins.
// When this function is called, absolute requirements which need to be
// transferred from one node to another as a result of the insertion
// operation were already queued in the 'queuedForward' and 'queuedBackward'
// queues. This function transfers the absolute requirements which were
// queued for transfer.
// In addition, this function notifies all complement requirements
// (requirements over a range defined by one forward and one backward
// requirement) of the addition of this element.

PartialOrderTree.prototype.transferRequirementsAfterInsertion =
    partialOrderTreeTransferRequirementsAfterInsertion;

function partialOrderTreeTransferRequirementsAfterInsertion(insertedElement,
                                                            insertNode,
                                                            insertPos)
{    
    // move all requirements which were queued to be moved
    if(this.queuedForward.length != 0)
        this.moveForwardRequirementsToPrev(insertedElement, insertPos);
    if(this.queuedBackward.length != 0) {
        var backInsertPos = this.invertOffset(insertPos);
        this.moveBackwardRequirementsToNext(insertedElement, backInsertPos);
    }
    
    // check next/prev traces
    if(insertNode.nextTrace > 0)
        this.notifyAddRelForward(insertNode.next, 1, insertNode.nextTrace);
    if(insertNode.prevTrace > 0)
        this.notifyAddRelBackward(insertNode.prev, 1, insertNode.prevTrace);

    // notify complement requirements
    this.notifyComplementRequirementsOfAdd(insertedElement, insertPos);
}

// This function is called after the element 'insertedElement' was inserted
// into the tree. This function goes over the list of nodes for which the
// forward requirements were scheduled (in the process of inserting
// the new element) for transfer to the previous node. The transfer takes
// place in the order of the nodes in the ordering (that is, first the
// nodes at the beginning of the ordering and then those at the end of the
// ordering). An 'undefined' entry in the queue of nodes to transfer
// means that requirements may have ot be transfer from the virtual last node.
// Transferring the requirements consists of moving them from one node to
// the other, notifying the requirements themselves of this transfer,
// and updating the traces on the dominating nodes in the tree.
// 'insertedElement' is provided to requirement, since if a requirement is
// a range requirement (covering a range of absolute positions) moving
// only one end of the range requirement means that the 'insertedElement'
// was added to the range of the requirement.
// 'insertPos' is the position at which the node was inserted (the position
// is in the forward direction of the ordering and 0 is the beginning of
// the ordered set). This is only accurate if the insertion took place under
// an element node, rather than under a heap node (but if insertion took
// place under the heap node, the exact position cannot be interesting for the
// requirements). If the insertion took place into a heap, this is the position
// at which this heap begins.

PartialOrderTree.prototype.moveForwardRequirementsToPrev =
    partialOrderTreeMoveForwardRequirementsToPrev;

function partialOrderTreeMoveForwardRequirementsToPrev(insertedElement,
                                                       insertPos)
{
    // loop backwards over the queue

    var l = this.queuedForward.length;
    if(l == 0)
        return;

    for(var i = l-1 ; i >= 0 ; --i) {
        var node = this.queuedForward[i];
        if(node === undefined) {
            if(this.virtualLast !== undefined) {
                var popped = this.virtualLast.notifyAddAbsolute(insertedElement,
                                                                insertPos);
                if(popped.length == 0)
                    break; // this must be the last in the queue

                // make sure the last node is an element node
                this.convertMaxElementToNode(this.last);
                
                if(this.last.absForward === undefined)
                    this.last.absForward = [];
                for(var j = 0, m = popped.length ; j < m ; ++j) {
                    var requirement = popped[j];
                    this.last.absForward.push(requirement);
                    requirement.updateElement(this.last.element,
                                              insertedElement, insertPos, true);
                    if(requirement.isOrderedRange) {
                        if(requirement.isEnd)
                            this.last.noHeapNext--;
                        else
                            this.last.noHeapNext++;
                    }
                }

                // add a trace for the last node
                this.addForwardTrace(this.last, popped.length);
                
                if(this.virtualLast.isEmpty()) // remove the virtual node
                    this.virtualLast = undefined;
            }
        } else if(node.absForward !== undefined) {
            // all absolute forward requirements on 'node' need to be
            // transferred to the previous node

            // make sure the previous node is an element node
            this.convertMaxElementToNode(node.prev);
            var prev = node.prev;
            if(prev.absForward === undefined)
                prev.absForward = [];
            for(var j = 0, m = node.absForward.length ; j < m ; ++j) {
                var requirement = node.absForward[j];
                prev.absForward.push(requirement);
                requirement.updateElement(prev.element,
                                          insertedElement, insertPos, true);
                if(requirement.isOrderedRange) {
                    if(requirement.isEnd)
                        prev.noHeapNext--;
                    else
                        prev.noHeapNext++;
                }
            }

            // add a trace for the previous node
            this.addForwardTrace(prev, node.absForward.length);
            // remove the trace for the original node
            this.removeForwardTrace(node, node.absForward.length);
            
            node.absForward = undefined;
            if(this.allowsHeap(node)) {
                if(node.next && node.next.heap !== undefined)
                    this.mergeWithNextNode(node);
                else if(node.prev && node.prev.heap !== undefined)
                    this.mergeWithNextNode(node.prev);
                else
                    node.convertElementToHeap(this.uniqueValueAttr,
                                              this.heapCompare);
            }
        }
    }
    
    // clear the queue
    this.queuedForward = [];
}

// This function is called after the element 'insertedElement' was inserted
// into the tree. This function goes over the list of nodes for which the
// backward requirements were scheduled (in the process of inserting
// the new element) for transfer to the next node. The transfer takes
// place in reverse order of the nodes in the ordering (that is, first the
// nodes at the end of the ordering and then those at the beginning of the
// ordering). An 'undefined' entry in the queue of nodes to transfer
// means that requirements may have ot be transfer from the virtual first node.
// Transferring the requirements consists of moving them from one node to
// the other, notifying the requirements themselves of this transfer,
// and updating the traces on the dominating nodes in the tree.
// 'insertedElement' is provided to requirement, since if a requirement is
// a range requirement (covering a range of absolute positions) moving
// only one end of the range requirement means that the 'insertedElement'
// was added to the range of the requirement.
// 'backInsertPos' is the backward position at which the node was inserted
// (0 is insertion at the beginning of the backward ordering, that is, at
// the end of the forward ordering). This is only accurate if the insertion
// took place under an element node, rather than under a heap node (but if
// insertion took place under the heap node, the exact position cannot be
// interesting for the requirements). If the insertion took place into a heap,
// this is the backeard position of the last element (in backward ordering)
// in the heap.

PartialOrderTree.prototype.moveBackwardRequirementsToNext =
    partialOrderTreeMoveBackwardRequirementsToNext;

function partialOrderTreeMoveBackwardRequirementsToNext(insertedElement,
                                                        backInsertPos)
{
    // loop backwards over the queue

    var l = this.queuedBackward.length;
    if(l == 0)
        return;

    for(var i = l-1 ; i >= 0 ; --i) {
        var node = this.queuedBackward[i];
        if(node === undefined) {
            if(this.virtualFirst !== undefined) {
                var popped =
                    this.virtualFirst.notifyAddAbsolute(insertedElement,
                                                        backInsertPos);
                if(popped.length == 0)
                    break;

                // make sure the first node is an element node
                this.convertMinElementToNode(this.first);
                
                if(this.first.absBackward === undefined)
                    this.first.absBackward = [];

                for(var j = 0, m = popped.length ; j < m ; ++j) {
                    var requirement = popped[j];
                    this.first.absBackward.push(requirement);
                    requirement.updateElement(this.first.element,
                                              insertedElement, backInsertPos,
                                              true);
                    if(requirement.isOrderedRange) {
                        if(requirement.isEnd)
                            this.first.noHeapPrev--;
                        else
                            this.first.noHeapPrev++;
                    }
                }

                // add a trace for the first node
                this.addBackwardTrace(this.first, popped.length);
                
                if(this.virtualFirst.isEmpty()) // remove the virtual node
                    this.virtualFirst = undefined;
            }
        } else if(node.absBackward !== undefined) {
            // make sure the next node is an element node
            this.convertMinElementToNode(node.next);
            // all absolute backward requirements on 'node' need to be
            // transferred to the next node
            var next = node.next;
            if(next.absBackward === undefined)
                next.absBackward = [];
            for(var j = 0, m = node.absBackward.length ; j < m ; ++j) {
                var requirement = node.absBackward[j];
                next.absBackward.push(requirement);
                requirement.updateElement(next.element,
                                          insertedElement, backInsertPos, true);
                if(requirement.isOrderedRange) {
                    if(requirement.isEnd)
                        next.noHeapPrev--;
                    else
                        next.noHeapPrev++;
                }
            }

            // add a trace for the next node
            this.addBackwardTrace(next, node.absBackward.length);
            // remove the trace for the original node
            this.removeBackwardTrace(node, node.absBackward.length);
            
            node.absBackward = undefined;
            if(this.allowsHeap(node)) {
                if(node.next && node.next.heap !== undefined)
                    this.mergeWithNextNode(node);
                else if(node.prev && node.prev.heap !== undefined)
                    this.mergeWithNextNode(node.prev);
                else
                    node.convertElementToHeap(this.uniqueValueAttr,
                                              this.heapCompare);
            }
        }
    }
    
    // clear the queue
    this.queuedBackward = [];
}

// This function is called for each element 'element' which is added
// to this tree. This happens at the end of the addition process
// (after all requirements were notified). This notifies all complement
// requirements that this element was added. Complement requirements,
// which are range constraints defined by one forward and one backward
// requirement, have their end-point requirements (the forward and backward
// absolute requirements) receive notifications of elements outside the range,
// so we need to notify them of all elements added to te tree in order
// for them to determine which elements are in the range.
// 'insertPos' is the position at which the node was inserted (the position
// is in the forward direction of the ordering and 0 is the beginning of
// the ordered set). This is only accurate if the insertion took place under
// an element node, rather than under a heap node (but if insertion took
// place under the heap node, the exact position cannot be interesting for the
// requirements). If the insertion took place into a heap, this is the position
// at which this heap begins.

PartialOrderTree.prototype.notifyComplementRequirementsOfAdd =
    partialOrderTreeNotifyComplementRequirementsOfAdd;

function partialOrderTreeNotifyComplementRequirementsOfAdd(element, insertPos)
{
    var requirements = this.complementRequirements.requirements;
    var l = requirements.length;
    
    if(l == 0)
        return;
    
    for(var i = 0 ; i < l ; ++i)
        requirements[i].updateAddElement(element, insertPos);
}

// This function is called at the end of an element removal operation.
// When this function is called, the element has not yet been removed from the
// tree, but the node from which it needs to be removed has already been found
// (this is the node 'removedFromNode') and all nodes from which absolute
// requirements need to be transferred have already been queued for transfer.
// 'removedElement' is the element which was removed. 'removalPos' is the
// forward position in the ordering of the element removed. If the element
// was the only element stored on 'removedFromNode', then this is the
// exact position from which it was removed. If the element is removed
// from a heap node with more than one element, this is the first position
// covered by the heap (since the element was stored in a heap, this must
// be sufficient for the requirements which are intersted in the position
// of this element).
// This function does two things:
// 1. It transfers the absolute requirements which were queued for transfer.
// 2. It checks the prev/next traces on the node from which the element was
//    removed and transfers relative requirements where needed.
// These operations also update the traces (both forward/backward traces
// and next/prev traces).
// In addition, this function notifies all complement requirements
// (requirements over a range defined by one forward and one backward
// requirement) of the removal of this element.

PartialOrderTree.prototype.transferRequirementsAfterRemoval =
    partialOrderTreeTransferRequirementsAfterRemoval;

function partialOrderTreeTransferRequirementsAfterRemoval(removedElement,
                                                          removedFromNode,
                                                          removalPos)
{
    // if there are any relative requirements or next/prev traces on this node,
    // update them before the node is removed
    this.notifyRemoveRelForward(removedFromNode, 0, removedFromNode.nextTrace);
    this.notifyRemoveRelBackward(removedFromNode, 0, removedFromNode.prevTrace);

    // transfer the absolute requirements queued for transfer in the
    // process of removing the element and update the traces
    this.moveForwardRequirementsToNext(removedElement, removalPos);
    var backRemovalPos = this.invertOffset(removalPos);
    this.moveBackwardRequirementsToPrev(removedElement, backRemovalPos);

    // notify complement requirements
    this.notifyComplementRequirementsOfRemove(removedElement, removalPos);
}

// This function is called after the element 'removedElement' was removed
// from the tree. This function goes over the list of nodes for which the
// forward requirements were scheduled (in the process of removing
// the element) for transfer to the next node. The transfer takes
// place in the inverse order of the nodes in the ordering (that is, first the
// nodes at the end of the ordering and then those at the beginning of the
// ordering). This is the order in which the nodes are stored in the queue
// 'queuedForward'. 
// Transferring the requirements consists of moving them from one node to
// the other, notifying the requirements themselves of this transfer,
// and updating the traces on the dominating nodes in the tree.
// If the node from which the requirements need to be transferred does not
// have a next node (it is the last node in the tree) the requirements
// are transferred to the virtual last node (which may have to be created
// for this purpose).
// 'removedElement' is provided to the requirement, since if a requirement is
// a range requirement (covering a range of absolute positions) moving
// only one end of the range requirement means that the 'removedElement'
// was removed from the range of the requirement. 'removalPos' is the
// forward position in the ordering of the element removed. If the element
// was the only element stored on 'removedFromNode', then this is the
// exact position from which it was removed. If the element is removed
// from a heap node with more than one element, this is the first position
// covered by the heap (since the element was stored in a heap, this must
// be sufficient for the requirements which are intersted in the position
// of this element).

PartialOrderTree.prototype.moveForwardRequirementsToNext =
    partialOrderTreeMoveForwardRequirementsToNext;

function partialOrderTreeMoveForwardRequirementsToNext(removedElement,
                                                       removalPos)
{
    // notify the virtual last node (before moving requirements, as
    // requirements may be moved to the virtual last node).
    if(this.virtualLast !== undefined)
        this.virtualLast.notifyRemoveAbsolute(removedElement,
                                              removalPos);

    for(var i = 0, l = this.queuedForward.length ; i < l ; ++i) {

        var node = this.queuedForward[i];
        if(node.absForward === undefined)
            continue; // no requirements to move
        
        // all absolute forward requirements on 'node' need to be
        // transferred to the next node

        if(node.next === undefined) {
            // this is the last node, need to transfer requirement to the
            // virtual node
            this.getVirtualNode(false); // make sure the virtual node exists
            // transfer the requirements in reverse order to the virtual node
            // so that if the begin and end requirements of the same range
            // requirement are on the same node, the end requirement is
            // transferred first.
            for(var j = node.absForward.length - 1 ; j >= 0 ; --j) {
                var requirement = node.absForward[j];
                this.virtualLast.addAbsRequirement(requirement, 1);
                requirement.updateElement(undefined,
                                          removedElement, removalPos, false);
                if(requirement.isOrderedRange) {
                    if(requirement.isEnd)
                        node.noHeapNext++;
                    else
                        node.noHeapNext--;
                }
            }
            
        } else {
            // make sure the next node is an element node
            this.convertMinElementToNode(node.next);
            var next = node.next;
            if(next.absForward === undefined)
                next.absForward = [];
            for(var j = 0, m = node.absForward.length ; j < m ; ++j) {
                var requirement = node.absForward[j];
                next.absForward.push(requirement);
                requirement.updateElement(next.element,
                                          removedElement, removalPos, false);
                if(requirement.isOrderedRange) {
                    if(requirement.isEnd)
                        node.noHeapNext++;
                    else
                        node.noHeapNext--;
                }
            }

            // add a trace for the next node
            this.addForwardTrace(next, node.absForward.length);
        }
        
        // remove the trace for the original node
        this.removeForwardTrace(node, node.absForward.length);
            
        node.absForward = undefined;
        if(this.allowsHeap(node)) {
            if(node.next && node.next.heap !== undefined)
                this.mergeWithNextNode(node);
            else if(node.prev && node.prev.heap !== undefined)
                this.mergeWithNextNode(node.prev);
            else
                node.convertElementToHeap(this.uniqueValueAttr,
                                          this.heapCompare);
        }
    }
    
    // clear the queue
    this.queuedForward = [];
}

// This function is called after the element 'removedElement' was removed
// from the tree. This function goes over the list of nodes for which the
// backward requirements were scheduled (in the process of removing
// the element) for transfer to the previous node. The transfer takes
// place in the order of the nodes in the ordering (that is, first the
// nodes at the beginning of the ordering and then those at the end of the
// ordering). This is the order in which the nodes are stored in the queue
// 'queuedBackward'. 
// Transferring the requirements consists of moving them from one node to
// the other, notifying the requirements themselves of this transfer,
// and updating the traces on the dominating nodes in the tree.
// If the node from which the requirements need to be transferred does not
// have a previous node (it is the first node in the tree) the requirements
// are transferred to the virtual first node (which may have to be created
// for this purpose).
// 'removedElement' is provided to the requirement, since if a requirement is
// a range requirement (covering a range of absolute positions) moving
// only one end of the range requirement means that the 'removedElement'
// was removed from the range of the requirement. 'backRemovalPos' is the
// backward position in the ordering of the element removed. If the element
// was the only element stored on 'removedFromNode', then this is the
// exact position from which it was removed. If the element is removed
// from a heap node with more than one element, this is the last position
// (in backward ordering) covered by the heap (since the element was stored
// in a heap, this must be sufficient for the requirements which are
// intersted in the position of this element).

PartialOrderTree.prototype.moveBackwardRequirementsToPrev =
    partialOrderTreeMoveBackwardRequirementsToPrev;

function partialOrderTreeMoveBackwardRequirementsToPrev(removedElement,
                                                        backRemovalPos)
{
    // notify the virtual first node (before moving requirements, as
    // requirements may be moved to the virtual first node).
    if(this.virtualFirst !== undefined)
        this.virtualFirst.notifyRemoveAbsolute(removedElement,
                                               backRemovalPos);
    
    for(var i = 0, l = this.queuedBackward.length ; i < l ; ++i) {

        var node = this.queuedBackward[i];
        if(node.absBackward === undefined)
            continue; // no requirements to move
        
        // all absolute backward requirements on 'node' need to be
        // transferred to the previous node

        if(node.prev === undefined) {
            // this is the first node, need to transfer requirement to the
            // virtual node
            this.getVirtualNode(true); // make sure the virtual node exists
            // transfer the requirements in reverse order to the virtual node
            // so that if the begin and end requirements of the same range
            // requirement are on the same node, the end requirement is
            // transferred first.
            for(var j = node.absBackward.length - 1 ; j >= 0 ; --j) {
                var requirement = node.absBackward[j];
                this.virtualFirst.addAbsRequirement(requirement, 1);
                requirement.updateElement(undefined,
                                          removedElement, backRemovalPos,
                                          false);
                if(requirement.isOrderedRange) {
                    if(requirement.isEnd)
                        node.noHeapPrev++;
                    else
                        node.noHeapPrev--;
                }
            }
            
        } else {
            // make sure the previous node is an element node
            this.convertMaxElementToNode(node.prev);
            var prev = node.prev;
            if(prev.absBackward === undefined)
                prev.absBackward = [];
            for(var j = 0, m = node.absBackward.length ; j < m ; ++j) {
                var requirement = node.absBackward[j];
                prev.absBackward.push(requirement);
                requirement.updateElement(prev.element,
                                          removedElement, backRemovalPos,
                                          false);
                if(requirement.isOrderedRange) {
                    if(requirement.isEnd)
                        node.noHeapPrev++;
                    else
                        node.noHeapPrev--;
                }
            }

            // add a trace for the previous node
            this.addBackwardTrace(prev, node.absBackward.length);
        }
        
        // remove the trace for the original node
        this.removeBackwardTrace(node, node.absBackward.length);
            
        node.absBackward = undefined;
        if(this.allowsHeap(node)) {
            if(node.next && node.next.heap !== undefined)
                this.mergeWithNextNode(node);
            else if(node.prev && node.prev.heap !== undefined)
                this.mergeWithNextNode(node.prev);
            else
                node.convertElementToHeap(this.uniqueValueAttr,
                                          this.heapCompare);
        }
    }
    
    // clear the queue
    this.queuedBackward = [];
}

// This function is called for each element 'element' which is removed
// from this tree. This happens at the end of the removal process
// (after all requirements were notified). This notifies all complement
// requirements that this element was removed. Complement requirements,
// which are range constraints defined by one forward and one backward
// requirement, have their end-point requirements (the forward and backward
// absolute requirements) receive notifications of elements outside the range,
// so we need to notify them of all elements removed from the tree in order
// for them to determine which elements are in the range.
// 'removalPos' is the forward position in the ordering of the element
// removed. If the element was the only element stored on
// 'removedFromNode', then this is the exact position from which it
// was removed. If the element is removed from a heap node with more
// than one element, this is the first position covered by the heap
// (since the element was stored in a heap, this must be sufficient
// for the requirements which are intersted in the position of this
// element).

PartialOrderTree.prototype.notifyComplementRequirementsOfRemove =
    partialOrderTreeNotifyComplementRequirementsOfRemove;

function partialOrderTreeNotifyComplementRequirementsOfRemove(element,
                                                              removalPos)
{
    var requirements = this.complementRequirements.requirements;
    var l = requirements.length;
    
    if(l == 0)
        return;
    
    for(var i = 0 ; i < l ; ++i)
        requirements[i].updateRemoveElement(element, removalPos);
}

//////////////////////////////////////
// Atomic Requirement Node Addition //
//////////////////////////////////////

// The following functions add the atomic requirments which are registered
// to the tree. Compound requirements (such as range requirements) are
// handled by another set of functions.

// This function simply stores the given requirement into the relevant tables,
// but does not insert it into the tree (this is done by other functions)

PartialOrderTree.prototype.registerAbsRequirement =
    partialOrderTreeRegisterAbsRequirement;

function partialOrderTreeRegisterAbsRequirement(requirement)
{
    this.allRequirements.add(requirement);
    if(requirement.isOrderedRange == true && requirement.isBegin)
        this.orderedRangeRequirements.add(requirement);
}

// This function simply removes the given requirement from the relevant tables,
// but does not remove it from the tree (this is done by other functions)

PartialOrderTree.prototype.unregisterAbsRequirement =
    partialOrderTreeUnregisterAbsRequirement;

function partialOrderTreeUnregisterAbsRequirement(requirement)
{
    this.allRequirements.remove(requirement);
    if(requirement.isOrderedRange == true && requirement.isBegin)
        this.orderedRangeRequirements.remove(requirement);
}

// This function adds the absolute requirement 'requirement' which may be
// either a forward or a backward requirement. The function searches
// for the element which satisfies the requirement (based on the 'offset'
// attribute of the requirement). If no such element exists inside the tree
// (which means that the required position is beyond the end/beginning of
// the ordered set) the requirement is set on the virtual last/first
// node. If the element is found and is stored in a heap node, the heap
// node is split to create an element node which satisfies the requirement.
// The requirement node is notified of the element which satisfies it
// (none if it is registered on a virtual node).
// For a absolute range requirement, adding the 'begin' requirement node of
// the range requirement will automatically call this function again with
// the 'end' requirement node if the begin node was inserted into the tree
// (and not on a virtual node). In case the begin requirement node was
// inserted to a virtual node, there is no need to add the end requirement
// (it will be added automatically when the begin requirement node is
// placed in the tree). Therefore, when adding a range requirement,
// only the begin requirement node of that requirement should be added
// using this function.

PartialOrderTree.prototype.addAbsRequirement =
    partialOrderTreeAddAbsRequirement;

function partialOrderTreeAddAbsRequirement(requirement)
{
    this.registerAbsRequirement(requirement);
    
    var offset = requirement.offset;
    var isBackward = requirement.isBackward;
    var numElements = this.getSize();
    
    if(numElements <= offset) {
        // offset not satisfied inside the tree, create a virtual node
        var virtualNode = this.getVirtualNode(isBackward);
        
        // add the requirement to the virtual node. The gap is the difference
        // between the requirement offset and the last offset of the set. 
        virtualNode.addAbsRequirement(requirement, offset - numElements + 1);

        if(requirement.isEnd) // handle the 'range' part of the update 
            this.addEndOfAbsRangeRequirement(requirement, undefined,
                                             offset - numElements + 1);
        
        return;
    }

    // find insertion position (if found inside a heap node, the heap node
    // will be split).
    var node = this.findNodeByOffset(offset, isBackward, true);
    //  Updates the trace count along the search path
    if(isBackward)
        this.addBackwardTrace(node, 1);
    else
        this.addForwardTrace(node, 1);
    
    // at this point, 'node' is an element node whose single element is
    // the one which satisfies the requirement
    this.addAbsRequirementToNode(requirement, node);
    
    requirement.updateElement(node.element, undefined);

    if(requirement.isEnd) // handle the 'range' part of the update 
        this.addEndOfAbsRangeRequirement(requirement, node);
    else if(requirement.isBegin)
        // insert the end of this range requirement
        this.addAbsRequirement(requirement.getEnd());
}

// This function registers the given requirement to the given node, which
// has already been determined to be the element node which satisfies
// this requirement. All this function does is write the requirement
// into the appropriate table on the node. All trace updates are assumed
// to take place elsewhere.
// This function is required to make sure that if the requirement being
// added is a begin/end requirement then it is added in such a way that
// if its partner element is also registered to the same node, the
// begin requirement will appear before it partner end requirement
// in the list of requirements.

PartialOrderTree.prototype.addAbsRequirementToNode =
    partialOrderTreeAddAbsRequirementToNode;

function partialOrderTreeAddAbsRequirementToNode(requirement, node)
{
    var requirements =
        requirement.isBackward ? node.absBackward : node.absForward;

    if(requirements === undefined) {
        if(!requirement.isBackward)
            node.absForward = [requirement];
        else
            node.absBackward = [requirement];
        return;
    }

    var endRequirement; // in case we are adding a begin requirement
    
    if(requirement.isBegin &&
       (endRequirement = requirement.getEnd()) !== undefined &&
       endRequirement.offset === requirement.offset) {
        // the end requirement may already be registered to this node.
        for(var i = 0, l = requirements.length ; i < l ; ++i) {
            if(requirements[i].id != endRequirement.id)
                continue;
            // found the end requirement, insert the begin requirement
            // before it.
            requirements.splice(i,0,requirement);
            return;
        }
    }

    // no end requirement already registered here, s can simply add at
    // the end of the list.
    requirements.push(requirement);
}

// This function is called when the end requirement of an absolute range
// requirement is added. The end requirement is 'requirement' and the
// element satisfying this requirement is stored on the node 'endNode'
// (this is undefined if the requirement was stored on a virtual node and
// otherwise this is an element node). If 'endNode' is undefined, 'gap' should
// be the difference between the offset of the requirement and the offset of
// the node adjacent to the virtual node on which the requirement is stored
// (that is, the first node in case of the virtual first node and last node
// in case of the virtual last node). 
// When this function is called, the addition of the range requirement
// has just been completed (the beginning of the range must always be
// added before the end). This function then takes care of the
// initialization of the range properties of the range requirement. It
// performs the following tasks:
// 1. If the requirement is 'isOrderedRange' (which means that the requirement
//    is not only interested in which elements are inside the range but also
//    in their order) this function converts any heap inside the requirement
//    range into element nodes and marks these nodes with the
//    'noHeapNext' or 'noHeapPrev' property so that any elements added
//    inside the range will be added on element node.
// 2. It notifies the requirement of the internal elements in the range.
//    If the requirement has the 'isOrderedRange' property, the
//    internal elements are provided ordered.
// If the requirement has the flag 'isReplacement' set, then this requirement
// replaces an existing requirement (at the same place) and no initial
// pudate needs to be sent. The only thing this function needs to do in
// this case is increase the 'no heap' counts and split heap nodes if the
// requirement has the 'isOrderedRange' property (otherwise, there is nothing
// to do for a requirement which is 'isReplacement').

PartialOrderTree.prototype.addEndOfAbsRangeRequirement =
    partialOrderTreeAddEndOfAbsRangeRequirement;

function partialOrderTreeAddEndOfAbsRangeRequirement(requirement, endNode, gap)
{
    if(!requirement.isOrderedRange && requirement.isReplacement)
        // this requirement was registered as a replacement for a previous
        // requirement, so no initial update is needed (is isOrderedRange is
        // set, we still need to run 'getNewRangeElements()' below to split
        // the heap nodes and increase the 'no heap' count.
        return;
    
    // number of elements in the range
    var rangeSize;
    if(endNode === undefined) // beyond end of set
        rangeSize = this.getSize() - requirement.getBegin().offset;
    else
        rangeSize = requirement.offset - requirement.getBegin().offset + 1;

    // get the elements of the requirement range (this is returned
    // in reverse order to the order of the requirement). This also increases
    // no heap counts and splits heap nodes, if necessary.
    var rangeElements = this.getNewRangeElements(endNode, rangeSize,
                                                 requirement.isOrderedRange,
                                                 requirement.isBackward,
                                                 false, 1);

    // notify the requirement (reverse if the requirement is in forward
    // ordering as 'addRangeElements()' must be called with the elements in
    // forward ordering).
    requirement.addRangeElements(requirement.isBackward ? rangeElements :
                                 rangeElements.reverse());
}

// This function returns an array with all elements in a range.
// In addition to returning the elements in the range, this function,
// if needed, also increases or the 'no heap' count on nodes in the range
// and splits heap nodes. For this reason, this function is to be used
// when a range is first registered or its offsets change. In the
// second case, this function should be called such that the range size
// and endNode represent the part of the range which changed
// (added or removed from the range by the change of offset). If
// the order of the elements in the range needs to be tracked, then
// the no-heap count needs to be increased ('noHeapInc' = 1) if the
// range became larger and decreased ('noHeapInc' = -1) if the
// range became smaller.
// The function receives a node 'endNode' which stores the end element of
// the range (if 'endNode' is undefined, the range extends beyond the end
// of the ordered set). It also receives 'rangeSize', which is the number
// of elements in the range.  If the end node is outside the ordered
// set, 'rangeSize' is the number of elements of the range which are
// inside the ordered set. If 'rangeSize' is Infinity, 'endNode' must
// be defined and the range extends all the way to the element of
// offset 0 (including). If 'isOrderedRange' is true, the function
// must return the elements ordered (from the end element to the first
// element).  In this case, this function also splits heap nodes into
// element nodes and increased the noHeap counts for the nodes in the
// range, except for the last one (so that no heap nodes can be
// created inside the range).  If 'isOrderedRange' is false, there is
// no guarantee as to the ordering of the elements returned. Finally,
// 'isBackward' indicates whether the range is relative to the forward
// or backward ordering. Since 'endNode' is the node holding the last
// element in the range, if 'isBackward' is true, the elements are
// collected in the direction of the ordering (from the last element
// in the range in the backward ordering) and if 'isBackward' is
// false, the elements are collected in the direction of the backward
// ordering. This is also the ordering in which the elements appear in
// the array returned by this function.
// 'isAnchored' indicates whether this range is defined by an anchor
// (an element) or an offset. If 'isAnchored' is true, the range is defined
// by an anchor element. In that case, the anchor element is not in the
// range. This means that 'endNode' is internal to the range and therefore
// must also have its noHeapNext/noHeapPrev increased by 'noHeapInc'.

PartialOrderTree.prototype.getNewRangeElements =
    partialOrderTreeGetNewRangeElements;

function partialOrderTreeGetNewRangeElements(endNode, rangeSize,
                                             isOrderedRange,
                                             isBackward, isAnchored,
                                             noHeapInc)
{
    // array of elements in the range
    // This is ordered from the end of the requirement to the beginning of the
    // requirement.
    var rangeElements = [];
    
    // loop backward from the node where the requirement ends to the node
    // where the requirement begins (where to stop is determined by the
    // offset). Create an array of all elements on the nodes in-between.
    if(!isBackward) {
        var node = (endNode === undefined) ? this.last : endNode;
        while(node !== undefined && rangeSize > 0) {

            if(node.heap === undefined) {
                // add the element
                rangeElements.push(node.element);
                rangeSize--;
                if(isOrderedRange)
                    node.noHeapNext += noHeapInc;
            } else if(isOrderedRange) {
                // this is a heap node but it must be converted into element
                // nodes. This returns the last node in this structure, which
                // allows the process to continue as if these element
                // nodes were there to begin with.
                node = this.convertHeapNodeToElements(node, true);
                continue;
            } else { // a heap node, and we don't care about internal ordering 
                rangeSize -= node.getSize();
                // push the elements of the heap on the list, the order
                // is the order in the heap array
                var heapArray = node.heap.heap;
                for(var i = 1, l = heapArray.length ; i < l ; ++i)
                    rangeElements.push(heapArray[i]);
            }

            node = node.prev;
        }

        if(isOrderedRange && endNode !== undefined && !isAnchored)
            endNode.noHeapNext -= noHeapInc; // increased above unnecessarily
        
    } else {
        var node = (endNode === undefined) ? this.first : endNode;
        while(node !== undefined && rangeSize > 0) {
            
            if(node.heap === undefined) {
                // add the element
                rangeElements.push(node.element);
                rangeSize--;
                if(isOrderedRange)
                    node.noHeapPrev += noHeapInc;
            } else if(isOrderedRange) {
                // this is a heap node but it must be converted into element
                // nodes. This returns the first node in this structure, which
                // allows the process to continue as if these element
                // nodes were there to begin with.
                node = this.convertHeapNodeToElements(node, false);
                continue;
            } else { // a heap node, and we don't care about internal ordering 
                rangeSize -= node.getSize();
                // push the elements of the heap on the list, the order
                // is the order in the heap array
                var heapArray = node.heap.heap;
                for(var i = 1, l = heapArray.length ; i < l ; ++i)
                    rangeElements.push(heapArray[i]);
            }

            node = node.next;
        }
        
        if(isOrderedRange && endNode !== undefined && !isAnchored)
            endNode.noHeapPrev -= noHeapInc; // increased above unnecessarily
    }

    return rangeElements;
}

// This function moves the given requirement, which may be either a begin
// or end requirement of a range requirement, from its current offset
// to the offset given by 'newOffset'. The new offset may be larger or
// smaller than the original offset, but it is assumed that the
// relation with the other end-point of the range remains valid, that
// is, if the begin requirement is moved, then both the old offset
// and the new offset of the begin requiremnt are smaller or equal to
// the end offset and if the end requirement is being moved then both
// the old and the new offsets of the end requirement are larger or equal
// the offset of the begin requirement. This property holds when
// a range changes but there is an overlap between the old and the new range
// (in this case it does not matter whether the begin or end requirement
// is moved first).
// When this function is called, the old offset is still registered on
// the requirement and when the function returns, the new offset is
// already set on the requirement. Except for the offset, all other
// properties of the requirement ('isBackward', 'isOrderedRange')
// remain unchanged. In addition to moving the requirement node to the
// appropriate tree node, this function also updates all traces
// (position tracing as well as no-heap counts, if needed). If moving
// the offset adds elements to the range and the requirement tracks
// the order inside the range, heap nodes between the old position and
// the new position are converted into element nodes.  The function returns
// an array with all elements added or removed from the range by this
// movement. These are the elements with an offset between the new offset
// and the old offset (for a begin requirement this is including the lower
// of the two and excluding the higher of the two while for an end requirement
// this is the other way around).
// If this is a begin requirement and the old requirement was outside
// the ordered set (was registered on the virtual node) and the new
// requirement is inside the ordered set, this function registers the end
// requirement (it must be outside the ordered set). If this is
// a begin requirement and the old requirement was inside the ordered set
// and the new requirement is outside the ordered set, the end requirement is
// removed from the ordered tree. In both these cases, the end requirement
// must be outside the ordered set, since its offset must be larger or
// equal to both the old and the new begin offset.

PartialOrderTree.prototype.moveAbsRequirement =
    partialOrderTreeMoveAbsRequirement;

function partialOrderTreeMoveAbsRequirement(requirement, newOffset)
{
    if(newOffset == requirement.offset)
        return []; // nothing changed

    var numElements = this.getSize();
    
    if(requirement.isEnd && requirement.getBegin().offset >= numElements) {
        // begin requirement out of set, end not registered
        requirement.offset = newOffset; // set new offset
        return [];
    }
    
    var oldOffset = requirement.offset;
    var virtualNode = requirement.isBackward ?
        this.virtualFirst : this.virtualLast; // if needed (determined below)

    // remove from the old offset
    
    var oldNode;
    if(requirement.offset >= numElements) {
        // remove from the virtual node (may be added back with a new gap)
        var gap = requirement.offset - numElements + 1;
        virtualNode.removeAbsRequirement(requirement, gap);
    } else {
        // find the node on which the requirement is currently registered
        oldNode = this.findNodeByOffset(requirement.offset,
                                        requirement.isBackward, false);
        // remove the trace count for this node
        if(requirement.isBackward)
            this.removeBackwardTrace(oldNode, 1);
        else
            this.removeForwardTrace(oldNode, 1);
        // remove the requirement from the node
        this.removeAbsRequirementFromNode(requirement, oldNode);
    }

    requirement.offset = newOffset; // set new offset

    // add at the new offset
    var newNode;
    if(requirement.offset >= numElements) {
        if(virtualNode === undefined)
            virtualNode = this.getVirtualNode(requirement.isBackward);
        // the requirement should be added to the virtual node. If this is
        // the begin requirement, this also removes the end requirement
        // if it is registered (if it is, it must be to the virtual node,
        // as its offset must be greater or equal the new begin offset).
        var gap = requirement.offset - numElements + 1;
        virtualNode.addAbsRequirement(requirement, gap);
    } else {
        // find the new node to which this requirement should be assigned
        newNode = this.findNodeByOffset(requirement.offset,
                                        requirement.isBackward, true);
            //  Updates the trace count along the search path
        if(requirement.isBackward)
            this.addBackwardTrace(newNode, 1);
        else
            this.addForwardTrace(newNode, 1);

        // add the requirement at this node
        this.addAbsRequirementToNode(requirement, newNode);
    }

    if(oldNode === undefined && newNode === undefined)
        return []; // nothing more to do

    // check whether the end requirement needs to be added
    // (if it needs to be removed, that already happened above, when
    // registering the begin requirement to the virtual node) 
    if(requirement.isBegin && oldNode === undefined && newNode !== undefined) {
        // add the end requirement to the virtual node
        var endRequirement = requirement.getEnd();
        var gap = endRequirement.offset - numElements + 1;
        virtualNode.addAbsRequirement(endRequirement, gap);
        this.registerAbsRequirement(endRequirement);
    }

    // notify the requirement of the change in element which satisfies it
    requirement.updateElement(newNode ? newNode.element : undefined,
                              undefined);
    
    // get the list of elements added/removed from the range as a result of
    // this movement (and set/remove the noHeap count if needed)
    var endNode = oldOffset > newOffset ? oldNode : newNode;
    var noHeapInc =
        (oldOffset > newOffset ? 1 : -1) * (requirement.isEnd ? -1 : 1);
    var rangeSize = (endNode !== undefined) ?
        Math.abs(oldOffset - newOffset) + 1 :
        numElements - Math.min(oldOffset, newOffset);
    var diffElements = 
        this.getNewRangeElements(endNode, rangeSize, requirement.isOrderedRange,
                                 requirement.isBackward, false, noHeapInc);
    if(requirement.isEnd) // first element should not be included
        diffElements.length--;
    diffElements.reverse();
    if(requirement.isBegin && endNode !== undefined)
        diffElements.length--; // last element should not be included
    return diffElements;
}

// This function adds an anchored requirement (relative or element requirement).
// The function searches for the anchor of the requirement in the tree.
// If not found, the requirement is suspended (it will be added when the
// anchor element is added to the tree). If the element is found, the function
// makes sure the anchor element is stored on a node which
// only stores that element (that is, not a heap node).
// Having found the node for the anchor, element requirements
// may be added directly to the anchor. For relative requirements we need
// to find a node which satisfies the requirement. If this node lies inside
// the heap just split, this node is identified before heap nodes are
// created to store the remaining elements in the heap. Otherwise, the
// function searches for the element satisfying the requirement and, if
// found, may need to split the node storing the element. If not found, the
// requirement is set on a virtual node.

PartialOrderTree.prototype.addAnchoredRequirement =
    partialOrderTreeAddAnchoredRequirement;

function partialOrderTreeAddAnchoredRequirement(requirement)
{
    this.allRequirements.add(requirement);
    
    var anchor = requirement.anchor;

    var anchorNodeAndPos = this.findNodeByElement(anchor, true);

    if(anchorNodeAndPos === undefined) {
        this.suspendRequirement(requirement);
        return;
    }
    
    this.insertAnchoredRequirement(requirement, anchorNodeAndPos.node,
                                   anchorNodeAndPos.pos);
}

// This function sets the anchored requirement 'requirement' (an
// element or relative requirement) on the node 'anchorNode' which has
// already been determined by the calling function to be an element
// node which stores the anchor element of the requirement.

PartialOrderTree.prototype.insertAnchoredRequirement =
    partialOrderTreeInsertAnchoredRequirement;

function partialOrderTreeInsertAnchoredRequirement(requirement, anchorNode,
                                                   insertPos)
{
    // 'node' is now an element node storing the anchor
    if(requirement.offset === undefined) {
        // element requirement (has no offset)
        this.insertElementRequirement(requirement, anchorNode, insertPos);
    } else if(requirement.isBackward) // backward relative requirement
        this.insertRelBackward(requirement, anchorNode);
    else // forward relative requirement
        this.insertRelForward(requirement, anchorNode);
}

// This function sets the element requirement 'requirement' on the
// node 'anchorNode' which has already been determined by the calling
// function to be an element node which stores the anchor element
// of the requirement. Only a single element requirement (in each direction)
// may be registered to an anchor node, so the new requirement replaces
// any existing requirement.
// Whether a requirement is being replaced or not, the requirement is
// initialized with the offset of the anchor element and (if required)
// the elements in the range defined by the requirement.
// At the same time, tracing in the tree is adjusted to reflect the
// updates the requirement needs. The update of the tracing is
// performed incrementally, relative to the needs of the requirement
// being replaced (if an requirement is replaced).
// 'anchorPos' is the forward position of the anchor element.
// This function stores the requirement on the node and notifies the
// requirement of the offset of this element. In addition, if the element
// requirement is also a range requirement (specifying the range between
// the anchor element, excluding, and the first or last element in the
// ordered set, depending on the direction of the requirement) this
// function also notifies the requirement of the elements which are
// internal to the range (that is, all elements in the range except the
// anchor element).

PartialOrderTree.prototype.insertElementRequirement =
    partialOrderTreeInsertElementRequirement;

function partialOrderTreeInsertElementRequirement(requirement, anchorNode,
                                                  anchorPos)
{
    var prevRequirement;
    
    if(requirement.isBackward) {
        prevRequirement = anchorNode.elementBackward;
        anchorNode.elementBackward = requirement;
    } else {
        prevRequirement = anchorNode.elementForward;
        anchorNode.elementForward = requirement;
    }
    
    if(!requirement.isBackward)
        requirement.setOffset(anchorPos);
    else
        requirement.setOffset(this.invertOffset(anchorPos));

    if(!prevRequirement) { // set tracing
        if(requirement.isBackward)
            this.addBackwardTrace(anchorNode, 1);
        else
            this.addForwardTrace(anchorNode, 1);
    }
    
    if(requirement.isEnd) {
        // get the range elements (this edcludes the anchor node) This
        // also increases no heap counts and splits heap nodes, if necessary.
        var rangeElements;
        var startNode = requirement.isBackward ? this.last : this.first;
        rangeElements = this.getNewRangeElements(startNode, anchorPos+1,
                                                 requirement.isOrderedRange,
                                                 !requirement.isBackward,
                                                 true, 1);
        rangeElements.pop(); // pop the anchor node
        // reverse (if needed, the element are received in
        // the direction of the requirement and remove the anchor element 
        if(requirement.isBackward)
            // the elements were received in the order of the
            // requirement and should be forwarded in forward order. 
            rangeElements.reverse();
        requirement.addRangeElements(rangeElements);
        if(requirement.isOrderedRange)
            this.orderedRangeRequirements.add(requirement);
    }
    
    if(prevRequirement !== undefined && prevRequirement.isEnd &&
       prevRequirement.isOrderedRange) {
        // remove any 'noHeap' count added for the previous requirement.
        // If the new requirement also requires the order of the
        // elements in the range to be tracked, the count was increased inside
        // 'getNewRangeElements()' above. This should not happen, but is handled
        // correctly.
        this.removeElementRequirementNoHeapCount(prevRequirement,
                                                 anchorNode);
        // remove from list of requirements which track order inside range
        this.orderedRangeRequirements.remove(prevRequirement);
    }
}

// This function is called for a forward relative requirement 'requirement'
// whose anchor element is the only element stored at the node
// 'anchorNode'. This function then looks for the element which satisfies
// the requirement, creates an element node for it and registers the requirement
// on that node. If the element is inside a heap node, that heap node
// is either converted into an element node (if it contains a single element)
// or is split. If no element is found which satisfies the requirement
// (which means that the requirement's offset extends beyond the end of
// the ordered set) the requirement is registered on the virtual last node.
// This function also increases by 1 the 'next' trace on all nodes between the
// anchor (including) and the node satisfying the requirement (excluding). 

PartialOrderTree.prototype.insertRelForward =
    partialOrderTreeInsertRelForward;

function partialOrderTreeInsertRelForward(requirement, anchorNode)
{
    var offset = requirement.offset;
    var node = anchorNode;
    
    while(node) {
        var nodeSize = node.getSize();
        if(offset < nodeSize)
            break; // this node contains the element satisfying the requirement

        // continue to the next node
        node.nextTrace++;
        offset -= nodeSize;
        node = node.next;
    }

    // requirement should be stored on element at offset 'offset' in 'node'.
    
    if(node === undefined) {
        // requirement is satisfied beyond the end of the ordered set,
        // set it on the virtual last node.
        this.getVirtualNode(false).addRelRequirement(requirement, offset + 1);
    } else {
        // make 'node' into an element node storing the element in position
        // 'offset' in the original 'node' (offset 0 is the first element)
        if(!node.convertHeapToElement())
            node = this.splitHeapNodeAtPos(node, offset, false);

        // store the requirement on the node and notify the requirement that
        // this is the element which satisfies it
        if(node.relForward === undefined)
            node.relForward = [];
        node.relForward.push(requirement);
        requirement.updateElement(node.element);
    }
}

// This function is called for a backward relative requirement 'requirement'
// whose anchor element is the only element stored at the node
// 'anchorNode'. This function then looks for the element which satisfies
// the requirement, creates an element node for it and registers the requirement
// on that node. If the element is inside a heap node, that heap node
// is either converted into an element node (if it contains a single element)
// or is split. If no element is found which satisfies the requirement
// (which means that the requirement's offset extends beyond the beginning of
// the ordered set) the requirement is registered on the virtual first node.
// This function also increases by 1 the 'prev' trace on all nodes between the
// anchor (including) and the node satisfying the requirement (excluding). 

PartialOrderTree.prototype.insertRelBackward =
    partialOrderTreeInsertRelBackward;

function partialOrderTreeInsertRelBackward(requirement, anchorNode)
{
    var offset = requirement.offset;
    var node = anchorNode;
    
    while(node) {
        var nodeSize = node.getSize();
        if(offset < nodeSize)
            break; // this node contains the element satisfying the requirement

        // continue to the next node
        node.prevTrace++;
        offset -= nodeSize;
        node = node.prev;
    }

    // requirement should be stored on element at offset 'offset' in 'node'.
    
    if(node === undefined) {
        // requirement is satisfied beyond the beginning of the ordered set,
        // set it on the virtual first node.
        this.getVirtualNode(true).addRelRequirement(requirement, offset + 1);
    } else {
        // make 'node' into an element node storing the element in position
        // 'offset' in the original 'node' (offset 0 is the last element)
        if(!node.convertHeapToElement())
            node = this.splitHeapNodeAtPos(node, offset, true);

        // store the requirement on the node and notify the requirement that
        // this is the element which satisfies it
        if(node.relBackward === undefined)
            node.relBackward = [];
        node.relBackward.push(requirement);
        requirement.updateElement(node.element);
    }
}

// This function adds a complement requirement 'requirement' to the tree
// (in addition, two absolute requirements in opposite directions should
// have already been registered to determine the elements which should not
// be included in the set satisfying the requirement).
// All the current function does is add the requirement to the list
// of complement requirements and then (unless 'noInitialUpdateNeeded' is true)
// provides the requirement with an array containing all elements
// currently in the range covered by the requirement (including the
// first and last elements).

PartialOrderTree.prototype.addComplementRequirement =
    partialOrderTreeAddComplementRequirement;

function partialOrderTreeAddComplementRequirement(requirement,
                                                  noInitialUpdateNeeded)
{
    if(requirement.isOrderedRange) {
        // each element must be stored on a separate node
        this.incNoHeapNodes();
        this.orderedRangeRequirements.add(requirement);
    }
    
    this.allRequirements.add(requirement);
    this.complementRequirements.add(requirement);

    if(noInitialUpdateNeeded)
        return;
    
    // get the offsets defining the requirement
    var offsets = requirement.getForwardRange();

    if(offsets === undefined) { // empty range
        requirement.addRangeElements([]);
        return;
    }
    
    var offsetLow = offsets[0];
    var offsetHigh = offsets[1];
    
    // find the node carrying the first element in the range.

    var node = this.findNodeByForwardOffset(offsetLow, true);
    var pos = offsetLow;
    
    // get the elements of all nodes inside the complement range
    var allElements = [];
    
    while(pos <= offsetHigh) {
        if(node.heap !== undefined) {
            // heap node, add all elements in the heap
            var heapArray = node.heap.heap;
            for(var i = 1, l = heapArray.length ; i < l ; ++i)
                allElements.push(heapArray[i]);
            pos += node.heap.getSize();
        } else {
            allElements.push(node.element);
            pos++;
        }
        node = node.next;
    }

    requirement.addRangeElements(allElements);
}

// This function increases by 1 the 'noHeapNodes' property. If this increases
// it from zero to one, this function also goes over all nodes currently
// stored in the tree and checks whether they are heap nodes. Those nodes
// which are heap nodes are converted into sub-trees of element nodes.

PartialOrderTree.prototype.incNoHeapNodes =
    partialOrderTreeIncNoHeapNodes;

function partialOrderTreeIncNoHeapNodes()
{
    if(this.noHeapNodes > 0) {
        this.noHeapNodes++;
        return;
    }

    this.noHeapNodes = 1;

    // loop over all nodes and convert heap nodes into element nodes
    for(var node = this.first ; node ; node = node.next) {

        if(node.heap === undefined || node.convertHeapToElement())
            // node does not store a heap (or the heap stored a single
            // element and the node was converted in the an element node)
            continue; 

        node = this.convertHeapNodeToElements(node, true);
    }
}

//////////////////////////////
// Requirement Node Removal //
//////////////////////////////

// This function removes the absolute requirement 'requirement' which may be
// either a forward or a backward requirement. The function searches
// for the element which satisfies the requirement (based on the 'offset'
// attribute of the requirement). If this is a virtual node, the requirement
// is removed from the virtual node and otherwise it is removed from the node
// which stores the element satisfying the requirement.
// When this function is called for a requirement which is the beginning
// of a range and the requirement is not stored on a virtual node,
// this function first fetches the requirement for the end of the range
// and removes it. It then removes the noHeapNext/noHeapPrev count set
// on nodes in the tree for this range and, finally, removed the requirement
// for the beginning of the range (the one this function was called with).
// An external caller should only call this function with the begin
// requirement of the range. The end requirement will always be removed
// (if it was added) by a recursive call of this function to itself.

PartialOrderTree.prototype.removeAbsRequirement =
    partialOrderTreeRemoveAbsRequirement;

function partialOrderTreeRemoveAbsRequirement(requirement)
{
    this.unregisterAbsRequirement(requirement);
    
    var offset = requirement.offset;
    var isBackward = requirement.isBackward;
    var numElements = this.getSize();
    
    if(numElements <= offset) { // the requirement is outside the tree
        var gap = offset - numElements + 1; 
        // offset not satisfied inside tree, remove from the virtual node
        if(!isBackward) {
            this.virtualLast.removeAbsRequirement(requirement, gap);
            if(this.virtualLast.isEmpty()) // remove the virtual node
                this.virtualLast = undefined;
        } else {
            this.virtualFirst.removeAbsRequirement(requirement, gap);
            if(this.virtualFirst.isEmpty()) // remove the virtual node
                this.virtualFirst = undefined;
        }
        
        return;
    }

    // the requirement is inside the tree

    // find the node on which the requirement is registered (in this process,
    var node = this.findNodeByOffset(offset, isBackward, true);
    // remove the trace count for this node
    if(isBackward)
        this.removeBackwardTrace(node, 1);
    else
        this.removeForwardTrace(node, 1);


    if(requirement.isBegin) { // this is the beginning of a range requirement
        
        var endRequirement = requirement.getEnd(); // end requirement of range

        if(requirement.isOrderedRange) { // remove the noHeap counts
            var rangeSize = endRequirement.offset - requirement.offset;
            this.removeRangeRequirementNoHeapCount(node, rangeSize, isBackward);
        }
        
        // remove the end requirement
        this.removeAbsRequirement(endRequirement);
    }

    // remove the requirement from the node (the traces were already removed
    // when looking up the node)
    this.removeAbsRequirementFromNode(requirement, node);
}

// Remove the absolute requirement 'requirement' from the node
// 'node' which it is know to be registered to. This function only
// takes care of the actual removal of the registration and not
// of the removal of any traces.

PartialOrderTree.prototype.removeAbsRequirementFromNode =
    partialOrderTreeRemoveAbsRequirementFromNode;

function partialOrderTreeRemoveAbsRequirementFromNode(requirement, node)
{
    var requirements =
        requirement.isBackward ? node.absBackward : node.absForward;

    if(requirements.length == 1) {
        // last requirement, discard the whole list
        if(requirement.isBackward)
            node.absBackward = undefined;
        else
            node.absForward = undefined;
    } else {
        for(var i = 0, l = requirements.length ; i < l ; ++i) {
            if(requirements[i].id != requirement.id)
                continue;
            requirements.splice(i,1);
            break;
        }
    }
}

// This function removes the noHeap count for one range requirement
// which begins at 'node' (that is, this node is an element node
// which holds the first element satisfying the range, in the direction of
// the ordering specified by 'isBackward') and such that the total range of
// the requirement is of size 'rangeSize' (this includes the first node in
// the range, but not the last node in the range, so for a range (1,6) this
// will be 5). 'isBackward' indicates whether the requirements is for
// the forward or backward ordering. This function goes over all nodes
// which fall in the range, beginning with 'node' and decreases their
// 'noHeapNext' (if the requirement is a forward requirement) or
// 'noHeapPrev' (if the requirement is a backward requirement) by 1.
// When the number of elements stored in the nodes for which this change
// took place reaches 'rangeSize', the process stops (the process may stop
// before that, as part of the range may be beyond the end of the element
// set).

PartialOrderTree.prototype.removeRangeRequirementNoHeapCount =
    partialOrderTreeRemoveRangeRequirementNoHeapCount;

function partialOrderTreeRemoveRangeRequirementNoHeapCount(node, rangeSize,
                                                           isBackward)
{

    if(!isBackward) {
        while(node !== undefined && rangeSize > 0) {
            node.noHeapNext--;
            node = node.next;
            rangeSize--;
        }
    } else {
        while(node !== undefined && rangeSize > 0) {
            node.noHeapPrev--;
            node = node.prev;
            rangeSize--;
        }
    }
}

// This function removes an anchored requirement (relative or element
// requirement). The requirement is given in 'requirement'. The function
// first uses the anchor of the requirement to check whether the anchor is
// stored in the tree. If it is not, the requirement was suspended and
// this function simply removes the requirement from the list of suspended
// requirements. If the anchor is stored in the tree, the function first
// finds the node which stores the anchor of the anchored requirement.
// Having found this node (which must be an element node) there are
// two possibilities:
// 1. The requirement is an element requirement (not a relative requirement).
//    It is then stored on the anchor node and this function removes
//    it from the node which stores the anchor element.
// 2. The requirement is a relative requirement. The function then searches
//    for the node which stores the element which satisfies the requirement
//    (if not found, the requirement is stored on the virtual node).
//    The requirement is then removed from the node (possibly the virtual
//    node).
//    In the process of looking for the node satisfying the requirement,
//    the next/prev tracing counts are decreased by 1.

PartialOrderTree.prototype.removeAnchoredRequirement =
    partialOrderTreeRemoveAnchoredRequirement;

function partialOrderTreeRemoveAnchoredRequirement(requirement)
{
    this.allRequirements.remove(requirement);
    
    var anchor = requirement.anchor;
    
    // check whether the requirement is suspended (the anchor element is
    // not in the set). If it is, only need to remove it from the suspended
    // requirement list
    var uniqueValue = this.uniqueValueAttr === undefined ?
        anchor : anchor[this.uniqueValueAttr];
    if(this.suspendedRequirements.has(uniqueValue)) {
        requirementList = this.suspendedRequirements.get(uniqueValue);
        if(requirementList.remove(requirement) == 0)
            this.suspendedRequirements.delete(uniqueValue)
        return;
    }

    // requirement is not suspended, need to find the node holding its
    // anchor element

    var node = this.findNodeByElement(anchor).node;

    if(requirement.offset === undefined) {
        // this is an element requirement, simply remove it from the node
        if(requirement.isBackward)
            node.elementBackward = undefined;
        else
            node.elementForward = undefined;
        // remove tracing for this requirement (if any was added)
        this.removeElementRequirementTracing(requirement, node);
        if(requirement.isEnd && requirement.isOrderedRange)
            this.orderedRangeRequirements.remove(requirement);
    } else if(requirement.isBackward) // backward relative requirement
        this.removeRelBackward(requirement, node);
    else // forward relative requirement
        this.removeRelForward(requirement, node);
}

// This function should be called when the element requirement 'requirement'
// is removed from the tree (either because the requirement was removed
// or because the anchor element was removed and the requirement was suspended).
// The function removes the position traces added for this requirement
// (to ensure it receives updates when elements are inserted and removed
// which influence the offset of the anchor element and the range covered
// by the requirement, if it is a range requirement).
// In addition, this function checks whether the element requirement
// needed to track the order of elements inside the range it defines. If it did,
// the 'no heap' counts added for this purpose are removed.

PartialOrderTree.prototype.removeElementRequirementTracing =
    partialOrderTreeRemoveElementRequirementTracing;

function partialOrderTreeRemoveElementRequirementTracing(requirement,
                                                         anchorNode)
{
    if(requirement.isBackward)
        this.removeBackwardTrace(anchorNode, 1);
    else
        this.removeForwardTrace(anchorNode, 1);

    if(requirement.isOrderedRange)
        this.removeElementRequirementNoHeapCount(requirement, anchorNode);
}

// This function is called to remove the 'no heap' counts set by an element
// requirement when that requirement is removed from the tree (either
// because the requirement was removed or because its anchor node was
// removed from the tree). This function the element requirement 'requirement'
// and the node 'anchorNode' on which the anchor element is/was stored.
// This function first checks whether no-heap counts were set by this
// requirement. Such counts are set if the element requirement is a range
// requirement (the range is the range between the anchor element and
// the beginning or end of the ordered set), which is indicated by the
// 'isEnd' flag of the requirement and if the requirement also tracks the
// order of the elements inside the range (indicated by the 'isOrderedRange'
// flag of the requirement). If these two conditions hold, this function
// loops over all nodes in the range and reduced the count of their
// 'noHeap' counter. The anchor element is always the end of the range.
// If the requirement is a forward requirement, the range extends from the
// beginning of the ordered set to the anchor range. The function then
// loops backwards from the node before the anchor node to the beginning
// of the ordered set and decreases the count of the 'noHeapNext' count
// on all these nodes by 1 (the anchor node itself does not have its
// 'noHeapNext' count increased by the requirement, since the next node
// after it may be a heap node). For a backward requirement, the process
// is in the opposite direction and decreases the 'noHeapPrev' count.

PartialOrderTree.prototype.removeElementRequirementNoHeapCount =
    partialOrderTreeRemoveElementRequirementNoHeapCount;

function partialOrderTreeRemoveElementRequirementNoHeapCount(requirement,
                                                             anchorNode)
{
    if(!requirement.isEnd || !requirement.isOrderedRange)
        return; // no 'no heap' count set for this requirement

    if(requirement.isBackward) {
        var node = anchorNode;
        while(node !== undefined) {
            node.noHeapNext--;
            node = node.next;
        }
    } else {
        var node = anchorNode;
        while(node !== undefined) {
            node.noHeapPrev--;
            node = node.prev;
        }
    }
}

// This function removes the relative forward requirement 'requirement'
// whose anchor element is stored on the element node 'anchorNode'.
// This function first finds the node on which the requirement is
// satisfied (this may be a virtual node) and then removes the requirement
// from it. While searching for the node which satisfies the requirement,
// this function also updates the 'nextTrace' counts on the nodes between
// the anchor node and the node satisfying the requirement (this includes
// the count on the anchor node, but excludes the count on the node satisfying
// the requirement).

PartialOrderTree.prototype.removeRelForward =
    partialOrderTreeRemoveRelForward;

function partialOrderTreeRemoveRelForward(requirement, anchorNode)
{
    var offset = requirement.offset;
    var node = anchorNode;
    
    while(node) {
        var nodeSize = node.getSize();
        if(offset < nodeSize)
            break; // this node contains the element satisfying the requirement

        // continue to the next node
        node.nextTrace--;
        offset -= nodeSize;
        node = node.next;
    }

    // requirement is stored on 'node'
    
    if(node === undefined) {
        // requirement is satisfied beyond the end of the ordered set,
        // remove it from the virtual last node.
        this.virtualLast.removeRelRequirement(requirement);
    } else {
        // remove the requirement from the list of forward relative requirements
        var requirements = node.relForward;
        if(requirements.length == 1) { // last relative requirement
            node.relForward = undefined;
        } else {
            for(var i = 0, l = requirements.length ; i < l ; ++i) {
                if(requirements[i].id != requirement.id)
                    continue;
                if(i < l - 1)
                    requirements[i] = requirements[l - 1];
                requirements.length--;
                break;
            }
        }
    }
}

// This function removes the relative backward requirement 'requirement'
// whose anchor element is stored on the element node 'anchorNode'.
// This function first finds the node on which the requirement is
// satisfied (this may be a virtual node) and then removes the requirement
// from it. While searching for the node which satisfies the requirement,
// this function also updates the 'prevTrace' counts on the nodes between
// the anchor node and the node satisfying the requirement (this includes
// the count on the anchor node, but excludes the count on the node satisfying
// the requirement).

PartialOrderTree.prototype.removeRelBackward =
    partialOrderTreeRemoveRelBackward;

function partialOrderTreeRemoveRelBackward(requirement, anchorNode)
{
    var offset = requirement.offset;
    var node = anchorNode;
    
    while(node) {
        var nodeSize = node.getSize();
        if(offset < nodeSize)
            break; // this node contains the element satisfying the requirement

        // continue to the previous node
        node.prevTrace--;
        offset -= nodeSize;
        node = node.prev;
    }

    // requirement is stored on 'node'
    
    if(node === undefined) {
        // requirement is satisfied beyond the end of the backward ordered set,
        // remove it from the virtual first node.
        this.virtualFirst.removeRelRequirement(requirement);
    } else {
        // remove the requirement from the list of backward relative
        // requirements
        var requirements = node.relBackward;
        if(requirements.length == 1) { // last relative requirement
            node.relBackward = undefined;
        } else {
            for(var i = 0, l = requirements.length ; i < l ; ++i) {
                if(requirements[i].id != requirement.id)
                    continue;
                if(i < l - 1)
                    requirements[i] = requirements[l - 1];
                requirements.length--;
                break;
            }
        }
    }
}

// This function removes a complement requirement 'requirement' from the tree
// (in addition, two absolute requirements in opposite directions should
// be removed before or after this operation).
// All the current function does is remove the requirement from the list
// of complement requirements and, if the requirement required the
// ordering of the elements inside the range to be maintained, also decreases
// the 'noHeap' counter.

PartialOrderTree.prototype.removeComplementRequirement =
    partialOrderTreeRemoveComplementRequirement;

function partialOrderTreeRemoveComplementRequirement(requirement)
{
    this.allRequirements.remove(requirement);
    this.complementRequirements.remove(requirement);
    if(requirement.isOrderedRange) {
        this.decNoHeapNodes();
        this.orderedRangeRequirements.remove(requirement);
    }
}

// This function decreases by 1 the 'noHeapNodes' property. Even if this
// drops to zero as a result of this operation, this function does not have
// to do anything beyond this, as we do not convert element nodes back into
// heap nodes even when there is no need to continue to maintain the
// element nodes separately.

PartialOrderTree.prototype.decNoHeapNodes =
    partialOrderTreeDecNoHeapNodes;

function partialOrderTreeDecNoHeapNodes()
{
    if(this.noHeapNodes == 0)
        return; // just in case
    
    this.noHeapNodes--;
}

/////////////////////////////////////
// Suspended Relative Requirements //
/////////////////////////////////////

// This function is called with a relative or element requirement 'requirement'
// when the element which is its anchor is removed. In this case the
// relative/element requirement is suspended, which means that its match/result
// is empty and it is stored in a table of suspended relative requirements
// under the unique value of its anchor element (the unique value of an element
// is the value stored under the field specified by this.uniqueValueAttr).
// The requirement remains suspended until either it is removed from
// this tree or until its anchor element is added back.
// This function places the requirement in the suspended requirement table
// and notifies the requirement that it is suspended. This function is
// not responsible for removing the requirement from the node on which its
// was registered (this is the responsibility of the calling function).

PartialOrderTree.prototype.suspendRequirement =
    partialOrderTreeSuspendRequirement;

function partialOrderTreeSuspendRequirement(requirement)
{
    var uniqueValue = this.uniqueValueAttr === undefined ?
        requirement.anchor : requirement.anchor[this.uniqueValueAttr];
    var requirementList;
    if(this.suspendedRequirements.has(uniqueValue))
        requirementList = this.suspendedRequirements.get(uniqueValue);
    else {
        requirementList = new RequirementList();
        this.suspendedRequirements.set(uniqueValue, requirementList);
    }

    if(requirementList.add(requirement))
        requirement.suspend(); // was not previously in the suspended list
}

// This function is called when the element 'element' is added to the tree.
// The function checks whether there are any suspended requirements anchored
// at 'element'. If there are, these requirements can now be unsuspended
// and added into the tree.
// 'insertPos' is the forward position of the inserted element

PartialOrderTree.prototype.unsuspendRequirements =
    partialOrderTreeUnsuspendRequirements;

function partialOrderTreeUnsuspendRequirements(element, node, insertPos)
{
    var uniqueValue = this.uniqueValueAttr === undefined ?
        element : element[this.uniqueValueAttr];
    
    if(!this.suspendedRequirements.has(uniqueValue))
        return; // no suspended requirements with anchor at this element
        
    var suspended = this.suspendedRequirements.get(uniqueValue).requirements;
    this.suspendedRequirements.delete(uniqueValue);

    for(var i = 0, l = suspended.length ; i < l ; ++i)
        this.insertAnchoredRequirement(suspended[i], node, insertPos);
}

// Given an element, this function returns true if there are any suspended
// requirements which have their anchor at this element

PartialOrderTree.prototype.isSuspendedRequirementAnchor =
    partialOrderTreeIsSuspendedRequirementAnchor;

function partialOrderTreeIsSuspendedRequirementAnchor(element)
{
    var uniqueValue = this.uniqueValueAttr === undefined ?
        element : element[this.uniqueValueAttr];
    
    return this.suspendedRequirements.has(uniqueValue);
}

////////////////////
// Compare Update //
////////////////////

// This function allows one to replace the existing comparison function
// with a new comparison function. There are two ways in which this function
// may be used:
// 1. After the new comparison function is set, call the refreshOrder()
//    which will reorder existing elements in the tree in case their order
//    under the new ordering is different from that under the previous
//    comparison function.
// 2. Without calling refreshOrder(). This option requires caution, as it
//    may only be used if the comparison function is identical to the
//    comparison function it replaces for those elements already in the tree.
//    This could typically be used in the following situations:
//    a. No elements have yet beeen added to the odrer tree.
//    b. The comparison has only changed for elements not yet added to
//       the tree (but are about to be added).

PartialOrderTree.prototype.updateCompareFunc =
    partialOrderTreeUpdateCompareFunc;

function partialOrderTreeUpdateCompareFunc(compareFunc)
{
    this.compare = compareFunc;

    var _self = this;

    // the comparison function used by the heaps is defined by closure to
    // ensure it remains the same as this.compare even when this.compare
    // changes.
    
    this.heapCompare = function(elementId1, elementId2) {
        return _self.compare(elementId1, elementId2);
    };
}

// This function re-orders the set after the comparison function changed.
// It both re-orders the set and notifies the requirements which were
// affected by the re-ordering. 

PartialOrderTree.prototype.refreshOrder =
    partialOrderTreeRefreshOrder;

function partialOrderTreeRefreshOrder()
{
    if(this.getSize() <= 1)
        return; // nothing to re-order
    
    // create a buffer to store anchored requirements whose anchor
    // element is moved during reordering (will be added back below).
    this.requirementsPendingReordering = [];

    var noHeapRanges = this.reorderSubTree(undefined, this.root);

    // re-insert the pending anchored requirement
    for(var i = 0, l = this.requirementsPendingReordering.length ; i < l ; ++i)
        this.addAnchoredRequirement(this.requirementsPendingReordering[i]);

    this.requirementsPendingReordering = undefined;

    // update requirements which keep track of the order inside ranges
    this.updateOrderedRangesAfterReordering(noHeapRanges);
}

// This function is called after the set has been re-ordered and updates
// requirements which track the ordering inside a range of the ranges
// in which the ordering may have changed. 'noHeapRanges' is an array
// holding a sequence of forward offset ranges of the form
// [<low offset>,<high offset>] inside which reordering may have
// changed. These ranges are disjoint and sorted (in increasing order).
// This function goes over all requirements which track the ordering
// inside a range, converts their range into a forward offset range
// (even if the requirement is defined based on backward offset(s) or
// an anchor element) and checks which ranges in 'noHeapRanges' overlap
// the requirement's range. For those requirements, the intersection of
// the requirement range an the range in 'noHeapRanges' is reported
// to the requirement as a range of offsets where the ordering of elements
// may have changed.

PartialOrderTree.prototype.updateOrderedRangesAfterReordering =
    partialOrderTreeUpdateOrderedRangesAfterReordering;

function partialOrderTreeUpdateOrderedRangesAfterReordering(noHeapRanges)
{
    if(noHeapRanges === undefined || noHeapRanges.length == 0 ||
       this.orderedRangeRequirements.getSize() == 0)
        return; // nothing to do

    // go over all requirements tracking ordering inside a range
        
    for(var i = 0, l = this.orderedRangeRequirements.requirements.length ;
        i < l ; ++i) {
        var requirement = this.orderedRangeRequirements.requirements[i];
        // get the current range of the requirement in terms of forward offsets
        var requirementRange = requirement.getForwardRange();

        if(requirementRange === undefined)
            continue;
        
        for(var j = 0, m = noHeapRanges.length ; j < m ; ++j) {

            var noHeapRange = noHeapRanges[j];
            
            if(requirementRange[1] < noHeapRange[0])
                break; // ranges in 'noHeapRanges' are ordered

            if(requirementRange[0] > noHeapRange[1])
                continue; // no overlap
            
            // update the requirement with the range of elements which
            // moved (reduced to the requirement's range)
            requirement.updateReorderedRange(Math.max(requirementRange[0],
                                                      noHeapRange[0]),
                                             Math.min(requirementRange[1],
                                                      noHeapRange[1]));
        }
    }
}

// This function re-orders the elements in the sub-tree rooted at the given
// node together with the elements on the node which is the previous node
// before the first node in the given sub-tree.
// It should be called when there is reason to believe that the comparison
// function changed for the elements stored in the sub-tree. It is then
// also called recursively when the sub-tree is re-sorted.
// The sorting is performed through a merge-sort:
// Let T be the sub-tree given as input to the function and let p be the
// previous node (this is undefined if T contains the first node in the
// tree). Let r be the root of T and let L and R be the left and right
// sub-trees under r. The function first calles itself recursively for L
// and R. The call for L will re-order p + L while the call for R will re-order
// r + R. After this re-ordering took place, p + L and r + R are merged
// to form a single sequence of sorted elements.
// 'prevNodePos' should be the forward offset of 'prevNode'. When
// 'prevNode' is undefined, 'prevNodePos' is ignored.
//
// Sorting is in-place: elements are moved among the tree nodes but
// the tree nodes remain the same and continue to hold the same number
// of elements after the sort as before the sort. This means that all
// absolute requirements can remain in place. Anchored requirements,
// however, need to be moved when their anchor element is moved.
// This is implemented by removing those requirements when their
// anchor element is moved and placing them in the
// this.requirementsPendingReordering table. After the re-ordering is
// completed, these requirements need to be re-inserted into the tree
// (this must take place in the calling function).
//
// Return value: the return value of this function is an array of
// arrays each containing two numbers (the first smaller or equal the second)
// representing a range of forward offsets. 
// These are ranges of offsets within which elements were moved to
// 'no heap' nodes. This set contains all reordered segments contained in
// range requirements which track the order inside the range.
// These ranges are disjoint and ordered (when the ranges calculated overlap
// they are merged into a single range).
// The argument 'noHeapRanges' is the initial array to which these
// offset range arrays may be added. This is used internally for
// the recursive call. Te initial call doe not need to provide this
// argument, as the array will be created and returned.
//
// It is up to the calling function to use this sequence of ranges
// to update the requirements affected by the change of ordering in
// the relevant segments.

PartialOrderTree.prototype.reorderSubTree =
    partialOrderTreeReorderSubTree;

function partialOrderTreeReorderSubTree(prevNode, subTreeRoot,
                                        prevNodePos, noHeapRanges)
{
    var subTreeRootPos =
        (prevNode === undefined) ? 0 : prevNodePos + prevNode.getSize();
    
    // recursively sort the left and right parts
    if(subTreeRoot.left !== undefined) {
        subTreeRootPos += subTreeRoot.left.getSubTreeSize();
        noHeapRanges = 
            this.reorderSubTree(prevNode, subTreeRoot.left, prevNodePos,
                                noHeapRanges);
    } else if(prevNode !== undefined)
        prevNode.refreshOrder(this.heapCompare);

    if(subTreeRoot.right !== undefined) {
        noHeapRanges =
            this.reorderSubTree(subTreeRoot, subTreeRoot.right, subTreeRootPos,
                                noHeapRanges);
    } else
        subTreeRoot.refreshOrder(this.heapCompare);
    
    // merge the two sorted parts
    
    var insertNode;
    var insertPos;
    if(prevNode === undefined) {
        insertNode = this.first;
        insertPos = 0;
        if(insertNode === subTreeRoot)
            return noHeapRanges; // nothing to merge
    } else {
        insertNode = prevNode;
        insertPos = prevNodePos;
    }
    var numToMerge = subTreeRoot.getSize() +
        (subTreeRoot.right ? subTreeRoot.right.getSubTreeSize() : 0);
    var noHeapRange = this.mergeReorderedSubTrees(insertNode, insertPos,
                                                  subTreeRoot, numToMerge);
    
    if(noHeapRange === undefined)
        return noHeapRanges;

    // merge this range with overlapping ranges received from the
    // recursive calls and return the updated list of ranges.
    return mergeIntervalIntoSequence(noHeapRanges, noHeapRange);
}

// This function merges, in place, two consecutive lists of elements
// in the tree, which are each assumed to already be sorted.
// The first sequence of elements (the 'left' sequence) begins at
// the elements stored at node 'insertNode' and extends all the way to
// (but not including) 'firstMergedNode' (that is, the last element in the
// left sequence is the maximal element on firstMergedNode.prev).
// The second sequence (referred to as the 'right sequence') begins with
// the elements stored at 'firstMergedNode' and containts 'numToMerge'
// elements ('numToMerge' must be such that all elements stored on the
// last node holding elements of the sequence are in the sequence, that is,
// the sequence may not end in the middle of a heap node).
// 'insertPos' is the forward offset of 'insertNode'.
// The function merges the two sequences in place, by moving elements, but
// without changing the nodes, such that after the operation the elements in
// the combined sequence of elements is sorted (up to the order inside
// a heap node) and each node stores the same number of elements
// as before this operation (that is, element nodes remain element
// nodes and heap nodes store the same number of elements as before
// the operation). This means that absolute requirements and their related
// traces do not need to be changed.
// The two sorted lists are merged by keeping track of the first element
// in each sequence (the left and the right sequences) which was not yet
// inserted into the combined list and the insertion position. These two
// elements are compared and the smaller of the two is inserted at the
// insertion position. The process has two distinct steps: insertion
// into the left sequence nodes and insertion into the right sequence
// nodes. The main difference is that while inserting nodes into the
// left sequence nodes requires the original element at the insertion
// position to be removed and put on a queue of elements pending insertion,
// insertion into the right sequence nodes does not require this removal
// since the elements at those positions were already moved forward.
// These two steps are implemented in two separate function (this function
// implements the first step and the second step takes place in a function
// called at the end of this function).
//
// In the process of merging the two sequences, requirement nodes are
// notified of relevant changes. Depending on the requirement, this happens
// in several ways:
// 1. Absolute requirements: when an element is replaced on a node which
//    carries absolute requirements, these requirements are notified
//    of this change in the matched element.
//    In addition, if any of the requirements are the end-point requirements
//    of a range or complement requirement, the system also notifies the
//    requirements of the elements which crossed from one side of the
//    requirement to the other. The elements which cross the requirement
//    from left to right (from lower in the ordering to higher) are
//    those elements which are still pending when the node carrying the
//    requirements becomes the insertion node. If there are N such elements
//    then the elements which crossed the requirements from right to
//    left (from higher in the ordering to lower) are the last N elements
//    which were copied from the right sequence.
// 2. Absolute requirement range ordering: when the 'noHeap' property is
//    set on a node whose element is replaced, the offset of that node is
//    registered. This produces (for each sub-tree reordered) the range of
//    offsets reordered which fall inside a range whose order is tracked
//    by some requirement. This range of offsets is returned by the function
//    to the calling function, together with the ranges received from the
//    recursive calles inside this function. After the top call to this
//    function returns, the calling function can use these ranges to
//    find the affected requirements and update them as to the ranges
//    which they need to retrieve in order to update the ordering inside
//    the range.
// 3. Anchored requirements: if an element is replaced on a node which
//    has a next/prev trace, we check which requirements are anchored
//    at this node. Those requirements which are relative requirements
//    are suspended (to be unsuspended at the end of the sort process).
//    Element requirements, however, are updated as the element at which
//    they are anchored is moved. If the element requirement is also
//    a range requirement, we also report the elements which crossed the
//    requirement (just like in the absolute requirements) and if it also
//    needs to track the ordering inside the range, notify the element
//    requirements in the same way as with absolute requirements which
//    track the ordering.
//
// This function returns an array containing two numbers: the lowest
// and highest forward offset at which a 'noHeap' marked node had its
// elemnet replaced by another (these ranges are later used to update
// the order of elements in the range).
//
// Note: in the function below, we maintain two lists of elements:
// 'pendingElements' (elements from the left segment moved to a higher
// forward offset) and 'rightMoved' (elements from the right segment
// moved to a lower forward offset). At every insertion node, the
// nodes still pending insertion in 'pendingElements' and the same number
// of elements at the end of the 'rightMoved' list are the elements
// which were moved across the insertion point (this is used
// for updating the requirements at that node).

PartialOrderTree.prototype.mergeReorderedSubTrees =
    partialOrderTreeMergeReorderedSubTrees;

function partialOrderTreeMergeReorderedSubTrees(insertNode, insertPos,
                                                firstMergedNode, numToMerge)
{
    var noHeapReplacedRange; // range of offsets returned by this function
    var mergedNode = firstMergedNode;
    // elements waiting to be re-inserted, sorted, smallest first.
    var pendingElements = [];
    var firstPendingPos = 0; // next element to insert from 'pendingElements'
    var rightMoved = []; // right elements which were moved (to the left)
    // elements popped from the heap to which elements are currently
    // being added (these appear here in reverse order).
    var poppedHeapElements = [];
    
    var rightElement = mergedNode.heap === undefined ?
        mergedNode.element : mergedNode.heap.getMin();

    // check whether any merging needs to take place
    var lastLeft = mergedNode.prev.heap === undefined ?
        mergedNode.prev.element : mergedNode.prev.heap.getMax();
    if(this.compare(lastLeft, rightElement) < 0)
        return undefined; // no merging to perform (elements already ordered)
    
    var leftElement = insertNode.heap === undefined ?
        insertNode.element : insertNode.heap.getMax();
    
    if(mergedNode.heap !== undefined) // store heap size before popping
        mergedNode.origHeapSize = mergedNode.heap.getSize();
    
    // loop until all elements in the left segment have been determined 
    while(insertNode !== firstMergedNode) {

        var cmp = (numToMerge === 0) ?
            -1 : this.compare(leftElement, rightElement);
        
        if(cmp < 0 && firstPendingPos == pendingElements.length) {
            // left element remains in place, just advance to next comparison

            // if this was a heap node, push the elements popped from it to
            // the pending list of elements
            if(insertNode.heap !== undefined) {
                if(poppedHeapElements.length != 0) {
                    for(var i = poppedHeapElements.length - 1 ; i >= 0; --i)
                        pendingElements.push(poppedHeapElements[i]);
                    poppedHeapElements = [];
                }
                insertPos += insertNode.heap.getSize();
            } else
                insertPos++;
            insertNode = insertNode.next;
            if(firstPendingPos < pendingElements.length)
                leftElement = pendingElements[firstPendingPos];
            else {
                leftElement = (insertNode.heap === undefined) ?
                    insertNode.element : insertNode.heap.getMax();
            }
            continue;
        }

        // the element to be inserted is the right element or an element from
        // the pending list, so it replaces an element on the insertion node.
        var insertedElement = (cmp > 0) ? rightElement : leftElement;

        if(cmp > 0) // add to the moved element before inserting it below
            rightMoved.push(insertedElement);
        
        if(insertNode.heap === undefined) {
            pendingElements.push(insertNode.element);
            noHeapReplacedRange =
                this.replaceNodeElement(insertNode, insertPos, false,
                                        insertedElement, pendingElements,
                                        firstPendingPos, rightMoved,
                                        noHeapReplacedRange);
            insertNode = insertNode.next;
            insertPos++;
        } else {
            poppedHeapElements.push(insertNode.heap.popMax());
            insertNode.heap.add(insertedElement);
            if(insertNode.heap.getMax() === insertedElement) {
                // already added as many nodes as possible to the heap,
                // advance to next node (popped heap elements are pending)
                for(var i = poppedHeapElements.length - 1 ; i >= 0; --i)
                    pendingElements.push(poppedHeapElements[i]);
                poppedHeapElements = [];
                insertPos += insertNode.heap.getSize();
                insertNode = insertNode.next;
                // since we added elements to the pending list, a new
                // left element may have become available
                leftElement = pendingElements[firstPendingPos];
            } else if(firstPendingPos >= pendingElements.length)
                leftElement = insertNode.heap.getMax();
        }
        
        if(cmp > 0) { // advance the right element
            
            // pop the node just inserted from its original list
            if(mergedNode.heap !== undefined)
                mergedNode.heap.popMin();
            
            if(--numToMerge == 0)
                continue; // reached the end of the right list
            
            if(mergedNode.heap === undefined ||mergedNode.heap.getSize() == 0) {
                mergedNode = mergedNode.next;
                if(mergedNode.heap !== undefined)
                    // store heap size before popping elements
                    mergedNode.origHeapSize = mergedNode.heap.getSize();
            }
            rightElement = (mergedNode.heap !== undefined) ?
                mergedNode.heap.getMin() : mergedNode.element;
            
        } else { // advance the left element
            firstPendingPos++; // only advance after replacement above
            if(firstPendingPos < pendingElements.length)
                leftElement = pendingElements[firstPendingPos];
            else {
                leftElement = (insertNode.heap === undefined) ?
                    insertNode.element : insertNode.heap.getMax();
            }
        }
    }

    // perform the remaining merge (into the right segment merged)
    return this.mergeReorderedSubTreeTail(pendingElements, firstPendingPos,
                                          rightMoved, insertNode, insertPos,
                                          numToMerge > 0 ?
                                          mergedNode : undefined,
                                          numToMerge, noHeapReplacedRange);
}

// This function implements the second step of the merge process carried
// out by 'mergeReorderedSubTrees()'. This step handles the part of the
// merge process in which elements are inserted into the right sequence.
// 'pendingElements' is an array holding all elements from the left
// sequence which were moved out of their original place in the sequence.
// The elements in this sequence are sorted. 'firstPendingPos' is the position
// in this array of the first element not yet inserted back into the
// tree nodes. Once all elements in 'pendingElements' have been inserted,
// the merge process is complete.
// 'rightMoved' is an array of elements from the right segment which were
// moved from their place (to a smaller forward offset in the ordering).
// At any moment, if there are N elements in 'pendingElements' which have
// not yet been inserted (that is, N = pendingElements.length - firstPendingPos)
// then this is also the number of elements at the end of the array
// 'rightMoved' which were moved from a node to the right of the current
// position to a node to the left of the current position. This list
// is used ot update the range and complement requirements (see
// introduction to calling function). 
// 'insertNode' is the node at which the next element inserted should
// be inserted. 'insertPos' is the forward offset of the insert node.
// 'mergedNode' is the node (in the right sequence) which
// holds the first element in the right sequence which was not yet merged.
// 'numToMerge' is the number of elements in the right sequence which
// were not yet merged (this allows the function to determine when it
// reaches the last element in the rigt sequence).
// 'noHeapReplacedRange' is undefined or an array of length 1 or 2
// which defines the lowest and highest forward offsets where the
// an element was replaced on a 'noHeap' node. This value is further
// updated by this function and then returned.
// 'insertNode' and 'mergedNode' may become equal during the processing
// of this function (and otherwise 'insertNode' must be before 'mergedNode').
// This may happen only if the node is a heap node. In that case, it may
// be that the heap node contains fewer elements than the capacity of the
// heap before the merge. Elements may be inserted into this heap node
// either from the pending leaf sequence elements or from the next node
// in the right sequence, but this first requires comparison with
// the maximal element already inserted into the node.
//
// This function udates requirements affected by the re-ordering
// of the requirements in the same way as the calling function.

PartialOrderTree.prototype.mergeReorderedSubTreeTail =
    partialOrderTreeMergeReorderedSubTreeTail;

function partialOrderTreeMergeReorderedSubTreeTail(pendingElements,
                                                   firstPendingPos, rightMoved,
                                                   insertNode, insertPos,
                                                   mergedNode, numToMerge,
                                                   noHeapReplacedRange)
{
    if(firstPendingPos == pendingElements.length)
        return noHeapReplacedRange; // nothing more to do

    var leftElement = pendingElements[firstPendingPos];
    var rightElement;
    if(numToMerge !== 0) {
        if(mergedNode.heap === undefined)
            rightElement = mergedNode.element;
        else if(insertNode == mergedNode) {
            // skip to the last element
            rightElement = mergedNode.heap.getMax();
            numToMerge -= mergedNode.heap.getSize() - 1;
        } else
            rightElement = mergedNode.heap.getMin();
    }
    
    // loop until all pending elements have been merged
    while(firstPendingPos < pendingElements.length) {

        var cmp = (numToMerge == 0) ?
            -1 : this.compare(leftElement, rightElement);
        var insertedElement;

        // determine the next element to insert. A special case is when
        // the insertion node and the merged node are the same node,
        // which means this is a heap node.
        if(cmp > 0) {

            if(insertNode == mergedNode) { // must be a heap node
                // inserted element remains in same heap
                if(--numToMerge > 0) {
                    mergedNode = mergedNode.next;
                    if(mergedNode.heap !== undefined)
                        mergedNode.origHeapSize = mergedNode.heap.getSize();
                    rightElement = (mergedNode.heap === undefined) ?
                        mergedNode.element : mergedNode.heap.getMin();
                } else
                    mergedNode = undefined;
                continue; // all heap element stay in place
            }
            
            insertedElement = rightElement;
            rightMoved.push(rightElement);
            if(mergedNode.heap !== undefined)
                mergedNode.heap.popMin(); // inserted elsewhere below
            
        } else // the next left element will be determined after insertion
            insertedElement = leftElement;

        // insert element

        if(insertNode.heap === undefined)
            noHeapReplacedRange =
                this.replaceNodeElement(insertNode, insertPos, true,
                                        insertedElement, pendingElements,
                                        firstPendingPos, rightMoved,
                                        noHeapReplacedRange);
        else
            insertNode.heap.add(insertedElement);

        if(cmp > 0) {
            
            // advance to the next merge position
            if(--numToMerge > 0) {
                if(mergedNode.heap === undefined) {
                    mergedNode = mergedNode.next;
                    if(mergedNode.heap !== undefined)
                        mergedNode.origHeapSize = mergedNode.heap.getSize();
                } else {
                    if(mergedNode.heap.getSize() == 0) {
                        mergedNode = mergedNode.next;
                        if(mergedNode.heap !== undefined)
                            mergedNode.origHeapSize = mergedNode.heap.getSize();
                    }
                }
                rightElement = (mergedNode.heap === undefined) ?
                    mergedNode.element : mergedNode.heap.getMin();
            } else
                mergedNode = undefined;
        } else { // advance to the next left element
            ++firstPendingPos;
            leftElement = pendingElements[firstPendingPos];
        }
        
        if(firstPendingPos == pendingElements.length)
            break; // add all elements
        
        // move to next insertion position
        if(insertNode.heap === undefined) {
            insertPos++;
            insertNode = insertNode.next;
        } else if(insertNode.origHeapSize > insertNode.heap.getSize())
            continue; // node not full yet
        else {            
            insertPos += insertNode.origHeapSize;
            insertNode.origHeapSize = undefined;
            insertNode = insertNode.next;
        }
        
        if(insertNode == mergedNode) { // skip to the last element
            numToMerge -= mergedNode.heap.getSize() - 1;
            rightElement = mergedNode.heap.getMax();
        }
    }

    return noHeapReplacedRange;
}

// This function is called during the merge step of the reordering of a
// sub-tree when the element 'insertedElement' replaces the current element
// on the node 'insertNode'. This function takes care of replacing the
// element and performing the requirement updates induced by this replacement.
// Since this only relates to requirements registered on this node or
// anchored at this node or requirements  which track the order of the
// range to which this node belongs, this function is only called on
// nodes which are element node.
// 'insertPos' is the forward offset of 'insertNode'. 'insertRight'
// indicates whether 'insertNode' is part of the left or right
// ordered segment being merged ('insertRight' true indicates that
// insertion took place to the right segment).
// 'insertedElement' is the element to be inserted. 'pendingElements'
// is an array such that beginning at position 'firstPendingPos', this
// array stores those elements whose original position (before the merge)
// was before or at 'insertNode' and their eventual position
// (after the merge) is at or after 'insertNode' and such that each of
// these elements is moved from its original place.
// 'rightMoved' is an array whose suffix stores all elements whose original
// position (before the emerge) was at or after 'insertNode' and their
// position after the merge is before or at 'insertNode' (and each of
// these elements was moved from its original position).
// When 'insertRight' is false ('insertNode' is in the left merge segment)
// all elements in 'rightMoved' satsify this condition. When
// 'insertRight' is true, only a suffix of this array of the following
// length contains these elements:
// 1. If 'insertedElement' is the element at position 'firstPendingPos' in
//    'pendingElements' (meaning that the left element was inserted here)
//    then as many elements as in 'pendingElements' beginning at position
//    'firstPendingPos' (that is, pendingElements.length - firstPendingPos).
// 2. Otherwise ('insertedElement' is a right element and thereofore the
//    last element in 'rightMoved') it is one more than
//    in 'pendingElements' beginning at position 'firstPendingPos' (that is,
//    pendingElements.length - firstPendingPos + 1).
// 'noHeapReplacedRange' is either undefined or an array describing the
// range of forward offsets in the currently reordered sub-tree
// where an element was replaced at an offset which is inside a range
// whose order is tracked by some requirement. This function updates this
// range and returns the new value of the range (it will construct the
// array if it does not yet exist).
// In addition to updating 'noHeapReplacedRange', this function also updates
// additional requirements:
// 1. Absolute requirements:
//    a. The function updates the element matched by the requirement.
//    b. If the requirement is part of a range or a complement requirement,
//       the function adds to the requirement range the elements crossing
//       the requirement from the outside to the inside and removes
//       those crossing from the inside to the outside (the same element
//       may be added here and removed later if it is moved beyond the
//       other end of the range).
// 2. Element requirements: since the element at this node was replaced,
//    the element requirements need to be moved to a different node
//    (together with their anchor element). This is done by removing them
//    here and placing them in a table of pending requirements which are
//    added back into the tree once the re-ordering is completed.
// 3. Relative requirements: just like element requirements, these
//    requirements need to be moved to a different position in the tree and
//    this is done by removing them and storing them in the list of pending
//    requirements, which are added back into the tree once the reordering
//    is completed. However, as opposed to the element requirement, the
//    relative requirement objects are not actually registered on the
//    node carrying their anchor element (but on the node carrying the
//    element satisfying their requirement). This function must therefore
//    search for these requirement nodes (by following the next/pre traces).

PartialOrderTree.prototype.replaceNodeElement =
    partialOrderTreeReplaceNodeElement;

function partialOrderTreeReplaceNodeElement(insertNode, insertPos, insertRight,
                                            insertedElement, pendingElements,
                                            firstPendingPos, rightMoved,
                                            noHeapReplacedRange)
{
    // modify the element
    var prevElement = insertNode.element;
    insertNode.element = insertedElement;

    // remove element requirements and add them to the pending list

    if(insertNode.elementForward !== undefined) {
        var requirement = insertNode.elementForward;
        // remove tracing for this requirement (if any was added)
        this.removeElementRequirementTracing(requirement, insertNode);
        this.requirementsPendingReordering.push(requirement);
        insertNode.elementForward = undefined;
    }
    if(insertNode.elementBackward !== undefined) {
        var requirement = insertNode.elementBackward;
        // remove tracing for this requirement (if any was added)
        this.removeElementRequirementTracing(requirement, insertNode);
        this.requirementsPendingReordering.push(requirement);
        insertNode.elementBackward = undefined;
    }
    
    // search for relative requirements anchored at this node (and
    // remove them and add them to the list of pending requirements)

    if(insertNode.nextTrace > 0) {
        var removedRelative =
            this.notifyReplaceRelForward(insertNode, 0, insertNode.nextTrace);
        if(removedRelative) // store the removed requirement
            for(var i = 0, l = removedRelative.length ; i < l ; ++i)
                this.requirementsPendingReordering.push(removedRelative[i]);
    }

    if(insertNode.prevTrace > 0) {
        var removedRelative =
            this.notifyReplaceRelBackward(insertNode, 0, insertNode.prevTrace);
        if(removedRelative) // store the removed requirement
            for(var i = 0, l = removedRelative.length ; i < l ; ++i)
                this.requirementsPendingReordering.push(removedRelative[i]);
    }

    // notify relative requirements which are satisfied at this node
    // (these continue to be satisfied here, but with a new element)
    if(insertNode.relForward !== undefined)
        for(var i = 0, l = insertNode.relForward.length ; i < l ; ++i)
            insertNode.relForward[i].updateElement(insertedElement);
    if(insertNode.relBackward !== undefined)
        for(var i = 0, l = insertNode.relBackward.length ; i < l ; ++i)
            insertNode.relBackward[i].updateElement(insertedElement);
    
    // notify absolute requirements at this node of the new element set
    // here and of the elements crossing the requirement from left
    // to right or from right to left.

    var firstRightMoved = 0; // see function introduction for explanation 
    if(insertRight == true) {
        firstRightMoved =
            rightMoved.length - (pendingElements.length - firstPendingPos);
        if(insertedElement != pendingElements[firstPendingPos])
            firstRightMoved--;
    }
    
    if(insertNode.absForward !== undefined)
        for(var i = 0, l = insertNode.absForward.length ; i < l ; ++i) {
            var requirement = insertNode.absForward[i];
            requirement.replacedElement(insertedElement, pendingElements,
                                        firstPendingPos, rightMoved,
                                        firstRightMoved);
        }

    if(insertNode.absBackward !== undefined)
        for(var i = 0, l = insertNode.absBackward.length ; i < l ; ++i) {
            var requirement = insertNode.absBackward[i];
            requirement.replacedElement(insertedElement, pendingElements,
                                        firstPendingPos, rightMoved,
                                        firstRightMoved);
        }

    // update the offset range of modified elements within a range
    // whose inner ordering is being tracked.
    
    if(insertNode.noHeapNext > 0 ||
       (insertNode.prev !== undefined && insertNode.prev.noHeapNext > 0) ||
       insertNode.noHeapPrev > 0 ||
       (insertNode.next !== undefined && insertNode.next.noHeapPrev > 0)) {
        if(noHeapReplacedRange === undefined)
            noHeapReplacedRange = [insertPos,insertPos];
        else
            noHeapReplacedRange[1] = insertPos;
    }
    
    return noHeapReplacedRange;
}

///////////////////
// Notifications //
///////////////////

// This function is called by the owner of this order tree (the module
// which adds and removes elements) to indicate that an element update
// cycle has been completed and that all requirements may now notify
// their listeners of any changes in their result. This function
// goes over all requirements registered to this tree and notifies
// them that they can notify their listeners of updates.

PartialOrderTree.prototype.notifyListeners = partialOrderTreeNotifyListeners;

function partialOrderTreeNotifyListeners()
{
    var requirements = this.allRequirements.requirements;

    for(var i = 0, l = requirements.length ; i < l ; ++i)
        requirements[i].notifyListeners();
}

//////////////////////
// PartialOrderNode //
//////////////////////

// PartialOrderNode:
//
// This class defines a single node in the tree. Such a node holds pointers
// to its parent and children in the tree as well as the next and previous
// node in the tree (in the ordering of the nodes).
//
// The node may store either a single element or a heap of elements.
//
// The node also stores the set of requirements satisfied by this
// node and various traces which allow the requirements on other nodes
// to be updated properly.
//
// {
//    // tree structure
//
//    parent: <parent node of this node>,
//    left: <left child node of this node>,
//    right: <right child node of this node>,
//    prev: <previous node in the order>,
//    next: <next node in the order>
//
//    // one of the following two fields
//    element: <single element at this node>
//    heap: <MinMaxPosHeap>
//    subTreeSize: <number of elements under this node>
//
//    // requirements
//
//    absForward: [<array of forward absolute requirements which start
//                 or end at this node>]
//    relForward: [<array of relative forward requirements at this node>]
//    absBackward: [<array of backward absolute requirements which start
//                   or end at this node>]
//    relBackward: [<array of relative backward requirements at this node>]
//    elementForward: <element forward position requirement node>,
//    elementBackward: <element backward position requirement node>,
//
//    // requirement traces
//
//    posTraceForward: <reference count>,
//    posTraceBackward: <reference count>,
//    nextTrace: <reference count>,
//    prevTrace: <reference count>,
//
//    // heap control
//    noHeapNext: <number>
//    noHeapPrev: <number>
// }
//
// Tree structure pointers:
//
// parent: pointer to the parent node (this is undefined iff this is
//    the root node)
// left: pointer to the left child node (may be undefined)
// right: pointer to the left child node (may be undefined)
// prev: pointer to the previous node in the order (this is undefined iff
//    this node is the first in the ordering).
// next: pointer to the next node in the order (this is undefined iff
//    this node is the last in the ordering).
//
// Data storage:
//
// One of the two following field is defined and the other undefined:
//
// element: this field stores the single element of this node in cases
//    where this node may only store a single element (when
//    are any requirements stored on it, see below).
//    When this field is used, the 'heap' field must be undefined.
// heap: this field holds a MinMaxPosHeap object in which the elements
//    belonging to this node are stored in cases where the node is allowed
//    to store multiple elements.
//    When this field is used, the 'element' field must be undefined.
// subTreeSize: this is the total number of elements stored under this
//    node. This is the number of elements stored on this node + the
//    subTreeSize of its left and right children. This number is only stored
//    on non-terminal nodes (for terminal nodes, this number can be directly
//    calculated from the content).
//
// Requirements:
//
// The following fields store the requirements which are satisfied by
// this node:
//
// absForward: this is an array of the forward absolute requirements
//    which start or end at this node. This is undefined if the list is
//    empty.
//    Any function which updates this list must make sure that if
//    the begin and end requirements of the same range requirement are both
//    in this list then the begin requirement appears first.
// relForward: this is an array of the forward relative requirements
//    satisfied at this node. This is undefined if the list is
//    empty
// absBackward: this is an array of the backward absolute requirements
//    which start or end at this node. This is undefined if the list is
//    empty.
//    Any function which updates this list must make sure that if
//    the begin and end requirements of the same range requirement are both
//    in this list then the begin requirement appears first.
// relBackward: this is an array of the backward relative requirements
//    satisfied at this node. This is undefined if the list is
//    empty.
// elementForward: this field can hold a single element forward position
//    requirement, that is, a requirement to update the (forward) position
//    in the ordering of a given element. Since a requirement may only be
//    registered on a node storing a single element, there may at most be one
//    such requirement on a node. When there is no such requirement for this
//    node, this field is undefined.
//    The requirement itself may only keep track of the position of the
//    element or also keep track of the list of elements which appear
//    before this element in the ordering (the requirement always receives
//    updates which contain sufficient information to keep track of this
//    list of elements, but may choose to ignore this information).
// elementBackward: this field can hold a single element backward position
//    requirement, that is, a requirement to update the backward position
//    in the ordering of a given element. Since a requirement may only be
//    registered on a node storing a single element, there may at most be one
//    such requirement on a node. When there is no such requirement for this
//    node, this field is undefined.
//    The requirement itself may only keep track of the position of the
//    element or also keep track of the list of elements which appear
//    after this element in the ordering (the requirement always receives
//    updates which contain sufficient information to keep track of this
//    list of elements, but may choose to ignore this information).
//
// Traces:
//
// The following fields store traces (counts) for various requirements.
// These traces indicate how many requirements are affected by changes
// (addition/removal of element) at this node. All these traces are
// initialized to zero.
//
// posTraceForward: this is the number of forward absolute requirements
//    and forward element requirements which are satisfied on nodes in
//    the right branch under this node (these are all node which are
//    dominated by this node and appear after this node in the
//    ordering). The requirements on this node itself are not included
//    in this count. By definition, this also does not include
//    requirements on the virtual last node.
// posTraceBackward: this is the number of backward absolute requirements
//    and backward element requirements which are satisfied on nodes
//    in the left branch under this node (these are all node which are
//    dominated by this node and appear before this node in the
//    ordering). The requirements on this node itself are not included
//    in this count. By definition, this also does not include
//    requirements on the virtual first node.
// nextTrace: this is the number of relative forward requirements which
//    have their anchor at this node or at an earlier node in the ordering
//    and which are satisfied on a node later in the ordering (including
//    the virtual last node). Adding an element just after this node or
//    removing an element at this node affects these requirements.
// prevTrace: this is the number of relative backward requirements which
//    have their anchor at this node or at a later node in the ordering
//    and which are satisfied on a node earlier in the ordering (including
//    the virtual first node). Adding an element just before this node or
//    removing an element at this node affects these requirements.
//
// noHeapNext: this is a counter of the number of absolute forward ranges
//    which have this node as their lowest point or as an internal node and
//    such that the range requirement needs to know the ordering of the
//    elements inside the range. An element inserted into the tree at
//    a position following a node which has a non-zero 'noHeapNext'
//    will have an element node created for it (rather than a heap node)
// noHeapPrev: this is similar to 'noHeapNext' but for backward range
//    requirements. This is a counter of the number of absolute backward ranges
//    which have this node as their highest point (first in the backward
//    ordering) or as an internal node and such that the range requirement
//    needs to know the ordering of the elements inside the range. An element
//    inserted into the tree at a position immediately before a node which
//    has a non-zero 'noHeapPrev' will have an element node created for
//    it (rather than a heap node)

//
// Constructor
//

// The constructor receives two types of input arguments:
// 1. parent, prev, next which are the parent node, and the previous/next
//    nodes in the tree at the place where this node is to be inserted.
// 2. content information: (optionally) the (first) element to be stored on this
//    node ('element') and, if this node should store an heap of elements,
//    also the following arguments (not optional if a heap shoudl be used):
//    a. the 'uniqueValueAttr' which is a string specifying the attribute
//       under the elements being stored here which carries the unique
//       identifier of the elements. This may be undefined, in which case
//       the elements stored must be atomic values and must be unique
//       (so that their value also identifies them).
//    b. the comparison function 'compare' to be used by the heap (this should
//       be the same comparison function used by the partial sorting tree).
//    A heap will be used iff a 'compare' function is provided. 

function PartialOrderNode(parent, prev, next, element, uniqueValueAttr,
                          compare)
{
    // update the tree structure pointers
    this.parent = parent;
    this.left = undefined;
    this.right = undefined;
    this.prev = prev;
    this.next = next;

    // store the value
    if(compare !== undefined) {
        this.heap = new MinMaxPosHeap(compare, uniqueValueAttr);
        if(element !== undefined)
            this.heap.add(element);
    } else if(element !== undefined)
        this.element = element;

    this.subTreeSize = undefined;
    
    // initialize tracing
    this.posTraceForward = 0;
    this.posTraceBackward = 0;
    this.nextTrace = 0;
    this.prevTrace = 0;

    this.noHeapNext = 0;
    this.noHeapPrev = 0;
}

// this function returns the number of elements stored on this node

PartialOrderNode.prototype.getSize = partialOrderNodeGetSize;

function partialOrderNodeGetSize()
{
    if(this.heap !== undefined)
        return this.heap.getSize();

    return this.element === undefined ? 0 : 1;
}

// This function returns the number of elements in the sub-tree whose
// root it at this node. For a terminal node, this is equal to the
// number of elements stored in the node (returned by the function 'getSize()')
// while for non-terminal nodes, this is stored under the 'subTreeSize'
// field of the node.

PartialOrderNode.prototype.getSubTreeSize = partialOrderNodeGetSubTreeSize;

function partialOrderNodeGetSubTreeSize()
{
    if(this.subTreeSize === undefined)
        return this.getSize();
    
    return this.subTreeSize;
}

// This function returns true if the properties of this node allow it
// to be made into a heap node.

PartialOrderNode.prototype.allowsHeap = partialOrderNodeAllowsHeap;

function partialOrderNodeAllowsHeap()
{
    return (this.absForward === undefined && this.absBackward === undefined &&
            this.relForward === undefined && this.relBackward === undefined &&
            this.elementForward === undefined &&
            this.elementBackward === undefined &&
            this.nextTrace == 0 && this.prevTrace == 0 &&
            (this.prev === undefined || this.prev.noHeapNext == 0) &&
            (this.next === undefined || this.next.noHeapPrev == 0));
}

// This function may be called on this node to convert it from an element
// node to a heap node. It is assumed the calling function already checked
// that this is allowed. This function must be given the 'uniqueValueAttr'
// and 'compare' arguments (identical to those of the constructor) since
// this information is not stored on the node when it has no heap.
// The function constructs the heap object and adds to it the single
// element stored on the node.

PartialOrderNode.prototype.convertElementToHeap =
    partialOrderNodeConvertElementToHeap;

function partialOrderNodeConvertElementToHeap(uniqueValueAttr, compare)
{
    this.heap = new MinMaxPosHeap(compare, uniqueValueAttr);
    if(this.element !== undefined) {
        this.heap.add(this.element);
        this.element = undefined;
    }
}

// This function may be applied to this node if it is a heap node where the
// heap contains a single element. Applying this function then stores this
// element as the single element of this node and discards the heap.
// This means that, after this call, no additional elements could be added
// to the node.
// If this node stores more than one element, this function cannot convert
// the node into a single element node and returns false. Otherwise,
// the function returns true (whether this was a heap node storing a single
// element or already an element node).

PartialOrderNode.prototype.convertHeapToElement =
    partialOrderNodeConvertHeapToElement;

function partialOrderNodeConvertHeapToElement()
{
    if(this.heap === undefined)
        return true; // nothing to convert

    var heapSize = this.heap.getSize();
    
    if(heapSize > 1)
        return false; // cannot convert

    if(heapSize == 1) // move the single element out of the heap
        this.element = this.heap.getMin();
    
    this.heap = undefined; // destroy the heap
    return true;
}

// This function copies the content of the node 'fromNode' to 'this' node.
// The content copied consists of the elements stored, the requirements
// and the next/prev traces. The forward/backward traces are unchanged.
// This is used when a node has to be removed but the node spliced out of
// the tree is not the same as the one which should be removed and the content
// of the node spliced is copied to the node that should have been removed.
// The forward and backward traces are a function of the position of the
// node in the tree and therefore are not copied (they are adjusted separately).
// Since 'fromNode' is about to be copied, there is no need to duplicate it.

PartialOrderNode.prototype.copyContentFromNode =
    partialOrderNodeCopyContentFromNode;

function partialOrderNodeCopyContentFromNode(fromNode)
{
    // one of the following two fields is undefined
    this.element = fromNode.element;
    this.heap = fromNode.heap;

    this.absForward = fromNode.absForward;
    this.relForward = fromNode.relForward;
    this.absBackward = fromNode.absBackward;
    this.relBackward = fromNode.relBackward;
    this.elementForward = fromNode.elementForward;
    this.elementBackward = fromNode.elementBackward;

    this.nextTrace = fromNode.nextTrace;
    this.prevTrace = fromNode.prevTrace;
    this.noHeapNext = fromNode.noHeapNext;
    this.noHeapPrev = fromNode.noHeapPrev;
}

// This function refreshes the ordering of the elements stored on this
// node in case the comparison function changed. 'compare' is the new
// comparison function (this may point to the same function as the old
// comparison function). If this is an element node, there is nothing to do
// here. If this is a heap node, a new heap is created (with the new
// comparison function) and all elements in the old heap are added to the
// new heap (in the process, the new comparison is applied).

PartialOrderNode.prototype.refreshOrder =
    partialOrderNodeRefreshOrder;

function partialOrderNodeRefreshOrder(compare)
{
    if(this.heap === undefined)
        return;

    // a heap node, reorder the heap
    var heapArray = this.heap.heap;
    this.heap = new MinMaxPosHeap(compare, this.heap.indexKey);
    for(var i = 1, l = heapArray.length ; i < l ; ++i)
        this.heap.add(heapArray[i]);
}

/////////////////////////////
// VirtualPartialOrderNode //
/////////////////////////////

// The VirtualPartialOrderNode is a special node which is used to store
// forward and backward requirements which are not yet satisfied (that is,
// when the ordered set contains fewer elements than required to satisfy
// the requirement, whether absolute or relative). For forward requirements
// such a node is attached at the end of the ordered set while for
// backward requirements such a node is attached at the beginning of
// the ordered set.
// This object stores two lists of requirements (one for absolute
// requirements and one for relative requirements). The absolute requirements
// are stored in a heap sorted by the position they require (smallest
// position first) while the relative requirements are stored in an array
// in an arbitrary order. Since we assume that most relative requirements
// are short distance requirements, the number of such requirements
// is assumed to be small.
// As elements are added to the set, the requirements on the virtual
// nodes may become satisfied one by one. For the absolute requirements,
// it is always the top node in the heap which is satisfied first.
// When a requirement becomes satisfied, it is removed from the virtual node
// and placed in the tree (on the first or last node, depending on which
// virtual node it was on).
//
// This object has the following structure:
//
// {
//     tree: <PartialOrderTree>
//     absoluteRequirements: <MinMaxPosHeap heap of requirements>
//     absoluteGap: <number>
//     endAbsoluteRequirements: <RequirementList>
//     relativeRequirements: <array of requirements, each of the form:
//                               {
//                                  requirement: <relative requirement object>,
//                                  gap: <number>
//                               }
//                           >
//     relativeGap: <number>
// }
//
// tree: this is the PartialOrderTree object which owns this virtual node.
//    This is provided once upon construction.
// absoluteRequirements: this is a heap which stores the absolute requirements
//    sorted by the absolute position of the requirement (smallest position
//    first - this may be a forward or backward position depending on whether
//    this is the virtual node at the beginning or at the end of the
//    ordered set). Currently we use here a min-max heap. This is not because
//    we need a min-max heap, but because our implementation of min-max heap
//    allows the removal of elements from the heap, while the simple heap
//    implementation does not. It is assumed that the performance penalty
//    for doing so is small (this may be modified in the future).
// absoluteGap: the difference between the number of elements in the set and
//    the position+1 which is required by the minimal requirement in
//    the absolute requirement heap (that is, if there is one element in
//    the set and the absolute requirement is for position 1, the gap is 1).
//    This can temporarily be zero (when an element was added to the set
//    but the requirement was not yet popped from the virtual node).
//    This property only refers to the absolute requirements. When
//    the virtual node only has relative requirements, 'absoluteGap'
//    is undefined.
// endAbsoluteRequirements: this object holds a subset of the requirements
//    which are stored in 'absoluteRequirements'. These are the absolute
//    requirements which have the property 'isEnd' set to true. These
//    requirements are part of a range requirement and carry the offset
//    which is the end of the range. These requirements are registered here
//    only if the beginning of the range is already inside the element tree.
//    In this case, the end requirement of ranges stored here are notified
//    of each element added to the set (if the begin node of the requirement
//    was not notified of an element, then this element is inside the range).
//    To make this notification cheap, the requirements are stored in the
//    array 'requirements' inside this object.
// relativeRequirements: this is an array which stores the relative requirements
//    together with their distance from the beginning/end of the set (depending
//    on whether these are forward or backward requirements). This distance
//    is stored under the 'gap' field of each object stored in this heap.
//    When an element is added or removed at a position which is not between
//    the anchor of the requirement and the virtual node, this
//    distance does not change.  When the insertion or deletion takes
//    place between the anchor and the virtual node, prev-next tracing
//    notifies the relevant requirements of this change and their
//    position can be adjusted.  The minimal distance in this heap is
//    the 'relative gap' and its value is stored in 'relativeGap'.
// relativeGap: this is the minimum of the 'gap' field of all objects
//    stored under 'relativeRequirements'. If there are no relative
//    requirements, this field is undefined.

//
// Constructor
//

// The only argument to this function is 'tree', which should be the
// PartialOrderTree object to which this virtual node belongs.

function VirtualPartialOrderNode(tree)
{
    this.tree = tree;
    this.absoluteRequirements = undefined;
    this.absoluteGap = undefined;
    this.endAbsoluteRequirements = undefined;
    this.relativeRequirements = undefined;
    this.relativeGap = undefined;
}

// This function returns true if there are no requirements stored on
// this node. This is checked by checking that both the absolute and
// the relative gap is undefined (these are set to undefined when the
// last absolute/relative requirement is removed).

VirtualPartialOrderNode.prototype.isEmpty =
    virtualPartialOrderNodeIsEmpty;

function virtualPartialOrderNodeIsEmpty()
{
    return (this.absoluteGap === undefined && this.relativeGap === undefined);
}

// This function returns the number fo relative requirements stored on
// this node.

VirtualPartialOrderNode.prototype.getRelNum =
    virtualPartialOrderNodeGetRelNum;

function virtualPartialOrderNodeGetRelNum()
{
    if(this.relativeRequirements === undefined)
        return 0;

    return this.relativeRequirements.length;
}

// This function is called when an element is added at the distance
// 'distance' from the virtual node (e.g., if this is the virtual first
// node and 'distance' is 1, the new element was inserted as the first
// element in the tree). This function then goes over all relative
// requirements and checks which of them has an offset larger or equal
// this distance + the gap of the requirement - 1. For those requirements,
// the gap is reduced by 1. If the gap becomes 0, the requirement is
// removed from the list of requirements. The list of requirements
// removed from the list of requirements is returned by this function
// in an array.  This function also updates the minimial relative gap
// (for those requirements remaining on this virtual node).

VirtualPartialOrderNode.prototype.notifyAddRel =
    virtualPartialOrderNodeNotifyAddRel;

function virtualPartialOrderNodeNotifyAddRel(distance)
{
    if(this.relativeRequirements === undefined)
        return [];

    // loop over the relative requirements
    var i = 0;
    var l = this.relativeRequirements.length;
    var popped = [];
    
    while(i < l) {
        var requirement = this.relativeRequirements[i];
        if(requirement.requirement.offset < distance + requirement.gap - 1) {
            i++;
            continue;
        }
        // reduce the gap of the requirement
        if(--requirement.gap == 0) {
            // pop the requirement
            popped.push(requirement.requirement);
            // replace the requirement by the last requirement and make
            // the list shorter
            if(i < l - 1)
                this.relativeRequirements[i] = this.relativeRequirements[l-1];
            this.relativeRequirements.length--;
            l--;
        } else if(requirement.gap < this.relativeGap)
            this.relativeGap = requirement.gap;
    }

    if(this.relativeRequirements.length == 0) {
        this.relativeRequirements = undefined;
        this.relativeGap = undefined;
    }

    return popped;
}

// This function is called when an element is removed at the distance
// 'distance' from the virtual node (e.g., if this is the virtual first
// node and 'distance' is 1, the element removed was at the first node
// of the tree. This function then goes over all relative requirements
// and increases the gap for all those requirements which have an offset
// larger or equal this distance + the gap of the requirement - 1. For those
// requirements where there si equality here, the requirement is removed
// and destroyed (the anchor of the requirement was just removed). For
// the remaining requirements (where the offset is larger than
// distance + gap - 1) the gap is increased by 1. This function also
// updates the minimial relative gap.

VirtualPartialOrderNode.prototype.notifyRemoveRel =
    virtualPartialOrderNodeNotifyRemoveRel;

function virtualPartialOrderNodeNotifyRemoveRel(distance)
{
    if(this.relativeRequirements === undefined)
        return;

    // loop over the relative requirements
    var i = 0;
    var l = this.relativeRequirements.length;
    var minGap = Infinity;
    
    while(i < l) {
        var requirement = this.relativeRequirements[i];
        var fullDistance = distance + requirement.gap - 1;
        if(requirement.requirement.offset < fullDistance) {
            if(requirement.gap < minGap)
                minGap = requirement.gap;
            i++;
            continue;
        } else if(requirement.requirement.offset == fullDistance) {
            // the anchor of the requirement was removed, destroy the
            // requirement.
            this.tree.suspendRequirement(requirement.requirement);
            // replace the requirement by the last requirement and make
            // the list shorter
            if(i < l - 1)
                this.relativeRequirements[i] = this.relativeRequirements[l-1];
            this.relativeRequirements.length--;
            l--;
            continue;
        }
        // increase the gap of the requirement
        requirement.gap++;
        if(requirement.gap < minGap)
            minGap = requirement.gap;
    }
    
    if(this.relativeRequirements.length == 0) {
        this.relativeRequirements = undefined;
        this.relativeGap = undefined;
    } else
        this.relativeGap = minGap;
}

// This function is called when the element at distance 'distance' from
// this virtual node is replaced (e.g. if the last element in the set
// is replaced and this is the virtual last node, it will be called
// with 'distance' 1). This function removes all relative requirements
// registered on the virtual node which have their anchor at the replaced
// element. This is determined by comparing the offset of the requirement
// with the give 'distance' (distance of replaced element from end of set) +
// 'gap' of each requirement from the end of the set. The removed
// requirements are pushed onto the array 'removed' which is also returned
// by this function. The minimal relative gap on the virtual node is also
// updated.

VirtualPartialOrderNode.prototype.notifyReplaceRel =
    virtualPartialOrderNodeNotifyReplaceRel;

function virtualPartialOrderNodeNotifyReplaceRel(distance, removed)
{
    if(removed === undefined)
        removed = [];
    
    if(this.relativeRequirements === undefined)
        return removed;

    // loop over the relative requirements
    var i = 0;
    var l = this.relativeRequirements.length;
    var minGap = Infinity;
    
    while(i < l) {
        var requirement = this.relativeRequirements[i];
        var fullDistance = distance + requirement.gap - 1;
        if(requirement.requirement.offset == fullDistance) {
            // anchor of requirement was removed, remove the requirement.
            removed.push(requirement.requirement);
            // replace the requirement by the last requirement and make
            // the list shorter
            if(i < l - 1)
                this.relativeRequirements[i] = this.relativeRequirements[l-1];
            this.relativeRequirements.length--;
            l--;
            continue;
        }
        if(requirement.gap < minGap)
            minGap = requirement.gap;
        i++;
    }
    
    if(this.relativeRequirements.length == 0) {
        this.relativeRequirements = undefined;
        this.relativeGap = undefined;
    } else
        this.relativeGap = minGap;

    return removed;
}

// This function is called when an element is added to the set.
// This means that the gap of the absolute requirements is decreased
// by 1. If this dropped to zero, the absolute requirements at the top
// of the absolute requirement heap, which have a position equal to the
// size of the set - 1 (because the first position is 0) need to be popped.
// These requirements are popped and placed in an array which is returned
// to the calling function. If there is any requirement still left in the
// absolute requirement heap, the gap is set to the difference between
// the position of that requirement and the size of the set - 1.
// If there are no absolute requirements left in the heap, the gap is
// set to undefined.
// If a requirement popped off the heap is the beginning of a range requirement,
// this function fetches the requirement which is the end of the range
// and registers it to the virtual node (it is assumed that this requirement
// was not registered yet and that there is a difference of at least 1
// between the offset of the beginning and the end of the range).
// If, after popping the requirements which are now satisfied in the tree
// there are still some range end requirements on this virtual node,
// these requirements must be notified of the element which was added
// to the set (just in case it is inside the range covered by the
// range requirement - the begin requirement will not be notified of this
// addition). For this purpose, this function receives the argument
// 'insertElement', which is the element which was just inserted into
// the set, and 'insertPos' which is the offset at which the element
// was inserted (if this is the virtual first node, this is the offset
// in the backward ordering and if this is the virtual last node, this
// is the offset in the forward ordering). Using this offset, the end
// requirements can determine whether the element was inserted inside their
// range.
// This function returns an array containing the requirements popped off
// of the requirement heap. This array may be empty.

VirtualPartialOrderNode.prototype.notifyAddAbsolute =
    virtualPartialOrderNodeNotifyAddAbsolute;

function virtualPartialOrderNodeNotifyAddAbsolute(insertElement, insertPos)
{
    if(this.absoluteGap === undefined)
        return []; // no absolute requirements

    var popped = [];
    var poppedOffset;
    var requirement;

    if(--this.absoluteGap == 0) {
        while(requirement = this.absoluteRequirements.getMin()) {
            if(poppedOffset === undefined)
                poppedOffset = requirement.offset;
            else if(requirement.offset !== poppedOffset) {
                this.absoluteGap = requirement.offset - poppedOffset;
                break;
            }
            // requirement needs to be popped
            this.absoluteRequirements.popMin();
            popped.push(requirement);
            if(requirement.isBegin) {
                // this is the lower end of a range requirement. Insert the
                // other end of the requirement (on this virtual node).
                var endRequirement = requirement.getEnd();
                var gap = endRequirement.offset - requirement.offset;
                this.addAbsRequirement(endRequirement, gap);
                this.tree.registerAbsRequirement(endRequirement);
            } else if(requirement.isEnd) {
                // remove the requirement from the list of end-requirements.
                // The last requirement in the list takes its place.
                if(this.endAbsoluteRequirements.remove(requirement) == 0)
                    this.endAbsoluteRequirements = undefined;
            }
        }
        if(this.absoluteRequirements.isEmpty()) {
            this.absoluteRequirements = undefined;
            this.absoluteGap = undefined;
        }
    }

    if(this.endAbsoluteRequirements !== undefined) {
        // notify the remaining end requirements that an element was inserted
        // before them (this may be inside the range covered by the
        // requirement)
        var requirements = this.endAbsoluteRequirements.requirements;
        for(var i = 0, l = requirements.length ; i < l ; ++i)
            requirements[i].updateElement(undefined, insertElement,
                                          insertPos, true);
    }

    return popped;
}

// This function is called when an element is removed from the set.
// It is called before any absolute requirements are moved from the
// tree to the virtual node as a result of this removal. Therefore,
// this function is only used to update the absolute requirements which
// were stored on the virtual node before the removal of the element.
// For these requirements, the gap increases by 1, so this function
// increases the minimal absolute gap by 1. In addition, if there are
// any end requirements registered on this node, these requirements
// are notified of the removal of the element, as this element may be inside
// the range of the range requirement the end requirement belongs to
// (if the element is in this range, the begin requirement of the range
// will not receive the notification).
// 'removedElement' is the element which was just removed and
// 'removalPos' is the offset at which it was removed (if this is the
// virtual first node, this is the offset in the backward ordering and
// if this is the virtual last node, this is the offset in the forward
// ordering). Using this offset, the end requirements can determine
// whether the elemetn was inserted inside their range.

VirtualPartialOrderNode.prototype.notifyRemoveAbsolute =
    virtualPartialOrderNodeNotifyRemoveAbsolute;

function virtualPartialOrderNodeNotifyRemoveAbsolute(removedElement, removalPos)
{  
    if(this.absoluteGap === undefined)
        return; // no absolute requirements

    this.absoluteGap++;
    
    if(this.endAbsoluteRequirements !== undefined) {
        // notify the end requirements that an element was removed
        // before them (this may be inside the range covered by the
        // requirement)
        var requirements = this.endAbsoluteRequirements.requirements;
        for(var i = 0, l = requirements.length ; i < l ; ++i)
            requirements[i].updateElement(undefined, removedElement,
                                          removalPos, false);
    }
}

// This function adds the absolute requirement 'requirement' to this
// virtual node. It is pushed onto the heap of absolute requirements
// based on its 'offset' field. Its identification field is "id" (that is,
// two requirements with the same value under attribute "id" are consider the
// same requirement).
// 'gap' is the gap between the offset of the requirement and the last position
// in the set (which is the same as the number of elements in the set - 1).
// The gap is always >= 1. For example, if the offset of the requirement is 4
// and the set contains 4 elements, the last position in the set is 3 and
// therefore the gap is 1 (adding one element will produce an element at
// position 4 which satisfies the requiremet).
// This function also updates 'absoluteGap' if the given gap is smaller than
// the minimial gap of other absolute requirements sotred here.

VirtualPartialOrderNode.prototype.addAbsRequirement =
    virtualPartialOrderNodeAddAbsRequirement;

function virtualPartialOrderNodeAddAbsRequirement(requirement, gap)
{
    if(this.absoluteRequirements === undefined) {
        this.absoluteRequirements =
            new MinMaxPosHeap(function(a,b){ return a.offset - b.offset; },
                              "id");
        this.absoluteGap = gap;
    } else if(gap < this.absoluteGap)
        this.absoluteGap = gap;
    
    this.absoluteRequirements.add(requirement);

    if(requirement.isEnd) {
        // this requirement is the end of a range requirement, add the
        // requirement to the list of end-requirements.
        if(this.endAbsoluteRequirements === undefined)
            this.endAbsoluteRequirements = new RequirementList();
        this.endAbsoluteRequirements.add(requirement);
    } else if(requirement.isBegin) {
        // since we are pushing the first requirement in the range onto the
        // virtual node, there is no longer any need to store the end
        // requirement here.
        var endRequirement = requirement.getEnd();
        if(this.absoluteRequirements.inHeap(endRequirement.id)) {
            this.tree.unregisterAbsRequirement(endRequirement);
            this.endAbsoluteRequirements.remove(endRequirement);
            if(this.endAbsoluteRequirements.requirements.length == 0)
                this.endAbsoluteRequirements = undefined;
            this.absoluteRequirements.removeIndex(endRequirement.id);
            // (since the we just added the begin requirement of this range,
            // the list of absolute requirements cannot be empty).
        }
    }
}

// This function removes the given absolute requirement from this virtual
// node. This removes the requirement, as needed, from all relevant tables
// of the node and updates the absolute gap of this node.

VirtualPartialOrderNode.prototype.removeAbsRequirement =
    virtualPartialOrderNodeRemoveAbsRequirement;

function virtualPartialOrderNodeRemoveAbsRequirement(requirement, gap)
{
    if(this.absoluteRequirements === undefined)
        return; // nothing to remove

    if(requirement.isEnd) {
        // remove from end-requirement list
        this.endAbsoluteRequirements.remove(requirement);
        if(this.endAbsoluteRequirements.requirements.length == 0)
            this.endAbsoluteRequirements = undefined;
    }
    
    // remove the requirement from the heap
    this.absoluteRequirements.removeIndex(requirement.id);

    if(this.absoluteRequirements.getSize() == 0) {
        this.absoluteRequirements = undefined;
        this.absoluteGap = undefined;
        return;
    }
    
    if(this.absoluteGap == gap) {
        // this may have been the last requirement with this minimal gap,
        // so adjust the minimal gap (which increases by the difference
        // between the offset of the remaining minimal gap requirement and
        // the requirement just removed).
        var minRequirement = this.absoluteRequirements.getMin();
        if(minRequirement.offset != requirement.offset)
            this.absoluteGap += (minRequirement.offset - requirement.offset);
    }
}

// This function adds the relative requirement 'requirement' to this
// virtual node. 'gap' should be the distance between the position
// which satisfies this requirement (which is not in the ordered set)
// and the last position in the set. For example, if the anchor of
// the requirement is at position 4 in the set, the offset of the
// requirement is 2, and the set contains 6 elements (the last position
// being 5) the requirement is satisfied at position 6, which has a gap
// of 1 with the last position in the set (this is the gap which should
// be provided here).
// This function adds the requirement and gap to the list of
// relative requirements and updates the minimial relative gap, if needed.

VirtualPartialOrderNode.prototype.addRelRequirement =
    virtualPartialOrderNodeAddRelRequirement;

function virtualPartialOrderNodeAddRelRequirement(requirement, gap)
{
    if(this.relativeRequirements === undefined) {
        this.relativeRequirements = [];
        this.relativeGap = gap;
    } else if(gap < this.relativeGap)
        this.relativeGap = gap;

    this.relativeRequirements.push(requirement);
}

// This function removes the given relative requirement fro this virtual
// node. It removes it fro the list of relative requirements and updates
// the relative gap. The function assumes that this function is called
// only if the requirement is registered on the node.

VirtualPartialOrderNode.prototype.removeRelRequirement =
    virtualPartialOrderNodeRemoveRelRequirement;

function virtualPartialOrderNodeRemoveRelRequirement(requirement)
{
    if(this.relativeRequirements.length == 1) {
        // last relative requirement
        this.relativeRequirements = undefined;
        this.relativeGap = undefined;
        return;
    }

    var removedGap;
    
    for(var i = 0, l = this.relativeRequirements.length ; i < l ; ++i) {

        if(this.relativeRequirements[i].requirement.id != requirement.id)
            continue;

        removedGap = this.relativeRequirements[i].gap;
        
        if(i < l - 1)
            this.relativeRequirements[i] = this.relativeRequirements[l - 1];
        this.relativeRequirements.length--;
        break;
    }

    if(removedGap == this.relativeGap) {
        // loop over all remaining requirements to determine the new minimal gap
        this.relativeGap = Infinity;
        for(var i = 0, l = this.relativeRequirements.length ; i < l ; ++i) {
            var gap = this.relativeRequirements[i].gap;
            if(gap < this.relativeGap)
                this.relativeGap = gap;
        }
    }
}

// This function is called after all elements were removed from the tree
// (by a single clear operation). Since the elements are not removed
// one by one, the standard incrementl updates of the virtual node
// do not take place. Instead, this function is called. This function
// then performs the following operation:
// 1. Clears all relative requirements (since there are not elements in
//    the tree, all anchored requirements (and, in particular, the relative
//    requirements) must be suspended.
// 2. Clear all end absolute requirements (since the begin requirement
//    cannot be satisfied, the end requirement should not be registered).
// 3. Reset the absolute gap (based on the minimal offset of an absolute
//    requirement registered here).

VirtualPartialOrderNode.prototype.resetAfterClearElements =
    virtualPartialOrderNodeResetAfterClearElements;

function virtualPartialOrderNodeResetAfterClearElements()
{
    // remove relative requirements
    this.relativeRequirements = undefined;
    this.relativeGap = undefined;

    // remove end absolute requirements
    if(this.endAbsoluteRequirements !== undefined) {
        var endRequirements = this.endAbsoluteRequirements.requirements;
        for(var i = 0, l = endRequirements.length ; i < l ; ++i)
            this.absoluteRequirements.removeIndex(endRequirements[i].id);
        this.endAbsoluteRequirements = undefined;
    }

    // recalculate the absolute gap
    if(this.absoluteRequirements !== undefined)
        this.absoluteGap = this.absoluteRequirements.getMin().offset + 1;
}

//////////////////////
// Requirement List //
//////////////////////

// This is a small auxiliary object which stores an array of requirements
// under its 'requirements' field. This provides a quick way of looping
// over the whole list.
// In addition, to allow quick removal of the requirements, this object
// stores a table which maps the ID of the requirement to its position
// in the list.
// This object should be used when looping over the list of requirements
// is expected to be frequent while their removal is expected to be far
// less frequent.
//
// {
//     requirements: <array of requirements>,
//     posById: <Map>{
//         <requirement ID>: <position in 'requirements' array>
//         .....
//     }
// }
//
// requirements: an array of the requirements stored here. New requirements
//    are pushed at the end and when a requirement is removed, the last
//    requirement in the list is moves to the vacated position.
// posById: for each requirment ID, the position in the 'requirements'
//    array of the corresponding requirement.

// constructor

function RequirementList()
{
    this.requirements = [];
    this.posById = new Map();
}

// get the current size of the list

RequirementList.prototype.getSize = requirementListGetSize;

function requirementListGetSize()
{
    return this.requirements.length;
}

// add the given requirement to the list

RequirementList.prototype.add = requirementListAdd;

function requirementListAdd(requirement)
{
    if(this.posById.has(requirement.id))
        return false; // never add twice
    var pos = this.requirements.length;
    this.requirements.push(requirement);
    this.posById.set(requirement.id, pos);
    return true;
}

// remove the given requirement from the list. Returns the length of the
// list after this operation.

RequirementList.prototype.remove = requirementListRemove;

function requirementListRemove(requirement)
{
    var pos = this.posById.get(requirement.id);
    if(pos === undefined)
        return;
    
    this.posById.delete(requirement.id);
    var lastPos = this.requirements.length-1;
    
    if(pos != lastPos) {
        var last = this.requirements[pos] = this.requirements[lastPos];
        this.posById.set(last.id, pos);
    }

    return --this.requirements.length;
}

/////////////////////
// Debug Functions //
/////////////////////

function printOrderTree(tree)
{
    var str = "";
    
    for(var node = tree.first ; node ; node = node.next) {

        str += debugGetOrderTreeNodeStr(node);

        if(node.next !== undefined)
            str += ",";
    }

    return str;
}

function printOrderSubTree(node, indentStr)
{
    var nodeIndent = "            "
    if(indentStr === undefined)
        indentStr = "";

    if(node.left)
        printOrderSubTree(node.left, indentStr + nodeIndent);
    else if(node.right)
        console.log(indentStr + nodeIndent, ".");

    var shortTreeNodeStr = debugGetShortOrderTreeNodeStr(node);
    console.log(indentStr, shortTreeNodeStr);

    if(node.right)
        printOrderSubTree(node.right, indentStr + nodeIndent);
    else if(node.left)
        console.log(indentStr + nodeIndent, ".");
}

function debugGetOrderTreeNodeStr(node)
{
    var str;
    
    if(node.heap !== undefined) {
        str = "H[";
        for(var i = 1, l = node.heap.heap.length ; i < l ; ++i) {
            str += node.heap.heap[i];
            if(i < l - 1)
                str += ",";
        }
        str +="]";
    } else
        str = "" + node.element;

    return str;
}

function debugGetShortOrderTreeNodeStr(node)
{
    var str;
    
    if(node.heap !== undefined) {
        str = "H[";
        str += node.heap.getMin();
        if(node.heap.getSize() > 1) {
            str += "-" + node.heap.getMax();
        }

        str += "]";
    } else
        str = "" + node.element;

    return str;
}

// This function checks whether the tree is consistent with the current
// comparison function.

function debugCheckCompare(tree)
{
    if(tree.root === undefined)
        return true;

    for(var node = tree.first ; node.next ; node = node.next) {
        if(node.element !== undefined) {
            if(node.next.element !== undefined)  {
                if(tree.compare(node.element, node.next.element) >= 0) {
                    concole.log("tree not sorted by comparison function at",
                                debugGetShortOrderTreeNodeStr(node));
                    return false;
                }
            } else if(node.next.heap !== undefined) {
                var minInHeap = node.next.heap.getMin();
                if(tree.compare(node.element, minInHeap) >= 0) {
                    concole.log("tree not sorted by comparison function at",
                                debugGetShortOrderTreeNodeStr(node));
                    return false;
                }
            } else {
                console.log("next node has no element",
                            debugGetShortOrderTreeNodeStr(node));
                return false;
            }
        } else if(node.heap !== undefined) {
            var maxInHeap = node.heap.getMax();
            if(node.next.element !== undefined)  {
                if(tree.compare(maxInHeap, node.next.element) >= 0) {
                    concole.log("tree not sorted by comparison function at",
                                debugGetShortOrderTreeNodeStr(node));
                    return false;
                }
            } else if(node.next.heap !== undefined) {
                var minInHeap = node.next.heap.getMin();
                if(tree.compare(maxInHeap, minInHeap) >= 0) {
                    concole.log("tree not sorted by comparison function at",
                                debugGetShortOrderTreeNodeStr(node));
                    return false;
                }
            } else {
                console.log("next node has no element",
                            debugGetShortOrderTreeNodeStr(node));
                return false;
            }
        } else {
            console.log("next node has no element",
                        debugGetShortOrderTreeNodeStr(node));
            return false;
        }
    }

    return true;
}
