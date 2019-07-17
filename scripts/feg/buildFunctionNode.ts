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

/// <reference path="expression.ts" />
/// <reference path="areaTemplate.ts" />
/// <reference path="functionNode.ts" />
/// <reference path="functionGraph.ts"/>
/// <reference path="queryCompiler.ts"/>
/// <reference path="builtInFunctions.ts"/>

/* From CDL to functions

   The conversion is kicked off by an area (template) looking for the
   expressions that control its behavior (display, position, etc.). The CDL
   expression directly following that section, e.g. { display: "white" }, is
   split into different types. Anything between { ... } is an attribute value,
   [...] is a function application, or a query (depending on the first
   argument); the remainder are values like strings, ordered sets, etc.

   If the first argument of a function application is constant data (though
   not a defun or a built-in function), we try to replace it by its origin.
   If the second argument of the query is [me] (*), we replace the expression
   by the expression of the other attribute. If there is no such attribute,
   the result is o(). If the path is longer, e.g. [{x: {y: _}}, [me]], and
   x is defined as [f, a1, ...], it is translated as [{y: _}, [f, a1, ...]].

   (*) There is rudimentary support for implementing direct access to e.g.
       [embedding, [me]] or [{children: {x: {y: _}}}, [me]], as long as the
       relations between the areas are static.

   The replacement process does this by following the query starting at the
   root of the area template, and then filling in the function node it finds
   at that place. If there is no such node, it will first build the function
   node, and then return it.

   The process is similar if the area is anything else but [me], but not
   completely, since there is no direct access to the function that evaluates
   the expression (**). So instead, the process first gets an id for the
   access path (called the export id), then determines which templates could
   be returned by the second argument of the query, and, to each template,
   adds a mapping from export id to the function that evaluates it in that
   area (template). So [{x: _}, [f, ...]] gets replaced by something like
   [getExportId, #e, [f, ...]], and inside each applicable template, #e maps
   onto [{x: _}, [me]].

   (**) The reason is that each area has a separate set of functions at run
        time, but at this point, we are looking at expressions per area
        template.
   
*/

declare var globalMessageNode: FunctionNode;
declare var pointerNode: FunctionNode;
declare var mode: string;
declare var showResolution: any;
declare var addDebugInformation: number;

// Conventions in the build functions
// origin: the id of the area template where the current expression is being
//   evaluated. When compiling a construction like [{a: ...}, [embedding]],
//   origin will be the embedding's template id, since the query needs to be
//   evaluated there. Also in cases like [{a: {b: ...}}, [me]], the origin can
//   shift when [{a: _}, [me]] points at another area.
// localToArea: the id of the area template that will host the function node.
//   This is generally this highest ancestor of the area template where the
//   expression originates that can still access all information directly.
//   So [{a: _}, [me]] can be translated to a function node with localToArea in
//   its embedding, if a: is defined as a value that exists in the embedding. It
//   can even be translated to a global expression. This usually happens with
//   constants or queries on global functions like [areaOfClass].
// context: the id of the template that defines the context of the current
//   expression. When compiling [{a: [f, ...]}, [me]], a: might point to another
//   area, but the result of the [f, ...] must evaluated in the original
//   context.
// origExpr: ties the generated function node to the expression that it
//   evaluates. This is convenient for debugging, as the relation between some
//   expressions and the resulting function node is quite distant. If it's
//   undefined, the actual expression is the original one.

var gStubCycleNr: number = 0;
var gNextStubCycleNr: number = 0;

function nextStubCycle(): void {
    gNextStubCycleNr++;
    gStubCycleNr = gNextStubCycleNr;
}

function inputsWontChangeValue(fns: FunctionNode[]): boolean {
    return fns.every(function(fn: FunctionNode): boolean {
        return fn instanceof ConstNode && fn.wontChangeValue;
    });
}

function eliminateAVQualifiers(commonQualifiers: SingleQualifier[][],
                       qualifiedAttributes: {[attribute: string]: FunctionNode},
                       localToArea: number, defun: number, suppressSet: boolean,
                       suppressSetAttr: {[attr: string]: boolean},
                       origExpr: Expression): FunctionNode
{
    var functionNodes: FunctionNode[] = [];
    var valueType: ValueType = new ValueType().addSize(1);
    var allFunctionsIdentical: boolean = true;
    var allQualifiersTrue: boolean = true;

    // Build AV node for every qualifier
    for (var i = 0; i !== commonQualifiers.length; i++) {
        var attributes: {[attribute: string]: FunctionNode} = {};
        var allConst: boolean = true;
        var wontChangeValue: boolean = true;
        var subLocalToArea: number = undefined;
        var subLocalToDefun: number = 0;
        for (var attr in qualifiedAttributes) {
            var qualifiedAttribute = <VariantFunctionNode> qualifiedAttributes[attr];
            var fun: FunctionNode = qualifiedAttribute.functionNodes[i];
            subLocalToArea = mergeLocality(subLocalToArea, fun.localToArea);
            subLocalToDefun = mergeDefunLocality(subLocalToDefun, fun.localToDefun);
            if (fun instanceof ConstNode) {
                wontChangeValue = wontChangeValue && fun.wontChangeValue;
            } else {
                allConst = false;
            }
            attributes[attr] = fun;
        }
        fun = AVFunctionNode.buildAV(attributes, subLocalToArea, subLocalToDefun,
             allConst, wontChangeValue, suppressSet, suppressSetAttr, origExpr);
        functionNodes.push(fun);
        if (i !== 0 && !fun.isEqual(functionNodes[0])) {
            allFunctionsIdentical = false;
        }
        if (commonQualifiers[i].length !== 0) {
            allQualifiersTrue = false;
        }
        valueType = valueType.merge(fun.valueType);
    }
    return functionNodes.length === 0?
        buildConstNode(undefined, false, suppressSet, 0, gUndefinedExpr):
        allFunctionsIdentical && allQualifiersTrue? functionNodes[0]:
        VariantFunctionNode.build2(commonQualifiers, functionNodes, valueType, origExpr, undefined);
}

function buildAVNode1(node: PathTreeNode, origin: number, defun: number, suppressSet: boolean, origExpr: Expression): FunctionNode {
    var attributes: {[attribute: string]: FunctionNode} = {};
    var localToArea: number = undefined;
    var localToDefun: number = 0;
    var allConst: boolean = true;
    var identicalQualifiers = true;
    var firstVariantNode: VariantFunctionNode = undefined;
    var suppressSetAttr: {[attr: string]: boolean} = {};
    var wontChangeValue: boolean = true;

    function valueIsUndefined(fn: FunctionNode): boolean {
        if (fn instanceof ConstNode) {
            var cn = <ConstNode> fn;
            return cn.value === undefined;
        }
        return false;
    }

    function combSuppr(s1: boolean, s2: boolean): boolean {
        if (s2 === undefined) {
            return s1;
        } else {
            return s1 !== true && s2; // false dominates
        }
    }

    if (Utilities.isEmptyObj(node.next)) {
        return buildConstNode(undefined, true, suppressSet, 0, gUndefinedExpr);
    }
    for (var attr in node.next) {
        if (attr === "class") {
            continue;
        }
        var attrVal: PathTreeNode = node.next[attr];
        var fun: FunctionNode = buildFunctionNode(attrVal, origin, defun, suppressSet);
        if (fun !== undefined && !valueIsUndefined(fun)) {
            attributes[attr] = fun;
            localToArea = mergeLocality(localToArea, fun.localToArea);
            localToDefun = mergeDefunLocality(localToDefun, fun.localToDefun);
            if (fun instanceof ConstNode) {
                identicalQualifiers = false;
                wontChangeValue = wontChangeValue && fun.wontChangeValue;
            } else {
                allConst = false;
                if (suppressSet !== undefined && !(fun instanceof AVFunctionNode)) {
                    var suppress: boolean = attrVal.isSuppressSetPath();
                    // fun doesn't know about suppressSet, so we register it here
                    if (suppress !== undefined) {
                        suppressSetAttr[attr] = suppress;
                    }
                }
                if (fun instanceof VariantFunctionNode) {
                    if (firstVariantNode === undefined) {
                        firstVariantNode = fun;
                    } else if (!firstVariantNode.identicalQualifiers(fun)) {
                        identicalQualifiers = false;
                    }
                } else {
                    identicalQualifiers = false;
                }
            }
        } else if (fun instanceof ConstNode) {
            wontChangeValue = wontChangeValue && fun.wontChangeValue;
        }
    }
    var fn: FunctionNode;
    if (Utilities.isEmptyObj(attributes)) {
        fn = buildConstNode(undefined, false, suppressSet, 0, gUndefinedExpr);
    } else if (identicalQualifiers && firstVariantNode !== undefined &&
               node.canBeCombined()) {
        fn = eliminateAVQualifiers(firstVariantNode.qualifiers.qualifiers, attributes,
                            localToArea, localToDefun, node.isSuppressSetPath(),
                            suppressSetAttr, origExpr);
    } else {
        fn = AVFunctionNode.buildAV(attributes, localToArea, localToDefun,
                              allConst && node.canBeCombined(), wontChangeValue,
                              combSuppr(suppressSet, node.isSuppressSetPath()),
                              suppressSetAttr, origExpr);
    }
    if (fn !== undefined && node.isWritableReference()) {
        fn = updateWritableNode(node.getContextPath(), fn, node.getAreaId(),
                                new PathInfo(node.getPath(), undefined,
                                  undefined, undefined, true, [], 0, undefined,
                                  undefined, undefined),
                                fn.valueType, fn.origExpr);
    }
    return fn;
}

class QualifierWithCycles {
    qualifiers: SingleQualifier[] = [];
    cycles: number[] = undefined;
}

function getParent(templateId: number, level: number): number {
    var template: AreaTemplate = areaTemplates[templateId];

    for (var i: number = 0; i < level; i++) {
        template = template.parent;
    }
    return template.id;
}

// Assumption: single context attribute, fixed value
function buildQualifier(qualifiers: CDLQualifierTerm[], origin: number, defun: number, knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][]): QualifierWithCycles {
    var qualifierWithCycles = new QualifierWithCycles();

    for (var i: number = 0; i !== qualifiers.length; i++) {
        var qualifier: string = qualifiers[i].attribute;
        if (qualifiers[i].value === undefined) {
            errorReporters["undefined"]("explicit undefined value in qualifier");
            return undefined;
        }
        var knownValue: any =
            SingleQualifier.getQualifierValue(knownTrueQualifiers, qualifier, origin);
        var match: boolean = knownValue === undefined? undefined:
                         SingleQualifier.match(qualifiers[i].value, knownValue);
        if (match === false) {
            return undefined; // this condition will never match
        } else if (match === true) {
            // this qualifier always matches; no need to build a condition
        } else {
            // must determine match at runtime
            var attrQuery: FunctionNode;
            var targetArea: number = getParent(origin, qualifiers[i].level);
            attrQuery = buildSimpleFunctionNode(
                ExpressionQuery.build(makeContextQuery(qualifier, gProjectorExpr), gMeExpr),
                undefined, targetArea, 0, false, knownTrueQualifiers, knownFalseQualifiers, undefined, targetArea);
            if (attrQuery instanceof QueryCycle) {
                if (qualifierWithCycles.cycles === undefined) {
                    qualifierWithCycles.cycles = [];
                }
                qualifierWithCycles.cycles.push(i);
            } else if (attrQuery === undefined) {
                // an undefined attribute cannot match anything
                return undefined;
            } else if (attrQuery instanceof ConstNode) {
                var val = <ConstNode> attrQuery;
                if ((val.value === undefined && qualifiers[i].value !== undefined) ||
                      (val.value !== undefined && !interpretedQualifierMatch(qualifiers[i].value, val.value))) {
                    return undefined; // this condition will never match
                }
                // this condition will always match, so can be skipped
            } else if (isSimpleType(qualifiers[i].value) ||
                       qualifiers[i].value instanceof MoonRange ||
                       (qualifiers[i].value instanceof MoonOrderedSet &&
                        qualifiers[i].value.os.every(function(elem: any): boolean {
                            return typeof(elem) in simpleTypes;
                        }))) {
                if (qualifiers[i].value === true || qualifiers[i].value === false) {
                    if (qualifiers[i].value === true) {
                        match = attrQuery.isAlwaysTrue()? true: attrQuery.isAlwaysFalse()? false: undefined;
                    } else {
                        match = attrQuery.isAlwaysTrue()? false: attrQuery.isAlwaysFalse()? true: undefined;
                    }
                }
                if (match === false) {
                    return undefined; // this condition will never match
                } else if (match === true) {
                    // this qualifier always matches; no need to build a condition
                } else {
                    qualifierWithCycles.qualifiers.push(
                        new SingleQualifier(attrQuery, qualifiers[i].attribute,
                                            qualifiers[i].value, targetArea));
                }
            } else {
                // Turn {attr: query} into [query, [{attr: _}, [me]]]: true
                var qualifierQuery: Expression =
                    expressionStore.get(qualifiers[i].value, undefined);
                var query: FunctionNode = buildQueryNodeOnFunction(
                  qualifierQuery, attrQuery, origin, 0, qualifierQuery, origin);
                var strRep: string = qualifiers[i].attribute + ":" +
                                     convertValueToString(qualifiers[i].value);
                qualifierWithCycles.qualifiers.push(
                    new SingleQualifier(query, strRep, true, targetArea,
                                 qualifiers[i].attribute, qualifiers[i].value));
            }
        }
    }
    return qualifierWithCycles;
}

function isConst(v: FunctionNode): boolean {
    return v instanceof ConstNode || v instanceof DefunNode;
}

// Returns g2 => g1
function isImpliedBy(g1: SingleQualifier[], g2: SingleQualifier[]): boolean {
    return g1.every(function(g1e: SingleQualifier) {
        return g2.some(function(g2e: SingleQualifier) {
            return g2e.isEqualSym(g1e);
        })
    });
}

// Returns index of the last function node that is unmergeable and implied
// by the current qualifier. If there is no such node, it returns -1.
// Used to check if there is any point in adding a new function node.
function lastImpliedUnmergeable(qualifier: SingleQualifier[], qualifiers: SingleQualifier[][], functionNodes: FunctionNode[]): number {
    for (var i: number = qualifiers.length - 1; i >= 0; i--) {
        if ((functionNodes[i].isUnmergeable() ||
               !functionNodes[i].valueType.isPotentiallyMergeable()) &&
              isImpliedBy(qualifiers[i], qualifier)) {
            return i;
        }
    }
    return -1;
}

// Assumption: only depends on current area and its parents
// knownTrueQualifiers is an array of known qualifiers per level.
function buildQualifierNode(values: PathInfo[], origin: number, defun: number,
                            suppressSet: boolean, contextAttribute: string,
                            node: PathTreeNode
                           ): FunctionNode
{
    var qualifiers: SingleQualifier[][] = [];
    var functionNodes: FunctionNode[] = [];

    function lastImplied(qualifier: SingleQualifier[]): number {
        for (var i: number = qualifiers.length - 1; i >= 0; i--) {
            if (isImpliedBy(qualifiers[i], qualifier)) {
                return i;
            }
        }
        return -1;
    }

    /* Attempt to simplify

       Note that information about actual values of qualifiers is given, which
       means that qualifier lists can be shortened or skipped.
       
       Scenario 1: identical qualifiers
       o(qualifier: {a: 1, b: 2}, variant: x
         ...
         qualifier: {a: 1, b: 2}, variant: y
         ...)
       I. If merge(x, y) == x, (i.e., x is a constant and a simple value, or x
       is a constant and not a simple value and y is a constant and a simple
       value, or x and y are identical expressions), then the second condition
       can be removed.
       II. If x and y are both constants and not simple values, and there is no
       qualifier in between that can be true (when a=1 and b=2), then this can
       be replaced by
       o(qualifier: {a: 1, b: 2}, variant: merge(x, y)
         ...)
       III. If x is a constant and a simple value, then this can
       be replaced by
       o(qualifier: {a: 1, b: 2}, variant: x
         ...)

       Scenario 2: implied qualifiers
       o(qualifier: {a: 1, b: 2}, variant: x
         ...
         qualifier: {a: 1}, variant: y
         )
       The second qualifier is implied by the first. This could be replaced by
       o(qualifier: {a: 1, b: 2}, variant: merge(x, y)
         ...
         qualifier: {a: 1, b: n(2)}, variant: y
         ...)

       Scenario 3: more restrictive qualifiers
       o(qualifier: {a: 1}, variant: x
         ...
         qualifier: {a: 1, b: 2}, variant: y
         )
       The second qualifier is more restrictive than the first (it actually
       implies the first). When x is constant and simple, or when
       merge(x, y) == x, this can be replaced by
       o(qualifier: {a: 1}, variant: x
         ...)

       We will not attempt 2, and 1.II only when the variants are consecutive.
       We also exclude the "ClassInfo" values from this, since they translate to
       a qualified true value, and hence are seen as unmergeable constants. 2
       will only be recognized when x == y, and hence the result is always y
       when the more general qualifier is true.

       Note that (for the purpose of) simplification, we only have to look at
       the last implied qualifier (which includes identical qualifiers) before
       the current position: if there are more, they are not constant, and
       cannot be removed.

       It can happen that a value contains a qualifier which refers to the same
       value. Only in the case it is a context attribute that has itself as
       qualifier, and its variant value is constant, we resolve it. Otherwise,
       we remove it and give a warning. TODO: this is wrong; solve it better.

    */

    var usedPathInfo: PathInfo[] = [];
    var usedValueIndex: number[] = [];
    var nrWritables: number = 0;
    // Each of these represent a qualifier (group) that is false when the next
    // function is evaluated
    var knownFalseQualifiers: SingleQualifier[][] = [];
    var nrEliminated: number = 0;
    for (var i: number = 0; i !== values.length; i++) {
        // localToArea of qualifiers is always [me] or one of the parents, but
        // since the parents exist when [me] exists, that is not a problem.
        if (!values[i].eliminated) {
            gErrContext.enter(undefined, values[i]);
            var qualifierWithCycles = buildQualifier(values[i].qualifierTerms, origin, defun, undefined, knownFalseQualifiers);
            if (qualifierWithCycles !== undefined) {
                var lib: number = lastImplied(qualifierWithCycles.qualifiers);
                var libc: number = lastImpliedUnmergeable(qualifierWithCycles.qualifiers, qualifiers, functionNodes);
                var fun: FunctionNode = undefined;
                var qualifier: SingleQualifier[] = qualifierWithCycles.qualifiers;
                if (lib === -1 /* && libc === -1 */) {
                    // Nothing implied, so check scenario 2 for consecutive variants
                    // with identical values; only keep last value
                    var p: number = qualifiers.length - 1;
                    if (qualifiers.length !== 0 && usedValueIndex[p] === i - 1 &&
                          optimize && isImpliedBy(qualifier, qualifiers[p]) &&
                          values[i].expression.id === usedPathInfo[p].expression.id) {
                        // Look if there are more cases preceding this one and
                        // delete them
                        do {
                            var elimPos: number = usedValueIndex.pop();
                            var elimVal: PathInfo = values[elimPos];
                            var uv: PathInfo = usedPathInfo.pop();
                            elimVal.eliminated = true;
                            fun = functionNodes.pop();
                            if (fun instanceof WritableNode) {
                                var wrNode = <WritableNode> fun;
                                if (wrNode.pathInfo === uv) {
                                    nrWritables--;
                                }
                            }
                            qualifiers.pop();
                            p--;
                        } while (p >= 0 && isImpliedBy(qualifier, qualifiers[p]) &&
                                 values[i].expression.id === usedPathInfo[p].expression.id);
                        // Now we can let the current qualifiers and function take
                        // the place of the removed ones.
                    }
                    fun = buildSimpleFunctionNode(values[i].expression, values[i],
                                                  origin, defun, suppressSet, qualifier,
                                                  knownFalseQualifiers, undefined, origin);
                } else if (optimize && lib === functionNodes.length - 1 &&
                           values[i].expression.id === usedPathInfo[lib].expression.id) {
                    // The previous one was implied and has the same expression,
                    // so this value won't make any change
                    fun = undefined;
                } else if (libc !== -1 && optimize) {
                    // Last implied variant was unmergeable
                    fun = undefined;
                } else {
                    fun = buildSimpleFunctionNode(
                        values[i].expression, values[i], origin, defun,
                        suppressSet, qualifier, knownFalseQualifiers,
                        undefined, origin);
                    if (optimize &&
                         (fun.isUnmergeable() || 
                          !fun.valueType.isPotentiallyMergeable())) {
                        // There is a last implied variant, and this one cannot be
                        // merged
                        fun = undefined;
                    }
                }
                if (fun !== undefined) {
                    fun = fun.valueUnderQualifier(qualifier, knownFalseQualifiers);
                    if (qualifierWithCycles.cycles !== undefined) {
                        var cyclicQNr: number = qualifierWithCycles.cycles[0];
                        var cyclicQual = cyclicQNr !== undefined && values[i].qualifierTerms[cyclicQNr];
                        if (fun instanceof ConstNode &&
                            qualifierWithCycles.cycles.length === 1 && 
                            cyclicQual.attribute === contextAttribute) {
                            var qc = <ConstNode> fun;
                            if (interpretedQualifierMatch(cyclicQual.value, qc.value)) {
                                // Everything's cool; expression is not influenced
                                // by value of the context attribute
                                Utilities.warnOnce("redundant cyclical qualifier: " + contextAttribute + " @ " + origin);
                            } else {
                                // CDLQualifierTerm is always false
                                Utilities.warnOnce("conflicting cyclical qualifier: " + contextAttribute + " @ " + origin);
                                fun = undefined;
                            }
                        } else {
                            gErrContext.enter(undefined, values[i]);
                            Utilities.warnOnce(
                                "cycle in qualifier {" + values[i].qualifierTerms.map(
                                    function(q: CDLQualifierTerm): string {
                                        return q.toString();
                                    }) + "}");
                            gErrContext.leave();
                        }
                    }
                    qualifiers.push(qualifier);
                    functionNodes.push(fun);
                    usedPathInfo.push(values[i]);
                    usedValueIndex.push(i);
                    if (fun instanceof WritableNode) {
                        var wrNode = <WritableNode> fun;
                        if (wrNode.pathInfo === values[i]) {
                            nrWritables++;
                        }
                    }
                }
                if (knownFalseQualifiers.length === i - nrEliminated &&
                    i < values.length - 1 &&
                    (fun === undefined || fun.isUnmergeable() || 
                     !fun.valueType.isPotentiallyMergeable())) {
                    knownFalseQualifiers.push(qualifier);
                }
            }
            gErrContext.leave();
        } else {
            nrEliminated++;
        }
    }

    return VariantFunctionNode.build(qualifiers, functionNodes, nrWritables,
                                     usedPathInfo, suppressSet, node);
}

