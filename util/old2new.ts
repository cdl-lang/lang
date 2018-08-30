

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


type LLTokenSet = number[];

type KeyWordList = {[keyword:string]: number}|undefined;

const endOfInput = 33;
const nrTokens = 33;
const endOfInputSet = [0, 0x00000004]; 
const llTokenSetSize = Math.floor((nrTokens + 30) / 31);
let llLineNumber = 1;
let llLinePosition = 1;
let errorOccurred = false;
let currSymbol: LLTokenSet = [];
interface localstate {
    state: number|undefined;
}

export function sprintf(args: any): string {
    let format = args[0];
    let argIndex = 1;
    let output = "";

    for (let i = 0; i < format.length; i++) {
        let ch = format[i];
        if (ch == '%') {
            let argm = format.slice(i).match(/%([0-9.*]*)([a-zA-Z])/);
            if (argm !== undefined) {
                let argarg = argm[1];
                let argtype = argm[2];
                i += argm[0].length - 1;
                if (argarg == ".*" || argarg == "*") {
                    let maxlen = Number(args[argIndex++]);
                    let argt = args[argIndex++];
                    output += argt.slice(0, maxlen);
                } else {
                    output += args[argIndex++];
                }
            }
        } else {
            output += ch;
        }
    }
    return output;
}

