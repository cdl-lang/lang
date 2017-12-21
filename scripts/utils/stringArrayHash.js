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

"use strict";

//
// StringArrayHash is a hash whose keys are string arrays.
// Entries for ["x"] and ["x", "y"] can safely co-exist.
// When removing an entry from the hash a 'null' wildcard can be used in
//  place of any of the entries in the string array. There is no wild-card for
//  the string-array length, though.
// The empty array [] is also a legitimate key in this hash (the only key of
//  length 0).
// 
// The public methods are:
//  StringArrayHash.destroy()
//  prevValue = StringArrayHash.add(strArray, value)
//  prevValueList = StringArrayHash.remove(strArray)
//  value = StringArrayHash.get(strArray)
//  StringArrayHash.iterator(thisArg, func, arg)
//
// The implementation creates a distinct sub-hash for each array-length in
//  use in an instance, then uses standard nested JS objects for each position
//  in the array. Empty hashes are deleted.
//
function StringArrayHash()
{
    this.byLen = [];
}

// --------------------------------------------------------------------------
// destroy
//
StringArrayHash.prototype.destroy = stringArrayHashDestroy;
function stringArrayHashDestroy()
{
    delete this.byLen;
}

// --------------------------------------------------------------------------
// add
//
StringArrayHash.prototype.add = stringArrayHashAdd;
function stringArrayHashAdd(strArray, value)
{
    if (! isArray(strArray)) {
        strArray = [ strArray ];
    }

    return this.getEntry(strArray, value);
}


// --------------------------------------------------------------------------
// remove
// 
// as 'strArray' may contain 'null' wildcards, the return value is either
// 'undefined' or a list of the removed entries.
//
StringArrayHash.prototype.remove = stringArrayHashRemove;
function stringArrayHashRemove(strArray)
{
    var len;
    var removedEntryList;
    if (isArray(strArray)) {
        len = strArray.length;
    } else {
        strArray = [ strArray ];
        len = 1;
    }

    if(len === 0) {
        if(this.byLen[0] === undefined)
            return undefined;
        removedEntryList = [this.byLen[0]];
        delete this.byLen[0];
        return removedEntryList;
    }
    
    var hash = this.byLen[len];
    if (! hash) {
        return undefined;
    }

    removedEntryList = [];
    var maybeDelete = this.rRemove(hash, strArray[0], strArray, 0,
                                   removedEntryList);
    if (maybeDelete) {
        if (isEmptyObj(this.byLen[len])) {
            delete this.byLen[len];
        }
    }

    if (removedEntryList.length === 0) {
        return undefined;
    }
    return removedEntryList;
}

// --------------------------------------------------------------------------
// rRemove
// 
// the recursive part of 'remove'.
// The return value is a hint from the nested recursive call - if it knows
//  for sure that our hash is not empty, it saves a call to 'isEmptyObj'
//
StringArrayHash.prototype.rRemove = stringArrayHashRRemove;
function stringArrayHashRRemove(hash, curStr, strArray, idx, removedEntryList)
{
    var maybeDelete = true;

    if (curStr === null) {
        for (var str in hash) {
            var elMBD = this.rRemove(hash, str, strArray, idx,
                                     removedEntryList);
            maybeDelete = maybeDelete && elMBD;
        }
    } else {
        var nextHash = hash[curStr];
        if (nextHash !== undefined) {
            if (idx === strArray.length - 1) {
                removedEntryList.push(nextHash);
                delete hash[curStr];
                return true;
            } else {
                maybeDelete = this.rRemove(nextHash, strArray[idx + 1], 
                                           strArray, idx + 1, removedEntryList);
                if (maybeDelete) {
                    if (isEmptyObj(nextHash)) {
                        delete hash[curStr];
                    } else {
                        maybeDelete = false;
                    }
                }
            }
        }
    }
    return maybeDelete;
}

// --------------------------------------------------------------------------
// get
//
StringArrayHash.prototype.get = stringArrayHashGet;
function stringArrayHashGet(strArray)
{
    if (! isArray(strArray)) {
        strArray = [ strArray ];
    }
    return this.getEntry(strArray);
}

// --------------------------------------------------------------------------
// getEntry
// 
// a private method, serving 'get' and 'add'
//
StringArrayHash.prototype.getEntry = stringArrayHashGetEntry;
function stringArrayHashGetEntry(strArray, newValue)
{
    var len = strArray.length;
    var prevValue;

    if(len === 0) { // the length 0 case is a little special (and simple)
        if(newValue === undefined)
            return this.byLen[len];
        prevValue = this.byLen[len];
        this.byLen[len] = newValue;
        return prevValue;
    }
    
    var hash = this.byLen[len];
    if (! hash) {
        if (newValue !== undefined) {
            hash = this.byLen[len] = {};
        } else {
            return undefined;
        }
    }

    for (var i = 0; i < len - 1; i++) {
        var nextHash = hash[strArray[i]];
        if (nextHash) {
            hash = nextHash;
        } else {
            if (newValue !== undefined) {
                hash = hash[strArray[i]] = {};
            } else {
                return undefined;
            }
        }
    }

    prevValue = hash[strArray[len - 1]];
    if (newValue !== undefined) {
        hash[strArray[len - 1]] = newValue;
    }
    return prevValue;
}

//---------------------------------------------------------------------------
// iterator
//
// This function iterates over all string arrays stored in the hash and
// applies the given function to each of them. The 'thisArg' should be
// the 'this' pointer which should be used when calling the function.
// For every string array stored in the hash, the given 'func' is then
// called as follows:
//   func.call(thisArg, <string array>, <value stored under string array>,
//             arg).
// where 'arg' is the (optional) argument given to the 'iterator' function.
// Note: the string array passed as argument to 'func' is reused throughout
// the recursion. If 'func' needs to store or modify the string array, it
// should create a copy of it.

StringArrayHash.prototype.iterator = stringArrayHashIterator;

function stringArrayHashIterator(thisArg, func, arg)
{
    if(!func)
        return;
    
    for(var len in this.byLen) {

        // length 0 is a special (and simple) case
        if(Number(len) === 0)
            func.call(thisArg, [], this.byLen[0], arg);
        else
            this.iteratorRecursion(thisArg, func, arg, len, [],
                                   this.byLen[len]);
    }
}

// This is a private function which should only be called by the 'iterator'
// function. It implements the recursion of the iterator.
// The arguments to this function are exactly the same as those for 'iterator'
// (and with the same menaing) with the addition of 'remainingLen',
// 'prefix' and 'prefixObj', which hold the current position of the iterator.
// At each call to 'iteratorRecursion', the iterator is positioned at some
// point inside the tree coding the string arrays of a certain length.
// 'prefix' is the array of strings describing the path to this point inside
// this tree (this is the prefix of all string arrays which will be iteratored
// over by this call to 'iteratorRecursion'). 'prefixObj' is the pointer
// to the current position in the tree. 'remainingLen' is the remaining
// length of the string arrays being iterated over. For example, if the
// iterator is iterating over strings of length 6 and 'prefix' has a length
// of 4, then the remaining length is 2.

StringArrayHash.prototype.iteratorRecursion =
    stringArrayHashIteratorRecursion;

function stringArrayHashIteratorRecursion(thisArg, func, arg, remainingLen,
                                          prefix, prefixObj)
{
    for(var str in prefixObj) {

        prefix.push(str);

        if(remainingLen == 1)
            func.call(thisArg, prefix, prefixObj[str], arg);
        else
            this.iteratorRecursion(thisArg, func, arg, remainingLen-1,
                                   prefix, prefixObj[str]);

        prefix.pop();
    }
}
