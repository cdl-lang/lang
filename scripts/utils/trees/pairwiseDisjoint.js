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


// This object checks whether a set of intervals (each defined by two
// end-points where each may be open or closed) are pairwise disjoint or not.
// In addition, it constructs an equivalent set of intervals which
// are pairwise disjoint and such that any interval in the original
// set which is disjoint from all other intervals keeps its original ID.
// 
// This is implemented by sorting the end points of the ranges
// lexicographically by the following criteria:
//
// 1. the value of the end point (lower values first)
// 2. points with the same value are sorted based on whether they
//    are the start or end of the range and on whether they are open
//    or closed, in the following order:
//    a. end open
//    b. start closed
//    c. end closed
//    d. start open
//    This means that if the start of one range has the same value
//    as the end of another range, the start point will appear first
//    only if both points are closed.
//    (note that a trivial range where both end points have the same
//    value must be closed on both sides and therefore has its points
//    sorted in the correct order).
//
// As long as the ranges are disjoint, the start and end points
// alternate in the sorted list. Once there is an overlap, there must be
// two consecutive start points in the list. The object keeps track of
// the number of start points which are immediately followed by a start
// point. The ranges are disjoint iff this number is non-zero.
//
// The object is derived from a red-black tree object (the value comparison
// function can be provided upon construction). The keys of the nodes in
// the tree are the end point values. The value stored under each key
// has the following format:
// {
//    endOpen: <number>,
//    startClosed: <number>,
//    endClosed: <number>,
//    startOpen: <number>,
//
//    startCountOpen: <number>,
//    startCountClosed: <number>
//    openEndIds: [<array of IDs>],
//    closedEndIds: [<array of IDs>]
// }
//
// endOpen, startClosed, endClosed, startOpen:
//    Each of these four fields in this object represents the number
//    of points of the corresponding type which have this value.
// startCountOpen: this is the number of intervals which have been
//    opened but not yet closed in the sequence of end points immediately
//    after the 'endOpen' points of this node.
//    This is equal to the 'startCountClosed' of the previous node (or zero
//    if this is the first node) + 'startOpen' of the previous node -
//    'endOpen' of this node.
// startCountClosed: this is the number of intervals which have been
//    opened but not yet closed in the sequence of end points immediately
//    after the 'endClosed' points of this node.
//    This is equal to the 'startCountOpen' property of this node +
//    'startClosed' - 'endClosed'
// openEndIds: list of IDs of intervals which have their open end at this node.
//    Each new ID is added at the end of this list.
// closedEndIds: list of IDs of intervals which have their closed end at
//    this node. Each new ID is added at the end of this list.
//
// We define the following properties of the node:
// startsWithStart() == true iff (endOpen == 0 and startClosed > 0)
//    or (endOpen == 0 and startClosed == 0 and endClosed == 0 and
//        startOpen > 0)
// endsWithStart() == true iff (startOpen > 0) or
//    (startOpen == 0 and endClosed == 0 and startClosed > 0)
//
// The object adds the following fields to the base RedBalckTree object:
//
// {
//    startFollowedByStart: <number>,
//    generateDisjointIntervals: true|false
//
//    justNowRestored: <array of interval IDs>
// }
//
// startFolllowedByStart: this is the number of start end-points stored in
//    the tree which are immediately followed by a start end-point.
//    For each node stored in the tree, 'startFolllowedByStart' is increased
//    by:
//    startClosed - 1 (if startClosed > 1)
//    startOpen - 1 (if startOpen > 1)
//    1 if startClosed > 0 and startOpen > 0 but endClosed == 0
//    1 if startsWithStart(<node>) and endsWithStart(<previous node>)
// generateDisjointIntervals: if this flag is set, then this object,
//    in addition to testing whether the set of intervals is pairwise disjoint,
//    also generates a set of pairwise disjoint intervals whose union is
//    equal to the union of the original intervals and such that every
//    interval in the original set of intervals which is disjoint from
//    all other intervals also appears in the generated pairwise disjoint
//    set and with the same ID. See below for more details.
//
// justNowRestored: this field is used to temporarily store the list of
//    intervals restored to the disjoint set by the removal operation
//    which is the first step in an interval modification operation.
//    This is needed by the functions which handle the addition of the
//    interval in teh second step of the modification operation.
//    This field is cleared before the end of the modification operation.
//
// When 'generateDisjointIntervals' is true, in addition to
// maintaining the 'startFollowedByStart' count which indicates
// whether there are overlapping intervls in the set (iff this count
// is not zero) this object also allows one to read a list of pairwise
// disjoint intervals whose union is equal to the union of the
// intervals added to this object. Any interval in the original set
// which is disjoint of all other intervals also appear without change
// in the pairwise disjoint set. Specifically, two intervals [x,y) and
// [y,z] (or [x,y], (y,z]) will not be combined into a single interval
// but will remain separate intervals.
//
// The end points of the intervals in the pairwise disjoint set are calculated
// based on the 'startCountOpen' and 'startCountClosed' properties of the
// nodes. Whenever this count reaches zero, there is an end-point of an
// interval at this node. If the 'endOpen' or 'endClosed' property is
// non-zero just before this zero count ('startCountOpen' and
// 'startCountClosed', respectively) the point is an end end-point, while it
// the 'startClosed' or 'startOpen' property is non-zero just after
// this zero count ('startCountOpen' and 'startCountClosed', respectively)
// the point is a start end-point. The same point may be both the end of
// an interval and the start of the next interval.
//
// The ID assigned to an interval in the pairwise disjoint set is based
// on their end point. An interval ending at a 'startCountOpen' == 0
// will use the ID of one of the intervals which has an open end at that
// value and an interval ending at a 'startCountClosed' == 0 will
// use the ID of one of the intervals which has a closed end at that
// value. These IDs are stored in 'openEndIds' and 'closedEndIds'
// respectively, and we use the first ID in each of these lists.

// %%include%%: "redBlackTree.js"
// %%include%%: <scripts/utils/intervalUtils.js>

inherit(PairwiseDisjoint, RedBlackTree);

// The constructor takes a flag 'generateDisjointIntervals' which indicates
// whether, in addition to testing whether the intervals are disjoint, this
// object should also generate an equivalent set of pairwise disjoint
// intervals. The second argument is an optional comparison function.

function PairwiseDisjoint(generateDisjointIntervals, compareFunc)
{
    this.RedBlackTree(compareFunc);
    this.startFollowedByStart = 0;
    this.generateDisjointIntervals = !!generateDisjointIntervals;
}

// This function returns true if the set of intervals currently stored
// in this object are pairwise disjoint.

PairwiseDisjoint.prototype.isDisjoint = pairwiseDisjointIsDisjoint;

function pairwiseDisjointIsDisjoint()
{
    return (this.startFollowedByStart == 0);
}

