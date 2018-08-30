#!llerror
#ignorebuffer
#keepignorebuffer
#main

/* Compile as: ~/work/llgen/llgen +ts old2new.ll */

{

import {cdlBuiltInFunctions} from "./aux/cdlBuiltInFunctions";

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
}

// Disabled by default
var zeroArgFunctions: {[name: string]: boolean} = {
    /* embedded: true,
    embeddedStar: true,
    embedding: true,
    embeddingStar: true,
    expressionOf: true,
    me: true,
    message: true,
    myMessage: true,
    prev: true,
    prevPlus: true,
    prevStar: true,
    referredOf: true */
};

let cdlPreDefinedSymbols: {[name: string]: boolean} = {
    superclass: true,
    _: true,
    mustBeDefined: true,
    unmatched: true,
    ascending: true,
    descending: true,
    true: true,
    false: true,
    null: true,
    Infinity: true
};

function llerror(... args: any[]): void {
    let msg = sprintf(args);

    process.stderr.write("error: " + lastSymbolPos.line + ":" + lastSymbolPos.position + ": " + msg + "\n");
}

const unquoteable = /^"[*^#]?[a-zA-Z_$][a-zA-Z_$0-9]*"$/;

function unquoteAttr(attr: string): string {
    return unquoteable.test(attr)? attr.substr(1, attr.length - 2): attr;
}

function guarantee1Space(cmt: string): string {
    return /^\s/.test(cmt) || /\s$/.test(cmt)? cmt: cmt + " ";
}

function lookupBiFunction(sym: string): {op: string; prio: number; assoc: boolean;}|undefined {
    switch (sym) {
        case "plus": return { op: "+", prio: 4, assoc: true };
        case "minus": return { op: "-", prio: 4, assoc: false };
        case "mul": return { op: "*", prio: 5, assoc: true };
        case "pow": return { op: "**", prio: 6, assoc: false };
        case "div": return { op: "/", prio: 5, assoc: false };
        case "mod": return { op: "%", prio: 5, assoc: false };
        case "lessThan": return { op: "<", prio: 3, assoc: false };
        case "lessThanOrEqual": return { op: "<=", prio: 3, assoc: false };
        case "greaterThan": return { op: ">", prio: 3, assoc: false };
        case "greaterThanOrEqual": return { op: ">=", prio: 3, assoc: false };
        case "equal": return { op: "==", prio: 3, assoc: false };
        case "notEqual": return { op: "!=", prio: 3, assoc: false };
        case "match": return { op: "~", prio: 3, assoc: false };
        case "or": return { op: "||", prio: 1, assoc: true };
        case "and": return { op: "&&", prio: 2, assoc: true };
        default: return undefined;
    }
}

function lookupUniFunction(sym: string): {op: string; prio: number; assoc: boolean;}|undefined {
    switch (sym) {
        case "uminus": return { op: "-", prio: 7, assoc: false };
        case "not": return { op: "!", prio: 7, assoc: false };
        default: return undefined;
    }
}

interface LangElt {
    prio: number;
    toString(): string;
    addLeadingComment(comment: string): void;
    emptyLeadingComment(nl: boolean): void;
    exchangeLeadingComment(): string;
    getAllComment(nl: boolean|undefined): string;
}

function isSimple(v: LangElt): boolean {
    return !(v instanceof AV || v instanceof Application);
}

function isSingle(v: LangElt): boolean {
    return v instanceof Literal || v instanceof JSId || v instanceof Identifier || v instanceof LocalId;
}

interface ArgumentPlusPostComment {
    arg: LangElt;
    postComment: string;
}

const noCommentNoNL = /^[ \t]+$/;
const noCommentAll = /^\s+$/;

function cleanUpComment(c: string, nl: boolean|undefined): string {
    return nl === undefined? c:
           nl? (noCommentAll.test(c)? "": c):
           (noCommentNoNL.test(c)? "": c);
}

class FunctionCall implements LangElt {
    prio = 7;
    postComment: string = "";

