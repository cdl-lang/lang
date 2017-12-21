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


// This object is used for storing range keys in the indexer. Keys are 
// simple values (numbers, strings or booleans) identified by an identifier.
// Each key is added or removed for a given identifier. Multiple keys
// may have the same value, but not the same identifier.
// When a key is added or modified, one needs to provide, in addition to
// the identifier and the key value also the key type (a string).
// The RangeKey maintains a single type as the type of the range key.
// It counts how many of the keys currently stored are of that type
// and how many are of another type. When the number of keys of the type
// assigned to the range key drops to zero, the object determines another
// type to be the type of the range key and then calculates how many 
// keys are of that type. As long as not all keys are of the same type,
// the range key is not active and only stores the keys, their types, 
// the type chosen for the whole range key and the count of how many keys 
// belong to that type and how many don't.
//
// When all keys of the range key have the same type, the range key is
// active and maintains a min-max heap which allows it to determine
// the minimal and maximal key value stored in the heap. The elements
// stored in the min-max heap are RangeKeyValue object, which are simply
// objects of the form { id: <key ID>, key: <key value> }. The heap is 
// sorted using standard number or string ordering, depending on the
// type of the keys (since sorting is only performed when all keys are
// of the same type, they are all numbers or all strings).
//
// Not all types can be ordered (e.g. "attributeValue"). If the type 
// of the range is a type that can't be ordered, the range is also 
// inactive. However, to keep the implementation simple, even when the
// type of the range cannot be ordered, a heap is created to store the values
// if all values are of the same type. Since the keys of the nodes can still
// be compared (even if this comparison is meaningless) this does not 
// cause any problems except for a little extra work. Under the assumption
// that ranges of non-orderable values are rare, this does not matter.
//
// The range being created can be specified as open/closed at its min/max
// point. This is a property which is independent of the key values in the
// range an must be set separately. The default is a range closed on
// both side.
//
// Interface
// =========
//
// add(<type string>, <ID>, <key value>) 
//   Use add(<type string>, <ID>, <key value>) to add a key to the
//   range. <ID> identifies the key (adding a key with the same ID as
//   an existing key will replace that key). <type string> is the name
//   of the type of the key. This is a string (such as "number",
//   "weight" or "string").  If not all keys in the range have the
//   same key type, the range becomes inactive (one cannot get the
//   minimal and maximal keys).
// remove(<ID>)
//   This function removes the key with the given ID.
// setMinOpen(true|false)
//   If the argument is true, this sets the range to be open at its minimal
//   value and if the argument is false sets it to be closed at its minimal
//   value.
// setMaxOpen(true|false)
//   If the argument is true, this sets the range to be open at its maximal
//   value and if the argument is false sets it to be closed at its maximal
//   value.
// isActive()
//   This function return true if the range key is active (all keys are of the
//   same type and the type can be ordered) and false otherwise.
// getMinKey()
//   Returns the minimal key in the range. This returns undefined if the
//   range is empty or inactive.
// getMaxKey()
//   Returns the maximal key in the range. This returns undefined if the
//   range is empty or inactive.
// getMinOpen()
///  Returns true if the range is open at its minimal value and false if
//   it is closed.
// getMaxOpen()
///  Returns true if the range is open at its maximal value and false if
//   it is closed.
//
// Object Structure
// ================
//
// {
//     minOpen: true|false
//     maxOpen: true|false
//     type: <type chosen for range>,
//     nonRangeType: true|false,
//     typeCount: <number of keys with the same type as the range>,
//     otherTypeCount: <number of keys with another type>
//
//     keyList: {
//        <key ID>: <position in heap and/or in arrays below>,
//        .......
//     },
//     keys: <array of RangeKeyValue objects, may point to this.heap>,
//     types: <array of key types (only when 'otherTypeCount' is not zero)>,
// }
//
// minOpen: true if the range is open at its minimal value and false if
//   it is closed.
// maxOpen: true if the range is open at its maximal value and false if
//   it is closed.
// type: this field holds a string defining the type of this range key.
//    This has to be the type of at least one of the keys stored in the
//    range key (if no keys are stored in the range key, this type is
//    undefined).
// nonRangeType: this is set to true if the current type of the range 
//    is a type which cannot be ordered and therefore no convex hull can
//    be defined.
// typeCount: the number of keys which have the same type as 'type'.
//    When this drops to zero, the object tries to find a new type
//    to assign to the range key, based on the types of the existing
//    keys (in this case, these types will be stored in the array 'types').
// otherTypeCount: this is the number of keys stored in the range key 
//    which have a type different from that in 'type'. When this is 
//    not zero, the 'types' array is used to store the type of each key
//    and the heap is not used. When this is zero, the 'types' array is
//    destroyed and the heap is used.
// keyList: this is an object whose attributes are the IDs identifying
//    the keys and the value under each attribute is the position
//    of the key value and type corresponding to this key ID in the 
//    'keys' arry and the 'types' array (if exists).
// keys: this is an array holding the IDs and values of the keys. Each
//    element in this array is a RangeKeyValue object of the form
//    { id: <key ID>, key: <key value> }. When all keys
//    are of the same type, this points to 'this.heap' (the array 
//    used by the base class MinMaxHeap). The position of each key in 
//    this array is stored in 'keyList' (under the ID of the key).
//    The first position (position 0) in the array is always empty
//    (undefined). This is the way it is when the heap is used and, for 
//    consistency, we also keep it this way when the heap is not used.
// types: this is an array of types (strings). Each position holds
//    the type of the key in the corresponding position in the 'keys' array.
//    This is only used when keys of different types are stored in the
//    range key object.

