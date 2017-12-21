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

/**
 * Gets the "pointer propagation in area" information for the current mouse
 * position
 * 
 * @param {boolean} forceEvaluation 
 * @returns {any[]} most recent list of ppia info from the event queue
 */
function debugPPIAInfo(forceEvaluation) {
    var ppiaInfo = EventQueue.debugPPIAInfo.map(shallowCopy);

    if (forceEvaluation === undefined) {
        forceEvaluation = globalTaskQueue.pendingTasks.isEmpty();
        if (!forceEvaluation) {
            console.warn("not forcing evaluation of inactive expressions");
        }
    }

    resetDebugObjCache();
    gDebugObjMgr.init();

    for (var i = 0; i < ppiaInfo.length; i++) {
        if (allAreaMonitor.getAreaById(ppiaInfo[i].areaId) !== undefined) {
            ppiaInfo[i].A_ = gDebugObjMgr.getArea(ppiaInfo[i].areaId, forceEvaluation);
        }
    }
    return ppiaInfo;
}

var DebugObj_isDebuggingAreaUnderMouse = false;
var gDebugObjMgr;
var debugObjCache;

function initDebugObjCache() {
    debugObjCache = true;
    gDebugObjMgr.initCache();
}

function resetDebugObjCache() {
    gDebugObjMgr.resetCache();
}

function initDebugObjMgr() {
    gDebugObjMgr = new DebugObjMgr();
}

function DebugObjMgr() {
    this.embeddingDepth = 0;
    this.syncCount = 0;
}

DebugObjMgr.nViolationMessages = 10;

// --------------------------------------------------------------------------
// init
//
DebugObjMgr.prototype.init = function() {
    this.drawFrame(false);
    this.initCache();
    this.embeddingDepth = 0;
}

// --------------------------------------------------------------------------
// initCache
//
DebugObjMgr.prototype.initCache = function() {
    if (typeof(this.allDebugObjAreas) === "undefined") {
            this.allDebugObjAreas = {};
    }
    if (this.syncCount !== globalPosConstraintSynchronizer.count ||
          typeof(this.constraints) === "undefined") {
        this.constraints = new DebugObjConstraint();
        this.constraints.init();
        this.syncCount = globalPosConstraintSynchronizer.count;
    }
}

// --------------------------------------------------------------------------
// resetCache
//
DebugObjMgr.prototype.resetCache = function() {
    delete this.allDebugObjAreas;
}

// --------------------------------------------------------------------------
// verifyConsistency
//
DebugObjMgr.prototype.verifyConsistency = function() {
    this.constraints.verifyConsistency();
}

/*****************************************************************************/

// Draw a frame around the area + tooltip (or delete the existing one).
DebugObjMgr.prototype.drawFrame =
function(isActive, areaID, classesStr, itsPos, attributes) {
    if (this.divsArr === undefined) {
        this.divsArr = [];
    }
    var divsArr = this.divsArr;
    var body = document.getElementsByTagName('body')[0];

    if (isActive && itsPos) {
        var div = document.createElement("div");
        div.style.overflow = "visible";
        div.style.position = "absolute";
        div.style.backgroundColor = '#000000';
        div.style.color = '#ffffff';
        div.style.textAlign = 'center';
        div.style.verticalAlign = 'middle';
        div.style.opacity = 0.5;
        div.style.zIndex = 2e8;
        div.style.borderStyle = 'dotted';
        div.style.borderWidth = '1px';
        div.style.borderColor = '#ffffff';
        div.style.borderSpacing = '0px';
        div.style.margin = '0px';
        for (var attr in attributes) {
            div.style[attr] = attributes[attr];
        }

        body.appendChild(div);
        this.divsArr.push(div);

        if (attributes === undefined ||
            (typeof(attributes) === "object" && attributes.borderStyle !== "")) {
            // Shift top/left when it needs a border
            div.style.left = itsPos.absLeft - 1 + 'px';
            div.style.top = itsPos.absTop - 1 + 'px';
        } else {
            // else overlap area precisely
            div.style.left = itsPos.absLeft + 'px';
            div.style.top = itsPos.absTop + 'px';
        }
        div.style.width = itsPos.width + 'px';
        div.style.height = itsPos.height + 'px';
    }
    else {
        // Delete the old frame and tooltip
        if (this.divsArr) {
            for (var i = 0; i < this.divsArr.length; i++) {
                body.removeChild(this.divsArr[i]);
            }
        }
        this.divsArr = [];
    }
}

/*****************************************************************************/

// Construct a debugObjArea(...) if needed.
//  Note that DebugObjArea() might call this function, so consider recursive
DebugObjMgr.prototype.getArea = function(areaID, forceEvaluation, isFirstLevelOnly) {
    var debugEntry = this.allDebugObjAreas[areaID];
    if (debugEntry && (debugEntry.nesting <= gDebugObjMgr.embeddingDepth)) {
        return debugEntry.obj;
    }
    new DebugObjArea(areaID, forceEvaluation, isFirstLevelOnly);
    return this.allDebugObjAreas[areaID].obj;
}

function allConstraints() {
    var str = [];

    if (! debugObjCache) {
        initDebugObjCache();
    }
    gDebugObjMgr.init();
    for (var pnt in gDebugObjMgr.constraints.pointsArr) {
        var cs = gDebugObjMgr.constraints.pointsArr[pnt];
        for (var c in cs) {
            if (c !== "Cycles" && c !== "Violations") {
                str.push(c);
            }
        }
    }
    return str.sort().join("\n");
}

// Displays a rectangle over an area's frame, and returns a DebugArea for it
function A_(areaDescrs, forceEvaluation) {
    if (areaDescrs === undefined) {
        gDebugObjMgr.drawFrame(false);
        return [];
    }

    if (forceEvaluation === undefined) {
        forceEvaluation = globalTaskQueue.pendingTasks.isEmpty();
        if (!forceEvaluation) {
            console.warn("not forcing evaluation of inactive expressions");
        }
    }

    resetDebugObjCache();
    gDebugObjMgr.init();

    if (gDebugObjMgr.constraints.violationMessageList.length > 0) {
        console.groupCollapsed('%c%d constraint violations',
            'font-weight: 500;',
            gDebugObjMgr.constraints.violationMessageList.length);
        for (var i = 0; i < gDebugObjMgr.constraints.violationMessageList.length; i++) {
            console.log(gDebugObjMgr.constraints.violationMessageList[i]);
        }
        console.groupEnd();
    }

    function getAndHighlightArea(areaId, highlight) {

        if (areaId === "p1") {
            var pDescr = shallowCopy(gDomEvent.pointerObj);
            pDescr.constraints = gDebugObjMgr.constraints.getConstraintOfArea("p1");
            return pDescr;
        }

        var area = allAreaMonitor.getAreaById(areaId);
        if (!area) {
            if (areaId) {
                mMessage("no such area: '" + areaId + "'");
            }
            return undefined;
        }

        var debugObjArea = gDebugObjMgr.getArea(areaId, forceEvaluation);
        if (highlight) {
            var itsPos = debugObjAbsAreaPosition(area);
            gDebugObjMgr.drawFrame(true, areaId, debugObjArea.classes, itsPos);
        }
        return debugObjArea;
    }

    var cdlInterpreted = false;

    if (!(areaDescrs instanceof Array)) {
        areaDescrs = [areaDescrs];
    }
    else if (!areaDescrs.every(function(d) {
                return typeof(d) === "string" || typeof(d) === "number";
            })) {
        areaDescrs = ensureOS(I(areaDescrs));
        cdlInterpreted = true;
    }
    var res = [];
    for (var i = 0; i < areaDescrs.length; i++) {
        var areaDescr = areaDescrs[i];
        switch (typeof(areaDescr)) {
          case "string":
            var areaId = undefined;
            if (areaDescr.match(/^@[0-9]+:[0-9]+$/)) {
                res.push(getAndHighlightArea(areaDescr.slice(1), false));
            } else if (!cdlInterpreted && areaDescr.match(/^[0-9]+:[0-9]+$/)) {
                res.push(getAndHighlightArea(areaDescr, true));
            } else if (areaDescr === "p1") {
                res.push(getAndHighlightArea(areaDescr, true));
            }
            break;
        }
    }
    return res.length === 0? undefined: res.length === 1? res[0]: res;
}

function a_(areaId) {
    return allAreaMonitor.allAreas[areaId];
}

function ae_(areaId, id, forceEvaluation) {
    var area = allAreaMonitor.allAreas[areaId];

    if (area === undefined) {
        console.log("no such area:", areaId);
        return undefined;
    }
    // if it's a number, treat it as the id in area's cache
    if (typeof(id) === "number") {
        return area.evaluationNodes[0][id];
    }
    // else treat it as a context attribute
    var context = debugAreaInfo[area.template.id].context;
    var fnRef = context[id];
    if (fnRef === undefined) {
        console.log("no such attribute:", id);
        return undefined;
    }
    return area.getExprByFNRef(fnRef, forceEvaluation);
}