    constructor(public func: LangElt, public args: ArgumentPlusPostComment[], public preComment: string, public infixComment: string = "") {
    }

    push(arg: LangElt, postComment: string): void {
        this.args.push({arg: arg, postComment: postComment});
    }

    toString(): string {
        const func = this.func;

        if (this.args.length === 0 && func instanceof Identifier && func.id in zeroArgFunctions) {
            const postComment = this.infixComment + this.postComment;
            return this.preComment + func.toString() + postComment;
        }
        return this.preComment + func.toString() + this.infixComment + "(" +
               this.args.map(apc => apc.arg === undefined? "": apc.arg.toString() + apc.postComment).join(",") +
               this.postComment + ")";
    }

    addLeadingComment(comment: string): void {
        this.preComment = comment + this.preComment;
    }

    emptyLeadingComment(nl: boolean): void {
        const noComment = nl? noCommentAll: noCommentNoNL;

        if (noComment.test(this.preComment)) {
            this.preComment = "";
        }
    }

    exchangeLeadingComment(): string {
        const cmt = this.preComment;

        this.preComment = "";
        return cmt;
    }

    getAllComment(nl: boolean|undefined): string {
        return cleanUpComment(this.preComment, nl) + cleanUpComment(this.postComment, nl);
    }
}

function isProjector(v: LangElt): boolean {
    return v instanceof Identifier && v.id === "_";
}

class Application implements LangElt {
    prio = 8;
    preComment: string = "";
    postComment: string = "";

    constructor(public args: ArgumentPlusPostComment[] = []) {
    }

    push(arg: LangElt, postComment: string): void {
        this.args.push({arg: arg, postComment: postComment});
    }

    toString(): string {
        return this.preComment + "[" +
               this.args.map(apc => apc.arg === undefined? "": apc.arg.toString() + apc.postComment).join(",") +
               this.postComment + "]";
    }

    convert(): LangElt {
        const len = this.args.length;
        const fun = this.args[0].arg;

        if ((len === 2 || len == 3) && fun instanceof Identifier) {
            const op = len === 2? lookupUniFunction(fun.id): lookupBiFunction(fun.id);
            if (op !== undefined) {
                return this.convertOp(fun, op);
            }
            if (fun.id === "cond" && len === 3) {
                return this.convertCond();
            }
        }
        if (fun instanceof ProjectionPath && len === 2) {
            fun.emptyLeadingComment(true);
            this.args[1].arg.emptyLeadingComment(false);
            return new Projection(this.args[1].arg, fun, this.preComment);
        }
        if ((fun instanceof Identifier || fun instanceof LocalId || fun instanceof JSId) && fun.id !== "_") {
            fun.emptyLeadingComment(true);
            if (this.args.length > 1) {
                this.args[1].arg.emptyLeadingComment(false);
            }
            return new FunctionCall(fun, this.args.slice(1), this.preComment, this.args.length > 0? this.args[0].postComment: "");
        } else if (fun instanceof Projection && fun.proj.path.length > 0) {
            fun.emptyLeadingComment(true);
            if (this.args.length > 1) {
                this.args[1].arg.emptyLeadingComment(false);
            }
            return new FunctionCall(fun, this.args.slice(1), this.preComment, this.args.length > 0? this.args[0].postComment: "");
        }
        return this;
    }

    convertOp(fun: LangElt, op: {op: string; prio: number; assoc: boolean;}): LangElt {
        const len = this.args.length;

        fun.emptyLeadingComment(true);
        if (len === 2) {
            const arg = this.args[1].arg.prio < op.prio? new Parenthesized(this.args[1].arg, "", ""): this.args[1].arg;
            arg.emptyLeadingComment(false);
            arg.addLeadingComment(this.args[0].postComment);
            return new UniOp(op.op, op.prio, arg, this.preComment + fun.exchangeLeadingComment(), this.postComment);
        }
        const arg1 = this.args[1].arg.prio < op.prio || (!op.assoc && this.args[1].arg instanceof BinOp && (<BinOp>this.args[1].arg).op === op.op)?
                    new Parenthesized(this.args[1].arg, "", ""): this.args[1].arg;
        arg1.emptyLeadingComment(false);
        arg1.addLeadingComment(cleanUpComment(this.preComment, true) + cleanUpComment(fun.exchangeLeadingComment(), true) + cleanUpComment(this.args[0].postComment, true));
        const arg2 = this.args[2].arg.prio < op.prio? new Parenthesized(this.args[2].arg, "", ""): this.args[2].arg
        return new BinOp(arg1, op.op, op.prio, arg2,
                         guarantee1Space(cleanUpComment(this.args[1].postComment, true)),
                         cleanUpComment(this.postComment, true));
    }

