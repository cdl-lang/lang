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

/// <reference path="globals.ts" />
/// <reference path="externalTypes.ts" />
/// <reference path="utilities.ts" />
/// <reference path="cdl.ts" />
/// <reference path="buildFunctionNode.ts" />
/// <reference path="evaluationNode.ts" />
/// <reference path="builtInFunctions.ts" />
/// <reference path="areaMonitor.ts" />
/// <reference path="area.ts" />
/// <reference path="buildEvaluationNode.ts" />
/// <reference path="eventQueue.ts" />
/// <reference path="externalTypes.ts" />
/// <reference path="debugInterpret.ts" />
/// <reference path="evaluationNode.database.ts" />
/// <reference path="evaluationNode.debugger.ts" />
/// <reference path="evaluationNode.label.ts" />
/// <reference path="appState.ts" />
/// <reference path="eventHandlers.ts" />
/// <reference path="debug.ts" />
/// <reference path="foreignJavascriptFunctions.ts" />

var gDomEvent: MondriaDomEvent;
var gZIndex: ZIndex;

var doCompileTimeChecks: boolean = false;

class FNRef {
    level: number;
    defunNr: number;
    index: number;
    suppressSet: boolean;
}

var debugAreaInfo: {[templateId: number]: {content: FNRef; context: {[attr: string]: FNRef};}} = {};

// References are relative to this area template
var gCurAreaTemplate: AreaTemplate = undefined;
var gCurTemplateId: number = undefined;
var gCurGeneric: boolean = false;
var gCurLocalFunctionNodes: FunctionNode[] = FunctionNode.globalFunctionNodes;
var gCurLocalDefunFunctionNodes: {[defunNr: number]: FunctionNode[]} = FunctionNode.globalDefunFunctionNodes;

var bodyCreateFuns: {
    defunNode: DefunNode;
    parameterNodes: FNRef[];
    bodyNode: FNRef;
    bodyImpl: () => void;
}[];

function _n(level: number, index: number): FNRef {
    var fnRef: FNRef = new FNRef();

    fnRef.level = level;
    fnRef.index = index;
    return fnRef;
}

function _nt(level: number, index: number): FNRef {
    var fnRef: FNRef = new FNRef();

    fnRef.level = level;
    fnRef.index = index;
    fnRef.suppressSet = true;
    return fnRef;
}

function _nf(level: number, index: number): FNRef {
    var fnRef: FNRef = new FNRef();

    fnRef.level = level;
    fnRef.index = index;
    fnRef.suppressSet = false;
    return fnRef;
}

function _nd(level: number, defunNr: number, index: number): FNRef {
    var fnRef: FNRef = new FNRef();

    fnRef.level = level;
    fnRef.defunNr = defunNr;
    fnRef.index = index;
    return fnRef;
}

function _ntd(level: number, defunNr: number, index: number): FNRef {
    var fnRef: FNRef = new FNRef();

    fnRef.level = level;
    fnRef.defunNr = defunNr;
    fnRef.index = index;
    fnRef.suppressSet = true;
    return fnRef;
}

function _nfd(level: number, defunNr: number, index: number): FNRef {
    var fnRef: FNRef = new FNRef();

    fnRef.level = level;
    fnRef.defunNr = defunNr;
    fnRef.index = index;
    fnRef.suppressSet = false;
    return fnRef;
}

function addFunctionNode(fn: FunctionNode, scheduleStep: number): void {
    var cache: FunctionNode[];

    if (!fn.localToDefun) {
        cache = gCurLocalFunctionNodes;
    } else {
        if (fn.localToDefun in gCurLocalDefunFunctionNodes) {
            cache = gCurLocalDefunFunctionNodes[fn.localToDefun];
        } else {
            gCurLocalDefunFunctionNodes[fn.localToDefun] = cache = [];
        }
    }
    fn.scheduleStep = scheduleStep;
    fn.id = cache.length;
    cache.push(fn);
}

function refFunctionNode(fnRef: FNRef): FunctionNode {
    if (fnRef === undefined) {
        return undefined;
    }
    var cache: FunctionNode[];
    if (fnRef.level === undefined) {
        cache = fnRef.defunNr? FunctionNode.globalDefunFunctionNodes[fnRef.defunNr]:
            FunctionNode.globalFunctionNodes;
    } else {
        var areaTemplate: AreaTemplate = gCurAreaTemplate;
        for (var i: number = 0; i < fnRef.level; i++) {
            areaTemplate = areaTemplate.parent;
        }
        cache = fnRef.defunNr? areaTemplate.defunFunctionNodes[fnRef.defunNr]:
                areaTemplate.functionNodes;
    }
    return cache[fnRef.index];
}