// This function receives the ID of an interval stored in this object
// together with its end end-point ('endValue' is the value of this
// point and 'endOpen' indicates whether it is open or closed). The
// function returns true if an interval with this ID is part of the
// pairwise disjoint interval set representing the set stored in this
// object. This happens if either the original set of intervals is
// pairwise disjoint or if the 'generateDisjointIntervals' mode is on
// and the end end-point of the interval with the given ID is an end
// end-point of an interval in the generate pairwise disjoint set and
// its ID is the first in the list of IDs of intervals which end at
// the same point (including the open/closed property).
// If the original set is not pairwise disjoint and
// the 'generateDisjointIntervals' mode is off, this function returns
// undefined.
// This function should probably only be used when
// the 'generateDisjointIntervals' mode is on.

PairwiseDisjoint.prototype.isDisjointInterval =
    pairwiseDisjointIsDisjointInterval;

function pairwiseDisjointIsDisjointInterval(id, endValue, endOpen)
{
    if(this.isDisjoint())
        return true;

    var endNode = this.find(endValue);

    return this.isDisjointId(id, endNode, endOpen);
}

// This function receives the ID of an interval stored in this object
// together with the node which stores the end end-point of this interval
// and a flag 'endOpen' which indicates whether the end of the interval
// is open or closed. The function returns true if an interval with this
// ID is part of the pairwise disjoint interval set representing the
// set stored in this object. This happens if either the original set of
// intervals is pairwise disjoint or if the 'generateDisjointIntervals'
// mode is on and the end end-point of the interval with the given ID is
// an end end-point of an interval in the generate pairwise disjoint set
// and its ID is the first in the list of IDs of intervals which end at
// the same point (including the open/closed property).
// If the original set is not pairwise disjoint and
// the 'generateDisjointIntervals' mode is off, this function returns
// undefined.
// This function should probably only be used when
// the 'generateDisjointIntervals' mode is on.

PairwiseDisjoint.prototype.isDisjointId =
    pairwiseDisjointIsDisjointId;

function pairwiseDisjointIsDisjointId(id, endNode, endOpen)
{
    if(this.isDisjoint())
        return true;
    
    if(!this.generateDisjointIntervals)
        return undefined;
    
    if(endOpen)
        return (endNode.value.startCountOpen == 0 &&
                endNode.value.openEndIds[0] == id);

    return (endNode.value.startCountClosed == 0 &&
            endNode.value.closedEndIds[0] == id);
}

// This function returns true if the given end point (given by the node
// 'endNode' and 'endOpen' which indicates whether the end point is open
// or closed) is the end of an interval in the disjoint interval set.

PairwiseDisjoint.prototype.isDisjointEnd =
    pairwiseDisjointIsDisjointEnd;

function pairwiseDisjointIsDisjointEnd(endNode, endOpen)
{
    if(endOpen)
        return (endNode.value.endOpen > 0 && endNode.value.startCountOpen == 0);

    return (endNode.value.startCountClosed == 0);
}

// This function gets the node in the binaray tree for the given key.
// If the node does not exist, it is created. In addition, if the
// node does not yet have a value object (in case the node is new)
// the value object is created and initialized. The exact value object
// created depends on the fields required by the mode in which the
// object is in (e.g. 'generateDisjointIntervals').

PairwiseDisjoint.prototype.getIntervalNode = pairwiseDisjointGetIntervalNode;

function pairwiseDisjointGetIntervalNode(key)
{
    var node = this.insertKey(key);
    
    if(node.value !== undefined)
        return node;

    if(!this.generateDisjointIntervals) {
        node.value = { endOpen: 0, startClosed: 0, endClosed: 0,
                       startOpen: 0 };
        return node;
    }
    
    var prevStartCount = node.prev ?
        (node.prev.value.startCountClosed + node.prev.value.startOpen) : 0;
    node.value = { endOpen: 0, startClosed: 0, endClosed: 0,
                   startOpen: 0, startCountOpen: prevStartCount,
                   startCountClosed: prevStartCount };
    return node;
}

////////////////////////////
// Testing (external API) //
////////////////////////////

// This function, which may be called by external modules, checks whether
// the given value 'value' falls inside any of the ranges already added to
// this object (in which case the function returns false) or not
// (in which case the function returns true).

PairwiseDisjoint.prototype.isDisjointValue =
    pairwiseDisjointIsDisjointValue;

function pairwiseDisjointIsDisjointValue(value)
{
    // find the node in the tree which carries the smallest value
    // which is larger or equal the given value
    var node = this.find(value);

    if(node === undefined)
        return true; // beyond the last range
    
    if(this.compare(node.key, value) == 0)
        return (node.value.startCountOpen == 0 && node.value.startClosed == 0);
    else
        return (node.value.startCountOpen == 0 && node.value.endOpen == 0);
}

// This function, which may be called by external modules, checks whether
// the range given by the arguments of this function intersects with any
// ranges recorded into this object.

PairwiseDisjoint.prototype.isDisjointRange =
    pairwiseDisjointIsDisjointRange;

function pairwiseDisjointIsDisjointRange(startValue, startOpen, endValue,
                                         endOpen)
{
    var degenerate = (this.compare(startValue, endValue) == 0);

    if(degenerate) {
        if(startOpen || endOpen)
            return true; // empty set is always disjoint
        return this.isDisjointValue(startValue);
    }
    
    // find the node in the tree which carries the smallest value
    // which is larger or equal the start value
    var node = this.find(startValue);
    
    if(node === undefined)
        return true; // beyond the last range

    var cmpStart = this.compare(startValue, node.key);
    var nodeValue = node.value;
    
    if(cmpStart == 0) {

        if(!startOpen && (nodeValue.startCountOpen != 0 ||
                          nodeValue.startClosed != 0 ||
                          nodeValue.startOpen != 0))
            return false;
        if(startOpen && (nodeValue.startCountClosed != 0 ||
                         nodeValue.startOpen != 0))
            return false;

        if(node.next === undefined)
            return true; // no range extends beyond this point
        
    } else {
        if(nodeValue.startCountOpen != 0 || nodeValue.endOpen != 0)
            return false;

        var cmpEnd = this.compare(endValue, node.key);
        if(cmpEnd < 0)
            return true;
        else if(cmpEnd == 0)
            return (endOpen || nodeValue.startClosed == 0);

        return false; // the start node must fall inside the range
    }

    // from here on: 'node' is exactly at the start of the range
    // but there is a neighborhood of the beginning of the
    // range which is not inside another range.

    var cmpNext = this.compare(endValue, node.next.key);

    if(cmpNext > 0)
        return false; // next node falls inside the range
    else if(cmpNext < 0)
        return true;

    // last remaining possibility: an overlapping range which begins
    // at 'node.next' (both ends must be closed)

    return (endOpen || node.next.value.startClosed == 0);
}

