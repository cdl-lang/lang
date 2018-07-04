// Copyright 2017 Theo Vosse.
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

/// <reference path="utilities.ts" />
/// <reference path="cdl.ts" />
/// <reference path="pathTreeNode.ts" />
/// <reference path="predefinedFunctions.ts" />
/// <reference path="buildFunctionNode.ts" />
/// <reference path="attributeDescription.ts" />
/// <reference path="testElement.ts" />
/// <reference path="functionGraph.postlude.ts"/>

// Set up the root, which coincides with the screen area
var pathTreeRoot: PathTreeNode = new PathTreeNode(undefined, undefined, undefined);
pathTreeRoot.area = pathTreeRoot;

// The entry point for the application; it's defined in one of the cdl files.
declare var screenArea: any;

/** Adds expressions for unused attributes and attributes optimized away at
 *  the end of the compilation */
var addDebugInformation: number = 0;
/** When false, this stops constant propagation and qualifier elimination.
 * But don't do that, since it requires so much memory that 4GB isn't enough to
 * compile myLeanFSApp.
 */
var optimize: boolean = true;
/** Flag to suppress compile time checks at application load time (since the
 * FunctionNode classes are shared) */
var doCompileTimeChecks: boolean = true;
var t0: number = Date.now();
var gArgParser: ArgParse = getArgParser();

// Node with the global message, [message]
var globalMessageNode: FunctionNode;
// Result node for [pointer]; its write function implements cursor changes
var pointerNode: FunctionNode;
// Result node for [debugBreak]; returns a special write node that breaks
// into the debugger
var globalDebugBreakNode: DebugBreakNode;
// Result node for [areasUnderPointer]; simple storage that reflects the
// current state
var globalAreasUnderPointerNode: StorageNode;
// Result node for [globalDefaults]; initialized with initGlobalDefaults.
var globalDefaultsNode: WritableNode;
var initGlobalDefaults: any = {};

var doDumpLOP: boolean = false;
var doProfileCycleNr: number = undefined;
var isProfiling: boolean = false;

// Maps error identifiers to error functions
var errorReporters: {[errorType: string]: (msg: string) => void} = {
    "undefined": Utilities.syntaxError,
    "unknownClass": Utilities.syntaxError,
    "noSuperclass": Utilities.syntaxError,
    "duplicateVariant": Utilities.syntaxError
};

declare var test: any;

// populate 'classDefinitions' with a class-definition
//
// 'classDefinitions' is a two dimensional associative array, indexed first
//  by class-name, then by confLib-name
//
function addClass(confLibName: string, className: string, classDef: any): void {
    if (! (className in classDefinitions)) {
        classDefinitions[className] = {};
    }
    classDefinitions[className][confLibName] = classDef;
}

// populate 'classDefinitions' with the classes defined in classDefList, all
//  being part of 'confLibName'
//
function addClasses(confLibName: string,
                    classDefList: {[className: string]: any}[]): void
{
    for (var idx = 0; idx < classDefList.length; idx++) {
        var classDefs: {[className: string]: any} = classDefList[idx];
        for (var className in classDefs) {
            addClass(confLibName, className, classDefs[className]);
        }
    }
}

// confLibPriority maps a confLibName to its priority value
// higher priority means lower numeric value
//
var confLibPriority: {[confLibName: string]: number} = {};

//
// initialize confLibPriority according to 'includedClassConf'
//
// includedClassConf is an array ordered by confLibPriorities.
// each element in the array is an object having a 'name' attribute, whose
//  value is the name of the confLib having that includedClassConf index as its
//  priority
//
function genConfLibPriority() {
    if (typeof(includedClassConf) === "undefined") {
        return;
    }
    for (var idx: number = 0; idx < includedClassConf.length; idx++) {
        var entry = includedClassConf[idx];
        confLibPriority[entry.name] = idx;
    }
}

function walkChildrenAndCreateTemplate(areaNode: PathTreeNode,
                                       parent: AreaTemplate,
                                       childName: string,
                                       dataExpr: PathTreeNode,
                                       partnerExpr: PathTreeNode): AreaTemplate
{
    var areaTemplate = new AreaTemplate(areaNode, parent, childName,
                                        dataExpr, partnerExpr);

    // Update the message node types
    var newTemplateValue: ValueType = new ValueType().addArea(areaTemplate.id, [_r(1, 1)]);
    var newRecipientAndHandledBy: ValueType = new ValueType().addObject({
        recipient: newTemplateValue,
        handledBy: newTemplateValue
    });
    globalMessageNode.valueType = globalMessageNode.valueType.merge(newRecipientAndHandledBy);

    // The area itself
    areaTemplates[areaTemplate.id] = areaTemplate;
    areaNode.templateId = areaTemplate.id;

    // Think about the children, recursively.
    if (areaNode.next["children"] !== undefined) {
        var children = areaNode.next["children"];
        if (children.opaque)
            Utilities.error("opaque children");
        for (childName in children.next) {
            var child: PathTreeNode = children.next[childName];
            var dataExpr: PathTreeNode = child.next["data"];
            var partnerExpr: PathTreeNode = child.next["partner"];
            if (child.opaque)
                Utilities.error("opaque child");
            if (dataExpr !== undefined && partnerExpr !== undefined)
                Utilities.warn("both data and partner for " + childName +
                               " in " + getShortChildPath(areaNode.getPath()));
            var childDescription: PathTreeNode = child.next["description"];
            if (childDescription !== undefined) {
                if (childDescription.doesExist()) {
                    areaTemplate.addChild(
                        childName,
                        walkChildrenAndCreateTemplate(
                            childDescription, areaTemplate, childName,
                            dataExpr, partnerExpr));
                }
            } else {
                Utilities.warn("no description for: " + childName + " in " +
                               getShortChildPath(areaNode.getPath()));
            }
        }
    }
    return areaTemplate;
}

