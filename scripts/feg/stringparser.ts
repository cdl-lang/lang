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

class ParseTree {
    head: any;
    arguments?: ParseTree[];
    result?: any;
}

class ParseResult {
    success: boolean; // undefined when legal prefix
    tree: ParseTree;
    error?: string;
}

interface StringParser {

    parse(str: string): ParseResult;

}

class StringParseFormula implements StringParser {

    static attributeRegExp: RegExp = /^(([a-zA-Z_$][a-zA-Z_$0-9]*)|("([^\\"]|\\.)+")|('([^\\']|\\.)+'))/;
    static numberRegExp: RegExp = new RegExp('^[+-]?([0-9]+(\\.[0-9]*)?|[0-9]*\\.[0-9]+)([Ee][0-9]+)?');

    static suffixes: {[letter: string]: number} = {
        K: 1e3,
        k: 1e3,
        M: 1e6,
        m: 1e6,
        B: 1e9,
        b: 1e9,
        T: 1e12,
        t: 1e12
    };

    static knownFunctions: {[name: string]: number} = {
        "ln": 1,
        "log10": 1,
        "logb": 2,
        "sqrt": 1,
        "abs": 1,
        "pi": 0,
        "e": 0,
        "exp": 1,
        "avg": -1,
        "sum": -1,
        "min": -1,
        "max": -1,
        "year": 1,
        "quarter": 1,
        "month": 1,
        "dayOfWeek": 1,
        "dayOfMonth": 1,
        "hour": 1,
        "minute": 1,
        "second": 1
    };

    parse(formula: string): ParseResult {
        var pos: number = 0;

        function skip_spaces(): void {
            while (pos < formula.length && formula[pos] === ' ') {
                pos++;
            }
        }

        function parse_arguments(head: any): ParseResult {
            var args: ParseTree[] = [];

            pos++;
            skip_spaces();
            if (formula[pos] !== ')') {
                pos--;
                do {
                    pos++;
                    var arg: ParseResult = addOp();
                    args.push(arg.tree);
                    if (arg.success !== true) {
                        return {
                            success: arg.success,
                            tree: {head: head, arguments: args},
                            error: arg.error
                        };
                    }
                    skip_spaces();
                } 
                while (formula[pos] === ',');
            }
            return {
                success: true,
                tree: {head: head, arguments: args}
            };
        }

        function atom(): ParseResult {
            var res: ParseResult;
            var matches: string[];

            skip_spaces();
            if (formula[pos] === '-') {
                pos++;
                res = atom();
                return {
                    success: res.success,
                    tree: { head: "unaryMinus", arguments: [res.tree] },
                    error: res.error
                };
            } else if (formula[pos] === '(') {
                pos++;
                res = addOp();
                skip_spaces();
                if (pos >= formula.length) {
                    if (res.success === true) {
                        res.success = undefined;
                    }
                } else if (formula[pos] === ')') {
                    pos++;
                } else {
                    if (res.success !== false) {
                        res.success = false;
                        res.error = "missing right parenthesis";
                    }
                }
                return res;
            } else if ((matches = StringParseFormula.attributeRegExp.exec(formula.substr(pos))) !== null) {
                var attr: string = matches[0];
                if (attr[0] === '"' || attr[0] === "'") {
                    attr = attr.substr(1, attr.length - 2).replace(/\\(.)/g, "$1");
                }
                pos += matches[0].length;
                skip_spaces();
                if (pos < formula.length && formula[pos] === '(') {
                    if (!(attr in StringParseFormula.knownFunctions)) {
                        return {
                            success: false,
                            tree: {head: attr},
                            error: "unknown function"
                        };
                    }
                    res = parse_arguments(attr);
                    if (pos >= formula.length) {
                        if (res.success === true) {
                            res.success = undefined;
                        }
                    } else if (formula[pos] === ')') {
                        pos++;
                        if (StringParseFormula.knownFunctions[attr] >= 0 &&
                            (res.tree.arguments === undefined ||
                             res.tree.arguments.length !== StringParseFormula.knownFunctions[attr])) {
                            res.success = false;
                            res.error = "wrong number of arguments to function";
                        }
                    } else {
                        if (res.success !== false) {
                            res.success = false;
                            res.error = "closing parenthesis expected";
                        }
                    }
                    return res;
                } else {
                    return {
                        success: true,
                        tree: {head: attr}
                    };
                }
            } else if ((matches = StringParseFormula.numberRegExp.exec(formula.substr(pos))) !== null) {
                var num: number = Number(matches[0]);
                pos += matches[0].length;
                skip_spaces();
                if (formula[pos] in StringParseFormula.suffixes) {
                    num *= StringParseFormula.suffixes[formula[pos]];
                    pos++;
                }
                return {
                    success: !isNaN(num),
                    tree: {head: num},
                    error: isNaN(num)? "incorrectly formatted number": undefined
                };
            } else {
                return {
                    success: pos === formula.length? undefined: false,
                    tree: {head: num},
                    error: pos === formula.length? "formula incomplete": "number, name or parenthesis expected"
                };
            }
        }

        function powOp(): ParseResult {
            var res: ParseResult = atom(), arg: ParseResult;

            skip_spaces();
            while (res.success && pos < formula.length) {
                var operator: string = formula[pos];
                switch (operator) {
                  case "^":
                    pos++;
                    arg = atom();
                    res = {
                        success: arg.success,
                        tree: {head: operator, arguments: [res.tree, arg.tree]},
                        error: arg.error
                    };
                    skip_spaces();
                    break;
                  default:
                    return res;
                }
            }
            return res;
        }

        function multOp(): ParseResult {
            var res: ParseResult = powOp(), arg: ParseResult;

            skip_spaces();
            while (res.success && pos < formula.length) {
                var operator: string = formula[pos];
                switch (operator) {
                  case "*":
                  case "/":
                  case "%":
                    pos++;
                    arg = powOp();
                    res = {
                        success: arg.success,
                        tree: {head: operator, arguments: [res.tree, arg.tree]},
                        error: arg.error
                    };
                    skip_spaces();
                    break;
                  default:
                    return res;
                }
            }
            return res;
        }

        function addOp(): ParseResult {
            var res: ParseResult = multOp(), arg: ParseResult;

            skip_spaces();
            while (res.success && pos < formula.length) {
                var operator: string = formula[pos];
                switch (operator) {
                  case "+":
                  case "-":
                    pos++;
                    arg = multOp();
                    res = {
                        success: arg.success,
                        tree: {head: operator, arguments: [res.tree, arg.tree]},
                        error: arg.error
                    };
                    skip_spaces();
                    break;
                  default:
                    return res;
                }
            }
            return res;
        }

        if (typeof(formula) !== "string") {
            return {
                success: false,
                tree: {
                    head: undefined,
                    result: undefined
                },
                error: "not a string"
            };
        }
        var res: ParseResult = addOp();
        skip_spaces();
        return pos === formula.length? res:
               res.success? {success: false, tree: res.tree, error: "end of expression expected"}:
               res;
    }
}

