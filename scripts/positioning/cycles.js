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


// This file implements an algorithm for maintaining a maximal set of
// linearly independent cycles in a graph G. In addition, it maintains
// a forest of trees spanning the graph G, such that each component of G
// is spanned by a single tree in the forest. The algorithm allows
// edges to be added and removed from G.
//

// The vertices of the graph G are labels (strings) and therefore the edges 
// of the graph are pairs of labels (strings). The pairs are not ordered
// (the graph G is not directed) but for each edge there is a canonical
// direction (an ordering of the pair of labels). The algorithm uses
// the order of the labels of an edge in the order they were first added
// to the graph G as their canonical order.

// In addition to a forest and a vector set object, this object also has
// an Edges object which stores the edges, allowing access to the edge
// ID from the labels and the other way around. This object also defines
// the canonical order of the edge.
//
// In addition, there is also a table indexed by edge IDs ('edgesById')
// which stores information about each (undirected) edge:
// {
//     labels: [<the labels of this pair, in canonical order>]
//     id: <ID of this edge>
//     inForest: <true/false>  // whether the edge is in the forest
//     isNormal: <true/false>  // true if this is a normal edge (see below)
//     isWatched: <true/false> // true if this is a watched edge (see below)
//     watchedCycle: <vector ID> // see below under watched edges
// }
//
// An additional table ('cycleNonForestEdge') stores under the ID of each
// cycle the ID of the non-forest edge in that cycle (each cycle contains
// exactly one such edge and every such edge appears in exactly one cycle).
//
// There is a 'changes' table which lists the vectors in 'this.cycles'
// that changed (since the last time the changes list was cleared).
// The list has the following structure:
// {
//    <vector ID>: <added/changed/removed>
// }
// Where the value is "changed" if the vector was changed, "added" if the
// vector was added (and possibly later also changed) and "removed" if
// the vector was removed (after possibly being also changed). If there is
// an "add" followed by a "remove" then the vector is removed from the
// 'changes' list (as it is assumed that the 'changes' list is cleared
// after being inspected and that its intermediate states are not of
// interest).
//
// Watched Edges
// -------------
// A watched edge is an edge which has a lower priority than a normal edge
// to appear in the forest. Moreover, a watched edge is considered undefined
// unless it is the non-forest edge in a cycle where all other edges are
// normal edges. A normal edge is always considered defined. Watched edges
// can be seen to represent variables which should be solved based on
// the values of the normal edges in a cycle. 
//
// An edge can be both watched and normal. When adding an edge, the calling
// function needs to indicate whether this is a watched or normal edge
// (or both). An edge can be added first as one type (watched/normal) and
// later the other type can be added. The two forms of the same edge can
// also be removed separately. The default is to add an edge as normal and
// to remove both the normal and watched variant of an edge.
//
// When an edge is both normal and watched, it is treated as a normal edge.
// The only difference between a normal+watched edge and a normal (but not
// watched) edge is that if we delete the normal instance of a normal+watched
// edge we are left with a watched edge (rather than with nothing).
//
// Algorithmically, we actually ditinguish between normal and non-normal
// edges. Non-normal edges are treated very similarly to normal edges,
// except for the following rules:
// 1. If a normal edge is added between two nodes of the same tree, but the
//    path connecting its two nodes in the tree has a non-normal 
//    edge on it, then the non-normal edge is removed from the tree and
//    replaced by the new normal edge.
// 2. When removing an edge from a tree resulting in a split in the tree,
//    we look for a non-tree edge which connects nodes in the two parts of
//    the split tree (adding this edge to the tree would re-connect the tree).
//    When we can choose among several such edges, we prefer to take a normal
//    edge over a non-normal edge.
//
// Another difference in implementation is that while for cycles whose
// non-forest edge is normal we store a vector holding all edges in the
// cycle, for cycles where the non-forest edge is not normal we only
// store a vector describing the path in the forest between the edges of
// the non-normal edge, but without having a component in the vector for
// the non-normal edge itself. We therefore have cycles for normal non-forest
// edges and paths for non-normal non-forest edges.
// 
// There several structures in the Cycles object to support watched (but not
// normal) edges:
// 
// watchedCycles: <vector set>
//
// The 'watchedCycles' holds a vector set with a vector for each non-normal
// non-forest edge. This vector describes the simple path in the forest between
// the endpoints of the edge. The path is in the direction from the first to
// the second point of the edge in canonical order. This way, the
// inner product of the values of the pairs on the path with the path equation
// gives the offset of the watched pair (in canonical order).
//
// The 'watchedCycles' vector set uses the same components as the 'cycles'
// vector set.
//
// For each edge with a path in the 'watchedCycles' table, the 'edgesById'
// entry for that edge holds the vector ID of the vector in this set which
// is associated with the edge. For the inverse lookup (from vector ID
// to edge) there is another structure:
//
// watchedCycleToEdge: {
//      <vector ID>: <corresponding watched edge ID>
// }
//
// Changes are recorded to the following structure (in the same way as changes
// to the normal cycles are recorded to 'changes'):

