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

/*

Basics
======

Any area can have a stacking section. In that section, constraints can be set
on the z-order of areas. These constraints have a name, like the positioning
constraints, and describe the z-order in relative terms:

stacking: {
    someConstraintName: {
        higher: ...,
        lower: ...,
        priority: ...
    },
    anotherConstraintName: {
        ...
    }
}

The effect is that the areas mentioned in the higher attribute will be
rendered above the areas mentioned in lower, provided there is no
contradiction.


Details
=======

Obviously, it's easy to write contradictory constraints. To understand how the
system deals with contradictions, it's important to realize that the
constraints are added one area pair at a time. When an area pair B < A gets
added and the constraints already present imply that A < B, the system looks
for the constraints involved with a lower priority than the new relation (this
chain can be complex, e.g. when A < C, C < D, D < E, C < F, E < F, and F < B
have already been added). If there are such constraints, they are suspended in
order of priority until the contradiction is resolved, and the new constraint
is added. If this cannot be done, the new relation is not added, but
suspended. Similarly, when a relation is removed, all suspended relations are
tested again to check if one or more can be added without causing a
contradiction.
* Note: no relations are added that place an area above/below itself.

For the higher and lower attributes, the following are permitted:
- an area set
- nothing (i.e., absence of the attribute)
- a string
- { label: string, element: <area set> }

The first variant affects the z-order of the areas mentioned directly. The
second variant is a short-hand for higher: [me] (or lower: [me]), so affects
the z-order of the current area.

The third variant is a global label and creates a level that can be used as a
kind of invisible separation.

The fourth variant is a label that is local to an area (or --when there area set
is larger--, a set of labels local to these areas); when there is no element,
the label is local to [me]. The intended use of this variant is to generate a
separation within an area, but is probably the variant that offers most
possibilities for creative use.

The priority attribute takes a number between -9999 and 9999. Anything larger
or lower is reserved for use by the system, in particular for placing implicit
constraints.

Internals
=========

A ZArea object is attached to each area. This object is responsible for
registering the stacking section, and passing changes in relations on to the
ZIndex object. While it is possible to have more than one ZIndex object in
theory, it doesn't make sense in practice. Consequently, there is one ZIndex
object, gZIndex, which controls all z-indices in the system.

A ZArea object generates differences between the previous and current state of
constraints per constraint name and passes these changes on to gZIndex. That
has a reference count of all area pairs plus priority. When a pair is created
for the first time, gZIndex creates a ZRelation and adds it to its
ZRelationGraph; when a pair is no longer needed, gZIndex removes it.

This is not all gZIndex does, however. The ZRelationGraph object does not have
any knowledge about embedding. The ZIndex object, however, does, through the
ZArea objects.

First, an area is split in a top and bottom element. These constraints for a
kind of box in which all children (and transitivally all descendants) are
kept, with low priority constraints. So, unless there is some author
constraint that breaks them, embedding relations are kept as in html.

When a relation between two areas is added, ZIndex looks for the least common
embedding, and adds extra relations between each node from the LCE upwards and
its siblings. That relation is needed to avoid unwanted changes in z-order
between siblings that do not have explicit constraints.

The relation that is assigned is one that keeps the ordering as it is at the
moment the extra relation is added by means of findCurrentZRelation(). The
reason for this is twofold: there will be no change except for the explicitly
added new relation, and when any of the existing relations between the
siblings involved is removed, the ordering will stay stable until the new
relation itself is removed.

gZIndex is also responsible for updating the z-values of the areas. This is
done in ZIndex.updateZ(), which is called in the geometry task after the
positioning. This functions calls ZRelationGraph's recalc() to obtain the
new values for each area's z-index attribute, and passes it on to the
corresponding ZArea.

However, this is not enough. Suppose we have this situation

            T
      +-----+-----+
      |     |     |
      A     U     C
      |  +--+--+
      |  |  |  |
      B  D  V  E

and there are constraints on T, so T has a non-default z-index. Since areas
A, B, C, D, E, U and V have the default z-index, they will be rendered on top
of T. But what happens when we set a constraint on V? If we keep a z-index on T,
V can only be moved relative to T's descendants, but nothing else.

Our trick is now to assign T's z-index not to its frame div, but to its
display div instead, and to copy T's z-index to areas A, U, D, E, and C. Now
we can assign V any z-index and it will no longer be restricted by T's frame.

This trickery is done trough ZArea.propagateUp() in cooperation with
ZArea.copyZIndexToDescendants() (and their counterparts,
ZArea.stopPropagateUp() and ZArea.clearZIndex()). Together, these functions
update the list of an area's descendants with an independent z-index, remove
the z-index from the frame, and moves it to the display div instead, and copy
the area's z-index to the frames of all siblings along each path to these
independent areas (note that this works because the Display object ensures
that the display div comes before the embedding div).

An unfortunate side effect of this approach is that frame opacity is no longer
supported, since making a frame even slightly transparant changes its role
in the rules for z-ordering.

TODO
====

There is still one efficiency issue, and that is avoiding to add ZRelations
for areas that don't really need it. Constructions like

stacking: {
    alert: {
        higher: [tempAreaSel, "alertWindow"],
        lower: [allAreas],
        priority: 9999
    }
}

will push all areas labeled "alertWindow" above all other areas (apart from
the minor fact that [allAreas] doesn't exist). Most of those other areas,
however, will have a default embedding, and consequently there is no need to
push them lower then the "alertWindow".

It might be possible to implement this by avoiding part of the registration
and z-value updates for areas that are not above any other area (i.e., not
mentioned in any "higher" attribute).

*/

