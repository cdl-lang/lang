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

// Type information about expressions.
// The values may not be altered while being shared, so for safety the
// add<type>() functions should only be called on fresh copies. For other
// operations, copy() and merge() must be used.
class ValueType implements EqualityTest {

    // Represents an attribute that is not known
    static anyAttribute: string = "<?>";

    // Each of the following fields indicates a potential disjoint type of the
    // result. E.g., {string:true, number:true} means that the result can be
    // an os of either of these types.
    // There are some exceptions: unknown indicates that there is no type
    // information, and is removed as soon as any other type is added, and
    // anyData, which removes all other types, since any inference on anyData
    // will yield anyData.

    // Initial value of an expression; only field that can get set to false/be
    // removed
    unknown?: boolean = true;

    // Meta information about origin of the data: true when is/derives from
    // remote data, which can be of any type except defuns. In combination
    // with unknown, represents data.
    remote?: boolean;

    // Meta information about the source of the data. When true, the result
    // possibly derives via queries etc. from an indexer.
    dataSource?: boolean;

    // represents any kind of data, but not areas
    anyData?: boolean;

    // undefined as a potential value
    undef?: boolean;

    // Simple, unmergeable values
    string?: boolean;
    number?: boolean;
    boolean?: boolean;
    defun?: ValueType;
    query?: boolean;
    range?: boolean;
    projector?: boolean;
    terminalSymbol?: boolean;
    comparisonFunction?: ValueType[];
    foreignInterface?: boolean;

    // AVs
    object?: {[attribute: string]: ValueType};

    // Sets of area references
    areas?: Map<number, ValueType>;

    // This field indicates the potential size ranges of the result. When it
    // is undefined, there is no information on the size. Note that size may
    // not be updated while 'this' is potentially being shared.
    sizes: RangeValue[];

    isPotentiallyMergeable(): boolean {
        return "unknown" in this || "object" in this || "anyData" in this ||
               "query" in this || "undef" in this;
    }

    isData(): boolean {
        return "unknown" in this || "object" in this || "anyData" in this ||
            "query" in this || "undef" in this || "string" in this ||
            "number" in this || "range" in this || "boolean" in this ||
            "projector" in this || "defun" in this|| "terminalSymbol" in this ||
            "comparisonFunction" in this || "foreignInterface" in this;
    }

    isStrictlyData(): boolean {
        return ("object" in this || "anyData" in this || "query" in this ||
                "string" in this || "number" in this || "range" in this ||
                "boolean" in this || "projector" in this || "defun" in this ||
                "comparisonFunction" in this || "terminalSymbol" in this ||
                "foreignInterface" in this) &&
            !("areas" in this);
    }

    isNotData(): boolean {
        return "areas" in this;
    }

    isNotString(): boolean {
        return !("anyData" in this) && !("unknown" in this) &&
               !("string" in this);
    }

    isAreas(): boolean {
        return (("unknown" in this || "undef" in this) && !("remote" in this)) ||
               "areas" in this;
    }

    isStrictlyAreas(): boolean {
        return "areas" in this;
    }

    isDataAndAreas(): boolean {
        return ("object" in this || "anyData" in this || "query" in this ||
                "string" in this || "number" in this || "range" in this ||
                "boolean" in this || "projector" in this || "defun" in this ||
                "comparisonFunction" in this || "terminalSymbol" in this ||
                "foreignInterface" in this) &&
            "areas" in this;
    }

    isStrictlyDefun(): boolean {
        return !("object" in this || "anyData" in this || "query" in this ||
                 "string" in this || "number" in this || "range" in this ||
                 "boolean" in this || "projector" in this || "areas" in this ||
                 "remote" in this || "comparisonFunction" in this ||
                 "terminalSymbol" in this || "foreignInterface" in this) &&
            "defun" in this;
    }

    isDefined(): boolean {
        return "object" in this || "anyData" in this || "query" in this ||
            "string" in this || "number" in this || "range" in this ||
            "boolean" in this || "projector" in this || "defun" in this ||
            "areas" in this || "comparisonFunction" in this ||
            "terminalSymbol" in this || "foreignInterface" in this;
    }

    isUndefined(): boolean {
        return "undef" in this && !this.isDefined();
    }

    addDataSource(): ValueType {
        this.dataSource = true;
        return this;
    }

    addAnyData(): ValueType {
        if ("unknown" in this) delete this.unknown;
        if ("undef" in this) delete this.undef;
        if ("string" in this) delete this.string;
        if ("number" in this) delete this.number;
        if ("boolean" in this) delete this.boolean;
        if ("defun" in this) delete this.defun;
        if ("query" in this) delete this.query;
        if ("range" in this) delete this.range;
        if ("projector" in this) delete this.projector;
        if ("object" in this) delete this.object;
        if ("comparisonFunction" in this) delete this.comparisonFunction;
        if ("terminalSymbol" in this) delete this.terminalSymbol;
        if ("foreignInterface" in this) delete this.foreignInterface;
        this.anyData = true;
        return this;
    }

