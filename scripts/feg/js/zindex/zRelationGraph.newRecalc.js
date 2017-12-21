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

/* API:

Core:

Create a new z relation	graph
    var g = new ZRelationGraph();

Create a new relation, add it, remove it:
    var r = new ZRelation(elementBelow, elementAbove, priority);
    g.addRel(r);
    ...
    g.removeRel(r);

Create a new relation, depending on a relation and an element
    var r = new ZRelation(elementBelow, elementAbove, priority, embedded);

Compute	new z-index values:
    g.recalc();

Get z-index value for an element:
    g.getHTMLZValue()

Check changes:
    for (var eltid in g.newZValues) {
        someFunction(eltid, g.newZValues[eltid]);
    }
    g.newZValues = {};	// clear changes for next time

Callback:
    g.registerCallback(obj, fun);
    g.unregisterCallback();
    obj.fun is called with a relation and a boolean when the status of a
    the relation has changed; there can be only one callback per graph.

Some extras:

Get a relation's id:
    r.getId()

Get a relation's priority
    r.getPriority()

Find out if a relation is still present in the graph (active or suspended)
   r.isPresent()

Find out if a relation is active
   r.isActive()

Change the preferred step size
   ZRelationGraph.increment = <some integer>;

Get active relation between two elements:
   g.getEdge(elementBelow, elementAbove)

Find out if an element is below another element:
   g.hasPath(elementBelow, elementAbove)

Dump z relations showing or hiding the suspended ones ... "GraphViz" style:
    console.log(g.dump(true/false));

*/

"use strict";

var gZRelationId = 1;

// A ZRelation is simply a relation between (the ids of) a higher and a lower
// element, with a certain priority. If embedded is true, above is embedded in
// below and consequently higher than below when both have the same z-index.
// Part of the API
function ZRelation(below, above, priority, embedded, userInfo) {
    this.id = gZRelationId++; // Integer
    this.below = below; // ElementId
    this.above = above; // ElementId
    this.priority = priority; // Integer
    this.relationSet = undefined; // ZRelationSet: parent relation set
    this.embedded = embedded; // Boolean: when true, above is embedded in below
    this.userInfo = userInfo; // To be used at the user's discretion
}

// Returns a relation's id
// Part of the API
ZRelation.prototype.getId = zrelationGetId;
function zrelationGetId() {
    return this.id;
}

ZRelation.prototype.getBelow = zRelationGetBelow;
function zRelationGetBelow() {
    return this.below;
}

ZRelation.prototype.getAbove = zRelationGetAbove;
function zRelationGetAbove() {
    return this.above;
}

ZRelation.prototype.getRelationSet = zrelationGetRelationSet;
function zrelationGetRelationSet() {
    return this.relationSet;
}

// Returns a relation's priority
// Part of the API
ZRelation.prototype.getPriority = zrelationGetPriority;
function zrelationGetPriority() {
    return this.priority;
}

// Returns whether a relation is present in the graph or not (either active
// or suspended)
// Part of the API
ZRelation.prototype.isPresent = zrelationIsPresent;
function zrelationIsPresent() {
    return this.relationSet !== undefined;
}

// Returns whether a relation is active or not
// Part of the API
ZRelation.prototype.isActive = zrelationIsActive;
function zrelationIsActive() {
    return this.relationSet !== undefined &&
           this.relationSet.getActive() === this;
}

// Set of relations between the same vertices. 
// Assumes that active is max priortity
function ZRelationSet() {
    this.active = undefined; // ZRelation: the currently active relation
    this.maxPrioRel = undefined; // ZRelation: relation with maximum priority
    this.relations = {}; // Map<id, ZRelation>
    this.nrRelations = 0; // Integer: cardinality of this.relations
    this.suspendedBecauseOf = undefined; // ZRelationSet: indicates why this edge was suspended
}

// Useful for debugging
ZRelationSet.prototype.toString = zrelationSetToString;
function zrelationSetToString() {
    var str = this.getId();
    var first = true;

    for (var id in this.relations) {
        var rel = this.relations[id];
        if (first) {
            str += ":";
            first = false;
        } else {
            str += ",";
        }
        if (this.active === rel) str += "*";
        if (this.maxPrioRel === rel) str += "!";
        str += "#" + rel.id + "(" + rel.priority + ")";
    }
    return str;
}

// Used in ZrelationGraph.dump()
ZRelationSet.prototype.toString2 = zrelationSetToString2;
function zrelationSetToString2() {
    var str = "";
    var first = true;

    for (var id in this.relations) {
        var rel = this.relations[id];
        if (first) {
            first = false;
        } else {
            str += ",";
        }
        if (this.active !== rel) str += "*" + rel.id; else str += rel.id;
        if (this.maxPrioRel !== rel) str += "(!" + rel.priority + ")";
        else str += "(" + rel.priority + ")";
    }
    return str;
}

// Returns an identifier based on the relations in the set. If everything is
// ok, then this is a unique identifier in the graph. Only used for debugging.
ZRelationSet.prototype.getId = zRelationSetGetId;
function zRelationSetGetId() {
    for (var rid in this.relations) {
        return this.relations[rid].above + " > " + this.relations[rid].below;
    }
    return undefined;
}

// Returns the active relation of this set, if there is one
ZRelationSet.prototype.getActive = zrelationSetGetActive;
function zrelationSetGetActive() {
    return this.active;
}

// Checks whether the set contains a given relation
ZRelationSet.prototype.contains = zrelationSetContains;
function zrelationSetContains(rel) {
    return rel.id in this.relations;
}

// Adds a relation to the set; updates maxPrioRel
ZRelationSet.prototype.add = zrelationSetAdd;
function zrelationSetAdd(rel) {
    if (!(rel.id in this.relations)) {
        this.nrRelations++;
    }
    this.relations[rel.id] = rel;
    if (this.maxPrioRel === undefined ||
          this.maxPrioRel.priority < rel.priority) {
        this.maxPrioRel = rel;
    }
    rel.relationSet = this;
}

