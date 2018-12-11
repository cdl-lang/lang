

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


type LLTokenSet = number[];

type KeyWordList = {[keyword:string]: number}|undefined;

const endOfInput = 39;
const nrTokens = 39;
const endOfInputSet = [0, 0x00000100]; 
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
let lastSymbol = "";
export let lastSymbolPos = {line: 0, position: 0};
let bufferEnd = 0;
let bufferFill = 0;
let atEOF = false;
let llTokenSet1: number[] = [0x00004000, 0x00000000]; /* string */
let llTokenSet2: number[] = [0x00010000, 0x00000000]; /* identifier */
let llTokenSet3: number[] = [0x00200000, 0x00000000]; /* and_keyword */
let llTokenSet4: number[] = [0x01000000, 0x00000000]; /* power_sym */
let llTokenSet5: number[] = [0x00002000, 0x00000000]; /* number */
let llTokenSet6: number[] = [0x00000001, 0x00000000]; /* */
let llTokenSet7: number[] = [0x00040000, 0x00000000]; /* include */
let llTokenSet8: number[] = [0x00040001, 0x00000000]; /* include */
let llTokenSet9: number[] = [0x00040001, 0x00000000]; /* include */
let llTokenSet10: number[] = [0x00008000, 0x00000000]; /* regexp */
let llTokenSet11: number[] = [0x00000000, 0x00000001]; /* globalContextSymbol */
let llTokenSet12: number[] = [0x00000000, 0x00000002]; /* functionSymbol */
let llTokenSet13: number[] = [0x00800000, 0x00000000]; /* comparison_sym */
let llTokenSet14: number[] = [0x00100000, 0x00000000]; /* or_keyword */
let llTokenSet15: number[] = [0x00000040, 0x00000000]; /* rightBrace */
let llTokenSet16: number[] = [0x00080000, 0x00000000]; /* pipe_symbol */
let llTokenSet17: number[] = [0x00000020, 0x00000000]; /* leftBrace */
let llTokenSet18: number[] = [0x08000000, 0x00000000]; /* caret */
let llTokenSet19: number[] = [0x00000010, 0x00000000]; /* rightBracket */
let llTokenSet20: number[] = [0x00000008, 0x00000000]; /* leftBracket */
let llTokenSet21: number[] = [0x00001000, 0x00000000]; /* question_mark */
let llTokenSet22: number[] = [0x00000800, 0x00000000]; /* assign */
let llTokenSet23: number[] = [0x00000400, 0x00000000]; /* semicolon */
let llTokenSet24: number[] = [0x00000200, 0x00000000]; /* colon */
let llTokenSet25: number[] = [0x02000000, 0x00000000]; /* mult_sym */
let llTokenSet26: number[] = [0x00000100, 0x00000000]; /* dot */
let llTokenSet27: number[] = [0x40000000, 0x00000000]; /* minus_sym */
let llTokenSet28: number[] = [0x00000080, 0x00000000]; /* comma */
let llTokenSet29: number[] = [0x20000000, 0x00000000]; /* add_sym */
let llTokenSet30: number[] = [0x04000000, 0x00000000]; /* asterisk */
let llTokenSet31: number[] = [0x00000004, 0x00000000]; /* rightParenthesis */
let llTokenSet32: number[] = [0x00000002, 0x00000000]; /* leftParenthesis */
let llTokenSet33: number[] = [0x10000000, 0x00000000]; /* hash */
let llTokenSet34: number[] = [0x00400000, 0x00000000]; /* not_keyword */
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
	"pipe_symbol",
	"or_keyword",
	"and_keyword",
	"not_keyword",
	"comparison_sym",
	"power_sym",
	"mult_sym",
	"asterisk",
	"caret",
	"hash",
	"add_sym",
	"minus_sym",
	"globalContextSymbol",
	"functionSymbol",
	"@&^@#&^",
	"@&^@#&^",
	"@&^@#&^",
	"\"class\"",
	"name",
	"\"name\"",
	"EOF",
];
const scanTab = [
/*   0 */ {
            '~': {destination:45,accept:llTokenSet13},
		    '}': {destination:47,accept:llTokenSet15},
		    '|': {destination:48,accept:llTokenSet16},
		    '{': {destination:49,accept:llTokenSet17},
		    '^': {destination:50,accept:llTokenSet18},
		    ']': {destination:51,accept:llTokenSet19},
		    '[': {destination:52,accept:llTokenSet20},
		    '?': {destination:53,accept:llTokenSet21},
		    '>': {destination:55,accept:llTokenSet13},
		    '<': {destination:55,accept:llTokenSet13},
		    '=': {destination:54,accept:llTokenSet22},
		    ';': {destination:56,accept:llTokenSet23},
		    ':': {destination:57,accept:llTokenSet24},
		    '9': {destination:42,accept:llTokenSet5},
		    '8': {destination:42,accept:llTokenSet5},
		    '7': {destination:42,accept:llTokenSet5},
		    '6': {destination:42,accept:llTokenSet5},
		    '5': {destination:42,accept:llTokenSet5},
		    '4': {destination:42,accept:llTokenSet5},
		    '3': {destination:42,accept:llTokenSet5},
		    '2': {destination:42,accept:llTokenSet5},
		    '1': {destination:42,accept:llTokenSet5},
		    '0': {destination:42,accept:llTokenSet5},
		    '/': {destination:58,accept:llTokenSet25},
		    '.': {destination:59,accept:llTokenSet26},
		    '-': {destination:60,accept:llTokenSet27},
		    ',': {destination:61,accept:llTokenSet28},
		    '+': {destination:62,accept:llTokenSet29},
		    '*': {destination:63,accept:llTokenSet30},
		    ')': {destination:64,accept:llTokenSet31},
		    '(': {destination:65,accept:llTokenSet32},
		    '\'': {destination:9},
		    '&': {destination:66},
		    '%': {destination:67,accept:llTokenSet25},
		    '#': {destination:68,accept:llTokenSet33},
		    '"': {destination:4},
		    '!': {destination:69,accept:llTokenSet34},
		    ' ': {destination:70,accept:llTokenSet6},
		    '\x0d': {destination:70,accept:llTokenSet6},
		    '\x0a': {destination:70,accept:llTokenSet6},
		    '\x09': {destination:70,accept:llTokenSet6},
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
		    '@': {},
		    '\\': {},
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
            'e': {destination:41},
		    'E': {destination:41},
		    '9': {destination:11,accept:llTokenSet5},
		    '8': {destination:11,accept:llTokenSet5},
		    '7': {destination:11,accept:llTokenSet5},
		    '6': {destination:11,accept:llTokenSet5},
		    '5': {destination:11,accept:llTokenSet5},
		    '4': {destination:11,accept:llTokenSet5},
		    '3': {destination:11,accept:llTokenSet5},
		    '2': {destination:11,accept:llTokenSet5},
		    '1': {destination:11,accept:llTokenSet5},
		    '0': {destination:11,accept:llTokenSet5},
		    '': {},
          },
/*  12 */ undefined,
/*  13 */ {
            '*': {destination:14},
		    '': {destination:13},
          },
/*  14 */ {
            '/': {destination:12,accept:llTokenSet6},
		    '': {destination:13},
          },
/*  15 */ {
            '\\': {destination:16},
		    '"': {destination:17,accept:llTokenSet7},
		    ' ': {destination:15,accept:llTokenSet7},
		    '': {destination:22},
          },
/*  16 */ {
            '\\': {destination:16},
		    '"': {destination:15,accept:llTokenSet7},
		    '': {destination:22},
          },
/*  17 */ {
            ' ': {destination:17,accept:llTokenSet7},
		    '': {},
          },
/*  18 */ {
            ' ': {destination:18,accept:llTokenSet8},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:34,accept:llTokenSet6},
          },
