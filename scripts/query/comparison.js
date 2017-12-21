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


// A Comparison node defines a comparison function. It depends only on
// the description of the comparison and not on the data to which it
// is applied, the comparisons with which it is composed or the
// functions which make use of it for comparison.
// When the same comparison is applied to different data (that is,
// comparisons which share a single description are applied to different
// data) one may construct a single Comparison object for both
// comparisons (compare this with Query, which uses a similar scheme).
//
// Just like a Query is used to construct one or more InternalQueryResult
// function result(s), a Comparison object may be used to construct
// one or more ComparisonResult objects (these are all function result
// nodes which may be inserted into a function result chain).
// When two ComparisonResult objects are constructed with the same
// Comparison object and their dominated indexer, dominated path and
// dominated comparison are the same, the comparisons are assigned the
// same comparison ID and are implemented using the same ComparisonCalc
// object.
//
// Defining a Comparison
// ---------------------
//
// There may be different ways of defining a comparison function.
// Each of these may be defined in a separate inherited class of
// the base class Comparison. Currently, the following comparison
// functions are defined (see documentation of each class separately):
//
// 1. partition comparison: this comparison function is based on partitioning
//    the set into several subsets and specifing an order among these
//    subsets (e.g. elements in 'subset 1' before elements in 'subset 2')
//    and optionally an ordering inside each subset (using the standard
//    comparison function on the projected values).
//    See the PartitionComparison class for more details.

//
// Base Comparison Class (Comparison)
//

// The base Comparison class does rather little at the moment, serving mainly
// as a common base calss for different comparison classes.

// Object Structure
// ----------------
//
// {
//      qcm: <InternalQCM>
//      id: <ID of this comparison object>
//      compResultNum: <number>
//      compCalcs: <Map>{
//          <CompCalc ID>: <CompCalc>
//          .....
//      }
//      destroyPending: undefined|true
// }

//
// qcm: the global internal QCM object.
// id: this is the ID of this comparison object.
// compResultNum: this is the number of CompResult nodes to which
//     this Comparison object is assiged. As long as this is non-zero,
//     the Comparison object may not be destroyed.
// compCalcs: this is a table holding all CompCalc objects allocated to
//     to implement this comparison.
// destroyPending: this flag is added (set to true) when the destroy()
//     function of the Comparison object was called while there were
//     still CompCalc objects registered. When the last CompCalc object
//     is removed, it is checked whether the destroyPending flag is set and,
//     if it is, the Comparison object is destroyed.

// %%include%%: "partitionCompCalc.js"

// Base class constructor: takes the global internal QCM object as its
// first and only argument.

function Comparison(internalQCM)
{
    this.qcm = internalQCM;
    this.id = InternalQCM.newId();
    this.compResultNum = 0;
    this.compCalcs = new Map();
    this.pendingDestroy = undefined;
}

// The base class implementation of the destroy() function only checks
// whether the object can be destroyed. It returns true if it can and
// false if it cannot. If it cannot be destroyed, the flag 'pendingDestroy'
// is set so that if it later becomes possible to destroy the object,
// it will be destroyed.

Comparison.prototype.destroy = comparisonDestroy;

function comparisonDestroy()
{
    if(this.compCalcs.size > 0 || this.compResultNum > 0) {
        this.pendingDestroy = true;
        return false;
    }

    return true;
}

// Returns the ID of this object

Comparison.prototype.getId = comparisonGetId;

function comparisonGetId()
{
    return this.id;
}

// This function should be called once by a CompResult object which is assigned
// this Comparison function as the description of its comparison. It simply
// increases the counter of CompResult nodes making use of this object. 

Comparison.prototype.allocate = comparisonAllocate;

function comparisonAllocate()
{
    this.compResultNum++;
}

// This function should be called once by a CompResult object to which
// this Comparison object was assigned when this assignment is terminated.
// This function simply decreases the counter of CompResult nodes making use
// of this object. If this drops to zero and the destruction of this object
// is pending (that is, it was requested but was blocked because the object
// was still in use) this object is destroyed.

Comparison.prototype.release = comparisonRelease;