// Given an interval defined by a start and end value and two booleans
// indicating whether the interval is open or closed on each side, this
// function checks whether there is an interval in the PairwiseDisjoint
// structure which intersects with the given interval and if there is
// such an interval, this function returns the ID of the disjoint
// interval (in the PairwiseDisjoint structure) which intersects with
// the given interval and contains th highest value of all these intervals.
// The function either returns the ID of the interval found or undefined
// (if no such interval was found).

PairwiseDisjoint.prototype.getCoveringIntervalId =
    pairwiseDisjointGetCoveringIntervalId;

function pairwiseDisjointGetCoveringIntervalId(startValue, startOpen, endValue,
                                               endOpen)
{
    if(this.root === undefined)
        return undefined;
    
    var degenerate = (this.compare(startValue, endValue) == 0);
    
    if(degenerate && (startOpen || endOpen))
        return undefined; // empty set is always disjoint
    
    // find the node in the tree which carries the smallest value
    // which is larger or equal the end value
    var node = this.find(endValue);

    if(node !== undefined) {
        var cmpEnd = this.compare(endValue, node.key);
        var covering;
        if(cmpEnd == 0) {
            covering = this.findCoveringDisjointInterval(node, endOpen);
            if(covering !== undefined)
                return covering.id;
            if(degenerate) // covering interval would have been returned
                return undefined;
            if(!endOpen && node.value.endOpen > 0)
                // there is an interval ending at this point which is open
                // and overlaps (such an interval is not returned above).
            return node.value.openEndIds[0];
        }
        
        if(node.prev === undefined)
            return undefined;
        
        var prevValue = node.prev.value;
        if(prevValue.startOpen > 0 || prevValue.startCountClosed > 0) {
            covering = this.findCoveringDisjointInterval(node, true);
            return (covering === undefined) ? undefined : covering.id;
        }

        node = node.prev;
    } else
        node = this.last;

    // 'node' must be before the end value and there is no interval
    // covering the end value (so all intervals at 'node' must end there).
    
    if(degenerate)
        return undefined; // no matching interval
    
    var cmp = this.compare(startValue, node.key);
    if(cmp > 0)
        return undefined; // full range beyond node, so no intersection
    var value = node.value;
    if(cmp < 0) { // overlap
        return value.endClosed > 0 ?
            value.closedEndIds[0] : value.openEndIds[0];
    } else { // cmp == 0
        if(startOpen || value.endClosed == 0)
            return undefined;
        return node.value.closedEndIds[0];
    }
}

/////////////////////////////////////
// Update Functions (external API) //
/////////////////////////////////////

// This function should be called to add an interval to this
// structure.  'startValue' is the value at which the interval starts
// and 'endValue' is the value at which the interval ends (it is
// required that 'startValue' <= 'endValue'). 'startOpen' and
// 'startClosed' should be true if the start (respectively, end) point
// is open and false if it is closed.
// 'id' is the ID of the interval being added.
// If the interval is empty (the two end points are equal and at least one of
// them is open) the interval is ignored.
// This function adds the interval to the structure and updates
// all properties which are dependent on this modification.
// When the 'generateDisjointIntervals' mode is off, this function does
// not return any value.
// When the 'generateDisjointIntervals' mode is on, this function returns
// a value which indicates how the set of pairwise disjoint interval
// has changed as a result of adding this interval.
// In this case, if the function returns undefined, then the addition of
// the interval did not change any other interval and the interval itself
// is added, as is, to the set of pairwise disjoint intervals.
// In all other cases (and assuming the 'generateDisjointIntervals' mode is on)
// the function returns the following structure:
// {
//     removedIntervals: <array of interval IDs>,
//     coveringInterval: {
//         id: <interval ID>
//         startValue: <value at which the interval starts>
//         startOpen: true|false // whether this interval starts open
//         endValue: <value at which the interval ends>
//         endOpen: true|false // whether this interval ends open 
//     }
// }
// 'removedIntervals' is the list of all intervals which were in the
// pairwise disjoint set before this interval addition operation took
// place, but are no longer in this set after the operation took place.
// 'coveringInterval' is a description of the interval in the pairwise
// disjoint interval set which covers the interval just added. This
// may be equal to the interval just added, or larger (and may have the
// same ID as the interval just added or a different ID).

PairwiseDisjoint.prototype.addInterval = pairwiseDisjointAddInterval;

function pairwiseDisjointAddInterval(startValue, startOpen, endValue,
                                     endOpen, id)
{
    var degenerate = (this.compare(startValue, endValue) == 0);
    if(degenerate && (startOpen || endOpen))
        return undefined; // empty interval, not added

    // get and initialize the nodes, if needed
    var startNode = this.getIntervalNode(startValue);
    var endNode = degenerate ? startNode : this.getIntervalNode(endValue);
    // update start point
    this.updateStart(startNode, startOpen, true);
    // update end point
    this.updateEnd(endNode, endOpen, true);

    if(!this.generateDisjointIntervals)
        return;

    // update the start count (and detect which disjoint intervals are
    // no longer in the disjoint set)
    var removedIntervals = [];
    this.extendStartCount(startNode, startOpen, endNode, endOpen,
                          removedIntervals);
    
    // insert the ID into the list of end IDs
    // Typically, it is added last, so as not to replace an existing
    // interval ID which is in the disjoint set. However, if we are
    // in the midst of an interval modification operation and the
    // current disjoint interval which ends at the same point as the
    // interval being added here has just been restored by the removal
    // which took place in the modification operation, we insert
    // the ID as first and add the current ID of the disjoint interval
    // to the list of intervals to be removed.
    var value = endNode.value;
    if(endOpen) {
        if(value.openEndIds === undefined)
            value.openEndIds = [id];
        else if(this.isJustRestoredDisjointEnd(endNode, endOpen)) {
            removedIntervals.push(value.openEndIds[0]);
            value.openEndIds.splice(0,0,id);
        } else
            value.openEndIds.push(id);
    } else {
        if(value.closedEndIds === undefined)
            value.closedEndIds = [id];
        else if(this.isJustRestoredDisjointEnd(endNode, endOpen)) {
            removedIntervals.push(value.closedEndIds[0]);
            value.closedEndIds.splice(0,0,id);
        } else
            value.closedEndIds.push(id);
    }

    if(this.isDisjoint() ||
       (removedIntervals.length == 0 &&
        this.isDisjointId(id, endNode, endOpen)))
        // no other interval changed and this interval added as is to
        // the pairwise disjoint set
        return undefined;

    return {
        removedIntervals: removedIntervals,
        coveringInterval: this.findCoveringDisjointInterval(endNode, endOpen)
    };
}