function refFunctionNodeMapNum(
    refMap: {[id: number]: FNRef}): {[id: number]: FunctionNode}
{
    if (refMap === undefined) {
        return undefined;
    } else {
        var fnMap: {[id: number]: FunctionNode} = {};
        for (var id in refMap) {
            fnMap[id] = refFunctionNode(refMap[id]);
        }
        return fnMap;
    }
}

function refFunctionNodeMapStr(
    refMap: {[id: string]: FNRef}): {[id: string]: FunctionNode}
{
    if (refMap === undefined) {
        return undefined;
    } else {
        var fnMap: {[id: string]: FunctionNode} = {};
        for (var id in refMap) {
            fnMap[id] = refFunctionNode(refMap[id]);
        }
        return fnMap;
    }
}

function _a(scheduleStep: number, localToDefun: number,
            av:{[attribute:string]: FNRef}, suppressSet: boolean): void
{ // av
    var fav: {[attribute: string]: FunctionNode} = {};
    var suppressSetAttr: {[attr: string]: boolean} = {};

    for (var attr in av) {
        fav[attr] = refFunctionNode(av[attr]);
        if ("suppressSet" in av[attr]) {
            suppressSetAttr[attr] = av[attr].suppressSet;
        }
    }
    addFunctionNode(
        new AVFunctionNode(fav, gCurTemplateId, localToDefun,
                           undefined, undefined, suppressSet, suppressSetAttr),
        scheduleStep);
}

function _g(fnRef: FNRef, value: any): SingleQualifier
{ // single guard
    return new SingleQualifier(refFunctionNode(fnRef), undefined, value, undefined);
}

function _gx(fnRef: FNRef, attribute: string, localToArea: number, value: any): SingleQualifier
{ // single guard
    return new SingleQualifier(refFunctionNode(fnRef), attribute, value, localToArea);
}

function _q(scheduleStep: number, localToDefun: number, qualifiers: SingleQualifier[][]): void
{ // qualifier
    addFunctionNode(new QualifiersFunctionNode(qualifiers, gCurTemplateId, localToDefun),
                    scheduleStep);
}

function _m(scheduleStep: number, localToDefun: number, qualifiers: FNRef, values: FNRef[]): void
{ // merge aka variant
    addFunctionNode(
        new VariantFunctionNode(
            <QualifiersFunctionNode> refFunctionNode(qualifiers),
            values.map(refFunctionNode), gCurTemplateId, localToDefun,
            undefined, undefined, undefined),
        scheduleStep);
}

function _m1(scheduleStep: number, localToDefun: number, qualifiers: FNRef, value: FNRef): void
{ // merge aka variant with only one function
    addFunctionNode(
        new VariantFunctionNode(
            <QualifiersFunctionNode> refFunctionNode(qualifiers),
            [refFunctionNode(value)], gCurTemplateId, localToDefun,
            undefined, undefined, undefined),
        scheduleStep);
}

function _f(scheduleStep: number, localToDefun: number,
            bif: BuiltInFunction, args: FNRef[]): void
{ // function call
    addFunctionNode(
        new FunctionApplicationNode(bif, args.map(refFunctionNode),
                            gCurTemplateId, localToDefun, undefined, undefined),
        scheduleStep);
}

function _srt(scheduleStep: number, localToDefun: number, areaSort: boolean, args: FNRef[]): void
{ // function call
    addFunctionNode(
        new SortNode(args.map(refFunctionNode), gCurTemplateId, localToDefun,
                     areaSort, undefined, undefined),
        scheduleStep);
}

function _c(scheduleStep: number, localToDefun: number,
            f: (v: any, args: any[]) => any, args: FNRef[], writePath: string[],
            dataRepresentation: FNRef): void
{ // compiled function
    var af: any = f;

    addFunctionNode(
        new CompiledFunctionNode(af.name, f, args.map(refFunctionNode),
                                 writePath, undefined, undefined, undefined,
                                 refFunctionNode(dataRepresentation),
                                 gCurTemplateId, localToDefun, undefined),
        scheduleStep);
}

