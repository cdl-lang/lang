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


// This file implements the LinearSubIndex class which supports incremental 
// lookup by keys of a single type (e.g. number, weight, height, ...). This 
// type must have a linear ordering defined on its values. Given such a linear 
// ordering, we can define intervals on this type. Both the keys stored
// in the sub-index and the lookup values may be either single values
// or intervals (open or closed on either side). 
//
// The values stored in the sub-index are IDs. Each ID is stored under
// a single key (of the type defined for the sub-index). This single
// key may either be a single value or an interval (range). When storing
// the same ID again, the key under which it is stored changes.
//
// Lookup is by intersection. Given a lookup value can be either a value
// or an interval. The sub-index returns the IDs stored under keys which 
// intersect with the lookup value. A lookup must also have an ID.
// When a lookup with the same ID is used again, the sub-index returns
// the difference between the result of the new lookup and the previous
// lookup under the same lookup ID. This is the incrementality of 
// the sub-index.
//
// When a value is added or removed from the sub-index, the sub-index
// returns the list of lookups already registered to the sub-index
// which match the value just added or removed.
//
// 
// Sub-Index Constructor
// ---------------------
//
// The LinearSubIndex constructor is called as follows:
//
// LinearSubIndex(<comparison function>)
// 
// A linear sub-index is constructed for a given type together with 
// a comparison function for that type (which defines a complete ordering
// on the values of this type). The type need not be given explicitly in the 
// constructor, but it is given implicitly by the comparison function,
// which must be able to compare any values subsequently stored in 
// the sub-index. The LinearSubIndex class defines a default comparison 
// function for numeric values (number, weight, length, etc.) so it is 
// possible to omit the comparison function from the construction if
// the type is numeric (and should be ordered using the standard 
// numeric ordering). 
// 
// If the type for which the sub-index is constructed requires a
// different comparison function, this should be given in <comparison
// function>. This function should compare two values and return a
// strictly negative number if the first is smaller, 0 if they are
// both equal a strictly positive number if the first is larger.
// The comparison function must also be able to handle the two special
// values -Infinity and Infinity. For any value x compared, 
// compare(-Infinity, x) should be strictly negative and 
// compare(Infinity, x) should be strictly positive. Of course, the comparison
// function must also compare the infinite values correctly: 
// compare(-Infinity, -Infinity) == 0, compare(-Infinity, Infinity) < 0 and
// compare(Infinity, Infinity) == 0. 
// The default numeric comparison function handles this correctly for 
// numeric values.
//
// Intervals
// ---------
//
// The intervals used are considered to be intervals in the domain
// (-Infinity, Infinity). This means that an interval may extend all the
// way to -Infinity or Infinity (or both) but a single point at infinity
// does not exist.
// 
// Everywhere below we will define intervals as a quadruple: 
// <low key, high key, low open, high open>. The <low key> and <high key> must
// be values of the type compared by the comparison function. It is required
// that <low key> <= <high key>. This defined the range 
// <low key, high key>. If <low open> is true, the low end of this range is 
// open and if <high open> is true, the high end of this range is open.
// If <low key> == <high key> and either <low open> or <high open> is true, 
// the interval is empty. Otherwise (if closed on both ends) the interval 
// is degenerate (equals a single point). If the end point of an interval 
// is -Infinity or Infinity, the end point is always considered open (it 
// follows that <low key> == <high key> == Infinity is an empty set).
//
// Since a single value is equivalent to a degenerate interval, we will
// refer from now one only to intervals (and explicitly to degenerate
// intervals when relevant).
//
// Many of the function below have lowKey, highKey, lowOpen, highOpen
// in their arguments. These are then interpreted as the quadruple above. 
// If highKey is left undefined, lowOpen and highOpen are ignored (if 
// specified) and the interval is interpreted as the degenerate interval
// [lowKey, lowKey].

