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


// This file implements a forest of trees which allows fast merging and
// splitting of trees while also allowing to quickly determine whether
// two node are in the same tree in the forest and if they are, allows
// to quickly find the path between these nodes.
//
// There is always some tradeoff between the efficiency of these operations,
// where maintaining the optimal structure for quickly determining whether
// two nodes are in the same tree and finding the path between them
// requires more processing when trees are split or merged.
// The implementation here tries to strike a balance between the various
// operations.

// Every tree is assigned an ID, which is recorded on the root of the tree.
// Every node carries the ID of the tree it belongs to and a pointer
// to the root of that tree.
//
// When a tree is split, both parts of the tree receive new IDs (this excludes
// the case where a leaf node is removed from a tree, in which case that
// node is destroyed and the remaining tree remains unchanged).
// When trees are merged, the root of the merged tree is the root of one of
// the two merged trees. The ID of this tree remains unchanged, but the
// ID of the other tree is removed from its root (the ID becomes an empty ID)
// as that root is no longer a root in the new tree.
//
// These ID changes are not immediately updated on nodes of the tree(s).
// Instead, when a node is accessed, it first checks whether the ID
// recorded on it matches that of the root to which it points. If there
// is a mismatch, the node has to follow the upward path along
// the edges until it reaches the root of the tree it currently belongs
// to (since the node was last updated there may have been multiple splits
// and merges).
//
// In addition to the tree ID, each tree also has a depthId. This is an ID
// which changes when the structure of a tree changes but the tree's root and
// the nodes belonging to the tree do not change. The depth ID is not unique
// to a tree and is not changed when the tree ID is changed (it could have been
// changed but this would be redundant).
// Most operations ignore the depth ID and only consider the tree ID.
// However, operations which use the depth of a node (see below) also check
// that the depth ID has not changed since the depth of the node was
// calculated.
//
// At each node, the algorithm indicates which edge leaving it is
// in the 'up' direction (that is, leading to the root).  When a tree
// is split, this edge does not change. When two trees are merged,
// this edge only has to be changed for the edges connecting the point
// of attachment and the root of the tree whose root is not the root of
// the merged tree.
//
// Finally, when the ID of the root is recorded on a node, we also record
// the depth of the node under the root (this speeds up the search for
// the path between nodes in a tree).
//
// The data structure of a forest is a list of all nodes in the forest
// (indexed by their names). Each such node carries the nodes to which it is
// connected by an edge. These nodes are split into a list of down nodes
// and (at most) a single up node (the down nodes are the nodes further
// away from the root while the up node is on the path to the root).
// In addition, every node carries the tree ID to which it belongs and a
// pointer to the root node of that tree (unless the node itself is the
// root). Finally, the node carries the distance of the node from the root. 
//

//
// ID assignment to trees
//

// Tree node structure

// A tree node has the following structure:
// name: the label of this node
// up: The node attached to this node and leading to the root. This is null
//     iff this node is the root of the tree.
// down: An object holding the nodes under this node (in the tree).
//       Each node appears under its name.
//       This structure is not used to maintain the forest but is provided
//       as a service for external modules which wish to traverse the trees.
// downNum: the number of nodes in the 'down' object (number of down edges).
// treeId: ID of the tree to which this node belongs (might not be up-to-date,
//         but if so, cannot agree with the ID of the tree of the root it
//         points to). This is a number.
// depthId: An additional ID for the depth of the tree (this may change in
//          situations where the tree ID does not change). If the depth ID
//          of a node does not agree with that of its root, the depth of
//          the nodes needs to be recalculated.
// root: a pointer to the root of the tree to which the node belongs
//       (might not be up-to-date but then the node pointed to is not a root
//       anymore or the ID of the root does not agree with treeId).
// depth: The depth of the node under the root (the depth of the root is 0).
//        This might be not up-to-date if the root is not up-to-date.
// isRoot: true/false if this node is the root of a tree

// Tree ID assignment

var treeIdCounter = 0; // Number of IDs already assigned

function nextTreeId()
{
    return ++treeIdCounter;
}

// Constructor

// The constructor is called when a node is created and at this stage the node
// is always a leaf of the tree (perhaps the root of a tree with a single
// node). The constructor therefore receives two arguments - the name of the
// node and the node in the tree to which it is attached. From this node
// it gets the tree ID and root. If no attachment node is given then this
// node is constructed as the root of a new tree (which has no other nodes).