/*  19 */ {
            '\\': {destination:20,accept:llTokenSet6},
		    '"': {destination:18,accept:llTokenSet8},
		    ' ': {destination:19,accept:llTokenSet9},
		    '\x0d': {destination:22},
		    '\x0a': {destination:22},
		    '\x00': {destination:22},
		    '': {destination:21,accept:llTokenSet6},
          },
/*  20 */ {
            '\\': {destination:20,accept:llTokenSet6},
		    '"': {destination:19,accept:llTokenSet9},
		    '\x0d': {destination:22},
		    '\x0a': {destination:22},
		    '\x00': {destination:22},
		    '': {destination:21,accept:llTokenSet6},
          },
/*  21 */ {
            '\\': {destination:20,accept:llTokenSet6},
		    '"': {destination:18,accept:llTokenSet8},
		    '\x0d': {destination:22},
		    '\x0a': {destination:22},
		    '\x00': {destination:22},
		    '': {destination:21,accept:llTokenSet6},
          },
/*  22 */ {
            '\\': {destination:16},
		    '"': {destination:17,accept:llTokenSet7},
		    '': {destination:22},
          },
/*  23 */ {
            '>': {destination:18,accept:llTokenSet8},
		    '\x0d': {destination:24},
		    '\x00': {destination:24},
		    '\x0a': {},
		    '': {destination:23,accept:llTokenSet6},
          },
/*  24 */ {
            '>': {destination:17,accept:llTokenSet7},
		    '\x0a': {},
		    '': {destination:24},
          },
/*  25 */ {
            '>': {destination:34,accept:llTokenSet6},
		    '\x0d': {destination:24},
		    '\x00': {destination:24},
		    '\x0a': {},
		    '': {destination:23,accept:llTokenSet6},
          },
/*  26 */ {
            '\\': {destination:20,accept:llTokenSet6},
		    '"': {destination:34,accept:llTokenSet6},
		    '\x0d': {destination:22},
		    '\x0a': {destination:22},
		    '\x00': {destination:22},
		    '': {destination:21,accept:llTokenSet6},
          },
/*  27 */ {
            '<': {destination:25,accept:llTokenSet6},
		    '"': {destination:26,accept:llTokenSet6},
		    ' ': {destination:27,accept:llTokenSet6},
		    '\x09': {destination:27,accept:llTokenSet6},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:34,accept:llTokenSet6},
          },
/*  28 */ {
            ':': {destination:27,accept:llTokenSet6},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:34,accept:llTokenSet6},
          },
