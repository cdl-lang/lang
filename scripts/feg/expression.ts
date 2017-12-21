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
/// <reference path="queryCompiler.ts" />

/// Any Javascript expression is a CdlExpression
type CdlExpression = any;

enum ExpressionType {
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
    className,
    childExistence,
    undefined,
    false,
    null,
    domainShield,
    unknown
}

// Returns the (syntactic) type of a CDL expression
function getCdlExpressionType(e: CdlExpression): ExpressionType {
    function isQueryObject(e: CdlExpression): boolean {
        switch (getCdlExpressionType(e)) {
          case ExpressionType.attributeValue:
          case ExpressionType.negation:
          case ExpressionType.range:
          case ExpressionType.number:
          case ExpressionType.boolean:
            return true;
          case ExpressionType.string:
            return !(e in gParameterStack);
          case ExpressionType.orderedSet:
            return (<MoonOrderedSet>e).os.every(isQueryObject);
          default:
            return false;
        }
    }
    assert(!(e instanceof Expression), "DEBUGGING!!!");
    if (e instanceof Object) {
        return e instanceof BuiltInFunction? ExpressionType.builtInFunction:
               e instanceof ChildExistence? ExpressionType.childExistence:
               e instanceof ClassName? ExpressionType.className:
               e instanceof Negation? ExpressionType.negation:
               e instanceof Array?
                 (e.length === 0? ExpressionType.false:
                  (e.length === 1 || e.length === 2) && isQueryObject(e[0])?
                  ExpressionType.query: ExpressionType.functionApplication):
               e instanceof JavascriptFunction? ExpressionType.jsFunctionApplication:
               e instanceof MoonRange? ExpressionType.range:
               e instanceof MoonComparisonFunction? ExpressionType.comparisonFunction:
               e instanceof MoonSubstringQuery? ExpressionType.subStringQuery:
               e instanceof MoonOrderedSet? ExpressionType.orderedSet:
               e instanceof Projector? ExpressionType.projector:
               e instanceof TerminalSymbol? ExpressionType.terminalSymbol:
               e instanceof RegExp? ExpressionType.string:
               ExpressionType.attributeValue;
    } else {
        switch (typeof(e)) {
          case "string":
            return ExpressionType.string;
          case "number":
            return ExpressionType.number;
          case "boolean":
            return ExpressionType.boolean;
          case "object":
            return ExpressionType.null;
          case "undefined":
            return ExpressionType.undefined;
        }
    }
    Utilities.error("unknown expression type");
    return ExpressionType.unknown;
}

type ConstantContext = {[attribute: string]: Expression};
type ConstantContextStack = ConstantContext[];
type ParameterMapping = {[argName: string]: Expression};

/// An associative dictionary for a specific expression type. Used to map each
/// expression to a unique object with a unique id. Consequently, once an
/// expression has been compiled in a certain context (template id and defun
/// id), the compilation result can be reused in that context.
class ExpressionDict {
    get(e: Expression): Expression {
        Utilities.error("implement in derived class");
        return undefined;
    }

    store(e: Expression): void {
        Utilities.error("implement in derived class");
    }
}

class ExpressionDictSingleton {
    expression: Expression = undefined;

    get(e: Expression): Expression {
        return this.expression;
    }

    store(e: Expression): void {
        this.expression = e;
    }
}

class ExpressionDictBySimpleValue {
    valueToExpression: {[val: string]: Expression} = {};

    get(e: Expression): Expression {
        return this.valueToExpression[e.expression];
    }

    store(e: Expression): void {
        this.valueToExpression[e.expression] = e;
    }
}

class ExpressionDictByName {
    getName: (e: Expression) => string;
    nameToExpression: {[name: string]: Expression} = {};

    constructor(getName: (e: Expression) => string) {
        this.getName = getName;
    }

    get(e: Expression): Expression {
        var name = this.getName(e);

        return this.nameToExpression[name];
    }

    store(e: Expression): void {
        var name = this.getName(e);

        this.nameToExpression[name] = e;
    }
}

class ExpressionDictById {
    getId: (e: Expression) => number;
    idToExpression: Expression[] = [];

    constructor(getId: (e: Expression) => number) {
        this.getId = getId;
    }

    get(e: Expression): Expression {
        var id: number = this.getId(e);

        return this.idToExpression[id];
    }

    store(e: Expression): void {
        var id: number = this.getId(e);

        this.idToExpression[id] = e;
    }
}

class AssociativeTree<T> {
    terminator: T = undefined;
    next: {[id: string]: AssociativeTree<T>} = {};
}

/// Associates lists of expression arguments' ids with an expression
class ExpressionDictByArguments {
    assocTree: AssociativeTree<Expression> = new AssociativeTree<Expression>();

    get(e: Expression): Expression {
        var ea = <ExpressionWithArguments> e;
        var ptr = this.assocTree;

        for (var i: number = 0; i < ea.arguments.length; i++) {
            var id: number = ea.arguments[i].id;
            if (!(id in ptr.next)) {
                return undefined;
            }
            ptr = ptr.next[id];
        }
        return ptr.terminator;
    }

    store(e: Expression): void {
        var ea = <ExpressionWithArguments> e;
        var ptr = this.assocTree;

        for (var i: number = 0; i < ea.arguments.length; i++) {
            var id: number = ea.arguments[i].id;
            if (!(id in ptr.next)) {
                ptr = ptr.next[id] = new AssociativeTree<Expression>();
            } else {
                ptr = ptr.next[id];
            }
        }
        ptr.terminator = e;
    }
}

/// Has four dictionaries based on open/closedness of range boundaries
class ExpressionDictByRangeArguments {
    boundaryIndicators: ExpressionDictByArguments[] = [
        new ExpressionDictByArguments(), new ExpressionDictByArguments(),
        new ExpressionDictByArguments(), new ExpressionDictByArguments()
    ];

    get(e: Expression): Expression {
        var er = <ExpressionRange> e;
        var rangeArgIndex: number = (er.closedLower? 0: 2) + (er.closedUpper? 0: 1);

        return this.boundaryIndicators[rangeArgIndex].get(er);
    }

    store(e: Expression): void {
        var er = <ExpressionRange> e;
        var rangeArgIndex: number = (er.closedLower? 0: 2) + (er.closedUpper? 0: 1);

        this.boundaryIndicators[rangeArgIndex].store(er);
    }
}

/// First associates by attributes, then by arguments
class ExpressionDictByAttributesAndArguments {
    assocTree: AssociativeTree<ExpressionDictByArguments> = new AssociativeTree<ExpressionDictByArguments>();

    get(e: Expression): Expression {
        var ea = <ExpressionAttributeValue> e;
        var ptr = this.assocTree;

        for (var i: number = 0; i < ea.attributes.length; i++) {
            var id: string = ea.attributes[i];
            if (!(id in ptr.next)) {
                return undefined;
            }
            ptr = ptr.next[id];
        }
        return ptr.terminator === undefined? undefined: ptr.terminator.get(e);
    }

    store(e: Expression): void {
        var ea = <ExpressionAttributeValue> e;
        var ptr = this.assocTree;

        for (var i: number = 0; i < ea.attributes.length; i++) {
            var id: string = ea.attributes[i];
            if (!(id in ptr.next)) {
                ptr = ptr.next[id] = new AssociativeTree<ExpressionDictByArguments>();
            } else {
                ptr = ptr.next[id];
            }
        }
        if (ptr.terminator === undefined) {
            ptr.terminator = new ExpressionDictByArguments();
        }
        ptr.terminator.store(e);
    }
}

/// First associates by jsFunctionName, then by arguments
class ExpressionDictByJSFNameAndArguments {
    assocDict: {[name: string]: ExpressionDictByArguments} = {};

    get(e: Expression): Expression {
        var ea = <ExpressionJsFunctionApplication> e;

        if (ea.jsFunctionName in this.assocDict) {
            return this.assocDict[ea.jsFunctionName].get(e);
        } else {
            return undefined;
        }
    }

    store(e: Expression): void {
        var ea = <ExpressionJsFunctionApplication> e;

        if (!(ea.jsFunctionName in this.assocDict)) {
            this.assocDict[ea.jsFunctionName] = new ExpressionDictByArguments();
        }
        this.assocDict[ea.jsFunctionName].store(e);
    }
}

/// First associates by template id, then by shieldedExpression
class ExpressionDictByTemplateIdAndArgument {
    assocDict: {[templateId: number]: {[argumentId: number]: Expression}} = {};

    get(e: Expression): Expression {
        var ds = <DomainShield> e;

        if (ds.templateId in this.assocDict) {
            return this.assocDict[ds.templateId][ds.shieldedExpression.id];
        } else {
            return undefined;
        }
    }

    store(e: Expression): void {
        var ds = <DomainShield> e;

        if (!(ds.templateId in this.assocDict)) {
            this.assocDict[ds.templateId] = {};
        }
        this.assocDict[ds.templateId][ds.shieldedExpression.id] = ds;
    }
}

class QueryPath {
    path: string[];
    terminal: Expression;
    isProjection: boolean;
}

var gExprDebuggerBreak: {[id: number]: boolean} = {};

interface CDLFormattingOptions {
    indent?: string;
    indentFunction?: boolean;
    fillOut?: number;
}

abstract class Expression {
    static nextId: number = 1;

    expression: CdlExpression; // The original expression
    type: ExpressionType; // The type of the expression
    id: number; // The global id for this expression

    constructor(expression: CdlExpression, type: ExpressionType) {
        this.expression = expression;
        this.type = type;
        this.id = undefined;
    }

    // Returns a clone of the object without the arguments
    abstract cloneBase(): Expression;

    obtainId(): void {
        this.id = Expression.nextId++;
        if (this.id in gExprDebuggerBreak) {
            debugger;
        }
    }

    abstract isConstant(): boolean;

    isMoonConstant(): boolean {
        return false;
    }

    abstract isLocalityDependent(): boolean;

    // Is of form [defun, o(param1, param2, ...), body]?
    isDefun(): boolean {
        return false;
    }

    abstract isSimpleValue(): boolean;

    isConstEmptyOS(): boolean {
        return false;
    }

    getEmbeddingLevel(node: PathTreeNode): number {
        return undefined;
    }

    containsAttribute(attr: string): boolean {
        return false;
    }

    getConstantRuntimeValue(): any {
        Utilities.error("implement in derived class");
        return undefined;
    }

    // Prefixes a query with context if it doesn't reference context,
    // content, or param.
    normalizeQuery(): Expression {
        return this;
    }

    // Replaces known local attributes in the expression in value. There is no
    // attempt to look beyond [me]. Returns a new value when successful, or
    // the original value when not.
    propagateConstants(node: PathTreeNode, contextStack: ConstantContextStack): Expression {
        Utilities.error("implement in derived class for " + ExpressionType[this.type]);
        return undefined;
    }

    // Returns the attribute on which is projected if the object is of the form
    // {attr: _} or {context: {attr: _}}.
    contextProjectionAttribute(level: number): string {
        return undefined;
    }

    // Returns true when v is a moon value that is always true. Returns false
    // when v is a moon value that cannot be true, i.e. is false. Returns
    // undefined when it is unknown.
    isTrue(): boolean {
        return true; // almost everything is true
    }

    // Opposite of iTrue.
    isFalse(): boolean {
        var isTrue: boolean = this.isTrue();

        return isTrue === undefined? undefined: !isTrue;
    }

    isUnmergeable(): boolean {
        return false;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        Utilities.error("implement in derived class");
        return undefined;
    }

    // Returns the expression but with the parameters replaced. It returns
    // undefined when the replacement can't be made (in particular because
    // the expression cannot be resolved due to unknown area relations).
    abstract substituteParameters(parameterMapping: ParameterMapping, origin: number, lvlDiff: number, innerDefunParams: ParameterMapping): Expression;

