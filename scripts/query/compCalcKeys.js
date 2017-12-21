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


// This file implements the CompCalcKeys class and its derived classes
// which are an auxiliary class for the management of sort key lists.

//////////////////
// CompCalcKeys //
//////////////////

// This object may be used to store the comparison keys for the
// partition comparison function. If there is a hierarchy of keys
// (e.g. first compare by membership in a partition set and then by
// the projected value), the keys for each level in the hierarchy are
// stored in a separate CompCalcKeys object.
//
// The CompCalcKeys object stores the keys in an intHashMap based on their
// element ID.
//
// As explained in the introduction, data element IDs are assigned in such a
// way that a comparison function assigns only a single key to every
// data element ID, regardless of any projections, result indexers, etc.
// which took place between the comparison function and the ordering
// function which uses it.
//
// Only simple keys (number, string, boolean) may be stored here.
// For range objects, it is the responsibility of the object which
// stores the key to decide whether to use the minimal value in the range,
// the maximal value in the range or some other value. Complex values
// (such as a-v objects) should not be added as keys. 
//

// Object Structure
// ----------------

// {
//    defaultKey: <atomic value>
//    useMinKey: true|false
//    keys: <IntHashMap of keys>
//    altKeys: <IntHashMap of unsorted arrays>
// }
//
// defaultKey: this is an optional default key to be assigned to elements
//     which have no key explicitly asigned to them. If the object fails
//     to find a key for a given element ID (that is, the key is undefined)
//     the default key is returned.
// useMinKey: determines whether, when multiple keys are available, to take
//     the minimal or maximal key. If this property is true, the minimal
//     key is used (this is also the default) and otherwise the maximal
//     key is used.
// keys: this is an IntHashMap which stores the keys (atomic values such as
//     number, string, boolean or undefined) for each data element ID.
// altKeys: this is an optional IntHashMap which stores alternative keys.
//     This is used when multiple keys are asigned to a data element
//     (for example, because it is matched by multiple partition queries or
//     because multiple values are projected under the data element as
//     its keys). In this case, the smallest/largest (depending on
//     'this.useMinKey') key among these keys is stored in the 'keys' table
//     while all other keys are stored in an array under the element ID.
//     The entries in the 'altKeys' array do not store empty arrays.
//     When there are no alternative keys left for a certain element ID,
//     the entry for that element ID in the alternative key table becomes
//     undefined.
//     When the key currently in 'keys' is removed or modified, this list
//     of alternative keys is used to determine the new key. Only the key
//     values are stored, so the same key may be stored multiple times
//     (if it is contributes multiple times).
//     It is assumed that the list of alternative keys is not very long and
//     does not change often so adding a key is performed by pushing
//     the value at the end of the array while finding the minimal element
//     requires a complete traversal of the array.

//
// Constructor
//

// The constructor received several arguments:
// useMinKey: if true, in case of multiple keys added for the same element ID,
//    the smallest of these keys will be used as the key. Otherwise,
//    the largest of these keys will be used.
// defaultKey: this is the key value which will be assigned (at comparison
//    time) to a data element for which this table stores no key.

function CompCalcKeys(useMinKey, defaultKey)
{
    this.defaultKey = defaultKey; // may be undefined
    this.useMinKey = !!useMinKey;
    this.keys = new IntHashMap();
    this.altKeys = undefined;
}

// Returns true if this object does not store sequence keys (the default
// is 'true', to be modified by the derived class)

CompCalcKeys.prototype.noSeqKeys = compCalcKeysNoSeqKeys;

function compCalcKeysNoSeqKeys()
{
    return true;
}

// Returns the main key for the given element ID

CompCalcKeys.prototype.getKey = compCalcKeysGetKey;

function compCalcKeysGetKey(elementId)
{
    return this.keys.get(elementId);
}

// Same as getKey() but if the resulting key is undefined and a default
// key is defined, returns the default key.
// This is the function to be used when actually comparing.

CompCalcKeys.prototype.getCompKey = compCalcKeysGetCompKey;

function compCalcKeysGetCompKey(elementId)
{
    var key = this.keys.get(elementId);
    return key === undefined ? this.defaultKey : key;
}

// Calling this function tells the object to expect the given number
// 'addedNum' of element IDs to have their keys added to the table.
// If the number of keys currently stored plus 'addedNum' is larger than
// the number of keys that can currently be stored in the table, the
// table will be extended to allow the storage of that number of keys.
// This function does not affect the altKeys table.