// %%include%%: "../utils/minMaxHeap.js"

inherit(RangeKey, MinMaxHeap);

function RangeKey(minOpen, maxOpen)
{
    this.MinMaxHeap(this.comparator);

    this.minOpen = !!minOpen;
    this.maxOpen = !!maxOpen;
    
    this.typeCount = 0;
    this.otherTypeCount = 0;

    this.keyList = {};    
    this.keys = this.heap; // the heap structure of MinMaxHeap
}

// comparison functions required by the base class MinMaxHeap.
RangeKey.prototype.comparator = function(a,b) { 
    if(a.key < b.key)
        return -1;
    return (a.key == b.key) ? 0 : 1;
}

// return true if the given type cannot be ordered and therefore does
// not support range creation.

RangeKey.prototype.isNonRangeType = rangeKeyIsNonRangeType;

function rangeKeyIsNonRangeType(type)
{
    return (type == "attributeValue" || type == "defun" || 
            type == "functionApplication" || type == "variableIndex" ||
            type == "builtInFunction" || type == "negation" ||
            type == "areaReference" || type == "pointerReference");
}

//////////////////////////
// Add/Remove Functions //
//////////////////////////

// This function adds a single key to the range. The type, key ID and 
// key value are given as argument. If the type of this key is different
// from that of the range, and the node was active, this may deactivate
// the node. If the type of this key is the same as that of the range 
// and the node was inactive, this may activate the node in case the
// previous type of the key was the last which was not equal to the type
// of the range or if this was the last which had the type of the range
// and all other nodes have the same type as the new type of the node.

RangeKey.prototype.add = rangeKeyAdd;

function rangeKeyAdd(type, keyId, keyVal)
{
    var pos;

    if(this.otherTypeCount == 0) {
        // active node
        if(!this.typeCount) {
            this.type = type;
            this.nonRangeType = this.isNonRangeType(type);
            
        }
        if(type == this.type) {
            if(this.keyList[keyId])
                this.remove(keyId);
            
            this.typeCount++;
            
            this.MinMaxHeap_add(new RangeKeyValue(keyId, keyVal));            
        } else { // deactivate the range node and add the key

            // clear the heap, this creates a new array for the heap, so 
            // 'keys' gets to keep the original array.
            this.clear();
            this.types = [undefined];
            for(var i = 1 ; i < this.keys.length ; ++i)
                this.types.push(this.type);
            this.otherTypeCount = 1;
            if(pos = this.keyList[keyId]) {
                this.typeCount--;
                this.types[pos] = type;
                this.keys[pos].key = keyVal;
            } else {
                this.keyList[keyId] = this.keys.length;
                this.types.push(type);
                this.keys.push(new RangeKeyValue(keyId, keyVal));
            }
        }
    } else { // inactive node, may be activated
        if(type == this.type)
            this.typeCount++;
        else
            this.otherTypeCount++;
        if(pos = this.keyList[keyId]) {
            this.keys[pos].key = keyVal;
            if(this.type == this.types[pos])
                this.typeCount--;
            else 
                this.otherTypeCount--;
            this.types[pos] = type;
            if(!this.typeCount) // assign a new type if needed
                this.setType();
            if(!this.otherTypeCount) // activate the range key
                this.activate();
        } else {
            this.keyList[keyId] = this.keys.length;
            this.keys.push(new RangeKeyValue(keyId, keyVal));
            this.types.push(type);
        }
    }
}