// %%include%%: "zRelationGraph.js"
// %%include%%: "zArea.js"

var gZIndex;

function initZIndex() {
    gZIndex = new ZIndex();
    // allAreaMonitor.addCallBack(gZIndex);
}

function ZIndex() {
    this.lowestUserPriority = -9999;
    this.highestUserPriority = 9999;
    this.newZValues = {};
    this.dependentRelations = {};
    this.dependentRelationsPerArea = {};
    this.dependencies = {};
    this.relations = {}; // reference count for all active relations
    this.zRelations = new ZRelationGraph();
    this.zRelations.registerCallback(this, this.addToNewZ);
    this.changes = false; // true when this.updateZ() needs to be called
    this.tempStore = undefined; // stores relations retracted during reembedding
}

ZIndex.prototype.addArea = zIndexAddArea;
function zIndexAddArea(area, embedding) {
    var parent = embedding? ZArea.areaMap["a_"+embedding.areaId]: undefined;
    var zArea = ZArea.get(area);

    zArea.parent = parent;
    if (parent) {
        parent.addChild(zArea);
    }
    ZArea.areaMap[zArea.id] = zArea;
    zArea.area.setZIndex("", zArea.zIndex);
    return zArea;
}

ZIndex.prototype.removeArea = zIndexRemoveArea;
function zIndexRemoveArea(area) {
    var zArea = ZArea.areaMap["a_" + area.areaId];
    var above, below;

    if (zArea !== undefined) {
        for (below in this.dependentRelations) {
            if (zArea.id in this.dependentRelations[below]) {
                this.hardDeleteDependentRelation(
                    this.dependentRelations[below][zArea.id], below, zArea.id);
            }
        }
        for (above in this.dependentRelations[zArea.id]) {
            this.hardDeleteDependentRelation(
                this.dependentRelations[zArea.id][above], zArea.id, above);
        }
        zArea.clear();
        ZArea.release(zArea);
    }
}

ZIndex.prototype.newEmbedding = zIndexNewEmbedding;
function zIndexNewEmbedding(area, oldEmbedding, newEmbedding) {
    var zArea = ZArea.areaMap["a_" + area.areaId];
    var newParent = newEmbedding? ZArea.areaMap["a_" + newEmbedding.areaId]:
                                  undefined;
    
    this.retractRelations(zArea);
    if (zArea.parent) {
        zArea.parent.removeChild(zArea);
    }
    zArea.parent = newParent;
    if (newParent) {
        newParent.addChild(zArea);
    }
    this.reassertRelations();
    scheduleGeometryTask();
}

ZIndex.prototype.getZArea = zIndexGetZArea;
function zIndexGetZArea(id) {
    return ZArea.areaMap[id];
}

ZIndex.prototype.addToNewZ = zIndexAddToNewZ;
function zIndexAddToNewZ(rel, act) {
    this.markRelElements(rel);
}

ZIndex.prototype.markRelElements = zIndexMarkRelElements;
function zIndexMarkRelElements(rel) {
    var below = rel.getBelow();

    if (typeof(below) === "string" && below.substr(-4) === " top") {
        below = below.substr(0, below.length - 4);
    }
    this.newZValues[below] = 0;
    this.newZValues[rel.getAbove()] = 0;
}