// Removes a relation from the set
ZRelationSet.prototype.remove = zrelationSetRemove;
function zrelationSetRemove(rel) {
    if (rel.id in this.relations) {
        this.nrRelations--;
    }
    delete this.relations[rel.id];
    if (this.maxPrioRel === rel) {
        this.maxPrioRel = undefined;
    }
    rel.relationSet = undefined;
}

// States that the indicated relation is active. There can only be one
// active relation in every zrelation set
ZRelationSet.prototype.activate = zrelationSetActivate;
function zrelationSetActivate(rel) {
    this.active = rel;
    this.maxPrioRel = rel;
    this.suspendedBecauseOf = undefined;
}

// States that the relation set has no active relation
ZRelationSet.prototype.deactivate = zrelationSetDeactivate;
function zrelationSetDeactivate(suspendingRelation) {
    if (this.active === this.maxPrioRel) {
        this.maxPrioRel = undefined;
    }
    this.active = undefined;
    this.suspendedBecauseOf = suspendingRelation;
}

// Gets the ZRelation with the highest priority that is not blocked by an
// inactive dependency from the set.
ZRelationSet.prototype.getMaxPriorityRelation =
      zrelationSetGetMaxPriorityRelation;
function zrelationSetGetMaxPriorityRelation() {
    if (this.maxPrioRel === undefined) {
        var max = undefined;
        this.maxPrioRel = undefined;
        for (var id in this.relations) {
            if (max === undefined || max < this.relations[id].priority) {
                this.maxPrioRel = this.relations[id];
                max = this.relations[id].priority;
            }
        }
    }
    return this.maxPrioRel;
}

// Gets the highest priority from the available relations in the set
ZRelationSet.prototype.getMaxPriority = zrelationSetGetMaxPriority;
function zrelationSetGetMaxPriority() {
    var mpr = this.getMaxPriorityRelation();

    return mpr === undefined? undefined: mpr.priority;
}

// True when there are no relations in the set
ZRelationSet.prototype.isEmpty = zrelationSetIsEmpty;
function zrelationSetIsEmpty() {
    return this.nrRelations === 0;
}

// Finds another permissable relation with the same priority.
// If one can be found, it is a useful replacement when rel is deleted,
// so retesting the suspended relations can be avoided.
ZRelationSet.prototype.findEquivalentRel = zRelationSetFindEquivalentRel;
function zRelationSetFindEquivalentRel(rel) {
    for (var id in this.relations) {
        if (this.relations[id] !== rel &&
              this.relations[id].priority === rel.priority) {
            return this.relations[id];
        }
    }
    return undefined;
}

// A vertex in the ZRelationGraph. It knows which vertices are above it, and
// which are below it.
function Vertex(elementId) {
    this.elementId = elementId; // ElementId
    this.above = {}; // Map<ElementId, ZRelation>
    this.nrAbove = 0; // Integer: Cardinality of this.above
    this.below = {}; // Map<ElementId, ZRelation>
    this.nrBelow = 0; // Integer: Cardinality of this.below
}

Vertex.prototype.addAbove = lowerThanAddAbove;
function lowerThanAddAbove(rel) {
    if (!(rel.above in this.above)) {
        this.nrAbove++;
    }
    this.above[rel.above] = rel;
}

Vertex.prototype.addBelow = lowerThanAddBelow;
function lowerThanAddBelow(rel) {
    if (!(rel.below in this.below)) {
        this.nrBelow++;
    }
    this.below[rel.below] = rel;
}

Vertex.prototype.isDirectlyBelow = vertexIsDirectlyBelow;
function vertexIsDirectlyBelow(element) {
    return element in this.above;
}

Vertex.prototype.isDirectlyAbove = vertexIsDirectlyAbove;
function vertexIsDirectlyAbove(element) {
    return element in this.below;
}

Vertex.prototype.getAbove = vertexGetAbove;
function vertexGetAbove(above) {
    return above in this.above? this.above[above]: undefined;
}

Vertex.prototype.removeAbove = lowerThanRemoveAbove;
function lowerThanRemoveAbove(above) {
    if (above in this.above) {
        this.nrAbove--;
    }
    delete this.above[above];
}

Vertex.prototype.removeBelow = lowerThanRemoveBelow;
function lowerThanRemoveBelow(below) {
    if (below in this.below) {
        this.nrBelow--;
    }
    delete this.below[below];
}

Vertex.prototype.isBottom = vertexIsBottom;
function vertexIsBottom() {
    return this.nrBelow === 0;
}

Vertex.prototype.isRoot = vertexIsRoot;
function vertexIsRoot() {
    return this.nrBelow === 0 && this.nrAbove > 0;
}

Vertex.prototype.isIsolated = vertexIsIsolated;
function vertexIsIsolated() {
    return this.nrAbove === 0 && this.nrBelow === 0;
}

Vertex.prototype.isLeaf = vertexIsLeaf;
function vertexIsLeaf() {
    return this.nrAbove === 0;
}

