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
/// <reference path="predefinedFunctions.ts" />
/// <reference path="buildFunctionNode.ts" />
/// <reference path="pathTreeNode.ts" />

class ErrorContext {
    nodes: PathTreeNode[] = [];
    values: PathInfo[] = [];

    getErrorContext(fullLocation: boolean = false): string {
        if (this.nodes.length === 0) {
            return undefined;
        }
        var topNode: PathTreeNode = this.nodes[this.nodes.length - 1];
        var topValue: PathInfo = this.values[this.values.length - 1];
        if (topValue === undefined && topNode.values.length === 1) {
            topValue = topNode.values[0];
        }
        return topValue === undefined? getShortChildPath(topNode.getPath()):
               fullLocation? topValue.getFullErrorLocation():
               topValue.getShortErrorLocation();
    }

    enter(node: PathTreeNode, value: PathInfo): void {
        this.nodes.push(node);
        this.values.push(value);
    }

    leave(): void {
        this.values.pop();
        this.nodes.pop();
    }
}

var gErrContext: ErrorContext = new ErrorContext();

/// @class ChildExistence
/// Represents conditional existence for an area. If the qualifiers in PathInfo
/// are true, the area exists. There can be more than one ChildExistence
/// value for one area.
class ChildExistence extends ChildInfo {
    toString(): string {
        return "<exist>";
    }
}

/// @class ClassName
/// Represents class membership for an area. If the qualifiers in PathInfo are
/// true, the area belongs to this class. There can be more than one ClassName
/// value per class for one area. This information is used by areaOfClass,
/// classOfArea and A_(). At runtime, it can be found at the area's export id 0
/// as a AV mapping the class name to a boolean expression.
/// The priority (used for inspection only) is stored in the prio field.
class ClassName extends ChildInfo {
    className: any;
    prio: number;

    constructor(className: any) {
        super();
        this.className = className;
    }

    toString(): string {
        return "class " + convertValueToString(this.className, "");
    }
}

// The write nodes for params setAttr and setData are local, and always at the
// same spot.
const areaMessageIndex: number = 0;
const areaParamIndex: number = areaMessageIndex + 1;

class ToMergeNode {
    to: FunctionNode;
    merge: FunctionNode;
    writeNode: WriteNode;
    scheduleStep: number = undefined;

    constructor(to: FunctionNode, merge: FunctionNode, writeNode: WriteNode) {
        this.to = to;
        this.merge = merge;
        this.writeNode = writeNode;
    }

    toString(): string {
        return this.to.idStr() + ":=" + this.merge.idStr();
    }

    toExportString(origin: number): string {
        return "_tm(" + this.to.idExpStr(origin) + ", " +
            this.merge.idExpStr(origin) + ", " +
            this.scheduleStep + ")";
    }

    walkFunctionNodes(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode): void {
        this.to = process(this.to, stack, true);
        this.merge = process(this.merge, stack, true);
        this.scheduleStep =
            Math.max(this.writeNode.scheduleStep,
                Math.max(this.to.scheduleStep, this.merge.scheduleStep)) + 1;
    }

    markWritablePath(): void {
        this.to.setPriority(Priority.writePriority);
        this.to.markWritablePath();
        this.merge.setPriority(Priority.writePriority);
    }

    tagExpressionPath(templateId: number, defunId: number, path: string): void {
        this.to.tagExpressionPath(templateId, defunId, path + ".to");
        this.merge.tagExpressionPath(templateId, defunId, path + ".merge");
    }
}

// Bunch of 'm nodes. The upon clause is realized as a watcher on the resulting
// expression, and will execute the matching instantiations of the ToMergeNodes
// when the result of the expression changes.
class WriteNode {
    upon: FunctionNode;
    whenBecomesTrue: {
        continuePropagation: FunctionNode;
        actions: {[name: string]: ToMergeNode};
    };
    whenBecomesFalse: {
        continuePropagation: FunctionNode;
        actions: {[name: string]: ToMergeNode};
    }
    scheduleStep: number;
    
    static strMap(cond: {[name: string]: ToMergeNode}): string {
        var str: string = "{";

        for (var name in cond) {
            if (str.length !== 1) str += ",";
            str += name + ":" + cond[name].toString();
        }
        return str + "}";
    }

    static expMap(origin: number, cond: {[name: string]: ToMergeNode}): string {
        if (cond === undefined) {
            return "undefined";
        } else {
            var str: string = "{";
            for (var name in cond) {
                if (str.length !== 1) str += ",";
                str += name + ":" + cond[name].toExportString(origin);
            }
            return str + "}";
        }
    }

    walkFunctionNodes(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode): void {

        function cacheMap(map: {[attr: string]: ToMergeNode}): void {
            for (var attr in map) {
                map[attr].walkFunctionNodes(stack, process);
            }
        }

        this.upon = process(this.upon, stack, true);
        this.scheduleStep = this.upon.scheduleStep + 1;
        if (this.whenBecomesTrue !== undefined) {
            if (this.whenBecomesTrue.continuePropagation !== undefined) {
                this.whenBecomesTrue.continuePropagation =
                    process(this.whenBecomesTrue.continuePropagation, stack, true);
                this.scheduleStep = Math.max(this.scheduleStep, this.whenBecomesTrue.continuePropagation.scheduleStep) + 1;
            }
            cacheMap(this.whenBecomesTrue.actions);
        }
        if (this.whenBecomesFalse !== undefined) {
            if (this.whenBecomesFalse.continuePropagation !== undefined) {
                this.whenBecomesFalse.continuePropagation =
                    process(this.whenBecomesFalse.continuePropagation, stack, true);
                this.scheduleStep = Math.max(this.scheduleStep, this.whenBecomesFalse.continuePropagation.scheduleStep) + 1;
            }
            cacheMap(this.whenBecomesFalse.actions);
        }
    }

    toString(): string {
        return this.upon.idStr() + "?" +
            (this.whenBecomesTrue === undefined? "": WriteNode.strMap(this.whenBecomesTrue.actions)) + ":" +
            (this.whenBecomesFalse === undefined? "": WriteNode.strMap(this.whenBecomesFalse.actions));
    }

    toExportString(origin: number): string {
        return this.upon.idExpStr(origin) + ", " +
            (this.whenBecomesTrue === undefined || this.whenBecomesTrue.continuePropagation === undefined? "undefined": this.whenBecomesTrue.continuePropagation.idExpStr(origin)) + ", " +
            (this.whenBecomesTrue === undefined? "undefined": WriteNode.expMap(origin, shallowCopyMinus(this.whenBecomesTrue.actions, "continuePropagation"))) + ", " +
            (this.whenBecomesFalse === undefined || this.whenBecomesFalse.continuePropagation === undefined? "undefined": this.whenBecomesFalse.continuePropagation.idExpStr(origin)) + ", " +
            (this.whenBecomesFalse === undefined? "undefined": WriteNode.expMap(origin, shallowCopyMinus(this.whenBecomesFalse.actions, "continuePropagation"))) + ", " +
            this.scheduleStep;
    }

    markWritablePath(): void {
        this.upon.setPriority(Priority.writePriority);
        if (this.whenBecomesTrue !== undefined) {
            for (var name in this.whenBecomesTrue.actions) {
                this.whenBecomesTrue.actions[name].markWritablePath();
            }   
        }
        if (this.whenBecomesFalse !== undefined) {
            for (var name in this.whenBecomesFalse.actions) {
                this.whenBecomesFalse.actions[name].markWritablePath();
            }
        }
    }

    tagExpressionPath(templateId: number, defunId: number, path: string): void {
        this.upon.tagExpressionPath(templateId, defunId, path + ".upon");
        if (this.whenBecomesTrue !== undefined) {
            for (var name in this.whenBecomesTrue.actions) {
                this.whenBecomesTrue.actions[name].tagExpressionPath(templateId, defunId, path + ".true");
            }
        }
        if (this.whenBecomesFalse !== undefined) {
            for (var name in this.whenBecomesFalse.actions) {
                this.whenBecomesFalse.actions[name].tagExpressionPath(templateId, defunId, path + ".False");
            }
        }
    }
}

var areaTemplates: AreaTemplate[] = [];

function verifyTypeEquality(fn1: FunctionNode, fn2: FunctionNode, src: string): void {
    if (!fn1.valueType.isEqual(fn2.valueType)) {
        Utilities.warnOnce(src + ": " + fn1.idStr() + ", " + fn2.idStr());
    }
}

