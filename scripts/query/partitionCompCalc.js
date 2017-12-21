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


// This object implements the comparison function defined by a
// PartitionComparison object. This object specifies a set of
// queries (Query objects), possibly a gap position in the sequence
// of queries and (optionally) a sort direction ("ascending" or "descending").
// For each element being compared we need to know which is the first
// query in the sequence which matches it. For this purpose we construct
// an InternalQueryResult node for each query defined in 'comparison'
// and a PartitionCompResult is used to create a function result chain for
// these query results (the PartitionCompResult object both creates
// a DataResult object which is the source of the data for these queries
// (this represents the data being compared) and the PartitionCompResult
// object itself serves as the composed result node which activated the
// query results and receives notifications from them.
//
// Partition Matching
// ------------------
//
// The data to which the queries are applied is defined by the indexer
// of the CompResult object which owns this CompCalc object together
// with the concatenation of the projection path of the CompResult object
// and the projection path defined in the Comparison object (the
// Comparison path is concatenated after the CompResult path). The
// CompResult projection path defines the data which is compared by this
// comparison function while the projection path defined in the Comparison
// object defines the relative path (to the path at which the elements
// are compared) at which the value which define the comparison are to
// be found.
//
// The matches of the queries are returned at this concatenated path.
// This means that the matches may have to be raised to the projection
// path of the CompResult object (as this is the path at which
// the comparison applies). To determine whether such raising is required,
// a CompValueQueryCalc node is registered to the indexer to receive
// match points for the concatenated projection path. The same
// CompValueQueryCalc may also be used for registering for key updates
// when a sort key is defined on the values of the keys projected
// (for the queries which are selections, the projected keys
// are at the concatenated path).
//
// Sort Keys
// ---------
//
// This object maintains a set of comparison keys. The comparison keys
// are indexed by data element ID. The same data element ID cannot
// refer to different keys in the same comparison function, even if that
// data element comes from order functions applied to different sets
// (this is because even when projection paths change or even
// data elements are mapped in merge indexers, any mapping which
// takes place will assign a new data element ID rather than make
// use of an existing element ID, unless it continues to refer to
// the same data element).
//
// This object therefore stores an IntHashMap object of keys.
//
// The matches received from each query in the partition are first raised
// to the projection path at which the comparison is defined (that is,
// 'this.prefixProjPathId'). The order key of the query is then registered
// under the raised data element ID. In case several
// queries match the same element ID, we store the order key of these
// matches too.

// Object Structure
// ----------------
//
// This class adds the following fields to the base class object:
//
// {
//     compProjPathId: <path ID>
//     valueQueryCalc: <CompValueQueryCalc>
//
//     valueAscending: undefined|true|false
//
//     queryToResult: <Map>: {
//         <query ID>: <query result ID>,
//         .....
//     },
//     queryResults: <Map>{
//         <query result ID>: {
//              result: <InternalQueryResult>,
//              orderKey: <number>,
//              valueQueryCalc: <CompValueQueryCalc>
//              updated: true|false
//         }
//         .....
//     }
//     gapOrderKey: <number>
//     
//     funcResult: <PartitionCompResult>
//
//     // sort key
//
//     firstKey: <CompCalcKeys>
//     secondKey: <CompCalcKeys>
//
//     partitionRemovedElements: <IntHashMap>{
//         <result ID>: <IntHashMap>{
//              <element ID>: <second key>,
//              ......
//         }
//         ......
//     }
//     removedElements: <IntHashMap>{
//         <element ID>: <second key>,
//         .....
//     }
// }
//
// compProjPathId: this is a projection path which is prefixed to
//     all queries in the partition. This projection path is a concatenation
//     of the projection path of the Comparison object after
//     'this.prefixProjPathId' (defined in the base CompCalc object).
//     Each of these two projection paths defines a different part of the
//     total path:
//     1. this.prefixProjPathId defines the projection path at which
//        the elements being compared can be found.
//     2. the projection path of the Comparison defines a common projection
//        path for all queries which define the partition.
// valueQueryCalc: this is a CompValueQueryCalc object which provides
//     common services for all partition queries which are selections
//     (without a result indexer) and for the unmatched matches.
//     In this case, the CompValueQueryCalc is registered to the indexer
//     at the path 'compProjPathId' (for partition queries which are
//     projections, we register a separate CompValueQueryCalc object at
//     the projection path of each of these queries).
// valueAscending: this is equal to the 'valueAscending' property of the
//     Comparison object defining this comparison. If this is undefined,
//     the comparison is only based on memebership in the partition sets
//     (all elements in one partition set are before all elements in
//     the other partition set). If this is true or false, the comparison
//     also has a second key, based (inside each partition set) on
//     the standard comparison of the values projected for each data
//     element ID by the partition queries.
// queryToResult: this table provides a translation from the IDs of
//     the Query objects which define the partition to the IDs of the
//     query result objects which implement these queries.
// queryResults: this table stores zero or more InternalQueryResult objects
//     which implement the queries which define this partition comparison.
//     Each query result node is stored under the ID of the query result
//     object. For each such query result node, the tble stores the following
//     information:
//        result: the InternalQueryResult object itself
//        orderKey: the order key of the query (this is the key
//            assigned to all elements matched by the query).
//        valueQueryCalc: this is a CompValueQueryCalc object assigned to
//            this query in case it is a projection query (for the selection
//            queries we have one common CompValueQueryCalc node).
//        updated: this is a flag used during the update process of this list.
//            New entries and entries which are to be kept when the list
//            of queries are refreshed have 'updated' set to true. Entries
//            with 'updated: false' can then be removed. At the end of
//            the refresh process all entries are set to 'updated: false'
//            (for the next round).
// gapOrderKey: this is the order key assigned to all elements which were
//     not matched by any of the queries.
//
// funcResult: this is a PartitionCompResult object which implements the
//     function result node aspects of this PartitionCompCalc node.
//     It is composed with the query result nodes for the queries
//     which define this comparison and receives notifications from
//     these query result nodes. It then forwards these updates to
//     update the compariosn keys.
//
// firstKey: this is a CompCalcKeys object which stores the partition key
//     assigned by this comparison function to the data elements.
//     If there are any partitions defined, this is the smallest order
//     key of all the order keys of partition queries which match the
//     element and if there is no such matching query, this is the gap
//     order key. If there are no partitions defined, this array is
//     undefined.
// secondKey: this is a CompCalcKeys object which stores the value key assigned
//     by this partition comparison. This is the value projected by the
//     first partition which matches the data element. This is defined only
//     if this comparison is defined to apply value comparison
//     (this.valueAscending is not undefined). Otherwise, 'secondKey'
//     is undefined.
//     The keys in this table are not guaranteed to exist before the comparison
//     is caried out. When no key is stored in this table for an element which
//     needs to be compared, it is fetch and stored. Once key(s) are stored
//     in this table for some element ID, they will continue to be updated
//     (by receiving key updates from the indexer).
//
// partitionRemovedElements: this is a table with an entry for each
//     query result defining a partition (the query results in the
//     'queryResults'). For each such query result, this table stores the
//     elements for which a removal update was received from the query result.
//     These removal updates are not processed immediately, but are queued
//     here. The actual removal takes place only at the end of the
//     path node execution queue (to ensure that any composed ordering
//     function which relies on these keys can still access them).
//     Only after all path node epilogues have been executed, the
//     pending comparison function updates are executed and this update
//     removes these queued elements.
//     If elements are added by a query result after having been queued
//     here for the same query result, the element is removed from this
//     queue.
// removedElements: this is the same as 'partitionRemovedElements' but
//     for matches removed by the common CompValueQueryCalc object
//     (this can happen only when there are no partitions defined, so these
//     two tables are never used at the same time).
//
// removalQueued: a boolean flag which indicates whether this object is
//     currently queued on the indexer queue to remove its queued removals.
//     