/*  29 */ {
            '%': {destination:28,accept:llTokenSet6},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:34,accept:llTokenSet6},
          },
/*  30 */ {
            'z': {destination:30,accept:llTokenSet6},
		    'y': {destination:30,accept:llTokenSet6},
		    'x': {destination:30,accept:llTokenSet6},
		    'w': {destination:30,accept:llTokenSet6},
		    'v': {destination:30,accept:llTokenSet6},
		    'u': {destination:30,accept:llTokenSet6},
		    't': {destination:30,accept:llTokenSet6},
		    's': {destination:30,accept:llTokenSet6},
		    'r': {destination:30,accept:llTokenSet6},
		    'q': {destination:30,accept:llTokenSet6},
		    'p': {destination:30,accept:llTokenSet6},
		    'o': {destination:30,accept:llTokenSet6},
		    'n': {destination:30,accept:llTokenSet6},
		    'm': {destination:30,accept:llTokenSet6},
		    'l': {destination:30,accept:llTokenSet6},
		    'k': {destination:30,accept:llTokenSet6},
		    'j': {destination:30,accept:llTokenSet6},
		    'i': {destination:30,accept:llTokenSet6},
		    'h': {destination:30,accept:llTokenSet6},
		    'g': {destination:30,accept:llTokenSet6},
		    'f': {destination:30,accept:llTokenSet6},
		    'e': {destination:30,accept:llTokenSet6},
		    'd': {destination:30,accept:llTokenSet6},
		    'c': {destination:30,accept:llTokenSet6},
		    'b': {destination:30,accept:llTokenSet6},
		    'a': {destination:30,accept:llTokenSet6},
		    '%': {destination:29,accept:llTokenSet6},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:34,accept:llTokenSet6},
          },
/*  31 */ {
            'z': {destination:30,accept:llTokenSet6},
		    'y': {destination:30,accept:llTokenSet6},
		    'x': {destination:30,accept:llTokenSet6},
		    'w': {destination:30,accept:llTokenSet6},
		    'v': {destination:30,accept:llTokenSet6},
		    'u': {destination:30,accept:llTokenSet6},
		    't': {destination:30,accept:llTokenSet6},
		    's': {destination:30,accept:llTokenSet6},
		    'r': {destination:30,accept:llTokenSet6},
		    'q': {destination:30,accept:llTokenSet6},
		    'p': {destination:30,accept:llTokenSet6},
		    'o': {destination:30,accept:llTokenSet6},
		    'n': {destination:30,accept:llTokenSet6},
		    'm': {destination:30,accept:llTokenSet6},
		    'l': {destination:30,accept:llTokenSet6},
		    'k': {destination:30,accept:llTokenSet6},
		    'j': {destination:30,accept:llTokenSet6},
		    'i': {destination:30,accept:llTokenSet6},
		    'h': {destination:30,accept:llTokenSet6},
		    'g': {destination:30,accept:llTokenSet6},
		    'f': {destination:30,accept:llTokenSet6},
		    'e': {destination:30,accept:llTokenSet6},
		    'd': {destination:30,accept:llTokenSet6},
		    'c': {destination:30,accept:llTokenSet6},
		    'b': {destination:30,accept:llTokenSet6},
		    'a': {destination:30,accept:llTokenSet6},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:34,accept:llTokenSet6},
          },
/*  32 */ {
            '%': {destination:31,accept:llTokenSet6},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:34,accept:llTokenSet6},
          },
/*  33 */ {
            '%': {destination:32,accept:llTokenSet6},
		    ' ': {destination:33,accept:llTokenSet6},
		    '\x09': {destination:33,accept:llTokenSet6},
		    '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:34,accept:llTokenSet6},
          },
/*  34 */ {
            '\x00': {},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:34,accept:llTokenSet6},
          },
/*  35 */ {
            'y': {destination:35,accept:llTokenSet10},
		    'u': {destination:35,accept:llTokenSet10},
		    'm': {destination:35,accept:llTokenSet10},
		    'i': {destination:35,accept:llTokenSet10},
		    'g': {destination:35,accept:llTokenSet10},
		    '': {},
          },
/*  36 */ {
            'y': {destination:36,accept:llTokenSet10},
		    'u': {destination:36,accept:llTokenSet10},
		    'm': {destination:36,accept:llTokenSet10},
		    'i': {destination:36,accept:llTokenSet10},
		    'g': {destination:36,accept:llTokenSet10},
		    '\\': {destination:37},
		    '/': {destination:35,accept:llTokenSet10},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:38},
          },
/*  37 */ {
            '\\': {destination:37},
		    '/': {destination:36,accept:llTokenSet10},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:38},
          },
/*  38 */ {
            '\\': {destination:37},
		    '/': {destination:35,accept:llTokenSet10},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:38},
          },
/*  39 */ {
            '9': {destination:39,accept:llTokenSet5},
		    '8': {destination:39,accept:llTokenSet5},
		    '7': {destination:39,accept:llTokenSet5},
		    '6': {destination:39,accept:llTokenSet5},
		    '5': {destination:39,accept:llTokenSet5},
		    '4': {destination:39,accept:llTokenSet5},
		    '3': {destination:39,accept:llTokenSet5},
		    '2': {destination:39,accept:llTokenSet5},
		    '1': {destination:39,accept:llTokenSet5},
		    '0': {destination:39,accept:llTokenSet5},
		    '': {},
          },
