// Copyright 2019 Yoav Seginer.
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


// This file implements the requirement nodes for ordering queries.
// Such queries are defined on an ordered set and may request the
// set of elements in the ordered set which are at a specific position
// or range of positions in this ordered set. These positions may be
// absolute (relative to the whole set) or relative to an element
// in the set (the element at a given offset in the ordering from
// another element). One can also request to be notified of the position
// of a given element in the set. Questions may be answered about
// the ordering in either the forward or backward direction.
//
// To answer these queries, the elements in the ordered set are loaded
// into the PartialOrderTree (see partialOrder.js). The ordering
// queries which need to be answered by this PartialOrderTree are then
// registered as 'requirements' to the tree. These nodes are implemented
// in this file.
//
// A requirement node specifies the question which needs to be answered.
// This includes such properties as the offset(s) in the ordering begin
// queried, whether this is in the ordering or in the inverse (backward)
// ordering, and (in case of a relative offset) the element relative to
// which the offset should be calculated.
//
// In addition, the requirements provide an interface for receiving
// updates from the partial order tree. The requirement nodes receive
// these updates from the order tree as elements are added or removed from the
// ordered set or when the requirement is registered to the order tree.
// A requirement node may receive multiple such updates before having
// to notify its listeners of the change. The requirement node is then
// responsible for the aggregation of all change notifications it receive
// so that it only notifies its listeners of the total change which
// took place.
//
// Requirement Types
// =================
//
// Currently, there are several requirement types.
//
// Absolute Requirements
// ---------------------
//
// Absolute requirements are requirements which specify an offset or a range
// of offsets relative to the whole ordered set. These offsets are relative
// to the ordering of the set or the inverse ordering. A zero offset in the
// forward ordering refers to the first element in the set and a zero offset
// in the backward ordering refers to the last element in the set. There
// are several different absolute requirements:
//
// Simple: such a requirement specifies a single offset. It need to notify
//     its listener of the element which is at the given offset in the ordered
//     set.
// Range: such a requirement specifies two offsets relative to the same
//     direction of the ordering (forward or backward). These are the
//     begin and end offsets. The begin offset must be smaller or equal
//     to the end offset. The requirement must notify its listener(s) of all
//     elements in the set which are in the given offset range, including the
//     begin and end offsets. It may be that only part of the offset
//     range is inside the set (e.g. in a set of 8 elements, the offset
//     range [4,10] covers the 5th to 8th elements in the set, which are
//     at offset [4,7]).
//     A range requirement can specify whether it is intersted in the
//     ordering of the elements inside the range. If it is, it will receive
//     ordered notifications of the elements in the set (that is, arrays
//     of element which are ordered) and will also receive notifications
//     for elements whose position changed (even if they were inside the
//     range both before and after the modification). If the range
//     requirement does not request to be notified of the ordering inside
//     the range, it only receives notifications for the elements which
//     were added or removed from the range, without any information of
//     their internal ordering.
//     The end points of the range may each be opened or closed. When
//     an end point is open, the range does not include the element
//     at the offset of that end point.
// Complement: a complement requirement also defines a range of offsets,
//     but it is defined by one forward offset and one backward offset.
//     All elements between the element matched by the forward offset
//     and the element matched by the backward offsets are part of the
//     the complement range. It does not matter whether the element matched
//     by the forward offset is before or after the element matched by the
//     backward offset.
//     If the forward offset points beyond the end of the set, the range
//     specified by the complement requirement consists of all elements
//     from the element matched by the backward offset to the end of the
//     set (in forward order). Similarly, if the backward offset points
//     before the beginning of the set, the range contains all elements
//     from the beginning of the set to the element matched by the forward
//     offset. Finally, if both the forward and the backward offsets point
//     outside the set, the full set is matched by the range.
//     A complement requirement may have its lower and upper end defined
//     as closed or open. If the lower end is open, the range does not
//     include the smallest element in the range between the forward and
//     the backward offset, regardless of whether this defined by the
//     forward or backward requirement. Similarly, if the upper end is open,
//     the range does not include the largest element in the range between
//     the forward and the backward offset, regardless of which of the two
//     offsets defines it.
//     Just like a range requirement, a complement requirement can specify
//     whether it is intersted in the ordering of the elements matched it
//     or not.
//
// Anchored Requirements
// ----------------------
//
// An anchored requirement is a requirement which is defined relative to
// a given element (identified by its ID). This is referred to as the
// anchor element of the requirement. An anchored requirement may be
// added even before the anchor element is added to the tree (as long
// as the anchor element is not in the tree, the requirement matches
// nothing).
// 
// There are several types of anchored requirements:
//
// element: this requirement must track the position of the anchor element
//     in the ordering (forward or backward). As long as the anchor element
//     is not in the set, this is undefined.
//     A forward element requirement is notified not only of the position
//     of its anchor but also of all elements added and removed before it
//     (in the forward ordering). This allows such a requirement to implement
//     the prev*/prev+ function which tracks all elements before a given
//     element.
//     Similarly, a backward element requirement is notified not only of
//     the position of its anchor but also of all elements added and removed
//     after it (before it in the backward ordering). This allows such
//     a requirement to implement the next*/next+ function which tracks
//     all elements before a given element. 
// relative: this requirement tracks the element at a given offset relative
//     to the anchored element. This offset may be specified relative
//     to the forward or backward ordering. An offset of 0 refers to
//     the anchor element itself (this should probably never be used)
//     while an offset of 1 refers to the next element (if a forward offset
//     is used) or previous element (if a backward offset is used).
//
// Interface to Listeners
// ======================
//
// Listeners are registered to each requirement node to receive notifications
// when the properties the requirement nodes track change. The listeners
// are notified of the changes using the following callback functions which
// need to be implemented by the listeners (each listener need only
// implement those functions which are relevant to the requirements it
// is listening to):
//
// position callbacks:
//
// <listener>.updateOffset(<element>, <offset>):
//     This function needs to be implemented for listeners listening to
//     element requirements. <element> is the anchor element (just in case
//     the listener is listening to multiple requirements) and <offset>
//     is the offset of the anchor element in the ordered set. It is either
//     an integer describing an offset within the ordered set or undefined
//     (if the anchor is not inside the orderd set).
//
// element callbacks:
//
// <listener>.addMatches(<array of elements>)
// <listener>.removeMatches(<array of elements>)
//    These two callback functions are similar to the standard FuncResult
//    interface: they notify the listener of the elements which
//    were added or removed from the set which satisfies the ordering
//    requirement (e.g. the elements in a given offset range).
//    The elements are those which are stored in the order tree.
//    If only element IDs are stored in the tree, then these are the IDs,
//    otherwise, these are objects and the IDs of the elements are
//    stored under an attribute agreed upon during construction
//    (see the constructor of PartialOrderTree).
//
// <listener>.updatePos(<array of elements>, <first offset>,
//                      <last offset>, <set size>)
//    This is similar (but not identical) to a key update in the standard
//    FuncResult interface. For a consecutive segment of elements which
//    are inside the set matched by the requirement, this function provides
//    the elements (in their order inside the set) and the first and last
//    absolute offsets of the elements in this sequence. These offsets are
//    always forward offsets. In addition, the total set size is also
//    provided. This provides information about:
//    1. elements which were removed from the range because the set
//       became smaller than the offset(s) of the range and therefore
//       some elements were removed from the range, but were not replaced
//       by other elements and therefore those offsets do not appear in
//       <array of elements>.
//    2. If the order function is based on backward offset(s) this allows
//       translating the update provided here (in terms of forward offsets)
//       into the backward offsets.
//    If only the set size changed and no element positions changed
//    (or if the range is empty) <element IDs>, <first offset> and
//    <last offset> will be undefined.
//
//    Since a full segment of elements is provided in this notification,
//    it may contain some elements whose offset did not change (therefore,
//    the update is not strictly incremental). However, this seems to provide
//    for simpler processing and interface than providing  notification
//    for only those elements whose position changed.
//    
//    A listener may or may not request to receive 'updatePos()' notifications
//    (if the listener is only interested in the elements in the set but not
//    in their order, addMatches() and removeMatches() should be sufficient).
//    If the listener does request to receive the 'updatePos()' updates,
//    this update will be called after the 'addMatches()' and
//    'removeMatches()' updates were called (this is similar to the order
//    in which add/remove matches and key updates are received).
//
// Incremental Modification of Requirements
// ========================================
//
// When a requirement changes (e.g. the offsets defining a range requirement
// change) this can sometimes be handled by modifying the existing requirement
// object (which may then perform the operation incrementally). For some
// requirements, such as a simple absolute requirement, there is no advantage
// in modifying an existing requirement and it is simpler to replace the
// existing requirement node with a new requirement node for the new offset
// or anchor.
//
// Currently, incremental modification of a requirement is supported
// for the following requirements:
// 1. Range requirements: it is possible to change the offsets, direction
//    (forward or backward) and whether the requirement should trace the
//    order of the elements in the range.
//
// Order Requirement Objects
// =========================
//
// There are several different classes of requirement nodes defined, to
// implement the various requirements described above. Some complex
// requirements may use multiple requirement nodes to implement
// the complex requirement (e.g. a range requirement consists of two
// simple absolute requirements together with a node which manages
// the combined functionality).
//
// The structure of each requirement object is described below, in the section
// where it is implemented. Here we first describe the interface
// of these requirement nodes to the order tree.
//
// Interface to Order Tree
// -----------------------
//
// On (almost) all requirements:
//
// <requirement>.id: this is an ID which must be unique. It is used to identify
//     the requirement wherever it is stored. This ID is allocated in the
//     base Requirement class.
// <requirement>.isBackward: this flag appears on almost all requirement
//     nodes. It indicates whether the specified requirement is relative to
//     the forward ordering on the ordered set (if 'isBackward' is false)
//     or relative to the backward (reverse) ordering on the set (in
//     'isBackward' is true).
//     Currently, the only requirement node which does not carry this
//     property is the top requirement node of a complement requirement
//     (since a complement requirement consists of both a forward and
//     a backward absolute requirement).
// <requirement>.offset: this property appears on all requirement nodes
//     which specify are specified by an offset (whether absolute or
//     relative). This does not appear on an element requirement or on
//     the top requirement node of a complement requirement.
// <requirement>.clearAllElements(): this function is called when the
//     order tree is cleared and therefore no requirement may be satisfied
//     anymore. When this function is called, each requirement must update
//     itself so that its incremental update represents the clearing
//     of the tree correctly. Elements may be added to the tree directly
//     after this operation.
//     For anchor requirements, this function is equivalent to 'suspend()'
// <requirement>.notifyListeners(): this function is called by the ordered tree
//     at the end of an update cycle. It indicates to the requirement that
//     if it has any changes to report to its listeners, it may notify them
//     of the changes now. In compound requirements, it is up to the
//     sub-requirements in the compound requirement to determine which
//     requirements is responsible for notifying the listeners. The order tree
//     will call this function on each requirement which is registered to it.
//     For example, in a range requirement, this function is called on both
//     the begin and end requirements, if both are registered. Since only the
//     begin requirement is guaranteed to be registered, it is the begin
//     requirement which is responsible for notifying the range requirement
//     that the listeners can be updated.
//     
//
// On Simple Absolute Requirements:
//
// (this includes all simple absolute requirement nodes, including those
//  defining the end points of a range requirement or a complement requirement):
//
// <requirement>.updateElement(<to element>, <element>, <pos>,
//                             <was added>):
//     This function is called to update the simple absolute requirement
//     when the element it matches changes as a result of adding or
//     removing an element from the ordered set. <to element> is the
//     new element matched by the requirement (this may be undefined if
//     no element is matched by the requirement after the change).
//     <element> is the element whose addition or removal caused the change
//     and <pos> is the offset at which it was added or removed (this is
//     a forward offset if this is a forward requirement and a backward
//     offset if this is a backward requirement). This offset must
//     always be smaller or equal to the offset of the requirement.
//     If the insertion/removal took place in a heap node, this position
//     is the position of the first element in the heap (if this is
//     a forward requirement) or of the last element, in backward ordering
//     (if this is a backward requirement).
//     <was added> is a flag which indicates whether the operation was
//     an addition or removal operation.
//     If <element> is undefined, <pos> and <was added>
//     should also be undefined and this update is the initial update
//     received when adding the requirement to the tree (therefore there
//     is no <element> whose addition or removal caused the update).
// <requirement>.replacedElement(<new element>,
//                               <moved right>, <first moved right>,
//                               <moved left>, <first moved left>):
//     This function is called when the element stored on the node on
//     which this requirement is registered is replaced by another element,
//     as a result of re-ordering the elements. 
//     This function notifies the requirement of the new element
//     now satisfying the requirement. In addition, it notifies it
//     of elements which were moved across this requirement: either
//     their forward offset increasing or decreasing across the offset
//     of the requirement. These elements are given in two arrays:
//     <moved left> and <moved right>. Beginning at position
//     <first moved right>, the array <moved right> lists all elements
//     which had a forward offset smaller or equal to the offset of
//     the requirement and whose offset changed to larger or equal the
//     offset of the requirement.
//     Similarly, beginning at position <first moved left>, the array
//     <moved left> contains all elements whose forward offset decreased
//     from larger or equal to the requirement's offset to smaller or equal
//     the requirement's offset.
//     Note: the move right/left list always refers to the forward ordering.
//
// On Range requirements:
//
// Range requirements consist of a top range requirement node and two
// simple absolute requirement nodes, where one is the 'begin' node and
// the other is the 'end' node. The offset of the 'begin' node must be <=
// the offset of the end node. It is only the begin and end nodes which
// interface with the order tree, the top range requirement node only
// manages the updates received from these two node.
//
// Common to begin and end requirement nodes:
//
// <requirement>.isOrderedRange: this property is set to true if the
//     range requirement is required to track the order of the elements
//     inside the range (in this case, the requirement needs to provide
//     the listener not only with addMatches() and removeMatches() updates
//     but also with updatePos() notifications).
//     For the tree, this implies that all elements inside the range need
//     to be stored on element nodes (and not on a heap).
//
// The begin requirement node has the following interface to the order tree:
//
// <requirement>.isBegin: this property must be true to identify this
//     requirement node as the beginning of the range (it is undefined
//     on all other requirement nodes).
// <requirement>.getEnd(): this function returns the end requirement
//     which defines the end of the range whose beginning is defined
//     by the begin requirement node.
//
// The end requirement node has the following interface to the order tree:
//
// <requirement>.isEnd: this property must be true to identify this
//     requirement node as the end of the range (it is undefined
//     on all other requirement nodes).
// <requirement>.getBegin(): this function returns the begin requirement
//     which defines the beginning of the range whose end is defined
//     by the end requirement node.
// <requirement>.addRangeElements(<array of elements>): this is called on
//     the 'end' requirement of a range requirement to add all
//     elements in the range. <elements> is an array of elements (if these
//     are objects, the ID of each element is to be found under
//     the 'unique value attribute' which was set during the construction
//     of the tree and otherwise the element is its own ID) which is ordered
//     if <requirement>.isOrderedRange (see above) is set on the requirement.
//     The order in the array is always in the forward direction of the
//     ordering.
//     This function is called only once, when the end requirement is
//     added to the tree. Afterwards, the set is incrementally updated
//     through the updateElement() function.
//
// Complement Requirements:
//
// <requirement>.isOrderedRange: this property is set to true if the
//     range requirement is required to track the order of the elements
//     inside the range (in this case, the requirement needs to provide
//     the listener not only with addMatches() and removeMatches() updates
//     but also with updatePos() notifications).
//     As opposed to range requirements, this property needs to be set
//     on the top node of the complement requirement and not on the
//     absolute forward and backward requirement nodes which define its
//     end points. This is because in the case of complement nodes,
//     the request to track the order inside the complement requirement range
//     forces the tree to store all elements in the tree in separate
//     element nodes (and not on a heap). This is under the assumption
//     that a complement requirement typically covers almost the full set.
//
// <requirement>.addRangeElements(<array of elements>): this is called on
//     the top node of a complement requirement to add the elements in
//     the range. <elements> is an array of elements (if these are
//     objects, the ID of each element is to be found under the
//     'unique value attribute' which was set during the construction
//     of the tree and otherwise the element is its own ID) which is
//     ordered if <requirement>.isOrderedRange (see above) is set on
//     the requirement. The order in the array is in the forward
//     ordering of the set (that is, in increasing order).  This
//     function is called only once, when the complement requirement
//     is added to the tree. Afterwards, the set is incrementally
//     updated through the updateElement() function.
// <requirement>.updateAddElement(<element>, <forward offset>)
// <requirement>.updateRemoveElement(<element>, <forward offset>):
//     These two function are called on a complement requirement for each
//     element added or removed. The forward offset of the element added
//     or removed is provided so that the requirement can determine
//     whether the element falls inside the range covered by the requirement.
//
// Anchored Requirements:
//
// <requirement>.anchor: this is an object which represents the element which
//    is the anchor of the requirement. There is no need for
//    <requirement>.anchor to be the exact same object as the element object
//    stored in the tree, but it has to be an object such that the comparison
//    function defined for the ordering can compare it with other element
//    objects and this comparison will provide the same results as for
//    the element stored in the tree which is the anchor of the requirement
//    and it must also be identifiable as the same element by its unique
//    value property. This is an attribute of the element object which holds
//    a unique ID for the element. This attribute is defined by the 
//    'uniqueValueAttr' property defined when constructing the
//    PartialOrderTree for these requirements (typically this is an attribute
//    such as "id" which uniquely identifies the element).
// <requirement>.suspend(): this function is called on an anchored requirement
//    when it is suspended, that is, when its anchor element is not found
//    in the ordered set.
//
// Relative Requirements:
//
// <requirement>.updateElement(<to element>):
//     This function is called to update the relative requirement
//     when the element it matches changes as a result of adding or
//     removing an element from the ordered set. <to element> is the
//     new element matched by the requirement (this may be undefined if
//     no element is matched by the requirement after the change).    
//
// Element Requirements:
//
// <requirement>.isEnd: if this property is true, the element requirement
//     also serves as a range requirement whose range ends at the anchor
//     element (not including the anchor element) and extends to first
//     or last element in the ordered set. The 'isBackward' flag (see below)
//     determines whether the range stretches to the first or last element
//     in the ordered set.
// <requirement>.isBackward: in case of an element requirement this has
//     two meanings. First, this determines whether the offset returned by
//     this requirement needs to be a forward or backward offset. In addition,
//     in case 'isEnd' is true, this also determines which range of elements
//     is covered by this requirement. The anchor element is considered
//     the last element in the range, so if the 'isBackward' flag is false,
//     the range consists of all elements before the anchor requirement
//     in the forward ordering an if 'isBackward' is true, the range consists
//     of all elements after (in the forward ordering) the anchor requirement.
// <requirement>.isOrderedRange: if 'isEnd' is set and this requirement
//     is a range requirement, 'isOrderedRange' indicates whether the
//     requirement is intersted in the ordering of the elements in the
//     range (similarly to this property in absolute range and complement
//     requirements). In this case, the tree is forced to store all elements
//     in the range in element nodes (and not in heaps).
// <requirement>.setOffset(<offset>): this function sets the offset of the
//     anchor element. This offset is a forward offset if 'isBackward' is
//     false and is a backward offset if 'isBackward' is true. This is only
//     called when the requirement is registered to the anchor element or
//     removed from it (in which case <offset> is undefined). Afterwards,
//     the offset is updated based on calls to 'updateAddElement()'
//     and 'updateRemoveElement()' (see below).
// <requirement>.addRangeElements(<array of elements>): when the 'isEnd'
//     property is set (in which case this requirement also specifies
//     a requirement for updates on the range between the anchor element
//     and one of the ends of the ordered set) this function is called
//     on the requirement when it is added to the tree (that is, either when
//     it is added and the anchor element is already in the tree or when the
//     anchor element is added to the tree and this requirement was previously
//     suspended). <elements> is the list of all elements in the range
//     the range (this does not include the anchor element itself).
//     <elements> is an array of elements (if these are objects,
//     the ID of each element is to be found under the 'unique value attribute'
//     which was set during the construction of the tree and otherwise
//     the element is its own ID) which is ordered if
//     <requirement>.isOrderedRange (see above) is set on the requirement.
//     The order in the array is always in forward direction of the ordering
//     (increasing order).
//     When <requirement>.isOrderedRange is false, the array <elements> is
//     semi-ordered: the elements which are stored in different nodes
//     are sorted, but elements stored inside a heap node appear in the
//     order in which the appear in the heap. This means that if we force
//     certain element to be stored in an element node (e.g. forcing the
//     element immediately before/after the anchor node to be stored separately
//     by registering an appropriate relative requirement) then we can
//     be sure that they appear in the appropriate position in the array.
//     After the intial call to this function, the range is updated by calls
//     to updateAddElement() and updateRemoveElement() (see below).
// <requirement>.updateAddElement(<element>)
// <requirement>.updateRemoveElement(<element>):
//     These two functions need to be called on any element requirement. For a
//     forward requirement these functions are called with elements
//     added or removed before the anchor element (in the forward ordering)
//     and for a backward requirement these functions are called with elements
//     added or removed after (in forward ordering) the anchor element.
//     When the requirement needs to track the range of elements defined by
//     the anchor, these are exactly the elements added or removed from
//     the range specified by the requirement. When the requirement only needs
//     to track the offset of the anchor element, every element added
//     here increases the offset by 1 and every element removed decreases
//     it by 1.
//
// On begin requirement, complement requirement and element requirement:
//
// <requirement>.getForwardRange(): returns the forward offsets which define
//    the current range of the requirement. For backward requirements,
//    the backward offsets are translated into a forward offset based
//    on the current set size. Similarly, for an element requirement,
//    the current forward offset of the anchor requirment is used
//    to define the range The range is returned as an array:
//    [<low offset>, <high offset>].
// <requirement>.updateReorderedRange(<low offset>, <high offset>):
//    This function is called when the set is reordered and the offset of
//    some elements in the range covered by this requirement changed.
//    The call to this function indicates to the requirement that
//    elements in the given range (which is always given in terms
//    of forward offsets) may have changed their ordering.
//    This function may be called multiple times on the same requirement
//    for a single reordering operation. After all calls were made, the
//    requirement knows that any elements outside the ranges it was called
//    with remained in place (the requirement may then use this information
//    to determine which range of elements has to be read from the tree
//    to report to the listeners).