// %%include%%: "compCalc.js"
// %%include%%: "compCalcKeys.js"
// %%include%%: "compValueQueryCalc.js"
// %%include%%: "internalQueryResult.js"
// %%include%%: "partitionCompResult.js"

inherit(PartitionCompCalc, CompCalc);

// The constructor of the partition comparison class takes the same arguments
// as the base class constructor (see documentation of the base class).
// The constructor only stores the values, but does not yet read the
// description of the comparison from the Comparison object. It is
// the responsibility of the Comparison object to push its description
// to the CompCalc object.

function PartitionCompCalc(internalQCM, comparison, indexer, prefixProjId, key)
{
    this.compProjPathId = undefined;
    this.valueQueryCalc = undefined;

    this.valueAscending = undefined;
    
    this.queryToResult = new Map();
    this.queryResults = new Map();
    this.gapOrderKey = undefined;

    // function result node to chain with the queries defining the partition
    this.funcResult = new PartitionCompResult(internalQCM, this, indexer,
                                              prefixProjId);

    this.partitionRemovedElements = undefined;
    this.removedElements = undefined;
    this.removalQueued = false;
    
    // base constructor may initialize queries if all is ready
    this.CompCalc(internalQCM, comparison, indexer, prefixProjId, key);
}

// Destruction function (destroys all function result nodes created here)

PartitionCompCalc.prototype.destroy = partitionCompCalcDestroy;

function partitionCompCalcDestroy()
{
    this.removalQueued = false; // in case it is still scheduled
    
    this.funcResult.destroy(); // also destroy the query result nodes
    if(this.valueQueryCalc)
        this.valueQueryCalc.destroy();

    this.queryResults.forEach(function(entry, resultId) {
        entry.result.destroy();
        if(entry.valueQueryCalc)
            entry.valueQueryCalc.destroy();
    });

    this.queryResults.clear();
    this.queryToResult.clear();
    
    this.CompCalc_destroy();
}

// This function returns the number of partition queries defined (this
// does not include the 'gap' partition).

PartitionCompCalc.prototype.numPartitions = partitionCompCalcNumPartitions;

function partitionCompCalcNumPartitions()
{
    return this.queryResults.size;
}

// See general documentation of this function in CompCalc.js. This function
// returns true if the 'prefixProjPathId' and the 'compProjPathId' of this
// comparison are the same, since in those situations it is possible that
// the owner CompResult node(s) get matches added before this object had
// the chance to update the comparison function.

PartitionCompCalc.prototype.needToSuspendOrderingUponAddition =
    partitionCompCalcNeedToSuspendOrderingUponAddition;

function partitionCompCalcNeedToSuspendOrderingUponAddition()
{
    return (this.compProjPathId !== undefined &&
            this.compProjPathId === this.prefixProjPathId);
}

/////////////////////////////////
// Activation and Deactivation //
/////////////////////////////////

// This function is called when this CompCalc is activated (that is, when
// the first of its CompResult nodes becomes order*).
// This function then notifies the result node wrapping the queries that
// it was activated.

PartitionCompCalc.prototype.activated = partitionCompCalcActivated;

function partitionCompCalcActivated()
{
    if(this.funcResult !== undefined)
        this.funcResult.activated();
}

// This function is called when this CompCalc is deactivated (that is, when
// the last of its CompResult nodes stops being order*).
// This function then notifies the result node wrapping the queries that
// it was deactivated.

PartitionCompCalc.prototype.deactivated = partitionCompCalcDeactivated;

function partitionCompCalcDeactivated()
{
    if(this.funcResult !== undefined)
        this.funcResult.deactivated();
}

////////////////////////////////
// Comparison and Data Update //
////////////////////////////////

// This function sets the indexer and projection path of the data result
// node to which the queries of the partition should be applied. This
// function first calculates the prefix projection path of the queries
// which is a concatenation of:
// 1. the prefix path provided by the CompResult which owns this CompCalc
//    object (this projection path defines the data being compared).
// 2. The projection path defined in the Comparison (which is a prefix
//    path for the queries which determine the comparison).
// This combined path is stored and then the path and indexer are passed
// on to the result node which constructs the function result chain for
// the partition queries.
// This function should be called every time either the indexer or the
// combined proejction path may have changed (if it eventually turns out
// it these did not change, there is littel harm done).

PartitionCompCalc.prototype.updateQueryData = partitionCompCalcUpdateQueryData;

function partitionCompCalcUpdateQueryData()
{
    var newCompProjPathId;
    
    if(this.indexer === undefined || this.prefixProjPathId === undefined ||
       this.comparison === undefined)
        newCompProjPathId = undefined;
    else {
        newCompProjPathId =
            this.qcm.allocateConcatPathId(this.prefixProjPathId,
                                          this.comparison.projPathId);
    }
    
    if(this.compProjPathId !== undefined)
        this.qcm.releasePathId(this.compProjPathId);
    
    this.compProjPathId = newCompProjPathId; 
    
    this.funcResult.setDataResult(this.indexer, this.compProjPathId);

    // refresh (if needed) the registration of the CompValueQueryCalc
    // object which serves the unmatches ('gap') elements
    
    var prevValueQueryCalcId = this.valueQueryCalc ?
        this.valueQueryCalc.getId() : undefined;
    this.updateValueQueryCalc(undefined);

    if(this.valueQueryCalc.needMatchUpdates &&
       prevValueQueryCalcId != this.valueQueryCalc.getId())
        // new QueryCalc which needs to project matches. Existing elements
        // are not pushed from the indexer, so they need to be pulled.
        this.addProjPathMatches(this.valueQueryCalc.getAllMatches());

}

///////////////////////
// Partition Refresh //
///////////////////////

// This function receives an array 'queries' of Query objects and an integer
// 'gapPos' which defines a gap position in this sequence. Together,
// these define the partition of this comparison function. This function
// is called when this object is first constructed and later when the
// list of queries changes (and/or the gap position changes and/or the
// valueAscending property changes).
// The function begins by comparing the existing list of queries defining
// the partition with the new list of queries. The order keys of
// the existing queries and the gap are reassigned, old queries which are
// no longer part of the partition are removed (including their query
// result node) and the new queries are added (new query result nodes
// are created for them and inserted into a function result chain).
// Sort keys of queries which remain in the partition are translated,
// if necessary, and sort keys due to removed queries are removed.
// Sort keys due to new queries will only be added when updates are
// received from those queries.
// This function also notifies dominated nodes of teh change to the ordering.