export var inputFileName: string;
export function setInputFileName(fn: string): void {
    inputFileName = fn;
}
let scanBuffer = "";
let ignoreBuffer = "";
let lastSymbol = "";
export let lastSymbolPos = {line: 0, position: 0};
let bufferEnd = 0;
let bufferFill = 0;
let atEOF = false;
let llTokenSet1: number[] = [0x00004000, 0x00000000]; /* string */
let llTokenSet2: number[] = [0x00010000, 0x00000000]; /* identifier */
let llTokenSet3: number[] = [0x00100000, 0x00000000]; /* and_keyword */
let llTokenSet4: number[] = [0x00800000, 0x00000000]; /* power_sym */
let llTokenSet5: number[] = [0x00002000, 0x00000000]; /* number */
let llTokenSet6: number[] = [0x00000001, 0x00000000]; /* */
let llTokenSet7: number[] = [0x00040000, 0x00000000]; /* include */
let llTokenSet8: number[] = [0x00040001, 0x00000000]; /* include */
let llTokenSet9: number[] = [0x00040001, 0x00000000]; /* include */
let llTokenSet10: number[] = [0x00008000, 0x00000000]; /* regexp */
let llTokenSet11: number[] = [0x00400000, 0x00000000]; /* comparison_sym */
let llTokenSet12: number[] = [0x00080000, 0x00000000]; /* or_keyword */
let llTokenSet13: number[] = [0x00000040, 0x00000000]; /* rightBrace */
let llTokenSet14: number[] = [0x00000020, 0x00000000]; /* leftBrace */
let llTokenSet15: number[] = [0x00000010, 0x00000000]; /* rightBracket */
let llTokenSet16: number[] = [0x00000008, 0x00000000]; /* leftBracket */
let llTokenSet17: number[] = [0x00001000, 0x00000000]; /* question_mark */
let llTokenSet18: number[] = [0x00000800, 0x00000000]; /* assign */
let llTokenSet19: number[] = [0x00000400, 0x00000000]; /* semicolon */
let llTokenSet20: number[] = [0x00000200, 0x00000000]; /* colon */
let llTokenSet21: number[] = [0x01000000, 0x00000000]; /* mult_sym */
let llTokenSet22: number[] = [0x00000100, 0x00000000]; /* dot */
let llTokenSet23: number[] = [0x04000000, 0x00000000]; /* minus_sym */
let llTokenSet24: number[] = [0x00000080, 0x00000000]; /* comma */
let llTokenSet25: number[] = [0x02000000, 0x00000000]; /* add_sym */
let llTokenSet26: number[] = [0x00000004, 0x00000000]; /* rightParenthesis */
let llTokenSet27: number[] = [0x00000002, 0x00000000]; /* leftParenthesis */
let llTokenSet28: number[] = [0x00200000, 0x00000000]; /* not_keyword */
let tokenName: string[] = [
	"IGNORE",
	"leftParenthesis",
	"rightParenthesis",
	"leftBracket",
	"rightBracket",
	"leftBrace",
	"rightBrace",
	"comma",
	"dot",
	"colon",
	"semicolon",
	"assign",
	"question_mark",
	"number",
	"string",
	"regexp",
	"identifier",
	"varSym",
	"include",
	"or_keyword",
	"and_keyword",
	"not_keyword",
	"comparison_sym",
	"power_sym",
	"mult_sym",
	"add_sym",
	"minus_sym",
	"@&^@#&^",
	"@&^@#&^",
	"@&^@#&^",
	"class",
	"name",
	"\"name\"",
	"EOF",
];
const scanTab = [
/*   0 */ {
            '~': {destination:44,accept:llTokenSet11},
		    '}': {destination:46,accept:llTokenSet13},
		    '|': {destination:47},
		    '{': {destination:48,accept:llTokenSet14},
		    ']': {destination:49,accept:llTokenSet15},
		    '[': {destination:50,accept:llTokenSet16},
		    '?': {destination:51,accept:llTokenSet17},
		    '>': {destination:53,accept:llTokenSet11},
		    '<': {destination:53,accept:llTokenSet11},
		    '=': {destination:52,accept:llTokenSet18},
		    ';': {destination:54,accept:llTokenSet19},
		    ':': {destination:55,accept:llTokenSet20},
		    '9': {destination:43,accept:llTokenSet5},
		    '8': {destination:43,accept:llTokenSet5},
		    '7': {destination:43,accept:llTokenSet5},
		    '6': {destination:43,accept:llTokenSet5},
		    '5': {destination:43,accept:llTokenSet5},
		    '4': {destination:43,accept:llTokenSet5},
		    '3': {destination:43,accept:llTokenSet5},
		    '2': {destination:43,accept:llTokenSet5},
		    '1': {destination:43,accept:llTokenSet5},
		    '0': {destination:43,accept:llTokenSet5},
		    '/': {destination:56,accept:llTokenSet21},
		    '.': {destination:57,accept:llTokenSet22},
		    '-': {destination:58,accept:llTokenSet23},
		    ',': {destination:59,accept:llTokenSet24},
		    '+': {destination:60,accept:llTokenSet25},
		    '*': {destination:61,accept:llTokenSet21},
		    ')': {destination:62,accept:llTokenSet26},
		    '(': {destination:63,accept:llTokenSet27},
		    '\'': {destination:9},
		    '&': {destination:64},
		    '%': {destination:65,accept:llTokenSet21},
		    '"': {destination:4},
		    '!': {destination:66,accept:llTokenSet28},
		    ' ': {destination:67,accept:llTokenSet6},
		    '\x0d': {destination:67,accept:llTokenSet6},
		    '\x0a': {destination:67,accept:llTokenSet6},
		    '\x09': {destination:67,accept:llTokenSet6},
		    '\x00': {},
		    '\x01': {},
		    '\x02': {},
		    '\x03': {},
		    '\x04': {},
		    '\x05': {},
		    '\x06': {},
		    '\x07': {},
		    '\x08': {},
		    '\x0b': {},
		    '\x0c': {},
		    '\x0e': {},
		    '\x0f': {},
		    '\x10': {},
		    '\x11': {},
		    '\x12': {},
		    '\x13': {},
		    '\x14': {},
		    '\x15': {},
		    '\x16': {},
		    '\x17': {},
		    '\x18': {},
		    '\x19': {},
		    '\x1a': {},
		    '\x1b': {},
		    '\x1c': {},
		    '\x1d': {},
		    '\x1e': {},
		    '\x1f': {},
		    '#': {},
		    '@': {},
		    '\\': {},
		    '^': {},
		    '`': {},
		    '\x7f': {},
		    '': {destination:5,accept:llTokenSet2},
          },
/*   1 */ {
            '\\': {destination:2},
		    '"': {destination:3,accept:llTokenSet1},
		    '': {destination:4},
          },
/*   2 */ {
            '\\': {destination:2},
		    '"': {destination:1,accept:llTokenSet1},
		    '': {destination:4},
          },
/*   3 */ undefined,
/*   4 */ {
            '\\': {destination:2},
		    '"': {destination:3,accept:llTokenSet1},
		    '': {destination:4},
          },
/*   5 */ {
            'z': {destination:5,accept:llTokenSet2},
		    'y': {destination:5,accept:llTokenSet2},
		    'x': {destination:5,accept:llTokenSet2},
		    'w': {destination:5,accept:llTokenSet2},
		    'v': {destination:5,accept:llTokenSet2},
		    'u': {destination:5,accept:llTokenSet2},
		    't': {destination:5,accept:llTokenSet2},
		    's': {destination:5,accept:llTokenSet2},
		    'r': {destination:5,accept:llTokenSet2},
		    'q': {destination:5,accept:llTokenSet2},
		    'p': {destination:5,accept:llTokenSet2},
		    'o': {destination:5,accept:llTokenSet2},
		    'n': {destination:5,accept:llTokenSet2},
		    'm': {destination:5,accept:llTokenSet2},
		    'l': {destination:5,accept:llTokenSet2},
		    'k': {destination:5,accept:llTokenSet2},
		    'j': {destination:5,accept:llTokenSet2},
		    'i': {destination:5,accept:llTokenSet2},
		    'h': {destination:5,accept:llTokenSet2},
		    'g': {destination:5,accept:llTokenSet2},
		    'f': {destination:5,accept:llTokenSet2},
		    'e': {destination:5,accept:llTokenSet2},
		    'd': {destination:5,accept:llTokenSet2},
		    'c': {destination:5,accept:llTokenSet2},
		    'b': {destination:5,accept:llTokenSet2},
		    'a': {destination:5,accept:llTokenSet2},
		    '_': {destination:5,accept:llTokenSet2},
		    'Z': {destination:5,accept:llTokenSet2},
		    'Y': {destination:5,accept:llTokenSet2},
		    'X': {destination:5,accept:llTokenSet2},
		    'W': {destination:5,accept:llTokenSet2},
		    'V': {destination:5,accept:llTokenSet2},
		    'U': {destination:5,accept:llTokenSet2},
		    'T': {destination:5,accept:llTokenSet2},
		    'S': {destination:5,accept:llTokenSet2},
		    'R': {destination:5,accept:llTokenSet2},
		    'Q': {destination:5,accept:llTokenSet2},
		    'P': {destination:5,accept:llTokenSet2},
		    'O': {destination:5,accept:llTokenSet2},
		    'N': {destination:5,accept:llTokenSet2},
		    'M': {destination:5,accept:llTokenSet2},
		    'L': {destination:5,accept:llTokenSet2},
		    'K': {destination:5,accept:llTokenSet2},
		    'J': {destination:5,accept:llTokenSet2},
		    'I': {destination:5,accept:llTokenSet2},
		    'H': {destination:5,accept:llTokenSet2},
		    'G': {destination:5,accept:llTokenSet2},
		    'F': {destination:5,accept:llTokenSet2},
		    'E': {destination:5,accept:llTokenSet2},
		    'D': {destination:5,accept:llTokenSet2},
		    'C': {destination:5,accept:llTokenSet2},
		    'B': {destination:5,accept:llTokenSet2},
		    'A': {destination:5,accept:llTokenSet2},
		    '9': {destination:5,accept:llTokenSet2},
		    '8': {destination:5,accept:llTokenSet2},
		    '7': {destination:5,accept:llTokenSet2},
		    '6': {destination:5,accept:llTokenSet2},
		    '5': {destination:5,accept:llTokenSet2},
		    '4': {destination:5,accept:llTokenSet2},
		    '3': {destination:5,accept:llTokenSet2},
		    '2': {destination:5,accept:llTokenSet2},
		    '1': {destination:5,accept:llTokenSet2},
		    '0': {destination:5,accept:llTokenSet2},
		    '$': {destination:5,accept:llTokenSet2},
		    '': {},
          },
/*   6 */ undefined,
/*   7 */ {
            '\\': {destination:8},
		    '\'': {destination:3,accept:llTokenSet1},
		    '': {destination:9},
          },
/*   8 */ {
            '\\': {destination:8},
		    '\'': {destination:7,accept:llTokenSet1},
		    '': {destination:9},
          },
/*   9 */ {
            '\\': {destination:8},
		    '\'': {destination:3,accept:llTokenSet1},
		    '': {destination:9},
          },
/*  10 */ undefined,
/*  11 */ {
            '9': {destination:12,accept:llTokenSet5},
		    '8': {destination:12,accept:llTokenSet5},
		    '7': {destination:12,accept:llTokenSet5},
		    '6': {destination:12,accept:llTokenSet5},
		    '5': {destination:12,accept:llTokenSet5},
		    '4': {destination:12,accept:llTokenSet5},
		    '3': {destination:12,accept:llTokenSet5},
		    '2': {destination:12,accept:llTokenSet5},
		    '1': {destination:12,accept:llTokenSet5},
		    '0': {destination:12,accept:llTokenSet5},
		    '': {},
          },
/*  12 */ {
            'e': {destination:42},
		    'E': {destination:42},
		    '9': {destination:12,accept:llTokenSet5},
		    '8': {destination:12,accept:llTokenSet5},
		    '7': {destination:12,accept:llTokenSet5},
		    '6': {destination:12,accept:llTokenSet5},
		    '5': {destination:12,accept:llTokenSet5},
		    '4': {destination:12,accept:llTokenSet5},
		    '3': {destination:12,accept:llTokenSet5},
		    '2': {destination:12,accept:llTokenSet5},
		    '1': {destination:12,accept:llTokenSet5},
		    '0': {destination:12,accept:llTokenSet5},
		    '': {},
          },
/*  13 */ undefined,
/*  14 */ {
            '*': {destination:15},
		    '': {destination:14},
          },
/*  15 */ {
            '/': {destination:13,accept:llTokenSet6},
		    '': {destination:14},
          },
/*  16 */ {
            '\\': {destination:17},
		    '"': {destination:18,accept:llTokenSet7},
		    ' ': {destination:16,accept:llTokenSet7},
		    '': {destination:23},
          },
/*  17 */ {
            '\\': {destination:17},
		    '"': {destination:16,accept:llTokenSet7},
		    '': {destination:23},
          },
/*  18 */ {
            ' ': {destination:18,accept:llTokenSet7},
		    '': {},
          },
/*  19 */ {
            ' ': {destination:19,accept:llTokenSet8},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:35,accept:llTokenSet6},
          },