    convertCond(): LangElt {
        let arg2 = this.args[2].arg;
        let cond = new Cond(
            this.preComment + this.args[0].arg.getAllComment(false) + this.args[0].postComment,
            this.args[1], [],
            cleanUpComment(arg2.exchangeLeadingComment(), false),
            this.postComment);
        let alternatives: ArgumentPlusPostComment[];

        if (arg2 instanceof FunctionCall && arg2.func instanceof Identifier && arg2.func.id === "o") {
            alternatives = arg2.args;
            cond.postComment = arg2.getAllComment(false) + this.args[2].postComment + this.postComment;
        } else {
            alternatives = [this.args[2]];
        }
        for (let i: number = 0; i < alternatives.length; i++) {
            const alt = alternatives[i].arg;
            if (!(alt instanceof AV) || alt.av.length !== 2) {
                llerror("not a proper cond (1)");
                return this;
            }
            const on = alt.av.find(av => av.attr === "on");
            const use = alt.av.find(av => av.attr === "use");
            if (on === undefined || use === undefined) {
                llerror("not a proper cond (2)");
                return this;
            }
            on.val.addLeadingComment(cleanUpComment(on.preComment, false));
            use.val.addLeadingComment(cleanUpComment(use.preComment, false));
            const newAlt = new BinOp(on.val, ":", 0, use.val, guarantee1Space(cleanUpComment(on.postComment, false)), cleanUpComment(use.postComment, false));
            cond.push(newAlt, alt.postComment);
        }
        return cond;
    }

    addLeadingComment(comment: string): void {
        this.preComment = comment + this.preComment;
    }

    emptyLeadingComment(nl: boolean): void {
        const noComment = nl? noCommentAll: noCommentNoNL;

        if (noComment.test(this.preComment)) {
            this.preComment = "";
        }
    }

    exchangeLeadingComment(): string {
        const cmt = this.preComment;

        this.preComment = "";
        return cmt;
    }

    getAllComment(nl: boolean|undefined): string {
        return cleanUpComment(this.preComment, nl) + cleanUpComment(this.postComment, nl);
    }
}

function parenthesize(expr: LangElt, prio: number): LangElt {
    return expr.prio <= prio? new Parenthesized(expr, "", ""): expr;
}

class Parenthesized implements LangElt {
    prio = 8;

    constructor(public expr: LangElt, public preComment: string, public postComment: string) {
    }

    toString(): string {
        return this.preComment + "(" + this.expr.toString() + this.postComment + ")";
    }

    addLeadingComment(comment: string): void {
        this.preComment = comment + this.preComment;
    }

    emptyLeadingComment(nl: boolean): void {
        const noComment = nl? noCommentAll: noCommentNoNL;

        if (noComment.test(this.preComment)) {
            this.preComment = "";
        }
    }

    exchangeLeadingComment(): string {
        const cmt = this.preComment;

        this.preComment = "";
        return cmt;
    }

    getAllComment(nl: boolean|undefined): string {
        return cleanUpComment(this.preComment, nl) + cleanUpComment(this.postComment, nl);
    }
}

class AV implements LangElt {
    prio = 8;
    preComment: string = "";
    av: {preComment: string; attr: string; val: LangElt; postComment: string;}[] = [];
    postComment: string = "";

    add(preComment: string, attr: string, val: LangElt, postComment: string) {
        this.av.push({preComment: preComment, attr: attr, val: val, postComment: postComment});
    }