function initTemplates(): void {
    for (var i = 1; i < areaTemplates.length; i++) {
        var areaTemplate: AreaTemplate = areaTemplates[i];
        areaTemplate.addMyMessageNode();
        areaTemplate.addParamNodes();
        areaTemplate.addExistence(areaTemplate.areaNode);
        areaTemplate.addClasses(areaTemplate.areaNode);
    }
}

function markAllWritables(): void {
    for (var i: number = 1; i < areaTemplates.length; i++) {
        areaTemplates[i].markWritablePath();
    }
    for (var i: number = 0; i !== FunctionNode.writabilityQueue.length; i++) {
        FunctionNode.writabilityQueue[i].checkWritability();
    }
}

function createInternalFunctions(areaTemplate: AreaTemplate): void {
    nextStubCycle();
    areaTemplate.addInternalFunctions();
    for (var childName in areaTemplate.children) {
        createInternalFunctions(areaTemplate.children[childName]);
    }
}

function createGlobals(): void {
    gProjectorExpr = expressionStore.get(_, undefined);
    gUndefinedExpr = expressionStore.get(undefined, undefined);
    gTrueExpr = expressionStore.get(true, undefined);
    gMeExpr = expressionStore.get([me], undefined);
    gRecipientMessageExpr = expressionStore.get([{recipient: _}, [message]], undefined);

    // Build a global node to store the message object, and ensure it's in the
    // global cache.
    globalMessageNode = buildMessageQueueNode(["message"], undefined, 0,
                                              new ValueType().addObject({
                                                  type: new ValueType().addString().addSize(1),
                                                  time: new ValueType().addNumber().addSize(1),
                                                  subType: new ValueType().addString().addSize(0, 1),
                                                  modifier: new ValueType().addString().addSize(0, 5),
                                                  absX: new ValueType().addNumber().addSize(1),
                                                  absY: new ValueType().addNumber().addSize(1),
                                                  relX: new ValueType().addNumber().addSize(1),
                                                  relY: new ValueType().addNumber().addSize(1),
                                                  deltaX: new ValueType().addNumber().addSize(0, 1),
                                                  deltaY: new ValueType().addNumber().addSize(0, 1),
                                                  deltaZ: new ValueType().addNumber().addSize(0, 1),
                                                  deltaMode: new ValueType().addString().addSize(0, 1),
                                                  key: new ValueType().addString().addSize(0, 1),
                                                  char: new ValueType().addString().addSize(0, 1),
                                                  repeat: new ValueType().addBoolean().addSize(0, 1),
                                                  location: new ValueType().addNumber().addSize(0, 1),
                                                  recipient: new ValueType().addSize(1),
                                                  handledBy: new ValueType().addSizeRange(new RangeValue([0, Infinity], true, false)),
                                                  reason: new ValueType().addString().addSize(0, 1),
                                                  files: new ValueType().addObject({
                                                        name: new ValueType().addString().addSize(1),
                                                        fullName: new ValueType().addString().addSize(1),
                                                        type: new ValueType().addString().addSize(1),
                                                        size: new ValueType().addNumber().addSize(1),
                                                        lastModified: new ValueType().addNumber().addSize(1),
                                                        lastModifiedDate: new ValueType().addAnyData().addSize(1),
                                                        fileHandle: new ValueType().addAnyData().addSize(1)
                                                    }).addSizeRange(new RangeValue([0, Infinity], true, false))
                                              }).
                                              addSize(0, 1));
    FunctionNode.cache(globalMessageNode, {}, true);
    pointerNode = buildPointerStorageNode(["pointer"], undefined, 0,
                                          new ValueType().addObject({
                                              position: new ValueType().addObject({
                                                  top: new ValueType().addNumber().addSize(1),
                                                  left: new ValueType().addNumber().addSize(1)
                                              }),
                                              display: new ValueType().addObject({
                                                  image: new ValueType().addString().addSize(0, 1)
                                              }),
                                              button: new ValueType().addString().addSize(0, 5),
                                              modifier: new ValueType().addString().addSize(0, 5),
                                              id: new ValueType().addNumber().addSize(1),
                                              dragging: new ValueType().addBoolean().addObject({
                                                  name: new ValueType().addString().addSize(0, 1),
                                                  fullName: new ValueType().addString().addSize(0, 1),
                                                  kind: new ValueType().addString().addSize(1),
                                                  type: new ValueType().addString().addSize(1),
                                                  size: new ValueType().addNumber().addSize(0, 1),
                                                  lastModified: new ValueType().addNumber().addSize(0, 1),
                                                  lastModifiedDate: new ValueType().addAnyData().addSize(0, 1),
                                                  fileHandle: new ValueType().addAnyData().addSize(0, 1)
                                              }).addSizeRange(new RangeValue([0, Infinity], true, false))
                                          }).
                                          addSize(1));
    FunctionNode.cache(pointerNode, {}, true);
}

function updateGlobalsCycle(): void {
    globalMessageNode.updateCycle();
    pointerNode.updateCycle();
    if (globalDebugBreakNode !== undefined) {
        globalDebugBreakNode.updateCycle();
    }
    if (globalAreasUnderPointerNode !== undefined) {
        globalAreasUnderPointerNode.updateCycle();
    }
    if (globalDefaultsNode !== undefined) {
        globalDefaultsNode.updateCycle();
        globalDefaultsNode.initialValue.updateCycle();
    }
}

function updateAreasCycle(): void {
    for (var i: number = 1; i < areaTemplates.length; i++) {
        var areaTemplate: AreaTemplate = areaTemplates[i];
        if (areaTemplate !== undefined) {
            areaTemplate.updateCycle();
        }
    }
    for (var i: number = 1; i < areaTemplates.length; i++) {
        var areaTemplate: AreaTemplate = areaTemplates[i];
        if (areaTemplate !== undefined) {
            if (addDebugInformation > 1) {
                areaTemplate.buildExprForAllContextLabels();
            }
        }
    }
}