CompCalcKeys.prototype.expectAdditionalNum = compCalcKeysExpectAdditionalNum;

function compCalcKeysExpectAdditionalNum(addedNum)
{
    this.keys.expectSize(this.keys.size + addedNum);
}

// This function is used to add a key for the given data element. 
// The function returns the previous main key if the added key differs
// from the main key before the addition and undefined otherwise. If this
// is the first key set for the element ID (that is, the main key
// changed from undefined to 'key') undefined is returned. This means
// that the first time the number of different keys increases to two,
// this function returns the value of the only key stored so far.

CompCalcKeys.prototype.addKey = compCalcKeysAddKey;

function compCalcKeysAddKey(elementId, key)
{
    if(this.keys.get(elementId) === undefined) {
        this.keys.set(elementId, key);
        return undefined;
    }
    
    var oldKey = this.keys.get(elementId);
    var altKey;
    if((this.useMinKey && key < oldKey) ||
       (!this.useMinKey && key > oldKey)) { // replace old key by new key
            altKey = oldKey;
        this.keys.set(elementId, key);
    } else
        altKey = key;

    // add the alternative key to the list alternative keys
    if(this.altKeys === undefined)
        this.altKeys = new IntHashMap();
    var alt = this.altKeys.get(elementId);
    if(alt === undefined)
        alt = this.altKeys.set(elementId, [altKey]);
    else
        alt.push(altKey);

    return (key !== oldKey) ? oldKey : undefined;
}

// This function is used to remove a key for the given data element.
// Key removal is performed by key value (so if the same key is assigned
// several times, it should appear several times in the list).
// The function assumes that only keys which were added are also removed.

CompCalcKeys.prototype.removeKey = compCalcKeysRemoveKey;

function compCalcKeysRemoveKey(elementId, key)
{
    var altKeys;
    
    if(this.keys.get(elementId) === key) {
        // the key removed is the main key
        if(this.altKeys !== undefined &&
           (altKeys = this.altKeys.get(elementId)) !== undefined) {
            // find the alternative key to replace this one
            var l = altKeys.length;
            if(l == 1) {
                this.keys.set(elementId, altKeys[0]);
                this.altKeys.delete(elementId);
            } else {
                var newKey = altKeys[0];
                var newPos = 0;
                if(this.useMinKey) {
                    for(var i = 1 ; i < l ; ++i) {
                        var altKey = altKeys[i];
                        if(altKey <= newKey) {
                            newKey = altKey;
                            newPos = i;
                        }
                    }
                } else {
                    for(var i = 1 ; i < l ; ++i) {
                        var altKey = altKeys[i];
                        if(altKey >= newKey) {
                            newKey = altKey;
                            newPos = i;
                        }
                    }
                }
                this.keys.set(elementId, newKey);
                if(newPos < l - 1)
                    altKeys[newPos] = altKeys[l-1];
                altKeys.length--;
            }
        } else // no alternative keys, just remove the key
            this.keys.delete(elementId);
    } else {
        // not the main key, remove from the list of alternatives
        altKeys = this.altKeys.get(elementId);
        var l = altKeys.length;
        if(l == 1) // this must be the key
            this.altKeys.delete(elementId);
        else {
            for(var i = 0 ; i < l ; ++i) {
                if(altKeys[i] === key) {
                    if(i < l - 1)
                        altKeys[i] = altKeys[l-1];
                    altKeys.length--;
                    break;
                }
            }
        }
    }
}

// This function is used to remove all keys in the table which are equal to
// the given key. This applies both to main and alternative keys and if the
// same key appears several times as alternatives for the same element ID,
// all its instances will be removed. The function returns the list of
// element IDs for which at leat one key was removed.

CompCalcKeys.prototype.removeAllKeysEqualTo = compCalcKeysRemoveAllKeysEqualTo;

function compCalcKeysRemoveAllKeysEqualTo(key)
{
    var elementIds = [];
    var _self = this;
    
    this.key.forEach(function(k, elementId) {
        if(_self.removeAllMatchingKeys(elementId,
                                       function(x) { return x === key; }))
            elementIds.push(elementId);
    });

    return elementIds;
}