    convert(): LangElt {
        if (this.av.length === 1){
            const v = this.av[0].val;
            if (isProjector(v)) {
                return new ProjectionPath([this.av[0].attr]);
            }
            if (v instanceof ProjectionPath) {
                return new ProjectionPath([this.av[0].attr].concat(v.path));
            }
        }
        return this;
    }

    toString(): string {
        return this.preComment + "{" +
                   this.av.map(av => av.preComment + av.attr + ":" +
                                     av.val.toString() +
                                     av.postComment).
                   join(",") +
               this.postComment + "}";
    }

    addLeadingComment(comment: string): void {
        this.preComment = comment + this.preComment;
    }

    emptyLeadingComment(nl: boolean): void {
        const noComment = nl? noCommentAll: noCommentNoNL;

        if (noComment.test(this.preComment)) {
            this.preComment = "";
        }
    }

    exchangeLeadingComment(): string {
        const cmt = this.preComment;

        this.preComment = "";
        return cmt;
    }

    getAllComment(nl: boolean|undefined): string {
        return cleanUpComment(this.preComment, nl) + cleanUpComment(this.postComment, nl);
    }
}

class Cond implements LangElt {
    prio = 0;

    constructor(public preComment: string, public condition: ArgumentPlusPostComment, public alternatives: ArgumentPlusPostComment[], public infixComment: string, public postComment: string) {
        this.condition.arg = parenthesize(this.condition.arg, this.prio);
        this.condition.arg.emptyLeadingComment(true);
    }

    push(arg: LangElt, postComment: string): void {
        this.alternatives.push({arg: arg, postComment: postComment});
    }

    toString(): string {
        return this.preComment + this.condition.arg.toString() + this.condition.postComment + "?" + this.infixComment +
               this.alternatives.map(apc => apc.arg === undefined? "": apc.arg.toString() + apc.postComment).join(" |") +
               this.postComment;
    }

    addLeadingComment(comment: string): void {
        this.preComment = comment + this.preComment;
    }

    emptyLeadingComment(nl: boolean): void {
        const noComment = nl? noCommentAll: noCommentNoNL;

        if (noComment.test(this.preComment)) {
            this.preComment = "";
        }
    }

    exchangeLeadingComment(): string {
        const cmt = this.preComment;

        this.preComment = "";
        return cmt;
    }

    getAllComment(nl: boolean|undefined): string {
        return cleanUpComment(this.preComment, nl) + cleanUpComment(this.postComment, nl);
    }
}

class BinOp implements LangElt {
    constructor(public left: LangElt, public op: string, public prio: number, public right: LangElt, public comment: string, public postComment: string) {
    }

    toString(): string {
        return this.left.toString() + this.comment + this.op + this.right.toString() + this.postComment;
    }

    addLeadingComment(comment: string): void {
        this.left.addLeadingComment(comment);
    }

    emptyLeadingComment(nl: boolean): void {
        this.left.emptyLeadingComment(nl);
    }

    exchangeLeadingComment(): string {
        const cmt = this.comment;

        this.comment = "";
        return cmt;
    }

    getAllComment(nl: boolean|undefined): string {
        return cleanUpComment(this.comment, nl) + cleanUpComment(this.postComment, nl);
    }
}

abstract class SingleElement implements LangElt {
    abstract prio: number;

    constructor(public comment: string) {
    }

    addLeadingComment(comment: string): void {
        this.comment = comment + this.comment;
    }

    emptyLeadingComment(nl: boolean): void {
        const noComment = nl? noCommentAll: noCommentNoNL;

        if (noComment.test(this.comment)) {
            this.comment = "";
        }
    }

    exchangeLeadingComment(): string {
        const cmt = this.comment;

        this.comment = "";
        return cmt;
    }

    getAllComment(nl: boolean|undefined): string {
        return cleanUpComment(this.comment, nl);
    }
}

class Literal extends SingleElement {
    prio = 8;

