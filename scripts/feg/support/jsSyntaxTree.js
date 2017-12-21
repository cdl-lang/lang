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
class JSSyntaxTree {
    constructor(children) {
        this.children = children;
    }
    // Note: indent should start with \n
    toString(indent) {
        assert(false, "implement in derived class");
        return undefined;
    }
    substitute(targetId, expr) {
        var children = [];
        for (var i = 0; i < this.children.length; i++) {
            if (this.children[i] === undefined) {
                children.push(undefined);
            }
            else if (this.children[i].isTarget(targetId)) {
                children.push(expr);
            }
            else {
                children.push(this.children[i].substitute(targetId, expr));
            }
        }
        return this.cloneWithNewChildren(children);
    }
    isTarget(targetId) {
        return false;
    }
    cloneWithNewChildren(children) {
        assert(false, "implement in derived class");
        return undefined;
    }
    isEqual(t) {
        return arrayEqual(this.children, t.children);
    }
}
class JSStatement extends JSSyntaxTree {
    substitute(targetId, expr) {
        var children = [];
        for (var i = 0; i < this.children.length; i++) {
            if (this.children[i] === undefined) {
                children.push(undefined);
            }
            else if (this.children[i].isTarget(targetId)) {
                children.push(expr);
            }
            else {
                children.push(this.children[i].substitute(targetId, expr));
            }
        }
        return this.cloneWithNewChildren(children);
    }
    cloneWithNewChildren(children) {
        assert(false, "implement in derived class");
        return undefined;
    }
}
class JSBlock extends JSStatement {
    constructor(block) {
        super(block);
    }
    toString(indent) {
        return this.children.map(function (c) {
            return c.toString(indent);
        }).join("");
    }
    cloneWithNewChildren(children) {
        return new JSBlock(children);
    }
    isEqual(t) {
        if (t instanceof JSBlock) {
            return super.isEqual(t);
        }
        return false;
    }
}
class JSFunction extends JSStatement {
    constructor(name, args, body) {
        super(body);
        this.name = name;
        this.arguments = args;
    }
    toString(indent) {
        var bIndent = indent + "    ";
        return indent + "function " + this.name + "(" + this.arguments + ") {" +
            this.children.map(function (c) {
                return c.toString(bIndent);
            }).join("") +
            indent + "}\n";
    }
    cloneWithNewChildren(children) {
        return new JSFunction(this.name, this.arguments, children);
    }
    isEqual(t) {
        if (t instanceof JSFunction) {
            return this.name === t.name && this.arguments === t.arguments &&
                super.isEqual(t);
        }
        return false;
    }
}
class JSIf extends JSStatement {
    constructor(condition, thenPart, elsePart) {
        super([condition, thenPart, elsePart]);
    }
    toString(indent) {
        var bIndent = indent + "    ";
        if (this.children[2] === undefined) {
            return indent + "if (" + this.children[0].toString(undefined) + ") {" +
                this.children[1].toString(bIndent) +
                indent + "}";
        }
        else {
            var elsePart = this.children[2] instanceof JSIf ?
                this.children[2].toString(indent).substr(indent.length - 1) :
                "{" + this.children[2].toString(bIndent) + indent + "}";
            return indent + "if (" + this.children[0].toString(undefined) + ") {" +
                this.children[1].toString(bIndent) +
                indent + "} else " + elsePart;
        }
    }
    cloneWithNewChildren(children) {
        return new JSIf((children[0]), children[1], children[2]);
    }
    isEqual(t) {
        if (t instanceof JSIf) {
            return super.isEqual(t);
        }
        return false;
    }
}
class JSForLoop extends JSStatement {
    constructor(init, cond, cont, stat) {
        super([init, cond, cont, stat]);
    }
    toString(indent) {
        var bIndent = indent + "    ";
        return indent + "for (" + this.children[0].toString(undefined) + "; " +
            this.children[1].toString(undefined) + "; " +
            this.children[2].toString(undefined) + ") {" +
            this.children[3].toString(bIndent) +
            indent + "}";
    }
    cloneWithNewChildren(children) {
        return new JSForLoop(children[0], children[1], children[2], children[3]);
    }
    isEqual(t) {
        if (t instanceof JSForLoop) {
            return super.isEqual(t);
        }
        return false;
    }
}
class JSReturn extends JSStatement {
    constructor(expr) {
        super([expr]);
    }
    toString(indent) {
        if (this.children[0] === undefined) {
            return indent + "return;";
        }
        else {
            return indent + "return " + this.children[0].toString(undefined) + ";";
        }
    }
    cloneWithNewChildren(children) {
        return new JSReturn(children[0]);
    }
    isEqual(t) {
        if (t instanceof JSReturn) {
            return super.isEqual(t);
        }
        return false;
    }
}
class JSExpression extends JSSyntaxTree {
    constructor() {
        super(...arguments);
        this.leftToRight = true;
    }
    isAssociative(expr) {
        return false;
    }
    substitute(targetId, expr) {
        var children = [];
        for (var i = 0; i < this.children.length; i++) {
            if (this.children[i] === undefined) {
                children.push(undefined);
            }
            else if (this.children[i].isTarget(targetId)) {
                children.push(expr);
            }
            else {
                children.push(this.children[i].substitute(targetId, expr));
            }
        }
        return this.cloneWithNewChildren(children);
    }
    cloneWithNewChildren(children) {
        assert(false, "implement in derived class");
        return undefined;
    }
}
class JSDeclaration extends JSExpression {
    constructor(variables) {
        super(variables);
        this.prio = 1;
    }
    toString(indent) {
        var str = "var " + this.children.map(function (c) {
            return c.toString(undefined);
        }).join(", ");
        return indent === undefined ? str : indent + str + ";";
    }
    cloneWithNewChildren(children) {
        return new JSDeclaration(children);
    }
    isEqual(t) {
        if (t instanceof JSDeclaration) {
            return super.isEqual(t);
        }
        return false;
    }
}
class JSOperator extends JSExpression {
    constructor(operator, args) {
        super(args);
        this.operator = operator;
        this.prio = JSOperator.priorities[operator];
        this.leftToRight = !(operator in JSOperator.rightToLeft);
    }
    toString(indent) {
        var pc = this.children[0];
        var str = pc.toString(undefined);
        for (var i = 1; i < this.children.length; i++) {
            var c = this.children[i];
            if (pc.prio > this.prio || this.isAssociative(pc) ||
                (pc.prio === this.prio && pc.leftToRight && this.leftToRight)) {
                str += " " + this.operator + " ";
            }
            else {
                str = "(" + str + ")" + " " + this.operator + " ";
            }
            if (c.prio > this.prio || this.isAssociative(c) ||
                (c.prio === this.prio && c.leftToRight && this.leftToRight)) {
                str += c.toString(undefined);
            }
            else {
                str += "(" + c.toString(undefined) + ")";
            }
            pc = this;
        }
        return indent === undefined ? str : indent + str + ";";
    }
    isAssociative(expr) {
        if (expr instanceof JSOperator) {
            return this.operator === expr.operator &&
                this.operator in JSOperator.associative;
        }
        return false;
    }
    cloneWithNewChildren(children) {
        return new JSOperator(this.operator, children);
    }
    isEqual(t) {
        if (t instanceof JSOperator) {
            return this.operator === t.operator && super.isEqual(t);
        }
        return false;
    }
}
JSOperator.priorities = {
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
JSOperator.rightToLeft = {
    "**": true,
    "=": true
};
JSOperator.associative = {
    "*": true,
    "+": true,
    "&": true,
    "|": true,
    "&&": true,
    "||": true,
    "=": true,
    ",": true
};
class JSMonadicOperator extends JSExpression {
    constructor(operator, argument) {
        super([argument]);
        this.operator = operator;
        this.prio = 15;
    }
    toString(indent) {
        var str = this.operator +
            (this.children[0].prio <= this.prio ?
                "(" + this.children[0].toString(undefined) + ")" :
                this.children[0].toString(undefined));
        return indent === undefined ? str : indent + str + ";";
    }
    cloneWithNewChildren(children) {
        return new JSMonadicOperator(this.operator, children[0]);
    }
    isEqual(t) {
        if (t instanceof JSMonadicOperator) {
            return this.operator === t.operator && super.isEqual(t);
        }
        return false;
    }
}
class JSPostOp extends JSExpression {
    constructor(operator, argument) {
        super([argument]);
        this.operator = operator;
        this.prio = 17;
    }
    toString(indent) {
        var str = (this.children[0].prio <= this.prio ?
            "(" + this.children[0].toString(undefined) + ")" :
            this.children[0].toString(undefined)) +
            this.operator;
        return indent === undefined ? str : indent + str + ";";
    }
    cloneWithNewChildren(children) {
        return new JSPostOp(this.operator, children[0]);
    }
    isEqual(t) {
        if (t instanceof JSPostOp) {
            return this.operator === t.operator && super.isEqual(t);
        }
        return false;
    }
}
class JSVariable extends JSExpression {
    constructor(name) {
        super([]);
        this.name = name;
        this.prio = 20;
    }
    toString(indent) {
        var str = this.name;
        return indent === undefined ? str : indent + str + ";";
    }
    cloneWithNewChildren(children) {
        return new JSVariable(this.name);
    }
    isEqual(t) {
        if (t instanceof JSVariable) {
            return this.name === t.name && super.isEqual(t);
        }
        return false;
    }
}
class JSCond extends JSExpression {
    constructor(condition, thenPart, elsePart) {
        super([condition, thenPart, elsePart]);
        this.prio = 4;
        this.leftToRight = false;
    }
    toString(indent) {
        var str = this.children[0].toString(undefined) + "? " +
            this.children[1].toString(undefined) + ": " +
            this.children[2].toString(undefined);
        return indent === undefined ? str : indent + str + ";";
    }
    cloneWithNewChildren(children) {
        return new JSCond(children[0], children[1], children[2]);
    }
    isEqual(t) {
        if (t instanceof JSCond) {
            return super.isEqual(t);
        }
        return false;
    }
}
class JSConstant extends JSExpression {
    constructor(value) {
        super([]);
        this.value = value;
        this.prio = 20;
    }
    toString(indent) {
        var str = this.value === undefined ? "undefined" : safeJSONStringify(this.value);
        return indent === undefined ? str : indent + str + ";";
    }
    cloneWithNewChildren(children) {
        return new JSConstant(this.value);
    }
    isEqual(t) {
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
    toString(indent) {
        var str = "NOP";
        return indent === undefined ? str : indent + str + ";";
    }
    cloneWithNewChildren(children) {
        return this;
    }
    isEqual(t) {
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
    toString(indent) {
        var str = "true";
        return indent === undefined ? str : indent + str + ";";
    }
    cloneWithNewChildren(children) {
        return this;
    }
    isEqual(t) {
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
    toString(indent) {
        var str = "false";
        return indent === undefined ? str : indent + str + ";";
    }
    cloneWithNewChildren(children) {
        return this;
    }
    isEqual(t) {
        if (t instanceof JSFalse) {
            return true;
        }
        return false;
    }
}
class JSSubstitutionTarget extends JSExpression {
    constructor(targetId) {
        super([]);
        this.targetId = targetId;
    }
    isTarget(targetId) {
        return this.targetId === targetId;
    }
    substitute(targetId, expr) {
        // NOTE: the cast to JSExpression isn't kosher. The cause is the
        // distinction between JSStatement and JSExpression and the lack of
        // expressing that in the return type (see also the repeated versions of
        // substitute)
        return this.targetId === targetId ? expr : this;
    }
    cloneWithNewChildren(children) {
        return this;
    }
    toString(indent) {
        var str = "#" + this.targetId;
        return indent === undefined ? str : indent + str + ";";
    }
    isEqual(t) {
        if (t instanceof JSSubstitutionTarget) {
            return this.targetId === t.targetId;
        }
        return false;
    }
}
class JSSubscript extends JSExpression {
    constructor(variable, subscript) {
        super([variable, subscript]);
        this.prio = 18;
    }
    toString(indent) {
        var str = this.children[0].toString(undefined) + "[" +
            this.children[1].toString(undefined) + "]";
        return indent === undefined ? str : indent + str + ";";
    }
    cloneWithNewChildren(children) {
        return new JSSubscript(children[0], children[1]);
    }
    isEqual(t) {
        if (t instanceof JSSubscript) {
            return super.isEqual(t);
        }
        return false;
    }
}
class JSField extends JSExpression {
    constructor(expr, field) {
        super([expr]);
        this.field = field;
        this.prio = 18;
    }
    toString(indent) {
        var str = jsIdentifierRegExp.test(this.field) && this.field !== "class" ?
            this.children[0].toString(undefined) + "." + this.field :
            this.children[0].toString(undefined) + "[\"" + this.field + "\"]";
        return indent === undefined ? str : indent + str + ";";
    }
    cloneWithNewChildren(children) {
        return new JSField(children[0], this.field);
    }
    isEqual(t) {
        if (t instanceof JSField) {
            return this.field === t.field && super.isEqual(t);
        }
        return false;
    }
}
class JSFunctionCall extends JSExpression {
    constructor(func, args) {
        super([func].concat(args));
        this.prio = 17;
    }
    toString(indent) {
        var str = this.children[0].toString(undefined) + "(" +
            this.children.slice(1).map(function (c) {
                return c.toString(undefined);
            }).join(", ") + ")";
        return indent === undefined ? str : indent + str + ";";
    }
    cloneWithNewChildren(children) {
        return new JSFunctionCall(children[0], children.slice(1));
    }
    isEqual(t) {
        if (t instanceof JSFunctionCall) {
            return super.isEqual(t);
        }
        return false;
    }
}
class JSAttributeValue extends JSExpression {
    constructor(attrs, values) {
        super(values);
        this.attrs = attrs;
    }
    toString(indent) {
        var str = "";
        for (var i = 0; i < this.attrs.length; i++) {
            if (i !== 0)
                str += ", ";
            str += this.attrs[i] + ": " + this.children[i].toString(undefined);
        }
        var str = "{" + str + "}";
        return indent === undefined ? str : indent + str + ";";
    }
    cloneWithNewChildren(children) {
        return new JSAttributeValue(this.attrs, children);
    }
    isEqual(t) {
        if (t instanceof JSAttributeValue) {
            return valueEqual(this.attrs, t.attrs) && super.isEqual(t);
        }
        return false;
    }
}
class JSType extends JSExpression {
    constructor(type) {
        super([]);
        this.type = type;
    }
    toString(indent) {
        var str = this.type;
        return indent === undefined ? str : indent + str + ";";
    }
    cloneWithNewChildren(children) {
        return this;
    }
    isEqual(t) {
        if (t instanceof JSType) {
            return this.type === t.type;
        }
        return false;
    }
}
function jsValueInRange(min, value, max, closedLower, closedUpper) {
    return new JSOperator("&&", [
        new JSOperator(closedLower ? "<=" : "<", [new JSConstant(min), value]),
        new JSOperator(closedUpper ? "<=" : "<", [value, new JSConstant(max)]),
    ]);
}
