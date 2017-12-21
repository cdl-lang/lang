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

class JSSyntaxTree implements EqualityTest {
    children: JSSyntaxTree[];

    constructor(children: JSSyntaxTree[]) {
        this.children = children;
    }

    // Note: indent should start with \n
    toString(indent: string): string {
        assert(false, "implement in derived class");
        return undefined;
    }

    substitute(targetId: number, expr: JSSyntaxTree): JSSyntaxTree {
        var children: JSSyntaxTree[] = [];

        for (var i: number = 0; i < this.children.length; i++) {
            if (this.children[i] === undefined) {
                children.push(undefined);
            } else if (this.children[i].isTarget(targetId)) {
                children.push(expr);
            } else {
                children.push(this.children[i].substitute(targetId, expr));
            }
        }
        return this.cloneWithNewChildren(children);
    }

    isTarget(targetId: number): boolean {
        return false;
    }

    cloneWithNewChildren(children: JSSyntaxTree[]): JSSyntaxTree {
        assert(false, "implement in derived class");
        return undefined;
    }

    isEqual(t: JSSyntaxTree): boolean {
        return arrayEqual(this.children, t.children);
    }
}

class JSStatement extends JSSyntaxTree {
    substitute(targetId: number, expr: JSSyntaxTree): JSStatement {
        var children: JSSyntaxTree[] = [];

        for (var i: number = 0; i < this.children.length; i++) {
            if (this.children[i] === undefined) {
                children.push(undefined);
            } else if (this.children[i].isTarget(targetId)) {
                children.push(expr);
            } else {
                children.push(this.children[i].substitute(targetId, expr));
            }
        }
        return this.cloneWithNewChildren(children);
    }

    cloneWithNewChildren(children: JSSyntaxTree[]): JSStatement {
        assert(false, "implement in derived class");
        return undefined;
    }
}

class JSBlock extends JSStatement {
    constructor(block: JSSyntaxTree[]) {
        super(block);
    }

    toString(indent: string): string {
        return this.children.map(function(c: JSSyntaxTree): string {
            return c.toString(indent);
        }).join("");
    }

    cloneWithNewChildren(children: JSSyntaxTree[]): JSBlock {
        return new JSBlock(children);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSBlock) {
            return super.isEqual(t);
        }
        return false;
    }
}

class JSFunction extends JSStatement {
    name: string;
    arguments: string;

    constructor(name: string, args: string, body: JSStatement[]) {
        super(body);
        this.name = name;
        this.arguments = args;
    }

    toString(indent: string): string {
        var bIndent: string = indent + "    ";

        return indent + "function " + this.name + "(" + this.arguments + ") {" +
            this.children.map(function(c: JSStatement): string {
                return c.toString(bIndent);
            }).join("") +
            indent + "}\n";
    }

    cloneWithNewChildren(children: JSStatement[]): JSFunction {
        return new JSFunction(this.name, this.arguments, children);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSFunction) {
            return this.name === t.name && this.arguments === t.arguments &&
                   super.isEqual(t);
        }
        return false;
    }
}

class JSIf extends JSStatement {

    constructor(condition: JSExpression, thenPart: JSStatement, elsePart: JSStatement) {
        super([condition, thenPart, elsePart]);
    }

    toString(indent: string): string {
        var bIndent: string = indent + "    ";

        if (this.children[2] === undefined) {
            return indent + "if (" + this.children[0].toString(undefined) + ") {" +
                   this.children[1].toString(bIndent) +
                   indent + "}";
        } else {
            var elsePart: string = this.children[2] instanceof JSIf?
                this.children[2].toString(indent).substr(indent.length - 1):
                "{" + this.children[2].toString(bIndent) + indent + "}";
            return indent + "if (" + this.children[0].toString(undefined) + ") {" +
                   this.children[1].toString(bIndent) +
                   indent + "} else " + elsePart;
        }
    }

    cloneWithNewChildren(children: JSSyntaxTree[]): JSIf {
        return new JSIf(<JSExpression>(children[0]), children[1], children[2]);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSIf) {
            return super.isEqual(t);
        }
        return false;
    }
}

class JSForLoop extends JSStatement {

    constructor(init: JSSyntaxTree, cond: JSExpression, cont: JSExpression, stat: JSStatement) {
        super([init, cond, cont, stat]);
    }

