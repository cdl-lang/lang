#!llerror
#!main

/* Compile as: ~/work/llgen/llgen +ts cdl.ll */

{

import {cdlBuiltInFunctions} from "./aux/cdlBuiltInFunctions";

export let errors: string[] = [];

function llerror(... args: any[]): void {
    errors.push(inputFileName + ":" + String(llLineNumber) + ": " + sprintf(args));
}

let cdlJsFunctions: {[name: string]: boolean} = {
    o: true,
    r: true,
    s: true,
    n: true,
    c: true,
    Rcc: true,
    Rco: true,
    Roc: true,
    Roo: true,
    atomic: true,
    push: true,
};

export var cdlPreDefinedSymbols: {[name: string]: string} = {
    _: "_",
    mustBeDefined: "mustBeDefined",
    unmatched: "unmatched",
    ascending: "ascending",
    descending: "descending",
    true: "true",
    false: "false",
    null: "null",
    Infinity: "Infinity",
    superclass: "superclass"
};

export var zeroArgFunctions: {[name: string]: boolean} = {
    embedded: true,
    embeddedStar: true,
    embedding: true,
    embeddingStar: true,
    expressionOf: true,
    me: true,
    message: true,
    myMessage: true,
    referredOf: true
};

function lookupFunction(sym: string): LangId {
    switch (sym) {
        case "+": return new LangId("plus");
        case "-": return new LangId("minus");
        case "*": return new LangId("mul");
        case "**": return new LangId("pow");
        case "/": return new LangId("div");
        case "%": return new LangId("mod");
        case "<": return new LangId("lessThan");
        case "<=": return new LangId("lessThanOrEqual");
        case ">": return new LangId("greaterThan");
        case ">=": return new LangId("greaterThanOrEqual");
        case "==": return new LangId("equal");
        case "!=": return new LangId("notEqual");
        case "~": return new LangId("match");
        case "||": return new LangId("or");
        case "&&": return new LangId("and");
        case "!": return new LangId("not");
        case "uminus": return new LangId("uminus");
        case "not": return new LangId("not");
        default:
            console.log("ERROR: lookUpFunction", sym);
            return new LangId(sym);
    }
}

// Ignore the use of _
function ignoreIdentifierUse(ident: string): boolean {
    return ident === "_";
}

// an o(...) doesn't start an expression, but other funtions (r, s, ...) do.
function transparentCdlFunction(ident: string): boolean {
    return ident === "o";
}

export let conv: string[] = [];
let lineStr: string = "";

function initParser(): void {
    conv = [];
    lineStr = "";
}

function output(str: string): void {
    lineStr += str;
}

const lineEnding = new RegExp("\r?\n");

function newline(): void {
    conv.push.apply(conv, lineStr.split(lineEnding));
    lineStr = "";
}

abstract class LangElt {
    abstract toString(indent?: string): string;
}

type CDLValue = number | string | boolean | LangElt | AV | Projector;

type AV = {[attr: string]: CDLValue};

class CompFunction extends LangElt {
    constructor(public funcName: string, public args: CDLValue[] = []) {
        super();
    }

    push(arg: CDLValue): void {
        this.args.push(arg);
    }

    toString(indent?: string): string {
        let nIndent: string|undefined = indent === undefined? undefined: indent + "    ";

        return !(this.funcName in cdlJsFunctions)?
                "[" + [this.funcName].concat(this.args.map(a => cdlify(a))).join(", ") + "]":
               indent === undefined || this.args.length === 0?
                this.funcName + "(" + this.args.map(a => cdlify(a)).join(", ") + ")":
                this.funcName + "(" + this.args.map(a => nIndent +
                    cdlify(a, nIndent)).join(",\n").substr(nIndent!.length) +
                    "\n"+ indent + ")";
    }
}

class LangId extends LangElt {
    constructor(public id: string) {
        super();
    }

    toString(indent?: string): string {
        return this.id;
    }
}

class AttributeProjectionPath extends LangElt {
    constructor(public path: string[], public data: CDLValue) {
        super();
    }

    extend(id: string): void {
        this.path.push(id);
    }

    toString(indent?: string): string {
        let revPathStr: string = "_";
        let postStr: string = "";

        for (let i: number = this.path.length - 1; i >= 0; i--) {
            revPathStr = "{" + this.path[i] + ": " + revPathStr;
            postStr += "}";
        }
        return "[" + revPathStr + postStr + ", " + cdlify(this.data, indent) + "]";
    }
}

class GlobalJSId extends LangElt {
    constructor(public id: string) {
        super();
    }

    toString(indent?: string): string {
        return this.id;
    }
}

class Projector extends LangElt {
    toString(indent?: string): string {
        return "_";
    }
}

function cdlify(v: any, indent?: string): string {
    if (v instanceof Object) {
        if (v instanceof LangElt) {
            return v.toString(indent);
        }
        if (v instanceof Array) {
            return "[" + v.map(e => cdlify(e)).join(", ") + "]";
        }
        let str: string = "";
        let first: boolean = true;
        let nIndent: string|undefined = indent === undefined? undefined: indent + "    ";
        for (let attr in v) {
            if (indent !== undefined) {
                if (!first) {
                    str += ",\n";
                }
                str += nIndent;
            } else if (!first) {
                str += ", ";
            }
            str += attr + ": " + cdlify(v[attr], nIndent);
            first = false;
        }
        return indent === undefined? "{" + str + "}":
               "{\n" + str + "\n" + indent + "}";
    }
    return v;
}

function isProjector(v: CDLValue): boolean {
    return v instanceof LangId && v.id === "_";
}

function qarg(q: CDLValue): [string|undefined, CDLValue|undefined] {
    if (!(q instanceof Array && q.length === 2 && q[0] instanceof Object)) {
        return [undefined, undefined];
    }
    const qAttr: string[] = Object.keys(q[0]);
    if (!(qAttr.length !== 1 || !isProjector(q[0][qAttr[0]]))) {
        return [undefined, undefined];
    }
    return [qAttr[0], q[1]];
}

function addParametersToContext(expr: CDLValue, newContext: any): CDLValue {
    let parameters = new CompFunction("o");

    if (expr instanceof CompFunction && expr.funcName === "o") {
        for (let i: number = 0; i < expr.args.length; i++) {
            let arg = expr.args[i];
            if (arg instanceof AttributeProjectionPath && arg.path.length === 1) {
                newContext[arg.path[0]] = true;
                parameters.push('"' + arg.path[0] + '"');
            } else {
                llerror("not a parameter list");
                break;
            }
        }
    } else if (expr instanceof AttributeProjectionPath && expr.path.length === 1) {
        newContext[expr.path[0]] = true;
        parameters.push('"' + expr.path[0] + '"');
    } else {
        llerror("not a parameter list");
    }
    return parameters;
}

}