ZIndex.prototype.updateZ = zIndexUpdateZ;
function zIndexUpdateZ() {
    var eltid;

    this.zRelations.minimizeZValues();
    for (eltid in this.newZValues) {
        this.newZValues[eltid] = this.zRelations.getHTMLZValue(eltid);
    }
    for (eltid in this.zRelations.newZValues) {
        this.newZValues[eltid] = this.zRelations.getHTMLZValue(eltid);
    }
    for (eltid in this.newZValues) {
        var zArea = ZArea.areaMap[eltid];
        var z = this.newZValues[eltid];
        if (zArea) {
            if (z === "") {
                if (zArea.zIndexStatus !== ZIndexStatus.copy) {
                    zArea.area.setZIndex("", "");
                    zArea.zIndex = "";
                }
            } else {
                zArea.copyZIndexToDescendants(z, ZIndexStatus.independent,
                                           zArea.pathsToIndependentDescendants);
            }
        }
    }
    this.changes = false;
    this.newZValues = {};
    this.zRelations.newZValues = {};
}

// Returns the current order between two siblings as [lowest, highest], so a
// newly added relation can copy the status quo.
ZIndex.prototype.findCurrentZRelation = zIndexFindCurrentZRelation;
function zIndexFindCurrentZRelation(area1, area2) {
    // First checks if there is an active relation between area1 and area2,
    // and uses that.
    if (this.zRelations.getEdge(area2.id, area1.id)) {
        return [area2, area1];
    } else if (this.zRelations.getEdge(area1.id, area2.id)) {
        return [area1, area2];
    }
    // If there is no (active) relation, we check if they have different Z
    // values assigned.
    var z1 = this.zRelations.getZValue(area1.id);
    var z2 = this.zRelations.getZValue(area2.id);
    if ((z1 !== undefined && z1 !== 0) || (z2 !== undefined && z2 !== 0)) {
        if (z1 > z2) {
            return [area2, area1];
        } else if (z1 < z2) {
            return [area1, area2];
        }
    }
    // Otherwise, we check the order of the divs. If area1's div
    // follows area2's div, then it is higher.
    if (ZArea.divFollows(area1, area2)) {
        return [area1, area2];
    } else {
        return [area2, area1];
    }
}

// this.dependentRelations stores relations between below/above once. It doesn't
// actually discriminate between priorities, since it's not clear that has any
// real advantages. depRel contains a relation, on which the newly formed
// relation is dependent.
// Note: the new relation is not made dependent on depRel. Reason: when element
// B1 under B has an independent relation, and we add A > B, the system adds A >
// B1 and B1 > B with a low priority, and the idea was to make these relations
// dependent on A > B. However, if A > B is in a cycle, then so are A > B1 and
// B1 > B, and the ZRelationGraph will suspend them before A > B. Hence, this
// kind of dependency is meaningless.
// Note 2: This is only called for siblings, so there is no need to check
// an embedding relation between them.
ZIndex.prototype.addDependentRelation = zIndexAddDependentRelation;
function zIndexAddDependentRelation(below, above, depRel, prio) {
    var id = depRel.getId();

    if (!(id in this.dependencies)) {
        this.dependencies[id] = {};
    }
    if (!(above in this.dependencies[id])) {
        this.dependencies[id][above] = {};
    }
    if (!(below in this.dependencies[id][above])) {
        this.dependencies[id][above][below] = true;
        this.createDependentRelation(below, above, prio);
    }
}

ZIndex.prototype.removeDependentRelations = zIndexRemoveDependentRelations;
function zIndexRemoveDependentRelations(relId) {
    for (var above in this.dependencies[relId]) {
        for (var below in this.dependencies[relId][above]) {
            if (this.deleteDependentRelation(below, above)) {
                this.changes = true;
            }
        }
    }
    delete this.dependencies[relId];
}

ZIndex.prototype.createRelation = zIndexCreateRelation;
function zIndexCreateRelation(below, above, prio, constraintName) {
    var areaBelow = ZArea.areaMap[below];
    var areaAbove = ZArea.areaMap[above];
    var embedded = areaBelow && areaAbove && areaAbove.isEmbeddedIn(areaBelow);
    var belowLabel, rel;

    if (areaBelow) {
        belowLabel = below + " top";
    } else {
        belowLabel = below;
    }
    rel = new ZRelation(belowLabel, above, prio, embedded, constraintName, {});
    if (areaBelow) {
        if (areaBelow.addRelation(rel.id, constraintName)) {
            this.changes = true;
        }
        areaBelow.refCount++;
    }
    if (areaAbove) {
        if (areaAbove.addRelation(rel.id, constraintName)) {
            this.changes = true;
        }
        areaAbove.refCount++;
    }
    return rel;
}