// First flatten screenArea to a priority ordered list of paths with values,
// then merge into tree for easier access
function createAreaTemplates(): void {
    var t1: number;

    t1 = Date.now();
    console.log("// start", (t1 - t0) / 1000 + " s");
    t0 = t1;
    
    initializeExpressions();

    pathTreeRoot.values.push(
        new PathInfo([], expressionStore.get(new ChildExistence(), undefined),
                     undefined, [], false, [], 0, 0, false, undefined));

    convertObject(pathTreeRoot, screenArea, [], [], 0,
        [{
            className: undefined,
            pathDepthAtInheritance: 0,
            classTreeDepth: 0,
            priorityQualifier: false
        }], {}, true, undefined);

    console.log("// nr PathTreeNodes", PathInfo.count);
    console.log("// multiple paths", multiplePathCount);
    if (Utilities.hasSyntaxError) {
        return;
    }

    t1 = Date.now();
    console.log("// load js", (t1 - t0) / 1000 + " s");
    t0 = t1;

    if (gArgParser.getArg("dumpAfterLoad", false)) {
        console.log(pathTreeRoot.toStream(function(nodeNr: string, str: string): void {
            console.log(str.replace(/ +([WO]*)$/, "$1"));
        }));
        process.exit(0);
    } else if (debugLoadJSTime) {
        console.log("time\tpath");
        console.log(pathTreeRoot.timePathToStream(function(nodeNr: number, time: number, path: string): void {
            console.log(String((time / 1000).toFixed(2)), path);
        }));
        console.log("\n\nclass name\tnr uses\ttime");
        for (var confLib in classUsage) {
            for (var classStem in classUsage[confLib]) {
                console.log(confLib + "::" + classStem, classUsage[confLib][classStem],
                            (classLoadJSTime[confLib][classStem] / 1000).toFixed(2));
            }
        }
        process.exit(0);
    }
    warnUnusedClasses();

    gInLoadPhase = false;
    if (optimize) {
        // Optimize qualifiers in tree until there are no more changes
        var change: boolean;
        do {
            change = false;
            if (pathTreeRoot.removeDuplicateExpressions()) {
                change = true;
            }
            if (pathTreeRoot.propagateConstants([pathTreeRoot.getContextConstants()])) {
                change = true;
            }
            if (pathTreeRoot.partitionQualifiers()) {
                change = true;
            }
            if (pathTreeRoot.removeInheritedQualifiers([], [])) {
                change = true;
            }
            if (pathTreeRoot.removeRedundantQualifiers([], [])) {
                change = true;
            }
            // if (pathTreeRoot.propagateAttributeMappings([{}])) {
            //     change = true;
            // }
        } while (change);
    } else {
        pathTreeRoot.removeInheritedQualifiers([], []);
    }
    pathTreeRoot.checkMustBeDefined();

    t1 = Date.now();
    console.log("// remove qualifiers", (t1 - t0) / 1000 + " s");
    t0 = t1;

    if (gArgParser.getArg("dumpAfterOptimization", false)) {
        console.log(pathTreeRoot.toStream(function(nodeNr: string, str: string): void{
            console.log(str.replace(/ +([WO]*)$/, "$1"));
        }));
        process.exit(0);
    }

    createGlobals();

    var rootTemplate = walkChildrenAndCreateTemplate(pathTreeRoot, undefined,
                                               undefined, undefined, undefined);
    initTemplates();

    t1 = Date.now();
    console.log("// create template tree", (t1 - t0) / 1000 + " s");
    t0 = t1;

    // Loop until all cycles have stabilized
    do {
        gOutputChanged = false;
        // invalidatedFunctionNodesInPreviousCycle = invalidatedFunctionNodes;
        // invalidatedFunctionNodes = [];
        gCycleNr++;
        if (gCycleNr == doProfileCycleNr) {
            console.profile();
            isProfiling = true;
        } else if (isProfiling) {
            console.profileEnd();
            isProfiling = false;
        }
        updateGlobalsCycle();
        updateAreasCycle();
        resetDefuns();
        var t1: number = Date.now();
        console.log("// cycle", gCycleNr, (t1 - t0) / 1000 + " s");
        t0 = t1;
        Utilities.resetAllTypeErrors();
        createInternalFunctions(rootTemplate);
        if (Utilities.hasSyntaxError) {
            return;
        }
    } while (gOutputChanged && !(gCycleNr >= maxNrCycles));
    if (isProfiling) {
        console.profileEnd();
        isProfiling = false;
    }
    console.log("// end", (Date.now() - t0) / 1000 + " s");
    // Now we can safely print the type errors
    Utilities.printAllTypeErrors();

    // Suppress creation of cache etc for non-existing areas. Removing them
    // from the template is too much trouble, but we don't want to fill up
    // the output with unnecessary nodes.
    rootTemplate.markNonExistingChildren(true);

    // Check for variant cycles and try to repair them when not all qualifiers
    // have been eliminated.
    if (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPick) {
        VariantFunctionNode.repairCycle = true;
        pickQualifiedExpressionStrategy = PickQualifiedExpressionStrategy.alwaysPick;
        try {
            rootTemplate.walkFunctionNodes(true, {}, FunctionNode.variantCycleCheck);
            for (var templateId: number = 1; templateId < areaTemplates.length; templateId++) {
                areaTemplates[templateId].expressionsHaveBeenCached = false;
            }
        } catch (e) {
            // An unrepairable cycle has been detected; the caching functions
            // will find it too and print the error message.
        }
        VariantFunctionNode.repairCycle = false;
    }

    // Schedule all area templates; first reset, because they all have step 0
    for (var templateId: number = 1; templateId < areaTemplates.length; templateId++) {
        areaTemplates[templateId].scheduleStep = undefined;
    }
    for (var templateId: number = 1; templateId < areaTemplates.length; templateId++) {
        if (areaTemplates[templateId].doesExist) {
            areaTemplates[templateId].getScheduleStep({}, FunctionNode.cache);
        }
    }

    // Check for calculation-only areas
    rootTemplate.checkDisplayArea();

    // test compilation may require exports, so compile test before 
    //  area exports are cached
    if (typeof(test) !== "undefined") {
        var contextNode: PathTreeNode = new PathTreeNode(undefined, undefined, "test");
        gErrContext.enter(contextNode, undefined);
        compileTest(test, contextNode, "test");
        gErrContext.leave();
    }

    // Traverses all areas to cache their expressions. This should lead to list
    // of expressions per template id (and a global one) without duplicates.
    rootTemplate.walkFunctionNodes(true, {}, FunctionNode.cache);
    markAllWritables();

    verifyAreaAttributeDescription(rootTemplate);
    
    if (!Utilities.hasSyntaxError && addDebugInformation > 0) {
        cacheContext();
        mapFunctionNodesToExpressionPaths();
    }
}