    // Matches [f, x1, x2, ...]?
    isApplicationOf(f: BuiltInFunction): boolean {
        return false;
    }

    extractQueryPath(): QueryPath {
        return {path: [], terminal: this, isProjection: false};
    }

    getNrProjectionPaths(): number {
        return 0;
    }

    // Chops up query in separate paths. E.g. {a: {b: true, c: _, d: "x"}}
    // becomes boolMatch([a,b], true), project([a,c]), equals([a,d], "x").
    // TODO: {x: o({a: 3}, {b: 4})}
    extractQueryComponents(path: string[], positive: boolean, origin: number, defun: number): QueryComponent[] {
        return [new QueryComponentSelect(path, this, positive, undefined)];
    }

    // Returns this formatted as a cdl expression.
    // The parent caller is responsible for prefixing the output with the correct
    // indentation.
    abstract toCdlString(formattingOptions?: CDLFormattingOptions, indent?: string): string;

    checkForUndefined(pathInfo: PathInfo): void {
    }

    setDefunArgTypes(args: FunctionNode[]): void {
    }

    unshield(): Expression {
        return this;
    }
}

var gMeExpr: Expression;
var gRecipientMessageExpr: Expression;
var gProjectorExpr: Expression;
var gUndefinedExpr: Expression;
var gTrueExpr: Expression;
var gFalseExpr: Expression;
var gChildExistence: Expression;
var gEmptyOSExpr: Expression;
var gEmptyAVExpr: Expression;
var gDynamicAttributeFun: Expression;

abstract class ExpressionWithArguments extends Expression {
    arguments: Expression[]; // The arguments to the expression

    constructor(expression: CdlExpression, type: ExpressionType, args: Expression[]) {
        super(expression, type);
        this.arguments = args;
    }

    // Returns a clone of the object with new arguments, and updates the
    // expression accordingly.
    cloneWithNewArguments(args: Expression[], lvlDiff: number, origin: number): Expression {
        var expr = <ExpressionWithArguments> this.cloneBase();

        expr.arguments = args;
        expr.expression = this.replaceArgumentsInExpression();
        return expressionStore.store(expr);
    }

    replaceArgumentsInExpression(): CdlExpression {
        Utilities.error("implement in derived class for " + ExpressionType[this.type]);
        return undefined;
    }

    isSimpleValue(): boolean {
        return false;
    }

    isLocalityDependent(): boolean {
        return this.arguments.some(e => e.isLocalityDependent());
    }

    getConstantRuntimeValue(): any {
        Utilities.error("value is not constant");
        return undefined;
    }

    isConstant(): boolean {
        return this.arguments.every((a: Expression): boolean => {
            return a.isConstant();
        });
    }

    propagateConstants(node: PathTreeNode, contextStack: ConstantContextStack): Expression {
        var args: Expression[] = this.propagateConstantsArguments(node, contextStack);

        return args === this.arguments? this: this.cloneWithNewArguments(args, 0, 0);
    }

    propagateConstantsArguments(node: PathTreeNode, contextStack: ConstantContextStack): Expression[] {
        var nArgs: Expression[] = new Array(this.arguments.length);
        var change: boolean = false;

        for (var i: number = 0; i < this.arguments.length; i++) {
            nArgs[i] = this.arguments[i].propagateConstants(node, contextStack);
            if (nArgs[i] !== this.arguments[i]) {
                change = true;
            }
        }
        return change? nArgs: this.arguments;
    }

    substituteParameters(parameterMapping: ParameterMapping, origin: number, lvlDiff: number, innerDefunParams: ParameterMapping): Expression {
        var substArgs: Expression[] = [];

        for (var i: number = 0; i < this.arguments.length; i++) {
            var s: Expression = this.arguments[i].substituteParameters(
                           parameterMapping, origin, lvlDiff, innerDefunParams);
            if (s === undefined) {
                return undefined;
            }
            substArgs.push(s);
        }
        return this.cloneWithNewArguments(substArgs, lvlDiff, origin);
    }

    checkForUndefined(pathInfo: PathInfo): void {
        for (var i: number = 0; i < this.arguments.length; i++) {
            this.arguments[i].checkForUndefined(pathInfo);
        }
    }

    toArgCdlString(prefix: string, suffix: string,
                   formattingOptions: CDLFormattingOptions|undefined,
                   indent: string): string
    {
        var str: string;

        if (formattingOptions === undefined ||
              formattingOptions.indent === undefined ||
              formattingOptions.fillOut !== undefined) {
            str = prefix + this.arguments.map((e: Expression): string => {
                    return e.toCdlString();
                }).join(", ") + suffix;
            if (formattingOptions === undefined ||
                  formattingOptions.indent === undefined ||
                  (formattingOptions.indent !== undefined &&
                   (formattingOptions.fillOut === undefined ||
                    indent.length + str.length <= formattingOptions.fillOut))) {
                return str;
            }
        }
        var nIndent: string = indent + formattingOptions.indent;
        str = prefix;
        for (var i: number = 0; i < this.arguments.length; i++) {
            if (!formattingOptions.indentFunction) {
                str += this.arguments[i].toCdlString(formattingOptions, indent);
                if (i < this.arguments.length - 1) {
                    str += ", ";
                }
            } else {
                str += "\n" + nIndent +
                    this.arguments[i].toCdlString(formattingOptions, nIndent);
                if (i < this.arguments.length - 1) {
                    str += ",";
                }
            }
        }
        str += formattingOptions.indentFunction? "\n" + indent + suffix: suffix;
        return str;
    }
}

abstract class ExpressionConstant extends Expression {
    constructor(expression: CdlExpression, type: ExpressionType) {
        super(expression, type);
    }

    isConstant(): boolean {
        return true;
    }

    isLocalityDependent(): boolean {
        return false;
    }

    getConstantRuntimeValue(): any {
        return this.expression;
    }

    propagateConstants(node: PathTreeNode, contextStack: ConstantContextStack): Expression {
        return this;
    }

    substituteParameters(parameterMapping: ParameterMapping, origin: number, lvlDiff: number, innerDefunParams: ParameterMapping): Expression {
        return this;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        return buildConstNode(this.expression, true, suppressSet, defun, this);
    }
}

class ExpressionBuiltInFunction extends ExpressionConstant {
    name: string;

    constructor(expression: BuiltInFunction) {
        super(expression, ExpressionType.builtInFunction);
        this.name = expression.name;
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictByName(function (e: ExpressionBuiltInFunction): string {
            return e.name;
        });
    }

    isSimpleValue(): boolean {
        return false;
    }

    isUnmergeable(): boolean {
        return true;
    }

    cloneBase(): Expression {
        var expr = new ExpressionBuiltInFunction(this.expression);

        expr.name = this.name;
        return expr;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        Utilities.error("cannot build function node for built-in function (no brackets around " + this.name + "?)");
        return undefined;
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent?: string): string {
        return this.name;
    }
}

class ExpressionAttributeValue extends ExpressionWithArguments {
    attributes: string[]; // The sorted list of attributes of the arguments

    constructor(expression: {[attr: string]: CdlExpression}, args: Expression[], attributes: string[]) {
        super(expression, ExpressionType.attributeValue, args);
        this.attributes = attributes;
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictByAttributesAndArguments();
    }

    cloneBase(): Expression {
        return new ExpressionAttributeValue(this.expression, undefined, this.attributes);
    }

    replaceArgumentsInExpression(): CdlExpression {
        var cdlExpr: CdlExpression = {};

        for (var i: number = 0; i < this.attributes.length; i++) {
            cdlExpr[this.attributes[i]] = this.arguments[i].expression;
        }
        return cdlExpr;
    }

    isMoonConstant(): boolean {
        return this.arguments.every(e => e.isMoonConstant());
    }

    getConstantRuntimeValue(): any {
        var val: any = {};

        for (var i: number = 0; i < this.attributes.length; i++) {
            val[this.attributes[i]] = this.arguments[i].getConstantRuntimeValue();
        }
        return val;
    }

    containsAttribute(attr: string): boolean {
        return attr in this.expression;
    }

    getAttribute(attr: string): Expression {
        var i: number = this.attributes.indexOf(attr);

        return i >= 0? this.arguments[i]: undefined;
    }

    contextProjectionAttribute(level: number): string {
        if (this.attributes.length !== 1) {
            return undefined;
        }
        var attr: string = this.attributes[0];
        if (level === 0) {
            switch (attr) {
              case "content": case "param": case "children":
                return undefined;
              case "context":
                return this.arguments[0].contextProjectionAttribute(1);
            }
        }
        return this.arguments[0].type === ExpressionType.projector? attr: undefined;
    }

    normalizeQuery(): Expression {
        for (var i: number = 0; i < this.attributes.length; i++) {
            var attr: string = this.attributes[i];
            if (attr in {children: 1, context: 1, content: 1, param: 1, class: 1}) {
                return this;
            }
        }
        return expressionStore.store(new ExpressionAttributeValue(
            {context: this.expression}, [this], ["context"]));
    }

    substituteParameters(parameterMapping: ParameterMapping, origin: number, lvlDiff: number, innerDefunParams: ParameterMapping): Expression {
        var nArgs: Expression[] = [];
        var nAttrs: string[] = [];
        var subst: Expression;
        var dynamicAttributes: number[];

        for (var i: number = 0; i < this.attributes.length; i++) {
            var attr: string = this.attributes[i];
            var arg: Expression = this.arguments[i];
            var subst: Expression = arg.substituteParameters(parameterMapping, origin, lvlDiff, innerDefunParams);
            if (subst === undefined) {
                return undefined;
            }
            if (attr.charAt(0) === "#") {
                var rAttr: string = attr.substr(1);
                if (rAttr in parameterMapping && !(rAttr in innerDefunParams)) {
                    var map: Expression = parameterMapping[rAttr].unshield();
                    if (map instanceof ExpressionSimpleValue &&
                        !(map.expression in gParameterStack)) {
                        nAttrs.push(map.expression);
                        nArgs.push(subst);
                    } else {
                        if (dynamicAttributes === undefined) {
                            dynamicAttributes = [];
                        }
                        dynamicAttributes.push(i);
                    }
                } else {
                    // #attr, but attr not a known parameter
                    nAttrs.push(attr);
                    nArgs.push(subst);
                    if (!(rAttr in innerDefunParams)) {
                        Utilities.warnOnce(attr + " not in defun parameters");
                    }
                }
            } else {
                nAttrs.push(attr);
                nArgs.push(subst);
            }
        }
        var av: ExpressionAttributeValue = new ExpressionAttributeValue(undefined, nArgs, nAttrs);
        av.expression = av.replaceArgumentsInExpression();
        var dynExpr: Expression = expressionStore.store(av);
        if (dynamicAttributes !== undefined) {
            for (var i: number = 0; i < dynamicAttributes.length; i++) {
                var attr: string = this.attributes[dynamicAttributes[i]];
                var arg: Expression = this.arguments[dynamicAttributes[i]];
                var rAttr: string = attr.substr(1);
                var attrExpr: Expression = parameterMapping[rAttr];
                var attrVal: Expression =
                    arg.substituteParameters(parameterMapping, origin, lvlDiff, innerDefunParams);
                dynExpr = expressionStore.store(new ExpressionFunctionApplication(
                    [dynamicAttribute, attrExpr.expression,
                                       attrVal.expression, dynExpr.expression],
                    ExpressionType.functionApplication,
                    [gDynamicAttributeFun, attrExpr, attrVal, dynExpr]));
            }
        }
        return dynExpr;
    }