    toString(indent: string): string {
        var bIndent: string = indent + "    ";

        return indent + "for (" + this.children[0].toString(undefined) + "; " +
            this.children[1].toString(undefined) + "; " +
            this.children[2].toString(undefined) + ") {" +
            this.children[3].toString(bIndent) +
            indent + "}";
    }

    cloneWithNewChildren(children: JSSyntaxTree[]): JSForLoop {
        return new JSForLoop(children[0], <JSExpression>children[1], <JSExpression>children[2], children[3]);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSForLoop) {
            return super.isEqual(t);
        }
        return false;
    }
}

class JSReturn extends JSStatement {
    constructor(expr: JSExpression) {
        super([expr]);
    }

    toString(indent: string): string {
        if (this.children[0] === undefined) {
            return indent + "return;";
        } else {
            return indent + "return " + this.children[0].toString(undefined) + ";";
        }
    }

    cloneWithNewChildren(children: JSExpression[]): JSReturn {
        return new JSReturn(children[0]);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSReturn) {
            return super.isEqual(t);
        }
        return false;
    }
}

class JSExpression extends JSSyntaxTree {
    children: JSExpression[];
    prio: number;
    leftToRight: boolean = true;

    isAssociative(expr: JSExpression): boolean {
        return false;
    }

    substitute(targetId: number, expr: JSExpression): JSExpression {
        var children: JSExpression[] = [];

        for (var i: number = 0; i < this.children.length; i++) {
            if (this.children[i] === undefined) {
                children.push(undefined);
            } else if (this.children[i].isTarget(targetId)) {
                children.push(expr);
            } else {
                children.push(this.children[i].substitute(targetId, expr));
            }
        }
        return this.cloneWithNewChildren(children);
    }

    cloneWithNewChildren(children: JSExpression[]): JSExpression {
        assert(false, "implement in derived class");
        return undefined;
    }
}

class JSDeclaration extends JSExpression {
    constructor(variables: JSExpression[]) {
        super(variables);
        this.prio = 1;
    }

    toString(indent: string): string {
        var str: string = "var "+ this.children.map(function(c: JSStatement): string {
                return c.toString(undefined);
        }).join(", ");

        return indent === undefined? str: indent + str + ";";
    }

    cloneWithNewChildren(children: JSExpression[]): JSDeclaration {
        return new JSDeclaration(children);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSDeclaration) {
            return super.isEqual(t);
        }
        return false;
    }
}

class JSOperator extends JSExpression {
    operator: string;

    static priorities: {[operator: string]: number} = {
        "**": 14,
        "*": 14,
        "/": 14,
        "%": 14,
        "+": 13,
        "-": 13,
        "<<": 12,
        ">>": 12,
        "<": 11,
        "<=": 11,
        ">": 11,
        ">=": 11,
        "in": 11,
        "instanceof": 11,
        "==": 10,
        "!=": 10,
        "===": 10,
        "!==": 10,
        "&": 9,
        "|": 8,
        "^": 7,
        "&&": 6,
        "||": 5,
        "=": 2,
        ",": 2
    };
    static rightToLeft: {[operator: string]: boolean} = {
        "**": true,
        "=": true
    }
    static associative: {[operator: string]: boolean} = {
        "*": true,
        "+": true,
        "&": true,
        "|": true,
        "&&": true,
        "||": true,
        "=": true,
        ",": true
    };

    constructor(operator: string, args: JSExpression[]) {
        super(args);
        this.operator = operator;
        this.prio = JSOperator.priorities[operator];
        this.leftToRight = !(operator in JSOperator.rightToLeft);
    }

    toString(indent: string): string {
        var pc: JSExpression = this.children[0];
        var str: string = pc.toString(undefined);

        for (var i: number = 1; i < this.children.length; i++) {
            var c: JSExpression = this.children[i];
            if (pc.prio > this.prio || this.isAssociative(pc) ||
                  (pc.prio === this.prio && pc.leftToRight && this.leftToRight)) {
                str += " " + this.operator + " ";
            } else {
                str = "(" + str + ")" + " " + this.operator + " ";
            }
            if (c.prio > this.prio || this.isAssociative(c) ||
                  (c.prio === this.prio && c.leftToRight && this.leftToRight)) {
                str += c.toString(undefined);
            } else {
                str += "(" + c.toString(undefined) + ")";
            }
            pc = this;
        }
        return indent === undefined? str: indent + str + ";";
    }

    isAssociative(expr: JSExpression): boolean {
        if (expr instanceof JSOperator) {
            return this.operator === expr.operator &&
                   this.operator in JSOperator.associative;
        }
        return false;
    }