PartitionCompCalc.prototype.updatePartition = partitionCompCalcUpdatePartition;

function partitionCompCalcUpdatePartition(queries, gapPos, valueAscending)
{
    var translation = []; // old order key -> new order key
    var orderKey = 0;
    var changedOrderKey = false;
    var newQueryEntries = [];
    
    for(var i = 0, l = queries.length ; i < l ; ++i) {

        if(i == gapPos) { // update gap order key
            if(this.gapOrderKey !== undefined)
                translation[this.gapOrderKey] = orderKey;
            if(this.gapOrderKey !== orderKey)
                changedOrderKey = true;
            this.gapOrderKey = orderKey;
            orderKey++;
        }

        var update = this.addQueryResult(queries[i], orderKey, translation,
                                         newQueryEntries);
        if(update.changedOrderKey)
            changedOrderKey = true;
        orderKey = update.orderKey;
    }

    if(gapPos >= queries.length) { // gap order key not updated in loop above
        if(this.gapOrderKey !== undefined)
            translation[this.gapOrderKey] = orderKey;
        if(this.gapOrderKey !== orderKey)
            changedOrderKey = true;
        this.gapOrderKey = orderKey;
    }

    // destroy query result nodes which are no longer needed

    var _self = this;
    
    this.queryResults.forEach(function(entry, resultId) {
        if(!entry.updated) { // remove the entry
            changedOrderKey = true;
            _self.removeQueryResult(entry);
        } else
            entry.updated = false; // reset the flag
    });

    this.valueAscending = valueAscending;
    
    // update the existing keys before receiving notifications for the new keys.
    this.updateFirstKeyAfterPartitionUpdate(changedOrderKey, translation);
    this.updateSecondKeyAfterPartitionUpdate();
    
    // reset the data (of existing queries) this also triggers an update
    // in case the projection path of the partition changed 
    this.updateQueryData();
    
    // add the new queries to the function result chain of 'this.funcResult'
    // (this actually makes them calcualte the query).
    for(var i = 0, l = newQueryEntries.length ; i < l ; ++i)
        this.funcResult.addQueryResult(newQueryEntries[i].result);
    
    this.refreshOrdering();
}

// This function creates a new InternalQueryResult object and entry in
// the 'queryResults' table for the partition query defined by the
// Query object 'query' if no InternalQueryResult was yet assigned to
// the given Query object and otherwise updates the existing
// InternalQueryResult and its entry in 'queryResults'. The update consists
// of constructing the InteralQueryResult object (if needed) assigning the
// query to it and assigning/updating the order key to the entry. The entry
// is marked as 'updated' (to distinguish it from entries which are about
// to be removed). 'orderKey' should be the next order key to assign this
// query, but this function may assign it a higher order key if that equals
// its existing order key. In addition, in case of an existing entry,
// the new orderKey (whether equal or different from the old key) is stored
// at a position equal to the old orderKey in the array 'translation'
// (this array must be provided by the calling function). Finally, if
// an entry (in the 'queryResults' table) is new, it is added to the array
// 'newQueryEntries' which is also an array which needs to be provided by
// the calling function.
// The function returns an object of the form:
// {
//     orderKey: <the next order key to use>,
//     changedOrderKey: true|false
// }
// where changedOrderKey is true iff the order key of an existing entry
// was changed by this operation.

PartitionCompCalc.prototype.addQueryResult =
    partitionCompCalcAddQueryResult;

function partitionCompCalcAddQueryResult(query, orderKey, translation,
                                         newQueryEntries)
{
    var changedOrderKey = false;
    var queryId = query.getId();
    
    
    if(this.queryToResult.has(queryId)) { // existing query
        var queryResultId = this.queryToResult.get(queryId);
        var entry = this.queryResults.get(queryResultId);
        entry.updated = true;
        if(entry.orderKey >= orderKey) // keep query's order key
            orderKey = translation[entry.orderKey] = entry.orderKey;
        else { // change query's order key
            changedOrderKey = true;
            translation[entry.orderKey] = orderKey;
            entry.orderKey = orderKey;
        }
    } else { // new query, create an entry for it
        var entry = {
            result: new InternalQueryResult(this.qcm),
            orderKey: orderKey,
            updated: true
        };
        // set the query, but don't add this result node to the
        // function result chain yet (so no query is calculated yet)
        entry.result.setQuery(query);
        newQueryEntries.push(entry);
        this.queryResults.set(entry.result.getId(), entry);
        this.queryToResult.set(queryId, entry.result.getId());
    }

    orderKey++;
    
    return { orderKey: orderKey, changedOrderKey: changedOrderKey };
}

// This function removes from this object the entry for the query result
// whose entry in the 'queryResults' table is 'resultEntry'. This also
// destroys the query result node (which implemented one of the queries
// of the partition until now). The query result object is removed from
// all tables and then destroyed.

PartitionCompCalc.prototype.removeQueryResult =
    partitionCompCalcRemoveQueryResult;

function partitionCompCalcRemoveQueryResult(resultEntry)
{
    var result = resultEntry.result;
    this.queryToResult.delete(result.query.getId());
    this.funcResult.removeQueryResult(result);

    var resultId = result.getId();
    if(resultEntry.valueQueryCalc)
        resultEntry.valueQueryCalc.destroy();
    else
        this.valueQueryCalc.removeResultId(resultId);
    this.queryResults.delete(resultId);

    result.destroy();
}

/////////////////////////////
// Value QueryCalc Refresh //
/////////////////////////////

// This function should be called when there is reason to think that the
// CompValueQueryCalc object for the given query result object (for one of
// the partition queries) needs to be replaced (because the indexer or
// path changed) or modified (because key updates need to be turned on or
// off). This holds both for queries which have their own value QueryCalc
// object and for queries which share the main value QueryCalc object.
// Calling this function with undefined will perform the same update
// for the CompValueQueryCalc object for the unmatched elements.
// This function first checks whether a change is needed and only if it is,
// creates a new object and destroys the old one. Either the old or the new
// value QueryCalc may be undefined (when either the indexer or the path
// is undefined).

PartitionCompCalc.prototype.updateValueQueryCalc =
    partitionCompCalcUpdateValueQueryCalc;

function partitionCompCalcUpdateValueQueryCalc(queryResult)
{
    if(queryResult === undefined) {
        // last argument: need match updates if no partition queries
        // and the comparison function compares values
        this.valueQueryCalc =
            this.replaceValueQueryCalc(this.valueQueryCalc, undefined,
                                       this.indexer, this.compProjPathId,
                                       (this.numPartitions() == 0 &&
                                        this.valueAscending !== undefined));
        return;
    }

    var resultId = queryResult.getId();
    var resultEntry = this.queryResults.get(resultId);
    var indexer = queryResult.getDominatedIndexer();
    var pathId = queryResult.getDominatedProjPathId();

    if(indexer == this.indexer && pathId == this.compProjPathId) {
        // can use the shared QueryCalc
        if(resultEntry.valueQueryCalc !== undefined) {
            resultEntry.valueQueryCalc.destroy();
            resultEntry.valueQueryCalc = undefined;
        }
        this.valueQueryCalc =
            this.replaceValueQueryCalc(this.valueQueryCalc, resultId,
                                       this.indexer, this.compProjPathId,
                                       false);
    } else {
        resultEntry.valueQueryCalc =
            this.replaceValueQueryCalc(resultEntry.valueQueryCalc, resultId,
                                       indexer, pathId, false);
    }
}

