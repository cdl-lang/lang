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


// This file implements a simple hash table for storing values under
// non-negative signed 32 bit integer keys (this means that while the
// keys stored are signed integers, one is only allowed to store
// non-negative values, because the negative values are reserved for
// internal purposes, that is, indicating where a value was removed).
// The basic class implement a 'hash set' which simply store a set
// of non-negative signed integers. Such a structure allows one to add
// or remove the integer keys, determine whether a key is in the set
// of keys and get the position of a key in the buffer. These position
// can then be used to store values under the keys (in a seperate array).
// Currently the hash set uses open adressing with linear probing.

//////////////////////
// Integer Hash Set //
//////////////////////

function Uint31HashSet(initialSize)
{
    // create fields, will be initialized by init()
    this.buffer = undefined;
    this.size = 0;
    this.maxFill = undefined;
    this.minFill = undefined;
    this.bufferSize = undefined;

    this.init(initialSize);
}

Uint31HashSet.loadFactor = 0.7;
Uint31HashSet.defaultInitialSize = 64;

// (re-)initialize 

Uint31HashSet.prototype.init = uint31HashSetInit;

function uint31HashSetInit(initialSize)
{
    if(!initialSize)
        initialSize = Uint31HashSet.defaultInitialSize;
    
    var arrayBuffer = new ArrayBuffer(4 * initialSize);
    this.buffer = new Int32Array(arrayBuffer);
    this.size = 0;
    this.maxFill = Math.floor(initialSize * Uint31HashSet.loadFactor);
    this.minFill = this.maxFill >> 2; // quarter of maximal fill
    this.bufferSize = initialSize;
}

// Clear the table and reset the buffer to the default initial size

Uint31HashSet.prototype.clear = uint31HashSetClear;

function uint31HashSetClear()
{
    this.init();
}

// Add the given value to the table.
// Returns the position in the buffer at which the value was added.

Uint31HashSet.prototype.set = uint31HashSetSet;

function uint31HashSetSet(value)
{
    value += 1; // 0 is reserved    

    if(this.size > this.maxFill)
        this.increaseSize();
    
    var firstSlot = value % this.bufferSize;
    var slot = firstSlot;
    var emptySlot = undefined;
    var slotValue;

    // loop along the array, starting at the slot until either an
    // equal value is reached or an empty bucket.
    
    while((slotValue = this.buffer[slot]) !== 0) {
        if(slotValue === value)
            return slot;
        if(slotValue < 0) {
            emptySlot = slot;
            if(-slotValue === value)
                break;
        }

        if(++slot === this.bufferSize)
            slot = 0;
        if(slot === firstSlot)
            break; // went the whole way around (only in small buffers)
    }

    // found empty bucket (and this is a new value)

    this.size++;
    if(emptySlot !== undefined) {
        this.buffer[emptySlot] = value;
        return emptySlot;
    } else {
        this.buffer[slot] = value;
        return slot;
    }
}

// return true if the value is in the table and false otherwise

Uint31HashSet.prototype.has = uint31HashSetHas;

function uint31HashSetHas(value)
{
    value += 1;
    
    var slotValue;
    var firstSlot = value % this.bufferSize;
    var slot = firstSlot;

    // loop over the buckets until the value is found or an empty slot is
    // reached

    while((slotValue = this.buffer[slot]) !== 0) {
        if(slotValue === value)
            return true;
        if(-slotValue === value)
            return false;
        if(++slot === this.bufferSize)
            slot = 0;
        if(slot === firstSlot)
            return false;
    }

    return false;
}

// return the position of the value in the table if it is in the table and
// undefined otherwise.

Uint31HashSet.prototype.getPos = uint31HashSetGetPos;

function uint31HashSetGetPos(value)
{
    value += 1;
    
    var slotValue;
    var firstSlot = value % this.bufferSize;
    var slot = firstSlot;

    // loop over the buckets until the value is found or an empty slot is
    // reached

    while((slotValue = this.buffer[slot]) !== 0) {
        if(slotValue === value)
            return slot;
        if(-slotValue === value)
            return undefined;
        if(++slot === this.bufferSize)
            slot = 0;
        if(slot === firstSlot)
            return undefined;
    }

    return undefined;
}

// remove the value from the hash table

Uint31HashSet.prototype.delete = uint31HashSetDelete;