// %%include%%: <scripts/utils/intervalUtils.js>

///////////////////////
// Requirement Nodes //
///////////////////////

////////////////////////////
// Requirement Base Class //
////////////////////////////

// The requirement base class is included in all requirement objects.
// Currently, it only provides basic functionality, such as the allocation
// of the requirement ID (which should be unique to each requirement).

// Object structure:
//
// {
//    id: <number>,
//    listeners: [<array of listener objects>]
// }
//
// id: this is a unique identifier of this requirement node (compound
//     requirements may consist of several requirement nodes with different
//     IDs).
// listeners: this is an array of listeners registered to this requirement
//     (this list is allowed to be temporarily empty). The listeners are stored
//     in an array under the assumption that the number of listeners is
//     relatively small and that adding and removing listeners is less
//     common than notifying listeners.

function OrderRequirement()
{
    this.id = ++OrderRequirement.nextRequirementId;
    this.listeners = [];
}

OrderRequirement.nextRequirementId = 1025; 

// This function adds the given listener object (which must support
// the interface defined in the introduction) to the list of listeners
// of this requirements. If the listener is already in the list, it is
// not added again.

OrderRequirement.prototype.addListener = orderRequirementAddListener;

function orderRequirementAddListener(listener)
{
    for(var i = 0, l = this.listeners.length ; i < l ; ++i) {
        if(listener == this.listeners[i])
            return; // already registered
    }
    this.listeners.push(listener);
}

// This function removes the given listener object from the list of listeners
// of this requirements (if it is in the list of listeners).

OrderRequirement.prototype.removeListener = orderRequirementRemoveListener;

function orderRequirementRemoveListener(listener)
{
    for(var i = 0, l = this.listeners.length ; i < l ; ++i) {
        if(listener == this.listeners[i]) {
            // found, remove from list
            if(i < l - 1)
                this.listeners[i] = this.listeners[l-1];
            this.listeners.length--;
            return;
        }
    }
}

/////////////////////////////////
// Atomic Absolute Requirement //
/////////////////////////////////

// The atomic aboslute requirement node is used both for simple
// absolute requirement (forward or backward) which track the single
// element at a given position or as the base class of a begin
// or end requirement of a range requirement.
//
// An atomic absolute requirement node is constructed for a fixed
// offset and direction.
//
// Object structure:
//
// {
//     offset: <integer>,
//     isBackward: true|false,
//     prevElement: <element>
//     element: <element>
// }
//
// offset: the absolute offset of this requirement (an integer >= 0)
// isBackward: whether the offset is specified relative to the forward
//     or backward (reverse) ordering.
// prevElement: the previous element matched by this requirement.
//     when the previous element differs from the current element, the
//     requirement must notify the listeners.
// element: the element currently matched by the requirement.

inherit(AtomicAbsOrderRequirement, OrderRequirement);

// An atomic absolute requirement is constructed for a given offset
// (an integer >= 0) and a direction (isBackward = true|false) indicating
// whether the offset is a forward or backward offset.

function AtomicAbsOrderRequirement(offset, isBackward)
{
    this.OrderRequirement();

    this.offset = offset;
    this.isBackward = isBackward;
    this.prevElement = undefined;
    this.element = undefined;
}

// This function is called by the order tree to indicate that 'toElement'
// is now the element which is matched by the atomic requirement. 'byElement'
// is the element whose addition or removal cause the change in the
// matched element (and 'pos' is the position, in the direction of the
// requirement, at which 'byElement' was added or removed). 'byElement'
// may be undefined only if this function is called immediately after
// adding the requirement to the tree (this is then the initial update).
// 'wasAdded' indicates whether the change is the result of adding or removing
// an element (this is undefined if 'byElement' is undefined).
// 'toElement' may be undefined if there is no match after the change.
//
// This is the base implementation of the class, which only handles the
// update of the element matched by the atomic requirement (and not the
// range, if this is part of a range requirement).

AtomicAbsOrderRequirement.prototype.updateElement =
    atomicAbsOrderRequirementUpdateElement;

function atomicAbsOrderRequirementUpdateElement(toElement, byElement, pos,
                                                wasAdded)
{
    this.element = toElement;
}

// For an atomic requirement which is not part of a range or complement
// requirement, the call to this function is identical to a call to
// 'updateElement()'. Derived classes which are part of a range requirement
// need to overide this simpe behavior.

AtomicAbsOrderRequirement.prototype.replacedElement =
    atomicAbsOrderRequirementReplacedElement;

function atomicAbsOrderRequirementReplacedElement(newElement, movedRight,
                                                  firstMovedRight, movedLeft,
                                                  firstMovedLeft)
{
    this.element = newElement;
}

// This function is called when all elements are about to be removed
// from the order tree. The element which satisfies this requirement
// is therefore about to become undefined.  The previous element
// satisfying the requirement remains unchanged.

AtomicAbsOrderRequirement.prototype.clearAllElements =
    atomicAbsOrderRequirementClearAllElements;

function atomicAbsOrderRequirementClearAllElements()
{
    this.element = undefined;
}

// This function notifies the listeners registered to this requirement object
// of changes to the element satisfying this requirement. This is an
// implemention for the base class and should be overridden by derived
// classes which require different behavior (for example, when the
// atomic requirement is part of a range requirement).

AtomicAbsOrderRequirement.prototype.notifyListeners =
    atomicAbsOrderRequirementNotifyListeners;

function atomicAbsOrderRequirementNotifyListeners()
{
    if(this.prevElement === this.element)
        return; // nothing changed

    var removed;
    if(this.prevElement !== undefined)
        removed = [this.prevElement];
    var added;
    if(this.element !== undefined)
        added = [this.element];
    
    for(var i = 0, l = this.listeners.length ; i < l ; ++i) {
        var listener = this.listeners[i];
        if(removed !== undefined)
            listener.removeMatches(removed);
        if(added !== undefined)
            listener.addMatches(added);
    }

    this.prevElement = this.element;
}

//////////////////////////////////////
// Range Begin Absolute Requirement //
//////////////////////////////////////

// This is an atomic absolute requirement node which defines the beginning
// of an absolute range requirement. It is derived from the atomic absolute
// requirement base class.

inherit(BeginAbsOrderRequirement, AtomicAbsOrderRequirement);

// A range begin absolute requirement is constructed for a given offset
// (an integer >= 0) and a parent (the range requirement node) which also
// provides it with access to the end requirement. Some properties of the
// begin requiremnt (such as the order direction and whether the order
// of the elements inside the range needs to be tracked) are copied form
// the parent range requirement.

function BeginAbsOrderRequirement(offset, rangeRequirement)
{
    this.AtomicAbsOrderRequirement(offset, rangeRequirement.isBackward);
    this.isOrderedRange = rangeRequirement.isOrderedRange;
    this.rangeRequirement = rangeRequirement;
    this.isBegin = true;
}

// this function returns the end requirement of the range requirement
// this begin requirement belongs to.

BeginAbsOrderRequirement.prototype.getEnd =
    beginAbsOrderRequirementGetEnd;

function beginAbsOrderRequirementGetEnd()
{
    return this.rangeRequirement.endRequirement;
}

// This function overrides the function defined in the base class.
// This is because the change in the element matched by this requirement
// also has additional implications for the elements matched by the
// range. Since the end requirement of the range will also receive
// an update, we here only handle that part of the update which is not
// handled by the end requirement. If 'byElement' was added ('wasAdded' is
// true) 'toElement' is added to the range and if 'byElement' was removed
// ('wasAdded' is false) teh previous element at this requirement is
// removed from the range.
// If 'byElement' is undefined, this is the initial notification and
// 'toElement' is set on this node but no notification is sent
// to the range requirement, since it is about to receive a
// full range update.
// Note that 'toElement' may be undefined (for example, if the reuqirement
// offset is still outside the set).

BeginAbsOrderRequirement.prototype.updateElement =
    beginAbsOrderRequirementUpdateElement;

function beginAbsOrderRequirementUpdateElement(toElement, byElement, pos,
                                               wasAdded)
{
    if(byElement !== undefined) {
        if(wasAdded === true) {
            if(toElement !== undefined)
                this.rangeRequirement.addElement(toElement, this.offset);
        } else {
            if(this.element !== undefined)
                this.rangeRequirement.removeElement(this.element, this.offset);
        }
    }
    
    this.element = toElement;
}

// This function is used to process updates received during re-ordering of
// the order tree. For full specifications of the arguments it takes,
// see the beginning of the file. The lists of moved elements are always
// relative to the forward direction. We here need to distinguish between the
// case that the requirement is a forward and a backward requirement.
//
// When the requirement is a forward requirement, we add all elements
// which were move right and remove those elements which were moved left.
// While some of the elements moved right may end up beyond the other end of
// the range and some of the elements moved left may have originated from
// beyond the other end of the range, such elements will also be
// moved across the end requirement of the range, so any superfulous
// addition/removal performed here may be cancelled later.
//
// The same logic also holds for backward requirements except for two
// differences:
// 1. In a backward requirement, elements moved to the right must be removed
//    and those moved to the left must be added.
// 2. Elements which were moved from/to beyond the other end of the range
//    were already added/remove by the end requirement (since it is
//    updated first).

BeginAbsOrderRequirement.prototype.replacedElement =
    beginAbsOrderRequirementReplacedElement;

function beginAbsOrderRequirementReplacedElement(newElement, movedRight,
                                                 firstMovedRight, movedLeft,
                                                 firstMovedLeft)
{
    if(!this.isBackward) {
        this.rangeRequirement.addElements(movedRight, firstMovedRight,
                                          this.element);
        this.rangeRequirement.removeElements(movedLeft, firstMovedLeft,
                                             newElement);
    } else {
        this.rangeRequirement.addElements(movedLeft, firstMovedLeft,
                                          this.element);
        this.rangeRequirement.removeElements(movedRight, firstMovedRight,
                                             newElement);
    }
    
    this.element = newElement;
}

// This function is called when all elements are about to be removed from
// the order tree.
// The element which satisfies this requirement is therefore about to
// becomes undefined.  The previous element satisfying the requirement
// remains unchanged.  Moreover, the parent requirement node is
// notified of this operation.

BeginAbsOrderRequirement.prototype.clearAllElements =
    beginAbsOrderRequirementClearAllElements;

function beginAbsOrderRequirementClearAllElements()
{
    // update the element satisfied by this requirement
    this.AtomicAbsOrderRequirement_clearAllElements();
    // notify the parent
    this.rangeRequirement.clearAllElements();
}

// This function returns an array [<low forward offset>,<high forward offset>]
// describing the forward offset range of the range requirement whose
// begin requirement this is. If this is a forward requirement, this simply
// returns the offsets of the begin and end requiremnts. If this is
// a backward requirement, the function must convert the offsets into
// forward offsets (using the size of the ordered set).

BeginAbsOrderRequirement.prototype.getForwardRange =
    beginAbsOrderRequirementGetForwardRange;

function beginAbsOrderRequirementGetForwardRange()
{
    if(!this.isBackward)
        return [this.offset, this.getEnd().offset]; 

    // backward requirement, need to invert the offsets
    
    var lowOffset =
        this.rangeRequirement.orderedTree.invertOffset(this.getEnd().offset);
    var highOffset =
        this.rangeRequirement.orderedTree.invertOffset(this.offset);

    return [lowOffset, highOffset];
}

// This function is called after the ordered set was reordered if this
// requirement has the 'isOrderedRange' set to true (which means that
// it tracks the order of the elements inside the range). This call indicates
// to this requirement that the ordering of elements inside the forward
// offset range [lowOffset, highOffset] may have changed. This function
// uses this information to update the parent SegmentOrderRequirement
// object.
// This function may be called several times on the same requirement after
// the set is reordered. It is not called on the end requirement object.

BeginAbsOrderRequirement.prototype.updateReorderedRange =
    beginAbsOrderRequirementUpdateReorderedRange;

function beginAbsOrderRequirementUpdateReorderedRange(lowOffset, highOffset)
{
    this.rangeRequirement.updateReorderedRange(lowOffset, highOffset);
}

// This function is called by the order tree at the end of an update
// cycle to indicate that notifications can be sent to the listeners.
// The begin requirement simply forwards this to its parent range requirement.

BeginAbsOrderRequirement.prototype.notifyListeners =
    beginAbsOrderRequirementNotifyListeners;

function beginAbsOrderRequirementNotifyListeners()
{
    this.rangeRequirement.notifyListeners();
}

////////////////////////////////////
// Range End Absolute Requirement //
////////////////////////////////////

// This is an atomic absolute requirement node which defines the end
// of an absolute range requirement. It is derived from the atomic absolute
// requirement base class.

inherit(EndAbsOrderRequirement, AtomicAbsOrderRequirement);

// A range end absolute requirement is constructed for a given offset
// (an integer >= 0) and a parent (the range requirement node) which also
// provides it with access to the begin requirement. Some properties of the
// end requiremnt (such as the order direction and whether the order
// of the elements inside the range needs to be tracked) are copied form
// the parent range requirement.
// If the 'isReplacement' argument is true, this flag is set on the object.
// This is used whent this requirement is used to replace the end of
// an existing requirement (e.g. a complement requirement) and at the same
// place, and indicates to the order tree that no initial update notification
// needs to be sent (as the rang eis already known).

function EndAbsOrderRequirement(offset, rangeRequirement, isReplacement)
{
    this.AtomicAbsOrderRequirement(offset, rangeRequirement.isBackward);
    this.isOrderedRange = rangeRequirement.isOrderedRange;
    this.rangeRequirement = rangeRequirement;
    this.isEnd = true;
    if(isReplacement)
        this.isReplacement = true;
}

// this function returns the begin requirement of the range requirement
// this end requirement belongs to.

EndAbsOrderRequirement.prototype.getBegin =
    endAbsOrderRequirementGetBegin;

function endAbsOrderRequirementGetBegin()
{
    return this.rangeRequirement.beginRequirement;
}

// This function overrides the function defined in the base class.
// This is because the change in the element matched by this requirement
// also has additional implications for the elements matched by the
// range. Since the begin requirement of the range may also have received
// an update, we here only handle that part of the update which is not
// handled by the begin requirement.
// If 'byElement' is undefined, this is the initial update and
// 'toElement' is set on this node but no notification is sent to
// the range requirement since this node is about to receive an update
// with the full list of matched elements. Otherwise:
// If 'byElement' was added ('wasAdded' is true):
// 1. The previous element (stored at this.element) is removed from the range.
// 2. If 'pos' is inside the range offset range, 'byElement' is added
//    to the range.
// If 'byElement' was removed ('wasAdded' is false):
// 1. 'toElement' is added to the range.
// 2. If 'pos' is inside the range offset range, 'byElement' is removed
//    from the range.
// Note that either one or both of 'this.element' and 'toElement' may be
// undefined (for example, if the requirement offset is still outside
// the set).

EndAbsOrderRequirement.prototype.updateElement =
    endAbsOrderRequirementUpdateElement;

function endAbsOrderRequirementUpdateElement(toElement,
                                             byElement, pos, wasAdded)
{
    if(byElement === undefined) {
        // initial update
        this.element = toElement;
        return; // full element list is about to be received
    }

    if(wasAdded === true) {
        if(this.element !== undefined)
            this.rangeRequirement.removeElement(this.element, this.offset);
        if(pos > this.rangeRequirement.beginRequirement.offset)
            // element added inside the range (and not at the begin position
            // which was already handled by the begin requirement)
            this.rangeRequirement.addElement(byElement, pos);
    } else {
        if(toElement !== undefined)
            this.rangeRequirement.addElement(toElement, this.offset);
        if(pos > this.rangeRequirement.beginRequirement.offset)
            // element removed inside the range (and not at the begin position
            // which was already handled by the begin requirement)
            this.rangeRequirement.removeElement(byElement, pos);
    }
    
    this.element = toElement;
}

// This function is used to process updates received during re-ordering of
// the order tree. For full specifications of the arguments it takes,
// see the beginning of the file. The lists of moved elements are always
// relative to the forward direction. We here need to distinguish between the
// case that the requirement is a forward and a backward requirement.
//
// When the requirement is a forward requirement, we add all elements
// which were move left and remove those elements which were moved right.
// While some of the elements moved left may end up beyond the other end of
// the range and some of the elements moved right may have originated from
// beyond the other end of the range, such elements were already
// moved across the begin requirement of the range, so any superfulous
// addition/removal performed here will cancel off with previous additions/
// removals.
//
// The same logic also holds for backward requirements except for two
// differences:
// 1. In a backward requirement, elements moved to the left must be removed
//    and those moved to the right must be added.
// 2. Elements which were moved from/to beyond the other end of the range
//    will be added/remove by the begin requirement later (since it is
//    updated second).

EndAbsOrderRequirement.prototype.replacedElement =
    endAbsOrderRequirementReplacedElement;

function endAbsOrderRequirementReplacedElement(newElement, movedRight,
                                               firstMovedRight, movedLeft,
                                               firstMovedLeft)
{
    if(!this.isBackward) {
        this.rangeRequirement.addElements(movedLeft, firstMovedLeft,
                                          this.element);
        this.rangeRequirement.removeElements(movedRight, firstMovedRight,
                                             newElement);
    } else {
        this.rangeRequirement.addElements(movedRight, firstMovedRight,
                                          this.element);
        this.rangeRequirement.removeElements(movedLeft, firstMovedLeft,
                                             newElement);
    }
    
    this.element = newElement;
}

// This function is called when all elements are about to be removed from
// the order tree.
// The element which satisfies this requirement is therefore about to
// becomes undefined.  The previous element satisfying the requirement
// remains unchanged.  There is no need o notify the parent requirement
// object here, since it is the responsibility of the begin requirement
// to do so (the end requirement may or may not be registered to the tree,
// but the begin requirement is always registered).

EndAbsOrderRequirement.prototype.clearAllElements =
    endAbsOrderRequirementClearAllElements;

function endAbsOrderRequirementClearAllElements()
{
    // update the element satisfied by this requirement
    this.AtomicAbsOrderRequirement_clearAllElements();
}

// This function is called when the end requirement is first registered
// (which takes place only after the begin requirement has been registered
// and is satisfied by some element). The function receives as input an array
// of all elements currently in the range.
// If this requirement has the 'isOrderedRange' property set, the elements
// in the array 'elements' are sorted, in the forward (increasing) order
// (regardless of the direction of the requirement).
// Since the range may extend beyond the end of the set, the number
// of elements in 'elements' may be smaller than the size of the range.

EndAbsOrderRequirement.prototype.addRangeElements =
    endAbsOrderRequirementAddRangeElements;

function endAbsOrderRequirementAddRangeElements(elements)
{
    this.rangeRequirement.addRangeElements(elements);
}