/*  20 */ {
            '\\': {destination:21,accept:llTokenSet6},
		    '"': {destination:19,accept:llTokenSet8},
		    ' ': {destination:20,accept:llTokenSet9},
		    '\x0d': {destination:23},
		    '\x0a': {destination:23},
		    '\x00': {destination:23},
		    '': {destination:22,accept:llTokenSet6},
          },
/*  21 */ {
            '\\': {destination:21,accept:llTokenSet6},
		    '"': {destination:20,accept:llTokenSet9},
		    '\x0d': {destination:23},
		    '\x0a': {destination:23},
		    '\x00': {destination:23},
		    '': {destination:22,accept:llTokenSet6},
          },
/*  22 */ {
            '\\': {destination:21,accept:llTokenSet6},
		    '"': {destination:19,accept:llTokenSet8},
		    '\x0d': {destination:23},
		    '\x0a': {destination:23},
		    '\x00': {destination:23},
		    '': {destination:22,accept:llTokenSet6},
          },
/*  23 */ {
            '\\': {destination:17},
		    '"': {destination:18,accept:llTokenSet7},
		    '': {destination:23},
          },
/*  24 */ {
            '>': {destination:19,accept:llTokenSet8},
		    '\x0d': {destination:25},
		    '\x00': {destination:25},
		    '\x0a': {},
		    '': {destination:24,accept:llTokenSet6},
          },
/*  25 */ {
            '>': {destination:18,accept:llTokenSet7},
		    '\x0a': {},
		    '': {destination:25},
          },
/*  26 */ {
            '>': {destination:35,accept:llTokenSet6},
		    '\x0d': {destination:25},
		    '\x00': {destination:25},
		    '\x0a': {},
		    '': {destination:24,accept:llTokenSet6},
          },
/*  27 */ {
            '\\': {destination:21,accept:llTokenSet6},
		    '"': {destination:35,accept:llTokenSet6},
		    '\x0d': {destination:23},
		    '\x0a': {destination:23},
		    '\x00': {destination:23},
		    '': {destination:22,accept:llTokenSet6},
          },
/*  28 */ {
            '<': {destination:26,accept:llTokenSet6},
		    '"': {destination:27,accept:llTokenSet6},
		    ' ': {destination:28,accept:llTokenSet6},
		    '\x09': {destination:28,accept:llTokenSet6},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:35,accept:llTokenSet6},
          },
/*  29 */ {
            ':': {destination:28,accept:llTokenSet6},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:35,accept:llTokenSet6},
          },
/*  30 */ {
            '%': {destination:29,accept:llTokenSet6},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:35,accept:llTokenSet6},
          },
/*  31 */ {
            'z': {destination:31,accept:llTokenSet6},
		    'y': {destination:31,accept:llTokenSet6},
		    'x': {destination:31,accept:llTokenSet6},
		    'w': {destination:31,accept:llTokenSet6},
		    'v': {destination:31,accept:llTokenSet6},
		    'u': {destination:31,accept:llTokenSet6},
		    't': {destination:31,accept:llTokenSet6},
		    's': {destination:31,accept:llTokenSet6},
		    'r': {destination:31,accept:llTokenSet6},
		    'q': {destination:31,accept:llTokenSet6},
		    'p': {destination:31,accept:llTokenSet6},
		    'o': {destination:31,accept:llTokenSet6},
		    'n': {destination:31,accept:llTokenSet6},
		    'm': {destination:31,accept:llTokenSet6},
		    'l': {destination:31,accept:llTokenSet6},
		    'k': {destination:31,accept:llTokenSet6},
		    'j': {destination:31,accept:llTokenSet6},
		    'i': {destination:31,accept:llTokenSet6},
		    'h': {destination:31,accept:llTokenSet6},
		    'g': {destination:31,accept:llTokenSet6},
		    'f': {destination:31,accept:llTokenSet6},
		    'e': {destination:31,accept:llTokenSet6},
		    'd': {destination:31,accept:llTokenSet6},
		    'c': {destination:31,accept:llTokenSet6},
		    'b': {destination:31,accept:llTokenSet6},
		    'a': {destination:31,accept:llTokenSet6},
		    '%': {destination:30,accept:llTokenSet6},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:35,accept:llTokenSet6},
          },
/*  32 */ {
            'z': {destination:31,accept:llTokenSet6},
		    'y': {destination:31,accept:llTokenSet6},
		    'x': {destination:31,accept:llTokenSet6},
		    'w': {destination:31,accept:llTokenSet6},
		    'v': {destination:31,accept:llTokenSet6},
		    'u': {destination:31,accept:llTokenSet6},
		    't': {destination:31,accept:llTokenSet6},
		    's': {destination:31,accept:llTokenSet6},
		    'r': {destination:31,accept:llTokenSet6},
		    'q': {destination:31,accept:llTokenSet6},
		    'p': {destination:31,accept:llTokenSet6},
		    'o': {destination:31,accept:llTokenSet6},
		    'n': {destination:31,accept:llTokenSet6},
		    'm': {destination:31,accept:llTokenSet6},
		    'l': {destination:31,accept:llTokenSet6},
		    'k': {destination:31,accept:llTokenSet6},
		    'j': {destination:31,accept:llTokenSet6},
		    'i': {destination:31,accept:llTokenSet6},
		    'h': {destination:31,accept:llTokenSet6},
		    'g': {destination:31,accept:llTokenSet6},
		    'f': {destination:31,accept:llTokenSet6},
		    'e': {destination:31,accept:llTokenSet6},
		    'd': {destination:31,accept:llTokenSet6},
		    'c': {destination:31,accept:llTokenSet6},
		    'b': {destination:31,accept:llTokenSet6},
		    'a': {destination:31,accept:llTokenSet6},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:35,accept:llTokenSet6},
          },
/*  33 */ {
            '%': {destination:32,accept:llTokenSet6},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:35,accept:llTokenSet6},
          },
/*  34 */ {
            '%': {destination:33,accept:llTokenSet6},
		    ' ': {destination:34,accept:llTokenSet6},
		    '\x09': {destination:34,accept:llTokenSet6},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:35,accept:llTokenSet6},
          },
/*  35 */ {
            '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:35,accept:llTokenSet6},
          },