    constructor(public textValue: string, public comment: string) {
        super(comment);
    }

    toString(): string {
        return this.comment + this.textValue;
    }
}

class Identifier extends SingleElement {
    prio = 8;
    postComment: string = "";

    constructor(public id: string, public comment: string) {
        super(comment);
    }

    toString(): string {
        return this.comment + this.id + this.postComment;
    }
}

class JSId extends SingleElement {
    prio = 8;

    constructor(public id: string, public comment: string) {
        super(comment);
    }

    toString(): string {
        return this.comment + "::" + this.id;
    }
}

class LocalId extends SingleElement {
    prio = 8;

    constructor(public id: string, public comment: string) {
        super(comment);
    }

    toString(): string {
        return this.comment + this.id;
    }

    cloneWithLeadingComment(comment: string): LocalId {
        return new LocalId(this.id, comment);
    }
}

class UniOp extends SingleElement {
    constructor(public op: string, public prio: number, public right: LangElt, comment: string, public postComment: string) {
        super(comment);
    }

    toString(): string {
        return this.comment + this.op + this.right.toString() + this.postComment;
    }
}

class ProjectionPath implements LangElt {
    prio = 8;

    constructor(public path: string[]) {
    }

    toPath(): string {
        return this.path.join(".");
    }

    toString(): string {
        let str: string = "_";

        for (let i: number = 0; i !== this.path.length; i++) {
            str = "{" + this.path[i] + ": " + str + "}";
        }
        return str;
    }

    addLeadingComment(comment: string): void {
        throw "do not call";
    }

    emptyLeadingComment(nl: boolean): void {
    }

    exchangeLeadingComment(): string {
        return "";
    }

    getAllComment(nl: boolean|undefined): string {
        return "";
    }
}

class Projection implements LangElt {
    prio = 7;

    constructor(public src: LangElt, public proj: ProjectionPath, public comment: string) {
    }

    toString(): string {
        function isMe(expr: LangElt): boolean {
            return expr instanceof FunctionCall &&
                   (<FunctionCall>expr).args.length === 0 &&
                   (<FunctionCall>expr).func instanceof Identifier &&
                   (<Identifier>(<FunctionCall>expr).func).id === "me";
        }

        return isMe(this.src) && !(this.proj.path[0] in zeroArgFunctions)?
               this.comment + this.proj.toPath():
               this.comment + this.src.toString() + "." + this.proj.toPath();
    }

    addLeadingComment(comment: string): void {
        this.comment = comment + this.comment;
    }

    emptyLeadingComment(nl: boolean): void {
        const noComment = nl? noCommentAll: noCommentNoNL;

        if (noComment.test(this.comment)) {
            this.comment = "";
        }
    }

    exchangeLeadingComment(): string {
        const cmt = this.comment;

        this.comment = "";
        return cmt;
    }

    getAllComment(nl: boolean|undefined): string {
        return cleanUpComment(this.comment, nl);
    }
}

type ContextScope = {[param: string]: LocalId};

// Add parameters to newContext and unquote the elements by direct modification
function addParametersToContext(expr: LangElt, newContext: ContextScope): void {
    if (expr instanceof FunctionCall && expr.func instanceof Identifier && expr.func.id === "o") {
        for (let i: number = 0; i < expr.args.length; i++) {
            let arg = expr.args[i].arg;
            if (arg instanceof Literal && typeof(arg.textValue) === "string") {
                const paramName = unquoteAttr(arg.textValue);
                if (paramName === arg.textValue) {
                    llerror("cannot remove quotes from parameter");
                }
                const newId = new LocalId(paramName, arg.comment);
                newContext[arg.textValue] = newId;
                arg.textValue = paramName;
            } else {
                llerror("not a parameter list");
                break;
            }
        }
    } else if (expr instanceof Literal && typeof(expr.textValue) === "string") {
        const paramName = unquoteAttr(expr.textValue);
        if (paramName === expr.textValue) {
            llerror("cannot remove quotes from parameter");
        }
        const newId = new LocalId(paramName, expr.comment);
        newContext[expr.textValue] = newId;
        expr.textValue = paramName;
    } else {
        llerror("not a parameter list");
    }
}

