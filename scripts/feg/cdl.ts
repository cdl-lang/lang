// Copyright 2019 Yoav Seginer.
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

type SimpleValue = number | string | boolean;

type Singleton = SimpleValue | NonAV | {[attr: string]: OrderedSet};
type OrderedSet = Singleton[];
type UnnormalizedValue = any;
type NormalizedValue = OrderedSet;

// Constant normalized values that are used often.
var constEmptyOS: any[] = [];
var constTrueOS: any[] = [true];
var constFalseOS: any[] = [false];
var constEmptyObject: any = {};

interface PathAssociationTree<T> {
    value?: T;
    next?: {[attr: string]: PathAssociationTree<T>};
};

function getPathAssociation<T>(path: string[], tree: PathAssociationTree<T>): T {
    var ptr: PathAssociationTree<T> = tree;

    for (var i: number = 0; i < path.length; i++) {
        if ("next" in ptr && path[i] in ptr.next) {
            ptr = ptr.next[path[i]];
        } else {
            return undefined;
        }
    }
    return ptr.value;
}

function addPathAssociation<T>(path: string[], value: T, tree: PathAssociationTree<T>): void {
    var ptr: PathAssociationTree<T> = tree;

    for (var i: number = 0; i < path.length; i++) {
        if (!("next" in ptr)) {
            ptr.next = {};
        }
        if (!(path[i] in ptr.next)) {
            ptr.next[path[i]] = {};
        }
        ptr = ptr.next[path[i]];
    }
    ptr.value = value;
}

interface SourcePointer {
    node: EvaluationNode;
    position: number;
}

// The interface for areas and area like objects in built-in functions.
interface EvaluationEnvironment {

    // Returns the object's id, or undefined if it doesn't have one
    getOwnId(): string;

    // Returns the result of the requested relation
    getRelation(relation: string): any[];

    // Returns the parent
    getParent(): EvaluationEnvironment;

    // Returns the parent with the given template id
    getParentWithTemplateId(id: number): EvaluationEnvironment;

    evaluationNodes: EvaluationNode[][]; // indices: defun nr, prototype id

    template: AreaTemplate;
    localToDefun: number;

    // Increases refCount where appropriate
    link(): EvaluationEnvironment;

    // Decreases refCount and destroys when it reaches 0 (not in case of
    // areas, though).
    unlink(): void;

    // Returns the EvaluationEnvironment to which this is linked, and which
    // is an area. This will be the implicit [me] in e.g. [offset].
    getEvaluationArea(): CoreArea;

    // Returns true when the environment can build nodes; false when it has been
    // destroyed.
    isValid(): boolean;

    // Returns the source for a defun parameter
    getSource(fn: FunctionNode): SourcePointer;
}

interface MarshallableValue {
    marshalValue(xdr: XDR): any;
    //static unmarshalValue(obj: any, xdr: XDR):  any;
}

interface ExecutableFunction {

    // static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction;

    destroy(): void;

    // Non incremental update for a single value
    execute(args: Result[]): any[];

    // Non incremental update for set mode
    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[];

    // If this function returns true, execute returns undefined when there is
    // no change; any other value means the result has changed. This allows the
    // ExecutableFunction to return the same object.
    undefinedSignalsNoChange(): boolean;
}

class EFNop implements ExecutableFunction {

    static singleton: ExecutableFunction = new EFNop();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFNop.singleton;
    }

    destroy(): void {
    }

    execute(args: Result[]): any[] {
        return constEmptyOS;
    }

    executeOS(args: Result[], setMode: boolean[]): any[] {
        return constEmptyOS;
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}

// Empty class that should be inherited by all objects that should not be
// split in attribute-values during comparison or querying.
abstract class NonAV implements EqualityTest, MarshallableValue {

    abstract isEqual(v: any): boolean;

    abstract copy(): NonAV;

    abstract typeName(): string;

    abstract stringify(): string;

    abstract toJSON(): string;

    abstract toCdl(): string;

    // Returns true when v matches this
    abstract match(v: any): boolean;

    // create a json representation of this object. The unmarshal counterpart
    // is a static function in each class
    abstract marshalValue(xdr: XDR): any;
}

class Projector extends NonAV {
    copy(): Projector {
        return this;
    }

    typeName(): string {
        return "projector";
    }

    toString(): string {
        return "_";
    }

    stringify(): string {
        return "_";
    }

    toJSON(): string {
        return "_";
    }

    toCdl(): any {
        return _;
    }

    isEqual(v: any) {
        return v === _;
    }

    match(v: any): boolean {
        return true;
    }

    // marshalling a projector requires just the type - all projectors are
    //  the same
    marshalValue(xdr: XDR) {
        return { type: "projector" };
    }

    static unmarshalValue(obj: any, xdr: XDR): Projector {
        return _;
    }
}

class TerminalSymbol extends NonAV {
    name: string;

    constructor(name: string) {
        super();
        this.name = name;
    }

    copy(): TerminalSymbol {
        return this;
    }

    typeName(): string {
        return "terminalSymbol";
    }

    toCdl(): any {
        return this.name;
    }

    toString(): string {
        return this.name; // denotation is identical to name
    }

    stringify(): string {
        return this.name;
    }

    toJSON(): string {
        return this.name;
    }

    isEqual(v: any) {
        return this === v; // there is only one of each terminal symbol
    }

    match(v: any): boolean {
        return this === v;
    }

    marshalValue(xdr: XDR) {
        return { type: "terminalSymbol", name: this.name };
    }

    static unmarshalValue(obj: any, xdr: XDR): TerminalSymbol {
        switch (obj.name) {
          case "unmatched":
            return unmatched;
        }
        return undefined;
    }
}

class BuiltInFunction extends NonAV {

    name: string;
    minNrArguments: number;
    maxNrArguments: number;
    isLocalWithoutArguments: boolean; // when true, this function is local when there are no arguments
    dependingOnImplicitArguments: boolean;
    factory: (local: EvaluationEnvironment, en: EvaluationNode) => ExecutableFunction;
    transientResult: boolean;
    classConstructor: typeof EvaluationNodeWithArguments;
    valueType: ValueType;
    // if this is true, a write to this function is propagated to its writable
    // arguments.
    writeThroughToWritableInputs: boolean;

    constructor(name: string, minNrArguments: number, maxNrArguments: number, valueType: ValueType, isLocalWithoutArguments: boolean = false, depOnImplArgs: boolean = false, transientResult: boolean = false, writeThroughToWritableInputs: boolean = false)
    {
        super();
        this.name = name;
        this.minNrArguments = minNrArguments;
        this.maxNrArguments = maxNrArguments;
        this.factory = EFNop.make;
        this.isLocalWithoutArguments = isLocalWithoutArguments;
        this.dependingOnImplicitArguments = depOnImplArgs;
        this.transientResult = transientResult;
        this.writeThroughToWritableInputs = writeThroughToWritableInputs;
        this.valueType = valueType;
    }

    copy(): BuiltInFunction {
        return this;
    }

    typeName(): string {
        return "builtInFunction";
    }

    stringify(): string {
        return this.name;
    }

    toJSON(): string {
        return this.name;
    }

    toCdl(): any {
        return this;
    }

    isEqual(v: any): boolean {
        return v instanceof BuiltInFunction && this.name === v.name;
    }

    match(v: any): boolean {
        return v instanceof BuiltInFunction && this.name === v.name;
    }

    // create a json object representing this built-in function
    marshalValue(xdr: XDR):
    any {
        return {
            type: "builtInFunction",
            name: this.name,
            isLocalWithoutArguments: this.isLocalWithoutArguments,
            dependingOnImplicitArguments: this.dependingOnImplicitArguments,
            transientResult: this.transientResult
        }
    }

    static unmarshalValue(obj: any, xdr: XDR) {
        return new BuiltInFunction(obj.name, obj.isLocalWithoutArguments,
                                   obj.depOnImplArgs, obj.transientResult);
    }
};

// The following symbols are used as Javascript functions
// in the cdl.

class JavascriptFunction {

    name: string;
    arguments: any[];

    constructor(name: string, functionArguments: any[]) {
        this.name = name;
        this.arguments = functionArguments;
    }

};

function atomic(...args: any[]): JavascriptFunction {
    return new JavascriptFunction("atomic", args);
}

function apply(...args: any[]): JavascriptFunction {
    return new JavascriptFunction("apply", args);
}

function push(...args: any[]): JavascriptFunction {
    return new JavascriptFunction("push", args);
}

abstract class MoonOrderedSetBase extends NonAV {
    
    os: any[];

    constructor(elts: any[]) {
        super();
        this.os = elts;
    }

    copy(): MoonOrderedSetBase {
        assert(false, "implement in derived class");
        return undefined;
    }

    makeNew(elts: any[]): MoonOrderedSetBase {
        assert(false, "implement in derived class");
        return undefined;
    }
   
    toString(): string {
        assert(false, "implement in derived class");
        return undefined;
    }

    isEqual(v: any): boolean {
        assert(false, "implement in derived class");
        return undefined;
    }

    typeName(): string {
        assert(false, "implement in derived class");
        return undefined;
    }

    // create a json representation of this ordered-set
    marshalValue(xdr: XDR) {
        return MoonOrderedSetBase.marshalValue(this.typeName(), this.os, xdr);
    }

    static marshalValue(type: string, os: any[], xdr: XDR): any {
        var marshalledOS: any[] = [];
        for (var i = 0; i < os.length; i++) {
            marshalledOS[i] = xdr.xdrCdlObj(os[i]);
        }
        return { type: type, os: marshalledOS };
    }

    static unmarshalOS(obj: any, xdr: XDR): any[] {
        var marshalledOS = obj.os;
        if (typeof(marshalledOS) === "undefined") {
            return [];
        }
        var os: any[] = [];
        for (var i = 0; i < marshalledOS.length; i++) {
            os[i] = xdr.xdrCdlObj(marshalledOS[i]);
        }
        return os;
    }

    // create an array as the internal representation of an o/s
    static unmarshalValue(obj: any, xdr: XDR): any {
        var os: any[] = MoonOrderedSetBase.unmarshalOS(obj, xdr);
        return os;
    }
}

class MoonOrderedSet extends MoonOrderedSetBase {
    
    os: any[];

    copy(): MoonOrderedSet {
        return new MoonOrderedSet(this.os);
    }

    makeNew(elts: any[]): MoonOrderedSet {
        return new MoonOrderedSet(elts);
    }
   
    toString(): string {
        return "o(" + this.os.map(flatcdlify).join(",") + ")";
    }

    stringify(): string {
        return this.toString();
    }

    toJSON(): string {
        return "o(" + this.os.map(cstringify).join(", ") + ")";
    }

    toCdl(): any {
        return this;
    }

    // Should only be called for os of simple values
    match(v: any): boolean {
        if (v instanceof Array) {
            return this.os.some(elt => v.indexOf(elt) >= 0);
        } else {
            return this.os.indexOf(v) >= 0;
        }
    }