    extractQueryPath(): QueryPath {
        var qp: QueryPath = undefined;

        if (this.attributes.length === 1) {
            qp = this.arguments[0].extractQueryPath();
            if (qp !== undefined) {
                qp.path = [this.attributes[0]].concat(qp.path);
            }
        }
        return qp;
    }

    getNrProjectionPaths(): number {
        var nr: number = 0;

        for (var i: number = 0; i < this.attributes.length; i++) {
            nr += this.arguments[i].getNrProjectionPaths();
        }
        return nr;
    }

    extractQueryComponents(path: string[], positive: boolean, origin: number, defun: number): QueryComponent[] {
        var qComps: QueryComponent[] = [];
        var nrProjections: number = 0;

        for (var i: number = 0; i < this.attributes.length; i++) {
            var attr: string = this.attributes[i];
            var arg: Expression = this.arguments[i];
            if (arg instanceof ExpressionProjector) {
                nrProjections++;
            }
            qComps = qComps.concat(arg.extractQueryComponents(path.concat([attr]), positive, origin, defun));
        }
        if (nrProjections > 1) {
            for (var j = 0; j < qComps.length; j++) {
                var qComp = qComps[j];
                if (qComp instanceof QueryComponentProject) {
                    qComp.destination = qComp.path;
                }
            }
        }
        return qComps;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        var attributes: {[attribute: string]: FunctionNode} = {};
        var nrDefinedAttributes: number = 0;
        var localToArea: number = undefined;
        var localToDefun: number = 0;
        var allConst: boolean = true;
        var wontChangeValue: boolean = true;
        var suppressSetAttr: {[attr: string]: boolean} = {};
        var paramAttr: string;
        var paramAttrMap: { attr: FunctionNode; fun: FunctionNode}[];

        function valueIsUndefined(fn: FunctionNode): boolean {
            if (fn instanceof ConstNode) {
                var cn = <ConstNode> fn;
                return cn.value === undefined;
            }
            return false;
        }

        for (var i: number = 0; i < this.attributes.length; i++) {
            var attr: string = this.attributes[i];
            var fun: FunctionNode;
            if (this.arguments[i] === undefined) {
                Utilities.syntaxError("undefined value for attribute '" + attr + "'");
                fun = undefined;
            } else {
                fun = buildSimpleFunctionNode(this.arguments[i], undefined, origin, defun, suppressSet, undefined, undefined, undefined, context);
                if (valueIsUndefined(fun)) {
                    fun = buildConstNode([], false, undefined, 0, gEmptyOSExpr);
                }
            }
            if (fun !== undefined) {
                var constantAttributeName: string = attr;
                if (attr.charAt(0) === "#" &&
                      (paramAttr = attr.substr(1)) in gParameterStack) {
                    var attrFun: FunctionNode = gParameterStack[paramAttr];
                    constantAttributeName = undefined;
                    if (attrFun instanceof ConstNode) {
                        if (attrFun.value instanceof Array &&
                            attrFun.value.length === 1 &&
                            typeof(attrFun.value[0]) === "string") {
                            constantAttributeName = attrFun.value[0];
                        } else if (typeof(attrFun.value) === "string") {
                            constantAttributeName = attrFun.value;
                        }
                    }
                }
                if (constantAttributeName === undefined) {
                    if (paramAttrMap === undefined) {
                        paramAttrMap = [];
                    }
                    paramAttrMap.push({
                        attr: gParameterStack[paramAttr],
                        fun: fun
                    });
                } else {
                    nrDefinedAttributes++;
                    if (fun instanceof ConstNode) {
                        wontChangeValue = wontChangeValue && (<ConstNode>fun).wontChangeValue;
                    } else {
                        allConst = false;
                        if (suppressSet && !(fun instanceof AVFunctionNode)) {
                            // fun doesn't know about suppressSet, so we register it here
                            suppressSetAttr[constantAttributeName] = false;
                        } else if (fun instanceof VariantFunctionNode) {
                            // Prevent EvaluationAV from deleting the attribute
                            // in {attr: [<query>]} when the query potentially
                            // returns undefined by turning it into {attr:o()}.
                            fun = new OrderedSetNode([fun], fun.localToArea,
                                 fun.localToDefun, fun.valueType, fun.origExpr, true);
                        }
                    }
                    attributes[constantAttributeName] = fun;
                }
                localToArea = mergeLocality(localToArea, fun.localToArea);
                localToDefun = mergeDefunLocality(localToDefun, fun.localToDefun);
            }
        }
        var avFun: FunctionNode;
        if (nrDefinedAttributes === 0) {
            avFun = suppressSet? buildConstNode({}, false, undefined, 0, gEmptyAVExpr):
                         buildConstNode([{}], false, undefined, 0, gEmptyAVExpr);
        } else {
            avFun = AVFunctionNode.buildAV(
                attributes, localToArea, localToDefun, allConst,
                wontChangeValue, suppressSet, suppressSetAttr, this);
        }
        if (paramAttrMap !== undefined) {
            for (var i: number = 0; i < paramAttrMap.length; i++) {
                localToArea = mergeLocality(localToArea, paramAttrMap[i].attr.localToArea);
                localToDefun = mergeDefunLocality(localToDefun, paramAttrMap[i].attr.localToDefun);
                localToArea = mergeLocality(localToArea, paramAttrMap[i].fun.localToArea);
                localToDefun = mergeDefunLocality(localToDefun, paramAttrMap[i].fun.localToDefun);
                avFun = FunctionApplicationNode.buildDynamicAttribute(
                    [paramAttrMap[i].attr, paramAttrMap[i].fun, avFun],
                    localToArea, localToDefun, origin, this);
            }
            avFun.origExpr = this;
        }
        return avFun;
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        var str: string;

        function quoteAttr(attr: string): string {
            return /^[a-zA-Z_$][a-zA-Z_$0-9]*$/.test(attr)? attr: '"' + attr + '"';
        }

        if (formattingOptions === undefined ||
              formattingOptions.indent === undefined ||
              formattingOptions.fillOut !== undefined) {
            str = "";
            for (var i: number = 0; i < this.attributes.length; i++) {
                if (i > 0)
                    str += ", ";
                str += quoteAttr(this.attributes[i]) + ": " + this.arguments[i].toCdlString();
            }
            if (formattingOptions === undefined ||
                  formattingOptions.indent === undefined ||
                  (formattingOptions.indent !== undefined &&
                   (formattingOptions.fillOut === undefined ||
                    indent.length + str.length + 2 <= formattingOptions.fillOut))) {
                return "{" + str + "}";
            }
        }
        var nIndent: string = indent + formattingOptions.indent;
        str = "{";
        for (var i: number = 0; i < this.attributes.length; i++) {
            str += "\n" + nIndent + quoteAttr(this.attributes[i]) + ": " +
                   this.arguments[i].toCdlString(formattingOptions, nIndent);
            if (i < this.attributes.length - 1) {
                str += ",";
            }
        }
        str += "\n" + indent + "}";
        return str;
    }
}

var unmergeableBuiltInFunctions: {[funName: string]: boolean} = {
	"plus":                          true,
	"minus":                         true,
	"mul":                           true,
	"div":                           true,
	"pow":                           true,
	"mod":                           true,
	"remainder":                     true,
	"and":                           true,
	"ln":                            true,
	"log10":                         true,
	"logb":                          true,
	"exp":                           true,
	"or":                            true,
	"not":                           true,
	"offset":                        true,
	"lessThan":                      true,
	"lessThanOrEqual":               true,
	"equal":                         true,
	"notEqual":                      true,
	"greaterThanOrEqual":            true,
	"greaterThan":                   true,
	"intersection":                  true,
	"index":                         true,
	"concatStr":                     true,
	"subStr":                        true,
	"bool":                          true,
	"notEmpty":                      true,
	"empty":                         true,
	"sum":                           true,
	"min":                           true,
	"max":                           true,
	"me":                            true,
	"embedded":                      true,
	"embeddedStar":                  true,
	"embedding":                     true,
	"embeddingStar":                 true,
	"expressionOf":                  true,
	"referredOf":                    true,
	"intersectionParentOf":          true,
	"debugNodeToStr":                true,
	"size":                          true,
	"pointer":                       true,
	"sequence":                      true,
	"areaOfClass":                   true,
	"allAreas":                      true,
	"overlap":                       true,
	"time":                          true,
	"changed":                       true,
	"displayWidth":                  true,
	"displayHeight":                 true,
	"dateToNum":                     true,
	"numToDate":                     true,
	"stringToNumber":                true,
	"areasUnderPointer":             true,
	"classOfArea":                   true,
	"debugBreak":                    true,
	"defun":                         true,
	"internalPush":                  true,
	"internalAtomic":                true,
	"compareAreasQuery":             true,
	"nCompareAreasQuery":            true,
	"internalFilterAreaByClass":     true,
	"internalFilterAreaByClassName": true,
	"floor":                         true,
	"ceil":                          true,
	"round":                         true,
	"abs":                           true,
	"sqrt":                          true,
	"sign":                          true,
	"uminus":                        true,
	"evaluateFormula":               true,
	"testFormula":                   true,
};

class ExpressionFunctionApplication extends ExpressionWithArguments {
    defunArgTypes: ValueType[];

    constructor(expression: CdlExpression, type: ExpressionType, args: Expression[]) {
        super(expression, type, args);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictByArguments();
    }

    cloneBase(): Expression {
        return new ExpressionFunctionApplication(this.expression, this.type, undefined);
    }

    cloneWithNewArguments(args: Expression[], lvlDiff: number, origin: number): Expression {
        var clone: Expression = super.cloneWithNewArguments(args, lvlDiff, origin);
        var template: AreaTemplate = areaTemplates[origin];

        if (lvlDiff > 0 && this.arguments.length === 1 && this.isLocalityDependent()) {
            // Implicit reference to area, e.g. [me] or [embedding] has to be
            // leveled up.
            for (var i: number = 0; i !== lvlDiff; i++) {
                var parentRefFun: BuiltInFunction =
                    template.embeddingInReferred? expressionOf: embedding;
                var parentRefExpr: Expression = expressionStore.store(
                    new ExpressionBuiltInFunction(parentRefFun));
                clone = expressionStore.store(
                    new ExpressionFunctionApplication(
                        [parentRefFun, clone.expression], this.type,
                        [parentRefExpr].concat(clone)
                    )
                );
                template = template.parent;
            }
        }
        return clone;
    }

    replaceArgumentsInExpression(): CdlExpression {
        return this.arguments.map(e => e.expression);
    }

    isDefun(): boolean {
        return this.arguments.length === 3 &&
               this.arguments[0].expression === defun &&
               (this.arguments[1] instanceof ExpressionOrderedSet ||
                this.arguments[1] instanceof ExpressionString
               );
    }

    isUsing(): boolean {
        return this.arguments.length >= 2 && this.arguments.length % 2 === 0 &&
               this.arguments[0].expression === using;
    }

    isUnmergeable(): boolean {
        return this.arguments.length === 0 ||
               (this.arguments[0] instanceof ExpressionBuiltInFunction &&
                unmergeableBuiltInFunctions[(<ExpressionBuiltInFunction>this.arguments[0]).name]);
    }

    isLocalityDependent(): boolean {
        if (this.arguments[0] instanceof ExpressionBuiltInFunction) {
            var funDef = <BuiltInFunction> this.arguments[0].expression;
            if ((funDef.isLocalWithoutArguments && this.arguments.length === 1) ||
                (funDef.dependingOnImplicitArguments &&
                 getLocalToAreaOfBuiltInFunction(funDef, 1) !== undefined)) {
                return true;
            }
        }
        return super.isLocalityDependent();
    }