// This function is given an existing CompValueQueryCalc object
// 'valueQueryCalc' (which may be undefined) and checks whether this
// is the right object for the given indexer, path ID, the projection
// path ID of the comparison and the 'needMatchUpdates' property (which
// indicates whether this value QueryCalc needs to notfy of match changes -
// used whne no partition queries are defined). If it is, this function
// simply returns the 'valueQueryCalc' provided as input (after having
// updated its 'needKeyUpdates' property and setting the given 'resultId'
// as an ID of a result node which makes use of this object). If this is
// not the right node, 'valueQueryCalc' is destroyed (if it is not undefined)
// and a new object is created (possibly undefined if the indexer or path is
// missing) and returns the new object. The calling function should
// replace the old object with new object (wherever it is stored).

PartitionCompCalc.prototype.replaceValueQueryCalc =
    partitionCompCalcReplaceValueQueryCalc;

function partitionCompCalcReplaceValueQueryCalc(valueQueryCalc, resultId,
                                                indexer, pathId,
                                                needMatchUpdates)
{
    if(indexer === undefined || pathId === undefined) {
        // no value query calc should be defined
        if(valueQueryCalc !== undefined)
            valueQueryCalc.destroy();
        return undefined;
    }

    // no need for key updates if no value sorting takes place or if
    // this value QueryCalc only serves the 'gap' partition while there
    // are some partitions defined.
    var needKeyUpdates = (this.valueAscending !== undefined) &&
        (resultId !== undefined || this.numPartitions() == 0 ||
         (valueQueryCalc !== undefined &&
          valueQueryCalc.getResultIds().length > 0));
    
    if(valueQueryCalc !== undefined && valueQueryCalc.indexer == indexer &&
       valueQueryCalc.pathId == pathId &&
       valueQueryCalc.prefixProjPathId == this.prefixProjPathId &&
       valueQueryCalc.needMatchUpdates == needMatchUpdates) {
        // value query calc unchanged except, perhaps, for 'needKeyUpdates'
        valueQueryCalc.setNeedKeyUpdates(needKeyUpdates);
        if(resultId !== undefined)
            valueQueryCalc.addResultId(resultId);
        return valueQueryCalc;
    }

    // construct a new value query calc object
    
    var newValueQueryCalc =
        new CompValueQueryCalc(this, resultId, indexer, pathId,
                               this.prefixProjPathId, needKeyUpdates,
                               needMatchUpdates);

    if(valueQueryCalc !== undefined)
        valueQueryCalc.destroy();

    return newValueQueryCalc;
}

/////////////////
// Key Refresh //
/////////////////

// This function is called when the comparison description is refreshed.
// This should be called after the new order keys of the existing
// partition queries were calculated (including determining which of them
// were removed). This function then updates the first key of the comparison,
// that is, the key which depends only on the partition which matches
// each element. This function performs that part of the update for which
// not further notification will be received (that is, for the new queries
// which were added to the partition). In addition, it updates the second
// key (if exists) to the extent that this is affected by the changes to
// the first key. This includes removing the second key for element IDs
// which do not have a first key after the first keys were updated and
// modifying sequence keys (where the sequence also includes the first key).
// This function first determined whether a first key exists at all
// (dependent on whether there are any partition queries defined).
// If yes, it initializes the first key object and translates those
// keys which need translation.
// The argument 'changedOrderKey' indicates whether there was any existing
// query whose order key (the key defining its position in the partition)
// changed. This includes both queries which remain in the partition but
// were assigned a new order key and queries which were removed from
// the partition. 'translation' is an array storing a translation of old
// order keys to new order keys (the old order key is the position in the
// array and the new order key is the value stored at that position in the
// array). The new order key may be undefined (meaning that the query was
// removed.
// When this function is called, the number of entries in this.queryResults
// is the number of queries defining the partition (entries were already
// added and removed from this table).

PartitionCompCalc.prototype.updateFirstKeyAfterPartitionUpdate =
    partitionCompCalcUpdateFirstKeyAfterPartitionUpdate;

function partitionCompCalcUpdateFirstKeyAfterPartitionUpdate(changedOrderKey,
                                                             translation)
{
    if(this.numPartitions() == 0) {
        if(this.firstKey !== undefined) {
            this.firstKey = undefined;
            this.secondKey = undefined; // cleared, will constructed again
        }
        return; // no first key, as there is a single unmatched partition
    }

    if(this.firstKey === undefined)
        this.firstKey = new CompCalcKeys(true, this.gapOrderKey);
    else if(changedOrderKey) { // need to update the existing key table
        this.firstKey.translateKeys(function(x) { return translation[x]; });
        if(this.secondKey) { // translate second key based on first key
            // remove second keys for which there is no first key anymore
            this.secondKey.clearKeysByRefList(this.firstKey.keys);
            // translate the sequence second keys (those that also include
            // the first key)
            var translationFunc = function(x) {
                if(!(x instanceof Array))
                    return x;
                var newKey = translation[x[1]];
                if(newKey === undefined)
                    return undefined;
                return [x[0], newKey];
            };
            var smallerThan = this.valueAscending ?
                function(x,y) {
                    if(x instanceof Array) {
                        return (x[1] < y[1] || (x[1] == y[1] && x[0] < y[0]));
                    } else
                        return (x < y);
                } :
                function(x,y) {
                    if(x instanceof Array) {
                        return (x[1] < y[1] || (x[1] == y[1] && x[0] > y[0]));
                    } else
                        return (x > y);
                }
            this.secondKey.translateKeys(translationFunc, smallerThan);
        }
    }
}

// Second key sequence comparison function for ascending value ordering

PartitionCompCalc.prototype.secondKeySeqAscending =
    partitionCompCalcSecondKeySeqAscending;

function partitionCompCalcSecondKeySeqAscending(x,y)
{
    var a = x[1];
    var b = y[1];
    if(a == b) {
        a = x[0];
        b = y[0];
        if(a < b)
            return -1;
        else if(a === b)
            return 0;
        else
            return 1;
    } else if(a < b)
        return -1;
    else
        return 1;
}

// Second key sequence comparison function for descending value ordering
// (the first key is always compared ascending)

PartitionCompCalc.prototype.secondKeySeqDescending =
    partitionCompCalcSecondKeySeqDescending;

function partitionCompCalcSecondKeySeqDescending(x,y)
{
    var a = x[1];
    var b = y[1];
    if(a == b) {
        a = x[0];
        b = y[0];
        if(a > b)
            return -1;
        else if(a === b)
            return 0;
        else
            return 1;
    } else if(a < b)
        return -1;
    else
        return 1;
}