    cloneWithNewChildren(children: JSExpression[]): JSOperator {
        return new JSOperator(this.operator, children);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSOperator) {
            return this.operator === t.operator && super.isEqual(t);
        }
        return false;
    }
}

class JSMonadicOperator extends JSExpression {
    operator: string;

    constructor(operator: string, argument: JSExpression) {
        super([argument]);
        this.operator = operator;
        this.prio = 15;
    }

    toString(indent: string): string {
        var str: string = this.operator +
            (this.children[0].prio <= this.prio?
             "(" + this.children[0].toString(undefined) + ")":
             this.children[0].toString(undefined));

        return indent === undefined? str: indent + str + ";";
    }

    cloneWithNewChildren(children: JSExpression[]): JSMonadicOperator {
        return new JSMonadicOperator(this.operator, children[0]);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSMonadicOperator) {
            return this.operator === t.operator && super.isEqual(t);
        }
        return false;
    }
}

class JSPostOp extends JSExpression {
    operator: string;

    constructor(operator: string, argument: JSExpression) {
        super([argument]);
        this.operator = operator;
        this.prio = 17;
    }

    toString(indent: string): string {
        var str: string = (this.children[0].prio <= this.prio?
                "(" + this.children[0].toString(undefined) + ")":
                this.children[0].toString(undefined)) +
            this.operator;

        return indent === undefined? str: indent + str + ";";
    }

    cloneWithNewChildren(children: JSExpression[]): JSPostOp {
        return new JSPostOp(this.operator, children[0]);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSPostOp) {
            return this.operator === t.operator && super.isEqual(t);
        }
        return false;
    }
}

class JSVariable extends JSExpression {
    name: string;

    constructor(name: string) {
        super([]);
        this.name = name;
        this.prio = 20;
    }

    toString(indent: string): string {
        var str: string = this.name;

        return indent === undefined? str: indent + str + ";";
    }

    cloneWithNewChildren(children: JSSyntaxTree[]): JSVariable {
        return new JSVariable(this.name);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSVariable) {
            return this.name === t.name && super.isEqual(t);
        }
        return false;
    }
}

class JSCond extends JSExpression {
    constructor(condition: JSExpression, thenPart: JSStatement, elsePart: JSStatement) {
        super([condition, thenPart, elsePart]);
        this.prio = 4;
        this.leftToRight = false;
    }

    toString(indent: string): string {
        var str: string = this.children[0].toString(undefined) + "? " + 
            this.children[1].toString(undefined) + ": " +
            this.children[2].toString(undefined);

        return indent === undefined? str: indent + str + ";";
    }

    cloneWithNewChildren(children: JSExpression[]): JSCond {
        return new JSCond(children[0], children[1], children[2]);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSCond) {
            return super.isEqual(t);
        }
        return false;
    }
}

class JSConstant extends JSExpression {
    value: any;

    constructor(value: any) {
        super([]);
        this.value = value;
        this.prio = 20;
    }

    toString(indent: string): string {
        var str: string = this.value === undefined? "undefined": safeJSONStringify(this.value);

        return indent === undefined? str: indent + str + ";";
    }

    cloneWithNewChildren(children: JSSyntaxTree[]): JSConstant {
        return new JSConstant(this.value);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSConstant) {
            return this.value === t.value;
        }
        return false;
    }
}

class JSNOP extends JSExpression {
    constructor() {
        super([]);
    }

    toString(indent: string): string {
        var str: string = "NOP";

        return indent === undefined? str: indent + str + ";";
    }

    cloneWithNewChildren(children: JSExpression[]): JSNOP {
        return this;
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSNOP) {
            return true;
        }
        return false;
    }
}

class JSTrue extends JSConstant {
    constructor() {
        super([]);
    }

    toString(indent: string): string {
        var str: string = "true";

        return indent === undefined? str: indent + str + ";";
    }

    cloneWithNewChildren(children: JSSyntaxTree[]): JSTrue {
        return this;
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSTrue) {
            return true;
        }
        return false;
    }
}

class JSFalse extends JSConstant {
    constructor() {
        super([]);
    }

    toString(indent: string): string {
        var str: string = "false";

        return indent === undefined? str: indent + str + ";";
    }

    cloneWithNewChildren(children: JSSyntaxTree[]): JSFalse {
        return this;
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSFalse) {
            return true;
        }
        return false;
    }
}

class JSSubstitutionTarget extends JSExpression {
    targetId: number;

