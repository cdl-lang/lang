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

/// <reference path="systemEvents.ts" />
/// <reference path="externalTypes.ts" />
/// <reference path="functionGraph.ts" />
/// <reference path="debugInterpret.ts" />
/// <reference path="buildFunctionNode.ts" />

/*
Because compilation provides extra information (query replacement, area ids,
type information about queried parts of the constraint), the analysis is based
on the (final) function nodes instead of the original CDL expressions.
*/

function printPositionConstraints(): void {

    var pathToStr: any;

    function addPathToStr(path: string[], qualifiers: SingleQualifier[], str: any): void {
        if (path.length === 0) {
            if (!(pathToStr instanceof Array)) {
                pathToStr = [];
            }
            pathToStr.push(str);
            return;
        }
        var ptr: any = pathToStr;
        for (var i: number = 0; i < path.length - 1; i++) {
            if (!(path[i] in ptr)) {
                ptr[path[i]] = {};
            }
            ptr = ptr[path[i]];
        }
        if (!(ptr[path[path.length - 1]] instanceof Array)) {
            ptr[path[path.length - 1]] = [];
        }
        ptr[path[path.length - 1]].push(str);
    }

    function unravelPcQ(fn: VariantFunctionNode, path: string[], qualifiers: SingleQualifier[]): void {
        for (var i: number = 0; i !== fn.functionNodes.length; i++) {
            unravelPc(fn.functionNodes[i], path, qualifiers.concat(fn.qualifiers.qualifiers[i]));
        }
    }

    function unravelPcA(fn: AVFunctionNode, path: string[], qualifiers: SingleQualifier[]): void {
        for (var attr in fn.attributes) {
            unravelPc(fn.attributes[attr], path.concat(attr), qualifiers);
        }
    }

    var terminalAttributes: {[attr: string]: boolean} = {
        element: true,
        type: true,
        content: true,
        intersection: true,
        label: true,
        pair1: false,
        pair2: false,
        point1: false,
        point2: false
    };

    function unravelPcC(v: any, path: string[], qualifiers: SingleQualifier[]): void {
        var termAttr: string = path[path.length - 1];
        var termStat: boolean = terminalAttributes[termAttr];

        if (v instanceof Array && v.length === 1) {
            unravelPcC(v[0], path, qualifiers);
        } else if (isAV(v)) {
            for (var attr in v) {
                unravelPcC(v[attr], path.concat(attr), qualifiers);
            }
        } else if (termStat || path.length === 0) {
            addPathToStr(path, qualifiers, v);
        }
    }

    function unravelPcVt(vt: ValueType, path: string[], qualifiers: SingleQualifier[]): void {
        var termAttr: string = path[path.length - 1];
        var termStat: boolean = terminalAttributes[termAttr];

        if ("unknown" in vt || "anyData" in vt || "query" in vt ||
              "undef" in vt || "string" in vt || "number" in vt ||
              "range" in vt || "boolean" in vt || "defun" in vt ||
              "areas" in vt || "projector" in vt) {
            if (termStat === true) {
                addPathToStr(path, qualifiers, {expressionType: vt.toString()});
            }
        } else { // must be object
            for (var attr in vt.object) {
                unravelPcVt(vt.object[attr], path.concat(attr), qualifiers);
            }
        }
    }

    function unravelPc(fn: FunctionNode, path: string[], qualifiers: SingleQualifier[]): void {
        var termAttr: string = path[path.length - 1];
        var termStat: boolean = terminalAttributes[termAttr];

        if (fn instanceof VariantFunctionNode) {
            unravelPcQ(fn, path, qualifiers);
        } else if (fn instanceof AVFunctionNode) {
            unravelPcA(fn, path, qualifiers);
        } else if (fn instanceof ConstNode) {
            unravelPcC(fn.value, path, qualifiers);
        } else if (termStat) {
            var str: any = fn.toCDLString(undefined);
            if (termAttr === "element") {
                if (!("areas" in fn.valueType)) {
                    // Query on non-existing areas, e.g. [{children: {...}}, [me]]
                    return;
                }
                var templateIds: number[] = [];
                for (var templateId of fn.valueType.areas.keys()) {
                    templateIds.push(templateId);
                }
                str = {expression: str, templateIds: templateIds};
            }
            addPathToStr(path, qualifiers, str);
        } else if (path.length === 0) { // it's a short cut
            addPathToStr(path, qualifiers, fn.toCDLString(undefined));
        } else {
            unravelPcVt(fn.valueType, path, qualifiers);
        }
    }

    console.log("var constraints = {");
    for (var i: number = 1; i < areaTemplates.length; i++) {
        var template: AreaTemplate = areaTemplates[i];
        var str: string = " " + String(i) + ": {";
        var first: boolean = true;
        for (var constraintName in template.positionFunctions) {
            var constraint: FunctionNode = template.positionFunctions[constraintName];
            pathToStr = {};
            unravelPc(constraint, [], []);
            if (first) {
                str += "\n  ";
                first = false;
            } else {
                str += ",\n  ";
            }
            str += jsIdentifierRegExp.test(constraintName) && constraintName !== "class"?
                constraintName: JSON.stringify(constraintName);
            str += ": " + vstringify(pathToStr);
        }
        str += "\n }" + (i < areaTemplates.length - 1? ",": "");
        console.log(str);
    }    
    console.log("};");
}

