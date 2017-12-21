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


// %%include%%: <scripts/utils/utils.js>
// %%include%%: <scripts/utils/random.js>
// %%include%%: <scripts/utils/seedrandom.js>
// %%include%%: <scripts/utils/inheritance.js>
// %%include%%: <scripts/utils/trees/binaryTree.js>
// %%include%%: <scripts/utils/trees/redBlackTree.js>

// This is a test version of the red black tree which defines its own
// rotation functions, to allow for counting of the number of rotations.

function TestRedBlackTree()
{
    this.rightRotations = 0;
    this.leftRotations = 0;
    this.RedBlackTree();
}

// rotate right and count this rotation

TestRedBlackTree.prototype.rotateRight = testRedBlackTreeRotateRight; 

function testRedBlackTreeRotateRight(y)
{
    this.rightRotations++;
    this.RedBlackTree_rotateRight(y);
}

// rotate left and count this rotation

TestRedBlackTree.prototype.rotateLeft = testRedBlackTreeRotateLeft; 

function testRedBlackTreeRotateLeft(x)
{
    this.leftRotations++;
    this.RedBlackTree_rotateLeft(x);
}

inherit(TestRedBlackTree, RedBlackTree);

var actualSeed; // = "iKlECVoPLOks";
// true when testing a red black tree and false when testing
// a standard binary tree.
var isRBTree = true;


var testTree = isRBTree ? new TestRedBlackTree() : new BinaryTree();

function main() {
    runTest();
}

if (typeof window === "undefined") {
    var argi = 2;
    while (argi < process.argv.length) {
        if (process.argv[argi] === "-l") {
            testLog = true;
            argi++;
        } else {
            break;
        }
    }
    if (argi !== process.argv.length) {
        actualSeed = process.argv[argi++];
    }
    runTest();
}

function runTest()
{
    // set the seed
    if (!actualSeed) {
        actualSeed = getRandomString(12);
    }
    console.log("seed", actualSeed);
    Math.seedrandom(actualSeed);

    // generate the keys
    var keys = [];
    var keyCount = {};
    var removeQueue = [];
    var removedQueue = [];

    for(var i = 0 ; i < 100 ; i++) {
        var newKey = Math.floor(Math.random() * 100); 
        keys.push(newKey);
        if(keyCount[newKey])
           keyCount[newKey]++;
        else
            keyCount[newKey] = 1;
    }

    // number of different keys
    var keyNum = Object.keys(keyCount).length;

    // add the keys to the test tree
    for(var i = 0, l = keys.length ; i < l ; ++i) {
        testTree.insertKey(keys[i]);
        console.log("inserting", keys[i]);
        if(Math.random() >= 0.3) {
            // insert in a random position in the array
            removeQueue.splice(Math.floor(Math.random() * removeQueue.length), 
                               0, keys[i]);
        }
        while(removeQueue.length) {
            if(Math.random() >= 0.6) {
                var removedKey = removeQueue.shift();
                if(testTree.removeKey(removedKey)) {
                    removedQueue.push(removedKey);
                    console.log("removing", removedKey);
                }
            } else
                break;
        }
        while(removedQueue.length) {
            if(Math.random() >= 0.6) {
                // get a random key out of the array
                var removedPos = 
                    Math.floor(Math.random() * removedQueue.length);
                var node = testTree.insertKey(removedQueue[removedPos]);
                console.log("re-inserting", node.key);
                removedQueue.splice(removedPos, 1);
            } else
                break;
        }
    }

    while(removedQueue.length) {
        var node = testTree.insertKey(removedQueue.shift());
        console.log("re-inserting", node.key);
    }

    var failed = false;

    // read out the keys in order (and count them)
    var sortedKeys = [];
    
    for(var node = testTree.first ; node ; node = node.next)
        sortedKeys.push(node.key);

    // check that the number of nodes is correct
    if(sortedKeys.length != keyNum) {
        failed = true;
        console.log("number of nodes in tree (", sortedKeys.length, 
                    ") differs from number of distinct keys:", keyNum);
    }

    // check that all the keys in the sorted list are in increasing order,
    // (not equal) and appear in the original list of keys
    for(var i = 0, l = sortedKeys.length ; i < l ; ++i) {
        if(!keyCount[sortedKeys[i]]) {
            failed = true;
            console.log("key", sortedKeys[i], " in tree but not in key list");
        }
        if(i > 0 && sortedKeys[i-1] >= sortedKeys[i]) {
            failed = true;
            console.log("tree not sorted, node number ", i, 
                        "is >= the next node", sortedKeys[i-1],
                        ">=", sortedKeys[i]);
        }
    }

    var range = [34, 69];

    // get all keys in this range
    var keysInRange = {};
    for(var node = testTree.find(range[0]) ; node && node.key <= range[1] ; 
        node = node.next) {
        keysInRange[node.key] = true;
    }

    // check if we have missed any keys
    for(var i = 0, l = keys.length ; i < l ; ++i) {
        if(keys[i] >= range[0] && keys[i] <= range[1] && !keysInRange[keys[i]]){
            failed = true;
            console.log("key", keys[i], "in range", range[0], ",", range[1],
                        "but is not in extracted key range", keysInRange);
        }
    }

    // check that all extracted keys are in range
    for(var rangeKey in keysInRange)  {
        if(rangeKey < range[0] || rangeKey > range[1]) {
            failed = true;
            console.log("key", rangeKey, "extracted by range", range[0], 
                        ",", range[1], "but is not in range");
        }
    }

    if(isRBTree) {
        // check that the red black tree properties hold
        if(!testRB(testTree.root))
            failed = true;
    }

    if(failed)
        console.log("test failed");
    else
        console.log("test succeeded");

    console.log("keys extracted in range", range[0], ",", range[1], ":",
                Object.keys(keysInRange));
    console.log("sorted keys:", sortedKeys);
    if(isRBTree) {
        console.log("left rotations: ", testTree.leftRotations);
        console.log("right rotations: ", testTree.rightRotations);
    }
}

// given a node in a red black tree, this function checks whether the
// tree fulfills the red black properties. It returns the number
// of black nodes on the path from the node to any of the leaf nodes
// under it if the properties hold and undefined otherwise. 

function testRB(node)
{
    if(node.left === undefined && node.right === undefined)
        return (node.red ? 1 : 2);

    if(node.red && node.left && node.left.red) {
        console.log("red node with key", node.left.key, 
                    "is left child of red node with key", node.key);
        return undefined;
    }
    if(node.red && node.right && node.right.red) {
        console.log("red node with key", node.right.key, 
                    "is right child of red node with key", node.key);
        return undefined;
    }

    var depthLeft = node.left ? testRB(node.left) : 1;

    if(!depthLeft)
        return undefined;
    
    var depthRight = node.right ? testRB(node.right) : 1;
    
    if(!depthRight)
        return undefined;
    
    if(depthLeft != depthRight) {
        console.log("left black path depth under node with key ", node.key, 
                   "is", depthLeft, "but the right black path depth is", 
                   depthRight);
        return undefined;
    }
    
    return depthLeft + (node.red ? 0 : 1);
}