// watchedChanges: {
//      <cycle ID>: "added"/"changed"/<edgeId>
// }
//
// When the cycle is removed, we do not record the keyword "removed", but
// instead record the edge ID to which the watched cycle belongs (this is
// because after the cycle is deleted we cannot find this information anymore).
//
// Derived Class Interface
// -----------------------
//
// The Cycles class implements several interfaces to be used by potential
// derived classes. As there may be no derived class (that is, Cycles can be
// used without deriving from it) or the derived class may not implement
// the interface functions, the Cycles object always checks for the
// existence of these functions before calling them.
//
// The following interface functions are currently defined (these should
// be implemented by the derived class):
//
// notifyCycleAdded(<cycle VectorSet>, <cycle ID>):
//    This function is called after the cycle (normal or watched) with
//    the given ID has been added. The first argument of the function
//    provides access into the VectorSet object (this.cycles or
//    this.watchedCycles) which stores the cycle vector.
//    This cycle is not called when a watched cycle is replaced by
//    a normal cycle or the other way around.
//    
// notifyCycleRemoved(<cycle VectorSet>, <cycle ID>):
//    This function is called before the cycle (normal or watched) with
//    the given ID is removed. The first argument of the function
//    provides access into the VectorSet object (this.cycles or
//    this.watchedCycles) which stores the cycle vector.
//
// In addition, the following fields may be defined by the derived class:
//
// notifyMeOfTreeChanges: if this is set to true, the derived class should
//    define the following functions:
//       this.notifyTreeSplit(<original tree root node>, <up removed node>,
//         <down removed node>):
//         this function is called when a tree is split as a result
//         of removing (or replacing) an edge in the underlying forest.
//         The function is called with three argments: the root of the tree
//         which was split and the nodes of the edge which was removed
//         (where the node of the removed edge which is closer
//         to the root is given first). If the root node and the first
//         of the two nodes of the removed edge are the same node,
//         this node may have been destroyed if it remain isolated. The
//         function is not called if the removal of the node simply
//         resulted in the removal of a leaf node from the tree (in
//         this case, the tree ID and structure remain unchanged
//         except for the removal of the leaf).
//       this.notifyTreesMerged(<merged tree root>, <up node of added edge>,
//                              <down node of added edge>):
//         this function is called when the addition (or replacement) of an edge
//         in the underlying forest resulted in the merging of two trees.
//         The function is called with three arguments: the root node of
//         the merged tree (the root before the merging) and the two nodes
//         of the edge added (the 'up' node is the first of these
//         two arguments).
//       this.notifyEdgeAdded(<node name 1>, <node name 2>):
//         this function is called when an edge is added to the forest
//         but this addition does not result in the merging of two
//         existing trees but in the creation of at least one new node.
//         The function is called with the names of the two nodes of the edge
//         (in arbitrary order).
//       this.notifyNodeRemoved(<name>): this function is called when the
//         node with the given name is removed from the forest (this means
//         that it is no longer attached to any edge). In case of replacement
//         (one edge replaced with the other) it is possible that this function
//         is called after the replaced edge is removed and that the replacing
//         edge would add this node back in. It is up to the object
//         implementing this function to handle this situation correctly.

//         

// %%include%%: "forest.js"
// %%include%%: "vectorSet.js"
// %%include%%: "edges.js"

// Constructor

// If an 'edges' argument is given, this argument should be an Edges object
// and this object will be used to store edges. In this way, the edge
// allocations can be shared with other objects.

function Cycles(edges)
{
    // initialize the object
    this.forest = new Forest(); // the forest of spanning trees
    this.cycles = new VectorSet(); // the set of vectors representing cycles
    this.cycleNonForestEdge = {}; // the non-forest edge in each cycle 
    this.edges = edges ? edges : new Edges(); // table of edges
    this.edgesById = {};
    this.changes = {};
    // watched edge vectors
    this.watchedCycles = new VectorSet();
    this.watchedCycleToEdge = {};
    this.watchedChanges = {};
}

///////////////////////////////
// Basic Auxiliary Functions //
///////////////////////////////

// returns true if the given label is of a node in the forest and false
// otherwise. A true return value means that there is an edge attached
// to the node with this label.

Cycles.prototype.nodeInForest = cyclesNodeInForest;

function cyclesNodeInForest(label)
{
    return this.forest.nodeInForest(label);
}

// This function returns the object describing the edge (label1,label2)
// in the edge table. The two labels can be given in any order.
// If the edge does not exist, undefined is returned.

Cycles.prototype.getEdge = cyclesGetEdge;

function cyclesGetEdge(label1, label2)
{
    return this.edges.getEdge(label1, label2);
}

// Get the two points (in canonical order) of the edge with the given ID.
// If no such edge exists, returns undefined. Otherwise, returns an array
// holding the two points.

Cycles.prototype.getEdgePoints = cyclesGetEdgePoints;

function cyclesGetEdgePoints(edgeId)
{
    return this.edges.getEdgePoints(edgeId);
}

// This function returns the tree ID of the tree in the forest in which
// the two end-points of the given edge are (even if the edge is not
// a tree edge, both its end-points must be in the same tree in the forest).
// If the edge is not found, undefined is returned.

Cycles.prototype.getEdgeTreeId = cyclesGetEdgeTreeId;

function cyclesGetEdgeTreeId(edgeId)
{
    var labels = this.getEdgePoints();

    if(labels === undefined)
        return undefined;
    
    return this.forest.getTreeId(labels[0]);
}

// This function returns an array with the other labels of all edges whose
// first label is 'label'. If 'canonicalOrderOnly' is set, only edge
// where 'label' is the first label in the canonical order are considered.
// The function always returns an array (possibily empty).
// The function first extract the list of possible other end points from
// the 'edges' table. Since the 'edges' table may contain edges which
// are not in the Cycles graph, this function must then go over all these
// entries and check which of the edges are edges in the Cycles graph.
// Only the other ends of these edges are returned.

Cycles.prototype.edgeOtherEnd = cyclesEdgeOtherEnd;

function cyclesEdgeOtherEnd(label, canonicalOrderOnly)
{
    var otherEnd = [];

    if(!(label in this.edges.edges))
        return otherEnd;

    var entry;
    
    for(var other in (entry = this.edges.allLabelEdges(label))) {
        var otherEntry = entry[other];
        if((canonicalOrderOnly && otherEntry.dir < 0) ||
           !(otherEntry.id in this.edgesById))
            continue;
        
        otherEnd.push(other);
    }

    return otherEnd;
}