// This function removes all keys under the given elementId which match
// the criterion of the given decision function (those keys which
// are matched by the decision function are removed). When the main key is
// removed, the function needs to check whether there is an alternative
// key which can become the main key. For this purpose, the function
// must be able to compare the keys. So that this function could also
// serve derived classes with various comparison functions, the calling
// function must provide a function 'smallerThan', which should be
// a function on arguments (x,y) which returns true if x is smaller than y.
// If this is not provided, the default comparison is used.
// The function returns true if any key was removed and false if no
// key was removed.

CompCalcKeys.prototype.removeAllMatchingKeys =
    compCalcKeysRemoveAllMatchingKeys;

function compCalcKeysRemoveAllMatchingKeys(elementId, decisionFunc,
                                           smallerThan)
{
    var mainKey = this.keys.get(elementId);
    if(mainKey === undefined)
        return false;

    var removed = false;
    
    if(!decisionFunc(mainKey)) {
        // only need to remove from the alternative keys (if any)
        var altKeys;
        if(this.altKeys === undefined ||
           (altKeys = this.altKeys.get(elementId)) === undefined)
            return false;
        // remove matching alternative keys
        for(var j = 0, m = altKeys.length ; j < m ; ++j) {
            var altKey = altKeys[j];
            if(decisionFunc(altKey)) {
                removed = true;
                if(j < m - 1)
                    altKeys[j] = altKeys[m - 1];
                altKeys.length--;
                m--;
                j--;
            }
        }
    } else { // need to replace main key, if possible

        removed = true;

        if(smallerThan === undefined) {
            smallerThan = this.useMinKey ?
                function(x,y){ return x < y } : function(x,y){ return x > y };
        }
        
        var minKey;
        var minKeyPos;
        var altKeys;
        var altKeyNum;
        if(this.altKeys !== undefined &&
           (altKeys = this.altKeys.get(elementId)) !== undefined) {
            altKeyNum = altKeys.length;
            for(var j = 0 ; j < altKeyNum ; ++j) {
                var altKey = altKeys[j];
                if(altKey === key) {
                    if(j < altKeyNum - 1)
                        altKeys[j] = altKeys[altKeyNum - 1];
                    altKeys.length--;
                    altKeyNum--;
                    j--;
                } else if(smallerThan(altKey, minKey)) {
                    minKey = altKey;
                    minKeyPos = j;
                }
            }
        }
        
        if(altKeyNum === 0)
            this.altKeys.delete(elementId);
        
        if(minKey === undefined) // no alternative for the main key
            this.keys.delete(elementId);
        else {
            // replace the main key with the best alternative key
            this.keys.set(elementId, minKey);
            if(altKeyNum == 1) // last alternative became main
                this.altKeys.delete(elementId);
            else {
                if(minKeyPos < altKeyNum - 1)
                    altKeys[minKeyPos] = altKeys[altKeyNum - 1];
                altKeys.length--;
            }
        }
    }

    return removed;
}

// clear all keys stored

CompCalcKeys.prototype.clear = compCalcKeysClear;

function compCalcKeysClear()
{
    this.keys = new IntHashMap();
    this.altKeys = undefined;
}

// This function removes all keys for the given element ID 

CompCalcKeys.prototype.clearKeysById = compCalcKeysClearKeysById;

function compCalcKeysClearKeysById(elementId)
{
    this.keys.delete(elementId);

    if(this.altKeys === undefined)
        return;
    
    this.altKeys.delete(elementId);

    if(this.altKeys.size === 0)
        this.altKeys = undefined;
}

// This function removes all keys (both keys and alternative keys)
// of element IDs which do not appear in refList (an IntHashMap object,
// typically the 'keys' table of another CompCalcKeys).

CompCalcKeys.prototype.clearKeysByRefList = compCalcKeysClearKeysByRefList;

function compCalcKeysClearKeysByRefList(refList)
{
    var _self = this;
    
    this.keys.forEach(function(k, elementId) {

        if(refList.has(elementId))
            return;
        
        if(_self.altKeys !== undefined)
            _self.altKeys.delete(elementId);

        _self.keys.delete(elementId);
    });
}

// This function applies a translation to the keys based on the translation
// function 'translation' which maps old keys to new keys.
// For each key (including the alternative keys) in this CompCalcKeys object,
// the function translates the key using the 'translation' function and replaces
// it with the translation key. If this value is undefined, the key is
// removed. Where there are alternative keys, this function must also determine
// which key is the main key after this translation.
// 'smallerThan' should be a function on arguments (x,y) which returns
// true if x is smaller than y. If this is not provided, the default
// comparison is used.