// Ensures that all expressions in the whole line from the top area down to
// areaTemplate have been processed; when called during the caching phase, this
// means they know their schedule step.
function ensureTemplateDependency(
    areaTemplate: AreaTemplate, stack: NumberSet,
    process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode): void
{
    if (areaTemplate.expressionsHaveBeenCached === false) {
        if (areaTemplate.parent !== undefined &&
              areaTemplate.parent.expressionsHaveBeenCached === false) {
            ensureTemplateDependency(areaTemplate.parent, stack, process);
        }
        areaTemplate.walkFunctionNodes(false, stack, process);
    }
}

class AreaTemplate {
    static nextAreaTemplateId: number = 1;
    
    // The node in the cdl
    areaNode: PathTreeNode;
    // An arbitrary index
    id: number;
    // The template of the parent area
    parent: AreaTemplate;
    // Name under which this template is the child
    childName: string;
    // The expression on which the area set is based; if dataExpr and
    // partnerExpr are both undefined, the child is a static area
    dataExpr: PathTreeNode;
    // The expression on which the intersection set is based
    partnerExpr: PathTreeNode;
    // List of nodes that other areas may need
    exports: {[exportId: number]: FunctionNode} = {};
    // Series of qualifier nodes that determine existence of this area
    existenceQualifiers: SingleQualifier[][];
    // Children templates
    children: {[childName: string]: AreaTemplate} = {};
    // Embedding
    embeddingInReferred: boolean = false;
    cacheStage: string[] = []; // for error messages

    // The expressions in this template
    expressionCache: ExpressionCache[];

    // FunctionNode list per template, ordered by scheduleStep
    functionNodes: FunctionNode[] = [];
    // FunctionNode cache per defun
    defunFunctionNodes: {[defunNr: number]: FunctionNode[]} = {};

    // classes of this area at the description level, and the
    // qualifiers that enable it
    classes: {[name: string]: PathInfo[]};
    // Sorting priority for class names
    classNamePrio: {[name: string]: number};
    // The qualifiers that control the existence of this child. Empty means
    // the area does not exist.
    childExistence: PathInfo[] = [];
    // When false, area cannot be instantiated.
    doesExist: boolean;
    // When false, this area nor any of its children, is rendered on screen.
    // (note that it is undefined during runtime when it is rendered).
    isDisplayArea: boolean;
    // Serves to check caching from projection and selection function nodes
    expressionsHaveBeenCached: boolean = false;
    // All expressions in this area must be later than this step
    scheduleStep: number = undefined;

    // Internal functions
    displayFunction: FunctionNode;
    foreignInterfaceDisplayFunction: FunctionNode;
    positionFunctions: {[name: string]: FunctionNode};
    stackingFunctions: {[name: string]: FunctionNode};
    setFunctions: {[childName: string]: {data?: FunctionNode; partner?: FunctionNode;}};
    independentContentPosition: FunctionNode;
    propagatePointerInArea: FunctionNode;
    writeFunctions: {[childName: string]: WriteNode};

    constructor(areaNode: PathTreeNode, parent: AreaTemplate, childName: string,
                dataExpr: PathTreeNode, partnerExpr: PathTreeNode)
    {
        this.areaNode = areaNode;
        this.id = AreaTemplate.nextAreaTemplateId++;
        this.parent = parent;
        this.childName = childName;
        this.dataExpr = dataExpr;
        this.partnerExpr = partnerExpr;
        if (doCompileTimeChecks) {
            this.expressionCache = [new ExpressionCache()];
        }
        if (this.partnerExpr !== undefined) {
            // check for embedding; we only recognize constants here, and
            // anything else than "referred" is considered "expression"
            this.embeddingInReferred = "embedding" in areaNode.next &&
                areaNode.next["embedding"].valueEquals("referred");
        }
    }

    // Returns the number of indices for areas based on this template
    getNrParentIndices(): number {
        var ptr: AreaTemplate = this;
        var len = 0;

        while (ptr !== undefined) {
            if (!ptr.isStaticChild())
                len++;
            ptr = ptr.parent;
        }
        return len;
    }

    addChild(childName: string, childAreaTemplate: AreaTemplate): void {
        if (childAreaTemplate !== undefined) {
            this.children[childName] = childAreaTemplate;
        }
    }

    isStaticChild(): boolean {
        return this.dataExpr === undefined && this.partnerExpr === undefined;
    }

    // Adds a node that represents "myMessage" with fixed ids in cache.
    addMyMessageNode():void {
        var localMessageType: ValueType = globalMessageNode.valueType.deepCopy();

        localMessageType.object["recipient"] = new ValueType().addArea(this.id, [_r(1, 1)]);
        this.functionNodes[areaMessageIndex] = FunctionNode.cacheDirectly(
            new MessageQueueNode(["message"], this.id, 0, localMessageType, gUndefinedExpr));
    }