// Experimental code

// List of qualifier attributes, qualifiers, and qualifier sets per template
function printVariantsPerTemplate(): void {

    var singleQualifiers: {[q1Str: string]: number};
    var qualifierId: {[qStr: string]: number};
    var qualifierString: string[];
    var qualifierCount: number[];
    var qualifierCombiCount: {[str: string]: number};

    function collectQualifiers(qn: QualifiersFunctionNode, templateId: number): void {
        var combi: number[] = [];

        for (var i = 0; i !== qn.qualifiers.length; i++) {
            var quals: SingleQualifier[] = qn.qualifiers[i];
            var qualStrs: string[] = [];
            for (var j: number = 0; j < quals.length; j++) {
                // Retarget qualifiers from embedded templates that are
                // evaluated in this template.
                var qs: string = quals[j].attribute + "@" + quals[j].localToArea;
                qualStrs.push(qs);
                if (qs in singleQualifiers) {
                    singleQualifiers[qs]++;
                } else {
                    singleQualifiers[qs] = 1;
                }
            }
            var qStr: string = qualStrs.join(",");
            var qId: number = qualifierId[qStr];
            if (qId === undefined) {
                qId = qualifierString.length;
                qualifierId[qStr] = qId;
                qualifierString.push(qStr);
                qualifierCount.push(0);
            }
            combi.push(qId);
            qualifierCount[qId]++;
        }
        var combiStr: string = combi.sort().join("|");
        if (!(combiStr in qualifierCombiCount)) {
            qualifierCombiCount[combiStr] = 1;
        } else {
            qualifierCombiCount[combiStr]++;
        }
    }

    function collectVariants(functionNodes: FunctionNode[], templateId: number): void {
        for (var i: number = 0; i < functionNodes.length; i++) {
            if (functionNodes[i] instanceof VariantFunctionNode) {
                collectQualifiers((<VariantFunctionNode>functionNodes[i]).qualifiers, templateId);
            }
        }
    }

    for (var i: number = 1; i < areaTemplates.length; i++) {
        singleQualifiers = {};
        qualifierId = {};
        qualifierString = [];
        qualifierCount = [];
        qualifierCombiCount = {};
        collectVariants(areaTemplates[i].functionNodes, i);
        console.log("\nvariants for template", i);
        for (var q1Str in singleQualifiers) {
            console.log(q1Str + "\t" + singleQualifiers[q1Str]);
        }
        for (var qId: number = 0; qId < qualifierString.length; qId++) {
            console.log(String(qId) + "\t" + qualifierString[qId] + "\t" +
                        String(qualifierCount[qId]));
        }
        var combiId: number = 0;
        for (var combiStr in qualifierCombiCount) {
            combiId++;
            console.log("combi #" + combiId + "\t" + combiStr + "\t" + qualifierCombiCount[combiStr]);
        }
    }
}