// Updating Values and Lookups
// ---------------------------
//
// The main operation performed on the sub-index is the addition or 
// removal of values and lookups. An addition operation (of a value or
// lookup) needs to specify the ID which is being added and the interval
// (range) assigned to it (either as its key or as its lookup value). 
// The sub-index remembers which intervals were added for each ID, so when
// a new interval is added for an existing ID, this is interpreted as
// an update operation, removing the previous interval and adding the new
// interval. Similarly, when a value or lookup ID needs to be completely
// removed, it is enough to specify the ID, as the rest of the information
// is stored in the sub-index.
// 
// The following four functions provide the basic interface to the sub-index:
//
// LinearSubIndex.addValue(<ID>, <low key>, <prev low key>, <high key>,
//                         <prev high key> , <low open>, <prev low open>, 
//                         <high open>, <prev high open>)
// LinearSubIndex.removeValue(<ID>, <low key>, <high key>, <low open>,
//                            <high open>)
// LinearSubIndex.addLookup(<ID>, <low key>, <prev low key>, <high key>,
//                          <prev high key> , <low open>, <prev low open>, 
//                          <high open>, <prev high open>)
// LinearSubIndex.removeLookup(<ID>, <low key>, <high key>, <low open>,
//                             <high open>)
//
// LinearSubIndex.getMatches(<ID>, <low key>, <high key>, <low open>,
//                           <high open>)
// 
// The <low key>, <high Key>, <low open>, <high open> describe the interval
// associated with the value or lookup ID as described in the section
// 'Intervals' above. <prev low key>, <prev high Key>, <prev low open>,
// and <prev high open> are the previous values of the interval registered
// under this ID. This is to be used in cases where the new interval replaces
// an existing registration under the  same ID. It is the responsibility of
// the calling function to provide the previous rang ein this case.
// To add a degenerate interval (single point) one can
// omit the last three arguments describing the new interval (that is,
// only provide <low key>). Similarly when the previous interval was a
// degenerate interval.
//
// The addValue and addLookup return an object of the following form:
//
// {
//     added: <array of IDs>,
//     removed: <array of IDs>
// }
//
// If the function is addValue(), the arrays of IDs contain lookup IDs.
// The 'added' array holds the IDs of lookups which match the new interval
// added but did not match the previous interval (if any). The array
// 'removed' holds the IDs of lookups which matched the previous interval
// but do no longer match the new interval. If no previous interval existed,
// this list is empty.
//
// If the function is addLookup(), the arrays of IDs contain value IDs.
// The 'added' array holds the IDs of values which are matched by the new 
// lookup interval added but were not matched by the previous lookup interval 
// (if any). The array 'removed' holds the IDs of values which were matched 
// by the previous lookup interval but are no longer matched by the new 
// interval. If no previous lookup interval existed, this list is empty.
//
// If either the list 'added' or 'removed' is empty, it may be omitted
// from the returned structure (but the existence of the array does not 
// imply that it is not empty).
//
// The removeValue() and removeLookup() functions return an array with IDs.
// removeValue() returns an array of the IDs of all lookups which matched
// the value that was removed and removeLookup() returns an array of the IDs
// of all values which were matched by the lookup that was removed. 
//
// The function 'getMatches()' is used to get the list of values matched
// by a given lookup which is already registered. This does not change
// the registration of the lookup. This may be used by a module which
// did not keep track of the incremental updates received when the look up
// was originally registered and later when values were added and removed.
// This function receives a single lookup ID as input and returns an
// array of value IDs as output.

// Additional Interface
// --------------------
//
// Several additional functions are available in the sub-index interface:
//
// LinearSubIndex.hasRangeValues(): return true if any non-degenerate
//    range value is stored in this sub-index. Once such a value is
//    stored, this function continues to return true, even if all range
//    values are removed.
// LinearSubIndex.supportsIntervals(): returns always true for this sub-index
//    (other sub-indexes may return false).
// LinearSubIndex.hasNoLookups(): this function returns true if the number
//    of lookups currently registered to the sub-index is zero.
// LinearSubIndex.clearValues(): this function can be used to remove all
//    values (but not lookups) registered to the index (this is far more
//    efficient than removing them one by one). 
// LinearSubIndex.loadFromDiscrete(<discrete index>): this function can 
//    be used to initialize the sub-index based on a discrete sub-index.
//    This function then reads all values and lookups stored in the
//    discrete sub-index and adds them (as degenerate intervals and under
//    the same IDs) to the linear sub-index. This can be used if certain
//    data was first handled as discrete data but later it became necessary
//    to handle it as ordered data.
//
// Implementation
// --------------
// 
// The implementation is based on two interval trees, one for storing 
// the values and one for storing the lookup intervals. When a value is
// added, it is stored in the value interval tree and performs a lookup
// on the lookup interval tree and when a lookup is added, it is stored
// in the lookup tree and performs a lookup on the value tree.
// Because when adding an ID or removing it we need to know the previous
// interval with which the ID was stored (whether a lookup or a value)
// we also need a table indexed by ID which stores under each ID the interval
// which which it was registered. We need such a table for both the 
// values and the lookups.
//

