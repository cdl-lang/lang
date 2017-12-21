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


// This file implements a red-black tree with an open interface allowing
// a derived class to track its rotation operations (this is used, for
// example, in a derived interval tree).
// This red-black tree is based on the BinaryTree class. The BinaryTree
// class implements a binary tree where each node is also linked to 
// the next and previous node in the tree, by order of keys.
// This property is maintained in the red-black tree so that it
// is possible to quickly extract all nodes within a certain range.
//
// The interface of the red-black tree is identical to that of the
// binary tree (only the insert and removal operations are 
// implemented differently, to allow for balancing of the tree).
// See the introduction of binaryTree.js for more details.

// %%include%%: "binaryTree.js"

inherit(RedBlackTree, BinaryTree);

// The constructor takes an optional comparison function as argument.

function RedBlackTree(compareFunc)
{
    this.BinaryTree(compareFunc);
}

// This function returns the node for the given key. If no node
// exists yet for this key, the node is added to the tree.
// After inserting the node using the insertion function of the base class
// binary tree, this function calls the function fixAfterInsertion() 
// which, if the node is new, colors it red and then adjusts the
// structure of the tree to ensure the properties of the red-black tree
// are preserved (and thus ensuring that it is reasonably balanced).
// (This function is taken from Cormen, Leiserson and Rivest, Introduction to
// Algorithms, 1998, section 14.3).
// The coloring of the node and the fixing of the tree structure are
// placed in a separate function so that classes which inherit this class
// can use the binary tree insertion and then perform some operation on 
// the inserted node before calling the fixAfterInsertion() function 
// to color the node and rebalance the tree.

RedBlackTree.prototype.insertKey = redBlackTreeInsertKey;
    
function redBlackTreeInsertKey(key)
{
    // perform the binary tree insertion
    var node = this.BinaryTree_insertKey(key);
    // set the color of the inserted node and fix the red black properties
    this.fixAfterInsertion(node);
    return node;
}

// This function is called after the node 'node' has been returned by
// the binary tree insertion function. If the node has the 'red' property
// (either true or false) then it is not a new node and there is nothing 
// to do. Otherwise, this function assigns the new node the color red
// and then modifies the structure of the red black tree (by recoloring
// nodes and performing rotations) so as to ensure that the red black 
// properties are preserved after the insertion.
// (This function is taken from Cormen, Leiserson and Rivest, Introduction to
// Algorithms, 1998, section 14.3).

RedBlackTree.prototype.fixAfterInsertion = redBlackTreeFixAfterInsertion;
    
function redBlackTreeFixAfterInsertion(x)
{
    if(x.red !== undefined)
        // existing node (already has the red/black property) no need to
        // rebalance
        return;

    // the new inserted node is red
    x.red = true;

    var p;    
    while(x != this.root && ((p = x.parent).red === true)) {
        if(p == p.parent.left) {
            var y = p.parent.right;
            if(y !== undefined && y.red === true) {
                p.red = false; // black
                y.red = false; // black
                p.parent.red = true;
                x = p.parent;
            } else {
                if(x == p.right) {
                    x = p;
                    this.rotateLeft(x);
                }
                (p = x.parent).red = false; // black
                p.parent.red = true;
                this.rotateRight(p.parent);
            }
        } else {
            // same as above, with left and right reversed
            var y = p.parent.left;
            if(y !== undefined && y.red === true) {
                p.red = false; // black
                y.red = false; // black
                p.parent.red = true;
                x = p.parent;
            } else {
                if(x == p.left) {
                    x = p;
                    this.rotateRight(x);
                }
                (p = x.parent).red = false; // black
                p.parent.red = true;
                this.rotateLeft(p.parent);
            }
        }
    }
    
    this.root.red = false; // that is, black
}

// This function removes from the tree the node 'node' (which is assumed
// to be in the tree). The first step in the removal is the standard
// binary tree removal, followed by a correction of the red-black tree
// properties.
// The fixing of the tree structure is placed in a separate function
// so that classes which inherit this class can use the binary tree
// removal and then perform some operation on the removed and
// remaining nodes before fixing the red black properties.

RedBlackTree.prototype.removeNode = redBlackTreeRemoveNode;
    
function redBlackTreeRemoveNode(node)
{
    // perform the binary tree deletion (the returned node y is the 
    // node actually spliced out of the tree).
    var y = this.BinaryTree_removeNode(node);

    this.fixAfterRemoval(y);
}

// This function is called after a node has been removed from the tree 
// using the binary tree removal function. The node 'y' is the node spliced
// out of the tree by this operation. This function then checks whether 
// the red black properties of the tree need to be fixes and fixes them,
// if necessary.  
// This function is based on the function appearing in 
// Cormen, Leiserson and Rivest, Introduction to Algorithms, 1998, 
// section 14.4. The only difference is that instead of using a sentinel node
// in case x below is undefined, we continue to use an undefined x,
// check for this case, where necessary (and also keeping an independent
// pointer to the parent of x, instead of reading the parent from x).