leftParenthesis = "\(".
rightParenthesis = "\)".
leftBracket = "\[".
rightBracket = "\]".
leftBrace = "{".
rightBrace = "}".
comma = ",".
dot = "\.".
colon = ":".
semicolon = ";".
assign = "=".
question_mark = "\?".
number = "((([0-9]+(\.[0-9]*)?)|([0-9]*\.[0-9]+))([Ee][+-]?[0-9]+)?)".
string = "(\"([^\"]|\\\")*\")|('([^']|\\')*')".
regexp = "/([^*\r\n/]|\\/)([^/\r\n]|\\/)*/[gimuy]*".
identifier = "[$a-zA-Z_][$a-zA-Z_0-9]*".
varSym = "var" KEYWORD identifier.
include = "//[ \t]*%%[a-z]+%%:[ \t]*((<[^>\n]+>)|(\"([^\"]|\\\")+\")) *".
pipe_symbol = "\|".
or_keyword = "\|\|".
and_keyword = "&&".
not_keyword = "!".
comparison_sym = "[<>!=]=|[~<>]".
power_sym = "\*\*".
mult_sym = "[/%]".
asterisk = "\*".
caret = "\^".
hash = "#".
add_sym = "\+".
minus_sym = "-".
globalContextSymbol = "::".
functionSymbol = "=>".

IGNORE "[ \t\r\n]+".
IGNORE "//.*".
IGNORE "/\*([^*]|\*[^/])*\*/".

cdl_file:
    { initParser(); },
    (   include_line;
        semicolon, { output(lastSymbol); newline(); };
        definition;
        top_level_assignment
    ) SEQUENCE OPTION,
    { newline(); }.

include_line:
    include, { newline(); output(lastSymbol); newline(); }.

