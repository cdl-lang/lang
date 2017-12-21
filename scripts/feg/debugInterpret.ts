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

/// <reference path="externalTypes.basic.d.ts" />
/// <reference path="cdl.ts" />
/// <reference path="utilities.ts" />
/// <reference path="builtInFunctions.ts" />

enum IntExpressionType {
    builtInFunction,
    attributeValue,
    query,
    functionApplication,
    jsFunctionApplication,
    range,
    subStringQuery,
    orderedSet,
    negation,
    projector,
    terminalSymbol,
    comparisonFunction,
    string,
    number,
    boolean,
    undefined,
    false,
    null,
    unknown
}

function intConvToPrintable(v: any): any {
    if (v instanceof Array) {
        return v.map(intConvToPrintable);
    } else if (v instanceof CoreArea) {
        return "@" + v.areaId;
    } else if (v instanceof ElementReference) {
        return "@" + v.element;
    } else if (v instanceof NonAV) {
        return v;
    } else if (v instanceof Object) {
        return objMap(v, intConvToPrintable);
    } else {
        return v;
    }
}

function intConvToInterpretable(v: any): any {
    if (v instanceof Array) {
        return v.map(intConvToInterpretable);
    } else if (v instanceof NonAV) {
        return v;
    } else if (v instanceof Object) {
        return objMap(v, intConvToInterpretable);
    } else {
        return typeof(v) === "string" && v.charAt(0) === "@"?
               new ElementReference(v.slice(1)): v;
    }
}

function I(expr: any): any {
    return intConvToPrintable(stripArray(interpretCDL(intConvToInterpretable(expr)), true));
}

function intGetArea(v: ElementReference): CoreArea {
    return allAreaMonitor.getAreaById(v.element);
}

function intMakeAreaReference(areaId: string): ElementReference {
    return new ElementReference(areaId);
}

function intGetCdlExpressionType(expr: any): IntExpressionType {
    function isQueryObject(e: any): boolean {
        switch (intGetCdlExpressionType(e)) {
            case IntExpressionType.attributeValue:
            case IntExpressionType.negation:
            case IntExpressionType.range:
            case IntExpressionType.number:
            case IntExpressionType.boolean:
                return true;
            case IntExpressionType.string:
                return true;
            case IntExpressionType.orderedSet:
                return (<MoonOrderedSet>e).os.every(isQueryObject);
            default:
                return false;
        }
    }
    if (expr instanceof Object) {
        return expr instanceof BuiltInFunction ? IntExpressionType.builtInFunction :
               expr instanceof Negation ? IntExpressionType.negation :
               expr instanceof Array ?
               (expr.length === 0 ? IntExpressionType.false :
                  (expr.length === 1 || expr.length === 2) && isQueryObject(expr[0]) ?
                  IntExpressionType.query : IntExpressionType.functionApplication) :
               expr instanceof JavascriptFunction ? IntExpressionType.jsFunctionApplication :
               expr instanceof MoonRange ? IntExpressionType.range :
               expr instanceof MoonComparisonFunction ? IntExpressionType.comparisonFunction :
               expr instanceof MoonSubstringQuery ? IntExpressionType.subStringQuery :
               expr instanceof MoonOrderedSet ? IntExpressionType.orderedSet :
               expr instanceof Projector ? IntExpressionType.projector :
               expr instanceof TerminalSymbol ? IntExpressionType.terminalSymbol :
               expr instanceof RegExp ? IntExpressionType.string :
               IntExpressionType.attributeValue;
    } else {
        switch (typeof (expr)) {
            case "string":
                return IntExpressionType.string;
            case "number":
                return IntExpressionType.number;
            case "boolean":
                return IntExpressionType.boolean;
            case "object":
                return IntExpressionType.null;
            case "undefined":
                return IntExpressionType.undefined;
        }
    }
    return IntExpressionType.unknown;
}