ZIndex.prototype.createDependentRelation = zIndexCreateDependentRelation;
function zIndexCreateDependentRelation(below, above, prio) {
    var dependency;
    var areaBelow = ZArea.areaMap[below];
    var areaAbove = ZArea.areaMap[above];

    if (!(below in this.dependentRelations)) {
        this.dependentRelations[below] = {};
    }
    if (above in this.dependentRelations[below]) {
        dependency = this.dependentRelations[below][above];
        dependency.count++;
    } else {
        dependency = this.dependentRelations[below][above] = {
            count: 1,
            rel: this.createRelation(below, above, prio, "sys:dependent")
        };
        if (this.zRelations.addRel(dependency.rel)) {
            this.changes = true;
        }
    }
}

ZIndex.prototype.deleteDependentRelation = zIndexDeleteDependentRelation;
function zIndexDeleteDependentRelation(below, above) {
    var dependency = this.dependentRelations[below][above];

    // dependency can already be deleted due to deletion of one of the areas
    if (dependency) {
        dependency.count--;
        if (dependency.count === 0) {
            this.hardDeleteDependentRelation(dependency, below, above);
        }
    }
}

function removeZIndexRelation(below, above, id) {
    if (below !== undefined) {
        below.removeRelation(id);
        ZArea.release(below);
    }
    if (above !== undefined) {
        above.removeRelation(id);
        ZArea.release(above);
    }
}

ZIndex.prototype.hardDeleteDependentRelation =
      zIndexHardDeleteDependentRelation;
function zIndexHardDeleteDependentRelation(dependency, below, above) {
    var areaBelow = ZArea.areaMap[below];
    var areaAbove = ZArea.areaMap[above];

    if (dependency.rel.isActive()) {
        this.changes = true;
    }
    removeZIndexRelation(areaBelow, areaAbove, dependency.rel.id);
    this.zRelations.removeRel(dependency.rel, false);
    delete this.dependentRelations[below][above];
}

// Finds all ancestors A from lce(A, B) upward and tries to assign a stable
// relation between all A and its siblings S={S1,S2,...}, in order to prevent A
// (assuming A > B) to jump above neighbouring areas. If there already is a
// relation A>Si or Si>A, it is copied; if it was added by this function, its
// reference count is increased. If there was no relation, we look for the
// current z-indices of A and Si, and assign a relation accordingly. If neither
// has a z-index, the decision is taken based on the order in which the divs of
// A and Si appear under their parent: if Si precedes A, A>Si is added. The
// priority of these relations is the lowest of the dependent relations.
// NOTE: This function has been commented out: it caused performance problems
// and did not seem to improve stacking, since the areas it is active in,
// rarely overlap, and have a constraint when they do.
ZIndex.prototype.checkLceUpward = zIndexCheckLceUpward;
function zIndexCheckLceUpward(A, B, newRel) {
/*
    var lceAncestor = A.findLce(B);
    var parent = (lceAncestor? lceAncestor.parent: undefined);
    
    while (parent) {
        if (this.assignDefaultSiblingRelations(parent, lceAncestor, newRel)) {
            this.changes = true;
        }
        lceAncestor = parent;
        parent = lceAncestor.parent;
    }
*/
    return false;
}

ZIndex.prototype.assignDefaultSiblingRelations =
      zIndexAssignDefaultSiblingRelations;
function zIndexAssignDefaultSiblingRelations(parent, target, depRel) {
    var changes = false;

    for (var childName in parent.children) {
        var child = parent.children[childName];
        if (child !== target) {
            var ab = this.findCurrentZRelation(child, target);
            var below = ab[0], above = ab[1];
            this.addDependentRelation(below.id, above.id, depRel,
                                         this.lowestUserPriority - 3);
        }
    }
    return changes;
}

