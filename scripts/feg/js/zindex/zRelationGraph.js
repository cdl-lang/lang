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
    var r = new ZRelation(elementBelow, elementAbove, priority, undefined, name);
    g.addRel(r);
    ...
    g.removeRel(r);

Create a new relation, depending on a relation and an element
    var r = new ZRelation(elementBelow, elementAbove, priority, embedded, name);

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
function ZRelation(below, above, priority, embedded, name, userInfo) {
    this.id = gZRelationId++; // Integer
    this.below = below; // ElementId
    this.above = above; // ElementId
    this.priority = priority; // Integer
    this.relationSet = undefined; // ZRelationSet: parent relation set
    this.embedded = embedded; // Boolean: when true, above is embedded in below
    this.name = name;
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
    this.suspendedBecauseOf = undefined; // Array<ZRelation>: relations that
                                         // caused blocking of this
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
function zrelationSetDeactivate(suspendingRelations) {
    assert(!(suspendingRelations instanceof ZRelation), "must be set or undefined");
    if (this.active === this.maxPrioRel) {
        this.maxPrioRel = undefined;
    }
    this.active = undefined;
    this.suspendedBecauseOf = suspendingRelations;
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

// Walk violatingLevels to check if a can be reached from b starting at
// z-value zv
// violatingLevels[zv][a] === b means that a constraint forced a's z-value
// to be (at least) 1 higher than b's
function onDirectedPath(a, b, zv, violatingLevels) {
    while (b !== undefined) {
        if (b === a) {
            return true;
        }
        b = violatingLevels[zv][b];
        zv--;
    }
    return false;
}

// Returns the path from b to a; note that the final step, isn't be present,
// because it was the relation being tested.
function getDirectedPath(a, b, zv, violatingLevels) {
    var path = [a];

    while (b !== a) {
        assert(b !== undefined, "cannot happen when onDirectedPath returns true");
        path.push(b);
        b = violatingLevels[zv][b];
        zv--;
    }
    return path;
}

// Emulates the update algorithm. When it 
ZRelationGraph.prototype.findDirectedPath = ZRelationGraphFindDirectedPath;
function ZRelationGraphFindDirectedPath(below, above) {
    var zLevels = [];

    if (!(below in this.vertices) || !(above in this.vertices)) {
        // there can't be a path between non-existent points
        return undefined;
    }
    var minZVal = this.getZValue(below);
    var tempZLevel = {};
    tempZLevel[below] = this.getZValue(below);
    if (tempZLevel[below] < this.getZValue(above)) {
        return undefined;
    }
    tempZLevel[above] = tempZLevel[below] + 1;
    zLevels[minZVal] = {};
    zLevels[minZVal][below] = undefined;
    minZVal++;
    zLevels[minZVal] = {};
    zLevels[minZVal][above] = below;
    while (minZVal < zLevels.length) {
        var vertices = zLevels[minZVal];
        if (vertices !== undefined) {
            var nextv = zLevels[minZVal + 1];
            for (var vertex in vertices) {
                tempZLevel[vertex] = minZVal;
                for (var above in this.vertices[vertex].above) {
                    if (above in tempZLevel) { // loop candidate
                        if (onDirectedPath(above, vertex, minZVal, zLevels)) {
                            return getDirectedPath(above, vertex, minZVal, zLevels);
                        }
                    } else {// above hasn't been seen yet, so can't be a loop
                        tempZLevel[above] = this.getZValue(above);
                    }
                    if (tempZLevel[above] <= minZVal) {
                        if (nextv === undefined) {
                            zLevels[minZVal + 1] = nextv = {};
                        }
                        nextv[above] = vertex;                            
                    }
                }
            }
        }
        minZVal++;
    }
    for (vertex in tempZLevel) {
        this.setZValue(vertex, tempZLevel[vertex]);
    }
    return undefined;
}

// Returns a list of all unique relations in the given paths sorted by priority
// from low to high.
ZRelationGraph.prototype.collectAllRelations = zRelationGraphCollectAllRelations;
function zRelationGraphCollectAllRelations(path, rel) {
    var relations = [rel];

    for (var i = 0; i < path.length - 1; i++) {
        relations.push(this.getActiveRel(path[i + 1], path[i]));
    }
    return relations.sort(function (r1, r2) {
        return r1.priority - r2.priority; 
    });
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
    var shortestCycle = this.findDirectedPath(rel.below, rel.above);

    this.resolveCycleBlockRel = undefined;
    while (shortestCycle !== undefined) {
        var relations = this.collectAllRelations(shortestCycle, rel);
        if (relations[0] === rel) {
            this.resolveCycleBlockRel = relations.slice(1);
            // The proposed relation is weaker than the existing
            return false;
        }
        this.suspendRel(relations[0], relations.slice(1).concat(rel));
        shortestCycle = this.findDirectedPath(rel.below, rel.above);
    }
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

function makePosConstraint(r) {
    var a = r.split(' ');

    return "{element:'" + a[0] + "',type:'" + (a.length === 1? "bottom": a[1]) + "'}";
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
            // console.log("add {{point1:" + makePosConstraint(rel.below) +
            //            "},{point2:" + makePosConstraint(rel.above) + "},prio:" +
            //            rel.priority + ",min:1}");
            if (!this.potentialCycle(rel)) {
                // if not both edges were in the graph, there cannot be a cycle
                this.activate(rel);
                return true;
            } else if (this.resolveCycle(rel)) {
                // if rel doesn't cause a cycle, push away possibly weaker
                // relations and retest suspended relations
                if (!isEmpty) {
                    this.removeSuspended(edgeRS);
                }
                this.activate(rel);
                this.retestSuspended();
                return true;
            } else {
                // otherwise, put rel on the suspended list
                if (isEmpty) {
                    this.addSuspended(edgeRS, this.resolveCycleBlockRel);
                }
                return false;
            }
        }
    }
}

// A relation can only cause a cycle if the below vertex of a relation is in the
// graph and has one or more vertices below it, and the above vertex is in the
// graph and has one or more vertices above it.
ZRelationGraph.prototype.potentialCycle = zRelationGraphPotentialCycle;
function zRelationGraphPotentialCycle(rel) {
    return rel.below in this.vertices &&
          this.vertices[rel.below].nrBelow > 0 &&
          rel.above in this.vertices &&
          this.vertices[rel.above].nrAbove > 0;
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
function zRelationGraphAddSuspended(relSet, blockingRelations) {
    assert(!(blockingRelations instanceof ZRelation), "must be set or undefined");
    assert(relSet.getActive() === undefined && !relSet.isEmpty(),
           "active or empty set suspended");
    relSet.suspendedBecauseOf = blockingRelations;
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
function zRelationGraphCheckVertex(elementId) {
    var vertex = this.vertices[elementId];

    if (!vertex) {
        this.vertices[elementId] = vertex = new Vertex(elementId);
    }
    if (vertex.isIsolated()) {
        // The vertex is changing from isolated to connected
        this.nrConnectedVertices++;
    }
    if (!(elementId in this.zValues)) {
        this.setZValue(elementId, "");
    }
    return vertex;
}

// Activates the relation rel and provides initial values if
// necessary.
ZRelationGraph.prototype.activate = zRelationGraphActivate;
function zRelationGraphActivate(rel) {
    rel.getRelationSet().activate(rel);
    this.checkVertex(rel.below).addAbove(rel);
    this.checkVertex(rel.above).addBelow(rel);

    if (!this.propagateChange(rel.below)) {
        if (this.getZValue(rel.above) <= this.getZValue(rel.below)) {
            this.propagateChange(rel.above);
        }
    }

    this.changed[rel.above] = true;
    this.changed[rel.below] = true;
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
function zRelationGraphDeactivateRel(rel, suspendingRelations) {
    if (rel && rel.isActive()) {
        rel.getRelationSet().deactivate(suspendingRelations);
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
    }
    if (this.vertices[above].isBottom()) {
        this.setZValue(above, "");
    }
}

ZRelationGraph.prototype.suspendRel = ZRelationGraphSuspendRel;
function ZRelationGraphSuspendRel(rel, suspendingRels) {
    this.removeEdge(rel.below, rel.above);
    this.deactivateRel(rel, suspendingRels);
    this.callback(rel, false);
    this.addSuspended(this.getEdgeRelationSet(rel.below, rel.above),
                      suspendingRels);
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
            if (rel && !this.blockingCycleStillActive(rel)) {
                suspendTmp = this.suspended;
                this.suspended = [];
                if (this.resolveCycle(rel)) {
                    rs.suspendedBecauseOf = undefined;
                    this.activate(rel);
                    this.callback(rel, true);
                    if (this.suspended.length !== 0) {
                        // changes have been made, so retest everything again
                        changes = true;
                        this.suspended = cconcat(
                            this.suspended, cconcat(suspendTmp,
                                                   sortedRelSets.slice(i + 1)));
                        break;
                    } else {
                        this.suspended = suspendTmp;
                    }
                } else {
                    rs.suspendedBecauseOf = this.resolveCycleBlockRel;
                    this.suspended = cconcat(this.suspended, suspendTmp);
                    this.suspended.push(rs);
                }
            } else {
                this.suspended.push(rs);
            }
        }
    }
}

// Check if the relations that blocked the addition of rel are still active.
// If so, there's no reason to test again.
ZRelationGraph.prototype.blockingCycleStillActive =
      ZRelationGraphBlockingCycleStillActive;
function ZRelationGraphBlockingCycleStillActive(rel) {
    var suspendingRels;

    if (rel.relationSet === undefined) {
        return false;
    }
    suspendingRels = rel.relationSet.suspendedBecauseOf;
    if (suspendingRels !== undefined) {
        for (var i = 0; i !== suspendingRels.length; i++) {
            if (!suspendingRels[i].isActive() ||
                  suspendingRels[i].priority < rel.priority) {
                return false;
            }
        }
    }
    return true;
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
        // console.log("remove {{point1:" + makePosConstraint(rel.below) +
        //             "},{point2:" + makePosConstraint(rel.above) + "}}");
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

ZRelationGraph.prototype.updateViolatingLevels =
      ZRelationGraphUpdateViolatingLevels;
function ZRelationGraphUpdateViolatingLevels(violatingLevels,
                                             minViolatingZValue) {
    while (minViolatingZValue < violatingLevels.length) {
        var vertices = violatingLevels[minViolatingZValue];
        if (vertices !== undefined) {
            var nextv = violatingLevels[minViolatingZValue + 1];
            for (var vertex in vertices) {
                this.setZValue(vertex, minViolatingZValue);
                for (var above in this.vertices[vertex].above) {
                    if (this.getZValue(above) <= minViolatingZValue) {
                        if (nextv === undefined) {
                            violatingLevels[minViolatingZValue + 1] = nextv = {};
                        }
                        nextv[above] = true;                            
                    }
                }
            }
        }
        minViolatingZValue++;
    }
}

// First assigns the correct z-value to all changed vertices. If any of
// them violates the relation with an "above" vertex, it's put on a list.
// This list is per z-value. When all values have been assigned, propagation
// proceeds upward, putting higher vertices on the list when they violate
// a constraint, until done.
ZRelationGraph.prototype.propagateChanges = zRelationGraphPropagateChanges;
function zRelationGraphPropagateChanges(changes) {
    var vertex, zv, vertices, nextv;
    var violatingLevels = [];
    var minViolatingZValue = undefined;
    
    for (vertex in changes) {
        zv = this.getMinimalZValue(vertex);
        if (this.getZValue(vertex) < zv) {
            vertices = violatingLevels[zv];
            if (vertices === undefined) {
                violatingLevels[zv] = vertices = {};
            }
            vertices[vertex] = true;
            if (minViolatingZValue === undefined || minViolatingZValue > zv) {
                minViolatingZValue = zv;
            }
        }
    }
    if (minViolatingZValue) {
        this.updateViolatingLevels(violatingLevels, minViolatingZValue);
        while (minViolatingZValue < violatingLevels.length) {
            vertices = violatingLevels[minViolatingZValue];
            if (vertices !== undefined) {
                nextv = violatingLevels[minViolatingZValue + 1];
                for (vertex in vertices) {
                    this.setZValue(vertex, minViolatingZValue);
                    for (var above in this.vertices[vertex].above) {
                        if (this.getZValue(above) <= minViolatingZValue) {
                            if (nextv === undefined) {
                                violatingLevels[minViolatingZValue + 1] = nextv = {};
                            }
                            nextv[above] = true;                            
                        }
                    }
                }
            }
            minViolatingZValue++;
        }
    }
}

// First assures a correct z-value for the changed vertex. If it
// violates the relation with an "above" vertex, it's put on a list.
// This list is per z-value. When all values have been assigned,
// propagation proceeds upward, putting higher vertices on the list
// when they violate a constraint, until done. Returns true when
// changes have been propagated.
ZRelationGraph.prototype.propagateChange = zRelationGraphPropagateChange;
function zRelationGraphPropagateChange(start) {
    var zv = this.getMinimalZValue(start);

    if (this.getZValue(start) < zv) {
        var violatingLevels = [];
        var minViolatingZValue = zv;
        violatingLevels[zv] = {};
        violatingLevels[zv][start] = true;
        this.updateViolatingLevels(violatingLevels, minViolatingZValue);
        return true;
    }
    return false;
}

// Returns a z-value that's one higher than all below
ZRelationGraph.prototype.getMinimalZValue = zRelationGraphGetMinimalZValue;
function zRelationGraphGetMinimalZValue(n) {
    var zv, p, maxLwb = -1;

    for (p in this.vertices[n].below) {
        zv = this.getZValue(p);
        if (maxLwb < zv) {
            maxLwb = zv;
        }
    }
    return maxLwb + 1;
}

ZRelationGraph.prototype.allLowerVerticesIn = zRelationGraphAllLowerVerticesIn;
function zRelationGraphAllLowerVerticesIn(v, vSet) {
    for (var p in this.vertices[v].below) {
        if (!(p in vSet)) {
            return false;
        }
    }
    return true;
}


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

// Returns true when above >* below. Only works when the graph is up to date.
// Part of the API
ZRelationGraph.prototype.hasPath = zRelationGraphHasPath;
function zRelationGraphHasPath(start, target) {
    var outer = [{vertex: start, prev: undefined}];
    var subGraph = {};
    var nrSteps = 0; // cheap safeguard against cycles
    var node, rel;
    var targetZ = this.getZValue(target);

    subGraph[start] = [];
    if (start === target)
        return true;
    while (outer.length !== 0 && nrSteps <= this.nrConnectedVertices + 2) {
        var l = outer;
        outer = [];
        for (var i = 0; i !== l.length; i++) {
            var e = l[i];
            if (e.vertex === target)
                return true;
            if (this.getZValue(e.vertex) > targetZ && e.vertex !== target) {
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
function zRelationGraphDump(showSuspended, showLabel) {
    var str = "digraph zrelation {\nrankdir=BT;\n";
    var below, above, edgeRS, act;
    var subgraphs = {};

    function checkSubGraph(areaId, z) {
        var str, areaSetStackable;

        if (!(areaId in dbgAreaSetRepr) || areaId in subgraphs) {
            return '';
        }
        subgraphs[areaId] = true;
        str = 'subgraph "cluster_' + areaId + '" {\n"' + areaId + '=' + z + '";\n';
        areaSetStackable = dbgAreaSetRepr[areaId];
        for (var childId in areaSetStackable.areaSet) {
            str += '"' + childId + '";\n';
        }
        str += '}\n';
        return str;
    }

    for (below in this.relations) {
        var bAreaId = below.slice(2);
        var bz = this.getZValue(below);
        var bl = bAreaId + "=" + bz;
        str += checkSubGraph(bAreaId, bz);
        for (above in this.relations[below]) {
            var aAreaId = above.slice(2);
            edgeRS = this.relations[below][above];
            act = edgeRS.getActive() !== undefined;
            if (showSuspended || act) {
                var az = this.getZValue(above);
                var al = aAreaId + "=" + az;
                str += checkSubGraph(aAreaId, az);
                str += '"' + bl + '" -> "' + al + '"';
                if (showLabel) {
                    str += ' [label="' + edgeRS.toString2() + '"' +
                          (act? "];\n": ',style=dotted];\n');
                } else if (!act) {
                    str += ' [style=dotted];\n';
                } else if (edgeRS.maxPrioRel !== undefined &&
                           (edgeRS.maxPrioRel.priority < -9999 ||
                            edgeRS.maxPrioRel.priority > 9999)) {
                    str += ' [style="dashed"];\n';
                }
                else str += ';\n';
            }
        }
    }
    return str + "}\n";
}

// Prints the list of all complete bipartite subgraphs. When trueKnm is true,
// no relations are permitted between elements in either subgraph of Knm.
ZRelationGraph.prototype.findCompleteBipartiteSubGraphs =
      zRelationGraphFindCompleteBipartiteSubGraphs;
function zRelationGraphFindCompleteBipartiteSubGraphs(trueKnm) {
    for (var e1 in this.vertices) {
        var v1 = this.vertices[e1];
        var L = {};
        L[e1] = true;
        for (var e2 in v1.above) {
            var v2 = this.vertices[e2];
            var U = {};
            U[e2] = true;
            this.expandKnm(L, 1, U, 1, trueKnm);
        }
    }
}

// Given a Kn,m from L to U, find an element to add to L or U that turns it
// into Kn+1,m Or Kn,m+1. If none can be found, Kn,m is maximal, so print it
// (unless it |L| = |U| = 1).
ZRelationGraph.prototype.expandKnm = zRelationGraphExpandKnm;
function zRelationGraphExpandKnm(L, cardL, U, cardU, trueKnm) {
    var hasBeenExpanded = false;

    // Returns true when e is larger than all elements in S. This helps
    // to avoid duplicates in the output.
    function inOrder(e, S) {
        for (var s in S)
            if (e < s)
                return false;
        return true;
    }

    function isGoodLower(v) {
        return v.substr(0, 2) !== "a_" || v.substr(-4) === " top";
    }

    function isGoodUpper(v) {
        return v.substr(0, 2) !== "a_" || v.substr(-4) !== " top";
    }

    for (var v in this.vertices) {
        // v cannot be added to L or U when it is already in either
        if (!(v in L) && !(v in U)) {
            var vertex = this.vertices[v];
            // v can be added to L when there is no path between v and any
            // element in L, and v can reach every element in U directly
            if (inOrder(v, L) && isGoodLower(v) &&
                this.allContainedIn(U, vertex.above) &&
                (!trueKnm || !this.pathFrom(v, L))) {
                hasBeenExpanded = true;
                L[v] = true;
                if (!this.expandKnm(L, cardL + 1, U, cardU, trueKnm) && cardU > 1) {
                    console.log(Object.keys(L), "->", Object.keys(U));
                }
                delete L[v];
            }
            // v can be added to U when there is no path between v and any
            // element in U, and v can be reached directly from every element in
            // L
            if (inOrder(v, U) && isGoodUpper(v) &&
                this.allContainedIn(L, vertex.below) &&
                (!trueKnm || !this.pathFrom(v, U))) {
                hasBeenExpanded = true;
                U[v] = true;
                if (!this.expandKnm(L, cardL, U, cardU + 1, trueKnm) && cardL > 1) {
                    console.log(Object.keys(L), "->", Object.keys(U));
                }
                delete U[v];
            }
        }
    }
    return hasBeenExpanded;
}

// Checks if all vertices in s1 are contained in s2
ZRelationGraph.prototype.allContainedIn = zRelationGraphAllContainedIn;
function zRelationGraphAllContainedIn(s1, s2) {
    for (var v in s1)
        if (!(v in s2))
            return false;
    return true;
}

// Checks if there is a path from v to any element in S
ZRelationGraph.prototype.pathFrom = zRelationGraphPathFrom;
function zRelationGraphPathFrom(v, S) {
    for (var s in S)
        if (this.hasPath(v, s) || this.hasPath(s, v))
            return true;
    return false;
}

ZRelationGraph.prototype.isKnm = zRelationGraphIsKnm;
function zRelationGraphIsKnm(L, U) {
    for (var l in L)
        if (!(this.allContainedIn(U, this.vertices[l].above)))
            return "no l: " + l;
    for (var u in U)
        if (!(this.allContainedIn(L, this.vertices[u].below)))
            return "no u: " + u;
    for (l in L) {
        delete L[l];
        if (this.pathFrom(l, L))
            return "not proper l: " + l;
        L[l] = true;
    }
    for (u in U) {
        delete U[u];
        if (this.pathFrom(u, U))
            return "not proper u: " + u;
        U[u] = true;
    }
    return "yes";
}

ZRelationGraph.prototype.minimizeZValues = zRelationGraphMinimizeZValues;
function zRelationGraphMinimizeZValues() {
    var isMinimized = true;
    var bottom = [];
    var higherVertices;
    var level = 0;
    var minimized = {};
    var awaiting = {};

    for (var v in this.vertices) {
        var minVal = this.getMinimalZValue(v);
        if (minVal !== this.getZValue(v)) {
            isMinimized = false;
        }
        if (minVal === 0) {
            bottom.push(v);
        }
    }
    if (isMinimized) {
        return;
    }
    higherVertices = bottom;
    while (higherVertices.length > 0) {
        var vertices = higherVertices;
        higherVertices = [];
        for (var i = 0; i < vertices.length; i++) {
            var v = vertices[i];
            if (this.allLowerVerticesIn(v, minimized)) {
                this.setZValue(v, level);
                minimized[v] = true;
                for (var h in this.vertices[v].above) {
                    if (!(h in awaiting)) {
                        higherVertices.push(h);
                        awaiting[h] = true;
                    }
                }
            } else {
                higherVertices.push(v);
                awaiting[h] = true;
            }
        }
        level++;
    }
}
