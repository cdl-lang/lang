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


// This file implements a sorted list data structure. At present, the
// trivial linear search algorithm is used for insertion, so one should
// not use this for very long lists with many different key values.
// However, if there is a small number of key values then insertion is
// efficient even if the number of items is large.
// The sorted list stores objects. Each object must be given a sortVal
// and a path array. The path in the path array can be used to look up the
// object (through a hash table). The sortVal is used for sorting
// the objects (in decreasing order of sortVal).
// The object ('node') at the end of each path has the following structure:
// {
//    subpaths: {
//       <subpath>: <node>,
//       ....
//    }
//    entry: <the entry stored at this path, may be empty>
//    sortVal: <the sortVal of the entry stored at this path>
//    sameValKey: <a value refelecting the relative position of the object
//                 relative to other objects with the same sortVal> 
//    prev: <previous node in the sorted list - defined only if there's
//           an entry>
//    next: <next node in sorted list - defined only if there's an entry>
//    firstSameKey: <first node with this sort value>
//    lastSameKey: <last node with this sort value>
//    iterators: {
//        <iterator ID>: <iterator object>
//        .....
//    }
// }
//
// The 'sameValKey' is a number assigned automatically by the system
// to entries inserted into the list, based on the position of insertion.
// Because a new object is inserted either before or after all existing
// objects with the same sortVal, the 'samValKey' can be assigned as
// follows:
// 1. If this is the first object with the given sortVal, it is assigned
//    an arbitrary 'sameValKey' (say, zero).
// 2. If an object is inserted before the first existing object with the
//    same sortVal, the object is assigned a 'sameValKey' which is
//    larger by 1 than that assigned to the first existing object with
//    that sortVal.
// 3. If an object is inserted after the last existing object with the
//    same sortVal, the object is assigned a 'sameValKey' which is
//    smaller by 1 than that assigned to the last existing object with
//    that sortVal.
// This number does not change as long as the sortVal of an object in the
// list does not change. Taken together, the sortVal and sameValKey
// allows us to determine for any two objects which of them appears before
// the other in the list (it does not tell us, however, how many positions
// separate them in the list).
//
// The 'firstSameKey' is a pointer pointing at the first entry in the sorted
// list which has the same 'sortVal' as this entry. The 'firstSameKey' is
// only defined on the last node with the same 'sortVal' and only if there is
// more than one node with that sortVal. Similarly, the 'lastSameKey' points
// at the last entry with the same sortVal and is only defined on the first
// node with that sortVal (and only if there is more than one entry
// with that sortVal). These two pointers make insertion efficient when
// the list is long but the number of different sortVals is relatively
// small.
// Because nodes are always inserted either before or after all existing
// nodes with the same sortVal, it is easy to maintain these two pointers.
//
// This class provides directly for sort value which are numbers
// (or anything else which can be compared using the Javascript comparison
// operators, such as '<', '>=' and '=='). However, one may create a
// derived class based on this class which replaces the comparison functions,
// thus allowing for other full orders to be used for sorting.
// To do so, a derived class needs to define the following functions:
// 1. valsEqual(a,b): returns true iff the two values equal.
// 2. valLessThan(a, b) returns true if value 'a' is strictly smaller than
//    'b' and false otherwise.
// 3. valLessOrEqual(a, b) returns true if value 'a' is less or equal to 'b'
//    and false otherwise.
// When a derived class defines these functions, it should set (in its
// constructor) the flag 'modifiedOrdering' to true. This tell the code that
// it must use the above functions. If the flag is not set, the code below
// either uses these functions (which are defined by default to reproduce
// the standard ordering >) or the operators <, >=, == directly
// (the functions are less efficient, so inside loops we prefer to use the
// operators directly, however, outside of loops, we use the functions
// for uniformity of code between the base and derived class).

//
// Iterators
//

