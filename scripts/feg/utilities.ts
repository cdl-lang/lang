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

var mode: string;
var showResolution: any;

// Used to check membership of numbers
type NumberSet = {[nr: number]: boolean};

module Utilities {

export class AssertException {
    msg: string;

    constructor(msg: string) {
        this.msg = msg;
    }

    toString(): string {
        return this.msg;
    }
}

export function isEmptyObj(obj: Object): boolean {
    return Object.keys(obj).length === 0;
}

export function firstAttribute(obj: Object): string {
    return Object.keys(obj)[0];
}

export function filterObj(obj: any, f: (attr: string, val: any) => boolean): Object {
    var nObj: any = {};

    for (var attr in obj) {
        if (f(attr, obj[attr])) {
            nObj[attr] = obj[attr];
        }
    }
    return nObj;
}

// Applies a function to all attribute-value pairs, and stores the result under
// the same attribute
export function mapObj(obj: any, f: (attr: string, val: any) => any): any {
    var nObj: any = {};

    for (var attr in obj) {
        nObj[attr] = f(attr, obj[attr]);
    }
    return nObj;
}

export function addAssociationPath(obj: any, path: string[], value: any) {
    var ptr: any = obj;

    for (var i: number = 0; i < path.length - 1; i++) {
        if (!(path[i] in ptr) || !ptr[path[i]] ||
           !(ptr[path[i]] instanceof Object)) {
            ptr[path[i]] = {};
        }
        ptr = ptr[path[i]];
    }
    ptr[path[path.length - 1]] = value;
}

export function getAssociationPath(obj: any, path: string[], start: number = 0): any {
    var i: number;
    var ptr: any = obj;

    for (i = (start === undefined? 0: start); i < path.length; i++) {
        if (!(ptr instanceof Object) || !(path[i] in ptr)) {
            return undefined;
        }
        ptr = ptr[path[i]];
    }
    return ptr;
}

export function hasAssociationPath(obj: any, path: string[], start: number = 0): boolean {
    return getAssociationPath(obj, path, start) !== undefined;
}

export function warnMessage(msg: string): void {
    console.log(msg);
}

export function errorMessage(msg: string): void {
    console.log(msg);
    debugger;
}

export function dupObjSafe(obj: any): any {
    if (obj instanceof ElementReference) {
        return new ElementReference(obj.getElement());
    }
    if (obj instanceof Array) {
        var arr: any[] = [];
        arr.length = obj.length;
        for (var i = 0; i !== obj.length; i++) {
            arr[i] = dupObjSafe(obj[i]);
        }
        return arr;
    }
    if (obj instanceof Object) {
        var cl: any = {};
        for (var attr in obj) {
            cl[attr] = dupObjSafe(obj[attr]);
        }
        return cl;
    }
    return obj;
}

export function error(msg: string): void {
    var context: string = gErrContext.getErrorContext();

    if (context !== undefined) {
        msg += " at " + context;
    }
    errorMessage("error: " + msg);
    throw new AssertException(msg);
}

export var hasSyntaxError: boolean = false;

export function syntaxError(msg: string, fullContext: boolean = false, contextLine: string = undefined): void {
    var context: string = gErrContext.getErrorContext(fullContext);

    if (context !== undefined) {
        msg += " at " + context;
    }
    if (contextLine !== undefined) {
        msg += "\n" + (mode === "dump"? "": "// error: ") + contextLine;
    }
    if (msg in oldWarnings) {
        return;
    }
    oldWarnings[msg] = true;
    if (mode === "dump") {
        console.log("error: " + msg);
    } else {
        console.log("// error: " + msg);
    }
    hasSyntaxError = true;
}

export function semanticWarning(msg: string, level: number): void {
    var context: string = gErrContext.getErrorContext();

    if (context !== undefined) {
        msg += " at " + context;
    }
    if (!(msg in oldWarnings)) {
        oldWarnings[msg] = true;
        if (level < strictnessLevel) {
            console.log("// error: " + msg);
        } else {
            console.log("// warning: " + msg);
        }
    }
}

var typeErrors: {[msg: string]: boolean};

export function typeError(msg: string): void {
    var context: string = gErrContext.getErrorContext();

    if (context !== undefined) {
        msg += " at " + context;
    }
    if (msg in typeErrors) {
        return;
    }
    typeErrors[msg] = true;
}

export function resetAllTypeErrors(): void {
    typeErrors = {};
}

// Type errors should be printed once all value types have stabilized.
export function printAllTypeErrors(): void {
    for (var msg in typeErrors) {
        if (mode === "dump") {
            console.log("error: type error: " + msg);
        } else {
            console.log("// error: type error: " + msg);
        }
    }
}

var oldWarnings: {[msg: string]: boolean} = {};

export function warn(msg: string): void {
    var context: string = gErrContext.getErrorContext();

    if (context !== undefined) {
        msg += " at " + context;
    }
    if (mode === "dump") {
        warnMessage("warning: " + msg);
    } else {
        warnMessage("// warning: " + msg);
    }
}

export function warnOnce(msg: string): void {
    if (!(msg in oldWarnings)) {
        warn(msg);
        oldWarnings[msg] = true;
    }
}

export function log(msg: string): void {
    console.log(msg);
}

export function runtimeWarning(msg: string): void {
    if (showRuntimeWarnings) {
        warnMessage("warning: " + msg);
    }
}

}