function interpretCDL(expr: any): any {
    function areaReference(s: string): any {
        return s.charAt(0) === "@"? intMakeAreaReference(s.slice(1)): s;
    }
    if (expr instanceof NonAV) {
        return expr;
    }
    switch (intGetCdlExpressionType(expr)) {
        case IntExpressionType.attributeValue:
            return intAttributeValue(expr);
        case IntExpressionType.query:
            return intQuery(expr);
        case IntExpressionType.functionApplication:
            return intFuncAppl(expr);
        case IntExpressionType.jsFunctionApplication:
            break;
        case IntExpressionType.range:
            return new RangeValue((<MoonRange>expr).os.map(interpretCDL), (<MoonRange>expr).closedLower, (<MoonRange>expr).closedUpper);
        case IntExpressionType.subStringQuery:
            return new SubStringQuery((<MoonSubstringQuery>expr).os.map(interpretCDL));
        case IntExpressionType.orderedSet:
            return (<MoonOrderedSet>expr).os.map(interpretCDL);
        case IntExpressionType.negation:
            return new Negation((<Negation>expr).queries.map(interpretCDL));
        case IntExpressionType.projector:
        case IntExpressionType.terminalSymbol:
        case IntExpressionType.comparisonFunction:
        case IntExpressionType.number:
        case IntExpressionType.boolean:
        case IntExpressionType.undefined:
        case IntExpressionType.false:
        case IntExpressionType.null:
        case IntExpressionType.builtInFunction:
            return expr;
        case IntExpressionType.string:
            return areaReference(expr);
    }
    console.log("cannot interpret", expr);
    return undefined;
}

function intAttributeValue(expr: any): any {
    var res: any = {};

    for (var attr in expr) {
        var v = interpretCDL(expr[attr]);
        if (v !== undefined) {
            res[attr] = v;
        }
    }
    return res;
}

function intApplyQuery(q: any, data: any): any {

    function tryPath(q: any, debugInfo: any): {fnRef: FNRef; match: any;} {
        if (debugInfo instanceof FNRef) {
            return {fnRef: debugInfo, match: q};
        }
        if (debugInfo !== undefined &&
              (q instanceof Object && !(q instanceof Array || q instanceof NonAV))) {
            var res: {fnRef: FNRef; match: any;} = undefined;
            for (var attr in q) {
                if (res !== undefined) {
                    return undefined; // Can't handle query with more than one context/content attribute
                }
                if (attr in debugInfo) {
                    res = tryPath(q[attr], debugInfo[attr]);
                    if (res === undefined) {
                        return undefined;
                    }
                }
            }
            return res;
        }
        return undefined;
    }

    if (data instanceof ElementReference && q instanceof Object &&
          !(q instanceof NonAV) && !(q instanceof Array)) {
        var area: CoreArea = intGetArea(data);
        if (area === undefined) {
            return [];
        }
        var debugInfo = debugAreaInfo[area.template.id];
        var fnMatch = tryPath(q, debugInfo) || tryPath({context: q}, debugInfo);
        if (fnMatch === undefined) {
            return [];
        }
        var evalNode = area.getExprByFNRef(fnMatch.fnRef, true); // Careful?
        var res: any = evalNode.result.value;
        if (queryIsSelection(fnMatch.match)) {
            return interpretedBoolMatch(fnMatch.match, res)? [area.areaReference]: undefined;
        } else {
            return interpretedQuery(fnMatch.match, res);
        }
    } else {
        return interpretedQuery(q, data);
    }
}

function intQueryApply(query: any, data: any): any {
    var res: any = [];

    if (!(data instanceof Array)) {
        data = [data];
    }
    for (var i = 0; i < data.length; i++) {
        var match: any = intApplyQuery(query, data[i]);
        if (match !== undefined) {
            res = res.concat(match);
        }
    }
    return res;
}

function intQuery(expr: any): any {
    return intQueryApply(interpretCDL(expr[0]), interpretCDL(expr[1]));
}