// One can construct an iterator on a sorted list. In principle, the 
// iterator simply holds a pointer to the node which is its current position
// and may advance to the next node in the list when instructed to do so.
// The iterator is a little more complex than that, however, since it allows
// for changes in the sorted list to take place during the iteration.
// The logic is then simple: if the node which the iterator currently points
// at is moved or removed, the iterator moves to the node preceding the 
// current node. This means that as long as node are removed or are moved
// down the sorted list, the iterator will not miss any nodes in the list
// and will not enter an infinte loop. If a node which appear after 
// the current position of the iterator is moved to a position before the
// current position of the interator, this node will not be reached by
// the iterator. Nodes which are moved from a position before or at 
// the current position of the iterator to a position after the current
// position of the iterator will be visited more than once. 
//
// Since the SortedList needs to notify the iterators of changes in its
// structure, each iterator is stored on the node it is currently pointing
// at. For this purpose, the SortedList generates a unique ID for the iterator
// when it is created. Each node has a table 'iterators' (created when 
// necessary) and this table holds a pointer to each iterator currently
// pointing at that node (the iterator is stored in the table under its
// iterator ID, assigned to it upn construction). 
// When constructing the iterator, it points at no node and one needs to call 
// 'SortedListIter.next()' to advance to the first element. After advancing
// beyond the end of the sorted list, the iterator again points at no node.
// When the iterator points at no node, it is not registered on any node 
// in the sorted list and therefore the sorted list stores no pointer (or any
// other trace) of this iterator. This means that in this state the iterator 
// would be garbage  collected in the usual way. While the iterator does 
// point at some node in the sorted list, it will remain stored on
// that node, and therefore must be destroyed explicitly if one does not
// wish to use it anymore (this is done by calling the 'destroy' function 
// of the iterator).
//
// The iterator object has the following structure:
// 
// {
//    sortedList: <pointer to the sorted list>
//    id: <the ID assigned to it upon construction>
//    node: <node it is currently pointing at>
//    atEnd: <true if the end as been reached>
// }
//
// The 'node' field points at the current node the iterator is pointing at.
// When the iterator has just been created or has reached the end, this
// node is undefined. To distinguish these two states, the 'atEnd' flag
// is set to true when the end has been reached.
//
// See more details in the implementation below (class SortedListIter). 

function SortedList()
{
    this.iteratorId = 1; // assignment of iterator IDs
    this.clear();
}

// This function clears the sorted list.

SortedList.prototype.clear = sortedListClear;

function sortedListClear()
{
    this.root = {
        subpaths: {}
    };
    this.first = null;
    this.last = null;
}

// This function allocates the next iterator ID (the current iterator ID
// stored is returned and the iterator ID counter is advanced).

SortedList.prototype.getNextIteratorId = sortedListGetNextIteratorId;

function sortedListGetNextIteratorId()
{
    return this.iteratorId++;
}

// This function gets the node at the given path. If the node does not
// exist, an empty node is created (unless 'dontCreate' is set).
// If the path is of length 1 and 'dontCreate' is true, it is more efficient
// to give the single path element x in 'path' rather than a path [x].

SortedList.prototype.getNode = sortedListGetNode;

function sortedListGetNode(path, dontCreate)
{
    if(path === undefined)
        return this.root;
    
    if(typeof(path) != "object") {
        if(dontCreate)
            return this.root.subpaths[path];
        path = [path];
    }
    
    if(!path || !path.length)
        return this.root;

    var prefix = this.root;

    for(var i in path) {
        if(!prefix.subpaths[path[i]]) {
            if(dontCreate)
                return undefined;
            prefix.subpaths[path[i]] = {
                subpaths: {}
            };
        }
        prefix = prefix.subpaths[path[i]];
    }

    return prefix;
}

// The following function returns the entry at the given path, if such an
// entry exists, and otherwise undefined.

SortedList.prototype.getEntry = sortedListGetEntry;

function sortedListGetEntry(path)
{
    var node = this.getNode(path, true);

    if(!node)
        return undefined;
    
    return node.entry;
}

// This function returns an array with all the node on the given path.
// It does not create nodes if the nodes do not exist yet (and in that
// case it returns an array of nodes which is shorter than the path).
// The first node in this path is always the root node.

SortedList.prototype.getNodePath = sortedListGetNodePath;

