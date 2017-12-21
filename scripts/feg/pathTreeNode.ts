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

/// <reference path="expression.ts" />

/// Maps qualifiers onto their potential values
type PotentialQualifierValues = {[qualifier:string]: {[value: string]: boolean}};
type PotentialQualifierValuesPerLevel = PotentialQualifierValues[];

// Gets set to true on exception
var gError = false;

const enum Priority {
    normalPriority = 0,
    writePriority = 1,
    maxPriority = 1
}

var _suppressSet: boolean = false; // set to true for debugging

function converAVToString(av: {[s: string]: any}, indent: string): string {
    var res: string = "{";

    function quoteAttr(a: string): string {
        return jsIdentifierRegExp.test(a) && a !== "class"? a: '"' + a + '"';
    }

    var nextIndent: string = indent === undefined? undefined: indent + "    ";
    for (var attr in av) {
        var v: string = convertValueToString(av[attr], nextIndent);
        if (res.length !== 1)
            res += indent !== undefined? ",": ", ";
        res += indent !== undefined?
              "\n" + nextIndent + quoteAttr(attr) + ": " + v:
              quoteAttr(attr) + ": " + v;
    }
    return res + (indent !== undefined? "\n" + indent + "}": "}");
}

function convertArrayToString(a: any[]): string {
    var res: string = "[";

    if (a[0] instanceof BuiltInFunction) {
        res += a[0].name;
    } else {
        res += convertValueToString(a[0], undefined);
    }
    for (var i: number = 1; i < a.length; i++) {
        res += ", " + convertValueToString(a[i], undefined);
    }
    return res + "]";
}

function convertOSToString(type: string, elts: any[], indent: string): string {
    var res: string = type + "(";
    var nextIndent: string = indent === undefined? undefined: indent + "    ";

    for (var i: number = 0; i !== elts.length; i++) {
        var v: string = convertValueToString(elts[i], nextIndent);
        if (i !== 0) res += ", ";
        res += v;
    }
    return res + ")";
}

function convertJSFunctionToString(f: JavascriptFunction): string {
    return convertOSToString(f.name, f.arguments, undefined);
}

function convertValueToString(v: any, indent: string = undefined): string {
    if (v instanceof Projector) {
        return "_";
    } else if (v instanceof TerminalSymbol) {
        return v.name;
    } else if (v instanceof ChildInfo) {
        return v.toString();
    } else if (v instanceof MoonRange) {
        return convertOSToString(
            "R" + (v.closedLower? "c": "o") + (v.closedUpper? "c": "o"),
            v.os, indent);
    } else if (v instanceof MoonSubstringQuery) {
        return convertOSToString("s", v.os, indent);
    } else if (v instanceof MoonOrderedSet) {
        return convertOSToString("o", v.os, indent);
    } else if (v instanceof Negation) {
        return convertOSToString("n", v.queries, indent);
    } else if (v instanceof Array) {
        return convertArrayToString(v);
    } else if (v instanceof JavascriptFunction) {
        return convertJSFunctionToString(v);
    } else if (v instanceof Object) {
        return converAVToString(v, indent);
    } else if (typeof(v) === "string") {
        return '"' + v.replace(/\n/g, "\\n") + '"';
    } else {
        return v;
    }
}

// A qualifier term consists of an attribute and level.
interface QualifierTerm {
    attribute: string; // the name of the qualifier
    level: number; // 0 is [me], 1 is [embedding], etc.
    value: any;

    cloneWithNewValue(v: any): QualifierTerm;
}

function compareQualifierTerms(a: QualifierTerm, b: QualifierTerm): number {
    if (a.level !== b.level) {
        return b.level - a.level; // Highest level first; just for debugging convenience
    }
    if (a.attribute !== b.attribute) {
        return a.attribute < b.attribute? -1: 1;
    }
    return objectCompare(a.value, b.value);
}

// Compares ignoring the value. Since value is the final sorting criterion,
// searching with this will return an arbitrary qualifier that matches attribute
// and level.
function compareQualifierTermsModValue(a: QualifierTerm, b: QualifierTerm): number {
    if (a.level !== b.level) {
        return b.level - a.level; // Highest level first; just for debugging convenience
    }
    if (a.attribute !== b.attribute) {
        return a.attribute < b.attribute? -1: 1;
    }
    return 0;
}

// A qualifier clause represents a conjunction of (single) qualifier terms.
// Important to note is that qualifierTerms should be sorted.
interface QualifierClause {
    qualifierTerms: QualifierTerm[];
}

// Lexicographical comparison of two arrays of sorted qualifier terms. For
// efficiency, length is checked first.
function compareQualifierTermArrays(a: QualifierTerm[], b: QualifierTerm[]): number {
    if (a.length !== b.length) {
        return a.length - b.length;
    }
    for (var i: number = 0; i < a.length; i++) {
        var cmp: number = compareQualifierTerms(a[i], b[i]);
        if (cmp !== 0) {
            return cmp;
        }
    }
    return 0;
}

function mergeQualifierClauses(a: QualifierTerm[], b: QualifierTerm[]): QualifierTerm[] {
    var i: number = 0, j: number = 0;
    var merged: QualifierTerm[] = [];

    while (i < a.length && j < b.length) {
        var cmp: number = compareQualifierTermsModValue(a[i], b[j]);
        if (cmp === 0) {
            // Attribute and level identical
            if (compareQualifierTerms(a[i], b[j]) === 0) {
                // Values identical too
                merged.push(a[i]);
            } else {
                // Values differ: this should only be because they overlap
                var intersection: any = qualifierMatchIntersection(a[i].value, b[j].value);
                if (intersection instanceof MoonOrderedSet && intersection.os.length === 0) {
                    Utilities.error("empty intersection: qualifier always false");
                }
                merged.push(a[i].cloneWithNewValue(intersection));
            }
            i++;
            j++;
        } else if (cmp < 0) {
            merged.push(a[i]);
            i++;
        } else {
            merged.push(b[j]);
            j++;
        }
    }
    return merged.concat(i < a.length? a.slice(i): b.slice(j));
}

// Returns a - b
function unmergeQualifiers(a: CDLQualifierTerm[], b: QualifierTerm[]): CDLQualifierTerm[] {
    var i: number = 0, j: number = 0;
    var unmerged: CDLQualifierTerm[] = [];

    while (i < a.length && j < b.length) {
        var cmp: number = compareQualifierTerms(a[i], b[j]);
        if (cmp === 0) {
            i++;
            j++;
        } else if (cmp < 0) {
            unmerged.push(a[i]);
            i++;
        } else {
            j++;
        }
    }
    return i < a.length? unmerged.concat(a.slice(i)): unmerged;
}

function removeQualifier(qs: CDLQualifierTerm[], qOldPos: number): void {
    qs.splice(qOldPos, 1);
}

function replaceQualifier(qs: CDLQualifierTerm[], qOldPos: number, nAttr: string, level: number): boolean {
    var qOld: CDLQualifierTerm = qs[qOldPos];

    qs.splice(qOldPos, 1);
    return addQualifier(qs, new CDLQualifierTerm(nAttr, qOld.value, level, qOld.className)); 
}

// If 'a' has no overlap with given 'b' values for the same qualifier,
// return o(), meaning: value cannot be active. Otherwise, return the
// intersection, which is a refinement of given matching values (e.g. one
// qualifier specifies facetType: o("a", "b", "c"), the next facetType: "a").
// The intersection can be a simple value or an os.
function qualifierMatchIntersection(a: any, b: any): any {
    if (a === undefined) {
        return b;
    } else if (b === undefined) {
        return a;
    }
    if (a instanceof MoonOrderedSet) {
        a = a.os;
    } else if (isSimpleType(a)) {
        a = [a];
    } else {
        Utilities.error("cannot intersect this value");
    }
    if (b instanceof MoonOrderedSet) {
        b = b.os;
    } else if (isSimpleType(b)) {
        b = [b];
    } else {
        Utilities.error("cannot intersect this value");
    }
    var left: any = a.filter((e: any): any => { return b.indexOf(e) >= 0; });
    if (left.length === 1) {
        return left[0];
    } else {
        return new MoonOrderedSet(left);
    }
}

// Tests if a single qualifier q is in a conjunction of qualifiers
function q1InQs(q: QualifierTerm, qs: QualifierTerm[]): boolean {
    return binarySearch(qs, q, compareQualifierTerms) >= 0;
}

// Tests if all qualifiers in q are in qs. If true, qs implies q.
function qInQs(q: QualifierTerm[], qs: QualifierTerm[]): boolean {
    var i: number = 0, j: number = 0;

    // Sorted so q[i-1] < q[i], and qs[j-1] < qs[j]

    // q[0..i-1] is in qs[0..j-1]
    while (i < q.length && j < qs.length) {
        var cmp: number = compareQualifierTerms(q[i], qs[j]);
        if (cmp === 0) {
            // q[i] == qs[j] => q[0..i] is in qs[0..j]
            i++;
            j++;
        } else if (cmp > 0) {
            // q[i] > qs[j]
            j++;
        } else {
            // q[i] < qs[j]; since all qs[j+1..] are also larger, q[i]
            // is not in qs => q not in qs.
            return false;
        }
        // q[0..i-1] is in qs[0..j-1]
    }
    // q[0..i-1] is in qs[0..j-1]
    return i === q.length;
}

function q1InQsModValue(q: QualifierTerm, qs: QualifierTerm[]): boolean {
    return binarySearch(qs, q, compareQualifierTermsModValue) >= 0;
}

function simplifyQs(qs: QualifierTerm[]): QualifierTerm[] {
    var sqs: QualifierTerm[] = [];

    for (var i: number = 0; i !== qs.length; i++) {
        if (!q1InQs(qs[i], sqs)) {
            assert(!q1InQsModValue(qs[i], sqs), "conflicting qualifiers?");
            sqs.push(qs[i]);
        }
    }
    return sqs;
}

class CDLQualifierTerm implements QualifierTerm {

    attribute: string;
    value: any; // {attribute: value} is a query on [me]
    level: number; // 0 is [me], 1 is [embedding], etc.
    className: string; // class in which it was added
    tested: boolean = false; // when true, matchState contains the result of matching against constant context
    matchState: boolean = undefined; // remembers outcome of matching

    constructor(attribute: string, value: any, level: number, className: string)
    {
        this.attribute = attribute;
        this.value = value;
        this.level = level;
        this.className = className;
    }

    cloneWithNewValue(v: any): CDLQualifierTerm {
        return new CDLQualifierTerm(this.attribute, v, this.level, this.className);
    }

    isEqual(q: CDLQualifierTerm): boolean {
        return this.attribute === q.attribute && this.value === q.value &&
            this.level === q.level;
    }

    toString(): string {
        return (this.level === 0? this.attribute: this.attribute + "/" + this.level) +
               (!this.tested || this.matchState === undefined? ":": this.matchState? "=": "!=") +
               safeJSONStringify(this.value);
    }

    // Eliminated qualifiers always match
    toElimString(): string {
        return this.level === 0? this.attribute + "=" + String(this.value):
               this.attribute + "/" + this.level + "=" + String(this.value);
    }

    levelUp(): CDLQualifierTerm {
        return new CDLQualifierTerm(this.attribute, this.value, this.level + 1,
                             this.className);
    }

    match(e: Expression): boolean {
        switch (typeof(this.value)) {
          case "number":
          case "string":
            return e instanceof ExpressionSimpleValue &&
                   this.value === e.expression;
          case "boolean":
            return (this.value? e.isTrue(): e.isFalse()) !== false;
          default:
            return undefined;
        }
    }
}

function qLevelUp(q: CDLQualifierTerm): CDLQualifierTerm {
    return q.levelUp();
}

class InheritInfo {
    className: string;
    pathDepthAtInheritance: number;
    classTreeDepth: number;
    priorityQualifier: boolean;
}

var gInLoadPhase: boolean = true;

// Keeps the qualifier list free of duplicates and contradictions
// (like { x: 1, ..., x: 2 }). Returns true when qualifier was added,
// false when there was a conflict.
// TODO: keep track of class name set in case of merge?
function addQualifier(qs: CDLQualifierTerm[], q: CDLQualifierTerm): boolean {
    var i: number = binarySearch(qs, q, compareQualifierTermsModValue);

    if (i < 0) {
        // qualifier wasn't present
        qs.splice(-(i + 1), 0, q);
        return true;
    } else {
        assert(q.attribute === qs[i].attribute && q.level === qs[i].level, "DEBUGGING");
        if (q.value === qs[i].value) {
            return true; // identical, so no need to add
        }
        // If either is a boolean, replace it with the non-boolean,
        // since the non-boolean is more restrictive; otherwise, give
        // an error message
        var q_is_boolean: boolean = typeof(q.value) === "boolean";
        var qs_i_is_boolean: boolean = typeof(qs[i].value) === "boolean";
        if (q_is_boolean && !qs_i_is_boolean) {
            if (q.value === true) {
                return true; // qs[i] is more restrictive
            }
        } else if (!q_is_boolean && qs_i_is_boolean) {
            if (qs[i].value === true) {
                qs[i] = q; // replace qs[i] by q, which is more restrictive
                return true;
            }
        }
        // If the two contain overlapping ordered sets, replace with the
        // intersection
        assert(q.value instanceof MoonOrderedSet || typeof(q.value) !== "object", "cannot handle all types in qualifiers");
        assert(qs[i].value instanceof MoonOrderedSet || typeof(qs[i].value) !== "object", "cannot handle all types in qualifiers");
        var q_values = q.value instanceof MoonOrderedSet? q.value.os: [q.value];
        var qsi_values = qs[i].value instanceof MoonOrderedSet? qs[i].value.os: [qs[i].value];
        var intersection: any[] = [];
        for (var j = 0; j < q_values.length; j++) {
            if (qsi_values.indexOf(q_values[j]) >= 0) {
                intersection.push(q_values[j]);
            }
        }
        if (intersection.length > 0) {
            var newVal: any = intersection.length === 1? intersection[0]:
                              new MoonOrderedSet(intersection);
            qs[i] = new CDLQualifierTerm(qs[i].attribute, newVal, qs[i].level,
                                         qs[i].className);
            return true;
        }
        return false; // conflict, qs + q is always false
    }
}