    // Adds the functions that give the area the information it needs. Currently
    // they are: display, position, independentContentPosition, stacking, and
    // write.
    addInternalFunctions() {
        var displayNode: PathTreeNode = this.areaNode.getNodeAtPath(["display"]);
        var positionNode: PathTreeNode = this.areaNode.getNodeAtPath(["position"]);
        var foreignInterfaceNode: PathTreeNode = this.areaNode.getNodeAtPath(["display", "foreign","value"]);
        var stackingNode: PathTreeNode = this.areaNode.getNodeAtPath(["stacking"]);
        var icpNode: PathTreeNode = this.areaNode.getNodeAtPath(["independentContentPosition"]);
        var ppiaNode: PathTreeNode = this.areaNode.getNodeAtPath(["propagatePointerInArea"]);
        var writeNode: PathTreeNode = this.areaNode.getNodeAtPath(["write"]);
        var fn: FunctionNode;

        function pointHasEmptyElement(fn: any): boolean {
            if (fn instanceof VariantFunctionNode) {
                return fn.functionNodes.length === 1 &&
                       pointHasEmptyElement(fn.functionNodes[0]);
            } if (fn instanceof AVFunctionNode) {
                return "element" in fn.attributes &&
                       fn.attributes["element"].isEmptyOS();
            } else if (fn instanceof ConstNode) {
                return fn.value instanceof Object && "element" in fn.value &&
                       objectEqual(fn.value.element, []);
            } else if (fn instanceof Object) {
                return "element" in fn && objectEqual(fn.element, []);
            }
            return false;
        }

        function pairHasEmptyElement(fn: any): boolean {
            if (fn instanceof VariantFunctionNode) {
                return fn.functionNodes.length === 1 &&
                       pairHasEmptyElement(fn.functionNodes[0]);
            } if (fn instanceof AVFunctionNode) {
                if ("point1" in fn.attributes && "point2" in fn.attributes) {
                    return pointHasEmptyElement(fn.attributes["point1"]) ||
                           pointHasEmptyElement(fn.attributes["point2"]);
                }
                return true; // at least one point is missing
            } else if (fn instanceof ConstNode) {
                if (fn.value instanceof Object && "point1" in fn.value &&
                      "point2" in fn.value) {
                    return pointHasEmptyElement(fn.value["point1"]) ||
                           pointHasEmptyElement(fn.value["point2"]);
                }
            } else if (fn instanceof Object) {
                if ("point1" in fn && "point2" in fn) {
                    return pointHasEmptyElement(fn["point1"]) ||
                           pointHasEmptyElement(fn["point2"]);
                }
            }
            return false;
        }

        function hasEmptyElement(fn: FunctionNode): boolean {
            if (fn instanceof VariantFunctionNode) {
                return fn.functionNodes.length === 1 &&
                       hasEmptyElement(fn.functionNodes[0]);
            } else if (fn instanceof AVFunctionNode) {
                if ("pair1" in fn.attributes && "pair2" in fn.attributes) {
                    if (!pairHasEmptyElement(fn.attributes["pair1"]) ||
                         !pairHasEmptyElement(fn.attributes["pair2"])) {
                        return false;
                    }
                }
                if ("point1" in fn.attributes && "point2" in fn.attributes) {
                    return pairHasEmptyElement(fn);
                }
            } else if (fn instanceof ConstNode) {
                if (fn.value instanceof Object && "pair1" in fn.value &&
                      "pair2" in fn.value) {
                    if (!pairHasEmptyElement(fn.value["pair1"]) ||
                         !pairHasEmptyElement(fn.value["pair2"])) {
                        return false;
                    }
                }
                if (fn.value instanceof Object && "point1" in fn.value &&
                      "point2" in fn.value) {
                    return pairHasEmptyElement(fn);
                }
            }
            return false;
        }

        this.doesExist = true;
        this.existenceQualifiers = [];
        for (var i: number = 0; i !== this.childExistence.length; i++) {
            var qwc: QualifierWithCycles = buildQualifier(
                this.childExistence[i].qualifierTerms,
                (this.parent === undefined? undefined: this.parent.id),
                undefined, undefined, undefined);
            if (qwc !== undefined) {
                var simplifiedQualifiers: SingleQualifier[] = [];
                for (var j = 0; j < qwc.qualifiers.length; j++) {
                    // Flatten qualifiers from variants in qualifiers
                    simplifiedQualifiers = simplifiedQualifiers.concat(
                        qwc.qualifiers[j].simplifyBooleanVariant());
                }
                this.existenceQualifiers.push(simplifiedQualifiers);
            }
        }
        if (this.existenceQualifiers.length === 0) {
            // Utilities.warnOnce("non-existing area: " + getShortChildPath(this.areaNode.getPath()));
            this.doesExist = false;
            return;
        }

        _suppressSet = true;
        if (displayNode !== undefined) {
            fn = buildFunctionNode(displayNode, this.id, 0, true);
            if (fn !== undefined) {
                this.displayFunction = fn;
            }
        }
        if (foreignInterfaceNode !== undefined) {
            fn = buildFunctionNode(foreignInterfaceNode, this.id, 0, true);
            if (fn !== undefined) {
                this.foreignInterfaceDisplayFunction = fn;
            }
        }
        if (positionNode !== undefined) {
            if (positionNode.opaque)
                Utilities.error("opaque position");
            this.positionFunctions = {};
            for (var constraintName in positionNode.next) {
                fn = buildFunctionNode(positionNode.next[constraintName], this.id, 0, true);
                if (fn !== undefined) {
                    if (hasEmptyElement(fn)) {
                        gErrContext.enter(positionNode, undefined);
                        Utilities.warnOnce("empty positioning constraint: " + constraintName + "@" + this.id);
                        gErrContext.leave();
                    }
                    this.positionFunctions[constraintName] = fn;
                }
            }
        }
        if (stackingNode !== undefined) {
            if (stackingNode.opaque)
                Utilities.error("opaque stacking");
            this.stackingFunctions = {};
            for (var constraintName in stackingNode.next) {
                fn = buildFunctionNode(stackingNode.next[constraintName], this.id, 0, false);
                if (fn !== undefined)
                    this.stackingFunctions[constraintName] = fn;
            }
        }
        if (writeNode !== undefined) {
            if (writeNode.opaque)
                Utilities.error("opaque write");
            this.writeFunctions = {};
            for (var writeName in writeNode.next) {
                var wrNode: WriteNode = buildWriteNode(writeNode.next[writeName], this.id);
                if (wrNode === undefined) {
                    gErrContext.enter(writeNode.next[writeName], undefined);
                    Utilities.warnOnce("write without upon: " + writeName);
                    gErrContext.leave();
                } else {
                    this.writeFunctions[writeName] = wrNode;
                }
            }
        }
        if (icpNode !== undefined) {
            fn = buildFunctionNode(icpNode, this.id, 0, undefined);
            if (fn !== undefined) {
                this.independentContentPosition = fn;
            }
        }
        if (ppiaNode !== undefined) {
            fn = buildFunctionNode(ppiaNode, this.id, 0, undefined);
            if (fn !== undefined) {
                this.propagatePointerInArea = fn;
            }
        }
        _suppressSet = false;
        this.determineClassMembership();
        
        for (var childName in this.children) {
            var child = this.children[childName];
            if (!child.isStaticChild()) {
                if (this.setFunctions === undefined) {
                    this.setFunctions = {};
                }
                if (!(childName in this.setFunctions)) {
                    this.setFunctions[childName] = {};
                }
            }
            if (child.dataExpr !== undefined && child.dataExpr.needsResolution()) {
                var dataExpr = buildFunctionNode(child.dataExpr, this.id, 0, undefined);
                var areaSetContentType = dataExpr !== undefined?
                                       dataExpr.valueType.copy().replaceSize(1):
                                       new ValueType().addSize(1);
                if (dataExpr !== undefined) {
                    this.setFunctions[childName].data = dataExpr;
                } else {
                    delete this.setFunctions[childName].data;
                }
                // Define/update the type of param.areaSetContent here; it's
                // the same as that of the data that defines the set, except it
                // has size 1.
                // attr is always data; we assume it's a number or a string;
                // this changes when identity can be an object (or an area).
                // see also: addParamNodes();
                child.functionNodes[areaParamIndex].mergeOutput(
                    new ValueType().addObject({
                        areaSetAttr: new ValueType().addNumber().addString().addSize(1),
                        areaSetContent: areaSetContentType
                    }).addSize(1)
                );
            }
            if (child.partnerExpr !== undefined) {
                if (child.partnerExpr.needsResolution()) {
                    this.setFunctions[childName].partner = buildFunctionNode(
                        child.partnerExpr, this.id, 0, undefined);
                } else {
                    this.setFunctions[childName].partner = child.partnerExpr.functionNode;
                }
                if (this.setFunctions[childName].partner === undefined) {
                    delete this.setFunctions[childName].partner;
                }
            }
        }
    }

    determineClassMembership(): void {
        if (this.classes !== undefined &&
              (this.exports[0] === undefined || this.exports[0].outdated())) {
            // Build function node that computes { x1: true/false, x2:
            // true/false, ... } for all class memberships. If a class name is
            // not present, it should be regarded as false.
            var membership: {[className: string]: FunctionNode} = {};
            var descr: {[className: string]: ValueType} = {};
            var localToArea: number = undefined;
            for (var className in this.classes) {
                var memberShipFun: FunctionNode = buildQualifierNode(
                    this.classes[className], this.id, 0,
                    undefined, undefined, undefined);
                if (memberShipFun !== undefined && !memberShipFun.isAlwaysFalse()) {
                    membership[className] = memberShipFun;
                    descr[className] = new ValueType().addBoolean().addSize(1);
                    localToArea = mergeLocality(localToArea,
                                                membership[className].localToArea);
                }
            }
            // Note that we don't make it a ConstNode (when possible), in order
            // to always provide direct access to the function that determines
            // class membership.
            this.exports[0] = new AVFunctionNode(membership, localToArea, 0,
                                    new ValueType().addObject(descr).addSize(1),
                                    undefined, false, {});
        }
    }

    // Builds the setData expression before the call to addInternalFunctions,
    // since someone needs to know the type of param.areaSetContent, which is
    // the same as the type of the set.
    determineSetContent(): void {
        if (this.parent.setFunctions === undefined) {
            this.parent.setFunctions = {};
        }
        if (!(this.childName in this.parent.setFunctions)) {
            this.parent.setFunctions[this.childName] = {};
        }
        if (this.dataExpr !== undefined && this.dataExpr.needsResolution()) {
            var prevDataFN: FunctionNode = this.parent.setFunctions[this.childName].data;
            var prevType: ValueType = prevDataFN === undefined? undefined: prevDataFN.valueType;
            this.parent.setFunctions[this.childName].data =
                buildFunctionNode(this.dataExpr, this.parent.id, 0, undefined);
            if (prevType === undefined ||
                  !this.parent.setFunctions[this.childName].data.valueType.subsumes(prevType)) {
                signalOutputChange(undefined, {
                    type: "valueTypeChange",
                    origType: prevType,
                    newType: this.parent.setFunctions[this.childName].data.valueType
                });
            }
        }
        if (this.parent.setFunctions[this.childName].data !== undefined) {
            this.functionNodes[areaParamIndex].mergeOutput(
                new ValueType().addObject({
                    areaSetAttr: new ValueType().addNumber().addString().addSize(1),
                    areaSetContent: this.parent.setFunctions[this.childName].data.valueType.copy().replaceSize(1)
                }).addSize(1)
            );
        }
        if (this.partnerExpr !== undefined && this.partnerExpr.needsResolution()) {
            var prevPartnerFN: FunctionNode = this.parent.setFunctions[this.childName].partner
            var prevType: ValueType = prevPartnerFN === undefined? undefined: prevPartnerFN.valueType;
            this.parent.setFunctions[this.childName].partner =
                buildFunctionNode(this.partnerExpr, this.parent.id, 0, undefined);
            if (prevType === undefined ||
                  !this.parent.setFunctions[this.childName].partner.valueType.subsumes(prevType)) {
                signalOutputChange(undefined, {
                    type: "valueTypeChange",
                    origType: prevType,
                    newType: this.parent.setFunctions[this.childName].partner.valueType
                });
            }
        }
    }