function _w(scheduleStep: number, localToDefun: number,
            path: string[], initialValue: FNRef, remoteWritable: boolean): void
{ // writable node
    var wn = new WritableNode(path, refFunctionNode(initialValue),
                              gCurTemplateId, localToDefun,
                              undefined, undefined, undefined);
    wn.setRemoteWritability(remoteWritable);
    addFunctionNode(wn, scheduleStep);
}

function _st(scheduleStep: number, localToDefun: number, path: string[]): void
{ // writable node
    addFunctionNode(new StorageNode(path, gCurTemplateId, localToDefun,
                                    undefined, undefined, undefined),
                    scheduleStep);
}

function _mq(scheduleStep: number, localToDefun: number,
             path: string[]): void
{ // storage node, specifically for the global message
    addFunctionNode(new MessageQueueNode(path, gCurTemplateId, localToDefun, undefined, undefined),
                    scheduleStep);
}

function _ptr(scheduleStep: number, localToDefun: number, path: string[]): void
{ // storage node, specifically for the pointer
    addFunctionNode(new PointerStorageNode(path, gCurTemplateId, localToDefun, undefined, undefined),
                    scheduleStep);
}

function _dB(scheduleStep: number, localToDefun: number, path: string[]): void
{ // storage node, specifically debugBreak
    addFunctionNode(new DebugBreakNode(path), scheduleStep);
}

function _par(scheduleStep: number, localToDefun: number, path: string[]): void
{ // storage node, specifically for the param: input:
    addFunctionNode(new ParamStorageNode(path, gCurTemplateId,
                             localToDefun, undefined, undefined), scheduleStep);
}

function _p(scheduleStep: number, localToDefun: number,
            exportId: number, data: FNRef): void
{ // area projection
    addFunctionNode(new AreaProjectionNode(
             exportId, undefined, gCurTemplateId, localToDefun,
             refFunctionNode(data), undefined, undefined, undefined, undefined),
        scheduleStep);
}

function _coa(scheduleStep: number, localToDefun: number, data: FNRef): void
{ // Class Of Area
    addFunctionNode(new ClassOfAreaNode(gCurTemplateId, localToDefun,
                        refFunctionNode(data), undefined, undefined, undefined),
                    scheduleStep);
}

function _s(scheduleStep: number, localToDefun: number,
         exportId: number, select: FNRef, positive: boolean, data: FNRef): void
{ // selection match boolean
    var qcs = new QueryComponentSelect(undefined, undefined, positive,
                                       refFunctionNode(select));

    addFunctionNode(
        new AreaSelectionNode(exportId, qcs, gCurTemplateId, localToDefun,
                              refFunctionNode(data), undefined, undefined),
                    scheduleStep);
}

function _o(scheduleStep: number, localToDefun: number, args: FNRef[]): void
{ // ordered set
    addFunctionNode(new OrderedSetNode(args.map(refFunctionNode),
                                       gCurTemplateId, localToDefun,
                                       undefined, undefined, undefined),
                    scheduleStep);
}

function _rcc(scheduleStep: number, localToDefun: number, args: FNRef[]): void
{ // range
    addFunctionNode(new RangeNode(args.map(refFunctionNode), true, true,
                            gCurTemplateId, localToDefun, undefined, undefined),
                    scheduleStep);
}

function _rco(scheduleStep: number, localToDefun: number, args: FNRef[]): void
{ // range
    addFunctionNode(new RangeNode(args.map(refFunctionNode), true, false,
                            gCurTemplateId, localToDefun, undefined, undefined),
                    scheduleStep);
}

function _roc(scheduleStep: number, localToDefun: number, args: FNRef[]): void
{ // range
    addFunctionNode(new RangeNode(args.map(refFunctionNode), false, true,
                            gCurTemplateId, localToDefun, undefined, undefined),
                    scheduleStep);
}

function _roo(scheduleStep: number, localToDefun: number, args: FNRef[]): void
{ // range
    addFunctionNode(new RangeNode(args.map(refFunctionNode), false, false,
                            gCurTemplateId, localToDefun, undefined, undefined),
                    scheduleStep);
}

function _neg(scheduleStep: number, localToDefun: number, queries: FNRef[]): void
{ // negation: n(...)
    addFunctionNode(new NegationNode(queries.map(refFunctionNode),
                            gCurTemplateId, localToDefun, undefined, undefined),
                    scheduleStep);
}