// Prints all function nodes per area template that form a subtree
function printGroupedExpressionSubTrees(): void {
    console.log("\ngrouped expression subtrees");
    for (var i: number = 1; i < areaTemplates.length; i++) {
        console.log("template", i);
        areaTemplates[i].printGroupedExpressionSubTrees();
    }    
}

// Partitions all function nodes per template by the qualifiers they depend
// upon. This differs from printVariantsPerTemplate in the sense that it puts a
// function [f, a, b, ...] in the partition with all combinations of qualifiers
// that determine the values of a, b, ...
function printExpandedVariants(templateId?: number): void {
    console.log("\nexpanded variants");
    if (templateId === undefined) {
        for (var i: number = 1; i < areaTemplates.length; i++) {
            console.log("template", i);
            var nrVariants: number = areaTemplates[i].getNrVariants();
            console.log("nr variants", nrVariants);
            areaTemplates[i].printExpandedVariants();
        }
    } else {
        areaTemplates[templateId].printExpandedVariants();
    }
}

function isAreaSet(templateId: number): boolean {
    return templateId &&
           (areaTemplates[templateId].dataExpr !== undefined ||
            areaTemplates[templateId].partnerExpr !== undefined);
}

function fnDump(o: FunctionNode): string {
    return o.idStr() + "=" + o.toString() +
        "; S=" + o.scheduleStep + 
        " P=" + o.prio +
        (o.schedulingError? " SCHERR": "") +
        " O="+(o.valueType? o.valueType.toString(): "undefined") +
        (o.origExpr? " E=" + o.origExpr.id: " E=undefined") +
        (o.getConstancy()? " const": "") +
        (o instanceof ConstNode && o.wontChangeValue? " wontchange": "");
}

// loadCompilerCache(compileEtc);

//
// includedClassConf is first indexed by confLib priority, in indices compatible
//  with 'confLibList' below
//
// for each confLibPriority, it has an object with two attributes: 'name' and
//  'classes'.
//  'name' specifies the confLib name, while 'classes' is a list of class
//    dictionaries
//
// for example,
//
// var includedClassConf = [
//   {
//      name: '',
//      classes: [ __myApp__classes ]
//   },
//   {
//      name: 'Mon1',
//      classes: [ Mon1__fsAppClasses__classes, ...]
//   },
//   {
//      name: 'Core',
//      classes: [ Core__general__classes, Core__table__classes, ...]
//   }
// ];
//
//  where e.g. __myApp__classes is a set of class defs, e.g.:
// __myApp__classes = { MyApp: { ... }, ScreenArea: o(...), ... }
//
declare var includedClassConf: any[];
declare var classes: any;
declare var test: any;

// create 'confLibPriority', mapping each confLibName to its priority value
// (higher values mean lower priority)
genConfLibPriority();

// create 'classDefinitions', a dictionary of all defined classes by class-name
//
// every class in 'includedClassConf' is placed into 'classDefinitions', indexed
//  first by the class-name, then by the confLib-name
//
if (typeof(includedClassConf) !== "undefined") {
    for (let icci = 0; icci !== includedClassConf.length; icci++) {
        let entry: any = includedClassConf[icci];
        addClasses(entry.name, entry.classes);
    }
}

debugger;