/*  36 */ {
            'y': {destination:36,accept:llTokenSet10},
		    'u': {destination:36,accept:llTokenSet10},
		    'm': {destination:36,accept:llTokenSet10},
		    'i': {destination:36,accept:llTokenSet10},
		    'g': {destination:36,accept:llTokenSet10},
		    '': {},
          },
/*  37 */ {
            'y': {destination:37,accept:llTokenSet10},
		    'u': {destination:37,accept:llTokenSet10},
		    'm': {destination:37,accept:llTokenSet10},
		    'i': {destination:37,accept:llTokenSet10},
		    'g': {destination:37,accept:llTokenSet10},
		    '\\': {destination:38},
		    '/': {destination:36,accept:llTokenSet10},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:39},
          },
/*  38 */ {
            '\\': {destination:38},
		    '/': {destination:37,accept:llTokenSet10},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:39},
          },
/*  39 */ {
            '\\': {destination:38},
		    '/': {destination:36,accept:llTokenSet10},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:39},
          },
/*  40 */ {
            '9': {destination:40,accept:llTokenSet5},
		    '8': {destination:40,accept:llTokenSet5},
		    '7': {destination:40,accept:llTokenSet5},
		    '6': {destination:40,accept:llTokenSet5},
		    '5': {destination:40,accept:llTokenSet5},
		    '4': {destination:40,accept:llTokenSet5},
		    '3': {destination:40,accept:llTokenSet5},
		    '2': {destination:40,accept:llTokenSet5},
		    '1': {destination:40,accept:llTokenSet5},
		    '0': {destination:40,accept:llTokenSet5},
		    '': {},
          },
/*  41 */ {
            '9': {destination:40,accept:llTokenSet5},
		    '8': {destination:40,accept:llTokenSet5},
		    '7': {destination:40,accept:llTokenSet5},
		    '6': {destination:40,accept:llTokenSet5},
		    '5': {destination:40,accept:llTokenSet5},
		    '4': {destination:40,accept:llTokenSet5},
		    '3': {destination:40,accept:llTokenSet5},
		    '2': {destination:40,accept:llTokenSet5},
		    '1': {destination:40,accept:llTokenSet5},
		    '0': {destination:40,accept:llTokenSet5},
		    '': {},
          },
/*  42 */ {
            '9': {destination:40,accept:llTokenSet5},
		    '8': {destination:40,accept:llTokenSet5},
		    '7': {destination:40,accept:llTokenSet5},
		    '6': {destination:40,accept:llTokenSet5},
		    '5': {destination:40,accept:llTokenSet5},
		    '4': {destination:40,accept:llTokenSet5},
		    '3': {destination:40,accept:llTokenSet5},
		    '2': {destination:40,accept:llTokenSet5},
		    '1': {destination:40,accept:llTokenSet5},
		    '0': {destination:40,accept:llTokenSet5},
		    '\x00': {},
		    '\x01': {},
		    '\x02': {},
		    '\x03': {},
		    '\x04': {},
		    '\x05': {},
		    '\x06': {},
		    '\x07': {},
		    '\x08': {},
		    '\x09': {},
		    '\x0a': {},
		    '\x0b': {},
		    '\x0c': {},
		    '\x0d': {},
		    '\x0e': {},
		    '\x0f': {},
		    '\x10': {},
		    '\x11': {},
		    '\x12': {},
		    '\x13': {},
		    '\x14': {},
		    '\x15': {},
		    '\x16': {},
		    '\x17': {},
		    '\x18': {},
		    '\x19': {},
		    '\x1a': {},
		    '\x1b': {},
		    '\x1c': {},
		    '\x1d': {},
		    '\x1e': {},
		    '\x1f': {},
		    ' ': {},
		    '!': {},
		    '"': {},
		    '#': {},
		    '$': {},
		    '%': {},
		    '&': {},
		    '\'': {},
		    '(': {},
		    ')': {},
		    '*': {},
		    '': {destination:41},
          },
/*  43 */ {
            'e': {destination:42},
		    'E': {destination:42},
		    '9': {destination:43,accept:llTokenSet5},
		    '8': {destination:43,accept:llTokenSet5},
		    '7': {destination:43,accept:llTokenSet5},
		    '6': {destination:43,accept:llTokenSet5},
		    '5': {destination:43,accept:llTokenSet5},
		    '4': {destination:43,accept:llTokenSet5},
		    '3': {destination:43,accept:llTokenSet5},
		    '2': {destination:43,accept:llTokenSet5},
		    '1': {destination:43,accept:llTokenSet5},
		    '0': {destination:43,accept:llTokenSet5},
		    '.': {destination:12,accept:llTokenSet5},
		    '': {},
          },
/*  44 */ undefined,
/*  45 */ undefined,
/*  46 */ undefined,
/*  47 */ {
            '|': {destination:45,accept:llTokenSet12},
		    '': {},
          },
/*  48 */ undefined,
/*  49 */ undefined,
/*  50 */ undefined,
/*  51 */ undefined,
/*  52 */ {
            '=': {destination:44,accept:llTokenSet11},
		    '': {},
          },
/*  53 */ {
            '=': {destination:44,accept:llTokenSet11},
		    '': {},
          },
/*  54 */ undefined,
/*  55 */ undefined,
/*  56 */ {
            '\\': {destination:38},
		    '/': {destination:34,accept:llTokenSet6},
		    '*': {destination:14},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:39},
          },
/*  57 */ {
            '9': {destination:12,accept:llTokenSet5},
		    '8': {destination:12,accept:llTokenSet5},
		    '7': {destination:12,accept:llTokenSet5},
		    '6': {destination:12,accept:llTokenSet5},
		    '5': {destination:12,accept:llTokenSet5},
		    '4': {destination:12,accept:llTokenSet5},
		    '3': {destination:12,accept:llTokenSet5},
		    '2': {destination:12,accept:llTokenSet5},
		    '1': {destination:12,accept:llTokenSet5},
		    '0': {destination:12,accept:llTokenSet5},
		    '': {},
          },
/*  58 */ {
            '9': {destination:43,accept:llTokenSet5},
		    '8': {destination:43,accept:llTokenSet5},
		    '7': {destination:43,accept:llTokenSet5},
		    '6': {destination:43,accept:llTokenSet5},
		    '5': {destination:43,accept:llTokenSet5},
		    '4': {destination:43,accept:llTokenSet5},
		    '3': {destination:43,accept:llTokenSet5},
		    '2': {destination:43,accept:llTokenSet5},
		    '1': {destination:43,accept:llTokenSet5},
		    '0': {destination:43,accept:llTokenSet5},
		    '.': {destination:11},
		    '': {},
          },
/*  59 */ undefined,
/*  60 */ {
            '9': {destination:43,accept:llTokenSet5},
		    '8': {destination:43,accept:llTokenSet5},
		    '7': {destination:43,accept:llTokenSet5},
		    '6': {destination:43,accept:llTokenSet5},
		    '5': {destination:43,accept:llTokenSet5},
		    '4': {destination:43,accept:llTokenSet5},
		    '3': {destination:43,accept:llTokenSet5},
		    '2': {destination:43,accept:llTokenSet5},
		    '1': {destination:43,accept:llTokenSet5},
		    '0': {destination:43,accept:llTokenSet5},
		    '.': {destination:11},
		    '': {},
          },