function _substr(scheduleStep: number, localToDefun: number, strings: FNRef[]): void
{ // substring: s(...)
    addFunctionNode(new SubStringQueryNode(strings.map(refFunctionNode),
                                           gCurTemplateId, localToDefun,
                                           undefined, undefined, undefined),
                    scheduleStep);
}

function _cf(scheduleStep: number, localToDefun: number, strings: FNRef[]): void
{ // Comparison Function: c(...)
    addFunctionNode(new ComparisonFunctionNode(strings.map(refFunctionNode),
                                               gCurTemplateId, localToDefun,
                                               undefined, undefined, undefined),
                    scheduleStep);
}

function _v(v: any, suppressSet: boolean): void
{ // constant value
    addFunctionNode(new ConstNode(v, undefined, undefined, suppressSet, true), -1);
}

function _vcq(v: any, compiledQuery: FNRef, suppressSet: boolean): void
{ // constant value with compiled query
    var cn: ConstNode = new ConstNode(v, undefined, undefined, suppressSet, true);
    var cq = <CompiledFunctionNode> refFunctionNode(compiledQuery);

    cn.setCompiledQuery(cq);
    addFunctionNode(cn, -1);
}

function _mss(prio: number, maxScheduleStep: number): void {
    evaluationQueue.init(prio, maxScheduleStep);
}

// Area template Create
function _ac(parentId: number, pChildName: string, scheduleStep: number, exists: boolean): void {
    var parent = parentId === undefined? undefined: areaTemplates[parentId];
    var areaTemplate = new AreaTemplate(undefined, parent, pChildName,
                                        undefined, undefined);

    areaTemplates.push(areaTemplate);
    areaTemplate.scheduleStep = scheduleStep;
    if (parent !== undefined && exists) {
        parent.children[pChildName] = areaTemplate;
    }
    gCurAreaTemplate = areaTemplate;
    gCurTemplateId = areaTemplate.id;
    gCurLocalFunctionNodes = areaTemplate.functionNodes;
    gCurLocalDefunFunctionNodes = areaTemplate.defunFunctionNodes;
    gCurGeneric = false;
}

// Area existence qualifiers
function _aeq(existenceQualifiers: SingleQualifier[][]): void {
    gCurAreaTemplate.existenceQualifiers = existenceQualifiers;
}

// Core Area (i.e. non display area)
function _ca(): void {
    gCurAreaTemplate.isDisplayArea = false;
}

// Classname priority
function _cnp(classNamePrio: {[name: string]: number}): void {
    gCurAreaTemplate.classNamePrio = classNamePrio;
}

// Independent content position
function _icp(fn: FNRef): void {
    gCurAreaTemplate.independentContentPosition = refFunctionNode(fn);
}

// Embedding in referred
function _eir(): void {
    gCurAreaTemplate.embeddingInReferred = true;
}

// propagatePointerInArea
function _ppia(fn: FNRef): void {
    gCurAreaTemplate.propagatePointerInArea = refFunctionNode(fn);
}

// Area create children
function _acc(id: number, setFunctions: {[childName: string]: {data?: FNRef; partner?: FNRef;}}): void
{
    var areaTemplate = areaTemplates[id];
    var sdf: {[childName: string]: {data?: FunctionNode; partner?: FunctionNode;}} = {};

    for (var childName in setFunctions) {
        sdf[childName] = {
            data: refFunctionNode(setFunctions[childName].data),
            partner: refFunctionNode(setFunctions[childName].partner)
        };
    }
    areaTemplate.setFunctions = sdf;
}

// Area template Expressions
function _ae(id: number, displayFunction: FNRef,
             positionFunctions: {[name: string]: FNRef},
             stackingFunctions: {[name: string]: FNRef},
             exports: {[exportId: number]: FNRef}): void
{
    var areaTemplate = areaTemplates[id];

    areaTemplate.displayFunction = refFunctionNode(displayFunction);
    areaTemplate.positionFunctions = refFunctionNodeMapStr(positionFunctions);
    if (stackingFunctions !== undefined) {
        areaTemplate.stackingFunctions = refFunctionNodeMapStr(stackingFunctions);
    }
    areaTemplate.exports = refFunctionNodeMapNum(exports);
    _gd();
}