/// @class PathInfo
/// Represents a single expression in the cdl.
class PathInfo implements QualifierClause {

    static nextPriority: number = 0;

    /// The path from the screen area to this expression
    path: string[];
    /// Number of parents above this path's area
    childLevel: number;
    /// Information about the inherited/mixed classes. Only used for information.
    inheritInfo: InheritInfo[];
    /// The expression in the expressionStore
    expression: Expression;
    /// The original expression
    origExpr: any;
    /// The qualifiers that guard this expression
    qualifierTerms: CDLQualifierTerm[];
    /// The qualifiers that were found to be always true. Kept for information.
    eliminatedQualifierTerms: CDLQualifierTerm[] = [];
    /// The priority of this expression. Merging is done according to priority.
    priority: number;
    /// True when the this expression is writable.
    writable: boolean;
    /// True when discarded by buildQualifierNode
    eliminated: boolean;
    // True when guaranteed unmergeable
    isUnmergeable: boolean;

    /// should this storage node be synchronized remotely?
    remoteWritable: boolean;

    /// A back pointer to the tree node
    node: PathTreeNode;

    /// Stores the type written to storage nodes to keep it separate from the
    /// function node that is associated with this.node. See
    /// buildSimpleFunctionNode().
    valueType: ValueType;

    static count: number = 0;

    constructor(path: string[], expression: Expression, origExpr: any,
                qualifierTerms: CDLQualifierTerm[], writable: boolean,
                inheritInfo: InheritInfo[], priority: number,
                childLevel: number, remoteWritable: boolean,
                node: PathTreeNode) {
        this.path = path;
        this.origExpr = origExpr;
        this.qualifierTerms = qualifierTerms;
        this.writable = writable;
        this.remoteWritable = remoteWritable;
        this.inheritInfo = inheritInfo;
        this.priority = priority === undefined? PathInfo.nextPriority++: priority;
        this.childLevel = childLevel;
        this.node = node;
        this.changeExpression(expression);
        PathInfo.count++;
    }

    changeExpression(expression: Expression): void {
        this.expression = expression;
        this.isUnmergeable = expression !== undefined && expression.isUnmergeable();
        if (expression !== undefined && gInLoadPhase) {
            this.expression.checkForUndefined(this);
        }
    }

    // If this object was created with the assumption it was at the root of
    // the tree, returns its representation when it is located at a deeper
    // path.
    cloneWithPrefix(path: string[], qualifierTerms: CDLQualifierTerm[],
                    inheritInfo: InheritInfo[], childLevel: number,
                    qMapCache: CDLQualifierTerm[][]): PathInfo
    {
        var addToChildLevel: number = this.childLevel;
        var nQualifierTerms: CDLQualifierTerm[];

        if (addToChildLevel === 0 && this.qualifierTerms.length === 0) {
            nQualifierTerms = qualifierTerms;
        } else if (qualifierTerms.length === 0) {
            nQualifierTerms = this.qualifierTerms;
        } else {
            if (qMapCache[addToChildLevel] === undefined) {
                qMapCache[addToChildLevel] = addToChildLevel === 0?
                    qualifierTerms.slice(0):
                    qualifierTerms.map(function (qt: CDLQualifierTerm): CDLQualifierTerm {
                        return new CDLQualifierTerm(qt.attribute, qt.value,
                                                    qt.level + addToChildLevel,
                                                    qt.className);
                    });
            }
            nQualifierTerms = qMapCache[addToChildLevel];
            if (this.qualifierTerms.length !== 0) {
                if (nQualifierTerms.length === 0 ||
                      this.qualifierTerms[0].level <
                      nQualifierTerms[nQualifierTerms.length - 1].level) {
                    nQualifierTerms = nQualifierTerms.concat(this.qualifierTerms);
                } else {
                    nQualifierTerms = nQualifierTerms.slice(0);
                    for (var i: number = 0; i < this.qualifierTerms.length; i++) {
                        addQualifier(nQualifierTerms, this.qualifierTerms[i]);
                    }
                }
            }
        }
        return new PathInfo(
            path.concat(this.path),
            this.expression,
            this.origExpr,
            nQualifierTerms,
            this.writable,
            inheritInfo.concat(
                this.inheritInfo.map(function(ih: InheritInfo): InheritInfo {
                    return {
                        className: ih.className,
                        pathDepthAtInheritance: ih.pathDepthAtInheritance,
                        classTreeDepth: ih.classTreeDepth,
                        priorityQualifier: ih.priorityQualifier
                    };
                })
            ),
            this.priority,
            this.childLevel + childLevel,
            this.remoteWritable,
            this.node);
    }

    getPathFromLastInherit(depth: number): string[] {
        var lastInherit: InheritInfo = this.inheritInfo[this.inheritInfo.length - 1];

        return lastInherit === undefined || lastInherit.className === undefined? undefined:
               this.path.slice(lastInherit.pathDepthAtInheritance, this.path.length - depth);
    }

    getClassFromLastInherit(): string {
        var lastInherit: InheritInfo = this.inheritInfo[this.inheritInfo.length - 1];

        return lastInherit.className;
    }

    getQualifiersFor(className: string): CDLQualifierTerm[] {
        var qs: CDLQualifierTerm[] = [];

        for (var i: number = 0; i < this.qualifierTerms.length; i++) {
            if (this.qualifierTerms[i].className === className) {
                qs.push(this.qualifierTerms[i]);
            }
        }
        for (var i: number = 0; i < this.eliminatedQualifierTerms.length; i++) {
            if (this.eliminatedQualifierTerms[i].className === className) {
                qs.push(this.eliminatedQualifierTerms[i]);
            }
        }
        return qs;
    }
    
    getQualifiersFromLastInherit(): CDLQualifierTerm[] {
        return this.getQualifiersFor(this.getClassFromLastInherit());
    }

    getShortErrorLocation(depth: number = 0): string {
        var pathFromLastInherit: string[] = this.getPathFromLastInherit(depth);

        if (pathFromLastInherit !== undefined) {
            var qStr: string = this.getQualifiersFromLastInherit().map(function(q: CDLQualifierTerm): string {
                return q.toString();
            }).join(", ");
            return pathFromLastInherit.join(".") + " in class " +
                this.getClassFromLastInherit() + " for qualifiers {" +
                qStr + "}";
        } else {
            return ["screenArea"].concat(this.path).join(".");
        }
    }

    getFullErrorLocation(): string {
        var str: string = "";

        for (var i: number = 0; i < this.inheritInfo.length; i++) {
            var inheritInfo: InheritInfo = this.inheritInfo[i];
            var path: string = getShortChildPath(this.path.slice(inheritInfo.pathDepthAtInheritance));
            if (str !== "") {
                str += " > ";
            }
            if (inheritInfo.className !== undefined) {
                str += inheritInfo.className;
                var qStr: string = this.getQualifiersFor(inheritInfo.className).
                    map(function(q: CDLQualifierTerm): string {
                        return q.toString();
                    }).join(", ");
                if (qStr !== "") {
                    str += "{" + qStr + "}";
                }
            } else {
                str += "screenArea";
            }
            if (path !== "") {
                str += "." + path;
            }
        }
        return str;
    }

    getInheritInfo(depth: number, parent: PathTreeNode): ClassDebugInfo[] {
        var inheritInfo = this.inheritInfo;

        if (inheritInfo.length <= 1) {
            return [{className: "screenArea"}];
        }
        var i: number = inheritInfo.length;
        var inheritPaths: ClassDebugInfo[] = [];
        while (i > 0) {
            i--;
            var inheritInfo_i = inheritInfo[i];
            var className: string = inheritInfo_i.className === undefined?
                                    "screenArea": inheritInfo_i.className;
            var pathFromInherit: string[] =
                parent.getPathSlice(inheritInfo_i.pathDepthAtInheritance,
                                    inheritInfo_i.classTreeDepth);
            var qualifierTerms = 
                inheritInfo_i.className === undefined? undefined:
                inheritInfo_i.priorityQualifier? "!":
                this.qualifierTerms.concat(this.eliminatedQualifierTerms).
                    filter(function(q: CDLQualifierTerm): boolean {
                        return q.className === className;
                    }).map(function(q: CDLQualifierTerm): string {
                        return q.toString();
                    }).join(", ");
            inheritPaths.push({
                className: className,
                qualifiers: qualifierTerms,
                childPath: pathFromInherit.join(".")
            });
        }
        return inheritPaths;
    }

    pathEqual(opi: PathInfo): boolean {
        if (this.path.length !== opi.path.length)
            return false;
        for (var i: number = 0; i !== this.path.length; i++)
            if (this.path[i] !== opi.path[i])
                return false;
        return true;
    }

    toString(): string {
        return (this.eliminated? "!": "") +
            this.path.join(".") +
            (this.remoteWritable? " ^= ": this.writable? " *= ": " = ") +
            (this.qualifierTerms.length !== 0? this.qualifierString() + " => ": "") +
            this.valueString();
    }

    pathString(): string {
        return "[" + this.path.toString() + "]";
    }

    qualifierString(): string {
        return "{" + this.qualifierTerms.map(function (q: CDLQualifierTerm): string {
                return q.toString();
            }).concat(this.eliminatedQualifierTerms.map(function (q: CDLQualifierTerm): string {
                return q.toElimString();
            })).join(",") + "}";
    }

    valueString(): string {
        return this.expression.toCdlString();
    }

    // Returns true if there are only eliminated qualifiers or no
    // qualifier, i.e. the qualifiers are always true.
    alwaysTrue(): boolean {
        return this.qualifierTerms.length === 0;
    }

    isSimpleValue(): boolean {
        return this.expression.isSimpleValue();
    }

    // [INHERIT PARENT QUAL]

    isEqual(p: PathInfo): boolean {
        return arrayEqual(this.qualifierTerms, p.qualifierTerms) &&
               this.expression.id === p.expression.id &&
               this.writable === p.writable &&
               this.remoteWritable === p.remoteWritable;
    }

    removeQualifier(q: QualifierTerm): PathInfo {
        var i: number = binarySearch(this.qualifierTerms, q, compareQualifierTerms);

        assert(i >= 0, "assuming qualifier was found");
        var p: PathInfo = new PathInfo(
            this.path, this.expression, this.origExpr,
            this.qualifierTerms.slice(0, i).
                                concat(this.qualifierTerms.slice(i + 1)),
            this.writable, this.inheritInfo,
            this.priority, this.childLevel, this.remoteWritable, this.node);

        if ("node" in this) {
            p.node = this.node;
        }
        return p;
    }

    removeQualifierInSitu(i: number): void {
        this.qualifierTerms =  this.qualifierTerms.slice(0, i).
                                       concat(this.qualifierTerms.slice(i + 1));
    }
   
    removeQualifiers(qs: CDLQualifierTerm[]): PathInfo {
        var p: PathInfo = new PathInfo(
            this.path, this.expression, this.origExpr,
            unmergeQualifiers(this.qualifierTerms, qs),
            this.writable, this.inheritInfo,
            this.priority, this.childLevel, this.remoteWritable, this.node);

        if ("node" in this) {
            p.node = this.node;
        }
        return p;
    }
   
    // Convenience methods for buildSimpleFunctionNode(); needed since writable
    // nodes are created by that function, and it's this or more parameters...
    getAreaId(): number {
        return this.node.getAreaId();
    }

    getContextPath(): string[] {
        return this.node.getContextPath();
    }

    // Eliminates qualifiers that match the constants from the context, and
    // returns false when at least one cannot match. If a qualifier is not
    // in the appropriate context, it can never match.
    eliminateConstantQualifiers(contextStack: ConstantContextStack): boolean {
        // First check if at least one qualifier is in contextStack. Saves some
        // garbage collection.
        var offset: number = this.expression.type === ExpressionType.childExistence? 1: 0;

        // The condition is only here to save some memory.
        if (this.qualifierTerms.some((q: CDLQualifierTerm): boolean => {
                return !(q.attribute in contextStack[q.level + offset]) || 
                       contextStack[q.level + offset][q.attribute] !== null;
        })) {
            var keep: CDLQualifierTerm[] = [];
            var eliminated: CDLQualifierTerm[] = [];
            for (var i: number = 0; i < this.qualifierTerms.length; i++) {
                var q = this.qualifierTerms[i];
                var matchState: boolean;
                if (q.tested) {
                    matchState = q.matchState;
                } else {
                    if (q.attribute in contextStack[q.level + offset] &&
                          contextStack[q.level + offset][q.attribute] !== undefined) {
                        var contextValue: any = contextStack[q.level + offset][q.attribute];
                        if (contextValue === null) {
                            matchState = undefined;
                        } else {
                            matchState = q.match(contextValue);
                            q.tested = true;
                            q.matchState = matchState;
                        }
                    } else {
                        // attribute not in context
                        if (q.value === false) { // an undefined attribute is always false, so eliminate
                            matchState = true;
                        } else { // Can never match
                            matchState = false;
                        }
                    }
                    q.tested = true;
                    q.matchState = matchState;
                }
                switch (matchState) {
                  case true: // always true, so eliminate
                    eliminated.push(q);
                    break;
                  case false: // Can never match
                    return false;
                  case undefined: // unknown, check at runtime
                    keep.push(q);
                    break;
                }
            }
            if (this.qualifierTerms.length !== keep.length) {
                this.qualifierTerms = keep;
                this.eliminatedQualifierTerms = this.eliminatedQualifierTerms.
                                                concat(eliminated);
            }
        }
        return true;
    }

