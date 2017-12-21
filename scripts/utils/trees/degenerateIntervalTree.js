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


// This file implements a tree with a similar functionality to that of
// IntervalTree except that only degenerate intervals [x,x] can be
// stored in it. The tree is then a standand red-black tree, which 
// stores the ID of each degenerate interval in the 'value' object
// of the node whose key is equal to the end-points of that degenerate
// interval.
//
// This structure provides a uniform interface when we sometimes want
// to store only degnerate intervals and sometimes non-degenerate
// intervals. When the first non-degenerate interval is to be added,
// one can create an IntervalTree object, import all nodes from 
// the DegenerateIntervalTree object and continue working with the
// IntervalTree.
//
// One can also work only with interval trees (as these also support
// the storage of degenerate intervals) but these are less efficient
// for the degnerate case and, therefore, if only degnerate intervals
// are stored, it is often better to use the DegenerateIntervalTree.
//
// The implementation of DegenerateIntervalTree adds only a thin interface
// layer over the base red-black tree class. On every node in the tree,
// the following fields are added:
// {
//    value: <IdStorage>
// }
// where IdStorage allows IDs to be stored for quick access.
//

// %%include%%: "redBlackTree.js"
// %%include%%: "idStorage.js"

inherit(DegenerateIntervalTree, RedBlackTree);

var debugAllDegenerateIntervalTrees;

// The constructor takes an optional comparison function as argument.
// If the comparison function is undefined, this class assumes the values
// stored here are non-negative integers. The default comparison function
// can, however, handle non-integer numbers, so to use the default comparison
// function but for values which are not necessrily non-negative integers,
// the second argument should be set to true.

function DegenerateIntervalTree(compareFunc, nonIntegerValues)
{
    this.RedBlackTree(compareFunc);

    var hasIntValues = (compareFunc === undefined && !nonIntegerValues);
    
    this.storageAllocate = hasIntValues ?
        this.intStorageAllocate : this.nonIntStorageAllocate;

    if(hasIntValues)
        this.allocateTreeNode = this.allocateIntTreeNode;

    if(debugAllDegenerateIntervalTrees)
        debugAllDegenerateIntervalTrees.push(this);
}

DegenerateIntervalTree.prototype.intStorageAllocate =
    degenerateIntervalTreeIntStorageAllocate;

function degenerateIntervalTreeIntStorageAllocate()
{
    return new IntIdStorage();
}

DegenerateIntervalTree.prototype.nonIntStorageAllocate =
    degenerateIntervalTreeNonIntStorageAllocate;

function degenerateIntervalTreeNonIntStorageAllocate()
{
    return new IdStorage();
}

DegenerateIntervalTree.prototype.allocateIntTreeNode =
    degenerateIntervalTreeAllocateIntTreeNode;

function degenerateIntervalTreeAllocateIntTreeNode(key, parent, prev, next)
{
    return new IntBinaryTreeNode(key, parent, prev, next);
}

    
// This function adds the point with the given ID and key to the tree.
// This does not remove any existing point with the same key (as there
// is no way of finding it). It is the responsibility of the calling
// function to first remove the old point if this ID was previously stored
// under a different key.

DegenerateIntervalTree.prototype.insertPoint = 
    degenerateIntervalTreeInsertPoint;

function degenerateIntervalTreeInsertPoint(id, key)
{
    var node = this.insertKey(key);

    if(node.value === undefined)
        node.value = this.storageAllocate();

    if(!node.value.has(id))
        node.value.set(id, true);
}

// This function removes the point with the given ID from the tree.
// The key under which the ID was previously stored in the tree must be
// provided so that the function can find the correct node.
// If the node on which the ID was stored only holds this ID, the node
// is removed from the tree at the end of this operation.

DegenerateIntervalTree.prototype.removePoint = 
    degenerateIntervalTreeRemovePoint;

function degenerateIntervalTreeRemovePoint(id, key)
{
    // get the node with the smallest key which is larger or equal 
    // the given key.
    var node = this.RedBlackTree_find(key);

    if(node === undefined || this.compare(node.key, key) ||
       node.value === undefined)
        return; // not stored in tree

    if(node.value.has(id)) {
        node.value.delete(id);
        if(node.value.size == 0)
            this.removeNode(node);
    }
}

//////////////////////
// Lookup Functions //
//////////////////////

// This function returns an array with all IDs stored in the first entry.
// An empty array is returned if the tree is empty.