// Area Foreign Interface display
function _afi(foreignInterfaceFunction: FNRef): void {
    gCurAreaTemplate.foreignInterfaceDisplayFunction = refFunctionNode(foreignInterfaceFunction);
}

// define Global Defuns
function _gd(): void {
    var defunNrs: {[defunNr: number]: boolean} = {};

    if (bodyCreateFuns !== undefined) {
        for (var i: number = 0; i !== bodyCreateFuns.length; i++) {
            var bcf = bodyCreateFuns[i];
            if (!(bcf.defunNode.defunNr in defunNrs)) {
                defunNrs[bcf.defunNode.defunNr] = true;
                bcf.bodyImpl();
            }
            bcf.defunNode.parameterNodes = <StorageNode[]> bcf.parameterNodes.map(refFunctionNode);
            bcf.defunNode.setBody(refFunctionNode(bcf.bodyNode));
        }
        bodyCreateFuns = undefined;
    }
}

// Area context attributes
function _ctx(id: number, content: FNRef, context: {[attr:string]:FNRef}): void
{
    debugAreaInfo[id] = {content: content, context: context};
}

// Descendants (direct children of areas)
function _d(scheduleStep: number, localToDefun: number,
            childName: string, data: FNRef): void
{
    addFunctionNode(
        new ChildAreasNode(childName, refFunctionNode(data), undefined, undefined),
        scheduleStep);
}

// Area Write
function _aw(id: number, name: string, upon: FNRef,
             whenBecomesTrueContinuePropagation: FNRef,
             whenBecomesTrue: {[name: string]: ToMergeNode},
             whenBecomesFalseContinuePropagation: FNRef,
             whenBecomesFalse: {[name: string]: ToMergeNode},
             scheduleStep: number): void
{
    var areaTemplate: AreaTemplate = areaTemplates[id];
    var wrNode: WriteNode = new WriteNode();
    
    wrNode.scheduleStep = scheduleStep;
    wrNode.upon = refFunctionNode(upon);
    if (whenBecomesTrueContinuePropagation !== undefined || whenBecomesTrue !== undefined) {
        wrNode.whenBecomesTrue = {
            continuePropagation: refFunctionNode(whenBecomesTrueContinuePropagation),
            actions: whenBecomesTrue
        };
    }
    if (whenBecomesFalseContinuePropagation !== undefined || whenBecomesFalse !== undefined) {
        wrNode.whenBecomesFalse = {
            continuePropagation: refFunctionNode(whenBecomesFalseContinuePropagation),
            actions: whenBecomesFalse
        };
    }
    if (areaTemplate.writeFunctions === undefined) {
        areaTemplate.writeFunctions = {};
    }
    areaTemplate.writeFunctions[name] = wrNode;
}

function getLastNodeFromFunctionNodes(localToArea: number,
                              localToDefun: number): FunctionNode
{
    var cache: FunctionNode[];

    if (!localToArea) {
        if (!localToDefun) {
            cache = FunctionNode.globalFunctionNodes;
        } else {
            if (localToDefun in FunctionNode.globalDefunFunctionNodes) {
                cache = FunctionNode.globalDefunFunctionNodes[localToDefun];
            } else {
                FunctionNode.globalDefunFunctionNodes[localToDefun] = cache = [];
            }
        } 
    } else {
        if (!localToDefun) {
            cache = gCurAreaTemplate.functionNodes;
        } else {
            var defFunctionNodes = gCurAreaTemplate.defunFunctionNodes;
            if (localToDefun in defFunctionNodes) {
                cache = defFunctionNodes[localToDefun];
            } else {
                defFunctionNodes[localToDefun] = cache = [];
            }
        }
    }
    return cache[cache.length - 1];
}

// Mark onWritablePath on last node in cache
function _owp(scheduleStep: number, localToDefun: number): void {
    var lastNode: FunctionNode = getLastNodeFromFunctionNodes(gCurTemplateId, localToDefun);

    lastNode.writable = true;
}

// Set Priority on last node in cache
function _sp(localToDefun: number, prio: number): void {
    var lastNode: FunctionNode = getLastNodeFromFunctionNodes(gCurTemplateId, localToDefun);

    lastNode.prio = prio;
}