// This function is called by the order tree at the end of an update
// cycle to indicate that notifications can be sent to the listeners.
// The end requirement does nothing, since the same notification was/will be
// sent also to the begin requirement, which is responsible for forwarding
// this notification to the parent range requirement object.

EndAbsOrderRequirement.prototype.notifyListeners =
    endAbsOrderRequirementNotifyListeners;

function endAbsOrderRequirementNotifyListeners()
{
    // do nothing
}

////////////////////////////////
// Range Absolute Requirement //
////////////////////////////////

// The range requirement is a node which manages various types of
// requirements which are based on absolute offsets and the elements
// between them. This includes the case of segment requirements
// (which are defined by two offsets in the same direction, that is,
// either both forward offsets or both backward offsets) and of
// complement requirements (where one end of the range is defined
// by a forward offset and the other by a backward offset).
//
// The range requirement object is not registered to the order tree.
// Instead, it implements the functionality common to the different
// types of requirement which are considered range requirements
// and a separate object is used to implement the specific type of
// requirement and it is that object (or some object owned by that
// object) which is registered into the order tree.
//
// A range requirement allows its offsets (including their direction and
// whether the range is open or closed at eithe end) to be
// modified after construction. This allows a small change in the range
// to be handled incrementally (rather than recalculating the whole range).
// It is also possible to change the 'isOrderedRange' property (which
// determines whether the range requirement tracks the order of the elements
// in the requirement or not) though this is probably a very infrequent
// operation (because this property is probably determined by the place where
// the requirement is used).

// Object Structure
//
// {
//     orderedTree: <PartialOrderTree>
//     isOrderedRange: true|false
//
//     isComplement: true|false
//     isBackward: true|false
//
//     requirement: <SegmentOrderRequirement|ComplementOrderRequirement>
//
//     // updates
//
//     addedMatches: <Map>{
//         <element>: true,
//         .....
//     },
//     removedMatches: <Map>{
//         <element>: <count>,
//         ......
//     }
//     lowestOffsetChanged: <offset>,
//     highestOffsetChanged: <offset>
//
//     addedRange: <array of elements>
//     removedRange: <array of elements>
//     orderedRange: <array of elements>
// }
//
// orderedTree: this is the PartialOrderTree object which sorts the elements.
//     This object needs access to the tree object in various cases.
// isCompelement: this indicates whether the current requirement is
//     a complement requirement (if it is defined by a forward and backward
//     offset), in which case this field is true, or a segment requirement
//     (in which case this field is false).
// isBackward: indicates whether the forward of the backward ordering
//     should be used for this requirement. For complement requirements
//     this is always false (since the range is defined by one forward
//     and one backward offset, we always use forward offsets here
//     for operations which take place in the range requirement -
//     the backward offset is conveted into a forward offset).
//     For segment requirements, this is either true or false,
//     depending on the requirement.
// isOrderedRange: does this requirement need to track the order of
//     the elements inside the range.
//
// requirement: this is a SegmentOrderRequirement or
//     a ComplementOrderRequirement depending on whether this is a
//     segment requirement (isComplement is false) or a complement
//     requirement (isComplement is true).
//
// addedMatches: this is a map whose keys are all elements which were
//     added to the range during an update cycle. At the end of the update
//     cycle, the listeners' 'addMatches()' function is called with this list
//     of elements and the list is cleared. When an element is added
//     to this table and then later removed within the same update cycles
//     (that is, without notify the listeners in between) that element is
//     removed from the 'addedMatched' list. An element cannot
//     be added or removed twice consecutively from this table. Therefore,
//     there is no need to count the number of additions and removals
//     but simply add or remove the entry (compare this to the situation
//     with 'removedMatches' where a count is sometimes needed).
//     
// removedMatches: this is a map whose keys are all elements which were
//     removed from the range during an update cycle. At the end of the
//     update cycle, the listeners' 'removeMatches()' function is called
//     with this list of elements and the list is cleared. When an element
//     is added to this table and then later added back into the range within
//     the same update cycles (that is, without notify the listeners in
//     between) that element is removed from the 'removedMatched' list.
//     In most cases, an element will not be added or removed twice
//     consecutively from this table. However, in the process of reordering,
//     when an element is moved across the range, the 'begin' requirement
//     is always notified before the 'end' requirement, even for elements
//     which cross the range from right to left. As a result, an element
//     which was moved out of the range (and therefore appears in the
//     removed matches) may first be removed again (when it crosses the
//     begin requirement from right to left and then added back (when
//     it crosses the end reqiurement from right to left). To make sure
//     the update in this case is correct, this table stores a count for
//     each element.
//
// lowestOffsetChanged: when the range requirement needs to track
//     the order of the elements in the range, this field stores the
//     lowest offset where an element was added or removed during
//     the update cycle. This offset is in the direction of the requirement
//     (that is, a forward offset for forward and complemen
//     requirements and a backward offset for backward
//     requirements). This is cleared when the listeners are notified
//     of the changes. When the listeners are notified of the change
//     in offsets of elements in the range (through the updatePos()
//     interface) there is no need to notify of the positions of
//     elements whose offsets are smaller than 'lowestOffsetChange',
//     as these did not change.
// highestOffsetChanged: when the range requirement needs to track
//     the order of the elements in the range, this field stores the
//     highest offset where the element changed during the update cycle.
//     This offset is in the direction of the requirement
//     (that is, a forward offset for forward and complement requirements and
//     a backward offset for backward requirements). This is cleared
//     when the listeners are notified of the changes. When elements are
//     added or removed, this is set to infinity, as all subsequent positions
//     are affected, but when reordering takes place, it may be possible to
//     determine that all elements beyond a certain position were not affected.
//     When the listeners are notified of the change in offsets of elements in
//     the range (through the updatePos() interface), there is no need to
//     notify of the positions of elements whose offsets are larger
//     than 'highestOffsetChange', as these did not change.
//
// addedRange: this is similar in purpose to 'addedMatches' but holds
//     an array of elements. These are then the elements added since the
//     last time the listeners were called. 'addedMatches' and 'removedMatches'
//     must be empty if 'addedRange' is defined and the elements in
//     'removedRange' (see below) must be disjoint from those in 'addedRange'.
//     This is used when the initial update of a range is received (when
//     the range is first registered to the ordered tree or the offsets of
//     the range change and the range is re-registered to the ordered tree).
//     In this case, the ordered tree immediately sends an array containing
//     all elements in the range (if this is the first registration) or
//     the elements added to the range in case the offsets were changed.
//     If there are no pending updates in 'addedMatches' or 'removedMatches'
//     we simply keep the array as is (instead of storing it in
//     'addedMatches' and then later retrieving an array of added matches
//     from that table). If the listeners need to be updated before additional
//     updates are received, this array (together with the array in
//     'removedRange') can be used to notify the listeners.
//     Once additional updates are received, this array needs to be stored
//     in 'addedMatches' and the array is discarded.
// removedRange: this is similar in purpose to 'removedMatches' but holds
//     an array of elements. These are then the elements removed since the
//     last time the listeners were called. 'addedMatches' and 'removedMatches'
//     must be empty if 'removedRange' is defined and the elements in
//     'addedRange' (see above) must be disjoint from those in 'removedRange'.
//     This is used when the offsets of a range change. In this case,
//     the offset update function immediately calculates the array of
//     elements which were removed from the range by this offset change.
//     If there are no pending updates in 'addedMatches' or 'removedMatches'
//     we simply keep the array as is (instead of storing it in
//     'removedMatches' and then later retrieving an array of removed matches
//     from that table). If the listeners need to be updated before additional
//     updates are received, this array (together with the array in
//     'addedRange') can be used to notify the listeners.
//     Once additional updates are received, this array needs to be stored
//     in 'removedMatches' and the array is discarded.
// orderedRange: when the range requirement needs to keep track of the
//     order inside the range, the initial registration of the range
//     to the ordered tree results in a notification from the ordered
//     tree containing a sorted list of all elements in the range.
//     This list is stored here until the listeners need to be updated.
//     If additional updates are received before the listeners are notified,
//     this list is discarded (and will have to be fetched again when
//     the listeners are notified).

inherit(RangeOrderRequirement, OrderRequirement);

// The requirement object must be constructed with the ordered tree object
// which stores the ordered set. In addition, it is possible to provide,
// upon construction, the offsets of the range (including the direction,
// the open/closed properties of the range and whether the ordering inside
// the range needs to be tracked). If these are not provided here, the
// object remains inactive (is not registered to the order tree) until
// the offsets are provided.
// 'orderedTree' is the tree object storing the ordered set (this argument
// must be provided). The remaining arguments define the range of offsets
// and are optional. If provided, 'offsets' should be an array of two
// non-negative integers. If 'isComplement' is false (indicating that the
// requirement is a segment requirement) the smaller of these two will
// be taken as the the beginning of the range and the larger of the two as
// the end of the range. If 'isComplement' is true, te first of these
// two numbers is taken to be the forward offset and the second one the
// backward offset which define the complement range. 'isBackward' (true
// or false) is used only if 'isComplement' is false (and ignored if
// 'isComplement' is true) and indicates whether the offsets are
// relative to the forward or backward direction (undefined means forward).
// 'lowOpen' and 'highOpen' (true or false) indicate whether the low/high
// end of the range is open or closed (undefined means closed). Finally,
// 'isOrderedRange' true indicates that the order of the elements
// in the range needs to be tracked (false or undefined indicate that the
// do not need to be tracked).

function RangeOrderRequirement(orderedTree, offsets, isComplement, isBackward,
                               lowOpen, highOpen, isOrderedRange)
{
    this.OrderRequirement();

    this.orderedTree = orderedTree;

    this.addedMatches = new Map();
    this.removedMatches = new Map();
    
    if(offsets !== undefined)
        this.updateOffsets(offsets, isComplement, isBackward, lowOpen, highOpen,
                           isOrderedRange);
    else { // set initial values (no offsets yet)
        this.isComplement = !!isComplement;
        this.isOrderedRange = !!isOrderedRange;
        this.requirement = undefined;
    }
}

// The desotry function should be called when the requirement is no longer
// needed. This function destroys the segment/complement requirement
// object (which should then unregister any requirements registered to
// the order tree).

RangeOrderRequirement.prototype.destroy =
    rangeOrderRequirementDestroy;

function rangeOrderRequirementDestroy()
{
    if(this.requirement !== undefined)
        this.requirement.destroy();
}

//
// Offset Update
//

// This function may be called to update the offsets of this range requirement.
// This may be used either for setting the initial offsets of a range
// requirement or to modify the offsets of an already existing requirement.
// This function then handles the full update, including modifying the
// registrations to the ordered tree and calcualting the added/removed match
// update.
// When the requirement changes from a complement requirement to a segment
// requirement (or vice versa) this function replaces the object
// which actually implements the requirement. Otherwise, it either creates
// or updates the appropriate requirement object (complement or segment). 

RangeOrderRequirement.prototype.updateOffsets =
    rangeOrderRequirementUpdateOffsets;

function rangeOrderRequirementUpdateOffsets(offsets, isComplement, isBackward,
                                            lowOpen, highOpen, isOrderedRange)
{
    this.isBackward = !isComplement && isBackward; 
    this.isOrderedRange = isOrderedRange;

    var oldRequirement = this.requirement; // may be undefined
    
    if(this.requirement === undefined || isComplement !== this.isComplement) {

        // create a new requirement, possibly using the existing requirement
        // (if any) to intialize the new requirement.
        
        this.requirement = isComplement ?
            new ComplementOrderRequirement(this, this.requirement) :
            new SegmentOrderRequirement(this, this.requirement);
    }

    this.isComplement = isComplement;
    
    // update the requirement properties
    if(this.isComplement)
        this.requirement.updateOffsets(offsets, lowOpen, highOpen,
                                       isOrderedRange);
    else
        this.requirement.updateOffsets(offsets, isBackward, lowOpen,
                                       highOpen, isOrderedRange);

    if(oldRequirement !== this.requirement) {
        if(this.orderedRange !== undefined)
            // new / replace requirement object, the added matches are exactly
            // those elements received as the initial range
            this.addedRange = this.orderedRange;
        if(oldRequirement !== undefined)
            // this unregisters the reqirement from the order tree
            oldRequirement.destroy();
    }
}

// this calculates the sets of added and removed matches after an
// existing requirement was replaced. 'offsets' is an array
// holding the offsets of the new range and 'prevOffsets' is an
// array holding the offsets of the previous range. The offsets are
// in the direction of the 'isBackward' property (always forward for
// a complement requirement and either true or false depending on
// the direction of the new requirement in case of a segment requirement).

RangeOrderRequirement.prototype.diffAfterReplacement =
    rangeOrderRequirementDiffAfterReplacement;

function rangeOrderRequirementDiffAfterReplacement(offsets, prevOffsets)
{
    // get the elements of the previous range: this is done based on
    // 'prevOffsets' so that the elements are given in the same order
    // as the elements of the new range.
    var prevElements = prevOffsets === undefined ? [] :
        this.orderedTree.getRangeElementsByOffsets(prevOffsets[0],
                                                   prevOffsets[1],
                                                   this.isBackward);
    var newElements = this.orderedRange !== undefined ?
        this.orderedRange : (this.requirement === undefined ? [] :
                             this.requirement.getAllMatches());
    

    if(prevOffsets === undefined || offsets == undefined ||
       offsets[1] < prevOffsets[0] || offsets[0] > prevOffsets[1]) {
        // disjoint ranges, the fully ordered set is the set of added
        // matches and 'prevElements' is the set of removed elements.
        this.setAddedAndRemovedRanges(newElements, prevElements);
    } else {
        // the ranges overlap, so need to calculate the difference
        var addedRange;
        var removedRange;
        if(prevOffsets[0] < offsets[0])
            removedRange = prevElements.slice(0, offsets[0] - prevOffsets[0]); 
        else if(prevOffsets[0] > offsets[0]) {
            addedRange = this.isBackward ?
                newElements.slice(-(prevOffsets[0] - offsets[0])) :
                newElements.slice(0, prevOffsets[0] - offsets[0]);
        }

        if(prevOffsets[1] > offsets[1]) {
            var removedSuffix =
                prevElements.slice(offsets[1] - prevOffsets[0] + 1);
            removedRange = (removedRange === undefined) ?
                removedSuffix : removedRange.concat(removedSuffix);
        } else if(prevOffsets[1] < offsets[1]) {
            var addedSuffix = this.isBackward ?
                newElements.slice(0, -(prevOffsets[1] - offsets[0])) :
                newElements.slice(prevOffsets[1] - offsets[0] + 1);
            addedRange = (addedRange === undefined) ?
                addedSuffix : addedRange.concat(addedSuffix);
        }

        this.setAddedAndRemovedRanges(addedRange, removedRange);
    }
}

// This function is called when the offsets of the requirements are updated
// and are moved from their previous position to the new position.
// This function is then responsible for updating the requirement with
// the consequences of this difference. The function is called with the
// following arguments:
// 'beginDiff': this is an array of elements which are at the difference
//     between the low offset of the previous requirement and the low
//     offset of the new requirement (the 'low offset' is the begin
//     offset in segment requirements and the lower of the two offsets
//     in the forward direction if the requirement is a complement
//     requirement).
//     If the new and old offsets are not in the same direction, all
//     offsets here are relative to the direction of the new offsets.
//     This function is usually called only if the old and new range overlap.
//     If they do not, 'beginDiff' should only include elements which are
//     in the range which have lower offsets (in the direction of the
//     requirement).
// 'beginDiffInNew': this is a boolean flag, which indicates whether the
//     the elements in 'beginDiff' belong to the previous range (false) or the
//     new range (true).
// 'endDiff' and 'endDiffInNew': the same as the two other arguments, but
//     for the high offset.

RangeOrderRequirement.prototype.setOffsetUpdateDiff =
    rangeOrderRequirementSetOffsetUpdateDiff;

function rangeOrderRequirementSetOffsetUpdateDiff(beginDiff, beginDiffInNew,
                                                  endDiff, endDiffInNew)
{
    // calculate the lists of added and removed elements

    var lowOffset = this.requirement.getLowOffset();
    var highOffset = this.requirement.getHighOffset();
    
    var addedRange;
    if(beginDiff.length && beginDiffInNew) {
        addedRange = beginDiff;
        if(this.isOrderedRange) {
            this.lowestOffsetChanged = lowOffset;
            var highestOffset = this.lowestOffsetChanged + beginDiff.length - 1;
            if(this.highestOffsetChanged === undefined ||
               this.highestOffsetChanged < highestOffset)
                this.highestOffsetChanged = highestOffset;
        }
    }
    if(endDiff.length && endDiffInNew) {
        addedRange = (addedRange === undefined) ?
            endDiff : addedRange.concat(endDiff);
        if(this.isOrderedRange) {
            var setSize = this.orderedTree.getSize();
            this.highestOffsetChanged = highOffset >= setSize ?
                setSize - 1 : highOffset;
            var lowestOffset = this.highestOffsetChanged - endDiff.length + 1;
            if(this.lowestOffsetChanged === undefined ||
               this.lowestOffsetChanged > lowestOffset)
                this.lowestOffsetChanged = lowestOffset;
        }
    }
    var removedRange;
    if(beginDiff.length && !beginDiffInNew)
        removedRange = beginDiff;
    if(endDiff.length && !endDiffInNew) {
        removedRange = (removedRange === undefined) ?
            endDiff : removedRange.concat(endDiff);
    }

    if(removedRange !== undefined || addedRange !== undefined)
        this.orderedRange = undefined; // no longer valid

    if(this.isOrderedRange) {
        if(this.lowestOffsetChanged !== undefined && lowOffset !== undefined &&
           this.lowestOffsetChanged < lowOffset)
            this.lowestOffsetChanged = lowOffset;
        if(this.highestOffsetChanged !== undefined &&
           highOffset !== undefined && this.highestOffsetChanged > highOffset)
            this.highestOffsetChanged = highOffset;
    }
    
    this.setAddedAndRemovedRanges(addedRange, removedRange);
}

// This function is called when the offsets or direction or
// isComplement or the requirement for order tracking in the range are
// modified or when all elements are about to be removed from the
// order tree. 'addedRange' and 'removedRange' are arrays of elements
// which describe the difference between the previous requirement and
// the new requirement. 'addedRange' holds the elements which were
// added and 'removedRange' the elements which were removed. The
// elements are given in the order of the new requirement (in case the
// old and the new requirements are not in the same order). For
// complement requirments this is in the forward order.  At the same
// time, this.orderedRange holds an array with the full set of
// elements matched by the new requirement (this is ordered if the
// requirement requires it to be ordered).  This function then stores
// these updates. If there are currently no other match updates in the
// object, these two objects are simply stored under 'this.addedRange'
// and 'this.removedRange'. Otherwise, if there are already some
// pending updates on the range, the matches are stored in the
// this.addedMatches and this.removedMatches Map tables.

RangeOrderRequirement.prototype.setAddedAndRemovedRanges =
    rangeOrderRequirementSetAddedAndremovedRanges;

function rangeOrderRequirementSetAddedAndremovedRanges(addedRange,
                                                       removedRange)
{
    if((addedRange == undefined || addedRange.length == 0) &&
       (removedRange == undefined || removedRange.length == 0))
        return; // empty update
    
    if(this.addedRange !== undefined || this.removedRange !== undefined)
        // transfer the existing range updates to the match update tables
        this.changeInitialUpdates();
    else if(this.addedMatches.size == 0 && this.removedMatches.size == 0) {
        // no pending updates, just store the initial match update lists
        this.addedRange = addedRange;
        this.removedRange = removedRange;
        return;
    }
    
    // add the added matches to the 'addedMatches' table
    if(addedRange !== undefined)
        for(var i = 0, l = addedRange.length ; i < l ; ++i) {
            var element = addedRange[i];
            if(this.removedMatches.size !== 0 &&
               this.removedMatches.has(element))
                this.removedMatches.delete(element);
            else
                this.addedMatches.set(element, true);
        }

    // add the removed matches to the 'removedMatches' table
    if(removedRange !== undefined)
        for(var i = 0, l = removedRange.length ; i < l ; ++i) {
            var element = removedRange[i];
            if(this.addedMatches.size !== 0 &&
               this.addedMatches.has(element))
                this.addedMatches.delete(element);
            else
                this.removedMatches.set(element, 1);
        }
}

//
// Update notifications
// 