    /**
     * Builds the (single) param: node for this area template. All param data is
     * stored here, so we go through some trouble to set its type properly. 
     */
    addParamNodes(): void {
        var paramNode: PathTreeNode = new PathTreeNode(this.areaNode, this.areaNode, "param");
        var localToArea: number = this.id;
        var paramValueType: ValueType = new ValueType().addObject({
                pointerInArea: new ValueType().addBoolean().addSize(1),
                dragInArea: new ValueType().addBoolean().addSize(1)
            }).addSize(1);


        assert(!("param" in this.areaNode.next), "param already in path");
        this.areaNode.next["param"] = paramNode;

        if (this.dataExpr !== undefined) {
            // param.areaSetContent is initialized with an undefined value type.
            // The type gets set when the set data is known. param.areaSetAttr
            // is defined as a number or a string, but perhaps it can be
            // something else. There is no code to analyze the value type of the
            // identity, though.
            paramValueType.addAttribute("areaSetAttr",
                new ValueType().addNumber().addString().addSize(1));
            paramValueType.addAttribute("areaSetContent",
                new ValueType().addSize(1));
        }

        if (this.hasInput()) {
            var inputTypeSpecs: string[] = this.inputTypes();
            var inputType: ValueType = new ValueType();
            if (inputTypeSpecs.indexOf(undefined) >= 0) {
                inputType.addAnyData();
            }
            if (inputTypeSpecs.indexOf("text") >= 0 ||
                  inputTypeSpecs.indexOf("password") >= 0) {
                inputType.addString();
            }
            if (inputTypeSpecs.indexOf("number") >= 0) {
                inputType.addNumber();
            }
            paramValueType.addAttribute("input", new ValueType().addObject({
                value: inputType.addSize(0, 1),
                focus: new ValueType().addBoolean().addSize(1),
                selectionStart: new ValueType().addNumber().addSize(1),
                selectionEnd: new ValueType().addNumber().addSize(1),
                selectionDirection: new ValueType().addString().addSize(1)
            }).addSize(1));
        }

        paramNode.functionNode = FunctionNode.cacheDirectly(
            buildStorageNode(["param"], localToArea, 0, paramValueType, true));
    }

    hasInput(): boolean {
        return this.areaNode.getNodeAtPath(["display", "text", "input"]) !== undefined;
    }

    inputTypes(): string[] {
        var node: PathTreeNode = this.areaNode.getNodeAtPath(["display", "text", "input", "type"]);

        if (node !== undefined && node.values !== undefined) {
            return node.values.map(function(pi: PathInfo): string {
                return typeof(pi.origExpr) === "string"? pi.origExpr: undefined;
            });
        }
        return [];
    }

    // Sets the cycle nr for the nodes involved in myMessage, and the param
    // section: they are not updated spontaneously, since they are not present
    // in the cdl.
    updateCycle(): void {
        var messageNode = <MessageQueueNode> this.functionNodes[areaMessageIndex]; 
        var localMessageType: ValueType = globalMessageNode.valueType.deepCopy();

        localMessageType.object["recipient"] = new ValueType().addArea(this.id, [_r(1, 1)]);
        messageNode.makeCompatible(localMessageType);
        messageNode.updateCycle();
        this.functionNodes[areaParamIndex].updateCycle();
    }

    addExistence(node: PathTreeNode): void {
        if (node.values !== undefined) {
            for (var i: number = 0; i !== node.values.length; i++) {
                switch (node.values[i].expression.type) {
                  case ExpressionType.childExistence:
                    this.childExistence.push(node.values[i]);
                    break;
                  case ExpressionType.className:
                    break;
                  default:
                    Utilities.error("unknown value type in addExistence");
                }
            }
        }
    }

    addClasses(node: PathTreeNode): void {
        var classNamePrio: number = 1;

        if (node.values !== undefined) {
            for (var i: number = 0; i !== node.values.length; i++) {
                if (node.values[i].expression.type === ExpressionType.className) {
                    if (this.classes === undefined) {
                        this.classes = {};
                        this.classNamePrio = {};
                    }
                    var classNames: any = node.values[i].expression.expression.className;
                    if (classNames instanceof MoonOrderedSet) {
                        classNames = classNames.os;
                    } else if ((typeof(classNames) === "string") ||
                               (classNames === superclass)) {
                        classNames = [classNames];
                    } else {
                        Utilities.error("error in class name: " + JSON.stringify(classNames));
                    }
                    for (var j: number = 0; j !== classNames.length; j++) {
                        var className: any = classNames[j];
                        if (className === superclass) {
                            className = "::superclass";
                        }

                        if (typeof(className) !== "string") {
                            Utilities.error("error in class name: " + JSON.stringify(className));
                        }
                        if (className in this.classes) {
                            this.classes[className].push(node.values[i]);
                        } else {
                            this.classNamePrio[className] = classNamePrio++;
                            this.classes[className] = [node.values[i]];
                        }
                    }
                }
            }
        }
    }

    walkFunctionNodes(
        cacheAll: boolean, stack: NumberSet,
        process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode): void
    {
        var self: AreaTemplate = this;
        var csi: number;

        if (FunctionNode.cacheDbg !== undefined) {
            csi = FunctionNode.cacheDbg.length;
            FunctionNode.cacheDbg.push(this);
        }

        function cacheExistenceQuals(qualifiers: SingleQualifier[][]): void {
            if (qualifiers === undefined) {
                return;
            }
            for (var i: number = 0; i !== qualifiers.length; i++) {
                for (var j: number = 0; j !== qualifiers[i].length; j++) {
                    if (FunctionNode.cacheDbg !== undefined) {
                        self.cacheStage[csi] = "existence " +
                            qualifiers[i][j].toSymString();
                    }
                    qualifiers[i][j].functionNode = process(
                        qualifiers[i][j].functionNode, stack, false);
                }
            }
        }

        function cacheMap(map: {[attr: number]: FunctionNode}): void;
        function cacheMap(map: {[attr: string]: FunctionNode}): void {
            for (var attr in map) {
                map[attr] = process(map[attr], stack, true);
            }
        }

        if (!this.expressionsHaveBeenCached && this.doesExist) {
            if (this.expressionsHaveBeenCached !== false) {
                Utilities.error("cycle in area existence: @" + this.id +
                              "=" + getShortChildPath(this.areaNode.getPath()) +
                              " depends on itself?");
                return;
            }
            this.expressionsHaveBeenCached = undefined;

            if (FunctionNode.cacheDbg !== undefined){
                this.cacheStage[csi] = "existence";
            }
            cacheExistenceQuals(this.existenceQualifiers);

            if (cacheAll) {
                for (var childName in this.setFunctions) {
                    if (FunctionNode.cacheDbg !== undefined) {
                        this.cacheStage[csi] = "setFunction " + childName;
                    }
                    if (this.setFunctions[childName].data !== undefined) {
                        this.setFunctions[childName].data =
                            process(this.setFunctions[childName].data, stack, true);
                    }
                    if (this.setFunctions[childName].partner !== undefined) {
                        this.setFunctions[childName].partner =
                            process(this.setFunctions[childName].partner, stack, true);
                    }
                }
                if (FunctionNode.cacheDbg !== undefined) this.cacheStage[csi] = "displayFunction";
                this.displayFunction = process(this.displayFunction, stack, true);
                if (this.foreignInterfaceDisplayFunction !== undefined) {
                    this.foreignInterfaceDisplayFunction = process(this.foreignInterfaceDisplayFunction, stack, true);
                }
                if (FunctionNode.cacheDbg !== undefined) this.cacheStage[csi] = "exports";
                for (var exportId in this.exports) {
                    if (this.exports[exportId] === undefined) {
                        delete this.exports[exportId];
                    } else if (this.exports[exportId].outdated()) {
                        Utilities.warn("not exporting " +
                                       exportPaths[exportId].join(".") +
                                       " at @" + this.id);
                        delete this.exports[exportId];
                    }
                }
                cacheMap(this.exports);
                if (FunctionNode.cacheDbg !== undefined) this.cacheStage[csi] = "positionFunctions";
                cacheMap(this.positionFunctions);
                if (FunctionNode.cacheDbg !== undefined) this.cacheStage[csi] = "stackingFunctions";
                cacheMap(this.stackingFunctions);
                for (var wrName in this.writeFunctions) {
                    if (FunctionNode.cacheDbg !== undefined) this.cacheStage[csi] = "writeFunction " + wrName;
                    this.writeFunctions[wrName].walkFunctionNodes(stack, process);
                }
                if (FunctionNode.cacheDbg !== undefined) this.cacheStage[csi] = "independentContentPosition";
                this.independentContentPosition = process(this.independentContentPosition, stack, true);
                this.propagatePointerInArea = process(this.propagatePointerInArea, stack, true);
                this.expressionsHaveBeenCached = true;
            } else {
                this.expressionsHaveBeenCached = false;
            }
        }

        if (cacheAll) {
            for (var childName in this.children) {
                if (FunctionNode.cacheDbg !== undefined) this.cacheStage[csi] = "child " + childName;
                this.children[childName].walkFunctionNodes(true, stack, process);
            }
        }

        if (FunctionNode.cacheDbg !== undefined) FunctionNode.cacheDbg.pop();
    }