// While building the expressions, the number of embedded or embeddedStar areas
// may not be stable. We therefore call signalOutputChange() when then number of
// areas found in the current cycle differs from that found in the previous
// cycle.
var nrOutputAreasPartner: {[templateId: number]: number} = {};
var nrOutputAreasEmbeddedStar: {[templateId: number]: number} = {};

// Determines and updates the size of the result
function updateValueSize(valueType: ValueType, fun: BuiltInFunction, args: FunctionNode[], origin: number): void {
    switch (fun.name) {
      // functions that have size 0
      case "debugBreak":
        valueType.sizes = [_r(0, 0)];
        break;
      // functions that have size 0 or 1
      case "first":
      case "last":
        valueType.sizes = [_r(0, 1)];
        break;
      // The result of evaluating push() is 1, but when it is merged, the result
      // can be infinitely large, so this is a bit of a trick to propagate
      // Infinity to the write target. A better solution would be to check the
      // guaranteed absence of a push() in every merge: clause, and assume
      // r(1, Infinity) when it might be present.
      case "internalPush":
        valueType.sizes = [_r(1, Infinity)];
        break;
      case "index":
        if (args[0] !== undefined && args[0].valueType !== undefined) {
            valueType.sizes = ValueTypeSize.max(args[0].valueType.sizes);
        }
        break;
      case "pos":
        if (args[1] !== undefined && args[1].valueType !== undefined) {
            valueType.sizes = ValueTypeSize.max(args[1].valueType.sizes);
        }
        break;
      case "internalApply":
        if (args[0] !== undefined && args[1] !== undefined &&
              args[1].valueType !== undefined &&
              !(args[0].valueType.anyData || args[0].valueType.defun ||
                args[0].valueType.unknown || args[0].valueType.projector)) {
            // When the first argument is data and not a defun or projector,
            // the result can't be larger than the second argument.
            valueType.sizes = ValueTypeSize.max(args[1].valueType.sizes);
        } else {
            valueType.sizes = [_r(0, Infinity)];
        }
        break;
      // arithmetic functions
      case "lessThan":
      case "lessThanOrEqual":
      case "greaterThanOrEqual":
      case "greaterThan":
        if (args[0] !== undefined && args[0].valueType !== undefined && args[1] !== undefined && args[1].valueType !== undefined) {
            valueType.sizes = ValueTypeSize.minOfSizes(args[0].valueType.sizes, args[1].valueType.sizes);
        }
        break;
      // arbitrary size
      case "testStore":
        valueType.sizes = [_r(0, Infinity)];
        break;
      // Basic arithmentic and foreign functions return one result per element
      // in the arguments. Since there's a special case for arguments of length
      // 1, the maximum length of all arguments is used as the default.
      default:
        valueType.sizes = undefined;
        for (var i: number = 0; i < args.length; i++) {
            var arg: FunctionNode = args[i];
            if (arg !== undefined) {
                if (arg.valueType === undefined) {
                    valueType.sizes = undefined;
                    break;
                }
                if (valueType.sizes === undefined) {
                    valueType.sizes = arg.valueType.sizes;
                } else {
                    valueType.sizes = ValueTypeSize.minOfSizes(valueType.sizes, arg.valueType.sizes);
                }
            }
        }
    }
}

function allAreasValueType(): ValueType {
    var valueType: ValueType = new ValueType();

    for (var areaTemplateId: number = 1;  areaTemplateId !== areaTemplates.length; areaTemplateId++) {
        var template = areaTemplates[areaTemplateId];
        valueType.addArea(areaTemplateId, template.getNumberOfAreasRangeUnder(1));
    }
    return valueType;
}

// Returns set of area template ids returned by area functions
function getValueType(fun: BuiltInFunction, args: FunctionNode[], origin: number): ValueType {
    var valueType: ValueType;
    var template: AreaTemplate;
    var inputType: Map<number, ValueType>;
    var inputList: number[];
    var funName: string = fun.name;
    var nrOutputAreas: number;

    if (fun.valueType !== undefined) {
        if (fun.valueType.sizes !== undefined) {
            return fun.valueType;
        } else {
            valueType = fun.valueType.copy();
            updateValueSize(valueType, fun, args, origin);
            // assert(valueType.sizes !== undefined, "no size for " + funName);
            return valueType;
        }
    }
    valueType = new ValueType();

    function copyValueTypeFromArg(requiredLength: number, index: number): ValueType {
        return args.length !== requiredLength? new ValueType(): args[index].valueType;
    }

    function checkPartnerExpr(template: AreaTemplate): void {
        if (template.partnerExpr.needsResolution()) {
            // assuming this cannot come from a defun body
            buildFunctionNode(template.partnerExpr, template.parent.id, 0, undefined);
        }
        if (template.partnerExpr.functionNode !== undefined) {
            gErrContext.enter(template.partnerExpr, undefined);
            assert(template.partnerExpr.functionNode.valueType.isAreas(), "shouldn't be data");
            gErrContext.leave();
            var nrOutputAreas: number = template.partnerExpr.functionNode.valueType.areas?
                template.partnerExpr.functionNode.valueType.areas.size:
                undefined;
            if (nrOutputAreas !== nrOutputAreasPartner[template.id]) {
                signalOutputChange(undefined, {
                    type: "nrOutputAreas",
                    from: nrOutputAreasPartner[template.id],
                    to: nrOutputAreas
                });
                nrOutputAreasPartner[template.id] = nrOutputAreas;
            }
        }
    }

    function collectEmbeddedStar(template: AreaTemplate, areas: Map<number, RangeValue[]>): number {
        var nr: number = 0;

        for (var childName in template.children) {
            var childTemplate: AreaTemplate = template.children[childName];
            if (!childTemplate.embeddingInReferred) {
                if (!areas.has(childTemplate.id)) {
                    areas.set(childTemplate.id, childTemplate.getNumberOfAreasRangeUnder(childTemplate.parent.id));
                    nr++;
                }
                nr += collectEmbeddedStar(childTemplate, areas);
            }
            for (var areaTemplateId2: number = 1; areaTemplateId2 !== areaTemplates.length; areaTemplateId2++) {
                childTemplate = areaTemplates[areaTemplateId2];
                if (childTemplate.embeddingInReferred && childTemplate.doesExist !== false) {
                    checkPartnerExpr(childTemplate);
                    if (childTemplate.partnerExpr.functionNode !== undefined &&
                          childTemplate.partnerExpr.functionNode.valueType.areas &&
                          childTemplate.partnerExpr.functionNode.valueType.areas.has(template.id)) {
                        if (!(areaTemplateId2 in areas)) {
                            areas.set(areaTemplateId2, childTemplate.getNumberOfAreasRangeUnder(childTemplate.parent.id));
                            nr++;
                        }
                        nr += collectEmbeddedStar(childTemplate, areas);
                    }
                }
            }
        }
        return nr;
    }

    var template: AreaTemplate;
    var nrAreas: RangeValue[];
    switch (funName) {
      case "me":
        valueType = new ValueType().addArea(origin, [_r(1, 1)]);
        break;
      case "allAreas":
        valueType = allAreasValueType();
        break;
      case "prev":
      case "prevPlus":
      case "prevStar":
      case "next":
      case "nextPlus":
      case "nextStar":
        if (args.length === 0) {
            template = areaTemplates[origin];
            if (fun.name === "prev" || fun.name === "next") {
                nrAreas = [_r(0, 1)];
            } else {
                nrAreas = ValueTypeSize.max(template.getNumberOfAreasRangeUnder(template.parent.id));
            }
            valueType = new ValueType().addArea(origin, nrAreas); // [prev, [me]] is of same class as [me]
        } else if (args.length === 1) {
            valueType = args[0].valueType; // [prev, x] is of same class and size as x; it has to be an area, though
            if (!valueType.areas) {
                Utilities.typeError("single argument " + fun.name + " requires area argument");
            }
        } else if (args.length === 2) {
            // Both should be of the same type, result is that of the first
            // one, the collection.
            // We don't bother looking for error messages or warnings here,
            // since it generates a few false warnings (in the first cycle),
            // and never a true one.
            valueType = args[0].valueType.copy();
            valueType.sizes = fun.name === "next" || fun.name === "prev"?
                ValueTypeSize.minOfSizes(args[0].valueType.sizes, args[1].valueType.sizes):
                ValueTypeSize.max(valueType.sizes);
        }
        break;
      case "expressionOf": // expressionOf is the direct parent
      case "embedding": // embedding is the direct parent, except when embedding: "referred"
        valueType = new ValueType();
        if (args.length === 0) { // then assume [me]
            inputType = new Map<number, ValueType>();
            inputType.set(origin, new ValueType().addSize(1));
        } else if (args.length === 1) {
            if (!args[0].valueType.isAreas()) {
                Utilities.typeError("areas expected as arguments: " + fun.name);
            }
            inputType = args[0].valueType.areas;
        } else {
            Utilities.syntaxError("too many arguments for: " + fun.name);
        }
        if (inputType !== undefined) {
            for (var [areaTemplateId1, type] of inputType) {
                template = areaTemplates[areaTemplateId1];
                if (template.doesExist !== false) {
                    if (template.parent === undefined) {
                        Utilities.warnOnce(fun.name + " on screen area:" +
                                    getShortChildPath(template.areaNode.getPath()));
                    } else if (fun.name === "expressionOf" &&
                            template.partnerExpr === undefined) {
                        Utilities.warnOnce("expressionOf on non-intersection: " +
                                    getShortChildPath(template.areaNode.getPath()));
                    } else if (fun.name === "embedding" && template.embeddingInReferred) {
                        if (template.partnerExpr === undefined) {
                            Utilities.warnOnce("referredOf on non-intersection: " +
                                        getShortChildPath(template.areaNode.getPath()));
                        } else {
                            checkPartnerExpr(template);
                            if (template.partnerExpr.functionNode.valueType.isStrictlyAreas()) {
                                valueType.addAreas(template.partnerExpr.functionNode.valueType.areas, true, type.areas);
                            }
                        }
                    } else {
                        valueType.addArea(template.parent.id, type.sizes);
                    }
                }
            }
        }
        break;
      case "referredOf": // referredOf is the partner
        valueType = new ValueType();
        if (args.length === 0) { // then assume [me]
            inputType = new Map<number, ValueType>();
            inputType.set(origin, new ValueType().addSize(1));
        } else if (args.length === 1) {
            assert(args[0].valueType.isAreas(), "areas expected as arguments");
            inputType = args[0].valueType.areas;
        } else {
             Utilities.syntaxError("too many arguments for: " + fun.name);
        }
        if (inputType !== undefined) {
            for (var [areaTemplateId1, type] of inputType) {
                template = areaTemplates[areaTemplateId1];
                if (template.doesExist !== false) {
                    if (template.partnerExpr === undefined) {
                        Utilities.warnOnce("referredOf on non-intersection: " +
                                    getShortChildPath(template.areaNode.getPath()));
                    } else {
                        checkPartnerExpr(template);
                        if (template.partnerExpr.functionNode.valueType.isStrictlyAreas()) {
                            valueType.addAreas(template.partnerExpr.functionNode.valueType.areas, true, type.areas);
                        }
                    }
                }
            }
        }
        break;
      case "embedded":
        // TODO: embedding: "referred"
        valueType = new ValueType();
        if (args.length === 0) { // then assume [me]
            inputType = new Map<number, ValueType>();
            inputType.set(origin, new ValueType().addSize(1));
        } else if (args.length === 1) {
            assert(args[0].valueType.isAreas(), "areas expected as arguments");
            inputType = args[0].valueType.areas;
        } else {
            Utilities.syntaxError("too many arguments for: " + fun.name);
        }
        if (inputType !== undefined) {
            for (var [areaTemplateId1, type] of inputType) {
                template = areaTemplates[areaTemplateId1];
                // Skip direct children with embedding: "referred"
                for (var childName in template.children) {
                    if (!template.children[childName].embeddingInReferred) {
                        nrAreas = template.children[childName].getNumberOfAreasRangeUnder(template.id);
                        valueType.addArea(template.children[childName].id,
                                        ValueTypeSize.multiplySizes(nrAreas,
                                                                    type.sizes));
                    }
                }
                // Add areas that have embedding: "referred" and one of the input
                // areas as partner. This can overgenerate, but that's not a
                // problem.
                for (var areaTemplateId2: number = 1; areaTemplateId2 !== areaTemplates.length; areaTemplateId2++) {
                    template = areaTemplates[areaTemplateId2];
                    if (template.embeddingInReferred && template.doesExist !== false) {
                        checkPartnerExpr(template);
                        if (template.partnerExpr.functionNode !== undefined &&
                              template.partnerExpr.functionNode.valueType.areas !== undefined &&
                              template.partnerExpr.functionNode.valueType.areas.has(areaTemplateId1)) {
                            nrAreas = template.getNumberOfAreasRangeUnder(template.parent.id);
                            valueType.addArea(areaTemplateId2, nrAreas);
                        }
                    }
                }
            }
        }
        break;
      case "embeddingStar":
        // TODO: embedding: "referred"
        valueType = new ValueType();
        inputList = [];
        if (args.length === 0) { // then assume [me]
            inputList.push(origin);
        } else if (args.length === 1) {
            assert(args[0].valueType.isAreas(), "areas expected as arguments");
            if (args[0].valueType.areas !== undefined) {
                for (var areaTemplateId3 of args[0].valueType.areas.keys()) {
                    inputList.push(areaTemplateId3);
                }
            }
        } else {
            Utilities.syntaxError("too many arguments for: " + fun.name);
        }
        for (var i: number = 0; i < inputList.length; i++) {
            var areaTemplateId: number = inputList[i];
            template = areaTemplates[areaTemplateId];
            if (template.embeddingInReferred && template.doesExist !== false) {
                checkPartnerExpr(template);
                if (template.partnerExpr.functionNode !== undefined &&
                      template.partnerExpr.functionNode.valueType.areas !== undefined) {
                    for (var areaTemplateId3 of template.partnerExpr.functionNode.valueType.areas.keys()) {
                        valueType.addArea(areaTemplateId3, [_r(1, 1)]);
                        inputList.push(areaTemplateId3);
                    }
                }
            } else if (template.parent !== undefined) {
                template = template.parent;
                valueType.addArea(template.id, [_r(1, 1)]);
                inputList.push(template.id);
            }
        }
        break;
      case "embeddedStar":
        // TODO: determine an estimate for the number of areas
        valueType = new ValueType();
        if (args.length === 0) { // then assume [me]
            inputType = new Map<number, ValueType>();
            inputType.set(origin, new ValueType().addSize(1));
        } else if (args.length === 1) {
            assert(args[0].valueType.isAreas(), "areas expected as arguments");
            inputType = args[0].valueType.areas;
        } else {
            Utilities.syntaxError("too many arguments for: " + fun.name);
        }
        if (inputType !== undefined) {
            for (var areaTemplateId1 of inputType.keys()) {
                var embeddedStar = new Map<number, RangeValue[]>();
                template = areaTemplates[areaTemplateId1];
                nrOutputAreas = collectEmbeddedStar(template, embeddedStar);
                if (nrOutputAreasEmbeddedStar[areaTemplateId1] !== nrOutputAreas) {
                    // An expression like [embeddedStar, [me]] will be shared
                    // and therefore all instances must have the same output type.
                    signalOutputChange(undefined, {
                        type: "nrOutputAreas",
                        from: nrOutputAreasPartner[areaTemplateId1],
                        to: nrOutputAreas
                    });
                    nrOutputAreasEmbeddedStar[areaTemplateId1] = nrOutputAreas;
                }
                for (var [areaTemplateId3, ranges] of embeddedStar) {
                    valueType.addArea(areaTemplateId3, ranges);
                }
            }
        }
        break;
      case "merge":
      case "mergeWrite":
        if (args.length >= 1) {
            // All should be data
            for (var i: number = 0; i < args.length; i++) {
                valueType = valueType.merge(args[i].valueType);
            }
        } else {
            Utilities.syntaxError("too few arguments for: " + fun.name);
        }
        break;
      case "map":
        if (args.length < 2) {
            Utilities.syntaxError("too few arguments for: " + fun.name);
        }
        if (args[0] === undefined || args[0].valueType.isNotData()) {
            Utilities.error("first argument to " + fun.name + " must be data");
        }
        if (args[0] !== undefined && args[0].valueType.isStrictlyDefun()) {
            valueType = args[0].valueType.defun;
        } else {
            valueType = new ValueType().addAnyData();
        }
        if (args.length >= 2) {
            // This could use some refinement for more than 1 argument.
            valueType.sizes = args[1].valueType.sizes;
        }
        break;
      case "filter": // multiQuery and filter operate on data, and return the same data type as its input
      case "multiQuery":
        if (args.length !== 2) {
            Utilities.syntaxError("too few arguments for: " + fun.name);
        }
        if (args[0] === undefined || args[0].valueType.isNotData()) {
            Utilities.error("first argument to " + fun.name + " must be data");
        }
        valueType = copyValueTypeFromArg(2, 1);
        valueType.sizes = ValueTypeSize.max(valueType.sizes);
        break;
      case "message":
      case "myMessage":
        valueType = globalMessageNode.valueType;
        break;
      case "identify":
      case "pos":
      case "range":
        // All of them 2 arguments, the os is the last, so determines the type
        valueType = copyValueTypeFromArg(2, 1);
        break;
      case "anonymize":
      case "internalAtomic":
      case "internalPush":
      case "first":
      case "last":
      case "reverse":
      case "makeDefined":
        // 1 argument, the os, which determines the type
        valueType = copyValueTypeFromArg(1, 0);
        break;
      case "compareAreasQuery":
        valueType = new ValueType();
        if (args.length !== 2) {
            Utilities.error("wrong number of arguments in compareAreasQuery");
        } else if (args[0].valueType.areas !== undefined && args[1].valueType.areas !== undefined) {
            // the result can only be the intersection between both area sets
            for (var [a1, type] of args[0].valueType.areas) {
                if (args[1].valueType.areas.has(a1)) {
                    valueType.addArea(a1, ValueTypeSize.minOfSizes(
                        type.sizes, args[1].valueType.areas.get(a1).sizes));
                }
            }
            valueType.sizes = ValueTypeSize.max(valueType.sizes);
        } else {
            // We don't know yet; valueType remains unknown at this point
        }
        break;
      case "nCompareAreasQuery":
        if (args.length !== 2) {
            Utilities.error("wrong number of arguments in nCompareAreasQuery");
        } else {
            // the result can be anything in the data part
            valueType = args[1].valueType;
            valueType.sizes = ValueTypeSize.max(valueType.sizes);
        }
        break;
      case "internalFilterAreaByClass":
        addTemplatesMatchingClassName(valueType, args[1], args[0], undefined);
        break;
      case "min":
      case "max":
        // Merge all value types
        valueType = args[0].valueType;
        for (var i: number = 1; i < args.length; i++) {
            valueType = valueType.merge(args[i].valueType);
        }
        valueType.sizes = [_r(1, 1)];
        break;
      case "internalApply":
        var appl = args[0];
        var arg: FunctionNode = args[1];
        if (appl === undefined || arg === undefined) {
            Utilities.error("wrong number of arguments in application");
            return new ValueType();
        }
        if (appl instanceof ConstNode) {
            valueType = determineQueryValueType(appl.origExpr, arg);
        } else if (appl.valueType.isData()) {
            if (arg === undefined) {
                valueType = new ValueType();
                Utilities.warnOnce("allAreas application?");
            } else {
                valueType = appl.valueType.applyQuery(arg.valueType);
            }
        } else if (appl.valueType.isStrictlyAreas() || arg.valueType.isStrictlyAreas()) {
            if (appl.valueType.isStrictlyAreas() !== arg.valueType.isStrictlyAreas()) {
                Utilities.error("no areas for internalApply");
            } else {
                valueType = arg.valueType.intersectAreas(arg.valueType);
                break;
            }
        } else {
            valueType = new ValueType();
        }
        valueType = valueType.subDefun(); // applying a defun removes 
        if ("defun" in appl.valueType) {
            // applying a defun instead returns the defun's body result
            valueType = valueType.merge(appl.valueType.defun);
        }
        break;
      case "dynamicAttribute":
        valueType = new ValueType().
            addAttribute(ValueType.anyAttribute, args[1].valueType).
            addSize(1).
            merge(args[2].valueType);
        break;
      case "addComputedAttribute":
        if (args.length !== 3) {
            Utilities.syntaxError("wrong number of arguments for: " + fun.name);
        }
        if (args[0].valueType.isNotString() || args[1].valueType.isNotString()) {
            Utilities.error("argument to " + fun.name + " must be string");
        }
        if (!("unknown" in args[2].valueType) && !("dataSource" in args[2].valueType)) {
            Utilities.error("3rd argument to " + fun.name + " must be datasource");
        }
        valueType = copyValueTypeFromArg(3, 2);
        break;
      default:
        Utilities.error("no value type for " + fun.name);
        valueType = new ValueType().addAnyData();
        break;
    }
    updateValueSize(valueType, fun, args, origin);
    // assert(valueType.sizes !== undefined, "no size for " + funName);
    return valueType;
}