function comparisonRelease()
{
    this.compResultNum--;

    if(this.pendingDestroy && this.compResultNum == 0 &&
       this.compCalcs.size == 0)
        this.destroy();
}


// This function allocates a new comparison calculation node for the
// comparison defined by this object for the data stored in 'indexer'
// at path 'prefixProjPathId'. 'key' is the key assigned to
// this comparison calculation by the Internal QCM module.
// This function needs to be implemented in the derived class (since
// a different comparison calculation node is constructed for each type
// of comparison).

Comparison.prototype.newCompCalc = comparisonNewCompCalc;

function comparisonNewCompCalc(indexer, prefixProjPathId, key)
{
    assert(false, "need to define function in derived class");
}

// This function is called to set the given comparison calculation node
// as one which implements this comparison function (on some data set).
// The function implemented here only stores the CompCalc node on this
// Comparison node. However, any intialization of the CompCalc node with
// properties of the Comparison node should take place in the dervied class.

Comparison.prototype.addCompCalc = comparisonAddCompCalc;

function comparisonAddCompCalc(compCalc)
{
    this.compCalcs.set(compCalc.getId(), compCalc);
}

// This function is called to remove the comparison calculation node
// with the given ID as one which implements this comparison function
// (on some data set). The base class implementation of this function
// simply removes the CompCalc object from the list of CompCalcs which
// implement this comparison and, if the Comparison object was marked
// for destruction, destroys it.
// The derived classes should override this function to implement additional
// actions which need to be taken.

Comparison.prototype.removeCompCalc = comparisonRemoveCompCalc;

function comparisonRemoveCompCalc(compCalcId)
{
    if(!this.compCalcs.has(compCalcId))
        return;

    this.compCalcs.delete(compCalcId);

    if(this.pendingDestroy && this.compCalcs.size == 0 &&
       this.compResultNum == 0)
        this.destroy();
}

//////////////////////////
// Partition Comparison //
//////////////////////////

