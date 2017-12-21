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

// ZIndex uses this class as positioning elements, and expects it to set the
// correct z-value on the area it represents.
// Area uses this class as responsible for realizing the "stacking" section
// in its description.

// TODO:
// - monitor LCE

// %%include%%: "zRelationGraph.js"

// Enum for z index. TODO: change to integer values
var ZIndexStatus = Object.freeze({
    none: "none",               // no constraints, follows default HTML rules
    copy: "copy",               // z-index is copy of a parent
    independent: "independent", // has its own z-index
    mark: "mark"                // has to be updated
});

function ZArea(id, area) {
    this.id = id; // id by which this object is known in ZIndex,
                  // and the name as its edge in ZRelationGraph
    this.area = area; // the area whose z-index it controls
    this.areaId = area.areaId;
    this.children = {}; // list of children by id
    this.parent = undefined; // parent ZArea; maintained by ZIndex
    this.zIndexStatus = ZIndexStatus.none; // z-index status of this area
    this.zIndex = ""; // the actual z-index
    this.pathsToIndependentDescendants = undefined;
    this.lowestIndependentAncestor = undefined;
    this.embeddingRelationTop = undefined;
    this.embeddingRelationBottom = undefined;
    this.nrRelations = 0; // number of (external) relations on this area
    this.topRelation = undefined;
    this.constraints = {}; // maps attribute names on ZConstraints
    this.refCount = 0;
}

ZArea.prototype.destroy = zAreaDestroy;
function zAreaDestroy() {
    if (this.topRelation) {
        this.removeTopRelation();
    }
    for (var name in this.constraints) {
        this.removeConstraint(name);
    }
    if (this.nrRelations !== 0) {
        var ap = this.getAncestorPath();
        if (ap) {
            var independentAncestor = ap.ancestor;
            var path = ap.path;
            deleteAssociationPath(
                independentAncestor.pathsToIndependentDescendants, path);
            this.setLowestIndependentAncestor(undefined);
        }
    }
    this.nrRelations = 0;
    this.constraints = {};
    this.pathsToIndependentDescendants = undefined;
    this.lowestIndependentAncestor = undefined;
    this.embeddingRelationTop = undefined;
    this.embeddingRelationBottom = undefined;
}

// Maps z-area ids onto z-areas
ZArea.areaMap = {};

ZArea.get = zAreaGet;
function zAreaGet(area) {
    var zId = "a_" + area.areaId;
    var zArea;

    if (!(zId in ZArea.areaMap)) {
        ZArea.areaMap[zId] = zArea = new ZArea(zId, area);
    } else {
        zArea = ZArea.areaMap[zId];
        assert(zArea.area === undefined, "not released?");
        zArea.area = area;
    }
    zArea.refCount++;
    return ZArea.areaMap[zId];
}

ZArea.release = zAreaRelease;
function zAreaRelease(zArea) {
    assert(zArea.refCount > 0, "releaseZArea called too often");
    zArea.refCount--;
    if (zArea.refCount === 0) {
        zArea.destroy();
        delete ZArea.areaMap[zArea.id];
    }
}

ZArea.prototype.clear = zAreaClear;
function zAreaClear() {
    for (var name in this.constraints) {
        this.removeConstraint(name);
    }
    if (this.setRepresentative) {
        this.setRepresentative.area.setMemberDestruction(this.area);
    }
    if (this.parent) {
        this.parent.removeChild(this);
        this.parent = undefined;
    }
    this.area = undefined;
}

ZArea.prototype.dump = zAreaDump;
function zAreaDump(offset) {
    if (offset === undefined) offset = "";
    console.log(offset, this.id, this.zIndex, this.zIndexStatus);
    for (var ch in this.children) {
        this.children[ch].dump(offset + "  ");
    }
}

// The following functions are used by ZIndex

ZArea.prototype.isEmbeddedIn = zAreaIsEmbeddedIn;
function zAreaIsEmbeddedIn(zArea) {
    var c = this;

    while (c) {
        if (c === zArea) {
            return true;
        }
        c = c.parent;
    }
    return false;
}

// Adds a new area. If there are no constraints on this area,
// it receives the settings of the parent.
ZArea.prototype.addChild = zAreaAddChild;
function zAreaAddChild(childZArea) {
    this.children[childZArea.id] = childZArea;
    if (childZArea.zIndexStatus === ZIndexStatus.none) {
        if (childZArea.hasAncestorPath()) {
            var ap = childZArea.getAncestorPath();
            var independentAncestor = ap.ancestor;
            var path = ap.path;
            var indepDescFromParent = getAssociationPath(
                independentAncestor.pathsToIndependentDescendants,
                path.slice(0, -1));
            if (indepDescFromParent !== undefined) {
                childZArea.zIndex = independentAncestor.zIndex;
                childZArea.zIndexStatus = ZIndexStatus.copy;
                childZArea.area.setZIndex(childZArea.zIndex, "");
            } else if (this.zIndexStatus === ZIndexStatus.copy) {
                childZArea.clearZIndex(this.zIndex, ZIndexStatus.copy);
            }
        }
    } else {
        childZArea.area.setZIndex(childZArea.zIndex, "");
    }
}