    propagateConstants(node: PathTreeNode, contextStack: ConstantContextStack): Expression {
        return this.isDefun()? this: super.propagateConstants(node, contextStack);
    }

    getEmbeddingLevel(node: PathTreeNode): number {
        var f: Expression = this.arguments[0];

        if (f.expression === me) {
            return 0;
        }
        if (node.area.parent !== undefined &&
              ((f.expression === embedding && !node.area.explicitEmbedding()) ||
               (f.expression === expressionOf && node.area.isIntersection()))) {
            if (this.arguments.length === 2) {
                var nextLevel: number = this.arguments[1].getEmbeddingLevel(node.area.parent.area);
                return nextLevel !== undefined? nextLevel + 1: undefined;
            } else {
                return 1;
            }
        } else {
            return undefined;
        }
    }

    isTrue(): boolean {
        return undefined; // we don't know
    }

    isMoonConstant(): boolean {
        return this.isDefun(); // && !this.arguments[1].isLocalityDependent();
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        var funDef: BuiltInFunction;
        var functionArguments: FunctionNode[] = [];
        var localToArea: number = undefined;
        var localToDefun: number = 0;
        var v1F: FunctionNode = undefined;
        var c: ConstNode;
        var qValueType: ValueType;
        var rewrite: Expression;
        var boolArgs: boolean = false;

        if (this.arguments[0] instanceof ExpressionBuiltInFunction) {
            funDef = <BuiltInFunction> this.arguments[0].expression;
            if (!(funDef.minNrArguments <= this.arguments.length - 1 &&
                  this.arguments.length - 1 <= funDef.maxNrArguments)) {
                Utilities.syntaxError(String(this.arguments.length - 1) + " arguments to " + funDef.name);
            }
            // First check special functions
            switch (funDef.name) {
              case "cond":
                return this.buildCondNode(origin, defun);
              case "defun":
                assert(origin === context, "origin and context should be identical for 'defun'");
                return this.buildDefunNode(origin, defun);
              case "using":
                Utilities.syntaxError("improper using syntax");
                return undefined;
              case "classOfArea":
                return this.buildClassOfArea(origin, defun);
              case "message":
                return globalMessageNode;
              case "myMessage":
                return areaTemplates[origin].functionNodes[areaMessageIndex];
              case "debugBreak":
              case "areasUnderPointer":
              case "globalDefaults":
                return buildDynamicGlobalFunctionNode([funDef.name]);
              case "foreignFunctions":
                return new FunctionApplicationNode(foreignFunctions, [], undefined, 0, anyDataValueType.copy(), undefined);
              case "and": case "or": case "not":
                boolArgs = true;
                break;
            }
            if (funDef.isLocalWithoutArguments && this.arguments.length === 1) {
                localToArea = origin;
                if (localToArea === undefined) {
                    Utilities.error("there is no area context for " + funDef.name);
                }
            } else if (funDef.dependingOnImplicitArguments) {
                localToArea = getLocalToAreaOfBuiltInFunction(funDef, origin);
            }
        } else {
            var fun: FunctionNode;
            if (this.arguments[0].isDefun()) {
                var defunExpr = <ExpressionFunctionApplication> this.arguments[0];
                rewrite = rewriteDefun(defunExpr, origin, this.arguments.slice(1), origin);
                if (rewrite !== undefined) {
                    fun = buildSimpleFunctionNode(rewrite, undefined, origin, defun, undefined, undefined, undefined, undefined, context);
                    if (fun !== undefined) {
                        fun.rewrite = rewrite;
                    }
                    return fun;
                }
            }
            if (this.isClassOfAreaQuery()) {
                fun = this.buildClassOfAreaQuery(origin, defun);
                if (fun !== undefined) {
                    return fun;
                }
            }
            fun = buildSimpleFunctionNode(this.arguments[0], undefined, origin, defun,
                                          undefined, undefined, undefined, undefined, context);
            if (fun === undefined) {
                return undefined; // The function or query doesn't exist
            }
            if (fun instanceof DefunNode) {
                rewrite = rewriteDefun(fun.orig, fun.localToArea,
                                       this.arguments.slice(1), origin);
                if (rewrite !== undefined) {
                    var rwfn = buildSimpleFunctionNode(rewrite, undefined, origin,
                         defun, undefined, undefined, undefined, this, context);
                    if (rwfn !== undefined) {
                        rwfn.rewrite = rewrite;
                        return rwfn;
                    }
                }
            } else if (fun instanceof VariantFunctionNode &&
                       getLevelDifference(origin, fun.localToArea, true) >= 0 &&
                       fun.functionNodes.every(e => e instanceof DefunNode)) {
                var rwfn = rewriteAndQualify(fun, this.arguments.slice(1),
                                                origin, defun, this, context);
                if (rwfn !== undefined) {
                    return rwfn;
                }
            }
            if (fun instanceof ConstNode && this.arguments.length === 2) {
                c = <ConstNode> fun;
                if (c.value === undefined) {
                    // Query cannot be resolved; there's probably a warning
                    return buildConstNode([], c.wontChangeValue, undefined, 0, gEmptyOSExpr);
                }
                var data = buildSimpleFunctionNode(
                    this.arguments[1], undefined, origin, defun, undefined,
                    undefined, undefined, undefined, context);
                if (data === undefined || data.isEmptyOS() ||
                    (fun.valueType.unknown && data.valueType.unknown)) {
                    return buildConstNode([], inputsWontChangeValue([data]), undefined, 0, gEmptyOSExpr);
                }
                if (data.valueType.isNotData()) {
                    if (data.valueType.areas !== undefined &&
                          isSimpleValueQuery(c.value)) {
                        // If the query is a constant or _, the compiled or
                        // interpreted query will yield o() or the input set
                        return isProjector(c.value)? data:
                            buildConstNode([], false, undefined, 0, gEmptyOSExpr);
                    } else if (data.valueType.areas !== undefined &&
                               isConstantQuery(c.value)) {
                        var query = normalizeValueQuery(
                            stripArray(c.value, true), true);
                        return buildAreaQuery(query, data, origin, defun, this, context, true);
                    } else {
                        Utilities.error("cannot run query " +
                                        convertValueToString(c.value, undefined) +
                                        " on non-data: " + origin + " " +
                                        JSON.stringify(this.arguments[0]) + " " +
                                        data.toString());
                    }
                }
                var query: Expression = normalizeValueQuery(c.value, false);
                if (this.arguments.length === 2) {
                    v1F = buildSimpleFunctionNode(
                        this.arguments[1], undefined, origin, defun, undefined,
                        undefined, undefined, undefined, context);
                }
                qValueType = determineQueryValueType(query, data);
                var constRepr: any = query.getConstantRuntimeValue();
                var funAppl = new ConstNode(constRepr, getValueTypeFromConstant(constRepr), query, true, c.wontChangeValue);
                return FunctionApplicationNode.buildInternalApply(
                    [funAppl, data], qValueType, origin, defun, this);
            }
            if (this.arguments.length === 2 && v1F === undefined) {
                v1F = buildSimpleFunctionNode(
                    this.arguments[1], undefined, origin, defun, undefined,
                    undefined, undefined, undefined, context);
            }
            if (fun instanceof AVFunctionNode && this.arguments.length === 2 &&
                  v1F !== undefined && v1F.valueType.areas !== undefined) {
                var avf = <AVFunctionNode> fun;
                var aq: FunctionNode = buildAreaQueryOnAV(avf, v1F, origin, this, context);
                if (aq !== undefined) {
                    return aq;
                }
            }
            if (fun instanceof VariantFunctionNode && this.arguments.length === 2 &&
                  v1F !== undefined && v1F.valueType.areas !== undefined) {
                var qf = <VariantFunctionNode> fun;
                var aq: FunctionNode = buildAreaQueryOnQualifiedAV(qf, v1F, origin, defun, this, context);
                if (aq !== undefined) {
                    return aq;
                }
            }
            if (this.arguments.length === 2) {
                if (fun instanceof AreaProjectionNode &&
                      fun.valueType.isStrictlyData() &&
                      (v1F === undefined || v1F.valueType.isStrictlyData())) {
                    if (v1F === undefined || v1F.isEmptyOS()) {
                        // A query on an empty os
                        return buildConstNode([], inputsWontChangeValue([v1F]), undefined, 0, gEmptyOSExpr);
                    }
                }
            }
            // [EXECUTECOMPILEDQUERY]
            // if (couldCompile) {
            //     funDef = executeCompiledQuery;
            //     functionArguments.push(fun);
            // } else
            if (fun.valueType.areas !== undefined) {
                if (v1F === undefined) {
                    Utilities.syntaxError("area selection without argument");
                    return fun;
                } else {
                    var aocMemberFun: FunctionNode =
                        buildAreaOfClassQuery(undefined, fun, v1F, origin, this);
                    if (aocMemberFun !== undefined) {
                        return aocMemberFun;
                    }
                    funDef = compareAreasQuery;
                    functionArguments.push(fun);
                }
            } else {
                // Perhaps it should be possible to look deeper in the data and find
                // out if the this.arguments returned by executableQuery is a defun or data
                // In case of area set data this might be possible.
                funDef = internalApply;
                functionArguments.push(fun);
                // This warning unfortunately makes Chrome and nodejs behave
                // differently if the string gets very (very) large, in the order
                // of 36MB.
                // if (mode === "dump")
                //     Utilities.warnOnce("internalApply: " + fun.toFullString() + " @ " +
                //                    (v1F? v1F.toFullString(): "<nothing>"));
            }
            localToArea = mergeLocality(localToArea, fun.localToArea);
            localToDefun = mergeDefunLocality(localToDefun, fun.localToDefun);
        }
        if (this.arguments.length === 1 && funDef === internalApply) {
            Utilities.syntaxError("function without arguments", false, this.toCdlString());
        }
        for (var i = 1; i !== this.arguments.length; i++) {
            var fun = i === 1 && v1F !== undefined? v1F:
                buildSimpleFunctionNode(
                    this.arguments[i], undefined, origin, defun, undefined,
                    undefined, undefined, undefined, context);
            if (fun === undefined) {
                fun = new ConstNode([], new ValueType(), gEmptyOSExpr, undefined, false);
            } else if (boolArgs) {
                fun = fun.getBoolInterpretation();
            }
            functionArguments.push(fun);
            localToArea = mergeLocality(localToArea, fun.localToArea);
            localToDefun = mergeDefunLocality(localToDefun, fun.localToDefun);
        }
        return FunctionApplicationNode.buildFunctionApplication(
            funDef, functionArguments,
            specialFunctionArgumentProcessing(
                funDef, functionArguments, localToArea),
            localToDefun, origin, this);
    }