definition:
    varSym, { newline(); output(lastSymbol) },
    identifier, { output(" " + lastSymbol); },
    assign, { output(" " + lastSymbol + " "); },
    expression.

top_level_assignment:
    (identifier, { newline(); output(lastSymbol) }) CHAIN (dot, { output(lastSymbol) }),
    assign, { output(" " + lastSymbol + " ") }, expression.

expression: prio0expression(new Object(), false, false) -> expr, { output(cdlify(expr, "")); }.

prio0expression(context any, inheritSpec boolean, firstArg boolean) -> expr CDLValue:
    prio1expression(context, inheritSpec, firstArg) -> expr,
    (
        functionSymbol, {
            let newContext = { ...context };
            let parameters: CDLValue = addParametersToContext(expr, newContext);
        },
        prio0expression(newContext, false, false) -> body,
        { expr = [new LangId("defun"), parameters, body]; };
        question_mark, {
            let alts: CompFunction = new CompFunction("o", []);
        },
        (
            prio1expression(context, inheritSpec, firstArg) -> match,
            colon,
            prio1expression(context, inheritSpec, firstArg) -> res,
            { alts.args.push({on: match, use: res}); }
        ) CHAIN pipe_symbol, {
            expr = [
                new LangId("cond"),
                expr,
                alts
            ];
        }
    ) OPTION.

prio1expression(context any, inheritSpec boolean, firstArg boolean) -> expr CDLValue:
    { let func: LangId|undefined = undefined; },
    (
        prio2expression(context, inheritSpec, firstArg) -> expr1, {
            expr = func === undefined? expr1: [func, expr!, expr1];
        }
    ) CHAIN (
        or_keyword, {
            func = lookupFunction(lastSymbol);
        }
    ).

prio2expression(context any, inheritSpec boolean, firstArg boolean) -> expr CDLValue:
    { let func: LangId|undefined = undefined; },
    (
        prio3expression(context, inheritSpec, firstArg) -> expr1, {
            expr = func === undefined? expr1: [func, expr!, expr1];
        }
    ) CHAIN (
        and_keyword, {
            func = lookupFunction(lastSymbol);
        }
    ).

prio3expression(context any, inheritSpec boolean, firstArg boolean) -> expr CDLValue:
    { let func: LangId|undefined = undefined; },
    (
        prio4expression(context, inheritSpec, firstArg) -> expr1, {
            expr = func === undefined? expr1: [func, expr!, expr1];
        }
    ) CHAIN (
        comparison_sym, {
            func = lookupFunction(lastSymbol);
        }
    ).

prio4expression(context any, inheritSpec boolean, firstArg boolean) -> expr CDLValue:
    { let func: LangId|undefined = undefined; },
    (
        prio5expression(context, inheritSpec, firstArg) -> expr1, {
            expr = func === undefined? expr1: [func, expr!, expr1];
        }
    ) CHAIN (
        (add_sym; minus_sym), {
            func = lookupFunction(lastSymbol);
        }
    ).

prio5expression(context any, inheritSpec boolean, firstArg boolean) -> expr CDLValue:
    { let func: LangId|undefined = undefined; },
    (
        prio6expression(context, inheritSpec, firstArg) -> expr1, {
            expr = func === undefined? expr1: [func, expr!, expr1];
        }
    ) CHAIN (
        (mult_sym; asterisk), {
            func = lookupFunction(lastSymbol);
        }
    ).

prio6expression(context any, inheritSpec boolean, firstArg boolean) -> expr CDLValue:
    { let func: LangId|undefined = undefined; },
    (
        prio7expression(context, inheritSpec, firstArg) -> expr1, {
            expr = func === undefined? expr1: [func, expr!, expr1];
        }
    ) CHAIN (
        power_sym, {
            func = lookupFunction(lastSymbol);
        }
    ).