// This function should be called to remove an interval previously added
// to this structure. It is up to the calling function to make sure
// that this interval was indeed previously added.
// 'startValue' is the value at which the interval starts and
// 'endValue' is the value at which the interval ends (it is required
// that 'startValue' <= 'endValue'). 'startOpen' and 'startClosed' should
// be true if the start (respectively, end) point is open and false
// if it is closed.
// 'id' is the ID of the interval being removed. It is up to the calling
// function to make sure that the ID indeed matches the end points previously
// registered for this ID.
// If the interval is empty (the two end points are equal and at least one of
// them is open) the interval is ignored.
// This function removes the interval from the structure and updates
// all properties which are dependent on this modification.
// When the 'generateDisjointIntervals' mode is off, this function does
// not return any value.
// When the 'generateDisjointIntervals' mode is on, this function returns
// a value which indicates how the set of pairwise disjoint interval
// has changed as a result of removing this interval.
// In this case, if the function returns undefined, then the removal of
// the interval did not change any other interval and the interval itself
// was removed, as is, from the set of pairwise disjoint intervals.
// In all other cases (and assuming the 'generateDisjointIntervals' mode is on)
// the function returns the following structure:
// {
//     restoredIntervals: <array of interval discriptions of the form:
//        {
//            id: <interval ID>
//            startValue: <value at which the interval starts>
//            startOpen: true|false // whether this interval starts open
//            endValue: <value at which the interval ends>
//            endOpen: true|false // whether this interval ends open 
//        }
//     >,
//     modifiedInterval: undefined | {
//         id: <interval ID>
//         startValue: <value at which the interval starts>
//         startOpen: true|false // whether this interval starts open
//         endValue: <value at which the interval ends>
//         endOpen: true|false // whether this interval ends open 
//     }
// }
// The list of intervals described in 'restoredIntervals' is a list of
// intervals which were not previously part of the pairwise disjoint set
// of intervals but which, following the removal, are now part of the
// pairwise disjoint set (before the removal, the interval just removed
// overlapped with these intervals, resulting in their removal from the
// pairwise disjoint set.
// 'modifiedInterval' is a description of an interval which was in
// in the pairwise disjoint set before the removal operation and
// covered the removed interval before the removal operation and has changed
// as a result of this operation. If this is undefined, then the interval
// covering the removed interval remains unchanged after the operation.
// If the ID provided under 'modifiedInterval' is the same as that of
// the interval just removed, then the interval was removed
// (the object does not specify its endpoint then). If the ID is different
// from that of the interval just removed, the object specifies the
// end-points of the interval after the removal.

PairwiseDisjoint.prototype.removeInterval = pairwiseDisjointRemoveInterval;

function pairwiseDisjointRemoveInterval(startValue, startOpen, endValue,
                                        endOpen, id)
{
    var degenerate = (this.compare(startValue, endValue) == 0);
    if(degenerate && (startOpen || endOpen))
        return undefined; // empty interval, was not added

    var modifications;
    if(this.generateDisjointIntervals && !this.isDisjoint()) {
        // need to report modifications only if the set is not pairwise disjoint
        // and the object generates a pairwsie disjoint set.
        modifications =  { restoredIntervals: [] };
    }
    
    var startNode = this.find(startValue);
    var endNode = degenerate ? startNode : this.find(endValue);

    if(modifications) {
        if(this.isDisjointId(id, endNode, endOpen))
            // the interval is in the pairwise disjoint set, so we report it
            // as the interval modified by this operation
            modifications.modifiedInterval = { id: id }
    }
    
    // update start point
    this.updateStart(startNode, startOpen, false);
    // update end point
    this.updateEnd(endNode, endOpen, false);
    
    if(this.generateDisjointIntervals) {
        var restoredIntervals = [];
        var restoredStartPoints = [];
        this.reduceStartCount(startNode, startOpen, endNode, endOpen,
                              restoredIntervals, restoredStartPoints);
        
        // remove the ID from the list of end IDs
        var ids =
            endOpen ? endNode.value.openEndIds : endNode.value.closedEndIds;
        for(var i = 0, l = ids.length ; i < l ; ++i) {
            if(ids[i] != id)
                continue;
            
            ids.splice(i, 1);
            // if this was the first of several intervals ending at this point
            // and this interval was in the disjoint set, we need to restore
            // the interval which has become the first in this list after
            // this removal.
            if(i == 0 && l > 1 &&
               ((endOpen && endNode.value.startCountOpen == 0) ||
                (!endOpen && endNode.value.startCountClosed == 0))) {
                var intervalStart = 
                    this.findDisjointIntervalStart(endNode, endOpen);
                restoredIntervals.push({ id: ids[0],
                                         startValue: intervalStart.startValue,
                                         startOpen: intervalStart.startOpen,
                                         endValue: endNode.key,
                                         endOpen: endOpen });
            }
            break;
        }

        if(modifications) {
            modifications.restoredIntervals = restoredIntervals;
            if(modifications.modifiedInterval === undefined &&
               restoredStartPoints.length > 0) {
                // the remove interval was not in the pairwise disjoint set
                // and a new start point was created by its removal, so the
                // interval in the pairwise disjoint set which covered the
                // removed interval must have changed, so we find this interval
                // and store its new description.
                modifications.modifiedInterval =
                    this.findCoveringDisjointInterval(endNode, endOpen);
            }

            if(modifications.restoredIntervals.length == 0 &&
               modifications.modifiedInterval !== undefined &&
               modifications.modifiedInterval.id == id)
                modifications = undefined; // only the removed interval affected
        }
    }
    
    // check whether the nodes need to be destroyed

    if(endNode != startNode) {
        var endValue = endNode.value;
        if(endValue.endOpen == 0 && endValue.startClosed == 0 &&
           endValue.endClosed == 0 && endValue.startOpen == 0) {
            this.removeNode(endNode);
        }
    }
    
    var startValue = startNode.value;
    if(startValue.endOpen == 0 && startValue.startClosed == 0 &&
       startValue.endClosed == 0 && startValue.startOpen == 0) {
        this.removeNode(startNode);
    }

    return modifications;
}