    addUndefined(): ValueType {
        if ("unknown" in this) delete this.unknown;
        if (!this.anyData) {
            this.undef = true;
        }
        return this;
    }

    // This is a meta-type change, which doesn't affect unknown.
    addRemote(): ValueType {
        this.remote = true;
        return this;
    }

    addString(): ValueType {
        if ("unknown" in this) delete this.unknown;
        if (!this.anyData) {
            this.string = true;
        }
        return this;
    }

    addNumber(): ValueType {
        if ("unknown" in this) delete this.unknown;
        if (!this.anyData) {
            this.number = true;
        }
        return this;
    }

    addBoolean(): ValueType {
        if ("unknown" in this) delete this.unknown;
        if (!this.anyData) {
            this.boolean = true;
        }
        return this;
    }

    addDefun(resultType: ValueType): ValueType {
        if ("unknown" in this) delete this.unknown;
        if (!this.anyData) {
            this.defun = resultType;
        }
        return this;
    }

    subDefun(): ValueType {
        if ("defun" in this) {
            var copy: ValueType = this.copy();
            delete copy.defun;
            return copy;
        } else {
            return this;
        }
    }

    addQuery(): ValueType {
        if ("unknown" in this) delete this.unknown;
        if (!this.anyData) {
            this.query = true;
        }
        return this;
    }

    addRange(): ValueType {
        if ("unknown" in this) delete this.unknown;
        if (!this.anyData) {
            this.range = true;
        }
        return this;
    }

    addProjector(): ValueType {
        if ("unknown" in this) delete this.unknown;
        if (!this.anyData) {
            this.projector = true;
        }
        return this;
    }

    addTerminalSymbol(): ValueType {
        if ("unknown" in this) delete this.unknown;
        if (!this.anyData) {
            this.terminalSymbol = true;
        }
        return this;
    }

    addForeignInterface(): ValueType {
        if ("unknown" in this) delete this.unknown;
        if (!this.anyData) {
            this.foreignInterface = true;
        }
        return this;
    }

    addObject(obj: {[attr: string]: ValueType}): ValueType {
        if ("unknown" in this) delete this.unknown;
        if (!this.anyData) {
            if ("object" in this) {
                for (var attr in obj) {
                    if (attr in this.object) {
                        this.object[attr] = this.object[attr].merge(obj[attr]);
                    } else {
                        this.object[attr] = obj[attr];
                    }
                }
            } else {
                this.object = obj;
            }
        }
        return this;
    }

    addAttribute(attr: string, o: ValueType): ValueType {
        if ("unknown" in this) delete this.unknown;
        if (!this.anyData) {
            if (!("object" in this)) {
                this.object = {};
            }
            if (attr in this.object) {
                this.object[attr] = this.object[attr].merge(o);
            } else {
                this.object[attr] = o;
            }
        }
        return this;
    }

    removeAttribute(attr: string): ValueType {
        if ("object" in this && attr in this.object) {
            var copy: ValueType = this.copy();
            delete copy.object[attr];
            return copy;
        }
        return this;
    }

    getAttributeType(attr: string): ValueType {
        if ("anyData" in this) {
            return this;
        }
        if ("object" in this) {
            if (attr in this.object) {
                return ValueType.anyAttribute in this.object?
                    this.object[attr].merge(this.object[ValueType.anyAttribute]):
                    this.object[attr];
            } else if (ValueType.anyAttribute in this.object) {
                return this.object[ValueType.anyAttribute];
            }
        }
        return emptyValueType;
    }

    addAreas(areas: Map<number, ValueType>, updateSizes: boolean, multiplyBy: Map<number, ValueType>): ValueType {
        assert(areas !== undefined, "must at least be {}");
        if ("unknown" in this) delete this.unknown;
        if (!("areas" in this)) {
            this.areas = new Map<number, ValueType>();
        }
        for (var [areaTemplateId, type] of areas) {
            if (this.areas.has(areaTemplateId)) {
                this.areas.set(areaTemplateId,
                               this.areas.get(areaTemplateId).merge(type));
            } else {
                this.areas.set(areaTemplateId, type);
            }
            if (updateSizes) {
                if (multiplyBy === undefined) {
                    this.sizes = ValueTypeSize.sumSizes(this.sizes, type.sizes);
                } else {
                    this.sizes = ValueTypeSize.sumSizes(
                        this.sizes,
                        ValueTypeSize.multiplySizes(
                            type.sizes, multiplyBy.get(areaTemplateId).sizes));
                }
            }
        }
        return this;
    }

