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

// This object extends the base class InternalQueryCalc for simple 
// selection query calculation nodes. These nodes are defined by a single
// path and a set of selection values. They implement a query which matches all
// data nodes whose value is matched by any one of the selection values 
// of the simple query calculation node.
//
// The selection values are registered to the simple query by the Query
// object during the query (re-)compilation process. Each value is 
// registered under a value ID (which is an element ID extracted from
// the query description strcture). Re-registering a value under the 
// same ID will result in the replacement of that value. Values
// may also be removed using this ID.
//
// The IDs by which the values are added and removed are not unique
// across different queries (as the data element IDs may repeat themselves).
// However, for registration into the indexer, each value needs to be
// assigned a unique ID. Therefore, upon registration, ech value ID
// is assigned a unique value ID (which is allocated from a single pool
// for all simple query calculation nodes). The interface with the 
// indexer uses only these unique value IDs.
//
// After registering to query calculation node to the indexer, the query
// calculation node registers its specific selection values to the
// indexer. The indexer then updates the query calculation node with 
// the data elements matched by these selection values. Because there
// may be multiple selection values, the query calculation node must, 
// in principle, count the number of selection values which matched
// each element ID. Any non-zero count is considered a match for
// the simple query calculation node.
//
// In many specific cases, however, the count for the match of each
// data element may either be 1 (matched) or zero (not matched). In this
// case the incremental update of the parent of this simple query calculation
// node is only a function of the update received by this node from
// the indexer. In this case, it is not necessary for the simple query
// calculation node to keep track of the matches, which saves both
// time and memory. When an external module requests the full list
// of matches from this query calculation node, it must go back to
// the indexer to retrieve those matches.
//
// The simple query calculation node does not keep track of the matches
// when the following conditions hold:
// 1. It is not a selection-projection node.
// 2. No two query values may match the same data element. Since the query
//    registers disjoint query values to the index (see the 'disjoint'
//    field for more information), this can only happen if the query
//    registers multiple query values of the same type and there are
//    range value in the data of that type.
//    To simplify testing this criterion, once a PairwiseDisjoint
//    object is created for certain type of value, this type is considered
//    to have multiple query values. If the same type also has range values
//    in the data, match counting is required.
//
// When these conditions no longer hold, the simple query calculation node
// must go back to the indexer and retrieve all matches and construct
// the match table. This operation is completely trasparent to any
// external object using the result of this simple query calculation
// node.
//
// The indexer may update the simple query calculation node through several
// interface functions:
//
// addMatches(<array of element ID>): this indicates that the match count
//     for each element ID in the array should be increased by 1. This
//     is called when the query calculation node adds or modifies the
//     selection values registered to the indexer. This function is
//     called once for every selection value being added or
//     modified. Therefore, if multiple selection values are added or
//     modified, matches added here are not forwarded immediately, but
//     only collected (in this.addedMatches). When the registration to 
//     the indexer returns, the changes can be forwarded.
//
// removeMatches(<array of element ID>): this indicates that the match count
//     for each element ID in the array should be decreased by 1. This
//     is called when the query calculation node removes or modifies the
//     selection values registered to the indexer. This function is called
//     once for every selection value being removed or modified. Therefore, 
//     if multiple selection values are removed or modified, matches removed
//     here are not forwarded immediately, but only collected 
//     (in this.removedMatches). When the registration to the indexer returns, 
//     the changes can be forwarded.  
//
// updateMatchCount(<Map object>): this receives an object whose keys
//     are element IDs and whose values are the changes in the match counts
//     for these element IDs (these numbers can be positive or negative).
//     This update is received when the data in the indexer changes.
//     The query calculation node then updates its match counts and 
//     forwards the new and removed matches.
//
// This node may also be a selection-projection node (in case it is 
// dominated by a projection union node). The node is then
// a generating projection iff it is not dominated by another generating
// projection (see internalRootQueryCalc.js for the definitions)
// which is iff it is dominated by an intersection node with multiple
// projection sub-nodes which is iff the union parent node of the simple
// query calculation node needs to add its matches to its parent.
// This property can easily be checked on the parent union node.
// When this node is a generating projection node, its selections are
// raised to the prefix path of the query and forwarded as projection matches
// to the result nodes. 

// Object Structure
// ----------------
//
// {
//    pathId: <path ID>,
//    
//    uniqueValueIds: <Map>{
//       <value ID>: <unique value ID>,
//       .......
//    },
//    values: <Map>{
//       <unique value ID>: {
//          type: <string>,
//          key: <simple value or range object>,
//       },
//       ......
//    }
//    disjoint: <Map>{
//        <type>: {
//            valueIds: <Map>{
//                <unique value ID>: <simple value or range object>
//                .....
//            },
//            pairwiseDisjoint: undefined|<PairwiseDisjoint>
//        },
//        ....
//    },
//
//    matches: <Map object>: {
//       <data element ID>: <count>
//       .......
//    }
//    addedMatches: <array or arrays of element IDs>
//    removedMatches: <array or arrays of element IDs>
//
//    matchPoints: <Map>{
//        <path ID>: 1
//        ......
//    }
//
//    changedValues: {
//       <value ID>: {
//          type: <string>,
//          key: <simple value or range object>
//       },
//         //  or
//       <value ID>: false
//       .....
//    }
//    becameSelectionProjection: undefined|true
// }
//
// pathId: this is the path of the simple query calculation node relative
//    to the root of the indexer to which the query is registered.
//
// uniqueValueIds: this table converts the ID used by the compilation
//    process (based on data element Ids in the query description) 
//    into IDs which are unique across all queries. The unique IDs are
//    used for all registrations to the indexer.
// values: a table of selection values. These are the selection values
//    registered to the indexer. Each value appears in this table under
//    its unique ID. Each value entry has a type (a string, e.g. "number"
//    or "weight") and a value, which is either a simple JavaScript
//    value (number, string or boolean) or a range object.
// disjoint: this table stores a set of pairwise disjoint values which
//    are equal (have the same union) as the original query values.
//    These are the values which are actually registered into the index
//    to perform the lookup.
//    Each value type has a separate entry in this table. For each type,
//    the entry has the following fields:
//    valueIds: this object stores the actual values which
//        will be registered into the indexer and these are stored
//        under 'valueIds'. The IDs which are the keys in this table
//        are a subset of the IDs of values of the given type. The value
//        under each ID contains the original value of that ID and
//        must have the same high end. These values are generated by
//        the PairwiseDisjoint object (see the PairwiseDisjoint documentation
//        for more information about the way the disjoint values are
//        generated). As long as the original values are disjoint, the
//        values here are the same as the original values.
//    pairwiseDisjoint: once there is more than one value under the same type,
//        a PairwiseDisjoint object is created and stored under
//        'pairwiseDisjoint'. All values of this type are stored in this
//        object and this generates the pairwise disjoint set of values.
//        Once constructed, this object is not destroyed anymore
//        until all values of this type are removed.
//
// matches: the sum of the counts reported by the indexer for each 
//   element ID. The count is the number of selection values which 
//   match the data node represented by the element ID. Every element 
//   in the table is a match.
//   This table exists only if the query calculation node needs to
//   track the match count for each data element. If not, this field
//   is undefined (this may change dynamically).
// addedMatches: this is an array used to store the updates received
//   through the addMatches() function. Each such updated (an array)
//   is pushed onto the 'addedMatches' array (so this becomes an array 
//   of arrays). At the end of the query refresh, this queue is processed
//   and cleared.
// removedMatches: this is an array used to store the updates received
//   through the removeMatches() function. Each such updated (an array)
//   is pushed onto the 'removedMatches' array (so this becomes an array 
//   of arrays). At the end of the query refresh, this queue is processed
//   and cleared.

// matchPoints: all match points added by the indexer to this node. These
//   are all prefixes of this.pathId (including this.pathId itself)
//   which carry data elements (that is, there is a data element at that path).
//
// changedValues: this field is used to refresh the query calculation node.
//   When the query compilation process adds, modifies or removes values
//   from this simple query calculation node, the change is first recorded
//   in the changedValues table. If a value is added or modified, this
//   table holds the new value (type + key) and if it si removed, the
//   table holds a value of 'false' under the value ID. The value IDs
//   are those received from the query compiler (that is, not unique IDs).
//   It is only when the query is refreshed that unique IDs are allocated,
//   the 'uniqueValueIds' and 'values' tables are updated and the 
//   new selection values are registered to the indexer.   
//
// becameSelectionProjection: this flag is set within the query structure
//   refresh phase when this query calculation node becomes a
//   selection - projection. This is to signal to the match refresh
//   function that this structural change has taken place (the 'matches'
//   table has to be created in thi case). This flag is reset
//   to undefined by the match refresh function or by a structural
//   change back into a non-selection-projection (this probably never
//   actually happens before the match refresh).