// Highlights all areas with the given class name and returns the list of
// their paids
function Ac_(className, forceEvaluation, getClass) {
    var areaIds, ids, classRe;

    if (forceEvaluation === undefined) {
        forceEvaluation = globalTaskQueue.pendingTasks.isEmpty();
    }
    resetDebugObjCache();
    gDebugObjMgr.init();

    if (typeof(className) === "number") {
        areaIds = allAreaMonitor.getAllAreaIds().filter(function (areaId) {
            return allAreaMonitor.getAreaById(areaId).template.id == className;
        });
        areaIds.map(function (areaId) {
            var area = allAreaMonitor.getAreaById(areaId);
            gDebugObjMgr.drawFrame(true, areaId, "", debugObjAbsAreaPosition(area));
        });
    } else if (typeof(className) !== "string") {
        mMessage("please provide a string class specifier");
        return undefined;
    } else {
        areaIds = [];
        ids = allAreaMonitor.getAllAreaIds();
        classRe = className.match(/[^a-zA-Z0-9_]/) === null? undefined:
                  new RegExp(className);
        gDebugObjClassesInactive = 0;
        for (var i = 0; i != ids.length; i++) {
            var areaId = ids[i];
            var area = allAreaMonitor.getAreaById(areaId);
            var itsPos;
            if (classRe === undefined) {
                if (debugObjAreaOfClass(area, className, forceEvaluation)) {
                    itsPos = debugObjAbsAreaPosition(area);
                    gDebugObjMgr.drawFrame(true, areaId, [className], itsPos);
                    areaIds.push(areaId);
                }
            } else {
                var classes = debugObjClasses(area, forceEvaluation);
                for (var str in classes) {
                    if (classRe.test(str)) {
                        itsPos = debugObjAbsAreaPosition(area);
                        gDebugObjMgr.drawFrame(true, areaId,
                                               Object.keys(classes), itsPos);
                        areaIds.push(areaId);
                        break;
                    }
                }
            }
        }
        if (gDebugObjClassesInactive > 0) {
            console.warn("warning:", gDebugObjClassesInactive,
                         "areas with inactive class function");
        }
    }
    return areaIds.length === 1 && !getClass?
           A_(areaIds[0], forceEvaluation): areaIds;
}

function S_(areaDescrs, attributes, forceEvaluation) {
    var cdlInterpreted = false;

    if (forceEvaluation === undefined) {
        forceEvaluation = globalTaskQueue.pendingTasks.isEmpty();
        if (!forceEvaluation) {
            console.warn("not forcing evaluation of inactive expressions");
        }
    }
    if (areaDescrs === undefined) {
        gDebugObjMgr.drawFrame(false);
        return [];
    }
    if (!(areaDescrs instanceof Array)) {
        areaDescrs = [areaDescrs];
    }
    else if (!areaDescrs.every(function(d) { return typeof(d) === "string" || typeof(d) === "number";})) {
        areaDescrs = ensureOS(I(areaDescrs));
        cdlInterpreted = true;
    }
    var areaIds = [];
    for (var i = 0; i < areaDescrs.length; i++) {
        var areaDescr = areaDescrs[i];
        switch (typeof(areaDescr)) {
          case "number":
            if (!cdlInterpreted) {
                areaIds = areaIds.concat(
                    allAreaMonitor.getAllAreaIds().filter(function(areaId) {
                        return allAreaMonitor.getAreaById(areaId).template.id === areaDescr;
                    })
                );
            }
            break;
          case "string":
            if (areaDescr.match(/^@[0-9]+:[0-9]+$/)) {
                areaIds.push(areaDescr.slice(1));
            } else if (!cdlInterpreted && areaDescr.match(/^[0-9]+:[0-9]+$/)) {
                areaIds.push(areaDescr);
            } else if (!cdlInterpreted) {
                areaIds = areaIds.concat(
                    allAreaMonitor.getAllAreaIds().filter(function(areaId) {
                        var area = allAreaMonitor.getAreaById(areaId);
                        return debugObjAreaOfClass(area, areaDescr, forceEvaluation);
                    })
                );
            }
            break;
        }
    }
    attributes = mergeConst(attributes, {borderStyle: ""});
    for (var i = 0; i < areaIds.length; i++) {
        var areaId = areaIds[i];
        var area = allAreaMonitor.getAreaById(areaId);
        if (area !== undefined) {
            var itsPos = debugObjAbsAreaPosition(area);
            gDebugObjMgr.drawFrame(true, areaId, "", itsPos, attributes);
        }
    }
    return areaIds;
}

function Attr_(areaId, attr) {
    var area;
    
    if (areaId instanceof Array) {
        var map = {};
        for (var i = 0; i < areaId.length; i++) {
            area = allAreaMonitor.getAreaById(areaId[i]);
            if (!area) {
                if (areaId) {
                    mMessage("no such area: '" + areaId + "'");
                }
            } else {
                map[areaId[i]] = area.debugGetContextLabelValue(attr);
            }
        }
        return map;
    } else {
        area = allAreaMonitor.getAreaById(areaId);
        if (!area) {
            if (areaId) {
                mMessage("no such area: '" + areaId + "'");
            }
            return;
        }
        return area.debugGetContextLabelValue(attr);
    }
}

function Attrc_(className, attr, forceEvaluation) {
    if (forceEvaluation === undefined) {
        forceEvaluation = globalTaskQueue.pendingTasks.isEmpty();
    }
    var areaIds = Ac_(className, forceEvaluation, true);
    var res = {};
    var attrs = attr instanceof Array? attr: [attr];

    for (var i = 0; i < areaIds.length; i++) {
        var areaId = areaIds[i];
        var areaVal = {};
        var hasVal = false;
        for (var j = 0; j < attrs.length; j++) {
            var attr1 = attrs[j];
            var evalNode = ae_(areaId, attr1, forceEvaluation);
            if (evalNode !== undefined) {
                areaVal[attr1] = stripArray(evalNode.result.value, true);
                hasVal = true;
            }
        }
        if (hasVal) {
            res[areaId] = attrs.length === 1? areaVal[attrs[0]]: areaVal;
        }
    }
    return res;
}

/*****************************************************************************/
/**************************         DebugObj         ************************/
/*****************************************************************************/

function DebugObj()
{
    this.currentArea = {};
    this.currentAreaID = undefined;
    this.areasUnderCursorArr = undefined;
}


/*****************************************************************************/
/**************************       DebugObjArea        ************************/
/*****************************************************************************/

// The constructor
function DebugObjArea(areaID, forceEvaluation, isFirstLevelOnly) {
    this.areaID = areaID;
    var area = allAreaMonitor.getAreaById(areaID);
    if (!area) {
        return;
    }
    // Add this DebugObjArea early to allDebugObjAreas (avoid recursions)
    gDebugObjMgr.allDebugObjAreas[areaID] = {
        nesting: gDebugObjMgr.embeddingDepth,
        obj:this
    };
    this.tAreaId = area.tAreaId;
    this.embedding = debugObjEmbedding(area);
    var embeddingStarAreaIds = debugObjEmbeddingStar(area);
    this.embeddingStar = embeddingStarAreaIds.map(function(embAreaId, i) {
        return embAreaId + "." +
               allAreaMonitor.getAreaById(i === 0? areaID: embeddingStarAreaIds[i - 1]).template.childName
    });
    if (area.display)
        this.display = area.display.descriptionDisplay;
    if (area.zArea)
        this.zIndex = area.zArea.zIndexStatus + ":" +
          (area.zArea.zIndex === ""? '""': area.zArea.zIndex);

    this.areaObj = area;
    this.explanation = area.explain(forceEvaluation);
    this.name = '';
    if ("context" in this.explanation) {
        area.debugAddContext(this, forceEvaluation);
    }

    this.classes = getClassesForArea(area, forceEvaluation);

    this.constraints = gDebugObjMgr.constraints.getConstraintOfArea(areaID);
    gDebugObjMgr.constraints.visualizeConstraints(this.constraints);

    if (isFirstLevelOnly) {
        return;
    }

    this.embedded = debugObjEmbedded(area, forceEvaluation);

    this.position = debugObjAbsAreaPosition(area);
    if (area.isIntersection()) {
        this.intersection = {};
        this.intersection.referredArea = debugObjReferredArea(area);
        this.intersection.expressionArea = debugObjExpressionArea(area);
        this.intersection.summary = debugObjSummaryLine(area);
    }
}

function getClassesForArea(area, forceEvaluation) {
    var watcher = {
        watcherId: getNextWatcherId(),
        dataSourceAware: true,
        totalUpdateInputTime: 0,
        attributedTime: 0,
        updateInput: function(id, result) {},
        debugName: function() {
            return "debugObjAreaOfClassWatcher";
        },
        getDebugOrigin: function() { return []; },
        isDeferred: function() { return false; },
        defer: function() {},
        undefer: function() {},
        isActive: function() { return true; },
        isReady: function() { return true; }
    };

    if (area.exports && 0 in area.exports) {
        var classes = [];
        var inactiveClasses = [];
        for (var attr in area.exports[0].inputByAttr) {
            var en = area.exports[0].inputByAttr[attr];
            if (forceEvaluation) {
                if (!en.isActive() && forceEvaluation) {
                    try {
                        if (!en.forceActive(watcher)) {
                            console.log("node not evaluated on time:",
                                        en.prototype.idStr());
                        }
                    } catch(e) {
                        Utilities.warn(e.toString());
                    }
                    en.deactivate(watcher);
                }
            }
            if (isTrue(en.result.value)) {
                classes.push({
                    className: (en.isActive() || forceEvaluation? "": "?") + attr,
                    prio: area.template.classNamePrio[attr]
                });
            } else {
                inactiveClasses.push((en.isActive() || forceEvaluation? "": "?") + "*" + attr);
            }
        }
        classes.sort(function(a, b) { return a.prio - b.prio; });
        inactiveClasses.sort();
        return classes.map(function(cp) { return cp.className; }).
               concat(inactiveClasses);
    }
    return [];
}