DegenerateIntervalTree.prototype.getFirst = degenerateIntervalTreeGetFirst;

function degenerateIntervalTreeGetFirst()
{
    var node = this.first;

    if(!node || node.value.size == 0)
        return [];

    return node.value.getList();
}

// Returns the first key in the tree (or undefined if the tree is empty).

DegenerateIntervalTree.prototype.getFirstKey =
    degenerateIntervalTreeGetFirstKey;

function degenerateIntervalTreeGetFirstKey()
{
    var node = this.first;


    if(node === undefined)
        return undefined;

    return node.key;
}

// This function returns an array with all IDs stored under the given key.

DegenerateIntervalTree.prototype.find = degenerateIntervalTreeFind;

function degenerateIntervalTreeFind(key)
{
    // get the node with the smallest key which is larger or equal 
    // the given key.
    var node = this.RedBlackTree_find(key);

    if(!node || this.compare(node.key, key) || node.value.size == 0)
        return [];

    return node.value.getList(0);
}

// This function returns an array with all IDs stored under keys in the 
// interval <lowKey, highKey> where openLow and openHigh indicate
// whether the low/high end of this interval should be considered closed
// or open.

DegenerateIntervalTree.prototype.findIntersections = 
    degenerateIntervalTreeFindIntersections;

function degenerateIntervalTreeFindIntersections(lowKey, highKey, openLow, 
                                                 openHigh)
{
    var cmpLowKeyHighKey = this.compare(lowKey, highKey);

    if(cmpLowKeyHighKey == 0) {
        if(openLow || openHigh)
            return []; // empty search interval
        return this.find(lowKey);
    }

    if(cmpLowKeyHighKey > 0) {
        var temp = lowKey;
        lowKey = highKey;
        highKey = temp;
    }

    var matchedIds = [];

    // get the node with the smallest key which is larger or equal 
    // the given key.
    var node = this.RedBlackTree_find(lowKey);

    if(openLow && node && !this.compare(node.key, lowKey))
        node = node.next;

    var cmpNodeKeyHighKey;
    
    while(node && 
          ((cmpNodeKeyHighKey = this.compare(node.key, highKey)) < 0 ||
           (!openHigh && cmpNodeKeyHighKey == 0))) {
        if(node.value.size > 0)
            node.value.pushTo(matchedIds);
        node = node.next;
    }
    
    return matchedIds;
}

// This function returns an array with all IDs stored under keys in the 
// interval <lowKey, highKey> where openLow and openHigh indicate
// whether the low/high end of this interval should be considered closed
// or open.
// Since only degenerate intervals are stored in this tree, this function 
// is identical to findIntersections(), but is required to ensure a uniform
// interface with the general IntervalTree.

DegenerateIntervalTree.prototype.findContained = 
    degenerateIntervalTreeFindContained;

function degenerateIntervalTreeFindContained(lowKey, highKey, openLow, openHigh)
{
    return this.findIntersections(lowKey, highKey, openLow, openHigh);
}

// This function returns an array with all IDs stored under keys which 
// are smaller than upperBound (or equal to upperBound if upperBoundOpen
// is false) and are in the interval <lowKey, highKey> 
// where openLow and openHigh indicate whether the low/high end of this 
// interval should be considered closed or open.
// After correcting the interval <lowKey, highKey> so that it does not
// extend beyond upperBound (and if highKey is equal to upperBound, the
// high end of the interval is made open if the uuper bound is open) 
// this function is identical to findIntersections(). This function is 
// mainly required to ensure a uniform interface with the general IntervalTree.

DegenerateIntervalTree.prototype.findWithUpperBound = 
    degenerateIntervalTreeFindWithUpperBound;

function degenerateIntervalTreeFindWithUpperBound(lowKey, highKey, openLow, 
                                                  openHigh, upperBound, 
                                                  upperBoundOpen)
{
    var cmpLowHigh = this.compare(lowKey, highKey);

    if(cmpLowHigh > 0) { // lowKey > highKey 
        // reverse key order (but not the 'open' flag order)
        var temp = lowKey;
        lowKey = highKey;
        highKey = temp;
        cmpLowHigh = -cmpLowHigh;
    }
    
    var cmpHighBound = this.compare(highKey, upperBound);

    if(cmpHighBound >= 0) {  // highKey >= upperBound
        if(cmpHighBound > 0) {
            highKey = upperBound;
            if((cmpLowHigh = this.compare(lowKey, highKey)) > 0)
                return []; // upper bound lower than low key, no match possible
        }
        if(upperBoundOpen)
            openHigh = true;
    }

    if(cmpLowHigh == 0 && (openLow || openHigh))
        return []; // empty interval

    return this.findIntersections(lowKey, highKey, openLow, openHigh);
}