// Graph for relations on z-index values.
// - vertices contain the highest priority active relations
// - relations contains all relation sets
// - suspended contains the suspended relation sets
// - roots contains the bottom elements in the graph (unused)
// - zValues contains a set of z-index values for all elements; can be read
//   by others, but should not be changed.
// - changed is a set of elements that has been changed in the last update step
//   it is not meant for inspection; nrChanged is its cardinality
// - newZValues is the set of changes to z values; it will be extended in
//   every call to recalc(). Third parties can clear it to find the set of
//   changes, or even change values in it, if they want.
// Part of the API
function ZRelationGraph() {
    this.vertices = {}; // Map<ElementId, Vertex>: maps element id onto its vertex
    this.nrConnectedVertices = 0; // Integer: number of vertices that are connected to at least one other vertex
    this.relations = {}; // Map<ElementId, Map<ElementId, ZRelationSet>>: all relations between two elements
    this.suspended = []; // List<ZRelationSet>: list of suspended relation sets
                         // invariant: adding any of these will cause a cycle
    this.zValues = {}; // Map<ElementId, Integer>: assigned z values
    this.changed = {}; // Map<ElementId, Integer>: elements changed since last recalc with their previous value
    this.nrChanged = 0; // Integer: cardinality this.changed
    this.newZValues = {}; // Map<ElementId, Integer>: new z-values
    this.callbackObject = undefined; // Object: used in callback
    this.callbackFunction = undefined; // Function: used in callback
    this.resolveCycleBlockRel = undefined; // For info about relation susp.
    this.roots = {};
}

ZRelationGraph.prototype.registerCallback = zRelationGraphRegisterCallback;
function zRelationGraphRegisterCallback(obj, fun) {
    this.callbackObject = obj;
    this.callbackFunction = fun;
}

ZRelationGraph.prototype.unregisterCallback = zRelationGraphUnregisterCallback;
function zRelationGraphUnregisterCallback() {
    this.callbackObject = undefined;
    this.callbackFunction = undefined;
}

ZRelationGraph.prototype.callback = zRelationGraphCallback;
function zRelationGraphCallback(rel, active) {
    if (this.callbackFunction !== undefined) {
        this.callbackFunction.call(this.callbackObject, rel, active);
    }
}

// function nodeInPath(e) {
//     var p = e.prev;
//
//     while (p !== undefined) {
//         if (p.vertex === e.vertex) {
//             return true;
//         }
//         p = p.prev;
//     }
//     return false;
// }

// function pathToStr(e) {
//     var p = e.prev;
//     var str = String(e.vertex);
//
//     while (p !== undefined) {
//         str = String(p.vertex) + " > " + str;
//         p = p.prev;
//     }
//     return str;
// }

// This function finds all paths from start to target in the required direction,
// and returns them as an array of reversed linked lists (i.e., the top element
// of the list is the last vertex in the path). It uses the "spreading oil"
// algorithm. It does not detect cycles, as we assume there are none, but does
// stop after a maximum number of steps.
// Returns the sub-graph created by going down from the start until the target;
// if the target is not in it, there is no cycle. Each member of the data
// structure corresponds to a vertex and points back to its origin with an array
// of {rel: r, prev: p}, where r is the relation between the current point and
// the previous.
// Note: the algoritm uses the fact that there is at most one edge between two
// vertices.
ZRelationGraph.prototype.findDirectedPaths = zRelationGraphFindDirectedPaths;
function zRelationGraphFindDirectedPaths(start, target) {
    var outer = [{vertex: start, prev: undefined}];
    var subGraph = {};
    var nrSteps = 0; // cheap safeguard against cycles
    var node, rel;

    subGraph[start] = [];
    while (outer.length !== 0 && nrSteps <= this.nrConnectedVertices + 2) {
        var l = outer;
        outer = [];
        for (var i = 0; i !== l.length; i++) {
            var e = l[i];
            // if (nodeInPath(e)) { console.log("CYCLE", pathToStr(e)); debugger; break;}
            if (e.vertex !== target) {
                if (e.vertex in this.vertices) { 
                    for (var end in this.vertices[e.vertex].below) {
                        rel = this.vertices[e.vertex].below[end];
                        if (end in subGraph) {
                            subGraph[end].push({rel: rel, prev: e.prev});
                        } else {
                            node = [{rel: rel, prev: e.prev}];
                            subGraph[end] = node;
                            outer.push({vertex: end, prev: node});
                        }
                    }
                }
            }
        }
        nrSteps++;
    }
    // the maximum number of steps in a non-cyclical graph is the number of
    // connected vertices + 1; if nrSteps exceeds that, there is a cycle.
    assert(nrSteps <= this.nrConnectedVertices + 1, "nrSteps = " + nrSteps + ", nrVert = " + this.nrConnectedVertices);
    return subGraph;
}

ZRelationGraph.prototype.removePathsContaining = zRelationGraphRemovePathsContaining;
function zRelationGraphRemovePathsContaining(subGraph, rel) {
    var arr = subGraph[rel.below];

    for (var pos = 0; pos !== arr.length; pos++) {
        if (arr[pos].rel === rel) {
            arr.splice(pos, 1);
            return;
        }
    }
    assert(false, "some assumption failed");
}

// Returns a list of all unique relations in the given paths sorted by priority
// from low to high.
ZRelationGraph.prototype.collectAllRelations = zRelationGraphCollectAllRelations;
function zRelationGraphCollectAllRelations(subGraph, target) {
    var relations = [];
    var history = {};
    var outer = [target];

    while (outer.length !== 0) {
        var l = outer;
        outer = [];
        for (var i = 0; i !== l.length; i++) {
            var vertex = l[i];
            if (!(vertex in history)) {
                history[vertex] = true;
                var edges = subGraph[vertex];
                for (var j = 0; j !== edges.length; j++) {
                    var edge = edges[j];
                    relations.push(edge.rel);
                    outer.push(edge.rel.above);
                }
            }
        }
    }
    return relations.sort(function (r1, r2) {
        return r1.priority - r2.priority; 
    });
}

// Checks for cycles in a sub-graph returned by this.findDirectedPaths() by
// walking back from the target to the start
ZRelationGraph.prototype.containsCycle = zRelationGraphContainsCycle;
function zRelationGraphContainsCycle(subGraph, start, target) {
    var history = {};
    var outer = [target];

    while (outer.length !== 0) {
        var l = outer;
        outer = [];
        for (var i = 0; i !== l.length; i++) {
            var vertex = l[i];
            if (!(vertex in history)) {
                if (vertex === start) {
                    return true;
                }
                history[vertex] = true;
                var edges = subGraph[vertex];
                for (var j = 0; j !== edges.length; j++) {
                    outer.push(edges[j].rel.above);
                }
            }
        }
    }
    return false;
}