// This function is called by the segment or complement requirement object
// when the element 'element' has been added to the range at offset
// 'offset' (in the direction of the range requirement - for a complement
// requirement this is in the forward direction). This function
// adds the element to the list of elements added (which will be sent
// to the listeners at the end of the update cycle). Before doing so,
// the function checks whether the element is not in the list of elements
// removed from the range (if it is, the element is simply removed from
// that list, as it has just been added back again).
// If the range requirement needs to track the order of the elements
// in the range, this function checks whether the given offset is the
// smallest offset at which a change took place in the
// current update cycle. If it is, the offset is stored (as minimal offset).
// When the listeners are updated, there is only need
// to notify them of the position of the elements at or after the
// minimal offset at which a change took place.
// Note that adding an element which was removed in the current update
// cycle (the notification of its removal still pending) does not count
// as a change for the purpose of the order tracing updated.

RangeOrderRequirement.prototype.addElement =
    rangeOrderRequirementAddElement;

function rangeOrderRequirementAddElement(element, offset)
{
    if(this.orderedRange !== undefined)
        this.orderedRange = undefined; // no longer valid after this update
    if(this.addedRange !== undefined || this.removedRange !== undefined)
        // the initial range updates must be dumped into the Map tables
        // to allow their update
        this.changeInitialUpdates();
    
    if(this.removedMatches.size !== 0 && this.removedMatches.has(element))
        this.removedMatches.delete(element);
    else {
        this.addedMatches.set(element, true);

        if(this.isOrderedRange) {
            if(this.lowestOffsetChanged === undefined ||
               offset < this.lowestOffsetChanged)
                this.lowestOffsetChanged = offset;
            this.highestOffsetChanged = Infinity;
        }
    }
}

// This function is similar to addElement() (above) except that:
// 1. It adds multiple elements
// 2. Some of these elements may not actually be inside the range (such
//    elements are guaranteed to either be in the 'removedMatches' table
//    or to soon be removed by a call to 'removeElements()'.
// This function is called by the complement or segment requirement object
// under this range requirement when elements in the order tree are
// reordered and, as a result, cross the simple requirements which
// define the end points of the range. Based on the direction of
// movement of the elements and the direction of the requirment they
// are either added or removed. This function handles the case that
// they should be added.  'elements' is an array holding the elements
// which need to be added, but only elements at or beyond position
// 'firstElementPos' in the array need to be added. In addtion, this
// function is provided with the element 'dontAddElement'. If an
// element in the array (this will always be the first or last element
// in the sequence) is equal to this element, it should not be added
// (this is an element which was moved from the position covered by
// the simple requirement and therefore was already inside the range).

RangeOrderRequirement.prototype.addElements =
    rangeOrderRequirementAddElements;

function rangeOrderRequirementAddElements(elements, firstElementPos,
                                          dontAddElement)
{
    if(this.orderedRange !== undefined)
        this.orderedRange = undefined; // no longer valid after this update
    if(this.addedRange !== undefined || this.removedRange !== undefined)
        // the initial range updates must be dumped into the Map tables
        // to allow their update
        this.changeInitialUpdates();

    for(var i = firstElementPos, l = elements.length ; i < l ; ++i) {
        var element = elements[i];
        if(element === dontAddElement)
            continue; // no need to add
        
        if(this.removedMatches.size !== 0 && this.removedMatches.has(element)){
            var count = this.removedMatches.get(element) - 1;
            if(count === 0)
                this.removedMatches.delete(element);
            else
                this.removedMatches.set(element, count);
        } else
            this.addedMatches.set(element, true);
    }
}

// This function is called by the segment or complement requirement object
// when the element 'element' has been removed from the range at offset
// 'offset' (in the direction of the range requirement - for a complement
// requirement this is in the forward direction). This function
// adds the element to the list of elements removed (which will be sent
// to the listeners at the end of the update cycle). Before doing so,
// the function checks whether the element is not in the list of elements
// added to the range (if it is, the element is simply removed from
// that list, as it has just been removed again).
// If the range requirement needs to track the order of the elements
// in the range, this function checks whether the given offset is the
// smallest offset at which a change took place in the
// current update cycle. If it is, the offset is stored (as a minimal offset).
// When the listeners are updated, there is only need
// to notify them of the position of the elements at or after the
// minimal offset at which a change took place.
// Note that removing an element which was added in the current update
// cycle (the notification of its addition still pending) does not count
// as a change for the purpose of the order tracing updated.

RangeOrderRequirement.prototype.removeElement =
    rangeOrderRequirementRemoveElement;

function rangeOrderRequirementRemoveElement(element, offset)
{
    if(this.orderedRange !== undefined)
        this.orderedRange = undefined; // no longer valid after this update
    if(this.addedRange !== undefined || this.removedRange !== undefined)
        // the initial range updates must be dumped into the Map tables
        // to allow their update
        this.changeInitialUpdates();
    
    if(this.addedMatches.size !== 0 && this.addedMatches.has(element))
        this.addedMatches.delete(element);
    else {
        this.removedMatches.set(element, 1);

        if(this.isOrderedRange) {
            if(this.lowestOffsetChanged === undefined ||
               offset < this.lowestOffsetChanged)
                this.lowestOffsetChanged = offset;
            // the change affect all subsequent positions
            this.highestOffsetChanged = Infinity;
        }
    }
}

// This function is similar to removeElement() (above) except that:
// 1. It removes multiple elements
// 2. Some of these elements may not actually have been inside the range (such
//    elements are guaranteed to either be in the 'addedMatches' table
//    or to soon be un-removed by a call to 'addElements()'.
// This function is called by the complement or segment requirement
// object under this range requirement when elements in the order tree
// are reordered and, as a result, cross the simple
// requirements. Based on the direction of movement of the elements
// and the direction of the requirment they are either added or
// removed. This function handles the case that they should be
// removed.  'elements' is an array holding the elements which need to
// be removed, but only elements at or beyond position
// 'firstElementPos' in the array need to be removed. In addtion, this
// function is provided with the element 'dontRemoveElement'. If an
// element in the array is equal to this element (this should be the
// first or last element in the sequence), it should not be removed
// (this is an element which was moved to the position covered by the
// simple requirement and therefore remains inside the range).

RangeOrderRequirement.prototype.removeElements =
    rangeOrderRequirementRemoveElements;

function rangeOrderRequirementRemoveElements(elements, firstElementPos,
                                             dontRemoveElement)
{
    if(this.orderedRange !== undefined)
        this.orderedRange = undefined; // no longer valid after this update
    if(this.addedRange !== undefined || this.removedRange !== undefined)
        // the initial range updates must be dumped into the Map tables
        // to allow their update
        this.changeInitialUpdates();

    for(var i = firstElementPos, l = elements.length ; i < l ; ++i) {
        var element = elements[i];
        if(element === dontRemoveElement)
            continue; // no need to remove
        
        if(this.addedMatches.size !== 0 && this.addedMatches.has(element)) {
            this.addedMatches.delete(element);
        } else if(this.removedMatches.has(element)) {
            var count = this.removedMatches.get(element) + 1;
            this.removedMatches.set(element, count);
        } else
            this.removedMatches.set(element, 1);
    }
}

// The function is called when the end requriement of the range is
// first registered to the order tree. 'elements' is a array containing
// all elements currently in the range and if 'isOrderedRange' is set
// on the requirement, these elements are also sorted (in the forward
// direction, regardless of the order of the requirement).
// As this is an initial update, this function simply stores the array.

RangeOrderRequirement.prototype.addRangeElements =
    rangeOrderRequirementAddRangeElements;

function rangeOrderRequirementAddRangeElements(elements)
{
    if(this.isOrderedRange && elements.length > 0) {
        this.lowestOffsetChanged = this.requirement.getLowOffset();
        this.highestOffsetChanged =
            this.lowestOffsetChanged + elements.length - 1;
    }
        
    // store the initial list
    this.orderedRange = elements;
}

// This function is called when some initial updates are stored on the
// range requirement (arrays of elements stored during the initial
// update) and an additional update is received. The initial updates
// are then dumped into the addedMatches and removedMatches Map tables
// so that the matches could be updted incrementally.

RangeOrderRequirement.prototype.changeInitialUpdates =
    rangeOrderRequirementChangeInitialUpdates;

function rangeOrderRequirementChangeInitialUpdates()
{
    if(this.addedRange) {
        for(var i = 0, l = this.addedRange.length ; i < l ; ++i)
            this.addedMatches.set(this.addedRange[i], true);
        this.addedRange = undefined;
    }

    if(this.removedRange) {
        for(var i = 0, l = this.removedRange.length ; i < l ; ++i)
            this.removedMatches.set(this.removedRange[i], 1);
        this.removedRange = undefined;
    }
}

// This function returns an array with elements which are the
// current matches of this requirement. The matches are returned
// in arbitrary order (not really, but one should not assume anything
// about this order). When there are pending matches which were not forwarded
// yet to the listeners, this function returns the list of matches from
// before the changes which are still pending (so that when the changes are
// forwarded, the update will be incremental).

RangeOrderRequirement.prototype.getMatches =
    rangeOrderRequirementGetMatches;

function rangeOrderRequirementGetMatches()
{
    if(this.requirement === undefined)
        return [];
    
    // get all elements currently matched by the requirement in the tree
    var matches = this.requirement.getAllMatches();
    
    // if there are still some pending updates, adjust the list of
    // matches accordingly
    if(this.addedMatches.size > 0) {
        var treeMatches = matches;
        matches = [];
        // remove from 'matches' those elements which are in 'addedMatches'
        for(var i = 0, l = treeMatches.length ; i < l ; ++i) {
            var element = treeMatches[i];
            if(!this.addedMatches.has(element))
                matches.push(element);
        }
    }

    if(this.removedMatches.size > 0) {
        // push the matches about to be removed at the end of the array
        this.removedMatches.forEach(function(t, element) {
            matches.push(element);
        });
    }

    if(this.addedRange !== undefined && this.addedRange.length > 0) {
        // remove the elements in 'addedRange' from matches.  the
        // added range is a subset of the elements in 'matches' and
        // must be in the same order.
        var treeMatches = matches;
        var matches = [];
        var iMatch = 0;
        var lMatch = treeMatches.length;
        var iAdded = 0;
        var lAdded = this.addedRange.length;
        while(lMatch - iMatch > lAdded - iAdded) {
            var match = treeMatches[iMatch];
            iMatch++;
            if(match == this.addedRange[iAdded])
                iAdded++;
            else
                matches.push(match);
        }
    }

    if(this.removedRange !== undefined && this.removedRange.length > 0)
        matches = matches.concat(this.removedRange);

    return matches;
}

// This function returns an array with all elements currently in the range.
// This is based on the current elements in the order tree and ignores
// any pending updates (compare this with getMatches()). There is one exception
// to this rule: when the initial update (received upon first registering the
// requirement to the order tree) is still pending, this function returns
// an empty array (since the full array is about to be sent in a notification
// very soon).
// This function is suitable for modules which are not sensitive to
// updates being competely incremental (such as order tracking modules
// which use the updatePos() interface). When the range requirement
// has the 'isOrderRange' property set, the array returned by this function
// is guaranteed to store the elements in the range in their correct order,
// in the forward ordering of the order set.

RangeOrderRequirement.prototype.getOrderedMatches =
    rangeOrderRequirementGetOrderedMatches;

function rangeOrderRequirementGetOrderedMatches()
{
    if(this.orderedRange !== undefined)
        // this will soon be received as an incremental update
        return [];

    if(this.requirement === undefined)
        return [];
    
    return this.requirement.getAllMatches(true);
}

// This function returns an array with a subset of the elements in the
// input array 'elements' which are among the current matches of
// this requirement. When there are pending matches which were not forwarded
// yet to the listeners, this function filters relative to the list
// of matches from before the changes which are still pending (so that when
// the changes are forwarded, the update will be incremental).

RangeOrderRequirement.prototype.filterMatches =
    rangeOrderRequirementFilterMatches;

function rangeOrderRequirementFilterMatches(elements)
{
    if(this.requirement === undefined || elements.length === 0)
        return [];

    var rangeSize = this.requirement.getRangeSize();

    if(rangeSize === 0)
        return [];
        
    var toFilter = [];
    
    // filter out elements which are marked as 'added' (which means they
    // are about to be added, so there were not yet in the range).
    var added;
    if(this.addedMatches.size > 0)
        added = this.addedMatches;
    else if(this.addedRange !== undefined && this.addedRange.length > 0) {
        // create a Map object storing the elements and check against it
        added = new Map();
        for(var i = 0, l = this.addedRange.length ; i < l ; ++i)
            added.set(this.addedRange[i]);
    }

    if(added !== undefined) {
        for(var i = 0, l = elements.length ; i < l ; ++i) {
            var element = elements[i];
            if(!added.has(element))
                toFilter.push(element);
        }
    } else
        toFilter = elements;

    // keep elements which are marked as 'removed' (which means they
    // are about to be removed, so they are still in the range).

    var removed;
    if(this.removedMatches.size > 0)
        removed = this.removedMatches;
    else if(this.removedRange !== undefined) {
        // create a Map object storing the elements and check against it
        removed = new Map();
        for(var i = 0, l = this.removedRange.length ; i < l ; ++i)
            removed.set(this.removedRange[i]);
    }

    var filtered = [];
    
    // if the range is very large and the set of element to filter is small,
    // check each element in the order tree. Otherwise, get all elements in
    // range and filter agains this list.
    if(/*toFilter.length < 3 ||*/ toFilter.length * 10 < rangeSize) {

        // forward offsets of range
        var offsets = this.requirement.getForwardRange();
        
        for(var i = 0, l = toFilter.length ; i < l ; ++i) {
            var element = toFilter[i];
            if(removed !== undefined && removed.has(element))
                filtered.push(element);
            else {
                var nodeAndPos = this.orderedTree.findNodeByElement(element);
                if(nodeAndPos !== undefined &&
                   nodeAndPos.pos >= offsets[0] && nodeAndPos.pos <= offsets[1])
                    filtered.push(element);
            }
        }
    } else {
        var rangeElements = this.requirement.getAllMatches();
        var matches = new Map();
        // convet to a Map
        for(var i = 0, l = rangeElements.length ; i < l ; ++i)
            matches.set(rangeElements[i], true);

        // fitler based on the match list
        for(var i = 0, l = toFilter.length ; i < l ; ++i) {
            var element = toFilter[i];
            if(removed !== undefined && removed.has(element))
                filtered.push(element);
            else if(matches.has(element))
                filtered.push(element);
        }
    }

    return filtered;
}

// This function is called after the ordered set was reordered if this
// requirement has the 'isOrderedRange' set to true (which means that
// it tracks the order of the elements inside the range). This call indicates
// to this requirement that the ordering of elements inside the
// offset range [lowOffset, highOffset] may have changed. The offsets are
// given in the forward direction if the requirement is a forward segment
// requirement or a complement requirements and in the backward direction
// if the requirement is a backward segment requirement.
// It is up to the calling function to make sure that the offsets
// are within the range of the range and that lowOffset is no greater than
// highOffset.
// This function uses this range to update the lowestOffsetChanged and
// highestOffsetChanged values on this requirement (which results in
// an appropriate update being sent to the listeners).

RangeOrderRequirement.prototype.updateReorderedRange =
    rangeOrderRequirementUpdateReorderedRange;

function rangeOrderRequirementUpdateReorderedRange(lowOffset, highOffset)
{
    if(this.lowestOffsetChanged === undefined ||
       lowOffset < this.lowestOffsetChanged)
        this.lowestOffsetChanged = lowOffset;

    if(this.highestOffsetChanged === undefined ||
       highOffset > this.highestOffsetChanged)
        this.highestOffsetChanged = highOffset;
}

// This function is called by the begin requirement, which was, in turn,
// called by the order tree at the end of an update cycle to indicate that
// notifications can be sent to the listeners.
// The function determines which update needs to be sent and then forwards
// it to all registered listeners.

RangeOrderRequirement.prototype.notifyListeners =
    rangeOrderRequirementNotifyListeners;

function rangeOrderRequirementNotifyListeners()
{
    // is this the result of an update in the offset range (rather than
    // an update of the ordered set).
    var offsetUpdate =
        (this.addedRange !== undefined || this.removedRange !== undefined);
    // deliver standard add/remove matches updates
    var removedMatches;
    var addedMatches;
    if(this.addedMatches.size == 0 && this.removedMatches.size == 0) {
        removedMatches = this.removedRange;
        this.removedRange = undefined;
        addedMatches = this.addedRange;
        this.addedRange = undefined;
    } else {
        if(this.addedMatches.size > 0) {
            addedMatches = [];
            this.addedMatches.forEach(function(t, element) {
                addedMatches.push(element);
            });
            this.addedMatches.clear();
        }
        if(this.removedMatches.size > 0) {
            removedMatches = [];
            this.removedMatches.forEach(function(t, element) {
                removedMatches.push(element);
            });
            this.removedMatches.clear();
        }
    }

    // push changes to listeners
    for(var i = 0, l = this.listeners.length ; i < l ; ++i) {
        var listener = this.listeners[i];
        if(removedMatches && removedMatches.length > 0)
            listener.removeMatches(removedMatches);
        if(addedMatches && addedMatches.length > 0)
            listener.addMatches(addedMatches);
    }
    
    if(!this.isOrderedRange) {
        this.orderedRange = undefined; // probably not needed
        return;
    }

    this.notifyListenersOfOrderedRange(offsetUpdate, addedMatches,
                                       removedMatches);
}

// This function is called by notifyListeners() when the range requirement
// is required to maintain the ordering inside the range. This function then
// completes the notification process by calling the 'updatePos()' function
// of the listeners.
// 'offsetUpdate', 'addedMatches' and 'removedMatches' are the same as
// the variables by the same name in the calling function. 'offsetUpdate'
// is true if the update is the result of an update in the offsets of the
// requirement (if it is false, the update is as a result of a change in
// the ordered set). 'addedMatches' and 'removedMatches' are arrays
// storing the elements which were added and removed from the range.
// (either of these may be undefined).

RangeOrderRequirement.prototype.notifyListenersOfOrderedRange =
    rangeOrderRequirementNotifyListenersOfOrderedRange;

function rangeOrderRequirementNotifyListenersOfOrderedRange(offsetUpdate,
                                                            addedMatches,
                                                            removedMatches)
{
    // total change in size of the set matched by the requirement 
    var numAdded = (addedMatches === undefined ? 0 : addedMatches.length) -
        (removedMatches === undefined ? 0 : removedMatches.length);
    
    if(this.lowestOffsetChanged === undefined && numAdded === 0)
        return; // no order updates

    var setSize = this.orderedTree.getSize();
    var lowOffset = this.requirement.getLowOffset();

    if(setSize === 0) {
        // special case, ordered set cleared
        for(var i = 0, l = this.listeners.length ; i < l ; ++i) {
            var listener = this.listeners[i];
            listener.updatePos([], 0, 0, 0);
        }
    } else if(lowOffset === undefined || lowOffset >= setSize) {
        // range is outside the set, so deliver an empty notification
        for(var i = 0, l = this.listeners.length ; i < l ; ++i) {
            var listener = this.listeners[i];
            listener.updatePos([], undefined, undefined, setSize);
        }
    } else {
    
        if(this.lowestOffsetChanged === undefined ||
           this.lowestOffsetChanged < lowOffset)
            // may happen if the requirement is a complement requirement
            this.lowestOffsetChanged = lowOffset;

        if(!offsetUpdate && numAdded !== 0) {
            this.highestOffsetChanged =
                Math.min(this.requirement.getHighOffset(), setSize - 1);
        } else if(this.highestOffsetChanged === undefined ||
                  this.highestOffsetChanged > setSize - 1)
            this.highestOffsetChanged = setSize - 1;
    
        // get the ordered set of elements in the range which changed. This
        // must first be converted into a forward direction (if backward)
        var beginOffset = this.isBackward ?
            this.orderedTree.invertOffset(this.highestOffsetChanged) :
            this.lowestOffsetChanged;
        var endOffset = this.isBackward ?
            this.orderedTree.invertOffset(this.lowestOffsetChanged) :
            this.highestOffsetChanged;
        
        var rangeElements = (this.orderedRange !== undefined) ?
            this.orderedRange :
            this.orderedTree.getRangeElementsByOffsets(beginOffset,
                                                       endOffset, false);
        
        // must deliver an 'updatePos()' update for the range affected
        for(var i = 0, l = this.listeners.length ; i < l ; ++i) {
            var listener = this.listeners[i];
            listener.updatePos(rangeElements, beginOffset, endOffset, setSize);
        }
    }

    // clear update values
    this.orderedRange = undefined; // already used
    this.lowestOffsetChanged = undefined;
    this.highestOffsetChanged = undefined;
}