function printAreaTemplateTree(area: AreaTemplate, indent: string = ""): void {
    if (area.classes !== undefined)
        console.log(indent + "classes=" +
                  (area.exports[0]? area.exports[0].toString(): "<UNDEFINED>"));
    console.log(indent + "isDiplayArea=" + area.isDisplayArea);
    if (area.childExistence !== undefined)
        console.log(indent + "existence=" +
                    (!area.doesExist? "NOT":
                     area.existenceQualifiers? area.existenceQualifiers.map(function(qs: SingleQualifier[]): string {
                        return qs.map(function(q: SingleQualifier): string {
                            return q.toSymString();
                        }).join(" && ");
                    }).join(" || "): "<UNDEFINED>"));
    if (area.displayFunction !== undefined)
        console.log(indent + "display=" + area.displayFunction.idStr());
    if (area.positionFunctions !== undefined)
        console.log(indent + "position=" + 
                    JSON.stringify(Utilities.mapObj(area.positionFunctions, function (a:any,v:any):any {
                        return v.idStr();
                    })));
    if (area.stackingFunctions !== undefined)
        console.log(indent + "position=" + 
                    JSON.stringify(Utilities.mapObj(area.stackingFunctions, function (a:any,v:any):any {
                        return v.idStr();
                    })));
    if (!Utilities.isEmptyObj(area.exports)) {
        var str = "";
        for (var exportId in area.exports) {
            if (area.exports[exportId] !== undefined) {
                if (str.length !== 0) str += ", ";
                str += "#" + exportId + ":" + area.exports[exportId].idStr();
            }
        }
        if (str.length !== 0) {
            console.log(indent + "exports={" + str + "}");
        }
    }
    if (area.writeFunctions !== undefined) {
        var str = "";
        for (var wrName in area.writeFunctions) {
            var wrNode: WriteNode = area.writeFunctions[wrName];
            if (wrNode !== undefined) {
                if (str.length !== 0) str += ", ";
                str += wrName + ":" + wrNode.toString();
            }
        }
        console.log(indent + "writes={" + str + "}");
    }
    for (var childName in area.children) {
        var ch: string = "";
        if (area.setFunctions !== undefined && childName in area.setFunctions) {
            if (area.setFunctions[childName].data !== undefined) {
                ch = "data="+area.setFunctions[childName].data.idStr() + " ";
            }
            if (area.setFunctions[childName].partner !== undefined) {
                ch = "partner="+area.setFunctions[childName].partner.idStr() + " ";
            }
        }
        console.log(indent + childName, "@" + area.children[childName].id,
                    ch + "S="+area.children[childName].scheduleStep + " {");
        printAreaTemplateTree(area.children[childName], indent + "    ");
        console.log(indent + "}");
    }
}

function findNodeWithFunctionId(id: number, n: PathTreeNode): PathTreeNode {
    if (n === undefined || (n.functionNode !== undefined && n.functionNode.id === id)) {
        return n;
    }
    for (var attr in n.next) {
        var r = findNodeWithFunctionId(id, n.next[attr]);
        if (r !== undefined) {
            return r;
        }
    }
    return undefined;
}

function cacheContext(): void {
    for (var i: number = 1; i !== areaTemplates.length; i++) {
        var t: AreaTemplate = areaTemplates[i];
        t.getDebugContextString({}); // causes caching of the expressions
    }
}

function exportFunctionNodes(origin:number, cache:FunctionNode[]):void {
    for (var i: number = 0; i !== cache.length; i++) {
        // Write the function that generates the FunctionNode
        console.log(cache[i].constructPrototypeFunctionCall(origin) +
                    " // " + cache[i].idStr());
    }
}

function exportAreaTemplates(): void {
    var createChildren: string;
    var attrFnStr: string;

    for (var i: number = 1; i !== areaTemplates.length; i++) {
        var t: AreaTemplate = areaTemplates[i];
        console.log(t.toCreateString(), "// area template create", i);
        if (!t.doesExist) {
            console.log("// non-existent");
        } else {
            exportFunctionNodes(t.id, t.functionNodes);
            attrFnStr = t.toAreaExistenceString();
            if (attrFnStr !== undefined)
                console.log(attrFnStr);
            console.log(t.toClassNamePrioString());
            attrFnStr = t.toIndependentContentPositionString();
            if (attrFnStr !== undefined)
                console.log(attrFnStr);
            attrFnStr = t.toEmbeddingInReferredString();
            if (attrFnStr !== undefined)
                console.log(attrFnStr);
            attrFnStr = t.toPropagatePointerInAreaString();
            if (attrFnStr !== undefined)
                console.log(attrFnStr);
            attrFnStr = t.toForeignDisplayString();
            if (attrFnStr !== undefined)
                console.log(attrFnStr);
            if (!t.isDisplayArea) {
                console.log("_ca()");
            }
        }
        createChildren = t.toCreateChildrenString();
        if (createChildren !== undefined) {
            console.log(createChildren);
        }
        if (addDebugInformation > 0) {
            console.log(t.getDebugContextString({}), "// context");
        }
        console.log(t.toExprString(), "// area template expr", i);
        if (t.doesExist) {
            var wrString: string = t.getWritesString();
            if (wrString !== undefined) {
                console.log(wrString);
            }
        }
    }
}

