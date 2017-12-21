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


// This file implements a binary tree which stores intervals. An interval
// is defined by two points <x,y> with x <= y. An interval <x,y> can
// be retrieved by various searches, including: all intervals containing 
// a given search point or all intervls contained in a given search interval. 
// Intervals can be either closed or open on either side.
// The tree is based on (and inherits from) a red-black tree. The keys of
// the red-black tree are all end-points of the intervals stored in it.
//
// A leaf in this tree is the 'undefined' left or right child of a node.
// A left leaf represents the open interval from the previous key of its parent
// to the key of its parent, while a right leaf represents the open interval
// from the key of its parent to the next key. 
//
// Each (non-leaf) node represents the open interval which is the union
// of the intervals represented by the leaf nodes it dominates and 
// the points represented by the keys of the nodes it dominates. 
// 
// Example:
//                                        (-inf,inf)
//                            +-------------+
//                            |      28     |
//                            +-------------+
//                           /               \
//             (-inf,28)    /                 \      (28,inf)
//                  +------+                   +------+
//                  |  21  |                   |  40  |
//                  +------+                   +------+
//                 /        \                 /        \
//     (-inf,21)  /  (21,28) \       (28,40) /        (40,inf)
//        +------+        +------+        +------+
//        |  11  |        |  23  |        |  32  |
//        +------+        +------+        +------+
//       /        \      /        \       /       \
// (-inf,11)  (11,21)  (21,23) (23,28)  (28,32)  (32,40) 
//           
//
// This tree can then be used to store a interval D by storing (the ID of) D 
// on nodes which represent intervals contained in D and such that these
// intervals completely cover D. If an end point of D is closed, this must
// also be indicated on the node whose key is equal to the value of that
// end point.
//
// For example, in the tree above, we can store the interval d = (11,28)
// either on the right leaf of node 11 (representing (11,21)) and the
// two leaf nodes of node 23 (representing (21,23) and (23,28)) or we
// can store it on the right leaf of node 11 ((11,21)) and on node 23
// ((21,28)). We can, of course, store the interval on all these nodes.
// If we want to store d = (11,28], we can store it in the same way as
// (11,28) except that we also need to store the ID of d in the list of
// intervals which have a closed end-point at node 28.
//
// Look-up is then, in prinicple, simple. Given a key (say, 22 in the example 
// above), we go down the tree along the search path defined by the key 
// (in our case these are nodes 28, 21, 23 and the left leaf of 23).
// Any interval stored on any of these nodes contains the search point
// (because the interval represented by the node contains the search point).
// Moreover, this is guarateed to retrieve all intervals containing the
// search point because all intervals not reached by this search process
// do not contain the given search point. Therefore, if an interval stored 
// in the tree contains the search point, it cannot be stored only on 
// nodes not reached by the search (as the union of these does not cover
// the search point). 
//
// The only (small) complication is when a node is reached whose key is 
// exactly equal to the search value. In this case, intervals which have
// a closed end point at the given value are stored (in a separate list) 
// on the node itself. But this is not enough, we also need to find all 
// intervals which cover only part of the span of this node and for which 
// the key is an internal point. These intervals are stored on the right
// and left children of this node. However, instead of searching for 
// matches down both branches and then intersecting the results, we
// mark for each interval stored in the tree whether the segment stored
// under a certain node is the rightmost segment of that interval.
// It is enough, therefore, in this case, to simply continue searching 
// (for the same lookup key) down the left child of the node whose
// key is equal to the lookup key, but only retrive those segments 
// matched which are marked as not ending at the matched segment.
// 
// The definition above leaves us with some choice as to which nodes
// to use for storing a given interval. To keep storage and look-up
// time minimal, we use the highest node possible for storing an interval.
// Since this tree is based on a red black tree, rotation operations on 
// the tree may change the interval represented by each node and, as 
// a result, require intervals to be moved from one node to the other.
//
// Consider, for example, a right rotation:
//
//       |                 |
//      (y)               (x)
//     /   \             /   \
//   (x)    c      =>   a    (y)
//  /   \                   /   \
// a     b                 b     c
//
// Here, the intervals represented by a, b, and c do not change, but while
// the interval represented by x before the rotation was the union of
// the intervals of a and b, after the operation it is the union of the
// intervals of a, b and c. For y it is the other way around (before the
// rotation it represented the union of the intervals a, b, and c while
// after the rotation it only represents the union of b and c.
//
// Any interval stored on y before the rotation must be moved to x
// after the rotation. Intervals stored on x before the rotation must be
// moved to a and b (as these two are no longer dominated by a single node).
// Additionally, intervals which before the rotation were stored on b and c 
// can be moved to y. This is optional (as the requirements on
// storing the intervals in the tree are not violated if the intervals
// remain sored in b and c). Currently we perform this operation in the
// hope that the cost of this operation is smaller than the gain from 
// the more compact representation.
//
// When using the highest node possible, an interval cannot be stored
// in more than two nodes at the same level of the tree (as thes nodes
// must represent consecutive intervals, of any three nodes at the
// same level in which the interval is stored, two must be children of
// the same parent and therefore the interval could be stored on the
// parent instead). This means that the storage of the segment cannot
// require more than 2 * D(T) nodes, where D(T) is the depth of the
// tree (length of longest branch).
//
// In the rotation given above, we need to find the intervals stored
// both on b and c, so that these could be moved to y. To simplify this
// operation, on each node we store the intervals in two separate
// lists: those that end at the given node, and those that do not.
// (this is also useful or the lookup algroithm, see above).
// For the nodes b and c in the rotation example above, the intervals
// on b which do not end at b are the intervals which have to be
// moved to y (we then still need to check in which list on c they 
// are stored so that we can delete them from the list and so that we
// can decide which list of y to add them to).
//
// As shown in the tree diagram above, intervals must also be stored
// on leaves of the tree. Since these leaves are represented as 
// 'undefined' values under their parents, we cannot actually store 
// the intervals on leaf nodes. Instead, we store them on the parent
// node, together with the intervals of the parent node. We still need
// to distinguish between the left and right leaf (and separate the intervals
// on the leaf node from those on the parent node). Therefore, each node
// holds (under its 'value' field) an object of the following structure:
//
// value: {
//    end: <Map>: { // intervals on this node which end at this node
//       <interval ID>: true,
//       .....
//    },
//    dontEnd: <Map>: { // intervals on this node which do end at this node
//       <interval ID>: true,
//       .....
//    },
//    leftLeaf: { // only if the left child is a leaf (otherwise, undefined)
//       end: <Map>: { // intervals on this leaf which end at this leaf
//          <interval ID>: true,
//          ......
//       },
//       dontEnd: <Map>{ // intervals on this leaf which do not end at this leaf
//          <interval ID>: true,
//          .......
//       }
//    },
//    rightLeaf: { // only if the right child is a leaf (otherwise, undefined)
//       // same structure as for the left leaf
//    }
// }
//
// In addition to this value object, the interval tree also adds the following
// fields directly on the tree node: 
// {
//    lowEnd: <Map>{
//       // non-degenerate intervals which have a low closed end point 
//       // at the key value
//       <interval ID>: true,
//       ......
//    },
//    highEnd: <Map>{
//       // non-degenerate intervals which have a high closed end point 
//       // at the key value
//       <interval ID>: true,
//       ......
//    },
//    degenerate: <Map>{
//       // degenerate intervals at the key value
//       <interval ID>: true,
//       ......
//    }
// }
// These fields store those intervals which have a closed end point at the
// key of the node. The reason that these fields are not stored in the
// value object but directly on the node is that they depend on the key
// of the node and not on the span of the node (whereas the fields stored
// under the value object depend on the span). This means that when the
// structure of the tree changes, the fields stored inside the value
// object need to be managed differently than the fields stored directly
// under the node. For example, when a node is removed from the tree
// by splicing another node and then copying the spliced node onto the
// node to be removed (which remains in place but gets the key of
// the spliced node) the fields sored directl on the node need to be copied
// from the spliced node to the removed node (as the key is now that
// of the spliced node) but the value object remains unchanged
// (since the span of the node to be removed remains unchanged after
// this operation).
//
// In addition to these fields and the value object, each node in the
// tree also carries a refCount field. This is a reference count for
// the number of intervals for which the key of the node is an end
// point (open or closed). When the reference count of a node drops to
// zero, the node can be removed from the tree.

// The tree object has a minimumKeyValue and a maximumKeyValue, and every key
// must be between these values (inclusive). Replace these values in derived
// classes that do not use numerical intervals.

// Representation for infinity is implicit, and there should be no nodes that
// represent an infinity as key. Consequently, intervals that span (-Infinity,
// +Infinity) cannot be represented in the tree, but are stored in a separate
// Map object, entireDomainIntervals.

// It is possible to store degenerate intervals (a single point) in the 
// interval tree (and this is essentially almost as efficient as storing the
// value in a red-black tree). Therefore, it is possible to mix degenerate
// and non-degenerate intervals in the same tree. However, if one only
// stores degenerate intervals, it is best to use the DegenerateIntervalTree
// (which is a standard red-black tree).
// The function importFromDegenerateTree(<degenerate interval tree>) can be 
// used to construct an interval tree from an existing degenerate interval
// tree so that the interval tree store the degenerate intervals previously
// stored in the degenerate interval tree. In this way, one can start off 
// with a degenerate interval tree and when the need to store a non-degenerate
// interval arises, convert it into an interval tree.
// 
// A degenerate interval must be closed on both ends. An interval whose
// two end-points are equal and at least one end point is open is considered
// empty and will not be stored. Specifically, a degenerate interval at
// minimumKeyValue or maximumKeyValue cannot be stored in the table.

// %%include%%: "redBlackTree.js"
// %%include%%: "idStorage.js"

inherit(IntervalTree, RedBlackTree);

var debugAllIntervalTrees;

// The constructor takes an optional comparison function as argument.
// If the comparison function is undefined, this class assumes the values
// stored here are non-negative integers. The default comparison function
// can, however, handle non-integer numbers, so to use the default comparison
// function but for values which are not necessrily non-negative integers,
// the second argument should be set to true.

function IntervalTree(compareFunc, nonIntegerValues)
{
    this.RedBlackTree(compareFunc);
    this.storageAllocate =
        (compareFunc === undefined && !nonIntegerValues) ?
        this.intStorageAllocate : this.nonIntStorageAllocate;
    this.minimumKeyValue = -Infinity;
    this.maximumKeyValue = Infinity;
    this.entireDomainIntervals = this.storageAllocate();

    if(debugAllIntervalTrees)
        debugAllIntervalTrees.push(this);
}