///////////////////////////
// Half Linear Sub-Index //
///////////////////////////

// Since the handling for values and lookups is identical, an intermediate
// class HalflinearSubIndex is defined which bundles all the functionality
// needed twice for the value and for the lookups. The LinearSubIndex
// object then simply has the structure:
//
// {
//    values: <value HalfLinearSubIndex>,
//    lookups: <lookup HalfLinearSubIndex>
// }
// 
// The HlafLinearSubIndex object has the following structure:
//
// {
//    compareFunc: <comparison function>,
//    tree: <DegenerateIntervalTree or IntervalTree>,
//    treeIsDegenerate: <boolean>
// }
//
// compareFunc: the comparison function, if given explicitly.
// tree: this is the tree structure which is used to store the IDs indexed
//    by their intervals. This tree can either be an IntervalTree or
//    a DegenerateIntervalTree. As long as only degenerate intervals were
//    stored in the half linear sub-index, a DegenerateIntervalTree is
//    used. This is slightly nore efficient than storing the degenerate
//    intervals in a standard interval tree. Once a non-degnerate interval
//    needs to be added, the degenerate interval tree is imported into 
//    a standard interval tree and from that moment on, a standard 
//    interval tree is used (even if at some point the number of non-degenerate
//    intervals drops again to zero). That is, once it becomes clear that
//    non-degnerate intervals could be stored in this half sub-index,
//    the standard interval tree is used. 
// treeIsDegenerate: true if the tree currently stored under 'tree' is
//    a DegenerateIntervalTree (able to store only degenerate intervals).
//    This starts out as true and is changed to false once the first 
//    non-degenerate interval is added. This flag never changes back to false.
//
// Interface for HalfLinearSubIndex
// --------------------------------
//
// The following functions constitute the interface of the HalfLinearSubIndex
// class:
//
// HalfLinearSubIndex.addInterval(<ID>, <low key>, <high Key>, <low open>, 
//                                <high open>, <prev low key>, <prev high key>,
//                                <prev low open>,  <prev high open>)
//    This function adds the given interval with the given ID. If this ID
//    was previously registered with a different interval, that previous
//    interval must also be provied. The function updates the tree.
//    If this is the first non-degenerate interval, the tree is converted
//    from a DegenerateIntervalTree to an IntervalTree.
//    This function returns the difference between the new interval
//    added and the previous interval. If there was not previous interval
//    with this ID, the function returns the difference
//    as [true, { lowKey: <low key>, highKey: <high key>, 
//                lowOpen: <boolean>, highOpen: <boolean> }]
//    where the object stored in the array represents the interval just
//    added.
//    If the ID was already stored in the half sub-index, the difference
//    is returned in an array representing two intervals, appended by the 
//    entry of the previous interval: 
//    [<in new>, { lowKey: <low key>, highKey: <high key>, 
//                 lowOpen: <boolean>, highOpen: <boolean> },
//     <in new>, { lowKey: <low key>, highKey: <high key>, 
//                 lowOpen: <boolean>, highOpen: <boolean> },
//     <previous interval>]
//    The <in new> flag before each interval indicates whether the interval
//    following it is contained in the new interval or in the previous 
//    interval.
//    Because these intervals represent the difference between two
//    intervals, they must be disjoint. If the difference is empty, 
//    both intervals are replaced by undefined. If one interval is 
//    a prefix of the other (e.g. [1,3] and [1,5]) then the first 
//    interval is undefined and the second defined ((3,5] in the example
//    just given). If on interval is a suffix of the other, the second
//    interval is undefined (and the first interval is the difference
//    between the two). See the function calcDiff() for more details.
// HalfLinearSubIndex.removeInterval(<ID>, <low key>, <high key>, <low open>,
//                                   <high open>):
//    given an ID and a specification of an interval, this removes the
//    interval.
// HalfLinearSubIndex.findIntersections(<low key>, <high Key>, <low open>, 
//                                      <high open>)
//    This function provides an interface to the findIntersections()
//    function of the (degenerate) interval tree stored in this half
//    sub-index. The first four arguments describe an interval. This is
//    usually an interval just added to the other half sub-index.
//    The function returns the IDs of all intervals stored in this half 
//    sub-index which intersect with the given interval.
// HalfLinearSubIndex.findWithUpperBound(<low key>, <high Key>, <low open>, 
//                                       <high open>, <upper bound>, 
//                                       <upper bound open>)
//    This function provides an interface to the findWithUpperBound()
//    function of the (degenerate) interval tree stored in this half
//    sub-index. The first four arguments describe an interval and the next 
//    two arguments provide an upper bound. These are usually
//    based the diff array returned by the addInterval() function of 
//    the other half sub-index. The function returns the IDs of all 
//    intervals stored in this half sub-index which intersect with the given
//    interval and do not extend beyond the upper bound.
// HalfLinearSubIndex.findWithLowerBound(<low key>, <high Key>, <low open>, 
//                                       <high open>, <lower bound>, 
//                                       <lower bound open>)
//    This function provides an interface to the findWithLowerBound()
//    function of the (degenerate) interval tree stored in this half
//    sub-index. The first four arguments describe an interval and the next 
//    two arguments provide a lower bound. These are usually
//    based the diff array returned by the addInterval() function of 
//    the other half sub-index. The function returns the IDs of all 
//    intervals stored in this half sub-index which intersect with the given
//    interval and do not extend below the lower bound.
//
// HalfLinearSubIndex.loadDegenerateIntervals(<keys + IDs>)
//    This function should only be called immediately after initilization,
//    before any intervals were added to the half sub-index. It is used to
//    initialize the linear sub-index based on an existing list of 
//    IDs with degenerate intervals assigned to them. This list is provided
//    as input to the function as a Map object of the form:
//    <Map object>: {
//       <key>: <Map>{
//            <ID>: true,
//            ......
//       }
//       .....
//    }
//    These values are stored in the half sub-index, but, as all IDs are
//    considered new, there is no need to calculate the difference 
//    with the previous value of the ID. It is also assued here that
//    all intervals are degenerate. 
//    