/*****************************************************************************/

function debugObjEmbedded(area, forceEvaluation) {
    var embedded = area.getEmbeddedAreaList();
    var embeddedObj;

    gDebugObjMgr.embeddingDepth++;
    for (var i = 0; i !== embedded.length; i++) {
        var embeddedArea = embedded[i];
        if (!embeddedObj) {
            embeddedObj = {};
        }
        var embeddedAreaObject;
        if (gDebugObjMgr.embeddingDepth > 0) {
            embeddedAreaObject = embeddedArea.areaId;
        } else {
            embeddedAreaObject = gDebugObjMgr.getArea(embeddedArea.areaId, forceEvaluation);
        }
        embeddedObj[
            embeddedArea.comment? embeddedArea.areaId+"("+embeddedArea.comment+")": embeddedArea.areaId
        ] = embeddedAreaObject;
    }
    gDebugObjMgr.embeddingDepth--;
    return embeddedObj;
}

/*****************************************************************************/

function debugObjAbsAreaPosition(area) {
    if (!(area instanceof DisplayArea)) {
        return undefined;
    }
    var relative = area.relative;
    var absTop = relative.top;
    var absLeft = relative.left;
    var height = relative.height;
    var width = relative.width;
    var offsets = area.getOffsets();

    if ("left" in offsets) {
        absTop += offsets.top;
        absLeft += offsets.left;
    }
    for (var em = relative.embedding; em; em = em.relative.embedding) {
        var offsets = em.getOffsets();
        if ("left" in offsets) {
            absTop += offsets.top;
            absLeft += offsets.left;
        }
        absTop += em.relative.top;
        absLeft += em.relative.left;
    }
    var areaPos = {
        absTop: absTop,
        absLeft:absLeft,
        relTop: relative.top,
        relLeft: relative.left,
        height: height,
        width: width,
        zIndex: area.getZ()
    };

    if (area.contentPos) {
        areaPos.relContentTop = area.contentPos.top;
        areaPos.absContentTop = absTop + area.contentPos.top;

        areaPos.relContentLeft = area.contentPos.left;
        areaPos.absContentLeft = absLeft + area.contentPos.left;

        areaPos.contentHeight = area.contentPos.height;
        areaPos.contentWidth = area.contentPos.width;
    }

    return areaPos;
}

/*****************************************************************************/

/*****************************************************************************/

function debugObjReferredArea(area) {
    return area && area.intersectionChain.referredArea.areaId;
}

/*****************************************************************************/

function debugObjExpressionArea(area) {
    return area && area.intersectionChain.expressionArea.areaId;
}

/*****************************************************************************/

function debugObjSummaryLine(area) {
    if (!area) {
        return undefined;
    }
    var LCE = getLCE(area.intersectionChain.expressionArea, area.intersectionChain.referredArea);
    var summaryStr =
        'Expression=' + area.intersectionChain.expressionArea.areaId +
        ', Referred=' + area.intersectionChain.referredArea.areaId +
        ', commonEmbedding=' + LCE.id +
        ', Embedding=' + (area.relative && area.relative.embedding ? area.relative.embedding.areaId : 'None')
        ;
    return summaryStr;
}

/*****************************************************************************/

var gDebugObjClassesInactive = 0;
function debugObjClasses(area, forceEvaluation) {
    var classes = {};
    var watcher = {
        watcherId: getNextWatcherId(),
        dataSourceAware: true,
        totalUpdateInputTime: 0,
        attributedTime: 0,
        updateInput: function(id, result) {},
        debugName: function() {
            return "debugObjAreaOfClassWatcher";
        },
        getDebugOrigin: function() { return []; },
        isDeferred: function() { return false; },
        defer: function() {},
        undefer: function() {},
        isActive: function() { return true; },
        isReady: function() { return true; }
    };

    if (area.exports !== undefined && "0" in area.exports) {
        if (area.exports[0] === undefined) {
            if (!forceEvaluation) {
                gDebugObjClassesInactive++;
                return;
            }
            area.getExport(0); // should define it
        }
        for (var attr in area.exports[0].inputByAttr) {
            var classExpr = area.exports[0].inputByAttr[attr];
            if (forceEvaluation) {
                if (!classExpr.isActive() && forceEvaluation) {
                    try {
                        if (!classExpr.forceActive(watcher)) {
                            console.log("node not evaluated on time:",
                                        classExpr.prototype.idStr());
                        }
                    } catch(e) {
                        Utilities.warn(e.toString());
                    }
                    classExpr.deactivate(watcher);
                }
            } else if (classExpr.nrActiveWatchers === 0) {
                gDebugObjClassesInactive++;
            }
            var member = classExpr.result.value;
            if (isTrue(member)) {
                classes[attr] = true;
            }
        }
    }
    return classes;
}

function printAllExpressions(areaId) {
    var area;

    function allExpr(indent, areaId, nodes, tAreaId) {
        if (indent === "") {
            console.log("For area " + areaId + " <" + tAreaId + ">");
        }
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                console.log(indent + node.prototype.idStr() + "#" + node.watcherId + ":", 
                            node.prototype.toString(), "active=" +
                            node.nrActiveWatchers, "value=" +
                            vstringifyLim(node.result.value, 100),
                            node.__proto__.constructor.name);
            }
            if (node instanceof EvaluationApply ||
                  node instanceof EvaluationMap ||
                  node instanceof EvaluationFilter ||
                  node instanceof EvaluationMultiQuery) {
                if (node.environment !== undefined) {
                    allExpr(indent + "    ", areaId, node.environment.cache, tAreaId);
                } else if (node.environments !== undefined) {
                    for (var j = 0; j < node.environments.length; j++) {
                        allExpr(indent + "    ", areaId, node.environments[j].cache, tAreaId);
                    }
                }
            }
        }
    }

    if (areaId === 0 || areaId === "global") {
        allExpr("", "global", globalEvaluationNodes, "");
    } else if (areaId !== undefined) {
        var area = allAreaMonitor.allAreas[areaId];
        allExpr("", areaId, area.evaluationNodes[0], area.tAreaId);
    } else {
        allExpr("", "global", globalEvaluationNodes);
        for (areaId in allAreaMonitor.allAreas) {
            area = allAreaMonitor.allAreas[areaId];
            allExpr("", areaId, area.evaluationNodes[0], area.tAreaId);
        }
    }
}

function printAllExpressionsOfType(type) {
    var area;
    var str;

    function allExpr(areaId, nodes) {
        var hit = false;
        var str = "";

        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node && node.debugName() === type) {
                if (!hit) {
                    str + "For area " + areaId + "\n";
                    hit = true;
                }
                str += areaId + " " + node.prototype.idStr() + " " +
                      node.prototype.toString() + " active=" +
                      node.nrActiveWatchers + " value=" +
                      vstringifyLim(node.result.value, 100) + "\n";
            }
            if (node instanceof EvaluationApply ||
                  node instanceof EvaluationMap ||
                  node instanceof EvaluationFilter ||
                  node instanceof EvaluationMultiQuery) {
                if (node.environment !== undefined) {
                    allExpr(areaId, node.environment.cache);
                } else if (node.environments !== undefined) {
                    for (var j = 0; j < node.environments.length; j++) {
                        allExpr(areaId, node.environments[j].cache);
                    }
                }
            }
        }
        return str;
    }

    str = allExpr("global", globalEvaluationNodes);
    for (areaId in allAreaMonitor.allAreas) {
        area = allAreaMonitor.allAreas[areaId];
        str += allExpr(areaId, area.evaluationNodes[0]);
    }
    return str;
}

function printHierarchy(areaId, offset) {
    if (!areaId) areaId = "1:1";
    if (!offset) offset = "";
    var area = allAreaMonitor.getAreaById(areaId);
    var embedded = areaRelationMonitor.getRelation(areaId, "embedded");

    function compareSiblingsByComment(areaRef1, areaRef2) {
        var area1 = allAreaMonitor.getAreaById(areaRef1.getElement());
        var childName1 = area1.comment.slice(area1.comment.lastIndexOf(":") + 1);
        var area2 = allAreaMonitor.getAreaById(areaRef2.getElement());
        var childName2 = area2.comment.slice(area2.comment.lastIndexOf(":") + 1);

        // Note that no two areas can be identical
        return childName1 < childName2? -1:
              childName1 > childName2? 1:
              area1.areaId < area2.areaId? -1:
              1;
    }

    var str = offset + "area " + areaId + "(" + area.tAreaId + ") " + area.comment;
    if (area.intersectionChain)
        str += " expression=" + areaRelationMonitor.getExpressionId(areaId).getElement() +
          " referred=" + areaRelationMonitor.getReferredId(areaId).getElement();
    var zArea = area.getZAreaRep();
    if (zArea)
        str += " z=" + zArea.zIndex;
    console.log(str);

    embedded.sort(compareSiblingsByComment);

    for (var i = 0; i !== embedded.length; i++) {
        var paid = embedded[i].getElement();
        printHierarchy(paid, offset + "  ");
    }
}