// This function is called when the comparison description is refreshed.
// This should be called after the new order keys of the existing
// partition queries were calculated (including determining which of them
// were removed) and the first key (if any) was refreshed. If there are
// any partition queries defined, and the second keys needed to be calculated
// also before the comparison was refreshed, the second keys were already
// refreshed together with the first key, since each second key has a
// corresponding first key (first keys which are removed entail the removal
// of the corresponding second key and sequence second keys need to
// have their 'first key' component modified). Therefore, in this case,
// this function needs to do nothing, except for setting a new comparison
// function in case the direction of the ordering changed (from ascending
// to descending or vice versa).
// If no second keys need to be calculated after the refresh, the second
// key table is simply removed.
// If second keys need to be calculated but did not have to be calculated
// before, this function needs to construct the second key table and
// add to it the keys due to queries which belonged to the partition both
// before and after the refresh. This is done by getting the matches
// of each such query and adding the second keys for them.
// The last case is where there are no partition queries defined. In this
// case, there is no first key and the second keys are simply all the
// keys projected by the 'gap' CompValueQueryCalc. In this case there is
// little to do here - most updates will take place through updates of
// the 'gap' CompValueQueryCalc. However, if the projected keys did not
// change but the order of sorting did change, we need to go over
// the keys so that if there are alternative keys, the correct key will
// be selected as the main key (given the new ordering).

PartitionCompCalc.prototype.updateSecondKeyAfterPartitionUpdate =
    partitionCompCalcUpdateSecondKeyAfterPartitionUpdate;

function partitionCompCalcUpdateSecondKeyAfterPartitionUpdate()
{
    if(this.valueAscending === undefined) {
        this.secondKey = undefined;
        return; // no second key needed
    }

    var compareFunc = this.valueAscending ?
        this.secondKeySeqAscending : this.secondKeySeqDescending;
    
    if(this.secondKey !== undefined) {

        if(this.numPartitions() == 0) { // no partitions, only second key
            // since 'secondKey' exists, there were previously also no
            // partitions, so check whether the current keys need to
            // be removed (iff the projection path changed)
            if(this.valueQueryCalc &&
               this.valueQueryCalc.pathId != this.compProjPathId)
                this.secondKey.clear();
            // path did not change (same keys) but udpate the comparison
            this.secondKey.setUseMinKey(this.valueAscending, false);
            return;
        }
        
        // keys were already refreshed (using the new sorting direction)
        // only need to set a new comparison function.

        this.secondKey.setUseMinKey(this.valueAscending, true);        

        if(this.numPartitions() > 1) {
            if(!(this.secondKey instanceof CompCalcSeqKeys))
                this.secondKey = new CompCalcSeqKeys(undefined, undefined,
                                                     compareFunc,
                                                     this.secondKey);
            this.secondKey.setSeqCompare(compareFunc);
        }
        return;
    }

    // create the second key table and add the keys for partition queries
    // which are not new.

    if(this.numPartitions() <= 1) // no more than one partition
        this.secondKey = new CompCalcKeys(this.valueAscending, undefined);
    else
        this.secondKey = new CompCalcSeqKeys(this.valueAscending,
                                             undefined, compareFunc);

    var _self = this;
    
    // for queries which are not new, need to fetch the keys
    this.queryResults.forEach(function(entry, resultId) {
        if(!entry.result.isActiveStar())
            return; // not an active query, so new in the list
        var elementIds = entry.result.getDominatedMatches();
        // add the second key of these matches 
        _self.addSecondKeyOfMatches(elementIds, entry);
    });
}

////////////////////////////////
// Updates from Query Results //
////////////////////////////////

// This function is called when the projection path of the given queryResult
// (which implements one of the partition queries) has changed.
// As a result of this change, the registration of the CompValueQueryCalc
// for this query may have to change. This function does not need to
// update any keys since a change in the projection path implies
// that all matches of the old query are removed and all matches of the
// new query are added.

PartitionCompCalc.prototype.refreshProjectedKeyPath =
    partitionCompCalcRefreshProjectedKeyPath;

function partitionCompCalcRefreshProjectedKeyPath(queryResult)
{
    // update (if needed) the registration of the CompValueQueryCalc
    // for this query.
    this.updateValueQueryCalc(queryResult);
}

// This function is called to notify the partition to add the element IDs
// in the array 'elementIds' to those matched by the partition query whose
// InternalQueryResult object is 'source'. This function updates the
// first and second keys for these element IDs. For more details, see
// addMatchesByResultId(), which actually carries out the operation.

PartitionCompCalc.prototype.addMatches =
    partitionCompCalcAddMatches;

function partitionCompCalcAddMatches(elementIds, source)
{
    this.addMatchesByResultId(elementIds, source.getId());
}

// This function is called to notify the partition to remove the element IDs
// in the array 'elementIds' from those matched by the partition query whose
// InternalQueryResult object is 'source'. Because these are removals,
// they are only queued here, to be executed later.

PartitionCompCalc.prototype.removeMatches =
    partitionCompCalcRemoveMatches;

function partitionCompCalcRemoveMatches(elementIds, source)
{
    this.queueRemovedElements(elementIds, source.getId());
}

// This function is called to remove all matches the query result
// whose InternalQueryResult object is given by 'source'. This function
// then gets all the matches of the given source and queues them
// for removal.

PartitionCompCalc.prototype.removeAllMatches =
    partitionCompCalcRemoveAllMatches;

function partitionCompCalcRemoveAllMatches(source)
{
    var elementIds = source.getDominatedMatches();
    this.queueRemovedElements(elementIds, source.getId());
}

// This function is called to notify the partition to add the element
// IDs in the array 'elementIds' to those matched by the partition
// query whose InternalQueryResult object is 'source'. Here, the query
// is a projection and the matches are the projected matches.  This
// function updates the first and second keys for these element
// IDs. For more details, see addMatchesByResultId(), which actually
// carries out the operation.

PartitionCompCalc.prototype.addProjMatches =
    partitionCompCalcAddProjMatches;

function partitionCompCalcAddProjMatches(elementIds, resultId, projId)
{
    this.addMatchesByResultId(elementIds, resultId);
}

// This function is called to notify the partition to remove the element
// IDs in the array 'elementIds' from those matched by the partition
// query whose InternalQueryResult object is 'source'. Here, the query
// is a projection and the matches are the projected matches. Because these
// are removals, they are only queued here, to be executed later.

PartitionCompCalc.prototype.removeProjMatches =
    partitionCompCalcRemoveProjMatches;

function partitionCompCalcRemoveProjMatches(elementIds, resultId, projId)
{
    this.queueRemovedElements(elementIds, resultId);
}

// This function is called by a CompValueQueryCalc when it receives
// a notification from the indexer it is registered to that the keys
// of some of the elements at the path to which the CompValueQueryCalc
// object is registered have changed. This function should only be called
// when the second key is calculated.
// This function first determines which query or queries this applies
// to. It then filters the elements IDs which were matched by each query
// and updates the second key.

PartitionCompCalc.prototype.updateKeys =
    partitionCompCalcUpdateKeys;