/**
 * A parser for basic CDL values: numbers, strings, AVs with basic CDL values and
 * the o() and r() functions.
 * 
 * @class StringParseCDLValue
 * @implements {StringParser}
 */
class StringParseCDLValue implements StringParser {

    static attributeRegExp: RegExp = /^(([a-zA-Z_$][a-zA-Z_$0-9]*)|("([^\\"]|\\.)+")|('([^\\']|\\.)+'))/;
    static identifierRegExp: RegExp = /^[a-zA-Z_$][a-zA-Z_$0-9]*/;
    static stringRegExp: RegExp = /^(("[^"]*")|(\'[^\']*\'))/;
    static numberRegExp: RegExp = /^[+-]?([0-9]+(\\.[0-9]*)?|[0-9]*\\.[0-9]+)([Ee][0-9]+)?/;
    static knownFunctions: {[functionName: string]: (elts: ParseTree[]) => any} = {
        o: (elts: ParseTree[]) => elts.map(elt => elt.result),
        r: (elts: ParseTree[]) => new RangeValue(elts.map(elt => elt.result), true, true),
        Rcc: (elts: ParseTree[]) => new RangeValue(elts.map(elt => elt.result), true, true),
        Rco: (elts: ParseTree[]) => new RangeValue(elts.map(elt => elt.result), true, false),
        Roc: (elts: ParseTree[]) => new RangeValue(elts.map(elt => elt.result), false, true),
        Roo: (elts: ParseTree[]) => new RangeValue(elts.map(elt => elt.result), false, false)
    };

    parse(cdlString: string): ParseResult {
        var pos: number = 0;

        function skip_spaces(): void {
            while (pos < cdlString.length && cdlString[pos] === ' ') {
                pos++;
            }
        }

        function parse_arguments(head: any): ParseResult {
            var args: ParseTree[] = [];

            pos++;
            skip_spaces();
            if (cdlString[pos] !== ')') {
                pos--;
                do {
                    pos++;
                    var arg: ParseResult = expression();
                    args.push(arg.tree);
                    if (arg.success !== true) {
                        return {
                            success: arg.success,
                            tree: {head: head, arguments: args},
                            error: arg.error
                        };
                    }
                    skip_spaces();
                } 
                while (cdlString[pos] === ',');
            }
            return {
                success: true,
                tree: {
                    head: head,
                    arguments: args
                }
            };
        }

        function parse_av(): ParseResult {
            var args: ParseTree[] = [];
            var result: {[attr: string]: any} = {};

            pos++;
            skip_spaces();
            if (cdlString[pos] !== ')') {
                pos--;
                do {
                    pos++;
                    skip_spaces();
                    var matches = StringParseFormula.attributeRegExp.exec(cdlString.substr(pos));
                    if (matches === null) {
                        return {
                            success: false,
                            tree: {head: undefined},
                            error: "attribute expected"
                        };
                    }
                    var attr: string = matches[0];
                    if (attr[0] === '"' || attr[0] === "'") {
                        attr = attr.substr(1, attr.length - 2).replace("\\\\", "\\");
                    }
                    pos += matches[0].length;
                    skip_spaces();
                    if (cdlString[pos] !== ":") {
                        return {
                            success: false,
                            tree: {head: undefined},
                            error: "colon expected"
                        };
                    }
                    pos++;
                    skip_spaces();
                    var arg: ParseResult = expression();
                    args.push(arg.tree);
                    if (arg.success !== true) {
                        return {
                            success: arg.success,
                            tree: {head: "", arguments: args},
                            error: arg.error
                        };
                    }
                    result[attr] = arg.tree.result;
                    skip_spaces();
                } 
                while (cdlString[pos] === ',');
            }
            return {
                success: true,
                tree: {
                    head: "",
                    arguments: args,
                    result: result
                }
            };
        }

        function expression(): ParseResult {
            var res: ParseResult;
            var matches: string[];

            skip_spaces();
            if (pos < cdlString.length && cdlString[pos] === '{') {
                // AV object
                res = parse_av();
                if (pos >= cdlString.length) {
                    if (res.success === true) {
                        res.success = undefined;
                    }
                } else if (cdlString[pos] === '}') {
                    pos++;
                } else {
                    if (res.success !== false) {
                        res.success = false;
                        res.error = "closing brace expected";
                    }
                }
                return res;
            } else if ((matches = StringParseCDLValue.identifierRegExp.exec(cdlString.substr(pos))) !== null) {
                // Constant identifier: true, false
                // or function application: o(1, r(5, 10))
                var id: string = matches[0];
                pos += id.length;
                skip_spaces();
                if (id === "true" || id === "false") {
                    return {
                        success: true,
                        tree: {
                            head: id,
                            result: id === "true"
                        }
                    };
                } else if (id === "_") {
                    return {
                        success: true,
                        tree: {
                            head: id,
                            result: _
                        }
                    };
                } else  if (pos < cdlString.length && cdlString[pos] === '(') {
                    var resultFunc = StringParseCDLValue.knownFunctions[id];
                    if (resultFunc === undefined) {
                        return {
                            success: false,
                            tree: {head: id},
                            error: "unknown function: " + id
                        };
                    }
                    res = parse_arguments(id);
                    if (pos >= cdlString.length) {
                        if (res.success === true) {
                            res.success = undefined;
                        }
                    } else if (cdlString[pos] === ')') {
                        pos++;
                        res.tree.result = resultFunc(res.tree.arguments);
                    } else {
                        if (res.success !== false) {
                            res.success = false;
                            res.error = "closing parenthesis expected";
                        }
                    }
                    return res;
                } else {
                    return {
                        success: false,
                        tree: {head: id},
                        error: "function call expected"
                    };
                }
            } else if ((matches = StringParseCDLValue.numberRegExp.exec(cdlString.substr(pos))) !== null) {
                // number: result is nunerical value
                var num: number = Number(matches[0]);
                pos += matches[0].length;
                skip_spaces();
                return {
                    success: !isNaN(num),
                    tree: {head: num, result: num},
                    error: isNaN(num)? "incorrectly formatted number": undefined
                };
            } else if ((matches = StringParseCDLValue.stringRegExp.exec(cdlString.substr(pos))) !== null) {
                // string: result is string stripped of quotes and extra backslashes
                var str: string = matches[0];
                pos += str.length;
                skip_spaces();
                return {
                    success: true,
                    tree: {
                        head: str,
                        result: str.substr(1, str.length - 2).replace("\\\\", "\\")
                    }
                };
            } else {
                return {
                    success: false,
                    tree: {head: undefined},
                    error: "number, string or function expected"
                };
            }
        }

        if (typeof(cdlString) !== "string") {
            return {
                success: false,
                tree: {
                    head: undefined,
                    result: undefined
                },
                error: "not a string"
            };
        }
        var res: ParseResult = expression();
        skip_spaces();
        return pos === cdlString.length? res:
               res.success? {success: false, tree: res.tree, error: "operator expected"}:
               res;
    }
}