function exprStatPerArea() {
    var area;
    var stats = {
        global: {
            id: "global",
            nrInstances: 0,
            nrUpdates: 0,
            nrEvals: 0,
            nrTimesChanged: 0,
            totalEvalTime: 0,
            totalInformWatchersTime: 0,
            totalUpdateInputTime: 0,
            totalAttributedTime: 0,
            nrQueueResets: 0
        }
    };

    function allExpr(areaId, nodes, stat) {
        assert(nodes);
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                stat.nrInstances++;
                stat.nrUpdates += node.nrCallsToUpdate;
                stat.nrEvals += node.nrCallsToEval;
                stat.nrTimesChanged += node.nrCallsToEval;
                stat.totalEvalTime += node.totalEvalTime;
                stat.totalInformWatchersTime += node.totalInformWatchersTime;
                stat.totalUpdateInputTime += node.totalUpdateInputTime;
                stat.totalAttributedTime += node.totalAttributedTime;
                stat.nrQueueResets += node.nrQueueResets;
                if (node instanceof EvaluationApply ||
                    node instanceof EvaluationMap ||
                    node instanceof EvaluationFilter ||
                    node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        allExpr(areaId, node.environment.cache, stat);
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            allExpr(areaId, node.environments[j].cache, stat);
                        }
                    }
                }
            }
        }
    }

    allExpr("global", globalEvaluationNodes, stats["global"]);
    for (var areaId in allAreaMonitor.allAreas) {
        area = allAreaMonitor.allAreas[areaId];
        stats[areaId] = {
            id: areaId,
            tid: area.tAreaId,
            nrInstances: 0,
            nrUpdates: 0,
            nrEvals: 0,
            nrTimesChanged: 0,
            totalEvalTime: 0,
            totalInformWatchersTime: 0,
            totalUpdateInputTime: area.totalUpdateInputTime,
            totalAttributedTime: area.attributedTime,
            nrQueueResets: 0
        };
        allExpr(area.tAreaId, area.evaluationNodes[0], stats[areaId]);
        for (var childName in area.children) {
            var controller = area.children[childName];
            stats[areaId].totalUpdateInputTime += controller.totalUpdateInputTime;
            stats[areaId].totalAttributedTime += controller.attributedTime;
        }
    }
    return "id\ttId\tnrInstances\tnrUpdates\tnrEvals\tnrTimesChanged\tevalTime\tinformWatchersTime\tupdateInputTime\tattributedTime\tnrQueueResets\n" +
          objValues(stats).map(function(v) {
              return v.id + "\t" + v.tid + "\t" + v.nrInstances + "\t" +
                    v.nrUpdates + "\t" + v.nrEvals + "\t" + v.nrTimesChanged +
                    "\t" + v.totalEvalTime + "\t" + v.totalInformWatchersTime +
                    "\t" + v.totalUpdateInputTime + "\t" +
                    v.totalAttributedTime + "\t" + v.nrQueueResets;
          }).join("\n");
}

function exprStatAreaAttributedTime() {

    function accumulateAttributedTime(stat, area) {
        var localSum = area.attributedTime + area.totalUpdateInputTime;
        var totalSum = localSum;
        var childrenStat = undefined;
        var childStat, childTime;

        for (var writeName in area.writes) {
            var write = area.writes[writeName];
            for (var toMergeName in write.whenBecomesTrue) {
                var toMerge = write.whenBecomesTrue[toMergeName];
                localSum += toMerge.attributedTime;
                localSum += toMerge.totalUpdateInputTime;
                if (toMerge.mergeExpression !== undefined) {
                    localSum += toMerge.mergeExpression.attributedTime;
                    localSum += toMerge.mergeExpression.totalUpdateInputTime;
                }
                if (toMerge.toExpression !== undefined) {
                    localSum += toMerge.toExpression.attributedTime;
                    localSum += toMerge.toExpression.totalUpdateInputTime;
                }
            }
            for (var toMergeName in write.whenBecomesFalse) {
                var toMerge = write.whenBecomesFalse[toMergeName];
                localSum += toMerge.attributedTime;
                localSum += toMerge.totalUpdateInputTime;
                if (toMerge.mergeExpression !== undefined) {
                    localSum += toMerge.mergeExpression.attributedTime;
                    localSum += toMerge.mergeExpression.totalUpdateInputTime;
                }
                if (toMerge.toExpression !== undefined) {
                    localSum += toMerge.toExpression.attributedTime;
                    localSum += toMerge.toExpression.totalUpdateInputTime;
                }
            }
        }
        for (var childName in area.children) {
            var ctrl = area.children[childName];
            localSum += ctrl.totalUpdateInputTime + ctrl.attributedTime;
            childStat = undefined;
            childTime = 0;
            for (var id in ctrl.identifier2area) {
                var child = ctrl.identifier2area[id];
                if (childStat === undefined) {
                    childStat = {};
                }
                childTime += accumulateAttributedTime(childStat, child);
            }
            for (var i = 0; i < ctrl.children.length; i++) {
                var child = ctrl.children[i];
                if (childrenStat === undefined) {
                    childrenStat = {};
                }
                if (childStat === undefined) {
                    childStat = {};
                }
                childTime += accumulateAttributedTime(childStat, child);
            }
            totalSum += childTime;
            if (childrenStat === undefined) {
                childrenStat = {};
            }
            childrenStat[childName + " " + childTime.toFixed(0)] = childStat;
        }
        stat[area.areaId + " " + localSum.toFixed(0) + " " + totalSum.toFixed(0)] = childrenStat;
        return totalSum;
    }

    var stat = {};
    accumulateAttributedTime(stat, allAreaMonitor.allAreas[gPaidMgr.getScreenAreaId()]);
    return stat;
}

function exprStatPerTemplate() {
    var stats = {
        global: {
            id: "global",
            nrAreas: 0,
            nrInstances: 0,
            nrUpdates: 0,
            nrEvals: 0,
            nrTimesChanged: 0,
            totalEvalTime: 0,
            totalInformWatchersTime: 0,
            totalUpdateInputTime: 0,
            totalAttributedTime: 0,
            nrQueueResets: 0
        }
    };

    function allExpr(areaId, nodes, stat) {
        assert(nodes);
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                stat.nrInstances++;
                stat.nrUpdates += node.nrCallsToUpdate;
                stat.nrEvals += node.nrCallsToEval;
                stat.nrTimesChanged += node.nrCallsToEval;
                stat.totalEvalTime += node.totalEvalTime;
                stat.totalInformWatchersTime += node.totalInformWatchersTime;
                stat.totalUpdateInputTime += node.totalUpdateInputTime;
                stat.totalAttributedTime += node.totalAttributedTime;
                stat.nrQueueResets += node.nrQueueResets;
                if (node instanceof EvaluationApply ||
                    node instanceof EvaluationMap ||
                    node instanceof EvaluationFilter ||
                    node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        allExpr(areaId, node.environment.cache, stat);
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            allExpr(areaId, node.environments[j].cache, stat);
                        }
                    }
                }
            }
        }
    }

    allExpr("global", globalEvaluationNodes, stats["global"]);
    for (var areaId in allAreaMonitor.allAreas) {
        var area = allAreaMonitor.allAreas[areaId];
        var stat;
        if (area.template.id in stats) {
            stat = stats[area.template.id];
            stat.nrAreas++;
        } else {
            stat = stats[area.template.id] = {
                id: area.template.id,
                nrAreas: 1,
                nrInstances: 0,
                nrUpdates: 0,
                nrEvals: 0,
                nrTimesChanged: 0,
                totalEvalTime: 0,
                totalInformWatchersTime: 0,
                totalUpdateInputTime: 0,
                totalAttributedTime: 0,
                nrQueueResets: 0
            };
        }
        allExpr(area.tAreaId, area.evaluationNodes[0], stat);
    }
    return "template\tnrAreas\tnrInstances\tnrUpdates\tnrEvals\tnrTimesChanged\tevalTime\tinformWatchersTime\tupdateInputTime\tattributedTime\tnrQueueResets\n" +
          objValues(stats).map(function(v) {
              return v.id + "\t" + v.nrAreas + "\t" + v.nrInstances + "\t" +
                    v.nrUpdates + "\t" + v.nrEvals + "\t" + v.nrTimesChanged +
                    "\t" + v.totalEvalTime + "\t" + v.totalInformWatchersTime +
                    "\t" + v.totalUpdateInputTime + "\t" + "\t" +
                    v.totalAttributedTime + "\t" + v.nrQueueResets;
          }).join("\n");
}