function sortedListGetNodePath(path)
{
    var nodePath = [this.root];
    var node = this.root;

    if(path === undefined)
        return nodePath;
    
    for(var i in path) {
        if(!node.subpaths[path[i]])
            break;
        node = node.subpaths[path[i]];
        nodePath.push(node);
    }

    return nodePath;
}

// This function inserts the given object into the structure. If an
// object already exists under the same path, that object is replaced.
// The 'atEnd' argument is optional. If it is true, the function seeks the
// insertion point beginning from the end of the list. Otherwise, the function
// seeks the insertion point beginning at the beginning of the list.
// This function returns the node in the list holding the inserted entry.

SortedList.prototype.insert = sortedListInsert;

function sortedListInsert(entry, path, sortVal, atEnd)
{
    var node = this.getNode(path);
    
    // if an entry already exists, replace it
    if("entry" in node) {
        node.entry = entry;
        this.changeNodeSortVal(node, sortVal);
        return node;
    }

    node.entry = entry;
    node.sortVal = sortVal;

    if(atEnd) {
        // insert the node into the sorted list seeking the position from
        // the end of the list
        var after = this.last;

        if(!this.modifiedOrdering)
            while(after && after.sortVal < sortVal)
                after =
                    after.firstSameKey ? after.firstSameKey.prev : after.prev;
        else
            while(after && this.valLessThan(after.sortVal, sortVal))
                after =
                    after.firstSameKey ? after.firstSameKey.prev : after.prev;

        this.insertBefore(node, after ? after.next : this.first);
    } else {
        // insert the node into the sorted list seeking the position from
        // the beginning.of the list
        var before = this.first;

        if(!this.modifiedOrdering)
            while(before && before.sortVal >= sortVal)
                before =
                    before.lastSameKey ? before.lastSameKey.next : before.next;
        else
            while(before && this.valLessOrEqual(sortVal, before.sortVal))
                before =
                    before.lastSameKey ? before.lastSameKey.next : before.next;
    
        this.insertBefore(node, before);
    }

    return node;
}

// This function changes the sortVal of the node at the given path.
// The node should already be in the list. Otherwise, nothing is done.

SortedList.prototype.changeSortVal = SortedListChangeSortVal;

function SortedListChangeSortVal(path, sortVal)
{
    var node = this.getNode(path, true);

    if(node)
        this.changeNodeSortVal(node, sortVal);
}

// This function changes the sortVal of a node already in the list.

SortedList.prototype.changeNodeSortVal = SortedListChangeNodeSortVal;

function SortedListChangeNodeSortVal(node, sortVal)
{
    if(!node)
        return;

    var before; // the node before which this node should be inserted
    var noPrevSortVal = !("sortVal" in node);
    var prevSortVal = node.sortVal;
    
    if (!noPrevSortVal && this.valsEqual(node.sortVal, sortVal))
        return;
    
    node.sortVal = sortVal;

    if(noPrevSortVal) {
        // search from the beginning of the list
        before = this.first;

        if(!this.modifiedOrdering)
            while(before && before.sortVal >= sortVal)
                before =
                    before.lastSameKey ? before.lastSameKey.next : before.next;
        else
            while(before && this.valLessOrEqual(sortVal, before.sortVal))
                before =
                    before.lastSameKey ? before.lastSameKey.next : before.next;
        
    } else if(this.valLessThan(prevSortVal, sortVal)) {
        var after = node.prev;

        if(!this.modifiedOrdering)
            while(after && after.sortVal < sortVal)
                after =
                    after.firstSameKey ? after.firstSameKey.prev : after.prev;
        else
            while(after && this.valLessThan(after.sortVal, sortVal))
                after =
                    after.firstSameKey ? after.firstSameKey.prev : after.prev;

        if(after == node.prev)
            before = node.next;
        else
            before = after ? after.next : this.first;
    } else {
        before = node.next;

        if(!this.modifiedOrdering)
            while(before && before.sortVal > sortVal)
                before =
                    before.lastSameKey ? before.lastSameKey.next : before.next;
        else
            while(before && this.valLessThan(sortVal, before.sortVal))
                before =
                    before.lastSameKey ? before.lastSameKey.next : before.next;
    }

    // Check whether the node really moved or whether only the key changed.
    // If really moved, then before moving the node, transfer all iterators 
    // pointing at it to the previous node
    if(before != node.next && node.iterators)
        this.transferIteratorsToPrevNode(node);
    
    this.removeNodeFromList(node);
    this.insertBefore(node, before);
}

