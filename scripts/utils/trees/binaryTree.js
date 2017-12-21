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


// This file implements a basic binary tree data structure. It allows for
// insertion, deletion and search on the tree. In addition to the basic
// binary tree structure, each node is also linked to the previous and
// next node (in key order) in the tree. This allows for quick extraction
// of a sequence of nodes within a range of key values.
//
// Data should be stored in the tree by first inserting the key into
// the tree by calling BinaryTree.insertKey(<key>). This function 
// returns the node with the given key (which may have already
// existed in the tree or is new). The value one wishes to store under
// the key should then be stored under the 'value' field of this 
// node. It is up to the mosule using the binary tree to determine
// how to add the new value to any existing value on the node.

// To extract all nodes whose key fall in a range [x,y], one should
// run the following loop:
//
//   for(var node = <tree object>.find(x) ; node && node.key <= y ; 
//       node = node.next) {
//        // 'node' is in the required range, do something with it
//   }
//
// To get the first and last nodes (by key order) in the tree, use
// <tree object>.first and <tree object>.last.

// The binary tree object is simply a pointer to the root of the tree
// and to the first and last nodes in the tree. The constructor takes 
// an optional comparison function as argument.

function BinaryTree(compareFunc)
{
    this.root = undefined;
    this.first = undefined;
    this.last = undefined;

    if(compareFunc)
        this.compare = compareFunc;

    this.allocateTreeNode = this.defaultAllocateTreeNode;
}

// default function used to allocate a tree node. A derived class
// may override this.

BinaryTree.prototype.defaultAllocateTreeNode =
    binaryTreeDefaultAllocateTreeNode;

function binaryTreeDefaultAllocateTreeNode(key, parent, prev, next)
{
    return new BinaryTreeNode(key, parent, prev, next);
}

// This function compares two key values, but it only works for
// numbers. For comparing other types, a derived class should be created
// with the proper comparison function, or a comparison may be provided as
// an argument for the constructor. The comparison function should return
// a negative number when a < b, 0 when a === b, and a positive number
// when a > b. Special care has to be taken to compare with Infinity:
// we require that compare(Infinity, Infinity) === 0. For a string tree,
// localeCompare could be used.
// Note that this function is inherited and used by RedBlackTree and
// IntervalTree.

BinaryTree.prototype.compare = binaryTreeCompare;

function binaryTreeCompare(a, b) 
{
    return a === b ? 0 : a - b;
}

// Returns true if this tree does not store any values and false otherwise. 

BinaryTree.prototype.isEmpty = binaryTreeIsEmpty;

function binaryTreeIsEmpty()
{
    return (this.root === undefined);
}

// This function returns the node for the inserted key (whether it is
// new or already existing).

BinaryTree.prototype.insertKey = binaryTreeInsertKey;

function binaryTreeInsertKey(key)
{
    var parent;
    var node;
    var cmp;

    // find insertion position
    for(node = this.root ; node ; node = cmp < 0? node.left: node.right) {
        cmp = this.compare(key, node.key);
        if(cmp === 0)
            return node; // already exists
        parent = node;
    }
    
    if(parent === undefined) {
        node = this.root = this.allocateTreeNode(key);
        this.first = node;
        this.last = node;
    } else if(this.compare(key, parent.key) < 0) {
        node = parent.left = 
            new this.allocateTreeNode(key, parent, parent.prev, parent);
        if(parent.prev)
            parent.prev.next = node;
        else
            this.first = node;
        parent.prev = node;
    } else {
        node = parent.right = 
            new this.allocateTreeNode(key, parent, parent, parent.next);
        if(parent.next)
            parent.next.prev = node;
        else
            this.last = node;
        parent.next = node;
    }
    
    return node;
}

// This function removes the node for the given key from the tree. It first
// looks for the node with the given key. If no such node is found,
// the function does nothing and returns false. Otherwise, it removes
// the node and returns true.

BinaryTree.prototype.removeKey = binaryTreeRemoveKey;

function binaryTreeRemoveKey(key)
{
    var cmp;

    // find the node
    for(var node = this.root ; node ; 
        node = cmp < 0 ? node.left : node.right) {
        cmp = this.compare(node.key, key);
        if(cmp === 0) {
            this.removeNode(node);
            return true;
        }
    }

    return false; // no matching node found

}