function exprStatPerType() {
    var area;
    var stats = {};

    function allExpr(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                var type = node.constructor.name;
                if (node instanceof EvaluationFunctionApplication) {
                    type = node.bif.name;
                }
                if (type in stats) {
                    stats[type].nrInstances++;
                    stats[type].nrUpdates += node.nrCallsToUpdate;
                    stats[type].nrEvals += node.nrCallsToEval;
                    stats[type].nrTimesChanged += node.nrCallsToEval;
                    stats[type].totalEvalTime += node.totalEvalTime;
                    stats[type].totalInformWatchersTime += node.totalInformWatchersTime;
                    stats[type].totalUpdateInputTime += node.totalUpdateInputTime;
                    stats[type].totalAttributedTime += node.totalAttributedTime;
                    stats[type].nrQueueResets += node.nrQueueResets;
                } else {
                    stats[type] = {
                        id: type,
                        nrInstances: 1,
                        nrUpdates: node.nrCallsToUpdate,
                        nrEvals: node.nrCallsToEval,
                        nrTimesChanged: node.nrTimesChanged,
                        totalEvalTime: node.totalEvalTime,
                        totalInformWatchersTime: node.totalInformWatchersTime,
                        totalUpdateInputTime: node.totalUpdateInputTime,
                        totalAttributedTime: node.totalAttributedTime,
                        nrQueueResets: node.nrQueueResets
                    };
                }
                if (node instanceof EvaluationApply ||
                    node instanceof EvaluationMap ||
                    node instanceof EvaluationFilter ||
                    node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        allExpr(node.environment.cache);
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            allExpr(node.environments[j].cache);
                        }
                    }
                }
            }
        }
    }

    allExpr(globalEvaluationNodes);
    for (var areaId in allAreaMonitor.allAreas) {
        area = allAreaMonitor.allAreas[areaId];
        allExpr(area.evaluationNodes[0]);
    }
    return "type\tnrInstances\tnrUpdates\tnrEvals\tnrTimesChanged\tevalTime\tinformWatchersTime\tupdateInputTime\tattributedTime\tnrQueueResets\n" +
          objValues(stats).map(function(v) {
              return v.id + "\t" + v.nrInstances + "\t" + v.nrUpdates + "\t" +
                    v.nrEvals + "\t" + v.nrTimesChanged + "\t" +
                    v.totalEvalTime + "\t" + v.totalInformWatchersTime + "\t" +
                    v.totalUpdateInputTime + "\t" + v.totalAttributedTime +
                    "\t" + v.nrQueueResets;
          }).join("\n");
}

function findAreaContextAttributeForEvaluationNode(area, node) {
    while (area !== undefined) {
        var attributes = area.getDebugAttributeFor(node);
        if (attributes !== undefined) {
            return "@" + area.areaId + ":context:" + attributes.join(",");
        }
        area = area.controller !== undefined? area.controller.parent: undefined;
    }
    return "";
}

function exprStatPerPrototype() {
    var area;
    var stats = {};

    function allExpr(nodes, area) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                var id = node.prototype.idStr();
                if (id in stats) {
                    stats[id].nrInstances++;
                    stats[id].nrUpdates += node.nrCallsToUpdate;
                    stats[id].nrCallsToEval += node.nrCallsToEval;
                    stats[id].nrTimesChanged += node.nrCallsToEval;
                    stats[id].totalEvalTime += node.totalEvalTime;
                    stats[id].totalInformWatchersTime += node.totalInformWatchersTime;
                    stats[id].totalUpdateInputTime += node.totalUpdateInputTime;
                    stats[id].totalAttributedTime += node.totalAttributedTime;
                    stats[id].nrQueueResets += node.nrQueueResets;
                } else {
                    stats[id] = {
                        id: id,
                        nrInstances: 1,
                        nrUpdates: node.nrCallsToUpdate,
                        nrCallsToEval: node.nrCallsToEval,
                        nrTimesChanged: node.nrTimesChanged,
                        totalEvalTime: node.totalEvalTime,
                        totalInformWatchersTime: node.totalInformWatchersTime,
                        totalUpdateInputTime: node.totalUpdateInputTime,
                        totalAttributedTime: node.totalAttributedTime,
                        nrQueueResets: node.nrQueueResets,
                        contextAttribute: findAreaContextAttributeForEvaluationNode(area, node)
                    };
                }
                if (node instanceof EvaluationApply ||
                    node instanceof EvaluationMap ||
                    node instanceof EvaluationFilter ||
                    node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        allExpr(node.environment.cache, undefined);
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            allExpr(node.environments[j].cache, undefined);
                        }
                    }
                }
            }
        }
    }

    allExpr(globalEvaluationNodes, undefined);
    for (var areaId in allAreaMonitor.allAreas) {
        area = allAreaMonitor.allAreas[areaId];
        allExpr(area.evaluationNodes[0], area);
    }
    return "id\tnrInstances\tnrUpdates\tnrCallsToEval\tnrTimesChanged\tevalTime\tinformWatchersTime\tupdateInputTime\tattributedTime\tnrQueueResets\tcontextAttribute\n" +
          objValues(stats).filter(function(v) {
              return v.nrUpdates !== 0;
          }).map(function(v) {
              return v.id + "\t" + v.nrInstances + "\t" + v.nrUpdates + "\t" +
                    v.nrCallsToEval + "\t" + v.nrTimesChanged + "\t" +
                    v.totalEvalTime + "\t" + v.totalInformWatchersTime + "\t" +
                    v.totalUpdateInputTime + "\t" + v.totalAttributedTime +
                    "\t" + v.nrQueueResets + "\t" + v.contextAttribute;
          }).join("\n");
}

function resetExprStat() {
    var area;

    function allExpr(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                node.nrCallsToEval = 0;
                node.nrCallsToUpdate = 0;
                node.nrTimesChanged = 0;
                node.totalEvalTime = 0;
                node.totalInformWatchersTime = 0;
                node.totalUpdateInputTime = 0;
                node.totalAttributedTime = 0;
                node.attributedTime = 0;
                node.nrQueueResets = 0;
                if (node instanceof EvaluationApply ||
                    node instanceof EvaluationMap ||
                    node instanceof EvaluationFilter ||
                    node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        allExpr(node.environment.cache);
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            allExpr(node.environments[j].cache);
                        }
                    }
                }
            }
        }
    }

    allExpr(globalEvaluationNodes);
    for (var areaId in allAreaMonitor.allAreas) {
        area = allAreaMonitor.allAreas[areaId];
        allExpr(area.evaluationNodes[0]);
        area.attributedTime = 0;
        area.totalUpdateInputTime = 0;
        for (var writeName in area.writes) {
            var write = area.writes[writeName];
            for (var toMergeName in write.whenBecomesTrue) {
                var toMerge = write.whenBecomesTrue[toMergeName];
                toMerge.attributedTime = 0;
                toMerge.totalUpdateInputTime = 0;
                if (toMerge.mergeExpression !== undefined) {
                    toMerge.mergeExpression.attributedTime = 0;
                    toMerge.mergeExpression.totalUpdateInputTime = 0;
                }
                if (toMerge.toExpression !== undefined) {
                    toMerge.toExpression.attributedTime = 0;
                    toMerge.toExpression.totalUpdateInputTime = 0;
                }
            }
            for (var toMergeName in write.whenBecomesFalse) {
                var toMerge = write.whenBecomesFalse[toMergeName];
                toMerge.attributedTime = 0;
                toMerge.totalUpdateInputTime = 0;
                if (toMerge.mergeExpression !== undefined) {
                    toMerge.mergeExpression.attributedTime = 0;
                    toMerge.mergeExpression.totalUpdateInputTime = 0;
                }
                if (toMerge.toExpression !== undefined) {
                    toMerge.toExpression.attributedTime = 0;
                    toMerge.toExpression.totalUpdateInputTime = 0;
                }
            }
        }
    }
    EvaluationNode.accumulatedTimes = [];
}

function exprStatCount() {
    var area;
    var nr = 0;
    var attributedRem = 0;

    function allExpr(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                nr++;
                if ("attributedTime" in node) {
                    attributedRem += node.attributedTime;
                }
                if (node instanceof EvaluationApply ||
                    node instanceof EvaluationMap ||
                    node instanceof EvaluationFilter ||
                    node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        allExpr(node.environment.cache);
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            allExpr(node.environments[j].cache);
                        }
                    }
                }
            }
        }
    }

    allExpr(globalEvaluationNodes);
    for (var areaId in allAreaMonitor.allAreas) {
        area = allAreaMonitor.allAreas[areaId];
        allExpr(area.evaluationNodes[0]);
    }
    return { nrNodes: nr, attributedRem: attributedRem };
}

function nrWatchers(minNrWatchers, minNrActive, minNrAdded, minNrRem) {
    var list = [];

    if (minNrWatchers === undefined) minNrWatchers = 0;
    if (minNrActive === undefined) minNrActive = 0;
    if (minNrAdded === undefined) minNrAdded = 0;
    if (minNrRem === undefined) minNrRem = 0;

    function allExpr(areaId, nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                if (node.nrWatchers >= minNrWatchers &&
                    node.nrActiveWatchers >= minNrActive &&
                    node.nrWatchersAdded >= minNrAdded &&
                    node.nrWatchersRemoved >= minNrRem) {
                    list.push({areaId: areaId, node: node});
                }
                if (node instanceof EvaluationApply ||
                    node instanceof EvaluationMap ||
                    node instanceof EvaluationFilter ||
                    node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        allExpr(areaId, node.environment.cache);
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            allExpr(areaId, node.environments[j].cache);
                        }
                    }
                }
            }
        }
    }

    allExpr("global", globalEvaluationNodes);
    for (var areaId in allAreaMonitor.allAreas) {
        var area = allAreaMonitor.allAreas[areaId];
        allExpr(areaId, area.evaluationNodes[0]);
    }
    list.sort(function(a, b) { return a.node.nrWatchers - b.node.nrWatchers; });
    return list.map(function(e) {
        return e.areaId + "\t" + e.node.prototype.idStr() + "\t" +
              e.node.nrWatchers + "\t" + e.node.nrActiveWatchers + "\t" +
              e.node.nrWatchersAdded + "\t" + e.node.nrWatchersRemoved;
    }).join("\n");
}