// This function removes the entry with the given path. It also removes
// any nodes on the path which become empty as a result of this operation. 
// The function returns the 'entry' part of the node if the entry was removed
// and undefined if not (this means that there was no entry defined at that
// path).
// If the path is of length 1 it is slightly more efficient to give the
// single path element x in 'path' rather than a path [x].

SortedList.prototype.remove = sortedListRemove;

function sortedListRemove(path)
{
    var entry = undefined;
    
    if(path === undefined)
        return undefined;
    
    var nodePath;
    
    if(typeof(path) != "object") {
        if(!this.root.subpaths[path])
            return undefined;
        nodePath = [this.root, this.root.subpaths[path]];
        path = [path];
    } else { // get the node path
        nodePath = this.getNodePath(path);
        if(nodePath.length != path.length + 1)
            return undefined; // node corresponding to path does not exist
    }
    
    var depth = path.length;
    
    if(nodePath[depth].sortVal !== undefined)
        this.removeNodeFromList(nodePath[depth]);

    if("entry" in  nodePath[depth])
        entry = nodePath[depth].entry;
    
    delete nodePath[depth].entry;
    delete nodePath[depth].sortVal;

    while(depth >= 1 && isEmptyObj(nodePath[depth].subpaths) &&
          !("entry" in nodePath[depth]) &&
          !("sortVal" in nodePath[depth])) {
        delete nodePath[depth-1].subpaths[path[depth-1]];
        --depth;
    }

    return entry;
}

// This function removes from the sorted list any node which has the given
// label in its path under the prefix path (that is, if the prefix path is
// ["a","b"] and label is "c", this function removes the node at
// ["a","b","c"] (and all nodes under it) and ["a","b","d","c"], etc.
// Nodes which become empty as a result of this are also removed.

SortedList.prototype.removeWhenLabelInPath = sortedListRemoveWhenLabelInPath;

function sortedListRemoveWhenLabelInPath(label, prefix)
{
    // get the node at the top of the path
    var node = this.getNode(prefix, true);

    if(!node)
        return;

    this.removeWhenLabelInPathFromNode(label, node);

    // Check whether the node at 'prefix' became empty. In this case,
    // if it is not root, remove it.
    
    if(node == this.root)
        return;
    
    if(isEmptyObj(node.subpaths) && !("entry" in node) && !("sortVal" in node))
        this.remove(prefix);
}

// This function removes from the sorted list any node which has the given
// label in its path under node. If 'node' is undefined, the root node
// is used.
// The 'node' is not removed even if after this operation it is empty.
// To ensure the node is removed (if it is empty) one should call the
// function 'removeWhenLabelInPath' (where the path to the initial node
// needs to be specified).

SortedList.prototype.removeWhenLabelInPathFromNode =
    sortedListRemoveWhenLabelInPathFromNode;

function sortedListRemoveWhenLabelInPathFromNode(label, node)
{
    if(!node)
        node = this.root;

    if(node.subpaths[label]) {
        this.removeNodesUnder(node.subpaths[label]);
        this.removeNodeFromList(node.subpaths[label]);
        delete node.subpaths[label];
    }

    for(var l in node.subpaths) {
        this.removeWhenLabelInPathFromNode(label, node.subpaths[l]);
        if(isEmptyObj(node.subpaths[l].subpaths) &&
           !("entry" in node.subpaths[l]) && !("sortVal" in node.subpaths[l]))
            delete node.subpaths[l];
    }
}

// remove all nodes under this node (but not this node itself)

SortedList.prototype.removeNodesUnder = sortedListRemoveNodesUnder;