function uint31HashSetDelete(value)
{
    value += 1;

    // if the size of the table is smaller than the minimal fill, shrink the
    // table
    if(this.size < this.minFill)
        this.decreaseSize();
    
    // first, find the value

    var slotValue;
    var firstSlot = value % this.bufferSize;
    var slot = firstSlot;

    // loop over the buckets until the value is found or an empty slot is
    // reached

    while((slotValue = this.buffer[slot]) !== 0) {
        if(slotValue === value) {
            // indicate that the slot is available for replacement.
            this.buffer[slot] = -slotValue;
            this.size--;
            return slot;
        }
        if(-slotValue === value)
            return undefined;
        
        if(++slot === this.bufferSize)
            slot = 0;
        if(slot === firstSlot)
            return undefined;
    }

    return undefined; // value not in table
}

// For internal use only! When the slot in which a key is stored is
// known, it can be deleted by this function directly, without having to
// searhc for it again.

Uint31HashSet.prototype.deleteAtPos = uint31HashSetDeleteAtPos;

function uint31HashSetDeleteAtPos(value, slot)
{
    value += 1;
    
    // indicate that the slot is available for replacement.
    this.buffer[slot] = -value;
    this.size--;

    // if the size of the table is smaller than the minimal fill, shrink the
    // table
    if(this.size < this.minFill)
        this.decreaseSize();
}

// 'func' is called with every key stored in this set, as the second argument.
// The first argument is always undefined.

Uint31HashSet.prototype.forEach = uint31HashSetForEach;

function uint31HashSetForEach(func)
{
    if(this.size === 0)
        return;

    // to make sure the buffer is not decreased during the loop
    this.suspendMinFill();
    
    // store before looping, to protect against resizing
    var buffer = this.buffer;
    var bufferSize = this.bufferSize;
    var i;
    
    for(i = 0 ; i < bufferSize ; ++i) {
        var value = buffer[i];
        if(value > 0)
            func(undefined, value - 1);
        if(buffer !== this.buffer)
            break; // was resized
    }

    if(i < bufferSize) {
        // quit loop prematurely because of a resize of the buffer.
        // The values in the original buffer are no longer the set values,
        // but their slot numbers (+1) in the new (resized) buffer.
        var resizedBuffer = this.buffer;
        // continue the loop
        for(++i ; i < bufferSize ; ++i) {
            var pos = buffer[i] - 1;
            if(pos < 0)
                continue; // empty position
            var value = resizedBuffer[pos];
            if(value > 0)
                func(undefined, value - 1);
            if(resizedBuffer !== this.buffer) {
                // resized again, update the positions
                for(var j = i+1 ; j < bufferSize ; ++j) {
                    pos = buffer[j] - 1;
                    if(pos < 0)
                        continue;
                    buffer[j] = resizedBuffer[pos];
                }
                resizedBuffer = this.buffer;
            }
        }
    }
    
    // reset the min fill (possibly decreasing the size of the buffer) 
    this.resetMinFill();
}

// push the values in the set at the end of the given buffer.

Uint31HashSet.prototype.pushTo = uint31HashSetPushTo;

function uint31HashSetPushTo(buffer)
{
    var numPushed = 0;

    for(var i = 0 ; numPushed < this.size ; ++i) {
        var value = this.buffer[i];
        if(value > 0) {
            buffer.push(value-1);
            numPushed++;
        }
    }
}

// Return a (duplicate) array of all IDs stored in the object.

Uint31HashSet.prototype.getList = uint31HashSetGetList;

function uint31HashSetGetList()
{
    var buffer = new Array(this.size);

    var numPushed = 0;

    for(var i = 0 ; numPushed < this.size ; ++i) {
        var value = this.buffer[i];
        if(value > 0) {
            buffer[numPushed] = value-1;
            numPushed++;
        }
    }
    
    return buffer;
}

// Increase the size of the buffer, if needed, to accomodate at least the given
// number of elements. This number is the total number which has
// to be accomodated, including both existing elements and new elements
// which will be added.

Uint31HashSet.prototype.expectSize = uint31HashSetExpectSize;