prio7expression(context any, inheritSpec boolean, firstArg boolean) -> expr CDLValue = {[]}:
    /* Unary op */
    { let func: string = "not"; },
    (minus_sym, { func = "uminus"; }; not_keyword, { func = "not"; }),
    prio7expression(context, inheritSpec, firstArg) -> op,
    { expr = [lookupFunction(func), op]; };
    add_sym, prio7expression(context, inheritSpec, firstArg) -> expr;
    /* Identifier, projection, or function call */
    prio8expression(context, inheritSpec, firstArg) -> expr,
    (
        /* expression without projection query or function call: treat as
           local context or function call without arguments. In an inheritance
           specification, treat identifiers as strings. */
        {
            if (expr instanceof LangId) {
                if (inheritSpec && expr.id !== "superclass") {
                    expr = '"' + expr.id + '"';
                } else if (expr.id in cdlPreDefinedSymbols) {
                    // skip
                } else if (expr.id in zeroArgFunctions && !firstArg) {
                    expr = [expr];
                } else if (!(expr.id in cdlBuiltInFunctions && firstArg)) {
                    expr = new AttributeProjectionPath([expr.id], [new LangId("me")]);
                }
            }
        };
        query_or_call(expr, context, inheritSpec) -> expr SEQUENCE
    ).

query_or_call(expr_in CDLValue, context any, inheritSpec boolean) -> expr_out CDLValue = {[]}:
    /* projection on a single field */
    dot, identifier -> id, {
        if (expr_in instanceof LangId) {
            if (expr_in.id in zeroArgFunctions) {
                expr_in = [expr_in];
            } else {
                if (expr_in.id in cdlPreDefinedSymbols) {
                    llerror("illegal use of " + expr_in.id);
                }
                expr_in = new AttributeProjectionPath([expr_in.id], [new LangId("me")]);
            }
        }
        if (expr_in instanceof AttributeProjectionPath) {
            expr_in.extend(id);
            expr_out = expr_in;
        } else {
            expr_out = new AttributeProjectionPath([id], expr_in);
        }
    };
    /* function call */
    {
        let f: CDLValue[]|CompFunction;
        if (expr_in instanceof LangId && expr_in.id in cdlBuiltInFunctions) {
            f = [expr_in];
        } else if (expr_in instanceof LangId && expr_in.id in cdlJsFunctions) {
            f = new CompFunction(expr_in.id, []);
        } else if (expr_in instanceof LangId) {
            if (expr_in.id in cdlPreDefinedSymbols) {
                llerror("illegal use of " + expr_in.id);
            }
            f = [new AttributeProjectionPath([expr_in.id], [new LangId("me")])];
        } else {
            f = [expr_in];
        }
    },
    leftParenthesis,
    (
        (prio0expression(context, inheritSpec, false) -> arg, { f.push(arg); })
        CHAIN
        (comma, ON rightParenthesis BREAK)
    ) OPTION,
    rightParenthesis,
    { expr_out = f; }.

prio8expression(context any, inheritSpec boolean, firstArg boolean) -> expr CDLValue = {[]}:
    /* Parentheses */
    leftParenthesis, prio0expression(context, false, false) -> expr, rightParenthesis;
    /* Base syntax function or query application */
    { let args: CDLValue[] = []; },
    leftBracket,
    (prio0expression(context, false, args.length === 0) -> arg, { args.push(arg); })
    CHAIN
    (comma, ON rightBracket BREAK),
    rightBracket, { expr = args; };
    /* AV */
    attribute_value_expr(context, inheritSpec) -> expr;
    /* Atom */
    number, { expr = Number(lastSymbol); };
    /* Atom */
    string, { expr = lastSymbol; };
    /* Atom */
    regexp, { expr = lastSymbol; };
    /* JavaScript global */
    globalContextSymbol, identifier, { expr = new GlobalJSId(lastSymbol); };
    /* Bare context label, built-in function name, or defun */
    identifier, {
        expr = !inheritSpec && lastSymbol in context? '"' + lastSymbol + '"':
               new LangId(lastSymbol);
    }.

attribute_value_expr(context any, inheritSpec boolean) -> expr CDLValue:
    {
        let av: any = {};
        let attr: string = "";
    },
    leftBrace,
    (
        (
            (
                (identifier; string), { attr = lastSymbol === "class"? "\"class\"": lastSymbol; };
                (asterisk; caret; hash), { attr = lastSymbol; },
                identifier, { attr = '"' + attr + lastSymbol + '"'; }
            ),
            colon,
            prio0expression(context, attr === "\"class\"" || (inheritSpec && (attr === "name" || attr === "\"name\"")), false) -> val,
            { av[attr] = val; }
        ) CHAIN
        (
            comma,
            ON rightBrace BREAK
        )
    ) OPTION,
    rightBrace,
    { expr = av; }.