// Returns true if this tree does not store any values and false otherwise. 

IntervalTree.prototype.isEmpty = intervalTreeIsEmpty;

function intervalTreeIsEmpty()
{
    if(this.entireDomainIntervals.size > 0)
        return false;
    
    return this.RedBlackTree_isEmpty();
}

/////////////////////////////////
// Storage Allocation Function //
/////////////////////////////////

IntervalTree.prototype.intStorageAllocate = intervalTreeIntStorageAllocate;

function intervalTreeIntStorageAllocate()
{
    return new IntIdStorage();
}

IntervalTree.prototype.nonIntStorageAllocate =
    intervalTreeNonIntStorageAllocate;

function intervalTreeNonIntStorageAllocate()
{
    return new IdStorage();
}

////////////////////////
// Interval Insertion //
//////////////////////// 

// This function inserts into the tree the interval <lowKey, highKey>
// with ID 'id'. 'openLow' and 'openHigh' indicate whether the
// interval <lowKey, highKey> should be considered open or closed on
// the lower or higher end. For example, if 'openLow' is true and
// 'openHigh' is false, the interval is (loweKey, openKey].
// The first step is to insert the two keys into the tree (if the two keys
// are equal, only one insertion takes place). Closed end points are
// stored in the 'lowEnd', 'highEnd' or 'degenerate' table of 
// the correpsonding node. 
// Once the two end points have been inserted, and if they are not equal,
// we have to register the ID of the interval on all maximal nodes
// (including leaf nodes) whose span (the union of spans of the leaves
// dominated by the node) is contained in the interval. This is done
// recursively by the function addInterval.

IntervalTree.prototype.insertInterval = 
    intervalTreeInsertInterval;

function intervalTreeInsertInterval(id, lowKey, highKey, openLow, openHigh)
{
    var singlePoint = (this.compare(lowKey, highKey) === 0);

    if(singlePoint && (openLow || openHigh || 
                       this.compare(lowKey, this.maximumKeyValue) === 0))
        return; // empty interval, not stored

    // insert the low and high keys
    if(this.compare(lowKey, this.minimumKeyValue) !== 0) {
        var node = this.insertKey(lowKey);
        if(!openLow) {
            if(singlePoint) {
                if(node.degenerate === undefined)
                    node.degenerate = this.storageAllocate();
                node.degenerate.set(id, true);
            } else {
                if(node.lowEnd === undefined)
                    node.lowEnd = this.storageAllocate();
                node.lowEnd.set(id, true);
            }
        }
    } 

    if(!singlePoint) {
        if(this.compare(highKey, this.maximumKeyValue) !== 0) {
            var node = this.insertKey(highKey);
            if(!openHigh) {
                if(node.highEnd === undefined)
                    node.highEnd = this.storageAllocate();
                node.highEnd.set(id, true);
            }
        }
        // register the interval recursively on the nodes, beginning with
        // the root node, whose span is (-Infinity, Infinity). 
        this.addInterval(id, lowKey, highKey, this.minimumKeyValue,
                         this.maximumKeyValue, this.root);
    }
}

// This function can be used to add the degnerate interval [key,key] to the 
// interval tree. It uses insertInterval to actually perform the operation.

IntervalTree.prototype.insertPoint = 
    intervalTreeInsertPoint;

function intervalTreeInsertPoint(id, key)
{
    this.insertInterval(id, key, key, false, false);
}

// This function inserts a key into the tree and returns the node assigned
// to the key. This function takes care of assigning the appropriate 
// value to the node (if it is new). 
// This function overrides the same function of the base class. It does
// not use the base class function directly, but, instead, inserts
// an extra step between the two steps of the base class insert function.
// First, the key is inserted using the binary tree insertion function.
// If the node already exists, there is nothing more to do. If, however,
// the node is new, its value must be set and the value of its parent
// adjusted before the tree is rebalanced. Since the new node is added 
// where there previously was a leaf node, the value for the relevant 
// leaf node must be copied from the parent node to the new node.
// The values for the leaf nodes of the new node needs to be set on the
// valu object of the new node (these values are empty).

IntervalTree.prototype.insertKey = 
    intervalTreeInsertKey;

function intervalTreeInsertKey(key)
{
    var node = this.BinaryTree_insertKey(key);

    if(node.value !== undefined) {
        // increase the reference count of this node
        node.refCount++;
        return node; // an existing node
    }

    // new node

    if(!node.parent) { // first node in the tree
        node.value = new ValueObj(this);
    } else if(node == node.parent.left) { // left child of parent
        node.value = node.parent.value.leftLeaf;
        delete node.parent.value.leftLeaf;
    } else { // right child of parent
        node.value = node.parent.value.rightLeaf;
        delete node.parent.value.rightLeaf;
    }
    node.value.leftLeaf = new ValueObj(this);
    node.value.rightLeaf = new ValueObj(this);

    node.refCount = 1;

    this.fixAfterInsertion(node);
    
    return node;
}

// This function recursively finds the highest nodes under the given 
// 'node' whose span is contained in the internval (lowKey, highKey).
// On each such node found, the ID 'id' is registered. As we go down 
// the different branches of the tree, we record the interval ID on 
// the first node whose span (the union of the intervals defined by 
// the leaves it dominates) is contained in the interval being added 
// (at that point we stop going down the branches under that node). 
// As long as the span of the node is not contained in the interval being 
// added, we go down the children of the node. If the interval is completely 
// to the left of the key of the node, we go down the left child and, if it 
// is completely to the right of the key, we go down the right child. 
// If the interval covers the key, we go down both children.
// The span of the node 'node' is given by (lowSpan, highSpan). From these,
// together with the key of the node, it is easy to calculate the spans 
// of the children. 

IntervalTree.prototype.addInterval = intervalTreeAddInterval;

function intervalTreeAddInterval(id, lowKey, highKey, lowSpan, highSpan, node)
{
    var cmpHighSpanHighKey = this.compare(highSpan, highKey);

    if(cmpHighSpanHighKey <= 0 && this.compare(lowKey, lowSpan) <= 0) {
        // span contained in interval, record the interval ID and terminate
        // the recursion
        if (this.compare(lowKey, this.minimumKeyValue) === 0 &&
              this.compare(highKey, this.maximumKeyValue) === 0) {
            // (-Infinity, +Infinity) is stored separately.
            this.entireDomainIntervals.set(id, true);
            return;
        } else if(cmpHighSpanHighKey === 0)
            node.value.end.set(id, true);
        else
            node.value.dontEnd.set(id, true);
        return;
    }

    // continue the recursion (leaf nodes require special attention)
    var cmpNodeKeyHighKey = this.compare(node.key, highKey);

    if(this.compare(lowKey, node.key) < 0) {
        // continue recursion down left child. If it is a leaf, record
        // the ID immediately
        if(node.left === undefined) { //leaf node
            if(cmpNodeKeyHighKey === 0)
                node.value.leftLeaf.end.set(id, true);
            else
                node.value.leftLeaf.dontEnd.set(id, true);
        } else
            this.addInterval(id, lowKey, highKey, lowSpan, node.key, node.left);
    }

    if(cmpNodeKeyHighKey < 0) {
        // continue recursion down right child. If it is a leaf, record
        // the ID immediately
        if(node.right === undefined) { //leaf node
            if(cmpHighSpanHighKey === 0)
                node.value.rightLeaf.end.set(id, true);
            else
                node.value.rightLeaf.dontEnd.set(id, true);
        } else
            this.addInterval(id, lowKey, highKey, node.key, highSpan, 
                             node.right);
    }
}

//////////////////////
// Interval Removal //
//////////////////////

// This function from the tree the interval <lowKey, highKey> 
// with ID 'id'. 'openLow' and 'openHigh' indicate whether the
// interval <lowKey, highKey> should be considered open or closed on
// the lower or higher end. For example, if 'openLow' is true and
// 'openHigh' is false, the interval is (loweKey, openKey]. 
// It is assumed that the interval is indeed stored in the tree
// (exactly as given).
// The first step is to erase the ID from all nodes in the tree which 
// carry it. This is done by the function eraseInterval() which uses exactly
// the same procedure as that used by addInterval to register the interval
// into the tree. If the two end points of the interval are equal, 
// this step is skipped (as no node span is contained in this interval).
// Having erased the interval, this function gets the nodes for the 
// two end points of the interval and decreases their reference count.
// If the reference count of a node reaches zero as a result of this 
// operation, the node is no longer an end point of any interval in the 
// tree and can be removed. Otherwise, if the interval has a closed end point
// on either of its ends, its ID is erased from the appropriate table of end
// points of the coresponding node.

IntervalTree.prototype.removeInterval = 
    intervalTreeRemoveInterval;

function intervalTreeRemoveInterval(id, lowKey, highKey, openLow, openHigh)
{
    if(this.compare(lowKey, this.minimumKeyValue) === 0 &&
       this.compare(highKey, this.maximumKeyValue) === 0) {
        this.entireDomainIntervals.delete(id);
        return;
    }

    var singlePoint = (this.compare(lowKey, highKey) === 0);

    if(!singlePoint) {
        this.eraseInterval(id, lowKey, highKey, this.minimumKeyValue,
                           this.maximumKeyValue, this.root);

        if (this.compare(lowKey, this.minimumKeyValue) !== 0) {
            var lowNode = this.RedBlackTree_find(lowKey);
            if(!--lowNode.refCount)
                this.removeNode(lowNode);
            else if(!openLow)
                lowNode.lowEnd.delete(id);
        }
    } else if(openLow || openHigh || 
              this.compare(lowKey, this.minimumKeyValue) === 0)
        return; // empty interval, not stored

    if (this.compare(highKey, this.maximumKeyValue) !== 0) {
        var highNode = this.RedBlackTree_find(highKey);
        if(!--highNode.refCount)
            this.removeNode(highNode);
        else if(!openHigh) {
            if(singlePoint)
                highNode.degenerate.delete(id);
            else
                highNode.highEnd.delete(id);
        }
    }
}

// This function can be used to remove the degnerate interval [key,key] from
// the interval tree. It uses removeInterval to actually perform the operation.

IntervalTree.prototype.removePoint = 
    intervalTreeRemovePoint;

function intervalTreeRemovePoint(id, key)
{
    this.removeInterval(id, key, key, false, false);
}