//////////////////////////////////
// Segment Absolute Requirement //
//////////////////////////////////

// The segment requirement is a node created by a range requirement
// node to manage range requirements which are defined by two offsets
// which are in the same direction (both forward or both backward).
// The segment requirement node is also not directly registered into
// the ordering tree but, instead, creates two simple absolute
// requirement nodes (the 'begin' and 'end' requirements), which define
// the beginning and end of the range and are registered to the ordering
// tree and receive updates from the tree.  The segment absolute
// requirement is responsible for constructing and registering the
// simple requirements and for combining the updates received from the
// two simple requirement nodes into a single update which can be
// delivered to the range requirement object and then to the listeners.
// The part of the work performed in the segment requirement and
// the part which is performed in the range requirement node which
// owns it depends on whether the operation is common to all types
// of range requirement (e.g. also complement requirements) or is specific
// to the segment requirement.
//
// A segment requirement allows its offsets (including their common direction
// and whether the range is open or closed at eithe end) to be
// modified after construction. This allows a small change in the range
// to be handled incrementally (rather than recalculating the whole range).
// It is also possible to change the 'isOrderedRange' property (which
// determines whether the range requirement tracks the order of the elements
// in the requirement or not).
//
// When specifying the offsets for this requirement, both offsets must
// be in the same direction (forward or backward). It is also possible
// to covert a segment requirement into a complement requirement or the
// other way around, but this is performed by the parent range requirement
// node and while it preserves the incrementality of the updates to
// the listeners, requires the destruction of the segment/complement
// requirement node and the construction of the node of the other type.
//
// When the simple absolute requirement nodes are created for the segment
// requirement, their offset takes the open/closed property into account
// and the offsets used in constructing the simple requirements already
// take this into account. If the lower end is open, the offset registered
// to the begin requirement is one larger than the low offset of the range
// and if the high end is open, the offset registered to the end requirement
// is one smaller than the low offset of the range.
//
// Object Structure
// ----------------
//
// {
//     orderedTree: <PartialOrderTree>
//     rangeRequirement: <RangeOrderRequirement>
//     isOrderedRange: true|false
//     isBackward: true|false
//
//     beginRequirement: <BeginAbsOrderRequirement>
//     endRequirement: <EndAbsOrderRequirement>
// }
//
// orderedTree: this is the PartialOrderTree object which sorts the elements.
//     This object needs access to the tree object in various cases.
// rangeRequirement: this is the RangeOrderRequirement object which
//     is the owner of this SegmentOrderRequirement
// isBackward: is this segment requirement defined by forward or backward
//     offsets (that is, offsets relative to the forward or backward ordering).
// isOrderedRange: does this requirement need to track the order of
//     the elements inside the range.
//
// beginRequirement: this is the BeginAbsOrderRequirement object which
//     defines the beginning of the range.
// endRequirement: this is the EndAbsOrderRequirement object which
//     defines the end of the range.

inherit(SegmentOrderRequirement, OrderRequirement);

// The requirement object must be constructed with the ordered tree object
// which stores the ordered set.
// 'replacedComplement' is optional and is provided when this segment
// requirement replaces a previous complement requirement (under the
// same RangeOrderRequirement node). Since we want an incremental update,
// we first register the segment requirement to cover exactly the same
// range as the old complement requirement (this does nto generate match
// updates) and then the ends of the range are moved to their new position.

function SegmentOrderRequirement(rangeRequirement, replacedComplement)
{
    this.OrderRequirement();

    this.rangeRequirement = rangeRequirement;
    this.orderedTree = rangeRequirement.orderedTree;

    // set initial values (no offsets yet)
    this.isBackward = false;
    this.isOrderedRange = rangeRequirement.isOrderedRange;
    this.beginRequirement = undefined;
    this.endRequirement = undefined;
    
    if(replacedComplement)
        this.initializeAtComplementRange(replacedComplement);
}

// The desotry function should be called when the requirement is no longer
// needed. This function removes the registration of its begin/end requirements
// from the order tree.

SegmentOrderRequirement.prototype.destroy =
    segmentOrderRequirementDestroy;

function segmentOrderRequirementDestroy()
{
    if(this.beginRequirement !== undefined)
        this.orderedTree.removeAbsRequirement(this.beginRequirement);
}

// returns the lower offset: the offset of the begin requirement

SegmentOrderRequirement.prototype.getLowOffset =
    segmentOrderRequirementGetLowOffset;

function segmentOrderRequirementGetLowOffset()
{
    return this.beginRequirement.offset;
}

// returns the higher offset: the offset of the end requirement

SegmentOrderRequirement.prototype.getHighOffset =
    segmentOrderRequirementGetHighOffset;

function segmentOrderRequirementGetHighOffset()
{
    return this.endRequirement.offset;
}

// This function returns the range of the requirement (for the
// current set size) in terms of forward offsets. If the requirement is
// a backward requirement, the offsets are converted to forward offsets
// (relative to the current set size). This may result in negative offsets.
// The result is returned in an array [<low offset>, <high offset>].

SegmentOrderRequirement.prototype.getForwardRange =
    segmentOrderRequirementGetForwardRange;

function segmentOrderRequirementGetForwardRange()
{
    return this.beginRequirement.getForwardRange();
}

// This function returns the number of elements that are actually inside
// the range defined by this requirement.

SegmentOrderRequirement.prototype.getRangeSize =
    segmentOrderRequirementGetRangeSize;

function segmentOrderRequirementGetRangeSize()
{
    if(this.beginRequirement === undefined || this.endRequirement === undefined)
        return 0; // not yet initialized

    var setSize = this.orderedTree.getSize();

    if(this.beginRequirement.offset >= setSize)
        return 0; // range outside set

    if(this.endRequirement.offset >= setSize)
        return setSize - this.beginRequirement.offset;
    
    return this.endRequirement.offset - this.beginRequirement.offset + 1;
}

//
// Offset Update
//

// This function initializes the segment requirement (which is assumed
// to have just been constructed and not yet registered to the order
// tree) to cover the same range as the range defined by
// 'replacedComplement' which is a ComplementOrderRequirement object.
// It is assumed that 'replacedComplement' implemented the range
// requirement dominating this node until now and therefore the
// matches stored on the parent range requirement node are those for
// 'replacedComplement'.  This is done by translating the offsets of
// 'replacedComplement' into forward offsets.  The requirements are
// then created for these offsets and then registered to the order
// tree, indicating that there is no need to send update notifications
// for this operation.

SegmentOrderRequirement.prototype.initializeAtComplementRange =
    segmentOrderRequirementInitializeAtComplementRange;

function segmentOrderRequirementInitializeAtComplementRange(replacedComplement)
{
    this.isBackward = false;

    var offsets = replacedComplement.getForwardRange();
    this.registerNewRequirements(offsets, true);
}

// This function may be called to update the offsets of this range requirement.
// This may be used either for setting the initial offsets of a range
// requirement or to modify the offsets of an already existing requirement.
// This function then handles the full update, including modifying the
// registrations to the ordered tree and calcualting the added/removed match
// update.

SegmentOrderRequirement.prototype.updateOffsets =
    segmentOrderRequirementUpdateOffsets;

function segmentOrderRequirementUpdateOffsets(offsets, isBackward, lowOpen,
                                              highOpen)
{
    var isOrderedRange = this.rangeRequirement.isOrderedRange;
    
    // calculate the offset end points (sorting them and taking the open
    // ends into account)

    if(offsets[0] > offsets[1])
        offsets.reverse();
        
    if(lowOpen)
        offsets[0]++;
    if(highOpen)
        offsets[1]--;

    if(offsets[0] > offsets[1])
        offsets = undefined; // empty range
    
    if(this.beginRequirement === undefined) {
        // no previous offset
        this.isBackward = !!isBackward;
        this.isOrderedRange = !!isOrderedRange;
        this.registerNewRequirements(offsets);
        return;
    }
    
    // calculate the difference between the existing range and the
    // new range.

    var prevOffsets = [this.beginRequirement.offset,
                       this.endRequirement.offset];
    
    if(this.isBackward !== !!isBackward) {
        // change in direction, convert the old range into the direction
        // of the new range (but keep non-negative)
        prevOffsets =
            [Math.max(this.orderedTree.invertOffset(prevOffsets[1]), 0),
             Math.max(this.orderedTree.invertOffset(prevOffsets[0]), 0)];
    }

    if(offsets === undefined ||
       offsets[1] < prevOffsets[0] || offsets[0] > prevOffsets[1] ||
       this.isOrderedRange !== !!isOrderedRange ||
       this.isBackward !== !!isBackward) {
        // no overlap between the old and new range, so the fastest is
        // to remove the old requirement and add the new one or
        // properties of range changed, so we need to remove the old
        // requirement and add the new one.
        this.replaceRequirements(offsets, isBackward, isOrderedRange,
                                 prevOffsets);
        return;
    }

     // otherwise, move the requirements
    var beginDiff = this.orderedTree.moveAbsRequirement(this.beginRequirement,
                                                        offsets[0]);
    var endDiff = this.orderedTree.moveAbsRequirement(this.endRequirement,
                                                      offsets[1]);
    
    // update the requirement with the difference between the old and the
    // new range
    this.rangeRequirement.setOffsetUpdateDiff(beginDiff,
                                              (offsets[0] < prevOffsets[0]),
                                              endDiff,
                                              offsets[1] > prevOffsets[1]);
}

// This function is used to replace existing range requirements
// defined for this range requirement with new range requirements.
// The new range requirements are defined by their offsets and
// the 'isBackward' and 'isOrderedRange' properties (which may differ
// from those of the existing requirements).
// 'offsets' is and array of two non-negative numbers such that the first
// is no larger than the second. It is assume that the open/closed
// properties of the range have already been taken into account when
// calculating the range (e.g. if the range was (2,8] the offsets received
// by this function are 3,8).
// 'offsets' may also be undefined (in case the range is empty, e.g.
// if it was defined as (2,3)). In this case no new requirements are
// created (only the old ones are removed).
// 'prevOffsets' is an array containing the low and high offsets
// of the previous range (the one about to be removed) but relative to
// the direction of the new range. This means that if the 'isBackward'
// property for the old and new range is the same, 'prevOffsets'
// stores the same offsets as on 'this.beginRequirement' and
// 'this.endRequirement'. However, if the 'isBackward' property is not
// the same for the old and the new requirements, 'prevOffsets' provides
// the offsets of 'this.beginRequirement' and 'this.endRequirement'
// converted to the direction of the new requirement.
// This function first removes the old requirement registrations
// and registers the new begin and end requirements
// to the order tree (which results in an update being received by this
// object with the set of elements matched by the range). Next, the
// difference between the old and the new matches is calculated by fetching
// the list of matches of the old range (this is actually performed
// in the function 'diffAfterReplacement) calculating the difference
// with the matches of the new requirement and storing the difference
// in the lists of added and removed matches.

SegmentOrderRequirement.prototype.replaceRequirements =
    segmentOrderRequirementReplaceRequirements;

function segmentOrderRequirementReplaceRequirements(offsets, isBackward,
                                                    isOrderedRange,
                                                    prevOffsets)
{
    // unregister the old begin/end requirements (this only needs to
    // be applied to the begin requirement, the tree then also
    // removes the end requirement)
    // This needs to take place before the new requirements are registered
    // because access to the end requirement from the begin requirement
    // takes place through the range requirement node.
    this.orderedTree.removeAbsRequirement(this.beginRequirement);

    // set the new requirement (this will trigger a call to
    // add the new elements in the range)
    this.isBackward = !!isBackward;
    this.isOrderedRange = !!isOrderedRange;
    this.registerNewRequirements(offsets);

    // update teh added and removed matches (the full new range is stored
    // under 'orderedRange' and the list of elements matched by the old
    // range is fetched in the function below)
    this.rangeRequirement.diffAfterReplacement(offsets, prevOffsets);
}

// This function creates new begin and end requirement nodes for the
// given offsets and the properties of the range requirement and
// registers them to the ordered tree. These requirements may replace
// existing requirements, but this function assumes that the calling
// function already took care of unregistering those requirements
// (or stores them for doing so later).
// 'offsets' is and array of two non-negative numbers such that the first
// is no larger than the second. It is assume that the open/closed
// properties of the range have already been taken into account when
// calculating the range (e.g. if the range was (2,8] the offsets received
// by this function are 3,8).
// 'offsets' may also be undefined (in case the range is empty, e.g.
// if it was defined as (2,3)). In this case no begin and end requirement
// nodes are created and the old begin and end requirement nodes (if any)
// are removed.
// 'isReplacement' should be true when these requirements are registered
// as a replacement for a complement requirement (for exactly the same
// range).

SegmentOrderRequirement.prototype.registerNewRequirements =
    segmentOrderRequirementRegisterNewRequirements;

function segmentOrderRequirementRegisterNewRequirements(offsets, isReplacement)
{    
    if(offsets === undefined) {
        this.beginRequirement = undefined;
        this.endRequirement = undefined;
        return; // nothing to do, this is an empty range
    }

    // create the begin and end requirements and register the begin
    // requirement (the end requirement will then be registered
    // automiatically by the order tree).
    this.beginRequirement = new BeginAbsOrderRequirement(offsets[0], this);
    this.endRequirement = new EndAbsOrderRequirement(offsets[1], this,
                                                     isReplacement);

    // enough to register the begin requirement to the tree, the end
    // requirement will be registered by the ordered tree when it is
    // ready to do so.
    this.orderedTree.addAbsRequirement(this.beginRequirement);
}

//
// Update notifications
// 

// This function is called by one of the simple requirements defining this
// range when the element 'element' has been added to the range at offset
// 'offset' (in the direction of the range requirement). This function
// merely forwards this notification to the parent range requirement
// (see more details there).

SegmentOrderRequirement.prototype.addElement =
    segmentOrderRequirementAddElement;

function segmentOrderRequirementAddElement(element, offset)
{
    this.rangeRequirement.addElement(element, offset);
}

// This function is similar to addElement() (above) except that:
// 1. It adds multiple elements
// 2. Some of these elements may not actually be inside the range (such
//    elements are guaranteed to either be in the 'removedMatches' table
//    or to soon be removed by a call to 'removeElements()'.
// This function is called by one of the simple requirements of this range
// requirement when elements in the order tree are reordered and, as a result,
// cross the simple requirements. Based on the direction of movement of the
// elements and the direction of the requirment they are either added or
// removed. This function handles the case that they should be added.
// This function merely forwards this notification to the parent range
// requirement (see more details there).

SegmentOrderRequirement.prototype.addElements =
    segmentOrderRequirementAddElements;

function segmentOrderRequirementAddElements(elements, firstElementPos,
                                            dontAddElement)
{
    this.rangeRequirement.addElements(elements, firstElementPos,
                                      dontAddElement);
}

// This function is called by one of the simple requirements defining this
// range when the element 'element' has been removed from the range at offset
// 'offset' (in the direction of the range requirement). This function
// merely forwards this notification to the parent range requirement
// (see more details there).

SegmentOrderRequirement.prototype.removeElement =
    segmentOrderRequirementRemoveElement;

function segmentOrderRequirementRemoveElement(element, offset)
{
    this.rangeRequirement.removeElement(element, offset);
}

// This function is similar to removeElement() (above) except that:
// 1. It removes multiple elements
// 2. Some of these elements may not actually have been inside the range (such
//    elements are guaranteed to either be in the 'addedMatches' table
//    or to soon be un-removed by a call to 'addElements()'.
// This function is called by one of the simple requirements of this range
// requirement when elements in the order tree are reordered and, as a result,
// cross the simple requirements. Based on the direction of movement of the
// elements and the direction of the requirment they are either added or
// removed. This function handles the case that they should be removed.
// This function merely forwards this notification to the parent range
// requirement (see more details there).

SegmentOrderRequirement.prototype.removeElements =
    segmentOrderRequirementRemoveElements;

function segmentOrderRequirementRemoveElements(elements, firstElementPos,
                                               dontRemoveElement)
{
    this.rangeRequirement.removeElements(elements, firstElementPos,
                                         dontRemoveElement);
}

// The function is called when the end requirement of the range is
// first registered to the order tree. 'elements' is a array containing
// all elements currently in the range and if 'isOrderedRange' is set
// on the requirement, these elements are also sorted (in the forward
// direction, regardless of the order of the requirement).
// As this is an initial update, this function simply stores the array.

SegmentOrderRequirement.prototype.addRangeElements =
    segmentOrderRequirementAddRangeElements;

function segmentOrderRequirementAddRangeElements(elements)
{
    this.rangeRequirement.addRangeElements(elements);
}

// This function is called when all elements are about to be removed from
// the order tree. Since the elements were not yet removed from the tree,
// this function fetches the full list of currently matching elements
// and updates the requirement with a removal of these elements

SegmentOrderRequirement.prototype.clearAllElements =
    segmentOrderRequirementClearAllElements;

function segmentOrderRequirementClearAllElements()
{
    var removedElements =
        this.orderedTree.getRangeElementsByOffsets(this.beginRequirement.offset,
                                                   this.endRequirement.offset,
                                                   this.isBackward);
    this.rangeRequirement.setAddedAndRemovedRanges(undefined, removedElements);
}

// This function returns an array with all elements which are currently
// in the segment. The elements are in the order of the requirement if
// 'forwardOnly' is false and in the forward order if 'forwardOnly' is true.
// This represents the current state of the order tree (which means
// that updates still pending in the parent range requirement node are
// not corrected for).  The elements are ordered to the extend that
// they are ordered in the tree (so where no requirement registered to
// the tree is intersted in the order and a heap node is created, the
// elements are returned in arbitrary order).

SegmentOrderRequirement.prototype.getAllMatches =
    segmentOrderRequirementGetAllMatches;

function segmentOrderRequirementGetAllMatches(forwardOnly)
{
    var setSize = this.orderedTree.getSize();
    if(this.beginRequirement === undefined ||
       this.beginRequirement.offset >= setSize)
        return []; // the whole range is outside the set

    if(forwardOnly && this.isBackward) {
        // convert the offsets
        var beginOffset = (this.endRequirement.offset >= setSize) ?
            0 : this.orderedTree.invertOffset(this.endRequirement.offset);
        var endOffset = 
            this.orderedTree.invertOffset(this.beginRequirement.offset);
        return this.orderedTree.
            getRangeElementsByOffsets(beginOffset, endOffset, false);
    }

    // return elements in the order of the requirement
    
    return this.orderedTree.
        getRangeElementsByOffsets(this.beginRequirement.offset,
                                  this.endRequirement.offset,
                                  this.isBackward);
}

// This function is called after the ordered set was reordered if this
// requirement has the 'isOrderedRange' set to true (which means that
// it tracks the order of the elements inside the range). This call indicates
// to this requirement that the ordering of elements inside the forward
// offset range [lowOffset, highOffset] may have changed. This function
// calls the parent range requirement object to use this 
// range to update the lowestOffsetChanged and highestOffsetChanged
// values on this requirement (which results in an appropriate update
// being sent to the listeners). Since lowestOffsetChanged and
// highestOffsetChanged are in the direction of the requirements,
// the offsets need to be converted in case this is a backward requirement.
// Since during a re-ordering operation the size of the set does not
// change, multiple updates received are consistent.

SegmentOrderRequirement.prototype.updateReorderedRange =
    segmentOrderRequirementUpdateReorderedRange;

function segmentOrderRequirementUpdateReorderedRange(lowOffset, highOffset)
{
    if(this.isBackward) {
        tmp = this.orderedTree.invertOffset(lowOffset);
        lowOffset = this.orderedTree.invertOffset(highOffset);
        highOffset = tmp;
    }

    if(lowOffset > this.endRequirement.offset ||
       highOffset < this.beginRequirement.offset)
        return; // out of range
    
    if(lowOffset < this.beginRequirement.offset)
        lowOffset = this.beginRequirement.offset;
    if(highOffset > this.endRequirement.offset)
        highOffset = this.endRequirement.offset;

    this.rangeRequirement.updateReorderedRange(lowOffset, highOffset);
}

// This function is called by the begin requirement, which was, in turn,
// called by the order tree at the end of an update cycle to indicate that
// notifications can be sent to the listeners.
// This function simply forwards the request to the parent range requirement.

SegmentOrderRequirement.prototype.notifyListeners =
    segmentOrderRequirementNotifyListeners;

function segmentOrderRequirementNotifyListeners()
{
    this.rangeRequirement.notifyListeners();
}

/////////////////////////////////////
// Complement Absolute Requirement //
/////////////////////////////////////