    cacheDataSetFunction(childName: string, stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode): boolean {
        var dataExpr: FunctionNode = this.setFunctions[childName].data;

        if (dataExpr === undefined) {
            return false;
        }
        if (!(dataExpr.seqNr in stack)) {
            stack[dataExpr.seqNr] = true;
            this.setFunctions[childName].data = process(dataExpr, stack, true);
            delete stack[dataExpr.seqNr];
        }
        return true;
    }

    cachePartnerSetFunction(childName: string, stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode): boolean {
        var partnerExpr: FunctionNode = this.setFunctions[childName].partner;

        if (partnerExpr === undefined) {
            return false;
        }
        if (!(partnerExpr.seqNr in stack)) {
            stack[partnerExpr.seqNr] = true;
            this.setFunctions[childName].partner = process(partnerExpr, stack, true);
            delete stack[partnerExpr.seqNr];
        }
        return true;
    }

    getScheduleStep(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode): number {
        if (this.scheduleStep !== undefined) {
            return this.scheduleStep;
        }

        var scheduleStep: number = -1;
        var csi: number;

        if (FunctionNode.cacheDbg !== undefined) {
            csi = FunctionNode.cacheDbg.length;
            FunctionNode.cacheDbg.push(this);
            this.cacheStage[csi] = "getScheduleStep";
        }

        if (this.parent !== undefined) {
            scheduleStep = this.parent.getScheduleStep(stack, process) - 1;
            if (this.dataExpr !== undefined &&
                  this.parent.cacheDataSetFunction(this.childName, stack, process)) {
                if (this.parent.setFunctions[this.childName].data.scheduleStep > scheduleStep) {
                    scheduleStep = this.parent.setFunctions[this.childName].data.scheduleStep;
                }
            }
            if (this.partnerExpr !== undefined &&
                  this.parent.cachePartnerSetFunction(this.childName, stack, process)) {
                if (this.parent.setFunctions[this.childName].partner.scheduleStep > scheduleStep) {
                    scheduleStep = this.parent.setFunctions[this.childName].partner.scheduleStep;
                }
            }
        }

        if (this.existenceQualifiers !== undefined) {
            for (var i: number = 0; i !== this.existenceQualifiers.length; i++) {
                for (var j: number = 0; j !== this.existenceQualifiers[i].length; j++) {
                    this.existenceQualifiers[i][j].functionNode =
                        process(this.existenceQualifiers[i][j].functionNode, stack, true);
                    if (this.existenceQualifiers[i][j].functionNode.scheduleStep > scheduleStep) {
                        scheduleStep = this.existenceQualifiers[i][j].functionNode.scheduleStep;
                    }
                }
            }
        }
        this.scheduleStep = scheduleStep + 1;
        if (FunctionNode.cacheDbg !== undefined) FunctionNode.cacheDbg.pop();
        return this.scheduleStep;
    }
    
    // Builds the expression that will recreate this area template
    toCreateString(): string {
        return "_ac(" +
            (this.parent === undefined? "undefined": String(this.parent.id)) + ", " +
            JSON.stringify(this.childName) + ", " + this.scheduleStep + ", " +
            String(this.doesExist) + ")";
    }

    toAreaExistenceString(): string {
        var origin: number = this.id;

        function existenceQuals(qualifiers: SingleQualifier[][]): string {
            return "[" + qualifiers.map(function(sqs: SingleQualifier[]): string {
                return "[" + sqs.map(function(sq: SingleQualifier): string {
                    return sq.toExportString(origin);
                }).join(",") + "]";
            }).join(", ") + "]";
        }

        return !this.doesExist || this.existenceQualifiers === undefined ||
                 this.existenceQualifiers.length === 0 ||
                 (this.existenceQualifiers.length === 1 &&
                  this.existenceQualifiers[0].length === 0)?
               undefined:
               "_aeq(" + existenceQuals(this.existenceQualifiers) + ")";
    }

    toClassNamePrioString(): string {
        return "_cnp(" + JSON.stringify(this.classNamePrio) + ")";
    }

    getClassNamePriority(className: string): number {
        return this.classNamePrio[className];
    }

    toIndependentContentPositionString(): string {
        return this.independentContentPosition === undefined? undefined:
            "_icp(" + this.toId(this.independentContentPosition) + ")";
    }

    toEmbeddingInReferredString(): string {
        return this.embeddingInReferred? "_eir()": undefined;
    }

    toPropagatePointerInAreaString(): string {
        return this.propagatePointerInArea === undefined? undefined:
            "_ppia(" + this.toId(this.propagatePointerInArea) + ")";
    }

    toForeignDisplayString(): string {
        return this.foreignInterfaceDisplayFunction === undefined? undefined:
            "_afi(" + this.toId(this.foreignInterfaceDisplayFunction) + ")";
    }

    // Builds the expression that will recreate this area template
    toCreateChildrenString(): string {
        if (this.setFunctions !== undefined) {
            var sdf: string = "{";
            for (var childName in this.setFunctions) {
                if (sdf.length !== 1) sdf += ", ";
                sdf += JSON.stringify(childName) + ":{data:" +
                    this.toId(this.setFunctions[childName].data) + ",partner:" +
                    this.toId(this.setFunctions[childName].partner) + "}";
            }
            sdf += "}";
            return "_acc(" + this.id + ", " + sdf + ")";
        }
        return undefined;
    }

    toIdMap(map: any): string {
        if (map === undefined || Utilities.isEmptyObj(map)) {
            return "undefined";
        } else {
            var str = "{";
            for (var name in map) {
                if (map[name] !== undefined) {
                    var attrStr: string =
                        jsIdentifierRegExp.test(name) && name !== "class"?
                        name: JSON.stringify(name);
                    if (str.length !== 1) str += ", ";
                    str += attrStr + ":" + map[name].idExpStr(this.id);
                }
            }
            return str + "}";
        }
    }

    toId(fn: FunctionNode): string {
        return fn === undefined? "undefined": fn.idExpStr(this.id);
    }

    // Builds the statement that will fill in the area properties display,
    // position, and stacking
    toExprString(): string {
        var exportsStr: string;
        if (!this.doesExist || Utilities.isEmptyObj(this.exports)) {
            exportsStr = "undefined";
        } else {
            exportsStr = this.toIdMap(this.exports);
        }
        return "_ae(" + this.id + ", " + this.toId(this.displayFunction) +
            ", " + this.toIdMap(this.positionFunctions) + ", " +
            this.toIdMap(this.stackingFunctions) + ", " + exportsStr + ")"
    }