// This comparison class defines a comparsion based on a partition of the
// set of elements into subsets. This sequence of subsets is ordered.
// Each elements is first assigned a position based on the first subset
// to which it belongs. Within each subset, the elements may further be
// sorted using the standard comparison function (on numbers/strings)
// based on the projection defined within each subset.
//
// The comparison function is defined by:
// 1. a projection path.
// 2. zero or more queries (which are composed with the given projection path).
//    Each of the queries specified is composed with the projection path.
// 3. An optional gap position in this seqeuce of queries. For example, if
//    the queries are Q1, Q2 and Q3 (in this order) then a gap at position
//    0 is before Q1, a gap at position 1 is between Q1 and Q2, a gap at
//    position 2 is between Q2 and Q3 and all other gaps are after
//    Q3 (this is also the default in case no gap position is specified).
//    A gap introduced into the sequence modifies the position of all
//    subsequent queries in the sequence (e.g. a gap at position 1
//    moves the queries which were original at position 1 and 2 to positions
//    2 and 3).
// 4. Partition Order Ascending/Descending flag: this indicates whether
//    the order of the queries defining the partition should be
//    considered ascending (first query in the array matches the
//    elements which are first in the ordering) or descending (last
//    query in the array matches the elements which are first in the
//    ordering). When the order is descending and the optional gap
//    position is provided, this gap position refers to the position
//    in the original array of queries (as provided in the
//    definition). Therefore, under a descending order, a gap position
//    of zero orders the unmatched elements as the last elements while
//    a gap position equal to the length of the array orders them as
//    first.  On the other hand, an undefined gap position always
//    orders the unmatched elements as last, regardless of whether the
//    queries are ordered ascending or descending.
// 4. Value Order Ascending/Descending: this is an optional flag and
//    may, therefore, have three values: undefined, true, false. If this
//    flag is not undefined, the element within each partition set (excluding
//    the gap set) are sorted based on the value projected for them by
//    the query, in either ascending or descending order (depending on
//    whether the flag is true or false). The satndard numeric/string
//    comparison functions are used for this (other values are considered
//    incomparable under this comparison).
//
// More specifically, for each element (data element ID) a sort key is
// assigned to it by the comparison function is as follows.
// 1. First sort key: the position in the query sequence of the first query
//    in the sequence (composed with the projection path) which matches
//    the element. If the element is not matched by any query, then
//    the position of the gap in the sequence.
// 2. Second sort key: this is defined only if a sorting direction is
//    defined. The key is then the result of the first non-empty
//    projection of the element, where for every query in the sequence of
//    queries defining the comparison, the projection is:
//    a. If the query is a projection, the projection defined by the
//       query (after composing it with the projection path of the
//       comparison).
//    b. Otherwise, the projection path of the comparison.
//    If the projection for a given data element is empty (this can happen
//    only if the element is matched by the gap) then the second sort key is
//    undefined (the element is then incomparible by this comparison).
//    It may also happen that the projection results in more than one projected
//    element for the same compared element (or none). We then take
//    the minimal (in case of "increasing") or maximal (in case of
//    "decreasing") key (of all projected keys of a single element) as
//    the sort key for that element.
//    When there is at least one partition query then for the unmatched
//    elements (those assigned to the 'gap' partition) and undefined
//    second key is assigned here.
//
// The comparison defined on the elements is then based on first comparing
// the first sort key (if there is more than one value possible) in
// increasing order. If two compared elements have different keys as
// their sort keys, this determines their order. If two elements have the
// same first sort key and a second sort key is defined, the second sort
// keys of the two elements are compared. The comparison is then depends
// on the direction of comparison defined. If the direction is "increasing",
// the element with the smaller sort key is considered as being smaller
// by the comparison function and otherwise it is the element with the
// larger sort key which is considered smaller.
//
// Interface
// ---------
//
// A module which wants to define a partition comparison should first create
// a PartitionComparison object. It can then perform the following actions:
// 1. call <PartitionComparison>.setPartition() to set (and later change)
//    the definition of the partition. This can be called both before
//    assigning this Comparison node to some Compresult node or after
//    doing so.
// 2. Assign this Comparison node to one or more CompResult nodes
//    by calling <CompResult>.setComparison(<Comparison>). This
//    can be done before or after the CompResult node is inserted
//    into the function result chain. setComparison() may also be called
//    multiple times on the same CompResult object.
// 3. Insert the CompResult node into the FuncResult chain at the place
//    where the relevant sorting takes place. This can be done either
//    before or after the Comparison object is set on the CompResult node.
//
// Object Structure
// ----------------
//
// {
//      projPathId: <path ID>
//      queries: <array of Query objects>
//      gapPos: undefined|<number>
//      partitionAscending: true|false
//      valueAscending: undefined|true|false
// }
//
// projPathId: this path is prefixed to the paths of all queries specified
//     in 'queries' (to this, the dominated path of the data to which this
//     comparison is applied is added when the CompCalc object is created).
// queries: this is an array of Query objects which define the partition
//     on which the comparison is based.
// gapPos: this is the position of the 'gap' in the partition, which defines
//     the place in the ordering of elements which were not matched by any
//     of the queries in the partition. This gap may be undefined, in which
//     case unmatched elements are always ordered last (whether the partition
//     queries are in ascending or descending order). Otherwise, gapPos
//     should be an integer between 0 and the number of queries in 'queries'.
//     A gapPos value larger than the number of queries is considered equal
//     to the number fo queries. When the partition order is descending,
//     the gap position is also reversed, so the actual gap position
//     becomes (number of queries - gap position). Here, we always store the
//     original gap position as provided upon setting the description.
// partitionAscending: indicates whether the ordering places the elements
//     in the order of the queries which match them or in the opposite order.
// valueAscending: if undefined, elements within the same partition subset
//     are not compareable. Otherwise, the elements inside each partition are
//     ordered by the values projected by the partition query for each of them.
//     These values are compared using the standard numeric or string
//     comparison and the corresponding elements are then ordered by
//     ascending or descending order of these values, as specified by
//     'valueAscending'.

inherit(PartitionComparison, Comparison);

//
// Constructor
//

// The constructor takes the global Internal QCM object as its first and
// only argument. To set the description of the comparison, one should
// call 'setPartition()' below.

function PartitionComparison(internalQCM)
{
    this.Comparison(internalQCM);
    
    this.projPathId = undefined;
    this.queries = undefined;
    this.gapPos = undefined;
    this.partitionAscending = undefined;
    this.valueAscending = undefined;
}