/*  40 */ {
            '9': {destination:39,accept:llTokenSet5},
		    '8': {destination:39,accept:llTokenSet5},
		    '7': {destination:39,accept:llTokenSet5},
		    '6': {destination:39,accept:llTokenSet5},
		    '5': {destination:39,accept:llTokenSet5},
		    '4': {destination:39,accept:llTokenSet5},
		    '3': {destination:39,accept:llTokenSet5},
		    '2': {destination:39,accept:llTokenSet5},
		    '1': {destination:39,accept:llTokenSet5},
		    '0': {destination:39,accept:llTokenSet5},
		    '': {},
          },
/*  41 */ {
            '9': {destination:39,accept:llTokenSet5},
		    '8': {destination:39,accept:llTokenSet5},
		    '7': {destination:39,accept:llTokenSet5},
		    '6': {destination:39,accept:llTokenSet5},
		    '5': {destination:39,accept:llTokenSet5},
		    '4': {destination:39,accept:llTokenSet5},
		    '3': {destination:39,accept:llTokenSet5},
		    '2': {destination:39,accept:llTokenSet5},
		    '1': {destination:39,accept:llTokenSet5},
		    '0': {destination:39,accept:llTokenSet5},
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
		    '': {destination:40},
          },
/*  42 */ {
            'e': {destination:41},
		    'E': {destination:41},
		    '9': {destination:42,accept:llTokenSet5},
		    '8': {destination:42,accept:llTokenSet5},
		    '7': {destination:42,accept:llTokenSet5},
		    '6': {destination:42,accept:llTokenSet5},
		    '5': {destination:42,accept:llTokenSet5},
		    '4': {destination:42,accept:llTokenSet5},
		    '3': {destination:42,accept:llTokenSet5},
		    '2': {destination:42,accept:llTokenSet5},
		    '1': {destination:42,accept:llTokenSet5},
		    '0': {destination:42,accept:llTokenSet5},
		    '.': {destination:11,accept:llTokenSet5},
		    '': {},
          },
/*  43 */ undefined,
/*  44 */ undefined,
/*  45 */ undefined,
/*  46 */ undefined,
/*  47 */ undefined,
/*  48 */ {
            '|': {destination:46,accept:llTokenSet14},
		    '': {},
          },
/*  49 */ undefined,
/*  50 */ undefined,
/*  51 */ undefined,
/*  52 */ undefined,
/*  53 */ undefined,
/*  54 */ {
            '>': {destination:44,accept:llTokenSet12},
		    '=': {destination:45,accept:llTokenSet13},
		    '': {},
          },
/*  55 */ {
            '=': {destination:45,accept:llTokenSet13},
		    '': {},
          },
/*  56 */ undefined,
/*  57 */ {
            ':': {destination:43,accept:llTokenSet11},
		    '': {},
          },
/*  58 */ {
            '\\': {destination:37},
		    '/': {destination:33,accept:llTokenSet6},
		    '*': {destination:13},
		    '\x0a': {},
		    '\x0d': {},
		    '': {destination:38},
          },
/*  59 */ {
            '9': {destination:11,accept:llTokenSet5},
		    '8': {destination:11,accept:llTokenSet5},
		    '7': {destination:11,accept:llTokenSet5},
		    '6': {destination:11,accept:llTokenSet5},
		    '5': {destination:11,accept:llTokenSet5},
		    '4': {destination:11,accept:llTokenSet5},
		    '3': {destination:11,accept:llTokenSet5},
		    '2': {destination:11,accept:llTokenSet5},
		    '1': {destination:11,accept:llTokenSet5},
		    '0': {destination:11,accept:llTokenSet5},
		    '': {},
          },
/*  60 */ undefined,
/*  61 */ undefined,
/*  62 */ undefined,
/*  63 */ {
            '*': {destination:10,accept:llTokenSet4},
		    '': {},
          },
/*  64 */ undefined,
/*  65 */ undefined,
/*  66 */ {
            '&': {destination:6,accept:llTokenSet3},
		    '': {},
          },
/*  67 */ undefined,
/*  68 */ undefined,
/*  69 */ {
            '=': {destination:45,accept:llTokenSet13},
		    '': {},
          },