    getDebugContextString(stack: NumberSet): string {
        var context: PathTreeNode = this.areaNode.next["context"];
        var content: PathTreeNode = this.areaNode.next["content"];
        var contentId: string = content !== undefined && this.doesExist && content.functionNode !== undefined?
            FunctionNode.cache(content.functionNode, stack, true).idExpStr(this.id): "undefined";
        var str: string = "";

        if (context !== undefined && this.doesExist) {
            for (var attr in context.next) {
                var expr: PathTreeNode = context.next[attr];
                if (expr.functionNode !== undefined && expr.functionNode.cycleNr === gCycleNr) {
                    var cached = FunctionNode.cache(expr.functionNode, stack, true);
                    if (cached !== undefined) {
                        if (str.length !== 0) str += ", ";
                        str += attr + ":" + cached.idExpStr(this.id);
                    }
                }
            }
            return "_ctx(" + this.id + ", " + contentId + ", {" + str + "})"
        }
        return "// no context";
    }

    // Does as it says on the tin
    buildExprForAllContextLabels(): void {
        var context: PathTreeNode = this.areaNode.next["context"];

        if (context !== undefined) {
            for (var attr in context.next) {
                buildFunctionNode(context.next[attr], this.id, 0, undefined);
            }
        }
    }

    // Builds the statements that will add the write section to the template
    getWritesString(): string {
        if (this.writeFunctions === undefined) {
            return undefined;
        }
        var str: string = "";
        for (var wrName in this.writeFunctions) {
            var wrNode: WriteNode = this.writeFunctions[wrName];
            if (str !== "") str += "\n";
            str += "_aw(" + this.id + ", " + JSON.stringify(wrName) + ", " +
                wrNode.toExportString(this.id) + ")";
        }
        return str;
    }

    markWritablePath(): void {
        for (var name in this.writeFunctions) {
            this.writeFunctions[name].markWritablePath();
        }
    }

    markNonExistingChildren(state: boolean): void {
        state = state && this.doesExist;
        for (var childName in this.children) {
            this.children[childName].markNonExistingChildren(state);
        }
        if (!state) {
            this.doesExist = false;
            this.existenceQualifiers = [
                [new SingleQualifier(
                    buildSimpleFunctionNode(gTrueExpr, undefined, undefined, 0,
                         undefined, undefined, undefined, undefined, undefined),
                    "<nonExisting>", false, undefined)
                ]
            ];
            this.dataExpr = undefined;
            this.partnerExpr = undefined;
            this.exports = {};
            this.children = {};
            this.functionNodes = [];
            this.defunFunctionNodes = {};
            this.displayFunction = undefined;
            this.positionFunctions = undefined;
            this.stackingFunctions = undefined;
            this.setFunctions = undefined;
            this.independentContentPosition = undefined;
            this.propagatePointerInArea = undefined;
            this.writeFunctions = undefined;
        }
    }

    // under the assumption that a ToMergeNode always follows the WriteNode    
    getMaxWriteScheduleStep(): number {
        var maxScheduleStep: number = -1;
        
        function getMaxCases(cases: {[caseName: string]: ToMergeNode}): number {
            var maxScheduleStep: number = -1;
            
            for (var caseName in cases) {
                var toMerge: ToMergeNode = cases[caseName];
                if (toMerge.scheduleStep > maxScheduleStep) {
                    maxScheduleStep = toMerge.scheduleStep;
                }
            }
            return maxScheduleStep;
        }
        
        for (var wrName in this.writeFunctions) {
            var w: WriteNode = this.writeFunctions[wrName];
            if (w.scheduleStep > maxScheduleStep) {
                maxScheduleStep = w.scheduleStep;
            }
            if (w.whenBecomesTrue !== undefined) {
                var mw: number = getMaxCases(w.whenBecomesTrue.actions);
                if (mw > maxScheduleStep) {
                    maxScheduleStep = mw;
                }
            }
            if (w.whenBecomesFalse !== undefined) {
                var mw: number = getMaxCases(w.whenBecomesFalse.actions);
                if (mw > maxScheduleStep) {
                    maxScheduleStep = mw;
                }
            }
        }
        return maxScheduleStep;
    }

    getMaxScheduleStep(prio: number): number {
        function gmss(cache: FunctionNode[]): number {
            var mss: number = -1;
            for (var i: number = 0; i !== cache.length; i++) {
                if (cache[i].prio === prio && cache[i].scheduleStep > mss) {
                    mss = cache[i].scheduleStep;
                }
            }
            return mss;
        }

        var mss: number = gmss(this.functionNodes);
        var wrMSS: number = prio === 1? this.getMaxWriteScheduleStep(): -1;
        if (wrMSS > mss) {
            mss = wrMSS;
        }
        if (this.scheduleStep > mss) {
            mss = this.scheduleStep;
        }
        for (var defunNr in this.defunFunctionNodes) {
            var defunMss: number = gmss(this.defunFunctionNodes[defunNr]);
            if (defunMss > mss) {
                mss = defunMss;
            }
        }
        return mss;
    }

    getEmbedding(level: number): AreaTemplate {
        var ptr: AreaTemplate = this;

        for (var i: number = 0; i < level; i++) {
            ptr = ptr.parent;
        }
        return ptr;
    }

    checkDisplayArea(): void {
        this.isDisplayArea =
            this.displayFunction !== undefined ||
            (this.positionFunctions !== undefined &&
             !Utilities.isEmptyObj(this.positionFunctions)) ||
            (this.stackingFunctions !== undefined &&
             !Utilities.isEmptyObj(this.stackingFunctions)) ||
            this.propagatePointerInArea !== undefined;
        for (var childName in this.children) {
            this.children[childName].checkDisplayArea();
            if (this.children[childName].isDisplayArea) {
                this.isDisplayArea = true;
            }
        }
    }