// given a label and an edge ID such the label is one of the ends of
// the edge, this function returns the other label in the same edge
// (if the edge is not defined or does not contain the given label,
// undefined is returned).

Cycles.prototype.edgeOppositeEnd = cyclesEdgeOppositeEnd;

function cyclesEdgeOppositeEnd(label, edgeId)
{
    return this.edges.edgeOppositeEnd(label, edgeId);
}

// This function returns the entry for the edge with the given ID from 
// the edgesById table. This entry stores information about the status of the
// edge, such as isWatched, isNormal and inForest.

Cycles.prototype.getEdgeInfo = cyclesGetEdgeInfo;

function cyclesGetEdgeInfo(edgeId)
{
    return this.edgesById[edgeId];
}


// This function returns true if the two given labels are a normal edge

Cycles.prototype.isNormal = cyclesIsNormal;

function cyclesIsNormal(label1, label2)
{
    var id = this.edges.getEdgeId(label1, label2);
    return ((id in this.edgesById) ? this.edgesById[id].isNormal : false);
}

// This function returns true if the edge with the given ID is a normal edge

Cycles.prototype.isNormalById = cyclesIsNormalById;

function cyclesIsNormalById(edgeId)
{
    return ((edgeId in this.edgesById) ?
            this.edgesById[edgeId].isNormal : false);
}

// This function returns true if the two given labels are a watched edge

Cycles.prototype.isWatched = cyclesIsWatched;

function cyclesIsWatched(label1, label2)
{
    var id = this.edges.getEdgeId(label1, label2);
    return ((id in this.edgesById) ? this.edgesById[id].isWatched : false);
}

// This function returns true if the edge with the given ID is a normal edge

Cycles.prototype.isWatchedById = cyclesIsWatchedById;

function cyclesIsWatchedById(edgeId)
{
    return ((edgeId in this.edgesById) ?
            this.edgesById[edgeId].isWatched : false);
}

// This function returns true if the two given labels are an edge in the
// forest

Cycles.prototype.inForest = cyclesInForest;

function cyclesInForest(label1, label2)
{
    var id = this.edges.getEdgeId(label1, label2);
    return ((id in this.edgesById) ? this.edgesById[id].inForest : false);
}

// This function returns true if the edge with the given ID is a normal edge

Cycles.prototype.inForestById = cyclesInForestById;

function cyclesInForestById(edgeId)
{
    return ((edgeId in this.edgesById) ?
            this.edgesById[edgeId].inForest : false);
}

// This function returns true if the edge with the given ID exists. For
// an edge to exist it should have an entry in the edge table and at
// least one of the flags 'inForest', 'isNormal' or 'isWatched' must be set.

Cycles.prototype.edgeExists = cyclesEdgeExists;

function cyclesEdgeExists(edgeId)
{
    if(!(edgeId in this.edgesById))
        return false;
    
    var edgeEntry = this.edgesById[edgeId];

    return (edgeEntry.inForest || edgeEntry.isNormal || edgeEntry.isWatched);
}


// This function creates the edge (label1,label2) in the edge table and
// returns it. If the edge already exists, it returns the existing entry.
// If the edge does not yet exist and pairId is not undefined, this
// pair ID is assigned to the new edge. If pairId is undefined and 
// a new edge is created, it is assigned a new ID.
// This function does not change the type of the edge (normal/watched) if
// the edge already exists. If the edge is new, the function creates
// and edge with both 'isNormal' and 'isWatched' turned off (false).
// If the edge is new in the cycles object, this function also allocates
// it (in the Edges object).
//
// This function should be considered a private function of this class.

Cycles.prototype.createEdge = cyclesCreateEdge;

function cyclesCreateEdge(label1, label2, pairId)
{
    var entry = this.edges.addEdge(label1, label2, pairId);
    var id = entry.id;

    if(!(id in this.edgesById)) {
        this.edgesById[id] = {
            labels: (entry.dir == 1 ? [label1,label2] : [label2,label1]), 
            id: id,
            inForest: false, // the edge was not yet added
            isNormal: false, // the edge was not yet added
            isWatched: false // the edge was not yet added
        };
        this.edges.allocateEdge(id);
    }
    
    return entry;
}

/////////////////////////////
// Edge Addition Functions //
/////////////////////////////

// This function adds the given edge to the graph. 'x1' and 'x2' are the 
// two labels identifying the end points of the edge. If adding
// the edge results in a new cycle being added, the cycle is added in the
// direction of the edge (x1,x2) (that is, the cycle added is
// (x1, x2, ..., x1).
// 'pairId' can optionally be provided if an ID was already allocated 
// for this pair. If such an ID is provided, it will be used as the ID
// of this edge, if a new edge is created. If no ID is provided, 
// a new ID will be allocated below (if a new edge needs to be created).
// Note that it is not possible to use this function to change the ID
// of an existing pair (if 'pairId' is provided for an existing pair,
// it will be ignored).
// The two flags 'isNormal' and 'isWatched' determine the type of edge
// to create. These flags can have the values true/false/undefined.
// If a flag is set to undefined, it does not change the current value
// of that flag for the edge if the edge already exists. If the edge
// does not exist, an undefined value for a flag is considered to be equal
// to false. If the edge does not yet exist and both flags are false/undefined,
// the edge entry is created, but it is added neither as a normal edge nor as
// a watched edge (this can be modified later). If the edge already exists,
// the value of its flag will be changed for those flags which are not
// undefined.
// The function returns the edge object:
// {
//     id: <ID of the edge>,
//     dir: <direction: +1 = canonical -1 = reverse>
// }

Cycles.prototype.addEdge = cyclesAddEdge;