// Returns the locality of the function in order to take the "implicit
// arguments" into account, but 
function getLocalToAreaOfBuiltInFunction(fun: BuiltInFunction, origin: number): number {
    switch (fun.name) {
      case "index":
      case "prev":
      case "prevPlus":
      case "prevStar":
      case "next":
      case "nextPlus":
      case "nextStar":
      case "expressionOf":
      case "embedding":
      case "referredOf":
      case "embedded":
      case "embeddingStar":
      case "embeddedStar":
      case "myMessage":
      case "intersectionParentOf":
      case "classOfArea":
        // area relations without argument are handled by isLocalWithoutArguments
        // the others depend on their arguments.
        return undefined;
      case "offset":
        // offset is always local, since we don't always know the content of
        // the posPoints
        return origin;
      case "coordinates":
      case "areaOfClass":
      case "allAreas":
      case "testStore":
      case "arg":
        return undefined;
      case "displayWidth":
      case "displayHeight":
      case "baseLineHeight":
        // displayWidth/displayHeight always assume they act on the current area
        return origin;
      default:
        Utilities.error("no localToArea for " + fun.name);
        return undefined;
    }
}

// Call when compiling (normalized) runtime data as a query
function normalizeValueQuery(q: any, areaQuery: boolean): Expression {
    var cdlExpr: CdlExpression = runtimeValueToCdlExpression(q);
    var qExpr: Expression = expressionStore.get(cdlExpr, undefined);

    if (areaQuery && cdlExpr instanceof Object && !(cdlExpr instanceof NonAV) &&
        !("children" in cdlExpr || "context" in cdlExpr ||
          "content" in cdlExpr || "param" in cdlExpr)) {
        return expressionStore.store(new ExpressionAttributeValue(
                                     {context: cdlExpr}, [qExpr], ["context"]));
    }
    return qExpr;
}

function addTemplatesMatchingClassName(
    valueType: ValueType, areaFun: FunctionNode, classNameFun: FunctionNode,
    matchInfo: {singleMatch: boolean; className: string; id: number;}): boolean
{
    if (classNameFun instanceof ConstNode) {
        var classNames: any[];
        var match: boolean = false;
        if (!(classNameFun.value instanceof Array)) {
            classNames = [classNameFun.value];
        } else {
            classNames = classNameFun.value;
        }
        if ("areas" in areaFun.valueType) {
            for (var [areaTemplateId, type] of areaFun.valueType.areas) {
                var template: AreaTemplate = areaTemplates[areaTemplateId];
                if (template.classes !== undefined) {
                    for (var i: number = 0; i < classNames.length; i++) {
                        if (classNames[i] in template.classes) {
                            var nrAreas = type.sizes;
                            valueType.addArea(template.id, nrAreas);
                            if (matchInfo !== undefined) {
                                matchInfo.singleMatch = !match;
                                matchInfo.className = classNames[i];
                                matchInfo.id = template.id;
                            }
                            match = true;
                            break;
                        }
                    }
                }
            }
        }
        return match;
    } else if ("areas" in areaFun.valueType) {
        for (var [areaTemplateId, type] of areaFun.valueType.areas) {
            if (areaTemplates[areaTemplateId].classes !== undefined) {
                valueType.addArea(template.id, type.sizes);
            }
        }
        return true;
    } else {
        return false;
    }
}

function nrAreasOfTemplates(templatedIds: {[areaTemplateId:number]: ValueType}): RangeValue[] {
    var sizes: RangeValue[] = [];

    for (var areaTemplateId in templatedIds) {
        var template: AreaTemplate = areaTemplates[areaTemplateId];
        ValueTypeSize.destructiveMerge(sizes, template.getNumberOfAreasRangeUnder(1));
    }
    return sizes;
}

// Returns a function node that the author cannot access directly (for the moment).
function buildFilterAreaByClass(classNameFun: FunctionNode,
                          areaFun: FunctionNode, origin: number,
                          onlyName: boolean, origExpr: Expression): FunctionNode
{
    var localToArea: number = mergeLocality(classNameFun.localToArea, areaFun.localToArea);
    var localToDefun: number = mergeDefunLocality(classNameFun.localToDefun, areaFun.localToDefun);
    var valueType: ValueType = new ValueType();

    if (areaFun.isEmptyOS()) {
        return areaFun;
    }
    if (onlyName) {
        valueType.addString().addSize(0, 1);
    } else {
        var matchInfo: {singleMatch: boolean; className: string; id: number;} = 
            {singleMatch: false, className: undefined, id: undefined};
        if (!addTemplatesMatchingClassName(valueType, areaFun, classNameFun, matchInfo)) {
            return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
        }
        if (matchInfo.singleMatch) {
            // When there is only a single matching template for the class name,
            // it is static, the class is always true, and it is in origin's
            // embeddingStar, [areaOfClass, ...] can be replaced by a direct
            // reference to the matching template
            var template: AreaTemplate = areaTemplates[matchInfo.id];
            if (template.getNrParentIndices() === 0 &&
                  template.classes[matchInfo.className] instanceof ConstNode &&
                  getLevelDifference(origin, template.id, false) >= 0) {
                return buildSimpleFunctionNode(gMeExpr, undefined, template.id,
                    0, undefined, undefined, undefined, undefined, template.id);
            }
        }
    }
    return new FunctionApplicationNode(
       onlyName? internalFilterAreaByClassName: internalFilterAreaByClass,
       [classNameFun, areaFun], localToArea, localToDefun, valueType, origExpr);
}

var gParameterStack: {[name: string]: FunctionNode} = {};
var gDefunStack: number[] = [];

function resetDefuns(): void {
    gParameterStack = {};
    ExpressionFunctionApplication.gDefunIndex = {};
    gDefunStack = [];
}

function makeEmptyOSOfType(fn: FunctionNode): ConstNode {
    var res: ConstNode = new ConstNode([], new ValueType(), gEmptyOSExpr, undefined, false);

    res.valueType = fn.valueType.copy().addSize(0);
    return res;
}

var constantUnaryFunctions: {[funName: string]: BuiltInFunction} = {
    abs: abs,
    uminus: uminus,
    sqrt: sqrt,
    sign: sign,
    empty: empty,
    notEmpty: notEmpty,
    first: first,
    last: last,
    size: size,
    reverse: reverse,
    escapeQuotes: escapeQuotes,
    dayOfWeek: dayOfWeek,
    dayOfMonth: dayOfMonth,
    month: month,
    quarter: quarter,
    year: year,
    hour: hour,
    minute: minute,
    second: second,
    urlStr: urlStr,
    singleValue: singleValue,
    testFormula: testFormula
};
var constantBinaryFunctions: {[funName: string]: BuiltInFunction} = {
    plus: plus,
    minus: minus,
    mul: mul,
    div: div,
    mod: mod,
    remainder: remainder,
    greaterThan: greaterThan,
    greaterThanOrEqual: greaterThanOrEqual,
    lessThan: lessThan,
    lessThanOrEqual: lessThanOrEqual,
    pow: pow,
    logb: logb,
    subStr: subStr,
    numberToString: numberToString,
    dateToNum: dateToNum,
    numToDate: numToDate
};

// Returns a constant when it can determine the result of a function application
function checkConstantResult(funDef: BuiltInFunction, args: FunctionNode[], origExpr: Expression, wontChangeValue: boolean): FunctionNode {
    var i: number;

    var constantArguments: boolean =
        args.every(function(f: FunctionNode): boolean {
            return f instanceof ConstNode;
        });

    function applyUnaryNumFunc(name: string, arg0: ConstNode): number[] {
        var fun: BuiltInFunction = constantUnaryFunctions[name];

        if (fun === undefined) {
            Utilities.error("unknown operator");
        }
        var exec = fun.factory(undefined, undefined);
        return exec.execute([new Result(ensureOS(arg0.value))]);
    }

    function applyBinaryNumFunc(name: string, args: ConstNode[]): number[] {
        var fun: BuiltInFunction = constantBinaryFunctions[name];

        if (fun === undefined) {
            Utilities.error("unknown operator");
        }
        var exec = fun.factory(undefined, undefined);
        return exec.execute([new Result(ensureOS(args[0].value)),
                             new Result(ensureOS(args[1].value))]);

    }

    function applyListFunc(name: string, args: ConstNode[]): FunctionNode {
        switch (name) {
          case "first":
            return buildConstNode(
                (!(args[0].value instanceof Array)? [args[0].value]:
                 args[0].value.length === 0? []:
                 args[0].value.slice(0, 1)),
                wontChangeValue, undefined, undefined, origExpr);
          case "last":
            return buildConstNode(
                (!(args[0].value instanceof Array)? [args[0].value]:
                 args[0].value.length === 0? []:
                 args[0].value.slice(args[0].value.length - 1, args[0].value.length)),
                wontChangeValue, undefined, undefined, origExpr);
        }
        return undefined;
    }

    function getNumbers(): number[] {
        return (<ConstNode[]>args).reduce(function(list: number[], fn: ConstNode): number[] {
            return cconcat(list, ensureOS(fn.value).filter(function(v: any): boolean {
                return typeof(v) === "number";
            }));
        }, []);
    }

    function applyForeignFunction(funDef: BuiltInFunction, args: ConstNode[]): any[] {
        var bif: any = {bif: funDef};
        var exec = funDef instanceof ForeignJavaScriptObjectFunction?
                   EFForeignJavaScriptObjectFunction.make(undefined, bif):
                   EFForeignJavaScriptFunction.make(undefined, bif);

        return exec.execute(args.map((arg: ConstNode) => new Result(ensureOS(arg.value))))
    }

    switch (funDef.name) {
      case "prev":
      case "prevPlus":
      case "prevStar":
      case "next":
      case "nextPlus":
      case "nextStar":
        if (args.length >= 1 && args[0].isEmptyOS()) {
            return makeEmptyOSOfType(args[0]);
        }
        if (args.length === 2 && args[1].isEmptyOS()) {
            return makeEmptyOSOfType(args[0]);
        }
        break;
      case "map":
      case "filter":
        if (args.length === 2 && args[1].isEmptyOS()) {
            return makeEmptyOSOfType(args[1]);
        }
        break;
      case "first":
      case "last":
      case "embedding":
      case "embeddingStar":
      case "embedded":
      case "embeddedStar":
      case "expressionOf":
      case "referredOf":
        if (args.length === 1) {
            if (args[0].isEmptyOS()) {
                return makeEmptyOSOfType(args[0]);
            }
            if (constantArguments) {
                return applyListFunc(funDef.name, <ConstNode[]> args);
            }
        }
        break;
      case "bool":
        if (args.length === 1) {
            if (args[0].isAlwaysTrue()) {
                return new ConstNode([true], new ValueType().addBoolean().addSize(1),
                                     origExpr, undefined, wontChangeValue);
            }
            if (args[0].isAlwaysFalse()) {
                return new ConstNode([false], new ValueType().addBoolean().addSize(1),
                                     origExpr, undefined, wontChangeValue);
            }
        }
        break;
      case "not":
        if (args.length === 1) {
            if (args[0].isAlwaysTrue()) {
                return new ConstNode([], emptyValueType, origExpr, undefined, wontChangeValue);
            }
            if (args[0].isAlwaysFalse()) {
                return new ConstNode([true], new ValueType().addBoolean().addSize(1), origExpr, undefined, wontChangeValue);
            }
        }
        break;
      case "concatStr":
      case "concat":  
        if (constantArguments) {
            var strOs = (<ConstNode> args[0]).value;
            var separator = args[1] === undefined? "": getDeOSedValue((<ConstNode> args[1]).value);
            if (!(strOs instanceof Array)) {
                strOs = [strOs];
            }
            if (typeof(separator) !== "string") {
                separator = "";
            }
            return new ConstNode([strOs.join(separator)], new ValueType().addString().addSize(1), origExpr, undefined, wontChangeValue);
        }
        break;
      case "numberToString":
        if (constantArguments) {
            var exec: ExecutableFunction = numberToString.factory(undefined, undefined);
            var val: any[] = exec.execute([new Result(ensureOS((<ConstNode> args[0]).value)),
                                           new Result(ensureOS((<ConstNode> args[1]).value))]);
            return new ConstNode(val, new ValueType().addString().addSize(val.length), origExpr, undefined, wontChangeValue);
        }
        break;
      case "equal":
        if (constantArguments) {
            var consts: ConstNode[] = <ConstNode[]> args;
            if (consts.every(c => objectEqual(c.value, consts[0].value))) {
                return new ConstNode([true], new ValueType().addBoolean().addSize(1), origExpr, undefined, wontChangeValue);
            } else {
                return new ConstNode([], emptyValueType, origExpr, undefined, wontChangeValue);
            }
        } else if (args[0].isEqual(args[1])) {
            return new ConstNode([true], new ValueType().addBoolean().addSize(1), origExpr, undefined, wontChangeValue);
        }
        break;
      case "notEqual":
        if (constantArguments) {
            var consts: ConstNode[] = <ConstNode[]> args;
            if (!consts.every(c => objectEqual(c.value, consts[0].value))) {
                return new ConstNode([true], new ValueType().addBoolean().addSize(1), origExpr, undefined, wontChangeValue);
            } else {
                return new ConstNode([], emptyValueType, origExpr, undefined, wontChangeValue);
            }
        } else if (args[0].isEqual(args[1])) {
            return new ConstNode([], emptyValueType, origExpr, undefined, wontChangeValue);
        }
        break;
      case "merge":
      case "mergeWrite":
        if (constantArguments) {
            var consts: ConstNode[] = <ConstNode[]> args;
            if (consts.length === 0) {
                return new ConstNode([], emptyValueType, origExpr, undefined, wontChangeValue);
            } else if (consts.length === 1) {
                return consts[0];
            } else {
                var merge: any[] = consts[0].value;
                for (var i: number = 1; i !== consts.length; i++) {
                    merge = mergeCopyValue(merge, consts[i].value, undefined);
                }
                return buildConstNode(merge, wontChangeValue, undefined, undefined, origExpr);
            }
        }
        break;
      case "sum":
        if (constantArguments) {
            return buildConstNode(
                getNumbers().reduce(function(sum: number, value: number): number { return sum + value; }, 0),
                wontChangeValue, undefined, undefined, origExpr);
        }
        break;
      case "pointer":
        return buildConstNode(new ElementReference("p1"), true, undefined, undefined, origExpr);
      default:
        if (!constantArguments) {
            break;
        }
        if (args.length === 2 && funDef.name in constantBinaryFunctions) {
            return buildConstNode(
                applyBinaryNumFunc(funDef.name, <ConstNode[]> args),
                wontChangeValue, undefined, undefined, origExpr);
        } else if (args.length === 1 &&
                   funDef.name in constantUnaryFunctions) {
            return buildConstNode(
                applyUnaryNumFunc(funDef.name, <ConstNode> args[0]),
                wontChangeValue, undefined, undefined, origExpr);
        } else if (funDef instanceof ForeignJavaScriptFunction) {
            return buildConstNode(
                    applyForeignFunction(funDef, <ConstNode[]> args),
                    wontChangeValue, undefined, undefined, origExpr);
        }
        break;
    }
    return undefined;
}

