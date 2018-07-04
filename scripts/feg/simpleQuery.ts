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

/// <reference path="globals.ts" />
/// <reference path="cdl.ts" />

// Executes a simple query on a canonical value. The implementations are all a
// bit samey, but avoid making the same decision (selection, projection, etc.)
// for each data element. The interface also provides functions that can be
// called by compiled queries.
interface SimpleQuery extends EqualityTest {
    // Applies the query to data, copying identifiers from matching elements
    // to selectedIdentifiers, and updating selectedPositions if defined.
    // dataPositions are the positions corresponding to the
    // elements in data; when undefined, it is  supposed to be an array of
    // DataPosition(i, 1).
    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[];

    // Returns true when data matches the query, and data is a single value
    testSingle(data: any): boolean;

    // Returns true when data matches the query and data is an os.
    testOS(data: any[]): boolean;

    // True when projection
    isProjection(): boolean;

    // True when it implements executeAndCache. Currently, the global
    // allowSimpleQueryCache can be set to false to avoid caching.
    canCache(): boolean;

    // When canCache() returns true, and the data set is large enough, this
    // function is called instead of execute. It is expected to build a
    // cache/index for similar queries on the result, and use that for
    // determining the query result.
    // Caching is only useful when performing multiple similar queries on the
    // same data. When there is only one query, it is probably counter-
    // productive. The current implementation caches for simple value and range
    // queries and attribute-range queries ({x: r(...)}), since they are used
    // frequently on the same, large data set in the current applications.
    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[];
}

// Implements selection based on ids. If the data doesn't have ids, or the
// data elements aren't ===-equal, it calls the SimpleQuery which must
// implement the same as this.data.
class IdentityQuery implements SimpleQuery {
    ids: {[id: string]: number};
    data: any[];
    query: SimpleQuery = undefined;