var lineStr: string = "";

function output(str: string): void {
    lineStr += str;
}

function flush(): void {
    process.stdout.write(lineStr);
    lineStr = "";
}

function getAndResetIgnoreBuffer(): string {
    const ignBuf = ignoreBuffer;

    ignoreBuffer = "";
    return ignBuf;
}

const errorReturn: LangElt = new Literal("error", "");

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
number = "[+\-]?((([0-9]+(\.[0-9]*)?)|([0-9]*\.[0-9]+))([Ee][+-]?[0-9]+)?)".
string = "(\"([^\"]|\\\")*\")|('([^']|\\')*')".
regexp = "/([^*\r\n/]|\\/)([^/\r\n]|\\/)*/[gimuy]*".
identifier = "[$a-zA-Z_][$a-zA-Z_0-9]*".
varSym = "var" KEYWORD identifier.
include = "//[ \t]*%%[a-z]+%%:[ \t]*((<[^>\n]+>)|(\"([^\"]|\\\")+\")) *".
or_keyword = "\|\|".
and_keyword = "&&".
not_keyword = "!".
comparison_sym = "[<>!=]=|[~<>]".
power_sym = "\*\*".
mult_sym = "[/%*]".
add_sym = "\+".
minus_sym = "-".

IGNORE "[ \t\r\n]+".
IGNORE "//.*".
IGNORE "/\*([^*]|\*[^/])*\*/".

cdl_file:
    (   include_line;
        { output(getAndResetIgnoreBuffer()); }, semicolon, { output(lastSymbol); flush(); };
        definition;
        top_level_assignment
    ) SEQUENCE OPTION,
    { output(getAndResetIgnoreBuffer()); flush(); }.

include_line:
    { output(getAndResetIgnoreBuffer()); },
    include, { output(lastSymbol); }.

definition:
    { output(getAndResetIgnoreBuffer()); },
    varSym, { output(lastSymbol + getAndResetIgnoreBuffer()); },
    identifier, { output(lastSymbol + getAndResetIgnoreBuffer()); },
    assign, { output(lastSymbol); }, expression.

top_level_assignment:
    { output(getAndResetIgnoreBuffer()); },
    (identifier, { output(lastSymbol + getAndResetIgnoreBuffer()); }) CHAIN (dot, { output(lastSymbol + getAndResetIgnoreBuffer()); }),
    assign, { output(lastSymbol); }, expression.

expression:
    { output(getAndResetIgnoreBuffer()); },
    prio0expression(<ContextScope> new Object(), false, false) -> expr, { output(expr.toString()); }.

prio0expression(context ContextScope, inheritSpec boolean, firstArg boolean) -> expr LangElt:
    prio1expression(context, inheritSpec, firstArg) -> expr.

prio1expression(context ContextScope, inheritSpec boolean, firstArg boolean) -> expr LangElt:
    prio2expression(context, inheritSpec, firstArg) -> expr,
    (   { const preComment = getAndResetIgnoreBuffer(); },
        or_keyword, { let func: string = lastSymbol; },
        prio1expression(context, inheritSpec, firstArg) -> expr1,
        { expr = new BinOp(expr, func, 1, expr1, preComment, ""); }
    ) OPTION.

prio2expression(context ContextScope, inheritSpec boolean, firstArg boolean) -> expr LangElt:
    prio3expression(context, inheritSpec, firstArg) -> expr,
    (   { const preComment = getAndResetIgnoreBuffer(); },
        and_keyword, { let func: string = lastSymbol; },
        prio2expression(context, inheritSpec, firstArg) -> expr1,
        { expr = new BinOp(expr, func, 2, expr1, preComment, ""); }
    ) OPTION.