// Get some global flags, mainly for debugging
var compileStart: number = Date.now();
mode = gArgParser.getArg("mode", "run");
addDebugInformation = gArgParser.getArg("debugInfo", 1);
// optimize = gArgParser.getArg("optimize", optimize); // See comment at declaration
showResolution = gArgParser.getArg("showResolution", undefined);
maxNrCycles = gArgParser.getArg("maxNrCycles", undefined);
doProfileCycleNr = gArgParser.getArg("profileCycle", undefined);
setErrors(gArgParser.getArg<string>("errors", undefined));
debugLoadJSTime = gArgParser.getArg("debugLoadJSTime", debugLoadJSTime);
pickQualifiedExpressionStrategy = gArgParser.getArg(
    "pickQualifiedExpressionStrategy", pickQualifiedExpressionStrategy);
if (debugLoadJSTime) {
    requirePerformanceNow();
}
FunctionNode.maxCacheDepth = gArgParser.getArg("FunctionNode.maxCacheDepth", FunctionNode.maxCacheDepth);

// xflags, separated by a comma, control dump output; fun/tree/nodes on by default
var xflags: {[flag:string]:boolean} = { fun: true, tree: true, nodes: true };
gArgParser.getArg("xflags", "").split(",").forEach(function(arg: string ,i: number) {
    if (arg.slice(0,3) === "no-") {
        delete xflags[arg.slice(3)];
    } else {
        xflags[arg] = true;
    }
});

setStrictnessLevel(gArgParser.getArg("strictness", undefined));

if ("dumpLOP" in xflags) {
    doDumpLOP = true;
}

if (mode === "convertSyntax") {
    convertSyntax();
    process.exit(0);
}

if (mode === "js" || mode === "javascript") {
    console.log("var fmtVersion = " + gRunFmtVersion + ";\n");
} else if (mode !== "dump") {
    console.log('/// <reference path="functionExecute.d.ts"/>\n');
    console.log("var fmtVersion: number = " + gRunFmtVersion + ";\n");
}

printCompilationInfo();

if (typeof(test) !== "undefined") {
    startTestCompilation();
}
if (mode === "dump") {
    try {
        createAreaTemplates();
    } catch (e) {
        let context: string = gErrContext.getErrorContext();
        console.log("exception in createAreaTemplates at", context);
        console.error(e);
        if (e instanceof RangeError) {
            console.log(FunctionNode.cache2str());
        }
        gError = true;
    }
} else {
    createAreaTemplates();
}

// tests may require entries in the globalFunctionNodes, so they must
// be handled early enough
cacheTestFunction();