    buildCondNode(origin: number, defun: number): FunctionNode {
        var alternatives: Expression[];

        if (this.arguments.length !== 3) {
            Utilities.syntaxError("wrong arguments to cond");
        }
        var condVar: FunctionNode = buildSimpleFunctionNode(this.arguments[1], undefined, origin, defun, undefined, undefined, undefined, undefined, origin);
        // var allConditionsConstant: boolean = true;
        var altList: {on: FunctionNode; use: FunctionNode}[] = [];

        if (condVar === undefined) {
            // possible optimization: look for matches with false, or null
            condVar = buildConstNode([], false, undefined, 0, gEmptyOSExpr);
        }
        // if (!(condVar instanceof ConstNode)) {
        //     allConditionsConstant = false;
        // }
        if (this.arguments[2] instanceof ExpressionOrderedSet) {
            alternatives = (<ExpressionOrderedSet> this.arguments[2]).arguments;
        } else {
            alternatives = [this.arguments[2]];
        }
        for (var i: number = 0; i !== alternatives.length; i++) {
            var alt: Expression = alternatives[i];
            if (alt instanceof ExpressionAttributeValue) {
                var onIndex: number = alt.attributes.indexOf("on");
                var useIndex: number = alt.attributes.indexOf("use");
                if (onIndex === -1 || useIndex === -1) {
                    Utilities.syntaxError("wrong syntax for cond");
                } else {
                    var on: FunctionNode = buildSimpleFunctionNode(alt.arguments[onIndex], undefined, origin, defun, undefined, undefined, undefined, undefined, origin);
                    if (on !== undefined) {
                        // if (!(on instanceof ConstNode)) {
                        //     allConditionsConstant = false;
                        // }
                        var use: FunctionNode = buildSimpleFunctionNode(alt.arguments[useIndex], undefined, origin, defun, undefined, undefined, undefined, undefined, origin);
                        if (use === undefined) {
                            use = buildConstNode([], false, undefined, 0, gEmptyOSExpr);
                        }
                        altList.push({on: on, use: use});
                    }
                }
            }
        }
        // if (allConditionsConstant) {
        //     TODO: return first matching use expression
        // }
        return CondNode.build(condVar, altList, origin, this);
    }

    static gDefunIndex: {[templateId: number]: number} = {};

    buildDefunNode(origin: number, defun: number): FunctionNode {
        var parameters: {[name: string]: number} = {};
        var parameterNodes: StorageNode[] = [];
        var body: FunctionNode;
        var defunNr: number;
        var prevParamStack = gParameterStack;
        var template: AreaTemplate = areaTemplates[origin];
        var domainExpressionCaches =
            origin? template.expressionCache: globalExpressionCache;
        var parameterList: Expression[];
        var defunExpr: ExpressionFunctionApplication;

        if (origin in ExpressionFunctionApplication.gDefunIndex) {
            defunNr = ++ExpressionFunctionApplication.gDefunIndex[origin];
        } else {
            ExpressionFunctionApplication.gDefunIndex[origin] = defunNr = 1;
        }
        if (domainExpressionCaches[defunNr] === undefined) {
            domainExpressionCaches[defunNr] = new ExpressionCache();
        }
        gDefunStack.push(defunNr);
        gParameterStack = shallowCopy(gParameterStack);
        if (this.arguments.length !== 3) {
            Utilities.syntaxError("wrong arguments to defun: " + this.toCdlString());
        }
        if (this.arguments[1] instanceof ExpressionOrderedSet) {
            parameterList = (<ExpressionOrderedSet>this.arguments[1]).arguments;
        } else {
            parameterList = [this.arguments[1]];
        }
        if (!("defunArgTypes" in this)) {
            this.defunArgTypes = new Array<ValueType>(parameterList.length);
            for (var i: number = 0; i < parameterList.length; i++) {
                this.defunArgTypes[i] = new ValueType();
            }
        }
        for (var i: number = 0; i !== parameterList.length; i++) {
            if (!(parameterList[i] instanceof ExpressionString)) {
                Utilities.syntaxError("non-string parameter to defun: " + this.toCdlString());
            }
            var paramName: string = parameterList[i].expression;
            // We're assuming that parameters are data only; that means no map or
            // filter on areas. If we need that, the type of the parameter should be
            // inferred before building the body of the defun.
            parameters[paramName] = i;
            parameterNodes.push(buildStorageNode([paramName], origin, defunNr,
                                                 this.defunArgTypes[i], false));
            gParameterStack[paramName] = parameterNodes[i];
        }
        body = buildSimpleFunctionNode(this.arguments[2], undefined, origin, defunNr, undefined, undefined, undefined, undefined, origin);
        if ("rewrite" in body) {
            defunExpr = <ExpressionFunctionApplication> expressionStore.store(
                new ExpressionFunctionApplication(
                    [this.expression[0], this.expression[1], body.rewrite.expression],
                    ExpressionType.functionApplication,
                    [this.arguments[0], this.arguments[1], body.rewrite]));
            // Note: the value types of the arguments of both this (not
            // rewritten) defun and the new expression with the rewritten body
            // point at the same objects. That makes sure that parameters set on
            // this defun arrive at the rewritten defun, and vice versa.
            defunExpr.defunArgTypes = this.defunArgTypes;
        } else {
            defunExpr = this;
        }
        gParameterStack = prevParamStack;
        gDefunStack.pop();
        // DefunNodes always originate in the area itself, because the body is
        // constructed after the parameters, and the parameters are created in
        // the area. Changing that would require some work.
        return new DefunNode(origin, defun, defunNr, parameters, parameterNodes,
                             body, defunExpr);
    }

    // Sets the value types for the arguments based on the data to calls to
    // filter, map, multiQuery and internalApply. Note that these types are
    // merged, so [map, f, o1] and [map, f, o2] will both have the same value
    // type, even though o1 and o2 might be different.
    setDefunArgTypes(args: FunctionNode[]): void {
        for (var i: number = 0; i < args.length; i++) {
            if (this.defunArgTypes[i].unknown) {
                if (args[i].valueType !== undefined &&
                      !args[i].valueType.unknown) {
                    signalOutputChange(undefined, {
                        type: "valueTypeChange",
                        origType: this.defunArgTypes[i],
                        newType: args[i].valueType
                    });
                    this.defunArgTypes[i] = args[i].valueType;
                }
            } else if (!this.defunArgTypes[i].subsumes(args[i].valueType)) {
                var mergeType = this.defunArgTypes[i].merge(args[i].valueType);
                signalOutputChange(undefined, {
                    type: "valueTypeChange",
                    origType: this.defunArgTypes[i],
                    newType: mergeType
                });
                this.defunArgTypes[i] = mergeType;
            }
        }
    }

    buildClassOfArea(origin: number, defun: number): FunctionNode {
        var areaOS: FunctionNode = buildSimpleFunctionNode(this.arguments[1], undefined, origin, defun, undefined, undefined, undefined, undefined, origin);

        if (areaOS === undefined || !areaOS.valueType.isAreas()) {
            Utilities.syntaxError("classOfArea takes an area os");
        }
        return ClassOfAreaNode.buildClassOfAreaNode(areaOS, this);
    }

    isApplicationOf(f: BuiltInFunction): boolean {
        return this.arguments[0].expression === f;
    }

    // Matches [[classOfArea, x], y] and [y, [classOfArea, x]]
    isClassOfAreaQuery(): boolean {
        return this.arguments.length === 2 &&
            (this.arguments[0].isApplicationOf(classOfArea) ||
             this.arguments[1].isApplicationOf(classOfArea));
    }

    buildClassOfAreaQuery(origin: number, defun: number): FunctionNode {
        var areaExpr: Expression;
        var className: Expression;
        var areaEmbDepth: RangeValue;
        var membership: AVFunctionNode;
        var areaFun: FunctionNode;
        var refArea: AreaTemplate = areaTemplates[origin];

        if (this.arguments[1] instanceof ExpressionString) {
            className = this.arguments[1];
            areaExpr = (<ExpressionFunctionApplication>this.arguments[0]).arguments[1];
        } else {
            className = this.arguments[0];
            areaExpr = (<ExpressionFunctionApplication>this.arguments[1]).arguments[1];
        }
        var areaFun = buildSimpleFunctionNode(areaExpr, undefined, origin, defun, undefined, undefined, undefined, undefined, origin);
        areaEmbDepth = levelOfEmbeddingFun(areaFun, origin);
        if (areaEmbDepth === undefined || areaEmbDepth.min !== areaEmbDepth.max ||
              !(className instanceof ExpressionString)) {
            var classNameFun: FunctionNode = buildSimpleFunctionNode(className, undefined, origin, defun, undefined, undefined, undefined, undefined, origin);
            return buildFilterAreaByClass(classNameFun, areaFun, origin, true, this);
        }
        for (var lvl: number = 0; lvl < areaEmbDepth.min; lvl++) {
            refArea = refArea.parent;
        }
        refArea.determineClassMembership();
        membership = <AVFunctionNode> refArea.exports[0];
        return membership !== undefined && 
                   className.expression in membership.attributes?
               membership.attributes[className.expression]:
               buildConstNode([false], false, undefined, 0, gFalseExpr);
    }

    static usingIds: Map<number, number> = new Map<number, number>();
    static nextUsingId: number = 1;

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return this.toArgCdlString("[", "]", formattingOptions, indent);
    }

    substituteParameters(parameterMapping: ParameterMapping, origin: number, lvlDiff: number, innerDefunParams: ParameterMapping): Expression {
        if (this.isDefun()) {
            // Add/replace parameters in parameterMapping with the parameters of
            // this defun to avoid erroneous substitution and spurious warnings.
            var newInnerDefunParams: ParameterMapping = shallowCopy(innerDefunParams);
            var localParameters = this.arguments[1];
            if (localParameters instanceof ExpressionString) {
                newInnerDefunParams[localParameters.expression] = undefined;
            } else if (localParameters instanceof ExpressionOrderedSet) {
                for (var i = 0; i < localParameters.arguments.length; i++) {
                    var localParam_i = localParameters.arguments[i];
                    newInnerDefunParams[localParam_i.expression] = undefined;
                }
            }
            var substArgs = [
                this.arguments[0],
                this.arguments[1],
                this.arguments[2].substituteParameters(parameterMapping, origin, lvlDiff, newInnerDefunParams)
            ];
            var repl = new ExpressionFunctionApplication(this.expression, this.type, substArgs);
            return expressionStore.store(repl);
        } else if (this.isUsing()) {
            var substArgs: Expression[] = this.arguments.slice(0);
            var newInnerDefunParams: ParameterMapping = shallowCopy(innerDefunParams);
            for (i = 2; i < substArgs.length; i += 2) {
                substArgs[i] = substArgs[i].substituteParameters(parameterMapping, origin, lvlDiff, newInnerDefunParams);
                newInnerDefunParams[substArgs[i - 1].expression] = undefined;
            }
            substArgs[substArgs.length - 1] = substArgs[substArgs.length - 1].substituteParameters(parameterMapping, origin, lvlDiff, newInnerDefunParams);
            var repl = new ExpressionFunctionApplication(this.expression, this.type, substArgs);
            return expressionStore.store(repl);
        } else {
            return super.substituteParameters(parameterMapping, origin, lvlDiff, innerDefunParams);
        }
    }
}

// Returns true if the (normalized) query has a defined result starting at node.
// If any path in the query reaches an undefined node without finding an
// expression, it returns false, unless the query happens to be a negation.
function queryHasDefinedResult(node: PathTreeNode, query: any): boolean {
    if (node === undefined) {
        return query instanceof Negation;
    }
    if (node.values.length !== 0) {
        return true;
    }
    if (isSimpleValue(query) || query instanceof Array ||
          query instanceof NonAV) {
        return true;
    }
    for (var attr in query) {
        if (!queryHasDefinedResult(node.next[attr], query[attr])) {
            return false;
        }
    }
    return true;
}

class ExpressionQuery extends ExpressionFunctionApplication {

    static build(query: Expression, data: Expression): Expression {
        return expressionStore.store(
            new ExpressionQuery([query.expression, data.expression],
                                [query, data]));
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictByArguments();
    }

    constructor(expression: CdlExpression, args: Expression[]) {
        super(expression, ExpressionType.query, args);
    }

    cloneBase(): Expression {
        return new ExpressionQuery(this.expression, undefined);
    }

    isLocalityDependent(): boolean {
        return false;
    }