    isEqual(v: any): boolean {
        if (v instanceof MoonOrderedSet) {
            if (this.os.length !== v.os.length) {
                return false;
            }
            for (var i: number = 0; i < this.os.length; i++) {
                if (!objectEqual(this.os[i], v.os[i])) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    typeName(): string {
        return "orderedSet";
    }
}

// Constructs an os in the cdl
function o(...args: any[]): MoonOrderedSet {
    return new MoonOrderedSet(args);
}

class MoonRange extends MoonOrderedSetBase {
    closedLower: boolean;
    closedUpper: boolean;

    constructor(elts: any[], closedLower: boolean, closedUpper: boolean) {
        super(elts);
        this.closedLower = closedLower;
        this.closedUpper = closedUpper;
    }

    copy(): MoonRange {
        return new MoonRange(this.os, this.closedLower, this.closedUpper);
    }
   
    makeNew(elts: any[]): MoonRange {
        return new MoonRange(elts, true, true);
    }
   
    min(): any {
        return Math.min.apply(null, this.os);
    }

    max(): any {
        return Math.max.apply(null, this.os);
    }

    typeName(): string {
        return "range";
    }

    match(v: any): boolean {
        throw "not implemented";
    }

    // a range is equal to another range if its open/closed statuses are
    // identical, and all elements can be found in the other in arbitrary order.
    isEqual(v: any): boolean {
        if (v instanceof MoonRange && this.closedLower === v.closedLower &&
              this.closedUpper === v.closedUpper) {
            if (this.os.every((v:any):boolean=>{return isSimpleType(v);}) &&
                  v.os.every((v:any):boolean=>{return isSimpleType(v);})) {
                return this.min() === v.min() && this.max() === v.max();
            }
            for (var i: number = 0; i < this.os.length; i++) {
                var match_i: boolean = false;
                for (var j: number = 0; !match_i && j < v.os.length; j++) {
                    match_i = objectEqual(this.os[i], v.os[i]);
                }
                if (!match_i) {
                    return false;
                }
            }
            for (var j: number = 0; j < v.os.length; j++) {
                var match_j: boolean = false;
                for (var i: number = 0; !match_j && i < this.os.length; i++) {
                    match_j = objectEqual(this.os[i], v.os[i]);
                }
                if (!match_j) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    toString(): string {
        var os: string = this.os.map(safeJSONStringify).join(",");

        return this.closedLower?
            (this.closedUpper? "r(" + os + ")": "Rco(" + os + ")"):
            (this.closedUpper? "Roc(" + os + ")": "Roo(" + os + ")");
    }

    stringify(): string {
        return this.toString();
    }

    toJSON(): string {
        return this.toString();
    }

    toCdl(): any {
        return this;
    }

    // Returns true when this range contains v, false when it doesn't and
    // undefined when the range consists of anything else than simple values.
    containsSimpleValue(v: SimpleValue): boolean {
        var hasLower: boolean = false;
        var hasUpper: boolean = false;

        for (var i: number = 0; i < this.os.length; i++) {
            var elt_i: any = this.os[i];
            if (typeof(elt_i) in simpleTypes) {
                if ((elt_i === -Infinity && typeof(v) === "number") ||
                      elt_i < v || (elt_i === v && this.closedLower)) {
                    hasLower = true;
                }
                if ((elt_i === Infinity && typeof(v) === "number") ||
                      elt_i > v || (elt_i === v && this.closedUpper)) {
                    hasUpper = true;
                }
            } else {
                return undefined;
            }
        }
        return hasLower && hasUpper;
    }

    // Returns true when this range overlaps v, false when it doesn't and
    // undefined when either range consists of anything else than simple values.
    rangesOverlap(v: MoonRange): boolean {
        for (var i: number = 0; i < v.os.length; i++) {
            var overlap_i: boolean = typeof(v.os[i]) in simpleTypes?
                this.containsSimpleValue(v.os[i]): undefined;
            if (overlap_i === undefined) {
                return undefined;
            } else if (overlap_i === true) {
                return true;
            }
        }
        return false;
    }

    // marshalling a range is the same as marshalling an o/s (the base-class)

    // unmarshalValue - create the unmarshalled array and construct
    // a range object with it.
    // returns a RangeValue, which is the runtime variant of the MoonRange.
    static unmarshalValue(obj: any, xdr: XDR): any {
        return RangeValue.unmarshalRange(obj, xdr);
    }
}

// Constructs a MoonRange in the cdl
function r(...args: any[]): MoonRange {
    return new MoonRange(args, true, true);
}

function Rcc(...args: any[]): MoonRange {
    return new MoonRange(args, true, true);
}

function Rco(...args: any[]): MoonRange {
    return new MoonRange(args, true, false);
}

function Roc(...args: any[]): MoonRange {
    return new MoonRange(args, false, true);
}

function Roo(...args: any[]): MoonRange {
    return new MoonRange(args, false, false);
}

// A range with actual values
class RangeValue extends NonAV {
    min: any;
    max: any;
    closedLower: boolean;
    closedUpper: boolean;

    // The current code immediately evaluates min and max, so they're computed
    // in the constructor instead of delayed
    constructor(values: any[], closedLower: boolean, closedUpper: boolean) {
        var min: any = values[0] instanceof Array? values[0][0]: values[0];
        var max: any = min;

        super();
        this.closedLower = closedLower;
        this.closedUpper = closedUpper;
        for (var i: number = 1; i < values.length; i++) {
            if (values[i] instanceof Array) {
                var vi: any[] = values[i];
                for (var j: number = 0; j < vi.length; j++) {
                    if (min > vi[j]) {
                        min = vi[j];
                    }
                    if (max < vi[j]) {
                        max = vi[j];
                    }
                }
            } else {
                if (min > values[i]) {
                    min = values[i];
                }
                if (max < values[i]) {
                    max = values[i];
                }
            }
        }
        this.min = min;
        this.max = max;
    }

    copy(): RangeValue {
        var rv: RangeValue = new RangeValue([], this.closedLower, this.closedUpper);

        rv.min = this.min;
        rv.max = this.max;
        return rv;
    }

    isEqual(v: any): boolean {
        if (v instanceof RangeValue) {
            return this.min === v.min && this.max === v.max;
        }
        return false;
    }

    match(v: any): boolean {
        if (v instanceof RangeValue) {
            var min: any = this.min < v.min? v.min: this.min;
            var max: any = this.max < v.max? this.max: v.max;
            return min < max || (min === max && this.match(min) && v.match(min));
        } else {
            return this.closedLower && this.closedUpper?
                       this.min <= v && v <= this.max:
                   this.closedLower && !this.closedUpper?
                       this.min <= v && v < this.max:
                   !this.closedLower && this.closedUpper?
                       this.min < v && v <= this.max:
                       this.min < v && v < this.max;
        }
    }

    isLessThanOrEqualTo(v: any): boolean {
        if (v instanceof RangeValue) {
            return (this.closedLower && this.min <= v.min) ||
                   (v.min > this.min);
        } else {
            return v > this.min;
        }
        
    }

    isGreaterThanOrEqualTo(v: any): boolean {
        if (v instanceof RangeValue) {
            return (this.closedUpper && this.max >= v.max) ||
                   (v.max < this.max);
        } else {
            return v < this.max;
        }
        
    }

    lower(v: any): any {
        return this.isLessThanOrEqualTo(v)? this: v;
    }

    upper(v: any): any {
        return this.isGreaterThanOrEqualTo(v)? this: v;
    }

    intMin(): number {
        return this.closedLower? this.min: this.min + 1;
    }

    intMax(): number {
        return this.closedUpper? this.max: this.max - 1;
    }

    intConnectsWith(v: any): boolean {
        var inf1: number = this.closedLower? this.min - 1: this.min;
        var sup1: number = this.closedUpper? this.max + 1: this.max;

        if (v instanceof RangeValue) {
            var vinf: number = v.closedLower? v.min: v.min + 1;
            var vsup: number = v.closedUpper? v.max: v.max - 1;
            return vinf === sup1 || vsup === inf1;
        } else {
            return v === inf1 || v === sup1;
        }
    }

    // Extends this to contain v
    merge(v: any): RangeValue {
        if (v instanceof RangeValue) {
            return new RangeValue([this.min, this.max, v.min, v.max],
                                  this.min < v.min? this.closedLower:
                                  v.min < this.min? v.closedLower:
                                  this.closedLower || v.closedLower,
                                  this.max > v.max? this.closedUpper:
                                  v.max > this.max? v.closedUpper:
                                  this.closedUpper || v.closedUpper);
        } else {
            if ((this.closedLower && v < this.min) ||
                  (!this.closedLower && v <= this.min)) {
                return new RangeValue([v, this.max], true, this.closedUpper);
            } else if ((this.closedUpper && v > this.max) ||
                       (!this.closedUpper && v >= this.max)) {
                return new RangeValue([this.min, v], this.closedLower, true);
            }
        }
        return this;
    }

    typeName(): string {
        return "range";
    }

    stringify(): string {
        return "r(" + safeJSONStringify(this.min) + "," +
            safeJSONStringify(this.max) + ")";
    }

    toJSON(): string {
        return "R" + (this.closedLower? "c": "o") + (this.closedUpper? "c": "o") +
            "(" + safeJSONStringify(this.min) + "," + safeJSONStringify(this.max) + ")";
    }

    toCdl(): any {
        return new MoonRange([this.min, this.max], this.closedLower, this.closedUpper);
    }

    // create a json representation of this range
    marshalValue(xdr: XDR): any {
        var marshalledOS: any[] = [];
        marshalledOS.push(xdr.xdrCdlObj(this.min));
        marshalledOS.push(xdr.xdrCdlObj(this.max));
        var marshalledClosedLower: any = xdr.xdrCdlObj(this.closedLower);
        var marshalledClosedUpper: any = xdr.xdrCdlObj(this.closedUpper);

        return {
            type: this.typeName(),
            os: marshalledOS,
            closedLower: marshalledClosedLower,
            closedUpper: marshalledClosedUpper
        };
    }

    static unmarshalValue(obj: any, xdr: XDR): any {
        return RangeValue.unmarshalValue(obj, xdr);
    }

    static unmarshalRange(obj: any, xdr: XDR): any {
        var marshalledOS = obj.os;
        var marshalledClosedLower = obj.closedLower;
        var marshalledClosedUpper = obj.closedUpper;
        if (typeof(marshalledOS) === "undefined") {
            return [];
        }
        var os: any[] = [];
        for (var i = 0; i < marshalledOS.length; i++) {
            os[i] = xdr.xdrCdlObj(marshalledOS[i]);
        }
        return new RangeValue(os, marshalledClosedLower, marshalledClosedUpper);
    }

}

function _r(low: number, high: number): RangeValue {
    return new RangeValue([low, high], low !== -Infinity, high !== Infinity);
}

class Negation extends NonAV {
    queries: any[];

    constructor(queries: any[]) {
        super();
        this.queries = queries;
    }

    copy(): Negation {
        return new Negation(deepCopy(this.queries));
    }

    match(v: any): boolean {
        throw "not implemented";
    }

    isEqual(v: any): boolean {
        if (v instanceof Negation) {
            if (this.queries.length !== v.queries.length) {
                return false;
            }
            for (var i: number = 0; i < this.queries.length; i++) {
                if (!objectEqual(this.queries[i], v.queries[i])) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    toJSON(): string {
        return "n(" + this.queries.map(cstringify).join(", ") + ")";
    }

    typeName(): string {
        assert(false, "it doesn't make sense to see negation as a constant");
        return "negation";
    }

    toCdl(): any {
        return new Negation(this.queries.map(runtimeValueToCdlExpression));
    }

    stringify(): string {
        return "n(" + this.queries.map(cstringify).join(", ") + ")";
    }

    // create a json representation of this object
    // a negation is defined by its 'queries' array
    marshalValue(xdr: XDR): { type: string; queries: any; } {
        return {
            type: this.typeName(),
            queries: xdr.xdrCdlObj(this.queries)
        };
    }

    // create a new Negation instance based on the json 'obj'
    static unmarshalValue(obj: any, xdr: XDR): any {
        var queries: any[] = xdr.xdrCdlObj(obj.queries);

        return new Negation(queries);
    }
}

function n(...args: any[]): Negation {
    return new Negation(args);
}

// Substring query in cdl
class MoonSubstringQuery extends MoonOrderedSetBase {
    copy(): MoonSubstringQuery {
        return new MoonSubstringQuery(this.os);
    }

    makeNew(elts: any[]): MoonSubstringQuery {
        return new MoonSubstringQuery(elts);
    }
    
    toString(): string {
        return "s(" + this.os.map(function(e) { return e.toString(); }) + ")";
    }

    stringify(): string {
        return "s(" + this.os.map(cstringify).join(", ") + ")";
    }

    toJSON(): string {
        return "s(" + this.os.map(cstringify).join(", ") + ")";
    }

    toCdl(): any {
        return this;
    }

    typeName(): string {
        return "substringQuery";
    }

    match(v: any): boolean {
        throw "not implemented";
    }
}

// Substring query in runtime
class SubStringQuery extends NonAV {
    strings: any[];
    regexps: RegExp[];

    static testWordCharStart: RegExp = /^\w/;

    // The current code immediately evaluates min and max, so they're computed
    // in the constructor instead of delayed
    constructor(strings: any[]) {
        super();
        if (strings.some(a => a === "" || (a instanceof Array && a.length === 0))) {
            // One of the arguments matches every string, so turn it into s()
            this.strings = constEmptyOS;
            this.regexps = constEmptyOS;
            return;
        }
        this.strings = strings;
        this.regexps = strings.map(function(s: any): RegExp {
            if (s instanceof RegExp) {
                return s;
            }
            var escapedString: string = typeof(s) === "string"?
                s.replace(/[[\]\\()*+?.|^${}]/g, "\\$&"): safeJSONStringify(s);
            if (SubStringQuery.testWordCharStart.test(escapedString)) {
                return new RegExp("\\b" + escapedString, "i");
            } else {
                return new RegExp(escapedString, "i");
            }
        });
    }

    copy(): SubStringQuery {
        return new SubStringQuery(this.strings);
    }

    isEqual(v: any): boolean {
        if (v instanceof SubStringQuery) {
            var s1: string[] = this.strings;
            var s2: string[] = v.strings;
            return s1.every(e => s2.indexOf(e) !== -1) &&
                   s2.every(e => s1.indexOf(e) !== -1);
        }
        return false;
    }

    match(v: any): boolean {
        if (typeof(v) === "number") {
            v = String(v);
        }
        if (typeof(v) === "string") {
            if (this.regexps.length === 0) {
                return true;
            }
            for (var i: number = 0; i < this.regexps.length; i++) {
                if (this.regexps[i].test(v)) {
                    return true;
                }
            }
        }
        return false;   
    }

    // Assuming this.match(v) is true
    matchValue(v: any): any {
        assert(false, "TODO");
        return false;
    }

    typeName(): string {
        return "subStringQuery";
    }

    stringify(): string {
        return "s(" + this.strings.map(safeJSONStringify).join(", ") + ")";
    }

    toJSON(): string {
        return "s(" + this.strings.map(cstringify).join(", ") + ")";
    }

    toCdl(): any {
        return new MoonSubstringQuery(this.strings);
    }

    marshalValue(xdr: XDR): { type: string; strings: any; } {
        return {
            type: this.typeName(),
            strings: xdr.xdrCdlObj(this.strings)
        };
    }

    // create a new Negation instance based on the json 'obj'
    static unmarshalValue(obj: any, xdr: XDR): any {
        var strings: any[] = xdr.xdrCdlObj(obj.strings);

        return new SubStringQuery(strings);
    }
}

function s(...args: any[]): MoonSubstringQuery {
    return new MoonSubstringQuery(args);
}

class MoonComparisonFunction extends MoonOrderedSetBase {
    
    copy(): MoonComparisonFunction {
        return new MoonComparisonFunction(this.os);
    }

    makeNew(elts: any[]): MoonComparisonFunction {
        return new MoonComparisonFunction(elts);
    }
   
    toString(): string {
        return "c(" + this.os.map(flatcdlify).join(",") + ")";
    }

    stringify(): string {
        return "c(" + this.os.map(cstringify).join(", ") + ")";
    }

    toCdl(): any {
        return this;
    }

    toJSON(): string {
        return "c(" + this.os.map(cstringify).join(", ") + ")";
    }

    match(v: any): boolean {
        throw "not implemented";
    }

    isEqual(v: any): boolean {
        if (v instanceof MoonComparisonFunction) {
            if (this.os.length !== v.os.length) {
                return false;
            }
            for (var i: number = 0; i < this.os.length; i++) {
                if (!objectEqual(this.os[i], v.os[i])) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    typeName(): string {
        return "comparisonFunction";
    }
}

// Constructs an elements in the cdl
function c(...args: any[]): MoonComparisonFunction {
    return new MoonComparisonFunction(args);
}

// A comparison function consisting of a sequence of queries, or one query and
// the string "ascending" or "descending".
class ComparisonFunctionValue extends NonAV {
    elements: any[];

    constructor(elements: any[]) {
        super();
        this.elements = elements
    }

    copy(): ComparisonFunctionValue {
        return new ComparisonFunctionValue(this.elements);
    }

    isEqual(v: any): boolean {
        if (v instanceof ComparisonFunctionValue) {
            return objectEqual(this.elements, v.elements);
        }
        return false;
    }

    match(v: any): boolean {
        if (v instanceof ComparisonFunctionValue) {
            if (v.elements.length >= this.elements.length) {
                for (var i: number = 0; i < this.elements.length; i++) {
                    if (!interpretedBoolMatch(this.elements[i], v.elements[i])) {
                        return false;
                    }
                }
                return true;
            }
        }
        return false;
    }

    typeName(): string {
        return "comparisonFunction";
    }

    stringify(): string {
        return "c(" + this.elements.map(safeJSONStringify).join(", ") + ")";
    }

    toCdl(): any {
        return this;
    }

    toJSON(): string {
        return "c(" + this.elements.map(safeJSONStringify).join(", ") + ")";
    }

    // The default is ascending.
    // c() and c(ascending/descending) are considered erroneous.
    inAscendingOrder(): boolean {
        var n: number = this.elements.length;

        if (n === 0) {
            Utilities.warn("empty comparison function");
            return true;
        }
        return getDeOSedValue(this.elements[n - 1]) !== descending;
    }

    orderByValue(): boolean {
        var n: number = this.elements.length;

        return n === 1 ||
               (n === 2 && (getDeOSedValue(this.elements[1]) === ascending ||
                            getDeOSedValue(this.elements[1]) === descending));
    }

    // create a json representation of this range
    marshalValue(xdr: XDR): any {
        return {
            type: this.typeName(),
            os: this.elements.map(xdr.xdrCdlObj)
        };
    }

    static unmarshalValue(obj: any, xdr: XDR): any {
        var marshalledOS: any[] = obj.os;

        return new ComparisonFunctionValue(marshalledOS === undefined? []:
                                           marshalledOS.map(xdr.xdrCdlObj));
    }
}

// Serves as a wrapper around argument index in a query object. E.g. {a: 1, b:
// [{...}, [me]]} is represented as {a: 1, b: new RuntimeArgument(0)} in the
// debugger, in order to avoid that it looks like a selection query or some
// arbitrary object.
class RuntimeArgument extends NonAV {
    index: number;

    constructor(index: number) {
        super();
        this.index = index;
    }

    copy(): RuntimeArgument {
        return this;
    }

    typeName(): string {
        throw "do not call"; // see marshalValue
    }

    stringify(): string {
        return "new RuntimeArgument(" + String(this.index) + ")";
    }

    toCdl(): any {
        return this;
    }

    toJSON(): string {
        return "$" + String(this.index);
    }

    match(v: any): boolean {
        throw "not implemented";
    }

    isEqual(v: any): boolean {
        return v instanceof RuntimeArgument && v.index === this.index;
    }

    marshalValue(xdr: XDR): any {
        throw "cannot be called"; // RuntimeArgument cannot be part of app-state
    }
}

class NativeObjectWrapper extends NonAV {
    file: File;
    foreignInterfaceConstructor: any;

    // Note that the path to the file is unknown, so we stay on the safe side
    // and declare files differently if they are not exactly the same object.
    // This may trigger unnecessary computation, but that's unlikely to happen
    // (it requires dropping the same file twice and a bug in the browser).
    isEqual(v: any): boolean {
        if (v instanceof NativeObjectWrapper) {
            return this.file === v.file &&
                   this.foreignInterfaceConstructor === v.foreignInterfaceConstructor;
        }
        return false;
    }

    match(v: any): boolean {
        if (v instanceof NativeObjectWrapper) {
            if (v.file !== undefined && this.file !== undefined) {
                return this.file.name === v.file.name &&
                       this.file.size === v.file.size &&
                       (<any>this.file).lastModified === (<any>v.file).lastModified;
            }
            if (v.foreignInterfaceConstructor !== undefined && this.foreignInterfaceConstructor !== undefined) {
                return this.foreignInterfaceConstructor === v.foreignInterfaceConstructor;
            }
        }
        return false;
    }

    copy(): NonAV {
        var now: NativeObjectWrapper = new NativeObjectWrapper();

        if ("file" in this) {
            now.file = this.file;
        }
        if ("foreignInterfaceConstructor" in this) {
            now.foreignInterfaceConstructor = this.foreignInterfaceConstructor;
        }
        return now;
    }

    typeName(): string {
        return "NativeObjectWrapper";
    }

    stringify(): string {
        return "file" in this && this.file !== undefined?
                 "File(" + this.file.name + ")":
               "foreignInterfaceConstructor" in this?
                 "foreignInterfaceConstructor":
                 "unknown";
    }

    toCdl(): any {
        return this;
    }

    toJSON(): string {
        return "file" in this && this.file !== undefined?
                 JSON.stringify(this.file.name):
               "foreignInterfaceConstructor" in this?
                 '"foreignInterfaceConstructor"':
               '"unknown"';
    }

    toString(): string {
        return "file" in this && this.file !== undefined? this.file.name: "";
    }

    marshalValue(xdr: XDR): any {
        return { type: "undefined" };
    }

    static unmarshalValue(obj: any, xdr: XDR): any {
        return undefined;
    }

    createForeignInterface(): ForeignInterface|undefined {
        return "foreignInterfaceConstructor" in this?
               new this.foreignInterfaceConstructor(): undefined;
    }
}

class ForeignJavaScriptFunction extends BuiltInFunction {
    constructor(name: string, public f: (... args: any[]) => any, returnType: ValueType = numOrStrOrBoolValueType) {
        super(name, 0, Infinity, returnType, false, false, false);
        this.factory = EFForeignJavaScriptFunction.make;
    }

    isEqual(v: any): boolean {
        return v instanceof ForeignJavaScriptFunction && v.name === this.name;
    }

    copy(): ForeignJavaScriptFunction {
        return new ForeignJavaScriptFunction(this.name, this.f);
    }

    typeName(): string {
        return "JavaScriptFunction";
    }

    match(v: any): boolean {
        return v instanceof ForeignJavaScriptFunction && v.name === this.name;
    }

    marshalValue(xdr: XDR) {
        throw new Error("Method not implemented.");
    }
}

class ForeignJavaScriptObjectFunction extends ForeignJavaScriptFunction {
    constructor(name: string, public f: (... args: any[]) => any, returnType: ValueType = numOrStrOrBoolValueType) {
        super(name, f, returnType);
        this.factory = EFForeignJavaScriptObjectFunction.make;
    }

    isEqual(v: any): boolean {
        return v instanceof ForeignJavaScriptObjectFunction && v.name === this.name;
    }

    copy(): ForeignJavaScriptObjectFunction {
        return new ForeignJavaScriptObjectFunction(this.name, this.f);
    }

    typeName(): string {
        return "JavaScriptObjectFunction";
    }

    match(v: any): boolean {
        return v instanceof ForeignJavaScriptObjectFunction && v.name === this.name;
    }
}

var jsIdentifierRegExp: RegExp = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

//
// classDefinitions in indexed first by class-name, then by confLib-name.
// For example, if there are three confLibs: the application (''),
//   'FacetedSearch' and 'Core', and all define class 'Cell', then
// classDefinitions['Cell]'] == {
//     '': <app def of Cell>,
//     'FacetedSearch': <FacetedSearch def of Cell>,
//     'Core': <Core def of Cell>
// }
//
var classDefinitions:{[className: string]: {[confLibName: string]: any}} = {};

var simpleTypes: { [type: string]: boolean } = {"string": true, "number": true, "boolean": true};

function isSimpleType(v: any): boolean {
    var t = typeof(v);

    return t === "number" || t === "string" || t === "boolean" || t === "undefined";
}

function isSimpleValue(v: any): boolean {
    return v instanceof Array?
           v.length === 0 || (v.length === 1 && isSimpleType(v[0])):
           isSimpleType(v);
}

function isEmptyOS(v: any): boolean {
    return v === undefined || (v instanceof Array && v.length === 0);
}

// Returns true when a runtime value is false
function isFalse(v: any): boolean {
    return v === undefined || v === false ||
           (v instanceof Array && isFalseValue(v));
}

// Returns true when a runtime value is true
function isTrue(v: any): boolean {
    return v !== undefined && v !== false &&
           !(v instanceof Array && isFalseValue(v));
}

// Returns true when a normalized runtime value is false
function isFalseValue(v: any[]): boolean {
    if (v !== undefined) {
        for (var i: number = 0; i < v.length; i++) {
            if (v[i] !== undefined && v[i] !== false) {
                return false;
            }
        }
    }
    return true;
}

// Returns true when a normalized runtime value is true
function isTrueValue(v: any[]): boolean {
    if (v !== undefined) {
        for (var i: number = 0; i < v.length; i++) {
            if (v[i] !== undefined && v[i] !== false) {
                return true;
            }
        }
    }
    return false;
}

// Returns true when a cdl value is guaranteed to evalaute to false, i.e. o(),
// false, or any combination
function isCDLFalse(v: any): boolean {
    return v === undefined || v === false ||
           (v instanceof MoonOrderedSet &&
            v.os.every(function(e: any): boolean { return isCDLFalse(e); }));
}

// Returns true when a cdl value is guaranteed to evaluate to true
function isCDLTrue(v: any): boolean {
    if (isSimpleType(v)) {
        return v !== undefined && v !== false;
    } else if (v instanceof Array) {
        return false; // function applications are unknown
    } else if (v instanceof MoonOrderedSet) {
        return v.os.some(function(e: any): boolean { return isCDLTrue(e); });
    } else {
        // Projector, ranges, substring queries etc. are all true
        return true;
    }
}

// Turns a bool into a [true]/[] normalized value
function boolValue(b: boolean): any[] {
    return b? constTrueOS: constFalseOS;
}

function toSimpleValue(v: any): any {
    if (v instanceof Array) {
        return v.length === 0? false: v.length === 1? v[0]: v;
    }
    return v;
}

// Create a shallow copy of the value
function shallowCopy(val: any): any {
    if (val instanceof Array) {
        return val.slice(0);
    } else if (val instanceof NonAV) {
        return val.copy();
    } else if (typeof(val) === "object") {
        var obj: any = {};
        for (var attr in val)
            obj[attr] = val[attr];
        return obj;
    }
    return val;
}

var dbglvl: number = 0;
function deepCopy(obj: any): any {
    if (dbglvl > 15) debugger;
    if (obj instanceof NonAV) {
        return obj.copy();
    }
    if (obj instanceof Array) {
        dbglvl++;
        var r = obj.map(deepCopy);
        dbglvl--;
        return r;
    }
    if (obj instanceof Object) {
        dbglvl++
        var cl: any = {};
        for (var attr in obj) {
            cl[attr] = deepCopy(obj[attr]);
        }
        dbglvl--;
        return cl;
    }
    return obj;
}

// True when run-time value is a real attribute value, and not a "closed" object
function isAV(v: any): boolean {
    return v instanceof Object && !(v instanceof NonAV);
}

// True when v is a (possibly) normalized av with attribute attr
function hasAttribute(v: any, attr: string): boolean {
    return v instanceof Array? v.some(elt => hasAttribute(elt, attr)):
           v instanceof Object && !(v instanceof NonAV) && !isEmptyOS(v[attr]);
}

function stripArray(v: any, deep: boolean = false): any {
    var v0 = v instanceof Array && v.length === 1? v[0]: v;
    var repl: any = undefined;
    var subst: boolean = false;

    if (v0 instanceof Array) {
        if (deep) {
            for (var i: number = 0; i < v0.length; i++) {
                var repl_i: any = stripArray(v0[i], true); 
                if (repl_i !== v0[i]) {
                    subst = true;
                    if (repl === undefined) {
                        repl = v0.slice(0, i);
                    }
                }
                if (subst) {
                    repl[i] = repl_i;
                }
            }
            return subst? repl: v0;
        }
        return v0;
    }
    if (!isAV(v0)) {
        return v0;
    }
    repl = undefined;
    for (var attr in v0) {
        var repl_attr: any = stripArray(v0[attr], deep); 
        if (repl_attr !== v0[attr]) {
            subst = true;
            if (repl === undefined) {
                repl = shallowCopy(v0);
            }
        }
        if (subst) {
            repl[attr] = repl_attr;
        }
    }
    return subst? repl: v0;
}

// Replaces any os with
function suppressSet(v: any): any {
    var v0 = v instanceof Array? v[0]: v; // Note: [] => undefined

    if (!isAV(v0)) {
        return v0;
    }
    var repl: any = undefined;
    for (var attr in v0) {
        var v0_attr: any = v0[attr];
        var repl_attr: any = suppressSet(v0_attr);
        if (repl_attr !== v0_attr && repl === undefined) {
            repl = shallowCopy(v0);
        }
        if (repl_attr !== undefined && repl !== undefined) {
            repl[attr] = repl_attr;
        }
    }
    return repl !== undefined? repl: v0;
}

// Checks if q matches v. Returns true or false.
function interpretedBoolMatch(q: any, v: any): boolean {
    var i: number;

    if (v instanceof Array) {
        for (i = 0; i < v.length; i++) {
            if (interpretedBoolMatch(q, v[i])) {
                return true;
            }
        }
        return false;
    } else {
        switch (typeof(q)) {
          case "object":
            if (q instanceof Array) { // === o(...)
                for (i = 0; i !== q.length; i++) {
                    if (interpretedBoolMatch(q[i], v)) {
                        return true;
                    }
                }
                return false;
            }
            if (q === _) {
                return !isFalse(v);
            }
            if (q instanceof NonAV) {
                if (q instanceof Negation) {
                    for (i = 0; i !== q.queries.length; i++) {
                        if (interpretedBoolMatch(q.queries[i], v)) {
                            return false;
                        }
                    }
                    return true;
                } else {
                    return q.match(v);
                }
            }
            if (!(v instanceof Object)) {
                return false;
            }
            for (var attr in q) {
                if (!(attr in v) || !interpretedBoolMatch(q[attr], v[attr])) {
                    return false;
                }
            }
            return true;
          case "string":
          case "number":
            return q === v || (v instanceof RangeValue && v.match(q));
          case "boolean":
            return q? isTrue(v): isFalse(v);
          default:
            return false;
        }
    }
}

// Can't mix selections and projections in an os.
function interpretedQuery(q: any, v: any): any {

    // Returns object that describes match
    // - sel: result is selection
    // - res: the resulting values
    // - or undefined when there is no match
    // So lmatch({x: 1}, [{x:1},{x:2},{y:1}]) returns { sel: true,
    // res: [{x:1}]}, and lmatch({x: _}, [{x:1},{x:2},{y:1}]) returns
    // {sel: false, res: [1, 2]}.
    function lmatch(q: any, v: any): { sel: boolean; res: any; } {
        var arres: any[];
        var isSel: boolean;
        var m: {sel:boolean;res:any;}, m1: {sel:boolean;res:any;}, i: number;

        if (q === _) {
            return { sel: false, res: v };
        }
        if (v instanceof Array) {
            arres = [];
            for (i = 0; i !== v.length; i++) {
                m1 = lmatch(q, v[i]);
                if (m1 !== undefined) {
                    arres = arres.concat(m1.res);
                    isSel = m1.sel; // Only last one...
                }
            }
            return isSel !== undefined? {sel: isSel, res: arres}: undefined;
        }
        switch (typeof(q)) {
          case "object":
            if (q instanceof Array) { // === o(...), assume no projections inside
                if (q.length === 0) {
                    return undefined;
                }
                if (q.length === 1 && q[0] === _) {
                    return { sel: false, res: v };
                }
                arres = [];
                for (i = 0; i !== q.length; i++) {
                    m = lmatch(q[i], v);
                    if (m !== undefined) {
                        if (m.sel) {
                            return {sel: true, res: v};
                        }
                        arres = arres.concat(m.res);
                    }
                }
                return arres.length !== 0? {sel: false, res: arres}: undefined;
            }
            if (q instanceof NonAV) {
                if (q instanceof Negation) {
                    var complement: any = interpretedQuery(q.queries, v);
                    if (v instanceof Array) {
                        if (complement.length === v.length) {
                            return {sel: false, res: []};
                        }
                        var i: number = 0, j: number = 0;
                        var neg: any[] = [];
                        while (i < complement.length && j < v.length) {
                            if (complement[i] === v[j]) {
                                i++;
                            } else {
                                neg.push(v[j]);
                            }
                            j++;
                        }
                        while (j < v.length) {
                            neg.push(v[j]);
                            j++;
                        }
                        return {sel: true, res: neg}
                    } else {
                        return isEmptyOS(complement)? 
                               {sel: true, res: v}: undefined;
                    }
                }
                return q.match(v)? {sel: true, res: v}: undefined;
            }
            if (!(v instanceof Object)) {
                return undefined;
            }
            var res = {sel: true, res: v};
            var nrMatchingAttributes: number = 0;
            var prevMatchingAttribute: string;
            for (var attr in q) {
                if (!(attr in v)) {
                    return undefined;
                }
                if (q[attr] !== undefined) {
                    // undefined attribute values should be treated as non-existent
                    m = lmatch(q[attr], v[attr]);
                    if (m === undefined) {
                        return undefined;
                    }
                    if (!m.sel) {
                        nrMatchingAttributes++;
                        if (nrMatchingAttributes === 1) {
                            res.sel = false;
                            res.res = m.res;
                            prevMatchingAttribute = attr;
                        } else if (nrMatchingAttributes === 2) {
                            var obj: any = {};
                            obj[prevMatchingAttribute] = res.res;
                            obj[attr] = m.res;
                            res.res = obj;
                        } else {
                            res.res[attr] = m;
                        }
                    }
                }
            }
            return res;
          case "string":
          case "number":
            return q === v || (v instanceof RangeValue && v.match(q))? {sel: true, res: v}: undefined;
          case "boolean":
            return (q? isTrue(v): isFalse(v))? {sel: true, res: v}: undefined;
          default:
            return undefined;
        }
    }

    var m: { sel: boolean; res: any; };
    if (v instanceof Array) {
        var res: any[] = [];
        for (var i: number = 0; i !== v.length; i++) {
            m = lmatch(q, v[i]);
            if (m !== undefined) {
                res = res.concat(m.res);
            }
        }
        return res;
    } else {
        m = lmatch(q, v);
        return m === undefined? undefined: m.res;
    }
}

function interpretedQueryWithIdentifiers(q: any, v: any, allIds: any[], selectedIds: any[]): any {
    var res: any[] = [];

    if (!(v instanceof Array)) {
        v = [v];
    }
    for (var i: number = 0; i !== v.length; i++) {
        var m: any = interpretedQuery(q, v[i]);
        if (m !== undefined) {
            res.push(m);
            selectedIds.push(allIds[i]);
        }
    }
    return res;
}

// Checks if q matches v. Returns true or false. Note that false matches o().
function interpretedQualifierMatch(q: any, v: any): boolean {
    var i: number;

    if (v instanceof Array) {
        // The following three lines make [false, o()] return a true selection,
        // being o().
        if (v.length === 0 && q === false) {
            return true;
        }
        for (i = 0; i < v.length; i++) {
            if (interpretedBoolMatch(q, v[i])) {
                return true;
            }
        }
        return false;
    } else {
        switch (typeof(q)) {
          case "object":
            if (q instanceof Array) { // === o(...)
                for (i = 0; i !== q.length; i++) {
                    if (interpretedBoolMatch(q[i], v)) {
                        return true;
                    }
                }
                return false;
            }
            if (q === _) {
                return !isFalse(v);
            }
            if (q instanceof NonAV) {
                if (q instanceof Negation) {
                    for (i = 0; i !== q.queries.length; i++) {
                        if (interpretedBoolMatch(q.queries[i], v)) {
                            return false;
                        }
                    }
                    return true;
                } else {
                    return q.match(v);
                }
            }
            if (!(v instanceof Object)) {
                return false;
            }
            for (var attr in q) {
                if (!(attr in v) || !interpretedBoolMatch(q[attr], v[attr])) {
                    return false;
                }
            }
            return true;
          case "string":
          case "number":
            return q === v || (v instanceof RangeValue && v.match(q));
          case "boolean":
            return q? isTrue(v): isFalse(v);
          default:
            return false;
        }
    }
}

function nrProjSitesInQuery(query: any): number {
    if (query === _) {
        return 1;
    }
    if (query instanceof Array) {
        if (query.length === 1) {
            return nrProjSitesInQuery(query[0]);
        }
        return 0; // assume that an os in a query is a selection
    }
    if (!(query instanceof Object) || query instanceof NonAV) {
        return 0;
    }
    var nr: number = 0;
    for (var attr in query) {
        nr += nrProjSitesInQuery(query[attr]);
    }
    return nr;
}

function queryIsSelection(query: any): boolean {
    if (query === _) {
        return false;
    }
    if (query instanceof Array) {
        if (query.length === 1) {
            return queryIsSelection(query[0]);
        }
        return true; // assume that an os in a query is a selection
    }
    if (!(query instanceof Object) || query instanceof NonAV) {
        return true;
    }
    for (var attr in query) {
        if (queryIsSelection(query[attr])) {
            return true;
        }
    }
    return false;
}

function extractProjectionPaths(query: any): string[][] {
    var paths: string[][] = [];

    if (query === _) {
        return [[]];
    }
    if (query instanceof Array) {
        if (query.length === 1) {
            return extractProjectionPaths(query[0]);
        }
        return undefined;
    }
    if (!(query instanceof Object) || query instanceof NonAV) {
        return undefined;
    }
    for (var attr in query) {
        var aPaths: string[][] = extractProjectionPaths(query[attr]);
        if (aPaths !== undefined) {
            paths = paths.concat(aPaths.map(function(p: string[]): string[] {
                return [attr].concat(p);
            }));
        }
    }
    return paths;
}

// Returns a string representation of v that is Javascript readable
function vstringify(v: any): string {
    if (v instanceof Projector) {
        return "_";
    } else if (v instanceof ChildInfo) {
        return v.toString();
    } else if (v instanceof BuiltInFunction || v instanceof ForeignJavaScriptFunction) {
        return v.name;
    } else if (v instanceof MoonRange) {
        return "r(" + v.os.map(vstringify).join(", ") + ")";
    } else if (v instanceof MoonSubstringQuery) {
        return "s(" + v.os.map(vstringify).join(", ") + ")";
    } else if (v instanceof MoonOrderedSet) {
        return "[" + v.os.map(vstringify).join(", ") + "]";
    } else if (v instanceof Negation) {
        return "n(" + v.queries.map(vstringify).join(", ") + ")";
    } else if (v instanceof RegExp) {
        return v.toString();
    } else if (v instanceof NonAV) {
        return v.stringify();
    } else if (v instanceof Array) {
        return "[" + v.map(vstringify).join(", ") + "]";
    } else if (v instanceof Object) {
        var str = "";
        for (var attr in v) {
            var attrStr = jsIdentifierRegExp.test(attr) && attr !== "class"?
                attr: JSON.stringify(attr);
            if (str.length !== 0) str += ", ";
            str += attrStr + ": " + vstringify(v[attr]);
        }
        return "{" + str + "}";
    } else {
        return safeJSONStringify(v);
    }
}

function vstringifyLim(v: any, maxNrChar: number): string {
    function vstringify2(v: any): string {
        if (v instanceof Array) {
            var str1: string = "";
            var str2: string = "";
            for (var i: number = 0; i < v.length / 2 && str1.length + str2.length < maxNrChar; i++) {
                str1 = i === 0? String(vstringify(v[i])): str1 + ", " + vstringify(v[i]);
                if (i !== v.length - i - 1) {
                    str2 = i === 0? String(vstringify(v[v.length - i - 1])):
                           vstringify(v[v.length - i - 1]) + ", " + str2;
                }
            }
            return v.length === 0? "[]":
                   v.length === 1? "[" + str1 + "]":
                   "[" + str1 + ", " + str2 + "]";
        } else{
            return vstringify(v);
        }
    }
    var str: string = vstringify2(v);

    return str === undefined? "undefined":
        str.length <= maxNrChar? str:
        str.slice(0, Math.ceil(maxNrChar / 2)) + ".." +
        str.slice(str.length - Math.floor(maxNrChar / 2));
}

class Unquote implements Compare<Unquote> {
    str: string;

    constructor(str: string) {
        this.str = str;
    }

    compare(u: Unquote): number {
        return this.str === u.str? 0: this.str < u.str? -1: 1;
    }
}

// Like vstringify, but can return a value that must be interpreted at runtime
function cstringify(v: any): string {
    if (v instanceof Projector) {
        return "_";
    } else if (v instanceof ChildInfo) {
        return v.toString();
    } else if (v instanceof BuiltInFunction || v instanceof ForeignJavaScriptFunction) {
        return v.name;
    } else if (v instanceof MoonOrderedSet) {
        return "[" + v.os.map(cstringify).join(", ") + "]";
    } else if (v instanceof RegExp) {
        return v.toString();
    } else if (v instanceof NonAV) {
        return v.toJSON();
    } else if (v instanceof Array) {
        return "[" + v.map(cstringify).join(", ") + "]";
    } else if (v instanceof Object) {
        var str = "";
        for (var attr in v) {
            var attrStr = jsIdentifierRegExp.test(attr) && attr !== "class"?
                attr: JSON.stringify(attr);
            if (str.length !== 0) str += ", ";
            str += attrStr + ": " + cstringify(v[attr]);
        }
        return "{" + str + "}";
    } else {
        return safeJSONStringify(v);
    }
}

function flatcdlify(v: any): string {
    return cdlify(v);
}



// Returns a string representation for v that can be pasted in a cdl file
function cdlify(v: any, indent: string = undefined): string {
    var type: string = typeof(v);

    if (type === "number" || type === "string" || type === "boolean") {
        return safeJSONStringify(v);
    } else if (v instanceof Projector) {
        return "_";
    } else if (v instanceof ChildInfo) {
        return v.toString();
    } else if (v instanceof BuiltInFunction || v instanceof ForeignJavaScriptFunction) {
        return v.name;
    } else if (v instanceof RegExp) {
        return v.toString();
    }

    var nextIndent: string = indent === undefined? undefined: indent + "  ";
    function innerCdlify(v: any): string {
        return cdlify(v, nextIndent);
    }

    if (v instanceof MoonRange) {
        return "r(" + v.os.map(innerCdlify).join(", ") + ")";
    } else if (v instanceof MoonOrderedSet) {
        return v.os.length === 1? cdlify(v.os[0]): 
               "o(" + v.os.map(innerCdlify).join(", ") + ")";
    } else if (v instanceof Negation) {
        return "n(" + v.queries.map(innerCdlify).join(", ") + ")";
    } else if (v instanceof NonAV) {
        return v.stringify();
    } else if (v instanceof Array) {
        return v.length === 1? cdlify(v[0], indent):
               "o(" + v.map(innerCdlify).join(", ") + ")";
    } else if (v instanceof Unquote) {
        return v.str;
    } else if (v instanceof Object) {
        var str = "";
        for (var attr in v) {
            var attrStr = jsIdentifierRegExp.test(attr) && attr !== "class"?
                attr: JSON.stringify(attr);
            if (str.length !== 0) {
                str += nextIndent === undefined? ", ": ",\n" + nextIndent;
            } else if (nextIndent !== undefined) {
                str += "\n" + nextIndent;
            }
            str += attrStr + ": " + cdlify(v[attr], nextIndent);
        }
        return indent === undefined? "{" + str + "}": "{" + str + "\n" + indent + "}";
    } else {
        return safeJSONStringify(v);
    }
}

function cdlifyLim(v: any, maxNrChar: number): string {
    if (v instanceof Projector || v instanceof ChildInfo ||
          v instanceof BuiltInFunction || v instanceof Negation ||
          v instanceof NonAV || v instanceof Unquote ||
          v instanceof ForeignJavaScriptFunction || !(v instanceof Object)) {
        var str: string = cdlify(v);
        return str === undefined? undefined:
               str.length <= maxNrChar? str:
               str.slice(0, Math.ceil(maxNrChar / 2)) + ".." +
                  str.slice(str.length - Math.floor(maxNrChar / 2));
    } else if (v instanceof Array) {
        var str1: string = "";
        var str2: string = "";
        for (var i: number = 0; i < v.length / 2 && str1.length + str2.length < maxNrChar; i++) {
            str1 = i === 0? cdlifyLim(v[i], maxNrChar / 2): str1 + ", " + cdlifyLim(v[i], maxNrChar / 2);
            if (i !== v.length - i - 1) {
                str2 = i === 0? cdlifyLim(v[v.length - i - 1], maxNrChar / 2):
                       cdlifyLim(v[v.length - i - 1], maxNrChar / 2) + ", " + str2;
            }
        }
        return v.length === 0? "[]":
            v.length === 1? str1:
            i < v.length / 2? "o(" + str1 + ", ..., " + str2 + ")":
            "o(" + str1 + ", " + str2 + ")";
    } else {
        var str1: string = "";
        var str2: string = "";
        var keys: string[] = Object.keys(v);
        for (var i: number = 0; i < keys.length / 2 && str1.length + str2.length < maxNrChar; i++) {
            var attr: string = keys[i];
            var attrStr = jsIdentifierRegExp.test(attr) && attr !== "class"?
                          attr: JSON.stringify(attr);
            if (i !== 0) str1 += ", ";
            str1 += attrStr + ": " + cdlifyLim(v[attr], maxNrChar / 2);
            if (i !== keys.length - i - 1) {
                attr = keys[keys.length - i - 1];
                attrStr = jsIdentifierRegExp.test(attr) && attr !== "class"?
                          attr: JSON.stringify(attr);
                if (i !== 0) str2 = ", " + str2;
                str2 = attrStr + ": " + cdlifyLim(v[attr], maxNrChar / 2) + str2;
            }
        }
        return keys.length === 0? "{}":
               keys.length === 1? "{" + str1 + "}":
               i < keys.length / 2? "{" + str1 + ", ..., " + str2 + "}":
               "{" + str1 + ", " + str2 + "}";
    }
}

// Numerical comparison on two runtime expressions
function cdlCompare(a: CdlExpression, b: CdlExpression): number {

    function cdlType(v: CdlExpression): number {
        if (v instanceof Projector) {
            return 0;
        } else if (v instanceof BuiltInFunction) {
            return 1;
        } else if (v instanceof Negation) {
            return 2;
        } else if (v instanceof RangeValue) {
            return 3;
        } else if (v instanceof SubStringQuery) {
            return 4;
        } else if (v instanceof ValueReference || v instanceof Unquote) {
            return 5;
        } else if (v instanceof Array) {
            return 6;
        } else if (v instanceof Object) {
            return 7;
        } else {
            return 8;
        }
    }

    function lexicalComparison(a: CdlExpression[], b: CdlExpression[]): number {
        if (a.length !== b.length) {
            return a.length - b.length;
        }
        for (var i: number = 0; i < a.length; i++) {
            var cmp: number = cdlCompare(a[i], b[i]);
            if (cmp !== 0) {
                return cmp;
            }
        }
        return 0;
    }

    function sortedLexicalComparison(a: CdlExpression[], b: CdlExpression[]): number {
        if (a.length !== b.length) {
            return a.length - b.length;
        }
        var sortedA: CdlExpression[] = a.slice(0).sort(cdlCompare);
        var sortedB: CdlExpression[] = b.slice(0).sort(cdlCompare);
        return lexicalComparison(sortedA, sortedB);
    }

    a = getDeOSedValue(a);
    b = getDeOSedValue(b);
    var typeA: number = cdlType(a);
    var typeB: number = cdlType(b);
    if (typeA !== typeB) {
        return typeA - typeB;
    }
    switch (typeA) {
      case 0:
        return 0;
      case 1:
        return a.name === b.name? 0: a.name < b.name? -1: 1;
      case 2:
        return sortedLexicalComparison(a.queries, b.queries);
      case 3:
        return lexicalComparison([a.closedLower, a.closedUpper, a.min, a.max],
                                 [b.closedLower, b.closedUpper, b.min, b.max]);
      case 4:
        return sortedLexicalComparison(a.strings, b.strings);
      case 5:
        return a.compare(b);
      case 6:
        return lexicalComparison(a, b);
      case 7:
        var aAttrs: string[] = Object.keys(a).sort();
        var bAttrs: string[] = Object.keys(b).sort();
        var cmp: number = lexicalComparison(aAttrs, bAttrs);
        if (cmp !== 0) {
            return cmp;
        }
        for (var i: number = 0; i < aAttrs.length; i++) {
            var attr: string = aAttrs[i];
            cmp = cdlCompare(a[attr], b[attr]);
            if (cmp !== 0) {
                return cmp;
            }
        }
        return 0;
      case 8:
        return a === b? 0: a < b? -1: 1;
    }
    return 0;
}

/// Like cdlify, but normalizes all unordered multiple values, so
/// {a:1,b:1} and {b:1,a:1} or r(1,2) and r(2,1) come out identically.
function cdlifyNormalized(v: any): string {
    if (v instanceof Projector) {
        return "_";
    } else if (v instanceof ChildInfo) {
        return v.toString();
    } else if (v instanceof BuiltInFunction || v instanceof ForeignJavaScriptFunction) {
        return v.name;
    } else if (v instanceof MoonRange) {
        var sortedOs: any[] = v.os.slice(0).sort(cdlCompare);
        return "r(" + sortedOs.map(flatcdlify).join(", ") + ")";
    } else if (v instanceof MoonOrderedSet) {
        return v.os.length === 1? cdlify(v.os[0]): 
               "o(" + v.os.map(flatcdlify).join(", ") + ")";
    } else if (v instanceof Negation) {
        var sortedQueries: any[] = v.queries.slice(0).sort(cdlCompare);
        return "n(" + sortedQueries.map(flatcdlify).join(", ") + ")";
    } else if (v instanceof NonAV) {
        return v.stringify();
    } else if (v instanceof Array) {
        return v.length === 1? cdlify(v[0]):
               "o(" + v.map(flatcdlify).join(", ") + ")";
    } else if (v instanceof Unquote) {
        return v.str;
    } else if (v instanceof Object) {
        var sortedKeys: string[] = Object.keys(v).sort();
        var str: string = "";
        for (var i: number = 0; i < sortedKeys.length; i++) {
            var attr: string = sortedKeys[i];
            var attrStr = jsIdentifierRegExp.test(attr) && attr !== "class"?
                          attr: JSON.stringify(attr);
            if (str.length !== 0) str += ", ";
            str += attrStr + ": " + cdlify(v[attr]);
        }
        return "{" + str + "}";
    } else {
        return safeJSONStringify(v);
    }
}

// Unmergeable values are: strings, numbers, booleans, arrays of length > 1,
// references ranges, and arrays of length 1 with an unmergeable value. The ugly
// logic comes from the fact that an array is instanceof Object.
function isUnmergeable(v: any): boolean {
    return v !== undefined &&
        (!(v instanceof Object) || (!(v instanceof Array) && !isAV(v)) ||
         (v instanceof Array && (v.length > 1 || isUnmergeable(v[0]))));
}

// This function performs the basic merge of a sequence of variant values
// (given in 'variants') which are ordered by their priority (first is
// highest priority). 'qualifiers' is an array of booleans indicating
// which variants are active (if no 'qualifiers' are given, all variants
// are assumes active). The argument 'isVariantUnmergeable' is again an
// array which can indicate (at the corresponding position) that a variant
// cannot be merged further with lower priority variants. This is optional,
// if undefined, it is assumed that all variants are mergeable.
// 'firstToMerge' and 'lastToMerge' (if given)
// indicate the range of indexes in the 'variants' list which need to
// participate in the merge (some of the variants in this range may still
// be inactive due to their qualifier). The variant with index
// 'lastToMerge' is not merged.
// Finally, 'result' could optionally be the Result object which should store
// the result of the merge. If given, this object is modified by this function.
// If this object is not given, a new Result object is created to store the
// result. This function returns the Result object which stores the
// result of the merge (either the object provided as argument or the
// object created by the function).

function mergeVariants(variants: Result[], qualifiers: boolean[],
                       isVariantUnmergeable: boolean[],
                       firstToMerge: number, lastToMerge: number,
                       result: Result): Result
{
    var nrMerges: number = 0;
    var attributes: MergeAttributes = undefined;
    // 'result' attributes to be returned with result (if not the same as
    // 'attributes')
    var rAttributes: MergeAttributes = undefined;
    var firstResult: Result = undefined;
    var mergeValue: any[] = undefined;

    if(firstToMerge === undefined)
        firstToMerge = 0;
    if(lastToMerge === undefined)
        lastToMerge = variants.length;
    
    for (var i: number = firstToMerge; i < lastToMerge; i++) {
        if ((qualifiers !== undefined && !qualifiers[i]) ||
            variants[i].value === undefined ||
            (!variants[i].isAtomic() && isEmptyOS(variants[i].value)))
            continue;

        if (firstResult === undefined)
            firstResult = variants[i];

        // the next variant to merge. This may be a virtual variant created
        // by merging the suffix of the sequence of variants.
        var nextVariant: Result = variants[i];

        // If the next variant has identites, merge the lower priority
        // variants first.
        if(nextVariant.identifiers !== undefined) {
            nextVariant = mergeByIdentities(variants, qualifiers,
                                            isVariantUnmergeable, i,
                                            lastToMerge,
                                            nrMerges == 0 ?
                                            result : undefined);
            if(nrMerges == 0) // no previous merging, so this is it
                return nextVariant;
            i = lastToMerge - 1; // make the loop quit when this pass is done
        }
        if(attributes && attributes.push && i < lastToMerge - 1) {
            // merge all lower priority variants (if there is more than
            // one of them) before performing the push below
            nextVariant = mergeVariants(variants, qualifiers,
                                        isVariantUnmergeable, i,
                                        lastToMerge, undefined);
            i = lastToMerge - 1; // make the loop quit when this pass is done
        }

        // if this is not yet the last merge, must check whether the
        // lower priority variant has unmergeable node which are mergeable
        // in the (higher priority) merge produced so far.
        var isUnmergeable: any[] = (i < lastToMerge - 1) ? [] : undefined
        
        if(nrMerges === 0) {
            mergeValue = nextVariant.value;
            nrMerges = 1;
        } else if(nrMerges === 1) {
            var prevMergeValue: any[] = mergeValue;
            mergeValue = mergeCopyValue(mergeValue, nextVariant.value,
                                        attributes, isUnmergeable);
            if(mergeValue !== prevMergeValue && mergeValue != nextVariant.value)
                // means copy of array (and object in it, if any)
                nrMerges++
        } else // mergeValue is already a copy, can merge into it
            mergeValue = mergeValueOverwrite(mergeValue, nextVariant.value,
                                             attributes, isUnmergeable);

        // merging without identities, only global merge attributes
        // (for all value elements) apply
        if(nextVariant.mergeAttributes !== undefined &&
           nextVariant.mergeAttributes.length == 1) {
            var nextAttributes: MergeAttributes = nextVariant.mergeAttributes[0];
            attributes = attributes ?
                attributes.copyMerge(nextAttributes) : nextAttributes;
            if(rAttributes !== undefined)
                rAttributes = rAttributes.copyMerge(nextAttributes);
        }
        
        if (isVariantUnmergeable && isVariantUnmergeable[i])
            break;
        
        if(isUnmergeable && isUnmergeable[0]) {

            if(isUnmergeable[0] === true)
                break; // nothing can be merged
            
            // lower nodes are unmergeable. These paths become atomic in
            // subsequent merge steps (but are not atomic in the total
            // result of the merge)
            if(!rAttributes) {
                rAttributes = attributes ? attributes :
                    new MergeAttributes(undefined, undefined);
            }

            // atomic merge attributes for the unmergeable paths
            var unmergeableAtomic =
                new MergeAttributes(undefined, isUnmergeable[0]);
            attributes = attributes ? attributes.copyMerge(unmergeableAtomic) :
                unmergeableAtomic;
        }
    }

    if(result === undefined)
        result = new Result();
    
    if (nrMerges === 1)
        result.copyLabelsMinusDataSource(firstResult);
    
    result.value = mergeValue;
    if(rAttributes)
        attributes = rAttributes;
    if(attributes && attributes.notEmpty())
        result.mergeAttributes = [attributes];
    else if(result.mergeAttributes)
        result.mergeAttributes = undefined;

    return result;
}

// Merges 'variants' (given in decreasing order of priority) using
// identities of elements in ordered sets to determine which elements
// to merge with each other. Since higher priority variants modify
// lower priority variants, if one of the variants does nto carry
// identities, it is first merged with all lower priroity variants
// without using identities and only then is the result of this merge
// merged (with identities) with the higher priority variants
// (all of which have identities).

function mergeByIdentities(variants: Result[], qualifiers: boolean[],
                           isVariantUnmergeable: boolean[],
                           firstToMerge: number, lastToMerge: number,
                           result: Result): Result
{
    if(firstToMerge === undefined)
        firstToMerge = 0;
    if(lastToMerge === undefined)
        lastToMerge = variants.length;

    var mergeWithIdentities = [];

    var i: number;
    for (i = firstToMerge; i < lastToMerge; i++) {
        if ((qualifiers !== undefined && !qualifiers[i]) ||
            variants[i].value === undefined ||
            (!variants[i].isAtomic() && isEmptyOS(variants[i].value)))
            continue;
        if(variants[i].identifiers !== undefined) {
            if(variants[i].isAtomic() && isEmptyOS(variants[i].value))
                // merging an atomic empty set by identity does nothing
                continue;
            mergeWithIdentities.push(variants[i]);
        } else {
            // first non-identified variant to merge
            break;
        }
    }

    // 'i' is the first active variant without identities.
    // First merge it and all lower priority variants.
    if(i < lastToMerge - 1) {
        // add the result of this merge as the last variant in the list
        // of variants to merge by identities.
        mergeWithIdentities.push(
            mergeVariants(variants, qualifiers, isVariantUnmergeable,
                          i, lastToMerge,
                          // this is the whole merge, so can return immediately
                          mergeWithIdentities.length == 0 ? result:undefined));
        if(mergeWithIdentities.length == 1)
            return mergeWithIdentities[0];
    } else if(mergeWithIdentities.length == 0) {
        if(result) {
            result.value = constEmptyOS;
            result.mergeAttributes = undefined;
            result.identifiers = undefined;
        } else
            result = new Result();
        return result;
    }
    
    // merge variants by identities.
    
    var valuesById: Result[][] = []; // ordering as in the result of the merge
    var mergedIds = []; // identities of the resulting ordered set 
    var posById: Map<any,any> = new Map();
    var mergedValues = []; // array of merged values
    var allMergeAttributes = []; // array of resulting merge attributes

    // loop over variants in ascending order of priorities.
    for(i = mergeWithIdentities.length - 1 ; i >= 0 ; --i) {
        var variant: Result = mergeWithIdentities[i];
        // lowest priority variant may have no identities
        var identities: any[] = variant.identifiers ? variant.identifiers : [];
        var value: any = variant.value;

        for(var j: number = 0 ; j < value.length ; ++j) {
            var identity: any = identities[j];
            var mergeAttributes: MergeAttributes = undefined;
            
            if(variant.mergeAttributes !== undefined)
                mergeAttributes = variant.mergeAttributes.length == 1 ? 
                    variant.mergeAttributes[0] : variant.mergeAttributes[j];

            if(identity === undefined || typeof(identity) == "object") {
                // no identity, so the value is not merged with anything,
                // insert it at the right place in the merged result
                mergedValues[valuesById.length] = value[j];
                mergedIds.length++;
                if(mergeAttributes)
                    allMergeAttributes[valuesById.length] = mergeAttributes; 
                valuesById.length++; // reserve the position
                continue;
            }
            
            // may have to merge this value with other values
            var labeledValue = new Result(value[j]);
            if(mergeAttributes !== undefined)
                labeledValue.mergeAttributes = [mergeAttributes];
            
            var pos: number = posById.get(identity);
            if(pos !== undefined)
                valuesById[pos].push(labeledValue);
            else {
                pos = valuesById.length;
                valuesById.push([labeledValue]);
                mergedIds.push(identity);
                posById.set(identity, pos);
            }
        }
    }

    // now, merge the array of values at each position (highest priority
    // values are at end).

    for(i = 0 ; i < valuesById.length ; ++i) {
        if(!valuesById[i])
            continue;
        var mergeResult: Result;
        if(valuesById[i].length == 1)
            mergeResult = valuesById[i][0];
        else {
            // the list of values was constructed with the lowest priority
            // elements first.
            valuesById[i].reverse();
            var mergeResult: Result = mergeVariants(valuesById[i], undefined,
                                                    undefined, undefined,
                                                    undefined, undefined);
        }
        mergedValues[i] = mergeResult.value;
        if(mergeResult.mergeAttributes !== undefined)
            allMergeAttributes[i] = mergeResult.mergeAttributes[0];
    }

    // create the new result object
    if(!result)
        result = new Result(mergedValues);
    else
        result.value = mergedValues;

    if(allMergeAttributes.length > 0) {
        allMergeAttributes.length = mergedValues.length;
        result.mergeAttributes = allMergeAttributes;
    } else if(result.mergeAttributes !== undefined)
        result.mergeAttributes = undefined;

    result.identifiers = mergedIds;
    
    return result;
}

// Merges a and b, assuming that a's top level object is the "accumulated" value
// of multiple sequential merges: it only makes copies of b, and assumes a is
// "owned" by the caller. Consequently, if a and b are objects, copies of
// attributes of b can be added to a.
//   This can be improved by keeping track of the state of the qualifiers and
// the inputs, combined with a merge function that knows when a change is made.
function mergeValueOverwrite(a: any, b: any, attributes: MergeAttributes,
                             isUnmergeable: any[]): any
{
    if (a instanceof Array) {
        if (a.length === 0) {
            return (attributes && attributes.atomic === true) ? [] : b;
        }
        if(b === undefined)
            return a;
        if (a.length !== 1)
            return a;
        if (b instanceof Array && b.length !== 1) {
            // b unmergeable unless its empty
            if(isUnmergeable !== undefined && b.length !== 0 && isAV(a[0]))
                isUnmergeable[0] = true;
            return a;
        }
    } else if (b instanceof Array && b.length !== 1) {
        // b unmergeable unless its empty
        if(isUnmergeable !== undefined && b.length !== 0 && isAV(a))
            isUnmergeable[0] = true;
        return a;
    }
    var a0: any = a instanceof Array? a[0]: a;
    var b0: any = b instanceof Array? b[0]: b;
    if (!isAV(a0))
        return a;
    if(!isAV(b0)) {
        // b unmergeable
        if(isUnmergeable !== undefined)
            isUnmergeable[0] = true;
        return a;
    }
    mergeCopyAV(a0,b0, attributes, true, isUnmergeable);
    return a;
}

// Returns the merge of a and b, trying to use as much of the original
// objects as possible; if the result differs from a and b, it is a
// new object, otherwise it's the original parameter.
// If push is true, a is appended to b. If push is an object, it describes at
// which paths the data under b should be pushed onto under a. Similarly
// holds for the 'atomic' property, which is handled here in the same way.
// This function returns b iff a is undefined. In all other cases it either
// returns 'a' or a new object/array.
// The optional array 'isUnmergeable' allows this function to return information
// about the merge that was produced. Specifically, it indicates in which
// paths in the returned object, 'b' had an unmergeable value, while 'a'
// had a mergeable value. The merge value at that path would be
// a's, but any further merging (with lower priority objects) would be blocked
// at those paths by the fact that b's value was unmergeable.
// Note: this
// function is not completely compatible with the classic [merge], as [merge,
// o(), x] = x in classic, but here it is o(). The implementation here is
// compatible with the idea that ordered set of length != 1 cannot be merged
// without identifiers. 
function mergeCopyValue(a: any, b: any, attributes: MergeAttributes,
                        isUnmergeable: any[]): any[]
{
    var a0: any, b0: any;

    if (a === undefined) {
        return b;
    }
    if (b === undefined) {
        return a;
    }
    if (attributes !== undefined) {
        if (attributes.push === true) {
            return b instanceof Array? b.concat(a): [b].concat(a);
        }
    }
    if (a instanceof Array && b instanceof Array) {
        // Cannot merge ordered sets with length !== 1
        if (a.length !== 1)
            return (a.length == 0 &&
                    !(attributes && attributes.atomic === true)) ? b : a;
        if(b.length !== 1) {
            // b unmergeable (and a is mergeable) unless b is empty
            if(isUnmergeable !== undefined && b.length !== 0 && isAV(a[0]))
                isUnmergeable[0] = true;
            return a;
        }
        a0 = a[0]; b0 = b[0];
    } else if (b instanceof Array) {
        if (b.length !== 1) {
            // b unmergeable unless it is empty
            if(isUnmergeable !== undefined && b.length !== 0 && isAV(a))
                isUnmergeable[0] = true;
            return a;
        }
        a0 = a; b0 = b[0];
    } else if (a instanceof Array) {
        if (a.length !== 1) {
            // a is unmergeable unless it is empty
            return (a.length == 0 &&
                    !(attributes && attributes.atomic === true)) ? b : a;
        }
        a0 = a[0]; b0 = b;
    } else {
        a0 = a; b0 = b;
    }
    if (!isAV(a0))
        return a;
    if(!isAV(b0)) {
        // This is also the case when b = o()
        // b is unmergeable
        if(isUnmergeable !== undefined)
            isUnmergeable[0] = true;
        return a;
    }
    var o: any = mergeCopyAV(a0, b0, attributes, false, isUnmergeable);
    return o === a0? a : (o === b0? b : (a instanceof Array ? [o] : o));
}

// The optional array 'isUnmergeable' allows this function to return information
// about the merge that was produced. Specifically, it indicates in which
// paths in the returned object, b0 had an unmergeable value, while a0
// (possibly) had a mergeable value. The merge value at that path would be
// a0's, but any further merging (with lower priority objects) would be blocked
// at those paths by the fact that b0's value was unmergeable.

function mergeCopyAV(a0: any, b0: any, attributes: MergeAttributes,
                     overwrite: boolean, isUnmergeable: any[]): any
{
    if (!isAV(a0) || !isAV(b0) ||
          (attributes !== undefined && attributes.atomic === true)) {
        return a0 !== undefined? a0: b0;
    }
    var o: any = overwrite ? a0 : {};
    var a0Empty: boolean = true; // When true, a0 is an empty AV
    var a0Repl: boolean = false; // when true, at least one attribute of a[0] has been replaced
    var attrIsUnmergeable: any[] = isUnmergeable ? [] : undefined;
    for (var attr in a0) {
        a0Empty = false;
        if (attr in b0) {
            var mAttr2: MergeAttributes = attributes === undefined? undefined:
                                          attributes.popPathElement(attr);
            var repl: any = mergeCopyValue(a0[attr], b0[attr], mAttr2,
                                           attrIsUnmergeable);
            if(attrIsUnmergeable !== undefined && attrIsUnmergeable[0]) {
                if(!isUnmergeable[0])
                    isUnmergeable[0] = {};
                isUnmergeable[0][attr] = attrIsUnmergeable[0];
                attrIsUnmergeable[0] = false;
            }
            if(overwrite)
                o[attr] = repl;
            else if (repl !== undefined) {
                o[attr] = repl;
                if (repl !== a0[attr]) {
                    a0Repl = true;
                }
            } else {
                a0Repl = true;
            }
        } else if(!overwrite) {
            o[attr] = a0[attr];
        }
    }
    if (a0Empty && !overwrite) {
        return b0;
    }
    for (var attr in b0) {
        if (!(attr in a0)) {
            o[attr] = b0[attr];
            a0Repl = true;
        }
    }
    return a0Repl? o: a0;
}

// Returns a normalized path for an area query, i.e. it prefixes a query path
// with context if the path does not start with one of the four allowed
// query paths.
function normalizePath(path: string[]): string[] {
    return path[0] in {children: 1, context: 1, content: 1, param: 1}?
        path: ["context"].concat(path);
}

// Sets the end of path in obj to v
function updateNormalizedValue(obj: NormalizedValue, path: string[], v: any[]): void {
    var ptr: NormalizedValue = obj;
    var attr: string;

    for (var i = 0; i < path.length; i++) {
        if (ptr.length !== 1) {
            ptr[0] = {};
        }
        if (typeof(ptr[0]) !== "object" || ptr[0] instanceof NonAV) {
            Utilities.error("cannot set " + path.join("."));
            return;
        }
        var aPtr = <{[attr: string]: OrderedSet}> ptr[0];
        attr = path[i];
        if (aPtr[attr] === undefined) {
            aPtr[attr] = [{}];
        }
        ptr = aPtr[attr];
    }
    ptr.length = 0;
    Array.prototype.push.apply(ptr, v);
}

/// @class ChildInfo
/// Stored as values under the description, where they represent information
/// about existence and class membership.
class ChildInfo {
}

class ValueTypeDescription {
    constructor(
        public type: string,
        public av: {[attr: string]: ValueTypeDescription[]}|undefined,
        public elements: ValueTypeDescription[]|undefined) {
    }

    matches(v: any): boolean {
        if (this.type === "any" && v !== undefined) {
            return true;
        }

        var t = typeof(v);
        if (t !== "object") {
            return t === this.type; // number, boolean, string, undefined
        }

        if (v instanceof Array) {
            if (this.type !== "os") {
                return v.length <= 1 && this.matches(v[0]); // matches singletons, but o() also matches undefined
            }
            for (var i = 0; i < v.length; i++) {
                var v_i: any = v[i];
                for (var j = 0; j < this.elements.length; j++) {
                    if (this.elements[j].matches(v_i)) {
                        break;
                    }
                }
                if (j === this.elements.length) {
                    return false;
                }
            }
            return true;
        }

        if (v instanceof Projector) {
            return this.type === "projector";
        }
        if (v instanceof RegExp) {
            return this.type === "regexp";
        }
        if (v instanceof RangeValue) {
            return this.type === "range";
        }
        if (v instanceof NonAV) {
            return false;
        }

        for (var attr in v) {
            var subTypes = this.av[attr];
            if (subTypes === undefined) {
                subTypes = this.av["_"]; // wild card with default types for all unmentioned attrs
                if (subTypes === undefined) {
                    return false;
                }
            }
            for (var j = 0; j < subTypes.length; j++) {
                if (subTypes[j].matches(v[attr])) {
                    break;
                }
            }
            if (j === subTypes.length) {
                return false;
            }
        }
        // Check undefined attributes
        for (var attr in this.av) {
            if (!(attr in v) && attr !== "_") {
                var subTypes = this.av[attr];
                for (var j = 0; j < subTypes.length; j++) {
                    if (subTypes[j].matches(undefined)) {
                        break;
                    }
                }
                if (j === subTypes.length) {
                    return false;
                }
            }
        }
        return true;
    }
}

// Shorthand for creating a ValueTypeDescription
function vtd(type: string, arg?: ValueTypeDescription|ValueTypeDescription[]|{[attr: string]: ValueTypeDescription[]|ValueTypeDescription}): ValueTypeDescription {
    if (arg === undefined) {
        return new ValueTypeDescription(type, undefined, undefined);
    }
    if (arg instanceof ValueTypeDescription) {
        return new ValueTypeDescription(type, undefined, [arg]);
    }
    if (arg instanceof Array) {
        return new ValueTypeDescription(type, undefined, arg);
    }
    var objVTD: {[attr: string]: ValueTypeDescription[]} = {};
    for (var attr in arg) {
        objVTD[attr] = arg[attr] instanceof ValueTypeDescription?
            [<ValueTypeDescription>arg[attr]]: <ValueTypeDescription[]> arg[attr];
    }
    return new ValueTypeDescription(type, objVTD, undefined);
}

abstract class ForeignInterface {
    arguments: Result[];
    local: string;
    hasDivSet: boolean = false;
    displayOfArea: DisplayArea;

    destroy(): void {
    }

    setArgument(i: number, arg: Result): boolean {
        if (this.arguments === undefined) {
            this.arguments = [];
        }
        this.arguments[i] = arg;
        return true;
    }

    /**
     * Should execute the changes in the arguments
     * 
     * @param cb callback function that publishes the result of the function call
     * @returns true when wrapUpVisuals should be called
     */
    abstract execute(cb: (status: string, result: any[]|undefined) => void): boolean;

    setDiv(area: DisplayArea, div: HTMLDivElement|undefined): HTMLElement|undefined {
        this.displayOfArea = area;
        this.hasDivSet = true;
        return undefined;
    }

    /**
     * returning true allows children to be embedded as normal divs, but loses
     * events to the foreign div.
     */
    allowsEmbedding(): boolean {
        return true;
    }

    releaseDiv(): void {
        this.displayOfArea = undefined;
        this.hasDivSet = false;
    }

    setSize(width: number, height: number): void {
    }

    wrapUpVisuals(): void {
    }

    displayElementVisible(): void {
    }

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        if(reportDeadEnd)
            Utilities.warn("dead-ended write: cannot write through foreign function: " + gWriteAction);
        return false;
    }

    isDisplay(): boolean {
        return this.hasDivSet;
    }

    getDisplayArea(): DisplayArea {
        return this.displayOfArea;
    }

    addChildArea(areaReference: string, displayData: Result, areaController: ChildController): void {
    }

    removeChildArea(areaReference: string, areaController: ChildController): void {
    }
}

// A normalized value containing values of type ForeignInterface at end
// points. All functions must be added before use.
var foreignInterfaceObjects: any = [];

function addForeignInterface(foreignInterfaceObject: any): void {
    foreignInterfaceObjects = foreignInterfaceObjects.concat(
                                       normalizeObject(foreignInterfaceObject));
}

function wrapForeignInterface(fic: any): NativeObjectWrapper {
    var now = new NativeObjectWrapper();

    now.foreignInterfaceConstructor = fic;
    return now;
}

var isFeg: boolean = true;