// The complement requirement is a node created by a range requirement
// node to manage range requirements which are defined by one forward
// offset and one backward offset.
//
// The complement requirement is registered into the ordered tree together
// with two absolute requirements (one forward and one backward).
// Together, these requirements track the range defined by the complement
// requirement. See the introduction to the file for the interface of
//
// these nodes with the ordered tree. The complement
// requirement is responsible for constructing and registering the
// simple requirements and for combining the updates it receives directly
// from the ordered tree with the updates received from the
// two simple requirement nodes into a single update which can be
// delivered to the range requirement object and then to the listeners.
// The part of the work performed in the segment requirement and
// the part which is performed in the range requirement node which
// owns it depends on whether the operation is common to all types
// of range requirement (e.g. also complement requirements) or is specific
// to the segment requirement.
//
// A complement requirement allows its offsets (including whether the range
// is open or closed at either end) to be modified after construction.
// This allows a small change in the range to be handled incrementally
// (rather than recalculating the whole range). It is also possible to
// change the 'isOrderedRange' property (which determines whether the range
// requirement tracks the order of the elements in the requirement or not).
//
// When specifying the offsets for this requirement, the first offset
// is always the forward offset and the second offset is the backward
// offset. It is also possible to covert a segment requirement into
// a complement requirement or the other way around, but this is performed
// by the parent range requirement node and while it preserves the
// incrementality of the updates to the listeners, requires the destruction
// of the segment/complement requirement node and the construction of
// the node of the other type.
//
// When the simple absolute requirement nodes are created for the forward
// and backward offsets of the requirement, the opened/closed property
// of this requirement is ignored and the simple absolute requirements
// point at the offset specified in the complement requirement (as if the
// ends were closed). This is so because it is not clear which of the
// two offsets is lower in the ordering (e.g. in a set of 10 elements,
// a backward offset of -7 is before (in forward ordering) a forward
// offset of 7, but if the st contains 20 elements, this is no longer the
// case). The open/closed properties refer to the low and high points of
// the range in the forward ordering and therefore it is not fixed
// whether the forward or backward requirement should be registered
// at one offset higher or lower in case of an open end-point. Correcting
// for the open end is therefore left for the component requirement
// to do when it updates the listeners.

// 
// Object Structure
//
// {
//      orderedTree: <PartialOrderTree>
//      rangeRequirement: <RangeOrderRequirement>
//      isOrderedRange: true|false
//      lowOpen: true|false
//      highOpen: true|false
//
//      isCrossing: true|false
//      lowOffset: <number>
//      highOffset: <number>
//
//      forwardRequirement: <ComplementEndOrderRequirement>,
//      backwardRequirement: <ComplementEndOrderRequirement>,
// }

// orderedTree: this is the PartialOrderTree object which sorts the elements.
//     This object needs access to the tree object in various cases.
// rangeRequirement: this is the RangeOrderRequirement object which
//     is the owner of this SegmentOrderRequirement
// isOrderedRange: does this requirement need to track the order of
//     the elements inside the range.
// lowOpen: is the range open on its lower end (the end with the lower offset
//     in the forward direction).
// highOpen: is the range open on its higher end (the end with the higher offset
//     in the forward direction).
//
// isCrossing: indicates whether the lower offset of the range is determined
//     by the forward or backward offset. Normally, the lower offset of the
//     range (in forward order) is determined by the forward requirement
//     and the higher offset by the backward requirement. Therefore, if
//     'isCrossing' is false, this is the case. If 'isCrossing' is true
//     then the lower offset is determined by the backward offset and
//     the higher offset by the forward offset.
// lowOffset: this is the current lowest (forward) offset inside the range.
//     This takes into account the lowOpen property and, depending on
//     'isCrossing' is determined based on the forward or backward requirement.
//     If this is determined by the backward offsets, this offset changes
//     with every element added or removed from the set.
// highOffset: this is the current highest (forward) offset inside the range.
//     This takes into account the highOpen property and, depending on
//     'isCrossing' is determined based on the forward or backward requirement.
//     If this is determined by the backward offsets, this offset changes
//     with every element added or removed from the set.
// Note: 'lowOffset' may be larger than 'highOffset' in case the forward
//     and backward offset point at the same element and the range is
//     open at at least one end or if these two point at adjacent elements
//     and the range is open on both ends. In these cases the range is
//     empty.
//
// forwardRequirement: this is the ComplementEndOrderRequirement object which
//     defines the forward offset of the range.
// backwardRequirement: this is the ComplementEndOrderRequirement object which
//     defines the backward offset of the range.

inherit(ComplementOrderRequirement, OrderRequirement);

//
// Constructor
//

// The requirement object must be constructed with the parent range
// requirement object.
// 'replacedSegment' is optional and is provided when this complement
// requirement replaces a previous segment requirement (under the
// same RangeOrderRequirement node). Since we want an incremental update,
// we first register the complement requirement to cover exactly the same
// range as the old segment requirement (this does not generate match
// updates) and then the ends of the range are moved to their new position.

function ComplementOrderRequirement(rangeRequirement, replacedSegment)
{
    this.OrderRequirement();
    
    this.rangeRequirement = rangeRequirement;
    this.orderedTree = rangeRequirement.orderedTree;
    
    // set initial values (no offsets yet)
    this.isOrderedRange = rangeRequirement.isOrderedRange;
    this.lowOpen = false;
    this.highOpen = false;

    this.isCrossing = false;
    this.lowOffset = undefined;
    this.highOffset = undefined;
    
    this.forwardRequirement = undefined;
    this.backwardRequirement = undefined;
    
    if(replacedSegment)
        this.initializeAtSegmentRange(replacedSegment);
}

// The desotry function should be called when the requirement is no longer
// needed. This function removes all registrations of the requirements
// from the ordered tree.

ComplementOrderRequirement.prototype.destroy =
    complementOrderRequirementDestroy;

function complementOrderRequirementDestroy()
{
    if(this.forwardRequirement)
        this.orderedTree.removeAbsRequirement(this.forwardRequirement);
    if(this.backwardRequirement)
        this.orderedTree.removeAbsRequirement(this.backwardRequirement);
    this.orderedTree.removeComplementRequirement(this);
}

// This function sets this.lowOffset and this.highOffset to represent
// the range currently defined by this requirement in terms of forward
// offsets. The backward offset is converted into a forward offset,
// it is then determined which offset is the low offset and which is
// the high offset and the offsets are then adjusted to fit inside the
// offset range of the ordered set and to take the open ends into account.

ComplementOrderRequirement.prototype.setForwardRange =
    complementOrderRequirementSetForwardRange;

function complementOrderRequirementSetForwardRange()
{    
    // get the offsets defining the requirement, convert to forward offsets
    // and determine which is the higher and which is the lower.
    
    var forwardOffset = this.forwardRequirement.offset;
    // convert the backward offset into a forward offset (may be negative)
    var backwardOffset =
        this.orderedTree.invertOffset(this.backwardRequirement.offset);

    if(forwardOffset <= backwardOffset) {
        this.lowOffset = forwardOffset;
        this.highOffset = backwardOffset;
        this.isCrossing = false;
    } else {
        this.lowOffset = backwardOffset;
        this.highOffset = forwardOffset;
        this.isCrossing = true;
    }

    // bring into range of offsets inside the set and take open ends
    // into account

    var setSize = this.orderedTree.getSize();
    
    if(this.lowOffset < 0)
        this.lowOffset = 0;
    else if(this.lowOpen)
        this.lowOffset++;

    if(this.highOpen)
        this.highOffset--;
}

// This function returns the range of the requirement (for the
// current set size) in terms of forward offsets. The values returned
// are based on this.lowOffset and this.highOffset which are returned
// in an array: [<low offset>, <high offset>]. If <low offset> > <high offset>
// (see explanation for 'this.lowOffset' and 'this.highOffset' at the
// introduction to this class) then this function returns undefined.

ComplementOrderRequirement.prototype.getForwardRange =
    complementOrderRequirementGetForwardRange;

function complementOrderRequirementGetForwardRange()
{
    if(this.lowOffset > this.highOffset)
        return undefined; // empty range
    
    return [this.lowOffset, this.highOffset];
}

// this function returns the current low offset of the range (lowest
// forward offset of an element in the range). When the range is empty,
// this returns undefined.

ComplementOrderRequirement.prototype.getLowOffset =
    complementOrderRequirementGetLowOffset;

function complementOrderRequirementGetLowOffset()
{
    if(this.lowOffset > this.highOffset)
        return undefined; // empty range
    
    return this.lowOffset;
}

// this function returns the current high offset of the range (highest
// forward offset of an element in the range). When the range is empty,
// this returns undefined.

ComplementOrderRequirement.prototype.getHighOffset =
    complementOrderRequirementGetHighOffset;

function complementOrderRequirementGetHighOffset()
{
    if(this.lowOffset > this.highOffset)
        return undefined; // empty range
    
    return this.highOffset;
}

// Returns true if the range is empty, either because the ordered set is
// empty or because the end-points are such that the range is empty.
// It is assumed this function s called only after the offsets of the
// range have been set.

ComplementOrderRequirement.prototype.isEmpty =
    complementOrderRequirementIsEmpty;

function complementOrderRequirementIsEmpty()
{
    return this.orderedTree.getSize() == 0 || this.lowOffset > this.highOffset; 
}

// This function returns the number of elements that are actually inside
// the range defined by this requirement.

ComplementOrderRequirement.prototype.getRangeSize =
    complementOrderRequirementGetRangeSize;

function complementOrderRequirementGetRangeSize()
{
    if(this.isEmpty())
        return 0;

    if(this.lowOffset === undefined || this.highOffset === undefined)
        return 0; // not yet initialized

    return this.highOffset - this.lowOffset + 1;
}

//
// Offset Update
//

// This function initializes the complement requirement (which is assumed
// to have just been constructed and not yet registered to the
// order tree) to cover the same range as the range defined by
// 'replacedSegment' which is a SegmentOrderRequirement object.
// It is assumed that 'replacedSegment' implemented the range requirement
// dominating this node until now and therefore the matches stored
// on the parent range requirement node are those for 'replacedSegment'.
// This is done by translating the offsets of 'replacedSegment'
// into a forward and backward offset (the forward offset is assigned
// to the offset of 'replacedSegment' which is smaller in forward direction).
// The requirements are then created for these offsets and then registered
// to the order tree, indicating that there is no need to send update
// notifications for this operation.

ComplementOrderRequirement.prototype.initializeAtSegmentRange =
    complementOrderRequirementInitializeAtSegmentRange;

function complementOrderRequirementInitializeAtSegmentRange(replacedSegment)
{
    // determine the offsets (the complement requirement is created closed
    // on both ends)
    var lowOffset = replacedSegment.getLowOffset();
    var highOffset = replacedSegment.getHighOffset();
    var isBackward = replacedSegment.isBackward;
    var setSize = this.orderedTree.getSize()

    if(lowOffset >= setSize)
        return; // completely outside the set, nothing to register

    // low offset remains unchanged, high offset must be converted into
    // an offset in the opposite direction and then, depending on the
    // direction of the segment requirement, they are assigned to the forward
    // and backward offsets of the complement requirement.
    
    var convertedHigh = (highOffset >= setSize) ?
        0 : this.orderedTree.invertOffset(highOffset);

    var offsets =
        isBackward ? [convertedHigh, lowOffset] : [lowOffset, convertedHigh];
    
    this.registerNewRequirements(offsets, false, false, this.isOrderedRange,
                                 true);
}

// This function may be called to update the offsets of this complemen
// requirement. This may be used either for setting the initial offsets of
// a complement requirement or to modify the offsets of an already existing
// requirement. 'offsets' should be an array of two non-zero integers,
// where the first offset is the forward offset and the second offset is
// the backward offset of the requirement.

ComplementOrderRequirement.prototype.updateOffsets =
    complementOrderRequirementUpdateOffsets;

function complementOrderRequirementUpdateOffsets(offsets, lowOpen, highOpen)
{
    var isOrderedRange = this.rangeRequirement.isOrderedRange;

    if(this.forwardRequirement === undefined) {
        // no previous offset
        this.registerNewRequirements(offsets, lowOpen, highOpen,
                                     isOrderedRange);
        return;
    }

    // requirements already registered, move them from the old offsets
    // to the new offsets

    // in the simple and common case where the forward offset is to
    // the left of the backward offset and the ranges overlap, we move the
    // end-points. In all other cases we remove the old constraint and
    // add the new one.
    
    // if either before or after the change the forward and backward
    // offsets cross, or if the 'isOrderedRange' property changed or
    // if the old and the new ranges are disjoint (possibly
    // overlapping at a single element), we replace the one set of
    // requirements with the other (this is simpler and this situation
    // is not likely in a large set).
    if(this.isOrderedRange !== isOrderedRange || this.isCrossing || 
       offsets[0] > this.orderedTree.invertOffset(offsets[1])) {
        // isOrderRange changed or crossing before or after change.
        this.replaceRequirements(offsets, lowOpen, highOpen, isOrderedRange,
                                 false); // the overlap may be non-empty
        return;
    }

    // both old and new range is non-crossing, so check whether their
    // overlap is empty

    // forward offset of end point (old and new)
    var endForward = this.orderedTree.invertOffset(offsets[1]);
    var prevEndForward =
        this.orderedTree.invertOffset(this.backwardRequirement.offset);
    if(endForward < this.forwardRequirement.offset ||
       prevEndForward < offsets[0] ||
       (endForward == this.forwardRequirement.offset &&
        (highOpen || this.lowOpen)) ||
       (prevEndForward == offsets[0] && (lowOpen || this.highOpen))) {
        // disjoint ranges
        this.replaceRequirements(offsets, lowOpen, highOpen, isOrderedRange,
                                 true);
        return;
    }

    // ranges overlap and end-points do not cross
    
    var prevLowOpen = this.lowOpen;
    var prevHighOpen = this.highOpen;
    this.lowOpen = lowOpen;
    this.highOpen = highOpen;
    
    var forwardDiff = this.moveOffset(offsets[0], prevLowOpen, lowOpen, false);
    var backwardDiff =
        this.moveOffset(offsets[1], prevHighOpen, highOpen, true);

    this.setForwardRange(); // register the new offsets
    
    // update the requirement with the difference between the old and the
    // new range
    this.rangeRequirement.setOffsetUpdateDiff(forwardDiff.diff,
                                              forwardDiff.diffInNew,
                                              backwardDiff.diff,
                                              backwardDiff.diffInNew);
}

// This function sets the given parameters of the requirement and registers
// itself and the end requirement to the ordere tree. This should be used
// either upon first registering this complement or after removing the
// previous registrations. In addition, it may be used when replacing
// a segment requirement under the same range requirement node. In that
// case, this function is called directly after construction with offsets
// equivalent to those of the segment requirement being replaced. In that
// case, 'noInitialUpdate' sould be true (in all other cases, false or
// undefined) which indicates to the order tree that no initial update
// needs to be sent.

ComplementOrderRequirement.prototype.registerNewRequirements =
    complementOrderRequirementRegisterNewRequirements;

function complementOrderRequirementRegisterNewRequirements(offsets, lowOpen,
                                                           highOpen,
                                                           isOrderedRange,
                                                           noInitialUpdate)
{
    this.lowOpen = lowOpen;
    this.highOpen = highOpen;
    this.isOrderedRange = isOrderedRange;
    this.forwardRequirement =
        new ComplementEndOrderRequirement(this, offsets[0], false);
    this.backwardRequirement =
        new ComplementEndOrderRequirement(this, offsets[1], true);

    this.setForwardRange(); // register the current offsets
    
    this.orderedTree.addAbsRequirement(this.forwardRequirement);
    this.orderedTree.addAbsRequirement(this.backwardRequirement);
    
    // this calls 'addRangeElements()' with an array of all matches 
    this.orderedTree.addComplementRequirement(this, noInitialUpdate);
}

// This function removes the current requirement registrations, changes
// the offsets and re-registers the requirements. The argument
// 'emptyOverlap' indicates whether the overlap between the previous range
// and the new range is guaranteed to be empty (if 'emptyOverlap' is true)
// or not guarateed to be empty (if it is guaranteed to be empty, calculating
// the difference between the new and the old range is somewhat quicker). 

ComplementOrderRequirement.prototype.replaceRequirements =
    complementOrderRequirementReplaceRequirements;

function complementOrderRequirementReplaceRequirements(offsets, lowOpen,
                                                       highOpen, isOrderedRange,
                                                       emptyOverlap)
{
    // before changing get the offsets of the range in forwards offsets
    // (already adjusted for open/closed ends and the size of the set).
    var prevOffsets = this.getForwardRange();
    
    // unregister the old requirements
    this.orderedTree.removeComplementRequirement(this);
    this.orderedTree.removeAbsRequirement(this.forwardRequirement);
    this.orderedTree.removeAbsRequirement(this.backwardRequirement);

    // set the new requirements (if we do not have a guarntee that the overlap
    // is empty, we do not want an 'initial update' from the order tree, as
    // we cannot treat this as a completely new range).
    this.registerNewRequirements(offsets, lowOpen, highOpen, isOrderedRange,
                                 !emptyOverlap);

    // range in forward offsets (already adjusted for open/closed ends
    // and the size of the set).
    var newOffsets = this.getForwardRange();
    
    // update teh added and removed matches (the full new range is stored
    // under 'orderedRange' and the list of elements matched by the old
    // range is fetched in the function below)
    this.rangeRequirement.diffAfterReplacement(newOffsets, prevOffsets);
}

// This function may be used to change either of the offsets of the
// requirement. 'isBackward' indicates whether the offset being moved
// is the forward or the backward offset of the requirement. The function
// moves the requirement for the forward/backward offset from its current
// offset (the requirement must already exist and be registered to the
// ordered tree) to the offset indicated by 'newOffset'. 'prevIsOpen' indicates
// whether the previous offset was an open or closed end-point of the range
// and 'newIsOpen' indicates the same for the new end-point. The function
// then moves the requirement from the old offset to the new offset
// (this does nto depend on the open/closed property). In doing so, it
// returns a list (array) of elements between the old offset and the new offset.
// This list of elements is the difference between the old range and the
// new range as a result of this movement. In calculating this difference,
// the function assumes that when the forward offset is moved the forward
// offset was the low point of the range both before and after the movement
// and that when the backward offset is moved the backward offset was the
// high point of the range both before and after the movement (since the
// offsets are moved one by one, this also means that there must be an
// overlap between the ranges before and after the movement). The function
// returns the list of elements which are the differeence in the range
// in forward order (if the requirement is 'isOrderedRange' then these
// elements are sorted). In addition, the function returns a falg indicating
// whether the list of elements returned is in the old or new range.
// This is returned in the following object:
// {
//    diff: <array of elements>,
//    diffInNew: true|false  // true for 'in new' false for 'in old'
// }
// The list of elements may be empty.

ComplementOrderRequirement.prototype.moveOffset =
    complementOrderRequirementMoveOffset;

function complementOrderRequirementMoveOffset(newOffset, prevIsOpen, newIsOpen,
                                              isBackward)
{
    var requirement = isBackward ?
        this.backwardRequirement : this.forwardRequirement;
    var prevOffset = requirement.offset;

    if(newOffset === prevOffset) {
        if(!!newIsOpen == !!prevIsOpen)
            return { diff: [], diffInNew: true }; // diffInNew arbitrary
        else 
            return {
                diff: [requirement.element],
                diffInNew: !newIsOpen 
            };
    }
    
    // the array returned below includes the end-points (the elements
    // at which the requirement was registere before and after the movement)
    var diff = this.orderedTree.moveAbsRequirement(requirement, newOffset);

    var diffInNew;

    if(newOffset < prevOffset) {
        forwardDiffInNew = true;
        if(!prevIsOpen)
            diff.length--;
        if(isBackward) {
            diff.reverse();
            if(newIsOpen)
                diff.length--;
        } else if(newIsOpen)
            diff.shift();
        return { diff: diff, diffInNew: true };
    }
    
    if(!newIsOpen)
        diff.length--;
    if(isBackward) {
        diff.reverse();
        if(prevIsOpen)
            diff.length--;
    } else if(prevIsOpen)
        diff.shift();
    return { diff: diff, diffInNew: false };
}

//
// Tree Updates
//

// This function is called by the ordered tree directly on the complement
// requirement for each element added (after the initial update upon
// registration). Together with the element, also the forward offset at
// which it was added is provided. This function first updates the low/high
// offset of the range (the one based on the backward offset, since this
// changes with the size of the set). It then checks whether the element
// was added inside the range. If it was, it is added to the matches
// of this range.