function TreeNode(name, upNode)
{
    this.name = name;
    this.up = upNode;
    this.down = {};
    this.downNum = 0; // number of 'down' edges.
    
    if(upNode) { // not a root node
        this.isRoot = false;
        this.root = upNode.root;
        this.treeId = upNode.treeId;
        this.depthId = upNode.depthId;
        this.depth = upNode.depth + 1;
        upNode.down[name] = this;
        upNode.downNum++;
    } else { // a root node
        this.isRoot = true;
        this.root = this;
        this.treeId = nextTreeId();
        this.depthId = 0;
        this.depth = 0;
    }
}

// This function makes the node into a root node.

TreeNode.prototype.makeIntoRoot = treeNodeMakeIntoRoot;

function treeNodeMakeIntoRoot()
{
    this.up = null; // this now becomes a root
    this.root = this;
    this.isRoot = true;
    this.depth = 0;
    this.treeId = nextTreeId();
    this.depthId = 0;
}

//
// Node administration 
//

// This function return true if the information on the node, except perhaps
// for the depth, is up-to-date.

TreeNode.prototype.isUpToDate = treeNodeIsUpToDate;

function treeNodeIsUpToDate()
{
    return (this.isRoot ||
            (this.root.isRoot && this.treeId == this.root.treeId));
}

// This function return true if the depth information on the node is
// up-to-date (this also implies that all the rest of the information is
// up-to-date.

TreeNode.prototype.isDepthUpToDate = treeNodeIsDepthUpToDate;

function treeNodeIsDepthUpToDate()
{
    return (this.isRoot ||
            (this.root.isRoot && this.treeId == this.root.treeId &&
             this.depthId == this.root.depthId));
}

// This function returns the ID of the tree to which the given node belongs
// to. If the tree name registered on the node is not up-to-date, calling
// this function updates root information on the node as well as the depth
// of the node under the root.

TreeNode.prototype.getTreeId = treeNodeGetTreeId;

function treeNodeGetTreeId()
{
    if(this.isUpToDate())
        return this.treeId;

    // ID registered on the node is not up-to-date. Follow path up to root
    this.depth = 0;
    this.root = this;
    while(!this.root.isRoot) {
        ++this.depth;
        this.root = this.root.up;
    }

    this.depthId = this.root.depthId;
    return (this.treeId = this.root.treeId);
}

// This function returns the depth of the node under the root of the tree.
// If the depth registered on the node is not up-to-date, this function
// caluclates the depth by looping up the tree.

TreeNode.prototype.getDepth = treeNodeGetDepth;

function treeNodeGetDepth()
{
    if(this.isDepthUpToDate())
        return this.depth;

    // Depth registered on the node is not up-to-date. Follow path up to root
    this.depth = 0;
    this.root = this;
    while(!this.root.isRoot) {
        ++this.depth;
        this.root = this.root.up;
    }

    this.treeId = this.root.treeId;
    this.depthId = this.root.depthId;

    return this.depth;
}

// This function returns the root of the tree to which this node belongs.
// The function first checks whether the root entry is up-to-date. If not,
// it updates all the relevant information on the node before returning
// the root node.

TreeNode.prototype.getRootNode = treeNodeGetRootNode;

function treeNodeGetRootNode()
{
    this.getTreeId();
    return this.root;
}

// Returns true if this node is a leaf node, that is, as no 'down' nodes.

TreeNode.prototype.isLeaf = treeNodeIsLeaf;

function treeNodeIsLeaf()
{
    return (this.downNum == 0);
}

// Forest constructor

function Forest()
{
    this.nodes = {}; // an index of all nodes in the forest
}

// returns true if the given name is of a node in the forest and false
// otherwise. A true return value means that there is an edge attached
// to the node with this name.

Forest.prototype.nodeInForest = forestNodeInForest;

function forestNodeInForest(name)
{
    return (name in this.nodes);
}

// get the tree node for the node with the given name

Forest.prototype.getNode = forestGetNode;

function forestGetNode(name)
{
    return this.nodes[name];
}

// This function returns true if the node with the given name is the root
// of a tree in the forest. If there is no node by this name in the forest,
// false is returned.

Forest.prototype.isRoot = forestIsRoot;

function forestIsRoot(name)
{
    return ((name in this.nodes) && this.nodes[name].isRoot);
}

// This function returns true if the node with the given name is a leaf node
// in the forest (that is, has no 'down' nodes attached to it). Otherwise,
// false is returned. If there is no node by this name in the forest,
// false is returned.