function partitionCompCalcUpdateKeys(valueQueryCalc, elementIds, types, keys,
                                     prevTypes, prevKeys)
{
    var needToRaise = valueQueryCalc.needToRaiseMatches();
    var dataElements;
    if(needToRaise)
        dataElements = this.indexer.getDataElements();

    // get the queries this belongs to
    var resultIds = valueQueryCalc.getResultIds();
    if(resultIds.length == 0) {
        // this belongs only to the 'gap' partition, need to update all keys
        // (we add the new keys and remove the old ones)
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            this.updatePartitionKey(elementIds[i], keys[i], prevKeys[i],
                                    undefined, dataElements);
        }
    } else {
        // this belongs to one or more partitions. For each partition,
        // need to filter those element IDs which are matched by the query.
        for(var i = 0, l = resultIds.length ; i < l ; ++i) {
            var resultEntry = this.queryResults.get(resultIds[i]);
            var orderKey = resultEntry.orderKey;

            // filter the elements
            var matchedPos =
                resultEntry.result.filterDominatedMatchPositions(elementIds);
            for(var j = 0, m = matchedPos.length ; j < m ; ++j) {
                var pos = matchedPos[j];
                this.updatePartitionKey(elementIds[pos], keys[pos],
                                        prevKeys[pos], orderKey, dataElements);
            }
        }
    }
}

// This function is called only when no partition function is defined. In that
// case, it is used to update the elements at the projection path
// ('this.compProjPathId'). These are the data elements for which keys need
// to be extracted from the indexer.
// This function first checks whether the matches need to be raised.
// It then adds the key of each match as the second key of the raised
// element ID.

PartitionCompCalc.prototype.addProjPathMatches =
    partitionCompCalcAddProjPathMatches;

function partitionCompCalcAddProjPathMatches(elementIds)
{
    // remove these elements from the list of elements queued for removal
    // (in case they were just removed and the removal is still queued)
    elementIds = this.removeAddedFromQueuedRemoved(elementIds);
    
    var valueQueryCalc = this.valueQueryCalc;
    var needToRaise = valueQueryCalc.needToRaiseMatches();
    var dataElements;
    if(needToRaise)
        dataElements = this.indexer.getDataElements();

    this.secondKey.expectAdditionalNum(elementIds.length);
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        // perform raising to 'this.prefixProjPathId', if needed
        if(dataElements !== undefined)
            elementId = dataElements.raiseToPath(elementId,
                                                 this.prefixProjPathId);
        var key = this.convertSecondKey(valueQueryCalc.getProjKey(elementId));
        this.secondKey.addKey(elementId, key);
    }

    if(elementIds.length !== 0)
        this.refreshOrdering();
}

// This function is called only when no partition function is defined. In that
// case, it is used to update the elements at the projection path
// ('this.compProjPathId'). These are the data elements for which keys need
// to be extracted from the indexer. This function is called to remove
// the give element IDs. Since this is a removal, the removal is only
// queued here, to be executed later.

PartitionCompCalc.prototype.removeProjPathMatches =
    partitionCompCalcRemoveProjPathMatches;

function partitionCompCalcRemoveProjPathMatches(elementIds)
{
    this.queueRemovedElements(elementIds);
}

// This function is called only when no partition function is defined. In that
// case, it is used to update the elements at the projection path
// ('this.compProjPathId'). These are the data elements for which keys need
// to be extracted from the indexer.
// This function is called to remove element IDs which were previously
// queued for removal.
// This function first checks whether the matches need to be raised.
// It then removes the key of each match as the second key of the raised
// element ID.

PartitionCompCalc.prototype.removeQueuedProjPathMatches =
    partitionCompCalcRemoveQueuedProjPathMatches;

function partitionCompCalcRemoveQueuedProjPathMatches()
{
    if(this.removedElements === undefined || this.removedElements.size === 0)
        return; // no removals queued
    
    var valueQueryCalc = this.valueQueryCalc;
    var needToRaise = valueQueryCalc.needToRaiseMatches();
    var dataElements;
    if(needToRaise)
        dataElements = this.indexer.getDataElements();

    var _self = this;
    
    this.removedElements.forEach(function(secondKey, elementId) {
        // perform raising to 'this.prefixProjPathId', if needed
        if(dataElements !== undefined)
            elementId = dataElements.raiseToPath(elementId,
                                                 _self.prefixProjPathId);
        _self.secondKey.removeKey(elementId, secondKey);
    });

    if(this.removedElements.size > 0)
        this.refreshOrdering();
}

/////////////////////
// Queued Removals //
/////////////////////

// This function receives a list (array) of element IDs which are just about
// to be removed by some source. If the matches are removed by a partition
// query, the result ID of that query is given by 'resultId'. If the matches
// are removed by the common CompValueQueryCalc (this is only in case there
// are no partitions) 'resultId' is undefined. This function then sets these
// elements on the appropriate removal queue, so that their removal can
// take place after all other updates of queries which depend on this
// comparison have been updated.

PartitionCompCalc.prototype.queueRemovedElements =
    partitionCompCalcQueueRemovedElements;

function partitionCompCalcQueueRemovedElements(elementIds, resultId)
{
    // get the queued removal list
    var queued;
    var valueQueryCalc;
    
    if(resultId === undefined) {
        if(this.removedElements !== undefined)
            queued = this.removedElements;
        else
            queued = this.removedElements = new IntHashMap();
        valueQueryCalc = this.valueQueryCalc;
    } else {
        if(this.partitionRemovedElements === undefined)
            this.partitionRemovedElements = new IntHashMap();

        if(this.partitionRemovedElements.has(resultId))
            queued = this.partitionRemovedElements.get(resultId);
        else {
            queued = new IntHashMap();
            this.partitionRemovedElements.set(resultId, queued);
        }

        if(this.secondKey !== undefined) {
            var resultEntry = this.queryResults.get(resultId);
            valueQueryCalc = resultEntry.valueQueryCalc !== undefined ?
                resultEntry.valueQueryCalc : this.valueQueryCalc;
        }
    }

    // add the matches to the removal queue (together with their current key)

    queued.expectSize(queued.size + elementIds.length);

    if(valueQueryCalc !== undefined)
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            var key =
                this.convertSecondKey(valueQueryCalc.getKnownKey(elementId));
            queued.set(elementId, key);
        }
    else
        for(var i = 0, l = elementIds.length ; i < l ; ++i)
            queued.set(elementIds[i], undefined);
    

    // schedule the removal
    this.qcm.scheduleCompCalc(this);
}

// This function receives a list (array) of element IDs which are just about
// to be added by some source. If the matches are added by a partition query,
// the result ID of that query is given by 'resultId'. If the matches are
// added by the common CompValueQueryCalc (this is only in case there are
// no partitions) 'resultId' is undefined. This function checks whether
// there are some element removals queued for the same source (partition
// query or CompValueQueryCalc) and if there are, removes the matches added
// from the list of pending removals. These elements are also removed from
// the list of elements to add (since they were queued for removal, they
// must have been added before). The function then returns an array with
// the subset of the input 'elementIds' which were not queued for removal.

PartitionCompCalc.prototype.removeAddedFromQueuedRemoved =
    partitionCompCalcRemoveAddedFromQueuedRemoved;