    // Analyzes sets of function nodes that form a tree. They have a regular
    // registration and activation pattern, and if one of these nodes gets an
    // update, the scheduling of the others is predictable. To save overhead on
    // registration, activation and scheduling, one subtree could be realized as
    // a single custom EvaluationNode with the combined external inputs of all
    // nodes in the subtree as its input, and the top node as its output.
    // However, the current EvaluationNodes do not allow for easy reuse of the
    // updateInput() and eval() functions.
    // Note: Writable nodes should probably be excluded, or the internal
    //       structure of the combined node might become rather complex.
    // TODO: Expressions referenced from embedded areas are swept up by forcing
    //       every function node to belong to a subtree. This is wrong, as it
    //       could move a node that must be accessible to an embedded area
    //       into a subtree.
    // TODO: add defun bodies.
    printGroupedExpressionSubTrees(): void {
        var nextSubTreeId: number = 0;
        var functionNodeIdToSubTreeId: {[id: number]: number} = {};
        var subTreeIdToFunctionNodeIds: {[id: number]: {[id: number]: boolean}} = {};
        var subTreeRoot: {[id: number]: number} = {};
        var self = this;

        function canBeGrouped(fn: FunctionNode): boolean {
            if (fn === undefined || fn.localToArea !== self.id || fn.getConstancy()) {
                return false;
            }
            if (fn instanceof StorageNode || fn instanceof AreaOfClassNode ||
                  fn instanceof DisplayOffsetNode || fn instanceof AreaProjectionNode ||
                  fn instanceof AreaSelectionNode || fn instanceof ChildAreasNode ||
                  (fn instanceof FunctionApplicationNode &&
                   ((<FunctionApplicationNode>fn).builtInFunction.name in {
                       offset: 1, allAreas: 1, embedded: 1, time: 1,
                       embeddedStar: 1, areaOfClass: 1, classOfArea: 1
                   } ||
                   ((<FunctionApplicationNode>fn).builtInFunction.name in {
                       prev: 1, next: 1, prevStar: 1, nextStar: 1, prevPlus: 1, nextPlus: 1
                   } && (<FunctionApplicationNode>fn).functionArguments.length === 1)))) {
                // These functions change on external inputs; if internal
                // (re)scheduling is supported, they can be allowed.
                return false;
            }
            return true;
        }

        function addFunctionNodeToSubTree(fn: FunctionNode, subTreeId: number): void {
            if (fn.id in functionNodeIdToSubTreeId) {
                // A node cannot be in two subtrees, so remove it from the other
                // subtree, and start a new subtree, unless it's already a root.
                var oldSubTreeId: number = functionNodeIdToSubTreeId[fn.id];
                if (oldSubTreeId === subTreeId) {
                    // It's the same tree
                    return;
                }
                if (subTreeRoot[oldSubTreeId] === fn.id) {
                    // Already is root of a subtree
                    return;
                }
                delete functionNodeIdToSubTreeId[fn.id];
                delete subTreeIdToFunctionNodeIds[oldSubTreeId][fn.id];
                subTreeId = nextSubTreeId++;
                subTreeIdToFunctionNodeIds[subTreeId] = {};
                subTreeRoot[subTreeId] = fn.id;
            }
            functionNodeIdToSubTreeId[fn.id] = subTreeId;
            subTreeIdToFunctionNodeIds[subTreeId][fn.id] = true;
        }

        // Start a new subtree, but assign the same subtree when repeating a
        // function node
        function addSubTreeRoot(fn: FunctionNode): void {
            if (canBeGrouped(fn) && !(fn.id in functionNodeIdToSubTreeId)) {
                var subTreeId: number = nextSubTreeId++;
                subTreeIdToFunctionNodeIds[subTreeId] = {};
                subTreeRoot[subTreeId] = fn.id;
                addFunctionNodeToSubTree(fn, subTreeId);
            }
        }

        // Mark start of subtrees from function node terminals (display, etc.
        // and exported nodes).
        addSubTreeRoot(this.displayFunction);
        for (var name in this.positionFunctions) {
            addSubTreeRoot(this.positionFunctions[name]);
        }
        for (var name in this.stackingFunctions) {
            addSubTreeRoot(this.stackingFunctions[name]);
        }
        for (var name in this.setFunctions) {
            addSubTreeRoot(this.setFunctions[name].data);
            addSubTreeRoot(this.setFunctions[name].partner);
        }
        addSubTreeRoot(this.independentContentPosition);
        addSubTreeRoot(this.propagatePointerInArea);
        for (var name in this.writeFunctions) {
            addSubTreeRoot(this.writeFunctions[name].upon);
            if (this.writeFunctions[name].whenBecomesTrue !== undefined) {
                addSubTreeRoot(this.writeFunctions[name].whenBecomesTrue.continuePropagation);
                for (var name2 in this.writeFunctions[name].whenBecomesTrue.actions) {
                    addSubTreeRoot(this.writeFunctions[name].whenBecomesTrue.actions[name2].to);
                    addSubTreeRoot(this.writeFunctions[name].whenBecomesTrue.actions[name2].merge);
                }
            }
            if (this.writeFunctions[name].whenBecomesFalse !== undefined) {
                addSubTreeRoot(this.writeFunctions[name].whenBecomesFalse.continuePropagation);
                for (var name2 in this.writeFunctions[name].whenBecomesFalse.actions) {
                    addSubTreeRoot(this.writeFunctions[name].whenBecomesFalse.actions[name2].to);
                    addSubTreeRoot(this.writeFunctions[name].whenBecomesFalse.actions[name2].merge);
                }
            }
        }
        for (var exportId in this.exports) {
            addSubTreeRoot(this.exports[exportId]);
        }

        // Verify inputs of marked nodes backwards
        for (var i: number = this.functionNodes.length - 1; i >= 0; i--) {
            var fn: FunctionNode = this.functionNodes[i];
            if (!(fn.id in functionNodeIdToSubTreeId)) {
                // Unreached function node, possibly for embedded area
                // Attempt to start new subtree
                addSubTreeRoot(fn);
            }
            if (fn.id in functionNodeIdToSubTreeId) {
                var inputs: FunctionNode[] = fn.allInputs();
                for (var j: number = 0; j < inputs.length; j++) {
                    // Attempt to add fn's inputs to the same subtree
                    if (canBeGrouped(inputs[j])) {
                        addFunctionNodeToSubTree(inputs[j], functionNodeIdToSubTreeId[fn.id]);
                    }
                }
            }
        }

        for (var subTreeId in subTreeIdToFunctionNodeIds) {
            var stids: string[] = Object.keys(subTreeIdToFunctionNodeIds[subTreeId]);
            if (stids.length > 1) {
                console.log("subtree", subTreeId, "=", stids.join(", "));
            }
        }
    }

    getNrVariants(): number {
        var nr: number = 0;

        for (var i: number = 0; i < this.functionNodes.length; i++) {
            if (this.functionNodes[i] instanceof VariantFunctionNode) {
                nr++;
            }
        }
        return nr;
    }

    // Note: continuePropagation, to and merge function nodes should be made
    // dependent on the upon. Similar problem in other sections?
    printExpandedVariants(): void {
        var cache: SingleQualifier[][][] = [];
        var qualifiers: SingleQualifier[][][] = [];
        var partitions: FunctionNode[][] = [];
        var strQuals: string[] = [];

        function getSubsets(qss: SingleQualifier[][][], j: number): number[] {
            var sub: number[] = [];

            function specializationFrom(qs1: SingleQualifier[][], qs2: SingleQualifier[][]): boolean {
                for (var j: number = 0; j < qs2.length; j++) {
                    for (var i: number = 0; i < qs1.length; i++) {
                        if (qImply(qs1[i], qs2[j])) {
                            break;
                        }
                    }
                    if (i === qs1.length) {
                        return false;
                    }
                }
                if (qs2.length > 0) {
                    for (var i: number = 0; i < qs1.length; i++) {
                        for (var j: number = 0; j < qs2.length; j++) {
                            if (qImply(qs1[i], qs2[j])) {
                                break;
                            }
                        }
                        if (j === qs2.length) {
                            return false;
                        }
                    }
                }
                return true;
            }

            for (var i: number = 0; i < qss.length; i++) {
                if (i !== j && specializationFrom(qss[j], qss[i])) {
                    sub.push(i + 1);
                }
            }
            return sub;
        }

        function filterSpecializationIndirectDependency(specializations: number[][]): number[][] {
            var spec: number[][] = [];

            // Is s[j] also origin in any of specialization[s[i]] (i!=j)
            function inOtherOrigin(s: number[], j: number): boolean {
                for (var i: number = 0; i < s.length; i++) {
                    if (i !== j && specializations[s[i] - 1].indexOf(s[j]) !== -1) {
                        return true;
                    }
                }
                return false;
            }

            for (var i: number = 0; i < specializations.length; i++) {
                var speci: number[] = [];
                for (var j: number = 0; j < specializations[i].length; j++) {
                    if (!inOtherOrigin(specializations[i], j)) {
                        speci.push(specializations[i][j]);
                    }
                }
                spec.push(speci);
            }
            return spec;
        }

        for (var i: number = 0; i < this.functionNodes.length; i++) {
            var fn: FunctionNode = this.functionNodes[i];
            var qs: SingleQualifier[][] = fn.getFullQualifierList(this.id, cache);
            for (var j: number = 0; j < qualifiers.length; j++) {
                if (qsEqual(qs, qualifiers[j])) {
                    break;
                }
            }
            if (j === qualifiers.length) {
                qualifiers.push(qs);
                partitions.push([fn]);
                strQuals.push(qs.map(function(q: SingleQualifier[]): string {
                    return "{"+q.map(SingleQualifier.sToSymString).join(",")+"}";
                }).join("\n          "));
            } else {
                qs = qualifiers[j];
                partitions[j].push(fn);
            }
            cache.push(qs);
        }
        console.log("nr partitions =", qualifiers.length);
        var specializations: number[][] = [];
        for (var i: number = 0; i < qualifiers.length; i++) {
            var specializationFrom: number[] = getSubsets(qualifiers, i);
            specializations.push(specializationFrom);
            console.log("\npartition", i + 1, "size="+partitions[i].length);
            console.log("specialization from", JSON.stringify(specializationFrom));
            if (strQuals[i] !== "") {
                console.log("          " + strQuals[i]);
            }
            for (var j: number = 0; j < partitions[i].length; j++) {
                var fn: FunctionNode = partitions[i][j];
                console.log(this.getSymWatcher(fn, ""), fn.idStr() + "=" + fn.toString());
            }
        }
        var spec: number[][] = filterSpecializationIndirectDependency(specializations);
        console.log("digraph specialization {");
        for (var i: number = 0; i < spec.length; i++) {
            for (var j: number = 0; j < spec[i].length; j++) {
                console.log(spec[i][j] + "->" + (i+1) + ";");
            }
        }
        console.log("}");
    }