/*  70 */ {
            ' ': {destination:70,accept:llTokenSet6},
		    '\x0d': {destination:70,accept:llTokenSet6},
		    '\x0a': {destination:70,accept:llTokenSet6},
		    '\x09': {destination:70,accept:llTokenSet6},
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
            /* If nothing recognized, continue; no need to copy buffer */
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

let llTokenSet35: number[] = [0x1C014040, 0x00000000]; /* asterisk caret hash identifier rightBrace string */
let llTokenSet36: number[] = [0x1C014000, 0x00000000]; /* asterisk caret hash identifier string */
let llTokenSet37: number[] = [0x00014000, 0x00000000]; /* identifier string */
let llTokenSet38: number[] = [0x00010000, 0x00000000]; /* identifier */
let llTokenSet39: number[] = [0x00000200, 0x00000000]; /* colon */
let llTokenSet40: number[] = [0x00004000, 0x00000000]; /* string */
let llTokenSet41: number[] = [0x1C000000, 0x00000000]; /* asterisk caret hash */
let llTokenSet42: number[] = [0x04000000, 0x00000000]; /* asterisk */
let llTokenSet43: number[] = [0x08000000, 0x00000000]; /* caret */
let llTokenSet44: number[] = [0x10000000, 0x00000000]; /* hash */
let llTokenSet45: number[] = [0x6041E02A, 0x00000001]; /* add_sym globalContextSymbol identifier leftBrace leftBracket leftParenthesis minus_sym not_keyword number regexp string */
let llTokenSet46: number[] = [0x000000C0, 0x00000000]; /* comma rightBrace */
let llTokenSet47: number[] = [0x00000080, 0x00000000]; /* comma */
let llTokenSet48: number[] = [0x00000040, 0x00000000]; /* rightBrace */
let llTokenSet49: number[] = [0x00000000, 0x00000000]; /* */
let llTokenSet50: number[] = [0x00070400, 0x00000000]; /* identifier include semicolon varSym */
let llTokenSet51: number[] = [0x00040000, 0x00000000]; /* include */
let llTokenSet52: number[] = [0x00000400, 0x00000000]; /* semicolon */
let llTokenSet53: number[] = [0x00020000, 0x00000000]; /* varSym */
let llTokenSet54: number[] = [0x00000800, 0x00000000]; /* assign */
let llTokenSet55: number[] = [0x00001000, 0x00000002]; /* functionSymbol question_mark */
let llTokenSet56: number[] = [0x00000000, 0x00000002]; /* functionSymbol */
let llTokenSet57: number[] = [0x00001000, 0x00000000]; /* question_mark */
let llTokenSet58: number[] = [0x00080000, 0x00000000]; /* pipe_symbol */
let llTokenSet59: number[] = [0x00100000, 0x00000000]; /* or_keyword */
let llTokenSet60: number[] = [0x00200000, 0x00000000]; /* and_keyword */
let llTokenSet61: number[] = [0x00800000, 0x00000000]; /* comparison_sym */
let llTokenSet62: number[] = [0x60000000, 0x00000000]; /* add_sym minus_sym */
let llTokenSet63: number[] = [0x20000000, 0x00000000]; /* add_sym */
let llTokenSet64: number[] = [0x40000000, 0x00000000]; /* minus_sym */
let llTokenSet65: number[] = [0x06000000, 0x00000000]; /* asterisk mult_sym */
let llTokenSet66: number[] = [0x02000000, 0x00000000]; /* mult_sym */
let llTokenSet67: number[] = [0x01000000, 0x00000000]; /* power_sym */
let llTokenSet68: number[] = [0x40400000, 0x00000000]; /* minus_sym not_keyword */
let llTokenSet69: number[] = [0x00400000, 0x00000000]; /* not_keyword */
let llTokenSet70: number[] = [0x0001E02A, 0x00000001]; /* globalContextSymbol identifier leftBrace leftBracket leftParenthesis number regexp string */
let llTokenSet71: number[] = [0x00000102, 0x00000000]; /* dot leftParenthesis */
let llTokenSet72: number[] = [0x00000002, 0x00000000]; /* leftParenthesis */
let llTokenSet73: number[] = [0x00000004, 0x00000000]; /* rightParenthesis */
let llTokenSet74: number[] = [0x00000008, 0x00000000]; /* leftBracket */
let llTokenSet75: number[] = [0x00000090, 0x00000000]; /* comma rightBracket */
let llTokenSet76: number[] = [0x00000010, 0x00000000]; /* rightBracket */
let llTokenSet77: number[] = [0x00000020, 0x00000000]; /* leftBrace */
let llTokenSet78: number[] = [0x00002000, 0x00000000]; /* number */
let llTokenSet79: number[] = [0x00008000, 0x00000000]; /* regexp */
let llTokenSet80: number[] = [0x00000000, 0x00000001]; /* globalContextSymbol */
let llTokenSet81: number[] = [0x00000100, 0x00000000]; /* dot */
let llTokenSet82: number[] = [0x6041E02E, 0x00000001]; /* add_sym globalContextSymbol identifier leftBrace leftBracket leftParenthesis minus_sym not_keyword number regexp rightParenthesis string */
let llTokenSet83: number[] = [0x00000084, 0x00000000]; /* comma rightParenthesis */
let llTokenSet84: number[] = [0x00000900, 0x00000000]; /* assign dot */


function attribute_value_expr(context: any, inheritSpec: boolean, follow: LLTokenSet): CDLValue {
	let expr: CDLValue;
	
	let av: any = {};
	let attr: string = "";
	getToken(5/*leftBrace*/, llTokenSet35, llTokenSet35, false);
	if (tokenInCommon(currSymbol, llTokenSet36)) {
		for (;;) {
			if (tokenInCommon(currSymbol, llTokenSet37)) {
				if (tokenInCommon(currSymbol, llTokenSet38)) {
					getToken(16/*identifier*/, llTokenSet39, llTokenSet39, false);
				} else if (tokenInCommon(currSymbol, llTokenSet40)) {
					getToken(14/*string*/, llTokenSet39, llTokenSet39, false);
				} else {
					llerror("syntax error after %s %.*s", lastSymbol, bufferEnd, scanBuffer);
				}
				
				attr = lastSymbol === "class"? "\"class\"": lastSymbol; 
			} else if (tokenInCommon(currSymbol, llTokenSet41)) {
				if (tokenInCommon(currSymbol, llTokenSet42)) {
					getToken(26/*asterisk*/, llTokenSet38, llTokenSet38, false);
				} else if (tokenInCommon(currSymbol, llTokenSet43)) {
					getToken(27/*caret*/, llTokenSet38, llTokenSet38, false);
				} else if (tokenInCommon(currSymbol, llTokenSet44)) {
					getToken(28/*hash*/, llTokenSet38, llTokenSet38, false);
				} else {
					llerror("syntax error after %s %.*s", lastSymbol, bufferEnd, scanBuffer);
				}
				
				attr = lastSymbol; 
				getToken(16/*identifier*/, llTokenSet39, llTokenSet39, false);
				
				attr = '"' + attr + lastSymbol + '"'; 
			} else {
				llerror("syntax error after %s %.*s", lastSymbol, bufferEnd, scanBuffer);
			}
			getToken(9/*colon*/, llTokenSet45, llTokenSet45, false);
			let val: CDLValue = prio0expression(context,  attr === "\"class\"" ||(inheritSpec &&(attr === "name" || attr === "\"name\"")),  false, llTokenSet46);
			
			av[attr] = val; 
			if (!tokenInCommon(currSymbol, llTokenSet47)) {
				break;
			}
			getToken(7/*comma*/, llTokenSet36, llTokenSet36, false);
			if (tokenInCommon(currSymbol, llTokenSet48)) {
				break;
			}
		}
	}
	getToken(6/*rightBrace*/, llTokenSet49, follow, true);
	
	expr = av; 
	return expr;
}


function cdl_file(follow: LLTokenSet): void {
	
	initParser(); 
	if (tokenInCommon(currSymbol, llTokenSet50)) {
		do {
			if (tokenInCommon(currSymbol, llTokenSet51)) {
				include_line(uniteTokenSets(follow, llTokenSet50));
			} else if (tokenInCommon(currSymbol, llTokenSet52)) {
				getToken(10/*semicolon*/, llTokenSet50, uniteTokenSets(follow, llTokenSet50), true);
				
				output(lastSymbol); newline(); 
			} else if (tokenInCommon(currSymbol, llTokenSet53)) {
				definition(uniteTokenSets(follow, llTokenSet50));
			} else if (tokenInCommon(currSymbol, llTokenSet38)) {
				top_level_assignment(uniteTokenSets(follow, llTokenSet50));
			} else {
				llerror("syntax error after %s %.*s", lastSymbol, bufferEnd, scanBuffer);
			}
			waitForToken(uniteTokenSets(llTokenSet50, follow), follow);
		} while (tokenInCommon(currSymbol, llTokenSet50));
	}
	
	newline(); 
}


function definition(follow: LLTokenSet): void {
	getToken(17/*varSym*/, llTokenSet38, llTokenSet38, false);
	
	newline(); output(lastSymbol) 
	getToken(16/*identifier*/, llTokenSet54, llTokenSet54, false);
	
	output(" " + lastSymbol); 
	getToken(11/*assign*/, llTokenSet45, llTokenSet45, false);
	
	output(" " + lastSymbol + " "); 
	expression(follow);
}


function expression(follow: LLTokenSet): void {
	let expr: CDLValue = prio0expression(new Object(),  false,  false, follow);
	
	output(cdlify(expr, "")); 
}


function include_line(follow: LLTokenSet): void {
	getToken(18/*include*/, llTokenSet49, follow, true);
	
	newline(); output(lastSymbol); newline(); 
}


function prio0expression(context: any, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): CDLValue {
	let expr: CDLValue;
	expr = prio1expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet55));
	if (tokenInCommon(currSymbol, llTokenSet55)) {
		if (tokenInCommon(currSymbol, llTokenSet56)) {
			getToken(32/*functionSymbol*/, llTokenSet45, llTokenSet45, false);
			
			let newContext = { ...context };
			let parameters: CDLValue = addParametersToContext(expr, newContext);
			let body: CDLValue = prio0expression(newContext,  false,  false, follow);
			
			expr = [new LangId("defun"), parameters, body]; 
		} else if (tokenInCommon(currSymbol, llTokenSet57)) {
			getToken(12/*question_mark*/, llTokenSet45, llTokenSet45, false);
			
			let alts: CompFunction = new CompFunction("o", []);
			for (;;) {
				let match: CDLValue = prio1expression(context,  inheritSpec,  firstArg, llTokenSet39);
				getToken(9/*colon*/, llTokenSet45, llTokenSet45, false);
				let res: CDLValue = prio1expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet58));
				
				alts.args.push({on: match, use: res}); 
				if (!tokenInCommon(currSymbol, llTokenSet58)) {
					break;
				}
				getToken(19/*pipe_symbol*/, llTokenSet45, llTokenSet45, false);
			}
			
			expr = [
			    new LangId("cond"),
			    expr,
			    alts
			];
		} else {
			llerror("syntax error after %s %.*s", lastSymbol, bufferEnd, scanBuffer);
		}
	}
	return expr;
}