CompCalcKeys.prototype.translateKeys = compCalcKeysTranslateKeys;

function compCalcKeysTranslateKeys(translation, smallerThan)
{
    if(smallerThan === undefined) {
        smallerThan = this.useMinKey ?
            function(x,y){ return x < y } : function(x,y){ return x > y };
    }

    // translate the default key, if any
    if(this.defaultKey !== undefined)
        this.defaultKey = translation(this.defaultKey);
    
    // first, if there are alternative keys, translate those keys. In the
    // process, place the alternative key which is a candidate to become
    // the main key as the last key in the list of alternatives.
    this.translateAltKeys(translation, smallerThan);

    // translate the main key. If there are alternative keys, check whether
    // after the translation the key needs to be replaced by an alternative
    // key.

    var _self = this;
    
    this.keys.forEach(function(key, elementId) {

        var altKeys = _self.altKeys !== undefined ?
            _self.altKeys.get(elementId) : undefined;
        var altKey = undefined;
        var altKeyNum;
        if(altKeys !== undefined) {
            altKeyNum = altKeys.length;
            altKey = altKeys[altKeyNum-1];
        }
        var newKey = translation(key);
        if(newKey === undefined) {
            if(altKey !== undefined) {
                _self.keys.set(elementId, altKey);
                if(altKeyNum == 1)
                    _self.altKeys.delete(elementId);
                else
                    altKeys.length--;
            } else
                _self.keys.delete(elementId);
        } else if(altKey !== undefined && smallerThan(newKey, altKey)) {
            // replace with the alternative key
            _self.keys.set(elementId, altKey);
            altKeys[altKeyNum-1] = newKey;
        } else
            _self.keys.set(elementId, newKey);
    });
}

// This function is an auxiliary function for the key translation function.
// This function is responsible for translating the keys in the 'altKeys'
// table. As in the general case of key translation, some keys may be
// removed as part of this translation. In addition, this function already
// prepares the comparison with the main key. It compares the new keys
// as they are being translated and places the minimal/maximal one
// (depending on the critrion for the main key) as the last key in the
// alternative key array (this then allows the main translation function
// to find it and compare it).
// 'smallerThan' should be a function on arguments (x,y) which returns
// true if x is smaller than y. If this is not provided, the default
// comparison is used.

CompCalcKeys.prototype.translateAltKeys = compCalcKeysTranslateAltKeys;

function compCalcKeysTranslateAltKeys(translation, smallerThan)
{
    if(this.altKeys === undefined)
        return;

    if(smallerThan === undefined) {
        smallerThan = this.useMinKey ?
            function(x,y){ return x < y } : function(x,y){ return x > y };
    }

    var _self = this;
    
    this.altKeys.forEach(function(altKeys, elementId) {

        var l = altKeys.length;
        var newCandidate;
        var newCandidatePos;
        for(var i = 0 ; i < l ; ++i) {
            var newKey = translation(altKeys[i]);
            if(newKey === undefined) { // remove the key
                if(i < l - 1)
                    altKeys[i] = altKeys[l-1];
                altKeys.length--;
                i--;
                l--;
            } else {
                altKeys[i] = newKey;
                if(i == 0 || smallerThan(newKey, newCandidate)) {
                    newCandidate = newKey;
                    newCandidatePos = i;
                }
            }
        }
        
        if(l == 0) {
            _self.altKeys.delete(elementId); // all keys removed
        } else if(newCandidatePos !== l - 1) { 
            // move the candidate to the last position
            var tmp = altKeys[i];
            altKeys[i] = altKeys[l-1];
            altKeys[l-1] = tmp;
        }
    });
}

// This function may be used to reset the 'useMinKey' property. The new
// value of this flag is provided in 'useMinKey'. In addition to setting
// this flag in the object, this function also checks whether the keys
// have to be recalculated. Such a recalculation is required only for
// keys which have alternatives (and which alternative is used depends
// on the 'useMinKey' flag).
// if 'dontRefresh' is true, only the new value fo 'useMinKey' is set, without
// re-calculating the main key among alternative keys (this may be used
// when the main key was already calculated by some other function, such
// as a translation function).

CompCalcKeys.prototype.setUseMinKey = compCalcKeysSetUseMinKey;