ZArea.prototype.removeChild = zAreaRemoveChild;
function zAreaRemoveChild(childZArea) {
    delete this.children[childZArea.id];
}

ZArea.prototype.getEmbeddingDepth = zAreaGetEmbeddingDepth;
function zAreaGetEmbeddingDepth() {
    var depth = 0;
    var ptr = this.parent;

    while (ptr !== undefined) {
        ptr = ptr.parent;
        depth++;
    }
    return depth;
}

ZArea.prototype.getFrameDiv = zAreaGetFrameDiv;
function zAreaGetFrameDiv() {
    return this.area !== undefined? this.area.getFrameDiv(): undefined;
}

ZArea.prototype.getZ = zAreaGetZ;
function zAreaGetZ() {
    return this.zIndex === ""? 0: this.zIndex;
}


// The set representative is the indication that this child should not be
// updated along the normal way.
ZArea.prototype.setSetRepresentative = ZAreaSetSetRepresentative;
function ZAreaSetSetRepresentative(setRepr, constraintName) {
    this.setRepresentative = setRepr;
    if (!Utilities.isEmptyObj(setRepr.constraints)) {
        console.log("warning: mixed areaSet relations: @" + this.areaId,
                    "individual:",
                    Object.keys(this.setRepresentative.constraints).join(","),
                    "set:", constraintName);
    }
}

ZArea.prototype.removeSetRepresentative = ZAreaRemoveSetRepresentative;
function ZAreaRemoveSetRepresentative() {
    delete this.setRepresentative;
}

// Returns an associative structure with all paths to independent areas
// or undefined if there isn't one
ZArea.prototype.collectIndependentDescendants =
      zAreaCollectIndependentDescendants;
function zAreaCollectIndependentDescendants(lowestIndependentAncestor) {
    var paths = undefined, subPaths;

    for (var childName in this.children) {
        var child = this.children[childName];
        if (child.nrRelations !== 0) {
            subPaths = child;
            child.setLowestIndependentAncestor(lowestIndependentAncestor);
        } else {
            subPaths =
                 child.collectIndependentDescendants(lowestIndependentAncestor);
        }
        if (subPaths !== undefined) {
            if (paths === undefined) {
                paths = {};
            }
            paths[childName] = subPaths;
        }
    }
    return paths;
};

ZArea.prototype.findChildName = zAreaFindChildName;
function zAreaFindChildName(child) {
    for (var childName in this.children) {
        if (this.children[childName] === child) {
            return childName;
        }
    }
    assert(false, "there shouldn't be orphans");
    return undefined;
};

// Returns true when one of the decendants is independent, i.e. has a
// relation
ZArea.prototype.hasIndependentDescendants = zAreaHasIndependentDescendants;
function zAreaHasIndependentDescendants() {
    return this.pathsToIndependentDescendants !== undefined &&
           !isEmptyObj(this.pathsToIndependentDescendants);
};

// Returns lowest independent ancestor looking up in the embedding chain from
// this, the first direct child of that ancestor on the path to this, and the
// path towards area, if there is an ancestor of the area with an independent
// z-index. If there is none, it returns undefined.
ZArea.prototype.hasAncestorPath = zAreaHasAncestorPath;
function zAreaHasAncestorPath() {
    var parent = this.parent;

    while (parent && parent.nrRelations === 0) {
        parent = parent.parent;
    }
    return parent !== undefined;
};

// Returns lowest independent ancestor looking up in the embedding chain from
// this, the first direct child of that ancestor on the path to this, and the
// path towards area, if there is an ancestor of the area with an independent
// z-index. If there is none, it returns undefined.
ZArea.prototype.getAncestorPath = zAreaGetAncestorPath;
function zAreaGetAncestorPath() {
    var child = this;
    var parent = child.parent;
    var path = [];

    while (parent) {
        path.push(parent.findChildName(child));
        if (parent.nrRelations !== 0) {
            return {ancestor: parent, child: child, path: path.reverse()};
        }
        child = parent;
        parent = parent.parent;
    }
    return undefined;
};

// Takes away the z-index that were dependent on area
ZArea.prototype.clearZIndex = zAreaClearZIndex;
function zAreaClearZIndex(z, zIndexStatus) {
    this.zIndex = z;
    this.zIndexStatus = zIndexStatus;
    if (this.area !== undefined) {
        this.area.setZIndex(z, "");
    }
    for (var childName in this.children) {
        var child = this.children[childName];
        if (child.nrRelations === 0 && child.setRepresentative === undefined) {
            child.clearZIndex("", ZIndexStatus.none);
        }
    }
};

ZArea.prototype.markPath = zAreaMarkPath;
function zAreaMarkPath(path) {
    var descendant = this;

    for (var i = 0; i !== path.length; i++) {
        descendant = descendant.children[path[i]];
        descendant.zIndexStatus = ZIndexStatus.mark;
    }
};