interface FuncApplReplacement {
    funDef: BuiltInFunction|undefined;
    args: FunctionNode[]|undefined;
    repl: FunctionNode|undefined;
}

// Removes redundant arguments. E.g. [plus, x, 0] becomes x, and
// [minus, 0, x] becomes [uminus, x].
function removeRedundantArguments(funDef: BuiltInFunction, args: FunctionNode[], origExpr: Expression, wontChangeValue: boolean): FuncApplReplacement|undefined {
    var nArgs: FunctionNode[];

    function isNumConst(fn: FunctionNode, n: number): boolean {
        return fn instanceof ConstNode && fn.value instanceof Array &&
               fn.value.length === 1 && fn.value[0] === n;
    }

    switch (funDef.name) {
      case "and":
        nArgs = args.filter(arg => !arg.isAlwaysTrue());
        if (nArgs.length === args.length) {
            return undefined;
        }
        return nArgs.length === 0? {
                funDef: undefined,
                args: undefined,
                repl: new ConstNode([true], new ValueType().addBoolean().addSize(1), origExpr, undefined, inputsWontChangeValue(args))
            }: nArgs.length === 1? {
                funDef: undefined,
                args: undefined,
                repl: nArgs[0].getBoolInterpretation()
            }: {
                funDef: funDef,
                args: nArgs,
                repl: undefined
            };
      case "or":
        nArgs = args.filter(arg => !arg.isAlwaysFalse());
        if (nArgs.length === args.length) {
            return undefined;
        }
        return nArgs.length === 0? {
                funDef: undefined,
                args: undefined,
                repl: new ConstNode([false], new ValueType().addBoolean().addSize(1), origExpr, undefined, inputsWontChangeValue(args))
            }: nArgs.length === 1? {
                funDef: undefined,
                args: undefined,
                repl: nArgs[0].getBoolInterpretation()
            }: {
                funDef: funDef,
                args: nArgs,
                repl: undefined
            };
      case "plus":
        nArgs = args.filter(arg => !isNumConst(arg, 0));
        if (nArgs.length === args.length) {
            return undefined;
        }
        return nArgs.length === 0? {
                funDef: undefined,
                args: undefined,
                repl: new ConstNode([0], new ValueType().addNumber().addSize(1), origExpr, undefined, inputsWontChangeValue(args))
            }: nArgs.length === 1? {
                funDef: undefined,
                args: undefined,
                repl: nArgs[0]
            }: {
                funDef: funDef,
                args: nArgs,
                repl: undefined
            };
      case "minus":
        if (args.length !== 2) {
            return undefined;
        }
        if (isNumConst(args[1], 0)) {
            return {
                    funDef: undefined,
                    args: undefined,
                    repl: args[0]
                };
        }
        if (isNumConst(args[0], 0)) {
            return {
                    funDef: uminus,
                    args: [args[1]],
                    repl: undefined
            };
        }
        break;
      case "mul":
        nArgs = args.filter(arg => !isNumConst(arg, 1));
        if (nArgs.length === args.length) {
            return undefined;
        }
        return nArgs.length === 0? {
                funDef: undefined,
                args: undefined,
                repl: new ConstNode([1], new ValueType().addNumber().addSize(1), origExpr, undefined, inputsWontChangeValue(args))
            }: nArgs.length === 1? {
                funDef: undefined,
                args: undefined,
                repl: nArgs[0]
            }: {
                funDef: funDef,
                args: nArgs,
                repl: undefined
            };
      case "div":
        if (args.length !== 2) {
            return undefined;
        }
        if (isNumConst(args[1], 1)) {
            return {
                    funDef: undefined,
                    args: undefined,
                    repl: args[0]
                };
        }
        break;
      case "logb":
        if (args.length !== 2) {
            return undefined;
        }
        if (isNumConst(args[1], 10)) {
            return {
                    funDef: log10,
                    args: [args[0]],
                    repl: undefined
                };
        }
        if (isNumConst(args[1], 2)) {
            return {
                    funDef: log2,
                    args: [args[0]],
                    repl: undefined
                };
        }
        if (isNumConst(args[1], Math.E)) {
            return {
                    funDef: ln,
                    args: [args[0]],
                    repl: undefined
                };
        }
        break;
      case "pow":
        if (args.length !== 2) {
            return undefined;
        }
        if (isNumConst(args[0], Math.E)) {
            return {
                    funDef: exp,
                    args: [args[1]],
                    repl: undefined
                };
        }
        break;
    }
    return undefined;
}

function rewriteAndQualify(
    qfn: VariantFunctionNode, funargs: any[], origin: number, defun: number,
    origExpr: Expression, context: number
): FunctionNode|undefined
{
    var qualifiers: SingleQualifier[][] = [];
    var functionNodes: FunctionNode[] = [];
    var allFunctionsIdentical: boolean = true;
    var allQualifiersTrue: boolean = true;
    var valueType: ValueType = new ValueType().addSize(0);

    for (var i: number = 0; i !== qfn.functionNodes.length; i++) {
        var dfn = <DefunNode> qfn.functionNodes[i];
        var rewrite = rewriteDefun(dfn.orig, dfn.localToArea, funargs, origin);
        if (rewrite === undefined) {
            return undefined;
        }
        var fun: FunctionNode = buildSimpleFunctionNode(
            rewrite, undefined, origin, defun, undefined,
            qfn.qualifiers.qualifiers[i], undefined, origExpr, context);
        fun.rewrite = rewrite;
        if (i !== 0 && !fun.isEqual(functionNodes[0])) {
            allFunctionsIdentical = false;
        }
        qualifiers.push(qfn.qualifiers.qualifiers[i]);
        if (qfn.qualifiers.qualifiers[i].length !== 0) {
            allQualifiersTrue = false;
        }
        valueType = valueType.merge(fun.valueType);
        functionNodes.push(fun);
    }
    return functionNodes.length === 0?
        buildConstNode(undefined, false, false, 0, gUndefinedExpr):
        allFunctionsIdentical && allQualifiersTrue? functionNodes[0]:
        VariantFunctionNode.build2(qualifiers, functionNodes, valueType, origExpr, undefined);
}

function isSimpleValueQuery(v: any): boolean {
    return v instanceof Array? v.length === 0 || !v.some(isAV): !isAV(v);
}

function isProjector(v: any): boolean {
    return v instanceof Array? v.length === 1 && v[0] === _: v === _;
}

function isConstantQuery(v: any): boolean {
    if (v instanceof Array) {
        return v.length === 0 || (v.length === 1 && isConstantQuery(v[0]));
    }
    if (!isAV(v)) {
        return true;
    }
    for (var attr in v) {
        if (!isConstantQuery(v[attr])) {
            return true;
        }
    }
    return true;
}

// Analyzes the query, looks for the projected data, and puts it in the
// object form of the query result.
function determineQueryValueType(q: Expression, data: FunctionNode): ValueType {
    var qc: QueryComponent[] = q.extractQueryComponents([], true, undefined, undefined);
    var valueType = new ValueType();
    var isOnlySelection: boolean = true;
    var containsSelection: boolean = false;
    var possiblyUndef: boolean = false;

    function getDataDescrFromPath(data: ValueType, path: string[]): ValueType {
        var ptr: ValueType = data;

        for (var i: number = 0; i !== path.length; i++) {
            if (ptr.anyData || ptr.unknown) {
                return ptr;
            } else if (ptr.undef) {
                possiblyUndef = true;
            }
            if (ptr.object === undefined) {
                // The data does not contain this path (yet); return unknown
                return new ValueType();
            }
            assert(ptr.isStrictlyData(), "wrong analysis?");
            ptr = ptr.object[path[i]];
            if (ptr === undefined) {
                // The data does not contain this path (yet); return unknown
                return new ValueType();
            }
        }
        return ptr;
    }

    for (var i: number = 0; i !== qc.length; i++) {
        if (qc[i] instanceof QueryComponentProject) {
            var qcp = <QueryComponentProject> qc[i];
            var dataDescr: ValueType = getDataDescrFromPath(data.valueType, qcp.path);
            isOnlySelection = false;
            if (qcp.destination.length === 0) {
                assert(valueType.unknown, "two projection paths with length zero?");
                valueType = dataDescr;
            } else {
                var dataProjDescr = new ValueType().addObject({});
                var ptr = dataProjDescr.object;
                for (var j: number = 0; j < qcp.destination.length - 1; j++) {
                    ptr[qcp.destination[j]] = new ValueType().addObject({});
                    ptr = ptr[qcp.destination[j]].object;
                }
                ptr[qcp.destination[qcp.destination.length - 1]] = dataDescr;
                valueType = valueType.merge(dataProjDescr);
            }
        } else if (qc[i] instanceof QueryComponentSelect) {
            containsSelection = true;
        }
    }
    if (isOnlySelection) {
        // no projection, so selection
        valueType = data.valueType;
        containsSelection = true;
    }
    if (containsSelection || possiblyUndef) {
        valueType = valueType.copy();
        valueType.sizes =
            ValueTypeSize.multiplySizes(data.valueType.sizes, valueType.sizes);
    }
    if (data.valueType.remote) {
        valueType = valueType.copy().addRemote();
    }
    return valueType;
}

function specialFunctionArgumentProcessing(funDef: BuiltInFunction, functionArguments: FunctionNode[], localToArea: number): number {
    switch (funDef.name) {
      case "filter":
      case "map":
      case "multiQuery":
      case "internalApply":
        if (functionArguments.length === 2) {
            functionArguments[0].setDefunArgTypes(functionArguments.slice(1), {});
        }
        break;
      case "embedding":
      case "embeddingStar":
      case "expressionOf":
        if (functionArguments.length === 1) {
            var areaEmbDepth: RangeValue = levelOfEmbeddingFun(functionArguments[0], localToArea);
            if (areaEmbDepth !== undefined && areaEmbDepth.min === areaEmbDepth.max) {
                var refArea: AreaTemplate = 
                    areaTemplates[functionArguments[0].localToArea].
                    getEmbedding(areaEmbDepth.min);
                // Remove argument and return the template id of the target as
                // the new localToArea. This helps mapping expressions to the
                // same function node.
                functionArguments.length = 0;
                return refArea.id;
            }
        }
        break;
    }
    return localToArea;
}

function buildAreaOfClassQuery0(orderFun: string|undefined, className: string,
                                areaEmbDepth: RangeValue, origin: number,
                              defun: number, origExpr: Expression): FunctionNode
{
    var refArea: AreaTemplate = areaTemplates[origin];
    var targetAreas: AreaTemplate[] = [];
    var membership: AVFunctionNode;

    for (var lvl: number = 0; lvl <= areaEmbDepth.max && refArea !== undefined; lvl++) {
        if (areaEmbDepth.min <= lvl) {
            refArea.determineClassMembership();
            membership = <AVFunctionNode> refArea.exports[0];
            if (membership !== undefined && className in membership.attributes) {
                targetAreas.push(refArea);
            }
        }
        refArea = refArea.parent;
    }
    if (targetAreas.length === 0) { // If no area can possibly match, return o()
        return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
    } else if (orderFun === "first") {
        targetAreas = targetAreas.slice(0);
    } else if (orderFun === "last") {
        targetAreas = targetAreas.slice(-1);
    } else if (targetAreas.length !== 1) { // Return undefined when there's no unique match
        return undefined;
    }
    refArea = targetAreas[0];
    membership = <AVFunctionNode> refArea.exports[0];
    var c: FunctionNode = membership.attributes[className];
    if (c instanceof ConstNode && !isTrue(c.value)) {
        return buildConstNode([], c.wontChangeValue, undefined, 0, gEmptyOSExpr);
    } else {
        var v: FunctionNode = new FunctionApplicationNode(me, [], refArea.id,
              defun, new ValueType().addArea(refArea.id, [_r(1, 1)]), origExpr);
        return BoolGateNode.build(c, v, origExpr);
    }
}

function isAreaOfClassFunctionApplication(fn: FunctionNode): boolean {
    if (!(fn instanceof FunctionApplicationNode)) {
        return false;
    }
    var fa = <FunctionApplicationNode> fn;
    if (fa.builtInFunction.name !== "areaOfClass" ||
        !(fa.functionArguments[0] instanceof ConstNode)) {
        return false;
    }
    var cn = <ConstNode> fa.functionArguments[0];
    var className: any = getDeOSedValue(cn.value);
    return typeof(className) === "string";
}

/**
 * Recognizes [<area set>, [areaOfClass, <constant string>]] or vice versa, and
 * simple order functions applied to it, e.g. [first, [<area set>, [areaOfClass,
 * "...]]]. If the area set intersection with area of class is single area
 * reference which is is me or in embedding*, the expression is resolved to the
 * membership function of that class.
 * 
 * @param orderFun The last applied order function: first, last or undefined
 * @param q1 The first function in the query
 * @param q2 The second function in the query
 * @param origin originating area template id
 * @param origExpr original expression
 */
function buildAreaOfClassQuery(orderFun: string|undefined, q1: FunctionNode, 
         q2: FunctionNode, origin: number, origExpr: Expression): FunctionNode {
    var areaFun: FunctionNode;
    var areaOfClassFun: FunctionApplicationNode;

    // Check which of the arguments is [areaOfClass, "const"]
    if (isAreaOfClassFunctionApplication(q1) && q2.valueType.isAreas()) {
        areaFun = q2;
        areaOfClassFun = <FunctionApplicationNode> q1;
    } else if (isAreaOfClassFunctionApplication(q2) && q1.valueType.isAreas()) {
        areaFun = q1;
        areaOfClassFun = <FunctionApplicationNode> q2;
    } else {
        return undefined;
    }

    var areaEmbDepth: RangeValue = levelOfEmbeddingFun(areaFun, origin);
    if (areaEmbDepth === undefined) {
        // No parent/child relation
        return buildFilterAreaByClass(areaOfClassFun.functionArguments[0],
                                      areaFun, origin, false, origExpr);
    }

    var cn = <ConstNode> areaOfClassFun.functionArguments[0];
    var className: string = getDeOSedValue(cn.value);
    return buildAreaOfClassQuery0(orderFun, className, areaEmbDepth,
                                  origin, areaFun.localToDefun, origExpr);
}

// Replaces [embedding] in a template by [me] in its parent (and [embedding,
// [embedding]] in its grandparent, etc.).
function substituteEmbeddingChain(fn: FunctionApplicationNode): FunctionNode {
    var areaEmbDepth: RangeValue = levelOfEmbeddingFun(fn, fn.localToArea);

    if (areaEmbDepth !== undefined && areaEmbDepth.min === areaEmbDepth.max &&
          areaEmbDepth.min > 0) {
        var refArea: AreaTemplate = areaTemplates[fn.localToArea].
                                                 getEmbedding(areaEmbDepth.min);
        assert(!fn.localToDefun, "can't have defun look in other area");
        return refArea === undefined? buildConstNode([], false, undefined, 0, gEmptyOSExpr):
            new FunctionApplicationNode(me, [], refArea.id, fn.localToDefun,
                  new ValueType().addArea(refArea.id, [_r(1, 1)]), fn.origExpr);
    }
    return fn;
}

function levelOfEmbeddingFun(fn: FunctionNode, origin: number): RangeValue {
    if (fn instanceof FunctionApplicationNode &&
          fn.localToDefun === 0 && fn.localToArea > 0) {
        var fan = <FunctionApplicationNode> fn;
        var distanceToOrigin: number = fn.getEmbeddingLevel(origin);
        if (fan.builtInFunction.name === "me") {
            return new RangeValue([distanceToOrigin], true, true);
        } else if ((fan.builtInFunction.name === "embedding" &&
                    !areaTemplates[fan.localToArea].embeddingInReferred) ||
                   (fan.builtInFunction.name === "expressionOf" &&
                    areaTemplates[fan.localToArea].partnerExpr !== undefined)) {
            if (fan.functionArguments.length === 0) {
                return new RangeValue([distanceToOrigin + 1], true, true);
            }
            var embLevel: RangeValue = levelOfEmbeddingFun(fan.functionArguments[0], origin);
            return embLevel === undefined? undefined:
                new RangeValue([embLevel.min + 1, embLevel.max + 1], true, true);
        } else if (fan.builtInFunction.name === "embeddingStar" &&
                   !areaTemplates[fan.localToArea].embeddingInReferred) {
            if (fan.functionArguments.length === 0) {
                return new RangeValue([distanceToOrigin + 1, Infinity], true, true);
            }
            var embLevel: RangeValue = levelOfEmbeddingFun(fan.functionArguments[0], origin);
            return embLevel === undefined? undefined:
                new RangeValue([embLevel.min + 1, Infinity], true, true);
        }
    }
    return undefined;
}

// Like levelOfEmbeddingFun, but also checks children queries, and returns a
// lower value in that case. Rejects [{children: {x: _}}, [embedding]], since
// these have no relation (unless x: happens to be [me], but we don't check
// that). [embedding, [{children: {x: _}}, [me]]] is accepted and returns 0.
function extLevelOfEmbeddingFun(fn: FunctionNode, origin: number): RangeValue {
    var embLevel: RangeValue;

    if (fn.localToDefun !== 0 || fn.localToArea === undefined) {
        return undefined;
    }
    if (fn instanceof FunctionApplicationNode) {
        var distanceToOrigin: number = fn.getEmbeddingLevel(origin);
        if (fn.builtInFunction.name === "me") {
            return new RangeValue([distanceToOrigin], true, true);
        } else if ((fn.builtInFunction.name === "embedding" &&
                    !areaTemplates[fn.localToArea].embeddingInReferred) ||
                   fn.builtInFunction.name === "expressionOf") {
            if (fn.functionArguments.length === 0) {
                return new RangeValue([distanceToOrigin + 1], true, true);
            }
            embLevel = levelOfEmbeddingFun(fn.functionArguments[0], origin);
            return embLevel === undefined? undefined:
                new RangeValue([embLevel.min + 1, embLevel.max + 1], true, true);
        } else if (fn.builtInFunction.name === "embeddingStar" &&
                   !areaTemplates[fn.localToArea].embeddingInReferred) {
            if (fn.functionArguments.length === 0) {
                return new RangeValue([distanceToOrigin + 1, Infinity], true, true);
            }
            embLevel = levelOfEmbeddingFun(fn.functionArguments[0], origin);
            return embLevel === undefined? undefined:
                   new RangeValue([embLevel.min + 1, Infinity], true, true);
        }
    } else if (fn instanceof ChildAreasNode) {
        embLevel = levelOfEmbeddingFun(fn.data, origin);
        return embLevel === undefined || embLevel.min > 0? undefined:
               new RangeValue([embLevel.min - 1, embLevel.max - 1], true, true);
    }
    return undefined;
}

function buildStorageNode(path: string[], origin: number, defun: number,
                          valueType: ValueType, param: boolean): StorageNode
{
    var node: StorageNode = getWritableNode(origin, defun, path);
    
    if (node !== undefined) {
        node.makeCompatible(valueType);
        return node;
    }
    return param?
        new ParamStorageNode(path, origin, defun, valueType, undefined):
        new StorageNode(path, origin, defun, undefined, valueType, undefined);
}

function buildMessageQueueNode(path: string[], origin: number, defun: number, valueType: ValueType): StorageNode {
    var node: StorageNode = getWritableNode(origin, defun, path);
    
    if (node !== undefined) {
        return node;
    }
    return new MessageQueueNode(path, origin, defun, valueType, undefined);
}