/*  61 */ {
            '*': {destination:10,accept:llTokenSet4},
		    '': {},
          },
/*  62 */ undefined,
/*  63 */ undefined,
/*  64 */ {
            '&': {destination:6,accept:llTokenSet3},
		    '': {},
          },
/*  65 */ undefined,
/*  66 */ {
            '=': {destination:44,accept:llTokenSet11},
		    '': {},
          },
/*  67 */ {
            ' ': {destination:67,accept:llTokenSet6},
		    '\x0d': {destination:67,accept:llTokenSet6},
		    '\x0a': {destination:67,accept:llTokenSet6},
		    '\x09': {destination:67,accept:llTokenSet6},
		    '': {},
          },
];
let keywordList: KeyWordList[] = [
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	{"var": 17},
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
];

function nextState(state: localstate, ch: string|undefined): LLTokenSet|undefined {
    let tab: any = state.state !== undefined? scanTab[state.state]: undefined;

    if (tab === undefined) {
        state.state = undefined;
        return undefined;
    }
    let transition = ch !== undefined && ch in tab? tab[ch]: tab[''];
    state.state = transition.destination;
    return transition.accept;
}

function uniteTokenSets(b: LLTokenSet, c: LLTokenSet): LLTokenSet {
    let a: LLTokenSet = [];

    for (let i = 0; i < llTokenSetSize; i++) {
        a[i] = b[i] | c[i];
    }
    return a;
}

function tokenInCommon(a: LLTokenSet, b: LLTokenSet): boolean {
    for (let i = 0; i < llTokenSetSize; i++) {
        if ((a[i] & b[i]) !== 0) {
            return true;
        }
    }
    return false;
}

function waitForToken(set: LLTokenSet, follow: LLTokenSet): void {
    let ltSet: LLTokenSet = uniteTokenSets(set, follow);

    while (currSymbol !== endOfInputSet && !tokenInCommon(currSymbol, ltSet)) {
        nextSymbol();
        llerror("token skipped: %s", lastSymbol);
    }
}

function memberTokenSet(token: number, set: LLTokenSet): boolean {
    return (set[Math.floor(token / 31)] & (1 << (token % 31))) !== 0;
}

function notEmpty(tSet: LLTokenSet): boolean {
    if (tSet[0] > 1)
        return true;
    for (let i = 1; i < tSet.length; i++)
        if (tSet[i] > 0)
            return true;
    return false;
}

function lLKeyWord(tokenSet: LLTokenSet): LLTokenSet {
    let keywordText = scanBuffer.slice(0, bufferEnd);

    for (let i = 0; i != nrTokens; i++) {
        let kwi = keywordList[i];
        if (kwi != undefined && memberTokenSet(i, tokenSet) &&
              kwi.hasOwnProperty(keywordText)) {
            let keyword = kwi[keywordText];
            if (keyword !== undefined) {
                let llKeyWordSet: LLTokenSet = [];
                llKeyWordSet[Math.floor(keyword / 31)] = 1 << (keyword % 31);
                return llKeyWordSet;
            }
        }
    }
    return tokenSet;
}

function nextSymbol(): void
{
    let bufferPos: number;
    let state: localstate = { state: 0 };
    let token: LLTokenSet|undefined;
    let ch: string|undefined;
    let lastNlPos = 0, nlPos = 0;
    let recognizedToken: LLTokenSet|undefined = undefined;

    /* Copy last recognized symbol into buffer and adjust positions */
    lastSymbol = scanBuffer.slice(0, bufferEnd);
    lastSymbolPos.line = llLineNumber;
    lastSymbolPos.position = llLinePosition;
    bufferFill -= bufferEnd; /* move remains of scanBuffer to beginning */
    while ((nlPos = scanBuffer.indexOf('\n', nlPos)) != -1 && nlPos < bufferEnd) {
        llLineNumber++;
        lastNlPos = nlPos;
        llLinePosition = 0;
        nlPos++;
    }
    llLinePosition += bufferEnd - lastNlPos;
    scanBuffer = scanBuffer.slice(bufferEnd); /* expensive for larger buffers; should use round robin? repeated below */
    bufferPos = 0;
    bufferEnd = 0;
    while (bufferPos !== bufferFill || !atEOF) {
        if (bufferPos !== bufferFill) {
            ch = scanBuffer[bufferPos++];
        } else if (atEOF || !(ch = getNextCharacter())) {
            atEOF = true;
        } else {
            scanBuffer += ch;
            bufferPos++;
            bufferFill++;
        }
        if (atEOF) {
            state.state = undefined;
        } else if ((token = nextState(state, ch)) !== undefined) {
            recognizedToken = token;
            bufferEnd = bufferPos;
        }
        if (state.state === undefined) {
            if (atEOF && bufferFill == 0) {
                currSymbol = endOfInputSet;
                return;
            }
            if (recognizedToken === undefined) {
                llerror("Illegal character: '%c'\n", scanBuffer[0]);
                bufferEnd = 1;
            } else if (notEmpty(recognizedToken)) {
                currSymbol = lLKeyWord(recognizedToken);
                return;
            }
            ignoreBuffer += scanBuffer.substr(0, bufferEnd);
            lastNlPos = nlPos = 0;
            while ((nlPos = scanBuffer.indexOf('\n', nlPos)) != -1 && nlPos < bufferEnd) {
                llLineNumber++;
                lastNlPos = nlPos;
                llLinePosition = 0;
                nlPos++;
            }
            llLinePosition += bufferEnd - lastNlPos;
            bufferFill -= bufferEnd;
            scanBuffer = scanBuffer.slice(bufferEnd);
            recognizedToken = undefined;
            state.state = 0;
            bufferEnd = 0;
            bufferPos = 0;
        }
    }
    currSymbol = endOfInputSet;
}

function getToken(token: number, firstNext: LLTokenSet, follow: LLTokenSet, firstNextEmpty: boolean): void {
    let ltSet: LLTokenSet = firstNextEmpty? uniteTokenSets(firstNext, follow): firstNext;

    while (currSymbol != endOfInputSet && !memberTokenSet(token, currSymbol) &&
           !tokenInCommon(currSymbol, ltSet)) {
        nextSymbol();
        if (!memberTokenSet(0, currSymbol)) {
            llerror("token skipped: %s", lastSymbol);
        }
    }
    if (!memberTokenSet(token, currSymbol)) {
        llerror("token expected: %s", tokenName[token]);
    } else {
        nextSymbol();
    }
}

function toSymbolList(set: LLTokenSet): string[] {
    let list: string[] = [];

    for (let i = 0; i < nrTokens; i++) {
        if (memberTokenSet(i, set)) {
            list.push(tokenName[i]);
        }
    }
    return list;
}