function prio1expression(context: any, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): CDLValue {
	let expr: CDLValue;
	
	let func: LangId|undefined = undefined; 
	for (;;) {
		let expr1: CDLValue = prio2expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet59));
		
		expr = func === undefined? expr1: [func, expr!, expr1];
		if (!tokenInCommon(currSymbol, llTokenSet59)) {
			break;
		}
		getToken(20/*or_keyword*/, llTokenSet45, llTokenSet45, false);
		
		func = lookupFunction(lastSymbol);
	}
	return expr;
}


function prio2expression(context: any, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): CDLValue {
	let expr: CDLValue;
	
	let func: LangId|undefined = undefined; 
	for (;;) {
		let expr1: CDLValue = prio3expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet60));
		
		expr = func === undefined? expr1: [func, expr!, expr1];
		if (!tokenInCommon(currSymbol, llTokenSet60)) {
			break;
		}
		getToken(21/*and_keyword*/, llTokenSet45, llTokenSet45, false);
		
		func = lookupFunction(lastSymbol);
	}
	return expr;
}


function prio3expression(context: any, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): CDLValue {
	let expr: CDLValue;
	
	let func: LangId|undefined = undefined; 
	for (;;) {
		let expr1: CDLValue = prio4expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet61));
		
		expr = func === undefined? expr1: [func, expr!, expr1];
		if (!tokenInCommon(currSymbol, llTokenSet61)) {
			break;
		}
		getToken(23/*comparison_sym*/, llTokenSet45, llTokenSet45, false);
		
		func = lookupFunction(lastSymbol);
	}
	return expr;
}