ZArea.prototype.embeddedIn = zAreaEmbeddedIn;
function zAreaEmbeddedIn(area) {
    var ancestor = this;

    while (ancestor) {
        if (ancestor === area) {
            return true;
        }
        ancestor = ancestor.parent;
    }
    return false;
};

ZArea.prototype.setTopRelation = zAreaSetTopRelation;
function zAreaSetTopRelation() {
    assert(this.topRelation === undefined);
    this.topRelation = new ZRelation(this.id, this.id + " top",
                                     gZIndex.highestUserPriority + 1, false,
                                     "automatic top", {});
    this.topRelation.userInfo[this.areaId] = { "automatic top": true };
    return gZIndex.zRelations.addRel(this.topRelation);
};

ZArea.prototype.addRelation = zAreaAddRelation;
function zAreaAddRelation(relId, constraintName) {
    var changes = false;

    if (this.setRepresentative) {
        console.log("warning: mixed areaSet relations: @" + this.areaId,
                    "individual:", constraintName, "set:",
                    Object.keys(this.setRepresentative.constraints).join(","));
    }
    this.nrRelations++;
    if (this.nrRelations === 1) {
        this.zIndexStatus = ZIndexStatus.independent;
        if (this.propagateUp()) {
            changes = true;
        }
        this.pathsToIndependentDescendants =
              this.collectIndependentDescendants(this);
        if (this.setTopRelation()) {
            changes = true;
        }
    }
    return changes;
};

ZArea.prototype.removeTopRelation = zAreaRemoveTopRelation;
function zAreaRemoveTopRelation() {
    assert(this.topRelation !== undefined);
    gZIndex.zRelations.removeRel(this.topRelation);
    this.topRelation = undefined;
};

ZArea.prototype.removeRelation = zAreaRemoveRelation;
function zAreaRemoveRelation(relId) {
    // assert(relId in this.relations, "relation should be present");
    // delete this.relations[relId];
    assert(this.nrRelations > 0, "too many calls to removeRelation");
    this.nrRelations--;
    if (this.nrRelations === 0) {
        if (this.zIndexStatus === ZIndexStatus.independent) {
            // avoid changing "mark" to "none"
            this.zIndexStatus = ZIndexStatus.none;
        }
        this.stopPropagateUp();
        this.removeTopRelation();
    }
};

// Seeks independent ancestor and attaches this as an independent descendant.
// If this was the first independent one, all children need updating,
// otherwise only the path to this area. This also triggers the creation of
// a relation between this area and bottom and top of the ancestor.
// Returns true when independent descendants were known
ZArea.prototype.propagateUp = zAreaPropagateUp;
function zAreaPropagateUp() {
    var ap = this.getAncestorPath();

    if (ap === undefined) {
        return false;
    }
    var indepAncestor = ap.ancestor;
    var child = ap.child;
    var path = ap.path;
    var indepAncestorAlreadyHadIndependentDescendants =
          indepAncestor.hasIndependentDescendants();
    if (indepAncestor.pathsToIndependentDescendants === undefined) {
        indepAncestor.pathsToIndependentDescendants = {};
    }
    // split path between independent ancestor and this
    this.pathsToIndependentDescendants =
          getAssociationPath(indepAncestor.pathsToIndependentDescendants, path);
    addAssociationPath(indepAncestor.pathsToIndependentDescendants, path, this);
    this.setLowestIndependentAncestor(indepAncestor);
    if (indepAncestorAlreadyHadIndependentDescendants) {
        // siblings already have copy of z-index, only need to copy it down here
        child.copyZIndexToDescendants(indepAncestor.zIndex, ZIndexStatus.copy,
                          indepAncestor.pathsToIndependentDescendants[path[0]]);
        this.updateLowestIndependentAncestor(this,
                                            this.pathsToIndependentDescendants);
    } else {
        indepAncestor.copyZIndexToDescendants(
            indepAncestor.zIndex, ZIndexStatus.independent,
            indepAncestor.pathsToIndependentDescendants);
    }
    return true;
}

// Removes the independent status of this area in the independent ancestor,
// as well as the relation between this area and the ancestor
ZArea.prototype.stopPropagateUp = zAreaStopPropagateUp;
function zAreaStopPropagateUp() {
    var ap = this.getAncestorPath();

    if (!ap) {
        // we're in a z-index free part of the hierarchy
        this.clearZIndex("", ZIndexStatus.none);
    } else {
        var indepAncestor = ap.ancestor;
        var child = ap.child;
        var path = ap.path;
        if (this.hasIndependentDescendants()) {
            // nothing changes for higher siblings, but things do change
            // for area and its dependent descendants: they are merged
            // below indepAncestor
            var paths = this.pathsToIndependentDescendants;
            this.updateLowestIndependentAncestor(indepAncestor, paths);
            this.pathsToIndependentDescendants = undefined;
            if (indepAncestor.pathsToIndependentDescendants === undefined) {
                indepAncestor.pathsToIndependentDescendants = {};
            }
            addAssociationPath(indepAncestor.pathsToIndependentDescendants,
                               path, paths);
            this.copyZIndexToDescendants(indepAncestor.zIndex,
                                         ZIndexStatus.copy, paths);
        } else {
            deleteAssociationPath(indepAncestor.pathsToIndependentDescendants,
                                  path);
        }
        indepAncestor.markPath(path);
        indepAncestor.copyZIndexToDescendants(
            indepAncestor.zIndex, ZIndexStatus.independent,
            indepAncestor.pathsToIndependentDescendants);
    }
    this.setLowestIndependentAncestor(undefined);
}