    getSymWatcher(fn: FunctionNode, path: string): string {
        if (this.displayFunction === fn) {
            return "[" + path + "display]";
        }
        for (var name in this.positionFunctions) {
            if (this.positionFunctions[name] === fn) {
                return "[" + path + "position." + name + "]";
            }
        }
        for (var name in this.stackingFunctions) {
            if (this.stackingFunctions[name] === fn) {
                return "[" + path + "stacking." + name + "]";
            }
        }
        for (var writeName in this.writeFunctions) {
            var wrNode: WriteNode = this.writeFunctions[writeName];
            if (wrNode.upon === fn) {
                return "[" + path + "write." + writeName + ".upon]";
            }
            if (wrNode.whenBecomesTrue !== undefined) {
                if (wrNode.whenBecomesTrue.continuePropagation === fn) {
                    return "[" + path + "write." + writeName + ".true.continuePropagation]";
                }
                for (var name2 in wrNode.whenBecomesTrue.actions) {
                    if (wrNode.whenBecomesTrue.actions[name2].to === fn) {
                        return "[" + path + "write." + writeName + ".true." + name2 + ".to]";
                    }
                    if (wrNode.whenBecomesTrue.actions[name2].merge === fn) {
                        return "[" + path + "write." + writeName + ".true." + name2 + ".merge]";
                    }
                }
            }
            if (wrNode.whenBecomesFalse !== undefined) {
                if (wrNode.whenBecomesFalse.continuePropagation === fn) {
                    return "[" + path + "write." + writeName + ".true.continuePropagation]";
                }
                for (var name2 in wrNode.whenBecomesFalse.actions) {
                    if (wrNode.whenBecomesFalse.actions[name2].to === fn) {
                        return "[" + path + "write." + writeName + ".true." + name2 + ".to]";
                    }
                    if (wrNode.whenBecomesFalse.actions[name2].merge === fn) {
                        return "[" + path + "write." + writeName + ".true." + name2 + ".merge]";
                    }
                }
            }
        }
        if (this.independentContentPosition === fn) {
            return "[" + path + "independentContentPosition]";
        }
        if (this.exports[0] === fn) {
            return "[" + path + "class]";
        }
        if (this.exports[0] !== undefined) {
            var classFN: AVFunctionNode = <AVFunctionNode> this.exports[0];
            for (var className in classFN.attributes) {
                if (classFN.attributes[className] === fn) {
                    return "[" + path + "class." + className + "]";
                }
            }
        }
        for (var name in this.exports) {
            if (this.exports[name] === fn) {
                return "[" + path + exportPaths[name] + "]";
            }
        }
        for (var childName in this.setFunctions) {
            if (this.setFunctions[childName].data === fn) {
                return "[" + path + "child." + childName + ".data]";
            }
            if (this.setFunctions[childName].partner === fn) {
                return "[" + path + "child." + childName + ".partner]";
            }
        }
        for (var childName in this.children) {
            var symWatcher: string = this.children[childName].getSymWatcher(fn, path + "child." + childName + ".");
            if (symWatcher !== "") {
                return symWatcher;
            }
        }

        var content: PathTreeNode = this.areaNode.next["content"];
        if (content !== undefined && content.functionNode === fn) {
            return "[" + path + "content]";
        }

        var context: PathTreeNode = this.areaNode.next["context"];
        if (context !== undefined) {
            for (var attr in context.next) {
                var expr: PathTreeNode = context.next[attr];
                if (expr.functionNode === fn) {
                    return "[" + path + "context." + attr + "]";
                }
            }
        }

        return "";
    }

    getNumberOfAreasRangeUnder(id: number): RangeValue[] {
        if (this.id == id) { // Note: id can be a string!
            return [new RangeValue([1], true, true)];
        }
        if (this.parent === undefined) {
            return [new RangeValue([0], true, true)];
        }
        var parentRange: RangeValue[] = this.parent.getNumberOfAreasRangeUnder(id);
        var childSize: RangeValue[] =
            this.parent === undefined ||
            this.parent.setFunctions === undefined ||
            !(this.childName in this.parent.setFunctions)?
            (this.existenceQualifiers === undefined ||
             this.existenceQualifiers.length === 0? [_r(0,0)]:
             this.existenceQualifiers.length === 1 &&
             this.existenceQualifiers[0].length === 0? [_r(1, 1)]:
             [_r(0, 1)]
            ):
            this.parent.setFunctions[this.childName].data !== undefined &&
            this.parent.setFunctions[this.childName].partner !== undefined?
            ValueTypeSize.mergeSizes(this.parent.setFunctions[this.childName].partner.valueType.sizes,
                                     this.parent.setFunctions[this.childName].data.valueType.sizes):
            this.parent.setFunctions[this.childName].data !== undefined?
            this.parent.setFunctions[this.childName].data.valueType.sizes:
            this.parent.setFunctions[this.childName].data !== undefined?
            this.parent.setFunctions[this.childName].partner.valueType.sizes:
            [new RangeValue([0], true, true)];

        return ValueTypeSize.multiplySizes(childSize, parentRange);
    }

    getChildPath(): string[] {
        if (this.parent === undefined) {
            return [];
        }
        var childPath: string[] = this.parent.getChildPath();
        childPath.push(this.childName);
        return childPath;
    }

    alwaysExists(): boolean {
        return this.dataExpr === undefined && this.partnerExpr === undefined &&
               this.childExistence.length === 1 &&
               this.childExistence[0].qualifierTerms.length === 0 &&
               (this.parent === undefined ||
                this.parent.alwaysExists());
    }

    // Returns the qualifiers that determine the existence of this area with
    // respect to one of its ancestors, if no template on the path is intersection
    // or (data) area set. Only works for direct parent at this moment.
    getExistenceQualifiersWithRespectTo(parentId: number): QualifiersFunctionNode {
        if (this.childExistence.length == 0 || this.parent === undefined ||
              this.parent.id !== parentId || this.dataExpr !== undefined ||
              this.partnerExpr !== undefined) {
            return undefined;
        }
        var qualifiers: SingleQualifier[][] = [];
        var localToArea: number = undefined;
        for (var i = 0; i < this.childExistence.length; i++) {
            var extQual: PathInfo = this.childExistence[i];
            var qualWithCycles = buildQualifier(
                extQual.qualifierTerms, this.parent.id, 0, undefined, undefined);
            if (qualWithCycles === undefined) {
                return undefined;
            }
            var quals: SingleQualifier[] = qualWithCycles.qualifiers;
            qualifiers.push(quals);
            for (var j = 0; j < quals.length; j++) {
                localToArea = mergeLocality(localToArea, quals[j].functionNode.localToArea);
            }
        }
        return new QualifiersFunctionNode(qualifiers, localToArea, 0);
    }

    accumulateCallsPerTemplate(): void {
        gAccumulatedNrCallsPerTemplate[this.id] =
            gNrCallsPerTemplate[this.id] !== undefined? gNrCallsPerTemplate[this.id]: 0;
        for (var childName in this.children) {
            var child = this.children[childName];
            child.accumulateCallsPerTemplate();
            gAccumulatedNrCallsPerTemplate[this.id] += gAccumulatedNrCallsPerTemplate[child.id];
        }
    }
}

function initAreaTemplate(): void {
    areaTemplates.push(undefined);
    _gd(); // Make sure global defuns refer to global evaluation nodes
}

var templateDifferenceMaps: {[templateId: number]: {[templateId: number]: number}}[] = [{}, {}];

// Returns the number of levels of difference between two templates. If
// embeddingOnly is true, templates with embeddingInReferred are considered
// unrelated to higher templates.
function getLevelDifference(lowId: number, highId: number, embeddingOnly: boolean): number {
    var templateDifferenceMap: {[templateId: number]: {[templateId: number]: number}} =
        templateDifferenceMaps[embeddingOnly? 0: 1];
    var lowIdMap: {[templateId: number]: number} = templateDifferenceMap[lowId];

    if (lowIdMap !== undefined) {
        if (highId in lowIdMap) {
            return lowIdMap[highId];
        }
    } else {
        templateDifferenceMap[lowId] = lowIdMap = {};
    }

    var nr: number = 0;
    var low: AreaTemplate = areaTemplates[lowId];
    var high: AreaTemplate = areaTemplates[highId];

    while (low !== high && low !== undefined) {
        if (embeddingOnly && low.embeddingInReferred) {
            low = undefined;
            break;
        }
        low = low.parent;
        nr++;
    }
    return (lowIdMap[highId] = low === undefined? undefined: nr);
}