function exportDebugInformation(): void {
    console.log("var areaDebugInfo = [undefined,");
    for (var i: number = 1; i !== areaTemplates.length; i++) {
        var t: AreaTemplate = areaTemplates[i];
        if (t.doesExist) {
            console.log(t.areaNode.getClassDebugInfo(t.areaNode) + ",");
        } else {
            console.log("undefined,");
        }
    }
    console.log("undefined];");
    console.log("var gClassNameDebugStrings = " + JSON.stringify(gClassNameDebugStrings) + ";");
    console.log("var gClassQualifierDebugStrings = " + JSON.stringify(gClassQualifierDebugStrings) + ";");
    console.log("var gClassPathDebugStrings = " + JSON.stringify(gClassPathDebugStrings) + ";");
    console.log("var gClassPathTree = " + JSON.stringify(gClassPathTree) + ";");
}


function getMaxScheduleStep(prio: number): number {
    var gMSS = 0;

    function mssFromFNs(fns: FunctionNode[]): void {
        for (var j: number = 0; j < fns.length; j++) {
            if (fns[j] !== undefined && fns[j].prio === prio &&
                  fns[j].scheduleStep > gMSS) {
                gMSS = fns[j].scheduleStep;
            }
        }
    }

    for (var i: number = 1; i !== areaTemplates.length; i++) {
        var areaTemplate: AreaTemplate = areaTemplates[i];
        if (areaTemplate !== undefined && areaTemplate.doesExist) {
            var aMSS: number = areaTemplate.getMaxScheduleStep(prio);
            if (aMSS > gMSS) {
                gMSS = aMSS;
            }
        }
    }
    mssFromFNs(FunctionNode.globalFunctionNodes);
    if (prio === 0 && typeof(testSequence) !== "undefined") {  
        for (var i: number = 0; i < testSequence.length; i++) {
            if (testSequence[i].scheduleStep > gMSS) {
                gMSS = testSequence[i].scheduleStep;
            }
        }
    }
    return gMSS;
}

var testSequence: TestElement[];

// Takes a moon representation and turns it into descriptions with function
// nodes that sequentially implement a test. The function nodes are shared
// with the global cache.
// tests itself is either an AV or an ordered set of tests. All will be executed
// linearly.
function compileTest(test: any, parentOS: PathTreeNode, attr: string): void {
    var contextNode: PathTreeNode = new PathTreeNode(parentOS, undefined, attr);

    gErrContext.enter(contextNode, undefined);
    testSequence = TestElement.getSequence(test);
    gErrContext.leave();
}

function startTestCompilation(): void {
}


function cacheTestFunction(): void {
    if (typeof(testSequence) !== "undefined") {
        for (var i: number = 0; i < testSequence.length; i++) {
            testSequence[i] = testSequence[i].cache();
        }
    }
}

function endTestCompilation(dumpMode: boolean): void {
    if (!dumpMode) {
        var indent: string = "      ";
        console.log("\nfunction createTestList() {");
        console.log("    var tests = [");
        console.log(indent + TestElement.genTestSequenceStr(testSequence, indent, dumpMode));
        console.log("    ];\n");
        console.log("    return tests;\n");
        console.log("}");
    } else {
        console.log("\ntests:");
        console.log(TestElement.genTestSequenceStr(testSequence, "", dumpMode));
    }
}

function setErrors(cmdArg: string): void {
    if (cmdArg !== undefined && cmdArg !== "") {
        var elts: string[] = cmdArg.split(",");
        for (var i: number = 0; i < elts.length; i++) {
            var elt: string[] = elts[i].split(":");
            if (elt.length !== 2) {
                Utilities.error("wrong argument to errors: " + cmdArg);
            }
            switch (elt[1]) {
            case "error":
                errorReporters[elt[0]] = Utilities.syntaxError;
                break;
            case "warning":
                errorReporters[elt[0]] = Utilities.warnOnce;
                break;
            default:
                Utilities.error("only error or warning allowed: " + cmdArg);
                break;
            }
        }
    }
}

var funPrio: {[name: string]: {symbol: string; lprio: number; rprio: number;}} = {
    or: {symbol: "|", lprio: 2, rprio: 2},
    and: {symbol: "&", lprio: 3, rprio: 3},
    equal: {symbol: "=", lprio: 4, rprio: 4},
    notEqual: {symbol: "!=", lprio: 4, rprio: 4},
    lessThan: {symbol: "<", lprio: 4, rprio: 4},
    lessThanOrEqual: {symbol: "<=", lprio: 4, rprio: 4},
    greaterThan: {symbol: ">", lprio: 4, rprio: 4},
    greaterThanOrEqual: {symbol: ">=", lprio: 4, rprio: 4},
    plus: {symbol: "+", lprio: 5, rprio: 5},
    minus: {symbol: "+", lprio: 5, rprio: 5.5},
    mul: {symbol: "*", lprio: 6, rprio: 6},
    div: {symbol: "/", lprio: 6, rprio: 6.5},
    mod: {symbol: "&", lprio: 6, rprio: 6.5},
    pow: {symbol: "^", lprio: 7, rprio: 7.5},
    uminus: {symbol: "-", lprio: 8, rprio: 8}
};