function prio4expression(context: any, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): CDLValue {
	let expr: CDLValue;
	
	let func: LangId|undefined = undefined; 
	for (;;) {
		let expr1: CDLValue = prio5expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet62));
		
		expr = func === undefined? expr1: [func, expr!, expr1];
		if (!tokenInCommon(currSymbol, llTokenSet62)) {
			break;
		}
		if (tokenInCommon(currSymbol, llTokenSet63)) {
			getToken(29/*add_sym*/, llTokenSet45, llTokenSet45, false);
		} else if (tokenInCommon(currSymbol, llTokenSet64)) {
			getToken(30/*minus_sym*/, llTokenSet45, llTokenSet45, false);
		} else {
			llerror("syntax error after %s %.*s", lastSymbol, bufferEnd, scanBuffer);
		}
		
		func = lookupFunction(lastSymbol);
	}
	return expr;
}


function prio5expression(context: any, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): CDLValue {
	let expr: CDLValue;
	
	let func: LangId|undefined = undefined; 
	for (;;) {
		let expr1: CDLValue = prio6expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet65));
		
		expr = func === undefined? expr1: [func, expr!, expr1];
		if (!tokenInCommon(currSymbol, llTokenSet65)) {
			break;
		}
		if (tokenInCommon(currSymbol, llTokenSet66)) {
			getToken(25/*mult_sym*/, llTokenSet45, llTokenSet45, false);
		} else if (tokenInCommon(currSymbol, llTokenSet42)) {
			getToken(26/*asterisk*/, llTokenSet45, llTokenSet45, false);
		} else {
			llerror("syntax error after %s %.*s", lastSymbol, bufferEnd, scanBuffer);
		}
		
		func = lookupFunction(lastSymbol);
	}
	return expr;
}


function prio6expression(context: any, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): CDLValue {
	let expr: CDLValue;
	
	let func: LangId|undefined = undefined; 
	for (;;) {
		let expr1: CDLValue = prio7expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet67));
		
		expr = func === undefined? expr1: [func, expr!, expr1];
		if (!tokenInCommon(currSymbol, llTokenSet67)) {
			break;
		}
		getToken(24/*power_sym*/, llTokenSet45, llTokenSet45, false);
		
		func = lookupFunction(lastSymbol);
	}
	return expr;
}


function prio7expression(context: any, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): CDLValue {
	let expr: CDLValue = [];
	if (tokenInCommon(currSymbol, llTokenSet68)) {
		
		let func: string = "not"; 
		if (tokenInCommon(currSymbol, llTokenSet64)) {
			getToken(30/*minus_sym*/, llTokenSet45, uniteTokenSets(follow, llTokenSet45), true);
			
			func = "uminus"; 
		} else if (tokenInCommon(currSymbol, llTokenSet69)) {
			getToken(22/*not_keyword*/, llTokenSet45, uniteTokenSets(follow, llTokenSet45), true);
			
			func = "not"; 
		} else {
			llerror("syntax error after %s %.*s", lastSymbol, bufferEnd, scanBuffer);
		}
		let op: CDLValue = prio7expression(context,  inheritSpec,  firstArg, follow);
		
		expr = [lookupFunction(func), op]; 
	} else if (tokenInCommon(currSymbol, llTokenSet63)) {
		getToken(29/*add_sym*/, llTokenSet45, llTokenSet45, false);
		expr = prio7expression(context,  inheritSpec,  firstArg, follow);
	} else if (tokenInCommon(currSymbol, llTokenSet70)) {
		expr = prio8expression(context,  inheritSpec,  firstArg, uniteTokenSets(follow, llTokenSet71));
		if (tokenInCommon(currSymbol, llTokenSet71)) {
			do {
				expr = query_or_call(expr,  context,  inheritSpec, uniteTokenSets(follow, llTokenSet71));
				waitForToken(uniteTokenSets(llTokenSet71, follow), follow);
			} while (tokenInCommon(currSymbol, llTokenSet71));
		} else {
			
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
		}
	} else {
		llerror("prio7expression");
	}
	return expr;
}