// Given another RangeKey object, this function copies the keys of
// that range key to this range key (including their IDs).

RangeKey.prototype.addFromRangeKey = rangeKeyAddFromRangeKey;
    
function rangeKeyAddFromRangeKey(rangeKey)
{
    var type;
    if((type = rangeKey.getType()) !== undefined) { // single type
        for(var i = 1, l = rangeKey.keys.length ; i < l ; ++i)
            this.add(type, rangeKey.keys[i].id, rangeKey.keys[i].key);
    } else {
        for(var i = 1, l = rangeKey.keys.length ; i < l ; ++i)
            this.add(rangeKey.types[i], rangeKey.keys[i].id, 
                     rangeKey.keys[i].key);
    }
}

// This function removes the key with the given key ID from the range key 
// node.

RangeKey.prototype.remove = rangeKeyRemove;

function rangeKeyRemove(keyId)
{
    var pos;

    if((pos = this.keyList[keyId]) === undefined)
        return;

    if(!this.otherTypeCount) {
        this.removePos(pos);
        this.typeCount--;
    } else {
        // different types or non-range type, no heap used
        delete this.keyList[keyId];
        if(this.types[pos] == this.type)
            this.typeCount--;
        else
            this.otherTypeCount--;

        var last;
        // move last key to the position just vacated
        if(pos != (last = this.keys.length-1)) {
            this.keys[pos] = this.keys[last];
            this.types[pos] = this.types[last];
        }
        this.keys.pop();
        this.types.pop();
        
        // assign a new type if needed
        this.setType();

        if(!this.otherTypeCount)
            this.activate();
    }
}

// Given another RangeKey object, this function removes the keys of
// that range key from this range key (based on their IDs).
// This operation depends only on the IDs of the keys stored in 'rangeKey'
// and not on their type of key value.

RangeKey.prototype.removeByRangeKey = rangeKeyRemoveByRangeKey;
    
function rangeKeyRemoveByRangeKey(rangeKey)
{
    for(var i = 1, l = rangeKey.keys.length ; i < l ; ++i)
        this.remove(rangeKey.keys[i].id);
}

/////////////////
// Open/Closed //
/////////////////

// If the argument is true, this sets the range to be open at its minimal
// value and if the argument is false sets it to be closed at its minimal
// value.

RangeKey.prototype.setMinOpen = rangeKeySetMinOpen;

function rangeKeySetMinOpen(isOpen)
{
    this.minOpen = !!isOpen;
}

// If the argument is true, this sets the range to be open at its maximal
// value and if the argument is false sets it to be closed at its maximal
// value.

RangeKey.prototype.setMaxOpen = rangeKeySetMaxOpen;

function rangeKeySetMaxOpen(isOpen)
{
    this.maxOpen = !!isOpen;
}

// Returns true if the range is open at its minimal value and false if
// it is closed.

RangeKey.prototype.getMinOpen = rangeKeyGetMinOpen;

function rangeKeyGetMinOpen()
{
    return this.minOpen;
}

// Returns true if the range is open at its maximal value and false if
// it is closed.

RangeKey.prototype.getMaxOpen = rangeKeyGetMaxOpen;

function rangeKeyGetMaxOpen()
{
    return this.maxOpen;
}

////////////////
// Activation //
////////////////

// This sets a new type for the range key when the number of 
// keys which has the type of the range key drops to zero and there
// are keys with other types. The function sets the type of the first
// key in the list as the type of the range key and then counts
// how many of the other keys have the same type and how many have
// a different type. This does not activate the node if the number
// of other types drops to zero as a result of this operation.

RangeKey.prototype.setType = rangeKeySetType;

function rangeKeySetType()
{
    if(this.typeCount || !this.otherTypeCount)
        return; // can keep the current type

    this.type = this.types[1];
    this.nonRangeType = this.isNonRangeType(this.type);
    this.typeCount = 1;
    this.otherTypeCount = 0;
    for(var i = 2 ; i < this.types.length ; ++i) {
        if(this.types[i] == this.type)
            this.typeCount++;
        else
            this.otherTypeCount++;
    }
}