// Remove the given node from the tree (the function assumes the given node
// appears inside the tree).
// A node is chosen for splicing (removing out of the tree structure)
// which has at most one child. The child of the spliced node
// is tehn inserted in the position previously occupied by the spliced node.
// If the spliced node is not the removed node, the content of the spliced
// node is copied to the removed node (which remains in the tree).
// This function returns the node just spliced (this is for use by 
// derived classes which need to rebalance the tree after the removal).

BinaryTree.prototype.removeNode = binaryTreeRemoveNode;

function binaryTreeRemoveNode(node)
{
    var splice;

    if(node.left === undefined || node.right === undefined)
        splice = node;
    else
        splice = node.next;
    
    // splice the spliced node out of the linked list
    if(splice.prev)
        splice.prev.next = splice.next;
    else
        this.first = splice.next;
    if(splice.next)
        splice.next.prev = splice.prev;
    else
        this.last = splice.prev;

    // spliced node can have at most one child. This child needs
    // to be inserted in the position where the splice node was
    var child = (splice.left !== undefined) ? splice.left : splice.right;

    if(child !== undefined)
        child.parent = splice.parent;
    if(splice.parent === undefined)
        this.root = child;
    else if(splice == splice.parent.left)
        splice.parent.left = child;
    else
        splice.parent.right = child;

    // if the node spliced was not the node deleted, we need to copy
    // the content of the spliced node (which should remain in the tree)
    // to the removed node (which remains in the tree, but should not)
    // we use a function to do this, so that a derived class can store 
    // other information on the node.
    if(splice != node)
        this.copySplicedToRemovedNode(splice, node);

    return splice;
}

// This is a default implementation of a function which is used in the 
// removal function to copy the content of the spliced node to the removed
// node (in case they are not the same). This function only copies the content
// of the node (including the key) but does not change the left/right/parent
// links of the node.
// This default implementation of this copy function assumes that the node
// has two content fields: 'key' and 'value'. A derived class can override
// this function if it uses other content fields on the node or if it needs
// to preserve some of the content of the removed node on the removed node
// even when its key is replaced with that of the spliced node.

BinaryTree.prototype.copySplicedToRemovedNode = 
    binaryTreeCopySplicedToRemovedNode;

function binaryTreeCopySplicedToRemovedNode(spliced, removed)
{
    removed.key = spliced.key;
    removed.value = spliced.value;
}

// Given a key value, this function returns the node with the smallest
// key in the tree that is larger or equal the given key (this may return
// undefined if the requested key is larger than all keys in the tree). 

BinaryTree.prototype.find = binaryTreeFind;

function binaryTreeFind(key)
{
    var node = this.root;
    while(node) {
        var cmp = this.compare(key, node.key);
        if(cmp < 0) {
            if(node.left === undefined)
                // no exact match, this is the first node after the search key
                return node;
            node = node.left;
        } else if(cmp === 0)
            return node;
        else if(node.right == undefined)
            return node.next; // == node.parent
        else
            node = node.right;
    }
    return undefined;
}

BinaryTree.prototype.print = binaryTreePrint;
function binaryTreePrint() {
    if (this.root !== undefined) {
        this.root.print("");
    }
}

// This is the basic node stored in the binary tree. It has the following
// fields:
// parent: pointer the the parent node
// left, right: pointers to the left (smaller) and right (larger) 
//   child, respectively.
// prev, next: pointers to predecessor and successor nodes (in key order)
//   in the tree.
// key: the key used to sort the tree.
// value: the value to be stored under the given key.

function BinaryTreeNode(key, parent, prev, next)
{
    this.parent = parent;
    this.left = undefined;
    this.right = undefined;
    this.prev = prev;
    this.next = next;
    this.key = key;
    this.value = undefined;
}

BinaryTreeNode.prototype.print = binaryTreeNodePrint;
function binaryTreeNodePrint(indent) {
    if (this.left !== undefined)
        this.left.print(indent + "  ");
    console.log(indent + config2str(this.key), "=>", config2str(this.value));
    if (this.right !== undefined)
        this.right.print(indent + "  ");
}