// Sets the lowest independent ancestor of this area, and updates its
// embedding relations accordingly. If this area is D, and A is the ancestor,
// it adds A < D and D(top) < A(top). These low priority relations make D stay
// in the hierarchical "box". They can however be overridden easily when
// an explicit relation causes a cycle.
// Returns true when there was a change in the z-relations.
ZArea.prototype.setLowestIndependentAncestor =
      zAreaSetLowestIndependentAncestor;
function zAreaSetLowestIndependentAncestor(area) {
    var changes = false;

    if (area !== this.lowestIndependentAncestor) {
        if (this.embeddingRelationTop) {
            gZIndex.zRelations.removeRel(this.embeddingRelationTop);
            this.embeddingRelationTop = undefined;
            gZIndex.zRelations.removeRel(this.embeddingRelationBottom);
            this.embeddingRelationBottom = undefined;
            changes = true;
        }
        this.lowestIndependentAncestor = area;
        if (area) {
            this.embeddingRelationTop = new ZRelation(this.id + " top",
                        area.id + " top", gZIndex.lowestUserPriority - 2, false,
                        "automatic embedding top", {});
            this.embeddingRelationTop.userInfo[this.areaId] = {
                "automatic embedding top": true
            };
            if (gZIndex.zRelations.addRel(this.embeddingRelationTop)) {
                changes = true;
            }
            this.embeddingRelationBottom = new ZRelation(area.id, this.id,
                                           gZIndex.lowestUserPriority - 1, true,
                                           "automatic embedding bottom", {});
            this.embeddingRelationBottom.userInfo[this.areaId] = {
                " automatic embedding bottom": true
            };
            if (gZIndex.zRelations.addRel(this.embeddingRelationBottom)) {
                changes = true;
            }
        }
    }
    return changes;
};

ZArea.prototype.updateLowestIndependentAncestor =
      zAreaUpdateLowestIndependentAncestor;
function zAreaUpdateLowestIndependentAncestor(area, paths) {
    if (paths instanceof ZArea) {
        paths.setLowestIndependentAncestor(area);
    } else {
        for (var childName in paths) {
            if (childName in this.children) {
                this.children[childName].updateLowestIndependentAncestor(area,
                                                              paths[childName]);
            }
        }
    }
}

// Puts the z-index on area if it doesn't have independent descendants,
// or removes it from area and copies it to its display and then to the
// descendants, with exception of those in the independent paths
ZArea.prototype.copyZIndexToDescendants = zAreaCopyZIndexToDescendants;
function zAreaCopyZIndexToDescendants(z, zIndexStatus, paths) {
    this.zIndex = z;
    this.zIndexStatus = zIndexStatus;
    if (paths === undefined || isEmptyObj(paths)) {
        this.clearZIndex(z, zIndexStatus);
    } else {
        if (this.area !== undefined) {
            this.area.setZIndex("", z);
        }
        for (var childName in this.children) {
            var child = this.children[childName];
            if (child.nrRelations === 0 && child.setRepresentative === undefined) {
                // note: this includes ZIndexStatus.mark, which gets overwritten
                child.copyZIndexToDescendants(z, ZIndexStatus.copy,
                                              paths[childName]);
            }
        }
    }
}

// The following functions maintain the constraints

ZArea.prototype.configurationUpdate = zAreaConfigurationUpdate;
function zAreaConfigurationUpdate(configuration, changeSet) {
    if (!changeSet.incremental) {
        // treat this as a completely new set of constraints
        this.newDescription(configuration);
    } else {
        for (var name in changeSet.removed()) {
            this.removeConstraint(name);
        }
        for (name in changeSet.added()) {
            this.addConstraint(name, configuration[name]);
            this.constraints[name].update(this.areaId, name);
        }
        for (name in changeSet.modified()) {
            // We use addNewConstraint for modified constraints too, since we
            // don't want to analyze the precise nature of the differences, and
            // the PosConstraintManager does a decent job of only applying
            // changes anyway.
            this.addConstraint(name, configuration[name]);
            this.constraints[name].update(this.areaId, name);
        }
    }
}

ZArea.prototype.updateConstraint = ZAreaUpdateConstraint;
function ZAreaUpdateConstraint(name, areaId) {
    this.constraints[name].update(areaId, name);
}

ZArea.prototype.newDescription = zAreaNewDescription;
function zAreaNewDescription(config) {
    for (var name in this.constraints) {
        if (!(name in config)) {
            this.constraints[name].unregisterAll(this, name);
            this.removeConstraint(name);
        }
    }
    for (name in config) {
        this.addConstraint(name, config[name]);
        this.constraints[name].update(this.areaId, name);
    }
}