function cyclesAddEdge(x1, x2, isNormal, isWatched, pairId)
{
    // create a new edge if it does not yet exist.
    var edgeObj = this.createEdge(x1, x2, pairId);
    var edgeEntry = this.edgesById[edgeObj.id];

    // check which types were changed and take action accordingly
    
    if(isNormal != undefined && isNormal != edgeEntry.isNormal) {
        // normal type changed 
        if(isNormal)
            this.addNormalEdge(edgeEntry);
        else
            this.removeNormalEdge(edgeEntry);
    }
    
    if(isWatched != undefined && isWatched != edgeEntry.isWatched) {
        // watched type changed
        if(isWatched)
            this.addWatchedEdge(edgeEntry);
        else
            this.removeWatchedEdge(edgeEntry);
    }

    return edgeObj;
}

// This function gets an edge entry and adds it as a normal edge to
// the cycles structure. This means that it tried to add it to the forest
// and if it cannot be added to the forest, creates a cycle for it.
// The function first checks whether the 'isNormal' flag is set on the
// edge entry. If it is, the function does nothing. Otherwise, it sets
// the flag and adds the edge.
// The edge may already exist as a non-normal edge. In this case, only
// a partial modification is necessary (see below).

Cycles.prototype.addNormalEdge = cyclesAddNormalEdge;

function cyclesAddNormalEdge(edgeEntry)
{
    if(!edgeEntry || edgeEntry.isNormal)
        return; // no entry or the edge is already normal

    edgeEntry.isNormal = true;
    
    if(edgeEntry.inForest)
        // the edge changed from non-normal to normal, so can remain in tree
        return;
    
    // add the edge to the forest
    if(this.forest.addEdge(edgeEntry.labels,
                           this.notifyMeOfTreeChanges ? this : undefined)) {
        // the edge was added to the forest, so no cycle was created
        edgeEntry.inForest = true;
        return;
    }

    edgeEntry.inForest = false;
    
    // the edge was not added to the forest, which means that a cycle was
    // created. If this cycle contains non-normal edges, a path is added
    // for one of these edges (instead of a cycle).
    this.addCycleOrPath(edgeEntry);
}

// Given is an edge entry which is not in the forest but
// has both ends in the same tree in the forest. This function adds either
// a path or a cycle as follows:
// 1. If this edge is not normal, this function adds a path through the
//    forest beginning at label1 and ending at label2.
// 2. If this is normal, the function first checks whether the simple path in
//    the forest connecting its two nodes consists of normal edges only.
//    If it does, this function adds a cycle consisting of the pair
//    [label1, label2] and the unique simple path in the forest from
//    label2 to label1. If, however, there is a non-normal edge of the path
//    in the forest from label2 to label1 then the normal edge (label1, label2)
//    is added to the forest and one of the non-normal edges on the path
//    from label2 to label1 is removed from the forest (the components in
//    the forest remain unchanged). The function then adds a path connecting
//    the two ends of the non-normal edge which was removed from the forest.
// The cycles are added to this.cycles while paths are added to
// 'this.watchedCycles'. The added cycles/paths are recorded to this.changes
// and this.watchedChanges (respectively).
// The function returns true if a cycle or path was added and false
// otherwise (this probably implies an error).

Cycles.prototype.addCycleOrPath = cyclesAddCycleOrPath;

function cyclesAddCycleOrPath(edgeEntry)
{
    // if there is no such edge or the edge is in the forest,
    // cannot add a cycle
    if(!edgeEntry || edgeEntry.inForest)
        return false;
   
    // get the path in the tree from one end of the edge to the other. In
    // case of a cycle, the direction is the direction of the edge, so
    // the path is from the second node to the first. In case of a path
    // we use the opposite direction (for the sake of the interface with
    // external modules).
    var path = edgeEntry.isNormal ?
        this.forest.getPath(edgeEntry.labels[1], edgeEntry.labels[0]) :
        this.forest.getPath(edgeEntry.labels[0], edgeEntry.labels[1]);
    
    if(!path)
        return false; // the two nodes are not in the same tree

    // transform the path into a sequence of edges, together with their
    // direction.
    var cycle = [];

    if(edgeEntry.isNormal)
        cycle.push({ name: edgeEntry.id, value: 1 });
    
    var firstNonNormal = undefined;
    var firstNonNormalDir; // direction of this edge in new cycle

    for(var i = 0, length = path.length - 1 ; i < length ; ++i) {
        var pathEdgeObj = this.getEdge(path[i].name, path[i+1].name);
        cycle.push({ name: pathEdgeObj.id, value: pathEdgeObj.dir });
        if(!firstNonNormal && !this.edgesById[pathEdgeObj.id].isNormal) {
            firstNonNormal = this.edgesById[pathEdgeObj.id];
            firstNonNormalDir = pathEdgeObj.dir;
        }
    }
    
    // add the cycle or path
    if(edgeEntry.isNormal) {

        // if this edge is also watched and has a watched cycle, we need to
        // remove this watched cycle
        var wasWatchedCycle = false;
        if(edgeEntry.watchedCycle != undefined) {
            this.removeWatchedCycle(edgeEntry);
            wasWatchedCycle = true;
        }

        // add a cycle
        var newId = this.cycles.newVector(cycle);
        this.cycleNonForestEdge[newId] = edgeEntry.id;
        this.changes[newId] = "added";
        
        if(!firstNonNormal) {
            if(this.notifyCycleAdded !== undefined && !wasWatchedCycle)
                this.notifyCycleAdded(this.cycles, newId);
            return;
        }

        // The non-forest edge is normal but the path contains a non-normal
        // edge, so we exchange these two edges in the forest. Consequently,
        // the cycle just added must be removed and a watched cycle added
        // instead. Other watched cycles containing the edge removed from the
        // forest must also be adjusted.
        
        this.forest.replaceEdge(firstNonNormal.labels, edgeEntry.labels,
                                this.notifyMeOfTreeChanges ? this : undefined);
        edgeEntry.inForest = true;
        firstNonNormal.inForest = false;

        // add a watched cycle for the edge just removed from the forest.
        // At first, this contains only the edge (this will be corrected
        // by the following steps).
        var vecId = firstNonNormal.watchedCycle =
            this.watchedCycles.newVector([{ name: firstNonNormal.id, 
                                            value: 1 }]);
        this.watchedCycleToEdge[vecId] = firstNonNormal.id;
        this.watchedChanges[vecId] = "added";
        
        // the original cycle added must be removed, but first, it must be
        // used to reduce the edge removed from the forest from all existing
        // watched cycles.
        this.reduceWatchedCyclesByCycle(newId, this.cycles.vectors[newId],
                                        firstNonNormalDir,
                                        firstNonNormal);

        // now, we can remove the edge
        this.cycles.removeVector(newId);
        delete this.cycleNonForestEdge[newId];
        delete this.changes[newId];

        if(this.notifyCycleAdded !== undefined && !wasWatchedCycle)
            this.notifyCycleAdded(this.watchedCycles, vecId);
    } else {
        // Add the path to the watched cycles
        edgeEntry.watchedCycle = this.watchedCycles.newVector(cycle);
        this.watchedCycleToEdge[edgeEntry.watchedCycle] = edgeEntry.id;
        this.watchedChanges[edgeEntry.watchedCycle] = "added";
        if(this.notifyCycleAdded !== undefined)
            this.notifyCycleAdded(this.watchedCycles, newId);
    }
}