    addArea(areaTemplateId:number, sizes: RangeValue[]): ValueType {
        if ("unknown" in this) delete this.unknown;
        if (this.areas === undefined) {
            this.areas = new Map<number, ValueType>();
        }
        this.areas.set(areaTemplateId, new ValueType().addSizeRanges(sizes));
        this.sizes = ValueTypeSize.sumSizes(this.sizes, sizes);
        return this;
    }

    addComparisonFunction(elements: ValueType[]): ValueType {
        if ("unknown" in this) delete this.unknown;
        if (!this.anyData) {
            if ("object" in this) {
                for (var i: number = 0; i < elements.length; i++) {
                    if (this.comparisonFunction.length < i) {
                        this.comparisonFunction[i] = this.comparisonFunction[i].merge(elements[i]);
                    } else {
                        this.comparisonFunction[i] = elements[i];
                    }
                }
            } else {
                this.comparisonFunction = elements;
            }
        }
        return this;
    }

    copy(): ValueType {
        var copy: ValueType = new ValueType();

        if ("remote" in this)
            copy.addRemote();
        if ("dataSource" in this)
            copy.addDataSource();
        if ("anyData" in this)
            copy.addAnyData();
        if ("undef" in this)
            copy.addUndefined();
        if ("string" in this)
            copy.addString();
        if ("number" in this)
            copy.addNumber();
        if ("boolean" in this)
            copy.addBoolean();
        if ("defun" in this)
            copy.addDefun(this.defun);
        if ("query" in this)
            copy.addQuery();
        if ("range" in this)
            copy.addRange();
        if ("projector" in this)
            copy.addProjector();
        if ("terminalSymbol" in this)
            copy.addTerminalSymbol();
        if ("foreignInterface" in this)
            copy.addForeignInterface();
        if ("object" in this)
            copy.addObject(this.object);
        if ("areas" in this) {
            if ("unknown" in copy) delete copy.unknown;
            copy.areas = new Map<number, ValueType>();
            for (var [areaId, type] of this.areas) {
                copy.areas.set(areaId, type);
            }
        }
        if ("comparisonFunction" in this)
            copy.comparisonFunction = this.comparisonFunction.slice(0);
        copy.sizes = this.sizes === undefined? undefined: this.sizes.slice(0);
        return copy;
    }

    deepCopy(): ValueType {
        var copy: ValueType = new ValueType();

        if ("remote" in this)
            copy.addRemote();
        if ("anyData" in this)
            copy.addAnyData();
        if ("undef" in this)
            copy.addUndefined();
        if ("string" in this)
            copy.addString();
        if ("number" in this)
            copy.addNumber();
        if ("boolean" in this)
            copy.addBoolean();
        if ("defun" in this)
            copy.addDefun(this.defun);
        if ("query" in this)
            copy.addQuery();
        if ("range" in this)
            copy.addRange();
        if ("projector" in this)
            copy.addProjector();
        if ("terminalSymbol" in this)
            copy.addTerminalSymbol();
        if ("foreignInterface" in this)
            copy.addForeignInterface();
        if ("object" in this) {
            if ("unknown" in copy) delete copy.unknown;
            copy.object = {};
            for (let attr in this.object) {
                copy.object[attr] = this.object[attr].deepCopy();
            }
        }
        if ("areas" in this) {
            if ("unknown" in copy) delete copy.unknown;
            copy.areas = new Map<number, ValueType>();
            for (var [areaId, type] of this.areas) {
                copy.areas.set(areaId, type.deepCopy());
            }
        }
        if ("comparisonFunction" in this) {
            copy.comparisonFunction = this.comparisonFunction.map(function(v: ValueType): ValueType {
                return v.deepCopy();
            });
        }
        copy.sizes = this.sizes === undefined? undefined: this.sizes.slice(0);
        return copy;
    }

    mergeMinusUndefined(o: ValueType, mergeSizes: boolean): ValueType {
        var merge: ValueType = this.copy();

        if ("anyData" in o)
            merge.addAnyData();
        if ("remote" in o)
            merge.addRemote();
        if ("dataSource" in o)
            merge.addDataSource();
        if ("string" in o)
            merge.addString();
        if ("number" in o)
            merge.addNumber();
        if ("boolean" in o)
            merge.addBoolean();
        if ("defun" in o) {
            if ("defun" in this) {
                merge.addDefun(this.defun.merge(o.defun));
            } else {
                merge.addDefun(o.defun);
            }
        }
        if ("query" in o)
            merge.addQuery();
        if ("range" in o)
            merge.addRange();
        if ("projector" in o)
            merge.addProjector();
        if ("terminalSymbol" in o)
            merge.addTerminalSymbol();
        if ("foreignInterface" in o)
            merge.addForeignInterface();
        if ("object" in o) {
            if ("unknown" in merge)
                delete merge.unknown;
            if (!merge.anyData) {
                if (this.object === undefined) {
                    merge.object = o.object;
                } else {
                    merge.object = shallowCopy(this.object);
                    for (var attr in o.object) {
                        if (attr in this.object) {
                            merge.object[attr] =
                                this.object[attr].merge(o.object[attr]);
                        } else {
                            merge.object[attr] = o.object[attr];
                        }
                    }
                }
            }
        }
        if ("areas" in o)
            merge.addAreas(o.areas, false, undefined);
        if ("comparisonFunction" in o)
            merge.addComparisonFunction(o.comparisonFunction);
        if (mergeSizes) {
            merge.sizes = ValueTypeSize.mergeSizes(this.sizes, o.sizes);
        }
        return merge;
    }