function printDirectedPath(subGraph, start, target) {
    var history = {};
    var outer = [{vertex: target, prev: undefined}];
    
    while (outer.length !== 0) {
        var l = outer;
        outer = [];
        for (var i = 0; i !== l.length; i++) {
            var vertex = l[i];
            if (!(vertex.vertex in history)) {
                if (vertex.vertex === start) {
                    var a = [];
                    var path = vertex;
                    while (path) {
                        a.push(path.vertex);
                        path = path.prev;
                    }
                    console.log(a);
                } else {
                    history[vertex.vertex] = true;
                    var edges = subGraph[vertex.vertex];
                    for (var j = 0; j !== edges.length; j++) {
                        outer.push({vertex: edges[j].rel.above, prev: vertex});
                    }
                }
            }
        }
    }
}

// Checks for potential cycles, i.e. all paths from rel.above to rel.below. If
// there are such paths, applies the following heuristic: find a relation with
// the lowest priority that occurs in one of the paths, and remove it from all
// paths (i.e., take those paths which contain that relation out of the
// collection of cycles). If the collection is not yet empty, repeat. If the
// collection is empty, the found relations are removed from the graph and
// pushed onto the list of suspended relations. However, the process also stops
// when the new relation is the one with the lowest priority. In that case, the
// function returns false. If there are no cycles, or lower priority relations
// can be removed, the function returns true.
ZRelationGraph.prototype.resolveCycle = zRelationGraphResolveCycle;
function zRelationGraphResolveCycle(rel) {
    var subGraph = this.findDirectedPaths(rel.below, rel.above);

    if (!(rel.above in subGraph)) {
        return true;
    }
    var relations = this.collectAllRelations(subGraph, rel.above);
    var eliminated = [];
    var thereIsACycle = true;
    while (thereIsACycle) {
        var relInCycle = relations[eliminated.length];
        if (relInCycle.priority >= rel.priority) {
            this.resolveCycleBlockRel = relInCycle;
            return false;
        }
        eliminated.push([relInCycle.below, relInCycle.above]);
        this.removePathsContaining(subGraph, relInCycle);
        thereIsACycle = this.containsCycle(subGraph, rel.below, rel.above);
    }
    this.resolveCycleBlockRel = undefined;
    this.suspendAll(eliminated, rel);
    return true;
}

// Returns the currently active relation between below and above
ZRelationGraph.prototype.getActiveRel = zRelationGraphGetActiveRel;
function zRelationGraphGetActiveRel(below, above) {
    return below in this.relations &&
           above in this.relations[below]?
           this.relations[below][above].getActive():
           undefined;
}

// Adds relations a > b with given priority when it doesn't cause a
// cycle. If it does cause a cycle, relations with the lowest priority
// are removed from the cycle until the priority threshold reachs the
// new relation's priority or the new relation can be added.
// Returns true when relation was activated, false when it wasn't, and
// undefined when it had already been added.
// When a relation that describes an already existing edge is added, it will be
// ignored when the new priority doesn't exceed the old one; otherwise it will
// replace the old relation (when active) or trigger retesting (when inactive).
// Part of the API
ZRelationGraph.prototype.addRel = zRelationGraphAddRel;
function zRelationGraphAddRel(rel) {
    var edgeRS, actRel, maxPrio, isEmpty;

    if (rel.below === rel.above) {
        return false; // ignore those (easier for writing relations)
    } else if (rel.getRelationSet() !== undefined) {
        return undefined; // bit weird, but ok
    } else {
        edgeRS = this.getEdgeRelationSet(rel.below, rel.above);
        isEmpty = edgeRS.isEmpty();
        actRel = edgeRS.getActive();
        maxPrio = edgeRS.getMaxPriority();
        edgeRS.add(rel);
        if (maxPrio !== undefined && rel.priority <= maxPrio) {
            // a similar relation with higher priority was already processed
            return false;
        } else if (actRel) {
            // there is an active similar relation with a lower priority
            edgeRS.activate(rel);
            this.replaceRel(rel);
            return true;
        } else {
            // check if this causes a cycle and push away possibly less
            // strong relations
            if (this.resolveCycle(rel)) {
                if (!isEmpty) {
                    this.removeSuspended(edgeRS);
                }
                this.activate(rel);
                this.retestSuspended();
                return true;
            } else {
                if (isEmpty) {
                    this.addSuspended(edgeRS, this.resolveCycleBlockRel);
                }
                return false;
            }
        }
    }
}

ZRelationGraph.prototype.getEdgeRelationSet = zRelationGraphGetEdgeRelationSet;
function zRelationGraphGetEdgeRelationSet(below, above) {
    var b = this.relations[below];
    var rs;

    if (!b) {
        this.relations[below] = b = {};
    }
    rs = b[above];
    if (!rs) {
        b[above] = rs = new ZRelationSet();
    }
    return rs;
}

ZRelationGraph.prototype.removeVertex = zRelationGraphRemoveVertex;
function zRelationGraphRemoveVertex(vertex) {
    var v;

    delete this.relations[vertex];
    if (vertex in this.changed) {
        delete this.changed[vertex];
        // don't change nrChanged, as things have changed and can be
        // recomputed.
    }
    for (v in this.vertices[vertex].above) {
        delete this.vertices[v].below[vertex];
    }
    for (v in this.vertices[vertex].below) {
        delete this.vertices[v].above[vertex];
    }
    delete this.vertices[vertex];
}

