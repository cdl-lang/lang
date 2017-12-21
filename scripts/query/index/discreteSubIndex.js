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


// This file implements the DiscreteSubIndex class which supports the
// lookup of elements by exact key match, where the key is a string.
// Each DiscreteSubIndex should be used for a single type of values
// (e.g. "string" or "elementReference").
//
// The values stored in the sub-index are IDs. Each ID is stored under
// a single key (of the type defined for the sub-index). When storing
// the same ID again, the key under which it is stored changes.
//
// A lookup is also specified by an ID and a single value of the type
// stored in the discrete sub-index. When the same lookup ID is used
// again, the new lookup value replaces the old lookup value.
//
// The sub-index provides incremental match information. When a value
// is added to the sub-index, the sub-index returns an array with
// the IDs of all lookups which match this value. If the value replaces 
// another value with the same ID, the sub-index also returns an array
// with the IDs of all lookups which matched the previous value.
//
// Similarly, when a lookup is added, the sub-index returns an array with
// the IDs of all values matched by the lookup. When this lookup value
// replaces a previous lookup value, the sub-index also returns an array
// of the IDs of all values which were matched by the previous lookup 
// value.
//
// Sub-Index Constructor
// ---------------------
//
// The discrete sub-index constructor takes not arguments. The type
// which is stored in the sub-index is not recorded inside the sub-index,
// as the sub-index is only interested in the string values of this type.
// It is the responsibility fo the calling function to make sure that
// all values stored are of the same type. 
//
// Updating Values and Lookups
// ---------------------------
//
// The main operation performed on the sub-index is the addition or 
// removal of values and lookups. An addition operation (of a value or
// lookup) needs to specify the ID which is being added and the value
// (string) assigned to it (either as its key or as its lookup value). 
// The sub-index remembers which values were added for each ID, so when
// a new value is added for an existing ID, this is interpreted as
// an update operation, removing the previous value and adding the new
// value. Similarly, when a value or lookup ID needs to be completely
// removed, it is enough to specify the ID, as the rest of the information
// is stored in the sub-index.
// 
// The following four functions provide the basic interface to the sub-index.
// This interface is identical to the linear sub-index interface except
// that only a single key value needs to be provided (instead of an interval
// with two keys).
//
// DiscreteSubIndex.addValue(<ID>, <key>, <previous key>)
// DiscreteSubIndex.removeValue(<ID>, <key>)
// DiscreteSubIndex.addLookup(<ID>, <key>, <previous key>)
// DiscreteSubIndex.removeLookup(<ID>, <key>)
// DiscreteSubIndex.getMatches(<ID>, <key>)
// 
// The <key> argument is the string which is associated with the value 
// or lookup ID. <previous key> is the previous key assigned to the same ID
// (in case such a key was already registered here under that ID).
// The previous key needs to be provided here (and the key must be provided
// when removing a value) because the object does not store the
// values indexed by their ID (it is assumed the calling module does that).
//
// The addValue and addLookup return an object of the following form:
//
// {
//     added: <array of IDs>,
//     removed: <array of IDs>
// }
//
// If the function is addValue(), the arrays of IDs contain lookup IDs.
// The 'added' array holds the IDs of lookups which match the new value
// added but did not match the previous value (if any). The array
// 'removed' holds the IDs of lookups which matched the previous value
// but do no longer match the new value. If no previous value existed,
// this list is empty.
//
// If the function is addLookup(), the arrays of IDs contain value IDs.
// The 'added' array holds the IDs of values which are matched by the new 
// lookup value added but were not matched by the previous lookup value 
// (if any). The array 'removed' holds the IDs of values which were matched 
// by the previous lookup value but are no longer matched by the new 
// lookup value. If no previous lookup value existed, this list is empty.
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
//
// Additional Interface
// --------------------
//
// Several additional functions are available in the sub-index interface:
//
// DiscreteSubIndex.hasRangeValues(): return always false (this index cannot
//    store non-degenerate range values)
// DiscreteSubIndex.supportsIntervals(): returns always false for this sub-index
//    (other sub-indexes may return true).
// DiscreteSubIndex.hasNoLookups(): this function returns true if there are
//    no lookups registered to the sub-index and false otherwise.
// DiscreteSubIndex.clearValues(): this function can be used to remove all
//    values (but not lookups) registered to the index (this is far more
//    efficient than removing them one by one). 
//
// Implementation
// --------------
//
// The structure of the sub-index object is as follows:
//
// {
//     values: <Map object>: {
//        <value>: <Map object>: {
//           <ID>: true,
//           ......
//        }
//        .....
//     },
//     lookups: <Map object>: {
//        <value>: <Map object>: {
//           <ID>: true,
//           ......
//        }
//        .....
//     }
// }
//
// The 'values' table stores the values and the 'lookups' table stores
// the lookups. Each of these table stores the pairs (<value>, <ID>) 
// indexed by value.