// This function should be called to omdify an existing interval stored
// in this object. Basically, this function removes the old interval
// and then adds it back in again, but calling it has several advantages
// over performing a removal and then an addition:
// 1. The value returned by this function (described below) already
//    summarizes the changes to the pairwise disjoint interval structure
//    as a result of this modification operation. This saves the calling
//    function the need to combine the results of the two operations,
//    which may consist in adding and then immediately removing
//    an interval from the disjoint set.
// 2. If, as a result of the removal operation an interval is restored
//    and this interval has the same end point as the new interval being
//    modified here, the ID of the disjoint interval will be that
//    of the modified interval rather than that of the restored
//    interval (this increases the stability of the IDs assigned to
//    the intervals and avoid unnecessary updates for the caller).
//
// The object returned by this function is a combination of the objects
// returned by the removal and the addition operations.
// When the 'generateDisjointIntervals' mode is off, this function does
// not return any value (that is, returns undefined).
// When the 'generateDisjointIntervals' mode is on, this function returns
// a value which indicates how the set of pairwise disjoint interval
// has changed as a result of modifying this interval.
//
// The function returns undefined if the only change to the disjoint
// interval set is in the interval being modified and this interval
// belongs to the disjoint set as is.
//
// In all other cases, this function returns the following object:
// {
//     removedIntervals: <array of interval IDs>,
//     coveringInterval: {
//         id: <interval ID>
//         startValue: <value at which the interval starts>
//         startOpen: true|false // whether this interval starts open
//         endValue: <value at which the interval ends>
//         endOpen: true|false // whether this interval ends open 
//     },
//     restoredIntervals: <array of interval discriptions of the form:
//        {
//            id: <interval ID>
//            startValue: <value at which the interval starts>
//            startOpen: true|false // whether this interval starts open
//            endValue: <value at which the interval ends>
//            endOpen: true|false // whether this interval ends open 
//        }
//     >,
//     modifiedInterval: {
//         id: <interval ID>
//         startValue: <value at which the interval starts>
//         startOpen: true|false // whether this interval starts open
//         endValue: <value at which the interval ends>
//         endOpen: true|false // whether this interval ends open 
//     }
// }
// where any of the fields may be undefined or empty.
//     removedIntervals: this is an array of interval IDs which were
//        in the disjoint interval set before the operation but are
//        not in the set after the operation.
//     coveringInterval: this is the interval in the disjoint set
//        which covers the modified interval after the operation.
//        If this is undefined, the modified interval in in the disjoint
//        set, as is.
//     restoredIntervals: intervals which were added to the disjoint
//        set as a result of this operation.
//     modifiedInterval: this is an interval which was modified
//        (but not removed or restored) as a result of this operation.
//        This may be a covering interval which changed as a result of
//        the removal step.
// The interval in 'coveringInterval' may cannot appear in 'restoredIntervals'.
//
// Remark: this is probably not the most efficient way to implement this
// (in extreme cases it would have been better to update incrementally
// rather than removing and then adding) but at present this seems the
// simplest solution (and it is probably efficient enough in most cases.

PairwiseDisjoint.prototype.modifyInterval = pairwiseDisjointModifyInterval;

function pairwiseDisjointModifyInterval(startValue, startOpen, endValue,
                                        endOpen,
                                        prevStartValue, prevStartOpen,
                                        prevEndValue, prevEndOpen, id)
{
    var removeModified = this.removeInterval(prevStartValue, prevStartOpen,
                                             prevEndValue, prevEndOpen, id);
    this.justNowRestored =
        removeModified ? removeModified.restoredIntervals : undefined;

    var addModified = this.addInterval(startValue, startOpen, endValue,
                                       endOpen, id);
    
    this.justNowRestored = undefined;

    // combine the modifications of the two operations

    if(removeModified === undefined) {
        if(addModified === undefined)
            return undefined;
        if(addModified.coveringInterval.id != id)
            addModified.removedIntervals.push(id); // was removed
        return addModified;
    }
        
    if(addModified === undefined) {
        if(removeModified.modifiedInterval &&
           removeModified.modifiedInterval.id == id)
            // this interval was added back
            removeModified.modifiedInterval = undefined;
        removeModified.coveringInterval = {
            id: id,
            startValue: startValue,
            startOpen: startOpen,
            endValue: endValue,
            endOpen: endOpen
        };
        return removeModified;
    }

    if(removeModified.modifiedInterval &&
       removeModified.modifiedInterval.id == addModified.coveringInterval.id){
        // the most up to date information about this interval is stored
        // in addModified.coveringInterval
        removeModified.modifiedInterval = undefined;
    } else if(removeModified.modifiedInterval &&
              removeModified.modifiedInterval.id == id) {
        // covering interval has a different ID, so this interval should be
        // removed
        addModified.removedIntervals.push(id);
    }
    
    // if there are both restored and removed intervals,
    // remove common intervals from both lists
    var restoredIntervals = removeModified.restoredIntervals;

    if(restoredIntervals && restoredIntervals.length &&
       addModified.coveringInterval) {
        // if the covering interval (after the addition) was previously
        // restored (by the removal) remove it from the restored list
        // (it is enough to return it once, with the most up to date value)
        for(var i = 0, l = restoredIntervals.length ; i < l ; ++i) {
            if(restoredIntervals[i].id == addModified.coveringInterval.id) {
                restoredIntervals.splice(i,1);
                break;
            }
        }
    }
    
    var removedIntervals = addModified.removedIntervals;

    if(!removedIntervals || !removedIntervals.length) {
        // add the covering interval to the update reported by the removal
        // and return this object
        removeModified.coveringInterval = addModified.coveringInterval;
        return removeModified;
    }

    // check whether the interval modified by the removal was later removed
    if(removeModified.modifiedInterval) {
        var modifiedId = removeModified.modifiedInterval.id;
        for(var i = 0, l = removedIntervals.length ; i < l ; ++i) {
            if(removedIntervals[i] == modifiedId) {
                removeModified.modifiedInterval = undefined;
                break;
            }
        }
    }
        
    if(restoredIntervals && restoredIntervals.length) {
        var restored = new Map();
        var removed = [];
        for(var i = 0, l = restoredIntervals.length ; i < l ; ++i)
            restored.set(restoredIntervals[i].id, restoredIntervals[i]);
        for(var i = 0, l = removedIntervals.length ; i < l ; ++i) {
            var removedId = removedIntervals[i];
            if(restored.has(removedId))
                restored.delete(removedId);
            else
                removed.push(removedId);
        }
        
        addModified.removedIntervals = removed;
        removeModified.restoredIntervals = [];
        restored.forEach(function(interval, id) {
            removeModified.restoredIntervals.push(interval);
        });
    }
    
    return {
        coveringInterval: addModified.coveringInterval,
        removedIntervals: addModified.removedIntervals,
        modifiedInterval: removeModified.modifiedInterval,
        restoredIntervals: removeModified.restoredIntervals
    };
}

///////////////////////////
// Start Count Functions //
///////////////////////////