// Adds a relation (set) to the list of suspended relations.
ZRelationGraph.prototype.addSuspended = zRelationGraphAddSuspended;
function zRelationGraphAddSuspended(relSet, blockingRelation) {
    assert(relSet.getActive() === undefined && !relSet.isEmpty(),
           "active or empty set suspended");
    relSet.suspendedBecauseOf = blockingRelation;
    this.suspended.push(relSet);
}

// Removes a relation set from the suspended list
ZRelationGraph.prototype.removeSuspended = zRelationGraphRemoveSuspended;
function zRelationGraphRemoveSuspended(edgeRS) {
    var i = this.suspended.indexOf(edgeRS);

    assert(i >= 0, "relation not suspended");
    this.suspended.splice(i, 1);
}

// Creates a vertex if needed and updates the number of connected vertices
ZRelationGraph.prototype.checkVertex = zRelationGraphCheckVertex;
function zRelationGraphCheckVertex(elementId, adding) {
    var vertex = this.vertices[elementId];

    if (!vertex) {
        this.vertices[elementId] = vertex = new Vertex(elementId);
    }
    if (adding && vertex.isIsolated()) {
        this.nrConnectedVertices++;
    }
    return vertex;
}

// Activates the relation rel and provides initial values if
// necessary.
ZRelationGraph.prototype.activate = zRelationGraphActivate;
function zRelationGraphActivate(rel) {
    rel.getRelationSet().activate(rel);
    this.checkVertex(rel.below, true).addAbove(rel);
    this.checkVertex(rel.above, true).addBelow(rel);
    if (!(rel.below in this.zValues) && !(rel.above in this.zValues)) {
        this.setZValue(rel.below, 0);
        this.setZValue(rel.above, ZRelationGraph.increment);
    } else if (!(rel.below in this.zValues)) {
        this.setZValue(rel.below,
                    Math.max(0, this.getZValue(rel.above) - ZRelationGraph.increment));
    } else if (!(rel.above in this.zValues)) {
        this.setZValue(rel.above,
                       this.getZValue(rel.below) + ZRelationGraph.increment);
    }
    this.changed[rel.above] = true;
    this.changed[rel.below] = true;
    if (rel.above in this.roots) {
        delete this.roots[rel.above];
    }
    if (!(rel.below in this.roots) && this.vertices[rel.below].isBottom()) {
        this.roots[rel.below] = true;
    }
}

// Replaces the active relation
ZRelationGraph.prototype.replaceRel = zRelationGraphReplaceRel;
function zRelationGraphReplaceRel(rel) {
    this.vertices[rel.below].addAbove(rel);
    this.vertices[rel.above].addBelow(rel);
}

ZRelationGraph.prototype.isEdgeActive = zRelationGraphIsEdgeActive;
function zRelationGraphIsEdgeActive(below, above) {
    return below in this.vertices &&
           this.vertices[below].isDirectlyBelow(above);
}

// Deactivates relation. Doesn't call retestSuspended() itself for
// efficiency reasons.
ZRelationGraph.prototype.deactivateRel = zRelationGraphDeactivateRel;
function zRelationGraphDeactivateRel(rel, suspendingRelation) {
    if (rel && rel.isActive()) {
        rel.getRelationSet().deactivate(suspendingRelation);
        this.callback(rel, false);
    }
}

// Removes an edge and tests the two vertices for connectedness and bottom
ZRelationGraph.prototype.removeEdge = zRelationGraphRemoveEdge;
function zRelationGraphRemoveEdge(below, above) {
    var rel = this.vertices[below].getAbove(above);

    this.vertices[below].removeAbove(above);
    this.vertices[above].removeBelow(below);
    if (this.vertices[below].isIsolated()) {
        this.nrConnectedVertices--;
    }
    if (this.vertices[above].isIsolated()) {
        this.nrConnectedVertices--;
    }
    if (this.vertices[below].isBottom()) {
        this.setZValue(below, "");
        if (below in this.roots && this.vertices[below].isIsolated()) {
            delete this.roots[below];
        }
    }
    if (this.vertices[above].isBottom()) {
        this.setZValue(above, "");
        if (!(above in this.roots) && !this.vertices[above].isIsolated()) {
            this.roots[above] = true;
        }
    }
    return rel;
}

// Deactivates relations and moves them to the list of suspended relations.
ZRelationGraph.prototype.suspendAll = zRelationGraphSuspendAll;
function zRelationGraphSuspendAll(edges, suspendingRel) {
    var i, edge, rel;

    if (edges.length !== 0) {
        for (i = 0; i !== edges.length; i++) {
            edge = edges[i];
            rel = this.removeEdge(edge[0], edge[1]);
            this.deactivateRel(rel, suspendingRel);
            this.callback(rel, false);
            this.addSuspended(this.getEdgeRelationSet(edge[0], edge[1]),
                              suspendingRel);
        }
    }
}

// Checks the suspended relations one by one for potential cycles, and
// activates the non-conflicting ones. As soon as a change has been made,
// newly suspended elements get tested too.
ZRelationGraph.prototype.retestSuspended = zRelationGraphRetestSuspended;
function zRelationGraphRetestSuspended() {
    var sortedRelSets, suspendTmp;
    var changes = true;
    var sortFun = function (rs1, rs2) {
        return rs2.getMaxPriority() - rs1.getMaxPriority();
    };

    while (changes) {
        changes = false;
        sortedRelSets = this.suspended.sort(sortFun);
        this.suspended = [];
        for (var i = 0; i !== sortedRelSets.length; i++) {
            var rs = sortedRelSets[i];
            var rel = rs.getMaxPriorityRelation();
            if (rel) {
                suspendTmp = this.suspended;
                this.suspended = [];
                if (this.resolveCycle(rel)) {
                    rs.suspendedBecauseOf = undefined;
                    this.activate(rel);
                    this.callback(rel, true);
                    if (this.suspended.length !== 0) {
                        // changes have been made, so retest everything again
                        changes = true;
                        this.suspended = this.suspended.concat(suspendTmp).
                                             concat(sortedRelSets.slice(i + 1));
                        break;
                    } else {
                        this.suspended = suspendTmp;
                    }
                } else {
                    rs.suspendedBecauseOf = this.resolveCycleBlockRel;
                    this.suspended = suspendTmp;
                    this.suspended.push(rs);
                }
            } else {
                this.suspended.push(rs);
            }
        }
    }
}