function compCalcKeysSetUseMinKey(useMinKey, dontRefresh)
{
    useMinKey = !!useMinKey;
    
    if(dontRefresh || useMinKey == this.useMinKey)
        return;

    this.useMinKey = useMinKey;

    if(this.altKeys === undefined)
        return; // nothing more to do

    var _self = this;
    
    this.altKeys.forEach(function(altKeys, elementId) {

        var key = _self.keys.get(elementId);

        if(_self.useMinKey) {
            for(var i = 0, l = altKeys.length ; i < l ; ++i) {
                var altKey = altKeys[i];
                if(altKey < key) {
                    altKeys[i] = key;
                    key = altKey;
                }
            }
        } else {
            for(var i = 0, l = altKeys.length ; i < l ; ++i) {
                var altKey = altKeys[i];
                if(altKey > key) {
                    altKeys[i] = key;
                    key = altKey;
                }
            }
        }

        _self.keys.set(elementId, key);
    });
}

/////////////////////
// CompCalcSeqKeys //
/////////////////////

// This object extends the basic CompCalcKeys object to support sequence
// keys, that it, keys which are an array of simple keys. It is the first
// position in the sequence key array which is the main key (of the sequence
// which is the main key for a given element ID) so that for the comparison
// function which uses these keys, the keys remain simple keys. However,
// the sequence keys allow better management of alternative keys in cases
// where the ordering of the keys themselves is not sufficient).
//
// The CompCalcSeqKeys object allows mixing simple keys with sequence keys.
// However, for every single element ID, one should either store simple
// keys or sequence keys.
//
// Derived Class Additional Fields
// -------------------------------
//
// {
//     seqCompare: <sequence key comparison function>
// }
//
// seqCompare: this is a comparison function for key sequences when such
//     sequences may be stored here (if this function is not defined, it
//     is not possible to store key sequences here). It is possible to
//     add this function to this object after some keys are already stored
//     in it, but it has to be defined before the first key sequence is added.
//     When comparing sequences, the 'useMinKey' property is ignored,
//     and the sequence key which is smallest based on the comparison
//     function is the main key.

inherit(CompCalcSeqKeys, CompCalcKeys);

//
// Constructor
//

// The constructor received the same arguments as the base class constructor
// and the following additional arguments:
// seqCompare: comparison function to be used with key sequences.
//    This is optional and may be set later.
// compCalcKeys: this is an optional argument. If provided, this should
//    be a CompCalcKeys object (without sequence keys). This object is
//    then used to initialize the keys of the object being constructed,
//    by simply having the new object use the key tables (main and alternative)
//    of 'compCalcKeys'. Since the keys of 'compCalcKeys' are assumed to
//    be simple, they are also valid keys here. After this operation,
//    the object 'compCalcKeys' should not be used anymore.
//    When 'compCalcKeys' is given, the other arguments of the constructor
//    are ignored (the arguments are copied from the 'compCalcKeys' object)

function CompCalcSeqKeys(useMinKey, defaultKey, seqCompare, compCalcKeys)
{
    if(compCalcKeys !== undefined) {
        this.CompCalcKeys(compCalcKeys.useMinKey, compCalcKeys.defaultKey);
        this.keys = compCalcKeys.keys;
        this.altKeys = compCalcKeys.altKeys;
    } else
        this.CompCalcKeys(useMinKey, defaultKey);

    this.seqCompare = seqCompare;
}

// Returns true if this object cannot (at the moment) store sequence keys.

CompCalcSeqKeys.prototype.noSeqKeys = compCalcSeqKeysNoSeqKeys;

function compCalcSeqKeysNoSeqKeys()
{
    return (this.seqCompare === undefined);
}

// Set a new sequence comparison function.

CompCalcSeqKeys.prototype.setSeqCompare = compCalcSeqKeysSetSeqCompare;

function compCalcSeqKeysSetSeqCompare(seqCompare)
{
    this.seqCompare = seqCompare;
}

// Same as getKey() except for:
// 1. If the resulting key is undefined and a default key is defined,
//    returns the default key.
// 2. If key stored is a sequence key, only the first key in the
//    sequence key is returned (this is the key to be used for
//    comparison).
// This is the function to be used when actually comparing.

CompCalcSeqKeys.prototype.getCompKey = compCalcSeqKeysGetCompKey;