// This function increases the 'start count' on nodes when a segment
// of an interval is added. If a whole interval is added, startNode and
// endNode should be the nodes at which the interval starts and ends
// (respectively) and 'startOpen' ad 'endOpen' should indicate whether the
// start/end is open (true) or closed (false).
// If an interval is only extended, then there must be a minimal overlap between
// the segment provided in the input parmeters and the existing segment.
//
// If the new start point of the interval is before the old start point,
// 'startNode' and 'startOpen' should be the values for the new start point.
// If the previous start was closed, 'endNode' should be the previous start
// node and 'endOpen' should be false (so that the 'startCountOpen' is increased
// on that node).
// If the previous start was open, 'endNode' should be the node following
// previous start node and 'endOpen' should be true (so that both
// 'startCountOpen' and 'startCountClosed' are increased on teh previous
// start node, but none is increased on teh following node).
//
// If the new end point of the interval is after the old end point,
// 'endNode' and 'endOpen' should be the values for the new end point.
// If the previous end was closed, 'startNode' should be the previous end
// node and 'startOpen' should be false (so that the 'startCountClosed'
// is increased on that node).
// If the previous end was open, 'startNode' should be the node before
// teh previous end node and 'startOpen' should be true (so that both
// 'startCountOpen' and 'startCountClosed' are increased on the previous
// end node, but none is increased on the previous node).
//
// This function should be called before the 'updateStart()' or
// 'updateEnd()' functions are called to remove the previous
// start/end point.
//
// 'removedIntervals' should be an array provided by the calling function.
// This function pushes on this array the IDs of disjoint intervals
// whose end end-point is no longer the end end-point of a disjoint
// interval after this operation (see 'increaseStartCount()' for more details).

PairwiseDisjoint.prototype.extendStartCount = pairwiseDisjointExtendStartCount;

function pairwiseDisjointExtendStartCount(startNode, startOpen, endNode,
                                          endOpen, removedIntervals)
{
    if(startNode == endNode)
        return; // nothing to do

    // update the start counts on all nodes covered by this interval
    if(!startOpen)
        this.increaseStartCount(startNode, false, removedIntervals);
        
    var node = startNode.next;
    while(node != endNode) { // internal nodes
        this.increaseStartCount(node, true, removedIntervals);
        this.increaseStartCount(node, false, removedIntervals);
        node = node.next;
    }
    if(!endOpen)
        this.increaseStartCount(node, true, removedIntervals);
}

// This function decreases the 'start count' on nodes when a segment
// of an interval is removed. If a whole interval is removed, startNode and
// endNode should be the nodes at which the interval starts and ends
// (respectively) and 'startOpen' ad 'endOpen' should indicate whether the
// start/end is open (true) or closed (false).
// If an interval is only made smaller, then there must be a minimal overlap
// between the segment provided in the input parmeters and the new interval.
//
// If the new start point of the interval is after the old start point,
// 'startNode' and 'startOpen' should be the values for the old start point.
// If the new start is closed, 'endNode' should be the new start
// node and 'endOpen' should be false (so that the 'startCountOpen' is decreased
// on this node).
// If the new start is open, 'endNode' should be the node following
// the new start node and 'endOpen' should be true (so that both
// 'startCountOpen' and 'startCountClosed' are decreased on the new
// start node, but none is decreased on the following node).
//
// If the new end point of the interval is before the old end point,
// 'endNode' and 'endOpen' should be the values for the old end point.
// If the new end is closed, 'startNode' should be the new end
// node and 'startOpen' should be false (so that the 'startCountClosed'
// is decreased on that node).
// If the new end is open, 'startNode' should be the node before
// the new end node and 'startOpen' should be true (so that both
// 'startCountOpen' and 'startCountClosed' are increased on the previous
// end node, but none is increased on the previous node).
//
// This function should be called after the 'updateStart()' or
// 'updateEnd()' functions are called to remove the previous
// start/end point.
//
// 'restoredIntervals' and 'restoredStartPoints' should be arrays provided
// by the calling function. should be an array provided by the calling function.
// This function pushes on the 'restroedIntervals' array the description
// of intervals which were not in the disjoint set before this operation
// but are in the disjoint set after the operation.
// 'restoredStartPoints' holds the descriptions of start points
// (value + open/closed) which were not the start point of an interval
// in the disjoint set before this operation but are the start point
// of such an interval after this operation.

PairwiseDisjoint.prototype.reduceStartCount = pairwiseDisjointReduceStartCount;

function pairwiseDisjointReduceStartCount(startNode, startOpen, endNode,
                                          endOpen, restoredIntervals,
                                          restoredStartPoints)
{
    
    if(startNode == endNode)
        return; // nothing to do
    
    // update the start counts on all nodes covered by this interval
    if(!startOpen)
        this.decreaseStartCount(startNode, false, restoredIntervals,
                                restoredStartPoints);
        
    var node = startNode.next;
    while(node != endNode) { // internal nodes
        this.decreaseStartCount(node, true, restoredIntervals,
                                restoredStartPoints);
        this.decreaseStartCount(node, false, restoredIntervals,
                                restoredStartPoints);
        node = node.next;
    }
    if(!endOpen)
        this.decreaseStartCount(node, true, restoredIntervals,
                                restoredStartPoints);
}

// This function is used to increase the 'startCount' on the value object
// of the node 'node'. If 'afterOpen' is true, this increases the
// count of 'startCountOpen' and if 'afterOpen' is false, this increases
// the count of 'startCountClosed'.
// When the count of 'startCountOpen' increases from 0 to 1 and
// there are intervals with an open end end-point at this node, the interval
// which ended with an open end at this value is now no longer part of the
// pairwise disjoint set. The ID of this interval (the first ID in
// 'openEndIds') is pushed onto 'removedIntervals', which must be an array
// provided by the caller.
// Similarly, when the count of 'startCountClosed' increases from 0 to 1 and
// there are intervals with a closed end end-point at this node, the interval
// which ended with a closed end at this value is now no longer part of the
// pairwise disjoint set. The ID of this interval (the first ID in
// 'closedEndIds') is pushed onto 'removedIntervals'.

PairwiseDisjoint.prototype.increaseStartCount =
    pairwiseDisjointIncreaseStartCount;

function pairwiseDisjointIncreaseStartCount(node, afterOpen, removedIntervals)
{
    var value = node.value;
    
    if(afterOpen) {
        if(++value.startCountOpen == 1 && value.endOpen > 0)
            removedIntervals.push(value.openEndIds[0]);
    } else {
        if(++value.startCountClosed == 1 && value.endClosed > 0)
            removedIntervals.push(value.closedEndIds[0]);
    }
}