// %%include%%: <scripts/utils/intervalUtils.js>
// %%include%%: <scripts/utils/trees/intervalTree.js>
// %%include%%: <scripts/utils/trees/degenerateIntervalTree.js>

// The constructor takes as input the comparison function to be used
// for the type indexed here. If this is undefined, the default comparison
// function is used.

function HalfLinearSubIndex(compareFunc)
{
    this.treeIsDegenerate = true; // the default initialization
    this.tree = undefined;
    this.compareFunc = 
        compareFunc ? compareFunc : IntervalTree.prototype.compare;
}

// This functio clears the half index and returns it to its initial state.
// The only thing which is not cleared is the the comparison function.

HalfLinearSubIndex.prototype.clear = halfLinearSubIndexClear;

function halfLinearSubIndexClear()
{
    this.treeIsDegenerate = true; // the default initialization
    this.tree = undefined;
}

// return the number of IDs stored in this half sub-index.

HalfLinearSubIndex.prototype.isEmpty = halfLinearSubIndexIsEmpty;

function halfLinearSubIndexIsEmpty()
{
    return this.tree === undefined || this.tree.isEmpty();
}

// See the description of this function in the introduction. 
// This function first checks whether a previous key is given (prevLowKey is
// not undefined). If it is, it calculates the difference between the new
// and the old interval (this difference is then returned in an array,
// as described in the introduction above). It then removes the old interval
// from the tree and stores the new interval in the tree.
// This function creates the tree object if this is the first ID added.
// It also converts an existing degenerate interval tree into an interval
// tree if this is the first non-degenerate interval added.
// The function return the difference between the old interval and the 
// new interval, as described in the introduction to the HalfLinearSunIndex.

HalfLinearSubIndex.prototype.addInterval = halfLinearSubIndexAddInterval;