// This function removes a node from the tree. It is assumed a node
// is removed only when its reference count has dropped to zero and, therefore,
// there are no intervals which end at the key of that node. The node
// is then removed by first calling the removeNode() function of the
// binary tree base class. This function returns the node spliced out
// of the tree (which is not necessarily the node which was removed - 
// the cotent of the spliced node may have been copied to the removed
// node, thus overwriting it).
// Before rebalancing the red black tree, this function has to copy interval
// IDs from one node to the other. There are several possibilities:
// 1. The spliced node is also the removed node. In this case, the 
//    removed node had at most one non-leaf child and that child is inserted
//    instead of the remove node. Any intervals still registered on 
//    the leaf node(s) of the removed node cannot begin or end at the key 
//    of the removed node (otherwise the node would not have been removed).
//    If both children of the removed node are leaf nodes then this 
//    implies that no intervals can be registered on them (because each such
//    segment would necessarily have to be registered on both leaf
//    nodes and therefore would actually be registered on the removed node).
//    If there is a single leaf node, then it spans an interval beginning
//    or ending at the key of the removed node. Since the intervals don't 
//    begin or end at the removed key, the intervals must also be
//    registered on some other node under the other child of the
//    removed node. After the removal of the node, their span (which
//    previously ended at the key of the removed node) would be
//    extended up to the key following or preceding the key of 
//    the removed node. The span of the leaf node would therefore 
//    be implicitly added to these nodes and there is nothing more to do. 
//    Therefore, there is no need to copy intervals from the leaf
//    nodes of the removed node.  The intervals on the removed node
//    itself span the interval from the parent node to the end of the
//    span of the child node. After the removal (and the insertion of
//    the child in place of the removed node, this is exactly the span
//    of the child node. Therefore, we need to copy intervals from the
//    removed node to the node which replaces it (whether a leaf node
//    or its (non-leaf) child node).
// 2. The spliced node is not the removed node. In that case, the 
//    removed node has two non-leaf children and the key of the spliced node
//    is the one immediately following that of the removed node. Since the
//    removed node has children on both sides, the spliced node must
//    be dominated by the removed node and the left child of the spliced
//    node must be a leaf node. Moreover, the spliced node must either be
//    the right child of the removed node or the left child of the 
//    spliced node's parent (otherwise, the key of its parent
//    intervenes between the key of the removed node and the key of
//    the spliced node).
//    The intervals on the left leaf node of the spliced node cannot
//    end at the removed node. Therefore, they must also be registered
//    on the left child of the remove node or on some nodes dominated
//    by it. When the removed node key is replaced by the spliced node
//    key, the span of these intervals will be implicitly extended to
//    include the span of the left leaf node of the spliced
//    node. Therefore, there is no need to copy these
//    intervals. However, those of the intervals which are registered
//    as ending on the left leaf of the spliced node will not be
//    registered as ending on the previous node they are registered
//    on. Therefore, on that node they need to be transferred from the
//    'dontEnd' table to the 'end' table.
//    If the spliced node also has a right leaf node, the span of that 
//    leaf node is from the key of the spliced node to the next key.
//    These intervals can be copied to the leaf node created where the
//    spliced node is removed. This node has exactly the same span as the
//    right leaf node of the spliced node (because the preceding key is
//    the key of the spliced node and the next key is the same as before).
//    The intervals registerd on the spliced node cover the span of the left 
//    leaf node and the right child of the spliced node. Since they cover
//    the left leaf node but cannot end at the removed key, they must also
//    appear on the left child of the removed node or some node dominated 
//    by it. As above, the span of this node will be extended to cover 
//    the span of the left leaf node of the spliced node when the key
//    of the spliced node is copied to the removed node. Therefore,
//    all we need to do is copy these intervals to the child node which 
//    replaces it (whether it is a leaf node or not), since this will 
//    have the same span as it had before.
//    There is also no need to do anything with the intervals registered
//    on the removed node. While the key of this node changes,
//    its span does not (as the key remains inside its span).
//
// Conclusion:
//
//    In case 1 (the spliced node is the removed node) we need to copy
//    intervals from the spliced node to the node which replaces it
//    (whether a leaf node or not).
//    As stated above, if the right child of the removed node is a leaf,
//    all intervals registered on it are also registered on some 
//    right* child of the replacement node (if it is not a leaf), which is
//    the left child of the removed node. However, in this case they are 
//    registered as not ending at that node, while if they ended at 
//    the right (leaf) child of the removed node then after the splicing
//    they need to be transferred from the list of intervals not ending
//    at the node to the list of intervals ending at the node.
//    This is exactly the same operation as should be performed in the case
//    of the spliced node not being the removed node for the left leaf
//    of the splice node (see below). This is then handled by the
//    same code (with some small differences between the two cases).
//
//    In case 2 (the spliced node is not the removed node) we also need to
//    copy the intervals from the spliced node to the node which replaces
//    it (which may be a leaf node). The intervals on the right child 
//    of the spliced node remain unchanged, but if it is a leaf node then
//    it has to be stored on the parent of the spliced node instead of
//    on the spliced node. Moreover, because the node is raised to a higher
//    position in the tree, it may be that its sibling carries some of the
//    same intervals, in which case these intervals need to be raised to
//    the parent node (and this process may continue recursively). As mentioned
//    above, going up the chain of parents up to the removed node 
//    (excluding) each node is the left child of its parent. The low end point
//    of the span of these nodes extends up to the removed node key
//    whose key has just changed from the removed key to the spliced key
//    (thus reducing the span and allowing some intervals to be stored
//    higher up the tree).
//    Finally, any intervals stored as ending at the left leaf of the
//    spliced node need to be searched on all previous nodes (in order
//    of keys) up to (but not including) the remove node
//    (equivalently, these are the left child of the removed node and
//    then, recursively, the right child of each node). Every interval
//    previously registered as ending at the left leaf of the spliced
//    node and found on these nodes should be transferred from the
//    dontEnd list to the end list.

IntervalTree.prototype.removeNode = 
    intervalTreeRemoveNode;

function intervalTreeRemoveNode(node)
{
    var spliced = this.BinaryTree_removeNode(node);

    // find the node which was inserted instead of the spliced node.
    // The spliced node has at most one child. If it has a non-leaf child,
    // this is the node inserted instead of the spliced node. If it has
    // two leaves as children, then we need to know on which side of the 
    // parent the spliced node was. This can be determined by comparing their 
    // keys (if the keys are equal, the parent is the removed node, to which
    // the spliced key was copied, and the spliced node must have been its 
    // right child).
    var replacement;
    
    if(spliced.left)
        replacement = spliced.left.value;
    else if(spliced.right)
        replacement = spliced.right.value;
    else if(!spliced.parent)
        return; // spliced node has no children and no parent, the tree is empty
    else if(this.compare(spliced.key, spliced.parent.key) < 0) {
        replacement = spliced.parent.value.leftLeaf = new ValueObj(this);
    } else
        replacement = spliced.parent.value.rightLeaf  = new ValueObj(this);

    // copy the intervals on the spliced node to the node which replaced it
    spliced.value.end.forEach(function(t,id) {
        replacement.end.set(id, true);
    });
    spliced.value.dontEnd.forEach(function(t,id) {
        replacement.dontEnd.set(id, true);
    });
     
    if(node != spliced) { // the spliced node is not the removed node 
        if(!spliced.right) {
            // the right child of the spliced node is a leaf node, copy its 
            // intervals to the new replacement node (it represents the same 
            // node, but stored on the parent instead of the spliced node)
            spliced.value.rightLeaf.end.forEach(function(t,id) {
                replacement.end.set(id, true);
            });
            spliced.value.rightLeaf.dontEnd.forEach(function(t,id) {
                replacement.dontEnd.set(id, true);
            });
        }

        // check whether the intervals that dont end at the replacement
        // node need to be raised to one of its parents (because their
        // span is now narrower than it was).
        replacement.dontEnd.forEach(function(t,id) {
            //  loop up the parents up to the removed node (excluding)
            for(var parent = spliced.parent ; parent != node ; 
                parent = parent.parent) {
                var rightValue = 
                    parent.right ? parent.right.value : parent.value.rightLeaf;
                if(rightValue.end.has(id)) {
                    // store on parent and stop (cannot extend further)
                    parent.value.end.set(id, true);
                    rightValue.end.delete(id);
                    replacement.dontEnd.delete(id);
                    break; // no need to look higher
                } else if(rightValue.dontEnd.has(id)) {
                    rightValue.dontEnd.delete(id);
                    if(parent.parent == node) {
                        // store here (loop cannot continue)
                        parent.value.dontEnd.set(id, true);
                        replacement.dontEnd.delete(id);
                        break;
                    }
                    // continue the search
                } else {
                    if(parent != spliced.parent) { // not the first loop step 
                        parent.left.value.dontEnd.set(id, true);
                        replacement.dontEnd.delete(id);
                    }
                    break; // no need to look higher
                }
            }  
        });
    }

    // If the leaf representing the segment from the removed key to the next
    // key is dropped by the slicing, the intervals registered on it are 
    // still registered on some previous node, but if they end at the leaf
    // must be changed from not ending to ending at that previous leaf.
    // (Note: as noted above, if both children of the removed node are
    // leaf nodes, there are no intervals on them and nothing to do here).
    if(spliced != node || (!node.right && node.left)) {
        var droppedLeafEnd = (spliced != node) ? 
            spliced.value.leftLeaf.end : node.value.rightLeaf.end;
        droppedLeafEnd.forEach(function(t,id) {
            var prevValue = node.prev.value.rightLeaf;
            var prevNode = node;
            while(1) {
                if(prevValue.dontEnd.has(id)) {
                    prevValue.dontEnd.delete(id);
                    prevValue.end.set(id, true);
                    break; // found
                }
                prevNode = prevNode.prev;
                prevValue = prevNode.value;
            }
        });
    }

    // rebalance the tree
    this.fixAfterRemoval(spliced);
}


// This function recursively finds the highest nodes under the given 
// 'node' whose span is contained in the internval [lowKey, highKey].
// From each such node found, it removes the ID 'id'. This function
// assumes that the interval with the given ID was previously registered
// on the tree using the function addInterval() which uses exactly the
// process to add the interval ID. Therefore, this function should
// remove all the registrations of the given interval. See addInterval()
// for more details.

IntervalTree.prototype.eraseInterval = intervalTreeEraseInterval;