prio3expression(context ContextScope, inheritSpec boolean, firstArg boolean) -> expr LangElt:
    prio4expression(context, inheritSpec, firstArg) -> expr,
    (   { const preComment = getAndResetIgnoreBuffer(); },
        comparison_sym, { let func: string = lastSymbol; },
        prio4expression(context, inheritSpec, firstArg) -> expr1,
        { expr = new BinOp(expr, func, 3, expr1, preComment, ""); }
    ) OPTION.

prio4expression(context ContextScope, inheritSpec boolean, firstArg boolean) -> expr LangElt:
    prio5expression(context, inheritSpec, firstArg) -> expr,
    (   { const preComment = getAndResetIgnoreBuffer(); },
        (add_sym; minus_sym), { let func: string = lastSymbol; },
        prio4expression(context, inheritSpec, firstArg) -> expr1,
        { expr = new BinOp(expr, func, 4, expr1, preComment, ""); }
    ) OPTION.

prio5expression(context ContextScope, inheritSpec boolean, firstArg boolean) -> expr LangElt:
    prio6expression(context, inheritSpec, firstArg) -> expr,
    (   { const preComment = getAndResetIgnoreBuffer(); },
        mult_sym, { let func: string = lastSymbol; },
        prio5expression(context, inheritSpec, firstArg) -> expr1,
        { expr = new BinOp(expr, func, 5, expr1, preComment, ""); }
    ) OPTION.

prio6expression(context ContextScope, inheritSpec boolean, firstArg boolean) -> expr LangElt:
    prio7expression(context, inheritSpec, firstArg) -> expr,
    (   { const preComment = getAndResetIgnoreBuffer(); },
        power_sym, { let func: string = lastSymbol; },
        prio6expression(context, inheritSpec, firstArg) -> expr1,
        { expr = new BinOp(expr, func, 6, expr1, preComment, ""); }
    ) OPTION.

prio7expression(context ContextScope, inheritSpec boolean, firstArg boolean) -> expr LangElt = {errorReturn}:
    /* Unary op */
    {
        let func: string = "error";
        const comment = getAndResetIgnoreBuffer();
    },
    (minus_sym, {func = "uminus"}; not_keyword, {func = "not"}),
    prio7expression(context, inheritSpec, firstArg) -> op,
    { expr = new UniOp(func, 7, op, comment, ""); };
    /* Identifier, projection, or function call */
    prio8expression(context, inheritSpec, firstArg) -> expr,
    (
        /* expression without projection query or function call: treat as
           local context or function call without arguments. In an inheritance
           specification, treat identifiers as strings. */
        {
            if (expr instanceof Identifier && !(expr.id in cdlPreDefinedSymbols || expr.id in cdlBuiltInFunctions || expr.id in cdlJsFunctions)) {
                expr = new JSId(expr.id, expr.comment);
            }
        };
        query_or_call(expr, context, inheritSpec) -> expr SEQUENCE
    ).

query_or_call(expr_in LangElt, context ContextScope, inheritSpec boolean) -> expr_out LangElt = {errorReturn}:
    /* projection on a single field */
    {
        const dotComment = getAndResetIgnoreBuffer();
        if (expr_in instanceof Identifier && !(expr_in.id in cdlPreDefinedSymbols || expr_in.id in cdlBuiltInFunctions || expr_in.id in cdlJsFunctions)) {
            expr_in = new JSId(expr_in.id, expr_in.comment);
        }
    },
    dot,
    { const idComment = getAndResetIgnoreBuffer(); },
    identifier -> id,
    { expr_out = new BinOp(expr_in, ".", 7, new Identifier(id, idComment), dotComment, ""); };
    /* function call */
    {
        let f: FunctionCall;
        if (expr_in instanceof Identifier && expr_in.id in cdlJsFunctions) {
            f = new FunctionCall(expr_in, [], expr_in.exchangeLeadingComment());
        } else if (expr_in instanceof Identifier) {
            f = new FunctionCall(new JSId(expr_in.id, ""), [], expr_in.comment);
        } else {
            llerror("not a JavaScript function");
            f = new FunctionCall(new Literal("error", ""), [], "");
        }
    },
    leftParenthesis,
    (
        (
            prio0expression(context, inheritSpec, false) -> arg,
            { f.push(arg, ""); }
        ) CHAIN (
            {f.args[f.args.length - 1].postComment = getAndResetIgnoreBuffer(); },
            comma,
            ON rightParenthesis BREAK
        )
    ) OPTION,
    { f.postComment = getAndResetIgnoreBuffer(); },
    rightParenthesis,
    { expr_out = f; }.