// This function activates the heap so that the minimum and the
// maximum can be calculated. It is assumed that the range is
// currently inactive.  This means that the keys are stored in the
// this.keys array, which is not the same array as this.heap and that
// this.heap is empty.
// It is assumed that the type of the range has already been set (and
// all keys must be of that type).

RangeKey.prototype.activate = rangeKeyActivate;

function rangeKeyActivate()
{
    delete this.types;
    for(var i = 1, l = this.keys.length ; i < l ; ++i)
        this.MinMaxHeap_add(this.keys[i]);
    this.keys = this.heap;
}

// This function returns true if this range key is active: iff all keys
// are of the same type and this type is a range type (can be ordered). 
// An empty range is always active.

RangeKey.prototype.isActive = rangeKeyIsActive;

function rangeKeyIsActive()
{
    return !this.otherTypeCount && (!this.nonRangeType || !this.typeCount);
}

//////////////////////////
// Access to Properties //
//////////////////////////

// This function returns the smallest key in the range. If the range is
// empty or not active (contains keys of different types) this function
// returns 'undefined'.

RangeKey.prototype.getMinKey = rangeKeyGetMinKey;

function rangeKeyGetMinKey()
{
    if(!this.isActive())
        return undefined; // not active
    
    if(!this.typeCount)
        return undefined; // no keys

    return this.getMin().key;
}

// This function returns the largest key in the range. If the range is
// empty or not active (contains keys of different types) this function
// returns 'undefined'.

RangeKey.prototype.getMaxKey = rangeKeyGetMaxKey;

function rangeKeyGetMaxKey()
{
    if(!this.isActive())
        return undefined; // not active
    
    if(!this.typeCount)
        return undefined; // no keys

    return this.getMax().key;
}

// If this is an active node and has some keys stored in it, this function
// returns the minimum and maximum of this node. If the minimum and 
// maximum are equal, this returns a single element. Otherwise, this
// function returns an array with two values: the first is the minimum
// and the second is the maximum.
// If the range key is not acive or there are no keys stored in it,
// undefined is returned.

RangeKey.prototype.getMinMax = rangeKeyGetMinMax;

function rangeKeyGetMinMax()
{
    if(!this.isActive() || this.isEmpty())
        return undefined;

    var min = this.getMinKey();
    var max = this.getMaxKey();

    return (min == max) ? min : [min, max];
}

// Returns true if there are no keys stored in the range key and false
// otherwise.

RangeKey.prototype.isEmpty = rangeKeyIsEmpty;

function rangeKeyIsEmpty()
{
    return this.keys.length === 1;
}

// This function returns the this.keys array, which holds all the key
// entries (RangeKeyValue objects of the form { id: <id>, val: <key value> }).
// This allows an external function to loop over all key IDs or key values.
// Note that the first entry in the array is not used (so one should start
// looping on the array from position 1).

RangeKey.prototype.getEntries = rangeKeyGetEntries;

function rangeKeyGetEntries()
{
    return this.keys;
}

// This function should only be used when the range is inactive. This 
// then returns the 'types' array of the range object (which holds
// the type of the corresponding node in the 'keys' array).
// Note that, just as in the 'keys' array, the first entry in the array 
// is not used (so one should start looping on the array from position 1).

RangeKey.prototype.getTypes = rangeKeyGetTypes;

function rangeKeyGetTypes()
{
    return this.types;
}

// If this range key is active and not empty, returns the type of the range 
// key (the common type of its keys). Otherwise, returned "range".

RangeKey.prototype.getType = rangeKeyGetType;

function rangeKeyGetType()
{
    return (this.otherTypeCount || !this.typeCount) ? "range" : this.type;
}

// This function generates the array which is used use to update an
// indexer with the keys in this range key. The array has either the
// form [<ID 1>, <key value 1>, ...., <ID n>, <key value n>]
// or [<ID 1>, ...., <ID n>] depending on whether
// the flag is 'idsOnly' is set (second format) or not (first format).
// The IDs and (if needed) the key values are those found in the entries
// of this.keys.

RangeKey.prototype.getKeyUpdate = rangeKeyGetKeyUpdate;

function rangeKeyGetKeyUpdate(idsOnly)
{
    var keyUpdate = [];

    if(idsOnly) {
        for(var i = 1, l = this.keys.length ; i < l ; ++i)
            keyUpdate.push(this.keys[i].id);
    } else {
        for(var i = 1, l = this.keys.length ; i < l ; ++i)
            keyUpdate.push(this.keys[i].id, this.keys[i].key);
    }
}