function intervalTreeEraseInterval(id, lowKey, highKey, lowSpan, highSpan, 
                                   node)
{
    var cmpHighSpanHighKey = this.compare(highSpan, highKey);

    if(this.compare(lowKey, lowSpan) <= 0 && cmpHighSpanHighKey <= 0) {
        // span contained in interval, remove the interval ID and terminate
        // the recursion
        if(cmpHighSpanHighKey === 0)
            node.value.end.delete(id);
        else
            node.value.dontEnd.delete(id);
        return;
    }

    // continue the recursion (leaf nodes require special attention)
    var cmpNodeKeyHighKey = this.compare(node.key, highKey);

    if(this.compare(lowKey, node.key) < 0) {
        // continue recursion down left child. If it is a leaf, remove
        // the ID immediately
        if(node.left === undefined) { //leaf node
            if(cmpNodeKeyHighKey === 0)
                node.value.leftLeaf.end.delete(id);
            else
                node.value.leftLeaf.dontEnd.delete(id);
        } else
            this.eraseInterval(id, lowKey, highKey, lowSpan, node.key, 
                               node.left);
    }

    if(cmpNodeKeyHighKey < 0) {
        // continue recursion down right child. If it is a leaf, remove
        // the ID immediately
        if(node.right === undefined) { //leaf node
            if(cmpHighSpanHighKey === 0)
                node.value.rightLeaf.end.delete(id);
            else
                node.value.rightLeaf.dontEnd.delete(id);
        } else
            this.eraseInterval(id, lowKey, highKey, node.key, highSpan, 
                               node.right);
    }
}

// This function is used in the removal function to copy the content of 
// the spliced node to the removed node (in case they are not the same).
// Here, we only want to copy the key and reference count of the 
// node, and fields which depend on the key value (such as lowEnd, highEnd
// and degenerate) but not its 'value' field (which holds the list of intervals
// covering its span, as this span does not change when the key changes).

IntervalTree.prototype.copySplicedToRemovedNode = 
    intervalTreeCopySplicedToRemovedNode;

function intervalTreeCopySplicedToRemovedNode(spliced, removed)
{
    removed.key = spliced.key;

    if(spliced.degenerate !== undefined)
        removed.degenerate = spliced.degenerate;
    else if(removed.degenerate !== undefined)
        removed.degenerate = undefined;
    
    if(spliced.lowEnd !== undefined)
        removed.lowEnd = spliced.lowEnd;
    else if(removed.lowEnd !== undefined)
        removed.lowEnd = undefined;
    
    if(spliced.highEnd !== undefined)
        removed.highEnd = spliced.highEnd;
    else if(removed.highEnd !== undefined)
        removed.highEnd = undefined;
    
    removed.refCount = spliced.refCount;
}

////////////////////////
// Rotation Functions //
////////////////////////

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
// This function overrides the rotateRight function of the 
// red black tree base class. It uses the base class implementation 
// to actually perform the node rotation. It then continues to update 
// the lists of interval on each node, which may change as a result of 
// the rotation.
// The interval lists must be updated as follows:
// 1. The list of intervals on node y must be moved to node x
//    (after the rotation, node x covers exactly the same interval
//    as y did before the rotation). An interval ends at x iff it ended 
//    at y. This operation is performed in two steps. First, the list is
//    removed from y and stored in a temporary object. This allows for
//    the steps below to take place. After these two steps are completed,
//    the list is moved to x. 
// 2. For all intervals on b which do not end at b we need to check whether
//    they are also in c. Those that are, are removed from both b and c and 
//    added to y (which after step 1 has no intervals registered on it). 
//    Note that intervals moved in the following step from x to b do not 
//    need to be checked since if they also cover c then before the rotation
//    they are registered on y and not on x. For this reason, this step takes
//    place before the copying of intervals from x to a and b, which takes
//    place in the next step.
// 3. The list of intervals on node x must be moved to nodes a and b.
//    The list is removed from node x and copied to both node a and node
//    b. Note that either one or both of these nodes may be leaf nodes
//    and therefore their interval lists would actually still be stored
//    on the node x (but under another field, see introduction).
//    The intervals that end at x also end at b but do nto end at a.
//    Intervals which do no end at x end neither at a nor at b. 
// 4. After step 3 is completed, we place the intervals from the node y,
//    which we stored in a temporary object, on the node x.
 
IntervalTree.prototype.rotateRight = 
    intervalTreeRotateRight;