// This function takes a given cycle (id + vector) and an edge which appears
// in the cycle vector and adds or subtracts the given cycle from each
// watched vector which contains the given edge so that after this operation
// no watched path contains the given edge anymore.
// 'cycleEdgeDir' is the value for the given edge ('edgeEntry') in the
// given vector (this needs to be given by the calling function because 
// 'cycleVec' is an array and we would have to search it for the
// required entry).

Cycles.prototype.reduceWatchedCyclesByCycle =
    cyclesReduceWatchedCyclesByCycle;

function cyclesReduceWatchedCyclesByCycle(cycleId, cycleVec, cycleEdgeDir, 
                                          edgeEntry)
{
    if(!cycleVec || !edgeEntry)
        return;
    
    // get the watched paths which contain this edge.
    var edgeId = edgeEntry.id;
    var watchedCycles = this.watchedCycles.componentIndex.get(edgeId);

    // add or subtract the cycle from each of the other paths

    var _self = this;
    watchedCycles.forEach(function(entry, watchedId) {

        if(watchedId == cycleId)
            return;
        
        var watchedEdgeDir = entry.value;

        _self.watchedCycles.
            addToVector(watchedId, cycleVec, undefined,
                        (watchedEdgeDir == cycleEdgeDir) ? -1 : 1);
        if(_self.watchedChanges[watchedId] != "added")
            _self.watchedChanges[watchedId] = "changed";
    });
}

// This function provides cycle creation functionality for external modules
// which want to create a cycle based on the forest structure stored here,
// but do not want to modify this Cycles object in any way. Therefore, the edge
// for which the cycle is created is not required to be stored on this 'Cycles'
// object (and is provided as a pair of labels) and the resulting cycle
// is stored on the given VectorSet.
// The calling function should provide the pair ID for the pair of labels.
// This pair ID is used iff the edge is not found among the existing
// objects (if it is found, the existing ID is used).

Cycles.prototype.addExternalCycle = cyclesAddExternalCycle;

function cyclesAddExternalCycle(label1, label2, pairId, vectorSet)
{
    if(!vectorSet)
        return false; // nowhere to write the result to
    
    // get the edge. It is not assumed the edge is already in the graph
    var edgeObj = this.getEdge(label1, label2);

    // if edgeObj is in the forest, cannot add a cycle
    if(edgeObj && this.edgesById[edgeObj.id].inForest)
        return false;
    
    // get the path in the tree from one end of the edge to the other.
    var path = this.forest.getPath(label2, label1);

    if(!path)
        return false; // the two nodes are not in the same tree
    
    // transform the path into a sequence of edges, together with their
    // direction.
    var cycle = {};

    if(edgeObj)
        cycle[edgeObj.id] = edgeObj.dir;
    else
        cycle[pairId] = 1;
    
    for(var i = 0, length = path.length - 1 ; i < length ; ++i) {
        var pathEdgeObj = this.getEdge(path[i].name, path[i+1].name);
        cycle[pathEdgeObj.id] = pathEdgeObj.dir;
    }
    
    // add the cycle vector
    vectorSet.newVector(cycle);

    return true;
}

// This function gets an edge entry and adds it as a watched edge.
// If the edge is already a nrmal edge, there is little to do except for
// marking the edge as a watched edge. If the edge is not a normal edge
// then it is added to the forest. If this succeeds (meaning that the edge
// connected two trees in the forest), there is nothing more to do
// (except to mark the edge as being in the forest). If the edge is not added
// to the forest (meaning that both its nodes are in the same tree in
// the forest) then the path in the forest between the two nodes of the
// edge is added to 'watchedCycles'.

Cycles.prototype.addWatchedEdge = cyclesAddWatchedEdge;

function cyclesAddWatchedEdge(edgeEntry)
{
    if(!edgeEntry || edgeEntry.isWatched)
        return; // no entry or the edge is already watched

    edgeEntry.isWatched = true;

    if(edgeEntry.isNormal)
        return; // nothing more to do

    // try to add the edge to the forest
    if(this.forest.addEdge(edgeEntry.labels,
                           this.notifyMeOfTreeChanges ? this : undefined)) {
        // the edge was added to the forest, so no cycle was created
        edgeEntry.inForest = true;
        return;
    }

    edgeEntry.inForest = false;

    // the edge was not added to the forest, which means that there is a
    // path in the forest between the nodes of the edge. Add this path
    // to the watched paths.
    this.addCycleOrPath(edgeEntry);
}