    constructor(targetId: number) {
        super([]);
        this.targetId = targetId;
    }

    isTarget(targetId: number): boolean {
        return this.targetId === targetId;
    }

    substitute(targetId: number, expr: JSSyntaxTree): JSExpression {
        // NOTE: the cast to JSExpression isn't kosher. The cause is the
        // distinction between JSStatement and JSExpression and the lack of
        // expressing that in the return type (see also the repeated versions of
        // substitute)
        return this.targetId === targetId? <JSExpression>expr: this;
    }

    cloneWithNewChildren(children: JSSyntaxTree[]): JSSubstitutionTarget {
        return this;
    }

    toString(indent: string): string {
        var str: string = "#" + this.targetId;

        return indent === undefined? str: indent + str + ";";
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSSubstitutionTarget) {
            return this.targetId === t.targetId;
        }
        return false;
    }
}

class JSSubscript extends JSExpression {
    constructor(variable: JSExpression, subscript: JSExpression) {
        super([variable, subscript]);
        this.prio = 18;
    }

    toString(indent: string): string {
        var str: string = this.children[0].toString(undefined) + "[" +
               this.children[1].toString(undefined) + "]";

        return indent === undefined? str: indent + str + ";";
    }

    cloneWithNewChildren(children: JSExpression[]): JSSubscript {
        return new JSSubscript(children[0], children[1]);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSSubscript) {
            return super.isEqual(t);
        }
        return false;
    }
}

class JSField extends JSExpression {
    field: string;

    constructor(expr: JSExpression, field: string) {
        super([expr]);
        this.field = field;
        this.prio = 18;
    }

    toString(indent: string): string {
        var str: string = jsIdentifierRegExp.test(this.field) && this.field !== "class"?
        this.children[0].toString(undefined) + "." + this.field:
        this.children[0].toString(undefined) + "[\"" + this.field + "\"]";

        return indent === undefined? str: indent + str + ";";
    }

    cloneWithNewChildren(children: JSExpression[]): JSField {
        return new JSField(children[0], this.field);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSField) {
            return this.field === t.field && super.isEqual(t);
        }
        return false;
    }
}

class JSFunctionCall extends JSExpression {
    constructor(func: JSExpression, args: JSExpression[]) {
        super([func].concat(args));
        this.prio = 17;
    }

    toString(indent: string): string {
        var str: string = this.children[0].toString(undefined) + "(" +
            this.children.slice(1).map(function(c: JSExpression): string {
                return c.toString(undefined);
            }).join(", ") + ")";

        return indent === undefined? str: indent + str + ";";
    }

    cloneWithNewChildren(children: JSExpression[]): JSFunctionCall {
        return new JSFunctionCall(children[0], children.slice(1));
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSFunctionCall) {
            return super.isEqual(t);
        }
        return false;
    }
}

class JSAttributeValue extends JSExpression {
    attrs: string[];

    constructor(attrs: string[], values: JSExpression[]) {
        super(values);
        this.attrs = attrs;
    }

    toString(indent: string): string {
        var str: string = "";

        for (var i: number = 0; i < this.attrs.length; i++) {
            if (i !== 0) str += ", ";
            str += this.attrs[i] + ": " + this.children[i].toString(undefined);
        }
        var str: string = "{" + str + "}";

        return indent === undefined? str: indent + str + ";";
    }

    cloneWithNewChildren(children: JSExpression[]): JSAttributeValue {
        return new JSAttributeValue(this.attrs, children);
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSAttributeValue) {
            return valueEqual(this.attrs, t.attrs) && super.isEqual(t);
        }
        return false;
    }
}

class JSType extends JSExpression {
    type: string;

    constructor(type: string) {
        super([]);
        this.type = type;
    }

    toString(indent: string): string {
        var str: string = this.type;

        return indent === undefined? str: indent + str + ";";
    }

    cloneWithNewChildren(children: JSSyntaxTree[]): JSType {
        return this;
    }

    isEqual(t: JSSyntaxTree): boolean {
        if (t instanceof JSType) {
            return this.type === t.type;
        }
        return false;
    }
}

function jsValueInRange(min: any, value: JSExpression, max: any, closedLower: boolean, closedUpper: boolean): JSExpression {
    return new JSOperator("&&", [
        new JSOperator(closedLower? "<=": "<", [new JSConstant(min), value]),
        new JSOperator(closedUpper? "<=": "<", [value, new JSConstant(max)]),
    ]);
}