    // Size is not part of equality
    isEqual(o: ValueType): boolean {
        if (this.unknown != o.unknown)
            return false;
        if (this.remote != o.remote)
            return false;
        if (this.dataSource != o.dataSource)
            return false;
        if (this.anyData != o.anyData)
            return false;
        if (this.undef != o.undef)
            return false;
        if (this.string != o.string)
            return false;
        if (this.number != o.number)
            return false;
        if (this.boolean != o.boolean)
            return false;
        if ("defun" in this || "defun" in o) {
            if (!("defun" in this && "defun" in o)) {
                return false;
            }
            if (!this.defun.isEqual(o.defun)) {
                return false;
            }
        }
        if (this.query != o.query)
            return false;
        if (this.range != o.range)
            return false;
        if (this.projector != o.projector)
            return false;
        if (this.terminalSymbol != o.terminalSymbol)
            return false;
        if (this.foreignInterface != o.foreignInterface)
            return false;
        if ("object" in this || "object" in o) {
            if (!("object" in this && "object" in o)) {
                return false;
            }
            for (var attr in this.object) {
                if (!(attr in o.object) || !this.object[attr].isEqual(o.object[attr])) {
                    return false;
                }
            }
            for (var attr in o.object) {
                if (!(attr in this.object)) {
                    return false;
                }
            }
        }
        if (("areas" in this || "areas" in o) &&
              (!("areas" in this && "areas" in o) ||
               !identicalSets(this.areas, o.areas)))
            return false;
        if (("comparisonFunction" in this || "comparisonFunction" in o) &&
              (!("comparisonFunction" in this && "comparisonFunction" in o) ||
               !arrayEqual(this.comparisonFunction, o.comparisonFunction)))
            return false;
        return true;
    }

    // Merges the types of o1 and o2 into o1, and returns o1.
    // Initially, o1 can be left undefined; o2 should never be undefined.
    merge(o: ValueType, mergeSizes: boolean = true): ValueType {
        var merge: ValueType = this.mergeMinusUndefined(o, mergeSizes);

        if ("undef" in o)
            merge.addUndefined();
        return merge;
    }

    removeDataSource(): ValueType {
        if ("dataSource" in this) {
            delete this.dataSource;
        }
        return this;
    }

    isEqualOrUnknown(o: ValueType): boolean {
        if (this.unknown || o.unknown) {
            return true;
        }
        if (this.anyData != o.anyData)
            return false;
        if (this.undef != o.undef)
            return false;
        if (this.string != o.string)
            return false;
        if (this.number != o.number)
            return false;
        if (this.boolean != o.boolean)
            return false;
        if ("defun" in this || "defun" in o) {
            if (!("defun" in this && "defun" in o)) {
                return false;
            }
            if (!this.defun.isEqual(o.defun)) {
                return false;
            }
        }
        if (this.query != o.query)
            return false;
        if (this.range != o.range)
            return false;
        if (this.projector != o.projector)
            return false;
        if (this.terminalSymbol != o.terminalSymbol)
            return false;
        if (this.foreignInterface != o.foreignInterface)
            return false;
        if ("object" in this || "object" in o) {
            if (!("object" in this && "object" in o)) {
                return false;
            }
            for (var attr in this.object) {
                if (!(attr in o.object) || !this.object[attr].isEqualOrUnknown(o.object[attr])) {
                    return false;
                }
            }
            for (var attr in o.object) {
                if (!(attr in this.object)) {
                    return false;
                }
            }
        }
        if (("areas" in this || "areas" in o) &&
              (!("areas" in this && "areas" in o) ||
               !identicalSets(this.areas, o.areas)))
            return false;
        if (("comparisonFunction" in this || "comparisonFunction" in o) &&
              (!("comparisonFunction" in this && "comparisonFunction" in o) ||
               !arrayEqual(this.comparisonFunction, o.comparisonFunction)))
            return false;
        return true;
    }