function halfLinearSubIndexAddInterval(id, lowKey, highKey, lowOpen, highOpen,
                                       prevLowKey, prevHighKey, prevLowOpen,
                                       prevHighOpen)
{
    var isDegenerate; // is the new interval added degenerate or not

    // booleanize
    lowOpen = !!lowOpen;
    highOpen = !!highOpen;

    if(highKey === undefined) {
        highKey = lowKey;
        isDegenerate = true;
    } else
        isDegenerate = !this.compareFunc(lowKey,highKey);

    var diff;

    if(prevLowKey !== undefined) {

        prevLowOpen = !!prevLowOpen;
        prevHighOpen = !!prevHighOpen;
        
        var prevIsDegenerate = (prevHighKey === undefined ||
                                this.compareFunc(prevLowKey, prevHighKey) == 0);

        // remove the old interval from the tree
        if(prevIsDegenerate) {
            this.tree.removePoint(id, prevLowKey);
            prevHighKey = prevLowKey;
        } else
            this.tree.removeInterval(id, prevLowKey, prevHighKey, 
                                     prevLowOpen, prevHighOpen);

        // calculate the difference
        if(isDegenerate && prevIsDegenerate)
            diff = this.calcDegenerateDiff(lowKey, prevLowKey);
        else 
            diff = this.calcDiff(lowKey, highKey, lowOpen, highOpen,
                                 prevLowKey, prevHighKey, prevLowOpen,
                                 prevHighOpen);

        diff.push({ lowKey: prevLowKey, highKey: prevHighKey, 
                    lowOpen: prevLowOpen, highOpen: prevHighOpen });

    } else {

        var entry = {
            lowKey: lowKey,
            highKey: highKey,
            lowOpen: lowOpen,
            highOpen: highOpen
        };
        
        diff = [true, entry];
    }

    // check whether tree needs to be created/converted
    if(this.treeIsDegenerate === true) {           
        if(this.tree === undefined) {
            var compareFunc =
                this.compareFunc === IntervalTree.prototype.compare ?
                undefined : this.compareFunc;
            if(isDegenerate === true)
                this.tree = new DegenerateIntervalTree(compareFunc);
            else {
                this.tree = new IntervalTree(compareFunc);
                this.treeIsDegenerate = false;
            }
        } else if(isDegenerate === false)
            this.convertDegnerateTree(); // convert the existing tree
    }

    // add the new interval to the tree
    if(isDegenerate)
        this.tree.insertPoint(id, lowKey);
    else
        this.tree.insertInterval(id, lowKey, highKey, lowOpen, highOpen);

    return diff;
}

// See the description of this function in the introduction. 

HalfLinearSubIndex.prototype.loadDegenerateIntervals = 
    halfLinearSubIndexLoadDegenerateIntervals;

function halfLinearSubIndexLoadDegenerateIntervals(keys)
{
    var compareFunc =
        this.compareFunc === IntervalTree.prototype.compare ?
        undefined : this.compareFunc;
    
    this.tree = new DegenerateIntervalTree(compareFunc);
    var _self = this;

    keys.forEach(function(idList, key) {
        idList.forEach(function(t, id) {
            this.tree.insertPoint(id, key);
        });
    });
}

// This function removes the given interval from the half linear sub-index.

HalfLinearSubIndex.prototype.removeInterval = halfLinearSubIndexRemoveInterval;

function halfLinearSubIndexRemoveInterval(id, lowKey, highKey, lowOpen,
                                          highOpen)
{
    // remove from tree
    if(highKey === undefined || this.treeIsDegenerate)
        this.tree.removePoint(id, lowKey);
    else
        this.tree.removeInterval(id, lowKey, highKey, lowOpen, highOpen);
}

// This function calculates the difference between the interval given
// by <lowKey, highKey, lowOpen, highOpen> and the interval given
// by <otherLowKey, otherHighKey, otherLowOpen, otherHighOpen> 
// The difference is returned as an array of four values of the following 
// form:
//    [<in first>, { lowKey: <low key>, highKey: <high key>, 
//                   lowOpen: <boolean>, highOpen: <boolean> },
//     <in first>, { lowKey: <low key>, highKey: <high key>, 
//                   lowOpen: <boolean>, highOpen: <boolean> }]
// This describes the difference as two intervals. Each <in first> is
// a boolean flag indicating for the interval following it whether it
// is contained in the first interval, given by <lowKey, highKey,
// lowOpen, highOpen>, (if the flag is true) or in the 'other' interval 
// (if the flag is false). The two intervals returned are disjoint and 
// are sorted in ascending order. 
// Since the difference between the two intervals may consist of zero 
// intervals (if the two intervals are identical) or one intervals (if one
// interval is a prefix or suffix of the other, e.g. [1,2] - [1,3]), 
// one or both of the interval positions in the array may be undefined. 
// In this case, the <in first> flag belonging to it should be ignored.
//
// When one interval is returned (that is, one interval position in
// the array is undefined) the intervals in the difference array should 
// still be considered 'sorted'. This means that if the first interval
// is undefined and the second defined then one interval compared is a
// prefix of the other while if the second interval returned is undefined,
// then the one interval compared is a suffix of the other interval.
// Examples (the intervals are written in standard interval notation):
// 1. [1,5] - (3,7) returns [true, [1,3], false, (5,7)]
// 2. [1,1] - [1,6] returns [undefined, undefined, false, (1,6]]
// 3. (1,5) - (3,5) returns [true, (1,3), undefined, undefined]
// 4. (1,5) - (3,5] returns [true, (1,3), false, [5,5]]
//
// The implementation of this function uses the utility function
// 'calcIntervalDiff()'.