    /// Moves qualifiers that are in q to eliminatedQualifierTerms under the
    /// assumption that those in q are true when this expression must be
    /// evaluated. Returns true when one or more qualifiers have been moved.
    eliminateGivenQualifiers(q: CDLQualifierTerm[]): boolean {
        var keep: CDLQualifierTerm[] = undefined;
        var eliminated: CDLQualifierTerm[] = undefined;

        for (var i: number = 0; i !== this.qualifierTerms.length; i++) {
            if (q1InQs(this.qualifierTerms[i], q)) {
                if (keep === undefined) {
                    keep = this.qualifierTerms.slice(0, i);
                    eliminated = [];
                }
                eliminated.push(this.qualifierTerms[i]);
            } else if (keep !== undefined) {
                keep.push(this.qualifierTerms[i]);
            }
        }
        if (keep !== undefined) {
            this.qualifierTerms = keep;
            this.eliminatedQualifierTerms = this.eliminatedQualifierTerms.
                                            concat(eliminated);
            return true;
        }
        return false;
    }

    eliminatedQValue(attr: string, level: number): any {
        for (var i = 0, l = this.eliminatedQualifierTerms.length; i < l; i++) {
            var eqt = this.eliminatedQualifierTerms[i];
            if (eqt.attribute === attr && eqt.level === level) {
                return eqt.value;
            }
        }
        return undefined;
    }
}

function arraysEqual(p1: PathInfo[], p2: PathInfo[]): boolean {
    if (p1 === undefined || p2 === undefined || p1.length !== p2.length) {
        return false;
    }
    var len: number = p1.length;

    for (var i: number = 0; i !== len; i++) {
        var p1i = p1[i];
        var found = false;
        for (var j: number = 0; !found && j !== len; j++) {
            found = p1i.isEqual(p2[j]);
        }
        if (!found) {
            return false;
        }
    }
    for (var i: number = 0; i !== len; i++) {
        var p2i = p2[i];
        var found = false;
        for (var j: number = 0; !found && j !== len; j++) {
            found = p2i.isEqual(p1[j]);
        }
        if (!found) {
            return false;
        }
    }
    return true;
}

enum ConstantStatus {
    unknown,
    notConstant,
    constant
}

var gClassNameDebugStrings: string[] = [];
var gClassQualifierDebugStrings: string[] = [];
var gClassPathDebugStrings: string[] = [];
var gClassNameDebugStringMap = new Map<string, number>();
var gClassQualifiersDebugStringMap = new Map<string, number>();
var gClassPathDebugStringMap = new Map<string, number>();
var gClassPathTreeMap: {[prevEntry: number]: {[strNums: string]: number}} = {0: {}};
var gClassPathTree: number[][] = [];

interface ClassDebugInfo {
    className: string;
    qualifiers?: string;
    childPath?: string;
}

function getClassDebugTreeIndex(debugInfo: ClassDebugInfo[]): number {
    var lastEntry: number = 0;

    function getIndex(str: string, map:  Map<string, number>, list: string[]): number {
        if (str === undefined) {
            str = "";
        }
        if (map.has(str)) {
            return map.get(str);
        } else {
            var index = list.length;
            map.set(str, index);
            list.push(str);
            return index;
        }
    }

    for (var i: number = debugInfo.length - 1; i >= 0; i--) {
        var classNameIndex: number = getIndex(debugInfo[i].className, gClassNameDebugStringMap, gClassNameDebugStrings);
        var qualifiersIndex: number = getIndex(debugInfo[i].qualifiers, gClassQualifiersDebugStringMap, gClassQualifierDebugStrings);
        var childPathIndex: number = getIndex(debugInfo[i].childPath, gClassPathDebugStringMap, gClassPathDebugStrings);
        var strNums: string = String(classNameIndex) + "," + String(qualifiersIndex) + "," + String(childPathIndex);
        if (!(strNums in gClassPathTreeMap[lastEntry])) {
            gClassPathTreeMap[lastEntry][strNums] = gClassPathTree.length;
            gClassPathTree.push([lastEntry, classNameIndex, qualifiersIndex, childPathIndex]);
        }
        lastEntry = gClassPathTreeMap[lastEntry][strNums];
        if (!(lastEntry in gClassPathTreeMap)) {
            gClassPathTreeMap[lastEntry] = {};
        }
    }
    return lastEntry;
}

// Partitions against known potential values. If a qualifier q is known to
// have values v_1,...,v_n, the expressions are partitioned by presence
// of q:v_i in the list of qualifiers. If the partitions are identical,
// the qualifier can be discarded.
// Note that the qualifiers' levels are relative to the parent template.
function partitionValueQualifiers(values: PathInfo[], qvpl: PotentialQualifierValuesPerLevel, descriptionLevel: boolean, classValuesOnly: boolean): PathInfo[] {
    var changeToThis: boolean = true;

    function collectValueQualifiers(): CDLQualifierTerm[] {
        var qs: CDLQualifierTerm[] = [];

        for (var i: number = 0; i < values.length; i++) {
            if (!descriptionLevel || (values[i].expression instanceof ExpressionClassName) === classValuesOnly) {
                for (var j: number = 0; j < values[i].qualifierTerms.length; j++) {
                    var q: CDLQualifierTerm = values[i].qualifierTerms[j];
                    if (0 < q.level && q.level - 1 < qvpl.length &&
                        q.attribute in qvpl[q.level - 1]) {
                        q = new CDLQualifierTerm(q.attribute, undefined, q.level - 1, q.className);
                        var p: number = binarySearch(qs, q, compareQualifierTerms);
                        if (p < 0) {
                            qs.splice(-(p + 1), 0, q);
                        }
                    }
                }
            }
        }
        return qs;
    }

    function partitionByQualifierValue(pQ: CDLQualifierTerm, potQValues: {[value: string]: boolean}): {[attr: string]: PathInfo[]} {
        var partitions: {[attr: string]: PathInfo[]} = undefined;

        for (var i: number = 0; i < values.length; i++) {
            if (!descriptionLevel || (values[i].expression instanceof ExpressionClassName) === classValuesOnly) {
                for (var j: number = 0; j < values[i].qualifierTerms.length; j++) {
                    var q: CDLQualifierTerm = values[i].qualifierTerms[j];
                    if (q.attribute === pQ.attribute && q.level - 1 === pQ.level) {
                        if (typeof(q.value) === "boolean") {
                            // no booleans
                            return undefined;
                        }
                        if (partitions === undefined)
                            partitions = {};
                        if (q.value in potQValues) {
                            // ignore qualifier values not in the potential
                            // qualifier values, since they can never match
                            if (!(q.value in partitions)) {
                                partitions[q.value] = [];
                            }
                            partitions[q.value].push(values[i].removeQualifier(q));
                        }
                    }
                }
            }
        }
        return partitions;
    }

    function allPartitionsEqual(partitions: {[attr: string]: PathInfo[]}, potQValues: {[value: string]: boolean}): string {
        var partVal: string[] = Object.keys(partitions);
        var potQValuesArr: string[] = Object.keys(potQValues);

        if (partVal.length !== potQValuesArr.length) {
            // Since only value in potQValues can go in partVal, they are
            // identical iff the lengths are identical
            return undefined;
        }
        var reprQVal: string = partVal[0];
        for (var i: number = 1; i < partVal.length; i++) {
            var qVal: string = partVal[i];
            if (!arraysEqual(partitions[reprQVal], partitions[qVal])) {
                return undefined;
            }
        }
        return reprQVal;
    }

    while (values.length > 1 && changeToThis) {
        var qs: CDLQualifierTerm[] = collectValueQualifiers();
        changeToThis = false;
        for (var i: number = 0; !changeToThis && i < qs.length; i++) {
            var q: CDLQualifierTerm = qs[i];
            var partitions = partitionByQualifierValue(q, qvpl[q.level][q.attribute]);
            if (partitions !== undefined) {
                var reprValue: string = allPartitionsEqual(partitions,
                                                           qvpl[q.level][q.attribute]);
                if (reprValue !== undefined) {
                    // All values are covered and both partitions are equal
                    // so we can omit this qualifier and use just one of the
                    // representative value.
                    if (!descriptionLevel) {
                        values = partitions[reprValue];
                    } else if (classValuesOnly) {
                        values = partitions[reprValue].concat(
                            values.filter((pi) => {
                                return !(pi.expression instanceof ExpressionClassName);
                            }));
                        
                    } else {
                        values = partitions[reprValue].concat(
                            values.filter((pi) => {
                                return pi.expression instanceof ExpressionClassName;
                            }));
                    }
                    changeToThis = true;
                }
            }
        }
    }
    return values;
}

type AttributeMapping = {[attribute: string]: { attribute: string; levelDifference: number;}};
type AttributeMappingStack = AttributeMapping[];

/// @class PathTreeNode
/// Represents one paths with all possible values and qualifiers in the cdl
/// as a tree, starting at the screen area.
class PathTreeNode {

    id: number;
    values: PathInfo[] = [];
    eliminatedValues: PathInfo[] = [];
    next: {[childName: string]: PathTreeNode} = {};
    parent: PathTreeNode;
    parentAttr: string;
    depth: number;
    area: PathTreeNode;
    // True when writable
    writable: boolean = false;
    constant: ConstantStatus = ConstantStatus.unknown;
    // True when attributes below this node cannot be determined beforehand
    opaque: boolean;
    // When true, the node at this point should not generate a normalized result
    // in an array, but rather a direct simple value or an attribute-value.
    // Note that only constant and AV constructing nodes support this right now;
    // other functions do not, and consequently something like display: [...]
    // can cause trouble.
    suppressSet: boolean;
    // Template id if this node is an area template
    templateId: number;
    // The function this node describes
    functionNode: FunctionNode;

    // When true, this node has been passed through only once
    singlePath: boolean = true;

    static pathTreeNodeId: number = 0;

    // CPU (or rather: elapsed) time it took to process this node. It's not defined
    // when debugLoadJSTime is false. When it's -1, a higher up call is responsible
    // for recording the time.
    loadJSCPUTime: number;

    constructor(parent: PathTreeNode, area: PathTreeNode, parentAttr: string) {
        this.id = ++PathTreeNode.pathTreeNodeId;
        this.parent = parent;
        this.parentAttr = parentAttr;
        this.area = area;
        this.depth = (parent !== undefined? parent.depth + 1: 0);
        if (debugLoadJSTime) {
            this.loadJSCPUTime = 0;
        }
    }

    attributeString(): string {
        return (this.opaque? "O": "") + (this.writable? "W": "");
    }

    // Returns true when this attribute can be substituted directly by its
    // expression, i.e. when it's o() or when it's a single, non-writable
    // expression.
    isSubstitution(): boolean {
        return (this.values.length === 0 ||
                 this.values.length === 1 && this.values[0].alwaysTrue()) &&
               !this.writable;
    }

    isUndefined(): boolean {
        return this.values.every((v: PathInfo): boolean => {
            return v.alwaysTrue() &&
                   v.expression.type === ExpressionType.undefined;
        }) && Utilities.isEmptyObj(this.next);
    }

    /**
     * @returns {boolean} true when there are expressions at this
     *          node; if it has children, they will be merged.
     */
    isMerging(): boolean {
        return this.values.length !== 0;
    }

    toString(indent: string = ""): string {
        var nodeStr: string = "";

        this.toStream(function(nodeNr: string, str: string): void {
            nodeStr += nodeNr + str + "\n";
        }, indent);
        return nodeStr;
    }

    toStream(stream: (nodeNr: string, line: string) => void, indent: string = ""): void {
        var indent2: string;
        var strId: string = String(this.id);

        if (strId.length < 5) {
            strId = "00000".slice(strId.length) + strId;
        }
        if (debugLoadJSTime) {
            var cpuTimeStr: string = (this.loadJSCPUTime / 1000).toFixed(2);
            if (strId.length < 7) {
                cpuTimeStr = "       ".slice(cpuTimeStr.length) + cpuTimeStr;
            }
            indent2 = cpuTimeStr + " " + indent + "  * ";
        } else {
            indent2 = indent + "  * ";
        }
        // Print only actual expressions
        var cnt: number = 0;
        for (var i: number = 0; i !== this.values.length; i++) {
            if (!this.values[i].eliminated) {
                if (cnt === 1)
                    indent2 = debugLoadJSTime? "        " + indent + "    ": indent + "    ";
                var inhInfoStr =
                    this.values[i].getInheritInfo(this.getDepthFromParent(), this).
                    map(function(cdi: ClassDebugInfo): string {
                        return cdi.className + ":{" +
                               (cdi.qualifiers === undefined? "": cdi.qualifiers) + "}" +
                               (cdi.childPath === undefined? "": "." + cdi.childPath);
                    }).join(", ");
                stream(strId, indent2 +
                        ((this.values.length === 1 && this.values[i].alwaysTrue()?
                        this.values[i].valueString():
                        this.values[i].qualifierString() + "=>" +
                        this.values[i].valueString()) + " < " +
                        inhInfoStr).
                    replace(/[ \t]+$/, ""));
                cnt++;
            }
        }
        // Print all expressions, including eliminated (marked by x> or !>)
        // for (var i: number = 0; i !== this.values.length; i++) {
        //     if (i === 1) indent2 = indent + "    ";
        //     out += strId + indent2 +
        //         (this.values.length === 1 && this.values[i].alwaysTrue()? this.values[i].valueString():
        //          this.values[i].qualifierString() +
        //          (this.values[i].eliminated? "!>": "=>") +
        //          this.values[i].valueString()) +
        //         (this.values[i].eliminated? "":
        //          " < " + this.values[i].getInheritInfo(this.getDepthFromParent())) +
        //         "\n";
        // }
        // for (var i: number = 0; i !== this.eliminatedValues.length; i++) {
        //     if (i + this.values.length === 1) indent2 = indent + "    ";
        //     out += strId + indent2 +
        //         this.eliminatedValues[i].qualifierString() + "x>" +
        //         this.eliminatedValues[i].valueString() + "\n";
        // }
        var nextIndent: string;
        indent2 = debugLoadJSTime? "        " + indent + "{  ": indent + "{  ";
        var attributes: string[] = Object.keys(this.next).sort();
        for (var i = 0; i < attributes.length; i++) {
            var attr: string = attributes[i];
            var next: PathTreeNode = this.next[attr];
            stream(strId, indent2 + attr + ":" +
                (next.functionNode === undefined || (!gError && next.functionNode.id < 0)?
                 "": next.functionNode.idStr() + ":" + next.functionNode.outputStr()) + " " +
                (next.templateId === undefined? "": " @" + next.templateId) +
                " " + next.attributeString());
            if (i === 0) {
                nextIndent = indent + "    ";
                indent2 = debugLoadJSTime? "        " + nextIndent: nextIndent;
            }
            next.toStream(stream, nextIndent);
        }
        if (attributes.length > 0) {
            stream(strId, debugLoadJSTime? "        " + indent + "}": indent + "}");
        }
    }