Forest.prototype.isLeaf = forestIsLeaf;

function forestIsLeaf(name)
{
    return ((name in this.nodes) && this.nodes[name].isLeaf());
}

//
// Basic forest operations (adding, removing and replacing edges)
//

// This function adds the given edge (an array of two node names) to the
// forest. It creates the nodes if they do not yet exist.
// If the edge cannot be added (if the edge entry given was corrupted
// or if the edge already exists or would create a cycle).
// If an edge is created, true is returned.
// If 'notifyMeOfTreeChanges' is provided, it should be an object which
// implements the function notifyTreesMerged(<root of merged tree>,
// <up node of added edge>, <down node of edge>)
// and the function notifyEdgeAdded(<node name 1>, <node name 2>).
// If this object is provided and, as a result of adding the given
// edge, two trees were merged, the function notifyTreesMerged() is
// called with the root of the merged tree as the first argument (this node
// is no longer a root node after the merge) and the nodes of the edge added
// as the two following arguments (with th first of these being the 'up' node
// of the edge). If at least one of the nodes of the given edge do not
// yet exist in the forest, the edge is added and the function
// notifyEdgeAdded(<node name 1>, <node name 2>) is called (with the names
// of the two points as arguments). This means that either notifyTreesMerged()
// or notifyEdgeAdded() is called, but not both.

Forest.prototype.addEdge = forestAddEdge;

function forestAddEdge(edge, notifyMeOfTreeChanges)
{
    if(!edge || edge.length != 2)
        return false;

    var node = [this.nodes[edge[0]], this.nodes[edge[1]]];
    
    if(node[0]) {
        if(node[1]) {
            // both nodes already in the forest, need to check whether they
            // are in the same tree or not.
            if(node[0].getTreeId() == node[1].getTreeId())
                return false; // nothing to do
            // record the root of the merged tree (it is about to change)
            var mergedTreeRoot = node[1].root;
            // need to merge the two trees (by adding the edge between them)
            this.mergeTrees(node[0], node[1]);
            // notify of the merge 
            if(notifyMeOfTreeChanges !== undefined)
                notifyMeOfTreeChanges.notifyTreesMerged(mergedTreeRoot,
                                                        node[0], node[1]);
            return true;
        } else {
            // create a new node and attach it under the node which is already
            // in the forest
            this.nodes[edge[1]] = new TreeNode(edge[1], node[0]);
        }
    } else if(node[1]) {
        // create a new node and attach it under the node which is already
        // in the forest
        this.nodes[edge[0]] = node[0] = new TreeNode(edge[0], node[1]);
    } else {
        // both nodes not in the forest. Create a new tree containing
        // these nodes.
        this.nodes[edge[0]] = node[0] = new TreeNode(edge[0], null);
        this.nodes[edge[1]] = new TreeNode(edge[1], node[0]);
    }

    if(notifyMeOfTreeChanges !== undefined)
        notifyMeOfTreeChanges.notifyEdgeAdded(edge[0], edge[1]);
    
    return true;
}

// This function removes the given edge (an array of two node names) from the
// forest. If this edge is not found in the forest, the function returns
// undefined. If the edge was found, it is removed and the 'down' node of
// the edge (the one further away from the root) is returned by the function.
// If the edge was found, then any of its nodes which remains isolated
// after this removal is destroyed. In this case, the 'down' node is returned
// even if it was destroyed (the calling function needs it temporarily).
// In this case, the down node is marked as 'isRoot' since it is
// (temporarily) the root of a new tree (containing a single node).
// If the node further from the root was destroyed (it was a leaf node,
// which was removed) the ID of the tree is not changed. In other cases,
// both parts of the tree are assigned a new tree ID (if the node closer
// to the root was destroyed, which means it was the root and had only
// the removed edge attached to it) the remaining tree also gets a new ID
// (this indicates that the root node has changed).
// If the removal of the edge resulted in two trees, each of these trees
// is assigned a new tree ID. These new IDs are consecutive IDs and
// the part of the tree which contains the original root of the tree
// gets the lower of these two IDs. The node returned by this function
// is then the root of the other tree.
// If 'notifyMeOfTreeChanges' is provided, it should be an object which
// implements the functions notifyTreeSplit(<original tree root node>,
// <up removed edge node>, <down removed edge node>) and
// notifyNodeRemoved(<name>).
// The notifyTreeSplit() function is called at the end of the
// removeEdge function when the tree was split as a result of removing
// the edge. This includes all cases where an edge was actually
// removed except the case where the removal of the edge resulted in
// the removal of a single leaf node.  The function
// notifyTreeSplit(<original tree root node>, <up removed edge node>,
// <down removed edge node>) is called with the root node of the
// original tree which was split and the two nodes of the removed edge
// (with the node in the removed edge which was closer to the root
// first). If the root node and the 'up' removed node are equal, this
// node may have been destroyed in case the root remained isolated
// after the removal) The function notifyNodeRemoved(<name>) is called
// when any nodes are destroyed as a result of removing the edge (if
// both points are removed, the function is called twice).