// Removes a relation. If it was an active relation, the edge relation set
// gets suspended and all suspended relations are retested.
// If doNotRetest is true, a return value of true means the caller is
// responsible for calling this.retestSuspended(). This can be done once after
// multiple removes, but must be done before any other action.
// Part of the API
ZRelationGraph.prototype.removeRel = zRelationGraphRemoveRel;
function zRelationGraphRemoveRel(rel, doNotRetest) {
    var edgeRS = rel.getRelationSet();
    var isActiveRel = rel.isActive();
    var equivalentRel;

    if (edgeRS === undefined) {
        return false; // can happen when rel.above === rel.below or rel already deleted
    }
    if (isActiveRel) {
        edgeRS.deactivate(undefined);
        equivalentRel = edgeRS.findEquivalentRel(rel);
        if (equivalentRel) {
            edgeRS.remove(rel);
            this.replaceRel(equivalentRel);
            edgeRS.activate(equivalentRel);
            // the status of the graph hasn't changed; retesting is unnecessary
            return false;
        } else {
            this.removeEdge(rel.below, rel.above);
        }
    }
    edgeRS.remove(rel);
    if (edgeRS.isEmpty()) {
        delete this.relations[rel.below][rel.above];
        if (!isActiveRel) {
            this.removeSuspended(edgeRS);
        }
    } else if (isActiveRel) {
        this.addSuspended(edgeRS, undefined);
    }
    if (isActiveRel) {
        if (doNotRetest) {
            return true;
        }
        this.retestSuspended();
    }
    return false;
}

var gNrZRecalcs = 0;


// Solves the solution using an attraction/repulsion-based method.
// Part of the API
ZRelationGraph.prototype.recalc = zRelationGraphRecalc;
function zRelationGraphRecalc() {
    var origChangeSet = dupObj(this.changed, 0);
    var stepNr = 0;
    var update;

    gNrZRecalcs++;
    // for (var v in this.vertices) {
    //     if (this.vertices[v].isBottom() && !this.vertices[v].isIsolated()) {
    //         assert(v in this.roots);
    //     }
    // }
    // for (v in this.roots) {
    //     assert(this.vertices[v].isBottom() && !this.vertices[v].isIsolated());
    // }
    this.propagateFromRoot();
    // this.filterChanges();
    // this.optimize();
    // update = !this.verifyConstraints(origChangeSet);
    // while (update && stepNr < 100) {
    //     this.changed = {};
    //     this.nrChanged = 0;
    //     // Move all elements to a correct position
    //     for (var vertex in this.vertices) {
    //         this.forceBetweenPeers(vertex);
    //     }
    //     update = this.nrChanged !== 0;
    //     this.optimize();
    //     stepNr++;
    // }
}

ZRelationGraph.prototype.propagateFromRoot = zRelationGraphPropagateFromRoot;
function zRelationGraphPropagateFromRoot() {
    var outer = {};
    var nrOuter = 0;
    var nrChanges = Object.keys(this.changed).length;
    
    for (var v in this.roots) {
        outer[v] = 0;
        nrOuter++;
    }
    while (nrOuter !== 0) {
        var l = outer;
        var changed = false;
        outer = {};
        nrOuter = 0;
        for (v in l) {
            var minZ = l[v];
            if (v in this.changed) {
                delete this.changed[v];
                nrChanges--;
            }
            for (var above in this.vertices[v].above) {
                var zAbove = this.getZValue(v);
                if (zAbove < minZ) {
                    this.setZValue(above, minZ);
                    changed = true;
                    outer[above] = minZ + 1;
                } else {
                    outer[above] = zAbove + 1;
                }
                nrOuter++;
            }
        }
        if (!changed && nrChanges === 0) {
            break;
        }
    }
}

// Determines the preferred increment in z-values
// Part of the API
ZRelationGraph.increment = 1024;

// Returns the z-index value determined for an element.
// If any changes have been made, recalc() needs to be called first
// for this value to be correct.
// Part of the API
ZRelationGraph.prototype.getHTMLZValue = zRelationGraphGetHTMLZValue;
function zRelationGraphGetHTMLZValue(n) {
    return this.zValues[n];
}

// Returns the z-index value determined for an element, mapping "" to 0
// for convenient comparison.
ZRelationGraph.prototype.getZValue = zRelationGraphGetZValue;
function zRelationGraphGetZValue(n) {
    return this.zValues[n] === ""? 0: this.zValues[n];
}