function uint31HashSetExpectSize(expectedSize)
{
    if(this.maxFill >= expectedSize)
        return; // no need to increase the size of the buffer

    // we want to increase the size of the buffer to at least twice
    // its current size (and possibly more, if needed).
    if(this.bufferSize * 2 * Uint31HashSet.loadFactor >= expectedSize)
        this.bufferSize *= 2;
    else
        this.bufferSize = Math.ceil(expectedSize / Uint31HashSet.loadFactor);

    this.resize();
}

// Sets the minFill to zero, so that the size of the buffer is not decreased
// as a result of removals (this can later be undone by calling resetMinFill()).

Uint31HashSet.prototype.suspendMinFill = uint31HashSetSuspendMinFill;

function uint31HashSetSuspendMinFill()
{
    this.minFill = 0;
}

// Resets the value of the minFill (quarter of the max fill) and
// decreases the size of the buffer, if needed.
// (this is typically used after minFill has be suspended by setting it
// to zero).

Uint31HashSet.prototype.resetMinFill = uint31HashSetResetMinFill;

function uint31HashSetResetMinFill()
{
    // reset the minimal fill and resize if needed
    this.minFill = this.maxFill >> 2;
    if(this.size < this.minFill)
        this.decreaseSize();
}

// double the size of the hash table and redistribute the values

Uint31HashSet.prototype.increaseSize = uint31HashSetIncreaseSize;

function uint31HashSetIncreaseSize()
{
    this.bufferSize *= 2;
    this.resize();
}

// decrease the size of the hash table and redistribute the values

Uint31HashSet.prototype.decreaseSize = uint31HashSetDecreaseSize;

function uint31HashSetDecreaseSize()
{
    if(this.bufferSize < 16)
        return; // don't make any smaller

    var minFill = this.minFill;

    while(this.size < minFill) {
        this.bufferSize = this.bufferSize >> 1;
        if(this.bufferSize < 16)
            break;
        minFill = minFill >> 1;
    }
    
    this.resize();
}

// Resize the buffer and copy the entries to their new place. When this
// function is called, this.bufferSize should already be set to the
// desired new size, but apart from that everything should still be in
// its state before the size change.

Uint31HashSet.prototype.resize = uint31HashSetResize;

function uint31HashSetResize()
{
    var prevBuffer = this.buffer;
    this.maxFill = Math.floor(this.bufferSize * Uint31HashSet.loadFactor);
    this.minFill = this.maxFill >> 2; // quarter of maximal fill

    var arrayBuffer = new ArrayBuffer(4 * this.bufferSize);
    this.buffer = new Int32Array(arrayBuffer);

    var numToCopy = this.size;
    this.size = 0;
    
    for(var i = 0, l = prevBuffer.length ; i < l ; ++i) {
        var value = prevBuffer[i];
        if(value <= 0)
            continue;

        // insert the value into the new buffer
        
        var slot = value % this.bufferSize;
        var slotValue;

        // loop along the array, starting at the slot until either an
        // equal value is reached or an empty bucket.
    
        while((slotValue = this.buffer[slot]) !== 0) {
            if(++slot === this.bufferSize)
                slot = 0;
        }

        // found empty bucket

        this.size++;
        this.buffer[slot] = value;
        prevBuffer[i] = slot+1; // to make sure it is not zero

        if(numToCopy === this.size)
            break; // all values copied to the new buffer
    }
}

//////////////
// Hash Map //
//////////////

// This objects implements a hash table with an interface equivalent to
// that of a standard Map() object. Only 31 bit unsigned integers may be
// used here as keys (or, in other words, only non-negative signed 32 bit
// integers).

function IntHashMap(initialSize)
{
    this.hashSet = new Uint31HashSet(initialSize);
    this.values = this.makeValueArray();
    this.hashSetBuffer = this.hashSet.buffer;
    this.size = 0;
}

// Clear the table

IntHashMap.prototype.clear = intHashMapClear;

function intHashMapClear()
{
    this.hashSet.clear();
    this.values = this.makeValueArray();
    this.hashSetBuffer = this.hashSet.buffer;
    this.size = 0;
}

// create the value array with the same size as the hash set array

IntHashMap.prototype.makeValueArray = intHashMapMakeValueArray;

function intHashMapMakeValueArray()
{
    return new Array(this.hashSet.bufferSize);
}

// Set the given value under the given key

IntHashMap.prototype.set = intHashMapSet;