ZArea.prototype.addConstraint = zAreaAddConstraint;
function zAreaAddConstraint(name, descr) {
    var zc;

    if (name in this.constraints) {
        zc = this.constraints[name];
    } else {
        this.constraints[name] = zc = new ZConstraint(this);
    }
    zc.newPriority = ("priority" in descr? descr.priority: 0);
    zc.higher.parseDescr(descr.higher, this, name);
    zc.lower.parseDescr(descr.lower, this, name);
}

ZArea.prototype.removeConstraint = zAreaRemoveConstraint;
function zAreaRemoveConstraint(name) {
    if (name in this.constraints) {
        var zc = this.constraints[name];
        zc.destroy(this.areaId, name);
        delete this.constraints[name];
    }
}

ZArea.prototype.findLce = zAreaFindLce;
function zAreaFindLce(area2, path1, path2) {
    var area1 = this;
    var depth1 = area1.getEmbeddingDepth();
    var depth2 = area2.getEmbeddingDepth();
    
    while (depth1 > depth2) {
        if (path1) path1.push(area1);
        area1 = area1.parent;
        depth1--;
    }
    while (depth2 > depth1) {
        if (path2) path2.push(area2);
        area2 = area2.parent;
        depth2--;
    }
    while (area1 && area2) {
        if (area1 === area2) {
            return area1;
        }
        if (path1) path1.push(area1);
        if (path2) path2.push(area2);
        area1 = area1.parent;
        area2 = area2.parent;
    }
    return undefined;
}

ZArea.prototype.findIndependentAncestor = zAreaFindIndependentAncestor;
function zAreaFindIndependentAncestor() {
    var area = this;

    while (area && area.nrRelations === 0) {
        area = area.parent;
    }
    return area;
}

// Returns a positive number when a is above b, and a negative number
// when a is below b.
//   If a and b get their z-index from the same area, their relative position
// is determined by the order between the daughter nodes of their lce leading
// to them, i.e. if there is a path lce -> a1 -> a2 ... -> a, and similarly
// for b, then the ordering between a1 and b1 determines the order between
// a and b. If either a or b is the lce, then the lce is the lowest area.
//   If a and b get their z-index from a different area, we can just compare
// the z-index values of these areas, except when these values are identical.
// In that case, their relative position is also determined by the path
// leading to the lce. In this case, nor a nor b can be the lce.
ZArea.compare = zAreaCompare;
function zAreaCompare(zArea1, zArea2) {
    function effectiveZIndex(area) {
        return !area || area.zIndex === ""? 0: area.zIndex;
    }

    var aZAssigner = zArea1.findIndependentAncestor();
    var bZAssigner = zArea2.findIndependentAncestor();
    var az, bz;

    if (aZAssigner !== bZAssigner) {
        az = effectiveZIndex(aZAssigner);
        bz = effectiveZIndex(bZAssigner);
        if (az !== bz) {
            return az - bz;
        }
    }

    if (aZAssigner === undefined && zArea1.zIndex !== zArea2.zIndex) {
        return zArea1.zIndex - zArea2.zIndex;
    }

    var pathToArea1 = [], pathToArea2 = [];
    var lce = zArea1.findLce(zArea2, pathToArea1, pathToArea2);
    assert(lce, "there is always area1 common area, the screen area");
    if (lce === zArea1) {
        return -1;
    } else if (lce === zArea2) {
        return 1;
    }
    if (ZArea.divFollows(pathToArea1[pathToArea1.length - 1],
                         pathToArea2[pathToArea2.length - 1])) {
        return -1;
    } else {
        return 1;
    }
}

ZArea.divFollows = zAreaDivFollows;
function zAreaDivFollows(area1, area2) {
    var div1 = area1.getFrameDiv();
    var div2 = area2.getFrameDiv();

    if (div1 === undefined)
        return false;
    if (div2 === undefined)
        return true;
    var sibling = div1.nextElementSibling;
    while (sibling) {
        if (sibling === div2) {
            return true;
        }
        sibling = sibling.nextElementSibling;
    }
    return false;
}

// ZArea constraint administration

// Enum for constraint types. TODO: change to integer values
var ZConstraintType = Object.freeze({
    none: "none",
    areaSet: "area set",
    localLabelSet: "local label set",
    globalLabel: "global label"
});

function ZConstraint(zArea) {
    this.zArea = zArea;
    this.higher = new ZConstraintSection();
    this.lower = new ZConstraintSection();
    this.priority = undefined;
    this.newPriority = 0;
}

ZConstraint.prototype.unregisterAll = zConstraintUnregisterAll;
function zConstraintUnregisterAll(zArea, name) {
    this.higher.unregisterAll(zArea, name, "higher");
    this.lower.unregisterAll(zArea, name, "lower");
}