function buildPointerStorageNode(path: string[], origin: number, defun: number,
                                 valueType: ValueType): StorageNode
{
    var node: StorageNode = getWritableNode(origin, defun, path);
    
    if (node !== undefined) {
        return node;
    }
    return new PointerStorageNode(path, origin, defun, valueType, undefined);
}

function buildDynamicGlobalFunctionNode(path: string[]): StorageNode {
    var node: StorageNode = getWritableNode(undefined, 0, path);

    if (node !== undefined) {
        return node;
    }
    switch (path[0]) {
      case "debugBreak":
        globalDebugBreakNode = new DebugBreakNode(path);
        return globalDebugBreakNode;
      case "areasUnderPointer":
        globalAreasUnderPointerNode = new StorageNode(path, undefined, 0,
                                     undefined, allAreasValueType(), undefined);
        return globalAreasUnderPointerNode;
      case "globalDefaults":
        var initVal = buildConstNode(
            normalizeObject(initGlobalDefaults), true, undefined, 0, undefined);
        globalDefaultsNode = new WritableNode(
            path, initVal, undefined, 0,
            new PathInfo([], undefined, undefined, [], true, [], 0, 0, false, undefined),
            anyDataValueType, undefined);
        return globalDefaultsNode;
      default:
        Utilities.error("no such dynamic storage node");
        return undefined;
    }
}

// This writable node can end up in a variant, so we need to merge the value
// types determined by a write with the new value type for this node in order
// not to lose the previous one.
function updateWritableNode(
   path: string[], initialValue: FunctionNode, origin: number,
   pathInfo: PathInfo, valueType: ValueType, origExpr: Expression): WritableNode
{
    var node: WritableNode = <WritableNode> getWritableNode(origin, 0, path);
    
    if (node !== undefined) {
        node.updateInitialValue(initialValue);
        return node;
    }
    return new WritableNode(path, initialValue, origin, 0,
                            pathInfo, valueType, origExpr);
}

// Splits {children: {x: ...}} into a query on {children: {x: _}} and
// a remaining query
function extractChildQuery(query: ExpressionAttributeValue): { childName: string; restQuery: Expression; } {
    var subq: Expression = query.arguments[0];
    var childName: string = undefined;

    if (query.attributes.length !== 1 || query.attributes[0] !== "children") {
        return undefined;
    }
    if (subq instanceof ExpressionAttributeValue) {
        var chQuery = <ExpressionAttributeValue> subq;
        if (chQuery.attributes.length !== 1) {
            // cannot process {children: {x: ..., y: ...}}
            return undefined;
        }
        childName = chQuery.attributes[0];
        subq = chQuery.arguments[0];
        if (subq !== gProjectorExpr &&
              !(subq instanceof ExpressionAttributeValue)) {
            return undefined; // A selection on {children: {x: val}}?
        }
        return { childName: childName, restQuery: subq };
    }
    return undefined;
}

function buildChildAreas(childName: string, data: FunctionNode, origExpr: Expression): FunctionNode {
    var valueType: ValueType = new ValueType();

    if (data.valueType.isStrictlyAreas()) {
        for (var [areaTemplateId, type] of data.valueType.areas) {
            var childTemplate: AreaTemplate = areaTemplates[areaTemplateId].children[childName];
            if (childTemplate !== undefined) {
                var nrAreas = ValueTypeSize.multiplySizes(
                    type.sizes,
                    childTemplate.getNumberOfAreasRangeUnder(areaTemplateId));
                valueType.addArea(childTemplate.id, nrAreas);
            } else {
                Utilities.warnOnce("no child " + childName + " in template @" +
                        areaTemplateId + ": " + areaTemplatePath(areaTemplateId));
            }
        }
        return new ChildAreasNode(childName, data, valueType, origExpr);
    } else {
        return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
    }
}

// If the query was [{a_1: {a_2: ... {a_n: x}...}}, expr], and data is the
// function node representing expr, and projection the projection up until a_n
// on expr, this function returns the condition of the selection.
function buildDataSelectionCondition(queryTerminal: Expression, projection: FunctionNode, data: FunctionNode, origin: number, defun: number): FunctionNode {
    if (queryTerminal instanceof ExpressionBoolean && queryTerminal.expression === false) {
        return FunctionApplicationNode.buildFunctionApplication(
                not, [projection], projection.localToArea,
                projection.localToDefun, origin, undefined);
    } else {
        var selection: FunctionNode = buildSimpleFunctionNode(
            queryTerminal, undefined, origin, defun, undefined, undefined,
            undefined, undefined, origin);
        var condLocalToArea: number = mergeLocality(selection.localToArea,
                                                    projection.localToArea);
        var condition: FunctionNode = new FunctionApplicationNode(
            internalApply, [selection, projection], condLocalToArea,
            mergeDefunLocality(selection.localToDefun, projection.localToDefun),
            projection.valueType, undefined);
        return BoolGateNode.build(condition, data, undefined);
    }
}

// TODO: [{param: { x: _}}, [embedding]] goes wrong???
function buildParamQuery(query: Expression, origin: number, defun: number, origExpr: Expression): FunctionNode {
    var queryPath: QueryPath = query.extractQueryPath();
    var template = areaTemplates[origin];
    var paramNode: FunctionNode = template.functionNodes[areaParamIndex];

    if (queryPath === undefined) {
        return undefined;
    }
    assert(paramNode.cycleNr === gCycleNr, "param should never be outdated");
    if (queryPath.path.length !== 1) {
        var restQuery: Expression = pathToQuery(queryPath.path, 1, queryPath.path.length, queryPath.terminal);
        return buildQueryNodeOnFunction(restQuery, paramNode, origin, 0, origExpr, origin);
    } else {
        return paramNode;        
    }
}

function buildClassQuery(query: Expression, origin: number, defun: number, origExpr: Expression): FunctionNode {
    var queryPath: QueryPath = query.extractQueryPath();
    var template = areaTemplates[origin];
    var paramNode: FunctionNode;

    if (queryPath.path.length < 2) {
        // Class name not given
        return undefined;
    }
    template.determineClassMembership();
    if (template.exports[0] === undefined) {
        // Template has no classes
        return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
    }
    paramNode = (<AVFunctionNode>template.exports[0]).attributes[queryPath.path[1]];
    if (paramNode === undefined) {
        // Can't be member of given class
        return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
    }
    if (queryPath.path.length > 2) {
        var restQuery: Expression = pathToQuery(queryPath.path, 2, queryPath.path.length, queryPath.terminal);
        return buildQueryNodeOnFunction(restQuery, paramNode, origin, 0, origExpr, origin);
    } else {
        return paramNode;
    }
}

// Translates {x: [...]}, i.e. an AV with function arguments to an query
// components. Cannot handle queries deeper than 1, unless the first and only
// attribute is "context" or "param", and chokes on mixing projector and
// data. Doesn't handle negation (shouldn't be too hard though).  Returns
// undefined when it finds a condition it can't handle.
function extractQueryComponentsFromAV(q: AVFunctionNode): QueryComponent[] {
    var qComps: QueryComponent[] = [];
    var path0: string;

    // Ugly path normalization
    if ("context" in q.attributes) {
        if (Object.keys(q.attributes).length !== 1) {
            return undefined;
        }
        var fn: FunctionNode = q.attributes["context"];
        if (!(fn instanceof AVFunctionNode)) {
            return undefined;
        }
        q = <AVFunctionNode> fn;
        path0 = "context";
    } else if ("param" in q.attributes) {
        if (Object.keys(q.attributes).length !== 1) {
            return undefined;
        }
        var fn: FunctionNode = q.attributes["param"];
        if (!(fn instanceof AVFunctionNode)) {
            return undefined;
        }
        q = <AVFunctionNode> fn;
        path0 = "param";
    } else if ("children" in q.attributes) {
        return undefined;
    } else if ("content" in q.attributes) {
        if (Object.keys(q.attributes).length !== 1) {
            return undefined;
        }
        // Don't change anything, just query content
    } else {
        // Add {context: ... }
        path0 = "context";
    }

    for (var attr in q.attributes) {
        var val: FunctionNode = q.attributes[attr];
        var qPath: string[] = path0 !== undefined? [path0, attr]: [attr];
        if (val instanceof ConstNode) {
            if (isProjector(val)) {
                qComps.push(new QueryComponentProject(qPath));
            } else {
                var qcs = new QueryComponentSelect(qPath, undefined, true, val);
                qComps.push(qcs);
            }
        } else {
            // The expression under attr should not be able to return _. If so,
            // we just return undefined. Note that this code can fail at run
            // time when the data type is any and includes a defun or _.
            if (val.valueType.projector) {
                return undefined;
            }
            // We also don't do queries deeper than 1; this check can also fail
            // when the query is "any", i.e. comes via some application.
            if (val.valueType.object !== undefined) {
                return undefined;
            }
            var qcs = new QueryComponentSelect(qPath, undefined, true, val);
            qComps.push(qcs);
        }
    }
    return qComps;
}

// export id #0 is reserved for class membership
var exportPaths: string[][] = [undefined];
var pathToExportId: PathAssociationTree<number> = {};

function pathsEqual(p1: string[], p2: string[]): boolean {
    if (p1.length !== p2.length) {
        return false;
    }
    for (var i: number = 0; i !== p1.length; i++) {
        if (p1[i] !== p2[i]) {
            return false;
        }
    }
    return true;
}

var gEICnt: {[pathStr: string]: Map<number, number>} = {};
var gEIStack: {path: string[]; templateSet: Map<number, ValueType>;}[] = []

function addExportToAreaTemplate(areaTemplateId: number, exportId: number): void {
    var template: AreaTemplate = areaTemplates[areaTemplateId];
    var exportPath: string[] = exportPaths[exportId];

    if (!(exportId in template.exports) ||
          (template.exports[exportId] !== undefined &&
           template.exports[exportId].outdated())) {
        var query: Expression = ExpressionQuery.build(pathToQuery(exportPath), gMeExpr);
        var fn: FunctionNode = buildSimpleFunctionNode(
            query, undefined, template.id, 0, undefined, undefined,
            undefined, undefined, template.id);
        template.exports[exportId] = fn;
    }
}

function differentAndValidPath(path: string[], prefixLength: number): boolean {
    if (path[0] === "context") {
        return 1 < prefixLength && prefixLength < path.length;
    } else {
        return 0 < prefixLength && prefixLength < path.length;
    }
}

// Allows data queries on areas: only {content: ...} and {context: {attr: ...}}
function validLocalQueryPath(queryPath: QueryPath): boolean {
    return queryPath !== undefined &&
           ((queryPath.path.length >= 1 && queryPath.path[0] === "content") ||
            (queryPath.path.length >= 2 && queryPath.path[0] === "context"));
}

function resolveLocalQuery(query: Expression, dataOrigin: number, defun: number, queryOrigin: number, origExpr: Expression): FunctionNode {
    var template: AreaTemplate = areaTemplates[dataOrigin];
    var queryPath: QueryPath = query.extractQueryPath();
    var target: PathTreeNode;
    var projection: FunctionNode;
    var curParameterStack = gParameterStack;
    var resolution: FunctionNode;

    if (!validLocalQueryPath(queryPath)) {
        return undefined;
    }
    // While resolving a query, defun parameters and using ids are not relevant.
    gParameterStack = {};
    target = template.areaNode.getNodeAtNonMergingPath(queryPath.path);
    if (target !== undefined) {
        projection = buildFunctionNode(target, dataOrigin, 0, undefined);
        if (queryPath.isProjection) {
            resolution = projection;
            if (resolution === undefined) {
                resolution = buildConstNode([], false, undefined, 0, gEmptyOSExpr);
            }
        } else {
            var data: FunctionNode = buildSimpleFunctionNode(
                gMeExpr, undefined, dataOrigin, 0, undefined, undefined,
                undefined, undefined, dataOrigin);
            resolution = buildDataSelectionCondition(queryPath.terminal,
                                projection, data, queryOrigin, defun);
        }
    } else {
        var prefixLength: number = 
            template.areaNode.findLongestPathPrefix(queryPath.path);
        if (differentAndValidPath(queryPath.path, prefixLength)) {
            // split into two queries
            var prefQuery: Expression = pathToQuery(queryPath.path, 0, prefixLength);
            var remQuery: Expression = pathToQuery(queryPath.path, prefixLength,
                                     queryPath.path.length, queryPath.terminal);
            resolution = buildSimpleFunctionNode(
                ExpressionQuery.build(
                    remQuery, ExpressionQuery.build(prefQuery, gMeExpr)),
                undefined, dataOrigin, defun, undefined, undefined,
                undefined, undefined, queryOrigin);
        } else {
            var alt: {dist: number; path: string[];} =
                template.areaNode.getSpellingErrorAtPath(queryPath.path);
            if (alt !== undefined) {
                Utilities.syntaxError("possible typo: " + 
                                      queryPath.path.join(".") + " vs. " +
                                      alt.path.join(".") + " @" + dataOrigin);
            } else {
                Utilities.warnOnce(queryPath.path.join(".") + " is undefined in template " + dataOrigin);
            }
            resolution = buildConstNode([], true, undefined, 0, gEmptyOSExpr);
        }
    }
    gParameterStack = curParameterStack;
    return resolution;
}

function getExportId(path: string[], templateSet: Map<number, ValueType>): number {
    var exportId: number;
    var pathStr: string = path.join(".");
    var aIDCnt: Map<number, number>;
    var curStubCycleNr: number = gStubCycleNr;

    nextStubCycle();
    gEIStack.push({path: path, templateSet: templateSet});
    if (!(pathStr in gEICnt)) {
        gEICnt[pathStr] = aIDCnt = new Map<number, number>();
    } else {
        aIDCnt = gEICnt[pathStr];
    }
    if (templateSet !== undefined) {
        for (var areaTemplateId of templateSet.keys()) {
            if (!(areaTemplateId in aIDCnt)) {
                aIDCnt.set(areaTemplateId, 1);
            } else {
                aIDCnt.set(areaTemplateId, aIDCnt.get(areaTemplateId) + 1);
                if (aIDCnt.get(areaTemplateId) >= 10) {
                    throw new Utilities.AssertException(
                        "infinite recursion at " + path.join(".") + " in " +
                        areaTemplates[areaTemplateId].areaNode.getPath());
                }
            }
        }
    }
    // first check if the export id already exists
    exportId = getPathAssociation(path, pathToExportId);
    // if not, add a new one
    if (exportId === undefined) {
        exportId = exportPaths.length;
        exportPaths.push(path);
        addPathAssociation(path, exportId, pathToExportId);
    }
    // make sure each area knows what to export under this id
    if (templateSet !== undefined) {
        for (var areaTemplateId of templateSet.keys()) {
            addExportToAreaTemplate(areaTemplateId, exportId);
        }
        for (var areaTemplateId of templateSet.keys()) {
            aIDCnt.set(areaTemplateId, aIDCnt.get(areaTemplateId) - 1);
        }
    }
    gEIStack.pop();
    gStubCycleNr = curStubCycleNr;
    return exportId;
}


// Builds a node that filters areas
function buildAreaSelection(selection: QueryComponentSelect, data: FunctionNode, origExpr: Expression, origin: number, context: number, allowOptimization: boolean): FunctionNode {
    var embeddingLevel: RangeValue = levelOfEmbeddingFun(data, origin);
    var selFun: FunctionNode = selection.selectionFunction;
    var selEmbLevel: RangeValue = levelOfEmbeddingFun(selFun, selFun.localToArea);
    var template: AreaTemplate, node: PathTreeNode, condition: FunctionNode;
    var nrPossibleMatches: number = 0;
    var targetTemplate: AreaTemplate[] = [];
    var targetLevelDiff: number[] = [];
    var targetConditions: FunctionNode[] = [];

    // If the area selection is [{c: [embf]}, data], and embf is [me],
    // [embedding], etc. (other functions are excluded, because they do not
    // identify a unique area), we check the function under c in all templates
    // returned by data. If that function (fun) returns a template that only
    // returns the template expressed by [embf], and uniquely refers it, the
    // expression can be short-cut. In case data is higher than embf, and the
    // child at embf is static under the higher template, it is [{children: {x1:
    // {children: x2: ...}}}, [me]].  If [embf] is higher, it is a sequence of
    // [embedding, ...].
    // If the child is not always present in data, the result of the expression
    // must be guarded by the condition that controls the child's presence in
    // data. For now, this is only possible through [areaOfClass] (other
    // functions, such as cond can be implemented as well), and only when the
    // condition can be evaluated by the originating area.
    if (allowOptimization && selEmbLevel !== undefined &&
          selEmbLevel.min === selEmbLevel.max) {
        var selArea: AreaTemplate = areaTemplates[selFun.localToArea].getEmbedding(selEmbLevel.min);
        for (var areaTemplateId of data.valueType.areas.keys()) {
            template = areaTemplates[areaTemplateId];
            node = template.areaNode.getNodeAtPath(selection.path);
            condition = data.getExistenceConditionForTemplate(template);
            if (node !== undefined) {
                var fun: FunctionNode = buildFunctionNode(node, template.id, 0, undefined);
                var funEmbLevel: RangeValue = extLevelOfEmbeddingFun(fun, fun.localToArea);
                // TODO: if fun is [embeddingStar] or [[embeddingStar], ...] or
                // [..., [embeddingStar]], then funEmbLevel can be any value so
                // walk them all.
                if (funEmbLevel === undefined || funEmbLevel.min !== funEmbLevel.max) {
                    if (fun.valueType.unknown ||
                          ("areas" in fun.valueType &&
                           fun.valueType.areas.has(selArea.id))) {
                        nrPossibleMatches++;
                    }
                } else if (funEmbLevel.min >= 0) {
                    if (getLevelDifference(template.id, selArea.id, true) >= 0 &&
                          fun.valueType.isEqual(selFun.valueType)) {
                        // data area is below the selection's origin
                        if (condition !== undefined) {
                            targetLevelDiff.push(funEmbLevel.min);
                            targetTemplate.push(template);
                            targetConditions.push(condition);
                        }
                        nrPossibleMatches++;
                    }
                } else {
                    if (getLevelDifference(selArea.id, template.id, false) >= 0 &&
                          fun.valueType.isEqual(selFun.valueType)) {
                        if (selArea.getNrParentIndices() === template.getNrParentIndices()) {
                            if (condition !== undefined) {
                                targetLevelDiff.push(funEmbLevel.min);
                                targetTemplate.push(template);
                                targetConditions.push(condition);
                            }
                        }
                        nrPossibleMatches++;
                    }
                }
            }
        }
    }

    if (nrPossibleMatches > 0 && targetLevelDiff.length === nrPossibleMatches) {
        var funs: FunctionNode[] = [];
        var localToArea: number = undefined;
        var localToDefun: number = 0;
        var canMerge: boolean = true;
        for (var target: number = 0; canMerge && target < nrPossibleMatches; target++) {
            // Check if the resulting set of expressions can be contained in
            // a single os. If not, fall back to the unoptimized version.
            if (!testMergeLocality(localToArea, targetConditions[target].localToArea) ||
                  !testMergeDefunLocality(localToDefun, targetConditions[target].localToDefun)) {
                canMerge = false;
                break;
            }
            localToArea = mergeLocality(localToArea, targetConditions[target].localToArea);
            localToDefun = mergeDefunLocality(localToDefun, targetConditions[target].localToDefun);
            if (targetLevelDiff[target] >= 0) {
                // The expression of the selection query returns an os that at
                // least contains selFun, so the query is equivalent to
                // [{children: { ...}}, [me]].
                var path: string[] = [];
                template = targetTemplate[target];
                while (template !== selArea) {
                    path.push(template.childName);
                    template = template.parent;
                }
                var childQuery: FunctionNode = selection.selectionFunction;
                if (testMergeLocality(localToArea, childQuery.localToArea) &&
                    testMergeDefunLocality(localToDefun, childQuery.localToDefun)) {
                    for (var i: number = path.length - 1; i >= 0; i--) {
                        childQuery = buildChildAreas(path[i], childQuery, origExpr);
                    }
                    localToArea = mergeLocality(localToArea, childQuery.localToArea);
                    localToDefun = mergeDefunLocality(localToDefun, childQuery.localToDefun);
                    funs.push(BoolGateNode.build(targetConditions[target],
                                                 childQuery, undefined));
                } else {
                    canMerge = false;
                }
            } else if (targetLevelDiff[target] < 0) {
                // selection is static child under data
                var embFun: FunctionNode = selection.selectionFunction;
                template = areaTemplates[selection.selectionFunction.localToArea];
                for (var i: number = 0; i > targetLevelDiff[target]; i--) {
                    template = template.parent;
                    embFun = new FunctionApplicationNode(
                        embedding, [embFun],
                        selection.selectionFunction.localToArea, 0,
                        new ValueType().addArea(template.id,
                                                embFun.valueType.sizes),
                        origExpr);
                }
                embFun = 
                    substituteEmbeddingChain(<FunctionApplicationNode> embFun);
                if (testMergeLocality(localToArea, embFun.localToArea) &&
                      testMergeDefunLocality(localToDefun, embFun.localToDefun)) {
                    localToArea = mergeLocality(localToArea, embFun.localToArea);
                    localToDefun = mergeDefunLocality(localToDefun, embFun.localToDefun);
                    funs.push(BoolGateNode.build(targetConditions[target],
                                                 embFun, undefined));
                } else {
                    canMerge = false;
                }
            } else {
                Utilities.error("an odd way of referring to oneself; bug?");
            }
        }
        if  (canMerge) {
            var os: FunctionNode = OrderedSetNode.buildOrderedSet(
                                       funs, data.localToArea, origExpr, false);
            if (origin >= 1 && os.localToArea <= origin &&
                  testMergeLocality(os.localToArea, origin)) {
                return os;
            }
        }
        // else one of the functions originates beneath origin, or the whole
        // produces an os with incompatible localities, so we have to use an
        // AreaSelectionNode.
    }

    if (embeddingLevel === undefined || embeddingLevel.min !== embeddingLevel.max) {
        if (selection.selectionFunction.localityCompatibleWith(data)) {
            return AreaSelectionNode.build(selection, data, origExpr);
        } else {
            // When rewriting expressions, the locality of data and selection
            // can go to incompatible templates. In that case, this caller
            // should try to build the query via a simpler and less efficient
            // function like buildComplexAreaQuery().
            return undefined;
        }
    } else {
        var localToArea: number =
            mergeLocality(selFun.localToArea, data.localToArea);
        var localToDefun: number =
            mergeDefunLocality(selFun.localToDefun, data.localToDefun);
        // The query data was rewritten to [me], [embedding], etc., but
        // always resolves to [me] (possibly at a higher template)
        assert(embeddingLevel.min === 0, "above comment is wrong; add loop to get correct level");
        var query: Expression = pathToQuery(selection.path).normalizeQuery();
        var fun: FunctionNode = buildSimpleFunctionNode(
            ExpressionQuery.build(query, gMeExpr), undefined, data.localToArea,
            0, undefined, undefined, undefined, undefined, context);
        localToArea = mergeLocality(localToArea, fun.localToArea);
        localToDefun = mergeDefunLocality(localToDefun, fun.localToDefun);
        return new BoolMatchNode(fun, selFun, data, localToArea, localToDefun,
                                 data.valueType, origExpr);
    }
}