var intFuncMap: {[name: string]: ExecutableFunction} = {
    plus: EFPlus.singleton,
    minus: EFMinus.singleton,
    mul: EFMul.singleton,
    div: EFDiv.singleton,
    mod: EFMod.singleton,
    remainder: EFRemainder.singleton,
    pow: EFPow.singleton,
    ln: EFLn.singleton,
    exp: EFExp.singleton,
    log10: EFLog10.singleton,
    logb: EFLogB.singleton,
    round: EFRound.singleton,
    ceil: EFCeil.singleton,
    floor: EFFloor.singleton,
    abs: EFAbs.singleton,
    uminus: EFUMinus.singleton,
    sqrt: EFSqrt.singleton,
    sign: EFSign.singleton,
    coordinates: EFCoordinates.singleton,
    arg: EFArg.singleton,
    pointer: EFPointer.singleton,
    not: EFNot.singleton,
    debugNodeToStr: EFDebugNodeToStr.singleton,
    equal: EFEqual.singleton,
    notEqual: EFNotEqual.singleton,
    bool: EFBool.singleton,
    sequence: EFSequence.singleton,
    or: EFOr.singleton,
    and: EFAnd.singleton,
    nCompareAreasQuery: EFNCompareAreasQuery.singleton,
    empty: EFEmpty.singleton,
    notEmpty: EFNotEmpty.singleton,
    size: EFSize.singleton,
    greaterThan: EFGreaterThan.singleton,
    greaterThanOrEqual: EFGreaterThanOrEqual.singleton,
    lessThan: EFLessThan.singleton,
    lessThanOrEqual: EFLessThanOrEqual.singleton,
    concatStr: EFConcatStr.singleton,
    numberToString: EFNumberToString.singleton,
    range: EFRange.singleton,
    max: EFMax.singleton,
    min: EFMin.singleton,
    sum: EFSum.singleton,
    testStore: EFTestStore.singleton,
    reverse: EFReverse.singleton,
    dynamicAttribute: EFDynamicAttribute.singleton,
    dateToNum: EFDateToNum.singleton,
    numToDate: EFNumToDate.singleton,
    testFormula: EFTestFormula.singleton,
    subStr: EFSubString.singleton,
    stringToNumber: EFStringToNumber.singleton,
};

var gDebugObjClassesInactive: number = 0;

function debugObjAreaOfClass(area: CoreArea, className: string, forceEvaluation: boolean): boolean {
    var watcher = {
        watcherId: getNextWatcherId(),
        dataSourceAware: true,
        totalUpdateInputTime: 0,
        attributedTime: 0,
        updateInput: function(id: any, result: Result): void {},
        debugName: function(): string {
            return "debugObjAreaOfClassWatcher";
        },
        getDebugOrigin: function(): string[] { return []; },
        isDeferred: function(): boolean { return false; },
        defer: function(): void {},
        undefer: function(): void {},
        isActive: function(): boolean { return true; },
        isReady: function(): boolean { return true; }
    };

    if (area.exports !== undefined && "0" in area.exports) {
        if (area.exports[0] === undefined) {
            if (!forceEvaluation) {
                gDebugObjClassesInactive++;
                return false;
            }
        }
        var areaClasses = <EvaluationAV> area.getExport(0);
        if (className in areaClasses.inputByAttr) {
            var classExpr = areaClasses.inputByAttr[className];
            if (forceEvaluation) {
                if (!classExpr.isActive() && forceEvaluation) {
                    try {
                        if (!classExpr.forceActive(watcher, false)) {
                            console.log("node not evaluated on time:",
                                        classExpr.prototype.idStr());
                        }
                    } catch(e) {
                        Utilities.warn(e.toString());
                    }
                    classExpr.deactivate(watcher, false);
                }
            } else if (classExpr.nrActiveWatchers === 0) {
                gDebugObjClassesInactive++;
            }
            return isTrue(classExpr.result.value);
        }
    }
    return false;
}