/////////////////////
// Copy Operations //
/////////////////////

// This function returns a ConstRangeKey object which is a copy
// of the basic properties of this node.

RangeKey.prototype.simpleCopy = rangeKeySimpleCopy;

function rangeKeySimpleCopy()
{
    return new ConstRangeKey(this); 
}

//////////////////////////
// MinMaxHeap Functions //
//////////////////////////

// This following MinMaxHeap functions need to be implemented by this
// (derived) class to allow the position of the keys to be tracked
// (in this.keyList) as they are moved around in the heap.

// This function is called by the min-max heap base class to swap the
// position of two elements in the heap. In addition to swapping them
// in the heap structure, this also updates their position in the keyList
// table. 

RangeKey.prototype.swap = rangeKeySwap;

function rangeKeySwap(n1, n2)
{
    this.keyList[this.heap[n1].id] = n2;
    this.keyList[this.heap[n2].id] = n1;
    var tmp = this.heap[n1];
    this.heap[n1] = this.heap[n2];
    this.heap[n2] = tmp;
}

// This assigns the given value ('val') which is a RangeKeyValue object
// the position 'pos' in the heap. In addition to inserting the value
// at that position in the heap, this also updates the 'keyList' table.
// If there is already a value at the given position, its entry in the
// keyList table is removed.

RangeKey.prototype.assignPos = rangeKeyAssignPos;

function rangeKeyAssignPos(pos, val)
{
    var prevValue;
    if(prevValue = this.heap[pos])
        delete this.keyList[prevValue.id];

    this.keyList[val.id] = pos;
    this.heap[pos] = val;
}

// This pops the last element in the heap, also removing it from the
// keyList table.

RangeKey.prototype.popLastPos = rangeKeyPopLastPos;

function rangeKeyPopLastPos()
{
    var val = this.heap.pop();
    delete this.keyList[val.id];
    return val;
}

/////////////////////////////////////
// Comparison Functions for Ranges //
/////////////////////////////////////

// 'range' is another RangeKey or ConstRangeKey object. This function
// returns true if the two ranges intersect and false if not.
// To intersect, both must be active, non-empty, of the same type
// and their ranges must overlap.

RangeKey.prototype.intersectsWith = rangeKeyIntersectsWith;

function rangeKeyIntersectsWith(range)
{
    if(this.isEmpty() || range.isEmpty() || !this.isActive() ||
       !range.isActive() || this.getType() != range.getType())
        return false;

    var thisMin = this.getMinKey();
    var rangeMax = range.getMaxKey();

    if(rangeMax == thisMin)
        return !this.minOpen && !range.getMaxOpen();
    else if(rangeMax < thisMin)
        return false;
    
    var thisMax = this.getMaxKey();
    var rangeMin = range.getMinKey();

    if(thisMax == rangeMin)
        return !range.getMinOpen() && !this.maxOpen;
    else if(thisMax < rangeMin)
        return false;

    return true;
}

// Returns true if the given type and key is a value within the range of
// this range object.

RangeKey.prototype.valueInRange = rangeKeyValueInRange;

function rangeKeyValueInRange(type, key)
{
    if(this.isEmpty() || !this.isActive() || this.getType() != type)
        return false;

    var min = this.getMinKey();
    var max = this.getMaxKey();

    if(key < min || (key == min && this.minOpen))
        return false;

    if(key > max || (key == max && this.maxOpen))
        return false;

    return true;
}

///////////////////
// RangeKeyValue //
///////////////////

// This is the object used to store the keys of the range. It is a 
// key ID + key value pair.

function RangeKeyValue(keyId, keyValue)
{
    this.id = keyId;
    this.key = keyValue;
}

////////////////////////
// Constant Range Key //
////////////////////////

// This class provides a range key object which has the same interface
// for reading the range properties as RangeKey but has a constant value
// (determined upon construction). The object can be constructed based
// on a RangeKey or another ConstRangeKey object (in which case its
// functions return the same values as those that would have been returned
// by the same functions on the original object) or it can be initialized
// by explicitly specifying its range in the arguments of the constructor.

// Constructor