// If a node has a z-index between its above and below peers, it doesn't move.
// If a node is outside that range, it will. If there is no space between its
// peers, the lowest areas above are pushed up. If a node has no peers above
// or below, it will get pushed up or down by the increment value (1024), but
// never below 0.
ZRelationGraph.prototype.forceBetweenPeers = zRelationGraphForceBetweenPeers;
function zRelationGraphForceBetweenPeers(n) {
    var zv, p, guard;
    var minUpb, maxLwb;
    var maxLwbEmbedded = false;

    for (p in this.vertices[n].above) {
        zv = this.getZValue(p);
        if (minUpb === undefined || minUpb > zv) {
            minUpb = zv;
        }
    }
    for (p in this.vertices[n].below) {
        zv = this.getZValue(p);
        if (maxLwb === undefined || maxLwb < zv) {
            maxLwb = zv;
            maxLwbEmbedded = this.vertices[n].below[p].embedded;
        } else if (maxLwb === zv && maxLwbEmbedded) {
            maxLwbEmbedded = this.vertices[n].below[p].embedded;
        }
    }
    if (minUpb !== undefined && maxLwb !== undefined) {
        if (this.zValues[n] === "" || this.zValues[n] <= maxLwb ||
              this.zValues[n] >= minUpb) {
            if (maxLwbEmbedded) {
                zv = maxLwb;
                if (maxLwb > minUpb) {
                    guard = maxLwb + 32;
                    for (p in this.vertices[n].above) {
                        if (this.getZValue(p) < maxLwb) {
                            if (this.vertices[n].above[p].embedded) {
                                this.setZValue(p, maxLwb);
                            } else {
                                this.setZValue(p, guard);
                            }
                        }
                    }
                }
            } else {
                if (maxLwb >= minUpb - 1) {
                    zv = maxLwb + 16;
                    guard = zv + 16;
                    for (p in this.vertices[n].above) {
                        if (this.getZValue(p) <= zv) {
                            if (this.vertices[n].above[p].embedded) {
                                this.setZValue(p, zv);
                            } else {
                                this.setZValue(p, guard);
                            }
                        }
                    }
                } else {
                    zv = Math.floor((maxLwb + minUpb + 1) / 2);
                }
            }
            this.setZValue(n, zv);
        }
    } else if (minUpb !== undefined) {
        if (this.zValues[n] !== "" && this.zValues[n] >= minUpb) {
            this.setZValue(n, Math.max(0, minUpb - ZRelationGraph.increment));
        }
    } else if (maxLwb !== undefined) {
        if (this.zValues[n] === "" || this.zValues[n] <= maxLwb) {
            this.setZValue(n, (maxLwbEmbedded? maxLwb: maxLwb + ZRelationGraph.increment));
        }
    }
}

// Removes elements from the set of initial changes that will trigger changes
// in other elements: when they have a changed element below but not space
// above, or when they have a changed element above and no space below. This
// is to make the initial optimization step make as few changes as possible
// and avoid that it tries to make changes where there is no space. This is
// just an extra heuristic on the optimization: if it can't solve the problem,
// the normal update procedure will take care of the problem.
ZRelationGraph.prototype.filterChanges = zRelationGraphFilterChanges;
function zRelationGraphFilterChanges() {
    for (var n in this.changed) {
        var hasChangeBelow = false;
        var hasChangeAbove = false;
        var minUpb, maxLwb, p, zv;
        for (p in this.vertices[n].above) {
            if (p in this.changed) {
                hasChangeAbove = true;
            } else {
                zv = this.getZValue(p);
                if (minUpb === undefined || minUpb > zv) {
                    minUpb = zv;
                }
            }
        }
        for (p in this.vertices[n].below) {
            if (p in this.changed) {
                hasChangeBelow = true;
            } else {
                zv = this.getZValue(p);
                if (maxLwb === undefined || maxLwb < zv) {
                    maxLwb = zv;
                }
            }
        }
        if ((hasChangeAbove && maxLwb === this.getZValue(n) - 1) ||
            (hasChangeBelow && minUpb === this.getZValue(n) + 1)) {
            delete this.changed[n];
        }
    }
}

// returns true when all elements in elems satisfy their relations
ZRelationGraph.prototype.verifyConstraints = zRelationGraphVerifyConstraints;
function zRelationGraphVerifyConstraints(elems) {
    var rel, zp;

    for (var n in elems) {
        var zv = this.getZValue(n);
        for (var p in this.vertices[n].above) {
            rel = this.vertices[n].above[p];
            zp = this.getZValue(p);
            if (zv > zp || (!rel.embedded && zv === zp)) {
                return false;
            }
        }
    }
    return true;
}

ZRelationGraph.prototype.optimizeChange = zRelationGraphOptimizeChange;
function zRelationGraphOptimizeChange(n) {
    var zv, p;
    var minUpb, maxLwb;
    var maxLwbEmbedded = false;

    for (p in this.vertices[n].above) {
        zv = this.getZValue(p);
        if (minUpb === undefined || minUpb > zv) {
            minUpb = zv;
        }
    }
    for (p in this.vertices[n].below) {
        zv = this.getZValue(p);
        if (maxLwb === undefined || maxLwb < zv) {
            maxLwb = zv;
            maxLwbEmbedded = this.vertices[n].below[p].embedded;
        } else if (maxLwb === zv && maxLwbEmbedded) {
            maxLwbEmbedded = this.vertices[n].below[p].embedded;
        }
    }
    if (minUpb !== undefined && maxLwb !== undefined) {
        if (maxLwb < minUpb - 1) {
            zv = (maxLwbEmbedded? maxLwb: Math.floor((minUpb + maxLwb) / 2));
            if (this.zValues[n] !== zv) {
                this.setZValue(n, zv);
                return true;
            }
        }
    } else if (minUpb !== undefined) {
        zv = Math.max(0, minUpb - ZRelationGraph.increment);
        if (this.zValues[n] !== "" && this.zValues[n] !== 0 &&
              this.zValues[n] !== zv) {
            this.setZValue(n, zv);
            return true;
        }
    } else if (maxLwb !== undefined) {
        zv = (maxLwbEmbedded? maxLwb: maxLwb + ZRelationGraph.increment);
        if (this.zValues[n] !== zv) {
            this.setZValue(n, zv);
            return true;
        }
    }
    return false;
}

// Runs over all changed elements to optimize the distance between it and
// its peers on both sides. Needs at most 11 cycles to cover the preferred
// increment of 1024.
ZRelationGraph.prototype.optimize = zRelationGraphOptimize;
function zRelationGraphOptimize() {
    var i = 0, n;
    var update = true;

    while (update && i <= 10) {
        update = false;
        for (n in this.changed) {
            if (this.optimizeChange(n)) {
                update = true;
            }
        }
        i++;
    }
}