function intervalTreeRotateRight(y)
{
    var x = y.left;

    this.RedBlackTree_rotateRight(y);

    // following the interval list update steps in the introduction above

    // get the lists for a,b,c
    var a = (x.left !== undefined) ? x.left.value : x.value.leftLeaf;
    var b = (y.left !== undefined) ? y.left.value : x.value.rightLeaf;
    var c = (y.right !== undefined) ? y.right.value : y.value.rightLeaf;
    
    // step 1
    var tempValue = y.value;
    var yl = y.value = new ValueObj(this);

    // if b is a leaf, move its list of intervals from x to y
    if(y.left === undefined) {
        y.value.leftLeaf = b;
        delete x.value.rightLeaf;
    }
    if(y.right === undefined)
        y.value.rightLeaf = tempValue.rightLeaf;

    // step 2
    b.dontEnd.forEach(function(t,id) {
        if(c.end.has(id)) {
            yl.end.set(id, true);
            b.dontEnd.delete(id);
            c.end.delete(id);
        } else if(c.dontEnd.has(id)) {
            yl.dontEnd.set(id, true);
            b.dontEnd.delete(id);
            c.dontEnd.delete(id);
        }
    });
    
    // step 3
    var xl = x.value;
    xl.end.forEach(function(t,id) {
        a.dontEnd.set(id, true);
        b.end.set(id, true);
    });
    xl.dontEnd.forEach(function(t,id) {
        a.dontEnd.set(id, true);
        b.dontEnd.set(id, true);
    });

    // step 4
    xl.dontEnd = tempValue.dontEnd;
    xl.end = tempValue.end;
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
// This function overrides the rotateLeft function of the 
// red black tree base class. It uses the base class implementation 
// to actually perform the node rotation. It then continues to update 
// the lists of interval on each node, which may change as a result of 
// the rotation.
// The interval lists must be updated as follows:
// 1. The list of intervals on node x must be moved to node y
//    (after the rotation, node y covers exactly the same interval
//    as x did before the rotation). An interval ends at y iff it ended 
//    at x. This operation is performed in two steps. First, the list is
//    removed from x and stored in a temporary object. This allows for
//    the steps below to take place. After these two steps are completed,
//    the list is moved to y. 
// 2. For all intervals on a which do not end at a we need to check whether
//    they are also in b. Those that are, are removed from both a and b and 
//    added to x (which after step 1 has no intervals registered on it). 
//    Note that intervals moved in the following step from y to b do not 
//    need to be checked since if they also cover a then before the rotation
//    they are registered on x and not on y. For this reason, this step takes
//    place before the copying of intervals from y to b and c, which takes
//    place in the next step.
// 3. The list of intervals on node y must be moved to nodes b and c.
//    The list is removed from node y and copied to both node b and node
//    c. Note that either one or both of these nodes may be leaf nodes
//    and therefore their interval lists would actually still be stored
//    on the node y (but under another field, see introduction).
//    The intervals that end at y also end at c but do not end at b.
//    Intervals which do no end at y end neither at b nor at c. 
// 4. After step 3 is completed, we place the intervals from the node x,
//    which we stored in a temporary object, on the node y.

IntervalTree.prototype.rotateLeft = 
    intervalTreeRotateLeft;

function intervalTreeRotateLeft(x)
{
    var y = x.right;

    this.RedBlackTree_rotateLeft(x);

    // following the interval list update steps in the introduction above

    // get the lists for a,b,c
    var a = (x.left !== undefined) ? x.left.value : x.value.leftLeaf;
    var b = (x.right !== undefined) ? x.right.value : y.value.leftLeaf;
    var c = (y.right !== undefined) ? y.right.value : y.value.rightLeaf;
    
    // step 1
    var tempValue = x.value;
    var xl = x.value = new ValueObj(this);

    // if b is a leaf, move its list of intervals from y to x
    if(x.right === undefined) {
        x.value.rightLeaf = b;
        delete y.value.leftLeaf;
    }
    if(x.left === undefined)
        x.value.leftLeaf = tempValue.leftLeaf;

    // step 2
    a.dontEnd.forEach(function(t,id) {
        if(b.end.has(id)) {
            xl.end.set(id, true);
            a.dontEnd.delete(id);
            b.end.delete(id);
        } else if(b.dontEnd.has(id)) {
            xl.dontEnd.set(id, true);
            a.dontEnd.delete(id);
            b.dontEnd.delete(id);
        }
    });
    
    // step 3
    var yl = y.value;
    yl.end.forEach(function(t,id) {
        b.dontEnd.set(id, true);
        c.end.set(id, true);
    });
    yl.dontEnd.forEach(function(t,id) {
        b.dontEnd.set(id, true);
        c.dontEnd.set(id, true);
    });

    // step 4
    yl.dontEnd = tempValue.dontEnd;
    yl.end = tempValue.end;
}

//////////////////////
// Search Functions //
//////////////////////


// This function returns an array with the IDs of all intervals which 
// the given key falls within.
// The function simply performs a simple binary search for the key and
// collects all the intervals on the nodes along this search (until it
// reaches a leaf node). It is guaranteed that each matched interval 
// appears on this path exactly once, so we can simply push the 
// intervals on the result array. The only case which requires
// some care is when at some point the key is matched exactly
// on a node. In this case, we first add to the list of matches
// all intervals stored in the edn point lists of the node (these
// are the intervals which have a closed end point at this value, including
// degenerate intervals). Next, the function continues the search
// (with the same seach key) under the left child, but only adds as
// matches those intervals which are marked as not ending at the
// span of the node. 

IntervalTree.prototype.find = intervalTreeFind;

function intervalTreeFind(key)
{
    var entireDomainIntervals = [];
    this.entireDomainIntervals.forEach(function(t,id) {
        entireDomainIntervals.push(id);
    });

    if(!this.root)
        return entireDomainIntervals;
    
    return this.findKeyUnder(this.root, this.root.value, key, false,
                             entireDomainIntervals);
}

// This function inplements the search of the 'find' function.
// Given a node, a value object for that node and a key, this function
// adds the intervals IDs found on the value object (which must be of
// the format { end: <Map>{ <interval ID>: true, .... }, 
//              dontEnd: <Map>{ <interval ID>: true, .... },
//              lowEnd: <Map>{ <interval ID>: true, .... },
//              highEnd: <Map>{ <interval ID>: true, .... },
//              degenerateEnd: <Map>{ <interval ID>: true, .... })
// to the array matchedIds.
// If the key is equal to the key node, only the intervals in 
// 'lowEnd', 'highEnd' and 'degenerate' are added. Otherwise, 
// if 'dontEndOnly' is set, only the intervals in the list 'dontEnd' are 
// added. Otherwise, all intervals in 'end' and 'dontEnd' are added.  
// The function then continues to the child of 'node' where the next
// list of intervals should be read from. Which child it is depends
// on the key and the key of the node (if 'key' is smaller or equal the key of
// node, the function continues to the left child and if it is 
// larger, it continues to the right child). When the key is equal 
// to the key of the node, the 'dontEndOnly' flag is set.
// This tells the function that it should only push the intervals which 
// dont end at the visited node. Because the search continues under the left 
// child of a node whose key equals the lookup key, the search continues
// down right children of this left child and the span of all these nodes 
// has its high value equal to the search key. Therefore, a match is 
// possible only if the interval stored on the node continues (to the right) 
// beyond this node span or has a closed end point at the search key (and 
// these intervals were already added).
// When a child node is undefined, it is a leaf node and its value is
// stored on the parent node. The value is then defined but the node
// is undefined. The loop continues one more step and then the function 
// returns.

IntervalTree.prototype.findKeyUnder = intervalTreeFindKeyUnder;

function intervalTreeFindKeyUnder(node, value, key, dontEndOnly, matchedIds)
{
    while(1) {

        // copy the intervals recorded on the value to the list of matches
        if(value.dontEnd.size > 0)
            value.dontEnd.pushTo(matchedIds);
        if(!dontEndOnly && value.end.size > 0)
            value.end.pushTo(matchedIds);
        if(node === undefined)
            return matchedIds;
        
        var cmpKeyNodeKey;

        if(!dontEndOnly) {

            // did not yet visit a node whose key is the search key

            cmpKeyNodeKey = this.compare(key, node.key);
            
            if(cmpKeyNodeKey === 0) {
                // add intervals which have closed end point at this key
                if(node.lowEnd !== undefined && node.lowEnd.size > 0)
                    node.lowEnd.pushTo(matchedIds);
                if(node.highEnd !== undefined && node.highEnd.size > 0)
                    node.highEnd.pushTo(matchedIds);
                if(node.degenerate !== undefined && node.degenerate.size > 0)
                    node.degenerate.pushTo(matchedIds);
            }
            
            if(cmpKeyNodeKey <= 0) {
                if(node.left === undefined)
                    value = node.value.leftLeaf;
                else
                    value = node.left.value;
                node = node.left;
                dontEndOnly = (cmpKeyNodeKey === 0);
            } else {
                if(node.right === undefined)
                    value = node.value.rightLeaf;
                else
                    value = node.right.value;
                node = node.right;
            }
        } else {
            if(node.right === undefined)
                value = node.value.rightLeaf;
            else
                value = node.right.value;
            node = node.right;
        }     
    }

    return matchedIds;
}

// This function returns an array of the IDs of all intervals stored
// in the tree which intersect with the interval <lowKey, highKey>.
// 'openLow' and 'openHigh' indicate whether the interval <lowKey, highKey> 
// should be considered open or closed on the lower or higher
// end. For example, if 'openLow' is true and 'openHigh' is false, the
// interval is (loweKey, openKey].
// To find these intervals, the function goes down the paths of the tree
// using both the low and high keys. At each node, if both keys are
// smaller than the key of the node, the search continues to the left
// child and if both keys are larger than the node key the search
// continues to the right child. In all other cases, the search
// continues to both children (using a recursive function call).
// If loweKey > highKey then the function is applied to [highKey, lowKey]
// (but note that 'openLow' and 'openHigh' still refer to the low and high
// end of the interval, not to 'highKey' ad 'lowKey' so if openLow is
// true and openHigh is false, the resulting search interval is 
// (highKey, lowKey].

IntervalTree.prototype.findIntersections = intervalTreeFindIntersections;

function intervalTreeFindIntersections(lowKey, highKey, openLow, openHigh)
{
    var cmpLowKeyHighKey = this.compare(lowKey, highKey);

    if(cmpLowKeyHighKey === 0) {
        if(openLow || openHigh)
            return []; // empty search interval
        return this.find(lowKey);
    }

    var entireDomainIntervals = [];
    this.entireDomainIntervals.forEach(function(t,id) {
        entireDomainIntervals.push(id);
    });

    if(!this.root)
        return entireDomainIntervals;
    
    if(cmpLowKeyHighKey > 0)
        // the order of highKey and lowKey is reversed, but not that of
        /// openLow and openHigh (see introduction to function). 
        return this.findIntersectionsUnder(this.root, this.root.value, highKey, 
                                           lowKey, openLow, openHigh, 
                                           this.minimumKeyValue,
                                           this.maximumKeyValue,
                                           entireDomainIntervals);
    else 
        return this.findIntersectionsUnder(this.root, this.root.value, lowKey, 
                                           highKey, openLow, openHigh, 
                                           this.minimumKeyValue,
                                           this.maximumKeyValue,
                                           entireDomainIntervals);
}

// This function implements the recursion of the 'findIntersections' function.
// Given a node, a value object for that node and a low and high search key
// (together with an indication whether the search interval is open or closed
// at the low and high end) this function adds the intervals IDs found on 
// the value object, which must be of the format: 
//                  { end: <Map>{ <interval ID>: true, .... }, 
//                    dontEnd: <Map>{ <interval ID>: true, .... },
//                    lowEnd: <Map>{ <interval ID>: true, .... },
//                    highEnd: <Map>{ <interval ID>: true, .... },
//                    degenerateEnd: <Map>{ <interval ID>: true, .... })
// to the object matchedIds.
// The function then continues down the children of the node. If both
// the low key and the high key are smaller than or equal to the key of 
// the node, the search continues to the left child and if both keys are larger
// or equal than the node key the search continues to the right child. In all
// other cases, the search continues to both children (using a
// recursive function call). This means that the spans visited all have an
// overlap with the search interval. Moreover, if an interval is matched
// by the search interval it must either have such an overlap or it must
// have a closed end point at a closed end point of the search interval
// or it must be a degenerate interval stored on one of the nodes traversed.
// Since the same interval may appear on multiple nodes traversed by this 
// search, we add an interval ID to the 'matchedIds' list only if 
// this is the rightmost matched segment of the interval. This means that 
// the interval IDs under the 'dontEnd' field of a node
// need to be copied to the matchedIds iff the span of the node reaches 
// beyond the highKey. Otherwise, the dominating node carrying a key equal to 
// highKey (if such a node exists) or the node covering the next segment 
// in the interval will add it to the list of matches. For
// this reason, the span of the node is also given in the arguments of
// the function.
// In addition to these intervals, we also need to copy the following
// intervals to the matchedIds:
// 1. degenerate intervals on a node whose key is within the search
//    interval.
// 2. if the high end of the search interval is closed: intervals in 
//    the 'lowEnd' list of a node whose key is equal to the highKey of 
//    the search interval.
// 3. if the low end of the search interval is closed: intervals in 
//    the 'highEnd' list of a node whose key is equal to the lowKey of 
//    the search interval.

// This function should only be used internally by this class.

IntervalTree.prototype.findIntersectionsUnder = 
    intervalTreeFindIntersectionsUnder;

function intervalTreeFindIntersectionsUnder(node, value, lowKey, highKey,
                                            openLow, openHigh,
                                            lowSpan, highSpan, matchedIds)
{
    // copy the intervals recorded on the value to the list of matches
    value.end.forEach(function(t,id) {
        matchedIds.push(id);
    });
    if(this.compare(highSpan, highKey) >= 0)
        value.dontEnd.forEach(function(t,id) {
            matchedIds.push(id);
        });
    
    if(!node)
        return matchedIds;

    var cmpLowKeyNodeKey = this.compare(lowKey, node.key);

    if(!openLow && cmpLowKeyNodeKey === 0 && node.highEnd !== undefined)
        // intervals whose high end is closed and equal to the low search key
        node.highEnd.forEach(function(t,id) {
            matchedIds.push(id);
        });

    if(cmpLowKeyNodeKey < 0) {
        if(node.left === undefined)
            value = node.value.leftLeaf;
        else
            value = node.left.value;
        this.findIntersectionsUnder(node.left, value, lowKey, highKey, 
                                    openLow, openHigh,
                                    lowSpan, node.key, matchedIds);
    }

    var cmpHighKeyNodeKey = this.compare(highKey, node.key);

    if(!openHigh && cmpHighKeyNodeKey === 0 && node.lowEnd !== undefined)
        // intervals whose low end is closed and equal to the high search key
        node.lowEnd.forEach(function(t,id) {
            matchedIds.push(id);
        });

    if(cmpHighKeyNodeKey > 0) {
        if(node.right === undefined)
            value = node.value.rightLeaf;
        else
            value = node.right.value;
        this.findIntersectionsUnder(node.right, value, lowKey, highKey, 
                                    openLow, openHigh, 
                                    node.key, highSpan, matchedIds);
    }

    if(node.degenerate !== undefined &&
       (cmpLowKeyNodeKey < 0 || (!openLow && cmpLowKeyNodeKey === 0)) &&
       (cmpHighKeyNodeKey > 0 || (!openHigh && cmpHighKeyNodeKey === 0)))
        node.degenerate.forEach(function(t,id) {
            matchedIds.push(id);
        });

    return matchedIds;
}

// This function returns an array containing the IDs of all intervals
// stored in this interval tree which are contained within the search
// interval <lowKey, highKey>. 'openLow' and 'openHigh'
// indicate whether the search interval <lowKey, highKey> should be considered
// open or closed on the lower or higher side. For example, if 'openLow'
// is true and 'openHigh' is false, the intervals must be contained
// in (loweKey, openKey].
// The ID of each interval matched is guaranteed to appear exactly once in 
// the array returned by this function.

IntervalTree.prototype.findContained = intervalTreeFindContained;

function intervalTreeFindContained(lowKey, highKey, openLow, openHigh)
{
    var cmpKeys = this.compare(lowKey, highKey);

    if(cmpKeys === 0 && (openLow || openHigh))
        return []; // no interval can be contained in a single point

    if(cmpKeys > 0) { // lowKey > highKey 
        // reverse key order (but not the 'open' flag order)
        var temp = lowKey;
        lowKey = highKey;
        highKey = temp;
    }

    var matchedIds = [];

    if(this.compare(lowKey, this.minimumKeyValue) === 0 &&
       this.compare(highKey, this.maximumKeyValue) === 0)
        this.entireDomainIntervals.forEach(function(t,id) {
            matchedIds.push(id);
        });

    if(!this.root)
        return matchedIds;

    this.findContainedUnder(this.root, this.root.value, lowKey, 
                            highKey, openLow, openHigh,
                            -Infinity, Infinity, matchedIds);
    
    return matchedIds;
}

// This function recursively implements the lookup of intervals which are
// contained in the interval <lowKey, highKey>. 'openLow' and 'openHigh'
// indicate whether the interval <lowKey, highKey> should be considered
// open or closed on the lower or higher side. For example, if 'openLow'
// is true and 'openHigh' is false, the intervals must be contained
// in (loweKey, openKey]. We will refer to this as the 'search interval'.
// This function is applied (recursively) to a node in the interval tree.
// This node, given in 'node', has the value object 'value'.
// 'node' may also be undefined, in which case it is a leaf node
// and its value is provided in 'value'. 'lowSpan' and 'highSpan'
// specify the span of the node (see introduction for a definition of this
// span).
// This function (including the recursive calls inside it) adds to 
// 'matchedIds' the IDs of all intervals contained in the search interval
// and ending within the span of the node.
// If highSpan is in the search interval (but is not equal to its high key), 
// this function also returns a list of intervals which should not be matched. 
// This list includes intervals stored under the node or any of its children
// such that:
// 1. The interval is stored on a node whose span is not contained in 
//    the search interval (meaning that the interval should not be matched).
// 2. The interval does not end inside the span of the node (the node
//    for which this function was called). This means that another segment
//    of the interval is stored under another node to the right of 
//    this node.
// This list is needed because the second condition indicates that 
// this segment is stored on some other node in the tree, to the right
// of this node, and given the condition on highSpan, it may be that
// the span of that node is contained in the search interval. Therefore,
// when the recursion arives at that node, it needs to know that another
// segment of the same interval was found which extended beyond the 
// search interval. The recursive call to this function traverses the 
// interval tree depth first and left to right, so this exclusion list
// is always available before the node storing the end of the interval
// is traversed.
//
// At a given point in the recursion, the function checks whether the
// span of the node is contained in the search interval. If it is, it
// adds to 'matchedIds' those intervals which are stored in its 'end'
// list (intervals which end in this span) and which are not in the
// 'dontAdd' list provided to the function. All intervals stored in
// the 'dontEnd' list of the node and are in the 'dontAdd' list with
// which the function was called, should be added to the 'dontAdd'
// list which the function returns. In this case, these are all the
// intervals in the 'dontAdd' list which should be returned by this
// function. However, to simplify the processing, in this case, the function
// simply returns the 'dontAdd' list it received. Some of the IDs in 
// it may not be needed, but they cause no harm (these IDs will not be
// matched and therefore there is no need to check whether they should
// be added, but it does no harm if they remain in the table). Since the
// span of the child nodes is also contained in the search interval, this
// also applies to the recursive call to the child nodes and the 
// 'dontAdd' list remains unchanged throughout this call.
// In this case, where the span of the node is contained in the search
// interval, the function needs o be called recursively on both its
// children.
//
// If the low end of the span of this node is higher or equal the high key
// of the search interval (whether the high end of the search interval
// is open or closed) there is no need to call this function on this
// node. This is because the spans of this node and all nodes under it 
// cannot be contained in the search interval and this call cannot
// provide any matches. Similarly, all nodes to its right cannot
// provide matches, so there is no need to construct a 'dontAdd' list.

// If the high end of the span of the node is strictly smaller than 
// than the low key of the search span or is equal to it and the low
// end of the search interval is open, the function does not need to
// be called on the node (there can be no matches under the node and
// any segments stored under this node (and its children) which are
// also stored on nodes to the right of this node, will also be stored
// on some node to the right which is not contained in the search interval
// and, therefore, this node does not need to generate a 'dontAdd' list
// for nodes to its right.
//
// These two cases are the cases where the span of the node and the
// search interval are 'disjoint'. If the span is considered a closed
// interval, this is equivalent to the standard definition of disjoint
// interval except that the case where the intersection of the two intervals 
// is exactly the high point of the search interval and the low point 
// of the span is also considered 'disjoint' (this is because the spans
// of all nodes have non-zero length and therefore the single point 
// intersection cannot contain a matched interval).
//
// Excluding the cases where the span is contained in the search interval
// and the case where the span and the search interval are disjoint
// (as defined in the previous paragraph) we consider the remaining cases:
// where there is an overlap, but the span extends beyond the search
// interval and where the search interval is contained in the span
// of the node. These three cases are covered below by two conditions.
//
// If the low end of the span of the node is smaller than the low end
// of the search interval, the function receives no 'dontAdd' list
// as input. It must call itself recursively on its left child if 
// the span of that child is not disjoint from the search interval
// (as defined above). This recursive call is preformed without
// providing a 'dontAdd' list (because the 'dontAdd' list of the calling
// step also did not have such a list) but it may return a 'dontAdd'.
// This 'dontAdd' list is then used in calling the function recusively
// on the right child. The 'dontAdd' list returned by the right child
// is also the 'dontAdd' list returned by this function.
//
// The remaining case is when the high end of the span of the node is higher
// than the high end of the search interval. In this case, the function
// does not need to generate a 'dontAdd' list. It calls itself 
// recursively on its left child with the 'dontAdd' list it received.
// If the span of its right child and the search interval are not
// disjoint, the function is called recursively on the right child
// with the 'dontAdd' list returned by the call on the left child.
// 
// Remark: this function guarantees that each matched interval ID appears
// only once in the 'matchedIds' array.

IntervalTree.prototype.findContainedUnder = 
    intervalTreeFindContainedUnder;

function intervalTreeFindContainedUnder(node, value, lowKey, highKey,
                                        openLow, openHigh,
                                        lowSpan, highSpan, matchedIds, 
                                        dontAdd)
{
    if(node) { // continue down
        
        var subValue; // value object for the recursive call
        
        var cmpLowKeyNodeKey = this.compare(lowKey, node.key);
        var cmpHighKeyNodeKey = this.compare(highKey, node.key);

        if(cmpHighKeyNodeKey === 0 && openHigh && node.highEnd !== undefined) {
            // don't add segments with a closed high end point at this node
            if(!dontAdd)
                dontAdd = this.storageAllocate();
            node.highEnd.forEach(function(t,id) {
                dontAdd.set(id, true);
            });
        }

        //   lowKey <= node.key 
        // (the case lowKey == node.key is needed only to get the dontAdd list)
        if(cmpLowKeyNodeKey <= 0) {
            if(node.left === undefined)
                subValue = node.value.leftLeaf;
            else
                subValue = node.left.value;
            dontAdd = // may be returned empty
                this.findContainedUnder(node.left, subValue, lowKey, highKey,
                                        openLow, openHigh,
                                        lowSpan, node.key, matchedIds, 
                                        dontAdd);
            if(node.degenerate && 
               (cmpLowKeyNodeKey < 0 || !openLow) &&
               (cmpHighKeyNodeKey > 0 || (cmpHighKeyNodeKey === 0 && !openHigh)))
                node.degenerate.forEach(function(t,id) {
                    matchedIds.push(id);
                });
        }
        
        if(cmpLowKeyNodeKey === 0 && openLow && node.lowEnd !== undefined) {
            // don't add segments with a closed low end point at this node
            if(!dontAdd)
                dontAdd = this.storageAllocate();
            node.lowEnd.forEach(function(t,id) {
                dontAdd.set(id, true);
            });
        }

        // single point overlap cannot produce any matches on the right branch, 
        // so no need to distinguish between open an closed high key.
        if(cmpHighKeyNodeKey > 0) { // highKey > node.key
            if(node.right === undefined)
                subValue = node.value.rightLeaf;
            else
                subValue = node.right.value;
            dontAdd = 
                this.findContainedUnder(node.right, subValue, lowKey, highKey, 
                                        openLow, openHigh,
                                        node.key, highSpan, matchedIds, 
                                        dontAdd);
        }
    }

    var cmpLowKeyLowSpan = this.compare(lowKey, lowSpan);
    var cmpHighKeyHighSpan = this.compare(highKey, highSpan);
    //    lowKey <= lowSpan      highKey > highSpan
    if(cmpLowKeyLowSpan <= 0 && cmpHighKeyHighSpan >= 0) {
        // the span of the node is contained in the search interval.
        // Add as matched segments which end here and are not excluded
        // by the 'dontAdd' list.
        if(dontAdd !== undefined) {
            value.end.forEach(function(t,id) {
                if(!dontAdd.has(id))
                    matchedIds.push(id);
            });
        } else {
            value.end.forEach(function(t,id) {
                matchedIds.push(id);
            });
        }
        // the input dontAdd list is also the list to be returned
        // The recursive call to the left and right children must have
        // done exactly the same, as the child spans must also be contained
        // in the  
    } else if(cmpHighKeyHighSpan < 0) // highKey < highSpan
        // tree nodes to the right of this node cannot match, so no need
        // to generate an exclusion 'dontAdd' list.
        return undefined;
    else {
        // this span extends below the search interval, but not above it
        // so all intervals stored in it which do not end at this span are 
        // not to be added by matches on nodes to the right.
        if(!dontAdd)
            dontAdd = this.storageAllocate();
        value.dontEnd.forEach(function(t,id) {
            dontAdd.set(id, true);
        });
    }

    return dontAdd;
}

// This function returns an array containing the IDs of all intervals
// stored in this interval tree which intersect with the search interval 
// <lowKey, highKey> and are contained in the interval (-infinity, upperBound)
// if upperBoundOpen is true or in the interval (-infinity, upperBound]
// if upperBoundOpen is false.
// 'openLow' and 'openHigh' indicate whether the search interval 
// <lowKey, highKey> should be considered open or closed on the lower 
// or higher side. For example, if 'openLow' is true and 'openHigh' is false, 
// the search interval is (loweKey, openKey]. While upperBound may be
// smaller than highKey, this does not make much sense, as this is equivalent
// to searching for intersections with <lowKey, upperBound). Therefore, if
// upperBound is smaller than highKey, highKey is set to be equal to 
// upperBound and openHigh is set to true (also, if highKey is equal to
// upperBound, openHigh is set to true). 
// The ID of each interval matched is guaranteed to appear exactly once in 
// the array returned by this function.

IntervalTree.prototype.findWithUpperBound = 
    intervalTreeFindWithUpperBound;

function intervalTreeFindWithUpperBound(lowKey, highKey, openLow, openHigh, 
                                        upperBound, upperBoundOpen)
{
    if(this.compare(upperBound, this.maximumKeyValue) >= 0)
        // no upper bound
        return this.findIntersections(lowKey, highKey, openLow, openHigh);

    if(this.root === undefined)
        // no intervals except, perhaps, for the full range interval,
        // and this is matched only if the upper bound is infinite,
        // which would have been handled by the code above (upper bound
        // not smaller than maximal value).
        return [];
    
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

    if(cmpLowHigh === 0 && (openLow || openHigh))
        return []; // empty interval

    var matchedIds = [];

    this.findWithUpperBoundUnder(this.root, this.root.value, lowKey, highKey, 
                                 openLow, openHigh, !cmpLowHigh, upperBound,
                                 upperBoundOpen,
                                 this.minimumKeyValue, this.maximumKeyValue, 
                                 matchedIds);
    return matchedIds;
}

// This function implements the recursive step of findWithUpperBound().
// It receives as input a node such that the closure of its span
// [lowSpan, highSpan] must intersect with (lowKey, upperBound] or,
// if lowKey == highKey, with [lowKey, upperBound] but 
// (lowSpan, highSpan) is not contained in (highKey, upperBound).
// 'dontAdd' is an object holding the IDs of intervals which should not 
// be added to the list of matches. This list may be provided by the recursive 
// call to this function (see details below).
// In contrast to other recursive search functions, this function first
// goes down the right child of a node and only then down the left child 
// of the node. This is because the list of intervals not to add for 
// a given span is detemined based on spans to its right (those extending
// beyond the upper bound).
//  
// If highSpan is larger than upperBound and lowSpan is larger or equal highKey 
// the intervals stored on the span are added to the dontAdd list
// (these are intervals which may fall under criteria for possible inclusion
// in the matches list, as specified below).
// If highSpan is smaller or equal to upperBound then by the assumption on
// the span of the node, lowSpan is smaller than highKey. In this case:
// 1. If highSpan is smaller than highKey, all intervals ending with this
//    span are added to the match list.
// 2. If highSpan is larger or equal highKey, all intervals ending with this 
//    span can be added to the match list unless highSpan is equal to 
//    upperBound, in which case we first need to check whether that they
//    do not appear in 'dontAdd' (this is in case the interval as a closed
//    high end point at the upper bound). All intervals which do not 
//    end at the span may also be added to the list of matches if they 
//    do not appear in the 'dontAdd' list.
//
// In addition to the intervals stored for each span, this function must
// also consider end points stored on the nodes traversed.
// 1. All degenerate intervals stored on nodes whose key is inside the
//    search interval need to be added to the list of matches.
// 2. If the upper bound is open, all intervals with a closed high end at 
//    the node with a key equal to upperBound should be added to the 
//    dontAdd list.
// 3. If openHigh is false (which also means highKey is smaller than 
//    upperBound) and intervals with a closed low end at the node with key 
//    equal to highKey should be added to list of matches unless they appear 
//    in the 'dontAdd' list returned by the recursive call on the right child of
//    this node.
// 4. if openLow is false, intervals with a closed high end at 
//    the node whose key is equal to lowKey need to be added to the 
//    list of matches. 

IntervalTree.prototype.findWithUpperBoundUnder = 
    intervalTreeFindWithUpperBoundUnder;

function intervalTreeFindWithUpperBoundUnder(node, value, lowKey, highKey, 
                                             openLow, openHigh, degenerate,
                                             upperBound, upperBoundOpen,
                                             lowSpan, highSpan, matchedIds,
                                             dontAdd)
{
    var cmpHighSpanUpperBound = this.compare(highSpan, upperBound);
    var cmpLowSpanHighKey = this.compare(lowSpan, highKey);

    if(node) {

        var subValue;

        var cmpHighKeyNodeKey = this.compare(highKey, node.key);
        var cmpLowKeyNodeKey  = this.compare(lowKey, node.key)
        var cmpNodeKeyUpperBound = this.compare(node.key, upperBound);

        // go down the right child if either highKey > node.key or
        // highSpan > upperBound and node.key =< upperBound
        if(cmpHighKeyNodeKey > 0 || 
           (cmpHighSpanUpperBound > 0 && cmpNodeKeyUpperBound <= 0)) { 
            if(node.right === undefined)
                subValue = node.value.rightLeaf;
            else
                subValue = node.right.value;
            dontAdd = 
                this.findWithUpperBoundUnder(node.right, subValue, lowKey, 
                                             highKey, openLow, openHigh, 
                                             degenerate, upperBound, 
                                             upperBoundOpen, node.key, 
                                             highSpan, matchedIds, dontAdd);
        }

        // add degenerate intervals inside the search interval
        if(node.degenerate !== undefined &&
           (cmpLowKeyNodeKey < 0 || (!openLow && cmpLowKeyNodeKey === 0)) &&
           (cmpHighKeyNodeKey > 0 || (!openHigh && cmpHighKeyNodeKey === 0))) {
                node.degenerate.forEach(function(t,id) {
                    matchedIds.push(id);
                });
        }
        // if the upper bound is open, check for closed high ends which are 
        // at the upper bound and therefore should not be added as matches 
        // (the upper bound is open, by definition).
        if(node.highEnd !== undefined && upperBoundOpen && 
           cmpNodeKeyUpperBound === 0) {
            if(dontAdd === undefined)
                dontAdd = this.storageAllocate();
            node.highEnd.forEach(function(t,id) {
                dontAdd.set(id, true);
            });
        }
        // intervals with closed low end which just match the high end
        // of the search interval
        if(!openHigh && node.lowEnd !== undefined && cmpHighKeyNodeKey === 0) {
            if(dontAdd !== undefined) {
                node.lowEnd.forEach(function(t,id) {
                    if(!dontAdd.has(id))
                        matchedIds.push(id);
                });
            } else {
                node.lowEnd.forEach(function(t,id) {
                    matchedIds.push(id);
                });
            }
        }
        // intervals with closed high end which just match the low end
        // of the search interval
        if(!openLow && node.highEnd && cmpLowKeyNodeKey === 0) {
            node.highEnd.forEach(function(t,id) {
                matchedIds.push(id);
            });
        }

        // go down the left child if node.key > upperBound or 
        // lowSpan < highKey && lowKey < node.key (or 
        // lowKey == node.key if the lookup interval is degenerate).
        if(cmpNodeKeyUpperBound > 0 || 
           (cmpLowSpanHighKey < 0 && 
            (cmpLowKeyNodeKey < 0 || (degenerate && cmpLowKeyNodeKey === 0)))) {

            if(node.left === undefined)
                subValue = node.value.leftLeaf;
            else
                subValue = node.left.value;
            dontAdd =
                this.findWithUpperBoundUnder(node.left, subValue, lowKey, 
                                             highKey, openLow, openHigh,
                                             degenerate, upperBound,
                                             upperBoundOpen, lowSpan, node.key, 
                                             matchedIds, dontAdd);
        }
    }

    // add interval segments to the list of matches or dontAdd list 

    if(cmpHighSpanUpperBound > 0) {
        if(cmpLowSpanHighKey >= 0) {
            // these intervals are not inside the upper bound but may be matched
            // as potential matches
            if(!dontAdd)
                dontAdd = this.storageAllocate();
            value.end.forEach(function(t,id) {
                dontAdd.set(id, true);
            });
            value.dontEnd.forEach(function(t,id) {
                dontAdd.set(id, true);
            });
        }
    } else {
        var cmpHighSpanHighKey = this.compare(highSpan, highKey);
        if(cmpHighSpanHighKey < 0) {
            value.end.forEach(function(t,id) {
                matchedIds.push(id);
            });
        } else {
            if(!degenerate || cmpHighSpanHighKey > 0) {
                // in the degenerate case, the high end of the span and 
                // the lookup interval can be equal, in which case we
                // only want to match intervals which do not end at this
                // span.
                if(cmpHighSpanUpperBound < 0 || !dontAdd) {
                    value.end.forEach(function(t,id) {
                        matchedIds.push(id);
                    });
                } else {
                    value.end.forEach(function(t,id) {
                        if(!dontAdd.has(id))
                            matchedIds.push(id);
                    });
                }
            }
            if(cmpHighSpanUpperBound < 0) {
                if(dontAdd !== undefined) {
                    value.dontEnd.forEach(function(t,id) {
                        if(!dontAdd.has(id))
                            matchedIds.push(id);
                    });
                } else {
                    value.dontEnd.forEach(function(t,id) {
                        matchedIds.push(id);
                    });
                }
            }
        }
    }

    return dontAdd;
}

// This function returns an array containing the IDs of all intervals
// stored in this interval tree which intersect with the search interval 
// <lowKey, highKey> and are contained in the interval (lowerBound, infinity)
// if lowerBoundOpen is true or in the interval [lowerBound, infinity)
// if lowerBoundOpen is false.
// 'openLow' and 'openHigh' indicate whether the search interval 
// <lowKey, highKey> should be considered open or closed on the lower 
// or higher side. For example, if 'openLow' is true and 'openHigh' is false, 
// the search interval is (loweKey, openKey]. While lowerBound may be
// larger than lowKey, this does not make much sense, as this is equivalent
// to searching for intersections with (lowerBound, highKey>. Therefore, if
// lowerBound is larger than lowKey, lowKey is set to be equal to 
// lowerBound and openLow is set to true (also, if lowKey is equal to
// lowerBound, openLow is set to true). 
// The ID of each interval matched is guaranteed to appear exactly once in 
// the array returned by this function.

IntervalTree.prototype.findWithLowerBound = 
    intervalTreeFindWithLowerBound;

function intervalTreeFindWithLowerBound(lowKey, highKey, openLow, openHigh, 
                                        lowerBound, lowerBoundOpen)
{
    if(this.compare(lowerBound, this.minimumKeyValue) <= 0)
        // no lower bound
        return this.findIntersections(lowKey, highKey, openLow, openHigh);

    if(this.root === undefined)
        // no intervals except, perhaps, for the full range interval,
        // and this is matched only if the lower bound is -infinity,
        // which would have been handled by the code above (lower bound
        // not larger than minimal value).
        return [];
    
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

    if(cmpLowHigh === 0 && (openLow || openHigh))
        return []; // empty interval

    var matchedIds = [];

    this.findWithLowerBoundUnder(this.root, this.root.value, lowKey, highKey, 
                                 openLow, openHigh, !cmpLowHigh, lowerBound,
                                 lowerBoundOpen,
                                 this.minimumKeyValue, this.maximumKeyValue, 
                                 matchedIds);

    return matchedIds;
}

// This function implements the recursive step of findWithLowerBound().
// It receives as input a node whose span (lowSpan, highSpan) must have 
// the following properties:
// [lowSpan, highSpan] intersect with [lowerBound, highKey) but
// (lowSpan, highSpan) is not contained in (lowerBound, lowKey).
// In the case of a degenerate lookup intervals (lowKey == highKey), 
// we require that (lowSpan, highSpan] is not contained in (lowerBound, lowKey)
// (meaning that we also consider spans where highSpan == lowKey == highKey
// even if lowSpan >= lowerBound).
// 'dontAdd' is an object holding the IDs of intervals which should not 
// be added to the list of matches. This list may be provided by the recursive 
// call to this function. Segments of intervals which have the lower
// bound inside them (including the case where the lower bound is their
// high end point) but do not cover the full (lowKey, highKey) interval are 
// added to this list if the segment is not marked as
// the last ('end') segment of the interval. Since these segments are
// not the rightmost segments of the interval and by the assumption on
// these segments, the next segment to the right would be considered 
// a potential match and we need to know it should not be added. See more 
// details below.
// To ensure that every interval matched is added only once, it is added
// to the matched list on its rightmost segment stored in the tree and
// intersects with (lowKey, higKey) is encountered. The rightmost segment
// can easily be recognized because it is either in the 'end' list
// (meaning it is the rightmost segment for this interval) or the high end
// of the span of the segment is equal or larger than highKey. 
//
// This function receives as input (in addition to the search interval
// and lower bound) a node (which may be undefined if it
// is a leaf node) its value object (which is always defined) and
// the span of the node. It then updates the matches list and 'dontAdd'
// list it received and continues recursively to its child nodes, if
// necessary (if their span fulfills the condition specified above that
// (lowSpan, highSpan] intersects with [lowerBound, highKey> but 
// (lowSpan, highSpan) is not contained in (lowerBound, lowKey).
// 
// If lowSpan is larger or equal the lower bound and highSpan is larger
// than lowKey then all segments in the 'end' list of the value object
// are added to the matches if they are not in 'dontAdd'. If highSpan
// is larger or equal to highKey, then also the intervals in the 'dontEnd'
// list can be added to the list of matches, if they are not in 'dontAdd'.
//
// If lowSpan is smaller than lowerBound then all intervals stored
// on the value as 'dontEnd' need to be added to the 'dontAdd' list.
//
// In addition, we need to take care of end points (only available when 
// 'node' is not undefined) as follows: 
// 1. If the key falls inside the <lowKey, highKey> interval (taking into
//    account its open/closed properties) all degenerate intervals 
//    stored on this node need to be added to the list of matches.
// 2. If the lower bound is open and the key is equal to lowerBound then 
//    all intervals which have a closed low end at this key need to be 
//    added to the 'dontAdd' list.
// 3. If openLow is false and the key is equal to lowKey, all intervals
//    with a closed high end at this node which do not appear in the 
//    dontAdd list (returned by the recursive call to the children)
//    should be added to the list of matches.
// 4. If openHigh is false and the key is equal to highKey, all intervals
//    with a closed low end at this node need to be added
//    to the list of changes.

IntervalTree.prototype.findWithLowerBoundUnder = 
    intervalTreeFindWithLowerBoundUnder;

function intervalTreeFindWithLowerBoundUnder(node, value, lowKey, highKey, 
                                             openLow, openHigh, degenerate,
                                             lowerBound, lowerBoundOpen,
                                             lowSpan, highSpan, matchedIds,
                                             dontAdd)
{
    var cmpLowSpanLowerBound = this.compare(lowSpan, lowerBound);
    var cmpHighSpanLowKey = this.compare(highSpan, lowKey);

    if(node) {

        var subValue;

        var cmpNodeKeyLowerBound = this.compare(node.key, lowerBound);
        var cmpLowKeyNodeKey = this.compare(lowKey, node.key);
        var cmpHighKeyNodeKey = this.compare(highKey, node.key);

        // go down the left child if either the node key is larger than 
        // the low key or if it is larger or equal the lower bound
        // and the low span is smaller than the lower bound.
        // In the case of a degenerate lookup intervals, also if the 
        // low key (==highKey) is equal to the node key.
        if((degenerate && cmpLowKeyNodeKey <= 0) ||
           cmpLowKeyNodeKey < 0 ||
           (cmpLowSpanLowerBound < 0 && cmpNodeKeyLowerBound >= 0)) {
            if(node.left === undefined)
                subValue = node.value.leftLeaf;
            else
                subValue = node.left.value;
            dontAdd =
                this.findWithLowerBoundUnder(node.left, subValue, lowKey, 
                                             highKey, openLow, openHigh,
                                             degenerate, lowerBound, 
                                             lowerBoundOpen, lowSpan, 
                                             node.key, matchedIds, dontAdd);
        }

        // add degenerate intervals inside the search interval
        if(node.degenerate !== undefined &&
           (cmpLowKeyNodeKey < 0 || (!openLow && cmpLowKeyNodeKey === 0)) &&
           (cmpHighKeyNodeKey > 0 || (!openHigh && cmpHighKeyNodeKey === 0))) {
            node.degenerate.forEach(function(t,id) {
                matchedIds.push(id);
            });
        }
        
        // check for closed low ends which are at the lower bound and
        // therefore should not be added as matches (the lower bound is 
        // open, by definition).
        if(node.lowEnd !== undefined && lowerBoundOpen && 
           cmpNodeKeyLowerBound === 0) {
            if(dontAdd === undefined)
                dontAdd = this.storageAllocate();
            node.lowEnd.forEach(function(t,id) {
                dontAdd.set(id, true);
            });
        }
        
        // intervals with closed high end which just match the low end
        // of the search interval
        if(!openLow && node.highEnd !== undefined && cmpLowKeyNodeKey === 0) {
            if(dontAdd !== undefined) {
                node.highEnd.forEach(function(t,id) {
                    if(!dontAdd.has(id))
                        matchedIds.push(id);
                });
            } else {
                node.highEnd.forEach(function(t,id) {
                    matchedIds.push(id);
                });
            }
        }
        // intervals with closed low end which just match the high end
        // of the search interval
        if(!openHigh && node.lowEnd && cmpHighKeyNodeKey === 0) {
            node.lowEnd.forEach(function(t,id) {
                matchedIds.push(id);
            });
        }
        
        // go down the right child if either node.key < lowerBound (by
        // assumption on the span, highSpan is then larger or equal
        // lowerBound) or highSpan > lowKey (or, if the search interval
        // is degenerate, highSpan >= lowKey) and highKey > node.key
        if(cmpNodeKeyLowerBound < 0 || 
           (((degenerate && cmpHighSpanLowKey >= 0) || cmpHighSpanLowKey > 0) &&
            cmpHighKeyNodeKey > 0)) {
            if(node.right === undefined)
                subValue = node.value.rightLeaf;
            else
                subValue = node.right.value;
            dontAdd = 
                this.findWithLowerBoundUnder(node.right, subValue, lowKey, 
                                             highKey, openLow, openHigh,
                                             degenerate, lowerBound, 
                                             lowerBoundOpen, node.key, 
                                             highSpan, matchedIds, dontAdd);
        }
    }

    // add interval segments to the list of matches or dontAdd list

    if(cmpLowSpanLowerBound < 0) {
        if(!dontAdd)
            dontAdd = this.storageAllocate();
        value.dontEnd.forEach(function(t,id) {
            dontAdd.set(id, true);
        });
        if(!openLow && cmpHighSpanLowKey === 0)
            // if the search interval is closed at the low end and the 
            // high end of the span is equal to the low key of the search
            // interval, intervals which end here may be added to the 
            // matches when their high end point (if closed) is matched
            // by the low key of the search interval. Therefore, these
            // must be added to the 'dontAdd' list.
            value.end.forEach(function(t,id) {
                dontAdd.set(id, true);
            });
    } else {
        // by the assumptions on the span it holds that highSpan > lowKey
        // except if the lookup interval is degenerate, in which case
        // highSpan >= lowKey. In the case of highSpan == lowKey we
        // only add intervals which do no end at this span.

        // if highSpan > lowKey, segments which end here are matched, unless 
        // they are in 'dontAdd'. This condition must hold, unless
        // the lookup interval is degenerate, in which case we need to 
        // verify it.
        if(!degenerate || cmpHighSpanLowKey > 0) {
            if(!dontAdd) {
                value.end.forEach(function(t,id) {
                    matchedIds.push(id);
                });
            } else {
                value.end.forEach(function(t,id) {
                    if(!dontAdd.has(id))
                        matchedIds.push(id);
                });
            }
        }

        if(this.compare(highSpan, highKey) >= 0) {
            // rightmost segment compared: segments do not end here are 
            // matched, unless they are in 'dontAdd'
            if(!dontAdd) {
                value.dontEnd.forEach(function(t,id) {
                    matchedIds.push(id);
                });
            } else {
                value.dontEnd.forEach(function(t,id) {
                    if(!dontAdd.has(id))
                        matchedIds.push(id);
                });
            }
        }
    }

    return dontAdd;
}

//////////////////////////
// Conversion Functions //
//////////////////////////

// This function can be called before any intervals have been added to 
// initialize this tree with degenerate intervals which are identical to
// the degenerate intervals stored in the given degnerate interval tree
// ('dTree'). This function assumes that:
// 1. 'dTree' is an object of type DegenerateIntervalTree.
//    A DegenerateIntervalTree is a derived class of the red-black tree
//    which supports an interface similar to that of IntervalTree except that
//    it only stores degenerate intervals (points).
// 2. The degenerate interval tree and this interval tree use the same 'compare'
//    function (this is not checked, it is the responsibility of the 
//    calling function to make sure this holds).
// The tree nodes of the degenerate interval tree are modified
// to be used in the interval tree (the structure of the tree is originally
// identical, so this is efficient). Since these nodes can no longer
// be used by the original degenerate interval tree, that tree is made 
// empty.

IntervalTree.prototype.importFromDegenerateTree = 
    intervalTreeImportFromDegenerateTree;

function intervalTreeImportFromDegenerateTree(dTree)
{
    // we can use the original nodes. We loop over them from first to last, 
    // convert them to the format required by the interval tree and
    // transfer the root from the degnerate interval tree to the
    // interval tree.
    if(!dTree.root)
        return; // tree is empty
    
    // move the tree pointers 
    this.root = dTree.root;
    dTree.root = undefined;
    this.first = dTree.first;
    dTree.first = undefined;
    this.last = dTree.last;
    dTree.last = undefined;
    
    // loop over all nodes and convert them.
    for(var node = this.first ; node ; node = node.next) {
        node.refCount = node.value.size;
        node.degenerate = node.value;
        node.value = new ValueObj(this);
        if(!node.left)
            node.value.leftLeaf = new ValueObj(this);
        if(!node.right)
            node.value.rightLeaf = new ValueObj(this);
    }
}

function ValueObj(owner)
{
    this.end = owner.storageAllocate();
    this.dontEnd = owner.storageAllocate();
    this.leftLeaf = undefined;
    this.rightLeaf = undefined;
}