// This function is used to decrease the 'startCount' on the value object
// of the node 'node'. If 'afterOpen' is true, this decreases the
// count of 'startCountOpen' and if 'afterOpen' is false, this decreases
// the count of 'startCountClosed'.
// When the count of 'startCountOpen' decreases to 0 and
// there are intervals with an open end end-point at this node, the interval
// which ended with an open end at this value now becomes part of the
// pairwise disjoint set of intervals (until now it was part of a larger
// interval with a different ID). The ID of this interval is the first ID in
// 'openEndIds'. This function finds the beginning of this interval
// (it is assumed that the start count has already beeing updated on all
// preceeding points) and pushes the description of this interval onto
// 'restoredIntervals' (which must be an array provided by the caller).
// Similarly, when the count of 'startCountClosed' decreases to 0 and
// there are intervals with a closed end end-point at this node, the interval
// ending with a closed end at this point is added to 'restoredIntervals'.
// The ID of this interval is the first ID in 'closedEndIds'.
// The format of the objects added to 'restoredIntervals' is:
// {
//     id: <ID of this interval>,
//     startValue: <value at which the interval starts>
//     startOpen: true|false // whether this interval starts open
//     endValue: <value at which the interval ends>
//     endOpen: true|false // whether this interval ends open 
// }

PairwiseDisjoint.prototype.decreaseStartCount =
    pairwiseDisjointDecreaseStartCount;

function pairwiseDisjointDecreaseStartCount(node, afterOpen, restoredIntervals,
                                            restoredStartPoints)
{
    var value = node.value;
    
    if(afterOpen) {
        if(--value.startCountOpen == 0) {
            if(value.endOpen > 0) {
                // find the beginning of the interval which ends here
                var intervalStart = restoredStartPoints.length ?
                    restoredStartPoints[restoredStartPoints.length-1] :
                    this.findDisjointIntervalStart(node, true);
                restoredIntervals.push({ id: value.openEndIds[0],
                                         startValue: intervalStart.startValue,
                                         startOpen: intervalStart.startOpen,
                                         endValue: node.key,
                                         endOpen: true });
            }
            if(value.startClosed > 0)
                restoredStartPoints.push({ startValue: node.key,
                                           startOpen: false});
        }
    } else {
        if(--value.startCountClosed == 0) {
            if(value.endClosed > 0) {
                var intervalStart = restoredStartPoints.length ?
                    restoredStartPoints[restoredStartPoints.length-1] :
                    this.findDisjointIntervalStart(node, false);
                restoredIntervals.push({ id: value.closedEndIds[0],
                                         startValue: intervalStart.startValue,
                                         startOpen: intervalStart.startOpen,
                                         endValue: node.key,
                                         endOpen: false });
            }
            if(value.startOpen > 0)
                restoredStartPoints.push({ startValue: node.key,
                                           startOpen: true });
        }
    }
}

/////////////////////////////////
// Disjoint Interval Functions //
/////////////////////////////////

// Given the node 'node', this function returns a description of the
// start point of the interval in the pairwise disjoint set of
// intervals such that:
// if 'isOpen' == false:
//    the interval covers the value of the node (the node may then either
//    be an internal point of the interval or its closed start or end).
// if 'isOpen' == true:
//    the interval begins before the value of the given node and
//    either covers the value of the node or ends with an open end-point
//    at this point.
// If there is no such interval, undefined is returned.
// By this definition, if we have two intervals [x,y), [y,z] and the node
// represents the value of y, this function will return x if 'isOpen' is
// true and y if 'isOpen' is false.
// The function returns an object of the format:
// {
//    startValue: <value at which the interval starts>,
//    startOpen: true|false // whether the start point is open or closed
// }
// To find the beginning of the interval, this function loops back
// from the point given until it finds a point where the start count
// is zero and the start point count directly following it is not
// zero.

PairwiseDisjoint.prototype.findDisjointIntervalStart =
    pairwiseDisjointFindDisjointIntervalStart;

function pairwiseDisjointFindDisjointIntervalStart(node, isOpen)
{
    if(node.value.startCountOpen == 0) {
        if(!isOpen) {
            if(node.value.startClosed > 0)
                return { startValue: node.key, startOpen: false };
            else
                return undefined;
        } else if(node.value.endOpen == 0)
            return undefined;
    }

    // the folowing loop must return at some node
    for(node = node.prev ; ; node = node.prev) {
        var value = node.value;
        if(value.startOpen > 0 && value.startCountClosed == 0)
            return { startValue: node.key, startOpen: true };
        if(value.startClosed > 0 && value.startCountOpen == 0)
            return { startValue: node.key, startOpen: false };
    }
}

// Given the node 'node', this function returns a description of the
// the interval in the pairwise disjoint set of intervals such that:
// if 'isOpen' == false:
//    the interval covers the value of the node (the node may then either
//    be an internal point of the interval or its closed end or its closed
//    start).
// if 'isOpen' == true:
//    the interval begins before the value of the given node and
//    either covers the value of the node or ends with an open end-point
//    at this point.
// If there is no such interval, undefined is returned.
// By this definition, if we have two intervals [x,y), [y,z] and the node
// represents the value of y, this function will return [x,y) if 'isOpen' is
// true and [y,z] if 'isOpen' is false.
// The function returns an object of the format:
// {
//    id: <ID of this interval>
//    startValue: <value at which the interval starts>,
//    startOpen: true|false // whether the start point is open or closed
//    endValue: <value at which the interval ends>,
//    endOpen: true|false // whether the end point is open or closed
// }

PairwiseDisjoint.prototype.findCoveringDisjointInterval =
    pairwiseDisjointFindCoveringDisjointInterval;

function pairwiseDisjointFindCoveringDisjointInterval(node, isOpen)
{
    // first get the start of the interval
    var interval = this.findDisjointIntervalStart(node, isOpen);
    if(!interval)
        return undefined;
    
    var value = node.value;
    if(isOpen && value.startCountOpen == 0) {
        interval.id = value.openEndIds[0];
        interval.endValue = node.key;
        interval.endOpen = true;
        return interval;
    }
    if(value.startCountClosed == 0) {
        interval.id = value.closedEndIds[0];
        interval.endValue = node.key;
        interval.endOpen = false;
        return interval;
    }

    while(node) {
        node = node.next;
        value = node.value;
        if(value.startCountOpen == 0) {
            interval.id = value.openEndIds[0];
            interval.endValue = node.key;
            interval.endOpen = true;
            return interval;
        }
        if(value.startCountClosed == 0) {
            interval.id = value.closedEndIds[0];
            interval.endValue = node.key;
            interval.endOpen = false;
            return interval;
        }
    }
}

// This function is given an end end-point (described by a node 'endNode'
// and a flag 'endOpen' indicating whether it is open or closed) and
// checks whether this is the end point of a disjoint interval and, if it
// is, whether the ID currently assigned to the disjoint interval
// ending at this point (if such an ID is already assigned) appears in the
// this.justNowRestored list (this list may exist only in the midst of
// an interval modification operation). If all these conditions hold, true
// is returns and false otherwise.

PairwiseDisjoint.prototype.isJustRestoredDisjointEnd =
    pairwiseDisjointIsJustRestoredDisjointEnd;