    timePathToStream(stream: (nodeNr: number, time: number, path: string) => void, path: string[] = []): void {
        stream(this.id, this.loadJSCPUTime, path.join("."));
        if ("children" in this.next) {
            var children = this.next["children"];
            for (var childName in children.next) {
                var child = children.next[childName];
                if ("description" in child.next) {
                    child.next["description"].timePathToStream(stream, path.concat(childName));
                }
            }
        }
    }

    getClassDebugInfo(areaNode: PathTreeNode): string {
        var out: string = "{";
        var section: boolean = false;
        var prevSection: boolean = false;

        function jsonString(attr: string): string {
            return jsIdentifierRegExp.test(attr) && attr !== "class"?
                   attr: JSON.stringify(attr);
        }
        
        // At the top of an area, all classes are mapped to their origin
        if (this === areaNode && this.values.length !== 0) {
            var template: AreaTemplate = areaTemplates[this.templateId];
            for (var className in template.classes) {
                if (!section) {
                    out += "inherit:{";
                    section = true;
                } else {
                    out += ",";
                }
                out += jsonString(className) + ":[";
                var ci: PathInfo[] = template.classes[className];
                var isDefined: boolean = false;
                for (var i: number = 0; i !== ci.length; i++) {
                    if (!ci[i].eliminated) {
                        if (!isDefined) {
                            isDefined = true;
                        } else {
                            out += ",";
                        }
                        out += getClassDebugTreeIndex(ci[i].getInheritInfo(this.getDepthFromParent(), this));
                    }
                }
                out += "]";
            }
            if (section) {
                out += "}";
            }
        } else {
            // Values are mapped to a list of class inheritance strings (or
            // rather, indices of those strings in another array).
            for (var i: number = 0; i !== this.values.length; i++) {
                if (!this.values[i].eliminated) {
                    if (!section) {
                        if (prevSection) {
                            out += ",";
                        }
                        out += "values:[" + getClassDebugTreeIndex(this.values[i].getInheritInfo(this.getDepthFromParent(), this));
                        section = true;
                    } else {
                        out += "," + getClassDebugTreeIndex(this.values[i].getInheritInfo(this.getDepthFromParent(), this));
                    }
                }
            }
            if (section) {
                out += "]";
            }
        }
        if (section) {
            prevSection = true;
        }
        // Then all attributes are listed
        section = false;
        for (var attr in this.next) {
            var next: PathTreeNode = this.next[attr];
            if (next.area === areaNode) {
                if (!section) {
                    if (prevSection) {
                        out += ",";
                    }
                    out += "next: {";
                    section = true;
                } else {
                    out += ",";
                }
                out += jsonString(attr) + ": " + next.getClassDebugInfo(areaNode);
            }
        }
        if (section) {
            out += "}";
        }
        return out + "}";
    }

    getDepthFromParent(): number {
        return this.depth - this.area.depth;
    }

    valuesToString(): string {
        var out: string = "";

        for (var i: number = 0; i !== this.values.length; i++) {
            out += (this.values.length === 1 && this.values[i].alwaysTrue()? this.values[i].valueString():
                 this.values[i].qualifierString() + "=>" + this.values[i].valueString()) +
                "\n";
        }
        for (var i: number = 0; i !== this.eliminatedValues.length; i++) {
            out += "!" + this.eliminatedValues[i].qualifierString() + "=>" +
                this.eliminatedValues[i].valueString() + "\n";
        }
        return out;
    }

    // Follows the path; returns undefined when path doesn't exist, or
    // a non-terminal node is opaque or writable
    getNodeAtPath(path: string[]): PathTreeNode {
        var ptr: PathTreeNode = this;

        for (var i: number = 0; i !== path.length; i++) {
            if (ptr.opaque || ptr.writable)
                return undefined;
            ptr = ptr.next[path[i]];
            if (ptr === undefined)
                return undefined;
        }
        return ptr;
    }

    getNodeAtChildPath(path: string[]): PathTreeNode {
        var ptr: PathTreeNode = this;

        for (var i: number = 0; ptr !== undefined && i !== path.length; i++) {
            if (path[i] in ptr.next) {
                ptr = ptr.next[path[i]];
            } else if (ptr.next["children"] !== undefined &&
                       path[i] in ptr.next["children"].next) {
                ptr = ptr.next["children"].next[path[i]].next["description"];
            } else {
                return undefined;
            }
        }
        return ptr;
    }

    getSpellingErrorAtPath(path: string[]): {dist: number; path: string[];} {
        var bestDistance: number = undefined;
        var bestAlternativePath: string[] = undefined;

        if (path.length === 0) {
            return { dist: 0, path: path };
        }
        if (this.opaque || this.writable)
            return undefined;
        for (var attr in this.next) {
            if (path[0].length + attr.length > 14) {
                var attrDist: number = levenshtein(path[0], attr, 3);
                if (attrDist <= 2) {
                    var rest: {dist: number; path: string[];} =
                        this.next[attr].getSpellingErrorAtPath(path.slice(1));
                    if (rest !== undefined) {
                        var dist: number = attrDist + rest.dist;
                        if (bestDistance === undefined || dist < bestDistance) {
                            bestDistance = dist;
                            bestAlternativePath = [attr].concat(rest.path);
                        }
                    }
                }
            }
        }
        return bestDistance === undefined? undefined:
            { dist: bestDistance, path: bestAlternativePath };
    }

    /**
     * Follows the path; returns undefined when path doesn't exist, or
     * a non-terminal node is opaque or writable, or is a merge node;
     * returns the terminal node otherwise. Assumes we start at the
     * area node
     */ 
    getNodeAtNonMergingPath(path: string[]): PathTreeNode {
        var ptr: PathTreeNode = this;

        for (var i: number = 0; ptr !== undefined && i !== path.length; i++) {
            if (i !== 0 && (ptr.opaque || ptr.writable || ptr.isMerging())) {
                return undefined;
            }
            ptr = ptr.next[path[i]];
        }
        return ptr;
    }

    // Returns the longest path to a non-opaque, non-writable, non merging
    // node under the present node. Assumes this is the area node.
    findLongestPathPrefix(path: string[]): number {
        var ptr: PathTreeNode = this;

        for (var i: number = 0; ptr !== undefined && i !== path.length; i++) {
            if (i !== 0 && (ptr.opaque || ptr.writable || ptr.isMerging())) {
                return i;
            }
            ptr = ptr.next[path[i]];
            if (ptr === undefined) {
                break;
            }
        }
        return i;
    }

    hasChildren(): boolean {
        return !Utilities.isEmptyObj(this.next);
    }

    // Returns false for paths for which an const node is inappropriate, such
    // as an area's context, position, and stacking, and the individual write
    // clauses.
    canBeCombined(): boolean {
        if (this.parent === this.area &&
              this.parentAttr in { context: true, position: true, stacking: true }) {
            return false;
        }
        if (this.parent !== undefined && this.parent.parentAttr === "write" &&
              this.parent.parent === this.area) {
            return false;
        }
        return true;
    }

    // If an attribute is not present, its value is copied to suppressAttr;
    // if it is not present, false is used; setting attributes explicitly to
    // undefined makes that attributes allow sets, while other attributes in
    // the same section can suppress them.
    static suppressAttributeList: any = {
        display: false,
        stacking: {
            higher: undefined,
            lower: undefined,
            priority: true,
            label: true,
            element: undefined
        },
        position: {
            pair1: false,
            pair2: false,
            point1: false,
            point2: false,
            equals: true,
            min: true,
            max: true,
            stability: true,
            preference: true,
            orGroups: false,
            priority: true,
            ratio: true,
            element: undefined
        }
    };

    isSuppressSetPath(): boolean {
        if (this.parent === undefined || this === this.area) {
            return undefined;
        }
        if (this.parentAttr === "foreign" ||
              (this.parentAttr === "value" && this.parent.parentAttr === "foreign")) {
            return undefined;
        }
        // Look for the section right under the area
        var ptrUp: PathTreeNode = this;
        while (ptrUp.parent !== this.area) {
            ptrUp = ptrUp.parent;
        }
        if (ptrUp.parentAttr in PathTreeNode.suppressAttributeList) {
            // Returning true translates [] into false at runtime; returning
            // false lets [] be an empty set; returning undefined leaves arrays
            // untouched.
            var section: any = PathTreeNode.suppressAttributeList[ptrUp.parentAttr];
            if (typeof(section) !== "object") {
                return section;
            }
            return this.parentAttr in section? section[this.parentAttr]: false;
        }
        return undefined;
    }

    getPath(): string[] {
        var ptr: PathTreeNode = this;
        var path: string[] = [];

        while (ptr.parent !== undefined) {
            path.push(ptr.parentAttr);
            ptr = ptr.parent;
        }
        return path.reverse();
    }

    getPathLength(): number {
        var ptr: PathTreeNode = this.parent;
        var pathLength: number = 0;

        while (ptr !== undefined) {
            pathLength++;
            ptr = ptr.parent;
        }
        return pathLength;
    }

    getContextAttribute(): string {
        return this.parent !== undefined &&
            this.parent.parentAttr === "context" &&
            this.parent.parent === this.area?
            this.parentAttr: undefined;
    }

    getParamAttribute(): string {
        return this.parent !== undefined &&
            this.parent.parentAttr === "param" &&
            this.parent.parent === this.area?
            this.parentAttr: undefined;
    }

    needsResolution(): boolean {
        if ((this.functionNode === undefined &&
             (this.values.length !== 0 || !Utilities.isEmptyObj(this.next))) ||
            (this.functionNode !== undefined && this.functionNode.outdated())) {
            return true;
        }
        if (this.functionNode instanceof StubFunctionNode) {
            var sfn = <StubFunctionNode> this.functionNode;
            return !sfn.stopped;
        }
        return false;
    }

    // We ignore qualifiers, and only check if all values equal v.
    valueEquals(v: any): boolean {
        if (!Utilities.isEmptyObj(this.next)) {
            return false;
        }
        for (var i: number = 0; i !== this.values.length; i++) {
            if (!objectEqual(this.values[i].expression.expression, v)) {
                return false;
            }
        }
        return true;
    }

    // Returns true if this only has a single value. All qualifiers that are not
    // eliminated are supposed to be able to become true, so there is only a
    // single value iff the first qualifier is always true and its value is
    // simple, or its value is not simple, but the rest is (because then it is
    // unmergeable). There is no check on the truth value of the qualifiers:
    // false ones will be eliminated gradually. Since this function is only used
    // to eliminate qualifiers, it is restricted to simple values, so the
    // criterium is rather simple. The resulting single value will always be
    // in this.values[0].value.
    isSingleValue(): boolean {
        return this.values.length > 0 && 
               (this.values[0].alwaysTrue() ||
                (this.allValuesIdentical() && this.atLeastOneAlwaysTrue())) &&
               Utilities.isEmptyObj(this.next);
    }

    isSingleSimpleValue(): boolean {
        return this.isSingleValue() && this.values[0].isSimpleValue();
    }

    // Returns a single value (if this.isSingleValue()).
    getSingleValue(): Expression {
        return this.values[0].expression;
    }

    // Returns the unqualified constants from the context. This could be made
    // more complete by making it inspect qualifiers, and evaluate expressions,
    // etc.; null is used to indicate existing but non-constant attributes.
    getContextConstants(): ConstantContext {
        var context = "context" in this.next? this.next["context"].next: undefined;
        var constants: ConstantContext = {};

        for (var attr in context) {
            var attrNode: PathTreeNode = context[attr];
            if (attrNode.isWritableReference()) {
                constants[attr] = null;
            } else if (attrNode.isUndefined()) {
                constants[attr] = gEmptyOSExpr;
            } else if (attrNode.isSingleSimpleValue()) {
                var val: Expression = attrNode.getSingleValue();
                constants[attr] = val.isMoonConstant()? val: null;
            } else {
                constants[attr] = null;
            }
        }
        return constants;
    }

    getAttributeMapping(): AttributeMapping {
        var context = "context" in this.next? this.next["context"].next: undefined;
        var mapping: AttributeMapping = {};

        for (var attr in context) {
            var attrNode: PathTreeNode = context[attr];
            if (attrNode.isSubstitution() && attrNode.values.length === 1 &&
                  attrNode.values[0].expression instanceof ExpressionQuery) {
                var f = <ExpressionQuery>attrNode.values[0].expression;
                var query: Expression = f.arguments[0];
                if (query instanceof ExpressionAttributeValue &&
                    query.arguments.length === 1 && query.arguments[0].expression === _) {
                    var data: Expression = f.arguments[1];
                    var levelDifference: number = data.getEmbeddingLevel(this);
                    if (levelDifference >= 0) {
                        mapping[attr] = {
                            attribute: query.attributes[0],
                            levelDifference: levelDifference
                        };
                    }
                }
            }
        }
        return mapping;
    }

    checkWritability(): void {
        this.writable = this.values.some(function(v: PathInfo): boolean {
            return v.writable;
        });
    }