    constructor(ids: string[], data: any[]) {
        this.ids = {};
        this.data = data;
        for (var i: number = 0; i < ids.length; i++) {
            this.ids[ids[i]] = i;
        }
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"IdentityQuery"});
    }

    init(): void {
        this.query = makeSimpleQueryDefault(this.data, undefined);
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        if (identifiers !== undefined) {
            var r: any[] = [];
            for (var i: number = 0; i !== data.length; i++) {
                var d: any = data[i];
                if (identifiers[i] in this.ids &&
                      (this.data[this.ids[identifiers[i]]] === d ||
                       this.testSingle(d))) {
                    selectedIdentifiers.push(identifiers[i]);
                    r.push(d);
                    if (selectedPositions !== undefined) {
                        selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                    }
                }
            }
            return r;
        } else {
            if (this.query === undefined) {
                this.init();
            }
            return this.query.execute(data, undefined, undefined, selectedPositions, undefined);
        }
    }

    testSingle(data: any): boolean {
        if (this.query === undefined) {
            this.init();
        }
        return this.query.testSingle(data);
    }

    testOS(data: any[]): boolean {
        if (this.query === undefined) {
            this.init();
        }
        return this.query.testOS(data);
    }

    isEqual(sq: SimpleQuery): boolean {
        if (sq instanceof IdentityQuery) {
            if (this.query === undefined) {
                this.init();
            }
            if (sq.query === undefined) {
                sq.init();
            }
            return objectEqual(this.ids, sq.ids) &&
                   this.query.isEqual(sq.query);
        }
        return false;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SimplePassThrough implements SimpleQuery {
    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        if (identifiers !== undefined) {
            var idMap: {[id: string]: boolean} = {};
            var res: any[] = [];
            assert(data.length === identifiers.length, "number of identifiers should match number of data elements");
            for (var i: number = 0; i < data.length; i++) {
                var id: any = identifiers[i];
                if (!(id in idMap)) {
                    idMap[id] = true;
                    res.push(data[i]);
                    selectedIdentifiers.push(id);
                    if (selectedPositions !== undefined) {
                        selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                    }
                }
            }
            return res;
        } else {
            var valueMap: Set<any> = new Set<any>();
            var res: any[] = [];
            for (var i: number = 0; i < data.length; i++) {
                var val: any = data[i];
                if (!valueMap.has(val)) {
                    valueMap.add(val);
                    res.push(val);
                    if (selectedPositions !== undefined) {
                        selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                    }
                }
            }
            return res;
        }
    }

    testSingle(data: any): boolean {
        return true;
    }

    testOS(data: any[]): boolean {
        return true;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SimplePassThrough;
    }

    // Note that we do not consider this operation a (strict) projection, but
    // rather a (trivial) selection.
    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

// The query that selects nothing
class SimpleSelectNone implements SimpleQuery {
    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        return [];
    }

    testSingle(data: any): boolean {
        return false;
    }

    testOS(data: any[]): boolean {
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SimpleSelectNone;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SingleAttributeProjection implements SimpleQuery {
    attr: string;

    constructor(attr: string) {
        this.attr = attr;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SingleAttributeProjection"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (typeof(data_i) !== "object") {
                continue;
            }
            var queryResult: any = data_i[this.attr];
            if (queryResult !== undefined) {
                if (!(queryResult instanceof Array)) {
                    r.push(queryResult);
                } else if (queryResult.length === 1) {
                    r.push(queryResult[0]);
                } else if (queryResult.length !== 0) {
                    r = r.concat(queryResult);
                }
                if (selectedPositions !== undefined) {
                    var sub: DataPosition = new DataPosition(
                        dataPositions === undefined? i: dataPositions[i].index,
                        queryResult instanceof Array? queryResult.length:
                            queryResult !== undefined? 1: 0);
                    selectedPositions.push(sub);
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return isTrue(data[this.attr]);
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                if (isTrue(data[i][this.attr])) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SingleAttributeProjection &&
            this.attr === (<SingleAttributeProjection>sq).attr;
    }


    isProjection(): boolean {
        return true;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class DoubleAttributeProjection implements SimpleQuery {
    attr1: string;
    attr2: string;

    constructor(attr1: string, attr2: string) {
        this.attr1 = attr1;
        this.attr2 = attr2;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"DoubleAttributeProjection"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (typeof(data_i) === "object") {
                var top: any[] = data_i[this.attr1];
                if (top !== undefined) {
                    for (var j = 0; j < top.length; j++) {
                        var queryResult: any = top[j][this.attr2];
                        if (queryResult !== undefined) {
                            if (!(queryResult instanceof Array)) {
                                r.push(queryResult);
                            } else if (queryResult.length === 1) {
                                r.push(queryResult[0]);
                            } else if (queryResult.length !== 0) {
                                r = r.concat(queryResult);
                            }
                            if (selectedPositions !== undefined) {
                                var sub: DataPosition = new DataPosition(
                                    dataPositions === undefined? i: dataPositions[i].index,
                                    1, [this.attr1],
                                    [new DataPosition(j,
                                            queryResult instanceof Array? queryResult.length:
                                            queryResult !== undefined? 1: 0
                                        )
                                    ]
                                );
                                selectedPositions.push(sub);
                            }
                        }
                    }
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return this.testOS2(data[this.attr1]);
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                if (this.testOS2(data[i][this.attr1])) {
                    return true;
                }
            }
        }
        return false;
    }

    testOS2(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                if (isTrue(data[i][this.attr2])) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof DoubleAttributeProjection &&
            this.attr1 === (<DoubleAttributeProjection>sq).attr1 &&
            this.attr2 === (<DoubleAttributeProjection>sq).attr2;
    }


    isProjection(): boolean {
        return true;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SimpleTrueSelection implements SimpleQuery {
    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (data_i !== false && data_i !== undefined) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return isTrue(data);
    }

    testOS(data: any[]): boolean {
        return isTrue(data);
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SimpleTrueSelection;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SingleAttributeTrueSelection implements SimpleQuery {
    attr: string;

    constructor(attr: string) {
        this.attr = attr;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SingleAttributeTrueSelection"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (isTrue(data_i[this.attr])) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return isTrue(data[this.attr]);
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                if (isTrue(data[i][this.attr])) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SingleAttributeTrueSelection &&
            this.attr === (<SingleAttributeTrueSelection>sq).attr;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}
    
class SimpleFalseSelection implements SimpleQuery {
    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (data_i === false || data_i === undefined) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return isFalse(data);
    }

    testOS(data: any[]): boolean {
        return isFalse(data);
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SimpleFalseSelection;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SingleAttributeFalseSelection implements SimpleQuery {
    attr: string;

    constructor(attr: string) {
        this.attr = attr;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SingleAttributeFalseSelection"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (typeof(data_i) === "object") {
                var data_i_attr: any = data_i[this.attr];
                if (isFalse(data_i_attr) && !isEmptyOS(data_i_attr)) {
                    if (identifiers !== undefined) {
                        selectedIdentifiers.push(identifiers[i]);
                    }
                    r.push(data_i);
                    if (selectedPositions !== undefined) {
                        selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                    }
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return typeof(data) === "object" && isFalse(data[this.attr]) &&
               !isEmptyOS(data[this.attr]);
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                var d: any = data[i];
                if (typeof(d) === "object" &&
                      (!isFalse(d[this.attr]) || isEmptyOS(d[this.attr]))) {
                    return false;
                }
            }
        }
        return true;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SingleAttributeFalseSelection &&
            this.attr === (<SingleAttributeFalseSelection>sq).attr;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SingleAttributePresentFalseSelection implements SimpleQuery {
    attr: string;

    constructor(attr: string) {
        this.attr = attr;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SingleAttributeFalseSelection"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (typeof(data_i) === "object" && isFalse(data_i[this.attr])) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return isFalse(data[this.attr]);
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                if (!isFalse(data[i][this.attr])) {
                    return false;
                }
            }
        }
        return true;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SingleAttributeFalseSelection &&
            this.attr === (<SingleAttributeFalseSelection>sq).attr;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

function simpleValueMatchInOS(data: any[], comp: SimpleValue): boolean {
    return data !== undefined && data.some(function(d: any): boolean {
        return d === comp || (d instanceof RangeValue && d.match(comp));
    });
}

function onlySimpleValueInOS(data: any[], comp: SimpleValue): boolean {
    return data !== undefined && data.every(function(d: any): boolean {
        return d === comp || (d instanceof RangeValue && d.match(comp));
    });
}

class SimpleValueSelection implements SimpleQuery {
    comp: SimpleValue;

    constructor(comp: SimpleValue) {
        this.comp = comp;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SimpleValueSelection"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];
        var comp: SimpleValue = this.comp;

        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (data_i === comp ||
                (data_i instanceof RangeValue && data_i.match(comp))) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return data === this.comp || (data instanceof RangeValue && data.match(this.comp));
    }

    testOS(data: any[]): boolean {
        return simpleValueMatchInOS(data, this.comp);
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SimpleValueSelection &&
            this.comp === (<SimpleValueSelection>sq).comp;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SimpleSubstringSelection implements SimpleQuery {
    substr: SubStringQuery;

    constructor(substr: SubStringQuery) {
        this.substr = substr;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SimpleSubstringSelection"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];
        var substr: SubStringQuery = this.substr;

        if (substr.strings.length === 1) {
            var re: RegExp = substr.regexps[0];
            for (var i: number = 0; i !== data.length; i++) {
                var data_i: any = data[i];
                if (typeof(data_i) !== "object" && re.test(String(data_i))) {
                    if (identifiers !== undefined) {
                        selectedIdentifiers.push(identifiers[i]);
                    }
                    r.push(data_i);
                    if (selectedPositions !== undefined) {
                        selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                    }
                }
            }
        } else {
            for (var i: number = 0; i !== data.length; i++) {
                var data_i: any = data[i];
                if (typeof(data_i) !== "object" && substr.match(String(data_i))) {
                    if (identifiers !== undefined) {
                        selectedIdentifiers.push(identifiers[i]);
                    }
                    r.push(data_i);
                    if (selectedPositions !== undefined) {
                        selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                    }
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return typeof(data) !== "object" && this.substr.match(String(data));
    }

    testOS(data: any[]): boolean {
        if (data === undefined) {
            return false;
        } else if (this.substr.strings.length === 1) {
            var re: RegExp = this.substr.regexps[0];
            return data.some(v => typeof(v) !== "object" && re.test(String(v)));
        } else {
            return data.some(v => typeof(v) !== "object" && this.substr.match(String(v)));
        }
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SimpleSubstringSelection &&
               this.substr.isEqual(sq.substr);
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class ElementReferenceSelection implements SimpleQuery {
    element: string;

    constructor(elementRef: ElementReference) {
        this.element = elementRef.element;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"ElementReferenceSelection"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (data_i instanceof ElementReference && data_i.element === this.element) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return data instanceof ElementReference && data.element === this.element;
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                if (data[i] instanceof ElementReference && data[i].element === this.element) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof ElementReferenceSelection &&
            this.element === (<ElementReferenceSelection>sq).element;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SingleAttributeSimpleValueSelection implements SimpleQuery {
    attr: string;
    comp: any;

    constructor(attr: string, comp: any) {
        this.attr = attr;
        this.comp = comp;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SingleAttributeSimpleValueSelection"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (typeof(data_i) === "object" && this.attr in data_i &&
                  simpleValueMatchInOS(data_i[this.attr], this.comp)) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return typeof(data) === "object" && this.attr in data &&
               simpleValueMatchInOS(data[this.attr], this.comp);
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                if (typeof(data[i]) === "object" && this.attr in data[i] &&
                      simpleValueMatchInOS(data[i][this.attr], this.comp)) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SingleAttributeSimpleValueSelection &&
            this.attr === (<SingleAttributeSimpleValueSelection>sq).attr &&
            this.comp === (<SingleAttributeSimpleValueSelection>sq).comp;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return allowSimpleQueryCache;
    }

    /// Builds an associative AV with each value in the of the attribute
    /// projection. Querying is then a matter of looking up the attribute's
    /// values in the cache.
    checkCache(result: Result): void {
        var attr: string = this.attr;
        var cacheId: string = "simplevalue_" + attr;

        if (!("simpleQueryCache" in result) || result.simpleQueryCache.result !== result.value) {
            result.simpleQueryCache = new QueryCache(result.value);
        }
        if (!(cacheId in result.simpleQueryCache.cache)) {
            var data: any[] = result.value;
            var ids: any[] = result.identifiers;
            var cache: {[value: string]: SortedCacheElement[]} = {};
            var hasRange: boolean = false;
            for (var i: number = 0; i < result.value.length && !hasRange; i++) {
                var d: any = data[i];
                if (attr in d) {
                    var proj: any[] = d[attr];
                    for (var j: number = 0; j < proj.length; j++) {
                        var p: any = proj[j];
                        if (p instanceof RangeValue) {
                            hasRange = true;
                        } else if (p in cache) {
                            cache[p].push({
                                key: undefined,
                                value: d,
                                index: i,
                                identifier: ids === undefined? undefined: ids[i]
                            });
                        } else {
                            cache[p] = [{
                                key: undefined,
                                value: d,
                                index: i,
                                identifier: ids === undefined? undefined: ids[i]
                            }];
                        }
                    }
                }
            }
            result.simpleQueryCache.cache[cacheId] = hasRange? undefined: cache;
        }
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        var cacheId: string = "simplevalue_" + this.attr;
        this.checkCache(result);
        var cache: any = result.simpleQueryCache.cache[cacheId];

        if (cache !== undefined) {
            return SortedCacheElement.extractResults(result,selectedIdentifiers,
                                                     cache[this.comp]);
        } else {
            return this.execute(result.value, result.identifiers, selectedIdentifiers, selectedPositions, undefined);
        }
    }
}

class SingleAttributeSelection implements SimpleQuery {
    attr: string;

    constructor(attr: string) {
        this.attr = attr;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SingleAttributeSelection"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var d: any = data[i];
            if (typeof(d) === "object" && !isEmptyOS(d[this.attr])) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(d);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return typeof(data) === "object" && !isEmptyOS(data[this.attr]);
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                var d: any = data[i];
                if (typeof(d) === "object" && !isEmptyOS(d[this.attr])) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SingleAttributeSelection &&
            this.attr === (<SingleAttributeSelection>sq).attr;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SingleAttributeAbsentSelection implements SimpleQuery {
    attr: string;

    constructor(attr: string) {
        this.attr = attr;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SingleAttributeAbsentSelection"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (typeof(data_i) !== "object" || isEmptyOS(data_i[this.attr])) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return typeof(data) !== "object" || isEmptyOS(data[this.attr]);
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                var data_i: any = data[i];
                if (typeof(data_i) !== "object" || isEmptyOS(data_i[this.attr])) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SingleAttributeAbsentSelection &&
            this.attr === (<SingleAttributeAbsentSelection>sq).attr;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SingleAttributeSimpleValueMultipleSelection implements SimpleQuery {
    attr: string;
    comp: {[key: string]: boolean} = undefined;
    compOS: any[];

    constructor(attr: string, compOS: any[]) {
        this.attr = attr;
        this.compOS = compOS;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SingleAttributeSimpleValueMultipleSelection"});
    }

    init(): void {
        var compOS: any[] = this.compOS;

        this.comp = {};
        for (var i: number = 0; i < compOS.length; i++) {
            this.comp[compOS[i]] = true;
        }
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];
        var comp: {[key: string]: boolean} = this.comp;
        var compOS: any[] = this.compOS;

        if (comp === undefined) {
            this.init();
            comp = this.comp;
        }
        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (typeof(data_i) === "object" && this.attr in data_i &&
                  data_i[this.attr].some(function (v: any): boolean {
                      return v in comp ||
                             (v instanceof RangeValue &&
                              compOS.some(function(c: any): boolean {
                                  return v.match(c);
                              }));
                  })) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        if (this.comp === undefined) {
            this.init();
        }
        return typeof(data) === "object" && this.attr in data &&
               data[this.attr].some((v: any): boolean => {
                   return v in this.comp ||
                          (v instanceof RangeValue &&
                           this.compOS.some(function(c: any): boolean {
                               return v.match(c);
                           }));
               });
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            if (this.comp === undefined) {
                this.init();
            }
            for (var i: number = 0; i < data.length; i++) {
                var data_i: any = data[i];
                if (typeof(data_i) === "object" && this.attr in data_i &&
                    data_i[this.attr].some((v: any): boolean => {
                        return v in this.comp ||
                               (v instanceof RangeValue &&
                                this.compOS.some(function(c: any): boolean {
                                    return v.match(c);
                                }));
                    })) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        if (sq instanceof SingleAttributeSimpleValueMultipleSelection) {
            if (this.comp === undefined) {
                this.init();
            }
            if (sq.comp === undefined) {
                sq.init();
            }
            return this.attr === sq.attr && objectEqual(this.comp, sq.comp);
        }
        return false;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SingleAttributeSimpleValueInvSelection implements SimpleQuery {
    attr: string;
    comp: SimpleValue;

    constructor(attr: string, comp: SimpleValue) {
        this.attr = attr;
        this.comp = comp;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SingleAttributeSimpleValueInvSelection"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];
        var comp: SimpleValue = this.comp;

        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (typeof(data_i) === "object" && this.attr in data_i &&
                  !onlySimpleValueInOS(data_i[this.attr], comp)) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return typeof(data) === "object" && this.attr in data &&
               !onlySimpleValueInOS(data[this.attr], this.comp);
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            var comp: SimpleValue = this.comp;
            for (var i: number = 0; i < data.length; i++) {
                var data_i: any = data[i];
                if (typeof(data_i) === "object" && this.attr in data_i &&
                      !onlySimpleValueInOS(data_i[this.attr], comp)) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SingleAttributeSimpleValueInvSelection &&
            this.attr === (<SingleAttributeSimpleValueInvSelection>sq).attr &&
            this.comp === (<SingleAttributeSimpleValueInvSelection>sq).comp;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SingleAttributeSimpleValueInvMultipleSelection implements SimpleQuery {
    attr: string;
    comp: {[key: string]: boolean};
    compOS: any[];

    constructor(attr: string, compOS: any[]) {
        this.attr = attr;
        this.compOS = compOS;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SingleAttributeSimpleValueInvMultipleSelection"});
    }

    init(): void {
        var compOS: any[] = this.compOS;

        this.comp = {};
        for (var i: number = 0; i < compOS.length; i++) {
            this.comp[compOS[i]] = true;
        }
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];
        var comp: {[key: string]: boolean} = this.comp;
        var compOS: any[] = this.compOS;

        if (comp === undefined) {
            this.init();
            comp = this.comp;
        }
        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (typeof(data_i) === "object" && this.attr in data_i &&
                  !data_i[this.attr].every(function (v: any): boolean {
                      return v in comp ||
                             (v instanceof RangeValue &&
                              compOS.some(function(c: any): boolean {
                                  return v.match(c);
                              }));
                  })) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        var comp: {[key: string]: boolean} = this.comp;
        var compOS: any[] = this.compOS;

        if (comp === undefined) {
            this.init();
            comp = this.comp;
        }
        return typeof(data) === "object" && this.attr in data &&
               !data[this.attr].every(function (v: any): boolean {
                   return v in comp ||
                          (v instanceof RangeValue &&
                           compOS.some(function(c: any): boolean {
                               return v.match(c);
                           }));
               });
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            var comp: {[key: string]: boolean} = this.comp;
            var compOS: any[] = this.compOS;
            if (comp === undefined) {
                this.init();
                comp = this.comp;
            }
            for (var i: number = 0; i < data.length; i++) {
                var data_i: any = data[i];
                if (typeof(data_i) === "object" && this.attr in data_i &&
                      !data_i[this.attr].every(function (v: any): boolean {
                          return v in comp ||
                                 (v instanceof RangeValue &&
                                  compOS.some(function(c: any): boolean {
                                      return v.match(c);
                                  }));
                      })) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        if (sq instanceof SingleAttributeSimpleValueInvMultipleSelection) {
            if (this.comp === undefined) {
                this.init();
            }
            if (sq.comp === undefined) {
                sq.init();
            }
            return this.attr === sq.attr && objectEqual(this.comp, sq.comp);
        }
        return false;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SingleAttributeSubStringQuery implements SimpleQuery {
    attr: string;
    substr: SubStringQuery;

    constructor(attr: string, substr: SubStringQuery) {
        this.attr = attr;
        this.substr = substr;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SingleAttributeSubStringQuery"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (typeof(data_i) === "object" && this.attr in data_i &&
                  data_i[this.attr].some((v: string) => {
                      return this.substr.match(v);
                  })) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return typeof(data) === "object" && this.attr in data &&
            data[this.attr].some((v: string) => {
                return this.substr.match(v);
            });
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                if (typeof(data[i]) === "object" && this.attr in data[i] &&
                      data[i][this.attr].some((v: string) => {
                          return this.substr.match(v);
                      })) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        if (sq instanceof SingleAttributeSubStringQuery) {
            return this.attr === sq.attr && this.substr.isEqual(sq.substr);
        }
        return false;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SortedCacheElement {
    key: any;
    value: any;
    index: number;
    identifier: any;

    static compareIndices(a: SortedCacheElement, b: SortedCacheElement): number {
        return a.index - b.index;
    }

    static extractValue(a: SortedCacheElement): any {
        return a.value;
    }

    static extractIdentifier(a: SortedCacheElement): any {
        return a.identifier;
    }

    static compareNumericKeys1(a: SortedCacheElement, b: number): number {
        return a.key - b;
    }

    static compareNumericKeys2(a: SortedCacheElement, b: SortedCacheElement): number {
        return a.key - b.key;
    }

    // TODO: add selected positions to output!!!
    static extractResults(result: Result, ids: any[], cache: SortedCacheElement[]): any[] {
        if (cache === undefined) {
            return constEmptyOS;
        }
        if (ids !== undefined) {
            Array.prototype.push.apply(ids, cache.map(SortedCacheElement.extractIdentifier));
        }
        return cache.map(SortedCacheElement.extractValue);
    }

    static extractResultRange(result: Result, ids: any[], cache: SortedCacheElement[], low: number, high: number): any[] {
        if (high <= low) {
            return constEmptyOS;
        }
        if (low === 0 && high === result.value.length) {
            if (ids !== undefined) {
                Array.prototype.push.apply(ids, result.identifiers);
            }
            return result.value;
        }
        var cacheSlice: SortedCacheElement[] = cache.slice(low, high);
        cacheSlice.sort(SortedCacheElement.compareIndices);
        if (ids !== undefined) {
            Array.prototype.push.apply(ids, cacheSlice.map(SortedCacheElement.extractIdentifier));
        }
        return cacheSlice.map(SortedCacheElement.extractValue);
    }
}

class SimpleRangeSelection implements SimpleQuery {
    comp: RangeValue;
    lowestIndexInCache: number = undefined;
    highestIndexInCache: number = undefined;

    constructor(comp: RangeValue) {
        this.comp = comp;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SimpleRangeSelection"});
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return allowSimpleQueryCache;
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }

    testSingle(data: any): boolean {
        Utilities.error("do not call");
        return undefined;
    }

    testOS(data: any[]): boolean {
        Utilities.error("do not call");
        return undefined;
    }

    isEqual(sq: SimpleQuery): boolean {
        Utilities.error("do not call");
        return undefined;
    }

    /// Sorts all values, and performs binary search with the range limits.
    /// Sets results to undefined when not all elements in the data are
    /// numeric, to avoid problems with ranges in the data.
    checkCache(result: Result): void {
        if (!("simpleQueryCache" in result) || result.simpleQueryCache.result !== result.value) {
            result.simpleQueryCache = new QueryCache(result.value);
        }
        if (!("range" in result.simpleQueryCache.cache)) {
            result.simpleQueryCache.cache["range"] = result.value.
                filter(function(a: any): boolean {
                    return typeof(a) === "number" && !isNaN(a);
                }).
                map(function(a: any, i: number): SortedCacheElement {
                    return { value: a, key: a, index: i, identifier: undefined};
                }).
                sort(SortedCacheElement.compareNumericKeys2);
        }
        if (result.simpleQueryCache.cache["range"].length === result.value.length) {
            this.lowestIndexInCache = binarySearchMin(
                result.simpleQueryCache.cache["range"], this.comp.min,
                SortedCacheElement.compareNumericKeys1);
            this.highestIndexInCache = binarySearchMax(
                result.simpleQueryCache.cache["range"], this.comp.max,
                SortedCacheElement.compareNumericKeys1);
        } else {
            this.lowestIndexInCache = undefined;
            this.highestIndexInCache = undefined;
        }
    }

    /// When the cache is complete, the low and high index of the slice on the
    /// cache are determined, and the result extracted from it.
    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        this.checkCache(result);
        if (this.lowestIndexInCache !== undefined) {
            var low: number = this.comp.min === -Infinity? 0:
                              this.lowestIndexInCache >= 0? (this.comp.closedLower?
                                                             this.lowestIndexInCache:
                                                             this.lowestIndexInCache + 1):
                              -this.lowestIndexInCache - 1;
            var high: number = this.comp.max === Infinity? result.simpleQueryCache.cache["range"].length:
                               this.highestIndexInCache >= 0? (this.comp.closedUpper?
                                                               this.highestIndexInCache + 1:
                                                               this.highestIndexInCache):
                               -this.highestIndexInCache - 1;
            return SortedCacheElement.extractResultRange(result, selectedIdentifiers, result.simpleQueryCache.cache["range"], low, high);
        } else {
            return this.execute(result.value, result.identifiers, selectedIdentifiers, selectedPositions, undefined);
        }
    }
}

class SimpleRangeCCSelection extends SimpleRangeSelection {
    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var low: number = this.comp.min;
        var high: number = this.comp.max;
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var d: any = data[i];
            if (d instanceof RangeValue) {
                if (this.comp.match(d)) {
                    if (identifiers !== undefined) {
                        selectedIdentifiers.push(identifiers[i]);
                    }
                    r.push(d);
                    if (selectedPositions !== undefined) {
                        selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                    }
                }
            } else if (low <= d && d <= high) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(d);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return data instanceof RangeValue? this.comp.match(data):
            this.comp.min <= data && data <= this.comp.max;
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                var data_i: any = data[i]
                if (data_i instanceof RangeValue? this.comp.match(data_i):
                    this.comp.min <= data_i && data_i <= this.comp.max) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SimpleRangeCCSelection &&
            this.comp.isEqual((<SimpleRangeCCSelection>sq).comp);
    }
}

class SimpleRangeCOSelection extends SimpleRangeSelection {
    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var low: number = this.comp.min;
        var high: number = this.comp.max;
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var d: any = data[i];
            if (d instanceof RangeValue) {
                if (this.comp.match(d)) {
                    if (identifiers !== undefined) {
                        selectedIdentifiers.push(identifiers[i]);
                    }
                    r.push(d);
                    if (selectedPositions !== undefined) {
                        selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                    }
                }
            } else if (low <= d && d < high) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(d);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return data instanceof RangeValue? this.comp.match(data):
            this.comp.min <= data && data < this.comp.max;
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                var data_i: any = data[i]
                if (data_i instanceof RangeValue? this.comp.match(data_i):
                    this.comp.min <= data_i && data_i < this.comp.max) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SimpleRangeCOSelection &&
            this.comp.isEqual((<SimpleRangeCOSelection>sq).comp);
    }
}

class SimpleRangeOCSelection extends SimpleRangeSelection {
    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var low: number = this.comp.min;
        var high: number = this.comp.max;
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var d: any = data[i];
            if (d instanceof RangeValue) {
                if (this.comp.match(d)) {
                    if (identifiers !== undefined) {
                        selectedIdentifiers.push(identifiers[i]);
                    }
                    r.push(d);
                    if (selectedPositions !== undefined) {
                        selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                    }
                }
            } else if (low < d && d <= high) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(d);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return data instanceof RangeValue? this.comp.match(data):
            this.comp.min < data && data <= this.comp.max;
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                var data_i: any = data[i]
                if (data_i instanceof RangeValue? this.comp.match(data_i):
                    this.comp.min < data_i && data_i <= this.comp.max) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SimpleRangeOCSelection &&
               this.comp.isEqual((<SimpleRangeOCSelection>sq).comp);
    }
}

class SimpleRangeOOSelection extends SimpleRangeSelection {
    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var low: number = this.comp.min;
        var high: number = this.comp.max;
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var d: any = data[i];
            if (d instanceof RangeValue) {
                if (this.comp.match(d)) {
                    if (identifiers !== undefined) {
                        selectedIdentifiers.push(identifiers[i]);
                    }
                    r.push(d);
                    if (selectedPositions !== undefined) {
                        selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                    }
                }
            } else if (low < d && d < high) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(d);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return data instanceof RangeValue? this.comp.match(data):
            this.comp.min < data && data < this.comp.max;
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                var data_i: any = data[i]
                if (data_i instanceof RangeValue? this.comp.match(data_i):
                    this.comp.min < data_i && data_i < this.comp.max) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SimpleRangeOOSelection &&
               this.comp.isEqual((<SimpleRangeOOSelection>sq).comp);
    }
}

class SimpleValueMultipleSelection implements SimpleQuery {
    comp: {[key: string]: boolean} = undefined;
    compOS: any[];

    constructor(compOS: any[]) {
        this.compOS = compOS;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SimpleValueMultipleSelection"});
    }

    init(): void {
        var compOS: any[] = this.compOS;

        this.comp = {};
        for (var i: number = 0; i < compOS.length; i++) {
            this.comp[compOS[i]] = true;
        }
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];
        var comp: {[key: string]: boolean} = this.comp;
        var compOS: any[] = this.compOS;

        if (this.comp === undefined) {
            this.init();
            comp = this.comp;
        }
        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (data_i in comp || (data_i instanceof RangeValue &&
                                   compOS.some(function(c: any): boolean {
                                       return data_i.match(c);
                                   }))) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        if (this.comp === undefined) {
            this.init();
        }
        return data in this.comp ||
               (data instanceof RangeValue &&
                this.compOS.some(function(c: any): boolean {
                    return data.match(c);
                }));
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            var comp: {[key: string]: boolean} = this.comp;
            var compOS: any[] = this.compOS;
            if (this.comp === undefined) {
                this.init();
                comp = this.comp;
            }
            for (var i: number = 0; i < data.length; i++) {
                var data_i: any = data[i];
                if (data_i in comp || (data_i instanceof RangeValue &&
                                       compOS.some(function(c: any): boolean {
                                           return data_i.match(c);
                                       }))) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        if (sq instanceof SimpleValueMultipleSelection) {
            if (this.comp === undefined) {
                this.init();
            }
            if (sq.comp === undefined) {
                sq.init();
            }
            return objectEqual(this.comp, sq.comp);
        }
        return false;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return allowSimpleQueryCache;
    }

    /// Builds an associative AV for all values in the data.
    checkCache(result: Result): void {
        var cacheId: string = "simplevalue";

        if (!("simpleQueryCache" in result) || result.simpleQueryCache.result !== result.value) {
            result.simpleQueryCache = new QueryCache(result.value);
        }
        if (!(cacheId in result.simpleQueryCache.cache)) {
            var data: any[] = result.value;
            var ids: any[] = result.identifiers;
            var cache: {[value: string]: SortedCacheElement[]} = {};
            var hasRange: boolean = false;
            for (var i: number = 0; i < result.value.length && !hasRange; i++) {
                var d: any = data[i];
                if (isSimpleType(d)) {
                    if (d in cache) {
                        cache[d].push({
                            key: undefined,
                            value: d,
                            index: i,
                            identifier: ids === undefined? undefined: ids[i]
                        });
                    } else {
                        cache[d] = [{
                            key: undefined,
                            value: d,
                            index: i,
                            identifier: ids === undefined? undefined: ids[i]
                        }];
                    }
                } else if (d instanceof RangeValue) {
                    hasRange = true; // call execute() instead
                    break;
                }
            }
            result.simpleQueryCache.cache[cacheId] = hasRange? undefined: cache;
        }
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        this.checkCache(result);
        var cache: {[value: string]: SortedCacheElement[]} = result.simpleQueryCache.cache["simplevalue"];
        if (cache !== undefined) {
            var cacheList: SortedCacheElement[] = [];
            var valuesSeen: Set<SimpleValue> = new Set<SimpleValue>();
            for (var i: number = 0; i < this.compOS.length; i++) {
                var d: any = this.compOS[i];
                if (!valuesSeen.has(d) && d in cache) {
                    Array.prototype.push.apply(cacheList, cache[d]);
                    valuesSeen.add(d);
                }
            }
            return SortedCacheElement.extractResults(result, selectedIdentifiers, cacheList);
        } else {
            return this.execute(result.value, result.identifiers, selectedIdentifiers, selectedPositions, undefined);
        }
    }
}

class SimpleValueInvMultipleSelection implements SimpleQuery {
    comp: {[key: string]: boolean} = undefined;
    compOS: any[];

    constructor(compOS: any[]) {
        this.compOS = compOS;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SimpleValueInvMultipleSelection"});
    }

    init(): void {
        var compOS: any[] = this.compOS;

        this.comp = {};
        for (var i: number = 0; i < compOS.length; i++) {
            this.comp[compOS[i]] = true;
        }
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];
        var comp: {[key: string]: boolean} = this.comp;
        var compOS: any[] = this.compOS;

        if (this.comp === undefined) {
            this.init();
            comp = this.comp;
        }
        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (!(data_i in comp ||
                  (data_i instanceof RangeValue &&
                   compOS.some(function(c: any): boolean {
                       return data_i.match(c);
                   })))) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        if (this.comp === undefined) {
            this.init();
        }
        return !(data in this.comp ||
                 (data instanceof RangeValue &&
                  this.compOS.some(function(c: any): boolean {
                      return data.match(c);
                  })));
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            var compOS: any[] = this.compOS;
            var comp: {[key: string]: boolean} = this.comp;
            if (comp === undefined) {
                this.init();
                comp = this.comp;
            }
            for (var i: number = 0; i < data.length; i++) {
                var data_i: any = data[i];
                if (!(data_i in comp || (data_i instanceof RangeValue &&
                                         compOS.some(function(c: any): boolean {
                                             return data_i.match(c);
                                         })))) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        if (sq instanceof SimpleValueInvMultipleSelection) {
            if (this.comp === undefined) {
                this.init();
            }
            if (sq.comp === undefined) {
                sq.init();
            }
            return objectEqual(this.comp, sq.comp);
        }
        return false;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class ElementReferenceMultipleSelection implements SimpleQuery {
    elements: {[key: string]: boolean} = undefined;
    compOS: ElementReference[];

    constructor(compOS: ElementReference[]) {
        this.compOS = compOS;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"ElementReferenceMultipleSelection"});
    }

    init(): void {
        var compOS: ElementReference[] = this.compOS;

        this.elements = {};
        this.compOS = undefined;
        for (var i: number = 0; i < compOS.length; i++) {
            this.elements[compOS[i].element] = true;
        }
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];
        var elements: {[key: string]: boolean} = this.elements;

        if (elements === undefined) {
            this.init();
            elements = this.elements;
        }
        for (var i: number = 0; i !== data.length; i++) {
            if (data[i] instanceof ElementReference &&
                  data[i].element in elements) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data[i]);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        if (this.elements === undefined) {
            this.init();
        }
        return data instanceof ElementReference && data.element in this.elements;
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            if (this.elements === undefined) {
                this.init();
            }
            for (var i: number = 0; i < data.length; i++) {
                if (data[i] instanceof ElementReference &&
                      data[i].element in this.elements) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        if (sq instanceof ElementReferenceMultipleSelection) {
            if (this.elements === undefined) {
                this.init();
            }
            if (sq.elements === undefined) {
                sq.init();
            }
            return objectEqual(this.elements, sq.elements);
        }
        return false;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

class SingleAttributeRangeSelection implements SimpleQuery {
    attr: string;
    comp: RangeValue;
    lowestIndexInCache: number;
    highestIndexInCache: number;

    constructor(attr: string, comp: RangeValue) {
        this.attr = attr;
        this.comp = comp;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SingleAttributeRangeSelection"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var data_i: any = data[i];
            if (typeof(data_i) === "object" && this.attr in data_i &&
                  data_i[this.attr].some((d: any): boolean => {
                      return this.comp.match(d);
                  })) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data_i);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return typeof(data) === "object" && this.attr in data &&
               data[this.attr].some((d: any): boolean => {
                   return this.comp.match(d);
               });
    }

    testOS(data: any[]): boolean {
        if (data !== undefined) {
            for (var i: number = 0; i < data.length; i++) {
                if (typeof(data[i]) === "object" && this.attr in data[i] &&
                    data[i][this.attr].some((d: any): boolean => {
                        return this.comp.match(d);
                    })) {
                    return true;
                }
            }
        }
        return false;
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SingleAttributeRangeSelection &&
               this.attr === (<SingleAttributeRangeSelection>sq).attr &&
               objectEqual(this.comp, (<SingleAttributeRangeSelection>sq).comp);
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return allowSimpleQueryCache;
    }

    /// Similar to a simple range query.
    checkCache(result: Result): void {
        var attr: string = this.attr;
        var cacheId: string = "range_" + attr;

        if (!("simpleQueryCache" in result) || result.simpleQueryCache.result !== result.value) {
            result.simpleQueryCache = new QueryCache(result.value);
        }
        if (!(cacheId in result.simpleQueryCache.cache)) {
            var data: any[] = result.value;
            var ids: any[] = result.identifiers;
            var cache: SortedCacheElement[] = [];
            var hasRange: boolean = false;
            // var multipleValuesPerElement: boolean = false;
            for (var i: number = 0; i < result.value.length && !hasRange; i++) {
                var d: any = data[i];
                if (attr in d) {
                    var proj: any[] = d[attr];
                    for (var j: number = 0; j < proj.length; j++) {
                        var p_j: any = proj[j]
                        if (typeof(p_j) === "number" && !isNaN(p_j)) {
                            cache.push({
                                key: p_j,
                                value: d,
                                index: i,
                                identifier: ids === undefined? undefined: ids[i]
                            });
                        } else if (p_j instanceof RangeValue) {
                            hasRange = true;
                        }
                    }
                    // if (j > 1) {
                    //     multipleValuesPerElement = true;
                    // }
                }
            }
            // TODO: store multipleValuesPerElement
            result.simpleQueryCache.cache[cacheId] = hasRange? undefined:
                cache.sort(SortedCacheElement.compareNumericKeys2);
        }
        if (result.simpleQueryCache.cache[cacheId] !== undefined) {
            this.lowestIndexInCache = binarySearchMin(
                result.simpleQueryCache.cache[cacheId], this.comp.min,
                SortedCacheElement.compareNumericKeys1);
            this.highestIndexInCache = binarySearchMax(
                result.simpleQueryCache.cache[cacheId], this.comp.max,
                SortedCacheElement.compareNumericKeys1);
        } else {
            this.lowestIndexInCache = undefined;
            this.highestIndexInCache = undefined;
        }
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        this.checkCache(result);
        if (this.lowestIndexInCache !== undefined) {
            var low: number = this.comp.min === -Infinity? 0:
                              this.lowestIndexInCache >= 0? (this.comp.closedLower?
                                                             this.lowestIndexInCache:
                                                             this.lowestIndexInCache + 1):
                              -this.lowestIndexInCache - 1;
            var high: number = this.comp.max === Infinity? result.value.length:
                               this.highestIndexInCache >= 0? (this.comp.closedUpper?
                                                               this.highestIndexInCache + 1:
                                                               this.highestIndexInCache):
                               -this.highestIndexInCache - 1;
            return SortedCacheElement.extractResultRange(result, selectedIdentifiers, result.simpleQueryCache.cache["range_" + this.attr], low, high);
        } else {
            return this.execute(result.value, result.identifiers, selectedIdentifiers, selectedPositions, undefined);
        }
    }
}

var gSimpleQueryMap: WeakMap<any, SimpleQuery>;

function makeSimpleQuery(query: any, queryIds: any[]): SimpleQuery {
    var simpleType: string;
    var sq: SimpleQuery = undefined;

    // Keep queries in a weak map. That saves a bit, in particular on large
    // "flat const" queries. Note that simple values cannot be stored in a
    // WeakMap.
    if (query instanceof Object) {
        if (gSimpleQueryMap === undefined) {
            // This is a work-around for nodejs: no easy initialization of
            // WeakMap earlier, and also no simple values in call to .has().
            gSimpleQueryMap = new WeakMap<any, SimpleQuery>();
        } else if (gSimpleQueryMap.has(query)) {
            return gSimpleQueryMap.get(query);
        }
    }

    function findSingleSimpleType(q: any[]): string {
        var t: string;

        for (var i: number = 0; i < q.length; i++) {
            var ti: string = typeof(q[i]);
            if (ti === "number" || ti === "string") {
                ti = "simple";
            } else if (q[i] instanceof ElementReference) {
                ti = "elementReference";
            }
            if (t === undefined) {
                t = ti;
            } else if (t !== ti) {
                return undefined;
            }
        }
        return t;
    }

    function makeSimpleRangeSelection(query: RangeValue): SimpleQuery {
        return query.closedLower && query.closedUpper?
                   new SimpleRangeCCSelection(query):
               query.closedLower && !query.closedUpper?
                   new SimpleRangeCOSelection(query):
               !query.closedLower && query.closedUpper?
                   new SimpleRangeOCSelection(query):
                   new SimpleRangeOOSelection(query);
    }

    query = singleton(query);
    if (!(query instanceof Array) && isAV(query)) {
        var keys: string[] = Object.keys(query);
        if (keys.length === 0) { // query = {}
            sq = new SimplePassThrough();
        } else {
            var selections: SimpleQuery[] = [];
            var projection: SimpleQuery = undefined;
            for (var i: number = 0; i < keys.length; i++) {
                var attr: string = keys[i];
                var comp: any = singleton(query[attr]);
                if (comp === _) { // query = {attr: _}
                    if (projection === undefined) {
                        projection = new SingleAttributeProjection(attr);
                    } else {
                        // allow one projection
                        break;
                    }
                } else if (comp instanceof RangeValue) { // query = {attr: r(...)}
                    selections.push(new SingleAttributeRangeSelection(attr, comp));
                } else if (comp instanceof SubStringQuery) { // query = {attr: s(...)}
                    selections.push(new SingleAttributeSubStringQuery(attr, comp));
                } else if (comp === true) { // query = {attr: true}
                    selections.push(new SingleAttributeTrueSelection(attr));
                } else if (comp === false) { // query = {attr: false}
                    selections.push(new SingleAttributeFalseSelection(attr));
                } else if (comp instanceof Array && comp.length === 0) { // query = {attr: o()}
                    // Cannot match anything
                    selections = [new SimpleSelectNone()];
                    sq = selections[0]; // In case this is not the last element
                    break;
                } else if (comp instanceof Negation) { // query = {attr: n(...)}
                    comp = singleton(comp.queries);
                    if (isSimpleType(comp)) { // e.g. query = {attr: n(3)}
                        selections.push(new SingleAttributeSimpleValueInvSelection(attr, comp));
                    } else if (findSingleSimpleType(comp) === "simple") { // e.g. query = {attr: n(1,2,3)}
                        selections.push(new SingleAttributeSimpleValueInvMultipleSelection(attr, comp));
                    } else if (comp instanceof Array && comp.length === 0) { // e.g. query = {attr: n()}
                        selections.push(new SingleAttributeSelection(attr));
                    } else {
                        break;
                    }
                } else if (isSimpleType(comp)) { // e.g. query = {attr: 3}
                    selections.push(new SingleAttributeSimpleValueSelection(attr, comp));
                } else if (findSingleSimpleType(comp) === "simple") { // e.g. query = {attr: o(1,2,3)}
                    selections.push(new SingleAttributeSimpleValueMultipleSelection(attr, comp));
                // DoubleAttributeProjection disabled because of problem with write path
                // } else if (typeof(comp) === "object" && !(comp instanceof NonAV)) {
                //     var keys2: string[] = Object.keys(comp);
                //     if (keys2.length === 1 && singleton(comp[keys2[0]]) === _) {
                //         if (projection === undefined) {
                //             projection = new DoubleAttributeProjection(attr, keys2[0]);
                //         } else {
                //             // allow one projection
                //             break;
                //         }
                //     }
                } else {
                    break;
                }
            }
            if (i === keys.length) {
                // All have been assigned
                if (projection !== undefined) {
                    selections.push(projection); // Make projection final step
                }
                sq = selections.length === 1?
                     selections[0]: new SimpleQueryChain(selections);
            }
        }
    } else if (query instanceof Negation) {
        var nquery: any[] = query.queries;
        if (nquery.length === 0) { // query = n()
            sq = new SimplePassThrough();
        } else {
            if (findSingleSimpleType(nquery) === "simple") {
                sq = new SimpleValueInvMultipleSelection(nquery);
            } else if (nquery.length === 1 && isAV(nquery[0])) {
                var keys: string[] = Object.keys(nquery[0]);
                if (keys.length === 0) { // nquery = n({})
                    sq = new SimpleSelectNone();
                } else if (keys.length === 1) { // nquery = n({attr: ...})
                    var attr: string = keys[0];
                    var comp: any = singleton(nquery[0][attr]);
                    if (comp === true) { // nquery = n({attr: true})
                        sq = new SingleAttributePresentFalseSelection(attr);
                    }
                }
            }
        }
        if (sq === undefined) {
            var simpleQueries: SimpleQuery[] = [];
            for (var i: number = 0; i < nquery.length; i++) {
                var sub: SimpleQuery = makeSimpleQuery(nquery[i], undefined);
                if (sub !== undefined) {
                    simpleQueries.push(sub);
                } else {
                    break;
                }
            }
            if (i === nquery.length) {
                sq = new SimpleNegation(simpleQueries);
            }
        }
    } else if (!(query instanceof Array)) {
        if (query === _) {
            return new SimplePassThrough();
        } else if (query === undefined) {
            return new SimpleSelectNone();
        } else if (query instanceof RangeValue) {
            sq = makeSimpleRangeSelection(query);
        } else if (query === true) {
            return new SimpleTrueSelection();
        } else if (query === false || query === undefined) {
            return new SimpleFalseSelection();
        } else if (isSimpleType(query)) {
            return new SimpleValueSelection(query);
        } else if (query instanceof ElementReference) {
            return new ElementReferenceSelection(query);
        } else if (query instanceof SubStringQuery) {
            return new SimpleSubstringSelection(query);
        }
    } else if (query.length === 0) {
        sq = new SimpleSelectNone();
    } else if ((simpleType = findSingleSimpleType(query)) !== undefined) {
        switch (simpleType) {
          case "simple":
            sq = new SimpleValueMultipleSelection(query);
            break;
          case "elementReference":
            sq = new ElementReferenceMultipleSelection(query);
            break;
          case "boolean":
            if (isTrue(query)) {
                sq = new SimpleTrueSelection();
            } else {
                sq = new SimpleFalseSelection();
            }
            break;
        }
    } else {
        sq = orOfSimpleQueries(query);
    }
    gSimpleQueryMap.set(query, sq);
    if (sq === undefined && showRuntimeWarnings) {
        console.log("warning: no simple query for", vstringify(query));
    }
    return sq;
}

function orOfSimpleQueries(q: any[]): SimpleQuery {
    var sq: SimpleQuery[] = [];

    for (var i: number = 0; i < q.length; i++) {
        var sq_i: SimpleQuery = makeSimpleQuery(q[i], undefined);
        if (sq_i === undefined || sq_i.isProjection()) {
            return undefined;
        }
        sq.push(sq_i);
    }
    return new SimpleOrSelection(sq);
}

class SimpleQueryInterpretedQuery implements SimpleQuery {
    query: any;

    constructor(query: any) {
        this.query = getDeOSedValue(query); // getDeOSedValue for efficiency
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SimpleQueryInterpretedQuery"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            var q: any = interpretedQuery(this.query, data[i]);
            if (q !== undefined) {
                if (q === data[i]) { // It's a selection
                    if (identifiers !== undefined) {
                        selectedIdentifiers.push(identifiers[i]);
                    }
                    r.push(q);
                } else {
                    if (q instanceof Array) {
                        if (q.length === 1) {
                            r.push(q[0]);
                        } else if (q.length > 1) {
                            r = cconcat(r, q);
                        }
                    } else {
                        r.push(q);
                    }
                }
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return interpretedBoolMatch(this.query, data);
    }

    testOS(data: any[]): boolean {
        return interpretedBoolMatch(this.query, data);
    }

    isEqual(sq: SimpleQuery): boolean {
        return sq instanceof SimpleQueryInterpretedQuery &&
           objectEqual(this.query, (<SimpleQueryInterpretedQuery>sq).query);
    }

    isProjection(): boolean {
        return nrProjSitesInQuery(this.query) > 0;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

// TODO: allow projections
class SimpleOrSelection implements SimpleQuery {
    simpleQueries: SimpleQuery[];

    constructor(sq: SimpleQuery[]) {
        this.simpleQueries = sq;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SimpleOrSelection"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            if (this.testSingle(data[i])) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data[i]);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    testSingle(data: any): boolean {
        return this.simpleQueries.some(function(sq: SimpleQuery): boolean {
            return sq.testSingle(data);
        });
    }

    testOS(data: any[]): boolean {
        return this.simpleQueries.some(function(sq: SimpleQuery): boolean {
            return sq.testOS(data);
        });
    }

    // Test is too strict: the same queries in another order should yield true
    isEqual(sq: SimpleQuery): boolean {
        if (sq instanceof SimpleOrSelection) {
            if (sq.simpleQueries.length !== this.simpleQueries.length) {
                return false;
            }
            for (var i: number = 0; i < this.simpleQueries.length; i++) {
                if (!this.simpleQueries[i].isEqual(sq.simpleQueries[i]))
                    return false;
            }
        }
        return false;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

// A chain (sequence/and) of simple queries, possibly ending in a projection
class SimpleQueryChain implements SimpleQuery {
    simpleQueries: SimpleQuery[];

    constructor(sq: SimpleQuery[]) {
        this.simpleQueries = sq;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SimpleQueryChain"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = data;
        var r_ids: any[] = identifiers;
        var r_dataPos: DataPosition[] = dataPositions;
        var r_selIds: any[];
        var r_selPos: DataPosition[];

        for (var i: number = 0; r.length !== 0 && i < this.simpleQueries.length; i++) {
            if (i === this.simpleQueries.length - 1) {
                r_selIds = selectedIdentifiers;
                r_selPos = selectedPositions;
            } else {
                r_selIds = identifiers === undefined? undefined: [];
                r_selPos = selectedPositions === undefined? undefined: [];
            }
            r = this.simpleQueries[i].execute(r, r_ids, r_selIds, r_selPos, r_dataPos);
            r_ids = r_selIds;
            r_dataPos = r_selPos;
        }
        return r;
    }

    testSingle(data: any): boolean {
        return this.simpleQueries.every(function(sq: SimpleQuery): boolean {
            return sq.testSingle(data);
        });
    }

    testOS(data: any[]): boolean {
        return this.simpleQueries.every(function(sq: SimpleQuery): boolean {
            return sq.testOS(data);
        });
    }

    // Test is too strict: the same queries in another order should yield true
    isEqual(sq: SimpleQuery): boolean {
        if (sq instanceof SimpleQueryChain) {
            if (sq.simpleQueries.length !== this.simpleQueries.length) {
                return false;
            }
            for (var i: number = 0; i < this.simpleQueries.length; i++) {
                if (!this.simpleQueries[i].isEqual(sq.simpleQueries[i]))
                    return false;
            }
        }
        return false;
    }

    isProjection(): boolean {
        return this.simpleQueries.length > 1 &&
               this.simpleQueries[this.simpleQueries.length - 1].isProjection();
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

// Negates the sub-queries
class SimpleNegation implements SimpleQuery {
    simpleQueries: SimpleQuery[];

    constructor(sq: SimpleQuery[]) {
        this.simpleQueries = sq;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SimpleNegation"});
    }

    execute(data: any[], identifiers: any[], selectedIdentifiers: any[], selectedPositions: DataPosition[], dataPositions: DataPosition[]): any[] {
        var r: any[] = [];

        for (var i: number = 0; i !== data.length; i++) {
            if (this.testSingle(data[i])) {
                if (identifiers !== undefined) {
                    selectedIdentifiers.push(identifiers[i]);
                }
                r.push(data[i]);
                if (selectedPositions !== undefined) {
                    selectedPositions.push(dataPositions !== undefined? dataPositions[i]: new DataPosition(i, 1));
                }
            }
        }
        return r;
    }

    // Returns true when none of the sub-queries matches data
    testSingle(data: any): boolean {
        return this.simpleQueries.every(function(sq: SimpleQuery): boolean {
            return !sq.testSingle(data);
        });
    }

    testOS(data: any[]): boolean {
        return this.simpleQueries.every(function(sq: SimpleQuery): boolean {
            return !sq.testOS(data);
        });
    }

    // Test is too strict: the same queries in another order should yield true
    isEqual(sq: SimpleQuery): boolean {
        if (sq instanceof SimpleNegation) {
            if (sq.simpleQueries.length !== this.simpleQueries.length) {
                return false;
            }
            for (var i: number = 0; i < this.simpleQueries.length; i++) {
                if (!this.simpleQueries[i].isEqual(sq.simpleQueries[i]))
                    return false;
            }
        }
        return false;
    }

    isProjection(): boolean {
        return false;
    }

    canCache(): boolean {
        return false;
    }

    executeAndCache(result: Result, selectedIdentifiers: any[], selectedPositions: DataPosition[]): any[] {
        Utilities.error("do not call");
        return undefined;
    }
}

// When makeSimpleQuery fails, it returns an object that calls
// interpretedQuery. This is not efficient, but provides a uniform
// interface for use in compiled queries.
function makeSimpleQueryDefault(query: any, queryIds: any[]): SimpleQuery {
    var sq: SimpleQuery = makeSimpleQuery(query, queryIds);

    return sq !== undefined? sq: new SimpleQueryInterpretedQuery(query);
}

// When the query has ids and is not a projection, the query is wrapped in
// an IdentityQuery, which selects purely by identity.
function makeSimpleQueryWithId(query: any, queryIds: any[]): SimpleQuery {
    if (queryIds === undefined) {
        return makeSimpleQueryDefault(query, undefined);
    } else {
        return new IdentityQuery(queryIds, query);
    }
}