function sortedListRemoveNodesUnder(node)
{
    if(!node)
        return;

    for(var l in node.subpaths) {
        var subnode = node.subpaths[l];
        this.removeNodesUnder(subnode);
        if("sortVal" in subnode)
            this.removeNodeFromList(subnode);
        delete node.subpaths[l];
    }
}

// This function inserts the given 'node' before the 'before' node.
// If 'before' is null, this inserts 'node' at the end of the list.
// This function assumes that if the inserted node has the same sortVal as
// other nodes in the list, then it is inserted either at the beginning or
// end of the block of nodes with that sortVal.

SortedList.prototype.insertBefore = sortedListInsertBefore;

function sortedListInsertBefore(node, before)
{
    if(!node)
        return;
    
    if(node.prev || node.next)
        this.removeNodeFromList(node);

    if(!before) {
        if(this.last)
            this.last.next = node;
        else
            this.first = node;
        node.prev = this.last;
        node.next = null;
        this.last = node;
    } else {
        node.prev = before.prev;
        node.next = before;
        if(before.prev)
            before.prev.next = node;
        else
            this.first = node;
        before.prev = node;
    }

    // assign the 'sameValKey' and the 'firstSameKey' and
    // 'lastSameKey' pointers
    if(node.prev && this.valsEqual(node.prev.sortVal, node.sortVal)) {
        // this must be the last node with this sortVal
        node.sameValKey = node.prev.sameValKey - 1;
        if(node.prev.firstSameKey) {
            node.firstSameKey = node.prev.firstSameKey;
            node.firstSameKey.lastSameKey = node;
            delete node.prev.firstSameKey;
        } else {
            node.firstSameKey = node.prev;
            node.prev.lastSameKey = node;
        }
    } else if(node.next && this.valsEqual(node.next.sortVal, node.sortVal)) {
        node.sameValKey = node.next.sameValKey + 1;
        if(node.next.lastSameKey) {
            node.lastSameKey = node.next.lastSameKey;
            node.lastSameKey.firstSameKey = node;
            delete node.next.lastSameKey;
        } else {
            node.lastSameKey = node.next;
            node.next.firstSameKey = node;
        }
    } else
        // only element with this sortVal
        node.sameValKey = 0;
}

// This function removes the given node from the list (if it is in the list)

SortedList.prototype.removeNodeFromList = sortedListRemoveNodeFromList;

function sortedListRemoveNodeFromList(node)
{
    if(!node || typeof(node.next) == "undefined" ||
       typeof(node.prev) == "undefined")
        return;
    
    // before removing, transfer all iterators pointing at this node to
    // the previous node.
    if(node.iterators)
        this.transferIteratorsToPrevNode(node);
    
    // adjust the firstSameKey/lastSameKey pointers (if necessary)
    if(node.lastSameKey) {
        // this has the same sortVal as the next node
        if(node.lastSameKey == node.next)
            delete node.next.firstSameKey;
        else {
            node.lastSameKey.firstSameKey = node.next;
            node.next.lastSameKey = node.lastSameKey;
        }
        delete node.lastSameKey;
    } else if(node.firstSameKey) {
        // this has the same sortVal as the previous node
        if(node.firstSameKey == node.prev)
            delete node.prev.lastSameKey;
        else {
            node.firstSameKey.lastSameKey = node.prev;
            node.prev.firstSameKey = node.firstSameKey;
        }
        delete node.firstSameKey;
    }

    if(!node.next)
        this.last = node.prev;
    else
        node.next.prev = node.prev;

    if(!node.prev)
        this.first = node.next;
    else
        node.prev.next = node.next;

    delete node.prev;
    delete node.next;
}

// This function goes over all iterators pointing at this node, and moves
// them to the previous node. This requires an update of both the previous
// node and the iterator object.

SortedList.prototype.transferIteratorsToPrevNode = 
    sortedListTransferIteratorsToPrevNode;