function printAppState() {
    var area;

    function allExpr(areaId, nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node instanceof EvaluationWrite) {
                console.log(node.prototype.id + "L" + areaId,
                            node.prototype.path.join("."),
                            vstringify(node.result.value));
            }
        }
    }

    allExpr("global", globalEvaluationNodes);
    for (var areaId in allAreaMonitor.allAreas) {
        area = allAreaMonitor.allAreas[areaId];
        allExpr(areaId, area.evaluationNodes[0]);
    }
}

function id_(tAreaId) {
    for (var areaId in allAreaMonitor.allAreas) {
        var area = allAreaMonitor.allAreas[areaId];
        if (area.tAreaId === tAreaId) {
            return areaId;
        }
    }
    return undefined;
}

function tid_(areaId) {
    var area = allAreaMonitor.allAreas[areaId];

    return area? area.tAreaId: undefined;
}

// call f, without local evaluation environment and evaluation node
function testInternalFunction(f) {
    var exec = f.factory();
    var args = [];

    for (var i = 1; i < arguments.length; i++) {
        args.push(new Result(arguments[i]));
    }
    return exec.execute(args);
}

function exprStatHeavy(minT) {
    var area;
    var heavyExpr = [];

    function allExpr(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node && node.totalEvalTime + node.totalInformWatchersTime + node.totalUpdateInputTime >= minT) {
                heavyExpr.push(node);
            }
            if (node instanceof EvaluationApply ||
                node instanceof EvaluationMap ||
                node instanceof EvaluationFilter ||
                node instanceof EvaluationMultiQuery) {
                if (node.environment !== undefined) {
                    allExpr(node.environment.cache);
                } else if (node.environments !== undefined) {
                    for (var j = 0; j < node.environments.length; j++) {
                        allExpr(node.environments[j].cache);
                    }
                }
            }
        }
    }

    allExpr(globalEvaluationNodes);
    for (var areaId in allAreaMonitor.allAreas) {
        area = allAreaMonitor.allAreas[areaId];
        allExpr(area.evaluationNodes[0]);
    }
    return heavyExpr;
}

function unwatchedActiveExpressions() {
    var area;
    var stats = {
        global: []
    };

    function noActiveWatcher(watchers) {
        var noActW = true;

        watchers.forEach(function(w) {
            if (!(w.watcher instanceof EvaluationNode) ||
                  w.watcher.nrActiveWatchers > 0) {
                noActW = false;
            }
        });
        return noActW;
    }

    function allExpr(areaId, nodes, stat) {
        assert(nodes);
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                if (node.nrActiveWatchers > 0 && noActiveWatcher(node.watchers)) {
                    stat.push(node);
                }
                if (node instanceof EvaluationApply ||
                    node instanceof EvaluationMap ||
                    node instanceof EvaluationFilter ||
                    node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        allExpr(areaId, node.environment.cache, stat);
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            allExpr(areaId, node.environments[j].cache, stat);
                        }
                    }
                }
            }
        }
    }

    allExpr("global", globalEvaluationNodes, stats["global"]);
    if (stats["global"].length === 0) {
        delete stats["global"];
    }
    for (var areaId in allAreaMonitor.allAreas) {
        area = allAreaMonitor.allAreas[areaId];
        stats[areaId] = [];
        allExpr(area.tAreaId, area.evaluationNodes[0], stats[areaId]);
        if (stats[areaId].length === 0) {
            delete stats[areaId];
        }
    }
    return Utilities.isEmptyObj(stats)? undefined: stats;
}

function printAreaSetExpressions(templateId, setIndices) {
    function collectAreas() {
        var areas = [];
        var nrInd = setIndices.length;

        for (var areaId in allAreaMonitor.allAreas) {
            var area = allAreaMonitor.allAreas[areaId];
            if (area.template.id === templateId &&
                  valueEqual(area.setIndices.slice(0, nrInd), setIndices)) {
                areas.push(area);
            }
        }
        return areas;
    }

    var areas = collectAreas();
    if (areas.length === 0) {
        return;
    }

    var area = areas[0];
    var template = area.template;
    var nrEvalNodes = area.evaluationNodes[0].length;
    var str = "id\tproto";
    var node;

    function ellipsis(val) {
        if (val === undefined) {
            return "undefined";
        }
        var str = vstringify(val);
        if (str.length > 80) {
            str = str.substr(0,40) + "..." + str.substr(-37);
        }
        if (val instanceof Array && val.length > 1) {
            str += " size=" + val.length;
        }
        return str;
    }

    for (var j = 0; j < areas.length; j++) {
        area = areas[j];
        str += "\t" + area.areaId;
    }
    str += "\n";
    for (var i = 0; i < nrEvalNodes; i++) {
        str += String(i) + "\t" + template.functionNodes[i].toString();
        for (var j = 0; j < areas.length; j++) {
            area = areas[j];
            node = area.evaluationNodes[0][i];
            if (!node) {
                str += "\t";
            } else if (node.nrActiveWatchers === 0) {
                str += "\tinactive";
            } else {
                str += "\t" + ellipsis(node.result.value) + "/" + node.nrActiveWatchers;
            }
        }
        str += "\n";
    }
    return str;
}

// Prints all expressions of a given prototype.
function printExprOfPrototype(id, localToArea, localToDefun) {
    var area;

    function allExpr(areaId, nodes) {
        var node = nodes[id];

        if (node && node.prototype.localToArea === localToArea &&
              node.prototype.localToDefun === localToDefun) {
            console.log(areaId.join(":"), "#" + node.watcherId, 
                        "active=" + node.nrActiveWatchers,
                        "value=" + (node.result === undefined? "<undefined>": vstringifyLim(node.result.value, 80)),
                        "size=" + (node.result !== undefined && node.result.value instanceof Array? node.result.value.length: 1));
        }
        if (localToDefun !== 0) {
            for (var i = 0; i < nodes.length; i++) {
                node = nodes[i];
                if (node) {
                    if (node instanceof EvaluationApply ||
                        node instanceof EvaluationMap ||
                        node instanceof EvaluationFilter ||
                        node instanceof EvaluationMultiQuery) {
                        if (node.environment !== undefined) {
                            allExpr(areaId, node.environment.cache);
                        } else if (node.environments !== undefined) {
                            for (var j = 0; j < node.environments.length; j++) {
                                allExpr(areaId, node.environments[j].cache);
                            }
                        }
                    }
                }
            }
        }
    }

    if (localToArea > 0) {
        for (var areaId in allAreaMonitor.allAreas) {
            area = allAreaMonitor.allAreas[areaId];
            if (area.template.id === localToArea || localToDefun !== 0) {
                allExpr([area.areaId], area.evaluationNodes[0]);
            }
        }
    } else {
        allExpr(["global"], globalEvaluationNodes);
    }
}

// Prints all expressions with result label dataSource
function printDataSourceExpr() {

    function isTerm(node) {
        for (var watcherId in node.watchers) {
            var w = node.watchers[watcherId].watcher;
            if (w.result && !("dataSource" in w.result)) {
                return true;
            }
        }
        return false;
    }

    function areaSetContent(area) {
        if (area.param && area.param.data && area.param.data.dataSource) {
            var ds = area.param.data.dataSource;
            var node = area.evaluationNodes[0][paramSetDataIndex];
            console.log(area.areaId + "\t" + ds.id + "\t" +
                        node.prototype.idStr() + "\t" + "areaSetContent");
        }
    }

    function allExpr(areaId, nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node && (node.dataSourceAware ||
                         node.result && node.result.dataSource)) {
                var ds = node.result.dataSource;
                if (ds) {
                    console.log(areaId + "\t" + ds.id + "\t" +
                                node.prototype.idStr() + "\t" +
                                node.prototype.toString());
                } else {
                    console.log(areaId + "\t" + node.prototype.idStr() + "\t" +
                                node.prototype.toString());
                }
            }
            if (node instanceof EvaluationApply ||
                  node instanceof EvaluationMap ||
                  node instanceof EvaluationFilter ||
                  node instanceof EvaluationMultiQuery) {
                if (node.environment !== undefined) {
                    allExpr(areaId, node.environment.cache);
                } else if (node.environments !== undefined) {
                    for (var j = 0; j < node.environments.length; j++) {
                        allExpr(areaId, node.environments[j].cache);
                    }
                }
            }
        }
    }

    allExpr("global", globalEvaluationNodes);
    var areaIds = sortAreaIds(Object.keys(allAreaMonitor.allAreas));
    for (var i = 0; i < areaIds.length; i++) {
        var areaId = areaIds[i];
        var area = allAreaMonitor.allAreas[areaId];
        areaSetContent(area);
        allExpr(areaId, area.evaluationNodes[0]);
    }
}

function listUnreachableDataSources() {
    var idSet = new Set();

    function allExpr(areaId, nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node && node instanceof EvaluationFunctionApplication &&
                  (node.bif.name === "datatable" || node.bif.name === "database") &&
                  node.result.dataSource !== undefined) {
                node.result.dataSource.collectReachableDSIds(idSet);
            }
            if (node instanceof EvaluationApply ||
                  node instanceof EvaluationMap ||
                  node instanceof EvaluationFilter ||
                  node instanceof EvaluationMultiQuery) {
                if (node.environment !== undefined) {
                    allExpr(areaId, node.environment.cache);
                } else if (node.environments !== undefined) {
                    for (var j = 0; j < node.environments.length; j++) {
                        allExpr(areaId, node.environments[j].cache);
                    }
                }
            }
        }
    }

    allExpr("global", globalEvaluationNodes);
    var areaIds = sortAreaIds(Object.keys(allAreaMonitor.allAreas));
    for (var i = 0; i < areaIds.length; i++) {
        var areaId = areaIds[i];
        var area = allAreaMonitor.allAreas[areaId];
        allExpr(areaId, area.evaluationNodes[0]);
    }
    var unreachableIds = [];
    for (var idStr in debugDataSourceObject) {
        var id = Number(idStr);
        if (!idSet.has(id)) {
            unreachableIds.push(id);
        }
    }
    return unreachableIds;
}