function debugObjEmbedding(areaDesc: any): string[] {
    var area: CoreArea = areaDesc instanceof CoreArea? areaDesc:
                         areaDesc instanceof ElementReference? intGetArea(areaDesc):
                         undefined;
    var embedding: string[] = [];

    if (area !== undefined) {
        var ptr: CoreArea = area.embedding;
        if (ptr !== undefined) {
            embedding.push(ptr.areaId);
        }
    }
    return embedding;
}

function intEmbeddedFun(areaDesc: any): string[] {
    var area: CoreArea = areaDesc instanceof CoreArea? areaDesc:
                         areaDesc instanceof ElementReference? intGetArea(areaDesc):
                         undefined;

    return area === undefined? []:
           area.getEmbeddedAreaList().map(area => { return area.areaId; });
}

function debugObjEmbeddingStar(areaDesc: any): string[] {
    var area: CoreArea = areaDesc instanceof CoreArea? areaDesc:
                         areaDesc instanceof ElementReference? intGetArea(areaDesc):
                         undefined;
    var embeddingStar: string[] = [];

    if (area !== undefined) {
        var ptr: CoreArea = area.embedding;
        while (ptr !== undefined) {
            embeddingStar.push(ptr.areaId);
            ptr = ptr.embedding;
        }
    }
    return embeddingStar;
}

function intAreaOfClass(className: string, forceEvaluation?: boolean): ElementReference[] {
    var areaRefs: ElementReference[] = [];
    var ids: string[] = allAreaMonitor.getAllAreaIds();

    if (forceEvaluation === undefined) {
        forceEvaluation = globalTaskQueue.pendingTasks.isEmpty();
    }
    resetDebugObjCache();
    gDebugObjMgr.init();
    gDebugObjClassesInactive = 0;
    for (var i = 0; i != ids.length; i++) {
        var areaId = ids[i];
        var area = allAreaMonitor.getAreaById(areaId);
        if (debugObjAreaOfClass(area, className, forceEvaluation)) {
            areaRefs.push(intMakeAreaReference(area.areaId));
        }
    }
    if (gDebugObjClassesInactive > 0) {
        console.warn("warning:", gDebugObjClassesInactive,
                     "areas with inactive class function");
    }
    return areaRefs;
}

function intFuncAppl(expr: any): any {
    var func: any = interpretCDL(expr[0]);
    var args: Result[] = expr.slice(1).map(interpretCDL).map((r: any) => new Result(normalizeObject(r)));

    function iterateOverResult<T>(f: (v: any) => T[], r: Result): T[] {
        return r === undefined || r.value === undefined? []:
               r.value instanceof Array? r.value.reduce(function(prevRes: any, v: any): any {
                   return prevRes.concat(f(v));
               }, []):
               f(r.value);
    }

    if (!(func instanceof BuiltInFunction)) {
        if (args.length !== 1) {
            console.log("cannot interpret function", func);
            return [];
        }
        return intQueryApply(func, args[0].value);
    }
    var funcName: string = (<BuiltInFunction>func).name;
    if (funcName in intFuncMap) {
        return intFuncMap[funcName].execute(args);
    }
    switch (funcName) {
        case "areaOfClass":
            if (args[0] instanceof Result) {
                var className: any = getDeOSedValue(args[0].value);
                if (typeof(className === "string")) {
                    return intAreaOfClass(className);
                }
            }
        case "allAreas":
            return Object.keys(allAreaMonitor.allAreas).map(intMakeAreaReference);
        case "embeddingStar":
            return iterateOverResult(debugObjEmbeddingStar, args[0]).map(intMakeAreaReference);
        case "embedding":
            return iterateOverResult(debugObjEmbedding, args[0]).map(intMakeAreaReference);
        case "embedded":
            return iterateOverResult(intEmbeddedFun, args[0]).map(intMakeAreaReference);
    }
    console.log("cannot interpret function", funcName);
}