// %%include%%: "internalQueryCalc.js"
// %%include%%: <scripts/utils/trees/pairwiseDisjoint.js>
// %%include%%: <scripts/utils/arrayUtils.js>

inherit(SimpleQueryCalc, InternalQueryCalc);

//
// Constructor
//

// The constructor receives as input, in addition to the root query
// calculation node which owns it, also the ID of the path in the indexer
// at which its selection is defined. This path is given relative to
// the root of the indexer.

function SimpleQueryCalc(rootQueryCalc, pathId)
{
    // call base constructor
	this.InternalQueryCalc(rootQueryCalc);

    // initialize derived class fields (selection-projection related fields are
    // constructed only when needed).

    this.matches = undefined; // if needed, will be constructed later

    this.pathId = pathId;
    // increase the path ID allocation count so that this node now
    // owns this path ID (this way it can be properly released)
    this.indexer.qcm.allocatePathIdByPathId(pathId);

    // create value tables
    this.uniqueValueIds = new Map();
    this.values = new Map();
    this.disjoint = new Map();
    this.changedValues = {};

    // match update queues
    this.addedMatches = [];
    this.removedMatches = [];
}

// destruction function
// In addition to the base class destruction, this function must also 
// detach the query calculation node from the indexer and release
// its allocation of the path ID. This only happens after the base class
// destroy, as the bse class destroy may still need to know the previous
// matches.

SimpleQueryCalc.prototype.destroy = simpleQueryCalcDestroy;

function simpleQueryCalcDestroy()
{
	// base class destroy (this also detaches from the root query calculation
    // node if this is the top query calculation node)
	this.InternalQueryCalc_destroy();

    // detach from indexer
    this.detachFromIndexer();
}

///////////////////////////////
// Property Access Functions //
///////////////////////////////

// This function is called by the indexer to determine whether indexing is
// needed. For this node, this is always true.

SimpleQueryCalc.prototype.isSelection = simpleQueryCalcIsSelection;

function simpleQueryCalcIsSelection()
{
	return true;
}

// Returns true if this node is a projection node (but not a 
// selection-projection node) and false otherwise. For a simple node,
// this is always false.

SimpleQueryCalc.prototype.isProjection = simpleQueryCalcIsProjection;

function simpleQueryCalcIsProjection()
{
	return false;
}

// Is a generating projection only if it is a selection-projection and
// is not dominated by another generating projection. Such a dominating
// projection must be an intersection with multiple projection sub-node.
// This holds iff the parent (union) node needs to add its selection
// matches, so we simply check the 'mustAddMatches' property on the parent
// node (which, if this is a selection-projection, must be a union node).

SimpleQueryCalc.prototype.isGeneratingProjection = 
	simpleQueryCalcIsGeneratingProjection;

function simpleQueryCalcIsGeneratingProjection()
{
    return this.isSelectionProjection() && !this.matchParent.mustAddMatches;
}

//////////////////////
// Selection Values //
//////////////////////

// This function is called by the Query object during compilation. It adds
// a value with the given 'type' (a string) and 'key' (simple JavaScript value
// or a range object) under 'valueId'. All this function does is store this
// value in the 'changedValues' table (the actual update will take place
// when the query is refreshed). 

SimpleQueryCalc.prototype.addValue = simpleQueryCalcAddValue;

function simpleQueryCalcAddValue(valueId, type, key)
{
    if(!this.changedValues)
        this.changedValues = {};
    this.changedValues[valueId] = { type: type, key: key };

    // indicate to the parent that this node needs to be refreshed
    if(this.parent)
        this.parent.addUpdatedSubNode(this.getId(), false);
}

// This function is called by the Query object during compilation. It adds
// removed any value under the given value ID. All this function does
// is store this value ID in the 'changedValues' table with a value of 
// 'false' (which means that it should be removed). The actual removal will
// only take place when the query is refreshed.

SimpleQueryCalc.prototype.removeValue = simpleQueryCalcRemoveValue;

function simpleQueryCalcRemoveValue(valueId)
{
    if(!this.changedValues)
        this.changedValues = {};
    this.changedValues[valueId] = false;

    // indicate to the parent that this node needs to be refreshed
    if(this.parent)
        this.parent.addUpdatedSubNode(this.getId(), false);
}

// This function returns the type of the value stored under the given
// unique ID (note that while the same ID may have a different key in the
// 'value' and the 'disjoint' tables, its type is always the same.

SimpleQueryCalc.prototype.getValueType = simpleQueryCalcGetValueType;

function simpleQueryCalcGetValueType(uniqueValueId)
{
    return this.values.get(uniqueValueId);
}

// returns an array with all unique value IDs of disjoint values defined
// by this query calculation node. This function returns an array of
// objects of the form:
// {
//    id: <value ID>,
//    type: <value type>
//    key: <value key>
// }

SimpleQueryCalc.prototype.getDisjointValueIds =
    simpleQueryCalcGetDisjointValueIds;

function simpleQueryCalcGetDisjointValueIds()
{
    var valueIds = [];
    this.disjoint.forEach(function(entry, type) {
        entry.valueIds.forEach(function(key, valueId) {
            valueIds.push({ id: valueId, type: type, key: key });
        });
    });
    return valueIds;
}

// Unique value ID assignment

var queryNextUniqueValueId = 1025;

// return the next unique value ID (must be unique across all queries)

SimpleQueryCalc.prototype.newUniqueValueId = simpleQueryCalcNewUniqueValueId;

function simpleQueryCalcNewUniqueValueId()
{
    return queryNextUniqueValueId++;
}

//////////////////
// Match Points //
//////////////////

// This function receives the initial list (array) of match points for 
// the selection path after registering to the indexer. The function then 
// updates its 'matchPoints' table with these match points and forwards
// these match points to its match parent.
// This function is called just once, when this node is registered to
// the indexer. This happens the first time the refreshMatchPoints()
// function is called. As this is the initial registration to the indexer,
// we know that the 'matchPoints' table was previously empty.

SimpleQueryCalc.prototype.setMatchPoints = 
	simpleQueryCalcSetMatchPoints;

function simpleQueryCalcSetMatchPoints(matchPoints)
{
	for(var i = 0, l = matchPoints.length ; i < l ; ++i) {
		var pathId = matchPoints[i];
		this.matchPoints.set(pathId, 1);
		this.matchParent.addToMatchPoints(pathId, this);
	}
}

// This function is called by the indexer when a new match point is 
// added (that is, when the first data element is created at the given
// path, which is a prefix of the path of this query calculation node).
// This function adds the match point to the match point table and 
// forwards it to the parent. 

SimpleQueryCalc.prototype.addToMatchPoints = 
	simpleQueryCalcAddToMatchPoints;

function simpleQueryCalcAddToMatchPoints(pathId)
{
    this.matchPoints.set(pathId, 1);
	this.matchParent.addToMatchPoints(pathId, this);
}

// This function is called by the indexer when a match point is 
// removed (that is, when the last data element is removed at the given
// path, which is a prefix of the path of this query calculation node).
// This function removes the match point from the match point table and 
// forwards the removal to the parent. 

SimpleQueryCalc.prototype.removeFromMatchPoints = 
	simpleQueryCalcRemoveFromMatchPoints;

function simpleQueryCalcRemoveFromMatchPoints(pathId)
{
    this.matchPoints.delete(pathId);
	this.matchParent.removeFromMatchPoints(pathId, this);
}

///////////////////
// Query Refresh //
///////////////////

// This function is called in the structural phase of the query refresh.
// Since structurally, the simple query calculation node never changes, 
// there is nothing to do here. The change between a selection node
// and a selection-projection node is handled through calles to 
// setSelectionProjection() and unsetSelectionProjection().

SimpleQueryCalc.prototype.refreshQueryStructure = 
    simpleQueryCalcRefreshQueryStructure;

function simpleQueryCalcRefreshQueryStructure()
{
    return;
}

// This function is called on a selection query calculation node which is
// a direct child of a union node when that union node changes from a 
// projection node to a selection node as a result of the removal of
// a projection sub-node directly or indirectly under the union node
// (note: this function is not called on the sub-node under which the
// removal took place because that node was a projection, not a 
// selection-projection before that change).
// This function performs the required cleanup. In this class, this
// consists of clearing the 'matches' table if it is no longer needed
// (it is always needed when the node is a selection-projection).
// Additional cleanup takes place in the base class version of the
// function.

SimpleQueryCalc.prototype.unsetSelectionProjection = 
    simpleQueryCalcUnsetSelectionProjection;