function convertSyntaxFunctionApplication(indent: string, expression: any[]): string {
    function priority(expr: any): number {
        return getCdlExpressionType(expr) === ExpressionType.functionApplication &&
               expr.length === 3 && expr[0] instanceof BuiltInFunction &&
               expr[0].name in funPrio?
               funPrio[expr[0].name].lprio: 9;
    }
    if (expression.length === 1) {
        return convertSyntaxValue(indent, expression[0], false);
    } else {
        var fun: string = convertSyntaxValue(indent, expression[0], false);
        if (fun in funPrio && expression.length === 3) {
            var op = funPrio[fun];
            var lop = convertSyntaxValue("", expression[1], false);
            var rop = convertSyntaxValue("", expression[2], false);
            if (priority(expression[1]) < op.lprio) {
                lop = "(" + lop + ")";
            }
            if (priority(expression[2]) < op.rprio) {
                rop = "(" + rop + ")";
            }
            return lop + " " + op.symbol + " " + rop;
        } else if (fun in funPrio && expression.length === 2) {
            var op = funPrio[fun];
            var rop = convertSyntaxValue("", expression[1], false);
            if (priority(expression[1]) < op.rprio) {
                rop = "(" + rop + ")";
            }
            return op.symbol + rop;
        } else {
            return fun + "(" +
                expression.slice(1).map(function(arg: any): string {
                    return convertSyntaxValue("", arg, false);
                }).join(", ") + ")";
        }
    }
}

function copyWithoutPath(obj: any, path: string[], index: number = 0): any {
    if (index < path.length) {
        var copy: any = undefined;
        for (var attr in obj) {
            var objAtAttr: any = undefined;
            if (attr === path[index]) {
                if (getCdlExpressionType(obj[attr]) === ExpressionType.attributeValue) {
                    objAtAttr = copyWithoutPath(obj[attr], path, index + 1);
                }
            } else {
                objAtAttr = obj[attr];
            }
            if (objAtAttr !== undefined) {
                if (copy === undefined) {
                    copy = {};
                }
                copy[attr] = objAtAttr;
            }
        }
        return copy;
    } else {
        return obj;
    }
}

var globalIdentifiers: {[name: string]: boolean} = {
    _: true,
    mustBeDefined: true,
    unmatched: true,
    ascending: true,
    descending: true,
    plus: true,
    minus: true,
    mul: true,
    div: true,
    pow: true,
    mod: true,
    remainder: true,
    and: true,
    ln: true,
    log10: true,
    logb: true,
    exp: true,
    or: true,
    not: true,
    offset: true,
    coordinates: true,
    lessThan: true,
    lessThanOrEqual: true,
    equal: true,
    notEqual: true,
    greaterThanOrEqual: true,
    greaterThan: true,
    map: true,
    filter: true,
    first: true,
    prev: true,
    next: true,
    last: true,
    sort: true,
    prevStar: true,
    prevPlus: true,
    nextStar: true,
    nextPlus: true,
    index: true,
    concatStr: true,
    subStr: true,
    numberToString: true,
    bool: true,
    notEmpty: true,
    empty: true,
    sum: true,
    min: true,
    max: true,
    me: true,
    embedded: true,
    embeddedStar: true,
    embedding: true,
    embeddingStar: true,
    expressionOf: true,
    referredOf: true,
    intersectionParentOf: true,
    debugNodeToStr: true,
    size: true,
    pointer: true,
    sequence: true,
    reverse: true,
    pos: true,
    range: true,
    arg: true,
    merge: true,
    mergeWrite: true,
    areaOfClass: true,
    allAreas: true,
    identify: true,
    anonymize: true,
    overlap: true,
    time: true,
    changed: true,
    redirect: true,
    systemInfo: true,
    timestamp: true,
    displayWidth: true,
    displayHeight: true,
    baseLineHeight: true,
    dateToNum: true,
    numToDate: true,
    stringToNumber: true,
    escapeQuotes: true,
    areasUnderPointer: true,
    globalDefaults: true,
    getRawData: true,
    download: true,
    printArea: true,
    dayOfWeek: true,
    dayOfMonth: true,
    month: true,
    quarter: true,
    year: true,
    hour: true,
    minute: true,
    second: true,
    foreignFunctions: true,
    remoteStatus: true,
    intersect: true,
    unite: true,
    isDisjoint: true,
    classOfArea: true,
    cond: true,
    debugBreak: true,
    defun: true,
    using: true,
    message: true,
    myMessage: true,
    multiQuery: true,
    tempAppStateConnectionInfo: true,
    debuggerAreaInfo: true,
    debuggerContextInfo: true,
    datasource: true,
    datasourceInfo: true,
    datatable: true,
    database: true,
    databases: true,
    internalApply: true,
    internalPush: true,
    internalAtomic: true,
    internalDelete: true,
    compareAreasQuery: true,
    nCompareAreasQuery: true,
    internalFilterAreaByClass: true,
    internalFilterAreaByClassName: true,
    dynamicAttribute: true,
    verificationFunction: true,
    makeDefined: true,
    singleValue: true,
    floor: true,
    ceil: true,
    round: true,
    abs: true,
    sqrt: true,
    sign: true,
    uminus: true,
    evaluateFormula: true,
    testFormula: true,
    evaluateCdlStringValue: true,
    testCdlValueString: true,
    addComputedAttribute: true,
    testStore: true,
    loginInfo: true
};

function convertSyntaxQuery(indent: string, expression: any[]): string {
    var query: any = expression[0];
    var data: string = convertSyntaxValue("", expression[1], false);

    function acceptable(attr: string): boolean {
        return !(attr in globalIdentifiers);
    }

    if (!(query instanceof Object) || query instanceof NonAV) {
        return data + "."+ "match(" + convertSyntaxValue("", query, false) + ")";
    }
    var projectionPaths: string[][] = extractProjectionPaths(query);
    if (projectionPaths.length === 1) {
        var matchingQuery: any = copyWithoutPath(query, projectionPaths[0]);
        if (matchingQuery !== undefined) {
            return data + "." + convertSyntaxValue("", matchingQuery, false) + "." + projectionPaths[0].join(".");
        }
        return data === "me" && acceptable(projectionPaths[0][0])?
               projectionPaths[0].join("."):
               data + "." + projectionPaths[0].join(".");
    }
    return data + "."+ convertSyntaxValue("", query, false);
}