ZConstraint.prototype.destroy = zConstraintDestroy;
function zConstraintDestroy(areaId, name) {
    debugStartTimer("z-index", "removeall");
    var hc = this.higher.getOld();
    var lc = this.lower.getOld();
    var relations = [], e1, e2;

    this.higher.releaseAreaSetReprs();
    this.lower.releaseAreaSetReprs();
    for (e1 in hc)
        for (e2 in lc)
            if (e1 !== e2)
                relations.push({below: e2, above: e1, priority: this.priority});
    gZIndex.removeAll(relations, areaId, name);
    scheduleGeometryTask();
    debugStopTimer("removeall");
}

ZConstraint.prototype.hasChanged = zConstraintHasChanged;
function zConstraintHasChanged() {
    return this.lower.hasChanged() || this.higher.hasChanged();
}

/* We start with H'=H+Hr and L'=L+Lr (non-overlapping). From that we substract
Hr/Lr and add Ha/Lr, so we end up H"=H+Ha and L"=L+La. The difference between
the cartesian products H' x L' and H" x L" is determined as follows.
  If we had H, added Ha and removed Hr (Ha and Hr not overlapping), and L, La
and Lr, then (H'+Ha-Hr)*(L'+La-Lr) = (H'+Ha-Hr)*L'+(H'+Ha-Hr)*La-(H'+Ha-Hr)*Lr =
H'*L'+Ha*L'-Hr*L'+H'*La+Ha*La-Hr*La-H'*Lr-Ha*Lr.
  Since Hr*La and Lr*Ha were not in the original cartesian product H' x L' and
are not in the new product H" x L" either, going from H'*L' to
(H'+Ha-Hr)*(L'+La-Lr) is done by adding Ha*(L'-Lr), (H'-Hr)*La and Ha*La, and
removing Hr*(L'-Lr), (H'-Hr)*Lr, and Hr*Lr.
  When H and L have a full change, H'=Hr and L'=Lr, and H"=Ha and L"=La, so we
obtain the result faster by removing Hr*Lr and adding Ha*La.
  When H has a full change, but L doesn't, then it suffices to remove Hr*(L'-Lr)
and Hr*Lr and add Ha*(L'-Lr) and Ha*La. When H doesn't have a full change, but L
does, removing (H'-Hr)*Lr and Hr*Lr, and adding (H'-Hr)*La, and Ha*La suffices.
So
add Ha*La always
add Ha*(L'-Lr) when L not full change
add (H'-Hr)*La when H not full change
remove Hr*Lr always
remove Hr*(L'-Lr) when L not full change
remove (H'-Hr)*Lr when H not full change

Note that the code below reconstructs the old set frequently, so it might be
more efficient to just store it. */
// Effectuate changes and reset
ZConstraint.prototype.update = zConstraintUpdate;
function zConstraintUpdate(areaId, name) {
    debugStartTimer("z-index", "zconstraint update");
    var priorityChanged = this.newPriority !== undefined &&
                          this.newPriority !== this.priority;
    var hd = this.higher.getDiff(priorityChanged, name); // Diff set for higher elements
    var ld = this.lower.getDiff(priorityChanged, name); // Diff set for lower elements
    var hOrig, lOrig; // Original higher and lower element set
    var relations = [], e1, e2;

    // remove hd.removed*ld.removed always
    for (e1 in hd.removed)
        for (e2 in ld.removed)
            if (e1 !== e2)
                relations.push({below: e2, above: e1, priority: this.priority});
    // remove hd.removed*(lOrig-ld.removed) when L not full change
    if (!ld.fullReplace)
        for (e1 in hd.removed) {
            if (!lOrig) {
                lOrig = this.lower.getOld();
            }
            for (e2 in lOrig)
                if (!(e2 in ld.removed) && e1 !== e2)
                    relations.push({below: e2, above: e1, priority: this.priority});
        }
    // remove (hOrig-hd.removed)*ld.removed when H not full change
    if (!hd.fullReplace) {
        if (!hOrig) {
            hOrig = this.higher.getOld();
        }
        for (e1 in hOrig)
            if (!(e1 in hd.removed))
                for (e2 in ld.removed)
                    if (e1 !== e2)
                        relations.push({below: e2, above: e1, priority: this.priority});
    }
    if (relations.length !== 0) {
        gZIndex.removeAll(relations, areaId, name);
        relations = [];
    }
    if (this.newPriority !== undefined) {
        this.priority = this.newPriority;
        this.newPriority = undefined;
    }
    // add Ha*La always
    for (e1 in hd.added)
        for (e2 in ld.added)
            if (e1 !== e2)
                relations.push({below: e2, above: e1, priority: this.priority});
    // add hd.added*(lOrig-ld.removed) when L not full change
    if (!ld.fullReplace)
        for (e1 in hd.added) {
            if (!lOrig) {
                lOrig = this.lower.getOld();
            }
            for (e2 in lOrig)
                if (!(e2 in ld.removed) && e1 !== e2)
                    relations.push({below: e2, above: e1, priority: this.priority});
        }
    // add (hOrig-hd.removed)*ld.added when H not full change
    if (!hd.fullReplace) {
        if (!hOrig) {
            hOrig = this.higher.getOld();
        }
        for (e1 in hOrig)
            if (!(e1 in hd.removed))
                for (e2 in ld.added)
                    if (e1 !== e2)
                        relations.push({below: e2, above: e1, priority: this.priority});
    }
    gZIndex.addAll(relations, areaId, name);

    this.higher.reset();
    this.lower.reset();
    debugStopTimer("zconstraint update");

    scheduleGeometryTask();
}