function printAllAreaContexts() {
    var areaIds = allAreaMonitor.getAllAreaIds();

    for (var j = 0; j < areaIds.length; j++) {
        var area = allAreaMonitor.getAreaById(areaIds[j]);
        var debugInfo = {};
        area.debugAddContext(debugInfo, false);
        if ("context" in debugInfo) {
            console.log(area.tAreaId, "@"+area.areaId, "content", cdlifyLim(debugInfo.content, 80));
        }
        for (var attr in debugInfo.context) {
            console.log(area.tAreaId, "@"+area.areaId, attr, cdlifyLim(debugInfo.context[attr], 80));
        }
    }
}

function printAllAreaClasses() {
    var areaIds = allAreaMonitor.getAllAreaIds();

    for (var j = 0; j < areaIds.length; j++) {
        var area = allAreaMonitor.getAreaById(areaIds[j]);
        var classes = getClassesForArea(area);
        for (var i = 0; i < classes.length; i++) {
            console.log(area.tAreaId, "@"+area.areaId, classes[i]);
        }
    }    
}

// Returns the node with the given watcher id
function wid_(watcherId) {

    function allExpr(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                if (node.watcherId === watcherId) {
                    return node;
                } else if (node instanceof EvaluationApply ||
                           node instanceof EvaluationMap ||
                           node instanceof EvaluationFilter ||
                           node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        var r = allExpr(node.environment.cache);
                        if (r !== undefined) {
                            return r;
                        }
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            var r = allExpr(node.environments[j].cache);
                            if (r !== undefined) {
                                return r;
                            }
                        }
                    }
                }
            }
        }
    }

    var r = allExpr(globalEvaluationNodes);
    if (r !== undefined) {
        return r;
    }
    for (var areaId in allAreaMonitor.allAreas) {
        var area = allAreaMonitor.allAreas[areaId];
        var r = allExpr(area.evaluationNodes[0]);
        if (r !== undefined) {
            return r;
        }
    }
    return undefined;
}

function printAreasOverlapping(areaId) {
    var area = allAreaMonitor.getAreaById(areaId);
    var absPos = debugObjAbsAreaPosition(area)
    var str = "";

    function overlappingEmbeddedAreas(areaId, top, left, bottom, right, indent) {
        var area = allAreaMonitor.getAreaById(areaId);
        var embedded = areaRelationMonitor.getRelation(areaId, "embedded");
        var info = areaId + " "  + area.zArea.zIndexStatus + " " +
                   area.zArea.zIndex;

        str += indent + (area.display && area.display.isOpaque()? info: "(" + info + ")") + "\n";
        for (var i = 0; i < embedded.length; i++) {
            var child = allAreaMonitor.getAreaById(embedded[i].getElement());
            if (child instanceof DisplayArea) {
                var pos = child.getPos();
                if (pos) {
                    var offsets = child.getOffsets();
                    var cPos = offsets === undefined || !("left" in offsets)?
                        pos: {
                            left: pos.left + offsets.left,
                            top: pos.top + offsets.top,
                            width: pos.width - offsets.left - offsets.right,
                            height: pos.height - offsets.top - offsets.bottom
                        };
                    var bPos = child.hasVisibleBorder()? pos: cPos;
                    if (bPos.left < right && bPos.left + bPos.width >= left &&
                        bPos.top < bottom && bPos.top + bPos.height >= top) {
                        overlappingEmbeddedAreas(child.areaId, top - cPos.top,
                                            left - cPos.left, bottom - cPos.top,
                                            right - cPos.left, indent + "  ");
                    }
                }
            }
        }
    }

    overlappingEmbeddedAreas("1:1", absPos.absTop, absPos.absLeft,
                             absPos.absTop + absPos.height,
                             absPos.absLeft + absPos.width, "");
    return str;
}

function printLargeQueries(minSize, areaId) {
    var area;

    function allExpr(areaId, nodes, tAreaId) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node && node.nrCallsToUpdate > 0 && node.isLargeQuery(minSize, true)) {
                console.log("ae_(\"" + areaId + "\", " + node.prototype.id + ")",
                            "T" + tAreaId, "#" + node.watcherId,
                            node.prototype.idStr(), "active=" +
                            node.nrActiveWatchers, "value=" +
                            vstringifyLim(node.result.value, 100),
                            node.__proto__.constructor.name);
            }
            if (node instanceof EvaluationApply ||
                  node instanceof EvaluationMap ||
                  node instanceof EvaluationFilter ||
                  node instanceof EvaluationMultiQuery) {
                if (node.environment !== undefined) {
                    allExpr(areaId, node.environment.cache, tAreaId);
                } else if (node.environments !== undefined) {
                    for (var j = 0; j < node.environments.length; j++) {
                        allExpr(areaId, node.environments[j].cache, tAreaId);
                    }
                }
            }
        }
    }

    if (areaId === 0 || areaId === "global") {
        allExpr("global", globalEvaluationNodes, "");
    } else if (areaId !== undefined) {
        var area = allAreaMonitor.allAreas[areaId];
        allExpr(areaId, area.evaluationNodes[0], area.tAreaId);
    } else {
        allExpr("global", globalEvaluationNodes);
        for (areaId in allAreaMonitor.allAreas) {
            area = allAreaMonitor.allAreas[areaId];
            allExpr(areaId, area.evaluationNodes[0], area.tAreaId);
        }
    }
}

function exprNrWatchersStatPerPrototype() {
    var area;
    var stats = {};

    function allExpr(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                var nrWatchers = node.watchers? node.watchers.size: 0;
                var id = node.prototype.idStr();
                if (id in stats) {
                    stats[id].nrInstances++;
                    stats[id].totalNrWatchers += nrWatchers;
                    if (stats[id].minNrWatchers > nrWatchers)
                        stats[id].minNrWatchers = nrWatchers;
                    if (stats[id].maxNrWatchers < nrWatchers)
                        stats[id].maxNrWatchers = nrWatchers;
                } else {
                    stats[id] = {
                        id: id,
                        nrInstances: 1,
                        totalNrWatchers: nrWatchers,
                        minNrWatchers: nrWatchers,
                        maxNrWatchers: nrWatchers
                    };
                }
                if (node instanceof EvaluationApply ||
                    node instanceof EvaluationMap ||
                    node instanceof EvaluationFilter ||
                    node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        allExpr(node.environment.cache);
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            allExpr(node.environments[j].cache);
                        }
                    }
                }
            }
        }
    }

    allExpr(globalEvaluationNodes);
    for (var areaId in allAreaMonitor.allAreas) {
        area = allAreaMonitor.allAreas[areaId];
        allExpr(area.evaluationNodes[0]);
    }
    return "id\tnrInstances\ttotalNrWatchers\tavgNrWatchers\tminNrWatchers\tmaxNrWatchers\n" +
          objValues(stats).map(function(v) {
              return v.id + "\t" + v.nrInstances + "\t" + v.totalNrWatchers +
                    "\t" + v.totalNrWatchers / v.nrInstances + "\t" +
                    v.minNrWatchers + "\t" + v.maxNrWatchers;
          }).join("\n");
}

function memStatsPerTemplate() {
    var stats = {
        global: {
            id: "global",
            nrAreas: 0,
            nrEvaluationNodes: 0,
            nrNonActive: 0,
            nrConstraints: 0,
            nrWatchers: 0,
            path: []
        }
    };

    function allExpr(areaId, nodes, stat) {
        assert(nodes);
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                stat.nrEvaluationNodes++;
                if (node.nrActiveWatchers === 0) {
                    stat.nrNonActive++;
                }
                stat.nrWatchers += node.watchers === undefined? 0: node.watchers.size;
                if (node instanceof EvaluationApply ||
                    node instanceof EvaluationMap ||
                    node instanceof EvaluationFilter ||
                    node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        allExpr(areaId, node.environment.cache, stat);
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            allExpr(areaId, node.environments[j].cache, stat);
                        }
                    }
                }
            }
        }
    }

    allExpr("global", globalEvaluationNodes, stats["global"]);
    for (var areaId in allAreaMonitor.allAreas) {
        var area = allAreaMonitor.allAreas[areaId];
        var stat;
        if (area.template.id in stats) {
            stat = stats[area.template.id];
            stat.nrAreas++;
        } else {
            stat = stats[area.template.id] = {
                id: area.template.id,
                nrAreas: 1,
                nrEvaluationNodes: 0,
                nrNonActive: 0,
                nrConstraints: 0,
                nrWatchers: 0,
                path: area.template.getChildPath()
            };
        }
        stat.nrConstraints += Object.keys(area.allPosConstraints.constraints).length;
        allExpr(area.tAreaId, area.evaluationNodes[0], stat);
    }
    return "template\tnrAreas\tnrEvNodes\tnrNonActive\tnrConstraints\tnrWatchers\tpath\n" +
          objValues(stats).map(function(v) {
              return v.id + "\t" + v.nrAreas + "\t" + v.nrEvaluationNodes +
                     "\t" + v.nrNonActive + "\t" + v.nrConstraints + "\t" +
                     v.nrWatchers + "\t" + v.path.join(".");
          }).join("\n");
}