////////////////////////////
// Edge Removal Functions //
////////////////////////////

// This function removes the given edge from the graph. This may result
// in changes to the forest and cycle and watched cycle vectors.
// The function takes two optional flags 'isNormal' and
// 'isWatched'. For each of these flags which is either 'true' or
// 'undefined', the function deletes the corresponding type of edge
// (if it exists). If one of these flags is set to 'false' that type
// of the edge is not deleted (if it exists). The edge entry itself is
// removed if both its types are false after this operation.
// The function returns false if no edge was removed (because the edge
// was not in the graph) or no tree was split. If a tree was split,
// the function returns the node of the edge which belongs
// to the split tree (the tree which does not contain the root of
// the original tree).

Cycles.prototype.removeEdge = cyclesRemoveEdge;

function cyclesRemoveEdge(point1, point2, isNormal, isWatched)
{
    var edgeObj = this.getEdge(point1, point2);

    if(!edgeObj)
        return false; // edge not in the graph

    return this.removeEdgeById(edgeObj.id, isNormal, isWatched);
}

// This function is idenitcal to 'removeEdge' except that instead of
// taking an array of two points as input it directly takes the edge ID
// as input.

Cycles.prototype.removeEdgeById = cyclesRemoveEdgeById;

function cyclesRemoveEdgeById(edgeId, isNormal, isWatched)
{
    var edgeEntry = this.edgesById[edgeId];

    if(!edgeEntry)
        return false;

    // If the tree was split, this is the label of the edge node which
    // was 'split' (is not in the tree with the original root of the tree).
    var splitNode = false;

    // it is more efficient (but not necessary) to first remove the watched
    // type of the edge
    if(isWatched != false && edgeEntry.isWatched)
        splitNode = this.removeWatchedEdge(edgeEntry);

    if(isNormal != false && edgeEntry.isNormal)
        splitNode = this.removeNormalEdge(edgeEntry);

    if(!edgeEntry.isNormal && !edgeEntry.isWatched) {
        this.edges.releaseEdge(edgeId);
        delete this.edgesById[edgeId];
    }
    
    return splitNode;
}

// This function receives an edge entry (the object stored in the 'edgesById'
// table) and removes it as a normal edge.
// If the edge is not in the forest, this function simply removes the edge,
// and since it belongs to a cycle (exactly one in this case) it removes that
// cycle. If the edge is also a watched edge, the cycle is converted into
// a watched path.
// If the edge is in the forest, it needs to be removed from the forest.
// If the edge belongs to a cycle or appears in a watched path, then the
// edge can be replaced in the forest by the non-forest edge of one of these
// cycles (or the watched edge belonging to the watched path). The function
// first attempts to replace the edge by a normal edge (that is, the
// non-forest edge of a cycle). If this is not possible, it replaces it
// with a non-normal edge. This may be the edge itself (if it is a watched
// edge) and this has the highest priority for replacement among the
// watched edges.
// The function returns false if no edge was removed (because the edge
// was not in the graph) or no tree was split. If a tree was split,
// the function returns the node of the edge which belongs
// to the split tree (the tree which does not contain the root of
// the original tree).
// This function does not remove the edge entry itself. It merely marks
// the 'isNormal' property of the edge as being 'false'. 

Cycles.prototype.removeNormalEdge = cyclesRemoveNormalEdge;

function cyclesRemoveNormalEdge(edgeEntry)
{
    if(!edgeEntry || !edgeEntry.isNormal)
        return false; // unspecified edge or not a normal edge

    edgeEntry.isNormal = false;

    if(edgeEntry.inForest) {
        return this.removeEdgeFromForest(edgeEntry);
    } else {

        var componentEntry = this.cycles.componentIndex.get(edgeEntry.id);

        // iterates only once (see introduction)
        var _self = this;
        componentEntry.forEach(function(e, cycleId) {
            // remove the cycle (if the edge is still watched, the cycle is
            // converted into a watched path for this edge).
            _self.removeCycle(cycleId, edgeEntry);
        });
        
        return false;
    }
}
    
// the 'isWatched' flag on the edge and then checks whether the edge is
// also normal. If the edge is also normal, there is nothing more to
// do. If the edge is not normal, it needs to be completely removed.
// If it is not a forest edge then all we need to do is remove the
// path registered for it in 'watchedCycles'. If it is a forest edge,
// we need to remove it from the forest, possibly inserting another
// watched edge into the forest instead.
// The function returns false if no tree was split as a result of this
// operation. If a tree was split, the function returns the node of
// the edge which belongs to the split tree (the tree which does not contain
// the root of the original tree).

Cycles.prototype.removeWatchedEdge = cyclesRemoveWatchedEdge;

function cyclesRemoveWatchedEdge(edgeEntry)
{
    if(!edgeEntry || !edgeEntry.isWatched)
        return; // unspecified edge or not a watched edge

    edgeEntry.isWatched = false;

    if(edgeEntry.isNormal)
        return;

    if(edgeEntry.inForest) {
        //remove edge from forest, possibly inserting another edge into it
        // instead
        return this.removeEdgeFromForest(edgeEntry);
    } else {
        // not in forest
        this.removeWatchedCycle(edgeEntry);
        return false;
    }
}