function ZConstraintSection() {
    this.type = ZConstraintType.none;
    this.label = undefined;
    this.newType = undefined;
    this.newLabel = undefined;
    this.areaSet = false;
    this.newAreaSet = undefined; // note that absence means false
    this.areas = undefined;
    this.areaSetReprs = undefined;
    this.newAreaSetReprs = undefined;
    this.added = undefined;
    this.removed = undefined;
    this.areaPath = undefined;
}

ZConstraintSection.prototype.parseDescr = zConstraintSectionParseDescr;
function zConstraintSectionParseDescr(descr, zArea, name) {
    var elements;

    for (var aid in this.areas) {
        this.removeArea(aid);
    }
    if (descr instanceof Array && descr.length === 1) {
        descr = descr[0];
    }
    if (descr === undefined) {
        this.newType = ZConstraintType.none;
    } else if (descr instanceof Array) {
        this.newType = ZConstraintType.areaSet;
        elements = descr;
    } else if (descr instanceof ElementReference) {
        this.newType = ZConstraintType.areaSet;
        elements = descr;
    } else if (descr instanceof Object) {
        if ("label" in descr && descr.label !== undefined) {
            this.newType = ZConstraintType.localLabelSet;
            this.newLabel = descr.label;
            if (this.newLabel instanceof Array && this.newLabel.length === 1) {
                this.newLabel = this.newLabel[0];
            }
        } else {
            this.newType = ZConstraintType.areaSet;
        }
        if ("element" in descr) {
            elements = descr.element;
        } else {
            elements = zArea.area.areaReference; // no element <=> element: [me]
        }
        if ("areaSet" in descr) {
            this.newAreaSet = descr.areaSet;
        }
    } else if (typeof(descr) === "string") {
        this.newType = ZConstraintType.globalLabel;
        this.newLabel = descr;
    } else {
        this.newType = ZConstraintType.none;
    }
    if (elements instanceof Array) {
        for (var i = 0; i !== elements.length; i++) {
            assert(elements[i] instanceof ElementReference);
            this.addArea(elements[i].getElement());
        }
    } else if (elements instanceof ElementReference) {
        this.addArea(elements.getElement());
    }
}

ZConstraintSection.prototype.addArea = zConstraintSectionAddArea;
function zConstraintSectionAddArea(aid) {
    if (!this.areas) {
        this.areas = {};
    }
    if (aid in this.areas) {
        this.areas[aid]++;
    } else {
        this.areas[aid] = 1;
        if (this.removed && aid in this.removed) {
            delete this.removed[aid];
        } else {
            if (!this.added) {
                this.added = {};
            }
            this.added[aid] = 1;
        }
    }
}

ZConstraintSection.prototype.hasChanged = zConstraintSectionHasChanged;
function zConstraintSectionHasChanged() {
    return this.newType !== this.type || this.newLabel !== this.label ||
          !!this.areaSet !== !!this.newAreaSet || this.added || this.removed;
}

ZConstraintSection.prototype.removeArea = zConstraintSectionRemoveArea;
function zConstraintSectionRemoveArea(aid) {
    assert(this.areas && aid in this.areas && this.areas[aid] >= 0, "area count");
    this.areas[aid]--;
    if (this.areas[aid] === 0) {
        delete this.areas[aid];
        if (this.added && aid in this.added) {
            delete this.added[aid];
        } else {
            if (!this.removed) {
                this.removed = {};
            }
            this.removed[aid] = 1;
        }
    }
}

ZConstraintSection.prototype.getDiff = zConstraintSectionGetDiff;
function zConstraintSectionGetDiff(forceFullReplace, constraintName) {
    if (!forceFullReplace &&
        (this.newType === this.type && this.newLabel === this.label &&
         !!this.newAreaSet === !!this.areaSet)) {
        // no force, same type, label and areaSet, so comparable representations
        return {
            added: this.getChanges(this.added, true, constraintName),
            removed: this.getChanges(this.removed, false, constraintName),
            fullReplace: false
        };
    } else {
        // different types and/or labels, so everything changes
        return {
            added: this.getNew(constraintName),
            removed: this.getOld(),
            fullReplace: true // the new set is this.added
        };
    }
}