function sortedListTransferIteratorsToPrevNode(node)
{
    if(!node.iterators)
        return;
    
    var prevNode = node.prev;
    var prevIterators;
    
    if(prevNode && !(prevIterators = prevNode.iterators))
        prevIterators = prevNode.iterators = {};
    
    for(var iteratorId in node.iterators) {
        
        var iterator = node.iterators[iteratorId];
        
        if(prevIterators)
            prevIterators[iteratorId] = iterator;
        
        iterator.node = prevNode;
    }
    
    delete node.iterators;
}

// This function returns true if there are no elements in the sorted list
// (the function only looks at the elements which are actually sorted,
// not at elements which were added with an undefined sort value).

SortedList.prototype.isEmpty = sortedListIsEmpty;

function sortedListIsEmpty()
{
    return (this.first === null);
}

// Given a path and a position
// { sortVal: <sort val>, sameValKey: <same val key> } this function returns
// true if the path is found in the sorted list and its position in the
// list is before the given position. Otherwise false is returned.
// If 'pos' is empty (undefined), true is returned if the path is found in the
// list and false otherwise (so undefined is considered the position after
// all entries).
// If the path is exactly at the position 'pos', false is returned.

SortedList.prototype.isBeforePos = sortedListIsBoforePos;

function sortedListIsBoforePos(path, pos)
{
    var node = this.getNode(path, true);

    if(!node || !("entry" in node))
        return false; // no entry in the list at this path

    if(!pos)
        return true;
    
    if(this.valLessThan(pos.sortVal, node.sortVal))
        return true;
    
    if(this.valLessThan(node.sortVal, pos.sortVal))
        return false;
    
    if(node.sameValKey > pos.sameValKey)
        return true;
    
    return false;
}

// Given a path and a position
// { sortVal: <sort val>, sameValKey: <same val key> } this function returns
// true if the path is found in the sorted list and its position in the
// list is after the given position. Otherwise false is returned.
// If 'pos' is empty (undefined), false is returned.
// If the path is exactly at the position 'pos', false is returned.

SortedList.prototype.isAfterPos = sortedListIsAfterPos;

function sortedListIsAfterPos(path, pos)
{
    var node = this.getNode(path, true);

    if(!node || !("entry" in node))
        return false; // no entry in the list at this path

    if(!pos)
        return false;
    
    if(this.valLessThan(node.sortVal, pos.sortVal))
        return true;
    
    if(this.valLessThan(pos.sortVal, node.sortVal))
        return false;
    
    if(pos.sameValKey > node.sameValKey)
        return true;
    
    return false;
}

// This function takes two position objects (objects with the format
// { sortVal: <sort val>, sameValKey: <same val key> }) and compares
// them. Returns -1 if pos1 is before pos2, 0 if they are equal and
// 1 if pos2 is before pos1.

SortedList.prototype.positionCompare = sortedListPositionCompare;

function sortedListPositionCompare(pos1, pos2)
{
    if(this.valLessThan(pos2.sortVal, pos1.sortVal))
        return -1;

    if(this.valLessThan(pos1.sortVal, pos2.sortVal))
        return 1;

    if(pos2.sameValKey < pos1.sameValKey)
        return -1;

    if(pos1.sameValKey < pos2.sameValKey)
        return 1;

    return 0;
}

// This function is the same as 'positionCompare' only the first position is
// given by a path, not the position itself. If the path is not found in
// the sorted list, this function returns 'undefined'.

SortedList.prototype.pathPositionCompare = sortedListPathPositionCompare;

function sortedListPathPositionCompare(path, pos)
{
    var node = this.getNode(path, true);

    if(!node || !("entry" in node))
        return undefined; // no entry in the list at this path

    return this.positionCompare(node, pos);
}

////////////////////////////////////////
// Default Value Comparison Functions //
////////////////////////////////////////

// These functions implement comparison based on the standard JS <, <=, ==
// operators.

SortedList.prototype.valsEqual = sortedListValsEqual;

function sortedListValsEqual(a, b)
{
    return (a == b);
}

SortedList.prototype.valLessThan = sortedListValLessThan;

function sortedListValLessThan(a, b)
{
    return (a < b);
}