// Builds a node that projects a path within areas
function buildAreaProjection(path: string[], data: FunctionNode, onAllAreasOfClass: boolean, origin: number, origExpr: Expression, context: number): FunctionNode {
    var exportId: number;
    var embeddingLevel: RangeValue;
    var fn: FunctionNode;

    exportId = getExportId(path, data.valueType.areas);
    embeddingLevel = levelOfEmbeddingFun(data, data.localToArea);
    if (embeddingLevel === undefined || embeddingLevel.min !== embeddingLevel.max) {
        fn = AreaProjectionNode.build(exportId, path, data, onAllAreasOfClass, origin, origExpr);
    } else {
        // The query data was rewritten to [me], [embedding], etc., but
        // always resolves to [me] (possibly at a higher template)
        assert(embeddingLevel.min === 0, "above comment is wrong; add loop to get correct level");
        // Turn path into normalized query on me in data's locality
        var query: Expression = ExpressionQuery.build(
            pathToQuery(path).normalizeQuery(), gMeExpr);
        fn = buildSimpleFunctionNode(query, undefined, data.localToArea,
                         0, undefined, undefined, undefined, origExpr, context);
    }
    return fn;
}

/* A query has to components: selection and projection. Applying a query to a
   set of areas first selects the areas matching the selection by treating
   selection as a chain of filters. The bottom of that chain is the data
   generating the area set.
     If there is no projection, the area set at the end of the chain is the
   result. If there is a projection, the projection expression is applied to
   each of the remaining areas.
*/
function buildAreaQuery(normalizedQuery: Expression, data: FunctionNode, origin: number, defun: number, origExpr: Expression, context: number, allowOptimization: boolean): FunctionNode {

    if (normalizedQuery instanceof ExpressionUndefined) {
        return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
    }

    function isComplex(q: Expression, lvl: number, qState: {proj: boolean; sel: boolean}): boolean {
        switch (q.type) {
          case ExpressionType.projector:
            qState.proj = true;
            return lvl > 1 && qState.sel;
          case ExpressionType.builtInFunction:
          case ExpressionType.query:
          case ExpressionType.functionApplication:
          case ExpressionType.jsFunctionApplication:
          case ExpressionType.string:
          case ExpressionType.number:
          case ExpressionType.null:
          case ExpressionType.boolean:
          case ExpressionType.range:
          case ExpressionType.orderedSet:
          case ExpressionType.false:
          case ExpressionType.undefined:
            qState.sel = true;
            return lvl > 1 && qState.proj;
          case ExpressionType.attributeValue:
            var sQState = {proj: false, sel: false};
            var av = <ExpressionAttributeValue> q;
            for (var i: number = 0; i < av.attributes.length; i++) {
                var attr: string = av.attributes[i];
                var arg: Expression = av.arguments[i];
                if (isComplex(arg, (lvl !== 0 || attr !== "context"? lvl + 1: lvl), sQState)) {
                    return true;
                }
            }
            return false;
          case ExpressionType.negation:
            var n = <ExpressionNegation> q;
            for (var i: number = 0; i < n.arguments.length; i++) {
                if (isComplex(n.arguments[i], lvl, qState)) {
                    return true;
                }
            }
            return false;
        }
        return false;
    }

    // Child queries on areas work differently: first get the children, then
    // do the query
    if (normalizedQuery.containsAttribute("children")) {
        var childQuery: { childName: string; restQuery: any; } =
            extractChildQuery(<ExpressionAttributeValue>normalizedQuery);
        if (childQuery === undefined) {
            Utilities.error("cannot process " + normalizedQuery.toCdlString());
            return undefined;
        }
        var children: FunctionNode = buildChildAreas(childQuery.childName, data, undefined);
        if (childQuery.restQuery !== gProjectorExpr) {
            // rewrite [{children: {x: {y: _}}}, z] to
            // [{y: _}, [{children: {x: _}}, z]]
            var queryOnChild: FunctionNode = buildAreaQuery(
                childQuery.restQuery.normalizeQuery(),
                children, origin, defun, origExpr, context, true);
            if (!(queryOnChild instanceof AreaProjectionNode)) {
                return queryOnChild;
            }
            var argEmbDepth: RangeValue = extLevelOfEmbeddingFun(
                               (<AreaProjectionNode>queryOnChild).data, origin);
            if (argEmbDepth === undefined || argEmbDepth.min !== argEmbDepth.max) {
                return queryOnChild;
            }
            // Of format [{children: {x: {y: _}}}, [me/embedding/...]], in which
            // case a more direct access to the expression may be available.
            // This is the case when the child's existence qualifiers and the
            // exported expression are available in origin's environment
            var childTemplate: AreaTemplate = undefined;
            for (var childTemplateId of (<AreaProjectionNode>queryOnChild).data.valueType.areas.keys()) {
                if (childTemplate !== undefined) {
                    return queryOnChild; // More than one child
                }
                childTemplate = areaTemplates[childTemplateId];
                var exportNode = childTemplate.exports[(<AreaProjectionNode>queryOnChild).exportId];
                if (exportNode !== undefined) {
                    var evaluationTemplateId: number = exportNode.localToArea;
                    if (getLevelDifference(origin, evaluationTemplateId, true) === undefined) {
                        return queryOnChild;
                    }
                }
            }
            assert(childTemplate !== undefined, "queryOnChild should have been o()");
            // There is precisely one exported node, and its localToArea is in our embedding*
            var childExtQual: QualifiersFunctionNode = childTemplate.getExistenceQualifiersWithRespectTo(origin);
            if (childExtQual === undefined ||
                  getLevelDifference(origin, childExtQual.localToArea, true) === undefined) {
                // Area doesn't exist or qualifiers are not in our embedding*
                return queryOnChild;
            }
            return new VariantFunctionNode(childExtQual,
                    childExtQual.qualifiers.map(q => exportNode), // One function node per qualifier
                    mergeLocality(childExtQual.localToArea, exportNode.localToArea),
                    0, exportNode.valueType, origExpr, undefined);
        } else {
            // query was [{children: {x: _}}, z]
            return children;
        }
    }

    if (normalizedQuery instanceof ExpressionAttributeValue) { // TODO: beautify
        if (isComplex(normalizedQuery, 0, {proj: false, sel: false})) {
            return buildComplexAreaQuery(normalizedQuery, data, origin, defun, origExpr, context);
        }
    }

    if (normalizedQuery instanceof ExpressionOrderedSet) {
        if (normalizedQuery.arguments.length === 0) {
            return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
        }
        var subQueries: Expression[] = normalizedQuery.arguments;
        var subResults: FunctionNode[] = [];
        var valueType: ValueType = new ValueType();
        for (var i: number = 0; i < subQueries.length; i++) {
            var subQuery: Expression = subQueries[i].normalizeQuery();
            var subResult: FunctionNode = buildAreaQuery(subQuery, data,
                           origin, defun, origExpr, context, allowOptimization);
            if (subResult !== undefined) {
                subResults.push(subResult);
                valueType = valueType.merge(subResult.valueType);
            }
        }
        if (valueType.isDataAndAreas()) {
            Utilities.syntaxError("mixing data and areas in o() query on areas");
            return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
        }
        var res: FunctionNode = OrderedSetNode.buildOrderedSet(
            subResults, undefined, origExpr, false);
        if (valueType.isAreas()) {
            var proj: FunctionNode = buildSimpleFunctionNode(
                gProjectorExpr, undefined, undefined, 0,
                undefined, undefined, undefined, undefined, context);
            var valueType: ValueType = res.valueType;
            res = FunctionApplicationNode.buildFunctionApplication(
                internalApply, [proj, res], res.localToArea,
                res.localToDefun, origin, origExpr);
            res.valueType = valueType; // the previous call makes it anyData
        }
        return res;
    }
    
    var queryComponents: QueryComponent[] = normalizedQuery.extractQueryComponents([], true, origin, defun);
    var projectionNode: QueryComponent;
    var resultNode: FunctionNode = data;

    for (var i: number = 0; i < queryComponents.length; i++) {
        if (queryComponents[i] instanceof QueryComponentSelect) {
            var qcs = <QueryComponentSelect> queryComponents[i];
            qcs.selectionFunction = buildSimpleFunctionNode(
                qcs.selectionExpression, undefined, context, defun,
                undefined, undefined, undefined, undefined, context);
        }
    }

    if (queryComponents[0].path.length === 0) {
        // The query [n([...]), ...] was passed here, but has to be translated
        // into a negative area comparison.
        var selection: FunctionNode[] = [];
        var localToArea: number = undefined;
        var localToDefun: number = 0;
        var valueType: ValueType = new ValueType();
        for (var i: number = 0; i < queryComponents.length; i++) {
            var qcs = <QueryComponentSelect> queryComponents[i];
            assert(!qcs.positive, "only [n([...]), ...] can bring us here");
            selection.push(qcs.selectionFunction);
            localToArea = mergeLocality(localToArea, qcs.selectionFunction.localToArea);
            localToDefun = mergeDefunLocality(localToDefun, qcs.selectionFunction.localToDefun);
            valueType = valueType.merge(qcs.selectionFunction.valueType);
        }
        var areaArg: FunctionNode = selection.length === 1? selection[0]:
            new OrderedSetNode(selection, localToArea, localToDefun, valueType, undefined, false);
        var functionArguments: FunctionNode[] = [areaArg, data];
        localToArea = mergeLocality(qcs.selectionFunction.localToArea, data.localToArea);
        localToDefun = mergeDefunLocality(qcs.selectionFunction.localToDefun, data.localToDefun);
        return new FunctionApplicationNode(nCompareAreasQuery, functionArguments,
                                           localToArea, localToDefun,
                                           getValueType(nCompareAreasQuery,
                                                        functionArguments,
                                                        localToArea),
                                           origExpr);
    }

    // First sort the query components, so that selections on [me] or
    // [embedding] come first: [{a: x}, [{b: [me]}, [fun]]] can be optimized,
    // but [{b: [me]}, [{a: x}, [fun]]] can't.
    queryComponents.sort(function(a: QueryComponent, b: QueryComponent): number {
        var aSel: boolean = a instanceof QueryComponentSelect;
        var bSel: boolean = b instanceof QueryComponentSelect;

        if (aSel && bSel) {
            var as = <QueryComponentSelect> a;
            var bs = <QueryComponentSelect> b;
            var embLevelA: RangeValue = levelOfEmbeddingFun(as.selectionFunction, as.selectionFunction.localToArea);
            var embLevelB: RangeValue = levelOfEmbeddingFun(bs.selectionFunction, bs.selectionFunction.localToArea);
            // embedding functions first; if both are, then put [me] before
            // [embedding], even though there is no need
            return embLevelA === embLevelB? objectCompare(a.path, b.path):
                   embLevelA === undefined? 1:
                   embLevelB === undefined? -1:
                   embLevelA.min - embLevelB.min;
        } else if (!aSel && !bSel) {
            return objectCompare(a.path, b.path);
        } else {
            // Projection after selection
            return aSel? -1: 1;
        }
    });

    for (var i: number = 0; i !== queryComponents.length; i++) {
        var qc: QueryComponent = queryComponents[i];
        if (qc instanceof QueryComponentSelect) {
            resultNode = buildAreaSelection(qc, resultNode, undefined, origin, context, allowOptimization);
            if (resultNode === undefined) {
                if (normalizedQuery instanceof ExpressionAttributeValue) {
                    return buildComplexAreaQuery(normalizedQuery, data, origin,
                                                 defun, origExpr, context);
                } else {
                    // Chain of area selections has led to incompatible
                    // expressions, so normalizedQuery should be an AV,
                    // {context: ...}, but clearly isn't.
                    Utilities.error("cannot build complex query");
                }
            }
        } else { // qc instanceof QueryComponentProject
            assert(projectionNode === undefined, "TODO: multiple projection paths");
            projectionNode = qc;
        }
    }
    if (projectionNode !== undefined) {
        resultNode = buildAreaProjection(projectionNode.path, resultNode, queryComponents.length === 1, origin, undefined, context);
    }
    resultNode.origExpr = origExpr;
    return resultNode;
}

// Similar to buildAreaQuery, but using a function node instead of a constant.
// Note: works only for positive queries of depth 1.
function buildAreaQueryOnAV(nonNormalizedQuery: AVFunctionNode, data: FunctionNode, origin: number, origExpr: Expression, context: number): FunctionNode {
    if ("children" in nonNormalizedQuery.attributes) {
        // Not for the moment
        return undefined;
    }
    var queryComponents: QueryComponent[] = extractQueryComponentsFromAV(nonNormalizedQuery);
    if (queryComponents === undefined) {
        return undefined;
    }
    var projectionNode: QueryComponent;
    var resultNode: FunctionNode = data;

    for (var i: number = 0; i !== queryComponents.length; i++) {
        var qc: QueryComponent = queryComponents[i];
        if (qc instanceof QueryComponentProject) {
            assert(projectionNode === undefined, "TODO: multiple projection paths");
            projectionNode = qc;
        } else {
            var qcs = <QueryComponentSelect> qc;
            resultNode = buildAreaSelection(qcs, resultNode, undefined, origin, context, true);
            assert(resultNode !== undefined, "call buildComplexAreaQuery? Should have checked locality before calling?");
        }
    }
    if (projectionNode !== undefined) {
        resultNode = buildAreaProjection(projectionNode.path, resultNode, queryComponents.length === 1, origin, undefined, context);
    }
    resultNode.origExpr = origExpr;
    return resultNode;
}

// TODO: improve this function. It merges the results instead of the queries!
// Replace q[0]=>{x:...},q[1]=>{y:...} into a qualifier node on a area
// queries on AVs or constants. Returns undefined when one of the
// qualified expressions cannot be replaced by an area query.
function buildAreaQueryOnQualifiedAV(qfn: VariantFunctionNode, data: FunctionNode, origin: number, defun: number, origExpr: Expression, context: number): FunctionNode {
    var qualifiers: SingleQualifier[][] = [];
    var functionNodes: FunctionNode[] = [];
    var valueType: ValueType = new ValueType();
    var allFunctionsIdentical: boolean = true;
    var allQualifiersTrue: boolean = true;

    for (var i: number = 0; i !== qfn.functionNodes.length; i++) {
        var fun: FunctionNode = undefined;
        if (qfn.functionNodes[i] instanceof AVFunctionNode) {
            var avf = <AVFunctionNode> qfn.functionNodes[i];
            fun = buildAreaQueryOnAV(avf, data, origin, undefined, context);
        } else if (qfn.functionNodes[i] instanceof ConstNode) {
            var cf = <ConstNode> qfn.functionNodes[i];
            var query: Expression =
                normalizeValueQuery(stripArray(cf.value, true), true);
            fun = buildAreaQuery(query, data, origin, defun, undefined, origin, true);
        }
        if (fun === undefined) {
            return undefined;
        }
        qualifiers.push(qfn.qualifiers.qualifiers[i]);
        if (qfn.qualifiers.qualifiers[i].length !== 0) {
            allQualifiersTrue = false;
        }
        valueType = valueType.merge(fun.valueType);
        functionNodes.push(fun);
        if (i !== 0 && !fun.isEqual(functionNodes[0])) {
            allFunctionsIdentical = false;
        }
    }
    if (functionNodes.length === 0) {
        return buildConstNode(undefined, false, false, 0, gUndefinedExpr);
    }
    if (allFunctionsIdentical && allQualifiersTrue) {
        functionNodes[0].origExpr = origExpr;
        return functionNodes[0];
    }
    return VariantFunctionNode.build2(qualifiers, functionNodes, valueType,
                                      origExpr, undefined);
}

// Construct a {#attr: expr} object
function makeContextQuery(attr: string, expr: Expression): Expression {
    var contextQueryObj: any = {};
    contextQueryObj[attr] = expr.expression;
    var queryObj: any = {context: contextQueryObj};
    var contextQuery = expressionStore.store(
        new ExpressionAttributeValue(contextQueryObj, [expr], [attr]));
    return expressionStore.store(
        new ExpressionAttributeValue(queryObj, [contextQuery], ["context"]));
}