Forest.prototype.removeEdge = forestRemoveEdge;

function forestRemoveEdge(edge, notifyMeOfTreeChanges)
{
    if(!edge || edge.length != 2)
        return undefined;

    // get the nodes
    var node = [this.nodes[edge[0]], this.nodes[edge[1]]];
    
    // check whether this edge is an edge in one of the trees
    if(!node[0] || !node[1])
        return undefined;

    var up, down;
    
    if(node[0] == node[1].up) {
        up = node[0];
        down = node[1];
    } else if(node[1] == node[0].up) {
        up = node[1];
        down = node[0];
    } else
        return undefined; // not an edge in a tree

    // split the tree (assign a new ID to both parts of the tree, if
    // the part split off is not a leaf node)

    var origRoot; // rot node of tree before split
    delete up.down[down.name];
    if(--up.downNum == 0 && up.isRoot) { // isolated node, should be destroyed
        delete this.nodes[up.name];
        if(notifyMeOfTreeChanges !== undefined)
            notifyMeOfTreeChanges.notifyNodeRemoved(up.name);
    }
    if(down.downNum !== 0) {
        // tree was split, need to assign a new ID to both parts, here we
        // do this for the part which includes the original root
        // This needs to take place even if the node was destroyed, since it
        // is still stored on node in the tree and the change in the tree ID
        // indicates to those nodes that the root of the tree has changed.
        origRoot = up.getRootNode(); // make sure up.root is up to date
        up.root.treeId = nextTreeId();
        // a split occurred, both parts of the tree need a new ID
        down.makeIntoRoot();

        // if an object registered to receive notifications when a
        // tree is split, notify it (providing the original tree
        // ID). This includes all cases where an edge is removed
        // except the case where only a leaf node was detached (and
        // removed).
        if(notifyMeOfTreeChanges !== undefined)
            notifyMeOfTreeChanges.notifyTreeSplit(origRoot, up, down);
        
    } else { // isolated node, should be destroyed
        delete this.nodes[down.name];
        down.isRoot = true; // temporarily, as the node is returned (see intro)
        if(notifyMeOfTreeChanges !== undefined)
            notifyMeOfTreeChanges.notifyNodeRemoved(down.name);
    }   
    
    // return the node which was split from the original tree
    return down;
}

// This function replaces the first edge with the second edge
// (each an array of two node names). If the edges are part of the same tree
// and after replacing the edge the tree remains connected then instead
// of splitting and merging the tree again, the function performs
// both operations simultaneously so that the tree ID does not need to
// change (only the depth ID changes).
// If 'notifyMeOfTreeChanges' is provided, it should be an object which
// implements the functions notifyTreeSplit(<original tree root>,
// <up split node>, <down split node>), notifyTreesMerged(<merged tree root>,
// <up node of added edge>, <down node of edge>),
// and notifyNodeRemoved(<name>). These function are called to notify the
// 'notifyMeOfTreeChanges' object of changes to the tree structure.
// The 'notifyTreeSplit()' function is called immediately after
// the replaced edge is removed in case this resulted in a tree split
// (exactly as in removeEdge(): this function is called unless the removal
// only removed a leaf node). The function is then called with three
// arguments: the root of the tree and the nodes of the removed edge
// (with the node in the removed edge closer to the root being first).
// This is called before the replacing edge is added, so
// the object receiving this call can better wait until the replacement
// process completes before performing updates based on this tree split
// notification. The function 'notifyTreesMerged()' is called when adding
// the replacing edge caused two trees to be merged. This function is called
// (just like in 'addEgde()') with three arguments: the node which was
// the root of the merged tree and the two nodes of the edge added.
// The function notifyNodeRemoved(<name>) is called when the replaced edge
// is removed if, as a result of this removal one or both its nodes are
// removed from the forest (the function is called twice if both
// nodes are removed).
// The function returns false if the given replacement edge could not be
// added (because both its nodes are in the same tree already) and true
// otherwise.