function simpleQueryCalcUnsetSelectionProjection()
{
    if(this.becameSelectionProjection !== undefined)
        this.becameSelectionProjection = undefined;
    
    if(this.matches !== undefined && !this.matchCountRequired())
        this.matches = undefined;

    // base class function
    this.InternalQueryCalc_unsetSelectionProjection();
}

// This function is called on a selection query calculation node which is
// a direct child of a union node when that union node changes from a 
// selection node to a projection node and its selection sub-nodes
// (including this node) become generating selection-projection node
// (it is the responsibility of the calling function to verify that the
// selection node is a generating projection node).
// When a simple query calculation node becomes a selection-projection,
// it needs to have a 'matches' table. If such a table does not yet
// exist, we do not want to create it yet, but wait until the
// matches are refreshed. To signal to the match refresh function that
// it needs to create the 'matches' table, we set the
// 'becameSelectionProjection' flag here.
// This function tehn continues to perform initialization defined in the base
// clas version of this function.

SimpleQueryCalc.prototype.setSelectionProjection = 
    simpleQueryCalcSetSelectionProjection;

function simpleQueryCalcSetSelectionProjection()
{
    // base class function
    this.becameSelectionProjection = true;
    this.InternalQueryCalc_unsetSelectionProjection();
}


// This function is called in the match point phase of the query refresh.
// This function only needs to do anything if this is the initial 
// query refresh. To detect whether this is the initial refresh, this function
// checks whether the root path is in the math point table (the root path
// is always a match point). If it isn't this is the initial update.
// When this is the initial update, the function adds the query 
// calculation node to the indexer, which results in the match points being
// updated through a call of the indexer to 'setMatchPoints()'.

SimpleQueryCalc.prototype.refreshMatchPoints = 
    simpleQueryCalcRefreshMatchPoints;

function simpleQueryCalcRefreshMatchPoints()
{
    if(this.matchPoints.has(this.indexer.qcm.getRootPathId()))
        return; // not initial update, nothing to do
    
    // initial update, need to register the node to the indexer
    this.indexer.addQueryCalcToPathNode(this);
}

/////////////////////////
// Query Match Refresh //
/////////////////////////

// This function is called in the match refresh phase of the query refresh.
// This function takes the pending selection value updates stored in 
// 'this.changedValues' and adds them to the 'this.values' table 
// (after (re-)assigning unique IDs to value IDs). The updates are then
// pushed to the indexer. The indexer then calls the addMatches() and
// removeMatches() functions of the simple query calculation node. These
// functions do not update the matches immediately in the 'this.matches'
// table but, instead, just queue them (storing the update vectors).
// It is then the refreshMatches() function which updates the 'this.matches'
// table and forwards the changes to the parent node or generates the 
// projection matches (in case this is a selection-projection).
// The functions below first remove all matches removed and then add
// all those added. Since a selection value update can remove a match only if a
// selection under the same ID exists and previously selected that value,
// no match can be removed which does nto already have a positive match count
// (that is, it cannot be removed just to cancel out a later addition).

SimpleQueryCalc.prototype.refreshMatches = 
    simpleQueryCalcRefreshMatches;

function simpleQueryCalcRefreshMatches()
{
    if(this.becameSelectionProjection) {
        // if this just became a selection-projection and the matches
        // table does not yet exist, this is the time to create it.
        if(this.matches === undefined)
            this.createMatchTable();
        this.becameSelectionProjection = undefined;
    }
    
    var changes = this.alignChangedValues();

    for(var i = 0, l = changes.length ; i < l ; ++i) {

        var change = changes[i];
        
        // get/assign unique ID
        var uniqueValueId;

        if(change.newUniqueValueId !== undefined) {
            // this is the new unique value ID assigned to this value ID
            uniqueValueId = change.newUniqueValueId;
            this.uniqueValueIds.set(change.valueId, uniqueValueId);
        } else // unique value ID assignment unchanged
            uniqueValueId = change.uniqueValueId;

        var value = change.newValue;

        if(!value) { // this value ID was removed
            if(change.valueId !== undefined) // remove this value ID
                this.uniqueValueIds.delete(change.valueId);
            else {
                // remove the value for the unique value ID from the query
                var entry = this.values.get(uniqueValueId);
                if(entry !== undefined)
                    this.removeValueByType(uniqueValueId, entry.type,
                                           entry.key);
                this.values.delete(uniqueValueId);
            }
        } else {
            // set the value only after updating the indexer, as we need 
            // the type of the previous value, to be able to remove it 
            // appropriately.
            var prevEntry = undefined;
            if(this.values.has(uniqueValueId)) {
                prevEntry = this.values.get(uniqueValueId);
                if(prevEntry.type != value.type)
                    this.removeValueByType(uniqueValueId, prevEntry.type,
                                           prevEntry.key);
            }
            this.addValueByType(uniqueValueId, value.type, value.key,
                                (prevEntry && prevEntry.type == value.type) ?
                                prevEntry.key : undefined);
            this.values.set(uniqueValueId, value);
        }
    }

    // process the queued added and removed matches (added matches first, 
    // see introduction).
    this.updateQueuedMatches();
}

// This function adds or modifies the value with the given unique ID,
// type and key to the 'disjoint' structure. This results in an update
// of the disjoint set of values which are registered to the index.
// If a previous value was registered under the given ID and this
// value had the same type, the key of this previous value is given
// by 'prevKey'. This previous key is needed in order to properly
// modify the key. If the same value ID previously had a different type,
// this previous value is not handled here and the value should
// have been removed by the calling function.
// This function finds the entry in the 'disjoint' table for the appropriate
// type and updates it. If there is only a single value, there is no
// need to create a PairwisDisjoint structure and the given value can be
// updated directly. Once there isore than one value a PairwiseDisjoint
// object must be created and updated. This structure is not destroyed
// anymore, even if the number of values drops to 1.

SimpleQueryCalc.prototype.addValueByType = simpleQueryCalcAddValueByType;

function simpleQueryCalcAddValueByType(uniqueValueId, type, key, prevKey)
{
    if(type === undefined)
        return; // nothing to add

    var typeEntry;

    if(this.disjoint.has(type)) {
        typeEntry = this.disjoint.get(type);
    } else {
        typeEntry = { valueIds: new Map() };
        this.disjoint.set(type, typeEntry);
    }

    if(typeEntry.pairwiseDisjoint === undefined) {
        // until now, no more than one value stored, calculate
        // number of values after this value will be added
        var numValues = typeEntry.valueIds.size;
        if(!typeEntry.valueIds.has(uniqueValueId))
            numValues++; // about to add a new unique value ID

        if(numValues == 1) {
            // single value, simply update it in the table and in the indexer
            typeEntry.valueIds.set(uniqueValueId, key);
            // update query in indexer (if the same value previously had a
            // different type, this was already removed).
            this.indexer.
                updateSimpleQuery(this, uniqueValueId, type, key, prevKey);
            return;
        }
    }

    if(this.matches == undefined &&
       this.indexer.hasRangeValues(this.pathId, type)) {
        // need a match count table, so create the match table and add
        // all existing matches to it, before continuing.
        this.createMatchTable();
    }
    
    // multiple values

    var modifications =
        this.updateKeyInPairwiseDisjoint(type, typeEntry, uniqueValueId, key,
                                         prevKey);

    // update the query values based on the 'modifications' structure
    
    if(modifications === undefined) {
        // only modify this value, update it in the table and in the indexer
        typeEntry.valueIds.set(uniqueValueId, key);
        // update query in indexer (if the same value previously had a
        // different type, this was already removed).
        this.indexer.
            updateSimpleQuery(this, uniqueValueId, type, key, prevKey);
        return;
    }

    this.updateDisjointIntervalModifications(typeEntry, type, modifications);
}

// This function updates the pairwise disjoint object of the entry
// 'typeEntry' in the 'disjoint' table for type 'type' with the
// key for value with ID 'uniqueValueId'. 'key' (either a simple value
// or a range object) is the new key of this value and 'prevKey'
// (either a simple value or a range object) is the previous key of
// this value (if such a key exists, otherwise it is undefined). This
// function returns undefined or an object of the format returned by
// the 'addInterval()' and 'modifyInterval()' of the
// 'PairwiseDisjoint' object (see documentation there).

SimpleQueryCalc.prototype.updateKeyInPairwiseDisjoint =
    simpleQueryCalcUpdateKeyInPairwiseDisjoint;

