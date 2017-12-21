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

/// <reference path="support/jsSyntaxTree.ts"/>

interface CompiledQueryInfo {
    // javascript code that matches the condition
    condition: JSExpression;

    // javascript code to get the result
    result?: JSExpression;

    // List of paths in query that are function arguments (in order).
    // If a query uses functions for selection, e.g. {a: [me], b: [plus, ...]},
    // argPaths contains the paths to the functions in the order in which the
    // variable args in the query expect them.
    argPaths?: any[][];

    // Object repesentation of the query where variable arguments are replaced
    // by a RuntimeArgument object.
    querySkeleton: any;

    // Associative structure mapping output to path in query object. For each
    // projection site in the query, this maps the place in the result to the
    // place in query. E.g., {a: {b: _}} has only a single result, so the
    // writePaths is ["a", "b"]. For {a: _, b: {c: _}}, there is a result with
    // two projection paths, and writePaths will be {a: ["a"], c: ["b", "c"]}.
    writePaths?: any;

    isSelection?: boolean;
    isProjection?: boolean;
    osReturn?: boolean;
}

class QueryProperties {
    argPaths: string[][];
    isSelection: boolean;
    isProjection: boolean;
}

module QueryCompiler {

// Some shortcuts for readability
// A variable a
function _var(a:string):JSVariable {return new JSVariable(a);}
// A subscript a[b]
function _sub(a:JSExpression, b:JSExpression):JSExpression {return new JSSubscript(a, b);}
// A return statement
function _return(v:JSExpression) {return new JSReturn(v);}
// A constant
function _c(v:any):JSExpression {return new JSConstant(v);}
// An if then else
function _if(a:JSSyntaxTree,b:JSSyntaxTree,c:JSSyntaxTree){return new JSIf(<JSExpression>a,b,c);}
// Negation
function _not(a:JSExpression){return new JSMonadicOperator("!", a);}
// field selection: a.b
function _dot(a:JSExpression,field:string){return new JSField(a,field);}
// Post operator, e.g. a++
function _post(op: string, a:JSExpression){return new JSPostOp(op, a);}
// Binary operator a op b
function _op(a:JSExpression,op: string,b:JSExpression):JSExpression{return new JSOperator(op, [a,b]);}
// expr instanceof Array?
function _instanceOfArray(expr:JSExpression) {return _op(expr, "instanceof", new JSType("Array"));}
// Ternary conditional expression: a? b: c
function _cond(a:JSExpression,b:JSExpression,c:JSExpression){return new JSCond(a,b,c);}
// A sequence of statement: a; b; c; ...
function _block(a:JSStatement[]){return new JSBlock(a);}
// A function call f(args)
function _call(f:JSExpression, args:JSExpression[]){return new JSFunctionCall(f, args);}
// Push onto an array: a.push(b)
function _push(a:JSExpression, b:JSExpression){return _call(_dot(a, "push"), [b]);}
// Concatenate to an array: a = a.concat(b)
function _concat(a:JSExpression, b:JSExpression){return _op(a, "=", _call(_dot(a, "concat"), [b]));}
// Declare variables: var a, b, c
function _declare(a:JSExpression[]){return new JSDeclaration(a);}
// expr === undefined?
function _isUndef(expr:JSExpression):JSExpression {return _op(expr, "===", _c(undefined));}
// expr !== undefined?
function _isDef(expr:JSExpression):JSExpression {return _op(expr, "!==", _c(undefined));}
// for loop: for (a; b; c) d
function _for(a:JSExpression,b:JSExpression,c:JSExpression,d:JSStatement) {return new JSForLoop(a,b,c,d);}
// for loop for array: for (var x = 0, l = array.length; x < l; x++) body
function _forArray(variable:JSExpression, array:JSExpression, body:JSStatement) {
    return _for(_declare([_op(variable, "=", _c(0)),
                          _op(_var("l"), "=", _dot(array, "length"))]),
                _op(variable, "<", _var("l")),
                _post("++", variable),
                body);
}
var _false = new JSFalse();
var _true = new JSTrue();

// Translates the matching part of a query to a javascript expression.
// Note that conditions with the same skeleton are mapped onto the same
// function.
function compileConditionCDL(q: Expression, value: JSExpression, path: string[], positive: boolean, argPath: any[], props: QueryProperties, queryDataType: ValueType): CompiledQueryInfo {
    if (path.length === 2) {
        Utilities.error("query too deep for current implementation");
    }
    var cond1: JSExpression;
    var skel: any;

    function getMinArg(args: Expression[]): any {
        var min = args[0].expression;

        for (var i: number = 1; i < args.length; i++) {
            if (args[i].expression < min) {
                min = args[i].expression;
            }
        }
        return min;
    }

    function getMaxArg(args: Expression[]): any {
        var max = args[0].expression;

        for (var i: number = 1; i < args.length; i++) {
            if (args[i].expression > max) {
                max = args[i].expression;
            }
        }
        return max;
    }

    switch (q.type) {
      case ExpressionType.range:
        var r = <ExpressionRange> q;
        props.isSelection = true;
        if ((r.arguments.every(function(a: Expression){return a instanceof ExpressionNumber;}) ||
               r.arguments.every(function(a: Expression){return a instanceof ExpressionString;})) &&
              !("range" in queryDataType || "anyData" in queryDataType)) {
            var min: any = getMinArg(r.arguments);
            var max: any = getMaxArg(r.arguments);
            cond1 = jsValueInRange(min, value, max, r.closedLower, r.closedUpper);
            skel = q.expression;
        } else {
            var cArg: JSExpression = _dot(_sub(_var("args"), _c(props.argPaths.length)), "comp");
            skel = new RuntimeArgument(props.argPaths.length);
            props.argPaths.push(argPath);
            cond1 = _call(
                _var("svir" + (r.closedLower? "c": "o") + (r.closedUpper? "c": "o")),
                [cArg, value]);
        }
        return { condition: positive? cond1: _not(cond1), querySkeleton: skel };
      case ExpressionType.orderedSet:
        var os = <ExpressionOrderedSet> q;
        var infos: CompiledQueryInfo[] = os.arguments.map((elt: Expression, index: number) => {
            return compileConditionCDL(elt, value, path, positive, argPath.concat([index]), props, queryDataType);
        }).filter(function (info: CompiledQueryInfo): boolean {
            // remove projections and superfluous true/false
            return !(info.condition === undefined ||
                     (positive? info.condition instanceof JSFalse: info.condition instanceof JSTrue));
        });
        // When empty, or one of the conditions corresponds to positive, return
        // a constant result; when singleton, return just the first; otherwise,
        // wrap conditions in || or && operators.
        return infos.length === 0? { condition: (positive? _false: _true), querySkeleton: !positive }:
            infos.some((info)=>{return positive? info.condition instanceof JSTrue: info.condition instanceof JSFalse;})? { condition: (positive? _true: _false), querySkeleton: positive }:
            infos.length === 1? infos[0]:
            {
                condition: new JSOperator(positive? "||": "&&", infos.map((info)=>{return info.condition;})),
                querySkeleton: new MoonOrderedSet(infos.map((info)=>{return info.querySkeleton;}))
            };
      case ExpressionType.negation:
        var n = <ExpressionNegation> q;
        var infos: CompiledQueryInfo[] = n.arguments.map((elt: Expression, index: number) => {
            return compileConditionCDL(elt, value, path, !positive, argPath.concat([index]), props, queryDataType);
        }).filter((info: CompiledQueryInfo) => {
            // remove projections and superfluous true/false
            return !(info.condition === undefined ||
                     (positive? info.condition instanceof JSFalse: info.condition instanceof JSTrue));
        });
        return n.arguments.length === 0? { condition: (positive? _true: _false), querySkeleton: positive }:
            infos.length === 0? { condition: (positive? _true: _false), querySkeleton: positive }:
            infos.some((info)=>{return positive? info.condition instanceof JSTrue: info.condition instanceof JSFalse;})? {condition: (positive? _false: _true), querySkeleton: !positive}:
            infos.length === 1? infos[0]:
            {
                condition: new JSOperator(positive? "&&": "||", infos.map((info)=>{return info.condition;})),
                querySkeleton: new Negation(infos.map((info)=>{return info.querySkeleton;}))
            };
      case ExpressionType.attributeValue:
        var av = <ExpressionAttributeValue> q;
        var conds: JSExpression[] = [];
        skel = {};
        for (var i: number = 0; i < av.attributes.length; i++) {
            var attr: string = av.attributes[i];
            var info = compileConditionCDL(av.arguments[i], _dot(value, attr), path.concat(attr), positive, argPath.concat(attr), props, queryDataType.getAttributeType(attr));
            if (positive && info.condition instanceof JSTrue) {
                conds.push(_isDef(_dot(value, attr)));
            } else if (!positive && info.condition instanceof JSFalse) {
                conds.push(_isUndef(_dot(value, attr)));
            } else if ((positive && info.condition instanceof JSFalse) ||
                       (!positive && info.condition instanceof JSTrue)) {
                return { condition: _false, querySkeleton: false };
            } else if (info.condition !== undefined) {
                conds.push(info.condition);
            }
            skel[attr] = info.querySkeleton;
        }
        return conds.length === 0? {condition: (positive? _true: _false), querySkeleton: positive }:
            {
                condition: conds.length === 1? conds[0]:
                    new JSOperator(positive? "&&": "||", conds),
                querySkeleton: skel
            };
      case ExpressionType.projector:
        return { condition: _true, querySkeleton: _ };
      case ExpressionType.string:
      case ExpressionType.number:
      case ExpressionType.null:
        props.isSelection = true;
        if (q.type === ExpressionType.string && q.expression in gParameterStack) {
            var cArg: JSExpression = _dot(_sub(_var("args"), _c(props.argPaths.length)),
                                          (path.length === 0? "testSingle": "testOS"));
            props.isSelection = true;
            props.argPaths.push(argPath);
            cond1 = _call(cArg, [value]);
            return { condition: positive? cond1: _not(cond1), querySkeleton: new RuntimeArgument(props.argPaths.length - 1) };
        }
        if (path.length === 0) {
            // If path length is 0, it's called with a top element from the
            // os, which can only be a simple value, a range or an object that
            // cannot match
            if ("range" in queryDataType || "anyData" in queryDataType) {
                // Can be a range
                cond1 = _op(_op(value, "===", _c(q.expression)),
                            "||",
                            _op(_op(value, "instanceof", new JSType("RangeValue")),
                                "&&",
                                _call(_dot(value, "match"), [_c(q.expression)])));
                return {
                    condition: positive? cond1: _not(cond1),
                    querySkeleton: q.expression
                };
            } else {
                return {
                    condition: _op(value, (positive? "===": "!=="), _c(q.expression)),
                    querySkeleton: q.expression
                };
            }
        } else if ("range" in queryDataType || "anyData" in queryDataType) {
            // Call generic comparison function
            return {
                condition: _call(_var(positive? "sveq": "svne"),
                                 [value, _c(q.expression)]),
                querySkeleton: q.expression
            };
        } else {
            // Do simple index check
            cond1 = _op(_isDef(value), "&&",
                        _op(_call(_dot(value, "indexOf"), [_c(q.expression)]),
                            "!==", _c(-1)));
            return {
                condition: positive? cond1: _not(cond1),
                querySkeleton: q.expression
            };
        }
      case ExpressionType.boolean:
        props.isSelection = true;
        return {
            condition: _call(_var(positive === q.expression? "isTrue": "isFalse"), [value]),
            querySkeleton: q.expression
        };
      case ExpressionType.functionApplication:
      case ExpressionType.query:
      case ExpressionType.subStringQuery:
        var cArg: JSExpression = _dot(_sub(_var("args"), _c(props.argPaths.length)),
                                      (path.length === 0? "testSingle": "testOS"));
        props.isSelection = true;
        props.argPaths.push(argPath);
        cond1 = _call(cArg, [value]);
        return {
            condition: positive? cond1: _not(cond1),
            querySkeleton: new RuntimeArgument(props.argPaths.length - 1)
        };
      case ExpressionType.domainShield:
        return compileConditionCDL((<DomainShield>q).shieldedExpression, value,
                                   path, positive, argPath, props, queryDataType);
      case ExpressionType.undefined:
        return { condition: _false, querySkeleton: q.expression };
      default:
        Utilities.warnOnce("compileConditionCDL: cannot match against " + ExpressionType[q.type]);
        return { condition: _false, querySkeleton: q.expression };
    }
}

function compileResultCDL(q: Expression, projectionPath: JSExpression, path: string[], props: {isSelection: boolean; isProjection: boolean;}): {code: JSExpression; osReturn: boolean; writePaths: any;} {
    switch (q.type) {
      case ExpressionType.projector:
        if (path.length !== 0) {
            props.isProjection = true;
        }
        return {
            code: projectionPath,
            osReturn: path.length > 0,
            writePaths: path
        };
      case ExpressionType.attributeValue:
        var av = <ExpressionAttributeValue> q;
        var condition: {code: JSExpression; osReturn: boolean; writePaths: any;} = undefined;
        var singleAttr: string;
        var nr = 0;
        for (var i: number = 0; i < av.attributes.length; i++) {
            var attr: string = av.attributes[i];
            var cond1: {code: JSExpression; osReturn: boolean; writePaths: any;} =
                compileResultCDL(av.arguments[i], new JSField(projectionPath, attr), path.concat(attr), props);
            if (cond1 !== undefined) {
                nr++;
                if (condition === undefined) {
                    condition = cond1;
                    singleAttr = attr;
                } else if (nr === 2) {
                    var wrps: any = {};
                    wrps[singleAttr] = condition.writePaths;
                    wrps[attr] = cond1.writePaths;
                    condition = {
                        code: new JSAttributeValue([singleAttr, attr], [condition.code, cond1.code]),
                        osReturn: false,
                        writePaths: wrps
                    };
                } else {
                    var avCC = <JSAttributeValue> condition.code;
                    avCC.attrs.push(attr);
                    avCC.children.push(cond1.code);
                    condition.writePaths[attr] = cond1.writePaths;
                }
            }
        }
        return condition;
      case ExpressionType.domainShield:
        return compileResultCDL((<DomainShield>q).shieldedExpression,
                                projectionPath, path, props);
      default:
        return undefined;
    }
}

// surround result with function q(o) { ... } to get executable code
function compileQuery(q: Expression, queryDataType: ValueType): CompiledQueryInfo {
    var props: QueryProperties = {
        argPaths: [],
        isProjection: false,
        isSelection: false
    };

    var substTarget = new JSSubstitutionTarget(0);
    var condition = compileConditionCDL(q, substTarget, [], true, [], props, queryDataType);
    var result = compileResultCDL(q, substTarget, [], props);

    return result === undefined? {
        condition: condition.condition, result: undefined,
        argPaths: props.argPaths, querySkeleton: condition.querySkeleton,
        writePaths: undefined, isSelection: props.isSelection,
        isProjection: false, osReturn: false
    }: {
        condition: condition.condition, result: result.code,
        argPaths: props.argPaths, querySkeleton: condition.querySkeleton,
        writePaths: result.writePaths, isSelection: props.isSelection,
        isProjection: props.isProjection, osReturn: result.osReturn
    };
}

// Too much trouble combining with compileQuery()
function compileQueryOnFN(q: FunctionNode, queryDataType: ValueType): CompiledQueryInfo {
    var props: QueryProperties = {
        argPaths: [],
        isProjection: false,
        isSelection: false
    };

    function compileCondition(q: FunctionNode, value: JSExpression, path: string[], argPath: any[], queryDataType: ValueType): CompiledQueryInfo {
        if (path.length === 2) {
            Utilities.error("query too deep for current implementation");
        }
        var cArg: JSExpression = new JSSubscript(new JSVariable("args"), new JSConstant(props.argPaths.length));

        function getMinArg(args: FunctionNode[]): any {
            var min = (<ConstNode>args[0]).value[0];

            for (var i: number = 1; i < args.length; i++) {
                if ((<ConstNode>args[i]).value[0] < min) {
                    min = (<ConstNode>args[i]).value[0];
                }
            }
            return min;
        }

        function getMaxArg(args: FunctionNode[]): any {
            var max = (<ConstNode>args[0]).value[0];

            for (var i: number = 1; i < args.length; i++) {
                if ((<ConstNode>args[i]).value[0] > max) {
                    max = (<ConstNode>args[i]).value[0];
                }
            }
            return max;
        }

        switch (q.type()) {
          case FunctionNodeType.const:
            var c = <ConstNode> q;
            var cval: CdlExpression = runtimeValueToCdlExpression(c.value);
            return compileConditionCDL(expressionStore.get(cval, undefined), value, path,
                                       true, argPath, props, queryDataType);
          case FunctionNodeType.range:
            var r = <RangeNode> q;
            // This is an argument, but it can be compiled
            if ((r.values.every(function(v: FunctionNode) {
                return v instanceof ConstNode && v.value instanceof Array &&
                    v.value.length === 1 && typeof(v.value[0]) === "number";
            }) || r.values.every(function(v: FunctionNode) {
                return v instanceof ConstNode && v.value instanceof Array &&
                       v.value.length === 1 && typeof(v.value[0]) === "string";
            })) &&
                  !("range" in queryDataType || "anyData" in queryDataType)) {
                var min: any = getMinArg(r.values);
                var max: any = getMaxArg(r.values);
                return {
                    condition: jsValueInRange(min, value, max, r.closedLower, r.closedUpper),
                    querySkeleton: new MoonRange([min, max], r.closedLower, r.closedUpper)
                };
            } else {
                props.isSelection = true;
                props.argPaths.push(argPath);
                return {
                    condition: _call(_var("svir" + (r.closedLower? "c": "o") + (r.closedUpper? "c": "o")),
                                     [_dot(cArg, "comp"), value]),
                    querySkeleton: new RuntimeArgument(props.argPaths.length - 1)
                };
            }
          case FunctionNodeType.av:
            if (path.length === 0) {
                var av = <AVFunctionNode> q;
                var conditions: JSExpression[] = [];
                var skel: any = {};
                for (var attr in av.attributes) {
                    cArg = new JSField(value, attr);
                    var info = compileCondition(av.attributes[attr], cArg, path.concat(attr), argPath.concat(attr), queryDataType.getAttributeType(attr));
                    if (info !== undefined && info.condition instanceof JSTrue) {
                        conditions.push(_isDef(cArg));
                        skel[attr] = info.querySkeleton;
                    } else if (info !== undefined) {
                        conditions.push(info.condition);
                        skel[attr] = info.querySkeleton;
                    }
                }
                return conditions.length === 0? {
                    condition: _true,
                    querySkeleton: {}
                }: conditions.length === 1? {
                    condition: conditions[0],
                    querySkeleton: skel
                }: {
                    condition: new JSOperator("&&", conditions),
                    querySkeleton: skel
                };
            }
            // Fall-through turns deeper av-structures into SimpleQuery
          default:
            assert(path.length !== 0, "Not all conditions are caught by canCompile");
            // Treat everything below top level, except constants, as a function
            // argument that match against the object.
            props.isSelection = true;
            props.argPaths.push(argPath);
            return {
                condition: _op(_isDef(cArg), "&&", _call(_dot(cArg, (path.length === 0? "testSingle": "testOS")), [value])),
                querySkeleton: new RuntimeArgument(props.argPaths.length - 1)
            };
        }
    }

    function compileResult(q: FunctionNode, projectionPath: JSExpression, path: string[]): {code: JSExpression; osReturn: boolean; writePaths: any;} {
        switch (q.type()) {
          case FunctionNodeType.const:
            var c = <ConstNode> q;
            var cval: CdlExpression = runtimeValueToCdlExpression(c.value);
            return compileResultCDL(expressionStore.get(cval, undefined), projectionPath,
                                    path, props);
          case FunctionNodeType.av:
            var condition: {code: JSExpression; osReturn: boolean; writePaths: any;} = undefined;
            var singleAttr: string;
            var nr = 0;
            var av = <AVFunctionNode> q;
            for (var attr in av.attributes) {
                var cond1 = compileResult(av.attributes[attr], new JSField(projectionPath, attr), path.concat(attr));
                if (cond1 !== undefined) {
                    nr++;
                    if (condition === undefined) {
                        condition = cond1;
                        singleAttr = attr;
                    } else if (nr === 2) {
                        var wrps: any = {};
                        wrps[singleAttr] = condition.writePaths;
                        wrps[attr] = cond1.writePaths;
                        condition = {
                            code: new JSAttributeValue([singleAttr, attr], [condition.code, cond1.code]),
                            osReturn: false,
                            writePaths: wrps
                        };
                    } else {
                        var avCC = <JSAttributeValue> condition.code;
                        avCC.attrs.push(attr);
                        avCC.children.push(cond1.code);
                        condition.writePaths[attr] = cond1.writePaths;
                    }
                }
            }
            return condition;
          default:
            return undefined;
        }
    }

    var substTarget = new JSSubstitutionTarget(0);
    var condition = compileCondition(q, substTarget, [], [], queryDataType);
    var result = compileResult(q, substTarget, []);

    return result === undefined? {
        condition: condition.condition, result: undefined,
        argPaths: props.argPaths, querySkeleton: condition.querySkeleton,
        writePaths: undefined, isSelection: props.isSelection,
        isProjection: false, osReturn: false
    }: {
        condition: condition.condition, result: result.code,
        argPaths: props.argPaths, querySkeleton: condition.querySkeleton,
        writePaths: result.writePaths, isSelection: props.isSelection,
        isProjection: props.isProjection, osReturn: result.osReturn
    };
}

// Returns the skeletal, canonical representation of a query if it can be
// compiled. Datatypes of the data to match are also included where
// necessary
function getQuerySkeleton(q: any, depth: number, cdl: boolean, queryDataType: ValueType): string {

    function dGetQuerySkeleton(dq: any): string {
        return getQuerySkeleton(dq, depth, cdl, queryDataType);
    }

    // Adds a type indication to the query skeleton because of the following
    // reason: when there is a match with a simple value, the compiled query can
    // use the regular equals operator, unless the data can be a range. So
    // queries that potentially match against a range must have a different
    // compilation than the others.
    function typeIndication(queryDataType: ValueType): string {
        if ("anyData" in queryDataType || "range" in queryDataType) {
            // Treat as a possible range
            return "=r";
        }
        if ("string" in queryDataType || "number" in queryDataType || "boolean" in queryDataType) {
            // Treat as simple type
            return "=s";
        }
        return "=s"; // other, which in principle cannot match, but treat as
                     // simple type for now
    }

    if (q === _) {
        return "_";
    }
    if (typeof(q) === "string" && q in gParameterStack) {
        return "$" + typeIndication(queryDataType);
    }
    if ((q instanceof Array && cdl) || (q instanceof FunctionApplicationNode && !cdl)) { // a function application
        return "$" + typeIndication(queryDataType);
    }
    assert(!(q instanceof FunctionNode), "each FunctionNode should get its own treatment");
    if (q instanceof Negation) {
        var sq: string[] = q.queries.map(dGetQuerySkeleton);
        return sq.indexOf(undefined) === -1? "n(" + sq.join(",") + ")": undefined;
    }
    if (q instanceof MoonRange && cdl) {
        var sq: string[] = q.os.map(dGetQuerySkeleton);
        return sq.indexOf(undefined) !== -1? undefined:
               "R" + (q.closedLower? "c": "o") + (q.closedUpper? "c": "o") +
               "(" + sq.join(",") + ")" + typeIndication(queryDataType);
    }
    if (q instanceof MoonSubstringQuery) {
        var sq: string[] = q.os.map(dGetQuerySkeleton);
        return "$" + typeIndication(queryDataType);
    }
    if ((q instanceof MoonOrderedSet && cdl) || (q instanceof Array && !cdl)) {
        var sq: string[] = q instanceof MoonOrderedSet? q.os.map(dGetQuerySkeleton): q.map(dGetQuerySkeleton);
        return sq.indexOf(undefined) !== -1? undefined:
            sq.length === 1? sq[0]: "o(" + sq.join(",") + ")";
    }
    if (q instanceof Object) {
        if (depth > 0) {
            // We only do depth 1; the rest must be interpreted for now.
            return undefined;
        }
        var str: string = "";
        var attrs: string[] = Object.keys(q).sort();
        for (var i: number = 0; i < attrs.length; i++) {
            var attr: string = attrs[i];
            var aq: string = getQuerySkeleton(q[attr], depth + 1, cdl, queryDataType.getAttributeType(attr));
            if (aq === undefined) {
                return undefined;
            }
            if (i !== 0) str += ",";
            str += attr + ":" + aq;
        }
        return "{" + str + "}";
    }
    return !isSimpleType(q)? undefined:
           safeJSONStringify(q) + typeIndication(queryDataType);
}

function getQuerySkeletonOnFN(q: FunctionNode, queryDataType: ValueType): string {
    if (q instanceof ConstNode) {
        var c = <ConstNode> q;
        return getQuerySkeleton(c.value, 0, false, queryDataType);
    }
    if (q instanceof AVFunctionNode) {
        var av = <AVFunctionNode> q;
        var str: string = "";
        var attrs: string[] = Object.keys(av.attributes).sort();
        for (var i: number = 0; i < attrs.length; i++) {
            var attr: string = attrs[i];
            if (i !== 0) str += ",";
            str += attr + ":$";
        }
        return "{" + str + "}";
    }
    if (q instanceof RangeNode) {
        return "R$" + (q.closedLower?"c":"o") + (q.closedUpper?"c":"o");
    }
    return undefined;
}

interface CompiledQueryCache {
    query: any;
    name: string;
    argPaths: any[][];
    writePaths: any;
    isSelection: boolean;
    isProjection: boolean;
}

var compiledQueryCache: {[querySkeleton: string]: CompiledQueryCache} = {};
var nrCompiledQueries = 0;

// Queries are identical if the perform the same selection and projection,
// modulo function applications (in selections). So {a: [f1, ...]} and
// {a: [f2, ...]} map to the same query, but {a: 1} to another (since we
// don't need an argument for 1, and can test directly).
// Testing on ranges and os'es is a bit conservative, but unlikely to
// generate way too many query functions.
function queryEqual(q1: any, q2: any, fnMode: boolean): boolean {
    if (q1 === _ || q2 === _) {
        return q1 === q2;
    }
    if (q1 instanceof NonAV) {
        return q1.isEqual(q2);
    } else if (q2 instanceof NonAV) {
        return false;
    }
    if (q1 instanceof Array || q1 instanceof FunctionNode) {
        return q2 instanceof Array || q2 instanceof FunctionNode;
    } else if (q2 instanceof Array || q2 instanceof FunctionNode) {
        return false;
    }
    if (q1 instanceof Object && q2 instanceof Object) {
        for (var attr in q1) {
            if (!(attr in q2) || !queryEqual(q1[attr], q2[attr], fnMode)) {
                return false;
            }
        }
        for (var attr in q2) {
            if (!(attr in q1)) {
                return false;
            }
        }
        return true;
    }
    return q1 === q2;
}

// Returns a javascript function that performs the query.
// q: the expression that forms the query (when fnQuery === undefined)
// fnQuery: the FunctionNode that forms the query
// First extracts the "query skeleton" from the query. The skeleton includes
// things like attributes, o(), etc., but omits certain arguments, so different
// queries can use the same javascript function.
// The query is translated into a condition and a result. The condition can be
// empty or always true, in which case every element is mapped onto the result.
// If the result is empty, the element itself is the output.
export function getCompiledQuery(q: any, origin: number, defun: number, fnQuery: FunctionNode, queryDataType: ValueType, origExpr: Expression): CompiledFunctionNode {
    var fnMode: boolean = fnQuery !== undefined;
    assert((!fnMode && q instanceof Expression) || (fnMode && q instanceof FunctionNode), "DEBUGGING!!!");
    var querySkeleton: string = fnMode?
        getQuerySkeletonOnFN(fnQuery, queryDataType):
        getQuerySkeleton(q.expression, 0, true, queryDataType);
    
    /* Generates something like
    function query_x(v: any, args: any[], allIds: any[], selectedIds: any[]): any {
        if (!(v instanceof Array)) {
            return <TEST(v)>? <RESULT>: undefined;
        } else {
            var res = constEmptyOS;
            if (selectedIds === undefined) {
                for (var i: number = 0; i !== v.length; i++) {
                    if (TEST(v[i])) {
                        res = res.concat(<RESULT>);
                    }
                }
            } else {
                for (var i: number = 0; i !== v.length; i++) {
                    if (TEST(v[i])) {
                        res = res.concat(<RESULT>);
                        selectedIds.push(allIds[i]);
                    }
                }
            }
            return res;
        }
    }
    There are some optimizations to avoid needless tests and use push instead
    of concat
    */

    function outputCompiledQuery(info: CompiledQueryInfo, query: any): void {
        var v: JSVariable = _var("v");
        var i: JSVariable = _var("i");
        var q: JSVariable = _var("q");
        var ql: JSVariable = _var("ql");
        var v_i: JSExpression = _sub(v, i);
        var res: JSVariable = _var("res");
        var selectedIds: JSVariable = _var("selectedIds");
        var result = info.result === undefined? new JSSubstitutionTarget(0): info.result;
        var condition = info.condition;
        var conditionAndResultIdentical: boolean = false;

        // When the condition includes result !== undefined, one test can be skipped
        if (condition instanceof JSOperator) {
            conditionAndResultIdentical = condition.operator === "!==" &&
                condition.children[0].isEqual(result) &&
                condition.children[1].isEqual(_c(undefined));
        }
        // Return statement when parameter v is not an array
        var nonArrayReturn: JSStatement =
            condition === undefined || condition instanceof JSTrue || conditionAndResultIdentical?
            _return(<JSExpression>result.substitute(0, v)):              // return <RESULT>
            _return(_cond(<JSExpression>info.condition.substitute(0, v), // return <TEST>? <RESULT>
                          <JSExpression>result.substitute(0, v),         //        <RESULT>:
                          _c(undefined))                                 //        undefined
                   );
        // A loop for iterating over v when it is an array.
        // The body contains a substitution target that is replaced by code
        // that doesn't need to deal with ids and code that does
        var genericLoop: JSStatement = 
            condition === undefined || condition instanceof JSTrue?
            _forArray(i, v, new JSSubstitutionTarget(1)):                // for (...) X();
            conditionAndResultIdentical?
            _forArray(i, v,                                              // for (...)
                      _block([                                           // {
                          _declare([_op(q, "=", result.substitute(0, v_i))]), // var q = <RESULT>
                          _if(_isDef(q),                                 //      if (q !== undefined)
                              new JSSubstitutionTarget(1),               //          X
                              undefined)
                      ])
                     ):
            _forArray(i, v,                                              // for (...)
                      _if(condition.substitute(0, v_i),                  //     if (<CONDITION>)
                          new JSSubstitutionTarget(1),                   //         X();
                          undefined)
                     );
        var addWithId: JSStatement =
            _block([_push(res, result.substitute(0, v_i)),              // res.push(<RESULT>);
                    _push(selectedIds, _sub(_var("allIds"), i))]);      // selectedIds.push(allids[i]);
        var idLoop: JSStatement =
            genericLoop.substitute(1, addWithId);
        var addWithoutId: JSStatement =
            !info.osReturn?
            _push(res, result.substitute(0, v_i)): // res.push(<RESULT>);
            conditionAndResultIdentical?
            _block([                                             // {
                    _declare([_op(ql, "=", _dot(q, "length"))]), //     var ql = q.length;
                    _if(_op(ql, "===", _c(1)),                   //     if (ql === 1)
                        _push(res, _sub(q, _c(0))),              //         res.push(q);
                        _if(_op(ql, ">", _c(1)),                 //     else if (ql > 1)
                            _concat(res, q),                     //         res = res.concat(q);
                            undefined                            // 
                           )                                     // 
                       )                                         // 
            ]):                                                  // }
            _block([
                _declare([_op(q, "=", result.substitute(0, v_i))]),  // var q = <RESULT>;
                _if(_isDef(q),                                       // if (q !== undefined)
                    _block([                                         // {
                        _declare([_op(ql, "=", _dot(q, "length"))]), //     var ql = q.length;
                        _if(_op(ql, "===", _c(1)),                   //     if (ql === 1)
                            _push(res, _sub(q, _c(0))),              //         res.push(q);
                            _if(_op(ql, ">", _c(1)),                 //     else if (ql > 1)
                                _concat(res, q),                     //         res = res.concat(q);
                                undefined                            // 
                               )                                     // 
                           )                                         // 
                    ]),                                              // }
                    undefined                                        //
                   )                                                 // 
            ]);
        var nonIdLoop: JSStatement =
            genericLoop.substitute(1, addWithoutId);
        var arrayReturn: JSStatement =
            info.isProjection? // NOTE: projections do not promote id
            _block([_declare([_op(res, "=", _c([]))]), // var res = [];
                    nonIdLoop,                         // nonIdLoop
                    _return(res)                       // return res;
                   ]):
            _block([_declare([_op(res, "=", _c([]))]), // var res = [];
                    _if(_isUndef(selectedIds),         // if (selectedIds === undefined)
                        nonIdLoop,                     //     nonIdLoop
                        idLoop                         // else
                       ),                              //     idLoop
                    _return(res)                       // return res;
                   ]);
        var fun: JSFunction = new JSFunction(
            name, "v, args, allIds, selectedIds",
            [condition instanceof JSFalse?
             _return(_c(undefined)):
             _if(_not(_instanceOfArray(v)),
                 nonArrayReturn,
                 arrayReturn
                )]);

        console.log(fun.toString("\n"));

        var queryStr: string = cdlify(info.querySkeleton);
        if (mode === "javascript" || mode === "js") {
            console.log(name + ".isProjection = " + String(info.isProjection));
            console.log(name + ".isSelection = " + String(info.isSelection));
            if (queryStr !== undefined) {
                console.log(name + ".queryStr = " + queryStr);
            }
        } else { // typescript work-around for properties on functions
            console.log("Object.defineProperty(" + name + ", \"isProjection\", {value: " + String(info.isProjection) + "})");
            console.log("Object.defineProperty(" + name + ", \"isSelection\", {value: " + String(info.isSelection) + "})");
            if (queryStr !== undefined) {
                console.log("Object.defineProperty(" + name + ", \"queryStr\", {value: " + queryStr + "})");
            }
        }
        console.log("");
    }

    function getPathFromQueryExpression(path: any[]): Expression {
        var ptr: Expression = q;

        for (var i: number = 0; i !== path.length; i++) {
            if (ptr instanceof ExpressionAttributeValue) {
                ptr = (<ExpressionAttributeValue>ptr).getAttribute(path[i]);
            } else if (ptr instanceof ExpressionWithArguments) {
                ptr = (<ExpressionWithArguments>ptr).arguments[path[i]];
            } else {
                ptr = undefined;
            }
            assert(ptr !== undefined, "something's wrong");
        }
        return ptr;
    }

    function getPathFromQueryFN(path: any[]): FunctionNode {
        var ptr: any = q;

        for (var i: number = 0; i !== path.length; i++) {
            if (ptr instanceof Negation) {
                ptr = ptr.queries[path[i]];
            } else if (ptr instanceof AVFunctionNode) {
                ptr = ptr.attributes[path[i]];
            } else {
                ptr = ptr[path[i]];
            }
            assert(ptr !== undefined, "something's wrong");
        }
        return ptr;
    }

    if (querySkeleton && querySkeleton !== "_") {
        var cached: CompiledQueryCache = compiledQueryCache[querySkeleton];
        var argPaths: any[][];
        var args: FunctionNode[] = [];
        var localToArea: number = undefined;
        var localToDefun: number = 0;
        var name: string;
        var writePaths: any;
        var isSelection: boolean;
        var isProjection: boolean;

        if (cached !== undefined) {
            argPaths = cached.argPaths;
            name = cached.name;
            writePaths = cached.writePaths;
            isSelection = cached.isSelection;
            isProjection = cached.isProjection;
        } else {
            try {
                var info: CompiledQueryInfo;
                if (!fnMode) {
                    info = compileQuery(q, queryDataType);
                } else {
                    try {
                        info = compileQueryOnFN(fnQuery, queryDataType);
                    } catch (e) {
                        return undefined;
                    }
                }
                nrCompiledQueries++;
                name = "query_" + nrCompiledQueries;
                compiledQueryCache[querySkeleton] = {
                    query: q,
                    name: name,
                    argPaths: info.argPaths,
                    writePaths: info.writePaths,
                    isSelection: info.isSelection,
                    isProjection: info.isProjection
                };
                outputCompiledQuery(info, q);
                argPaths = info.argPaths;
                writePaths = info.writePaths;
                isSelection = info.isSelection;
                isProjection = info.isProjection;
            } catch (e) {
                Utilities.error(e.toString() + ": " + JSON.stringify(q));
                return undefined;
            }
        }
        for (var i: number = 0; i !== argPaths.length; i++) {
            var fun: any = !fnMode? getPathFromQueryExpression(argPaths[i]):
                                    getPathFromQueryFN(argPaths[i]);
            var arg: FunctionNode;
            if (fnMode) {
                assert(fun instanceof FunctionNode, "debugging");
                arg = fun;
            } else if (fun instanceof ExpressionString &&
                       fun.expression in gParameterStack) {
                arg = gParameterStack[fun.expression];
            } else {
                assert(!(fun instanceof ExpressionConstant), "debugging");
                arg = buildSimpleFunctionNode(fun, undefined, origin,
                         defun, false, undefined, undefined, undefined, origin);
            }
            localToArea = mergeLocality(localToArea, arg.localToArea);
            localToDefun = mergeDefunLocality(localToDefun, arg.localToDefun);
            args.push(arg);
        }
        return new CompiledFunctionNode(name, undefined, args, writePaths,
                                        q, isSelection, isProjection,
                                        fnQuery, localToArea, localToDefun,
                                        origExpr);
    }
    return undefined;
}

}