// Set Scheduling Error flag on last node in cache
function _se(scheduleStep: number, localToDefun: number, prio: number): void {
    var lastNode: FunctionNode = getLastNodeFromFunctionNodes(gCurTemplateId, localToDefun);

    lastNode.schedulingError = true;
}

// BoolGate
function _bg(scheduleStep: number, localToDefun: number,
             a: FNRef, b: FNRef): void
{
    addFunctionNode(
        new BoolGateNode(refFunctionNode(a), refFunctionNode(b),
                         gCurTemplateId, localToDefun, undefined),
        scheduleStep);
}

// BoolMatch
function _bm(scheduleStep: number, localToDefun: number,
             a: FNRef, b: FNRef, c: FNRef): void
{
    addFunctionNode(
        new BoolMatchNode(refFunctionNode(a), refFunctionNode(b),
                          refFunctionNode(c), gCurTemplateId, localToDefun,
                          undefined, undefined),
        scheduleStep);
}

// To+Merge
function _tm(to: FNRef, merge: FNRef, scheduleStep: number): ToMergeNode {
    var tmNode: ToMergeNode = new ToMergeNode(refFunctionNode(to),
                                              refFunctionNode(merge),
                                              undefined);

    tmNode.scheduleStep = scheduleStep;
    return tmNode;
}

// Cond
function _co(scheduleStep: number, localToDefun: number,
             condVar: FNRef, altList: {on: FNRef; use: FNRef;}[]): void
{
    var altListFN: {on: FunctionNode; use: FunctionNode;}[] =
        altList.map(function (e) {
            return {
                on: refFunctionNode(e.on),
                use: refFunctionNode(e.use)
            };
        });

    addFunctionNode(new CondNode(refFunctionNode(condVar), altListFN,
                            gCurTemplateId, localToDefun, undefined, undefined),
                    scheduleStep);
}

// Defun
function _def(scheduleStep: number, localToDefun: number,
              defunNr: number, parameterNodes: FNRef[], bodyNode: FNRef,
              bodyImpl:() => void): void
{
    var defunNode: DefunNode = new DefunNode(gCurTemplateId, localToDefun,
                           defunNr, undefined, undefined, undefined, undefined);

    defunNode.localToArea = gCurTemplateId; // A defun's localToArea is the body's localToArea
    addFunctionNode(defunNode, scheduleStep);
    if (bodyCreateFuns === undefined) {
        bodyCreateFuns = [];
    }
    // Create the body's FunctionNode cache when the area cache is complete.
    // This is not needed for nested defuns, but they are treated the same way.
    bodyCreateFuns.push({
        defunNode: defunNode,
        parameterNodes: parameterNodes,
        bodyNode: bodyNode,
        bodyImpl: bodyImpl
    });
}

function _executeCompiledQuery_(compiledQuery: (v: any) => any, v: any): any {
    if (!(v instanceof Array)) {
        return compiledQuery(v);
    } else {
        var r: any = [];
        for (var i = 0; i !== v.length; i++) {
            var r1 = compiledQuery(v[i]);
            if (r1 !== undefined) {
                r.push(r1);
            }
        }
        return r;
    }
}

declare var globalMessageNodeIndex: number;
declare var pointerNodeIndex: number;
declare var globalAreasUnderPointerNodeIndex: number;
declare var globalDefaultsNodeIndex: number;

// Creates all areas by instantiating the screen area, and also create the
// global nodes for [message], [pointer], [debugBreak], etc., if they are
// required. They need to exist before the first expression looks at them, since
// they are storage the result of external functions that set data just once.
function createAreas(): void {
    // Make sure that [message] isn't undefined
    var globMsg = <EvaluationStore> getEvaluationNode(
        FunctionNode.globalFunctionNodes[globalMessageNodeIndex], undefined);
    globMsg.lastUpdate = new Result([]);
    // And [pointer]
    buildEvaluationNode(FunctionNode.globalFunctionNodes[pointerNodeIndex], globalEvaluationEnv);
    if (typeof(globalAreasUnderPointerNodeIndex) !== "undefined") {
        buildEvaluationNode(FunctionNode.globalFunctionNodes[globalAreasUnderPointerNodeIndex], globalEvaluationEnv);
    }
    if (typeof(globalDefaultsNodeIndex) !== "undefined") {
        buildEvaluationNode(FunctionNode.globalFunctionNodes[globalDefaultsNodeIndex], globalEvaluationEnv);
    }
    CoreArea.instantiate(areaTemplates[1], undefined, []);
}