    mapQualifiers(attributeMappingStack: AttributeMappingStack, childExistence: boolean): boolean {
        var change: boolean = false;

        for (var i: number = 0; i < this.values.length; i++) {
            var p_i: PathInfo = this.values[i];
            if ((p_i.expression instanceof ExpressionChildExistence) === childExistence) {
                var qualifierTerms: CDLQualifierTerm[] = p_i.qualifierTerms;
                for (var j = qualifierTerms.length - 1; j >= 0; j--) {
                    var q_ij = qualifierTerms[j];
                    if (q_ij.level !== 0) {
                        break; // The rest is of a higher level, so no match
                    }
                    if (q_ij.attribute in attributeMappingStack[0]) {
                        var map = attributeMappingStack[0][q_ij.attribute];
                        var nAttr: string = map.attribute;
                        var levelDiff: number = map.levelDifference;
                        // Check which values have been given as match for
                        // the replacement qualifier
                        var eliminatedQValue: any = p_i.eliminatedQValue(nAttr, levelDiff);
                        var prevLength: number = qualifierTerms.length;
                        var removeValue: boolean = false;
                        // Loop over the stack for more substitutions.
                        while (nAttr in attributeMappingStack[levelDiff]) {
                            map = attributeMappingStack[levelDiff][nAttr];
                            nAttr = map.attribute;
                            levelDiff += map.levelDifference;
                            eliminatedQValue = qualifierMatchIntersection(
                                    p_i.eliminatedQValue(nAttr, levelDiff),
                                    eliminatedQValue);
                        }
                        change = true;
                        if (eliminatedQValue !== undefined) {
                            var qMDiff: any = qualifierMatchIntersection(q_ij.value, eliminatedQValue);
                            if (qMDiff instanceof MoonOrderedSet && qMDiff.os.length === 0) {
                                // given value conflicts with current value
                                removeValue = true;
                            } else {
                                // The value for q_ij has been assumed true already.
                                // We can refine value of the eliminated qualifier
                                // to the intersection, but don't care right now.
                                p_i.removeQualifierInSitu(j);
                            }
                        } else {
                            // Qualifier not contradicted by eliminated qualifiers.
                            // Can still be contradicted by active qualifiers.
                            removeValue = !replaceQualifier(qualifierTerms, j, nAttr, levelDiff);
                        }
                        if (removeValue) {
                            // Qualifier replacement led to conflict
                            this.eliminatedValues.push(this.values[i]);
                            this.values.splice(i, 1);
                            i--;
                            break; // j loop must be terminated
                        }
                        j += qualifierTerms.length - prevLength;
                    }
                }
            }
        }
        return change;
    }

    propagateAttributeMappings(attributeMappingStack: AttributeMappingStack): boolean {
        var change: boolean = this.mapQualifiers(attributeMappingStack, false);

        for (var attr in this.next) {
            var next: PathTreeNode = this.next[attr];
            if (next.area === next) {
                if (next.mapQualifiers(attributeMappingStack, true)) {
                    change = true;
                }
                if (next.propagateAttributeMappings([next.getAttributeMapping()].concat(attributeMappingStack))) {
                    change = true;
                }
            } else {
                if (next.propagateAttributeMappings(attributeMappingStack)) {
                    change = true;
                }
            }
        }
        return change;
    }

    // Removes constants and qualifiers known to be constant.
    propagateConstants(contextStack: ConstantContextStack): boolean {
        var changes: boolean = false;

        for (var i: number = 0; i < this.values.length; i++) {
            var beforeLength: number = this.values[i].qualifierTerms.length;
            if (this.values[i].eliminateConstantQualifiers(contextStack)) {
                if (beforeLength !== this.values[i].qualifierTerms.length) {
                    changes = true;
                }
                var nVal: Expression = this.values[i].expression.propagateConstants(this, contextStack);
                if (nVal !== this.values[i].expression) {
                    this.values[i].changeExpression(nVal);
                    changes = true;
                }
            } else {
                var elimVal: PathInfo = this.values.splice(i, 1)[0];
                changes = true;
                this.eliminatedValues.push(elimVal);
                i--;
                if (elimVal.writable) {
                    this.checkWritability();
                }
            }
        }
        for (var attr in this.next) {
            var next: PathTreeNode = this.next[attr];
            if (attr === "description" && this.parent !== undefined &&
                  this.parent.parentAttr === "children" &&
                  this.area === this.parent.parent) {
                if (next.propagateConstants(
                           [next.getContextConstants()].concat(contextStack))) {
                    changes = true;
                }
            } else {
                if (next.propagateConstants(contextStack)) {
                    changes = true;
                }
            }
        }
        return changes;
    }

    removeDuplicateExpressions(): boolean {
        var changes: boolean = false;

        for (var i: number = 0; i < this.values.length; i++) {
            for (var j: number = this.values.length - 1; j > i; j--) {
                if (this.values[i].isEqual(this.values[j])) {
                    var writable: boolean = this.values[j].writable;
                    changes = true;
                    this.eliminatedValues.push(this.values[j]);
                    this.values.splice(j, 1);
                    if (writable) {
                        this.checkWritability();
                    }
                }
            }
        }
        for (var attr in this.next) {
            if (this.next[attr].removeDuplicateExpressions()) {
                changes = true;
            }
        }
        return changes;
    }

    // [INHERIT PARENT QUAL]

    // Removes qualifiers from nodes that have been inherited but are guaranteed
    // by the existence of the area
    removeInheritedQualifiers(existQual: CDLQualifierTerm[], potentialQVPL: PotentialQualifierValuesPerLevel): boolean {
        var change: boolean = false;

        function getCommonQualifiers(qs: CDLQualifierTerm[][]): CDLQualifierTerm[] {
            var qList: CDLQualifierTerm[] = [];
            var qCommon: CDLQualifierTerm[] = [];

            for (var i: number = 0; i !== qs.length; i++) {
                for (var j: number = 0; j < qs[i].length; j++) {
                    var q: CDLQualifierTerm = qs[i][j];
                    var p: number = binarySearch(qList, q, compareQualifierTerms);
                    if (p < 0) {
                        qList.splice(-(p + 1), 0, q);
                    }
                }
            }
            for (var i: number = 0; i !== qList.length; i++) {
                var inAllQs: boolean = true;
                var q: CDLQualifierTerm = qList[i];
                for (var j: number = 0; inAllQs && j < qs.length; j++) {
                    inAllQs = q1InQs(q, qs[j]);
                }
                if (inAllQs) {
                    // qList is sorted, so qCommon will also be sorted
                    qCommon.push(q.levelUp());
                }
            }
            return qCommon;
        }

        for (var attr in this.next) {
            var next: PathTreeNode = this.next[attr];
            if (attr === "description" && this.parent !== undefined &&
                  this.parent.parentAttr === "children" &&
                  this.area === this.parent.parent) {
                if (next.eliminateQualFromExistence(existQual)) {
                    change = true;
                }
                if (next.partitionValueQualifiers(potentialQVPL, true, false)) {
                    change = true;
                }
                var pQs = existQual.map(qLevelUp);
                var childExtQual: CDLQualifierTerm[][] = [];
                var nrExistenceQualifiers: number = 0;
                var qualifierCount: {[qualifier: string]: number} = {};
                var potentialQV: PotentialQualifierValues = {};
                var nextPQVPL: PotentialQualifierValuesPerLevel;
                for (var i: number = 0; i !== next.values.length; i++) {
                    if (next.values[i].expression.type === ExpressionType.childExistence) {
                        var allQualifiers = <CDLQualifierTerm[]>
                            mergeQualifierClauses(next.values[i].qualifierTerms,
                                       next.values[i].eliminatedQualifierTerms);
                        childExtQual.push(allQualifiers);
                        for (var j: number = 0; j < allQualifiers.length; j++) {
                            var q: CDLQualifierTerm = allQualifiers[j];
                            if (typeof(q.value) !== "boolean") {
                                // Booleans are treated elsewhere, since they
                                // are just true or false. A mix of booleans and
                                // other values is not handled.
                                if (!(q.attribute in qualifierCount)) {
                                    qualifierCount[q.attribute] = 1;
                                    potentialQV[q.attribute] = {};
                                } else {
                                    qualifierCount[q.attribute]++;
                                }
                                potentialQV[q.attribute][q.value] = true;
                            }
                        }
                        nrExistenceQualifiers++;
                    }
                }
                // Only keep those attributes that are mentioned in all
                // existence qualifiers.
                for (var qAttr in qualifierCount) {
                    if (qualifierCount[qAttr] !== nrExistenceQualifiers) {
                        delete potentialQV[qAttr];
                    }
                }
                // pQs current contents rank before childExtQual since they
                // come from a higher level; hence concat is sufficient.
                pQs = <CDLQualifierTerm[]> simplifyQs(mergeQualifierClauses(pQs,
                                            getCommonQualifiers(childExtQual)));
                nextPQVPL = [potentialQV].concat(potentialQVPL);
                if (next.eliminateQual(pQs)) {
                    change = true;
                }
                if (next.partitionClassQualifiers(nextPQVPL)) {
                    change = true;
                }
                if (next.removeInheritedQualifiers(pQs, nextPQVPL)) {
                    change = true;
                }
            } else {
                if (next.eliminateQual(existQual)) {
                    change = true;
                }
                if (next.partitionValueQualifiers(potentialQVPL, false, false)) {
                    change = true;
                }
                if (next.removeInheritedQualifiers(existQual, potentialQVPL)) {
                    change = true;
                }
            }
        }
        return change;
    }

    removeRedundantQualifiers(q0: CDLQualifierTerm[][], q1: CDLQualifierTerm[][]): boolean {
        var change: boolean = this.removeUnreachableVariants();

        if (this.values.length > 1 && this.allValuesIdentical() &&
              this.allValuesImpliedByQualifiers(q0)) {
            this.values = [this.values[0]];
            this.values[0].qualifierTerms = [];
            change = true;
        }
        for (var attr in this.next) {
            var next: PathTreeNode = this.next[attr];
            if (attr === "description" && this.parent !== undefined &&
                  this.parent.parentAttr === "children" &&
                  this.area === this.parent.parent) {
                var childExtQual: CDLQualifierTerm[][] = [];
                for (var i: number = 0; i !== next.values.length; i++) {
                    if (next.values[i].expression.type === ExpressionType.childExistence) {
                        childExtQual.push(next.values[i].qualifierTerms.map(qLevelUp));
                    }
                }
                if (next.removeRedundantQualifiers(q1, childExtQual)) {
                    change = true;
                }
            } else {
                if (q1.length !== 0 && next.values.length !== 0) {
                    if (next.eliminateRedundantQualifiers(q1)) {
                        change = true;
                    }
                }
                if (next.removeRedundantQualifiers(q1, q1)) {
                    change = true;
                }
            }
        }
        return change;
    }

    // Reduces runs with identical qualifiers starting at an unmergeable one
    removeUnreachableVariants(): boolean {
        var change: boolean = false;

        for (var i: number = 0; i < this.values.length; i++) {
            if (this.values[i].isUnmergeable) {
                // Remove subsequent values with implied qualifiers
                while (i + 1 < this.values.length &&
                      qInQs(this.values[i].qualifierTerms,
                            this.values[i + 1].qualifierTerms)) {
                    this.eliminatedValues.push(this.values[i + 1]);
                    this.values.splice(i + 1, 1);
                    change = true;
                }
            }
        }
        return change;
    }

    eliminateQual(existQual: CDLQualifierTerm[]): boolean {
        var change: boolean = false;

        for (var i: number = 0; i !== this.values.length; i++) {
            if (this.values[i].eliminateGivenQualifiers(existQual)) {
                change = true;
            }
        }
        return change;
    }

    eliminateQualFromExistence(existQual: CDLQualifierTerm[]): boolean {
        var change: boolean = false;

        for (var i: number = 0; i !== this.values.length; i++) {
            if (this.values[i].expression.type === ExpressionType.childExistence) {
                if (this.values[i].eliminateGivenQualifiers(existQual)) {
                    change = true;
                }
            }
        }
        return change;
    }

    allValuesIdentical(): boolean {
        for (var i: number = 1; i < this.values.length; i++) {
            if (this.values[0].expression.id !== this.values[i].expression.id) {
                return false;
            }
        }
        return true;
    }

    valueCycleLength(): number {
        var l: number = this.values.length;

        for (var i: number = 1; i <= l / 2; i++) {
            if (l % i === 0) {
                // Only if the length is a multiple of i, there is the possibility of a value cycle
                var cycleFound: boolean = true;
                for (var j = i; j < l; j++) {
                    if (this.values[j].expression.id !== this.values[j % i].expression.id) {
                        cycleFound = false;
                        break;
                    }
                }
                if (cycleFound) {
                    return i;
                }
            }
        }
        return undefined;
    }

    atLeastOneAlwaysTrue(): boolean {
        return this.values.some((p: PathInfo): boolean => {
            return p.alwaysTrue();
        });
    }

    // All values are identical. If the result cannot be undefined, because
    // the existence qualifiers xq guarantee that at least one variant is
    // always active, the whole expression can be replaced by a single one.
    allValuesImpliedByQualifiers(xqs: CDLQualifierTerm[][]): boolean {

        for (var i: number = 0; i !== xqs.length; i++) {
            var xq_i_implies_one_q: boolean = false;
            for (var j: number = 0; !xq_i_implies_one_q && j !== this.values.length; j++) {
                xq_i_implies_one_q = qInQs(this.values[j].qualifierTerms, xqs[i]);
            }
            if (!xq_i_implies_one_q) {
                return false;
            }
        }
        return true;
    }