    propagateConstants(node: PathTreeNode, contextStack: ConstantContextStack): Expression {
        var query: Expression = this.arguments[0].propagateConstants(node, contextStack);

        if (this.arguments.length === 1) {
            return query === this.arguments[0]? this:
                this.cloneWithNewArguments([query], 0, 0);
        } else {
            var os: Expression = this.arguments[1].propagateConstants(node, contextStack);
            var attr: string = query.contextProjectionAttribute(0);
            var embLvl: number = os.getEmbeddingLevel(node);
            if (attr !== undefined && embLvl !== undefined) {
                return !(attr in contextStack[embLvl])? gUndefinedExpr:
                       contextStack[embLvl][attr] === null? this:
                       contextStack[embLvl][attr];
            } else {
                return query === this.arguments[0] || os === this.arguments[1]?
                    this: this.cloneWithNewArguments([query, os], 0, 0);
            }
        }
    }

    isParamQuery(): boolean {
        return this.arguments[0] instanceof ExpressionAttributeValue &&
            (<ExpressionAttributeValue>this.arguments[0]).attributes.length === 1 &&
            (<ExpressionAttributeValue>this.arguments[0]).attributes[0] === "param";
    }

    isClassQuery(): boolean {
        return this.arguments[0] instanceof ExpressionAttributeValue &&
            (<ExpressionAttributeValue>this.arguments[0]).attributes.length === 1 &&
            (<ExpressionAttributeValue>this.arguments[0]).attributes[0] === "class";
    }

    isPointerQuery(): boolean {
        return this.arguments[1] instanceof ExpressionFunctionApplication &&
            (<ExpressionFunctionApplication>this.arguments[1]).arguments[0].expression === pointer;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        var query: Expression = this.arguments[0];
        var res: FunctionNode;

        if (this.arguments.length === 1) {
            Utilities.syntaxError("query without argument");
            return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
        }

        if (this.isPointerQuery()) {
            res = buildQueryNodeOnFunction(query, pointerNode, origin, defun, this, context);
            if (res !== undefined) {
                return res;
            }
        }

        // look in other areas; for now only supports direct embedding*
        var data: FunctionNode = buildSimpleFunctionNode(
            this.arguments[1], undefined, origin, defun,
            undefined, undefined, undefined, undefined, context);
        if (origin !== undefined) {
            var refArea: AreaTemplate = areaTemplates[origin];
            var argEmbDepth: RangeValue = levelOfEmbeddingFun(data, origin);
            if (argEmbDepth !== undefined && argEmbDepth.min === argEmbDepth.max &&
                  !query.containsAttribute("children")) {
                for (var lvl: number = 0; lvl < argEmbDepth.min && refArea; lvl++) {
                    refArea = refArea.parent;
                }
                if (refArea === undefined) {
                    Utilities.syntaxError("too many levels of embedding");
                    return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
                }
                // Now perform query on refArea, and return the result.
                // If it's a single path {a: {b: ...}}, it should return that node's
                // functionNode. If it's more complex, it should return an av.
                // Beware of opaque and writable nodes.
                var node: FunctionNode;
                if (this.isParamQuery()) {
                    node = buildParamQuery(query, refArea.id, data.localToDefun, this);
                } else if (this.isClassQuery()) {
                    node = buildClassQuery(query, refArea.id, data.localToDefun, this);
                } else {
                    var nQuery: Expression = query.normalizeQuery();
                    node = resolveLocalQuery(nQuery, refArea.id, defun, origin, this);
                }
                if (node !== undefined) {
                    return node;
                } else if (!queryHasDefinedResult(refArea.areaNode, nQuery)) {
                    return buildConstNode(undefined, false, suppressSet, 0, gUndefinedExpr);
                }
            }
        }
        return buildQueryNodeOnFunction(query, data, origin, defun, this, context);
    }
}

class ExpressionJsFunctionApplication extends ExpressionWithArguments {
    jsFunctionName: string;

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictByJSFNameAndArguments();
    }

    constructor(expression: JavascriptFunction, args: Expression[]) {
        super(expression, ExpressionType.jsFunctionApplication, args);
        this.jsFunctionName = expression.name;
    }

    cloneBase(): Expression {
        var expr = new ExpressionJsFunctionApplication(this.expression, undefined);

        expr.jsFunctionName = this.jsFunctionName;
        return expr;
    }

    replaceArgumentsInExpression(): CdlExpression {
        return new JavascriptFunction(this.jsFunctionName,
                           this.arguments.map(e => e.expression));
    }

    isTrue(): boolean {
        return this.arguments.some(e => e.isTrue());
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        var funDef: BuiltInFunction;
        var functionArguments = this.arguments.map((fn: Expression): FunctionNode => {
            return buildSimpleFunctionNode(fn, undefined, origin, defun,
                           undefined, undefined, undefined, undefined, context);
        });

        switch (this.jsFunctionName) {
          case "push":
            funDef = internalPush;
            break;
          case "atomic":
            funDef = internalAtomic;
            break;
          case "erase":
            funDef = internalDelete;
            break;
          default:
            Utilities.syntaxError("unsupported function: " + this.jsFunctionName);
            return buildConstNode([], true, undefined, 0, gEmptyOSExpr);
        }
        return FunctionApplicationNode.buildFunctionApplication(
                 funDef, functionArguments, undefined, undefined, origin, this);
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return this.toArgCdlString(this.jsFunctionName + "(", ")", formattingOptions, indent);
    }
}

class ExpressionOrderedSet extends ExpressionWithArguments {
    constructor(expression: MoonOrderedSet, os: Expression[]) {
        super(expression, ExpressionType.orderedSet, os);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictByArguments();
    }

    cloneBase(): Expression {
        return new ExpressionOrderedSet(this.expression, undefined);
    }

    replaceArgumentsInExpression(): CdlExpression {
        return new MoonOrderedSet(
            this.arguments.map(e => e.expression));
    }

    // Combines o() with embedded o() into one flat o().
    propagateConstantsArguments(node: PathTreeNode, contextStack: ConstantContextStack): Expression[] {
        var nArgs: Expression[] = [];
        var change: boolean = false;

        for (var i: number = 0; i < this.arguments.length; i++) {
            var nArg_i = this.arguments[i].propagateConstants(node, contextStack);
            if (nArg_i !== this.arguments[i]) {
                change = true;
            }
            if (nArg_i instanceof ExpressionOrderedSet) {
                nArgs = nArgs.concat(nArg_i.arguments);
                change = true; // one level of o() embedding removed
            } else if (nArg_i !== undefined) {
                nArgs.push(nArg_i);
            } else {
                change = true; // undefined left out
            }
        }
        return change? nArgs: this.arguments;
    }

    isConstEmptyOS(): boolean {
        return this.arguments.length === 0;
    }

    isMoonConstant(): boolean {
        return this.arguments.every(e => e.isMoonConstant());
    }

    getConstantRuntimeValue(): any {
        return this.arguments.map(e => e.getConstantRuntimeValue());
    }

    // o(x_1, ...) is true, if at least one x_i isn't false.
    isTrue(): boolean {
        var res: boolean = false;

        for (var i: number = 0; i < this.arguments.length; i++) {
            var xi: boolean = this.arguments[i].isTrue();
            if (xi === true) {
                res = true;
                break;
            } else if (xi === undefined) {
                res = undefined;
            }
        }
        return res;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        var os: FunctionNode[] = [];

        for (var i = 0; i !== this.arguments.length; i++) {
            var fun = buildSimpleFunctionNode(this.arguments[i], undefined, origin, defun, undefined, undefined, undefined, undefined, context);
            if (fun instanceof OrderedSetNode && fun.isOrderedSetNode()) {
                os = os.concat(fun.values);
            } else {
                os.push(fun);
            }
        }
        return OrderedSetNode.buildOrderedSet(os, origin, this, false);
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return this.toArgCdlString("o(", ")", formattingOptions, indent);
    }
}

class ExpressionRange extends ExpressionWithArguments {
    closedLower: boolean;
    closedUpper: boolean;

    constructor(expression: MoonRange, os: Expression[]) {
        super(expression, ExpressionType.range, os);
        this.closedLower = expression.closedLower;
        this.closedUpper = expression.closedUpper;
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictByRangeArguments();
    }

    cloneBase(): Expression {
        return new ExpressionRange(this.expression, undefined);
    }

    replaceArgumentsInExpression(): CdlExpression {
        return new MoonRange(
            this.arguments.map(e => e.expression),
            this.closedLower, this.closedUpper);
    }

    getConstantRuntimeValue(): any {
        return new RangeValue(
            this.arguments.map(e => e.getConstantRuntimeValue()),
            this.closedLower, this.closedUpper);
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        var os: FunctionNode[] = [];

        for (var i = 0; i !== this.arguments.length; i++) {
            var fun = buildSimpleFunctionNode(this.arguments[i], undefined, origin, defun, undefined, undefined, undefined, undefined, context);
            if (fun !== undefined && !fun.isEmptyOS()) {
                if (fun instanceof OrderedSetNode) { // includes RangeNode
                    os = os.concat(fun.values);
                } else {
                    os.push(fun);
                }
                if (fun.valueType.isNotData()) {
                    Utilities.warnOnce("range on non-data");
                }
            }
        }
        return RangeNode.buildRange(os, this.closedLower, this.closedUpper, origin, this);
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return this.toArgCdlString(
            (this.closedLower && this.closedUpper? "r":
             "R" + (this.closedLower? "c": "o") + (this.closedUpper? "c": "o")) + "(",
            ")", formattingOptions, indent);
    }
}

class ExpressionNegation extends ExpressionWithArguments {
    constructor(expression: CdlExpression, queries: Expression[]) {
        super(expression, ExpressionType.negation, queries);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictByArguments();
    }

    cloneBase(): Expression {
        return new ExpressionNegation(this.expression, undefined);
    }

    replaceArgumentsInExpression(): CdlExpression {
        return new Negation(
            this.arguments.map(e => e.expression));
    }

    extractQueryComponents(path: string[], positive: boolean, origin: number, defun: number): QueryComponent[] {
        var qComps: QueryComponent[] = [];

        for (var i: number = 0; i < this.arguments.length; i++) {
            qComps = qComps.concat(this.arguments[i].extractQueryComponents(
                path, !positive, origin, defun));
        }
        return qComps;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        return NegationNode.build(this.arguments.map((v) => {
            return buildSimpleFunctionNode(v, undefined, origin, defun, undefined, undefined, undefined, undefined, context);
        }), origin, this);
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return this.toArgCdlString("n(", ")", formattingOptions, indent);
    }
}

class ExpressionSubStringQuery extends ExpressionWithArguments {
    constructor(expression: MoonOrderedSet, os: Expression[]) {
        super(expression, ExpressionType.subStringQuery, os);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictByArguments();
    }

    cloneBase(): Expression {
        return new ExpressionSubStringQuery(this.expression, undefined);
    }

    replaceArgumentsInExpression(): CdlExpression {
        return new MoonSubstringQuery(
            this.arguments.map(e => e.expression));
    }

    isConstEmptyOS(): boolean {
        return false;
    }

    isMoonConstant(): boolean {
        return this.arguments.every(e => e.isMoonConstant());
    }

    getConstantRuntimeValue(): any {
        return this.arguments.map(e => e.getConstantRuntimeValue());
    }

    // s("...") is true
    isTrue(): boolean {
        return true;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        var os: FunctionNode[] = [];

        for (var i = 0; i !== this.arguments.length; i++) {
            var fun = buildSimpleFunctionNode(this.arguments[i], undefined, origin, defun, undefined, undefined, undefined, undefined, context);
            if (fun !== undefined && !fun.isEmptyOS()) {
                if (fun instanceof OrderedSetNode) { // includes RangeNode
                    os = os.concat(fun.values);
                } else {
                    os.push(fun);
                }
                if (fun.valueType.isNotData()) {
                    Utilities.warnOnce("substring query on non-data");
                }
            }
        }
        return SubStringQueryNode.buildSubStringQuery(os, origin, this);
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return this.toArgCdlString("s(", ")", formattingOptions, indent);
    }
}