// Destroy function of derived class.

PartitionComparison.prototype.destroy = partitionComparisonDestroy;

function partitionComparisonDestroy()
{
    if(!this.Comparison_destroy())
        return; // no destroy allowed to take place

    // currently, no further action needs to take place
}

// This function can be used to set the description of this partition
// comparison. The arguments of the function identical in meaning to the
// fields with the same name in this object (see details in the object
// description above).
// This function stores the given arguments to this object.
// If this PartitionComparison function is already assigned one or
// more comparison calculation nodes, calling this function immeidately
// updates the comparison performed by those comparison calculation nodes.

PartitionComparison.prototype.setPartition = partitionComparisonSetPartition;

function partitionComparisonSetPartition(projPathId, queries, gapPos,
                                         partitionAscending,
                                         valueAscending)
{
    this.projPathId = projPathId;
    this.queries = queries ? queries : [];
    this.gapPos = gapPos;
    this.partitionAscending = !!partitionAscending;
    this.valueAscending = valueAscending; // may be undefined|true|false

    if(this.compCalcs.size > 0) {
        var queries = this.getQueries();
        var gapPos = this.getGapPos();
        
        this.compCalcs.forEach(function(compCalc, id) {
            compCalc.updatePartition(queries, gapPos, valueAscending);
        });
    }
}

///////////////////////////////////
// CompCalc Addition and Removal //
///////////////////////////////////

// This function creates and returns a new comparison calculation node
// to apply the comparison defined by this PartitionComparison node
// to the data in indexer 'indexer' at path 'prefixProjPathId'.
// 'key' is the key under which the comparison calculation node created here
// is stored in the central InternalQCM object.

PartitionComparison.prototype.newCompCalc = partitionComparisonNewCompCalc;

function partitionComparisonNewCompCalc(indexer, prefixProjPathId, key)
{
    return new PartitionCompCalc(this.qcm, this, indexer, prefixProjPathId,
                                 key);
}

// This function is called to set the given comparison calculation
// node (which must be of type PartitionCompCalc) as one which
// implements this comparison function (on some data set).
// This function registers the CompCalc node and then sets the
// properties of the partition comparison on the CompCalc node.

PartitionComparison.prototype.addCompCalc = partitionComparisonAddCompCalc;

function partitionComparisonAddCompCalc(compCalc)
{
    // base class function
    this.Comparison_addCompCalc(compCalc);

    // set the properties of the comparison on the CompCalc node (if already
    // defined).
    if(this.queries !== undefined)
        compCalc.updatePartition(this.getQueries(), this.getGapPos(),
                                 this.valueAscending);
}

// This function is called to remove the comparison calculation node
// (of type PartitionCompCalc) with the given ID
// as one which implements this comparison function (on some data set).

PartitionComparison.prototype.removeCompCalc =
    partitionComparisonRemoveCompCalc;

function partitionComparisonRemoveCompCalc(compCalcId)
{
    // base class function
    this.Comparison_removeCompCalc(compCalcId);
}

// This function returns an integer which is the position of the gap
// in the query sequence which defines the partition (see introduction).
// The integer returned is between 0 and the length of the query list.
// This already takes into account the value of 'this.partitionAscending'.

PartitionComparison.prototype.getGapPos = partitionComparisonGetGapPos;

function partitionComparisonGetGapPos()
{
    var numQueries = this.queries.length;
    if(this.gapPos === undefined)
        return numQueries;
    
    var gapPos = this.gapPos > numQueries ? numQueries : this.gapPos; 
    
    return this.partitionAscending ? gapPos : (numQueries - gapPos);
}

// This function returns an array of Query objects which is the set of
// Query objects defining this partition comparison. The order of the
// Query objects is as in 'this.queries' but adjusted for the direction
// defined by 'this.partitionAscending'. If this flag is true, the order
// is as in 'this.queries' but if that flag is false, an array with the
// inverse order is used.

PartitionComparison.prototype.getQueries =
    partitionComparisonGetQueries;

function partitionComparisonGetQueries()
{
    if(this.partitionAscending)
        return this.queries;

    return this.queries.concat().reverse();
}