// This function receives a edge entry of an edge in the forest and removes
// that edge from the forest. When the edge is removed from the forest,
// the function attempts to insert another edge into the forest, if possible.
// The logic is as follows:
// 1. The function checks whether the edge appears in any cycle or watched
//    path.
// 2. If the edge appear in a cycle (this can only happen if the removed edge
//    was normal) then one such cycle is selected. The non-forest edge
//    of the cycle is added to the forest, the cycle is removed from the
//    list and added/subtracted from the vectors of all other cycles and
//    watched paths which contain the removed edge. Also, if the removed edge
//    is still marked as 'isWatched', a watched path must be created for this
//    edge. This watched path is the cycle that was removed, except for the
//    removed edge.
// 3. If the edge does not appear in any cycle but is still marked as
//    'isWatched', the edge is not removed from the forest.
// 4. If the edge does not appear in any cycle and is not marked as watched
//    but does appear in some watched path, then we select one of these
//    watched paths. The watched edge for this watched path is inserted into
//    the forest and the cycle created from the path for that edge together
//    with the edge itself is added/subtracted form all other paths which
//    contain the removed edge.
// 5. If none of the above is the case, the edge is simply removed from
//    the forest and the function returns the node of the edge which
//    belongs to the split tree (the tree which does not contain the root
//    of the original tree).
// This function assumes that the isNormal and isWatched flags on the
// edge entry are set to their values as these should be after the removal.

Cycles.prototype.removeEdgeFromForest = cyclesRemoveEdgeFromForest;

function cyclesRemoveEdgeFromForest(edgeEntry)
{
    if(!edgeEntry || !edgeEntry.inForest || edgeEntry.isNormal)
        return; // nothing to do

    // check whether the edge appears in a cycle or a watched path
    var edgeId = edgeEntry.id;
    var cycles;
    var watchedCycles;

    cycles = this.cycles.componentIndex.get(edgeId);
    watchedCycles = this.watchedCycles.componentIndex.get(edgeId);

    var hasCycle = (cycles !== undefined);
    
    if(!hasCycle) {
        
        if(edgeEntry.isWatched)
            return false; // leave edge in tree
        else if(watchedCycles === undefined) {
            // remove from tree
            edgeEntry.inForest = false;
            // A tree was split, so return the entry of the tree node
            // which (after this split) no longer belongs to the original tree.
            return this.forest.removeEdge(edgeEntry.labels,
                                          this.notifyMeOfTreeChanges ?
                                          this : undefined);
        }
    }

    // edge in cycle or edge in watched path, but the edge is not watched
    // get the first such cycle/path (with preference for a cycle, if exists).

    if(hasCycle)
        this.replaceEdgeByCycle(edgeEntry, cycles, watchedCycles);
    else
        this.replaceEdgeByWatchedCycle(edgeEntry, watchedCycles);

    return false;
}

// This function receives as input an edge entry, the set of entries 
// for this edge (from the this.cycles componentIndex) of cycles which 
// contain that edge and the set of entries (from this.watchCycles 
// componentIndex) for this edge of watched cycles which contain that edge.
// This function should be called only if the edge given is in the forest
// and 'cycles' (a Map object whose keys are the set of cycles containing
// the edge) is not empty.
// This function then replaces in the forest the given edge
// with the non-forest edge of the first cycle. It then adds or subtracts
// the first cycle vector from all other cycles and paths (so as to make
// the component of the removed edge 0). The first cycle is then deleted.

Cycles.prototype.replaceEdgeByCycle = cyclesReplaceEdgeByCycle;

function cyclesReplaceEdgeByCycle(removedEdgeEntry, cycles, watchedCycles)
{
    if(!removedEdgeEntry || !removedEdgeEntry.inForest)
        return;

    if(cycles === undefined)
        return;

    // the forEach loop below will only perform a single iteration,
    // because in the first iteration all other cycles are removed from the
    // list (the component is made zero). For this reason, the argument of
    // the function is named 'firstCycleId'

    var _self = this;
    
    cycles.forEach(function(entry, firstCycleId) {

        // get the non-forest edge in this cycle
        var nonForestEdge =
            _self.edgesById[_self.cycleNonForestEdge[firstCycleId]];

        // replace the removed edge with the non-forest edge
        _self.forest.replaceEdge(removedEdgeEntry.labels, nonForestEdge.labels,
                                 _self.notifyMeOfTreeChanges ?
                                 _self : undefined);
        nonForestEdge.inForest = true;
        removedEdgeEntry.inForest = false;

        // add or subtract the first cycle from each of the other cycles/paths

        var edgeId = removedEdgeEntry.id;
        var firstCycle = _self.cycles.vectors[firstCycleId];
        var firstCycleEdgeDir = entry.value;

        cycles.forEach(function(e, cycleId) {
            
            if(cycleId == firstCycleId)
                return;
            
            var cycleEdgeDir = e.value;
            
            _self.cycles.
                addToVector(cycleId, undefined, firstCycleId,
                            (cycleEdgeDir == firstCycleEdgeDir) ? -1 : 1);
            if(_self.changes[cycleId] != "added")
                _self.changes[cycleId] = "changed";
        });

        if(watchedCycles !== undefined)
            watchedCycles.forEach(function(e, cycleId) {
                var cycleEdgeDir = e.value;
                _self.watchedCycles.
                    addToVector(cycleId, firstCycle, undefined,
                                (cycleEdgeDir == firstCycleEdgeDir) ? -1 : 1);
                if(_self.watchedChanges[cycleId] != "added")
                    _self.watchedChanges[cycleId] = "changed";
            });

        // remove the cycle (if the edge is still watched, the cycle is
        // converted into a watched path for this edge).
        _self.removeCycle(firstCycleId, removedEdgeEntry);
    });
}

// This function receives as input an edge entry, and the set of watched cycles
// which contain that edge. This function should be called only if the edge
// given is in the forest and 'watchedCycles' (the entry in the 
// this.watchedCycles component index for the given edge holding the entries
// for all watched cycles which are not zero for this edge) is not empty. 
// This function then replaces in the forest the given edge with the
// edge associated with the first watched cycle. It then adds this
// associated edge to the watched cycle and adds or subtracts this
// modified watched cycle vector from all other watched cycles (so as
// to make the component of the removed edge 0). The first
// watched cycle is then deleted.