function simpleQueryCalcUpdateKeyInPairwiseDisjoint(type, typeEntry,
                                                    uniqueValueId, key, prevKey)
{
    var startValue, startOpen, endValue, endOpen;
    
    if(typeof(key) == "object") {
        startValue = key.getMinKey();
        startOpen = key.getMinOpen();
        endValue = key.getMaxKey();
        endOpen = key.getMaxOpen();
    } else {
        startValue = endValue = key;
        startOpen = endOpen = false;
    }

    if(typeEntry.pairwiseDisjoint !== undefined && prevKey !== undefined) {
        // the value ID already exists, we modify the value
        var prevStartValue, prevStartOpen, prevEndValue, prevEndOpen;
        if(typeof(prevKey) == "object") {
            prevStartValue = prevKey.getMinKey();
            prevStartOpen = prevKey.getMinOpen();
            prevEndValue = prevKey.getMaxKey();
            prevEndOpen = prevKey.getMaxOpen();
        } else {
            prevStartValue = prevEndValue = prevKey;
            prevStartOpen = prevEndOpen = false;
        }
        
        return typeEntry.pairwiseDisjoint.
            modifyInterval(startValue, startOpen, endValue, endOpen,
                           prevStartValue, prevStartOpen, prevEndValue,
                           prevEndOpen, uniqueValueId);
    }
    
    if(typeEntry.pairwiseDisjoint === undefined) {
        // create a PairwiseDisjoint object using the same comparison
        // function as the one that will be used for the data
        typeEntry.pairwiseDisjoint =
            new PairwiseDisjoint(true,
                                 (type in this.indexer.alphabeticTypes) ? 
                                 LinearSubIndex.stringCompare : undefined);
        // add the existing value (iterates once)
        typeEntry.valueIds.forEach(function(key, id) {
            if(typeof(key) == "object") { // a range object
                typeEntry.pairwiseDisjoint.
                    addInterval(key.getMinKey(), key.getMinOpen(),
                                key.getMaxKey(), key.getMaxOpen(), id);
            } else
                typeEntry.pairwiseDisjoint.addInterval(key, false, key,
                                                       false, id);
        });
    }
    
    // add the new interval
    return typeEntry.pairwiseDisjoint.
        addInterval(startValue, startOpen, endValue, endOpen, uniqueValueId);
}

// This function receives the entry 'typeEntry' for the type 'type'
// from the 'disjoint' table and an object 'modifications'
// which is of the format returned by the 'addInterval()', 'modifyInterval()'
// or 'removeInterval()' function of the 'PairwiseDisjoint' object
// (see the documentation of these functions). This function then
// updates the values in the 'valueIds' table of 'typeEntry' and
// queries registered to the indexer based on the values in the 'modifications'
// structure.
// When the 'addInterval()', 'modifyInterval()' or 'removeInterval()'
// function returns undefined, this function cannot be used to carry out
// the update, since an 'undefined' value has a different meaning for
// each function returning the value. At the same time, since the update
// associated with an 'undefined' return value is simple, it can be
// carried out by the calling function.

SimpleQueryCalc.prototype.updateDisjointIntervalModifications =
    simpleQueryCalcUpdateDisjointIntervalModifications;

function simpleQueryCalcUpdateDisjointIntervalModifications(typeEntry, type,
                                                            modifications)
{
    // remove intervals which are no longer in the disjoint set
    
    if(modifications.removedIntervals && modifications.removedIntervals.length)
        for(var i = 0, l = modifications.removedIntervals.length ; i < l ; ++i){
            var id = modifications.removedIntervals[i];
            this.indexer.unregisterQueryValue(this, id, type,
                                              typeEntry.valueIds.get(id));
            typeEntry.valueIds.delete(id);
        }

    // add/modify the disjoint interval which covers the interval just
    // added or modified.
    
    if(modifications.coveringInterval !== undefined) {
        var interval = modifications.coveringInterval;
        this.addDisjointIntervalToQuery(typeEntry, interval.id, type,
                                        interval.startValue,
                                        interval.endValue,
                                        interval.startOpen,
                                        interval.endOpen);
    }

    // add disjoint intervals which became disjoint as a result of the
    // removal or modification operation
    
    if(modifications.restoredIntervals) {
        var restored = modifications.restoredIntervals;
        for(var i = 0, l = restored.length ; i < l ; ++i) {
            var interval = restored[i];
            this.addDisjointIntervalToQuery(typeEntry, interval.id, type,
                                            interval.startValue,
                                            interval.endValue,
                                            interval.startOpen,
                                            interval.endOpen);
        }
    }

    // update the disjoint interval modified by a removal or modification
    // operation.
    
    if(modifications.modifiedInterval) {
        var interval = modifications.modifiedInterval;
        this.addDisjointIntervalToQuery(typeEntry, interval.id, type,
                                        interval.startValue,
                                        interval.endValue,
                                        interval.startOpen,
                                        interval.endOpen);
    }
}

// This function takes the interval with ID 'id' and of type 'type'
// whose range is defined by the arguments , 'lowKey', 'highKey', 'lowOpen',
// and 'highOpen' and sets it in the set of disjoint intervals in
// the 'valueIds' table of the 'typeEntry' object (which is the entry
// for this given type in the 'disjoint' table. It is assumed that
// the given interval is valid and non-empty. This function also updates
// this query interval in the indexer.
// This function may be used both when the interval has just become
// part of the disjoint interval set and when it previously already was
// part of the disjoint interval set.

SimpleQueryCalc.prototype.addDisjointIntervalToQuery = 
    simpleQueryCalcAddDisjointIntervalToQuery;

function simpleQueryCalcAddDisjointIntervalToQuery(typeEntry, id, type, lowKey,
                                                   highKey, lowOpen, highOpen)
{
    var key;
    if(lowKey == highKey)
        key = lowKey;
    else
        key = new ConstRangeKey(undefined, type, lowKey, highKey,
                                lowOpen, highOpen);

    var prevKey =
        typeEntry.valueIds.has(id) ? typeEntry.valueIds.get(id) : undefined;

    if(key === prevKey)
        return;
    
    typeEntry.valueIds.set(id, key);
    this.indexer.updateSimpleQuery(this, id, type, key, prevKey);
}

// This function removes the value with the given unique ID,
// type and key from the 'disjoint' structure. This results in an update
// of the disjoint set of values which are registered to the index.
// This function finds the entry in the 'disjoint' table for the appropriate
// type and updates it. If there is no PairwiseDisjoint structure,
// all this function needs to do is remove the value (from the 'valueIds'
// table of the entry and the index). If there is a PairwiseDisjoint structure,
// that structure has to be updated and then the valueIds table and the
// index are updated based on the modification specified by the
// PairwiseDisjoint object.

SimpleQueryCalc.prototype.removeValueByType =
    simpleQueryCalcRemoveValueByType;

function simpleQueryCalcRemoveValueByType(uniqueValueId, type, key)
{ 
    if(type === undefined)
        return;
    
    var typeEntry = this.disjoint.get(type);

    if(typeEntry === undefined)
        return;

    if(typeEntry.pairwiseDisjoint === undefined) {
        typeEntry.valueIds.delete(uniqueValueId);
        this.indexer.unregisterQueryValue(this, uniqueValueId, type, key);
    } else {
        var modifications;
        if(typeof(key) == "object") {
            modifications = typeEntry.pairwiseDisjoint.
                removeInterval(key.getMinKey(), key.getMinOpen(),
                               key.getMaxKey(), key.getMaxOpen(),
                               uniqueValueId);
        } else {
            modifications = typeEntry.pairwiseDisjoint.
                removeInterval(key, false, key, false, uniqueValueId);
        }
        if(modifications === undefined) {
            var prevKey = typeEntry.valueIds.get(uniqueValueId);
            typeEntry.valueIds.delete(uniqueValueId);
            this.indexer.unregisterQueryValue(this, uniqueValueId, type,
                                              prevKey);
        } else
            this.updateDisjointIntervalModifications(typeEntry, type,
                                                     modifications);
    }

    if(typeEntry.valueIds.size == 0)
        this.disjoint.delete(type);
}

//////////////////////////////////////
// Value Update Alignment Functions //
//////////////////////////////////////