function intHashMapSet(key, value)
{
    // set the key in the hash set
    var pos = this.hashSet.set(key);

    if(this.hashSetBuffer !== this.hashSet.buffer)
        this.resize();

    this.values[pos] = value;
    this.size = this.hashSet.size; // perhaps increased by 1
}

// Check whether the key is in the hash

IntHashMap.prototype.has = intHashMapHas;

function intHashMapHas(key)
{
    return this.hashSet.has(key);
}

// get the value stored under the given key.

IntHashMap.prototype.get = intHashMapGet;

function intHashMapGet(key)
{
    var pos = this.hashSet.getPos(key);

    if(pos === undefined)
        return undefined;

    return this.values[pos];
}

// This function returns the position of the given key in the hash array.
// If the key is not found, undefined is returned.

IntHashMap.prototype.getPos = intHashMapGetPos;

function intHashMapGetPos(key)
{
    return this.hashSet.getPos(key);
}

IntHashMap.prototype.delete = intHashMapDelete;

function intHashMapDelete(key)
{
    // remove from hash set (returns position at which found)
    var pos = this.hashSet.delete(key);

    if(this.hashSetBuffer !== this.hashSet.buffer)
        this.resize();
    
    if(pos === undefined)
        return;

    this.values[pos] = 0; // delete value
    this.size--;
}

// 'func' is called with every (value, key) pair stored in this table, with
// the value as the first argument and the key as the second argument.

IntHashMap.prototype.forEach = intHashMapForEach;

function intHashMapForEach(func)
{
    if(this.size === 0)
        return;

    // to make sure the buffer is not decreased during the loop
    this.suspendMinFill();
    
    // store before looping, to protect against resizing
    var bufferSize = this.hashSet.bufferSize;
    var buffer = this.hashSet.buffer;
    
    for(var i = 0 ; i < bufferSize ; ++i) {
        var key = buffer[i];
        if(key > 0)
            func(this.values[i], key - 1);
        if(buffer !== this.hashSet.buffer)
            break; // was resized
    }

    if(i < bufferSize) {
        // quit loop prematurely because of a resize of the buffer.
        // The values in the original buffer are no longer the key values,
        // but their slot numbers (+1) in the new (resized) buffer.
        var resizedBuffer = this.hashSet.buffer;
        
        // continue the loop
        for(++i ; i < bufferSize ; ++i) {
            var pos = buffer[i] - 1;
            if(pos < 0)
                continue; // empty position
            var key = resizedBuffer[pos];
            if(key > 0)
                func(this.values[pos], key - 1);
            if(resizedBuffer !== this.hashSet.buffer) {
                // resized again, update the positions
                for(var j = i+1 ; j < bufferSize ; ++j) {
                    pos = buffer[j] - 1;
                    if(pos < 0)
                        continue;
                    buffer[j] = resizedBuffer[pos];
                }
                resizedBuffer = this.hashSet.buffer;
            }
        }
    }
        
    // reset the minimal fill and resize if needed
    this.resetMinFill();
}

// Sets the minFill to zero, so that the size of the buffer is not decreased
// as a result of removals (this can later be undone by calling resetMinFill()).

IntHashMap.prototype.suspendMinFill = intHashMapSuspendMinFill;

function intHashMapSuspendMinFill()
{
    this.hashSet.suspendMinFill();
}

// Resets the value of the minFill (quarter of the max fill) and
// decreases the size of the buffer, if needed.
// (this is typically used after minFill has be suspended by setting it
// to zero).

IntHashMap.prototype.resetMinFill = intHashMapResetMinFill;

function intHashMapResetMinFill()
{
    // reset the minimal fill and resize if needed
    this.hashSet.resetMinFill();
    if(this.hashSetBuffer !== this.hashSet.buffer)
        // hash set buffer was resized, so need to resize the value buffer 
        this.resize();
}

// Increase the size of the buffer, if needed, to accomodate at least the given
// number of elements. This number is the total number which has
// to be accomodated, including both existing elements and new elements
// which will be added.

IntHashMap.prototype.expectSize = intHashMapExpectSize;

function intHashMapExpectSize(expectedSize)
{
    this.hashSet.expectSize(expectedSize);
    if(this.hashSetBuffer !== this.hashSet.buffer)
        // hash set buffer was resized, so need to resize the value buffer 
        this.resize();
}

// Called when the hash set buffer is resized (either increased of decreased)

IntHashMap.prototype.resize = intHashMapResize;