interface EqualityTest {
    isEqual(v: any): boolean;
}

interface Compare {
    compare<T>(v: T): number;
}

function arrayEqual(a: EqualityTest[], b: EqualityTest[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (var i = 0; i !== a.length; i++) {
        if (!a[i].isEqual(b[i])) {
            return false;
        }
    }
    return true;
}

function array2Equal(a: EqualityTest[][], b: EqualityTest[][]): boolean {
    if (a === undefined || b === undefined) {
        return a === b;
    }
    if (a.length !== b.length) {
        return false;
    }
    for (var i = 0; i !== a.length; i++) {
        if (!arrayEqual(a[i], b[i])) {
            return false;
        }
    }
    return true;
}

function assert(condition: boolean, msg: string): void {
    if (!condition) {
        Utilities.error("assert failure: " + msg);
    }
}

function assertFalse(condition: boolean, msg: string): void {
    assert(!condition, msg);
}

function setUnion<T>(a: {[id:number]: T}, b: {[id:number]: T}): {[id:number]: T} {
    if (a === undefined) {
        return b;
    } else if (b === undefined) {
        return a;
    } else {
        var union: {[id:number]: T} = {};
        for (var elem in a) {
            union[elem] = a[elem];
        }
        for (var elem in b) {
            if (!(elem in union)) {
                union[elem] = b[elem];
            }
        }
        return union;
    }
}

function subsetOf<K, V>(a: Map<K,V>, b: Map<K,V>): boolean {
    for (var k of a.keys()) {
        if (!b.has(k)) {
            return false;
        }
    }
    return true;
}

function identicalSets<K, V>(a: Map<K,V>, b: Map<K,V>, eq?: (a: V, b: V) => boolean): boolean {
    if (a === b) {
        return true;
    } else if (a === undefined || b === undefined) {
        return false;
    } else {
        for (var k of a.keys()) {
            if (!b.has(k)) {
                return false;
            }
            if (eq !== undefined && !eq(a.get(k), b.get(k))) {
                return false;
            }
        }
        for (var k of b.keys()) {
            if (!a.has(k)) {
                return false;
            }
        }
        return true;
    }
}

function objectEqual(q1: any, q2: any): boolean {
    if (q1 === q2)
        return true;
    var t1: string = typeof(q1), t2: string = typeof(q2);
    if (t1 !== t2)
        return false;
    if (t1 !== "object")
        return false; // q1 and q2 aren't objects and q1 !== q2
    if (q1 instanceof NonAV)
        return q1.isEqual(q2);
    if (q1 instanceof RegExp || q2 instanceof RegExp)
        return q1 instanceof RegExp && q2 instanceof RegExp &&
               q1.toString() === q2.toString();
    if (q1 instanceof Array) {
        if (!(q2 instanceof Array))
            return false;
        if (q1.length !== q2.length)
            return false;
        for (var i = 0; i !== q1.length; i++)
            if (!objectEqual(q1[i], q2[i]))
                return false;
    } else if (q2 instanceof NonAV || q2 instanceof Array) {
        return false;
    } else {
        if (q1 === null || q2 === null)
            return q1 === q2;
        for (var attr in q1)
            if (!(attr in q2) || !objectEqual(q1[attr], q2[attr]))
                return false;
        for (var attr in q2)
            if (!(attr in q1))
                return false;
    }
    return true;
}

// Like objectEqual, but o(x) == x.
function cdlyEqual(q1: any, q2: any): boolean {
    while (q1 instanceof Array && q1.length === 1) {
        q1 = q1[0];
    }
    while (q2 instanceof Array && q2.length === 1) {
        q2 = q2[0];
    }
    if (q1 === q2)
        return true;
    var t1: string = typeof(q1), t2: string = typeof(q2);
    if (t1 !== t2)
        return false;
    if (t1 !== "object")
        return false; // q1 and q2 aren't objects and q1 !== q2
    if (q1 instanceof NonAV)
        return q1.isEqual(q2);
    if (q1 instanceof RegExp || q2 instanceof RegExp)
        return q1 instanceof RegExp && q2 instanceof RegExp &&
               q1.toString() === q2.toString();
    if (q1 instanceof Array) {
        if (!(q2 instanceof Array)) {
            return false;
        }
        if (q1.length !== q2.length)
            return false;
        for (var i = 0; i !== q1.length; i++)
            if (!cdlyEqual(q1[i], q2[i]))
                return false;
    } else if (q2 instanceof NonAV || q2 instanceof Array) {
        return false;
    } else {
        if (q1 === null || q2 === null)
            return q1 === q2;
        for (var attr in q1)
            if (!(attr in q2) || !cdlyEqual(q1[attr], q2[attr]))
                return false;
        for (var attr in q2)
            if (!(attr in q1))
                return false;
    }
    return true;
}

/**
 * Checks if two objects have values that conflict in a merge
 * 
 * @param {*} q1
 * @param {*} q2
 * @returns {boolean} [merge, q1, q2] === [merge, q2, q1]
 */
function objectCompatible(q1: any, q2: any): boolean {
    if (q1 === q2)
        return true;
    var t1: string = typeof(q1), t2: string = typeof(q2);
    if (t1 !== t2)
        return false;
    if (t1 !== "object")
        return false; // q1 and q2 aren't objects and q1 !== q2
    if (q1 instanceof NonAV)
        return q1.isEqual(q2);
    if (q1 instanceof RegExp || q2 instanceof RegExp)
        return q1 instanceof RegExp && q2 instanceof RegExp &&
               q1.toString() === q2.toString();
    if (q1 instanceof Array) {
        if (!(q2 instanceof Array))
            return false;
        for (var i = 0; i < q1.length && i < q2.length; i++)
            if (!objectCompatible(q1[i], q2[i]))
                return false;
    } else if (q2 instanceof NonAV || q2 instanceof Array) {
        return false;
    } else {
        if (q1 === null || q2 === null)
            return q1 === q2;
        for (var attr in q1)
            if (attr in q2 && !objectCompatible(q1[attr], q2[attr]))
                return false;
    }
    return true;
}

// Like objectEqual, but slightly optimized for normalized values
function valueEqual(v1: any[], v2: any[]): boolean {
    if (v1 === v2)
        return true;
    if (v1 === undefined || v2 === undefined)
        return false;
    if (v1.length !== v2.length)
        return false;
    for (var i: number = 0; i < v1.length; i++) {
        var a: any = v1[i];
        var b: any = v2[i];
        if (a !== b) {
            var ta: string = typeof(a);
            var tb: string = typeof(b);
            if (ta !== tb)
                return false;
            if (ta !== "object") {
                return false; // not objects and a !== b
            } else if (a instanceof NonAV) {
                if (!a.isEqual(b))
                    return false;
            } else if (b instanceof NonAV) {
                return false;
            } else {
                for (var attr in a)
                    if (!(attr in b) || !valueEqual(a[attr], b[attr]))
                        return false;
                for (var attr in b)
                    if (!(attr in a))
                        return false;
            }
        }
    }
    return true;
}

// SimpleValueEquals: called with a runtime value and a simple value (which can
// be compared using ===). Used for comparing to simple values in compiled
// queries.
function sveq(cdlValue: any, simpleValue: any): boolean {
    if (cdlValue instanceof Array) {
        for (var i: number = 0; i < cdlValue.length; i++) {
            if (cdlValue[i] === simpleValue ||
                (cdlValue[i] instanceof RangeValue &&
                 cdlValue[i].match(simpleValue))) {
                return true;
            }
        }
        return false;
    } else {
        return cdlValue === simpleValue ||
               (cdlValue instanceof RangeValue && cdlValue.match(simpleValue));
    }
}

// Simple Value Not Equals
function svne(cdlValue: any, simpleValue: any): boolean {
    if (cdlValue instanceof Array) {
        for (var i: number = 0; i < cdlValue.length; i++) {
            if (cdlValue[i] !== simpleValue &&
                !(cdlValue[i] instanceof RangeValue &&
                  cdlValue[i].match(simpleValue))) {
                return true;
            }
        }
        return cdlValue.length === 0;
    } else {
        return cdlValue !== simpleValue &&
               !(cdlValue instanceof RangeValue && cdlValue.match(simpleValue));
    }
}

// Simple Value In Range, closed, closed
function svircc(r: any, sv: any): boolean {
    var rv: RangeValue;
    var v: any = sv instanceof Array && sv.length === 1? sv[0]: sv;

    if (r instanceof Array) {
        if (r.length === 1) {
            rv = r[0];
        } else {
            return false;
        }
    } else {
        rv = r;
    }
    return rv.min <= v && v <= rv.max;
}

// Simple Value In Range, closed, open
function svirco(r: any, sv: any): boolean {
    var rv: RangeValue;
    var v: any = sv instanceof Array && sv.length === 1? sv[0]: sv;

    if (r instanceof Array) {
        if (r.length === 1) {
            rv = r[0];
        } else {
            return false;
        }
    } else {
        rv = r;
    }
    return rv.min <= v && v < rv.max;
}

// Simple Value In Range, open, closed
function sviroc(r: any, sv: any): boolean {
    var rv: RangeValue;
    var v: any = sv instanceof Array && sv.length === 1? sv[0]: sv;

    if (r instanceof Array) {
        if (r.length === 1) {
            rv = r[0];
        } else {
            return false;
        }
    } else {
        rv = r;
    }
    return rv.min < v && v <= rv.max;
}

// Simple Value In Range, open, open
function sviroo(r: any, sv: any): boolean {
    var rv: RangeValue;
    var v: any = sv instanceof Array && sv.length === 1? sv[0]: sv;

    if (r instanceof Array) {
        if (r.length === 1) {
            rv = r[0];
        } else {
            return false;
        }
    } else {
        rv = r;
    }
    return rv.min < v && v < rv.max;
}

/* Lexicographical comparison of JSON objects q1 and q2. Returns -1 when
   q1 < q2, 0 when q1 == q2, and 1 when q1 > q2.
   Comparing attributes of two objects is expensive, due to the call to
   Object.keys(). If this becomes a performance bottleneck, consider the
   following:
   1. Reserve an attribute, e.g. "_#" in all avs. Do not allow this attribute
      in the cdl.
   2. Cache in that attribute the sorted list of attribute names of the
      object. I.e., if it's not present, do obj["_#"] = Object.keys(obj).sort()
   3. Use that list for comparison
   4. Make sure all functions that modify or create avs respect this, either
      by removing the attribute when it's not present, or by updating it
*/
function objectCompare(q1: any, q2: any): number {
    var t1: string = typeof(q1), t2: string = typeof(q2);

    if (t1 !== t2) {
        return t1 < t2? -1: 1;
    }
    if (typeof(q1) !== "object") {
        return q1 === q2? 0: q1 < q2? -1: 1;
    }
    if (q1 instanceof Array || q2 instanceof Array) {
        if (!(q1 instanceof Array && q2 instanceof Array)) {
            return q1 instanceof Array? 1: -1;
        }
        if (q1.length !== q2.length) {
            return q1.length < q2.length? -1: 1;
        }
        for (var i = 0; i !== q1.length; i++) {
            var cmp = objectCompare(q1[i], q2[i]);
            if (cmp !== 0) {
                return cmp;
            }
        }
    } else {
        var a1: string[] = Object.keys(q1);
        var a2: string[] = Object.keys(q2);
        // q1 < q2 if q1 has less attributes than q2
        if (a1.length !== a2.length)
            return a1.length < a2.length? -1: 1;
        a1.sort();
        a2.sort();
        // otherwise, compare attributes lexicographically
        for (var i: number = 0; i !== a1.length; i++) {
            if (a1[i] !== a2[i]) {
                return a1[i] < a2[i]? -1: 1;
            }
        }
        // if they are all equal, compare values lexicographically
        for (var i: number = 0; i !== a1.length; i++) {
            var attr: string = a1[i];
            var cmp: number = objectCompare(q1[attr], q2[attr]);
            if (cmp !== 0) {
                return cmp;
            }
        }
    }
    return 0;
}

// Create a shallow copy of the object, leaving out attr
function shallowCopyMinus<T>(obj: T, excl: string): T {
    var dup: any = {};

    for (var attr in obj)
        if (attr !== excl)
            dup[attr] = (<any>obj)[attr];
    return dup;
}

// excl is an object. if an attribute in excl has value true, it's suppressed.
// if an attribute has a deeper object, the attribute is copied minus the
// exclusions mentioned under attr.
function shallowCopyMinusTree(obj: any, excl: any): any {
    function intDup(obj: any, excl: any, dup: any): any {
        for (var attr in obj) {
            if (attr in excl) {
                if (excl[attr] !== true) {
                    var adup: any = intDup(obj[attr], excl[attr], undefined);
                    if (adup !== undefined) {
                        if (dup === undefined) {
                            dup = {};
                        }
                        dup[attr] = adup;
                    }
                }
            } else {
                if (dup === undefined) {
                    dup = {};
                }
                dup[attr] = obj[attr];
            }
        }
        return dup;
    }
    return intDup(obj, excl, {});
}

function safeJSONStringify(val: any): string {
    return val === -Infinity? "-Infinity":
        val === Infinity? "Infinity":
        typeof(val) === "number" && isNaN(val)? '"NaN"':
        JSON.stringify(val);
}

// Returns first element of an os if it contains precisely one element,
// otherwise the whole os.
function singleton(v: any): any {
    return v instanceof Array && v.length === 1? v[0]: v;
}

// Returns v as a normalized value, guaranteed to an os.
function ensureOS(v: any): any[] {
    return v === undefined? []: v instanceof Array? v: [v];
}

function valueLength(v: any): number {
    return v === undefined? 0: v instanceof Array? v.length: 1;
}

// Returns an os interpreted as a single value if possible.
// So o(x) becomes x. Note that o() becomes false.
function getDeOSedValue(v: any): any {
    return v instanceof Array?
        (v.length === 0? false: v.length === 1? v[0]: v): v;
}

function objMap(obj: any, f: (v: any, attr?: string) => any): any {
    var mappedObj: any = {};

    for (var attr in obj) {
        mappedObj[attr] = f(obj[attr], attr);
    }
    return mappedObj;
}

function objFilter(obj: any, f: (v: any, attr?: string) => boolean): any {
    var filteredObj: any = {};

    for (var attr in obj) {
        if (f(obj[attr], attr)) {
            filteredObj[attr] = obj[attr];
        }
    }
    return filteredObj;
}

function objValues(obj: any): any[] {
    var arr: any[] = [];

    for (var attr in obj) {
        arr.push(obj[attr]);
    }
    return arr;
}

function levenshtein(str1: string, str2: string, maxd: number): number {
    var cost: number[][] = new Array(),
    n: number = str1.length,
    m: number = str2.length,
    i: number, j: number;

    function minimum(a: number, b: number, c: number) {
        var min: number = a < b? a: b;
        return min < c? min: c;
    }

    if (str1 == str2)
        return 0;
    if (str1.length == 0)
        return str2.length;
    if (str2.length == 0)
        return str1.length;
    for (i = 0; i <= n; i++) {
        cost[i] = new Array();
    }
    for (i = 0;i <= n; i++) {
        cost[i][0] = i;
    }
    for (j = 0; j <= m; j++) {
        cost[0][j] = j;
    }
    for (i = 1; i <= n; i++) {
        var x = str1.charAt(i - 1);
        var mind: number = str1.length + str2.length;
        for (j = 1; j <= m; j++) {
            var y = str2.charAt(j - 1);
            if (x === y) {
                cost[i][j] = cost[i-1][j-1]; 
            } else if (x.toLowerCase() === y.toLowerCase()) {
                cost[i][j] = minimum(0.1 + cost[i-1][j-1], 1 + cost[i][j-1], 1 + cost[i-1][j]);
            } else if (j > 1 && i > 1 && x === str2.charAt(j - 2) &&
                       y === str1.charAt(i - 2)) {
                cost[i][j] = 1 + minimum(cost[i-2][j-2], cost[i][j-1], cost[i-1][j]);
            } else {
                cost[i][j] = 1 + minimum(cost[i-1][j-1], cost[i][j-1], cost[i-1][j]);
            }
            if (cost[i][j] < mind) {
                mind = cost[i][j];
            }
        }
        if (mind >= maxd) {
            return mind;
        }
    }
    return cost[n][m];  
}

function runtimeValueToCdlExpression(v: any): any {
    if (v instanceof Array) {
        return v.length === 1? runtimeValueToCdlExpression(v[0]):
            new MoonOrderedSet(v.map(runtimeValueToCdlExpression));
    }
    if (v === _) {
        return v;
    }
    if (v instanceof NonAV) {
        // Doesn't yield a good cdl expression for ElementReference, but is useful for debugNodeToStr
        return v.toCdl();
    }
    if (v instanceof Object) {
        var o: any = {};
        for (var attr in v) {
            o[attr] = runtimeValueToCdlExpression(v[attr]);
        }
        return o;
    }
    return v;
}

//
// merge 'a' and 'b' which are assumed to be deO/Sed, aka set-suppressed,
//  aka 'stripArray'ed
//
function deOsedMerge(a: any, b: any): any {
    a = singleton(a);
    b = singleton(b);

    if (typeof(a) === "undefined") {
        return b;
    }
    if (typeof(a) !== "object" || typeof(b) !== "object" ||
        a instanceof Array || b instanceof Array) {
        return a;
    }

    var res: any = {};

    for (var attr in a) {
        var repl: any = attr in b? deOsedMerge(a[attr], b[attr]): a[attr];
        if (repl !== undefined &&
              !(repl instanceof Array && repl.length === 0)) {
            res[attr] = repl;
        }
    }
    for (var attr in b) {
        if (!(attr in a)) {
            var repl: any = b[attr];
            if (repl !== undefined &&
                  !(repl instanceof Array && repl.length === 0)) {
                res[attr] = repl;
            }
        }
    }

    return res;
}

// Break up an os into an array of os'es with the same identity. The identity
// of the elements of each os[i] is stored in sids[i] (single id).
function groupResultById(result: Result, values: any[][], sids: any[]): void {
    if (result !== undefined && result.value !== undefined && result.value.length !== 0) {
        var i: number = 0;
        var v: any[] = result.value;
        var ids: any[] = result.identifiers;
        while (i < ids.length) {
            var nextId: any = ids[i];
            if (v[i] === undefined) {
                values.push(undefined);
                i++; // there cannot be multiple undefineds with the same id
                while (i < ids.length && ids[i] === nextId) {
                    i++;
                }
            } else {
                var nextVal: any[] = [];
                while (i < ids.length && ids[i] === nextId) {
                    nextVal.push(v[i]);
                    i++;
                }
                values.push(nextVal);
            }
            if (sids !== undefined) {
                sids.push(nextId);
            }
        }
    }
}

function repeatId(ids: any[], id: any, nr: number): void {
    for (var i: number = 0; i < nr; i++) {
        ids.push(id);
    }
}

// Track the elements in the different arguments to expressions like r(v1, v2,
// ...) by identity.
function mapByIdentity(elements: Result[]): Map<any, any[]> {
    var values: Map<any, any[]> = new Map<any, any[]>();

    for (var i: number = 0; i !== elements.length; i++) {
        var v_i: any[] = elements[i].value;
        var id_i: any[] = elements[i].identifiers;
        for (var j: number = 0; j < v_i.length; j++) {
            if (!values.has(id_i[j])) {
                values.set(id_i[j], []);
            }
            values.get(id_i[j]).push(v_i[j]);
        }
    }
    return values;
}

// Mapping from id to the elements in the results with that id
function splitByIdentity(elements: Result[]): Map<any, any[][]> {
    var values: Map<any, any[][]> = new Map<any, any[][]>();

    for (var i: number = 0; i !== elements.length; i++) {
        var v_i: any[] = elements[i].value;
        var id_i: any[] = elements[i].identifiers;
        for (var j: number = 0; j < v_i.length; j++) {
            if (!values.has(id_i[j])) {
                values.set(id_i[j], elements.map(function(r: Result): any[] { return []; }));
            }
            values.get(id_i[j])[i].push(v_i[j]);
        }
    }
    return values;
}

function normalizeObject(v: any): any[] {
    var res: any[];

    if (!(v instanceof Array)) {
        v = [v];
    }
    res = [];
    for (var i: number = 0; i !== v.length; i++) {
        if (v[i] instanceof MoonRange) {
            res.push(new RangeValue(v[i].os, v[i].closedLower, v[i].closedUpper));
        } else if (v[i] instanceof MoonComparisonFunction) {
            res.push(new ComparisonFunctionValue(v[i].elements));
        } else if (v[i] instanceof MoonOrderedSet) {
            res = cconcat(res, v[i].os.map(normalizeObject));
        } else if (v[i] instanceof Array) {
            res = cconcat(res, v[i].map(normalizeObject));
        } else if (v[i] instanceof NonAV) {
            res.push(v[i]);
        } else if (v[i] instanceof Object) {
            var normalizedObj: any = undefined;
            for (var attr in v[i]) {
                var normalizedValue: any[] = normalizeObject(v[i][attr]);
                if (normalizedValue.length !== 0) {
                    if (normalizedObj === undefined) {
                        normalizedObj = {};
                    }
                    normalizedObj[attr] = normalizedValue;
                }
            }
            if (normalizedObj !== undefined) {
                res.push(normalizedObj);
            }
        } else if (v[i] !== undefined) {
            res.push(v[i]);
        }
    }
    return res;
}

function binarySearchMin<T1, T2>(
    arr: T1[], val: T2, comp: (a: T1, b: T2, info?: any) => number): number
{
    var i: number = binarySearch(arr, val, comp);

    while (i > 0 && comp(arr[i - 1], val) === 0) {
        i--;
    }
    return i;
}

function binarySearchMax<T1, T2>(
    arr: T1[], val: T2, comp: (a: T1, b: T2, info?: any) => number): number
{
    var i: number = binarySearch(arr, val, comp);

    if (i >= 0) {
        while (i < arr.length - 1 && comp(arr[i + 1], val) === 0) {
            i++;
        }
    }
    return i;
}

function countObjSize(v: any, recursive: boolean): number {
    if (v === undefined) {
        return 0;
    } else if (typeof(v) !== "object" || v instanceof NonAV || v instanceof RegExp) {
        return 1;
    } else if (v instanceof Array) {
        if (recursive) {
            var sum: number = 0;
            for (var i = 0; i !== v.length; i++) {
                sum += countObjSize(v[i], true);
            }
            return sum;
        } else {
            return v.length;
        }
    } else {
        if (recursive) {
            var prod: number = 1;
            for (var attr in v) {
                prod *= countObjSize(v[attr], true);
            }
            return prod;
        } else {
            return 1;
        }
    }
}

function printObjAsTree(obj: any, indent: string = "", maxWidth: number = 999999): string {
    if (obj instanceof Array || obj instanceof NonAV) {
        return obj.toString() + "\n";
    }
    if (!(obj instanceof Object)) {
        return String(obj) + "\n";
    }
    var attributes: string[] = Object.keys(obj).sort((a: string, b: string): number => {
        var an = Number(a);
        var bn = Number(b);
        if (!isNaN(an) && !isNaN(bn)) {
            return an - bn;
        } else if (!isNaN(an)) {
            return -1;
        } else if (!isNaN(bn)) {
            return 1;
        } else {
            return a < b? -1: a === b? 0: 1;
        }
    });
    var str: string = "";
    var nIndent: string;
    for (var i = 0; i < attributes.length; i++) {
        var attr = attributes[i];
        var val = obj[attr];
        var nextTerm: string = i < attributes.length - 1? "├── ": "└── ";
        if (val instanceof Array || val instanceof NonAV) {
            str += indent + nextTerm + attr + ":" + val.toString() + "\n";
        } else if (!(val instanceof Object)) {
            str += indent + nextTerm + attr + ":" + String(val) + "\n";
        } else {
            if (i === attributes.length - 1) {
                nIndent = indent + "    ";
            } else if (nIndent === undefined) {
                nIndent = indent + "|   ";
            }
            var indentWidth: number = indent.length + 4;
            if (indentWidth + attr.length < maxWidth) {
                str += indent + nextTerm + attr;
            } else {
                var attrMaxLen: number = Math.max(25, maxWidth - indentWidth);
                str += indent + nextTerm + attr.slice(0, attrMaxLen);
            }
            str += "\n" + printObjAsTree(val, nIndent, maxWidth);
        }
    }
    return str;
}

function extractBaseName(n: string): string {
    var slashPos: number = n.lastIndexOf('/');

    if (slashPos === -1) {
        slashPos = n.lastIndexOf('\\');
    }
    if (slashPos !== -1) {
        n = n.substr(slashPos + 1);
    }
    var match = n.match(/\.[a-z]+$/);
    if (match !== null) {
        n = n.substr(0, n.length - match[0].length);
    }
    return n;
}

function extractExtension(n: string): string {
    var lastDotPos: number = n.lastIndexOf('.');

    return lastDotPos === -1? "": n.slice(lastDotPos + 1);
}

// Adds a base path and a file name to a file URL (minus the URL encoding).
// Assumes baseDir ends in /.
function combineFilePath(baseDir: string, fileName: string): string {
    if (fileName.charAt(0) === '/') {
        return "file://" + fileName;
    }
    var fullName: string = baseDir;
    var restName: string = fileName;
    while (restName.charAt(0) === '.') {
        if (restName.charAt(1) === '.' && restName.charAt(2) === '/') {
            var lsp: number = fullName.lastIndexOf('/', fullName.length - 2);
            restName = restName.slice(3);
            fullName = fullName.slice(0, lsp + 1);
        } else if (restName.charAt(1) === '/') {
            restName = restName.slice(2);
        } else {
            break;
        }
    }
    return fullName + restName;
}

// Removes attributes with o() values
function removeEmptyOSFromAV(v: any): any {
    if (v instanceof Array) {
        return v.map(removeEmptyOSFromAV);
    }
    if (typeof(v) !== "object" || v === null || v instanceof NonAV) {
        return v;
    }
    var repl: any = {};
    for (var attr in v) {
        var v_attr: any = v[attr];
        if (v_attr !== undefined && !(v_attr instanceof Array && v_attr.length === 0)) {
            repl[attr] = removeEmptyOSFromAV(v_attr);
        }
    }
    return repl;
}

function allValuesIdentical<T>(values: T[]): boolean {
    for (var i = 1; i < values.length; i++) {
        if (values[i] !== values[0]) {
            return false;
        }
    }
    return true;
}

function compareSimpleValues(a: SimpleValue, b: SimpleValue): number {
    var t_a: string = typeof(a);
    var t_b: string = typeof(b);

    if (t_a !== t_b) {
        return t_a < t_b? -1: t_a === t_b? 0: 1;
    } else if (t_a === "number") {
        return <number>a - <number>b;
    } else {
        return a < b? -1: a === b? 0: 1;
    }
}

// Returns a sorted list of all unique simple values in data, if it can be
// expected to reduce the size of the transmitted data
function getUniqueValues(data: SimpleValue[]): SimpleValue[]|undefined {
    var uniqueElements = new Map<SimpleValue, number>();
    var estCompressedSize: number = 0;
    var estUncompressedSize: number = 0;

    // Estimation for uniform distribution of all digits between 0 and nrElts-1
    // based on sum_(n=0)^m n (10^n - 10^(n-1)) = 1/9 (9 10^m m - 10^m + 1)
    function averageNrDigits(nrElts: number): number {
        var log = Math.log10(nrElts);
        var m = Math.floor(log);
        var sumNrDigits = (Math.pow(10, m) * (9 * m - 1) + 1) / 9 + 1;

        return ((nrElts - Math.pow(10, m)) * Math.ceil(log) + sumNrDigits) / nrElts;
    }

    for (var i = 0; i < data.length; i++) {
        var element = data[i];
        var count = uniqueElements.get(element);
        uniqueElements.set(element, count === undefined? 1: count + 1);
    }
    if (2 * uniqueElements.size >= data.length) {
        // Note: this includes arrays of length <= 1
        return undefined;
    }
    uniqueElements.forEach((count: number, key: SimpleValue) => {
        var keySize = String(key).length;
        estCompressedSize += keySize + 1;
        estUncompressedSize += keySize * count;
    });
    estCompressedSize += data.length * (averageNrDigits(uniqueElements.size) + 1);
    if (estCompressedSize >= estUncompressedSize) {
        return undefined;
    }
    var keys: SimpleValue[] = [];
    uniqueElements.forEach((count: number, key: SimpleValue) => {
        keys.push(key);
    });
    return keys.sort(compareSimpleValues);
}

function compressRawData(data: any[], indexedValues: SimpleValue[]|undefined): {o: number; v: SimpleValue[];}[] {
    var ranges: {o: number; v: SimpleValue[];}[] = [];
    var lastDefined: number = 0;
    var lastOffset: number = 0;
    var lastRange: SimpleValue[] = undefined;

    for (var i = 0; i < data.length; i++) {
        var data_i = data[i];
        if (data_i !== undefined) {
            if (indexedValues !== undefined) {
                data_i = binarySearch(indexedValues, data_i, compareSimpleValues);
            }
            if (lastRange === undefined || i - 3 > lastDefined) { // allow up to 3 consecutive undefined values
                lastRange = [];
                ranges.push({
                    o: i,
                    v: lastRange
                });
                lastOffset = i;
            } else if (i - 1 !== lastDefined) {
                while (i - 1 !== lastDefined) {
                    lastRange.push(null);
                    lastDefined++;
                }
            }
            lastRange[i - lastOffset] = data_i;
            lastDefined = i;
        }
    }
    return ranges;
}

function decompressRawData(compressedData: {o: number; v: SimpleValue[];}[], indexedValues: SimpleValue[]): any[] {
    var data: any[] = [];

    if (indexedValues === undefined) {
        for (var i = 0; i < compressedData.length; i++) {
            var offset = compressedData[i].o;
            var values = compressedData[i].v;
            for (var j = 0; j < values.length; j++) {
                var v = values[j];
                if (v !== undefined && v !== null) {
                    data[offset + j] = v;
                }
            }
        }
    } else {
        for (var i = 0; i < compressedData.length; i++) {
            var offset = compressedData[i].o;
            var values = compressedData[i].v;
            for (var j = 0; j < values.length; j++) {
                var v = values[j];
                if (v !== undefined && v !== null) {
                    data[offset + j] = indexedValues[<number>v];
                }
            }
        }
    }
    return data;
}