function convertSyntaxQualifiers(qualifiers: any): string {
    var str: string = "";

    for (var qualifier in qualifiers) {
        if (str.length !== 0) {
            str += " & ";
        }
        str += qualifier + " ~ " + convertSyntaxValue("", qualifiers[qualifier], false);
    }
    return str;
}

function convertSyntaxVariants(indent: string, expression: MoonOrderedSet, section: boolean): string {
    var str: string = "";

    for (var i: number = 0; i < expression.os.length; i++) {
        var variant: any = expression.os[i];
        if (getCdlExpressionType(variant) === ExpressionType.attributeValue &&
              "qualifier" in variant) {
            if (variant.qualifier === "!") {
                str += indent + "first:\n";
            } else {
                str += indent + "when " + convertSyntaxQualifiers(variant.qualifier) + ":\n";
            }
            if ("variant" in variant) {
                str += convertSyntaxValue(indent + "  ", variant.variant, section) + "\n";
            } else {
                str += convertSyntaxValue(indent + "  ", shallowCopyMinus(variant, "qualifier"), section) + "\n";
            }
        } else {
            str += indent + "last:\n" + convertSyntaxValue(indent + "  ", variant, section) + "\n";
        }
    }
    return str;
}

function convertSyntaxValue(indent: string, expression: any, section: boolean): string {
    var str: string = "";

    function isVariant(expression: MoonOrderedSet): boolean {
        return expression.os.some(function(elt: any): boolean {
            return getCdlExpressionType(elt) === ExpressionType.attributeValue &&
                   ("qualifier" in elt || "variant" in elt);
        });
    }

    switch (getCdlExpressionType(expression)) {
      case ExpressionType.builtInFunction:
        return indent + expression.name;
      case ExpressionType.projector:
        return indent + "_";
      case ExpressionType.string:
        return indent + '"' + expression + '"'; // escape quotes!
      case ExpressionType.number:
      case ExpressionType.boolean:
      case ExpressionType.undefined:
      case ExpressionType.false:
      case ExpressionType.null:
        return indent + expression;
      case ExpressionType.query:
        return convertSyntaxQuery(indent, expression);
      case ExpressionType.functionApplication:
        return convertSyntaxFunctionApplication(indent, expression);
      case ExpressionType.jsFunctionApplication:
        return indent + "jsFunctionApplication";
      case ExpressionType.range:
            return indent + "r(" + expression.os.map(function(arg: any): string {
                return convertSyntaxValue("", arg, false);
            }).join(", ") + ")";
      case ExpressionType.subStringQuery:
            return indent + "s(" + expression.os.map(function(arg: any): string {
                return convertSyntaxValue("", arg, false);
            }).join(", ") + ")";
      case ExpressionType.comparisonFunction:
        return indent + "comparisonFunction";
      case ExpressionType.orderedSet:
        if (expression === mustBeDefined) {
            return indent + "mustBeDefined";
        } else if (isVariant(expression)) {
            return convertSyntaxVariants(indent, expression, section);
        } else if (section && expression.os.length === 1 &&
                   getCdlExpressionType(expression.os[0]) === ExpressionType.attributeValue) {
            return convertSyntaxValue(indent, expression.os[0], true);
        } else {
            return indent + "o(" + expression.os.map(function(arg: any): string {
                return convertSyntaxValue("", arg, false);
            }).join(", ") + ")";
        }
      case ExpressionType.negation:
            return indent + "n(" + expression.queries.map(function(arg: any): string {
                return convertSyntaxValue("", arg, false);
            }).join(", ") + ")";
      case ExpressionType.attributeValue:
        if (expression === superclass) {
            return indent + "super";
        } else if ("variant" in expression || "qualifier" in expression) {
            return convertSyntaxVariants(indent, o(expression), section);
        } else if (section) {
            for (var attr in expression) {
                var val: any = expression[attr];
                var mod: string = "";
                if (str.length > 0) {
                    str += "\n";
                }
                if (attr === "class") {
                    str += indent + "inherit " + 
                        convertSyntaxValue("", val, true);
                } else {
                    if (attr[0] === "^") {
                        mod = "persistent store ";
                        attr = attr.slice(1);
                    } else if (attr[0] === "*") {
                        mod = "temp store ";
                        attr = attr.slice(1);
                    }
                    if (val !== superclass && getCdlExpressionType(val) === ExpressionType.attributeValue) {
                        str += indent + mod + attr + ":\n" + 
                            convertSyntaxValue(indent + "  ", val, true);
                    } else {
                        str += indent + mod + attr + ": " + 
                            convertSyntaxValue("", val, true);
                    }
                }    
            }
            return str;
        } else {
            for (var attr in expression) {
                if (str.length > 0) {
                    str += ", ";
                }
                str += attr + ":" + convertSyntaxValue("", expression[attr], false); // escape those attributes
            }
            return "{" + str + "}";
        }
      default:
        Utilities.error("unknown type");
        return "unknown type";
    }
}

function convertSyntaxClass(levelName: string, className: string, definition: any): void {
    console.log("class " + (levelName === ""? className: levelName + "::" + className) + ":");
    console.log(convertSyntaxValue("", definition, true) + "\n");
}

function convertClassList(levelName: string, classes: {[className: string]: any}): void {
    for (var className in classes) {
        convertSyntaxClass(levelName, className, classes[className]);
    }
}