    // qs is a set of qualifiers, to be interpreted as or(i, and(j, qs[i][j])).
    // The goal is to split all expressions up into partions, where partition
    // i contains expressions that are guarded by qualifiers equal to or more
    // restrictive than qs[i]. Then qs[i] is taken out of all expressions in
    // partition i, and if the resulting expressions are identical in all
    // partitions, they can be replaced by those of one partition.
    // Strategy is not sufficient for this:
    eliminateRedundantQualifiers(qs: CDLQualifierTerm[][]): boolean {
        var partition: PathInfo[][] = [];

        function qMatch(qs: CDLQualifierTerm[][], q: CDLQualifierTerm[]): number {
            for (var i: number = 0; i !== qs.length; i++) {
                if (qInQs(qs[i], q)) {
                    return i;
                }
            }
            return undefined;
        }

        for (var i: number = 0; i !== this.values.length; i++) {
            var pos = qMatch(qs, this.values[i].qualifierTerms);
            if (pos === undefined) {
                return false;
            }
            if (partition[pos] === undefined) {
                partition[pos] = [];
            }
            partition[pos].push(this.values[i].removeQualifiers(qs[pos]));
        }
        if (partition.length < 2) {
            return false;
        }
        // partition contains all values split per qs[i]; if all expressions
        // in all partitions are the same, they are in essence one expression,
        // since the qs's guarantee the selection of one of them. Note that
        // empty partitions mean no elimination.
        for (var i: number = 1; i < qs.length; i++) {
            if (!arraysEqual(partition[0], partition[i])) {
                return false;
            }
        }
        // Replace all expressions by any partition[i] without qs[i]
        this.values = partition[0];
        return true;
    }

    // Partitions by qualifiers that match against true and false.
    // When the both partitions are identical, the expression is replaced by
    // one of the partitions, minus the partitioning qualifier.
    partitionQualifiers(): boolean {

        // Return list of qualifiers which match against true or false
        function collectQualifiers(values: PathInfo[]): CDLQualifierTerm[] {
            var qs: CDLQualifierTerm[] = [];

            for (var i: number = 0; i < values.length; i++) {
                for (var j: number = 0; j < values[i].qualifierTerms.length; j++) {
                    var q: CDLQualifierTerm = values[i].qualifierTerms[j];
                    q = new CDLQualifierTerm(q.attribute, undefined, q.level, undefined);
                    var p: number = binarySearch(qs, q, compareQualifierTerms);
                    if (p < 0) {
                        qs.splice(-(p + 1), 0, q);
                    }
                }
            }
            return qs;
        }

        // Note: assuming that a qualifier name occurs only once, i.e.
        // {a: somevalue, ..., a: anothervalue, ...} doesn't happen. This should
        // have been guaranteed in an earlier step.
        function partitionByQualifier(pQ: CDLQualifierTerm, values: PathInfo[]): {from: number; to: number; partByValue: Map<any, PathInfo[]>;} {
            var partitions: Map<any, PathInfo[]> = new Map<any, PathInfo[]>();
            var first: number = undefined;
            var last: number = undefined;
            var nrOccurences: number = 0;

            for (var i: number = 0; i < values.length; i++) {
                var qCount: number = 0;
                for (var j: number = 0; j < values[i].qualifierTerms.length; j++) {
                    var q: CDLQualifierTerm = values[i].qualifierTerms[j];
                    if (q.attribute === pQ.attribute && q.level === pQ.level) {
                        qCount++;
                        if (qCount > 1) {
                            // no attributes that occur more than once
                            return undefined;
                        }
                        if (first === undefined) {
                            first = i;
                        } else if (last !== i - 1) {
                            return undefined; // not consecutive
                        }
                        last = i;
                        nrOccurences++;
                        var matchValues: any[] = q.value instanceof MoonOrderedSet? q.value.os: [q.value];
                        for (var k = 0; k < matchValues.length; k++) {
                            var matchValue: any = matchValues[k];
                            var matchValueType: string = typeof(matchValue);
                            if (matchValueType !== "boolean" && matchValueType !== "string" &&
                                  matchValueType !== "number") {
                                return undefined;
                            }
                            if (!partitions.has(matchValue)) {
                                partitions.set(matchValue, []);
                            }
                            partitions.get(matchValue).push(values[i].removeQualifier(q));
                        }
                    }
                }
            }
            if (first === undefined || nrOccurences === 1) {
                // If an attribute occurs only once, we must skip it: there's
                // nothing to partition, and it leads to an infinite loop
                // because changeToThis will be set without an actual change.
                return undefined;
            }
            var firstPartition: PathInfo[] = undefined;
            for (var [matchValue, partition] of partitions) {
                if (firstPartition === undefined) {
                    firstPartition = partition;
                } else if (!arraysEqual(firstPartition, partition)) {
                    return undefined;
                }
            }
            return {
                from: first,
                to: last,
                partByValue: partitions
            };
        }

        // This function could be extended to return true when a qualifier
        // covers all possible string values (facetType?) or numerical values
        // ({q: r(0, Infinity)}, {q:r(-Infinity, 0)}). 
        function qualifierCoversFullRange(partitions: Map<any, PathInfo[]>): boolean {
            return partitions.size === 2 && partitions.has(true) && partitions.has(false);
        }

        // Add attribute back to all pathInfo qualifiers with an os of match values
        function extendWithQ(pathInfo: PathInfo[], attribute: string, level: number, matchValues: MoonOrderedSet, className: string): PathInfo[] {
            return pathInfo.map(function(pi: PathInfo): PathInfo {
                var qualifiers = pi.qualifierTerms.slice(0);
                var qualifier = new CDLQualifierTerm(attribute, matchValues, level, className);
                var i: number = binarySearch(qualifiers, qualifier, compareQualifierTermsModValue);
                assert(i < 0, "qualifier should have been removed");
                qualifiers.splice(-(i + 1), 0, qualifier);
                return new PathInfo(pi.path, pi.expression, pi.origExpr,
                                    qualifiers, pi.writable, pi.inheritInfo,
                                    pi.priority, pi.childLevel,
                                    pi.remoteWritable, pi.node);
            });
        }

        var changeToThis: boolean = true;
        var globalChange: boolean = false;
        var nonPartitioningQualifiers: {[attr: string]: boolean}[] = [];
        while (this.values.length > 1 && changeToThis) {
            var qs: CDLQualifierTerm[] = collectQualifiers(this.values);
            changeToThis = false;
            for (var i: number = 0; !changeToThis && i < qs.length; i++) {
                var p = nonPartitioningQualifiers[qs[i].level] !== undefined &&
                        qs[i].attribute in nonPartitioningQualifiers[qs[i].level]?
                        undefined: partitionByQualifier(qs[i], this.values);
                if (p !== undefined) {
                    var matchValues: any[] = [];
                    for (var key of p.partByValue.keys()) {
                        matchValues.push(key);
                    }
                    if (qualifierCoversFullRange(p.partByValue)) {
                        // If a consecutive range of values is covered and both
                        // partitions are equal we can omit this qualifier over
                        // this range and use just one of the partitions.
                        this.values = this.values.slice(0, p.from).
                                    concat(p.partByValue.get(matchValues[0])).
                                    concat(this.values.slice(p.to + 1));
                        changeToThis = true;
                        globalChange = true;
                    } else if (p.partByValue.size > 1 &&
                               p.partByValue.get(matchValues[0]).length < p.to - p.from + 1) {
                        // When a limited set of values is covered, we can
                        // replace the set by one that matches the o() of the
                        // values, i.e. {a: 1} => x, {a: 2} => x, {a: 3} => x
                        // becomes {a: o(1,2,3)} => x. We only do this when the
                        // number of values is reduced (otherwise an infinite
                        // loop results; plus it would be useless)
                        // Logging:
                        // var str: string = "";
                        // for (var val of p.partByValue.keys()) {
                        //     if (str !== "") str += ", ";
                        //     str += String(val);
                        // }
                        // Utilities.warnOnce("could partition " + qs[i].attribute + " by " + str);
                        this.values =
                            this.values.slice(0, p.from).
                            concat(extendWithQ(p.partByValue.get(matchValues[0]),
                                               qs[i].attribute, qs[i].level,
                                               new MoonOrderedSet(matchValues),
                                               qs[i].className)).
                            concat(this.values.slice(p.to + 1));
                        changeToThis = true;
                        globalChange = true;
                    } else {
                        if (nonPartitioningQualifiers[qs[i].level] === undefined) {
                            nonPartitioningQualifiers[qs[i].level] = {};
                        }
                        nonPartitioningQualifiers[qs[i].level][qs[i].attribute] = true;
                    }
                } else {
                    if (nonPartitioningQualifiers[qs[i].level] === undefined) {
                        nonPartitioningQualifiers[qs[i].level] = {};
                    }
                    nonPartitioningQualifiers[qs[i].level][qs[i].attribute] = true;
                }
            }
        }
        nonPartitioningQualifiers = undefined; // for the garbage collector
        for (var attr in this.next) {
            if (this.next[attr].partitionQualifiers()) {
                globalChange = true;
            }
        }
        return globalChange;
    }

    // Partitions against known potential values. If a qualifier q is known to
    // have values v_1,...,v_n, the expressions are partitioned by presence
    // of q:v_i in the list of qualifiers. If the partitions are identical,
    // the qualifier can be discarded.
    // Note that the qualifiers' levels are relative to the parent template.
    partitionValueQualifiers(qvpl: PotentialQualifierValuesPerLevel, descriptionLevel: boolean, classValuesOnly: boolean): boolean {
        var values: PathInfo[] = partitionValueQualifiers(this.values, qvpl, descriptionLevel, classValuesOnly);

        if (values !== this.values) {
            assert(this.values.length !== values.length, "AAAAA");
            this.values = values;
            return true;
        } else {
            return false;
        }
    }

    // Partitioning class membership can be less strict, since class membership
    // is not a merge of different value. Hence the process can be done for each
    // class separately. This helps since variants usually introduce different
    // lists of class membership with quite some overlap.
    partitionClassQualifiers(qvpl:PotentialQualifierValuesPerLevel):boolean {
        var classNames: {[className: string]: PathInfo[]} = {};
        var others: PathInfo[] = [];
        var change: boolean = false;
        var className: string;

        for (var i: number = 0; i < this.values.length; i++) {
            if (this.values[i].expression instanceof ExpressionClassName) {
                className = this.values[i].expression.expression.className;
                if (!(className in classNames)) {
                    classNames[className] = [];
                }
                classNames[className].push(this.values[i]);
            } else {
                others.push(this.values[i]);
            }
        }
        for (className in classNames) {
            var values: PathInfo[] = partitionValueQualifiers(classNames[className], qvpl, false, false);
            if (values !== classNames[className]) {
                assert(classNames[className].length !== values.length, "BBBBB");
                classNames[className] = values;
                change = true;
            }
        }
        if (change) {
            this.values = others;
            for (className in classNames) {
                this.values = this.values.concat(classNames[className]);
            }
        }
        return change;
    }

    // Convenience methods for buildSimpleFunctionNode(); needed since writable
    // nodes are created by that function, and it's this or more parameters...
    getAreaId(): number {
        return this.area.templateId;
    }

    getContextPath(): string[] {
        var attributePath: string[] = [this.parentAttr];
        var ptr: PathTreeNode = this.parent;

        while (ptr !== undefined && ptr !== this.area) {
            attributePath.push(ptr.parentAttr);
            ptr = ptr.parent;
        }
        assert(ptr === this.area, "a writable that isn't a context nor param attribute?");
        return attributePath.reverse();
    }

    collectAllPathInfo(): PathInfo[] {
        var allPathInfo: PathInfo[] = this.values.slice(0);

        for (var attr in this.next) {
            allPathInfo = allPathInfo.concat(this.next[attr].collectAllPathInfo());
        }
        return allPathInfo;
    }

    isWritableReference(): boolean {
        return this.writable &&
            (this.parent === undefined || !this.parent.writable);
    }

    doesExist(): boolean {
        return this.values.some(function(pi: PathInfo): boolean {
            return pi.expression.type === ExpressionType.childExistence;
        });
    }

    explicitEmbedding(): boolean {
        return "embedding" in this.next &&
            !this.next["embedding"].isUndefined();
    }

    isIntersection(): boolean {
        var childDescription: PathTreeNode = this.parent.parent;

        return "partner" in childDescription.next;
    }

    checkMustBeDefined(): void {
        var mbd: boolean = false;
        for (var i: number = 0; i < this.values.length; i++) {
            if (this.values[i].origExpr === mustBeDefined &&
                  Utilities.isEmptyObj(this.next)) {
                // Only report when there are no overlapping qualifiers, i.e.
                // if q => mustBeDefined, then any subset or superset of q is
                // enough to consider this value defined, even though in case
                // of a superset, it's only partially defined.
                //   Test on this.next is too weak: should check if there is at
                // least one attribute defined for i's qualifiers
                var overlappingQualifiers: boolean = false;
                for (var j: number = 0;
                     !overlappingQualifiers && j < this.values.length;
                     j++) {
                    overlappingQualifiers = j != i &&
                        this.values[j].origExpr !== mustBeDefined &&
                        (qInQs(this.values[i].qualifierTerms,
                               this.values[j].qualifierTerms) ||
                         qInQs(this.values[j].qualifierTerms,
                               this.values[i].qualifierTerms));
                }
                if (!overlappingQualifiers) {
                    gErrContext.enter(this, this.values[i]);
                    Utilities.syntaxError("value left undefined", true);
                    gErrContext.leave();
                }
                mbd = true;
            }
        }
        if (mbd) {
            this.values = this.values.filter(function(value: PathInfo): boolean {
                return value.origExpr !== mustBeDefined;
            });
        }
        for (var attr in this.next) {
            this.next[attr].checkMustBeDefined();
        }
    }

    // If the new value is preceded by an unmergeable or identical value,
    // whose qualifiers are implied by the new value's qualifiers,
    // the new value doesn't add anything.
    addValue(value: PathInfo): void {
        for (var i = 0, l = this.values.length; i < l; i++) {
            var v_i: PathInfo = this.values[i];
            if ((v_i.isUnmergeable || v_i.expression.id === value.expression.id) &&
                  qInQs(v_i.qualifierTerms, value.qualifierTerms)) {
                return;
            }
        }
        this.values.push(value);
    }