function pairwiseDisjointIsJustRestoredDisjointEnd(endNode, endOpen)
{
    if(!this.justNowRestored || this.justNowRestored.length == 0)
        return false;
    
    if(!this.isDisjointEnd(endNode, endOpen))
        return false;
    
    var value = endNode.value;
    var endIds = endOpen ? value.openEndIds : value.closedEndIds;

    if(endIds === undefined || endIds.length == 0)
        return false; // no ID for this disjoint end (yet)
    
    var id = endIds[0];

    for(var i = 0, l = this.justNowRestored.length ; i < l ; ++i) {
        if(this.justNowRestored[i].id == id)
            return true;
    }

    return false;
}

////////////////////////////////////////
// Start After Start Update Functions //
////////////////////////////////////////

// This function is an auxiliary function which is used to update the value
// of a node in the tree when a start point is added or removed. It is
// the responsibility of the calling function to provide this function with
// the node which needs to be updated and to ensure that this node
// has a value object. 'node' is this node. 'isOpen' indicates whether
// the point to be added/removed is open or closed. Finally, 'add'
// is true if the point needs to be added and false if it needs to be removed.
// This function updates the value of the node as well as the
// 'startFollowedByStart' property. Since we are modifying a start point
// here, this operation may increase by 1 the number of start points followed by
// a start point if the start point is inserted immediately before or
// after a start point and may decerase by one this number if the point
// is removed immediately before or after a start point (note that when
// inserted/remove between two start points the count only changes by 1).

PairwiseDisjoint.prototype.updateStart = pairwiseDisjointUpdateStart;

function pairwiseDisjointUpdateStart(node, isOpen, add)
{
    var valueObj = node.value;
    var count = add ? 1 : -1;
    
    if(isOpen) {
        if(!add)
            valueObj.startOpen--;
        if(valueObj.startOpen == 0) {
            // check if directly follows start point
            if(valueObj.endClosed == 0 &&
               (valueObj.startClosed > 0 ||
                (valueObj.endOpen == 0 &&
                 this.endsWithStart(node.prev))))
                this.startFollowedByStart += count;
            else if(this.startsWithStart(node.next))
                // check if followed by start point (only if not directly
                // after start point, otherwise we will be counting double).
                this.startFollowedByStart += count;
        } else
            this.startFollowedByStart += count;
        if(add)
            valueObj.startOpen++;
    } else {
        if(!add)
            valueObj.startClosed--;
        if(valueObj.startClosed == 0) {
            // check if directly follows start point
            if(valueObj.endOpen == 0 && this.endsWithStart(node.prev))
                this.startFollowedByStart += count;
            else if(valueObj.endClosed == 0 &&
                    (valueObj.startOpen > 0 ||
                     this.startsWithStart(node.next)))
                // check if followed by start point (only if not directly
                // after start point, otherwise we will be counting double).
                this.startFollowedByStart += count;
        } else
            this.startFollowedByStart += count;
        if(add)
            valueObj.startClosed++;
    }
}

// This function is an auxiliary function which is used to update the value
// of a node in the tree when an end point is added or removed. It is
// the responsibility of the calling function to provide this function with
// the node which needs to be updated and to ensure that this node
// has a value object. 'node' is this node. 'isOpen' indicates whether
// the point to be added/removed is open or closed. Finally, 'add'
// is true if the point needs to be added and false if it needs to be removed.
// This function updates the value of the node as well as the
// 'startFollowedByStart' property. Since we are modifying an end point
// here, this operation may decrease by 1 the number of start points followed by
// a start point if the end point is inserted between two start points
// and may incerase by one this number if the point is removed between
// two start points.

PairwiseDisjoint.prototype.updateEnd = pairwiseDisjointUpdateEnd;

function pairwiseDisjointUpdateEnd(node, isOpen, add)
{
    var valueObj = node.value;
    var count = add ? 1 : -1;

    if(isOpen) {
        if(!add)
            valueObj.endOpen--;
        if(valueObj.endOpen == 0) {
            // check if this separates two consecutive start points
            if(this.endsWithStart(node.prev) &&
               (valueObj.startClosed > 0 || 
                (valueObj.endClosed == 0 &&
                 (valueObj.startOpen > 0 ||
                  this.startsWithStart(node.next)))))
                this.startFollowedByStart -= count;
        }
        if(add)
            valueObj.endOpen++;
    } else {
        if(!add)
            valueObj.endClosed--;
        if(valueObj.endClosed == 0) {
            if(valueObj.startClosed > 0) {
                if(valueObj.startOpen > 0 ||
                   this.startsWithStart(node.next))
                    this.startFollowedByStart -= count;
            } else if(valueObj.startOpen > 0) {
                if(valueObj.endOpen == 0 && this.endsWithStart(node.prev))
                    this.startFollowedByStart -= count;
            } else if(valueObj.endOpen == 0) {
                if(this.endsWithStart(node.prev) &&
                   this.startsWithStart(node.next))
                    this.startFollowedByStart -= count;
            }
        }
        if(add)
            valueObj.endClosed++;
    }
}

// This function is given a node in the tree and returns true if the
// first non-zero property in its value object is a 'start' property
// ('start open' or 'start closed').  The ordering of the properties
// is the standard one: 'end open', 'start closed', 'end closed',
// 'start open'.
// If all properties on this node have a zero count, this function continues
// recursively to the next node.
// The node provided may be undefined. In that case,
// the function returns false.

PairwiseDisjoint.prototype.startsWithStart = pairwiseDisjointStartsWithStart;

function pairwiseDisjointStartsWithStart(node)
{
    if(node === undefined)
        return false;

    var value = node.value;

    if(value === undefined)
        return false;

    if(value.endOpen > 0)
        return false;
    if(value.startClosed > 0)
        return true;
    if(value.endClosed > 0)
        return false;
    if(value.startOpen > 0)
        return true;

    return this.startsWithStart(node.next);
}

// This function is given a node in the tree and returns true if the last
// non-zero property in its value object is a 'start' property
// ('start open' or 'start closed').
// The ordering of the properties is the standard one:
// 'end open', 'start closed', 'end closed', 'start open'.
// If all properties on this node have a zero count, this function continues
// recursively to the previous node.
// The node provided may be undefined. In that case, the function
// returns false.

PairwiseDisjoint.prototype.endsWithStart = pairwiseDisjointEndsWithStart;

function pairwiseDisjointEndsWithStart(node)
{
    if(node === undefined)
        return false;

    var value = node.value;

    if(value === undefined)
        return false;
    
    if(value.startOpen > 0)
        return true;
    if(value.endClosed > 0)
        return false;
    if(value.startClosed > 0)
        return true;
    if(value.endOpen > 0)
        return false;
    return this.endsWithStart(node.prev);
}