ZIndex.prototype.addAll = zIndexAddAll;
function zIndexAddAll(relations, areaId, constraintName) {
    for (var i = 0; i !== relations.length; i++) {
        var rel = relations[i];
        var o, dbg;
        if (rel.below in this.relations) {
            o = this.relations[rel.below];
        } else {
            o = this.relations[rel.below] = {};
        }
        if (rel.above in o) {
            o = o[rel.above];
        } else {
            o = o[rel.above] = {};
        }
        if (rel.priority in o) {
            o[rel.priority].count++;
            dbg = o[rel.priority].rel.userInfo;
        } else {
            var zrel = this.createRelation(rel.below, rel.above, rel.priority, constraintName);
            o[rel.priority] = {count: 1, rel: zrel};
            dbg = zrel.userInfo;
            if (this.zRelations.addRel(zrel)) {
                this.changes = true;
            }
            var area1 = ZArea.areaMap[rel.below];
            var area2 = ZArea.areaMap[rel.above];
            if (area1 && area2) { // no need to check when one is a label
                if (this.checkLceUpward(area1, area2, zrel)) {
                    this.changes = true;
                }
            }
        }
        if (!(areaId in dbg)) dbg[areaId] = {};
        dbg[areaId][constraintName] = true;
    }
}

ZIndex.prototype.removeAll = zIndexRemoveAll;
function zIndexRemoveAll(relations, areaId, constraintName) {
    var retest = false, o, rel;

    for (var i = 0; i !== relations.length; i++) {
        rel = relations[i];
        if (rel.below in this.relations) {
            o = this.relations[rel.below];
            if (rel.above in o) {
                o = o[rel.above];
                if (rel.priority in o) {
                    o[rel.priority].count--;
                    if (o[rel.priority].count === 0) {
                        var zrel = o[rel.priority].rel;
                        removeZIndexRelation(ZArea.areaMap[rel.below],
                                             ZArea.areaMap[rel.above],
                                             zrel.id);
                        if (zrel.userInfo && areaId in zrel.userInfo) {
                            delete zrel.userInfo[areaId][constraintName];
                        }
                        delete o[rel.priority];
                        this.changes = true;
                        this.removeDependentRelations(zrel.id);
                        if (this.zRelations.removeRel(zrel, true)) {
                            retest = true;
                        }
                    }
                }
            }
        }
    }
    // TODO: there might be a bit of gain by retesting only before adding
    // a new relationship and before updating.
    if (retest) {
        this.zRelations.retestSuspended();
    }
}

// Removes all relations that involve zArea and puts them (temporarily)
// in tempStore.
ZIndex.prototype.retractRelations = zIndexRetractRelations;
function zIndexRetractRelations(zArea) {
    var below, above, priority;
    var retest = false;

    this.tempStore = [];
    for (below in this.relations) {
        for (above in this.relations[below]) {
            if (below === zArea.id || above === zArea.id) {
                for (priority in this.relations[below][above]) {
                    var zrel = this.relations[below][above][priority];
                    removeZIndexRelation(ZArea.areaMap[below],
                                         ZArea.areaMap[above], zrel.rel.id);
                    this.changes = true;
                    this.removeDependentRelations(zrel.rel.getId());
                    if (this.zRelations.removeRel(zrel.rel, true)) {
                        retest = true;
                    }
                    this.tempStore.push({above: above, below: below,
                                         count: zrel.count, name: zrel.rel.name,
                                         prio: zrel.rel.priority,
                                         userInfo: zrel.rel.userInfo});
                }
            }
        }
    }
    if (retest) {
        this.zRelations.retestSuspended();
    }
}

ZIndex.prototype.reassertRelations = zIndexReassertRelations;
function zIndexReassertRelations() {
    var i, above, below, prio, count, rel;

    for (i = 0; i !== this.tempStore.length; i++) {
        above = this.tempStore[i].above;
        below = this.tempStore[i].below;
        count = this.tempStore[i].count;
        prio = this.tempStore[i].prio;
        rel = this.createRelation(below, above, prio, this.tempStore[i].name);
        rel.userInfo = this.tempStore[i].userInfo;
        this.relations[below][above][prio] = {count: count, rel: rel};
        if (this.zRelations.addRel(rel)) {
            this.changes = true;
        }
        var area1 = ZArea.areaMap[below];
        var area2 = ZArea.areaMap[above];
        if (area1 && area2) { // no need to check when one is a label
            if (this.checkLceUpward(area1, area2, rel)) {
                this.changes = true;
            }
        }
    }
    this.tempStore = undefined;
}