// This function goes over the list of pending changes in 'this.changedValues'
// and returns an array of change entries which describes the updates
// which need to take place to implement the change defined in
// 'this.changedValues'. 'this.changedValues' is cleared. The array returned
// by this function holds entries of the following structure:
// {
//      valueId: undefined|<value ID>
//      uniqueValueId: undefined|<unique value ID>
//      newUniqueValueId: undefined|<unique value ID>
//      newValue: false|{
//          type: <type>,
//          key: <simple key or range object>
//      }
// }
// valueId: if this is undefined, this entry is an update for the unique
//      value ID given in 'uniqueValueId' (which cannot be undefined in
//      this case). 'newValue' must then be 'false'. This entry then deletes
//      the current value for this unique value ID. If 'valueId' is defined,
//      this is an update for this value ID. If 'newValue' is false,
//      this entry deletes the entry for the given value ID, but does not
//      delete the unique value ID belonging to that value ID, as this
//      unique value ID may be reused (if the unique value ID should also
//      be removed, a separate entry with an undefined 'valueId' will do that).
//      Finally, if 'newValue' is not false, the value ID is assigned the
//      unique value ID in 'newUniqueValueId', if it is not undefined,
//      and the unique value ID in 'uniqueValueId' if 'newUniqueValueId'
//      is undefined. The value 'newValue' is set for this unique ID.
// uniqueValueId: this is the current unique value ID for this value ID
//      (if value ID is defined). If 'newUniqueValueId' is undefined, this
//      remains the unique value ID for this value ID (so the assignment of
//      unique value ID to value ID does not change). In case of 'newValue'
//      equal to false, this removes the value assigned to the unique value ID.
// newUniqueValueId: this is a new unique value ID to be assigned to
//      the value ID 'valueId'. This unique value ID may be an existing
//      unique value ID (previously assigned to a different value ID) or
//      a new unique value ID. This is defined iff 'valueId' is
//      defined and 'newValue' is not false. The value 'newValue' is
//      assigned to this unique value ID.
// newValue: if this is false, the value under 'valueId' is deleted
//      (if valueId is not undefined). If valueId is undefined, the
//      unique value ID under 'uniqueValueId' is removed.
//      If 'newValue' is not false, the value stored here is set as the value
//      of the unique ID given by 'newUniqueValueId' (if defined)
//      or 'uniqueValueId' (if 'newUniqueValueId' is undefined).

SimpleQueryCalc.prototype.alignChangedValues =
    simpleQueryCalcAlignChangedValues;

function simpleQueryCalcAlignChangedValues()
{
    // a processed list of changes, in preparation for the alignment of IDs 
    var changes = this.prepareValueChangeAlignment();    

    // determine which change entries may be reassigned an existing
    // unique ID (which does not already belong to that value ID)
    // (this function modifies the input 'changes' object)
    this.findFreeOverlappingUniqueIds(changes);

    // finalize the reassignment of unique IDs
    // entries in the 'reassign' list which are not already mapped to another
    // unique ID should get one of the remaining 'freeUniqueIds' assigned
    // to them. When those are exhausted, new unique IDs are assigned.

    // create list of free unique IDs still available
    var freeUniqueIds = [];
    changes.freeUniqueIds.forEach(function(t, id) {
        freeUniqueIds.push(id);
    });
    
    for(var i = 0, l = changes.reassign.length ; i < l ; ++i) {
        var change = changes.reassign[i];
        if(change.newUniqueValueId !== undefined)
            continue; // already assigned a free unique ID
        if(freeUniqueIds.length > 0) {
            change.newUniqueValueId =
                freeUniqueIds[freeUniqueIds.length-1];
            freeUniqueIds.length--;
        } else
            change.newUniqueValueId = this.newUniqueValueId();
    }
            
    if(freeUniqueIds.length > 0)
        for(var i = 0, l = freeUniqueIds.length ; i < l ; ++i)
            changes.changes.push({ uniqueValueId: freeUniqueIds[i],
                                   newValue: false });

    return changes.changes;
}

// This function prepares the reassignment of unique value IDs to selection
// values which have changed. This function determines which value changes
// are candidates for the reassignment of their unique value ID and which
// existing unique value IDs are free to have values assigned to them. Finally,
// it prepares and array of all change entries (and this.changedValues is
// cleared). All the value change lists are returned in an object, as follows:
// {
//    changes: [{
//                 valueId: <ID of the value> // non-unique ID (attribute in
//                                            // this.changedValues table).
//                 uniqueValueId: <unique ID> // current unique ID assigned to
//                                            // the value ID (may be undefined)
//                 newValue: false|{ type: <type>, key: <key> } // new value
//                                                              // assigned to
//                                                              // value ID
//              },....]
//    reassign: [<subset of entries in 'changes'>]
//    freeUniqueIds: <Map>{
//         <unique ID>: true
//         .....
//    }
// }
//
// changes: is an array with an entry for each change currently in
//    this.changedValues. It stores the value ID (the attribute of the entry
//    in this.changedValues) the unique ID currently assigned to this value ID
//    (if such a unique ID is already assigned, if not, this is undefined)
//    and the new value assigned to this value ID (this is the entry in
//    this.changedValues under 'valueId'). If this is false, the value is
//    deleted, otherwise its value is replaced with the provided value.
// reassign: this is a subset of the objects stored in 'changes' this subset
//    consists of those entries for which a new unique ID may have to
//    be asigned. This includes all entries which do not yet have
//    a unique value ID assigned and all those entries which have a
//    unique value ID assigned, have a new value (not 'false') but
//    this new value does not overlap the curent value registered under
//    this unique ID.
// freeUniqueIds: this is a Map object containing those unique value IDs
//    which are already allocated to a value ID, but may be allocated to
//    a different value ID. These unique IDs include those appearing in
//    'changes' such that their newValue is either 'false' or the new
//    value does not overlap with the old value.

SimpleQueryCalc.prototype.prepareValueChangeAlignment =
    simpleQueryCalcPrepareValueChangeAlignment;

function simpleQueryCalcPrepareValueChangeAlignment()
{
    var changes = [];
    var reassign = []; // candidates for re-assigning existing unique IDs
    var freeUniqueIds = new Map();
    
    for(var valueId in this.changedValues) {
        var change = this.changedValues[valueId];
        var uniqueValueId = this.uniqueValueIds.has(valueId) ?
            this.uniqueValueIds.get(valueId) : undefined;
        var changeEntry = { valueId: valueId, uniqueValueId: uniqueValueId,
                            newValue: change }; 
        changes.push(changeEntry);
        if(uniqueValueId === undefined) {
            reassign.push(changeEntry);
            continue; // new value
        }
        
        if(change === false) {
            // value removed, so the unique value ID is now free to be assigned
            freeUniqueIds.set(uniqueValueId, true);
        } else {
            // get current type and key and check whether the current and
            // the new values intersect. If they don't, mark the unique value
            // ID as being free to be assigned to some other value. 
            var valueEntry = this.values.get(uniqueValueId);
            if(!this.valuesOverlap(change, valueEntry)) {
                // no overlap with the previous value so the unique
                // value is free to be assigned
                freeUniqueIds.set(uniqueValueId, true);
                reassign.push(changeEntry);
            }
        }
    }

    this.changedValues = {};
    
    return {
        changes: changes,
        reassign: reassign,
        freeUniqueIds: freeUniqueIds
    };
}

// This function takes as input the object desscribing the pending query
// value changes as prepared by the function prepareValueChangeAlignment().
// This function then checks which value changes in the list of
// changes which may be reassigned a unique ID has a free unique ID
// whose current value overlaps the new value of the change (the lists
// of changes which may be reassigned a unique value ID and the list of
// free unique value IDs have been prepared by prepareValueChangeAlignment()).
// For each change entry which may be reassigned a free unique value ID,
// the free value ID is stored under the 'newUniqueValueId' field in the
// change entry. This unique value ID is then removed from the list
// of free value IDs (so it cannot be reused). These changes apply to the
// entries stored in the 'changes' object, so this function does not
// need to return any value.

SimpleQueryCalc.prototype.findFreeOverlappingUniqueIds =
    simpleQueryCalcFindFreeOverlappingUniqueIds;

function simpleQueryCalcFindFreeOverlappingUniqueIds(changes)
{
    var reassign = changes.reassign;
    var freeUniqueIds = changes.freeUniqueIds;
    
    // for each entry which may be reassigned, check which existing unique
    // value it overlaps.
    
    var currentType;
    var typeEntry;
    
    for(var i = 0, l = reassign.length ; i < l ; ++i) {
        var change = reassign[i];
        var value = change.newValue;
        
        if(value.type != currentType) {
            typeEntry = this.disjoint.has(value.type) ?
                this.disjoint.get(value.type) : undefined;
            currentType = value.type;
        }
        if(typeEntry === undefined)
            continue;
        var disjoint = typeEntry.pairwiseDisjoint;
        if(disjoint === undefined) {
            
            // at most one current value of this type, check whether it
            // overlaps with the new key
            
            var _self = this; // at most one iteration in loop below.
            typeEntry.valueIds.forEach(function(oldValue, uniqueId) {
                if(_self.valuesOverlap(value, oldValue) &&
                   freeUniqueIds.has(uniqueId)) {
                    change.newUniqueValueId = uniqueId;
                    freeUniqueIds.delete(uniqueId);
                }
            });
        } else {
            var uniqueId;
            if(typeof(value.key) == "object") { // range object
                uniqueId =
                    disjoint.getCoveringIntervalId(value.key.getMinKey(),
                                                   value.key.getMinOpen(),
                                                   value.key.getMaxKey(),
                                                   value.key.getMaxOpen());
            } else {
                uniqueId = disjoint.getCoveringIntervalId(value.key, false,
                                                          value.key, false);
            }
            if(uniqueId !== undefined && freeUniqueIds.has(uniqueId)) {
                change.newUniqueValueId = uniqueId;
                freeUniqueIds.delete(uniqueId);
            }
        }
    }
}