    // True when o is covered by this. E.g. anyData covers any other data,
    // but number only covers number.
    subsumes(o: ValueType): boolean {
        if (!this.remote && o.remote)
            return false; // remote covers non-remote, but not vice versa.
        if (!this.dataSource && o.dataSource)
            return false; // dataSource covers non-dataSource, but not vice versa.
        if (this.anyData)
            return true;
        if (o.anyData)
            return false;
        if (!this.string && o.string)
            return false;
        if (!this.number && o.number)
            return false;
        if (!this.boolean && o.boolean)
            return false;
        if (!("defun" in this) && "defun" in o)
            return false;
        if ("defun" in this && "defun" in o) {
            if (!this.defun.subsumes(o.defun)) {
                return false;
            }
        }
        if (!this.query && o.query)
            return false;
        if (!this.range && o.range)
            return false;
        if (!this.projector && o.projector)
            return false;
        if (!this.terminalSymbol && o.terminalSymbol)
            return false;
        if (!this.foreignInterface && o.foreignInterface)
            return false;
        if (!("object" in this) && "object" in o)
            return false;
        if ("object" in this && "object" in o) {
            for (var attr in this.object) {
                if (attr in o.object && !this.object[attr].subsumes(o.object[attr])) {
                    return false;
                }
            }
            for (var attr in o.object) {
                if (!(attr in this.object)) {
                    return false;
                }
            }
        }
        if (!("areas" in this) && "areas" in o)
            return false;
        if ("areas" in this && "areas" in o && !subsetOf(o.areas, this.areas))
            return false;
        if (!("comparisonFunction" in this) && "comparisonFunction" in o)
            return false;
        if ("comparisonFunction" in this && "comparisonFunction" in o) {
            if (this.comparisonFunction.length > o.comparisonFunction.length) {
                return false;
            }
            for (var i: number = 0; i < this.comparisonFunction.length; i++) {
                if (!this.comparisonFunction[i].subsumes(o.comparisonFunction[i])) {
                    return false;
                }
            }
        }
        return true;
    }

    checkForSpellingErrors(o: any): void {
        if ("object" in this && "object" in o) {
            var k1: string[] = Object.keys(this.object);
            var k2: string[] = Object.keys(o.object);
            for (var i: number = 0; i !== k1.length; i++) {
                for (var j: number = 0; j < k2.length; j++) {
                    // Bit of an arbitrary heuristic...
                    if (k1[i].length + k2[j].length > 14) {
                        var dist: number = levenshtein(k1[i], k2[j], 2);
                        if (dist !== 0 && dist < 2) {
                            Utilities.syntaxError(
                                "possible spelling error in attributes: " +
                                    k1[i] + " vs " + k2[j]);
                        }
                    }
                }
            }
            for (var attr in this.object) {
                if (attr in o.object) {
                    this.object[attr].checkForSpellingErrors(o.object[attr]);
                }
            }
        }
    }

    // Can an expression with this type match an expression with type o? "this"
    // is the data, o is the query, so if o is a boolean or unknown, or _, it
    // always matches, etc. Does not do embedded negative queries, but stays on
    // the safe side (when positive is false or undefined).
    canMatch(o: ValueType, positive: boolean): boolean {
        if (this.unknown || o.unknown || o.boolean || this.remote || o.remote) // bool and remote can match anything
            return true;
        if (o.projector)
            return true;
        if (this.undef || o.undef)
            return this.undef === o.undef;
        if ((this.anyData && o.isData()) || (this.isData() && o.anyData))
            return true;
        if (this.boolean && o.boolean)
            return true;
        if (this.string && (o.string || o.range))
            return true;
        if (this.number && (o.number || o.range))
            return true;
        if ("defun" in this && "defun" in o)
            return true;
        if (this.query && o.query)
            return true;
        if (this.range && (o.range || o.number || o.string))
            return true;
        if (this.terminalSymbol && o.terminalSymbol)
            return true;
        if (this.foreignInterface && o.foreignInterface)
            return true;
        if (this.object !== undefined && o.object !== undefined) {
            for (var attr in this.object) {
                if (attr !== ValueType.anyAttribute && attr in o.object &&
                      !this.object[attr].canMatch(o.object[attr], undefined)) {
                    if (!(ValueType.anyAttribute in o.object) ||
                          !this.object[attr].canMatch(o.object[ValueType.anyAttribute], undefined)) {
                        return false;
                    }
                }
            }
            if (positive && !(ValueType.anyAttribute in this.object)) {
                for (var attr in o.object) {
                    if (!(attr in this.object)) {
                        return false;
                    }
                }
            }
        }
        if (this.areas !== undefined && o.areas !== undefined) {
            for (var areaTemplateId of this.areas.keys()) {
                if (o.areas.has(areaTemplateId)) {
                    return true;
                }
            }
        }
        if (this.comparisonFunction !== undefined && o.comparisonFunction !== undefined &&
              this.comparisonFunction.length <= o.comparisonFunction.length) {
            for (var i: number = 0; i < this.comparisonFunction.length; i++) {
                if (!this.comparisonFunction[i].canMatch(o.comparisonFunction[i], positive)) {
                    return false;
                }
            }
        }
        return false;
    }