Forest.prototype.replaceEdge = forestReplaceEdge;

function forestReplaceEdge(replaced, replacing, notifyMeOfTreeChanges)
{
    var origId;
    var down;
    
    if(replaced[0] in this.nodes) {
        // store the original ID of the tree (in case it changes below)
        origId =  this.nodes[replaced[0]].getTreeId();
        
        // remove the 'replaced' edge (if it is in the tree)
        down = this.removeEdge(replaced, notifyMeOfTreeChanges);
    }

    // Add the 'replacing' edge

    if(down === undefined || down.downNum == 0) {
        // no split occurred (or just an isolated node was removed, so
        // the tree ID did not change)
        return this.addEdge(replacing, notifyMeOfTreeChanges);
    }

    // check whether the nodes to be added are one in each of the trees which
    // were just split.
    
    var node1 = this.nodes[replacing[0]];
    var node2 = this.nodes[replacing[1]];
    
    if(node1 && node2) {
        var treeId1 = node1.getTreeId();
        var treeId2 = node2.getTreeId();
        // get the IDs of the split trees. As they were both assigned a new
        // tree ID, they must have consecutive IDs. The 'down' node is
        // the root of the second of these trees to be assigned a new ID.
        var newTreeId = down.treeId; // the new ID of the tree split off
        // the new ID of the tree containing the original root
        var rootNewId = down.treeId - 1;
        
        if(treeId1 == rootNewId && treeId2 == newTreeId) {
            node1.root.treeId = origId;
            node1.root.depthId++;
        } else if(treeId1 == newTreeId && treeId2 == rootNewId) {
            node2.root.treeId = origId;
            node2.root.depthId++;
            // reverse the order of the nodes in 'replacing' so that
            // the 'new' tree will be placed under the original tree.
            replacing = [node2.name, node1.name];
        }
    }

    // add the edge
    return this.addEdge(replacing, notifyMeOfTreeChanges);
}

// Given a node which is not the root of a tree but is attached to the
// root of the tree (that is, node.up is defined but node.up.up is undefined)
// this function makes the given node into the root of the tree.
// If the given node is the root of the tree or is not attached directly
// to the root of the tree, this function doe snot do anything.

Forest.prototype.exchangeWithRoot = forestExchangeWithRoot;

function forestExchangeWithRoot(node)
{
    if(!node.up || node.up.up)
        return; // root or not directly attached to root

    var oldRootNode = node.up;

    node.makeIntoRoot();
    node.down[oldRootNode.name] = oldRootNode;
    node.downNum++;
    
    oldRootNode.up = node;
    oldRootNode.root = node;
    oldRootNode.isRoot = false;
    oldRootNode.treeId = node.treeId;
    oldRootNode.depthId = 0;
    oldRootNode.depth = 1;
    delete oldRootNode.down[node.name];
    --oldRootNode.downNum;
}

// This function may be called to change the name of a node already in the
// forest. If the name does not exist already in the forest, it is simply
// changed. If the name already exists, the two nodes (the one which has
// that name already and the one which has to receive that name) need to
// be merged. This is only possible if at least one of these nodes is a
// tree root node. In this case, the 'down' lists of the two nodes are
// merged and the 'up' node for this merged node is the (at most one)
// 'up' node defined for the two original nodes.
// If the name is replaced successfully, the function returns the node
// with the given name (this may be the node provided as input or
// the node into which it was merged). If the name cannot be replaced,
// false is returned.

Forest.prototype.setName = forestSetName;

function forestSetName(node, name)
{
    if(node.name == name)
        return node; // nothing to do

    if(!(name in this.nodes)) { // no node by this name, only replace name

        delete this.nodes[node.name];
        this.nodes[name] = node;

        if(node.up) {
            delete node.up.down[node.name];
            node.up.down[name] = node;
        }
        node.name = name;

        return node;
    }
    
    // merge the 'mergedNode' (a root node) into the 'combinedNode'

    var mergedNode;
    var combinedNode;
    
    if(node.up) {
        mergedNode = this.nodes[name];
        if(mergedNode.up)
            return false; // neither node is a root node, cannot be merged
        combinedNode = node;
    } else {
        mergedNode = node;
        combinedNode = this.nodes[name];
    }

    // copy the 'down' nodes
    for(var downName in mergedNode.down) {
        var downNode = combinedNode.down[downName] = mergedNode.down[downName];
        downNode.up = combinedNode;
    }

    combinedNode.downNum += mergedNode.downNum;

    // store the combined node under the new name and discard the
    // merged node (it may still be stored as the root node on some
    // other nodes, so we need to mark it as not being a root)
    mergedNode.isRoot = false;
    if(mergedNode == node)
        delete this.nodes[node.name];
    else {
        this.nodes[name] = combinedNode;
        combinedNode.name = name;
    }

    return combinedNode;
}