//
// Constructor
//

function DiscreteSubIndex()
{
    this.values = new Map();
    this.lookups = new Map();
}

// This is a generic implementation of the common functionality of 
// addValue() and addLookup(). The only difference between addValue()
// and addLookup() is that addValue() adds the value to the this.values
// table and returns lists of lookup IDs (from this.lookups) for which the 
// match with this value changed, while addLookup() reverses the roles 
// of this.values and this.lookups: the ID is added to this.lookups 
// and the lists of IDs returned are IDs of values in this.values for
// which the match with the lookup changed.
// This function therefore does not access the this.values and this.lookups
// half sub-indexes directly, but receives them as arguments. 'values' is the 
// half sub-index to which the value should be added and 'lookups'
// is the half sub-index for which the change in matching is returned
// and from which the returned IDs are taken.

DiscreteSubIndex.prototype.addToHalfSubIndex = 
    discreteSubIndexAddToHalfSubIndex;

function discreteSubIndexAddToHalfSubIndex(id, key, prevKey, values, lookups)
{
    if(prevKey === key)
        return {}; // nothing changed
    
    if(prevKey !== undefined) { // replacing an existing key for this ID

        // remove the old key from the values table
        var keyEntry = values.get(prevKey);
        keyEntry.delete(id);
        if(keyEntry.size == 0)
            values.delete(prevKey);
    }

    // insert the new key
    var newByValue;
    if(!values.has(key)) {
        newByValue = new Map();
        values.set(key, newByValue);
    } else
        newByValue = values.get(key); 

    newByValue.set(id, true); 
    
    // return the lists of removed matches and new matches

    if(lookups.size == 0)
        return {}; // no lookups

    var added;
    if(lookups.has(key)) {
        added = [];
        lookups.get(key).forEach(function(t, id) {
            added.push(id);
        });
    }
    var removed;

    if(prevKey !== undefined && lookups.has(prevKey)) {
        removed = [];
        lookups.get(prevKey).forEach(function(t, id) {
            removed.push(id);
        });
    }
    
    return {
        added: added,
        removed: removed
    };
}

// See the description of this function in the introduction above.

DiscreteSubIndex.prototype.addValue = discreteSubIndexAddValue;

function discreteSubIndexAddValue(id, key, prevKey)
{
    return this.addToHalfSubIndex(id, key, prevKey, this.values, this.lookups);
}

// See the description of this function in the introduction above.

DiscreteSubIndex.prototype.addLookup = discreteSubIndexAddLookup;

function discreteSubIndexAddLookup(id, key, prevKey)
{
    return this.addToHalfSubIndex(id, key, prevKey, this.lookups, this.values);
}