export function tokenSetToString(set: LLTokenSet): string {
    return "{" + toSymbolList(set).join(",") + "}";
}

let llTokenSet29: number[] = [0x00014040, 0x00000000]; /* identifier rightBrace string */
let llTokenSet30: number[] = [0x00014000, 0x00000000]; /* identifier string */
let llTokenSet31: number[] = [0x00010000, 0x00000000]; /* identifier */
let llTokenSet32: number[] = [0x00000200, 0x00000000]; /* colon */
let llTokenSet33: number[] = [0x00004000, 0x00000000]; /* string */
let llTokenSet34: number[] = [0x0421E02A, 0x00000000]; /* identifier leftBrace leftBracket leftParenthesis minus_sym not_keyword number regexp string */
let llTokenSet35: number[] = [0x000140C0, 0x00000000]; /* comma identifier rightBrace string */
let llTokenSet36: number[] = [0x00000080, 0x00000000]; /* comma */
let llTokenSet37: number[] = [0x00000000, 0x00000000]; /* */
let llTokenSet38: number[] = [0x00070400, 0x00000000]; /* identifier include semicolon varSym */
let llTokenSet39: number[] = [0x00040000, 0x00000000]; /* include */
let llTokenSet40: number[] = [0x00000400, 0x00000000]; /* semicolon */
let llTokenSet41: number[] = [0x00020000, 0x00000000]; /* varSym */
let llTokenSet42: number[] = [0x00000800, 0x00000000]; /* assign */
let llTokenSet43: number[] = [0x00080000, 0x00000000]; /* or_keyword */
let llTokenSet44: number[] = [0x00100000, 0x00000000]; /* and_keyword */
let llTokenSet45: number[] = [0x00400000, 0x00000000]; /* comparison_sym */
let llTokenSet46: number[] = [0x06000000, 0x00000000]; /* add_sym minus_sym */
let llTokenSet47: number[] = [0x02000000, 0x00000000]; /* add_sym */
let llTokenSet48: number[] = [0x04000000, 0x00000000]; /* minus_sym */
let llTokenSet49: number[] = [0x01000000, 0x00000000]; /* mult_sym */
let llTokenSet50: number[] = [0x00800000, 0x00000000]; /* power_sym */
let llTokenSet51: number[] = [0x04200000, 0x00000000]; /* minus_sym not_keyword */
let llTokenSet52: number[] = [0x00200000, 0x00000000]; /* not_keyword */
let llTokenSet53: number[] = [0x0001E02A, 0x00000000]; /* identifier leftBrace leftBracket leftParenthesis number regexp string */
let llTokenSet54: number[] = [0x00000102, 0x00000000]; /* dot leftParenthesis */
let llTokenSet55: number[] = [0x00000002, 0x00000000]; /* leftParenthesis */
let llTokenSet56: number[] = [0x00000004, 0x00000000]; /* rightParenthesis */
let llTokenSet57: number[] = [0x00000008, 0x00000000]; /* leftBracket */
let llTokenSet58: number[] = [0x00000090, 0x00000000]; /* comma rightBracket */
let llTokenSet59: number[] = [0x00000010, 0x00000000]; /* rightBracket */
let llTokenSet60: number[] = [0x00000020, 0x00000000]; /* leftBrace */
let llTokenSet61: number[] = [0x00002000, 0x00000000]; /* number */
let llTokenSet62: number[] = [0x00008000, 0x00000000]; /* regexp */
let llTokenSet63: number[] = [0x00000100, 0x00000000]; /* dot */
let llTokenSet64: number[] = [0x0421E02E, 0x00000000]; /* identifier leftBrace leftBracket leftParenthesis minus_sym not_keyword number regexp rightParenthesis string */
let llTokenSet65: number[] = [0x00000084, 0x00000000]; /* comma rightParenthesis */
let llTokenSet66: number[] = [0x00000900, 0x00000000]; /* assign dot */


function attribute_value_expr(context: ContextScope, inheritSpec: boolean, follow: LLTokenSet): LangElt {
	let expr: LangElt;
	
	let av = new AV();
	let attr: string;
	av.preComment = getAndResetIgnoreBuffer();
	getToken(5/*leftBrace*/, llTokenSet29, llTokenSet29, false);
	if (tokenInCommon(currSymbol, llTokenSet30)) {
		if (tokenInCommon(currSymbol, llTokenSet30)) {
			do {
				
				const preComment = getAndResetIgnoreBuffer(); let postComment = ""; 
				if (tokenInCommon(currSymbol, llTokenSet31)) {
					getToken(16/*identifier*/, llTokenSet32, llTokenSet32, false);
				} else if (tokenInCommon(currSymbol, llTokenSet33)) {
					getToken(14/*string*/, llTokenSet32, llTokenSet32, false);
				} else {
					llerror("syntax error after %s %.*s", lastSymbol, bufferEnd, scanBuffer);
				}
				
				attr = unquoteAttr(lastSymbol); 
				getToken(9/*colon*/, llTokenSet34, llTokenSet34, false);
				let val: LangElt = prio0expression(context,  attr === "class" ||(inheritSpec &&(attr === "name" || attr === "\"name\"")),  false, llTokenSet35);
				if (tokenInCommon(currSymbol, llTokenSet36)) {
					
					postComment = getAndResetIgnoreBuffer(); 
					getToken(7/*comma*/, llTokenSet29, llTokenSet29, false);
				}
				
				av.add(preComment, attr, val, postComment); 
				waitForToken(uniteTokenSets(llTokenSet29, follow), follow);
			} while (tokenInCommon(currSymbol, llTokenSet30));
		}
	}
	
	av.postComment = getAndResetIgnoreBuffer(); 
	getToken(6/*rightBrace*/, llTokenSet37, follow, true);
	
	expr = av.convert(); 
	return expr;
}


function cdl_file(follow: LLTokenSet): void {
	if (tokenInCommon(currSymbol, llTokenSet38)) {
		do {
			if (tokenInCommon(currSymbol, llTokenSet39)) {
				include_line(uniteTokenSets(follow, llTokenSet38));
			} else if (tokenInCommon(currSymbol, llTokenSet40)) {
				
				output(getAndResetIgnoreBuffer()); 
				getToken(10/*semicolon*/, llTokenSet38, uniteTokenSets(follow, llTokenSet38), true);
				
				output(lastSymbol); flush(); 
			} else if (tokenInCommon(currSymbol, llTokenSet41)) {
				definition(uniteTokenSets(follow, llTokenSet38));
			} else if (tokenInCommon(currSymbol, llTokenSet31)) {
				top_level_assignment(uniteTokenSets(follow, llTokenSet38));
			} else {
				llerror("syntax error after %s %.*s", lastSymbol, bufferEnd, scanBuffer);
			}
			waitForToken(uniteTokenSets(llTokenSet38, follow), follow);
		} while (tokenInCommon(currSymbol, llTokenSet38));
	}
	
	output(getAndResetIgnoreBuffer()); flush(); 
}