function compCalcSeqKeysGetCompKey(elementId)
{
    var key = this.keys.get(elementId);
    if(key === undefined)
        return this.defaultKey;
    if(this.seqCompare === undefined || !(key instanceof Array))
        return key;
    else
        return key[0];
}

// This function is used to add a sequence key for the given element ID
// (a sequence key is a key which is an array of simple keys, where the
// first key in the array is considered its main key). This may be
// used only if 'this.seqCompare' was defined (a comparison function for
// the sequence keys). If a sequence key is used for one key of a certain
// element ID, it must be used for all keys added for that element ID.
// This function does not return any value.

CompCalcSeqKeys.prototype.addSeqKey = compCalcSeqKeysAddSeqKey;

function compCalcSeqKeysAddSeqKey(elementId, key)
{
    if(!this.keys.has(elementId)) {
        this.keys.set(elementId, key);
        return;
    }
    
    var oldKey = this.keys.get(elementId);
    var altKey;
    if(this.seqCompare(key, oldKey) < 0) { // replace old key by new key
        altKey = oldKey;
        this.keys.set(elementId, key);
    } else
        altKey = key;

    // add the alternative key to the list of alternative keys
    if(this.altKeys === undefined)
        this.altKeys = new IntHashMap();
    var alt = this.altKeys.get(elementId);
    if(alt === undefined) {
        alt = [altKey];
        this.altKeys.set(elementId, alt);
    } else
        alt.push(altKey);
}

// This function is used to remove a sequence key for the given element ID
// (a sequence key is a key which is an array of simple keys, where the
// first key in the array is considered its main key). This may be
// used only if the keys for the given element ID are sequence keys.
// Key removal is performed by key value, so the key removed is the first
// key found which is equal (based on the comparison function) to the key
// 'key'. The function assumes that only keys which were added are also removed.

CompCalcSeqKeys.prototype.removeSeqKey = compCalcSeqKeysRemoveSeqKey;

function compCalcSeqKeysRemoveSeqKey(elementId, key)
{
    var altKeys;
    
    if(this.seqCompare(this.keys.get(elementId), key) == 0) {
        // the key removed is the main key
        if(this.altKeys !== undefined &&
           (altKeys = this.altKeys.get(elementId)) !== undefined) {
            // find the alternative key to replace this one
            var l = altKeys.length;
            if(l == 1) {
                this.keys.set(elementId, altKeys[0]);
                this.altKeys.delete(elementId);
            } else {
                var newKey = altKeys[0];
                var newPos = 0;
                for(var i = 1 ; i < l ; ++i) {
                    var altKey = altKeys[i];
                    if(this.seqCompare(altKey, newKey) <= 0) {
                        newKey = altKey;
                        newPos = i;
                    }
                }
                this.keys.set(elementId, newKey);
                if(newPos < l - 1)
                    altKeys[newPos] = altKeys[l-1];
                altKeys.length--;
            }
        } else // no alternative keys, just remove the key
            this.keys.delete(elementId);
    } else {
        // not the main key, remove from the list of alternatives
        altKeys = this.altKeys.get(elementId);
        var l = altKeys.length;
        if(l == 1) // this must be the key
            this.altKeys.delete(elementId);
        else {
            for(var i = 0 ; i < l ; ++i) {
                if(this.seqCompare(altKeys[i], key) == 0) {
                    if(i < l - 1)
                        altKeys[i] = altKeys[l-1];
                    altKeys.length--;
                    break;
                }
            }
        }
    }
}

// This function may be used to upgrade the keys (both main key and alternative
// keys) of the given element ID to sequence keys. 'upgradeFunc' must be
// a function which takes in a simple key and returns the upgraded sequence
// key.

CompCalcSeqKeys.prototype.convertToSeqKeys =
    compCalcSeqKeysConvertToSeqKeys;

function compCalcSeqKeysConvertToSeqKeys(elementId, upgradeFunc)
{
    var key = this.keys.get(elementId);
    if(key === undefined)
        return; // no keys to upgrade

    this.keys.set(elementId, upgradeFunc(key));

    if(this.altKeys === undefined)
        return;

    var altKeys = this.altKeys.get(elementId);
    if(altKeys === undefined)
        return;

    for(var i = 0, l = altKeys.length ; i < l ; ++i)
        altKeys[i] = upgradeFunc(altKeys[i]);
}