    getPathSlice(topDepth: number, relBottomDepth: number): string[] {
        if (relBottomDepth === 0) {
            return [];
        }
        var ptr: PathTreeNode = this;
        var prevAttr: string = "";
        var bottomDepth: number = topDepth + relBottomDepth;
        while (ptr.depth > bottomDepth) {
            prevAttr = ptr.parentAttr;
            ptr = ptr.parent;
        }
        var path: string[] = [];
        while (ptr.depth > topDepth) {
            if (prevAttr === "description") {
                path.push(ptr.parentAttr);
            }
            prevAttr = ptr.parentAttr;
            ptr = ptr.parent;
        }
        return path;
    }
}

// the global 'super-class' derivation variable
// using 'class: superclass' results in deriving the class of the same name in
//  the next confLib down the priority scale
//
var superclass = {
    __superclass__: "--superclass--"
};

// Maps class usage (see warnUnusedClasses)
var classUsage:{[confLibName: string]: {[className: string]: number}} = {};
var classLoadJSTime:{[confLibName: string]: {[className: string]: number}} = {};

// First index is defunNr (0 for no defun), second is using clause
var globalExpressionCache: ExpressionCache[] = [new ExpressionCache()];

// Checks if path is [children, name, description]*
function isChildPath(path: string[], len: number = path.length): boolean {
    var isChildPath: boolean = true;
    
    for (var i: number = 0; isChildPath && i < len; i += 3) {
        isChildPath = path[i] === "children" &&
            (i + 2 >= path.length || path[i + 2] === "description");
    }
    return isChildPath;
}

function isContextPath(path: string[]): boolean {
    return isChildPath(path, path.length - 1) &&
        path[path.length - 1] === "context";
}

function getShortChildPath(path: string[]): string {
    var shrt: string[] = [];

    for (var i: number = 0; i < path.length; i += 3) {
        if (path[i] === "children" && path[i + 2] === "description") {
            shrt.push(path[i + 1]);
        } else {
            break;
        }
    }
    return shrt.concat(path.slice(i)).join(".");
}

function areaTemplatePath(templateId: number): string {
    return getShortChildPath(areaTemplates[templateId].areaNode.getPath());
}
            
function logClassName(path: string[], names: any): void {
    if (isChildPath(path)) {
        console.log("child", getShortChildPath(path), names);
    } else {
        console.log("nonchild", path.join("."), names);
    }
}

var inheritanceGraph: {[className:string]: {[className:string]: {[path: string]: boolean}}} = {};

function addInherit(inheritInfo: InheritInfo, children: any, fullPath: string[]): void {
    var parent: string = inheritInfo.className;
    var path: string = fullPath.slice(inheritInfo.pathDepthAtInheritance).join(".");
    var childNames = children instanceof MoonOrderedSet? children.os: [children];

    if (!(parent in inheritanceGraph)) {
        inheritanceGraph[parent] = {};
    }
    for (var i: number = 0; i !== childNames.length; i++) {
        if (!(childNames[i] in inheritanceGraph[parent])) {
            inheritanceGraph[parent][childNames[i]] = {};
        }
        inheritanceGraph[parent][childNames[i]][path] = true;
    }
}

function updateInheritInfoPath(inheritInfo: InheritInfo[]): InheritInfo[] {
    var last: InheritInfo = inheritInfo[inheritInfo.length - 1];

    return inheritInfo.slice(0, inheritInfo.length - 1).concat({
        className: last.className,
        pathDepthAtInheritance: last.pathDepthAtInheritance,
        classTreeDepth: last.classTreeDepth + 1,
        priorityQualifier: last.priorityQualifier
    });
}

function priorityInheritInfoPath(inheritInfo: InheritInfo[]): InheritInfo[] {
    var last: InheritInfo = inheritInfo[inheritInfo.length - 1];

    return inheritInfo.slice(0, inheritInfo.length - 1).concat({
        className: last.className,
        pathDepthAtInheritance: last.pathDepthAtInheritance,
        classTreeDepth: last.classTreeDepth + 1,
        priorityQualifier: true
    });
}

// The qualifier comparison has been lifted from contentArray/description
// qualifier.js and classes.js
// The idea is: a more specialized qualifier has a higher priority. Since not
// all qualifiers are specializations of each other, sorting is done by
// determining relations between the qualifiers called "paths", where a path
// contains the ids of the preceding qualifiers of which it is a specialization.
// By comparing paths, it is guaranteed that q1 comes before q2 when q1 is a
// specialization of q2, even when there are other qualifiers with which
// neither has a specialization/generalization relationship.

function queryIsSpecialization(spec: any, gen: any): boolean {
    for (var attr in gen) {
        if (!(attr in spec) || gen[attr] !== spec[attr]) {
            return false;
        }
    }
    return true;
}

function qualifierCompare(q1: any, q2: any): number
{
    if (q1 === "!" && q2 !== "!") {
        return -1;
    }
    if (q1 !== "!" && q2 === "!") {
        return 1;
    }

    var q1Constant = q1 === undefined || q1 === "!" || q1 === true;
    var q2Constant = q2 === undefined || q2 === "!" || q2 === true;

    if (q1Constant && q2Constant)
        return 0; // pos?

    if (q1Constant)
        return 1;

    if (q2Constant)
        return -1;

    // nothing more specific than a never matching qualifier
    if (q1 === false) {
        if (q2 === false) {
            return 0;
        }
        return -1;
    }
    if (q2 === false) {
        return 1;
    }

    var r12 = queryIsSpecialization(q1, q2);
    var r21 = queryIsSpecialization(q2, q1);

    if (r12 && r21)
        return 0; // pos?

    if (r12)
        return -1;

    if (r21)
        return 1;

    return undefined;
}

function assignPath(id: number, relation: number[][], assignedPath: number[][], pathPrefix: number[]) {
    if (assignedPath[id]) {
        return;
    }
    var path: number[] = pathPrefix.concat(id);
    assignedPath[id] = path;
    for (var i = 0; i < relation.length; i++) {
        if (relation[id][i] < 0) {
            assignPath(i, relation, assignedPath, path);
        }
    }
}

function pathCompare(p1: number[], p2: number[]): number {
    for (var i: number = 0; i < p1.length && i < p2.length; i++) {
        if (p1[i] !== p2[i]) {
            return p1[i] - p2[i];
        }
    }
    return p2.length - p1.length;
}

interface VariantDesc {
    qualifier: any;
    variant: any;
    pos: number;
}

// e.g.
// { fullname: 'Core::Table', stemname: 'Table', conflib: 'Core', classdef:... }
interface ClassDesc {
    fullname: string;
    stemname: string;
    conflib: string;
    contextConfLib: string;
    classdef: any;
}

// the immediate context: the immediate classname of the cdl currently being
//  parsed, and the path relative to the root of that class
interface LastInheritInfo {
    className: string;
    path: string[];
}

function sortVariants(variants: VariantDesc[]): void {
    var variantRelation: number[][] = variants.map(function(q1: VariantDesc): number[] {
        return variants.map(function(q2: VariantDesc): number {
            return qualifierCompare(q2.qualifier, q1.qualifier);
        });
    });
    var variantPath: number[][] = [];

    // assign paths
    for (var startId: number = 0; startId < variants.length; startId++) {
        assignPath(startId, variantRelation, variantPath, []);
    }
    // and sort
    variants.sort(function (v1: VariantDesc, v2: VariantDesc): number {
        return pathCompare(variantPath[v1.pos], variantPath[v2.pos]);
    });
}

type ClassInheritByQualifiers = {
    [className: string]: {
        qualifiers: CDLQualifierTerm[];
        inheritStr: string;
    }[]
};

var multiplePathCount: number = 0;

function getLastInheritInfo(inheritInfo: InheritInfo[], path: string[]): LastInheritInfo {
    var lastInherit: InheritInfo = inheritInfo[inheritInfo.length - 1];
    var inhPath: string[] = path.slice(lastInherit.pathDepthAtInheritance);
    var className = lastInherit.className;
    return {
        className: className,
        path: inhPath
    };
}

function inheritStr(inheritInfo: InheritInfo[], path: string[]): string {
    var lastInheritInfo = getLastInheritInfo(inheritInfo, path);
    var className = lastInheritInfo.className === undefined? "screenArea":
                    "in class " + lastInheritInfo.className;
    var combStr: string = lastInheritInfo.className === undefined? "." : " at ";
    var inhPath = lastInheritInfo.path;

    return inhPath.length === 0? className:
                                    className + combStr + inhPath.join(".");
}

// return a classDesc of the class whose stem is 'classStem' and
//  which has the lowest numbered priority, which is still numerically
// higher than the priority of 'contextConfLib'
// (lower numeric priorities express higher preference)
// if 'contextConfLib' is not provided, then the class with minimal numeric
//  priority confLib of those confLibs having the given stem is used
//
function getClassDesc(classStem: string,
                        contextConfLib: string = undefined): ClassDesc
{
    var classDefDict: {[confLibName: string]: any};
    classDefDict = classDefinitions[classStem];

    var minPri: number = -Infinity;
    var clpri: number = Infinity;
    var def: any;

    if (typeof(contextConfLib) !== "undefined") {
        minPri = confLibPriority[contextConfLib];
    }

    var confLibName: string;
    var curConfLibName: string;

    for (curConfLibName in classDefDict) {
        var curpri: number = confLibPriority[curConfLibName];
        if ((curpri < clpri) && (curpri > minPri)) {
            clpri = curpri;
            confLibName = curConfLibName;
            def = classDefDict[confLibName];
        }
    }

    if (!(confLibName in classUsage)) {
        classUsage[confLibName] = {};
        classLoadJSTime[confLibName] = {};
    }
    if (!(classStem in classUsage[confLibName])) {
        classUsage[confLibName][classStem] = 0;
        classLoadJSTime[confLibName][classStem] = 0.0;
    }

    return {
        fullname: confLibName + '::' + classStem,
        stemname: classStem,
        conflib: confLibName,
        contextConfLib: contextConfLib,
        classdef: def
    };
}

// return a classDesc of the class with the same stem-name as the
//  class immediately surrounding the current cdl code, and whose confLib
//  has highest priority (lowest numerical priority value) of all those
//  confLibs having a class with this stem name which have a priority
//  lower than the confLib of the current confLib
// The stem and the confLib are extracted from the fullname
function getSuperclassDesc(inheritInfo: InheritInfo[], path: string[]): ClassDesc {
    var lastInherit = inheritInfo[inheritInfo.length - 1];

    var fullname: string = lastInherit.className;
    if (typeof(fullname) !== 'string') {
        Utilities.error("Cannot derive a superclass when not in a class" +
                        " at " + inheritStr(inheritInfo, path));
    }
    if (lastInherit.classTreeDepth !== 0) {
        Utilities.error("Deriving a superclass of '" + fullname +
                        "' is not allowed at " + inheritStr(inheritInfo, path));
    }
    var cnc: string[] = fullname.split("::");
    if (cnc.length !== 2) {
        Utilities.error("Unexpected class name '" + fullname +
                        "' while deriving superclass at " + inheritStr(inheritInfo, path));
    }
    var confLib: string = cnc[0];
    var stem: string = cnc[1];

    return getClassDesc(stem, confLib);
}

function alreadyInherited(className: string, qualifiers: CDLQualifierTerm[],
                            classes: ClassInheritByQualifiers): boolean
{
    var byQ: {qualifiers: CDLQualifierTerm[]; inheritStr: string;}[] = classes[className];

    if (byQ !== undefined) {
        for (var i: number = 0; i < byQ.length; i++) {
            if (qInQs(byQ[i].qualifiers, qualifiers)) {
                return true;
            }
        }
    }
    return false;
}

function convertClass(node: PathTreeNode, classReference: any, path: string[],
                      qualifiers: CDLQualifierTerm[], childLevel: number,
                      classes: ClassInheritByQualifiers,
                      inheritInfo: InheritInfo[], classArguments: any): void
{
    var className: string;

    // Parse class reference
    if (typeof(classReference) === "string") {
        className = classReference;
    }

    if (inheritInfo.length > 1) {
        addInherit(inheritInfo[inheritInfo.length - 1], className, path);
    }
    if (classReference !== superclass && node.area === node) {
        node.addValue(new PathInfo(
            path, expressionStore.get(new ClassName(className), classArguments), className,
            qualifiers, false, inheritInfo, undefined, childLevel, undefined, node));
    }
    if (className in classDefinitions || classReference === superclass) {
        var classDesc: ClassDesc;
        var classFullName: string;
        var def: any;

        if (classReference === superclass) {
            classDesc = getSuperclassDesc(inheritInfo, path);

            def = classDesc.classdef;

            // it is OK to try to derive a super-class that does not exist,
            // but warn anyway (for now)
            if (typeof(def) === "undefined") {
                errorReporters["noSuperclass"](classDesc.contextConfLib +
                                '::' + classDesc.stemname + "'" +
                                " attempts to derive its superclass, " +
                                "which does not exist");
                return;
            }
        } else {
            classDesc = getClassDesc(className);
            def = classDesc.classdef;
        }
        classFullName = classDesc.fullname;

        if (alreadyInherited(classFullName, qualifiers, classes)) {
            Utilities.warnOnce("repeated class '" + className + "' " +
                               inheritStr(inheritInfo, path));
            return;
        }
        if (!(classFullName in classes)) {
            classes[classFullName] = [];
        }

        if (inheritInfo.some(function(ih: InheritInfo): boolean {
            return ih.className === classFullName;
        })) {
            Utilities.error("cycle in inheritance: class '" +
                            classFullName + "' "  + inheritStr(inheritInfo, path));
        }

        var t0: number, nodeTime: number;
        if (debugLoadJSTime) {
            t0 = performance.now();
            nodeTime = node.loadJSCPUTime;
            node.loadJSCPUTime = -1;
        }
        classes[classFullName].push({
            qualifiers: qualifiers,
            inheritStr: undefined // unused: inheritStr()
        });
        convertVariants(node, def, path, qualifiers, childLevel,
                        inheritInfo.concat(<InheritInfo>{
                            className: classFullName,
                            pathDepthAtInheritance:path.length,
                            classTreeDepth: 0
                        }),
                        classes, true, classArguments);
        classes[classFullName].pop();
        classUsage[classDesc.conflib][classDesc.stemname]++;
        if (debugLoadJSTime) {
            var t = performance.now() - t0;
            if (nodeTime !== -1) {
                node.loadJSCPUTime = nodeTime + t;
            }
            classLoadJSTime[classDesc.conflib][classDesc.stemname] += t;
        }
    } else {
        errorReporters["unknownClass"]("unknown class '" + className +
                                        "' "  + inheritStr(inheritInfo, path));
    }
}
    