function debugZRelations(areaId) {
    var below, above, prio, i, rel, edgeRS, re;

    function areaNameList(ui) {
        var str;

        for (var areaId in ui) {
            for (var cName in ui[areaId]) {
                if (str) {
                    str += ", " + areaId + ":" + cName;
                } else {
                    str = areaId + ":" + cName;
                }
            }
        }
        return str? str: "system";
    }

    function relInfo(rel) {
        var str = rel.below + " < " +  rel.above +
              " set by " + areaNameList(rel.userInfo);

        if (!rel.getRelationSet().getActive()) {
            if (rel.getRelationSet().suspendedBecauseOf) {
                str += " with priority " + rel.priority + ", suspended by " +
                      rel.getRelationSet().suspendedBecauseOf.
                      filter(
                          function(suspRel) {
                              return suspRel.isActive() &&
                                    suspRel.priority >= rel.priority;
                          }
                      ).map(
                          function(suspRel){
                              return suspRel.below + " < " +  suspRel.above +
                                    " set by " + areaNameList(suspRel.userInfo) +
                                    " with priority " + suspRel.priority;
                          }
                      ).join(" and ");
            } else {
                str += ", removed";
            }
        }
        return str;
    }

    if (areaId !== undefined) {
        re = new RegExp("(^a_" + areaId + "( top)?)$|(^l_" + areaId + "_)");
    }
    for (below in gZIndex.relations) {
        for (above in gZIndex.relations[below]) {
            for (prio in gZIndex.relations[below][above]) {
                if (areaId === undefined || re.test(below) || re.test(above)) {
                    rel = gZIndex.relations[below][above][prio];
                    console.log(relInfo(rel.rel));
                }
            }
        }
    }
    for (i = 0; i !== gZIndex.zRelations.suspended.length; i++) {
        edgeRS = gZIndex.zRelations.suspended[i];
        if (!edgeRS.isEmpty() &&
              (areaId === undefined || re.test(edgeRS.maxPrioRel.above) ||
               re.test(edgeRS.maxPrioRel.below))) {
            console.log(relInfo(edgeRS.getMaxPriorityRelation()));
        }
    }
}

function traceStacking(areaId, label) {
    var start = label === undefined? "a_" + areaId: "l_" + areaId + "_" + label;

    function traceChain(id, indent, dir, areaIndent) {
        var vertex = gZIndex.zRelations.vertices[id];
        var zArea = ZArea.areaMap[id];
        var area = zArea && zArea.area;
        var embedding = zArea && zArea.parent;
        var str = area instanceof AreaSetStackable? id.slice(2) + "S": id.slice(2);
        var nIndent = indent + str.replace(/./g, " ");
        var out = vertex === undefined || vertex[dir] === undefined? []:
              Object.keys(vertex[dir]);

        if (id in areaIndent) {
            if (out.length !== 0) {
                str += "*";
            }
            if (indent.length < areaIndent[id].length) {
                str = areaIndent[id].slice(indent.length).
                      replace(/  /g, (dir === "below"? "> ": "< ")) + str;
            }
        } else {
            var defEmb = undefined;
            var sortDir = dir === "below"? -1: 1;
            areaIndent[id] = indent.replace(/\|/g, " ");
            if (embedding !== undefined &&
                  (vertex === undefined || vertex[dir] === undefined ||
                   !(embedding.id in vertex[dir]))) {
                // add the embedding element if this area has no z-relations,
                // since that controls the default embedding, both when going
                // up and down.
                defEmb = embedding.id;
            }
            out.sort(function(a, b) {
                return sortDir * (gZIndex.zRelations.zValues[a] -
                                  gZIndex.zRelations.zValues[b]);
            });
            if (defEmb !== undefined && (out.length === 0 || dir === "below")) {
                out.push(defEmb);
            }
            if (out.length === 0) {
                return str;
            } else {
                for (var i = 0; i !== out.length; i++) {
                    var rel = vertex && vertex[dir] && vertex[dir][out[i]];
                    if (i > 0) {
                        str += "\n" + nIndent;
                    }
                    if (rel === undefined) {
                        str += " : " + // the symbol for embedding
                              traceChain(out[i],
                                         nIndent + (i < out.length - 1? " | ": "   "),
                                         dir, areaIndent);
                    } else if (rel.relationSet !== undefined &&
                               rel.relationSet.active !== undefined) {
                        str += (dir === "below"? " > ": " < ") +
                              traceChain(out[i],
                                         nIndent + (i < out.length - 1? " | ": "   "),
                                         dir, areaIndent);
                    } else {
                        str += " # " + out[i].slice(2);
                    }
                }
            }
        }
        return str;
    }

    return "higher than:\n" + traceChain(start, "", "below", {}) +
          "\n\nlower than:\n" + traceChain(start, "", "above", {});
}