function prio8expression(context: any, inheritSpec: boolean, firstArg: boolean, follow: LLTokenSet): CDLValue {
	let expr: CDLValue = [];
	if (tokenInCommon(currSymbol, llTokenSet72)) {
		getToken(1/*leftParenthesis*/, llTokenSet45, llTokenSet45, false);
		expr = prio0expression(context,  false,  false, llTokenSet73);
		getToken(2/*rightParenthesis*/, llTokenSet49, follow, true);
	} else if (tokenInCommon(currSymbol, llTokenSet74)) {
		
		let args: CDLValue[] = []; 
		getToken(3/*leftBracket*/, llTokenSet45, llTokenSet45, false);
		for (;;) {
			let arg: CDLValue = prio0expression(context,  false,  args.length === 0, llTokenSet75);
			
			args.push(arg); 
			if (!tokenInCommon(currSymbol, llTokenSet47)) {
				break;
			}
			getToken(7/*comma*/, llTokenSet45, llTokenSet45, false);
			if (tokenInCommon(currSymbol, llTokenSet76)) {
				break;
			}
		}
		getToken(4/*rightBracket*/, llTokenSet49, follow, true);
		
		expr = args; 
	} else if (tokenInCommon(currSymbol, llTokenSet77)) {
		expr = attribute_value_expr(context,  inheritSpec, follow);
	} else if (tokenInCommon(currSymbol, llTokenSet78)) {
		getToken(13/*number*/, llTokenSet49, follow, true);
		
		expr = Number(lastSymbol); 
	} else if (tokenInCommon(currSymbol, llTokenSet40)) {
		getToken(14/*string*/, llTokenSet49, follow, true);
		
		expr = lastSymbol; 
	} else if (tokenInCommon(currSymbol, llTokenSet79)) {
		getToken(15/*regexp*/, llTokenSet49, follow, true);
		
		expr = lastSymbol; 
	} else if (tokenInCommon(currSymbol, llTokenSet80)) {
		getToken(31/*globalContextSymbol*/, llTokenSet38, llTokenSet38, false);
		getToken(16/*identifier*/, llTokenSet49, follow, true);
		
		expr = new GlobalJSId(lastSymbol); 
	} else if (tokenInCommon(currSymbol, llTokenSet38)) {
		getToken(16/*identifier*/, llTokenSet49, follow, true);
		
		expr = !inheritSpec && lastSymbol in context? '"' + lastSymbol + '"':
		       new LangId(lastSymbol);
	} else {
		llerror("prio8expression");
	}
	return expr;
}


function query_or_call(expr_in: CDLValue, context: any, inheritSpec: boolean, follow: LLTokenSet): CDLValue {
	let expr_out: CDLValue = [];
	if (tokenInCommon(currSymbol, llTokenSet81)) {
		getToken(8/*dot*/, llTokenSet38, llTokenSet38, false);
		getToken(16/*identifier*/, llTokenSet49, follow, true);
		let id: string = lastSymbol;
		
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
	} else if (tokenInCommon(currSymbol, llTokenSet72)) {
		
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
		getToken(1/*leftParenthesis*/, llTokenSet82, llTokenSet82, false);
		if (tokenInCommon(currSymbol, llTokenSet45)) {
			for (;;) {
				let arg: CDLValue = prio0expression(context,  inheritSpec,  false, llTokenSet83);
				
				f.push(arg); 
				if (!tokenInCommon(currSymbol, llTokenSet47)) {
					break;
				}
				getToken(7/*comma*/, llTokenSet45, llTokenSet45, false);
				if (tokenInCommon(currSymbol, llTokenSet73)) {
					break;
				}
			}
		}
		getToken(2/*rightParenthesis*/, llTokenSet49, follow, true);
		
		expr_out = f; 
	} else {
		llerror("query_or_call");
	}
	return expr_out;
}


function top_level_assignment(follow: LLTokenSet): void {
	for (;;) {
		getToken(16/*identifier*/, llTokenSet84, llTokenSet84, false);
		
		newline(); output(lastSymbol) 
		if (!tokenInCommon(currSymbol, llTokenSet81)) {
			break;
		}
		getToken(8/*dot*/, llTokenSet38, llTokenSet38, false);
		
		output(lastSymbol) 
	}
	getToken(11/*assign*/, llTokenSet45, llTokenSet45, false);
	
	output(" " + lastSymbol + " ") 
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