function convertVariants(node: PathTreeNode, def: any, path: string[],
                         qualifiers: CDLQualifierTerm[], childLevel: number,
                         inheritInfo: InheritInfo[],
                         classes: ClassInheritByQualifiers,
                         inheritAllowed: boolean, classArguments: any): void
{
    var variants: VariantDesc[] = [];
    var os: any[] = def instanceof MoonOrderedSet? def.os: [def];
    var className = inheritInfo[inheritInfo.length - 1].className;
    var localQualifiers: any[] = [];

    for (var i: number = 0; i !== os.length; i++) {
        var elt: any = os[i];
        var qualifier: any;
        var variant: any;
        if (elt instanceof Object && "qualifier" in elt) {
            qualifier = elt.qualifier;
            if (qualifier !== "!" && qualifier !== undefined &&
                    getCdlExpressionType(qualifier) !== 
                    ExpressionType.attributeValue) {
                Utilities.error("unexpected qualifier: " +
                                convertValueToString(qualifier, ""));
            }
            variant = "variant" in elt? elt.variant:
                        shallowCopyMinus(elt, "qualifier");
        } else if (elt instanceof Object && "variant" in elt) {
            qualifier = undefined;
            variant = elt.variant;
        } else {
            qualifier = undefined;
            variant = elt;
        }
        variants.push({qualifier: qualifier, variant: variant, pos: i});
        if (localQualifiers.some(function(q1: any): boolean {
                return cdlCompare(q1, qualifier) === 0;
            })) {
            errorReporters["duplicateVariant"](
                "duplicate " +
                (qualifier === undefined?
                    "default variant":
                    "variant " + JSON.stringify(qualifier)) +
                " in class " + className);
        }
        localQualifiers.push(qualifier);
    }
    sortVariants(variants);
    for (var i: number = 0; i !== variants.length; i++) {
        var variantQualifiers: CDLQualifierTerm[] = qualifiers;
        var qualIsFalse: boolean = false;
        if (variants[i].qualifier instanceof Object) {
            variantQualifiers = qualifiers.slice(0);
            for (var qAttr in variants[i].qualifier) {
                var qualifierValue = variants[i].qualifier[qAttr];
                if (!addQualifier(variantQualifiers,
                                            new CDLQualifierTerm(
                                                qAttr, qualifierValue,
                                                0, className))) {
                    qualIsFalse = true;
                    break;
                }
            }
        }
        if (!qualIsFalse) {
            var nInheritInfo = variants[i].qualifier === "!"?
                priorityInheritInfoPath(inheritInfo): inheritInfo;
            convertObject(node, variants[i].variant, path, variantQualifiers,
                          childLevel, nInheritInfo, classes, inheritAllowed,
                          classArguments);
        }
    }
}

function convertValue(node: PathTreeNode, val: any, path: string[],
                      qualifiers: CDLQualifierTerm[], childLevel: number,
                      inheritInfo: InheritInfo[],
                      classes: ClassInheritByQualifiers,
                      inheritAllowed: boolean, classArguments: any): void
{
    if (isVariantExpression(val)) {
        convertVariants(node, val, path, qualifiers, childLevel, inheritInfo, classes, inheritAllowed, classArguments);
    } else if (val instanceof Object &&
                !(val instanceof NonAV || val instanceof Array || val instanceof JavascriptFunction)) {
        convertObject(node, val, path, qualifiers, childLevel, inheritInfo, {}, inheritAllowed, classArguments);
    } else {
        var pathInfo = new PathInfo(path, expressionStore.get(val, classArguments), val,
                                    qualifiers, false, inheritInfo, undefined,
                                    childLevel, undefined, node);
        node.addValue(pathInfo);
        if (!Utilities.isEmptyObj(node.next)) {
            node.opaque = true;
        }
    }
}

function isVariantExpression(obj: any): boolean {
    function isVariantObject(obj: any): boolean {
        return obj instanceof Object &&
                !(obj instanceof NonAV || obj instanceof Array) &&
                (("qualifier" in obj) || ("variant" in obj));
    }
    return isVariantObject(obj) ||
        (obj instanceof MoonOrderedSet && obj.os.some(isVariantObject));
}

function isClassReference(expr: any): boolean {
    return typeof(expr) === "string" || expr === superclass;
}

// Replace "a.b": x by "a: {b: x}", merging in order of attributes (note that
// this can be rather arbitrary, but "a.b": 3 and "a.c": 4 should merge nicely).
function replaceAbbreviatedPaths(obj: any): any {
    var obj2 = obj;

    for (var attr in obj) {
        if (/\./.test(attr)) {
            var replacement: any =
                pathToQueryObject(attr.split("."), obj[attr]);
            obj2 = mergeConst(shallowCopyMinus(obj2, attr), replacement);
        }
    }
    return obj2;
}

function isTemplateVar(name: any): boolean {
    return typeof(name) === "string" && name.startsWith("$") && !name.startsWith("$$");
}

// Converts a CDL object in an array of paths, ordered by priority
// so { a: 1, b: <expr>, "class": "x" } will go to
// path = ["a"], value = 1
// path = ["b"], value = expr
// followed by the conversion of class x.
// If class x contains e.g. {b: {c: "z"}}, then the next path will be
// path = ["b","c"], value = "z"
// Since it's later in the list, it has a higher priority value (meaning the
// original path "b" takes precendence when appriopriate).
// Note:
// - The parameters should not be modified, since they are used in PathInfo to
//   store path, qualifiers and debug info, except classes.
function convertObject(node: PathTreeNode, obj: any, path: string[],
                       qualifiers: CDLQualifierTerm[],
                       childLevel: number, inheritInfo: InheritInfo[],
                       classes: ClassInheritByQualifiers,
                       inheritAllowed: boolean, classArguments: any): void
{
    if (obj instanceof Array || obj instanceof NonAV || !(obj instanceof Object)) {
        convertValue(node, obj, path, qualifiers, childLevel, inheritInfo, classes, inheritAllowed, classArguments);
        return;
    }

    if (isVariantExpression(obj)) {
        convertVariants(node, obj, path, qualifiers, childLevel, inheritInfo, classes, inheritAllowed, classArguments);
        return;
    }

    // It's an AV with a direct path to the screen area
    var isNewChild: boolean = isChildPath(path);
    var newClasses: ClassInheritByQualifiers = {};
    var newInheritInfo: InheritInfo[] = updateInheritInfoPath(inheritInfo);

    obj = replaceAbbreviatedPaths(obj);

    for (var origAttr in obj) {
        var attr0 = origAttr.charAt(0);
        var attr: string = attr0 === "^" || attr0 === "*"? origAttr.substr(1): origAttr;
        var childNode: PathTreeNode;

        if (attr.length > 1 && attr[0] === "$") {
            if (attr[1] === "$") {
                attr = attr.slice(1);
            } else {
                var templateArg = classArguments === undefined? undefined:
                                  classArguments[attr.slice(1)];
                if (templateArg === undefined) {
                    Utilities.syntaxError("undefined template argument for " + attr);
                } else if (typeof(templateArg) !== "string") {
                    Utilities.syntaxError("template argument for attribute " +
                                            attr + " is not a string");
                } else {
                    attr = templateArg;
                }
            }
        }

        var childPath: string[] = path.concat(attr);

        if (attr in node.next) {
            childNode = node.next[attr];
            if (childNode.singlePath) {
                // console.log("multiple path", childPath.join("."));
                multiplePathCount++;
                childNode.singlePath = false;
            }
        } else if (attr !== "class") {
            childNode = node.next[attr] = new PathTreeNode(node, node.area, attr);
            if (!isNewChild && node.values.length !== 0) {
                node.opaque = true;
            }
        }

        if (isNewChild && origAttr === "description") {

            // A description needs to contain a child-existence value with
            // the qualifiers that guard the existence of the area
            childNode.addValue(new PathInfo(
                childPath, gChildExistence, gChildExistence,
                qualifiers, false, inheritInfo, undefined, childLevel,
                undefined, childNode));
            childNode.area = childNode;
            var pQs = qualifiers.map(qLevelUp);
            convertValue(childNode, obj[origAttr], childPath, pQs,
                         childLevel + 1, newInheritInfo, newClasses, false,
                         classArguments);

        } else if (attr !== "class") {

            // A normal attribute only extends the path to the expression. If it
            // is writable, all paths below it (in this variant) are writable
            // too.

            // a '^' prefix indicates a remote-writable variable
            // a '*' prefix indicates a local-writable variable
            if (attr0 === "^" || attr0 === "*") {
                // Writable, so everything that follows is a value, rather
                // than a tree
                childNode.addValue(new PathInfo(childPath,
                    expressionStore.get(obj[origAttr], classArguments),
                    obj[origAttr], qualifiers, true, inheritInfo, undefined,
                    childLevel, attr0 === "^", childNode));
                childNode.writable = true;
            } else {
                // Non-writable
                convertValue(childNode, obj[origAttr], childPath, qualifiers,
                    childLevel, newInheritInfo, newClasses, false, classArguments);
            }
        }
    }

    if (inheritAllowed) {
        addInheritAtPath(node, obj, path, qualifiers, childLevel,
                         inheritInfo, classes, classArguments);
    }
}

function addInheritAtPath(node: PathTreeNode, obj: any, path: string[],
                          qualifiers: CDLQualifierTerm[],
                          childLevel: number, inheritInfo: InheritInfo[],
                          classes: ClassInheritByQualifiers,
                          classArguments: any): void {
    var isNewChild: boolean = isChildPath(path);
    var newClasses: ClassInheritByQualifiers = {};
    var newInheritInfo: InheritInfo[] = updateInheritInfoPath(inheritInfo);

    obj = replaceAbbreviatedPaths(obj);

    // First expand children, which means that classes in child areas have a
    // higher priority
    for (var origAttr in obj) {
        var val: any = obj[origAttr];
        var attr0 = origAttr.charAt(0);
        var attr: string = attr0 === "^" || attr0 === "*"? origAttr.substr(1): origAttr;
        var childPath: string[] = path.concat(attr);
        var childNode: PathTreeNode = node.next[attr];
        if (isNewChild && origAttr === "description") {
            var pQs = qualifiers.map(qLevelUp);
            addInheritAtPath(childNode, val, childPath, pQs, childLevel + 1,
                             newInheritInfo, newClasses, classArguments);
        } else if (attr !== "class") {
            // When childNode is undefined, it hasn't been added by convertObject and can be skipped
            if (childNode !== undefined) {
                if (isVariantExpression(val)) {
                    // TODO: qualifier/variant!!!
                    debugger;
                } else if (val instanceof Object &&
                          !(val instanceof NonAV || val instanceof Array ||
                            val instanceof JavascriptFunction)) {
                    addInheritAtPath(childNode, val, childPath, qualifiers,
                                     childLevel, inheritInfo, classes, classArguments);
                }
            }
        }
    }

    var objClass: any = obj.class;
    if (objClass !== undefined) {
        // Get the list of paths from the class definitions, and expand them
        // A list of classes is treated as if all classes were merged/concatenated
        // into one big class.
        var inheritedClasses: any[] = objClass instanceof MoonOrderedSet?
                                    objClass.os: [objClass];
        // Add classes to tree in order of appearance
        for (var i: number = 0; i !== inheritedClasses.length; i++) {
            var inh_i = inheritedClasses[i];
            var className: any;
            var newClassArguments: any;
            if (inh_i instanceof Object && inh_i !== superclass) {
                var exp = expressionStore.get(inh_i, classArguments);
                className = exp.expression.name;
                newClassArguments = exp.expression;
            } else {
                className = inh_i;
                if (className === superclass) {
                    // superclass inherits arguments by default
                    newClassArguments = classArguments;
                }
            }
            while (isTemplateVar(className)) {
                var exp = expressionStore.get(className, classArguments);
                inh_i = exp.expression;
                if (inh_i instanceof Object && inh_i !== superclass) {
                    var exp = expressionStore.get(inh_i, newClassArguments);
                    className = exp.expression.name;
                    newClassArguments = exp.expression;
                } else {
                    className = inh_i;
                    if (className === superclass) {
                        // superclass inherits arguments by default
                        newClassArguments = classArguments;
                    }
                }
            }
            if (inheritedClasses.find(elt => objectEqual(elt, inh_i)) < i) {
                Utilities.warn("repeated class '" + className +
                    "' " + inheritStr(inheritInfo, path));
            }
            else if (!isClassReference(className)) {
                Utilities.syntaxError("malformed \"class\" reference: " +
                    convertValueToString(className, "") +
                    " at " + inheritStr(inheritInfo, path));
            }
            else {
                convertClass(node, className, path, qualifiers, childLevel,
                             classes, inheritInfo, newClassArguments);
            }
        }
    }
}

    // Print a warning with a list of unused classes.
// Also releases memory used by the cache.
function warnUnusedClasses(): void {
    var unusedClassNames: string[] = [];

    for (var classStem in classDefinitions) {
        for (var confLib in classDefinitions[classStem]) {
            if (!(confLib in classUsage) || !(classStem in classUsage[confLib])) {
                unusedClassNames.push(confLib + "::" + classStem);
            }
        }
    }
    if (unusedClassNames.length !== 0) {
        Utilities.warn("unused classes: " + unusedClassNames.join(", "));
    }
    // And release a bit of memory
    classUsage = undefined;
    classLoadJSTime = undefined;
}