// This is an auxiliary function.
// value1 and value2 are objects which have at least the two fields
// { type: <type string>, key: <simple JS value or range object> }
// This function returns true if the two values overlap (they have the same
// type and their values overlap) and false if not.

SimpleQueryCalc.prototype.valuesOverlap = simpleQueryCalcValuesOverlap;

function simpleQueryCalcValuesOverlap(value1, value2)
{
    if(value1.type != value2.type)
        return false;
    
    if(typeof(value1.key) == "object") {
        if(typeof(value2.key) == "object")
            return value1.key.intersectsWith(value2.key);
        else
            return value1.key.valueInRange(value2.key);
    } else if(typeof(value2.key) == "object")
        return value2.key.valueInRange(value1.key);
    else
        return value1.key == value2.key;
}

////////////////
// Suspension //
////////////////

// The projection matches of this node may be suspended in case this 
// node is a generating selection-projection. There is, however, nothing 
// to do here beyond what already takes place in the base class.

SimpleQueryCalc.prototype.suspendProjMatches = 
	simpleQueryCalcSuspendProjMatches;

function simpleQueryCalcSuspendProjMatches()
{
    return;
}

///////////////////////
// Node Mode Setting //
///////////////////////

// Since the simple node uses the same addMatches, removeMatches, 
// addProjMatches and removeProjMatches in all cases, the mode
// setting functions do nothing.

SimpleQueryCalc.prototype.setSelectionMode = simpleQueryCalcSetSelectionMode;

function simpleQueryCalcSetSelectionMode()
{
    return;
}

SimpleQueryCalc.prototype.setProjectionMode = simpleQueryCalcSetProjectionMode;

function simpleQueryCalcSetProjectionMode()
{
    return;
}

SimpleQueryCalc.prototype.setSuspendedProjectionMode = 
	simpleQueryCalcSetSuspendedProjectionMode;

function simpleQueryCalcSetSuspendedProjectionMode()
{
    return;
}

//////////////////////
// Updating Matches //
//////////////////////

// This function creates the match table, adding to it the matches which were
// already forwarded to the parent of this query calculation node.
// These matches are all those which are still registered in the indexer
// as matching the query values registered already by this query calculation
// node (these are the keys currently in the 'valueIds' tables of the
// 'disjoint' table). Since these matches include match count changes
// which are still pending (already updated in the indexer but not yet
// delivered to the query calculation node) this function retrieves
// those pending matches and corrects the counts in the 'matches' table so
// that when this update is received, the resulting match count (after
// processing the update) is correct.

SimpleQueryCalc.prototype.createMatchTable =
    simpleQueryCalcCreateMatchTable;

function simpleQueryCalcCreateMatchTable()
{
    if(this.matches !== undefined)
        return;
    
    // first forward any matches already pending (as this will be included
    // in the table constructed here).
    this.updateQueuedMatches();

    // create the table
    this.matches = new Map();
    
    // add all existing matches to the table.

    var _self = this;
    
    this.disjoint.forEach(function(entry, type) {
        entry.valueIds.forEach(function(key, valueId) {
            var matches =
                _self.indexer.getSimpleQueryValueMatches(_self, valueId, type,
                                                         key);
            for(var i = 0, l = matches.length ; i < l ; ++i) {
                var elementId = matches[i];
                if(!_self.matches.has(elementId))
                    _self.matches.set(elementId, 1);
                else
                    _self.matches.set(elementId,
                                      _self.matches.get(elementId) + 1);
            }
        });
    });

    // Queued match updates (still waiting in the indexer) are removed
    // for the match count added, as they will be added back when the
    // update is receive from the index.
    
    var queuedMatchUpdates = this.indexer.getSimpleQueryQueuedUpdates(this);

    if(queuedMatchUpdates !== undefined) {

        queuedMatchUpdates.forEach(function(count, elementId) {
            if(count == 0)
                return;
            if(count < 0) {
                // count will be decreased, increase it to the value before
                // this decrease
                if(!_self.matches.has(elementId))
                    _self.matches.set(elementId, -count);
                else
                    _self.matches.set(elementId,
                                      _self.matches.get(elementId) - count);
            } else {
                var prevCount = _self.matches.get(elementId) - count;
                if(prevCount == 0)
                    _self.matches.delete(elementId);
                else
                    _self.matches.set(elementId, prevCount);
            }
        });
    }
}

// This function returns true if this simple query calculation node needs
// to count the number of matches for each data element. This is needed
// in case one of the following holds:
// 1. The simple query is a selection-projection
// 2. Two query values may match the same data element. Since the query
//    registers disjoint query values to the index (see the 'disjoint'
//    field for more information), this can only happen if the query
//    registers multiple query values of the same type and there are
//    range value in the data of that type.
//    To simplify testing this criterion, once a PairwiseDisjoint
//    object is created for a certain type of value, this type is considered
//    to have multiple query values. If the same type also has range values
//    in the data, match counting is required.

// This function returns true if any of these two conditions holds and
// false otherwise.

SimpleQueryCalc.prototype.matchCountRequired =
    simpleQueryCalcMatchCountRequired;

function simpleQueryCalcMatchCountRequired()
{
    if(this.isSelectionProjection())
        return true;
    
    if(this.values.size <= 1)
        return false; // no multiple query values

    var multipleQueriesOnRanges = false;
    
    // loop over the query value types and check whether the data for the type
    // contains ranges.
    var pathId = this.pathId;
    this.disjoint.forEach(function(entry, type) {
        if(entry.valueIds.pairwiseDisjoint &&
           this.indexer.hasRangeValues(pathId, type)) {
            multipleQueriesOnRanges  = true;
        }
    });

    return multipleQueriesOnRanges;
}

// This function is called by the indexer during query refresh and 
// provides a list (array) of element IDs which are new matches of 
// the selection value just added or modified by the query refresh.
// If multiple selection values are updated, this function may be called
// multiple times.
// All this function does is store this array under 'this.addedMatches'.
// All updates will be processed together at the end of the query refresh.  

SimpleQueryCalc.prototype.addMatches = simpleQueryCalcAddMatches;

function simpleQueryCalcAddMatches(matches)
{
    if(matches.length != 0)
        this.addedMatches.push(matches);
}

// This function is called by the indexer during query refresh and 
// provides a list (array) of element IDs which were just removed as matches 
// for the selection value just removed or modified by the query refresh.
// If multiple selection values are updated, this function may be called
// multiple times.
// All this function does is store this array under 'this.removedMatches'.
// All updates will be processed together at the end of the query refresh.  

SimpleQueryCalc.prototype.removeMatches = simpleQueryCalcRemoveMatches;

function simpleQueryCalcRemoveMatches(matches)
{
    if(matches.length != 0)
        this.removedMatches.push(matches);
}

// This function is called by the indexer when, as a result of value changes
// in the indexer, the match of this query calculation node has changed.
// It receives a Map object whose keys are data element IDs and
// whose values are the change in match count for this query for each
// of these data element IDs (these changes may be positive or negative).
// The function then uses these counts to update the counts in the 
// 'this.matches' table. The function then calculates the lists of new
// and removed matches for this node and forwards them to the match 
// parent (if this is a selection) or to the projection matches (if this
// is a generating selection-projection).

SimpleQueryCalc.prototype.updateMatchCount = simpleQueryCalcUpdateMatchCount;

function simpleQueryCalcUpdateMatchCount(matchUpdate)
{
    if(matchUpdate === undefined)
        return;
    
    var addedMatches = [];
    var removedMatches = [];

    if(this.matches === undefined) {
        if(!this.matchCountRequired()) {
            matchUpdate.forEach(function(count, elementId) {
                if(count < 0)
                    removedMatches.push(elementId);
                else if(count > 0)
                    addedMatches.push(elementId);
            });
            this.propagateMatchUpdates(addedMatches, removedMatches);
            return;
        }

        // match count is required: create the match table for the matches
        // before this update and tehn continue below to process the update.
        this.createMatchTable();
    }
    
    var _self = this;
    
    matchUpdate.forEach(function(count, elementId) {

        if(!_self.matches.has(elementId)) {
            // must be an increase in count
            _self.matches.set(elementId, count);
            addedMatches.push(elementId);
        } else {
            var newCount = _self.matches.get(elementId) + count;
            if(newCount == 0) {
                _self.matches.delete(elementId);
                removedMatches.push(elementId);
            } else
                _self.matches.set(elementId, newCount);
        }
    });

    this.propagateMatchUpdates(addedMatches, removedMatches);
}