    toString(): string {
        var strs: string[] = [];

        if ("remote" in this)
            strs.push("remote");
        if ("dataSource" in this)
            strs.push("dataSource");
        if ("anyData" in this)
            strs.push("anyData");
        if ("unknown" in this)
            strs.push("unknown");
        if ("undef" in this)
            strs.push("undef");
        if ("string" in this)
            strs.push("string");
        if ("number" in this)
            strs.push("number");
        if ("boolean" in this)
            strs.push("boolean");
        if ("defun" in this)
            strs.push("defun(" + this.defun.toString() + ")");
        if ("query" in this)
            strs.push("query");
        if ("range" in this)
            strs.push("range");
        if ("projector" in this)
            strs.push("projector");
        if ("terminalSymbol" in this)
            strs.push("terminalSymbol");
        if ("foreignInterface" in this)
            strs.push("foreignInterface");
        if ("object" in this) {
            var ostrs: string[] = [];
            for (var attr in this.object) {
                ostrs.push(attr + ": " + this.object[attr].toString());
            }
            strs.push("{" + ostrs.join(", ") + "}");
        }
        if ("areas" in this) {
            var str: string = "";
            for (var areaId of this.areas.keys()) {
                if (str.length > 0)
                    str += ",";
                str += "@" + areaId;
            }
            strs.push("areas(" + str + ")");
        }
        if ("comparisonFunction" in this) {
            strs.push("comparisonFunction(" + this.comparisonFunction.map(function(v: ValueType): string { return v.toString(); }) + ")");
        }
        var str = strs.length === 1? strs[0]: "o(" + strs.join(", ") + ")";
        if (this.sizes !== undefined) {
            str += "/#=" + this.sizes.map(function(r: RangeValue): string {
                return r.stringify();
            }).join(",");
        }
        return str;
    }

    // Checks if the return value is guaranteed to represent a strict selection
    // when interpreted as a query.
    isStrictSelection(): boolean {
        if ("remote" in this || "anyData" in this || "unknown" in this ||
              "undef" in this || "defun" in this || "query" in this ||
              "projector" in this || "areas" in this) {
            return false;
        }
        if ("object" in this) {
            for (var attr in this.object) {
                if (!this.object[attr].isStrictSelection()) {
                    return false;
                }
            }
        }
        return true;
    }

    applyQueryInt(v: ValueType): {sel: boolean; proj: ValueType} {
        if ((v === undefined || ("undef" in v && !("remote" in v))) &&
              !("remote" in this)) {
            return {
                sel: true,
                proj: undefined
            };
        }
        if ("anyData" in this || "unknown" in this || "remote" in this) {
            return {
                sel: true,
                proj: this
            };
        }
        if ("query" in this || "anyData" in v || "unknown" in v ||
              "remote" in v) {
            return {
                sel: true,
                proj: v
            };
        }
        var sel: boolean = "boolean" in this || "number" in this || "string" in this || "range" in this;
        var projType: ValueType = "projector" in this? v: undefined;
        if ("object" in this && "object" in v) {
            var objProjType: ValueType = undefined;
            var nrProjectingAttributes: number = 0;
            var nrSelectingAttributes: number = 0;
            var firstProjectingAttribute: string;
            var totalNrAttributes: number = 0;
            for (var attr in this.object) {
                if (attr === ValueType.anyAttribute) {
                    var anyAttrProj: ValueType = undefined;
                    var nrAnyAttrSel: number = 0;
                    for (var attr2 in v.object) {
                        totalNrAttributes++;
                        var aq = this.object[ValueType.anyAttribute].applyQueryInt(v.object[attr2]);
                        if (aq.sel) {
                            nrAnyAttrSel++;
                        }
                        if (aq.proj !== undefined) {
                            anyAttrProj = anyAttrProj === undefined? aq.proj:
                                          anyAttrProj.merge(aq.proj);
                        }
                    }
                    if (nrAnyAttrSel !== 0) {
                        nrSelectingAttributes++;
                        sel = true;
                    }
                    if (anyAttrProj !== undefined) {
                        nrProjectingAttributes++;
                        if (nrProjectingAttributes === 1) {
                            objProjType = anyAttrProj;
                            firstProjectingAttribute = attr;
                        } else {
                            if (nrProjectingAttributes === 2) {
                                objProjType = new ValueType().addAttribute(firstProjectingAttribute, objProjType);
                            }
                            objProjType.addAttribute(attr, anyAttrProj);
                        }
                    }
                } else {
                    totalNrAttributes++;
                    var aq = this.object[attr].applyQueryInt(v.object[attr]);
                    if (aq.sel) {
                        nrSelectingAttributes++;
                        sel = true;
                    }
                    if (aq.proj !== undefined) {
                        nrProjectingAttributes++;
                        if (nrProjectingAttributes === 1) {
                            objProjType = aq.proj;
                            firstProjectingAttribute = attr;
                        } else {
                            if (nrProjectingAttributes === 2) {
                                objProjType = new ValueType().addAttribute(firstProjectingAttribute, objProjType);
                            }
                            objProjType.addAttribute(attr, aq.proj);
                        }
                    }
                }
            }
            projType = projType === undefined? objProjType:
                       projType = projType.merge(objProjType);
            if (nrSelectingAttributes !== 0 &&
                  nrProjectingAttributes === totalNrAttributes) {
                projType = projType.merge(v);
            }
        }
        return {
            sel: sel,
            proj: projType
        };
    }