class ExpressionComparisonFunction extends ExpressionWithArguments {
    constructor(expression: MoonComparisonFunction, os: Expression[]) {
        super(expression, ExpressionType.comparisonFunction, os);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictByArguments();
    }

    cloneBase(): Expression {
        return new ExpressionSubStringQuery(this.expression, undefined);
    }

    replaceArgumentsInExpression(): CdlExpression {
        return new MoonComparisonFunction(
            this.arguments.map(e => e.expression));
    }

    isConstEmptyOS(): boolean {
        return false;
    }

    isMoonConstant(): boolean {
        return this.arguments.every(e => e.isMoonConstant());
    }

    getConstantRuntimeValue(): any {
        return this.arguments.map(e => e.getConstantRuntimeValue());
    }

    // c("...") is true
    isTrue(): boolean {
        return true;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        var os: FunctionNode[] = [];

        for (var i = 0; i !== this.arguments.length; i++) {
            var fun = buildSimpleFunctionNode(this.arguments[i], undefined, origin, defun, undefined, undefined, undefined, undefined, context);
            if (fun instanceof ComparisonFunctionNode) {
                os = os.concat(fun.values);
            } else if (fun !== undefined) {
                os.push(fun);
            }
        }
        return ComparisonFunctionNode.buildComparisonFunction(os, origin, this);
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return this.toArgCdlString("c(", ")", formattingOptions, indent);
    }
}

abstract class ExpressionSimpleValue extends ExpressionConstant {
    constructor(expression: CdlExpression, type: ExpressionType) {
        super(expression, type);
    }

    isSimpleValue(): boolean {
        return true;
    }

    isUnmergeable(): boolean {
        return true;
    }

    isMoonConstant(): boolean {
        return true;
    }
}

class ExpressionProjector extends ExpressionConstant {
    constructor(expression: Projector) {
        super(expression, ExpressionType.projector);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictSingleton();
    }

    cloneBase(): Expression {
        return new ExpressionProjector(this.expression);
    }

    isMoonConstant(): boolean {
        return true;
    }

    isSimpleValue(): boolean {
        return false;
    }

    extractQueryPath(): QueryPath {
        return {path: [], terminal: this, isProjection: true};
    }

    getNrProjectionPaths(): number {
        return 1;
    }

    extractQueryComponents(path: string[], positive: boolean, origin: number, defun: number): QueryComponent[] {
        if (positive) {
            return [new QueryComponentProject(path)];
        } else {
            return [new QueryComponentSelect(path, this, false, undefined)];
        }
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return "_";
    }
}

class ExpressionTerminalSymbol extends ExpressionConstant {
    constructor(expression: TerminalSymbol) {
        super(expression, ExpressionType.terminalSymbol);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictByName(function(e: Expression): string {
            return e.expression.name;
        });
    }

    cloneBase(): Expression {
        return new ExpressionTerminalSymbol(this.expression);
    }

    isMoonConstant(): boolean {
        return true;
    }

    isSimpleValue(): boolean {
        return true;
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return this.expression.name;
    }
}

class ExpressionString extends ExpressionSimpleValue {
    constructor(expression: string) {
        super(expression, ExpressionType.string);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictBySimpleValue();
    }

    cloneBase(): Expression {
        return new ExpressionString(this.expression);
    }

    substituteParameters(parameterMapping: ParameterMapping, origin: number, lvlDiff: number, innerDefunParams: ParameterMapping): Expression {
        return this.expression in parameterMapping && !(this.expression in innerDefunParams)?
               parameterMapping[this.expression]: this;
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return this.expression instanceof RegExp? this.expression.toString():
               JSON.stringify(this.expression);
    }
}

class ExpressionNumber extends ExpressionSimpleValue {
    constructor(expression: number) {
        super(expression, ExpressionType.number);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictBySimpleValue();
    }

    cloneBase(): Expression {
        return new ExpressionNumber(this.expression);
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return String(this.expression);
    }
}

class ExpressionBoolean extends ExpressionSimpleValue {
    constructor(expression: boolean) {
        super(expression, ExpressionType.boolean);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictBySimpleValue();
    }

    cloneBase(): Expression {
        return new ExpressionBoolean(this.expression);
    }

    isTrue(): boolean {
        return this.expression;
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return this.expression? "true": "false";
    }
}

class ExpressionClassName extends ExpressionConstant {
    constructor(expression: ClassName) {
        super(expression, ExpressionType.className);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictByName(function (e: ExpressionClassName): string {
            var cln = <ClassName> e.expression;

            function classNameToString(v: any): string {
                if (v instanceof MoonOrderedSet) {
                    var os: MoonOrderedSet = v;
                    return os.os.map(classNameToString).join(",");
                } else if (typeof(v) === "string") {
                    return v;
                } else if (v === superclass) {
                    return '::superclass';
                } else {
                    Utilities.error("unexpected class name");
                    return undefined;
                }
            }

            return classNameToString(cln.className);
        });
    }

    cloneBase(): Expression {
        return new ExpressionClassName(this.expression);
    }

    isSimpleValue(): boolean {
        return false;
    }

    isUnmergeable(): boolean {
        return false;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        return buildConstNode(true, true, undefined, 0, gTrueExpr);
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return (<ClassName>this.expression).toString();
    }
}

class ExpressionChildExistence extends ExpressionConstant {
    constructor(expression: ChildExistence) {
        super(expression, ExpressionType.childExistence);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictSingleton();
    }

    cloneBase(): Expression {
        return new ExpressionChildExistence(this.expression);
    }

    isSimpleValue(): boolean {
        return false;
    }

    isUnmergeable(): boolean {
        return false;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        return buildConstNode(true, true, undefined, 0, gTrueExpr);
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return (<ChildExistence>this.expression).toString();
    }
}

class ExpressionUndefined extends ExpressionConstant {
    constructor(expression: CdlExpression) {
        super(expression, ExpressionType.undefined);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictSingleton();
    }

    cloneBase(): Expression {
        return new ExpressionUndefined(this.expression);
    }

    isSimpleValue(): boolean {
        return true;
    }

    isMoonConstant(): boolean {
        return true;
    }

    isTrue(): boolean {
        return false;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        return buildConstNode([], true, undefined, 0, gEmptyOSExpr);
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return "undefined";
    }

    checkForUndefined(pathInfo: PathInfo): void {
        errorReporters["undefined"]("explicit undefined value at " + pathInfo.getShortErrorLocation());
    }
}

class ExpressionFalse extends ExpressionSimpleValue {
    constructor(expression: CdlExpression) {
        super(expression, ExpressionType.false);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictSingleton();
    }

    cloneBase(): Expression {
        return new ExpressionFalse(this.expression);
    }

    isTrue(): boolean {
        return false;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        return buildConstNode([], true, undefined, 0, gEmptyOSExpr);
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return "[]"; // TODO: find out why this is called false 
    }
}

class ExpressionNull extends ExpressionSimpleValue {
    constructor(expression: CdlExpression) {
        super(expression, ExpressionType.null);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictSingleton();
    }

    cloneBase(): Expression {
        return new ExpressionNull(this.expression);
    }

    isSimpleValue(): boolean {
        return true;
    }

    isMoonConstant(): boolean {
        return true;
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return "null";
    }
}

class ExpressionUnknown extends Expression {
    constructor(expression: CdlExpression)
    {
        super(expression, ExpressionType.unknown);
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictSingleton();
    }

    cloneBase(): Expression {
        return new ExpressionUnknown(this.expression);
    }

    propagateConstantsArguments(node: PathTreeNode, contextStack: ConstantContextStack): Expression[] {
        return [];
    }

    isConstant(): boolean {
        return true;
    }

    isSimpleValue(): boolean {
        return true;
    }
    isLocalityDependent(): boolean {
        return false;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        Utilities.error("should not be called");
        return undefined;
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return "<UNKNOWN>";
    }

    checkForUndefined(pathInfo: PathInfo): void {
        // Catches an unexpected value in the cdl early on.
        Utilities.error("unknown value at " + pathInfo.getShortErrorLocation());
    }

    substituteParameters(parameterMapping: ParameterMapping, origin: number, lvlDiff: number, innerDefunParams: ParameterMapping): Expression {
        throw new Error("Method not implemented.");
    }
}

class DomainShield extends Expression {
    templateId: number;
    shieldedExpression: Expression;

    constructor(templateId: number, shieldedExpression: Expression) {
        super(shieldedExpression.expression, ExpressionType.domainShield);
        this.templateId = templateId;
        this.shieldedExpression = shieldedExpression;
    }

    static getExpressionDict(): ExpressionDict {
        return new ExpressionDictByTemplateIdAndArgument();
    }

    cloneBase(): Expression {
        return new DomainShield(this.templateId, this.shieldedExpression);
    }

    isConstant(): boolean {
        return this.shieldedExpression.isConstant();
    }

    isSimpleValue(): boolean {
        return this.shieldedExpression.isSimpleValue();
    }

    getEmbeddingLevel(node: PathTreeNode): number {
        var lvl: number = 0;
        var ptr: PathTreeNode = node;
        var emb: number;

        while (ptr.templateId !== this.templateId) {
            ptr = ptr.parent.area;
            assert(ptr !== undefined, "domain shield should be in template's embeddingStar");
            lvl++;
        }
        emb = this.expression.levelOfEmbedding(ptr);
        return emb !== undefined? emb + lvl: undefined;
    }

    buildFunctionNode(origin: number, defun: number, suppressSet: boolean, context: number): FunctionNode {
        // assert(defun === 0 || this.templateId === origin, "cannot transfer defun to other area template");
        return this.shieldedExpression.buildFunctionNode(
                                  this.templateId, defun, suppressSet, context);
    }

    extractQueryComponents(path: string[], positive: boolean, origin: number, defun: number): QueryComponent[] {
        return this.shieldedExpression.extractQueryComponents(path, positive, origin, defun);
    }

    toCdlString(formattingOptions?: CDLFormattingOptions, indent: string = ""): string {
        return "shield(" + this.templateId + ", " +
            this.shieldedExpression.toCdlString() + ")";
    }

    substituteParameters(parameterMapping: ParameterMapping, origin: number, lvlDiff: number, innerDefunParams: ParameterMapping): Expression {
        var lvlDiff2: number = getLevelDifference(origin, this.templateId, false);

        assert(lvlDiff2 >= 0, "defun not in embeddingStar?");
        return this.shieldedExpression.substituteParameters(parameterMapping, origin, lvlDiff2, innerDefunParams);
    }

    unshield(): Expression {
        return this.shieldedExpression.unshield();
    }

    isLocalityDependent(): boolean {
        return this.shieldedExpression.isLocalityDependent();
    }
}

class ExpressionStore {
    // A associative structure per expression type. The rest of the system
    // uses the expressions and indices stored here, so they can be compared
    // directly.
    expressions: ExpressionDict[];

    constructor() {
        this.expressions = [
            ExpressionBuiltInFunction.getExpressionDict(),
            ExpressionAttributeValue.getExpressionDict(),
            ExpressionQuery.getExpressionDict(),
            ExpressionFunctionApplication.getExpressionDict(),
            ExpressionJsFunctionApplication.getExpressionDict(),
            ExpressionRange.getExpressionDict(),
            ExpressionSubStringQuery.getExpressionDict(),
            ExpressionOrderedSet.getExpressionDict(),
            ExpressionNegation.getExpressionDict(),
            ExpressionProjector.getExpressionDict(),
            ExpressionTerminalSymbol.getExpressionDict(),
            ExpressionComparisonFunction.getExpressionDict(),
            ExpressionString.getExpressionDict(),
            ExpressionNumber.getExpressionDict(),
            ExpressionBoolean.getExpressionDict(),
            ExpressionClassName.getExpressionDict(),
            ExpressionChildExistence.getExpressionDict(),
            ExpressionUndefined.getExpressionDict(),
            ExpressionFalse.getExpressionDict(),
            ExpressionNull.getExpressionDict(),
            DomainShield.getExpressionDict(),
            ExpressionUnknown.getExpressionDict()
        ];
    }