function definition(follow: LLTokenSet): void {
	
	output(getAndResetIgnoreBuffer()); 
	getToken(17/*varSym*/, llTokenSet31, llTokenSet31, false);
	
	output(lastSymbol + getAndResetIgnoreBuffer()); 
	getToken(16/*identifier*/, llTokenSet42, llTokenSet42, false);
	
	output(lastSymbol + getAndResetIgnoreBuffer()); 
	getToken(11/*assign*/, llTokenSet34, llTokenSet34, false);
	
	output(lastSymbol); 
	expression(follow);
}


function expression(follow: LLTokenSet): void {
	
	output(getAndResetIgnoreBuffer()); 
	let expr: LangElt = prio0expression(<ContextScope> new Object(),  false,  false, follow);
	
	output(expr.toString()); 
}


function include_line(follow: LLTokenSet): void {
	
	output(getAndResetIgnoreBuffer()); 
	getToken(18/*include*/, llTokenSet37, follow, true);
	
	output(lastSymbol); 
}


function prio0expression(context: ContextScope, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): LangElt {
	let expr: LangElt;
	expr = prio1expression(context,  inheritSpec,  firstArg, follow);
	return expr;
}


function prio1expression(context: ContextScope, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): LangElt {
	let expr: LangElt;
	expr = prio2expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet43));
	if (tokenInCommon(currSymbol, llTokenSet43)) {
		
		const preComment = getAndResetIgnoreBuffer(); 
		getToken(19/*or_keyword*/, llTokenSet34, llTokenSet34, false);
		
		let func: string = lastSymbol; 
		let expr1: LangElt = prio1expression(context,  inheritSpec,  firstArg, follow);
		
		expr = new BinOp(expr, func, 1, expr1, preComment, ""); 
	}
	return expr;
}


function prio2expression(context: ContextScope, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): LangElt {
	let expr: LangElt;
	expr = prio3expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet44));
	if (tokenInCommon(currSymbol, llTokenSet44)) {
		
		const preComment = getAndResetIgnoreBuffer(); 
		getToken(20/*and_keyword*/, llTokenSet34, llTokenSet34, false);
		
		let func: string = lastSymbol; 
		let expr1: LangElt = prio2expression(context,  inheritSpec,  firstArg, follow);
		
		expr = new BinOp(expr, func, 2, expr1, preComment, ""); 
	}
	return expr;
}


function prio3expression(context: ContextScope, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): LangElt {
	let expr: LangElt;
	expr = prio4expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet45));
	if (tokenInCommon(currSymbol, llTokenSet45)) {
		
		const preComment = getAndResetIgnoreBuffer(); 
		getToken(22/*comparison_sym*/, llTokenSet34, llTokenSet34, false);
		
		let func: string = lastSymbol; 
		let expr1: LangElt = prio4expression(context,  inheritSpec,  firstArg, follow);
		
		expr = new BinOp(expr, func, 3, expr1, preComment, ""); 
	}
	return expr;
}


function prio4expression(context: ContextScope, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): LangElt {
	let expr: LangElt;
	expr = prio5expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet46));
	if (tokenInCommon(currSymbol, llTokenSet46)) {
		
		const preComment = getAndResetIgnoreBuffer(); 
		if (tokenInCommon(currSymbol, llTokenSet47)) {
			getToken(25/*add_sym*/, llTokenSet34, uniteTokenSets(follow, llTokenSet34), true);
		} else if (tokenInCommon(currSymbol, llTokenSet48)) {
			getToken(26/*minus_sym*/, llTokenSet34, uniteTokenSets(follow, llTokenSet34), true);
		} else {
			llerror("syntax error after %s %.*s", lastSymbol, bufferEnd, scanBuffer);
		}
		
		let func: string = lastSymbol; 
		let expr1: LangElt = prio4expression(context,  inheritSpec,  firstArg, follow);
		
		expr = new BinOp(expr, func, 4, expr1, preComment, ""); 
	}
	return expr;
}


function prio5expression(context: ContextScope, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): LangElt {
	let expr: LangElt;
	expr = prio6expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet49));
	if (tokenInCommon(currSymbol, llTokenSet49)) {
		
		const preComment = getAndResetIgnoreBuffer(); 
		getToken(24/*mult_sym*/, llTokenSet34, llTokenSet34, false);
		
		let func: string = lastSymbol; 
		let expr1: LangElt = prio5expression(context,  inheritSpec,  firstArg, follow);
		
		expr = new BinOp(expr, func, 5, expr1, preComment, ""); 
	}
	return expr;
}


function prio6expression(context: ContextScope, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): LangElt {
	let expr: LangElt;
	expr = prio7expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet50));
	if (tokenInCommon(currSymbol, llTokenSet50)) {
		
		const preComment = getAndResetIgnoreBuffer(); 
		getToken(23/*power_sym*/, llTokenSet34, llTokenSet34, false);
		
		let func: string = lastSymbol; 
		let expr1: LangElt = prio6expression(context,  inheritSpec,  firstArg, follow);
		
		expr = new BinOp(expr, func, 6, expr1, preComment, ""); 
	}
	return expr;
}


function prio7expression(context: ContextScope, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): LangElt {
	let expr: LangElt = errorReturn;
	if (tokenInCommon(currSymbol, llTokenSet51)) {
		
		let func: string = "error";
		const comment = getAndResetIgnoreBuffer();
		if (tokenInCommon(currSymbol, llTokenSet48)) {
			getToken(26/*minus_sym*/, llTokenSet34, uniteTokenSets(follow, llTokenSet34), true);
			
			func = "uminus"
		} else if (tokenInCommon(currSymbol, llTokenSet52)) {
			getToken(21/*not_keyword*/, llTokenSet34, uniteTokenSets(follow, llTokenSet34), true);
			
			func = "not"
		} else {
			llerror("syntax error after %s %.*s", lastSymbol, bufferEnd, scanBuffer);
		}
		let op: LangElt = prio7expression(context,  inheritSpec,  firstArg, follow);
		
		expr = new UniOp(func, 7, op, comment, ""); 
	} else if (tokenInCommon(currSymbol, llTokenSet53)) {
		expr = prio8expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet54));
		if (tokenInCommon(currSymbol, llTokenSet54)) {
			do {
				expr = query_or_call(expr,  context,  inheritSpec, uniteTokenSets(follow, llTokenSet54));
				waitForToken(uniteTokenSets(llTokenSet54, follow), follow);
			} while (tokenInCommon(currSymbol, llTokenSet54));
		} else {
			
			if (expr instanceof Identifier && !(expr.id in cdlPreDefinedSymbols || expr.id in cdlBuiltInFunctions || expr.id in cdlJsFunctions)) {
			    expr = new JSId(expr.id, expr.comment);
			}
		}
	} else {
		llerror("prio7expression");
	}
	return expr;
}