function intHashMapResize()
{
    if(this.hashSetBuffer === this.hashSet.buffer)
        return; // no need to resize

    // resize took place and the new positions (+1) of the keys are in
    // the previous hash set buffer, move the values
    
    var prevValues = this.values;
    this.values = this.makeValueArray();
    
    var numToCopy = this.size;
    var numCopied = 0;
    
    for(var i = 0, l = this.hashSetBuffer.length ; i < l ; ++i) {

        var pos = this.hashSetBuffer[i] - 1;
        if(pos < 0)
            continue; // empty position in array
        
        this.values[pos] = prevValues[i];
        if(++numCopied === numToCopy)
            break;
    }
    
    this.hashSetBuffer = this.hashSet.buffer;
}

/////////////////////////////////
// Hash Map for Integer Values //
/////////////////////////////////

//
// Same as IntHashMap except that the values stored are restricted to
// be unsigned integers of a certain number of bytes (1,2 or 4). In case
// of 4 bytes (32 bits) the integers are signed (since JS will convert them
// anyway to signed integers).
//

// maxValue is the maximal value (integer) which needs to be stored in the
// table. This determines how many bytes of storage are allocated for
// each value stored (1, 2, or 4 bytes). An undefined 'maxValue' will
// create the maximal size (4 bytes). 


inherit(IntHashMapUint, IntHashMap);

function IntHashMapUint(maxValue, initialSize)
{
    this.nBytes = this.getByteNumForMaxValue(maxValue);
    this.IntHashMap(initialSize);
}

// create the value array with the same size as the hash set array

IntHashMapUint.prototype.makeValueArray = intHashMapUintMakeValueArray;

function intHashMapUintMakeValueArray()
{
    var arrayBuffer = new ArrayBuffer(this.nBytes * this.hashSet.bufferSize);
    
    if(this.nBytes == 1)
        return new Uint8Array(arrayBuffer);

    if(this.nBytes == 2)
        return new Uint16Array(arrayBuffer);
    
    return new Int32Array(arrayBuffer);
}

// Given a maximal integer which need to be stored in the table, this
// function calculates the number fo bytes needed to store it (1,2 or 4).

IntHashMapUint.prototype.getByteNumForMaxValue =
    intHashMapUintGetByteNumForMaxValue;

function intHashMapUintGetByteNumForMaxValue(maxValue)
{
    if(maxValue === undefined)
        return 4;
    
    if(maxValue < (1 << 8))
        return 1;

    if(maxValue < (1 << 16))
        return 2;

    return 4;
}

// Given the maximal value that needs to be stored in the hash table,
// this function adjusts the storage to support this number of bytes.
// If the number of bytes needed differs from the number of bytes
// actually used, this function will allocate a new storage array and
// copy all existing values into that array. If the flag 'increaseOnly'
// is set to true, this function will increase the number of storage
// bytes if the maximal value does not fit into the current number
// of bytes assigned but will will change nothing if the new maximal value
// can fit into a smaller number of bytes than currently used. 

IntHashMapUint.prototype.adjustByteNumber = intHashMapUintAdjustByteNumber;

function intHashMapUintAdjustByteNumber(maxValue, increaseOnly)
{
    var nBytes = this.getByteNumForMaxValue(maxValue);

    if(this.nBytes === nBytes)
        return;

    if(increaseOnly && this.nBytes > nBytes)
        return;

    var newBuffer = this.makeValueArray();

    // copy the values
    
    for(var i = 0, l = this.values.length ; i < l ; ++i)
        newBuffer[i] = this.values[i];

    this.values = newBuffer;
}

// Increase the value stored under the given key by the given amount
// (which must be a non-zero positive integer). If the key is not yet in
// the table, an entry is created and the value is set to the given
// value (as if the original value was zero). The function returns
// the resulting value.

IntHashMapUint.prototype.inc = intHashMapUintInc;

function intHashMapUintInc(key, count)
{
    // set the key in the hash set (whether it exists already or not)
    var pos = this.hashSet.set(key);

    if(this.hashSetBuffer !== this.hashSet.buffer)
        this.resize();

    this.size = this.hashSet.size; // perhaps increased by 1
    
    return (this.values[pos] += count);
}