HalfLinearSubIndex.prototype.calcDiff = halfLinearSubIndexCalcDiff;

function halfLinearSubIndexCalcDiff(lowKey, highKey, lowOpen, highOpen,
                                    otherLowKey, otherHighKey, otherLowOpen,
                                    otherHighOpen)
{
    return calcIntervalDiff(lowKey, highKey, lowOpen, highOpen, otherLowKey,
                            otherHighKey, otherLowOpen, otherHighOpen,
                            this.compareFunc);
}

// This function provides the same functionality as calcDiff for the 
// special case where it is known that both intervals are degenerate.
// The returned value has exactly the same form as for calcDiff 
// (see above) except that here only two possibilities exist:
// 1. The two intervals are identical: in this case an array of 
//    four undefines is returned ([undefined, undefined, undefined, undefined]).
// 2. The two intervals are different. In this case, an array of
//    the form:
//    [<boolean>, <interval object>, <boolean>, <interval object>]
//    where the <interval object>s are objects representing the two
//    intervals compared, with the lower interval appearing first. The objects
//    are of the form:
//    {
//        lowKey: <key>,
//        highKey: <same key>,
//        lowOpen: false,
//        highOpen: false
//    }
//    The <boolean> before each interval indicates wither this interval
//    is the interval given by 'key' (<boolean> is true) or by 'otherKey'.
//    One of these will be true and the other false.
//
// The implementation of this function uses the utility function
// 'calcDegenerateIntervalDiff()' and must use an object format compatible
// with it.

HalfLinearSubIndex.prototype.calcDegenerateDiff = 
    halfLinearSubIndexCalcDegenerateDiff;

function halfLinearSubIndexCalcDegenerateDiff(key, otherKey)
{
    return calcDegenerateIntervalDiff(key, otherKey, this.compareFunc);
}

// This function is called just before the first non-degenerate interval
// needs to be added to the tree. It converts the degnerate interval tree
// into an interval tree.

HalfLinearSubIndex.prototype.convertDegnerateTree =
    halfLinearSubIndexConvertDegnerateTree;

function halfLinearSubIndexConvertDegnerateTree()
{
    var degenerateTree = this.tree;
    var compareFunc =
        this.compareFunc === IntervalTree.prototype.compare ?
        undefined : this.compareFunc;
    
    this.tree = new IntervalTree(compareFunc);
    this.treeIsDegenerate = false;

    if(degenerateTree)
        this.tree.importFromDegenerateTree(degenerateTree);
}

// This is an interface to the findIntersections() function of the 
// (degenerate) interval tree.

HalfLinearSubIndex.prototype.findIntersections = 
    halfLinearSubIndexFindIntersections;

function halfLinearSubIndexFindIntersections(lowKey, highKey, lowOpen, 
                                             highOpen)
{
    return this.tree.findIntersections(lowKey, highKey, lowOpen, highOpen);
}

// This is an interface to the findWithUpperBound() function of the 
// (degenerate) interval tree.

HalfLinearSubIndex.prototype.findWithUpperBound = 
    halfLinearSubIndexFindWithUpperBound;

function halfLinearSubIndexFindWithUpperBound(lowKey, highKey, lowOpen, 
                                              highOpen, upperBound, 
                                              upperBoundOpen)
{
    return this.tree.findWithUpperBound(lowKey, highKey, lowOpen, 
                                        highOpen, upperBound, 
                                        upperBoundOpen);
}

// This is an interface to the findWithLowerBound() function of the 
// (degenerate) interval tree.

HalfLinearSubIndex.prototype.findWithLowerBound = 
    halfLinearSubIndexFindWithLowerBound;

function halfLinearSubIndexFindWithLowerBound(lowKey, highKey, lowOpen, 
                                              highOpen, lowerBound, 
                                              lowerBoundOpen)
{
    return this.tree.findWithLowerBound(lowKey, highKey, lowOpen, 
                                        highOpen, lowerBound, 
                                        lowerBoundOpen);
}

//////////////////////
// Linear Sub-Index //
//////////////////////

//
// Constructor
//

// The constructor takes an optional comparison function (see introduction)
// as argument.
// The constructor simply constructs the two half sub-indexes.

function LinearSubIndex(compareFunc)
{
    this.values = new HalfLinearSubIndex(compareFunc);
    this.lookups = new HalfLinearSubIndex(compareFunc);
}

