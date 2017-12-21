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
// %%include%%: <scripts/utils/bptree.js>
// %%include%%: <scripts/utils/random.js>
// %%include%%: <scripts/utils/seedrandom.js>
// %%include%%: <scripts/utils/inheritance.js>
// %%include%%: <scripts/utils/trees/binaryTree.js>
// %%include%%: <scripts/utils/trees/redBlackTree.js>

var actualSeed = "mRXNVuTHBOx2";
// true when testing a red black tree and false when testing
// a standard binary tree.
var isRBTree = true;

function assert() {};

// This class wraps a BPTree with an interface which is similar
// to that of the binary tree

function defaultCompFunc(a, b)
{
    if(a < b)
        return -1;
    else if(a == b)
        return 0;
    else
        return 1;
}

inherit(TestBPTree, BPTree);

function TestBPTree()
{
    this.BPTree(50, defaultCompFunc, false);
}

TestBPTree.prototype.insertKey = testBPTreeInsertKey;

function testBPTreeInsertKey(key)
{
    this.insert(key, 1);
}

TestBPTree.prototype.removeKey = testBPTreeRemoveKey;

function testBPTreeRemoveKey(key)
{
    this.remove(key);
}

var binaryTree = isRBTree ? new RedBlackTree() : new BinaryTree();
var bpTree = new TestBPTree();

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

// we run the same test twice, once for a binary tree and once for a
// B-Tree. The time for each of these trees is measured and reported.

function runTest()
{
    // set the seed
    if (!actualSeed) {
        actualSeed = getRandomString(12);
    }
    console.log("seed", actualSeed);
    Math.seedrandom(actualSeed);
    
    var bpTreeTime = treeTest(bpTree);

    // reset the seed for the second round (should be identical to the first)
    Math.seedrandom(actualSeed);

    var binaryTreeTime = treeTest(binaryTree);
    
    console.log("binary tree: ", binaryTreeTime, "bp-tree:", bpTreeTime);
}

// run the test for the given tree. Returns the time elapsed in ms.

function treeTest(tree)
{
    // generate the keys
    var keys = [];
    var keyCount = {};
    var removeQueue = [];
    var removedQueue = [];

    for(var i = 0 ; i < 1000000 ; i++) {
        var newKey = Math.floor(Math.random() * 100000000); 
        keys.push(newKey);
        if(keyCount[newKey])
            keyCount[newKey]++;
        else
            keyCount[newKey] = 1;
    }

    var startTime = new Date();
    
    // add the keys to the test tree
    for(var i = 0, l = keys.length ; i < l ; ++i) {
        tree.insertKey(keys[i]);
        if(Math.random() >= 0.3) {
            // insert in a random position in the array
            removeQueue.splice(Math.floor(Math.random() * removeQueue.length), 
                               0, keys[i]);
        }
        while(removeQueue.length) {
            if(Math.random() >= 0.6) {
                var removedKey = removeQueue.shift();
                tree.removeKey(removedKey);
                removedQueue.push(removedKey);
            } else
                break;
        }
        while(removedQueue.length) {
            if(Math.random() >= 0.6) {
                // get a random key out of the array
                var removedPos = 
                    Math.floor(Math.random() * removedQueue.length);
                tree.insertKey(removedQueue[removedPos]);
                removedQueue.splice(removedPos, 1);
            } else
                break;
        }
    }

    while(removedQueue.length) {
        tree.insertKey(removedQueue.shift());
    }

    var endTime = new Date();

    return endTime.getTime() - startTime.getTime();
}