// Decrease the value stored under the given key by the given amount
// (which must be a non-zero positive integer). The function returns the
// resulting value. If the value returned in negative, the actual value
// stored in the table becomes zero. If the flag 'dontDeleteZero' is *not*
// set and the value dropped to zero (or to a negative number) the entry for the
// key is deleted. Otherwise (if 'dontDeleteZero' is set) the value is set
// to zero.
// If no entry exists for the given key, no entry is created and undefined
// is returned.

IntHashMapUint.prototype.dec = intHashMapUintDec;

function intHashMapUintDec(key, count, dontDeleteZero)
{
    // set the key in the hash set (whether it exists already or not)
    var pos = this.hashSet.getPos(key);

    if(pos === undefined)
        return undefined;
    
    if(this.hashSetBuffer !== this.hashSet.buffer)
        this.resize();
    
    var value = (this.values[pos] -= count);

    if(value > 0)
        return value;

    if(value < 0)
        this.values[pos] = 0;
    
    if(!dontDeleteZero) {
        this.hashSet.deleteAtPos(key, pos);
        if(this.hashSetBuffer !== this.hashSet.buffer)
            // hash set buffer was resized, so need to resize the value buffer 
            this.resize();
    }

    this.size = this.hashSet.size; // may have changed above
    
    return value; // may be negative
}

///////////////////
// Hash Pair Map //
///////////////////

inherit(IntHashPairMap, IntHashMap);

// This object is similar to the IntHashMap object except that it allows
// a pair of values to be stored under each integer key. The values
// are stored in two value arrays (similar to the single value array
// of the IntHashMap). The first array is the 'values' array, which is
// identical to the one used in IntHashMap. In this way, all the standard
// functions (which add/get a single value) continue to apply here (the
// other value is, by default undefined or 0, depending on the type chosen
// for the second value).

function IntHashPairMap(initialSize)
{
    this.hashSet = new Uint31HashSet(initialSize);
    this.values = this.makeValueArray();
    this.values2 = this.makeSecondValueArray();
    this.hashSetBuffer = this.hashSet.buffer;
    this.size = 0;
}

// Clear the table

IntHashPairMap.prototype.clear = intHashPairMapClear;

function intHashPairMapClear()
{
    this.IntHashMap_clear();
    this.values2 = this.makeSecondValueArray();
}

// create the value array with the same size as the hash set array

IntHashPairMap.prototype.makeValueArray = intHashPairMapMakeValueArray;

function intHashPairMapMakeValueArray()
{
    return new Array(this.hashSet.bufferSize);
}

// create the value array with the same size as the hash set array

IntHashPairMap.prototype.makeSecondValueArray =
    intHashPairMapMakeSecondValueArray;

function intHashPairMapMakeSecondValueArray()
{
    return new Array(this.hashSet.bufferSize);
}

// The function 'set()' inherited from the base class can be used to
// set the first value without changing the second value. This function
// is used to set the second argument without changing the first argument.

IntHashPairMap.prototype.setSecond = intHashPairMapSetSecond;

function intHashPairMapSetSecond(key, value2)
{
    // set the key in the hash set
    var pos = this.hashSet.set(key);

    if(this.hashSetBuffer !== this.hashSet.buffer)
        this.resize();

    this.values2[pos] = value2;
    this.size = this.hashSet.size; // perhaps increased by 1
}

// Set the given pair of values under the given key

IntHashPairMap.prototype.setPair = intHashPairMapSetPair;

function intHashPairMapSetPair(key, value, value2)
{
    // set the key in the hash set
    var pos = this.hashSet.set(key);

    if(this.hashSetBuffer !== this.hashSet.buffer)
        this.resize();

    this.values[pos] = value;
    this.values2[pos] = value2;
    this.size = this.hashSet.size; // perhaps increased by 1
}

// The standard 'get()' function returns the first value (this is directly
// inherited from the base class). This function returns the second value.

IntHashPairMap.prototype.getSecond = intHashPairMapGetSecond;

function intHashPairMapGetSecond(key)
{
    var pos = this.hashSet.getPos(key);

    if(pos === undefined)
        return undefined;

    return this.values2[pos];
}

// The standard 'get()' function returns the first value (this is directly
// inherited from the base class). 'getSecond()' returns the second
// value. This function returns an array with both values (first value is
// first in the returned array).

IntHashPairMap.prototype.getPair = intHashPairMapGetPair;