// Stores the z-index value for an element, and marks it as changed. Also
// records the new value in newZValues for easy inspection by external
// callers.
ZRelationGraph.prototype.setZValue = zRelationGraphSetZValue;
function zRelationGraphSetZValue(elt, zVal) {
    if (zVal === 0) {
        zVal = "";
    }
    if (this.zValues[elt] !== zVal) {
        if (!(elt in this.changed)) {
            this.changed[elt] = true;
            this.nrChanged++;
        }
        this.zValues[elt] = zVal;
        this.newZValues[elt] = zVal;
    }
}

// Returns the active relation above > below if it exists, or undefined
// Part of the API
ZRelationGraph.prototype.getEdge = zRelationGraphGetEdge;
function zRelationGraphGetEdge(below, above) {
    if (below in this.vertices) {
        return this.vertices[below].above[above];
    }
    return undefined;
}

// Returns true when above >* below
// Part of the API
ZRelationGraph.prototype.hasPath = zRelationGraphHasPath;
function zRelationGraphHasPath(below, above) {
    var outer = [above];
    var stepNr = 0;
    
    while (outer.length !== 0 && stepNr < this.nrConnectedVertices) {
        var l = outer;
        outer = [];
        for (var i = 0; i !== l.length; i++) {
            var e = l[i];
            if (e === below) {
                return true;
            }
            if (e in this.vertices) { 
                for (var end in this.vertices[e].below) {
                    outer.push(end);
                }
            }
        }
        stepNr++;
    }
    return false;
}

// Checks if all relations in this.relations are active and present in
// this.vertices, or not active and present in this.suspended, and vice
// versa. Also checks if the active relation has the highest priority.
// Note: assert error 2 implies assert error 3, and 6 implies 7.
// Part of the API
ZRelationGraph.prototype.checkConsistency = zRelationGraphCheckConsistency;
function zRelationGraphCheckConsistency() {
    var below, above, edgeRS, activeRel, i, id, rel, first, susprels;

    for (below in this.relations) {
        for (above in this.relations[below]) {
            edgeRS = this.relations[below][above];
            assert(!edgeRS.isEmpty(), "(1) edgeRS may not be empty");
            activeRel = edgeRS.getActive();
            if (activeRel) {
                assert(this.isEdgeActive(below, above),
                       "(2) edgeRS is active and should be in graph");
                assert(below in this.vertices &&
                       above in this.vertices[below].above &&
                       this.vertices[below].above[above] === activeRel,
                       "(3) activeRel should be the active edge");
                assert(activeRel.priority >= edgeRS.getMaxPriority(),
                       "(4) activeRel should have highest priority");
            } else {
                assert(this.suspended.indexOf(edgeRS) !== -1,
                       "(4) edgeRS has no active edge so should be suspended");
            }
        }
    }
    for (below in this.vertices) {
        for (above in this.vertices[below].above) {
            assert(below in this.relations &&
                   above in this.relations[below] &&
                   this.relations[below][above] !== undefined,
                   "(15) active edge should have be in relations");
            activeRel = this.vertices[below].above[above];
            edgeRS = activeRel.getRelationSet();
            assert(edgeRS, "(5) active edge should be part of a relation set");
            assert(below in this.relations && above in this.relations[below],
                   "(6) active edge should be in relations");
            assert(edgeRS === this.getEdgeRelationSet(below, above),
                   "(7) edge relation set should be unique");
        }
    }
    susprels = {};
    for (i = 0; i !== this.suspended.length; i++) {
        edgeRS = this.suspended[i];
        assert(!(edgeRS.getId() in susprels),
               "(16) relation should be suspended only once: " + edgeRS.toString());
        susprels[edgeRS.getId()] = true;
        assert(!edgeRS.isEmpty(),
               "(8) suspended rs should not be empty: " + edgeRS.toString());
        assert(edgeRS.getActive() === undefined,
               "(9) suspended relation set should not have active edge: " +
               edgeRS.toString());
        first = undefined;
        for (id in edgeRS.relations) {
            rel = edgeRS.relations[id];
            if (!first) {
                assert(!(rel.below in this.vertices) ||
                       !(rel.above in this.vertices[rel.below].above) ||
                       this.vertices[rel.below].above[rel.above] === undefined,
                       "(10) no active edge should have a suspended relation set:" +
                       edgeRS.toString());
                first = rel;
            } else {
                assert(rel.below === first.below && rel.above === first.above,
                       "(11) relation set should contain similar relations");
            }
            assert(edgeRS.getMaxPriority() === undefined ||
                   rel.priority <= edgeRS.getMaxPriority(),
                   "(12) higher priority relation in relation set");
        }
        var subGraph = this.findDirectedPaths(rel.below, rel.above);
        assert(rel.above in subGraph,
               "(13) relation should only be suspended because of cycle or dependencies: " + rel.id);
    }
}

// Returns a string representation of the graph suitable for layout using
// "dot" (part of graphviz; http://graphviz.org/). If showSuspended is true,
// suspended relations are shown as dotted lines.
// Part of the API
ZRelationGraph.prototype.dump = zRelationGraphDump;
function zRelationGraphDump(showSuspended) {
    var str = "digraph zrelation {\nrankdir=BT;\n";
    var below, above, edgeRS, act;

    for (below in this.relations) {
        for (above in this.relations[below]) {
            edgeRS = this.relations[below][above];
            act = edgeRS.getActive() !== undefined;
            if (showSuspended || act) {
                str += '"' + below + '" -> "' + above +
                      '" [label="' + edgeRS.toString2() + '"' +
                      (act? "];\n": ",style=dotted];\n");
            }
        }
    }
    return str + "}\n";
}