function initialize(): void {

    // switch 'gInitPhase' to false when initial construction is completed
    globalConcludeInitPhaseTask.schedule();

    createAreas();

    startEventProcessing();

    if (!evaluationQueue.runQueue(0, undefined)) {
        globalContentTask.schedule();
    }

    // schedule re-calculation of display queries, to allow for delayed font
    // loading (web-fonts), that are initially rendered with a local font
    scheduleDisplayQueryRecalculation();
}

// TODO: fixed id of screen area
function createGlobalObjects(): void {
    initDebugObjMgr();
    initTaskQueue();

    gArgParser = getArgParser();
    initDefaultArgs();


    initPositioning();
    initAbsolutePosManager();
    initPosConstraintSynchronizer();

    initZIndex();

    // Pointer object is area 1:1
    gPointer = new MondriaPointer(
        labelBySuffix("1:1", leftSuffix(undefined, false, false)),
        labelBySuffix("1:1", topSuffix(undefined, false, false)));

    buildEvaluationNode(FunctionNode.globalFunctionNodes[globalMessageNodeIndex],
                        globalEvaluationEnv);
    evaluationQueue.setGlobalMessageQueue(
        globalEvaluationNodes[globalMessageNodeIndex]);

    createScreenArea();

    createRemoteMgr();
}