// This is a generic implementation of the common functionality of 
// removeValue() and removeLookup(). The only difference between removeValue()
// and removeLookup() is that removeValue() removes the ID from this.values
// and returns lists of lookup IDs (from this.lookups) which matched the
// value of this ID, while removeLookup() reverses the roles 
// of this.values and this.lookups: the ID is removed from this.lookups 
// and the list of IDs returned is that of IDs of values in this.values
// which were matched by the removed lookup ID.
// This function therefore does not access the this.values and this.lookups
// half sub-indexes directly, but receives them as arguments. 'values' is the 
// half sub-index from which the value should be removed and 'lookups'
// is the half sub-index for which the list of matches is returned.
// The function return an array of ID from the 'lookups' half sub-index,
// which are the IDs in that half index which have the same key as 
// the ID just removed.

DiscreteSubIndex.prototype.removeFromHalfSubIndex = 
    discreteSubIndexRemoveFromHalfSubIndex;

function discreteSubIndexRemoveFromHalfSubIndex(id, key, values, lookups)
{
    // remove the ID from the values table
    var keyEntry = values.get(key);
    keyEntry.delete(id);
    if(keyEntry.size == 0)
        delete values.delete(key);
    
    // return the list of removed matches
    if(lookups.size == 0)
        return []; // no lookups

    if(!lookups.has(key))
        return [];
    
    var lookupIds = [];
    lookups.get(key).forEach(function(t, id) {
        lookupIds.push(id);
    });

    return lookupIds;
}

// See the description of this function in the introduction above.

DiscreteSubIndex.prototype.removeValue = discreteSubIndexRemoveValue;

function discreteSubIndexRemoveValue(id, key)
{
    return this.removeFromHalfSubIndex(id, key, this.values, this.lookups);
}

// See the description of this function in the introduction above.

DiscreteSubIndex.prototype.clearValues = discreteSubIndexClearValues;

function discreteSubIndexClearValues()
{
    this.values = new Map();
}

// See the description of this function in the introduction above.

DiscreteSubIndex.prototype.removeLookup = discreteSubIndexRemoveLookup;

function discreteSubIndexRemoveLookup(id, key)
{
    return this.removeFromHalfSubIndex(id, key, this.lookups, this.values);
}

// This function is used to get the list of values matched by a given
// lookup which is already registered. This does not change the
// registration of the lookup. This may be used by a module which did
// not keep track of the incremental updates received when the lookup
// was originally registered and later when values were added and
// removed.  This function receives a single lookup ID and the lookup key
// as input and returns an array of value IDs as output.

DiscreteSubIndex.prototype.getMatches = discreteSubIndexGetMatches;

function discreteSubIndexGetMatches(id, key)
{
    // find the lookup value for this query ID
    
    if(key === undefined)
        return [];

    if(!this.values.has(key))
        return [];

    var matches = [];
    
    this.values.get(key).forEach(function(t,id) {
        matches.push(id);
    });

    return matches;
}

// return false, because this sub-index does not support (non-degenerate) 
// intervals.

DiscreteSubIndex.prototype.supportsIntervals = 
    discreteSubIndexSupportsIntervals;

function discreteSubIndexSupportsIntervals()
{
    return false;
}

// This function indicates whether any of the values stored in this sub-index
// is a (non-degenerate) range value. Since no range values can be stored
// here, this function always returns false.

DiscreteSubIndex.prototype.hasRangeValues = discreteSubIndexHasRangeValues;

function discreteSubIndexHasRangeValues()
{
    return false;
}

// return the number of lookups stored in this sub-index.

DiscreteSubIndex.prototype.hasNoLookups = discreteSubIndexHasNoLookups;

function discreteSubIndexHasNoLookups()
{
    return (this.lookups.size == 0);
}

//
// Interface for exporting all values in the sub-index
//

// This function returns the table of all values, indexed by key

DiscreteSubIndex.prototype.getAllValues = discreteSubIndexGetAllValues;

function discreteSubIndexGetAllValues()
{
    return this.values;
}

// This function returns the table of all lookups, indexed by lookup key

DiscreteSubIndex.prototype.getAllLookups = discreteSubIndexGetAllLookups;

function discreteSubIndexGetAllLookups()
{
    return this.lookups;
}