ComplementOrderRequirement.prototype.updateAddElement =
    complementOrderRequirementUpdateAddElement;

function complementOrderRequirementUpdateAddElement(element, offset)
{
    if(!this.isCrossing) {
        // the backward offset is the high offset, advance by 1
        this.highOffset++;
    } else {
        // the backward offet is the low offset, need to check whether it
        // is inside the set (otherwise it is not moved) and whether
        // crossing continues
        var backwardOffset =
            this.orderedTree.invertOffset(this.backwardRequirement.offset);

        if(backwardOffset >= this.forwardRequirement.offset) {
            // no crossing anymore
            this.setForwardRange();
        } else if(backwardOffset <= 0) {
            this.lowOffset = 0;
            if(backwardOffset == 0 && this.lowOpen)
                this.lowOffset = 1;
        } else
            this.lowOffset++;
    }

    // if the new element is in the range, add it
    if(this.lowOffset <= offset && offset <= this.highOffset)
        this.rangeRequirement.addElement(element, offset);

    // in addition, adding an element (whether inside the range or outside
    // it) may cause changes at the end-points of the range. These are
    // handled by the updates from the end-point requirements. 
}

// This function is called by the ordered tree directly on the complement
// requirement for each element removed (after the initial update upon
// registration). Together with the element, also the forward offset at
// which it was removed is provided. The function checks whether the element
// was removed from inside the range. If it was, it is removed from the matches
// of this range. The function then updates the low/high offset of the
// range (the one based on the backward offset, since this changes with
// the size of the set). 

ComplementOrderRequirement.prototype.updateRemoveElement =
    complementOrderRequirementUpdateRemoveElement;

function complementOrderRequirementUpdateRemoveElement(element, offset)
{
    // if the element was in the range, remove it
    if(this.lowOffset <= offset && offset <= this.highOffset)
        this.rangeRequirement.removeElement(element, offset);

    // in addition, removing an element (whether inside the range or outside
    // it) may cause changes at the end-points of the range. These are
    // handled by the updates from the end-point requirements.

   if(!this.isCrossing) {
       // the backward offset is the high offset, decrease by 1
       this.highOffset--;
       if(this.highOffset < this.lowOffset) {
           // has become crossing
           var newLowOffset = this.highOffset;
           this.highOffset = this.lowOffset;
           this.lowOffset = newLowOffset; 
           this.isCrossing = true;
       }
    } else {
        // the backward offet is the low offset, need to check whether it
        // is inside the set (otherwise it is not moved)
        var backwardOffset =
            this.orderedTree.invertOffset(this.backwardRequirement.offset);

        if(backwardOffset < 0)
            this.lowOffset = 0;
        else if(this.lowOpen)
            this.lowOffset = backwardOffset + 1;
        else
            this.lowOffset = backwardOffset;
    }
}

// This function is called by one of the simple requirements defining this
// range when the element 'element' has been added to the range at offset
// 'offset' (in the direction of the range requirement). This function
// merely forwards this notification to the parent range requirement
// (see more details there).

ComplementOrderRequirement.prototype.addElement =
    complementOrderRequirementAddElement;

function complementOrderRequirementAddElement(element, offset)
{
    this.rangeRequirement.addElement(element, offset);
}

// This function is similar to addElement() (above) except that:
// 1. It adds multiple elements
// 2. Some of these elements may not actually be inside the range (such
//    elements are guaranteed to either be in the 'removedMatches' table
//    or to soon be removed by a call to 'removeElements()'.
// This function is called by one of the simple requirements of this range
// requirement when elements in the order tree are reordered and, as a result,
// cross the simple requirements. Based on the direction of movement of the
// elements and the direction of the requirment they are either added or
// removed. This function handles the case that they should be added.
// This function merely forwards this notification to the parent range
// requirement (see more details there).

ComplementOrderRequirement.prototype.addElements =
    complementOrderRequirementAddElements;

function complementOrderRequirementAddElements(elements, firstElementPos,
                                               dontAddElement)
{
    this.rangeRequirement.addElements(elements, firstElementPos,
                                      dontAddElement);
}

// This function is called by one of the simple requirements defining this
// range when the element 'element' has been removed from the range at offset
// 'offset' (in the direction of the range requirement). This function
// merely forwards this notification to the parent range requirement
// (see more details there).

ComplementOrderRequirement.prototype.removeElement =
    complementOrderRequirementRemoveElement;

function complementOrderRequirementRemoveElement(element, offset)
{
    this.rangeRequirement.removeElement(element, offset);
}

// This function is similar to removeElement() (above) except that:
// 1. It removes multiple elements
// 2. Some of these elements may not actually have been inside the range (such
//    elements are guaranteed to either be in the 'addedMatches' table
//    or to soon be un-removed by a call to 'addElements()'.
// This function is called by one of the simple requirements of this range
// requirement when elements in the order tree are reordered and, as a result,
// cross the simple requirements. Based on the direction of movement of the
// elements and the direction of the requirment they are either added or
// removed. This function handles the case that they should be removed.
// This function merely forwards this notification to the parent range
// requirement (see more details there).

ComplementOrderRequirement.prototype.removeElements =
    complementOrderRequirementRemoveElements;

function complementOrderRequirementRemoveElements(elements, firstElementPos,
                                                  dontRemoveElement)
{
    this.rangeRequirement.removeElements(elements, firstElementPos,
                                         dontRemoveElement);
}


// The function is called when the complement requirement of the range is
// first registered (or re-registered) to the order tree. 'elements' is
// an array containing all elements currently in the range and if
// 'isOrderedRange' is set on the requirement, these elements are also
// sorted (in the forward direction).
// As this is an initial update, this function simply stores the array.

ComplementOrderRequirement.prototype.addRangeElements =
    complementOrderRequirementAddRangeElements;

function complementOrderRequirementAddRangeElements(elements)
{
    this.rangeRequirement.addRangeElements(elements);
}

// This function is called when all elements are about to be removed from
// the order tree. Since the elements were not yet removed from the tree,
// this function fetches the full list of currently matching elements
// and updates the requirement with a removal of these elements

ComplementOrderRequirement.prototype.clearAllElements =
    complementOrderRequirementClearAllElements;

function complementOrderRequirementClearAllElements()
{
    var removedElements = this.getAllMatches();
    this.rangeRequirement.setAddedAndRemovedRanges(undefined, removedElements);
}

// This function returns an array with all elements which are currently
// in the segment. The elements are in the forward order.
// This represents the current state of the order tree (which means
// that updates still pending in the parent range requirement node are
// not corrected for).  The elements are ordered to the extend that
// they are ordered in the tree (so where no requirement registered to
// the tree is intersted in the order and a heap node is created, the
// elements are returned in arbitrary order).

ComplementOrderRequirement.prototype.getAllMatches =
    complementOrderRequirementGetAllMatches;

function complementOrderRequirementGetAllMatches()
{
    var offsets = this.getForwardRange();

    if(offsets === undefined)
        return [];
    
    return this.orderedTree.getRangeElementsByOffsets(offsets[0], offsets[1],
                                                      false);
}

// This function is called after the ordered set was reordered if this
// requirement has the 'isOrderedRange' set to true (which means that
// it tracks the order of the elements inside the range). This call indicates
// to this requirement that the ordering of elements inside the forward
// offset range [lowOffset, highOffset] may have changed. This function
// calls the parent range requirement object to use this 
// range to update the lowestOffsetChanged and highestOffsetChanged
// values on this requirement (which results in an appropriate update
// being sent to the listeners). Since for a complement requirment
// lowestOffsetChanged and highestOffsetChanged are always given in the forward
// direction, there is little this function needs to do.

ComplementOrderRequirement.prototype.updateReorderedRange =
    complementOrderRequirementUpdateReorderedRange;

function complementOrderRequirementUpdateReorderedRange(lowOffset, highOffset)
{
    this.rangeRequirement.updateReorderedRange(lowOffset, highOffset);
}

// This function is called by the order tree at the end of an update
// cycle to indicate that notifications can be sent to the listeners.
// This function simply forwards the request to the parent range
// requirement.

ComplementOrderRequirement.prototype.notifyListeners =
    complementOrderRequirementNotifyListeners;

function complementOrderRequirementNotifyListeners()
{
    this.rangeRequirement.notifyListeners();
}

//
// ComplementEndOrderRequirement
//

// This class is a simple extension of the AtomicAbsOrderRequirement class.
// Its interface with the ordered tree is identical to that of
// AtomicAbsOrderRequirement. When it receives updates from the ordered
// tree, it forwards them to the parent complement requirement.
//
// Object Structure
// ----------------
//
// The following fields are added to the base class
//
// {
//    complementRequirement: <ComplementOrderRequirement>
// }
//
// compementRequirement: this points at the complement requirement to which
//     this end point belongs.
// 

inherit(ComplementEndOrderRequirement, AtomicAbsOrderRequirement);

// The arguments to the constructor are the parent complement requirement
// (to which notifications need to be forwarded) and the arguments
// to the constructor of the base class: the offset (a non-negative integer)
// and a flag indicating whether this is a froward or backward offset.

function ComplementEndOrderRequirement(complementRequirement, offset,
                                       isBackward)
{
    this.AtomicAbsOrderRequirement(offset, isBackward);
    this.complementRequirement = complementRequirement;
}

// This function is called by the order tree to indicate that 'toElement'
// is now the element which is matched by this requirement. 'byElement'
// is the element whose addition or removal caused the change in the
// matched element (and 'pos' is the position, in the direction of the
// requirement, at which 'byElement' was added or removed). 'byElement'
// may be undefined only if this function is called immediately after
// adding the requirement to the tree (this is then the initial update).
// 'wasAdded' indicates whether the change is the result of adding or removing
// an element (this is undefined if 'byElement' is undefined).
// 'toElement' may be undefined if there is no match after the change.
// This function handles those aspects of the update which are not handled
// by the complement requirement object.
// Most of this function is implemented by two sub-functions, one for
// the case where the change is as a result of adding an element and one
// for the case where the change is as a result of removing an element.

ComplementEndOrderRequirement.prototype.updateElement =
    complementEndOrderRequirementUpdateElement;

function complementEndOrderRequirementUpdateElement(toElement, byElement,
                                                    pos, wasAdded)
{
    var fromElement = this.element; // the previous element
    this.element = toElement;

    if(byElement === undefined)
        // initial update, nothing more to do, as the parent complement
        // requirement object receives a full update.
        return;
    
    if(wasAdded)
        this.updateElementAdded(fromElement, toElement, byElement, pos);
    else
        this.updateElementRemoved(fromElement, toElement, byElement, pos);
}

// This function is called when 'toElement' has become the element which
// is matched by this requirement as a result of an element being added
// to the order tree.
// 'fromElement' is the element which was previously matched. 'byElement'
// is the element whose addition caused the change in the
// matched element (and 'pos' is the position, in the direction of the
// requirement, at which 'byElement' was added).
// Each of 'fromElement' and 'toElement' (or both) may be undefined if there
// was no match before/after the change.
// This function handles those aspects of the update which are not handled
// by the complement requirement object (see details inside function).

ComplementEndOrderRequirement.prototype.updateElementAdded =
    complementEndOrderRequirementUpdateElementAdded;

function complementEndOrderRequirementUpdateElementAdded(fromElement, toElement,
                                                         byElement, pos)
{
    var isCrossing = this.complementRequirement.isCrossing;

    // 'byElement' must have been added at or before this requiremnt
    // (in the direction of the requirement)
    if(!isCrossing) {
        var isOpen = this.isBackward ? this.highOpen : this.lowOpen;
        var addedAt = this.isBackward ?
            this.complementRequirement.highOffset + (isOpen ? -1 : 0) :
            this.complementRequirement.lowOffset + (isOpen ? 1 : 0);
        if(isOpen) {
            // the requirement points at the closed end, so it is the
            // previous element which was added
            this.complementRequirement.addElement(fromElement, addedAt);
        } else if(toElement !== byElement)
            // toElement === byElement this will be added by the
            // the complement requirement's updateAddElement()
            this.complementRequirement.addElement(toElement, addedAt);
    } else {
        // crossing, so an element was popped out of the range
        var removedAt = this.isBackward ?
            this.complementRequirement.getLowOffset() :
            this.complementRequirement.getHighOffset();
        
        if(removedAt === undefined)
            return; // range (before the change) is empty

        var isOpen = this.isBackward ? this.lowOpen : this.highOpen;
        
        if(isOpen) {
            // the requirement points at the closed end, so it is the
            // new element which is actually removed (unless it is equal
            // to 'byElement', in which case nothing changed)
            if(toElement !== byElement) {
                this.complementRequirement.
                    removeElement(toElement,
                                  removedAt + (this.isBackward ? 1 : -1));
            }
        } else
            this.complementRequirement.removeElement(fromElement, removedAt);
    }
}

// This function is called when 'toElement' has become the element which
// is matched by this requirement as a result of an element being removed
// from the order tree.
// 'fromElement' is the element which was previously matched. 'byElement'
// is the element whose removal caused the change in the
// matched element (and 'pos' is the position, in the direction of the
// requirement, at which 'byElement' was removed).
// Each of 'fromElement' and 'toElement' (or both) may be undefined if there
// was no match before/after the change.
// This function handles those aspects of the update which are not handled
// by the complement requirement object (see details inside function).

ComplementEndOrderRequirement.prototype.updateElementRemoved =
    complementEndOrderRequirementUpdateElementRemoved;

function complementEndOrderRequirementUpdateElementRemoved(fromElement,
                                                           toElement,
                                                           byElement, pos)
{
    // if the low and high offsets are equal, removing any element
    // would result in the requirement becoming crossing (a requirement
    // with equal low and high offsets is ambiguous between crossing and
    // not crossing).
    var isCrossing = this.complementRequirement.isCrossing ||
        (this.complementRequirement.lowOffset ==
         this.complementRequirement.highOffset);

    // 'byElement' must have been removed at or before this requirement
    // (in the direction of the requirement)
    
    if(!isCrossing) {
        var isOpen = this.isBackward ? this.highOpen : this.lowOpen;
        var removedAt = this.isBackward ?
            this.complementRequirement.highOffset + (isOpen ? -1 : 0) :
            this.complementRequirement.lowOffset + (isOpen ? 1 : 0);
        if(isOpen) {
            // the requirement points at the closed end, so it is the
            // new element which was removed from the range (it was previously
            // inside the range and now just outside it).
            this.complementRequirement.removeElement(toElement, removedAt);
        } else if(fromElement !== byElement)
            // fromElement === byElement will be removed by the
            // the complement requirement's updateRemoveElement()
            this.complementRequirement.removeElement(fromElement, removedAt);
    } else if(toElement === undefined) {
        // Must be crossing and the requirement match has just moved out of the
        // ordered set. This means that 'byElement' was removed from
        // the matched ordered set if it was within the offsets of the set.
        if(!this.isBackward) {
            if(pos > this.complementRequirement.lowOffset ||
               (!this.lowOpen && pos == this.complementRequirement.lowOffset))
                this.complementRequirement.removeElement(byElement, pos);
        } else if(pos < this.complementRequirement.highOffset ||
               (!this.highOpen && pos == this.complementRequirement.highOffset))
                this.complementRequirement.removeElement(byElement, pos);
    } else {
        // crossing, so an element was popped out of the range
        var addedAt = this.isBackward ?
            this.complementRequirement.getLowOffset() :
            this.complementRequirement.getHighOffset();
        
        if(addedAt === undefined)
            return; // range (after the change) is empty

        var isOpen = this.isBackward ? this.lowOpen : this.highOpen;
        
        if(isOpen) {
            // the requirement points at the closed end, so it is the
            // previous element at the closed end which moves into the
            // range, unless it is the node removed (in which case nothing
            // change din the range).
            if(fromElement !== byElement) {
                this.complementRequirement.
                    addElement(fromElement,
                               addedAt + (this.isBackward ? 1 : -1));
            }
        } else
            this.complementRequirement.addElement(toElement, addedAt);
    }
}

// This function is called when the element stored on the node on
// which this requirement is registered is replaced by another element,
// as a result of re-ordering the elements. 
// This function notifies the requirement of the new element
// now satisfying the requirement. In addition, it notifies it
// of elements which were moved across this requirement
// (for more details, see the introduction to this file).
// This function forwards these sets of elements to the parent range
// requirement node after determining which set of elements were added
// and which were removed: those moving from left to right or those
// moving from right to left. There is also need to correct for the
// element matched by the requirement (depending on the direction of
// movement and on whether the requirement offset is part of the range or not.
// While it may be that elements moving across the requirement from
// outside the range will be moved beyond the other end of the range,
// this corrected for by a call to the same function on the requirement for
// the other end node.

ComplementEndOrderRequirement.prototype.replacedElement =
    complementEndOrderRequirementReplacedElement;

function complementEndOrderRequirementReplacedElement(newElement, movedRight,
                                                      firstMovedRight,
                                                      movedLeft, firstMovedLeft)
{
    if(this.complementRequirement.isEmpty())
        return;

    var isCrossing = this.complementRequirement.isCrossing;
    
    if(!!this.isBackward == !!isCrossing) {

        // this requirement is the low end of the range

        // this is closed if either required to be closed or extends beyond
        // the end of the set (must be a backward requirement in this case)
        var isClosed = !this.complementRequirement.lowOpen ||
            (this.isBackward && this.offset >= this.orderedTree.getSize());
            
            (this.offset == this.complementRequirement.getLowOffset());
        
        this.complementRequirement.
            addElements(movedRight, firstMovedRight,
                        isClosed ? this.element : newElement);
        this.complementRequirement.
            removeElements(movedLeft, firstMovedLeft,
                           isClosed ? newElement : this.element);
    } else {
        
        // this requirement is the high end of the range

        // this is closed if either required to be closed or extends beyond
        // the end of the set (must be a forward requirement in this case)
        var isClosed = !this.complementRequirement.highOpen ||
            (!this.isBackward && this.offset >= this.orderedTree.getSize());
        
        this.complementRequirement.
            addElements(movedLeft, firstMovedLeft,
                        isClosed ? this.element : newElement);
        this.complementRequirement.
            removeElements(movedRight, firstMovedRight,
                           isClosed ? newElement : this.element);
    }
    
    this.element = newElement;
}

// This function is called when all elements are about to be removed
// from the order tree. Since this function is also called directly by
// the ordered tree on the complement requirement, all this function
// does is remove the current element stored on it.

ComplementEndOrderRequirement.prototype.clearAllElements =
    complementEndOrderRequirementClearAllElements;

function complementEndOrderRequirementClearAllElements()
{
    this.element = undefined;
}

// This function does not need to do anything, since the complement
// requirement is also called (directly by the ordered tree) to
// notify the listners.

ComplementEndOrderRequirement.prototype.notifyListeners =
    complementEndOrderRequirementNotifyListeners;

function complementEndOrderRequirementNotifyListeners()
{
    return;
}

//////////////////////////
// Relative Requirement //
//////////////////////////

/////////////////////////
// Element Requirement //
/////////////////////////

// This object implements the element requirement, as defined in the
// introduction to this file, supporting both the case where the requirement
// only needs to track the offset (forward or backward) of the anchor element
// and the case where the requirement must also track the elements in the
// range from the beginning of the ordering (in the forward/backward direction)
// to the anchor element (not included).
//
// The choice as to the anchor, the direction of ordering, whether the
// elements in the range ending at the anchor element need to be tracked
// and whether their order must be tracked must all be given upon
// construction. Any change in these parameters requires the removal
// of the old requirement and the creation of a new requirement (there is
// relatively little to gain here from incrementality).

//
// Object Structure
//

// {
//      anchor: <element>,
//      isBackward: true|false,
//
//      elementOffset: undefined|<number>
//      notifiedOffset: undefined|<number>
//
//      elementRangeRequirement: <ElementRangeRequirement>
// }
//
// anchor:
// isEnd:
// isBackward:
//     These arguments implement the interface with the ordered tree as
//     described in the introduction to this file. These three parameters
//     must be set upon construction and cannot be changed (there is
//     little advantage to changing them incrementally).
//
// elementOffset: this is the offset of the anchor element. It is undefined iff
//     the anchor element is not in the ordered set.
// notifiedOffset: this is the last offset which the listeners were notified
//     of. If 'elementOffset' differs from 'notifiedOffset' when the
//     notifyListeners() function is called, the listeners of the new
//     offset 'elementOffset' and 'notifiedOffset' is set to be equal
//     to 'elementOffset'.
// elementRangeRequirement: this object handles the update of the elements
//     in the range ending at the anchor element. This object is
//     only created when the requirement needs to track the elements in the
//     given range.
//