// Comparison function for strings

LinearSubIndex.stringCompare = function(a,b)
{
    if(a == b)
        return 0;

    if(a === -Infinity)
        return -1;
    else if(a === Infinity)
        return 1;
    else if(b === -Infinity)
        return 1;
    else if(b === Infinity)
        return -1;

    return (a < b) ? -1 : 1;
}

// This is a generic implementation of the common functionality of 
// addValue() and addLookup(). The only difference between addValue()
// and addLookup() is that addValue() adds the interval to the this.values
// table and returns lists of lookup IDs (from this.lookups) for which the 
// match with this interval changed, while addLookup() reverses the roles 
// of this.values and this.lookups: the interval is added to this.lookups 
// and the lists of IDs returned are IDs of values in this.values for
// which the match with the interval changed.
// This function therefore does not access the this.values and this.lookups
// half sub-indexes directly, but receives them as arguments. 'values' is the 
// half sub-index to which the interval should be added and 'lookups'
// is the half sub-index for which the change in matching is returned
// and from which the returned IDs are taken.

LinearSubIndex.prototype.addToHalfSubIndex = linearSubIndexAddToHalfSubIndex;

function linearSubIndexAddToHalfSubIndex(id, lowKey, prevLowKey, highKey,
                                         prevHighKey, lowOpen, prevLowOpen,
                                         highOpen, prevHighOpen,
                                         values, lookups)
{
    // add the ID and interval to the 'values' table, receiving the
    // difference with the previous value in return.
    var diff = values.addInterval(id, lowKey, highKey, lowOpen, highOpen,
                                  prevLowKey, prevHighKey, prevLowOpen,
                                  prevHighOpen);
    
    if(lookups.isEmpty()) 
        // no looks, so no added/removed matches possible.
        return { added: [], removed: [] };

    if(highKey === undefined)
        highKey = lowKey; // degenerate interval
    
    if(diff.length == 2) {
        // no previous interval stored for this ID, just find the matching
        // lookups.
        return {
            added: lookups.findIntersections(lowKey, highKey, lowOpen, 
                                             highOpen),
            removed: []
        };
    }

    var changes = {}; // lookup changes (returned by this function)
    var prev = diff[4]; // previous interval with this ID
    var diffInterval;

    if(interval = diff[1]) {

        // find all lookups intersecting with this difference segment with an
        // upper bound equal to the low end of the interval which does
        // not contain this difference segment.

        var upperBound;
        var upperBoundOpen;
            
        if(diff[0]) { // difference interval contained in new interval 
            upperBound = prev.lowKey;
            upperBoundOpen = !prev.lowOpen;
        } else {
            upperBound = lowKey;
            upperBoundOpen = !lowOpen;
        }
        var lowLookups =
            lookups.findWithUpperBound(interval.lowKey, interval.highKey, 
                                       interval.lowOpen, interval.highOpen,
                                       upperBound, upperBoundOpen);
        if(diff[0])
            changes.added = lowLookups;
        else
            changes.removed = lowLookups;   
    }

    if(interval = diff[3]) {

        // find all lookups intersecting with this difference segment with a
        // lower bound equal to the high end of the interval which does
        // not contain this difference segment.

        var lowerBound;
        var lowerBoundOpen;
            
        if(diff[2]) { // difference interval contained in new interval 
            lowerBound = prev.highKey;
            lowerBoundOpen = !prev.highOpen;
        } else {
            lowerBound = highKey;
            lowerBoundOpen = !highOpen;
        }

        var highLookups =
            lookups.findWithLowerBound(interval.lowKey, interval.highKey, 
                                       interval.lowOpen, interval.highOpen,
                                       lowerBound, lowerBoundOpen);
        if(diff[2]) {
            if(changes.added)
                changes.added = cconcat(changes.added, highLookups);
            else
                changes.added = highLookups;
        } else {
            if(changes.removed)
                changes.removed = cconcat(changes.removed, highLookups);
            else
                changes.removed = highLookups;
        }
    }

    return changes;
}

// See the description of this function in the introduction above.

LinearSubIndex.prototype.addValue = linearSubIndexAddValue;

function linearSubIndexAddValue(id, lowKey, prevLowKey, highKey, prevHighKey,
                                lowOpen, prevLowOpen, highOpen, prevHighOpen)
{
    return this.addToHalfSubIndex(id, lowKey, prevLowKey, highKey, prevHighKey,
                                  lowOpen, prevLowOpen, highOpen, prevHighOpen,
                                  this.values, this.lookups);
}