/// Initializes global variables from the URL/command line arguments
function initDefaultArgs(): void {
    logValues = gArgParser.getArg("logValues", false);
    if (logValues) {
        logPrototypes = undefined;
    }
    debugWrites = gArgParser.getArg("debugWrites", debugWrites);
    debugWritesEval = gArgParser.getArg("debugWritesEval", debugWritesEval);
    debugWritesString = gArgParser.getArg("debugWritesString", debugWritesString);
    debugEvents = gArgParser.getArg("debugEvents", debugEvents);
    gProfile = gArgParser.getArg("profile", gProfile);
    debugTest = gArgParser.getArg("debugTest", debugTest);
    logEventTimes = gArgParser.getArg("logEventTimes", false);
    useResultIndexers = gArgParser.getArg("useResultIndexers", useResultIndexers);
    dsDestroyTimeOut = gArgParser.getArg("destroyTimeOut", dsDestroyTimeOut);
    allowSetData = gArgParser.getArg("allowSetData", allowSetData);
    linearMultiQuery = gArgParser.getArg("linearMultiQuery", linearMultiQuery);
    runTests = gArgParser.getArg("test", runTests);
    testSingleStep = gArgParser.getArg("testSingleStep", testSingleStep);
    debugTasks = gArgParser.getArg("debugTasks", debugTasks);
    dataTableMaxNrRows = gArgParser.getArg("dataTableMaxNrRows", undefined);
    dataTableMaxNrColumns = gArgParser.getArg("dataTableMaxNrColumns", undefined);
    dataTableFacetRestriction = gArgParser.getArg("dataTableFacetRestriction", undefined);
    debugNoConstMaps = gArgParser.getArg("debugNoConstMaps", debugNoConstMaps);
    if (!useResultIndexers) {
        console.warn("no result indexers");
    }
    if (testSingleStep && !gArgParser.getArg("maxTestDuration", undefined)) {
        // Set a very long time out. 32 years should be enough.
        maxTestDuration = 1e12;
    } else {
        maxTestDuration = gArgParser.getArg("maxTestDuration", maxTestDuration / 1000) * 1000;
    }
    if (runTests) {
        logEventHistory = false;
        g_noTryAndCatchUpdate = true;
    }
    g_noTryAndCatchUpdate = gArgParser.getArg("noTryAndCatch", g_noTryAndCatchUpdate);
    noTimeOut = gArgParser.getArg("noTimeOut", false);
    slowDownFactor = gArgParser.getArg<number>("slowDownFactor", undefined);
    if (slowDownFactor !== undefined) {
        globalTaskQueue.iterationTimeout = 1; 
        globalTaskQueueIterationTimeout = 1;
    }
    debugAreaConstruction = gArgParser.getArg("debugAreaConstruction", false);
    debugDelayLoad = gArgParser.getArg("debugDelayLoad", debugDelayLoad);
    gMaxMessageSize = gArgParser.getArg("gMaxMessageSize", gMaxMessageSize);
    baseDelay = gArgParser.getArg("baseDelay", baseDelay);
    sizeDependentDelay = gArgParser.getArg("sizeDependentDelay", sizeDependentDelay);

    var maxEPS = Number(gArgParser.getArg("maxEPS", maxEvaluationsPerSlice));
    if (maxEPS > 0) {
        maxEvaluationsPerSlice = maxEPS;
    }

    if (gArgParser.getArg("noProgressBar", false)) {
        gProgressValue = undefined;
        gProgressDiv = document.getElementById("progress");
        if (gProgressDiv !== undefined && gProgressDiv !== null) {
            gProgressDiv.parentNode.removeChild(gProgressDiv);
            gProgressDiv = null;
        }        
    }


    if (gProfile) {
        requirePerformanceNow();
    }
    var debugBreaks: string[][] = gArgParser.getArg("debugBreak", "").split(",").map(function(s: string): string[] {
        return s.split(":");
    });
    for (var i: number = 0; i < debugBreaks.length; i++) {
        if (debugBreaks[i].length === 3 && debugBreaks[i][0] === "_") {
            setDebugBreak(_, debugBreaks[i][1], debugBreaks[i][2]);
        } else if (debugBreaks[i].length === 4) {
            setDebugBreak(debugBreaks[i][0] + ":" + debugBreaks[i][1],
                          debugBreaks[i][2], debugBreaks[i][3]);
        }
    }
    var contextTraces: string[][] = gArgParser.getArg("contextTrace", "").split(",").map(function(s: string): string[] {
        return s.split(":");
    });
    for (var i: number = 0; i < contextTraces.length; i++) {
        if (contextTraces[i].length === 3) {
            contextTrace(contextTraces[i][0] + ":" + contextTraces[i][1], contextTraces[i][2]);
        }
    }

    var testLogBreakStr: string = gArgParser.getArg("testLogBreak", undefined);
    if (testLogBreakStr !== undefined) {
        testLogBreak = new RegExp(decodeURIComponent(testLogBreakStr));
    }

    if (typeof(globalDefaultsNodeIndex) !== "undefined") {
        // Modify the initial value for [globalDefaults]
        var globalDefaultInitValue = (<ConstNode>(<WritableNode>FunctionNode.globalFunctionNodes[globalDefaultsNodeIndex]).initialValue).value;
        var globDefChanges: {path: string[]; value: any[];}[] =
            gArgParser.getArg("globalDefaults", "").
                split(",").filter(function(s: string): boolean {
                    return s.includes(":");
                }).map(function(s: string) {
                    var args: string[] = s.split(":");
                    return { path: args[0].split("."), value: [argvConvertString(args[1])] };
                });
        for (var i = 0; i < globDefChanges.length; i++) {
            updateNormalizedValue(globalDefaultInitValue, globDefChanges[i].path, globDefChanges[i].value);
        }
    }

    var prodStatArg = gArgParser.getArg<ProductStatus|undefined>("productStatus", undefined);
    if (prodStatArg !== undefined) {
        productStatus = prodStatArg;
    } else if (typeof(process) !== "undefined") {
        productStatus = ProductStatus.testing; // running in node
    } else {
        productStatus = window.location.hostname === "testing.mondriatech.com"? ProductStatus.testing:
                        window.location.hostname === "www.mondriatech.com"? ProductStatus.production:
                        ProductStatus.development;
    }
}

function startEventProcessing(): void {
    var wrNode = <EvaluationStore> globalEvaluationNodes[pointerNodeIndex];

    // Set up event handling
    gDomEvent = new MondriaDomEvent(gPointer, "1:1");
    // Initialize pointer object
    wrNode.set(new Result([{
        position: { top: [0], left: [0] },
        display: [{
            image: ["default"]
        }],
        button: [],
        modifier: [],
        id: [1]
    }]));
    // Declare screen size
    updateScreenAreaPosition("1:1");
}

function cdlMain(): void {

    if (fmtVersion !== gRunFmtVersion) {
        userAlert("wrong format version");
        return;
    }

    createGlobalObjects();

    // request app-state to be restored from the server (if applicable)
    gAppStateMgr.load();

    initialize();

    // window.addEventListener("beforeunload", function(e) {
    //     var msg = "Do you want to leave this page?";
    //     e.returnValue = msg;
    //     return msg;
    // });
}