prio8expression(context ContextScope, inheritSpec boolean, firstArg boolean) -> expr LangElt = {errorReturn}:
    /* Parentheses */
    { const preComment = getAndResetIgnoreBuffer(); },
    leftParenthesis,
    prio0expression(context, false, false) -> embExpr,
    { const postComment = getAndResetIgnoreBuffer(); },
    rightParenthesis,
    { expr = new Parenthesized(embExpr, preComment, postComment); };
    /* Base syntax function or query application */
    {
        let appl = new Application();
        let newContext = context;
        let isDefun: boolean = false;
        appl.preComment = getAndResetIgnoreBuffer();
    },
    leftBracket,
    (
        prio0expression(newContext, false, appl.args.length === 0) -> arg,
        {
            if (appl.args.length === 0 && arg instanceof Identifier && arg.id === "defun") {
                isDefun = true;
            } else if (isDefun && appl.args.length === 1) {
                newContext = { ...context };
                addParametersToContext(arg, newContext);
            }
            appl.push(arg, "");
        }
    ) CHAIN (
        { appl.args[appl.args.length - 1].postComment = getAndResetIgnoreBuffer(); },
        comma,
        ON rightBracket BREAK
    ),
    { appl.postComment = getAndResetIgnoreBuffer(); },
    rightBracket,
    {
        if (!isDefun) {
            expr = appl.convert();
        } else {
            appl.args[1].arg.emptyLeadingComment(false);
            appl.args[1].arg.addLeadingComment(appl.preComment);
            appl.args[1].arg.addLeadingComment(
                appl.args[0].arg.getAllComment(false) +
                cleanUpComment(appl.args[0].postComment, false));
            expr = new BinOp(appl.args[1].arg, "=>", 0, appl.args[2].arg,
                             guarantee1Space(appl.args[1].postComment),
                             appl.postComment);
        }
    };
    /* AV */
    attribute_value_expr(context, inheritSpec) -> expr;
    /* Atom */
    { const comment = getAndResetIgnoreBuffer(); },
    number, { expr = new Literal(lastSymbol, comment); };
    /* Atom */
    { const comment = getAndResetIgnoreBuffer(); },
    string, {
        expr = inheritSpec? new Literal(lastSymbol.substr(1, lastSymbol.length - 2), comment):
               lastSymbol in context? context[lastSymbol].cloneWithLeadingComment(comment):
               new Literal(lastSymbol, comment);
    };
    /* Atom */
    { const comment = getAndResetIgnoreBuffer(); },
    regexp, { expr = new Literal(lastSymbol, comment); };
    /* Bare context label, built-in function name, or defun */
    { const comment = getAndResetIgnoreBuffer(); },
    identifier, {
        expr = new Identifier(lastSymbol, comment);
    }.

attribute_value_expr(context ContextScope, inheritSpec boolean) -> expr LangElt:
    {
        let av = new AV();
        let attr: string;
        av.preComment = getAndResetIgnoreBuffer();
    },
    leftBrace,
    (
        (
            { const preComment = getAndResetIgnoreBuffer(); let postComment = ""; },
            (identifier; string), { attr = unquoteAttr(lastSymbol); },
            colon,
            prio0expression(context, attr === "class" || (inheritSpec && (attr === "name" || attr === "\"name\"")), false) -> val,
            (
                { postComment = getAndResetIgnoreBuffer(); },
                comma
            ) OPTION,
            { av.add(preComment, attr, val, postComment); }
        ) SEQUENCE OPTION
    ) OPTION,
    { av.postComment = getAndResetIgnoreBuffer(); },
    rightBrace,
    { expr = av.convert(); }.