function intHashPairMapGetPair(key)
{
    var pos = this.hashSet.getPos(key);

    if(pos === undefined)
        return undefined;

    return [this.values[pos],this.values2[pos]];
}

IntHashPairMap.prototype.delete = intHashPairMapDelete;

function intHashPairMapDelete(key)
{
    // remove from hash set (returns position at which found)
    var pos = this.hashSet.delete(key);

    if(this.hashSetBuffer !== this.hashSet.buffer)
        this.resize();
    
    if(pos === undefined)
        return;

    this.values[pos] = 0; // delete value
    this.values2[pos] = 0; // delete value
    this.size--;
}

// The forEach() function (inherited from the base class) implements a
// forEach loop which iterates over the keys and the first values.
// This function iterates over the keys and the pairs of values. 
// 'func' is called with every (value, value2, key) tuple stored in this
// table, where 'value' (the first argument) is the first value,
// 'value2' (the second argument) is he second value and 'key'
// (the third argument) is the key.

IntHashPairMap.prototype.forEachPair = intHashPairMapForEachPair;

function intHashPairMapForEachPair(func)
{
    if(this.size === 0)
        return;

    // to make sure the buffer is not decreased during the loop
    this.suspendMinFill();

    // store before looping, to protect against resizing
    var bufferSize = this.hashSet.bufferSize;
    var buffer = this.hashSet.buffer;
    
    for(var i = 0 ; i < bufferSize ; ++i) {
        var key = buffer[i];
        if(key > 0)
            func(this.values[i], this.values2[i], key - 1);
        if(buffer !== this.hashSet.buffer)
            break; // was resized
    }

    if(i < bufferSize) {
        // quit loop prematurely because of a resize of the buffer.
        // The values in the original buffer are no longer the key values,
        // but their slot numbers (+1) in the new (resized) buffer.
        var resizedBuffer = this.hashSet.buffer;
        
        // continue the loop
        for(++i ; i < bufferSize ; ++i) {
            var pos = buffer[i] - 1;
            if(pos < 0)
                continue; // empty position
            var key = resizedBuffer[pos];
            if(key > 0)
                func(this.values[pos], this.values2[pos], key - 1);
            if(resizedBuffer !== this.hashSet.buffer) {
                // resized again, update the positions
                for(var j = i+1 ; j < bufferSize ; ++j) {
                    pos = buffer[j] - 1;
                    if(pos < 0)
                        continue;
                    buffer[j] = resizedBuffer[pos];
                }
                resizedBuffer = this.hashSet.buffer;
            }
        }
    }
    
    // reset the minimal fill and resize if needed
    this.resetMinFill();
}

// Called when the hash set buffer is resized (either increased of decreased)

IntHashPairMap.prototype.resize = intHashPairMapResize;

function intHashPairMapResize()
{
    if(this.hashSetBuffer === this.hashSet.buffer)
        return; // no need to resize

    // resize took place and the new positions (+1) of the keys are in
    // the previous hash set buffer, move the values
    
    var prevValues = this.values;
    var prevValues2 = this.values2;
    this.values = this.makeValueArray();
    this.values2 = this.makeSecondValueArray();
    
    var numToCopy = this.size;
    var numCopied = 0;
    
    for(var i = 0, l = this.hashSetBuffer.length ; i < l ; ++i) {

        var pos = this.hashSetBuffer[i] - 1;
        if(pos < 0)
            continue; // empty position in array
        
        this.values[pos] = prevValues[i];
        this.values2[pos] = prevValues2[i];
        if(++numCopied === numToCopy)
            break;
    }
    
    this.hashSetBuffer = this.hashSet.buffer;
}

///////////////////////////////
// Hash (*,integer) Pair Map //
///////////////////////////////

//
// Same as IntHashPairMap except that the first value stored is restricted to
// be an unsigned integer of a certain number of bytes (1,2 or 4). In case
// of 4 bytes (32 bits) the integers are signed (since JS will convert them
// anyway to signed integers).
//
// The class has the IntHashPairMap class as its base class. However, it
// also makes use of some of the functions defined for IntHashMapUint to
// support the integer first argument functionality.

// maxValue is the maximal value (integer) which needs to be stored in the
// first value. This determines how many bytes of storage are allocated for
// storing the second value (1, 2, or 4 bytes).

inherit(IntHashPairMapUint, IntHashPairMap);