if (mode === "dump") {

    if ("fun" in xflags) {
        console.log(FunctionNode.globalFunctionNodes.map(fnDump).join("\n"));
        for (let g_defunNr in FunctionNode.globalDefunFunctionNodes) {
            console.log(FunctionNode.globalDefunFunctionNodes[g_defunNr].map(fnDump).join("\n"));
        }
        for (let g_id = 1; g_id < areaTemplates.length; g_id++) {
            console.log(areaTemplates[g_id].functionNodes.map(fnDump).join("\n"));
            for (let g_defunNr in areaTemplates[g_id].defunFunctionNodes) {
                console.log(areaTemplates[g_id].defunFunctionNodes[g_defunNr].map(fnDump).join("\n"));
            }
        }

        console.log("\n");
        for (let g_i: number = 1; g_i !== exportPaths.length; g_i++) {
            console.log("export #" + g_i, exportPaths[g_i].toString());
        }

        if (typeof(test) !== "undefined") {
            endTestCompilation(true);
        }
    }
    
    if ("tree" in xflags && areaTemplates[1] !== undefined) {
        console.log("\n");
        printAreaTemplateTree(areaTemplates[1]);
    }

    if ("nodes" in xflags) {
        console.log("\n");
        console.log(pathTreeRoot.toStream(function(nodeNr: string, str: string): void {
            console.log(nodeNr + str);
        }));
    }

    if ("inheritgraph" in xflags) {
        console.log("\ndigraph inheritance {");
        for (let g_p in inheritanceGraph) {
            for (let g_c in inheritanceGraph[g_p]) {
                let label = "";
                for (let path in inheritanceGraph[g_p][g_c]) {
                    if (label !== "") label += ",";
                    label += path;
                }
                console.log(g_p + " -> " + g_c + '[label="' + label + '"];');
            }
        }
        console.log("}");
    }

    // Experimental info
    if ("variantsPerTemplate" in xflags)
        printVariantsPerTemplate();
    if ("groupedExpressionSubTrees" in xflags)
        printGroupedExpressionSubTrees();
    if ("expandedVariants" in xflags)
        printExpandedVariants();

    if (areaTemplates[1] !== undefined) {
        areaTemplates[1].accumulateCallsPerTemplate();
    }
    console.log("\ntemplateid\tnr build calls per template\taccum");
    for (let i = 1; i < gNrCallsPerTemplate.length; i++) {
        if (gNrCallsPerTemplate[i] !== undefined) {
            console.log(String(i) + "\t" + String(gNrCallsPerTemplate[i]) + "\t" +
                        String(gAccumulatedNrCallsPerTemplate[i]) + "\t" +
                        areaTemplates[i].getChildPath().join("."));
        }
    }

} else if (!Utilities.hasSyntaxError && !gError && mode === "constraints") {

    printPositionConstraints();

} else if (!Utilities.hasSyntaxError && !gError &&
           (typeof(process) !== "undefined" || mode === "js")) {

    if (mode === "js" || mode === "javascript") {
        console.log("var globalMessageNodeIndex = " + globalMessageNode.id);
        console.log("var pointerNodeIndex = " + pointerNode.id);
        console.log("var nrExports = " + String(exportPaths.length));
        console.log("var exportPaths = " + JSON.stringify(exportPaths));
        console.log("var pathToExportId = " + JSON.stringify(pathToExportId) + "\n");
        console.log("var globalAreasUnderPointerNodeIndex = " +
                    (globalAreasUnderPointerNode === undefined || globalAreasUnderPointerNode.id === -1? "undefined":
                     globalAreasUnderPointerNode.id));
        console.log("var globalDefaultsNodeIndex = " +
                    (globalDefaultsNode === undefined || globalDefaultsNode.id === -1? "undefined":
                     globalDefaultsNode.id));
    } else { // mode = typescript
        console.log("var globalMessageNodeIndex: number = " + globalMessageNode.id);
        console.log("var pointerNodeIndex: number = " + pointerNode.id);
        console.log("var nrExports: number = " + String(exportPaths.length));
        console.log("var exportPaths: string[][] = " + JSON.stringify(exportPaths));
        console.log("var pathToExportId: PathAssociationTree<number> = " + JSON.stringify(exportPaths) + "\n");
        console.log("var globalAreasUnderPointerNodeIndex: number = " +
                    (globalAreasUnderPointerNode === undefined || globalAreasUnderPointerNode.id === -1? "undefined":
                     globalAreasUnderPointerNode.id));
        console.log("var globalDefaultsNodeIndex: number = " +
                    (globalDefaultsNode === undefined || globalDefaultsNode.id === -1? "undefined":
                     globalDefaultsNode.id));
    }

    exportFunctionNodes(undefined, FunctionNode.globalFunctionNodes);
    
    console.log("\ninitAreaTemplate()");
    exportAreaTemplates();

    for (let prio = 0; prio <= Priority.maxPriority; prio++) {
        console.log("_mss(" + String(prio) + ", " + getMaxScheduleStep(prio) + ")");
    }

    if (typeof(test) !== "undefined") {
        endTestCompilation(false);
    }

    if (addDebugInformation > 0) {
        exportDebugInformation();
    }
}

console.log("// compile time:", (Date.now() - compileStart) / 1000, "s");
console.log("// nr wont change:", gWontChangeCount);

function printCompilationInfo(): void {
    console.log("// debuginfo="+addDebugInformation, "optimize="+optimize,
                "errors="+gArgParser.getArg("errors", ""),
                "xflags="+gArgParser.getArg("xflags", ""),
                "strictness="+gArgParser.getArg("strictness", ""));
}