ZConstraintSection.prototype.getNew = zConstraintSectionGetNew;
function zConstraintSectionGetNew(constraintName) {
    var set = {}, label, aid;
    var type = (this.newType === undefined? this.type: this.newType);

    switch (type) {
      case ZConstraintType.none:
       break;
      case ZConstraintType.areaSet:
        if (this.newAreaSet) {
            if (this.newAreaSetReprs === undefined) {
                this.newAreaSetReprs = {};
            }
            for (aid in this.areas) {
                var setRepr = allAreaMonitor.getAreaById(aid).makeAreaSetRepr(constraintName);
                set["a_" + setRepr.areaId] = true;
                this.newAreaSetReprs[aid] = setRepr.areaId;
            }
        } else {
            for (aid in this.areas) {
                set["a_" + aid] = true;
            }
        }
        break;
      case ZConstraintType.localLabelSet:
        label = (this.newLabel === undefined? this.label: this.newLabel);
        if (this.newAreaSet) {
            if (this.newAreaSetReprs === undefined) {
                this.newAreaSetReprs = {};
            }
            for (aid in this.areas) {
                var setRepr = allAreaMonitor.getAreaById(aid).makeAreaSetRepr();
                set["l_" + setRepr.areaId + "_" + label] = true;
                this.newAreaSetReprs[aid] = setRepr.areaId;
            }
        } else {
            for (aid in this.areas) {
                set["l_" + aid + "_" + label] = true;
            }
        }
        break;
      case ZConstraintType.globalLabel:
        label = (this.newLabel === undefined? this.label: this.newLabel);
        set["g_" + label] = true;
        break;
    }
    return set;
}

ZConstraintSection.prototype.getOld = zConstraintSectionGetOld;
function zConstraintSectionGetOld() {
    var set = {}, aid, said;
    var type = this.type;

    switch (type) {
      case ZConstraintType.none:
        break;
      case ZConstraintType.areaSet:
        for (aid in this.areas) {
            said = this.areaSet? this.areaSetReprs[aid]: aid;
            if (!this.added || !(said in this.added)) {
                set["a_" + said] = true;
            }
        }
        for (aid in this.removed) {
            said = this.areaSet? this.areaSetReprs[aid]: aid;
            set["a_" + said] = true;
        }
        break;
      case ZConstraintType.localLabelSet:
        for (aid in this.areas) {
            if (!this.added || !(aid in this.added)) {
                said = this.areaSet? this.areaSetReprs[aid]: aid;
                set["l_" + said + "_" + this.label] = true;
            }
        }
        for (aid in this.removed) {
            said = this.areaSet? this.areaSetReprs[aid]: aid;
            set["l_" + said + "_" + this.label] = true;
        }
        break;
      case ZConstraintType.globalLabel:
        set["g_" + this.label] = true;
        break;
    }
    return set;
}

// Only gets called when the type and label haven't changed
ZConstraintSection.prototype.getChanges = zConstraintSectionGetChanges;
function zConstraintSectionGetChanges(diffSet, add, constraintName) {
    var set = {}, label, aid, setRepr, setReprId;

    switch (this.type) {
      case ZConstraintType.none:
        break;
      case ZConstraintType.areaSet:
        if (this.areaSet) {
            if (add & this.newAreaSetReprs === undefined) {
                this.newAreaSetReprs = {};
            }
            for (aid in diffSet) {
                if (add &&
                      (area = allAreaMonitor.getAreaById(aid)) !== undefined) {
                    setRepr = allAreaMonitor.getAreaById(aid).makeAreaSetRepr(constraintName);
                    setReprId = setRepr.areaId;
                } else {
                    setReprId = this.areaSetReprs[aid];
                }
                set["a_" + setReprId] = true;
                if (add) {
                    this.newAreaSetReprs[aid] = setReprId;
                }
            }
        } else {
            for (aid in diffSet) {
                set["a_" + aid ] = true;
            }
        }
        break;
      case ZConstraintType.localLabelSet:
        label = this.label;
        if (this.areaSet) {
            if (add && this.newAreaSetReprs === undefined) {
                this.newAreaSetReprs = {};
            }
            for (aid in diffSet) {
                if (add &&
                      (area = allAreaMonitor.getAreaById(aid)) !== undefined) {
                    setRepr = area.makeAreaSetRepr(constraintName);
                    setReprId = setRepr.areaId;
                } else {
                    setReprId = this.areaSetReprs[aid];
                }
                set["l_" + setReprId + "_" + label] = true;
                if (add) {
                    this.newAreaSetReprs[aid] = setReprId;
                }
            }
        } else {
            for (aid in diffSet) {
                set["l_" + aid + "_" + label] = true;
            }
        }
        break;
      case ZConstraintType.globalLabel:
        label = (this.newLabel === undefined? this.label: this.newLabel);
        set["g_" + label] = true;
        break;
    }
    return set;
}

ZConstraintSection.prototype.reset = zConstraintSectionReset;
function zConstraintSectionReset() {
    this.type = this.newType;
    this.newType = undefined;
    this.label = this.newLabel;
    this.newLabel = undefined;
    this.added = undefined;
    this.removed = undefined;
    this.releaseAreaSetReprs();
}

ZConstraintSection.prototype.releaseAreaSetReprs =
      zConstraintSectionReleaseAreaSetReprs;
function zConstraintSectionReleaseAreaSetReprs() {
    for (var aid in this.areaSetReprs) {
        var area = allAreaMonitor.getAreaById(aid);
        if (area !== undefined) {
            // Can area have been destroyed and reconstructed in the mean time?
            area.removeAreaSetRepr();
        }
    }
    this.areaSetReprs = this.newAreaSetReprs;
    this.newAreaSetReprs = undefined;
}