// This function runs at the end of the query refresh. It reads all
// updates received during the query refresh by 'addMatches()' and 
// 'removeMatches()' (and stored in this.addedMatches and this.removedMatches)
// and updates them to the 'matches'. The queued updates are still
// stored in arrays of element IDs, as received by the addMatches()
// and removeMatches() functions. This function first adds all the matches
// in the added arrays (increasing the count for an element ID by 1 for 
// each appearance of the element ID in the added lists) and then removes 
// all matches in the removed arrays (decreasing the count by 1).
// Because matches removed must be matches existing before the update
// (the removal is due to the removal of a previous selection value)
// any match added whose match count goes up from 0 to 1 can be considered
// a new mathc of this node (it cannot be later removed when processing
// the removed arrays). Any match whose count drops to zero when updating
// the removals is a previous (before the update) match which was removed.
// After constructing the lists of new and removed matches of this node,
// these list are forwarded to the parent node (if this is a selection
// node) or used to update the projection matches (if this is a 
// selection-projection).

SimpleQueryCalc.prototype.updateQueuedMatches = 
    simpleQueryCalcUpdateQueuedMatches;

function simpleQueryCalcUpdateQueuedMatches()
{
    var addedMatches = [];
    var removedMatches = [];

    // loop over all lists of added matches and then over the elements in 
    // each list
    var l = this.addedMatches.length;
    for(var i = 0 ; i < l ; ++i) { 
        var added = this.addedMatches[i];
        if(this.matches === undefined) {
            if(addedMatches.length == 0)
                addedMatches = added;
            else
                addedMatches = cconcat(addedMatches,added);
        } else {
            for(var a = 0, la = added.length ; a < la ; ++a) {
                var elementId = added[a];
                if(this.matches.has(elementId)) // not a new match
                    this.matches.set(elementId, this.matches.get(elementId)+1);
                else {
                    this.matches.set(elementId, 1);
                    addedMatches.push(elementId);
                }
            }
        }
    }
    if(l > 0)
        this.addedMatches = [];
    
    l = this.removedMatches.length;
    for(var i = 0 ; i < l ; ++i) { 
        var removed = this.removedMatches[i];
        if(this.matches === undefined) {
            if(removedMatches.length == 0)
                removedMatches = removed;
            else
                removedMatches = cconcat(removedMatches,removed);
        } else {
            for(var r = 0, lr = removed.length ; r < lr ; ++r) {
                var elementId = removed[r];
                var newCount = this.matches.get(elementId) - 1;
                if(newCount == 0) {
                    this.matches.delete(elementId);
                    removedMatches.push(elementId);
                } else
                    this.matches.set(elementId, newCount);
            }
        }
    }
    if(l > 0)
        this.removedMatches = [];

    // propagate the matches to the parent (if a selection) or
    // to the projection matches (if a selection-projection)
    this.propagateMatchUpdates(addedMatches, removedMatches);
}

// This function is called directly by the indexer when a path node is 
// cleared and it needs to notify the query calculation node that all 
// matches received from the indexer should be removed.
// This function clears the 'matches' table. The removal is then 
// propagated to the parent node or the result nodes, as needed.
// Note that this function is called before the data is cleared in the
// indexer, so this function may still get the matches from the indexer. 

SimpleQueryCalc.prototype.removeAllIndexerMatches = 
    simpleQueryCalcRemoveAllIndexerMatches;

function simpleQueryCalcRemoveAllIndexerMatches()
{
    var removedMatches = this.getMatches();

    if(this.matches !== undefined)
        this.matches.clear();
    this.propagateMatchUpdates([], removedMatches);
}

// This function receives two arrays: a list of selection matches added to
// this node and a list of selection matches removed from this node.
// If this is a selection node, this function propagates these lists
// to the match parent. If this node is a generating selection projection,
// this function updates the projection matches of this node and forwards
// the projection match update to the resutl nodes.
// If this node is a non-generating selection-projection then this behaves
// exactly like a standard selection node (because a selection-projection
// node is non-generating iff it is dominated by an intersection node
// with multiple projection sub-nodes, which is iff the simple node
// needs to add its selection matches to the parent).   

SimpleQueryCalc.prototype.propagateMatchUpdates = 
    simpleQueryCalcPropagateMatchUpdates;

function simpleQueryCalcPropagateMatchUpdates(addedMatches, removedMatches)
{
    if(this.isGeneratingProjection()) {
        // this is a generating projection, which means that it must be
        // a selection-projection which does not add its matches to the
        // parent node.
        if(this.isSuspendedProjection())
            this.unsuspend();
        else {
            if(removedMatches.length)
                this.removeOldSelectionProjMatches(removedMatches);
            if(addedMatches.length)
                this.addNewSelectionProjMatches(addedMatches);
        }
    } else {
        // either a selection or a selection-projection which has to add
        // its matches to the parent node (this is then equivalent to
        // a selection, as no projection takes place).
        if(removedMatches.length)
            this.matchParent.removeMatches(removedMatches, this);
        if(addedMatches.length)
            this.matchParent.addMatches(addedMatches, this);
    }
}

///////////////////////
// Access to Matches //
///////////////////////

// This function returns an array with data element IDs of all
// selection matches of this node. If this object has a 'matches'
// table, the function uses the default implementation (form the base class)
// which creates an array with all data elements in the 'matches' table.
// If the object does not have a 'matches' table, the function reads
// the matches directly from the indexer. When reading the matches
// from the indexer, the function must correct these matches for
// any matches which are pending update (that is, matches which were
// already added/removed in the indexer but the change was not yet
// forwarded to the query calculation node).

SimpleQueryCalc.prototype.getMatches = simpleQueryCalcGetMatches;

function simpleQueryCalcGetMatches()
{
    if(this.matches !== undefined)
        // use the base class implementation
        return this.InternalQueryCalc_getMatches();

    // Queued match updates (still waiting in the indexer) are corrected
    // for so that the matches returned by this function represent the
    // matches before this update took place.
    var queuedMatchUpdates = this.indexer.getSimpleQueryQueuedUpdates(this);
    if(queuedMatchUpdates && queuedMatchUpdates.size == 0)
        queuedMatchUpdates = undefined;
    
    var matches = [];
    var _self = this;
    
    // get the matches for each query value directly from the indexer. 
    this.disjoint.forEach(function(entry, type) {
        entry.valueIds.forEach(function(key, valueId) {
            var valueMatches =
                _self.indexer.getSimpleQueryValueMatches(_self, valueId, type,
                                                         key);
            if(queuedMatchUpdates === undefined) {
                if(matches.length == 0)
                    matches = valueMatches;
                else
                    matches = cconcat(matches, valueMatches);
            } else {
                // need to check for each match whether it is new (and still
                // not reported from the indexer to the query calculation node)
                for(var i = 0, l = valueMatches.length ; i < l ; ++i) {
                    var elementId = valueMatches[i];
                    if(!queuedMatchUpdates.has(elementId) ||
                       queuedMatchUpdates.get(elementId) == 0)
                        matches.push(elementId);
                }
            }
        });
    });

    if(queuedMatchUpdates !== undefined) {
        // add matches which are still pending as removed (that is, were
        // already removed from the indexer but were not yet updated
        // to the query calculation node).
        queuedMatchUpdates.forEach(function(count, elementId) {
            if(count < 0)
                matches.push(elementId);
        });
    }

    return matches;
}

// This function is identical to 'getMatches' except that it returns
// the matches as a Map object whose keys are the matches.  If this
// object has a 'matches' table, this function simply returns this
// object.  If the object does not have a 'matches' table, the
// function reads the matches directly from the indexer. When reading
// the matches from the indexer, the function must correct these
// matches for any matches which are pending update (that is, matches
// which were already added/removed in the indexer but the change was
// not yet forwarded to the query calculation node).

SimpleQueryCalc.prototype.getMatchesAsObj = simpleQueryCalcGetMatchesAsObj;