SortedList.prototype.valLessOrEqual = sortedListValLessOrEqual;

function sortedListValLessOrEqual(a, b)
{
    return (a <= b);
}

////////////////////
// Debug Printing //
////////////////////

// This function prints out the content of this sorted list, from beginning
// to end (but without the paths).

SortedList.prototype.debugPrint = sortedListDebugPrint;

function sortedListDebugPrint()
{
    if(!this.first)
        console.log("sorted list: empty");
    else {
        console.log("sorted list:");
        for(var node = this.first ; node ; node = node.next) {
            console.log("sortVal: ", objToString(node.sortVal),
                        " sameValKey: ", node.sameValKey, " entry: ",
                        objToString(node.entry), "firstSameKey: ",
                        node.firstSameKey ?
                        objToString(node.firstSameKey.entry) : "undefined",
                        "lastSameKey: ",
                        node.lastSameKey ?
                        objToString(node.lastSameKey.entry) : "undefined");
        }
    }
}

//////////////
// Iterator //
//////////////

// Iterator constructor (based on the given sorted list). This assigns the
// iterator its ID. Upon construction, the iterator points before the first
// element of the list (one needs to call 'next()' to advance to the first 
// element).

function SortedListIter(sortedList)
{
    this.sortedList = sortedList;
    this.id = sortedList.getNextIteratorId();
    this.node = null;
    this.atEnd = false;
}

// Destroy the iterator. This move the iterator past the end of the list
// and removes its registration from the node it is pointing to. This needs
// to be called only if the iterator has not reached the end but one does not
// wish to use it anymore.

SortedListIter.prototype.destroy = sortedListIterDestroy;

function sortedListIterDestroy()
{
    if(this.node) {
        delete this.node.iterators[this.id];
        this.node = null;
    }

    this.atEnd = true;
}

// This function advances to the next node in the list. It returns the node
// reached after the iterator is advance or null if the end of the 
// list was reached.

SortedListIter.prototype.next = sortedListIterNext;

function sortedListIterNext()
{
    if(!this.node) {
        if(this.atEnd)
            return null; // at end
        this.node = this.sortedList.first;
    } else {
        // remove this iterator from the current node
        delete this.node.iterators[this.id];
        // advance to the next node
        this.node = this.node.next;
    }
    
    if(!this.node)
        this.atEnd = true;
    else {
        // store this iterator on the node
        if(!this.node.iterators)
            this.node.iterators = {};
        
        this.node.iterators[this.id] = this;
    }
    
    return this.node;
}

// This function returns the node the iterator is currently pointing at. This
// will be null if the iterator is positioned either before the start or after
// the end of the list.

SortedListIter.prototype.getNode = sortedListIterGetNode;

function sortedListIterGetNode()
{
    return this.node;
}


//////////////////////////////////////////////////////////////////////////////
//                               Derived Classes                            //
//////////////////////////////////////////////////////////////////////////////

///////////////////
// Pair Ordering //
///////////////////

// This derived class defines a lexicographic ordering on pairs (such that
// each element in the par can be compared using the standard JS <. <=, ==
// operators).

inherit(PairSortedList, SortedList);
function PairSortedList()
{
    // call the base class constructor
    this.SortedList();

    // indicate to the base class that a modified ordering is used.
    this.modifiedOrdering = true;
}

// The comparison functions below expect pairs (arrays) as input. This is
// not checked before applying the operation.

PairSortedList.prototype.valsEqual = pairSortedListValsEqual;

function pairSortedListValsEqual(a, b)
{
    return (a[0] == b[0] && a[1] == b[1]);
}

PairSortedList.prototype.valLessThan = pairSortedListValLessThan;

function pairSortedListValLessThan(a, b)
{
    return (a[0] < b[0] || (a[0] == b[0] && a[1] < b[1]));
}

PairSortedList.prototype.valLessOrEqual = pairSortedListValLessOrEqual;

function pairSortedListValLessOrEqual(a, b)
{
    return (a[0] < b[0] || (a[0] == b[0] && a[1] <= b[1]));
}