//
// Tree Merge Operation 
//

// This function merges the trees to which the two nodes belong.
// It does so by adding a link between the two nodes.

Forest.prototype.mergeTrees = forestMergeTrees;

function forestMergeTrees(node1, node2)
{
    if(!node1 || !node2)
        return;

    if(!node1.isUpToDate())
        node1.getTreeId();
    if(!node2.isUpToDate())
        node2.getTreeId();

    if(node1.treeId == node2.treeId)
        return; // same tree, nothing to merge

    // put the tree of node 2 under node 1

    // reverse all edges between node 2 and the root of its tree.
    var upNode = node1;
    var downNode = node2;
    var prevUp;
    
    while(downNode) {
        prevUp = downNode.up;
        downNode.up = upNode;
        upNode.down[downNode.name] = downNode;
        upNode.downNum++;
        if(upNode.name in downNode.down) {
            delete downNode.down[upNode.name];
            downNode.downNum--;
        }

        // update treeId, root and depth
        downNode.root = upNode.root;
        downNode.treeId = upNode.treeId;
        downNode.depthId = upNode.depthId;
        downNode.depth = upNode.depth + 1;

        // advance to next edge
        upNode = downNode;
        downNode = prevUp;
    }

    // upNode is now the previous root node of the merged tree.
    upNode.isRoot = false;
}

//
// Getting the path between nodes
//

// This function returns the tree ID which the node with the given name
// belongs to. If the name is not assigned any node, the function returns
// 'undefined'

Forest.prototype.getTreeId = forestGetTreeId;

function forestGetTreeId(name)
{
    if(!name)
        return undefined;
    
    var node = this.nodes[name];

    if(!node)
        return undefined;

    return node.getTreeId();
}

// The following function returns true if both names given are names
// of nodes in the same tree in the forest. Otherwise, false is returned

Forest.prototype.inSameTree = forestInSameTree;

function forestInSameTree(name1, name2)
{
    if(!name1 || !name2)
        return false;
    
    var node1, node2;

    if(!(node1 = this.nodes[name1]) || !(node2 = this.nodes[name2]))
        return false;

    return (node1.getTreeId() == node2.getTreeId());
}

// given the names of two nodes, this function returns an array with the
// path in the forest from the first node to the second. The path returned
// includes the two end points. If not both nodes are in the same tree,
// undefined is returned (undefined is also returned if one or both node
// names are not names of nodes in the forest).

Forest.prototype.getPath = forestGetPath;

function forestGetPath(name1, name2)
{
    if(!name1 || !name2)
        return undefined;
    
    var node1, node2;

    if(!(node1 = this.nodes[name1]) || !(node2 = this.nodes[name2]))
        return undefined;

    if(node1.getTreeId() != node2.getTreeId())
        return undefined;

    // Loop up from each node until the two paths meet. For this to work
    // correctly, we need to know the depth of the nodes under the root.
    var depth1 = node1.getDepth();
    var depth2 = node2.getDepth();

    var path1 = [node1];
    var path2 = [node2];

    // If one of the depths is greater than the other, advance along
    // the longer path until both depths are the same.
    while(depth1 > depth2) {
        node1 = node1.up;
        path1.push(node1);
        depth1--;
    }

    while(depth2 > depth1) {
        node2 = node2.up;
        path2.push(node2);
        depth2--;
    }

    // loop up both paths until they meet
    while(node1 != node2) {
        node1 = node1.up;
        path1.push(node1);
        node2 = node2.up;
        path2.push(node2);
    }

    // Merge the two paths (the meeting node appears in both paths, so it
    // should only be added once)
    var length1 = path1.length;
    var length2 = path2.length;
    for(var i = 0 ; i < length2 - 1 ; ++i)
        path1[length1 + length2 - i - 2] = path2[i]; 

    return path1;
}