Cycles.prototype.replaceEdgeByWatchedCycle = cyclesReplaceEdgeByWatchedCycle;

function cyclesReplaceEdgeByWatchedCycle(removedEdgeEntry, watchedCycles)
{
    if(!removedEdgeEntry || !removedEdgeEntry.inForest)
        return;

    if(watchedCycles === undefined)
        return;

    // the forEach loop below will only perform a single iteration,
    // because in the first iteration all other cycles are removed from the
    // list (the component is made zero). For this reason, the argument of
    // the function is named 'firstCycleId'

    var _self = this;
    
    watchedCycles.forEach(function(entry, firstCycleId) {

        // get the non-forest edge
        var nonForestEdge =
            _self.edgesById[_self.watchedCycleToEdge[firstCycleId]];

    // replace the removed edge with the non-forest edge
        _self.forest.replaceEdge(removedEdgeEntry.labels, nonForestEdge.labels,
                                 _self.notifyMeOfTreeChanges ?
                                 _self : undefined);
        nonForestEdge.inForest = true;
        removedEdgeEntry.inForest = false;

        // add the new forest edge to the cycle
        _self.watchedCycles.addValue(firstCycleId, nonForestEdge.id, -1);

        // add or subtract the modified cycle from each of the other paths
        var firstCycle = _self.watchedCycles.vectors[firstCycleId];
        var firstCycleDir = entry.value;
        _self.reduceWatchedCyclesByCycle(firstCycleId, firstCycle,
                                         firstCycleDir, removedEdgeEntry);

        // remove the first cycle
        var edgeEntry = _self.edgesById[_self.watchedCycleToEdge[firstCycleId]];
        _self.removeWatchedCycle(edgeEntry);
    });
}

// This function is called to remove the given cycle as a result of the
// given edge not being normal any more. There are two possibilities.
// If the given edge is still a watched edge, the cycle is converted into
// a watched cycle. Otherwise, the cycle is simply removed.

Cycles.prototype.removeCycle = cyclesRemoveCycle;

function cyclesRemoveCycle(cycleId, edgeEntry)
{
    if(edgeEntry.isWatched) {
        // if this is also a watched edge, we need to convert this cycle
        // into a watched cycle
        this.makeWatchedCycleFromCycle(cycleId, edgeEntry);
    } else {
        // otherwise, just remove the cycle
        if(this.notifyCycleRemoved !== undefined)
            this.notifyCycleRemoved(this.cycles, cycleId);
        this.cycles.removeVector(cycleId);
        delete this.cycleNonForestEdge[cycleId];
        if(this.changes[cycleId] == "added")
            delete this.changes[cycleId];
        else
            this.changes[cycleId] = "removed";
    }
}

// This function is called to remove the watched cycle associated with
// the edge given by 'edgeEntry'. This can happen when either the
// watched edge is removed or the edge becomes normal. This function is
// responsible for all cleanup required by this removal and registers it
// to the 'watchedChanges' list.

Cycles.prototype.removeWatchedCycle = cyclesRemoveWatchedCycle;

function cyclesRemoveWatchedCycle(edgeEntry)
{
    var cycleId = edgeEntry.watchedCycle;

    if(cycleId == undefined)
        return; // no watched cycle to remove

    // if the given edge is normal, it has just become normal and
    // the watched cycle is replaced by an identical normal cycle
    // therefore, in that case, do not notify of removal 
    if(this.notifyCycleRemoved !== undefined && !edgeEntry.isNormal)
        this.notifyCycleRemoved(this.watchedCycles, cycleId);
    
    this.watchedCycles.removeVector(cycleId);
    delete this.watchedCycleToEdge[cycleId];
        
    if(this.watchedChanges[cycleId] == "added")
        delete this.watchedChanges[cycleId];
    else
        this.watchedChanges[cycleId] = edgeEntry.id;

    delete edgeEntry.watchedCycle;
}

// This function takes a cycle and an edge which is on that cycle and adds
// a watched path based on this cycle such that the watched path contains
// all edges in the cycle except for the one given. The direction of the
// path is from the first node of the edge to its second node (in canonical
// order).
// After creating the watched cycle, the original cycle is removed.

Cycles.prototype.makeWatchedCycleFromCycle = cyclesMakeWatchedCycleFromCycle;

function cyclesMakeWatchedCycleFromCycle(cycleId, edgeEntry)
{
    var edgeId = edgeEntry.id;
    
    // get the direction of this edge in the cycle
    var dir = this.cycles.getValue(cycleId, edgeId);
    
    // remove this edge entry from the vector.
    this.cycles.setValue(cycleId, edgeId, 0);
    
    // create a new (empty) watched cycle
    var vecId = edgeEntry.watchedCycle = this.watchedCycles.newVector([]);
    // add the modified cycle to the empty watched cycle
    // with a multiple depending on the direction of the edge
    this.watchedCycles.addToVector(vecId, this.cycles.vectors[cycleId], 
                                   undefined, -dir);
    
    this.watchedCycleToEdge[vecId] = edgeEntry.id;
    this.watchedChanges[vecId] = "added";

    // remove the original cycle
    this.cycles.removeVector(cycleId);
    delete this.cycleNonForestEdge[cycleId];
    if(this.changes[cycleId] == "added")
        delete this.changes[cycleId];
    else
        this.changes[cycleId] = "removed";
}

//////////////////////////////////////////////
// Interface functions for external modules //
//////////////////////////////////////////////

// This function returns true if the given edge is part of a cycle

Cycles.prototype.edgeInCycle = cyclesEdgeInCycle;

function cyclesEdgeInCycle(edgeId)
{
    return this.cycles.componentIndex.has(edgeId);
}

Cycles.prototype.clearChanges = cyclesClearChanges;

function cyclesClearChanges()
{
    this.changes = {};
    this.watchedChanges = {};
}