function partitionCompCalcRemoveAddedFromQueuedRemoved(elementIds, resultId)
{
    // get the queued removal list
    var queued;
    if(resultId === undefined)
        queued = this.removedElements;
    else if(this.partitionRemovedElements !== undefined)
        queued = this.partitionRemovedElements.get(resultId);

    if(queued === undefined || queued.size === 0)
        return elementIds; // no pending removals for this source

    var notRemovedIds; // subset of 'elementIds' not pending removal

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(queued.delete(elementId) === undefined) {
            // not in list
            if(notRemovedIds !== undefined)
                notRemovedIds.push(elementId);
            continue;
        }
        if(notRemovedIds === undefined)
            // first element in list which is pending removal
            notRemovedIds = elementIds.slice(0,i);
    }

    return (notRemovedIds === undefined) ? elementIds : notRemovedIds;
}

// This function is called after all other queued tasks were applied.
// This function then removes all elements whose removal was queued.
// If element are removed from partitions, the ordering is refreshed.

PartitionCompCalc.prototype.applyQueuedRemovals =
    partitionCompCalcApplyQueuedRemovals;

function partitionCompCalcApplyQueuedRemovals()
{
    if(this.removedElements !== undefined) {
        this.removeQueuedProjPathMatches();
        this.removedElements = undefined;
    }

    if(this.partitionRemovedElements) {

        var _self = this;
        var needToRefresh = false;
        
        this.partitionRemovedElements.forEach(function(removals, resultId) {
            if(removals.size > 0)
                needToRefresh = true;
            _self.removeMatchesByResultId(removals, resultId);
        });

        this.partitionRemovedElements = undefined;

        if(needToRefresh)
            this.refreshOrdering();
    }
}
    

/////////////////
// Key Updates //
/////////////////

// This function is a common implementation of addMatches() and
// addProjMatches(). 
// This function is called to notify the partition to add the element IDs
// in the array 'elementIds' to those matched by the partition query whose
// InternalQueryResult object ID is 'resultId'. If needed, this function raises
// the element IDs to the path at which the elements are compared. It then
// updates the first key of those elements which were added here
// (after raising) by adding the order key of the query whose query result
// node is 'source'. If this is also a second key (based on value) and if
// the first key of an element added here is equal to the order key of the
// query which adds its matches here, this function fetches the key
// for that element ID and adds it to the second key.

PartitionCompCalc.prototype.addMatchesByResultId =
    partitionCompCalcAddMatchesByResultId;

function partitionCompCalcAddMatchesByResultId(elementIds, resultId)
{
    if(elementIds.length == 0)
        return;

    // remove these elements from the list of elements queued for removal
    // (in case they were just removed and the removal is still queued)
    elementIds = this.removeAddedFromQueuedRemoved(elementIds, resultId);
    
    var resultEntry = this.queryResults.get(resultId);
    var valueQueryCalc = resultEntry.valueQueryCalc !== undefined ?
        resultEntry.valueQueryCalc : this.valueQueryCalc;
    var orderKey = resultEntry.orderKey;
    var needToRaise = valueQueryCalc.needToRaiseMatches();
    var dataElements;
    if(needToRaise)
        dataElements = this.indexer.getDataElements();

    this.firstKey.expectAdditionalNum(elementIds.length);
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        // perform raising to 'this.prefixProjPathId', if needed
        var raisedId = (dataElements !== undefined) ?
            dataElements.raiseToPath(elementId, this.prefixProjPathId) :
            elementId;
        
        var otherKey = this.firstKey.addKey(raisedId, orderKey);
        if(this.secondKey !== undefined)
            // add the key of 'elementId' (before raising) as a second key
            // of the same raised ID (for the raise element)
            this.addSecondKey(raisedId, elementId, valueQueryCalc, orderKey,
                              otherKey);
    }

    this.refreshOrdering();
}

// This function is called to add the second keys for elements for which the
// first key has already been added. This is used in cases where the
// comparison changed from one which does not compare by value to one which
// which does. This function is very similar to 'addMatchesByResultId()'
// (which adds both the first and second keys) except that instead of
// setting the first key, it only gets the main first key (for each element)
// to detemrine whether sequence second keys need to be added (this
// is in case there is more than one partition which matches the same
// (raised) element).

PartitionCompCalc.prototype.addSecondKeyOfMatches =
    partitionCompCalcAddSecondKeyOfMatches;

function partitionCompCalcAddSecondKeyOfMatches(elementIds, resultEntry)
{
    var valueQueryCalc = resultEntry.valueQueryCalc !== undefined ?
        resultEntry.valueQueryCalc : this.valueQueryCalc;
    var orderKey = resultEntry.orderKey;
    var needToRaise = valueQueryCalc.needToRaiseMatches();
    var dataElements;
    if(needToRaise)
        dataElements = this.indexer.getDataElements();
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        // perform raising to 'this.prefixProjPathId', if needed
        var raisedId = (dataElements !== undefined) ?
            dataElements.raiseToPath(elementId, this.prefixProjPathId) :
            elementId;
        
        var otherKey = this.firstKey.getKey(raisedId);
        if(otherKey === orderKey)
            // no indication that matched by multiple partition queries
            otherKey = undefined;
        // add the key of 'elementId' (before raising) as a second key
        // for the raise element
        this.addSecondKey(raisedId, elementId, valueQueryCalc, orderKey,
                          otherKey);
    }
}

// This is an auxiliary function. It adds as a second key for the element ID
// 'raisedId' raised from the element 'projElementId' at the projection path
// at which 'valueQueryCalc' is registered ('valueQueryCalc' must be
// the CompValueQueryCalc object assigned to one of the partition queries
// or the one assigned to the common projection path of the partition
// ('this.compProjPathId')). 'projElementId' should be the data element ID
// of a node at the projection path which was matched under the element
// 'raisedId' ('elementId' and 'raisedId' may be the same).
// The function must determine whether a simple key or a sequence key
// (which also codes the first key) should be added. If the main key
// already stored is a sequence key, a sequence key must be added.
// If the main key is not a sequence key then a sequence key must be added
// iff 'otherFirstKey' is not undefined. In that case, the function first
// replaces all existing keys with sequence keys whose second member is
// 'otherFirstKey'.
// When a sequence key is added, that key is [<the projection key>, 'firstKey']
// (this is the first key for the same raised element ID and is used to
// distinguish between the keys for different first keys. 

PartitionCompCalc.prototype.addSecondKey = partitionCompCalcAddSecondKey;

function partitionCompCalcAddSecondKey(raisedId, projElementId,
                                       valueQueryCalc, firstKey,
                                       otherFirstKey)
{
    var key = this.convertSecondKey(valueQueryCalc.getProjKey(projElementId));
    var currentKey = this.secondKey.getKey(raisedId);

    if(currentKey instanceof Array) { // already a sequence key
        this.secondKey.addSeqKey(raisedId, [key, firstKey]);
    } else if(otherFirstKey !== undefined) {
        if(currentKey !== undefined)
            this.secondKey.convertToSeqKeys(raisedId,
                                            function(x) {
                                                return [x,otherFirstKey];
                                            });
        this.secondKey.addSeqKey(raisedId, [key, firstKey]);
    } else
        this.secondKey.addKey(raisedId, key);
}

// This function take the raw key as received from the projection and
// converts it into the value which will be stored as the second key in
// the key table. Currently, this performs the following transformations:
// 1. If the key is a range, its minimum/maximum is taken as the key.
// 2. If it is a string, the string is converted to lower case.