function IntHashPairMapUint(maxValue, initialSize)
{
    this.nBytes = this.getByteNumForMaxValue(maxValue);
    this.IntHashPairMap(initialSize);
}

// inherit from IntHashMapUint

IntHashPairMapUint.prototype.makeValueArray =
    IntHashMapUint.prototype.makeValueArray;

// inherit from IntHashMapUint

IntHashPairMapUint.prototype.getByteNumForMaxValue =
    IntHashMapUint.prototype.getByteNumForMaxValue;

// inherit from IntHashMapUint

IntHashPairMapUint.prototype.adjustByteNumber =
    IntHashMapUint.prototype.adjustByteNumber;

// inherit from IntHashMapUint

IntHashPairMapUint.prototype.inc = IntHashMapUint.prototype.inc;

// inherit from IntHashMapUint

IntHashPairMapUint.prototype.dec = IntHashMapUint.prototype.dec;

// Increment the count in the first value for the given key by 'count'
// and return the second value stored for this key (may be undefined if
// the entry is new). If no value is yet stored here for the key the default
// value (0) is returned.
 
IntHashPairMapUint.prototype.incAndGetSecond =
    intHashPairMapUintIncAndGetSecond;
 
function intHashPairMapUintIncAndGetSecond(key, count)
{
    // set the key in the hash set
    var pos = this.hashSet.set(key);

    if(this.hashSetBuffer !== this.hashSet.buffer)
        this.resize();
    
    this.size = this.hashSet.size; // perhaps increased by 1

    this.values[pos] += count;
    
    return this.values2[pos];
}

// This function is identical to 'dec()' in that it decreases the count
// (in the first value) of the given key by 'count'. The new count is
// set in exactly the same way and if the count dropped to zero and
// 'dontDeleteZero' is false, the entry is deleted. This function returns,
// however, the second value stored under this key. If 'returnOnlyIfZero'
// is set, the value is returned only if the count dropped as a result of
// this operation to zero (or lower). If the count did not drop to zero
// and 'returnOnlyIfZero' is set, undefined is returned. If 'returnOnlyIfZero'
// is not set, the second value for this key is always returned.
// If 'key' is not in the table, no entry is created for it and undefined
// is returned.
 
IntHashPairMapUint.prototype.decAndGetSecond =
    intHashPairMapUintDecAndGetSecond;
 
function intHashPairMapUintDecAndGetSecond(key, count, dontDeleteZero,
                                           returnOnlyIfZero)
{
    // set the key in the hash set (whether it exists already or not)
    var pos = this.hashSet.getPos(key);

    if(pos === undefined)
        return undefined;
    
    if(this.hashSetBuffer !== this.hashSet.buffer)
        this.resize();

    var value = (this.values[pos] -= count);

    if(value > 0)
        return returnOnlyIfZero ? undefined : this.values2[pos];
    
    if(value < 0)
        this.values[pos] = 0;

    var value2 = this.values2[pos]; // before possibly deleting below
    
    if(!dontDeleteZero) {
        this.values2[pos] = 0;
        this.hashSet.deleteAtPos(key, pos);
        if(this.hashSetBuffer !== this.hashSet.buffer)
            // hash set buffer was resized, so need to resize the value buffer 
            this.resize();
        this.size = this.hashSet.size; // may have changed above
        return value2;
    }

    this.size = this.hashSet.size; // may have changed above
    
    return value2;
}

// Return the second value for the given key iff its count is zero.

IntHashPairMapUint.prototype.getSecondIfZeroCount =
    intHashPairMapUintGetSecondIfZeroCount;
 
function intHashPairMapUintGetSecondIfZeroCount(key, deleteIfZeroCount)
{
    var pos = this.hashSet.getPos(key);

    if(pos === undefined)
        return undefined;

    if(this.values[pos] !== 0)
        return undefined; // count is not zero

    var value2 = this.values2[pos];

    if(deleteIfZeroCount) {
        this.values[pos] = 0; // delete value
        this.values2[pos] = 0; // delete value
    
        this.hashSet.deleteAtPos(key, pos);
        if(this.hashSetBuffer !== this.hashSet.buffer)
            // hash set buffer was resized, so need to resize the value buffer 
            this.resize();

        this.size = this.hashSet.size; // may have changed above
    }

    return value2;
}