function memStatsTotal() {
    var stat = {
        nrAreas: 0,
        nrEvaluationNodes: 0,
        nrNonActive: 0,
        nrConstraints: 0
    };

    function allExpr(areaId, nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                stat.nrEvaluationNodes++;
                if (node.nrActiveWatchers === 0) {
                    stat.nrNonActive++;
                }
                if (node instanceof EvaluationApply ||
                    node instanceof EvaluationMap ||
                    node instanceof EvaluationFilter ||
                    node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        allExpr(areaId, node.environment.cache);
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            allExpr(areaId, node.environments[j].cache);
                        }
                    }
                }
            }
        }
    }

    allExpr("global", globalEvaluationNodes);
    for (var areaId in allAreaMonitor.allAreas) {
        var area = allAreaMonitor.allAreas[areaId];
        stat.nrAreas++;
        stat.nrConstraints += Object.keys(area.allPosConstraints.constraints).length;
        allExpr(area.tAreaId, area.evaluationNodes[0]);
    }
    console.log("nrAreas=" + stat.nrAreas + ", nrEvaluationNodes=" + stat.nrEvaluationNodes + ", nrNonActive=" + stat.nrNonActive + ", nrConstraints=" + stat.nrConstraints);
}

function countLocalWatchers() {
    var nrNodes = 0;
    var nrWatchers = 0;
    var nrLocalWatchers = 0;

    function allExpr(areaId, nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                nrNodes++;
                if (node.watchers !== undefined) {
                    nrWatchers += node.watchers.size;
                    node.watchers.forEach(function(watcher) {
                        var w = watcher.watcher;
                        if (w instanceof EvaluationNode && w.local === node.local) {
                            nrLocalWatchers++;
                        }
                    });
                }
                if (node instanceof EvaluationApply ||
                      node instanceof EvaluationMap ||
                      node instanceof EvaluationFilter ||
                      node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        allExpr(areaId, node.environment.cache);
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            allExpr(areaId, node.environments[j].cache);
                        }
                    }
                }
            }
        }
    }

    allExpr("global", globalEvaluationNodes);
    for (var areaId in allAreaMonitor.allAreas) {
        var area = allAreaMonitor.allAreas[areaId];
        allExpr(area.tAreaId, area.evaluationNodes[0]);
    }
    console.log("nrNodes=" + nrNodes + ", nrWatchers=" + nrWatchers + ", nrLocalWatchers=" + nrLocalWatchers);
}

function markAllFunctionNodes() {
    function allExpr(areaId, nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                node.__MARKED__ = true;
                // if (node instanceof EvaluationApply ||
                //       node instanceof EvaluationMap ||
                //       node instanceof EvaluationFilter ||
                //       node instanceof EvaluationMultiQuery) {
                //     if (node.environment !== undefined) {
                //         allExpr(areaId, node.environment.cache);
                //     } else if (node.environments !== undefined) {
                //         for (var j = 0; j < node.environments.length; j++) {
                //             allExpr(areaId, node.environments[j].cache);
                //         }
                //     }
                // }
            }
        }
    }

    allExpr("global", globalEvaluationNodes);
    for (var areaId in allAreaMonitor.allAreas) {
        var area = allAreaMonitor.allAreas[areaId];
        allExpr(area.tAreaId, area.evaluationNodes[0]);
    }
}

function countAllUnmarkedFunctionNodes() {
    var nodeCount = [];

    function allExpr(areaId, nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node && !node.__MARKED__) {
                node.__MARKED__ = true;
                var id = node.prototype.id;
                var templId = node.prototype.localToArea;
                if (templId === undefined) {
                    templId = 0;
                }
                if (nodeCount[templId] === undefined) {
                    nodeCount[templId] = [];
                }
                if (nodeCount[templId][id] === undefined) {
                    nodeCount[templId][id] = 1;
                } else {
                    nodeCount[templId][id]++;
                }
                // Note: don't walk defun nodes: they have no context/display/
                // labels
            }
        }
    }

    allExpr("global", globalEvaluationNodes);
    for (var areaId in allAreaMonitor.allAreas) {
        var area = allAreaMonitor.allAreas[areaId];
        allExpr(area.tAreaId, area.evaluationNodes[0]);
    }
    var str = "tid\tid\tn\tlabels\n";
    for (var tid = 0; tid < nodeCount.length; tid++) {
        var tc = nodeCount[tid];
        if (tc !== undefined) {
            for (var nid = 0; nid < tc.length; nid++) {
                var cnt = tc[nid];
                if (cnt !== undefined) {
                    str += tid + "\t" + nid + "\t" + cnt + "\t" +
                        (functionNodeToExpressionPaths[tid] === undefined? "":
                            functionNodeToExpressionPaths[tid][nid]) + "\n";
                }
            }
        }
    }
    return str;
}

function printAllDefunAppl() {
    var area;
    var str;

    function allExpr(areaId, nodes) {
        var str = "";

        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node instanceof EvaluationApply && "fun" in node) {
                str += areaId + " " + node.prototype.idStr() + " " +
                      node.prototype.toString() + " active=" +
                      node.nrActiveWatchers + " value=" +
                      vstringifyLim(node.result.value, 100) + "\n";
            }
            if (node instanceof EvaluationApply ||
                  node instanceof EvaluationMap ||
                  node instanceof EvaluationFilter ||
                  node instanceof EvaluationMultiQuery) {
                if (node.environment !== undefined) {
                    allExpr(areaId, node.environment.cache);
                } else if (node.environments !== undefined) {
                    for (var j = 0; j < node.environments.length; j++) {
                        allExpr(areaId, node.environments[j].cache);
                    }
                }
            }
        }
        return str;
    }

    str = allExpr("global", globalEvaluationNodes);
    for (areaId in allAreaMonitor.allAreas) {
        area = allAreaMonitor.allAreas[areaId];
        str += allExpr(areaId, area.evaluationNodes[0]);
    }
    return str;
}

function nukeAllWatcherMaps() {
    function allExpr(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node !== undefined) {
                node.watchers = undefined;
            }
            if (node instanceof EvaluationApply ||
                  node instanceof EvaluationMap ||
                  node instanceof EvaluationFilter ||
                  node instanceof EvaluationMultiQuery) {
                if (node.environment !== undefined) {
                    allExpr(node.environment.cache);
                } else if (node.environments !== undefined) {
                    for (var j = 0; j < node.environments.length; j++) {
                        allExpr(node.environments[j].cache);
                    }
                }
            }
        }
    }

    allExpr(globalEvaluationNodes);
    for (var areaId in allAreaMonitor.allAreas) {
        allExpr(allAreaMonitor.allAreas[areaId].evaluationNodes[0]);
    }
}

function printAppStateChangeList() {
    return gAppStateChangeList.map(function(c) {
            return "@" + c.areaId + ":" + c.path.join(".") + ":" + cdlify(c.value);
        }).join("\n");
}

function printNrInitiatedDeferrals() {
    var strs = ["nrdef\tarea\tprototype\twatcherId\tactive\tvalue\ttype"];

    function allExpr(areaId, nodes) {
        assert(nodes);
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                if (node.nrDeferralsInitiated > 0) {
                    strs.push(String(node.nrDeferralsInitiated) + "\t" + "@" + areaId + "\t" +
                              node.prototype.idStr() + "\t" + node.watcherId + "\t" +
                              node.nrActiveWatchers + "\t" +
                              vstringifyLim(node.result.value, 100) + "\t" +
                              node.__proto__.constructor.name);
                }
                if (node instanceof EvaluationApply ||
                    node instanceof EvaluationMap ||
                    node instanceof EvaluationFilter ||
                    node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        allExpr(areaId, node.environment.cache);
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            allExpr(areaId, node.environments[j].cache);
                        }
                    }
                }
            }
        }
    }

    allExpr("global", globalEvaluationNodes);
    for (var areaId in allAreaMonitor.allAreas) {
        var area = allAreaMonitor.allAreas[areaId];
        allExpr(areaId, area.evaluationNodes[0]);
    }
    return strs.join("\n");
}

function resetNrInitiatedDeferrals() {
    var area;

    function allExpr(areaId, nodes) {
        assert(nodes);
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node) {
                node.nrDeferralsInitiated = 0;
                if (node instanceof EvaluationApply ||
                    node instanceof EvaluationMap ||
                    node instanceof EvaluationFilter ||
                    node instanceof EvaluationMultiQuery) {
                    if (node.environment !== undefined) {
                        allExpr(areaId, node.environment.cache);
                    } else if (node.environments !== undefined) {
                        for (var j = 0; j < node.environments.length; j++) {
                            allExpr(areaId, node.environments[j].cache);
                        }
                    }
                }
            }
        }
    }

    allExpr("global", globalEvaluationNodes);
    for (var areaId in allAreaMonitor.allAreas) {
        area = allAreaMonitor.allAreas[areaId];
        allExpr(areaId, area.evaluationNodes[0]);
    }
}