PartitionCompCalc.prototype.convertSecondKey =
    partitionCompCalcConvertSecondKey;

function partitionCompCalcConvertSecondKey(key)
{
    if(typeof(key) == "object") // a range object
        key = this.valueAscending ? key.getMinKey() : key.getMaxKey();

    if(typeof(key) == "string")
        key = key.toLocaleLowerCase();

    return key;
}

// This function is called to remove element IDs queued for removal from
// the partition query with ID 'resultId'. 'removals' is an IntHashMap
// object whose keys are the element IDs to remove and their values the
// second key which should be removed. 
// If needed, this function raises the element IDs to the path at which
// the elements are compared. It then removes the order key of partition
// as a first key for the raised data element and (if needed) removes
// the value projected under the non-raised element ID as a second key of
// the raised data element.

PartitionCompCalc.prototype.removeMatchesByResultId =
    partitionCompCalcRemoveMatchesByResultId;

function partitionCompCalcRemoveMatchesByResultId(removals, resultId)
{
    if(removals.length == 0)
        return;
    
    var resultEntry = this.queryResults.get(resultId);
    var valueQueryCalc = resultEntry.valueQueryCalc !== undefined ?
        resultEntry.valueQueryCalc : this.valueQueryCalc;
    var orderKey = resultEntry.orderKey;
    var needToRaise = valueQueryCalc.needToRaiseMatches();
    var dataElements;
    if(needToRaise)
        dataElements = this.indexer.getDataElements();

    var _self = this;
    
    removals.forEach(function(secondKey, elementId) {

        // perform raising to 'this.prefixProjPathId', if needed
        var raisedId = (dataElements !== undefined) ?
            dataElements.raiseToPath(elementId,_self.prefixProjPathId) :
            elementId;
            
        // remove the first key
        _self.firstKey.removeKey(raisedId, orderKey);
        if(_self.secondKey !== undefined) 
            _self.removeSecondKey(raisedId, elementId, orderKey, secondKey);
    });
}

// This is an auxiliary function. It removes as a second key for the element ID
// 'raisedId' raised from the element 'projElementId'. 'projElementId' should
// be the data element ID of a node at the projection path which was matched
// under the element 'raisedId' ('elementId' and 'raisedId' may be the same).
// The function must determine whether a simple key or a sequence key
// (which also codes the first key) should be removed. This is done by
// checking whether the main key of raisedId is a sequence key
// (all keys for a raised element ID must all be of the same type).

PartitionCompCalc.prototype.removeSecondKey = partitionCompCalcRemoveSecondKey;

function partitionCompCalcRemoveSecondKey(raisedId, projElementId, firstKey,
                                          secondKey)
{
    var mainKey = this.secondKey.getKey(raisedId);

    if(mainKey instanceof Array) // sequence keys
        this.secondKey.removeSeqKey(raisedId, [secondKey, firstKey]);
    else
        this.secondKey.removeKey(raisedId, secondKey);
}

// This function updates a single key of a partition when the key value
// changes. The key is defined for element 'elementId', which may still
// have to be raised to the element dominating it in the set of elements
// being compared by this comparison function. If such raising may be needed,
// the calling function must provide this function with the data element
// table of the indexer, in 'dataElements'. 'key' is the new key to be set
// and 'prevKey' is the old key (which is removed). If the keys stored
// may be sequence keys, the order key 'orderKey' of the partition query being
// updated must be provided (this is part of the sequence key).

PartitionCompCalc.prototype.updatePartitionKey =
    partitionCompCalcUpdatePartitionKey;

function partitionCompCalcUpdatePartitionKey(elementId, key, prevKey,
                                             orderKey, dataElements)
{
    // perform raising to 'this.prefixProjPathId', if needed
    if(dataElements !== undefined)
        elementId = dataElements.raiseToPath(elementId,
                                             this.prefixProjPathId);
    
    prevKey = this.convertSecondKey(prevKey);
    key = this.convertSecondKey(key);

    if(orderKey !== undefined &&
       (this.secondKey.getKey(elementId) instanceof Array)) {

        // sequence keys
        
        // add the new key
        this.secondKey.addSeqKey(elementId, [key, orderKey]);
        // remove the old key
        this.secondKey.removeSeqKey(elementId, [prevKey, orderKey]);
    } else { // simple keys
        // add the new key
        this.secondKey.addKey(elementId, key);
        // remove the old key
        this.secondKey.removeKey(elementId, prevKey);
    }
}

//////////////////////////
// Comparison Functions //
//////////////////////////

// This function constructs and returns the comparison function to be
// used for the comparison defined by this partition CompCalc. The comparison
// function returned here uses closure, so that it stores information
// relevant to the specific comparison which needs to be performed.

PartitionCompCalc.prototype.getCompareFunc = partitionCompCalcGetCompareFunc;

function partitionCompCalcGetCompareFunc()
{
    var key2CompFunc = this.valueAscending ?
        function(key1, key2) {
            if(typeof(key1) != typeof(key2))
                return typeof(key1) < typeof(key2) ? -1 : 1;
            return key1 < key2 ? -1 : key1 > key2 ? 1 : 0;
        } :
        function(key1, key2) {
            if(typeof(key1) != typeof(key2))
                return typeof(key1) < typeof(key2) ? 1 : -1;
            return key1 < key2 ? 1 : key1 > key2 ? -1 : 0;
        };

    if(this.firstKey && !this.secondKey) { // only first key comparison
        var firstKey = this.firstKey;
        return function(elementId1,elementId2) {
            return (firstKey.getCompKey(elementId1) -
                    firstKey.getCompKey(elementId2));
        };
    } else if(!this.firstKey && this.secondKey) {
        var secondKey = this.secondKey;
        return function(elementId1,elementId2) {
            var key1 = secondKey.getCompKey(elementId1);
            var key2 = secondKey.getCompKey(elementId2);
            return key2CompFunc(key1, key2);
        };
    } else if(this.firstKey && this.secondKey) {
        var firstKey = this.firstKey;
        var secondKey = this.secondKey;
        return function(elementId1,elementId2) {
            var cmp = (firstKey.getCompKey(elementId1) -
                       firstKey.getCompKey(elementId2));
            if(cmp !== 0)
                return cmp;
            var key1 = secondKey.getCompKey(elementId1);
            var key2 = secondKey.getCompKey(elementId2);
            return key2CompFunc(key1, key2);
        };
    } else {
        return function(elementId1,elementId2) {
            return 0; // no comparison, all elements equal
        };
    }
}

// This function return a function which (using closure) can perform raising
// of the data element IDs to the 'this.prefixProjPathId' path in
// the indexer of this partition CompCalc. This can be used during
// the comparison process when it is possible that some raising would need
// to take place without needing direct access to the raising information
// (such as the target path, data element table of the indexer, etc.).

PartitionCompCalc.prototype.getRaisingFunc =
    partitionCompCalcGetRaisingFunc;

function partitionCompCalcGetRaisingFunc()
{
    dataElements = this.indexer.getDataElements();

    return function(elementId) {
        // raise the element to the path 'this.prefixProjPathId' if needed
        return dataElements.raiseToPath(elementId, this.prefixProjPathId);
    }
}