// Breaks down queries like {context: {a: {b: 1, c: _}}} on an area set into
// queries with one attribute level less. Splits the query into queries per
// attribute, and chains them as selections, to which the projection is
// applied. Accepts only one projection attribute, like buildAreaQuery.
function buildComplexAreaQuery(normalizedQuery: ExpressionAttributeValue, data: FunctionNode, origin: number, defun: number, origExpr: Expression, context: number): FunctionNode {
    var projAttr: string;
    var projIndex: number;
    var result: FunctionNode = data;
    var attrs: string[] = normalizedQuery.attributes;
    var contextQuery: ExpressionAttributeValue;

    if (attrs.length !== 1 || attrs[0] !== "context" ||
          normalizedQuery.getNrProjectionPaths() > 1) {
        Utilities.error("complex area queries must start with context and have at most one projection site");
        return buildConstNode([], true, undefined, 0, gEmptyOSExpr);
    }
    contextQuery = <ExpressionAttributeValue> normalizedQuery.arguments[0];
    // First build the selection(s)
    for (var i: number = 0; i < contextQuery.attributes.length; i++) {
        var attr: string = contextQuery.attributes[i];
        var nrProjectionPaths: number = contextQuery.arguments[i].getNrProjectionPaths();
        if (nrProjectionPaths !== 0) {
            projAttr = attr; // skip projection for now
            projIndex = i;
        } else {
            switch (contextQuery.arguments[i].type) {
              case ExpressionType.attributeValue:
                // Transform [{x: y}, z] into [y, [{x: _}, z]]
                result = buildQueryNodeOnFunction(
                    contextQuery.arguments[i],
                    buildAreaQuery(makeContextQuery(attr, gProjectorExpr),
                              result, origin, defun, undefined, context, false),
                    origin, defun, undefined, context);
                break;
              case ExpressionType.negation:
                Utilities.error("negation in complex area queries not supported");
                break;
              default:
                // add query {attr: contextQuery[attr]}
                result = buildAreaQuery(
                    makeContextQuery(attr, contextQuery.arguments[i]),
                    result, origin, defun, undefined, context, false);
                break;
            }
            assert(result.valueType.isEqual(data.valueType), "selections should not change the value type");
        }
    }
    // Append the projection in the same style with the projAttr attribute
    if (projAttr !== undefined) {
        if (contextQuery.arguments[projIndex] instanceof ExpressionAttributeValue) {
            // Transform [{x: y}, z] into [y, [{x: _}, z]]
            result = buildQueryNodeOnFunction(
                contextQuery.arguments[projIndex],
                buildAreaQuery(makeContextQuery(projAttr, gProjectorExpr), result, origin, defun, undefined, context, false),
                origin, defun, undefined, context);
        } else {
            result = buildAreaQuery(
                makeContextQuery(projAttr, contextQuery.arguments[projIndex]),
                result, origin, defun, undefined, context, false);
        }
    }
    result.origExpr = origExpr;
    return result;
}

// Optimization for constructions like [{a: _}, {a: 1}], which unfortunately
// only seem to be present in small tests.
function buildAVQueryOnAV(query: ExpressionAttributeValue, data: AVFunctionNode, origin: number, defun: number, origExpr: Expression, context: number): FunctionNode {
    var queryComponents: QueryComponent[] = query.extractQueryComponents([], true, origin, defun);
    var projectionNodes: {[attr: string]: FunctionNode} = undefined;
    var singleProjAttr: string = undefined;
    var nrProjections: number = 0;
    var nrSelections: number = 0;
    var selectionNodes: FunctionNode[] = undefined;
    var selection: FunctionNode;
    var projection: FunctionNode = data;

    for (var i: number = 0; i !== queryComponents.length; i++) {
        var qc: QueryComponent = queryComponents[i];
        var attr: string = qc.path[0];
        if (qc instanceof QueryComponentProject) {
            if (qc.path.length !== 1) {
                // We only do top level projection; deeper seems unnecessary.
                return undefined;
            }
            if (attr in data.attributes) {
                if (nrProjections === 0) {
                    projectionNodes = {};
                    singleProjAttr = attr;
                }
                projectionNodes[attr] = data.attributes[attr];
            }
            nrProjections++;
        } else if (qc instanceof QueryComponentSelect) {
            if (attr in data.attributes) {
                if (!qc.positive) {
                    // No optimization: extractQueryComponents doesn't return a
                    // proper selection function for negative queries.
                    return undefined;
                }
                if (selectionNodes === undefined) {
                    selectionNodes = [];
                }
                // Note that deeper selections are propagated here
                selectionNodes.push(buildQueryNodeOnFunction(
                    query.arguments[query.attributes.indexOf(attr)],
                    data.attributes[attr], origin, defun, undefined, context));
            } else if (qc.positive) {
                // There is no such attribute, so the result is o()
                return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
            } else {
                // It's a negation, so it's always true
            }
            nrSelections++;
        } else {
            Utilities.error("unknown query component");
            return undefined;
        }
    }
    if (selectionNodes !== undefined) {
        if (selectionNodes.length === 1) {
            selection = selectionNodes[0];
        } else {
            selection = FunctionApplicationNode.buildFunctionApplication(and, selectionNodes, undefined, undefined, origin, undefined);
        }
    }
    if (projectionNodes !== undefined) {
        if (nrProjections === 1) {
            projection = projectionNodes[singleProjAttr];
        } else {
            projection = AVFunctionNode.build(projectionNodes, data.suppressSet,
                                              data.suppressSetAttr, undefined);
        }
    }
    if (selection === undefined && projection === undefined &&
          (nrSelections !== 0 || nrProjections !== 0)) {
        return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
    } else if (selection === undefined) {
        return projection;
    } else {
        return BoolGateNode.build(selection, projection, undefined);
    }
}

// If fn evaluates to undefined, turn it into o(). The result is is guaranteed
// to be not undefined and not mergeable. Not for general use.
function guaranteeUnmergeableAndDefined(fn: FunctionNode): FunctionNode {
    if (fn instanceof ConstNode && fn.isAlwaysFalse()) {
        return buildConstNode([], fn.wontChangeValue, undefined, 0, gEmptyOSExpr);
    }
    return fn.isUnmergeable() && !fn.valueType.isPotentiallyMergeable()? fn:
           FunctionApplicationNode.buildFunctionApplication(
               makeDefined, [fn], fn.localToArea, fn.localToDefun,
               fn.localToArea, fn.origExpr);
}

// Check if it is something like ["ClassName", [classOfArea, [me]]],
// which can be translated directly to <class expr>: true => o("ClassName")
function buildClassNameSelectionOnMe(areaFun: FunctionNode, origin: number,
                  query: ExpressionString, origExpr: Expression): FunctionNode
{
    if (areaFun instanceof FunctionApplicationNode && areaFun.builtInFunction === me) {
        var areaEmbDepth: RangeValue = levelOfEmbeddingFun(areaFun, origin);
        if (areaEmbDepth !== undefined) {
            var defun: number = areaFun.localToDefun;
            var cond: FunctionNode = buildAreaOfClassQuery0(undefined,
                query.expression, areaEmbDepth, origin, defun, undefined);
            if (cond instanceof BoolGateNode) {
                if (cond.a instanceof StubFunctionNode) {
                    debugger;
                }
            }
            var classNameFun: FunctionNode =
                buildSimpleFunctionNode(query, undefined, origin, defun,
                        undefined, undefined, undefined, undefined, origin);
            return BoolGateNode.build(cond, classNameFun, origExpr);
        }
    }
    return undefined;
}

// Check if it is something like ["ClassName", [classOfArea, [f, ...]]], where f
// returns areas, and translate it directly to
// [areaProject, class.ClassName, [f, ...]] => o("ClassName")
// Note that the generated export corresponds to the query [{class: {className: _}}, ...],
// which thereby has become legal in cdl.
function buildClassNameSelectionOnAreaSelection(areaFun: FunctionNode,
    origin: number, query: ExpressionString, origExpr: Expression): FunctionNode
{
    if (!areaFun.valueType.isStrictlyAreas()) {
        return undefined;
    }
    var path: string[] = ["class", query.expression];
    var condition: FunctionNode = buildAreaProjection(path, areaFun, false, origin, origExpr, origin);
    var classNameFun: FunctionNode = buildSimpleFunctionNode(query, undefined,
        origin, 0, undefined, undefined, undefined, query, origin);
    return BoolGateNode.build(condition, classNameFun, origExpr);
}

function getIntermediateAreaProjectionPaths(query: Expression, dataValueType: ValueType): string[][] {
    if (dataValueType === undefined || query.type !== ExpressionType.attributeValue) {
        return [];
    }
    if (dataValueType.isStrictlyAreas()) {
        return [[]];
    }
    if (dataValueType.object === undefined) {
        return [];
    }
    var av = <ExpressionAttributeValue> query;
    var areaProjectionPaths: string[][] = [];
    for (var i = 0; i < av.attributes.length; i++) {
        var attr = av.attributes[i];
        var subQuery = av.arguments[i];
        var subAreaProjPaths = getIntermediateAreaProjectionPaths(subQuery, dataValueType.object[attr]);
        if (subAreaProjPaths.length > 0) {
            areaProjectionPaths = areaProjectionPaths.concat(
                subAreaProjPaths.map(function(subPath: string[]): string[] {
                    return [attr].concat(subPath);
                })
            );
        }
    }
    return areaProjectionPaths;
}

function buildQueryNodeOnFunction(query: Expression, data: FunctionNode, origin: number, defun: number, origExpr: Expression, context: number): FunctionNode {
    if (data.valueType.unknown && !data.valueType.remote &&
          !data.hasWritableReference) {
        data.valueType.checkConsistency();
        return buildConstNode([], inputsWontChangeValue([data]),
                              undefined, 0, gEmptyOSExpr);
    }
    if (data.valueType.isDataAndAreas()) {
        Utilities.typeError("cannot query on combination of data and areas: " +
                            query.toCdlString());
        return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
    }
    if (data.valueType.areas !== undefined) {
        // If data is a set of areas, build an import node, and make
        // the output areas export the normalized query
        return buildAreaQuery(query.normalizeQuery(), data, origin, defun,
                              origExpr, context, true);
    }
    if (query instanceof ExpressionString && data instanceof ClassOfAreaNode) {
        var classNameSelectionOnMe =
            buildClassNameSelectionOnMe(data.data, origin, query, origExpr);
        if (classNameSelectionOnMe !== undefined) {
            return classNameSelectionOnMe;
        }
        var classNameSelectionOnAreaSelection =
            buildClassNameSelectionOnAreaSelection(data.data, origin, query, origExpr);
        if (classNameSelectionOnAreaSelection !== undefined) {
            return classNameSelectionOnAreaSelection;
        }
    }

    var areaProjectionPaths = getIntermediateAreaProjectionPaths(query, data.valueType);
    if (areaProjectionPaths.length > 0) {
        // The query looks like {a: {b: ...}}, where e.g. {a: _} returns area refs
        if (areaProjectionPaths.length > 1) {
            Utilities.syntaxError("no support for projections on multiple areas");
            return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
        }
        var restQuery = splitPathFromQuery(query, areaProjectionPaths[0]);
        assert(restQuery !== undefined && restQuery.type === ExpressionType.attributeValue,
              "expecting an AV");
        var leadQuery = pathToQuery(areaProjectionPaths[0]);
        var areaQuery = buildQueryNodeOnFunction(leadQuery, data, origin,
                                                defun, origExpr, context);
        return buildQueryNodeOnFunction(restQuery, areaQuery, origin, 0, origExpr, origin);
    }

    // Else it's data
    var queryNode = buildSimpleFunctionNode(query, undefined, origin, defun, undefined, undefined, undefined, undefined, origin);
    if (queryNode instanceof ConstNode && data instanceof ConstNode) {
        // Since query and data are constant, replace this expression by
        // the result.
        return buildConstNode(interpretedQuery(queryNode.value, data.value),
                              queryNode.wontChangeValue && data.wontChangeValue,
                              undefined, 0, origExpr);
    }

    if (query instanceof ExpressionAttributeValue &&
          data instanceof AVFunctionNode) {
        var rewrite: FunctionNode = buildAVQueryOnAV(query, data, origin, defun, origExpr, context);
        if (rewrite !== undefined) {
            return rewrite;
        }
    }

    // var compiledQuery = !query.isConstEmptyOS()?
    //     QueryCompiler.getCompiledQuery(query, origin, defun, undefined, data.valueType, origExpr): undefined;
    var valueType: ValueType = determineQueryValueType(query, data);
    // [EXECUTECOMPILEDQUERY]
    // if (compiledQuery !== undefined) {
    //     return FunctionApplicationNode.buildExecuteCompiledQuery(
    //                compiledQuery, data, valueType, origExpr);
    // } else {
    //     if (query !== gProjectorExpr) { // don't bother to warn about _
    //         Utilities.warnOnce("interpreted query: " + query.toCdlString() + " @" + origin);
    //     }
        return queryNode === undefined?
               buildConstNode([], false, undefined, 0, origExpr):
               FunctionApplicationNode.buildInternalApply(
                   [queryNode, data], valueType,
                   mergeLocality(queryNode.localToArea, data.localToArea),
                   mergeDefunLocality(queryNode.localToDefun, data.localToDefun),
                   origExpr);
    // }
}

function pathToQuery(path: string[], from: number = 0, to: number = path.length,
                     terminal: Expression = gProjectorExpr): Expression
{
    var query: Expression = terminal;
    var queryObject: any = terminal.expression;

    for (var i: number = to - 1; i >= from; i--) {
        var attr: string = path[i];
        var tmp: any = {};
        tmp[attr] = queryObject;
        queryObject = tmp;
        query = expressionStore.store(
            new ExpressionAttributeValue(queryObject, [query], [attr]));
    }
    return query;
}

function splitPathFromQuery(query: Expression, path: string[]): Expression|undefined {
    for (var i = 0; i < path.length; i++) {
        if (query.type !== ExpressionType.attributeValue) {
            Utilities.error("not an av in splitPathFromQuery");
            return undefined;
        }
        var av = <ExpressionAttributeValue> query;
        if (av.attributes.length !== 1) {
            Utilities.error("Cannot split query");
            return undefined;
        }
        if (av.attributes[0] !== path[i]) {
            return undefined;
        }
        query = av.arguments[0];
    }
    return query;
}

var lastAreaCountForMessageQueryOutput: number = undefined;

function buildConstNode(val: any, wontChangeValue: boolean, suppressSet: boolean, defun: number, origExpr: Expression): FunctionNode {
    assert(!(val instanceof DomainShield), "should not be handled here");
    if (val instanceof Array) {
        if (val.length === 1 && typeof(val[0]) === "string" && val[0] in gParameterStack) {
            return gParameterStack[val[0]];
        }
    } else if (typeof(val) === "string" && val in gParameterStack) {
        return gParameterStack[val];
    }
    return new ConstNode(val, getValueTypeFromConstant(val), origExpr, suppressSet, wontChangeValue);
}

function checkTypeChange(newFN: FunctionNode, oldFN: FunctionNode): void {
    var newValueType: ValueType;

    if (newFN !== undefined) {
        if (newFN instanceof StubFunctionNode) {
            var sfn = <StubFunctionNode> newFN;
            newValueType = sfn.resolution !== undefined?
                sfn.resolution.valueType: sfn.valueType;
        } else {
            newValueType = newFN.valueType;
        }
    }
    if (oldFN !== undefined) {
        if (newValueType !== undefined) {
            if (!oldFN.valueType.subsumes(newValueType)) {
                signalOutputChange(undefined, {
                    type: "valueTypeChange",
                    origType: oldFN.valueType,
                    newType: newValueType
                });
            }
        } else if (oldFN instanceof StubFunctionNode) {
            var sfn = <StubFunctionNode> oldFN;
            if (!sfn.valueType.unknown) {
                signalOutputChange(undefined, {
                    type: "valueTypeChange",
                    origType: sfn.valueType,
                    newType: newValueType
                });
            }
        } else {
            signalOutputChange(undefined, {
                type: "valueTypeChange",
                origType: oldFN.valueType,
                newType: newValueType
            });
        }
    } else if (newFN !== undefined) {
        signalOutputChange(undefined, {
            type: "valueTypeChange",
            origType: undefined,
            newType: newFN.valueType
        });
    }
}

var gBuildExprBreak: {[id: number]: any} = {};
var gNrCallsPerTemplate: number[] = [];
var gAccumulatedNrCallsPerTemplate: number[] = [];

/// Builds a FunctionNode from an Expression. Each expression (which must have a
/// unique id, see ExpressionDict) is compiled only once per template/defun.
/// During compilation, a StubFunctionNode is placed in the cache, so that
/// cyclical compilation is prevented.
function buildSimpleFunctionNode(expr: Expression, writability: PathInfo,
                                 origin: number, defun: number,
                                 suppressSet: boolean,
                                 knownTrueQualifiers: SingleQualifier[],
                                 knownFalseQualifiers: SingleQualifier[][],
                                 origExpr: Expression,
                                 context: number
                                ): FunctionNode
{
    assert(knownTrueQualifiers === undefined || knownTrueQualifiers instanceof Array, "debugging");
    var fn: FunctionNode;

    if (context === origin || defun === 0) {
        var template: AreaTemplate = areaTemplates[origin];
        var domainExpressionCaches =
            origin? template.expressionCache: globalExpressionCache;
        var expressionCache: ExpressionCache = domainExpressionCaches[defun];
        fn = expressionCache.findFunctionNode(expr, suppressSet);
        if (fn === undefined || fn.outdated()) {
            var oldFunctionNode: FunctionNode = fn;
            var stub: StubFunctionNode = new StubFunctionNode(origin, defun,
                                     fn === undefined? undefined: fn.valueType);
            expressionCache.updateFunctionNode(expr, stub, suppressSet);
            if (gNrCallsPerTemplate[origin] === undefined) {
                gNrCallsPerTemplate[origin] = 1;
            } else {
                gNrCallsPerTemplate[origin]++;
            }
            if (expr.id in gBuildExprBreak && (gBuildExprBreak[expr.id] === true || gBuildExprBreak[expr.id] === origin)) {
                debugger;
            }
            fn = expr.buildFunctionNode(origin, defun, suppressSet, context);
            checkTypeChange(fn, oldFunctionNode);
            expressionCache.updateFunctionNode(expr, fn, suppressSet);
            stub.resolve(fn);
        } else if (fn instanceof StubFunctionNode) {
            if (fn.stubCycleNr === gStubCycleNr && fn.resolution === undefined) {
                // This cycle detection generates a false hit when some
                // expression <x> depends on [<y>, [classOfArea, [me]]] and
                // class membership depends on <x> for another class, so it's a
                // warning for now.
                Utilities.warnOnce("possible cycle detected")
            }
        }
    } else {
        // if context is another template than origin and we're in a defun, the
        // domainExpressionCaches do not point to the correct defun. This would
        // require an extra level of caching. Instead, we opt to build the
        // expression again, assuming that this will be very infrequent (since
        // the calling defun will be built only once).
        fn = expr.buildFunctionNode(origin, defun, suppressSet, context);
    }

    if (fn !== undefined) {
        if (optimize && fn.containsQualifiedExpression &&
              (knownTrueQualifiers !== undefined ||
               knownFalseQualifiers !== undefined)) {
            fn = fn.pickQualifiedExpression(knownTrueQualifiers,
                                            knownFalseQualifiers, origin);
        }
        if (writability !== undefined && writability.writable) {
            fn = updateWritableNode(writability.getContextPath(), fn,
                                    writability.getAreaId(), writability,
                                    fn.valueType, expr);
        } 
        if (defun === 0 && fn.localToDefun !== 0) {
            Utilities.syntaxError("unresolved defun parameter");
            fn.localToDefun = 0; // suppresses more errors
        }
        if (origExpr !== undefined) {
            fn.origExpr = origExpr;
        }
    }
    return fn;
}