// This function returns an array with all IDs stored under keys which 
// are larger than lowerBound (or equal to lowerBound if lowerBoundOpen
// is false) and are in the interval <lowKey, highKey> 
// where openLow and openHigh indicate whether the low/high end of this 
// interval should be considered closed or open.
// After correcting the interval <lowKey, highKey> so that it does not
// extend below lowerBound (and if lowKey is equal to lowerBound, the
// low end of the interval is made open) this function is identical 
// to findIntersections(). This function is mainly required to ensure
// a uniform interface with the general IntervalTree.

DegenerateIntervalTree.prototype.findWithLowerBound = 
    degenerateIntervalTreeFindWithLowerBound;

function degenerateIntervalTreeFindWithLowerBound(lowKey, highKey, openLow, 
                                                  openHigh, lowerBound, 
                                                  lowerBoundOpen)
{
    var cmpLowHigh = this.compare(lowKey, highKey);

    if(cmpLowHigh > 0) { // lowKey > highKey 
        // reverse key order (but not the 'open' flag order)
        var temp = lowKey;
        lowKey = highKey;
        highKey = temp;
        cmpLowHigh = -cmpLowHigh;
    }
    
    var cmpLowBound = this.compare(lowKey, lowerBound);

    if(cmpLowBound <= 0) {  // lowKey <= lowerBound
        if(cmpLowBound < 0) {
            lowKey = lowerBound;
             if((cmpLowHigh = this.compare(lowKey, highKey)) > 0)
                 // lower bound higher than high key, no match possible
                 return [];
        }
        if(lowerBoundOpen)
            openLow = true;
    }

    if(cmpLowHigh == 0 && (openLow || openHigh))
        return []; // empty interval

    return this.findIntersections(lowKey, highKey, openLow, openHigh);
}

//
// debugging functions
//

DegenerateIntervalTree.prototype.debugGetValueDistribution = 
    degenerateIntervalTreeDebugGetValueDistribution;

function degenerateIntervalTreeDebugGetValueDistribution(smallSetSize)
{
    var totalIds = 0;
    var totalIdsWithHash = 0;
    var totalIdsWithMap = 0;
    var totalHashBuffer = 0;
    var totalEmptyNodes = 0;
    var totalNodes = 0;
    
    for(var node = this.first ; node ; node = node.next) {

        totalNodes++;
        
        if(node.value.size === 0) {
            totalEmptyNodes++;
            continue;
        }
        totalIds += node.value.size;
        if(node.value.hashSet !== undefined) {
            totalIdsWithHash += node.value.hashSet.size;
            totalHashBuffer += node.value.hashSet.buffer.length;
        } else if(node.value.idSet !== undefined)
            totalIdsWithMap += node.value.idSet.size;
    }

    return {
        totalIds: totalIds, 
        totalIdsWithHash: totalIdsWithHash, 
        totalIdsWithMap: totalIdsWithMap,
        totalHashBuffer: totalHashBuffer,
        totalEmptyNodes: totalEmptyNodes,
        totalNodes: totalNodes
    };
}

function debugGetValueDistribution()
{
    var distribution = {
        totalIds: 0,
        totalIdsWithHash: 0,
        totalIdsWithMap: 0,
        totalHashBuffer: 0,
        totalEmptyNodes: 0,
        totalNodes: 0
    };

    for(var i = 0, l = debugAllDegenerateIntervalTrees.length ; i < l ; ++i) {
        var treeDistribution = debugAllDegenerateIntervalTrees[i].
            debugGetValueDistribution();

        distribution.totalIds += treeDistribution.totalIds;
        distribution.totalIdsWithHash += treeDistribution.totalIdsWithHash;
        distribution.totalIdsWithMap +=
            treeDistribution.totalIdsWithMap;
        distribution.totalHashBuffer += treeDistribution.totalHashBuffer;
        distribution.totalEmptyNodes += treeDistribution.totalEmptyNodes;
        distribution.totalNodes += treeDistribution.totalNodes;
    }

    return distribution;
}