    // Maps a Javascript value directly onto a unique Expression. The advantage
    // is that objects that are repeated by value (e.g. by repeated use of a
    // global JS variable) only require a single break-down.
    hardCache = new Map<any, Expression>();

    get(expression: CdlExpression, templateArguments: any): Expression {
        var self: ExpressionStore = this;

        if (templateArguments === undefined && this.hardCache.has(expression)) {
            return this.hardCache.get(expression);
        }

        function argumentsArray(args: CdlExpression[]): Expression[] {
            var arr: Expression[] = new Array(args.length);

            for (var i: number = 0; i < args.length; i++) {
                arr[i] = self.get(args[i], templateArguments);
            }
            return arr;
        }

        function argumentsObject(args: {[attr: string]: CdlExpression}, attributes: string[]): Expression[] {
            var arr: Expression[] = new Array(attributes.length);

            for (var i: number = 0; i < attributes.length; i++) {
                arr[i] = self.get(args[attributes[i]], templateArguments);
            }
            return arr;
        }

        function argumentsArrayDefun(args: CdlExpression[]): Expression[] {
            var arr: Expression[] = new Array(args.length);
            var prevParamStack = gParameterStack;

            arr[0] = self.get(args[0], templateArguments);
            arr[1] = self.get(args[1], templateArguments);
            gParameterStack = shallowCopy(gParameterStack);
            if (typeof(args[1]) === "string") {
                gParameterStack[args[1]] = undefined;
            } else if (args[1] instanceof MoonOrderedSet) {
                for (var i: number = 0; i < args[1].os.length; i++) {
                    gParameterStack[args[1].os[i]] = undefined;
                }
            }
            arr[2] = self.get(args[2], templateArguments);
            gParameterStack = prevParamStack;
            return arr;
        }

        function rewriteUsing(args: CdlExpression[]): Expression {
            var prevParamStack = gParameterStack;
            var localNameStack: ParameterMapping = {};
            var usingName: Expression;
            var usingValue: Expression;

            gParameterStack = shallowCopy(gParameterStack);
            for (var i: number = 1; i < args.length - 1; i += 2) {
                usingName = self.get(args[i], templateArguments);
                if (!(usingName instanceof ExpressionString)) {
                    Utilities.syntaxError("not a string: " + usingName.toCdlString());
                    return undefined;
                }
                gParameterStack[usingName.expression] = undefined;
                localNameStack[usingName.expression] = self.get(args[i + 1], templateArguments).
                                 substituteParameters(localNameStack, 0, 0, {});
            }
            usingValue = self.get(args[args.length - 1], templateArguments).
                                 substituteParameters(localNameStack, 0, 0, {});
            gParameterStack = prevParamStack;
            return usingValue;
        }

        function replaceTemplateArguments(obj: any): any {
            var repl: any = {};

            for (var attr in obj) {
                var expr = self.get(obj[attr], templateArguments);
                var replAttr: any = attr;
                if (attr.length > 1 && attr[0] === "$") {
                    if (attr[1] === "$") {
                        replAttr = attr.slice(1);
                    } else {
                        replAttr = templateArguments === undefined? undefined:
                                   templateArguments[attr.slice(1)];
                        if (replAttr === undefined) {
                            Utilities.syntaxError("undefined template argument for " + attr);
                        } else if (typeof(replAttr) !== "string") {
                            Utilities.syntaxError("template argument for attribute " +
                                                attr + " is not a string");
                        }
                    }
                }
                repl[replAttr] = expr.expression;
            }
            return repl;
        }

        var type: ExpressionType = getCdlExpressionType(expression);
        var expr: Expression = undefined;

        switch (type) {
          case ExpressionType.builtInFunction:
            expr = new ExpressionBuiltInFunction(expression);
            break;
          case ExpressionType.projector:
            expr = new ExpressionProjector(expression);
            break;
          case ExpressionType.string:
            var startsWithDollar: boolean = typeof(expression) === "string" &&
                                            expression.startsWith("$");
            if (expression.length > 1 && startsWithDollar && !expression.startsWith("$$")) {
                var templateArg: any = templateArguments === undefined? undefined:
                                       templateArguments[expression.slice(1)];
                if (templateArg === undefined) {
                    return this.get(o(), undefined);
                } else {
                    return this.get(templateArg, templateArguments);
                }
            } else {
                if (startsWithDollar) {
                    // Replace ^$$ by a single $.
                    expression = expression.slice(1);
                }
                expr = new ExpressionString(expression);
            }
            break;
          case ExpressionType.number:
            expr = new ExpressionNumber(expression);
            break;
          case ExpressionType.boolean:
            expr = new ExpressionBoolean(expression);
            break;
          case ExpressionType.className:
            expr = new ExpressionClassName(expression);
            break;
          case ExpressionType.childExistence:
            expr = new ExpressionChildExistence(expression);
            break;
          case ExpressionType.undefined:
            expr = new ExpressionUndefined(expression);
            break;
          case ExpressionType.false:
            expr = new ExpressionFalse(expression);
            break;
          case ExpressionType.null:
            expr = new ExpressionNull(expression);
            break;
          case ExpressionType.unknown:
            expr = new ExpressionUnknown(expression);
            break;
          case ExpressionType.query:
            expr = new ExpressionQuery(expression, argumentsArray(expression));
            break;
          case ExpressionType.functionApplication:
            if (expression[0] === using && expression.length % 2 === 0) {
                // Note: returns undefined on syntax error, and a later
                // function stands a better chance at showing the error location
                expr = rewriteUsing(expression);
                if (expr !== undefined) {
                    return expr;
                }
            }
            var nArgs: Expression[] = expression[0] === defun && expression.length === 3?
                argumentsArrayDefun(expression): argumentsArray(expression);
            expr = new ExpressionFunctionApplication(expression, ExpressionType.functionApplication, nArgs);
            break;
          case ExpressionType.jsFunctionApplication:
            expr = new ExpressionJsFunctionApplication(expression, argumentsArray(expression.arguments));
            break;
          case ExpressionType.range:
            expr = new ExpressionRange(expression, argumentsArray(expression.os));
            break;
          case ExpressionType.subStringQuery:
            expr = new ExpressionSubStringQuery(expression, argumentsArray(expression.os));
            break;
          case ExpressionType.comparisonFunction:
            expr = new ExpressionComparisonFunction(expression, argumentsArray(expression.os));
            break;
          case ExpressionType.orderedSet:
            if (expression.os.length === 1) {
                return this.get(expression.os[0], templateArguments); // get rid of singleton o() during compilation
            } else {
                expr = new ExpressionOrderedSet(expression, argumentsArray(expression.os));
            }
            break;
          case ExpressionType.negation:
            expr = new ExpressionNegation(expression, argumentsArray(expression.queries));
            break;
          case ExpressionType.attributeValue:
            expression = replaceAbbreviatedPaths(expression);
            if (templateArguments !== undefined) {
                expression = replaceTemplateArguments(expression);
            }
            var attributes: string[] = Object.keys(expression).sort();
            expr = new ExpressionAttributeValue(expression,
                           argumentsObject(expression, attributes), attributes);
            break;
          case ExpressionType.terminalSymbol:
            expr = new ExpressionTerminalSymbol(expression);
            break;
          default:
            Utilities.error("unknown type");
        }
        var exprWithId = this.store(expr);
        if (templateArguments === undefined) {
            this.hardCache.set(expression, exprWithId);
        }
        return exprWithId;
    }

    store(expr: Expression): Expression {
        var exprDict: ExpressionDict = this.expressions[expr.type];
        var stored: Expression = exprDict.get(expr);

        assert(!expr.id, "DEBUGGING!!! Perhaps this is ok, though; then return this;");
        if (stored !== undefined) {
            return stored;
        }
        expr.obtainId();
        exprDict.store(expr);
        return expr;
    }
}

var expressionStore: ExpressionStore;

function initializeExpressions(): void {
    expressionStore = new ExpressionStore();
    gProjectorExpr = expressionStore.get(_, undefined);
    gUndefinedExpr = expressionStore.get(undefined, undefined);
    gTrueExpr = expressionStore.get(true, undefined);
    gFalseExpr = expressionStore.get(false, undefined);
    gMeExpr = expressionStore.get([me], undefined);
    gRecipientMessageExpr = expressionStore.get([{recipient: _}, [message]], undefined);
    gChildExistence = expressionStore.get(new ChildExistence(), undefined);
    gEmptyOSExpr = expressionStore.get(o(), undefined);
    gEmptyAVExpr = expressionStore.get({}, undefined);
    gDynamicAttributeFun = expressionStore.get(dynamicAttribute, undefined);
}

// Rewrites an expression with a defun to the expression where the function
// has been applied.
function rewriteDefun(fun: ExpressionFunctionApplication, funDomain: number, args: Expression[], argsDomain: number): Expression {
    var body: Expression = fun.arguments[2];
    var parameterMapping: ParameterMapping = {};
    var parameterNames: Expression[];
    var lvlDiff: number = getLevelDifference(argsDomain, funDomain, false);

    assert(funDomain === undefined || lvlDiff >= 0, "defun not global, nor in embeddingStar?");
    if (fun.arguments[1] instanceof ExpressionOrderedSet) {
        parameterNames = (<ExpressionOrderedSet> fun.arguments[1]).arguments;
    } else {
        parameterNames = [fun.arguments[1]];
    }
    if (parameterNames.length !== args.length) {
        Utilities.syntaxError("parameter count mismatch", false, fun.toCdlString());
        return gEmptyOSExpr;
    }
    // Bind arguments
    for (var i: number = 0; i !== args.length; i++) {
        var parameterName: Expression = parameterNames[i];
        if (parameterName instanceof ExpressionString) {
            parameterMapping[parameterName.expression] = args[i];
        } else {
            Utilities.syntaxError("parameter name not a string");
            return undefined;
        }
    }
    return body.substituteParameters(parameterMapping, argsDomain, lvlDiff, {});
}

type ExpressionToFunctionNode = {[exprId: number]: FunctionNode};

class ExpressionCache {
    // Array of all cdl expressions per supIndex and type in an area.
    // Note that all assume originating in the same locality.
    expressions: ExpressionToFunctionNode[][] = new Array(3);

    findFunctionNode(expression: Expression, suppressSet: boolean): FunctionNode {
        var supIndex: number = suppressSet === undefined? 0: suppressSet? 2: 1;
        var type: ExpressionType = expression.type;
        
        return this.expressions[supIndex] === undefined? undefined:
            this.expressions[supIndex][type] === undefined? undefined:
            this.expressions[supIndex][type][expression.id];
    }

    updateFunctionNode(expression: Expression, functionNode: FunctionNode, suppressSet: boolean): void {
        var type: ExpressionType = expression.type;
        var supIndex: number = suppressSet === undefined? 0: suppressSet? 2: 1;

        if (this.expressions[supIndex] === undefined) {
            this.expressions[supIndex] = new Array(ExpressionType.unknown + 1);
            this.expressions[supIndex][type] = {};
        } else if (this.expressions[supIndex][type] === undefined) {
            this.expressions[supIndex][type] = {};
        }
        this.expressions[supIndex][type][expression.id] = functionNode;
    }
}