// Merge the writable nodes, since we should have one per path; otherwise,
// switching between variants would result in retrieving the result of an
// outdated write action.
//   At the end of this function, initialization is the qualified merge of the
// initialization expressions, and all variants point at the same writable node.
// The expressions stay in the same locality as the higher qualifier node.
// Note: remoting also demands one writable node per path.
function mergeWritables(qualifiers: SingleQualifier[][],
                        functionNodes: FunctionNode[], values: PathInfo[],
                        node: PathTreeNode): void
{
    var wrNode: WritableNode;
    var initFuns: FunctionNode[] = [];
    var initQuals: SingleQualifier[][] = [];
    var initValueType: ValueType = new ValueType();
    var wrValueType: ValueType = new ValueType();
    var allFunctionsIdentical: boolean = true;
    var allQualifiersTrue: boolean = true;
    var initFN: FunctionNode;
    var localToArea: number = undefined;
    var localToDefun: number = 0;

    for (var i: number = 0; i < functionNodes.length; i++) {
        if (functionNodes[i] instanceof WritableNode) {
            wrNode = <WritableNode> functionNodes[i];
            if (wrNode.pathInfo === values[i]) {
                var fun: FunctionNode = wrNode.initialValue;
                if (initFuns.length !== 0 && !fun.isEqual(initFuns[0])) {
                    allFunctionsIdentical = false;
                }
                if (qualifiers[i].length !== 0) {
                    localToArea = mergeLocality(localToArea,
                                       SingleQualifier.locality(qualifiers[i]));
                    allQualifiersTrue = false;
                }
                localToArea = mergeLocality(localToArea, fun.localToArea);
                localToDefun = mergeDefunLocality(localToDefun,
                                                  fun.localToDefun);
                initValueType = initValueType.merge(fun.valueType);
                wrValueType = wrValueType.merge(fun.valueType);
                if (wrNode.pathInfo.valueType !== undefined) {
                    wrValueType = wrValueType.merge(wrNode.pathInfo.valueType);
                }
                initFuns.push(fun);
                initQuals.push(qualifiers[i]);
            }
        }
    }
    initFN = allFunctionsIdentical && allQualifiersTrue? initFuns[0]:
             VariantFunctionNode.build2(initQuals, initFuns, initValueType,
                                        undefined, node);
    wrNode = updateWritableNode(wrNode.path, initFN, localToArea,
                                wrNode.pathInfo, wrValueType, wrNode.origExpr);
    for (var i: number = 0; i < functionNodes.length; i++) {
        if (functionNodes[i] instanceof WritableNode) {
            if ((<WritableNode> functionNodes[i]).pathInfo === values[i]) {
                functionNodes[i] = wrNode;
            }
        }
    }
}

/* If a node has one or more values, but also has lower attributes with values,
   the results have to be merged according to qualifiers and priority. One could
   in principle write:

   {qualifiers: Q1}, {variant: V1},
   {qualifiers: Q2}, {variant: {a: A2, b: B2}},
   {qualifiers: Q3}, {variant: {b: B3}},
   {qualifiers: Q4}, {variant: V4},
   {qualifiers: Q5}, {variant: {a: A5, b: B5}},

   The approach is to build the expressions for the top expression and each
   subordinate attribute, i.e.,

   {qualifiers: Q1}, {variant: V1},
   {qualifiers: Q2}, {variant: {a: A2}},
   {qualifiers: Q2}, {variant: {b: B2}},
   {qualifiers: Q3}, {variant: {b: B3}},
   {qualifiers: Q4}, {variant: V4},
   {qualifiers: Q5}, {variant: {b: B5}},
   {qualifiers: Q5}, {variant: {a: A5}},

   and then create a qualifier node in the correct order, merging nodes with
   compatible qualifiers and identical status beforehand if possible.

   Note that defun is undefined, since this construction happens outside
   function bodies
*/
function buildMergeNode(node: PathTreeNode, origin: number, suppressSet: boolean): FunctionNode {

    function identicalQualifiers(g1: SingleQualifier[], g2: SingleQualifier[]): boolean {
        return g1.every(function(g1e: SingleQualifier): boolean {
            return g2.some(function(g2e: SingleQualifier): boolean {
                return g2e.attribute === g1e.attribute &&
                    g2e.localToArea === g1e.localToArea && g2e.value === g1e.value;
            })
        }) && g2.every(function(g2e: SingleQualifier): boolean {
            return g1.some(function(g1e: SingleQualifier): boolean {
                return g2e.attribute === g1e.attribute &&
                    g2e.localToArea === g1e.localToArea && g2e.value === g1e.value;
            })
        });
    }

    var valueType: ValueType = new ValueType();
    var allPathInfo: PathInfo[] = node.collectAllPathInfo();
    allPathInfo.sort(function (a: PathInfo, b: PathInfo): number {
        return a.priority - b.priority;
    });

    // Path info now merged and sorted. Now we build an expression for each, and
    // put them in order in a qualifier node. Note that the paths can be of
    // length n or longer. If they are of longer, an AV structure is added
    // around it. Worst case, the results of those AV structures can only be
    // merged at runtime, since it is possible to have construction as
    // low priority:  q1 => {a: {b: ...}}
    // mid priority:  q2 => {a: {d: ...}}
    // high priority: q1 => {a: {d: ...}}
    // which cannot be simplified at compile time. However, when two subsequent
    // expressions have path length > n and have the same qualifier, they are
    // merged.

    var qualifiers: SingleQualifier[][] = [];
    var functionNodes: FunctionNode[] = [];
    var localToArea: number = undefined;
    var localToDefun: number = 0;
    var topPathLength: number = node.values[0].path.length;
    var allFunctionsIdentical: boolean = true;
    var allQualifiersTrue: boolean = true;
    var lastFun: FunctionNode;
    var firstValue: PathInfo;
    var nrWritables: number = 0;
    var usedPathInfo: PathInfo[] = [];

    // The following code builds an AV for every path deeper than node's path.
    // This can be optimized by merging expressions on the same path, but it
    // requires a bit of qualifier magic.
    for (var i: number = 0; i !== allPathInfo.length; i++) {
        var qualifierWithCycles = buildQualifier(allPathInfo[i].qualifierTerms, origin, 0, undefined, undefined);
        if (qualifierWithCycles !== undefined) {
            var libc: number = lastImpliedUnmergeable(qualifierWithCycles.qualifiers, qualifiers, functionNodes);
            gErrContext.enter(undefined, allPathInfo[i]);
            var fun: FunctionNode = libc !== -1? undefined:
                buildSimpleFunctionNode(allPathInfo[i].expression,
                                       allPathInfo[i], origin, 0, undefined,
                                       undefined, undefined, undefined, origin);
            gErrContext.leave();
            if (fun !== undefined) {
                if (qualifierWithCycles.cycles !== undefined) {
                    Utilities.warnOnce("cycle in buildMergeNode: " + node.getPath());
                }
                localToArea = mergeLocality(localToArea, SingleQualifier.locality(qualifierWithCycles.qualifiers));
                if (qualifierWithCycles.qualifiers.length !== 0) {
                    allQualifiersTrue = false;
                }
                localToArea = mergeLocality(localToArea, fun.localToArea);
                localToDefun = mergeDefunLocality(localToDefun, fun.localToDefun);
                var expr: Expression = allPathInfo[i].expression;
                for (var j: number = allPathInfo[i].path.length - 1; j >= topPathLength; j--) {
                    var attr: string = allPathInfo[i].path[j];
                    var exprAttr: any = {};
                    exprAttr[attr] = expr;
                    expr = expressionStore.store(
                        new ExpressionAttributeValue(exprAttr, [expr], [attr]));
                    if (fun instanceof ConstNode) {
                        var cn = <ConstNode> fun;
                        var cv: any = cn.value;
                        var nv: any;
                        if (suppressSet) {
                            nv = {};
                            nv[attr] = cv;
                        } else {
                            nv = [{}];
                            nv[0][attr] = cv;
                        }
                        fun = new ConstNode(nv, new ValueType().addAttribute(attr, cn.valueType).addSize(1), expr, cn.suppressSet, cn.wontChangeValue);
                    } else {
                        var attributes: {[attribute:string]: FunctionNode} = {};
                        var suppressSetAttr: {[attr: string]: boolean} = {};
                        attributes[attr] = fun;
                        if (suppressSet) {
                            suppressSetAttr[attr] = true;
                        }
                        fun = AVFunctionNode.buildAV(
                            attributes, fun.localToArea, fun.localToDefun,
                            false, false, suppressSet, suppressSetAttr, expr);
                    }
                }
                if (functionNodes.length > 0 && !fun.isEqual(functionNodes[0])) {
                    allFunctionsIdentical = false;
                }
                valueType = valueType.merge(fun.valueType);
                if (lastFun !== undefined &&
                      lastFun.canMergeUnderQualifier(fun) &&
                      identicalQualifiers(qualifiers[qualifiers.length - 1],
                                          qualifierWithCycles.qualifiers)) {
                    lastFun = lastFun.mergeUnderQualifier(fun);
                    functionNodes[functionNodes.length - 1] = lastFun;
                    usedPathInfo[usedPathInfo.length - 1] = allPathInfo[i];
                    firstValue = undefined;
                } else {
                    qualifiers.push(qualifierWithCycles.qualifiers);
                    if (functionNodes.length === 0) {
                        firstValue = allPathInfo[i];
                    }
                    functionNodes.push(fun);
                    usedPathInfo.push(allPathInfo[i]);
                    lastFun = fun;
                    if (fun instanceof WritableNode) {
                        var wrNode: WritableNode = <WritableNode> fun;
                        if (wrNode.pathInfo === allPathInfo[i]) {
                            nrWritables++;
                        }
                    }
                }
            }
        }
    }

    if (nrWritables > 1) {
        mergeWritables(qualifiers, functionNodes, usedPathInfo, node);
    }
    if (functionNodes.length === 0) {
        if (node.isWritableReference()) {
            Utilities.warnOnce("cannot write to empty merge node");
        }
        return buildConstNode(undefined, false, suppressSet, 0, gUndefinedExpr);
    }
    if (allFunctionsIdentical && allQualifiersTrue) {
        if (node.isWritableReference()) {
            if (firstValue !== undefined) {
                return updateWritableNode(node.getContextPath(), functionNodes[0],
                                         node.getAreaId(), firstValue,
                                         functionNodes[0].valueType, undefined);
            }
            Utilities.warnOnce("cannot write through merge node");
        }
        return functionNodes[0];
    }
    return VariantFunctionNode.build2(qualifiers, functionNodes, valueType,
                                      undefined, node);
}

var gBuildNodeBreak: {[id: number]: boolean} = {};

function buildFunctionNodeNC(node: PathTreeNode, origin: number, defun: number, suppressSet: boolean): FunctionNode {
    var fn: FunctionNode;

    assert(defun >= 0 && (origin === undefined || typeof(origin) === "number"), "debugging");
    if (node.id in gBuildNodeBreak) {
        debugger;
    }
    if (node.values.length === 0) {
        gErrContext.enter(node, undefined);
        fn = buildAVNode1(node, origin, defun, suppressSet, undefined);
    } else if (node.hasChildren()) {
        gErrContext.enter(node, undefined);
        assert(defun === 0, "merge node in defun?");
        fn = buildMergeNode(node, origin, suppressSet);
    } else if (node.isSingleValue()) {
        gErrContext.enter(node, node.values[0]);
        fn = buildSimpleFunctionNode(node.values[0].expression,
           (node.isWritableReference()? node.values[0]: undefined),
           origin, defun, suppressSet, undefined, undefined, undefined, origin);
    } else {
        gErrContext.enter(node, undefined);
        fn = buildQualifierNode(node.values, origin, defun,
                    node.isSuppressSetPath(), node.getContextAttribute(), node);
    }
    gErrContext.leave();
    return fn;
}

var gWontChangeCount: number = 0;

function buildFunctionNode(node: PathTreeNode, origin: number, defun: number, suppressSet: boolean): FunctionNode {
    if (defun === 0) {
        // Don't mix different defun environments by returning the wrong
        // function node.  Another option is to store results per defun, but
        // that seems overkill, since defuns are rather insignificant.
        if (node.needsResolution()) {
            if (node.functionNode instanceof ConstNode &&
                  (<ConstNode>node.functionNode).wontChangeValue) {
                // Constant nodes don't change after the first cycle, so they
                // don't have to be rebuilt anymore. Probably not much of a time
                // saver.
                gWontChangeCount++;
                node.functionNode.cycleNr = gCycleNr;
            } else {
                if (node.functionNode instanceof StubFunctionNode) {
                    node.functionNode = undefined;
                }
                node.functionNode = buildFunctionNodeNC(node, origin, defun, suppressSet);
            }
        }
        return node.functionNode;
    } else {
        return buildFunctionNodeNC(node, origin, defun, suppressSet);
    }
}

// Stores associations between writable nodes and the write that can potentially
// reach them for warnings.
var appStateSources: {[wrPath: string]: {[nodeId: number]: PathTreeNode}} = {};

class WritableNodePath {
    qualifiers: SingleQualifier[];
    functionNode: StorageNode;
    path: string[];
}

function buildToMergeNode(node: PathTreeNode, origin: number, wrNode: WriteNode): ToMergeNode {

    // returns true when the merge node doesn't do anything, i.e. a push with
    // an empty os.
    function nopMerge(fn: FunctionNode): boolean {
        if (fn instanceof FunctionApplicationNode) {
            var fan = <FunctionApplicationNode> fn;
            if (fan.builtInFunction.name === "internalPush" &&
                  fan.functionArguments.length === 1 &&
                  fan.functionArguments[0] instanceof ConstNode) {
                var cn = <ConstNode> fan.functionArguments[0];
                return cn.value instanceof Array && cn.value.length === 0;
            }
        }
        return false;
    }

    // First a bunch of checks for things we cannot do
    if (node.opaque) {
        // This can be resolved, but it takes some effort.
        Utilities.error("opaque to/merge:\n" + node.toString());
        return undefined;
    }
    if (!("to" in node.next && "merge" in node.next)) {
        // This is probably an author error
        Utilities.error("missing to or merge:\n" + node.toString());
        return undefined;
    }

    function addPathToType(vt: ValueType, path: string[]): ValueType {
        var nt: ValueType = vt;

        for (var i: number = path.length - 1; i >= 0; i--) {
            nt = new ValueType().addAttribute(path[i], nt).addSize(1);
        }
        return nt;
    }

    gErrContext.enter(node, undefined);

    // TODO: get qualifiers for upon, to and merge expressions
    var toNode: PathTreeNode = node.next["to"];
    gErrContext.enter(toNode, undefined);
    var toFunc: FunctionNode = buildFunctionNode(toNode, origin, 0, undefined);
    var wrNodes: WritableNodePath[] = toFunc === undefined? undefined:
                                 toFunc.extractWritableDestinations([], {});

    if (wrNodes === undefined) {
        Utilities.warnOnce("cannot write to:\n// " + toNode.toString().split("\n").join("\n// "));
        gErrContext.leave();
        gErrContext.leave();
        return undefined;
    }

    if (toFunc instanceof ConstNode) {
        if (!toFunc.valueType.undef) {
            Utilities.warnOnce("cannot write to constant: " + toNode.toString().split("\n").join("\n// "));
        }
        gErrContext.leave();
        gErrContext.leave();
        return undefined;
    }
    gErrContext.leave();

    var mergeNode: PathTreeNode = node.next["merge"];
    gErrContext.enter(mergeNode, undefined);
    var mergeExpr: FunctionNode = buildFunctionNode(mergeNode, origin, 0, undefined);
    // The function node for writables should already have been created by
    // AreaTemplate.addWritables().

    if (mergeExpr === undefined || nopMerge(mergeExpr)) {
        gErrContext.leave();
        gErrContext.leave();
        return undefined;
    }

    // Make all writable nodes compatible with mergeExpr's value type. Works
    // only for storage nodes, unfortunately.
    for (var i: number = 0; i < wrNodes.length; i++) {
        if (wrNodes[i].functionNode instanceof StorageNode) {
            var stn = wrNodes[i].functionNode;
            var wrPath: string = stn.localToArea + ":" + stn.path.join(".");
            if (!(wrPath in appStateSources)) {
                appStateSources[wrPath] = {};
            }
            appStateSources[wrPath][node.id] = node;
            var possibleMergeValues = mergeExpr.valueUnderQualifier(wrNodes[i].qualifiers, []);
            stn.makeCompatible(addPathToType(possibleMergeValues.valueType, wrNodes[i].path));
            if (stn.valueType.isDataAndAreas()) {
                Utilities.warnOnce("both data and areas in app state: " +
                                   stn.path.join(".") + " @" + stn.localToArea +
                                   "from " + objValues(appStateSources[wrPath]).map(function(n: PathTreeNode): string {
                                       return getShortChildPath(n.getPath());
                                   }).join(" and "));
            }
        }
    }
    gErrContext.leave();
    gErrContext.leave();

    // So now we have an expression node that should lead to a writable node,
    // and the types of its initial value and the new value are the same, so
    // there's no conflict.
    return new ToMergeNode(toFunc, mergeExpr, wrNode);
}

function buildWriteNode(node: PathTreeNode, origin: number): WriteNode {
    var wrNode: WriteNode = undefined;

    gErrContext.enter(node, undefined);
    if ("upon" in node.next) {
        wrNode = new WriteNode();
        gErrContext.enter(node.next["upon"], undefined);
        wrNode.upon = buildFunctionNode(node.next["upon"], origin, 0, undefined);
        gErrContext.leave();
        if (wrNode.upon === undefined) {
            gErrContext.leave();
            return undefined;
        }
        for (var cond in node.next) {
            var condNode = node.next[cond];
            var condCase: {
                    continuePropagation: FunctionNode;
                    actions: {[name: string]: ToMergeNode};
                } = {actions: undefined, continuePropagation: undefined};
            if (cond === "true") {
                if (wrNode.whenBecomesTrue === undefined) {
                    wrNode.whenBecomesTrue = condCase;
                }
            } else if (cond === "false") {
                wrNode.whenBecomesFalse = condCase;
            } else if (cond === "continuePropagation") {
                // Backwards compatibility: moves continuePropagation directly
                // under the write hander name to true:
                if (Number(buildInfo.cdlRevision) < 6746) {
                    if (wrNode.whenBecomesTrue === undefined) {
                        wrNode.whenBecomesTrue = condCase;
                    }
                    wrNode.whenBecomesTrue.continuePropagation =
                        buildFunctionNode(condNode, origin, 0, undefined);
                } else {
                    Utilities.error("continuePropagation should be in true/false");
                }
                continue;
            } else {
                if (cond !== "upon") {
                    Utilities.syntaxError("upon condition nor true, nor false");
                }
                continue;
            }
            for (var name in condNode.next) {
                gErrContext.enter(condNode.next[name], undefined);
                if (name === "continuePropagation") {
                    condCase.continuePropagation = buildFunctionNode(condNode.next["continuePropagation"], origin, 0, undefined);
                } else {
                    // Action handler
                    var tmNode: ToMergeNode = buildToMergeNode(condNode.next[name], origin, wrNode);
                    if (tmNode !== undefined) {
                        if (condCase.actions === undefined) {
                            condCase.actions = {};
                        }
                        condCase.actions[name] = tmNode;
                    }
                }
                gErrContext.leave();
            }
        }
    }
    gErrContext.leave();
    return wrNode;
}
