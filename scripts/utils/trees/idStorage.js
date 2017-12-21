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


// This file implements a simple object for storing a set of IDs. The
// interface is similar to the Map interface where the value stored
// under the ID is ignored (that is, we are only interested in the keys
// and the value is arbitrary, say 'true'). This supports the
// add(<ID>, <value (ignored)>), delete(<ID>), has(<ID>) and
// 'forEach(<function>)' functions of the Map interface. It also
// has a 'size' member which indicates the number of IDs stored in the
// object.
//
// An additional assumption made is that 'add' operations always add
// keys which are new. Therefore, the object does not need to check whether
// the given key is already stored.
//
// In addition to the forEach() function, one can also iterate directly
// over the IDs stored in the object by running over the memeber array
// 'idList' of the object.

// %%include%%: <scripts/utils/intHashTable.js>

function IdStorage()
{
    this.size = 0;
    this.idList = [];
    this.iForEach = undefined; // used during a forEach operation
    // idSet is a Map object for quick access to the position of the
    // key, which is only created when the number of IDs stored in the
    // object becomes large
    this.idSet = undefined;
}

IdStorage.minMapSize = 100;

// check whether the ID is in the list

IdStorage.prototype.has = idStorageHas;

function idStorageHas(id)
{
    if(this.idSet !== undefined)
        return this.idSet.has(id);

    for(var i = 0, l = this.size ; i < l ; ++i)
        if(this.idList[i] == id)
            return true;

    return false;
}

// Add the given ID to the set. It is assumed the ID is not in the list. 

IdStorage.prototype.set = idStorageSet;

function idStorageSet(id)
{
    var l = this.idList.push(id);
    this.size++;

    if(this.idSet !== undefined)
        this.idSet.set(id, l-1);
    else if(this.size > IdStorage.minMapSize) {
        // create the idSet object
        this.idSet = new Map();
        for(var i = 0, l = this.size ; i < l ; ++i)
            this.idSet.set(this.idList[i], i);
    }
}

// remove the given ID from the set. It is assumed the ID is in the list. 

IdStorage.prototype.delete = idStorageDelete;

function idStorageDelete(id)
{
    var l;
    if(this.idSet === undefined) {
        for(l = 0, m = this.size ; l < m ; ++l)
            if(this.idList[l] == id)
                break;
    } else {
        l = this.idSet.get(id);
        this.idSet.delete(id);
    }

    if(this.iForEach !== undefined && this.iForEach > l) {
        // deleting inside a forEach loop, at a position before the position
        // at which the forEach loop is at the moment. 
        var lastId = this.idList[this.size-1];
        var forEachId = this.idList[this.iForEach];
        this.idList[l] = forEachId;
        this.idList[this.iForEach] = lastId;
        this.iForEach--; // next step will return to the same position
        
        if(this.idSet !== undefined) {
            this.idSet.set(lastId, this.iForEach);
            this.idSet.set(forEachId, l);
        }

        
    } else if(l !== this.size - 1) {
        var lastId = this.idList[this.size-1];
        this.idList[l] = lastId;
        if(this.idSet !== undefined)
            this.idSet.set(lastId, l);
        if(this.iForEach === l) // forEach loop at removal position
            this.iForEach--; // next step will return to the same position
    }
    
    this.idList.length--;
    this.size--;
}

// apply the given function to each ID in the list

IdStorage.prototype.forEach = idStorageForEach;

function idStorageForEach(func)
{
    for(this.iForEach = 0 ; this.iForEach < this.size ; ++this.iForEach) {
        func(true, this.idList[this.iForEach]);
    }

    this.iForEach = undefined;
}

// push the IDs stored here at the end of the given buffer.

IdStorage.prototype.pushTo = idStoragePushTo;

function idStoragePushTo(buffer)
{
    for(var i = 0, l = this.size ; i < l ; ++i)
        buffer.push(this.idList[i]);
}

// Return a (duplicate) array of all IDs stored in the object.

IdStorage.prototype.getList = idStorageGetList;

function idStorageGetList()
{
    return this.idList.slice(0);
}

//
// IntIdStorage
//

// This is an implementation of IdStorage for non-negative integer values.
// For such values, when the array becomes large, it is replaced by
// a hash set instead of adding a Map object to index it.

// Object Structure
//
// {
//     size: <integer> // number of items stored
//     idList: <array> // used to store IDs when number is small
//     hashSet: <UInt31HashSet> // used to store IDs when number is large
//     // used in a forEach loop when 'idList' is in use. When there is
//     // a single ID stored in this object, it is stored under this
//     // field.
//     iForEachOrId: <integer>
// }

function IntIdStorage()
{
    this.size = 0;
    this.idList = undefined;
    this.hashSet = undefined;
    // used during a forEach operation and to store single value
    this.iForEachOrId = undefined;
}