RedBlackTree.prototype.fixAfterRemoval = redBlackTreeFixAfterRemoval;
    
function redBlackTreeFixAfterRemoval(y)
{
    if(y.red === true)
        return; // maintains the red black tree properties
    
    // the spliced node must have had at most one child. The spliced node
    // itself is not modified in the removal (as it is about to be discarded)
    // so here we can get this child (placed in 'x').
    var x = (y.left !== undefined) ? y.left : y.right;
    var parent = y.parent; // the node under which x was inserted
    
    // if x is undefined, then the node p under which it x was inserted when y 
    // was spliced (p was the parent of y) must have another child which 
    // is not undefined. Otherwise, since y is black, p would have violated
    // before the removal the requirement that all paths from p to the
    // leaves have the same number of black nodes along them. Therefore,
    // also in the case of x === undefined we can use the criterion 
    // x == parent.left to check whether x was inserted as the left or
    // right leaf of p. x === undefined is a black node (by definition).

    // The deleted parent of x was black, perform deletion fixup for x
    while(parent !== undefined && (x === undefined || x.red !== true)) {
        if(x === parent.left) {
            var w = parent.right;
            if(w.red === true) {
                w.red = false; // black
                parent.red = true;
                this.rotateLeft(parent);
                w = parent.right; // changed by the rotation
            }
            if((w.left === undefined || w.left.red == false) &&
               (w.right === undefined || w.right.red == false)) {
                w.red = true;
                x = parent;
                parent = x.parent;
            } else { // at least one of the children of w is red
                if(w.right === undefined || w.right.red === false) {
                    w.left.red = false; // black
                    w.red = true;
                    this.rotateRight(w);
                    w = parent.right; // changed by the rotation
                }
                w.red = parent.red;
                parent.red = false; // black
                w.right.red = false;
                this.rotateLeft(parent);
                x = this.root;
                break;
            }
        } else {
            // the same, with left and right reversed
            var w = parent.left;
            if(w.red === true) {
                w.red = false; // black
                parent.red = true;
                this.rotateRight(parent);
                w = parent.left; // changed by the rotation
            }
            if((w.right === undefined || w.right.red == false) &&
               (w.left === undefined || w.left.red == false)) {
                w.red = true;
                x = parent;
                parent = x.parent;
            } else { // at least one of the children of w is red
                if(w.left === undefined || w.left.red === false) {
                    w.right.red = false; // black
                    w.red = true;
                    this.rotateLeft(w);
                    w = parent.left; // changed by the rotation
                }
                w.red = parent.red;
                parent.red = false; // black
                w.left.red = false;
                this.rotateRight(parent);
                x = this.root;
                break;
            }
        }
    }
    
    if(x !== undefined)
        x.red = false;
}

// This function performs the right rotation of node y in the tree:
//
//       |                 |
//      (y)               (x)
//     /   \             /   \
//   (x)    c      =>   a    (y)
//  /   \                   /   \
// a     b                 b     c
//
// This function assumes that the given node y (see diagram) has 
// a left child.

 
RedBlackTree.prototype.rotateRight = 
    redBlackTreeRotateRight;

function redBlackTreeRotateRight(y)
{
    // x is rotated together with y (see diagram above)
    var x = y.left;
    y.left = x.right;

    if(x.right !== undefined)
        x.right.parent = y;

    // set x under the former parent of y
    x.parent = y.parent;
    if(y.parent === undefined)
        this.root = x;
    else if(y == y.parent.left)
        y.parent.left = x;
    else
        y.parent.right = x;
    
    // re-connect y and x
    x.right = y;
    y.parent = x;
}

// This function performs the left rotation of node x in the tree:
//
//       |                 |
//      (x)               (y)
//     /   \             /   \
//    a    (y)     =>  (x)    c
//        /   \       /   \
//       b     c     a     b
//
// This function assumes that the given node x (see diagram) has 
// a right child.

RedBlackTree.prototype.rotateLeft = 
    redBlackTreeRotateLeft;

function redBlackTreeRotateLeft(x)
{
    // y is rotated together with x (see diagram above)
    var y = x.right;
    x.right = y.left;

    if(y.left !== undefined)
        y.left.parent = x;

    // set y under the former parent of x
    y.parent = x.parent;
    if(x.parent === undefined)
        this.root = y;
    else if(x == x.parent.left)
        x.parent.left = y;
    else
        x.parent.right = y;
    
    // re-connect x and y
    y.left = x;
    x.parent = y;
}