function convertSyntax(): void {
    for (var i: number = 0; i < includedClassConf.length; i++) {
        var level = includedClassConf[i];
        for (var j: number = 0; j < level.classes.length; j++) {
            convertClassList(level.name, level.classes[j]);
        }
    }
    convertSyntaxClass("", "ScreenArea", screenArea);
}

var compilerCache: any;
var pathToCompilerCache: ResourcePath;

function loadCompilerCache(cont:() => void): void {
    var pathToApp: ResourcePath =
        runtimeEnvironment.pathFunctions.getPath(runtimeEnvironment.appName); 

    pathToCompilerCache = pathToApp.replaceExtension("cache");
    if (pathToApp.extension === "html") {
        pathToCompilerCache = pathToCompilerCache.down("intermediate");
    }
    pathToCompilerCache = pathToCompilerCache.getURLResourcePath();

    var client = new XMLHttpRequest();

    client.onerror = (errorEvent: ErrorEvent): void => {
        console.log("loadCompilerCache error:", errorEvent);
    }
    console.log("loadCompilerCache", pathToCompilerCache.getResourceString());
    client.open("GET", pathToCompilerCache.getResourceString(), true);
    client.onabort = (): void => {
        console.log("loadCompilerCache aborted");
    }
    client.onerror = (errorEvent: ErrorEvent): void => {
        if (errorEvent === undefined) {
            Utilities.warn("no cache");
            cont();
        } else {
            console.log("loadCompilerCache error:", errorEvent);
        }
    }
    client.onloadend = (): void => {
        compilerCache = JSON.parse(client.responseText);
        cont();
    }
    client.send();
}

// take an array of objects, merge by using the attribute from the
//  earliest object in which it appears.
// the merge is 'flat' - each object in the array is considered as a flat
//  set of attributes.
// Called from fsPositioningConstants.js
function mergeCdlConstants(objList: any[]): void {
    var res: any = {};

    for (var i: number = objList.length - 1; i >= 0; i--) {
        var obj: any = objList[i];
        for (var attr in obj) {
            res[attr] = obj[attr];
        }
    }
    return res;
}

var functionNodeToExpressionPaths: number[/*areaTemplateId*/][/*defunId*/][/*FunctionNode.id*/][/*index of the alternative path: even numbers are source template id, subsequent number is index in string cache*/] = [[]];
var functionNodeToExpressionPathsStringCache: string[] = [];

function mapFunctionNodesToExpressionPaths(): void {
    for (var areaTemplateId = 1; areaTemplateId < areaTemplates.length; areaTemplateId++) {
        var area: AreaTemplate = areaTemplates[areaTemplateId];
        functionNodeToExpressionPaths.push([]);
        if (area.displayFunction !== undefined) {
            area.displayFunction.tagExpressionPath(areaTemplateId, 0, "display");
        }
        if (area.independentContentPosition !== undefined) {
            area.independentContentPosition.tagExpressionPath(areaTemplateId, 0, "independentContentPosition");
        }
        if (area.propagatePointerInArea !== undefined) {
            area.propagatePointerInArea.tagExpressionPath(areaTemplateId, 0, "propagatePointerInArea");
        }
        for (var attr in area.positionFunctions) {
            area.positionFunctions[attr].tagExpressionPath(areaTemplateId, 0, "position." + attr);
        }
        for (var attr in area.stackingFunctions) {
            area.stackingFunctions[attr].tagExpressionPath(areaTemplateId, 0, "stacking." + attr);
        }
        for (var attr in area.writeFunctions) {
            area.writeFunctions[attr].tagExpressionPath(areaTemplateId, 0, "write." + attr);
        }
        for (var attr in area.setFunctions) {
            if (area.setFunctions[attr].data !== undefined) {
                area.setFunctions[attr].data.tagExpressionPath(areaTemplateId, 0, "child." + attr + ".data");
            }
            if (area.setFunctions[attr].partner !== undefined) {
                area.setFunctions[attr].partner.tagExpressionPath(areaTemplateId, 0, "child." + attr + ".partner");
            }
        }
        var content: PathTreeNode = area.areaNode.next["content"];
        if (content !== undefined && area.doesExist && content.functionNode !== undefined) {
            content.functionNode.tagExpressionPath(areaTemplateId, 0, "content");
        }
        var context: PathTreeNode = area.areaNode.next["context"];
        if (context !== undefined && area.doesExist) {
            for (var attr in context.next) {
                var expr: PathTreeNode = context.next[attr];
                if (expr.functionNode !== undefined && expr.functionNode.cycleNr === gCycleNr) {
                    expr.functionNode.tagExpressionPath(areaTemplateId, 0, "context." + attr);
                }
            }
        }
    }
    if (mode !== "dump") {
        console.log("var functionNodeToExpressionPaths = [");
        for (var areaTemplateId = 0; areaTemplateId < functionNodeToExpressionPaths.length; areaTemplateId++) {
            var templatePaths: number[][][] = functionNodeToExpressionPaths[areaTemplateId];
            if (templatePaths === undefined) {
                console.log(" undefined,");
            } else {
                console.log(" [");
                for (var i = 0; i < templatePaths.length; i++) {
                    var defunPaths: number[][] = templatePaths[i];
                    if (defunPaths === undefined) {
                        console.log("  undefined,");
                    } else {
                        console.log("  [");
                        for (var j = 0; j < defunPaths.length; j++) {
                            console.log("   ", JSON.stringify(defunPaths[j]), ",");
                        }
                        console.log("  ],");
                    }
                }
                console.log(" ],");
            }
        }
        console.log("];");
        console.log("var functionNodeToExpressionPathsStringCache = [");
        for (var i = 0; i < functionNodeToExpressionPathsStringCache.length; i++) {
                console.log(" ", JSON.stringify(functionNodeToExpressionPathsStringCache[i]), ",");
        }
        console.log("];");
    }
}