inherit(ElementRequirement, OrderRequirement);

// The constructor should be called with the anchor element and the
// isBackward arguments (see introduction to this file).
// These initial values cannot be modified later. In addition, if
// the requirement should track the range between the beginning of the ordering
// (in the specified direction) and the anchor element, 'isEnd' should
// be true. In thi case, if 'isOrderedRange' is true, the object also needs
// to track the ordering of the elements in the range. If 'isEnd' is true,
// 'orderedTree' must be provided and should be the order tree to which
// the requirement is registered. If 'isEnd' is false, 'orderedTree'
// is optionally provided. When the ordered tree is provided, the constructor
// registers the requirement to the ordered tree.

function ElementRequirement(anchor, isBackward, isEnd,
                            isOrderedRange, orderedTree)
{
    this.OrderRequirement();

    this.orderedTree = orderedTree; // may be undefined
    this.anchor = anchor;
    this.isBackward = !!isBackward;
    this.isEnd = !!isEnd;
    this.isOrderedRange = !!isOrderedRange;

    // position of element in ordered set (not yet known)
    this.elementOffset = undefined;
    this.notifiedOffset = undefined;

    if(isEnd)
        this.elementRangeRequirement = new ElementRangeRequirement(this);
    else
        this.elementRangeRequirement = undefined;

    if(this.orderedTree !== undefined)
        this.orderedTree.addAnchoredRequirement(this);
}

// This function destroys the requirement. If the ordered tree is accessible
// from the requirement object, it was also registered to the ordered tree
// (when the requirement was created) and therefore the destroy function
// removes the requirement from the ordered tree (otherwise, this is the
// responsibility of the calling function).

ElementRequirement.prototype.destroy = elementRequirementDestroy;

function elementRequirementDestroy()
{
    if(this.orderedTree !== undefined)
        this.orderedTree.removeAnchoredRequirement(this);
}

///////////////////////////////
// Updates from Ordered Tree //
///////////////////////////////

// This function is called when all elements are removed from the ordered tree.
// This is a special case of 'suspend()' (below) where the anchor is
// no longer in the orderd set.

ElementRequirement.prototype.clearAllElements =
    elementRequirementClearAllElements;

function elementRequirementClearAllElements()
{
    this.suspend();
}

// This function is called when the anchor element is (no longer) in the
// ordered tree. This means that the offset of the element in the
// ordered set becomes undefined and if this requirement also tracks
// the range of elements up to the anchor, this set of elements becomes
// empty.

ElementRequirement.prototype.suspend = elementRequirementSuspend;

function elementRequirementSuspend()
{
    this.elementOffset = undefined;
    if(this.elementRangeRequirement !== undefined)
        this.elementRangeRequirement.suspend();
}

// This function is called when the anchor is first found in the order tree
// (either when the requirement is registered to the ordered tree, if
// the anchor element is already in the order set, or when the anchor element
// is first added to the ordered set). 'offset' is the current position of
// the anchor element in the ordered set (in the forward or backward ordering,
// depending on 'this.isBackward').

ElementRequirement.prototype.setOffset =
    elementRequirementSetOffset;

function elementRequirementSetOffset(offset)
{
    this.elementOffset = offset;
}

// This function is called only if this requirement tracks the range of
// elements between the beginning of the ordering and the anchor element.
// This is implemented by the ElementRangeRequirement object.

ElementRequirement.prototype.addRangeElements =
    elementRequirementAddRangeElements;

function elementRequirementAddRangeElements(elements)
{
    if(this.elementRangeRequirement !== undefined)
        this.elementRangeRequirement.addRangeElements(elements);
}

// When this is called, the given element has just been inserted before
// the anchor (in the order of the requirement, that is before in forward
// ordering if 'this.isBackward' is false or after in forward ordering if
// 'this.isBackward' is true). This means that the offset of the anchor
// element has just increased by 1. If the range between the beginning of
// the set and the anchor is tracked, this element was added to this range.

ElementRequirement.prototype.updateAddElement =
    elementRequirementUpdateAddElement;

function elementRequirementUpdateAddElement(element)
{
    this.elementOffset++;
    if(this.elementRangeRequirement !== undefined)
        this.elementRangeRequirement.updateAddElement(element);
}

// When this is called, the given element has just been removed from before
// the anchor (in the order of the requirement, that is before in forward
// ordering if 'this.isBackward' is false or after in forward ordering if
// 'this.isBackward' is true). This means that the offset of the anchor
// element has just decreased by 1. If the range between the beginning of
// the set and the anchor is tracked, this element was removed from this range.

ElementRequirement.prototype.updateRemoveElement =
    elementRequirementUpdateRemoveElement;

function elementRequirementUpdateRemoveElement(element)
{
    this.elementOffset--;
    if(this.elementRangeRequirement !== undefined)
        this.elementRangeRequirement.updateRemoveElement(element);
}

// This function does nothing here, since the ordered range cannot be
// updated incrementally (once there is a change, it will be fully
// updated by being suspended and then being added again).

ElementRequirement.prototype.updateReorderedRange =
    elementRequirementUpdateReorderedRange;

function elementRequirementUpdateReorderedRange(lowOffset, highOffset)
{
    return;
}

// This function notifies the listeners registered to this requirement object
// of changes in the offset of the anchor element.

ElementRequirement.prototype.notifyListeners =
    elementRequirementNotifyListeners;

function elementRequirementNotifyListeners()
{
    if(this.elementOffset !== this.notifiedOffset) {
        // the offset changed since the last notification
        for(var i = 0, l = this.listeners.length ; i < l ; ++i)
            this.listeners[i].updateOffset(this.anchor, this.elementOffset);
    }

    this.notifiedOffset = this.elementOffset;

    if(this.elementRangeRequirement !== undefined)
        this.elementRangeRequirement.notifyListeners();
}

// If this requirement needs to track the range between the beginning of
// the ordering and the anchor element, this function is called by
// the ElementRangeRequirement object to notify the listeners of the
// matches added and removed. 'addedMatches' is an array holding the
// matches which were added and 'removedMatches' is an array holding the
// matches which were removed. Either of the two arrays may be undefined.
// If the requirement must also track the ordering inside the range,
// 'rangeElements' may optionally be a array with all elements in the range,
// ordered in the forward ordering. For more details, see the function
// 'notifyRangeOrder()' which handles the 'updatePos()' notifications
// on the listener.

ElementRequirement.prototype.notifyMatches = elementRequirementNotifyMatches;

function elementRequirementNotifyMatches(addedMatches, removedMatches,
                                         rangeElements)
{
    // push changes to listeners
    for(var i = 0, l = this.listeners.length ; i < l ; ++i) {
        var listener = this.listeners[i];
        if(removedMatches && removedMatches.length > 0)
            listener.removeMatches(removedMatches);
        if(addedMatches && addedMatches.length > 0)
            listener.addMatches(addedMatches);
    }

    if(this.isOrderedRange)
        this.notifyRangeOrder(rangeElements);
}

// If this requirement needs to track the ordering of the elements in
// the range between the beginning of the ordering and the anchor element,
// this function is called by the notifyMatches() function to notify
// the listeners of changes in the ordering of elements in this range.
// This function always provide the listeners with the full ordered set
// of elements in the range. Therefore, it is enough to call it with an
// undefined argument as an indication that the ordered range has changed.
// This function then fetches the ordered range from the ordered tree
// and notifies the listeners. However, after the first initial update,
// the ElementRangeRequirement can provide the full set of ordered elements,
// so to save the need to generate the array of elements again, these
// may be provided as the argument to this function.

ElementRequirement.prototype.notifyRangeOrder =
    elementRequirementNotifyRangeOrder;

function elementRequirementNotifyRangeOrder(rangeElements)
{
    var setSize = this.orderedTree.getSize();

    var lowOffset = undefined;
    var highOffset = undefined;
    
    if(this.notifiedOffset) {
        // not 0 or undefined (the range is not empty)
    
        // offsets in the forward direction
        lowOffset = this.isBackward ? setSize - this.notifiedOffset - 1 : 0;
        highOffset = this.isBackward ? setSize - 1 : this.notifiedOffset;
    
        // 'rangeElements' always in the forward direction
        if(rangeElements === undefined) {
            rangeElements =
                this.orderedTree.getRangeElementsByOffsets(lowOffset,
                                                           highOffset,
                                                           false);
        }
    } else // empty update
        rangeElements = [];
    
    for(var i = 0, l = this.listeners.length ; i < l ; ++i) {
        var listener = this.listeners[i];
        listener.updatePos(rangeElements, lowOffset, highOffset, setSize);
    }
}

// This function is for internal use by the ordered tree, not for external
// use. Therefore, it provides access to the latest offset, not te notified
// offset (see getOffset() below). This function returns the forward
// offsets of the range between the beginning of the ordering and the
// anchor. It is assumed that this is called only when the requirement is
// not suspended (the anchor is in the ordered set) and this requirement
// tracks the range. If either of these assumptions do not hold, this
// function returns undefined. Also, if the range is empty (the anchor is
// the first element in the ordering) this function returns undefined.

ElementRequirement.prototype.getForwardRange =
    elementRequirementGetForwardRange;

function elementRequirementGetForwardRange()
{
    if(!this.elementOffset) // undefined or 0
        return undefined;

    if(!this.isBackward)
        return [0,this.elementOffset-1];
    else {
        if(this.orderedTree === undefined)
            return undefined; // cannot access set size

        var setSize = this.orderedTree.getSize();

        return [setSize - this.elementOffset, setSize];
    }
}

// This function returns the last offset notified by this requirement
// to the listeners. This may not be the most up to date value, and
// a call to notifyListeners() is required to get the most up to date offset
// value (but notifyListeners() will only push a new value if it differs from
// the existing value).

ElementRequirement.prototype.getOffset =
    elementRequirementGetOffset;

function elementRequirementGetOffset()
{
    return this.notifiedOffset;
}

///////////////////////////////
// Element Range Requirement //
///////////////////////////////

// This object is a sub-object of the ElementRequirement object which
// implements the functionality needed to track the range of elements
// between the beginning of the ordering (forward or backward) and the anchor.
// When the requirement needs to track this range, this object is
// created and attached to the ElementRequirement object, which then
// passes on to it all relevant updates received from the order tree.
//
// Currently, in case 'isOrderRange' is set (the order inside the range
// needs to be tracked) the requirement does not know the range of offsets
// affected by adding elements, removing element or reordering them.
// Therefore, when anything changes, the updatePos() function of the
// listeners is always called with the complete new fully ordered range.
// This may be somewhat sub-optimal is some cases, but in most cases
// any in the elements or ordering of the range would cause almost all elements
// in the range to move.

//
// Object Structure
//

// {
//     requirement: <ElementRequirement>,
//     notifiedMatches: <Map>{
//         <element>: true,
//         .....
//     },
//
//     addedMatches: <Map>{
//         <element>: true,
//         .....
//     },
//     removedMatches: <Map>{
//         <element>: true,
//         ......
//     }
//     isSuspended: false|true
//
//     orderedRange: <array of elements>
// }
//
// requirement: this is the ElementRequirement which is the owner of
//     this object. It is the owner ElementRequirement object which
//     is registered into the ordered tree and which delivers the notifications
//     to the listeners.
//
// notifiedMatches: this is the current full list of matches, as reported to
//     the listeners in the last notification. In case of reordering,
//     the requirement object does not receive full incremental updates
//     from the order tree but, instead, simply receives a notification
//     with the new range. To be able to provide the listeners with
//     an incremental notification of the change in matches, the requirement
//     object must track the set of matches.
//
// addedMatches: this is a map whose keys are all elements which were
//     added to the range during an update cycle. At the end of the update
//     cycle, the listeners' 'addMatches()' function is called with this list
//     of elements and the list is cleared. When an element is added
//     to this table and then later removed within the same update cycle
//     (that is, without notify the listeners in between) that element is
//     removed from the 'addedMatched' list. An element cannot
//     be added or removed twice consecutively from this table. Therefore,
//     there is no need to count the number of additions and removals
//     but simply add or remove the entry (compare this to the situation
//     with 'removedMatches' where a count is sometimes needed).
//     
// removedMatches: this is a map whose keys are all elements which were
//     removed from the range during an update cycle. At the end of the
//     update cycle, the listeners' 'removeMatches()' function is called
//     with this list of elements and the list is cleared. When an element
//     is added to this table and then later added back into the range within
//     the same update cycles (that is, without notify the listeners in
//     between) that element is removed from the 'removedMatched' list.
//     An element cannot be added or removed twice consecutively from
//     this table. Therefore, there is no need to count the number of
//     additions and removals but simply add or remove the entry
//     (compare this to the situation with 'removedMatches' where a
//     count is sometimes needed).
// isSuspended: this is set to true when the requirement is suspended.
//     This saves the need to store all elements in the 'notifiedMatches' table
//     in the 'removedMatches' table.
//     If 'orderedRange' is not undefined, this also means that all previous
//     matches were removed and that the array in 'orderedRange' is the
//     new set of matches.
//
// orderedRange: when the element requirement needs to keep track of the
//     range between the beginning of the order (forward or backward) and
//     the anchor element, the initial registration of the requirement
//     to on the element in the order tree (when the requirement is
//     added when the anchor was already in the ordered set or when the
//     anchor element is added to the ordered set) send a notification
//     containing a list of all elements in the range (sorted if
//     'isOrderedRange' is true). This list is stored here until the listeners
//      need to be updated. If additional updates are received before
//     the listeners are notified, this list is discarded (and will have to
//     be fetched again when the listeners are notified).
//     This notification is also received when, as a result of reordering,
//     the position of the anchor element changes, in which case the
//     requirement is removed and inserted back into the order tree.
//     The full array of elements in the range is then received here. 

//
// Constructor
//

// The constructor is called with 'elementRequirement' which is the
// ElementRequirement object that is the owner of this object.

function ElementRangeRequirement(elementRequirement)
{
    this.requirement = elementRequirement;
    
    this.notifiedMatches = new Map();
    this.addedMatches = new Map();
    this.removedMatches = new Map();
    this.isSuspended = true; // initially, suspended
    
    this.orderedRange = undefined;
}

///////////////////////////////
// Updates from Ordered Tree //
///////////////////////////////

// This function is called when the anchor element is (no longer) in the
// ordered tree. This means that the set of matched elements becomes
// empty.

ElementRangeRequirement.prototype.suspend = elementRangeRequirementSuspend;

function elementRangeRequirementSuspend()
{
    this.isSuspended = true;
    this.addedMatches.clear();
    this.removedMatches.clear();
    this.orderedRange = undefined;
}

// This function is called when the requirement is first registered to
// the order tree. 'elements' is then an array of elements containing
// all elements between the beginning of the ordering (forward or backward,
// depending on the 'isBackward' of the requirement) and the anchor
// (not including the anchor). If the requirement is also required to
// track the order of the elements in the range, the array is guaranteed
// to be ordered (always in forward direction). This function determines
// the range of forward offsets of the elements added and stores the array.
// This function may also be called when the requirement is re-registered
// after a reordering.

ElementRangeRequirement.prototype.addRangeElements =
    elementRangeRequirementAddRangeElements;

function elementRangeRequirementAddRangeElements(elements)
{
    // store the initial list
    this.orderedRange = elements;
    this.isSuspended = false;
    this.addedMatches.clear();
    this.removedMatches.clear();
}

// The given element was added to the range

ElementRangeRequirement.prototype.updateAddElement =
    elementRangeRequirementUpdateAddElement;

function elementRangeRequirementUpdateAddElement(element)
{
    if(this.isSuspended)
        return; // will receive a full update through 'addRangeElements()'

    if(this.orderedRange !== undefined)
        // first incremental update after initial update, convert initial
        // update into an incremental update.
        this.setAddedAndRemovedMatches();

    if(this.removedMatches.size > 0 && this.removedMatches.has(element))
        // was just removed and now being added back
        this.removedMatches.delete(element);
    else
        this.addedMatches.set(element, true);
}

// The given element was removed from the range

ElementRangeRequirement.prototype.updateRemoveElement =
    elementRangeRequirementUpdateRemoveElement;

function elementRangeRequirementUpdateRemoveElement(element)
{
    if(this.isSuspended)
        return; // will receive a full update through 'addRangeElements()'

    if(this.orderedRange !== undefined)
        // first incremental update after initial update, convert initial
        // update into an incremental update.
        this.setAddedAndRemovedMatches();

    if(this.addedMatches.size > 0 && this.addedMatches.has(element))
        // was just removed and now being added back
        this.addedMatches.delete(element);
    else
        this.removedMatches.set(element, true);
}

// This function is called on the first incremental updated after the
// initial update. It takes the matches in 'orderedRange' (which are
// the full range at the time of the initial update) and compares
// them with the elements already notified to the listener (those
// are the elements in 'notifiedMatches'). It translates the comparison
// of these two lists into the matches added and removed (relative to
// the notified matches) and stores these in 'addedMatches' and
// 'removedMatches' (these lists will then be used to update the listeners).

ElementRangeRequirement.prototype.setAddedAndRemovedMatches =
    elementRangeRequirementSetAddedAndRemovedMatches;

function elementRangeRequirementSetAddedAndRemovedMatches()
{
    if(this.orderedRange === undefined)
        return;

    if(this.notifiedMatches.size === 0) {
        for(var i = 0, l = this.orderedRange.length ; i < l ; ++i)
            this.addedMatches.set(this.orderedRange[i], true);
        this.orderedRange = undefined;
        return;
    }
    
    var remaining = new Map();
    
    for(var i = 0, l = this.orderedRange.length ; i < l ; ++i) {
        var element = this.orderedRange[i];

        if(!this.notifiedMatches.has(element))
            this.addedMatches.set(element, true);
        else
            remaining.set(element, true);
    }

    var _self = this;
    this.notifiedMatches.forEach(function(t, element) {
        if(remaining.has(element))
            return;
        _self.removedMatches.set(element, true);
    });

    this.orderedRange = undefined;
}

// This function is called when the notifyListeners() function of the owner
// requirement is called. It then calculates the lists of elements added
// and removed from the range since the previous update of the listeners
// and then calles the owner requirement with these lists to update
// the listeners. This function then also updates the list of
// 'notifiedMatches', the matches for which the listeners were notified.

ElementRangeRequirement.prototype.notifyListeners =
    elementRangeRequirementNotifyListeners;

function elementRangeRequirementNotifyListeners()
{
    if(this.isSuspended) {
        if(this.notifiedMatches.size === 0)
            return; // nothing changed
        var removedMatches = [];
        this.notifiedMatches.forEach(function(t, element) {
            removedMatches.push(element);
        });
        this.requirement.notifyMatches(undefined, removedMatches,
                                       undefined);
        this.notifiedMatches.clear();
        return;
    }
    
    if(this.orderedRange !== undefined) { // initial update
        if(this.notifiedMatches.size === 0) {
            // elements only added
            this.requirement.notifyMatches(this.orderedRange, undefined,
                                           this.orderedRange);
            for(var i = 0, l = this.orderedRange.length ; i < l ; ++i)
                this.notifiedMatches.set(this.orderedRange[i], true);
            this.orderedRange = undefined;
            return;
        } else {
            // check which elements were removed and which were added
            var remaining = new Map();
            var addedMatches = [];
            var removedMatches = [];
    
            for(var i = 0, l = this.orderedRange.length ; i < l ; ++i) {
                var element = this.orderedRange[i];
                if(!this.notifiedMatches.has(element))
                    addedMatches.push(element);
                else
                    remaining.set(element, true);
            }

            var _self = this;
            this.notifiedMatches.forEach(function(t, element) {
                if(remaining.has(element))
                    return;
                removedMatches.push(element);
                _self.notifiedMatches.delete(element);
            });

            this.requirement.notifyMatches(addedMatches, removedMatches,
                                           this.orderedRange);

            for(var i = 0, l = addedMatches.length ; i < l ; ++i)
                this.notifiedMatches.set(addedMatches[i], true);
            this.orderedRange = undefined;
            return;
        }
    }

    var addedMatches = [];
    var removedMatches = [];
    var _self = this;
    
    this.addedMatches.forEach(function(t, element) {
        addedMatches.push(element);
        _self.notifiedMatches.set(element, true);
    });

    this.removedMatches.forEach(function(t, element) {
        removedMatches.push(element);
        _self.notifiedMatches.delete(element);
    });

    this.requirement.notifyMatches(addedMatches, removedMatches, undefined);
    this.addedMatches.clear();
    this.removedMatches.clear();
}