function prio8expression(context: ContextScope, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): LangElt {
	let expr: LangElt = errorReturn;
	if (tokenInCommon(currSymbol, llTokenSet55)) {
		
		const preComment = getAndResetIgnoreBuffer(); 
		getToken(1/*leftParenthesis*/, llTokenSet34, llTokenSet34, false);
		let embExpr: LangElt = prio0expression(context,  false,  false, llTokenSet56);
		
		const postComment = getAndResetIgnoreBuffer(); 
		getToken(2/*rightParenthesis*/, llTokenSet37, follow, true);
		
		expr = new Parenthesized(embExpr, preComment, postComment); 
	} else if (tokenInCommon(currSymbol, llTokenSet57)) {
		
		let appl = new Application();
		let newContext = context;
		let isDefun: boolean = false;
		appl.preComment = getAndResetIgnoreBuffer();
		getToken(3/*leftBracket*/, llTokenSet34, llTokenSet34, false);
		for (;;) {
			let arg: LangElt = prio0expression(newContext,  false,  appl.args.length === 0, llTokenSet58);
			
			if (appl.args.length === 0 && arg instanceof Identifier && arg.id === "defun") {
			    isDefun = true;
			} else if (isDefun && appl.args.length === 1) {
			    newContext = { ...context };
			    addParametersToContext(arg, newContext);
			}
			appl.push(arg, "");
			if (!tokenInCommon(currSymbol, llTokenSet36)) {
				break;
			}
			
			appl.args[appl.args.length - 1].postComment = getAndResetIgnoreBuffer(); 
			getToken(7/*comma*/, llTokenSet34, llTokenSet34, false);
			if (tokenInCommon(currSymbol, llTokenSet59)) {
				break;
			}
		}
		
		appl.postComment = getAndResetIgnoreBuffer(); 
		getToken(4/*rightBracket*/, llTokenSet37, follow, true);
		
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
	} else if (tokenInCommon(currSymbol, llTokenSet60)) {
		expr = attribute_value_expr(context,  inheritSpec, follow);
	} else if (tokenInCommon(currSymbol, llTokenSet61)) {
		
		const comment = getAndResetIgnoreBuffer(); 
		getToken(13/*number*/, llTokenSet37, follow, true);
		
		expr = new Literal(lastSymbol, comment); 
	} else if (tokenInCommon(currSymbol, llTokenSet33)) {
		
		const comment = getAndResetIgnoreBuffer(); 
		getToken(14/*string*/, llTokenSet37, follow, true);
		
		expr = inheritSpec? new Literal(lastSymbol.substr(1, lastSymbol.length - 2), comment):
		       lastSymbol in context? context[lastSymbol].cloneWithLeadingComment(comment):
		       new Literal(lastSymbol, comment);
	} else if (tokenInCommon(currSymbol, llTokenSet62)) {
		
		const comment = getAndResetIgnoreBuffer(); 
		getToken(15/*regexp*/, llTokenSet37, follow, true);
		
		expr = new Literal(lastSymbol, comment); 
	} else if (tokenInCommon(currSymbol, llTokenSet31)) {
		
		const comment = getAndResetIgnoreBuffer(); 
		getToken(16/*identifier*/, llTokenSet37, follow, true);
		
		expr = new Identifier(lastSymbol, comment);
	} else {
		llerror("prio8expression");
	}
	return expr;
}


function query_or_call(expr_in: LangElt, context: ContextScope, inheritSpec: boolean, follow: LLTokenSet): LangElt {
	let expr_out: LangElt = errorReturn;
	if (tokenInCommon(currSymbol, llTokenSet63)) {
		
		const dotComment = getAndResetIgnoreBuffer();
		if (expr_in instanceof Identifier && !(expr_in.id in cdlPreDefinedSymbols || expr_in.id in cdlBuiltInFunctions || expr_in.id in cdlJsFunctions)) {
		    expr_in = new JSId(expr_in.id, expr_in.comment);
		}
		getToken(8/*dot*/, llTokenSet31, llTokenSet31, false);
		
		const idComment = getAndResetIgnoreBuffer(); 
		getToken(16/*identifier*/, llTokenSet37, follow, true);
		let id: string = lastSymbol;
		
		expr_out = new BinOp(expr_in, ".", 7, new Identifier(id, idComment), dotComment, ""); 
	} else if (tokenInCommon(currSymbol, llTokenSet55)) {
		
		let f: FunctionCall;
		if (expr_in instanceof Identifier && expr_in.id in cdlJsFunctions) {
		    f = new FunctionCall(expr_in, [], expr_in.exchangeLeadingComment());
		} else if (expr_in instanceof Identifier) {
		    f = new FunctionCall(new JSId(expr_in.id, ""), [], expr_in.comment);
		} else {
		    llerror("not a JavaScript function");
		    f = new FunctionCall(new Literal("error", ""), [], "");
		}
		getToken(1/*leftParenthesis*/, llTokenSet64, llTokenSet64, false);
		if (tokenInCommon(currSymbol, llTokenSet34)) {
			for (;;) {
				let arg: LangElt = prio0expression(context,  inheritSpec,  false, llTokenSet65);
				
				f.push(arg, ""); 
				if (!tokenInCommon(currSymbol, llTokenSet36)) {
					break;
				}
				
				f.args[f.args.length - 1].postComment = getAndResetIgnoreBuffer(); 
				getToken(7/*comma*/, llTokenSet34, llTokenSet34, false);
				if (tokenInCommon(currSymbol, llTokenSet56)) {
					break;
				}
			}
		}
		
		f.postComment = getAndResetIgnoreBuffer(); 
		getToken(2/*rightParenthesis*/, llTokenSet37, follow, true);
		
		expr_out = f; 
	} else {
		llerror("query_or_call");
	}
	return expr_out;
}


function top_level_assignment(follow: LLTokenSet): void {
	
	output(getAndResetIgnoreBuffer()); 
	for (;;) {
		getToken(16/*identifier*/, llTokenSet66, llTokenSet66, false);
		
		output(lastSymbol + getAndResetIgnoreBuffer()); 
		if (!tokenInCommon(currSymbol, llTokenSet63)) {
			break;
		}
		getToken(8/*dot*/, llTokenSet31, llTokenSet31, false);
		
		output(lastSymbol + getAndResetIgnoreBuffer()); 
	}
	getToken(11/*assign*/, llTokenSet34, llTokenSet34, false);
	
	output(lastSymbol); 
	expression(follow);
}



var inputString: string, inputPosition: number;

function getNextCharacter() {
    return inputPosition < inputString.length?
           inputString[inputPosition++]: undefined;
}

export function parse(str: string, ): void {
    inputString = str;
    inputPosition = 0;
    llLineNumber = 1;
    llLinePosition = 1;
    errorOccurred = false;
    currSymbol = [];
    scanBuffer = "";
    lastSymbol = "";
    lastSymbolPos = {line: 0, position: 0};
    bufferEnd = 0;
    bufferFill = 0;
    atEOF = false;
    nextSymbol();
    cdl_file(endOfInputSet);
}

declare function require(pkg: string): any;
declare var process: any;
var fs = require("fs");
parse(fs.readFileSync(process.argv[2]).toString());