// See the description of this function in the introduction above.

LinearSubIndex.prototype.addLookup = linearSubIndexAddLookup;

function linearSubIndexAddLookup(id, lowKey, prevLowKey, highKey, prevHighKey,
                                 lowOpen, prevLowOpen, highOpen, prevHighOpen)
{
    return this.addToHalfSubIndex(id, lowKey, prevLowKey, highKey, prevHighKey,
                                  lowOpen, prevLowOpen, highOpen, prevHighOpen,
                                  this.lookups, this.values);
}

// See the description of this function in the introduction above.

LinearSubIndex.prototype.removeValue = linearSubIndexRemoveValue;

function linearSubIndexRemoveValue(id, lowKey, highKey, lowOpen, highOpen)
{
    this.values.removeInterval(id, lowKey, highKey, lowOpen, highOpen);
    
    if(this.lookups.isEmpty())
        return [];

    return highKey === undefined ? // is this a single value or range?
        this.lookups.findIntersections(lowKey, lowKey, false, false) : 
        this.lookups.findIntersections(lowKey, highKey, lowOpen, highOpen);
}

// See the description of this function in the introduction above.

LinearSubIndex.prototype.clearValues = linearSubIndexClearValues;

function linearSubIndexClearValues()
{
    this.values.clear();
}

// See the description of this function in the introduction above.

LinearSubIndex.prototype.removeLookup = linearSubIndexRemoveLookup;

function linearSubIndexRemoveLookup(id, lowKey, highKey, lowOpen, highOpen)
{
    this.lookups.removeInterval(id, lowKey, highKey, lowOpen, highOpen);
    
    if(this.values.isEmpty())
        return [];

    return (highKey === undefined ? // is this a single value or range?
            this.values.findIntersections(lowKey, lowKey, false, false) :
            this.values.findIntersections(lowKey, highKey, lowOpen, highOpen));
}

// This function is used to get the list of values matched by a given
// lookup which is already registered. This does not change the
// registration of the lookup. This may be used by a module which did
// not keep track of the incremental updates received when the look up
// was originally registered and later when values were added and
// removed.  This function receives a single lookup ID as input and
// returns an array of value IDs as output.

LinearSubIndex.prototype.getMatches = linearSubIndexGetMatches;

function linearSubIndexGetMatches(id, lowKey, highKey, lowOpen, highOpen)
{
    if(this.values.isEmpty())
        return [];

    return this.values.findIntersections(lowKey, highKey, lowOpen, highOpen);
}

// This function returns true if the values stored in this sub-index contain
// range values (that is, non-degenerate values). Because this function
// uses the 'treeIsDegenerate' property of the value half-index to
// answer this question, once a range value is added to this sub-index,
// this function will continue to return true, even if all range values
// are subsequently removed.

LinearSubIndex.prototype.hasRangeValues = linearSubIndexHasRangeValues;

function linearSubIndexHasRangeValues()
{
    return !this.values.treeIsDegenerate;
}

// return true, because this sub-index does support (non-degenerate) intervals.

LinearSubIndex.prototype.supportsIntervals = linearSubIndexSupportsIntervals;

function linearSubIndexSupportsIntervals()
{
    return true;
}

// return the number of lookups stored in this sub-index (this is the
// number of IDs stored in the lookup half sub-index).

LinearSubIndex.prototype.hasNoLookups = linearSubIndexHasNoLookups;

function linearSubIndexHasNoLookups()
{
    return this.lookups.isEmpty();
}

// This function should be called immediately after the construction of
// the linear sub-index and is used ot initialize it based on the given
// discrete sub-index. All IDs (values and lookups) are copied from the
// discrete sub-index with their keys into the linear sub-index.
// The function does not return the match list (as in the addValue()
// and addLookup() functions) because the match lists are as in the imported
// discrete sub-index and it is assumed that the calling module 
// already received these matches from the discrete sub-index. 

LinearSubIndex.prototype.loadFromDiscrete = linearSubIndexLoadFromDiscrete;

function linearSubIndexLoadFromDiscrete(discreteSubIndex)
{
    // load the half sub-indexes from the corresponding half sub-indexes 
    // of the discrete sub-index
    this.values.loadDegenerateIntervals(discreteSubIndex.getAllValues());
    this.lookups.loadDegenerateIntervals(discreteSubIndex.getAllLookups());
}