    // Return the value type of the result of applying a query with this
    // type of data with type v.
    applyQuery(v: ValueType): ValueType {
        var aqi = this.applyQueryInt(v);
        var aq = aqi.proj !== undefined? aqi.proj: aqi.sel? v: new ValueType();

        if ("remote" in v || "dataSource" in v) {
            aq = aq.copy();
            if ("remote" in v) aq.addRemote();
            if ("dataSource" in v) aq.addDataSource();
        }
        return aq;
    }

    addSizeRange(nSize: RangeValue): ValueType {
        this.sizes = ValueTypeSize.insertNewSize(this.sizes, nSize);
        return this;
    }

    addSizeRanges(nSizes: RangeValue[]): ValueType {
        if (this.sizes === undefined) {
            this.sizes = nSizes;
        } else {
            ValueTypeSize.destructiveMerge(this.sizes, nSizes);
        }
        return this;
    }

    addSize(min: number, max?: number): ValueType {
        if (typeof(max) === "undefined") {
            return this.addSizeRange(new RangeValue([min], true, true));
        } else {
            return this.addSizeRange(new RangeValue([min, max], true, true));
        }
    }

    addSizes(sizes: RangeValue[]): ValueType {
        this.sizes = ValueTypeSize.mergeSizes(this.sizes, sizes);
        return this;
    }

    replaceSize(min: number, max?: number): ValueType {
        if (typeof(max) === "undefined") {
            this.sizes = [new RangeValue([min], true, true)];
        } else {
            this.sizes = [new RangeValue([min, max], true, true)];
        }
        return this;
    }

    checkConsistency(): void {
        if ("anyData" in this || "undef" in this || "string" in this ||
              "number" in this || "boolean" in this || "defun" in this ||
              "query" in this || "range" in this || "projector" in this ||
              "object" in this || "areas" in this ||
              "comparisonFunction" in this || "terminalSymbol" in this ||
              "foreignInterface" in this) {
            assert(!("unknown" in this), "ValueType consistency failure");
        }
    }

    // Returns the path to the projector iff there is precisely one path
    extractWritePath(): string[] {
        var writePath: string[] = undefined;

        if ("projector" in this) {
            writePath = [];
        }
        if ("object" in this) {
            for (var attr in this.object) {
                var attrWrPath: string[] = this.object[attr].extractWritePath();
                if (attrWrPath !== undefined) {
                    if (writePath === undefined) {
                        writePath = [attr].concat(attrWrPath);
                    } else {
                        return undefined;
                    }
                }
            }
        }
        return writePath;
    }

    intersectAreas(v: ValueType): ValueType {
        if (v.areas !== undefined) {
            var vt: ValueType = this.copy();
            vt.areas = undefined;
            for (var [a1, t1] of this.areas) {
                if (v.areas.has(a1)) {
                    vt.addArea(a1, ValueTypeSize.minOfSizes(v.areas.get(a1).sizes, t1.sizes));
                }
            }
            vt.sizes = ValueTypeSize.max(vt.sizes);
            return vt;
        } else {
            return this;
        }
    }

    isExactSize(sz: number): boolean {
        return this.sizes !== undefined && this.sizes.length > 0 &&
               this.sizes.every(function(rng: RangeValue): boolean {
                   return rng.intMin() === sz && rng.intMax() === sz;
               });
    }
}

module ValueTypeSize {
    function testSizes(sizes: RangeValue[]): boolean {
        for (var i: number = 1; i < sizes.length; i++) {
            if (sizes[i].min > sizes[i].max ||
                  sizes[i-1].max >= sizes[i].min - 1 ||
                  sizes[i-1].min >= sizes[i].min - 1) {
                return false;
            }
        }
        return true;
    }