// If rangeKey is not undefined, it should be a RangeKey or ConstRangeKey
// object. This object is then initialized as a constant copy of the given
// object. If 'rangeKey' is undefined, the object is initialized based
// on the remaining argument of the constructor. If all these arguments
// are undefined, this constructs an empty (active) range. Otherwise, it
// is assumed that these describe a valid, non-empty, range. This means that
// 'minKey' <=  'maxKey' and if they are equal, both 'minOpen' and 'maxOpen'
// are false.

function ConstRangeKey(rangeKey, type, minKey, maxKey, minOpen, maxOpen)
{
    if(rangeKey) {
        this.active = rangeKey.isActive();
        this.type = rangeKey.type;
        this.empty = rangeKey.isEmpty();
        this.minKey = rangeKey.getMinKey(); 
        this.maxKey = rangeKey.getMaxKey();
        this.minOpen = rangeKey.getMinOpen();
        this.maxOpen = rangeKey.getMaxOpen();
    } else if(type === undefined) {
        this.empty = true;
        this.active = true;
    } else {
        // by assumption, this is a valid, non-empty key 
        this.active = true;
        this.type = type;
        this.empty = false;
        this.minKey = minKey;
        this.maxKey = maxKey;
        this.minOpen = minOpen;
        this.maxOpen = maxOpen;
    }
}

// Returns true if the original range key was active (all keys of same type)
// and false otherwise.

ConstRangeKey.prototype.isActive = constRangeKeyIsActive;

function constRangeKeyIsActive()
{
    return this.active;
}

// Returns true if no keys were stored in the range key and false otherwise.

ConstRangeKey.prototype.isEmpty = constRangeKeyIsEmpty;

function constRangeKeyIsEmpty()
{
    return this.empty;
}

// Returns the minimal key value (may be undefined if the original range
// key was not active or had no keys stored in it).

ConstRangeKey.prototype.getMinKey = constRangeKeyGetMinKey;

function constRangeKeyGetMinKey()
{
    return this.minKey;
}

// Returns the maximal key value (may be undefined if the original range
// key was not active or had no keys stored in it).

ConstRangeKey.prototype.getMaxKey = constRangeKeyGetMaxKey;

function constRangeKeyGetMaxKey()
{
    return this.maxKey;
}

// Returns true if the range is open at its minimal value and false if
// it is closed.

ConstRangeKey.prototype.getMinOpen = constRangeKeyGetMinOpen;

function constRangeKeyGetMinOpen()
{
    return this.minOpen;
}

// Returns true if the range is open at its maximal value and false if
// it is closed.

ConstRangeKey.prototype.getMaxOpen = constRangeKeyGetMaxOpen;

function constRangeKeyGetMaxOpen()
{
    return this.maxOpen;
}

// Returns the type of the range key (may be undefined if the original range
// key was not active or had no keys stored in it).

ConstRangeKey.prototype.getType = constRangeKeyGetType;

function constRangeKeyGetType()
{
    return this.type;
}

// Since this is a constant object, it can safely return itself as a copy.

ConstRangeKey.prototype.simpleCopy = constRangeKeySimpleCopy;

function constRangeKeySimpleCopy()
{
    return this;
}

// 'range' is another RangeKey or ConstRangeKey object. This function
// returns true if the two ranges intersect and false if not.
// To intersect, both must be active, non-empty, of the same type
// and their ranges must overlap.

ConstRangeKey.prototype.intersectsWith = constRangeKeyIntersectsWith;

function constRangeKeyIntersectsWith(range)
{
    if(this.isEmpty() || range.isEmpty() || !this.isActive() ||
       !range.isActive() || this.type != range.getType())
        return false;

    var thisMin = this.minKey;
    var rangeMax = range.getMaxKey();

    if(rangeMax == thisMin)
        return !this.minOpen && !range.getMaxOpen();
    else if(rangeMax < thisMin)
        return false;
    
    var thisMax = this.maxKey;
    var rangeMin = range.getMinKey();

    if(thisMax == rangeMin)
        return !range.getMinOpen() && !this.maxOpen;
    else if(thisMax < rangeMin)
        return false;

    return true;
}

// Returns true if the given type and key is a value within the range of
// this range object.

ConstRangeKey.prototype.valueInRange = constRangeKeyValueInRange;

function constRangeKeyValueInRange(type, key)
{
    if(this.isEmpty() || !this.isActive() || this.type != type)
        return false;

    var min = this.minKey;
    var max = this.maxKey;

    if(key < min || (key == min && this.minOpen))
        return false;

    if(key > max || (key == max && this.maxOpen))
        return false;

    return true;
}