IntIdStorage.minMapSize = 100;
IntIdStorage.initialLoadFactor = 0.7;

// check whether the ID is in the list

IntIdStorage.prototype.has = intIdStorageHas;

function intIdStorageHas(id)
{
    if(this.hashSet !== undefined)
        return this.hashSet.has(id);

    if(this.idList !== undefined) {
        for(var i = 0, l = this.size ; i < l ; ++i)
            if(this.idList[i] == id)
                return true;
    
        return false;
    }

    return this.iForEachOrId === id;
}

// Add the given ID to the set. It is assumed the ID is not in the list. 

IntIdStorage.prototype.set = intIdStorageSet;

function intIdStorageSet(id)
{
    this.size++;
    
    if(this.hashSet !== undefined) {
        this.hashSet.set(id);
        return;
    }

    if(this.idList !== undefined) {
        this.idList.push(id);

        if(this.size > IntIdStorage.minMapSize) {
            // copy the values to a hash set
            this.hashSet =
                new Uint31HashSet(Math.ceil(this.size /
                                            IntIdStorage.initialLoadFactor));
            for(var i = 0, l = this.size ; i < l ; ++i)
                this.hashSet.set(this.idList[i]);

            this.idList = undefined;
        }

        return;
    }

    if(this.size === 1)
        this.iForEachOrId = id;
    else {
        this.idList = [this.iForEachOrId, id];
        this.iForEachOrId = undefined;
    }
}

// remove the given ID from the set. It is assumed the ID is in the list. 

IntIdStorage.prototype.delete = intIdStorageDelete;

function intIdStorageDelete(id)
{
    if(this.hashSet !== undefined) {
        this.hashSet.delete(id);
        this.size--;
        return;
    }

    if(this.idList !== undefined) {
        var l;
        for(l = 0, m = this.size ; l < m ; ++l)
            if(this.idList[l] == id)
                break;

        if(this.iForEachOrId !== undefined && this.iForEachOrId > l) {
            // deleting inside a forEach loop, at a position before the position
            // at which the forEach loop is at the moment. 
            var lastId = this.idList[this.size-1];
            var forEachId = this.idList[this.iForEachOrId];
            this.idList[l] = forEachId;
            this.idList[this.iForEachOrId] = lastId;
            this.iForEachOrId--; // next step will return to the same position
        } else if(l !== this.size - 1) {
            var lastId = this.idList[this.size-1];
            this.idList[l] = lastId;
            if(this.iForEachOrId === l) // forEach loop at removal position
                // next step will return to the same position
                this.iForEachOrId--;
        }
    
        this.idList.length--;
        this.size--;
        return;
    }

    this.iForEachOrId = undefined;
    this.size = 0;
}

// apply the given function to each ID in the list

IntIdStorage.prototype.forEach = intIdStorageForEach;

function intIdStorageForEach(func)
{
    if(this.hashSet !== undefined) {
        this.hashSet.forEach(func);
        return;
    }

    if(this.idList !== undefined) {
        for(this.iForEachOrId = 0 ; this.iForEachOrId < this.size ;
            ++this.iForEachOrId) {
            func(true, this.idList[this.iForEachOrId]);
        }
        this.iForEachOrId = undefined;
        return;
    }

    if(this.size !== 0)
        func(true, this.iForEachOrId);
}

// push the IDs stored here at the end of the given buffer.

IntIdStorage.prototype.pushTo = intIdStoragePushTo;

function intIdStoragePushTo(buffer)
{
    if(this.hashSet !== undefined) {
        this.hashSet.pushTo(buffer);
        return;
    }

    if(this.idList !== undefined) {
        for(var i = 0, l = this.size ; i < l ; ++i)
            buffer.push(this.idList[i]);
        return;
    }

    if(this.size !== 0)
        buffer.push(this.iForEachOrId);
}

// Return a (duplicate) array of all IDs stored in the object.

IntIdStorage.prototype.getList = intIdStorageGetList;

function intIdStorageGetList()
{
    if(this.hashSet !== undefined)
        return this.hashSet.getList();

    if(this.idList !== undefined)
        return this.idList.slice(0);

    if(this.size !== 0)
        return [this.iForEachOrId];
}

//
// IntBinaryTreeNode
//

inherit(IntBinaryTreeNode, IntIdStorage);

function IntBinaryTreeNode(key, parent, prev, next)
{
    this.IntIdStorage();

    // binary tree fields

    this.parent = parent;
    this.left = undefined;
    this.right = undefined;
    this.prev = prev;
    this.next = next;
    this.key = key;
    // points back to itself, as all operation are implemented directly at
    // the binary tree level, but calling functions may look for them under
    // the 'value' field.
    this.value = this;
}