    export function insertNewSize(sizes: RangeValue[], nSize: RangeValue): RangeValue[] {
        if (nSize === undefined) {
            return sizes;
        } else if (sizes === undefined) {
            sizes = [nSize];
        } else {
            for (var i: number = 0; i < sizes.length; i++) {
                if (sizes[i].match(nSize) ||
                      sizes[i].intConnectsWith(nSize)) {
                    sizes[i] = sizes[i].merge(nSize);
                    while (i < sizes.length - 1 &&
                           (sizes[i].match(sizes[i + 1]) ||
                            sizes[i].intConnectsWith(sizes[i + 1]))) {
                        sizes[i] = sizes[i].merge(sizes[i + 1]);
                        sizes.splice(i + 1, 1);
                    }
                    break;
                } else if (nSize.isLessThanOrEqualTo(sizes[i])) {
                    sizes.splice(i, 0, nSize);
                    break;
                }
            }
            if (i === sizes.length) {
                sizes.push(nSize);
            }
            assert(testSizes(sizes), "wrong update");
        }
        return sizes;
    }

    export function destructiveMerge(sizes: RangeValue[], s2: RangeValue[]): void {
        for (var i: number = 0; i < s2.length; i++) {
            insertNewSize(sizes, s2[i]);
        }
    }

    export function mergeSizes(s1: RangeValue[], s2: RangeValue[]): RangeValue[] {
        if (s1 === undefined) {
            return s2;
        } else if (s2 === undefined) {
            return s1;
        } else {
            var sizes: RangeValue[] = shallowCopy(s1);
            destructiveMerge(sizes, s2);
            return sizes;
        }
    }

    export function sumSizes(s1: RangeValue[], s2: RangeValue[]): RangeValue[] {
        if (s1 === undefined) {
            return s2;
        } else if (s2 === undefined) {
            return s1;
        } else {
            var s1imin = s1[0].intMin();
            var s1imax = s1[s1.length - 1].intMax();
            var s2imin = s2[0].intMin();
            var s2imax = s2[s2.length - 1].intMax();
            return [new RangeValue([s1imin + s2imin, s1imax + s2imax], true, true)];
        }
    }

    export function multiplySizes(s1: RangeValue[], s2: RangeValue[]): RangeValue[] {
        if (s1 === undefined) {
            return s2;
        } else if (s2 === undefined) {
            return s1;
        } else {
            var sizes: RangeValue[] = undefined;
            for (var i: number = 0; i < s1.length; i++) {
                var s1imin = s1[i].intMin();
                var s1imax = s1[i].intMax();
                for (var j: number = 0; j < s2.length; j++) {
                    sizes = insertNewSize(
                        sizes,
                        new RangeValue([s1imin * s2[j].intMin(),
                                        s1imax * s2[j].intMax()],
                                       true, true));
                }
            }
            return sizes;
        }
    }

    export function minOfSizes(s1: RangeValue[], s2: RangeValue[]): RangeValue[] {
        if (s1 === undefined || s1.length === 0) {
            return s2;
        } else if (s2 === undefined || s2.length === 0) {
            return s1;
        } else {
            var sizes: RangeValue[] = undefined;
            var s1max = s1[s1.length - 1].max;
            var s2max = s2[s2.length - 1].max;
            if (s1max === s2max) {
                sizes = mergeSizes(s1, s2);
            } else {
                var min: RangeValue[] = s1max < s2max? s1: s2;
                var max: RangeValue[] = s1max < s2max? s2: s1;
                var upb: number = s1max < s2max? s1max: s2max;
                sizes = shallowCopy(min);
                for (var i: number = 0; i < max.length && max[i].min <= upb; i++) {
                    if (max[i].max <= upb) {
                        insertNewSize(sizes, max[i]);
                    } else {
                        insertNewSize(sizes, _r(max[i].min, upb));
                        break;
                    }
                }
            }
            return sizes;
        }
    }

    // Returns the range from 0 to max of sizes
    export function max(sizes: RangeValue[]): RangeValue[] {
        return sizes === undefined || sizes === []? undefined:
            [new RangeValue([0, sizes[sizes.length - 1].max], true,
                            sizes[sizes.length - 1].closedUpper)];
    }

    export function equalsNumber(sizes: RangeValue[], num: number): boolean {
        return sizes !== undefined && sizes.length === 1 &&
               sizes[0].min === num && sizes[0].max === num &&
               !sizes[0].closedLower && !sizes[0].closedUpper;
    }

    export function upperLimit(sizes: RangeValue[], upb: number): RangeValue[] {
        if (sizes === undefined) {
            return undefined;
        } else {
            var nSizes: RangeValue[] = [];
            for (var i: number = 0; i < sizes.length; i++) {
                if (sizes[i].min <= upb) {
                    if (sizes[i].max <= upb) {
                        nSizes.push(sizes[i]);
                    } else {
                        nSizes.push(_r(sizes[i].min, upb));
                        break;
                    }
                } else {
                    break;
                }
            }
            return nSizes;
        }
    }
}

var emptyValueType: ValueType = new ValueType().addSize(0);