function simpleQueryCalcGetMatchesAsObj()
{
	if(this.matches !== undefined)
        return this.matches;

    // Queued match updates (still waiting in the indexer) are corrected
    // for so that the matches returned by this function represent the
    // matches before this update took place.
    var queuedMatchUpdates = this.indexer.getSimpleQueryQueuedUpdates(this);
    if(queuedMatchUpdates && queuedMatchUpdates.size == 0)
        queuedMatchUpdates = undefined;
    
    var matches = new Map();
    var _self = this;
    
    // get the matches for each query value directly from the indexer. 
    this.disjoint.forEach(function(entry, type) {
        entry.valueIds.forEach(function(key, valueId) {
            var valueMatches =
                _self.indexer.getSimpleQueryValueMatches(_self, valueId, type,
                                                         key);
            if(queuedMatchUpdates === undefined) {
                for(var i = 0, l = valueMatches.length ; i < l ; ++i)
                    matches.set(valueMatches[i], 1);
            } else {
                // need to check for each match whether it is new (and still
                // not reported from the indexer to the query calculation node)
                for(var i = 0, l = valueMatches.length ; i < l ; ++i) {
                    var elementId = valueMatches[i];
                    if(!queuedMatchUpdates.has(elementId) ||
                       queuedMatchUpdates.get(elementId) == 0)
                        matches.set(elementId,1);
                }
            }
        });
    });

    if(queuedMatchUpdates !== undefined) {
        // add matches which are still pending as removed (that is, were
        // already removed from the indexer but were not yet updated
        // to the query calculation node).
        queuedMatchUpdates.forEach(function(count, elementId) {
            if(count < 0)
                matches.set(elementId,1);
        });
    }

    return matches;
}

// This function returns an array with data element IDs of all data
// elements with a full match on this node which are also higher (or
// at) the root node's prefix path (these are matches which do not
// need to be raised any further). If the match points on the node
// indicate that no raising is necessary, the function simply calls
// 'getMatches'. Otherwise, the function must go over all matches and
// check the match point of each element and return only those
// elements which have a short enough path.

SimpleQueryCalc.prototype.getFullyRaisedMatches =
    simpleQueryCalcGetFullyRaisedMatches;

function simpleQueryCalcGetFullyRaisedMatches()
{
    if(!this.lowerThanQueryPrefixFullMatches())
        return this.getMatches();

    var allMatches = this.getMatches();
    
    var maxMatches = [];
    var dataElements = this.indexer.getDataElements();
    var prefixPathId = this.rootQueryCalc.prefixProjPathId;

    for(var i = 0, l = allMatches.length ; i < l ; ++i) {
        var elementId = allMatches[i];
        if(dataElements.getPathId(elementId) <= prefixPathId)
            maxMatches.push(elementId);
    };
		
    return maxMatches;
}

// This function is identical to 'getFullyRaisedMatches' except that
// it returns the matches as a Map object whose keys are the
// matches.

SimpleQueryCalc.prototype.getFullyRaisedMatchesAsObj =
    simpleQueryCalcGetFullyRaisedMatchesAsObj;

function simpleQueryCalcGetFullyRaisedMatchesAsObj()
{
    if(!this.lowerThanQueryPrefixFullMatches())
        return this.getMatchesAsObj();

    var allMatches = this.getMatches();
    
    var maxMatches = new Map();
    var dataElements = this.indexer.getDataElements();
    var prefixPathId = this.rootQueryCalc.prefixProjPathId;

    for(var i = 0, l = allMatches.length ; i < l ; ++i) {
        var elementId = allMatches[i];
        if(dataElements.getPathId(elementId) <= prefixPathId)
            maxMatches.set(elementId, 1);
    };
		
    return maxMatches;
}

// This function receives as input a list (array) of data element IDs
// and returns (in a new array) the subset of element IDs which are
// selection matches on this query calculation node (this function
// should probably never be called if this query calculation node
// is a projection).

SimpleQueryCalc.prototype.filterMatches = simpleQueryCalcFilterMatches;

function simpleQueryCalcFilterMatches(elementIds)
{
    if(this.matches !== undefined)
        return this.InternalQueryCalc_filterMatches(elementIds);
    
    var allMatches = this.getMatchesAsObj();
    var matches = [];
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(allMatches.has(elementId))
            matches.push(elementId);
    }

    return matches;
}

// This function receives as input a list (array) of data element IDs
// and returns an array with the positions in the input array of element IDs
// which are selection matches on this query calculation node (this function
// should probably never be called if this query calculation node
// is a projection).
// This function is similar to 'filterMatches()' except that instead
// of returning a subset of the original array, it returns an array
// containing the positions (in the original array) of the elements which
// are matches of this query.

SimpleQueryCalc.prototype.filterMatchPositions =
    simpleQueryCalcFilterMatchPositions;

function simpleQueryCalcFilterMatchPositions(elementIds)
{
    if(this.matches !== undefined)
        return this.InternalQueryCalc_filterMatchPositions(elementIds);
    
    var allMatches = this.getMatchesAsObj();
    var positions = [];
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(allMatches.has(elementId))
            positions.push(i);
    }

    return positions;
}

////////////////////////
// Projection Matches //
////////////////////////

// As a simple query calculation node always defines a selection, projection
// matches are only calculated if this is a generating selection-projection.

// This function is called by the dominating union query calculation 
// only when this node is a generating selection-projection node.
// The function is called with a list (array of element IDs) of projection
// matches just added to the union node projection matches for the result
// node with ID 'resultId'.
// This function compares these projection matches with the matches of
// this node. Those projection matches which are also matches on this
// node, are added to the projection matches (and forwarded to the result node)

SimpleQueryCalc.prototype.addProjMatches = simpleQueryCalcAddProjMatches;

function simpleQueryCalcAddProjMatches(projMatches, resultId)
{
    if(this.isSuspendedProjection())
        return; // suspended

    var newProjMatches = [];

    for(var i = 0, l = projMatches.length ; i < l ; ++i) {
        var elementId = projMatches[i];
        if(this.matches.has(elementId))
            newProjMatches.push(elementId);
    }

    // raise (if needed) add to this.projMatches and forward to result node
    this.addSelectionProjMatches(newProjMatches, resultId);
}

// This function is called only if this is a generating selection projection
// node. As input, it receives an array with a set of new selection
// matches added to the node. It then updates the projection matches 
// for each result node based on these new selection matches. First, it
// lets the match parent node filter the new selection matches with the
// parent node's projection matches. Next, a function of the base class
// is used to raise these projection matches (if needed) and update 
// the result node (the same function also updates the this.projMatches
// table of this query calculation node).

SimpleQueryCalc.prototype.addNewSelectionProjMatches = 
    simpleQueryCalcAddNewSelectionProjMatches;

function simpleQueryCalcAddNewSelectionProjMatches(matches)
{
    var _self = this;
    this.rootQueryCalc.getQueryResults().forEach(function(queryResult,
                                                          resultId) {
        var projMatches = 
            _self.matchParent.filterProjMatches(matches, resultId);
        
        _self.addSelectionProjMatches(projMatches, resultId);
    });
}

// This function is called by the dominating union query calculation 
// only when this node is a generating selection-projection node.
// The function is called with a list (array of element IDs) of projection
// matches just removed from the union node projection matches for the result
// node with ID 'resultId'.
// This function compares these projection matches with the matches of
// this node. Those projection matches which are selection matches on this
// node, are removed from the projection matches (and the removal is 
// forwarded to the result node)

SimpleQueryCalc.prototype.removeProjMatches = simpleQueryCalcRemoveProjMatches;

function simpleQueryCalcRemoveProjMatches(projMatches, resultId)
{
    if(this.isSuspendedProjection())
        return; // suspended
    
    var removedProjMatches = [];

    for(var i = 0, l = projMatches.length ; i < l ; ++i) {
        var elementId = projMatches[i];
        if(this.matches.has(elementId))
            removedProjMatches.push(elementId);
    }

    // raise (if needed), rmeove from this.projMatches and forward the removal
    // to the result node
    this.removeSelectionProjMatches(removedProjMatches, resultId);
}

// This function is called only if this is a generating selection projection
// node. As input, it receives an array with a set of selection
// matches just now removed from the node. It then updates the projection 
// matches for each result node based on these removed selection matches. 
// First, it lets the match parent node filter the removed selection matches 
// with the parent node's projection matches. Next, a function of the base 
// class is used to raise these projection matches (if needed) and update 
// the result node (the same function also updates the this.projMatches
// table of this query calculation node).

SimpleQueryCalc.prototype.removeOldSelectionProjMatches = 
    simpleQueryCalcRemoveOldSelectionProjMatches;

function simpleQueryCalcRemoveOldSelectionProjMatches(matches)
{
    var _self = this;
    this.rootQueryCalc.getQueryResults().forEach(function(queryResult,
                                                          resultId) {
        
        var projMatches = 
            _self.matchParent.filterProjMatches(matches, resultId);

        _self.removeSelectionProjMatches(projMatches, resultId);
    });
}
