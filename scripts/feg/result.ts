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

/// <reference path="dataSource.ts" />
/// <reference path="functionNode.ts" />

// Possible extensions:
// - incremental changes
// - pointers to original object/value

type CompiledQuery =
    (v: any, args: SimpleQuery[], allIds?: any[], selectedIds?: any[]) => any;

class QueryCache {
    // Pointer to the result for which the cache is valid
    result: any[];

    // Cache ordered by some query id.
    cache: {[id: string]: any};

    constructor(result: any[]) {
        this.result = result;
        this.cache = {};
    }
}

// The Javascript representation of the value; should always be present
// and up to date in the current design. Apart from a value, it can also
// carry "compiledQuery", which is the function that implements the query
// represented by value[0]. Future extensions are write paths and incremental
// updates.
class Result {

    // A value is an array of simple values or attribute-values, where under
    // each attribute we find a similar structure, unless the context
    // requires a simple or attribute value. This only happens for the display,
    // position and stacking sections, which cannot be queried.
    value: any;
    
    // LABELS: any kind of extra information about a value

    // If value is used as a query, this is the function that implements it.
    // This is not left undefined, but rather deleted when absent.
    compiledQuery?: CompiledQuery[];
    // And the arguments that should  be passed along; these are SimpleQuery
    // objects constructed from the argument values
    queryArguments?: SimpleQuery[][];
    // And the number of values that are represented by each compiled query
    nrQueryElements?: number[];
    // And the places where writes should go. For interpretation, see
    // CompiledQueryInfo.
    writePaths?: any;

    // merge attributes indicate specific paths in the value (assuming it is
    // an AV) that have special merge properties, such as atomic or push.
    // If there is a single element in the mergeAttributes array, it applies
    // to the whole ordered set of values. If there is more than a single
    // element in mergeAttributes, the merge attributes apply for each value
    // in the ordered set of values separately (this only makes sense for
    // merge by identification, otherwise, if the value is an ordered set
    // of size > 1, the merge is anyway atomic). In this case, even if the
    // merge attributes are only defined for the first element in the ordered
    // set, the array under mergedAttributes will be set to have the same
    // length as the value ordered set.
    mergeAttributes?: MergeAttributes[];
    // If true, identities should be ignored. This flag is not copied, so
    // use it only directly in the area set data expression.
    anonymize?: boolean;

    // The identifiers for the values in the result
    identifiers?: any[];

    // Label for generating unique identifiers
    uniqueIdPrefix?: string;

    // Label for data sources
    dataSource?: DataSourceComposable;

    // Label to indicate the status of app data or external sources (foreign
    // interfaces). Its value can be
    // "local": locally initialized or written
    // "remote": in sync with server/foreign interface
    // "waiting": waiting for server/foreign interface to return app state
    // "error": not properly synced to server or error during execution
    remoteStatus?: string;

    // Counter for generating unique identifiers
    static nextUniqueIdPrefix: number = 0;

    // The following are precursors to incremental updates. They are currently
    // only set by the areaMonitor (and it even doesn't use "modified").
    // The incremental flag is reset after a call to eval that returns true.
    incremental?: boolean;
    added?: any[];
    modified?: any[];
    removed?: any[];

    // Points at the foreign interface that is under this path.
    foreignInterfaceSource?: ForeignInterface;

    // This is space that can be used by a SimpleQuery for caching and sharing
    // information across similar operations on the same result.
    simpleQueryCache?: QueryCache;

    constructor(v: any = undefined) {
        this.value = v;
    }

    size(): number {
        return this.value instanceof Array? this.value.length:
            this.value === undefined? 0: 1;
    }

    // Expressions that copy results should also copy labels, and make sure that
    // they are removed when the input removes them.

    copy(r: Result): void {
        this.value = r.value;
        this.mergeAttributes = r.mergeAttributes;
        if ("incremental" in r) {
            this.incremental = r.incremental;
            this.added = r.added;
            this.modified = r.modified;
            this.removed = r.removed;
        } else if ("incremental" in this) {
            delete this.incremental;
            delete this.added;
            delete this.modified;
            delete this.removed;
        }
        this.copyLabels(r);
    }

    clone(): Result {
        var r: Result = new Result();

        r.copy(this);
        return r;
    }

    copyMinusUndefinedValues(r: Result): void {
        var values: any[] = r.value;
        var ids: any[] = r.identifiers;
        var res: any[];

        if (values === undefined) {
            this.value = undefined;
            this.resetLabels();
        }
        if (ids === undefined) {
            res = [];
            for (var i: number = 0; i < values.length; i++) {
                if (values[i] !== undefined) {
                    res.push(values[i]);
                }
            }
            this.value = res;
            if ("identifiers" in this) {
                delete this.identifiers;
            }
        } else {
            var nids: any[] = [];
            res = [];
            for (var i: number = 0; i < values.length; i++) {
                if (values[i] !== undefined) {
                    res.push(values[i]);
                    nids.push(ids[i]);
                }
            }
            this.value = res;
            this.copyLabels(r);
            this.identifiers = nids;
        }
        if ("dataSource" in r) {
            this.dataSource = r.dataSource;
        } else if ("dataSource" in this) {
            delete this.dataSource;
        }
    }
    
    resetLabels(): void {
        if ("compiledQuery" in this) {
            delete this.compiledQuery;
        }
        if ("queryArguments" in this) {
            delete this.queryArguments;
        }
        if ("nrQueryElements" in this) {
            delete this.nrQueryElements;
        }
        if ("writePaths" in this) {
            delete this.writePaths;
        }
        if ("mergeAttributes" in this) {
            delete this.mergeAttributes
        }
        if ("identifiers" in this) {
            delete this.identifiers;
        }
        if ("dataSource" in this) {
            delete this.dataSource;
        }
        if ("remoteStatus" in this) {
            delete this.remoteStatus;
        }
        if ("foreignInterfaceSource" in this) {
            delete this.foreignInterfaceSource;
        }
        if ("anonymize" in this) {
            delete this.anonymize;
        }
    }

    copyLabelsMinusDataSource(r: Result, ignoreDS: boolean = false): void {
        if (r === undefined) {
            this.resetLabels();
            return;
        }
        if ("compiledQuery" in r) {
            this.compiledQuery = r.compiledQuery;
        } else if ("compiledQuery" in this) {
            delete this.compiledQuery;
        }
        if ("queryArguments" in r) {
            this.queryArguments = r.queryArguments;
        } else if ("queryArguments" in this) {
            delete this.queryArguments;
        }
        if ("nrQueryElements" in r) {
            this.nrQueryElements = r.nrQueryElements;
        } else if ("nrQueryElements" in this) {
            delete this.nrQueryElements;
        }
        if ("writePaths" in r) {
            this.writePaths = r.writePaths;
        } else if ("writePaths" in this) {
            delete this.writePaths;
        }
        if("mergeAttributes" in r && r.mergeAttributes !== undefined) {
            this.mergeAttributes = r.mergeAttributes.slice(0)
        } else if ("mergeAttributes" in this) {
            delete this.mergeAttributes
        }
        if ("identifiers" in r) {
            this.identifiers = r.identifiers;
        } else if ("identifiers" in this) {
            delete this.identifiers;
        }
        if (!ignoreDS && "dataSource" in this) {
            delete this.dataSource;
        }
        if ("remoteStatus" in r) {
            this.remoteStatus = r.remoteStatus;
        } else if ("remoteStatus" in this) {
            delete this.remoteStatus;
        }
        if ("foreignInterfaceSource" in r) {
            this.foreignInterfaceSource = r.foreignInterfaceSource;
        } else if ("foreignInterfaceSource" in this) {
            delete this.foreignInterfaceSource;
        }
        if ("anonymize" in r) {
            this.anonymize = r.anonymize;
        } else if ("anonymize" in this) {
            delete this.anonymize;
        }
    }

    copyLabels(r: Result): void {
        if (r === undefined) {
            return;
        }
        this.copyLabelsMinusDataSource(r, true);
        if ("dataSource" in r) {
            this.dataSource = r.dataSource;
        } else if ("dataSource" in this) {
            delete this.dataSource;
        }
    }

    copyConst(v: ConstNode): void {
        this.value = v.value;
        if ("compiledQuery" in v) {
            this.compiledQuery = [v.compiledQuery.compiledFunction];
            this.queryArguments = [];
            this.nrQueryElements = [];
        } else if ("compiledQuery" in this) {
            delete this.compiledQuery;
            delete this.queryArguments;
            delete this.nrQueryElements;
        }
    }

    set(v: any): void {
        this.value = v;
        if ("compiledQuery" in this) {
            delete this.compiledQuery;
        }
        if ("queryArguments" in this) {
            delete this.queryArguments;
        }
        if ("nrQueryElements" in this) {
            delete this.nrQueryElements;
        }
        if ("writePaths" in this) {
            delete this.writePaths;
        }
        if("mergeAttributes" in this) {
            delete this.mergeAttributes;
        }
        if ("identifiers" in this) {
            delete this.identifiers;
        }
        if ("dataSource" in this) {
            delete this.dataSource;
        }
        if ("remoteStatus" in this) {
            delete this.remoteStatus;
        }
        if ("foreignInterfaceSource" in this) {
            delete this.foreignInterfaceSource;
        }
        if ("anonymize" in this) {
            delete this.anonymize;
        }
    }

    setIdentifiers(identifiers: any[]): void {
        if (identifiers !== undefined) {
            this.identifiers = identifiers;
        } else if ("identifiers" in this) {
            delete this.identifiers;
        }
    }

    getLabels(): any {
        var labels: any = undefined;

        if ("anonymize" in this) {
            if (labels === undefined) {
                labels = {anonymize: this.anonymize};
            } else {
                labels.anonymize = this.anonymize;
            }
        }
        if ("compiledQuery" in this) {
            if (labels === undefined) {
                labels = {compiledQuery: this.compiledQuery};
            } else {
                labels.compiledQuery = this.compiledQuery;
            }
            if ("queryArguments" in this) {
                labels.queryArguments = this.queryArguments;
            }
            if ("nrQueryElements" in this) {
                labels.nrQueryElements = this.nrQueryElements;
            }
            if ("writePaths" in this) {
                labels.writePaths = this.writePaths;
            }
        }
        if ("mergeAttributes" in this) {
            if (labels === undefined) {
                labels = {mergeAttributes: this.mergeAttributes};
            } else {
                labels.mergeAttributes = this.mergeAttributes;
            }
        }
        if ("identifiers" in this) {
            if (labels === undefined) {
                labels = {identifiers: this.identifiers};
            } else {
                labels.identifiers = this.identifiers;
            }
        }
        if ("dataSource" in this) {
            if (labels === undefined) {
                labels = {dataSource: this.dataSource};
            } else {
                labels.dataSource = this.dataSource;
            }
        }
        if ("remoteStatus" in this) {
            if (labels === undefined) {
                labels = {remoteStatus: this.remoteStatus};
            } else {
                labels.remoteStatus = this.remoteStatus;
            }
        }
        if ("foreignInterfaceSource" in this) {
            if (labels === undefined) {
                labels = {foreignInterfaceSource: this.foreignInterfaceSource};
            } else {
                labels.foreignInterfaceSource = this.foreignInterfaceSource;
            }
        }
        return labels;
    }

    hasLabels(): boolean {
        return "compiledQuery" in this ||
               "queryArguments" in this || "nrQueryElements" in this ||
               "writePaths" in this || "mergeAttributes" in this ||
               "identifiers" in this ||
               "anonymize" in this ||  "dataSource" in this ||
               "remoteStatus" in this || "foreignInterfaceSource" in this;
    }

    equalLabels(lbls: any): boolean {
        return (lbls === undefined &&
                this.compiledQuery === undefined &&
                this.queryArguments === undefined &&
                this.nrQueryElements === undefined &&
                this.writePaths === undefined &&
                this.mergeAttributes === undefined &&
                this.identifiers === undefined &&
                this.dataSource === undefined &&
                this.remoteStatus === undefined &&
                this.foreignInterfaceSource === undefined &&
                this.anonymize === undefined) ||
            (lbls !== undefined &&
             this.compiledQuery === lbls.compiledQuery &&
             array2Equal(this.queryArguments, lbls.queryArguments) &&
             objectEqual(this.nrQueryElements, lbls.nrQueryElements) &&
             objectEqual(this.writePaths, lbls.writePaths) &&
             objectEqual(this.mergeAttributes, lbls.mergeAttributes) &&
             valueEqual(this.identifiers, lbls.identifiers) &&
             this.dataSource === lbls.dataSource &&
             this.remoteStatus === lbls.remoteStatus &&
             this.foreignInterfaceSource === lbls.foreignInterfaceSource &&
             this.anonymize === lbls.anonymize);
    }

    // Tests if two results are equal
    equal(r: Result): boolean {
        return this.equalLabels(r) && valueEqual(this.value, r.value);
    }

    // Returns a result consisting of "length" elements from this result,
    // starting at "pos", including the labels. Range check is responsibility of
    // the caller. Note that value can be undefined for compiled queries.
    sub(pos: number, length: number = 1): Result {
        var res: Result = new Result(this.value !== undefined? this.value.slice(pos, pos + length): []);

        if ("compiledQuery" in this) {
            res.compiledQuery = this.compiledQuery.slice(pos, pos + length);
            if ("queryArguments" in this) {
                res.queryArguments = this.queryArguments.slice(pos, pos + length);
            }
            if ("nrQueryElements" in this) {
                res.nrQueryElements = this.nrQueryElements.slice(pos, pos + length);
            }
            if ("writePaths" in this) {
                res.writePaths = this.writePaths;
            }
        }
        if("mergeAttributes" in this && this.mergeAttributes !== undefined){
            res.mergeAttributes = this.mergeAttributes.length > 1 ?
                this.mergeAttributes.slice(pos, pos + length) :
                this.mergeAttributes.slice(0)
        }
        if ("identifiers" in this && this.identifiers !== undefined) {
            res.identifiers = this.identifiers.slice(pos, pos + length);
        }
        if ("anonymize" in this) {
            res.anonymize = this.anonymize;
        }
        return res;
    }

    // getUniqueIdPrefix(): string {
    //     if (!("uniqueIdPrefix" in this)) {
    //         this.uniqueIdPrefix = "R" + String(Result.nextUniqueIdPrefix++) + "_";
    //     }
    //     return this.uniqueIdPrefix;
    // }

    // Generates unique ids for the elements in this.value. The id is the value
    // itself when it is a simple value, or a local unique id as a prefix and
    // the position in the array. These identifiers are accessible to other
    // functions, but only simple values can have the same identity as elements
    // from another os.
    getIdentifiers(): any[] {
        // if (this.value === undefined) {
        //     return [];
        // }
        // if (!("identifiers" in this)) {
        //     var idPref: string = this.getUniqueIdPrefix();
        //     this.identifiers = this.value.map(function(v: any, i: number): string {
        //         return typeof(v) !== "object"? v:
        //                v instanceof ElementReference? v.getElement():
        //                idPref + i;
        //     });
        // }
        // return this.identifiers;
        var identifiers = this.identifiers;
        if(identifiers === undefined) {
            // create an array with one entry for each value, where all
            // identities are undefined 
            identifiers = [];
            identifiers.length = this.value.length;
        } else if(identifiers.length < this.value.length) {
            identifiers = identifiers.slice(0);
            identifiers.length = this.value.length;
        }
        return identifiers;
    }

    // Doesn't test all labels, only value, identifiers and dataSource
    isEqual(r: Result): boolean {
        if (!valueEqual(this.value, r.value) ||
              !valueEqual(this.identifiers, r.identifiers)) {
            return false;
        }
        if ("dataSource" in this || "dataSource" in r) {
            return "dataSource" in this && "dataSource" in r &&
                   this.dataSource.isEqual(r.dataSource);
        }
        return true;
    }

    isLargerThan(n: number, recursive: boolean): boolean {
        return this.value === undefined? false:
            "identifiers" in this? this.identifiers.length >= n:
            countObjSize(this.value, recursive) >= n;
    }

    containsDefun(): boolean {
        return this.value.some(function(v: any): boolean {
            return v instanceof DefunReference;
        })
    }

    isEmpty(): boolean {
        return !("dataSource" in this) && 
               (this.value === undefined ||
                (this.value instanceof Array && this.value.length === 0));
    }

    // The whole result is at an atomic merge path
    isAtomic(): boolean {
        return this.mergeAttributes !== undefined &&
            this.mergeAttributes.length == 1 &&
            this.mergeAttributes[0] !== undefined &&
            this.mergeAttributes[0].atomic === true;
    }

    // The whole result is at a push merge path
    isPush(): boolean {
        return this.mergeAttributes !== undefined &&
            this.mergeAttributes.length == 1 &&
            this.mergeAttributes[0] !== undefined &&
            this.mergeAttributes[0].push === true;
    }
}

enum WriteMode {
    replace,
    merge
}

// Contains paths to the points where a merge operations should apply push
// or atomic. The paths are represented in an av structure, so multiple paths
// can apply at the same time. Push/atomic is applied where a path ends in
// true.
class MergeAttributes {
    push: any;
    atomic: any;

    constructor(push: any, atomic: any) {
        this.push = push;
        this.atomic = atomic;
    }

    notEmpty(): boolean {
        return <boolean> (this.push || this.atomic)
    }
    
    // Prefix the push and atomic paths with the write path so at merge time
    // it's known where to push/atomic
    extendWithPath(path: string[]): MergeAttributes {

        function extendObjWithPath(obj: any): any {
            if (obj !== undefined) {
                for (var i: number = path.length - 1; i >= 0; i--) {
                    var pathToObj: any = {};
                    pathToObj[path[i]] = obj;
                    obj = pathToObj;
                }
            }
            return obj;
        }

        return path === undefined? this:
               new MergeAttributes(extendObjWithPath(this.push),
                                   extendObjWithPath(this.atomic)
        );
    }

    // 'atomic' is either true (if the given attribute is atomic) or
    // an existing object representing the atomic part of a MergeAttributes
    // object.
    addAtomicAttr(attr: string, atomic: any): void {
        if(!this.atomic || typeof(this.atomic) != "object")
            this.atomic = {};
        this.atomic[attr] = atomic;
    }

    // 'push' is either true (if the given attribute has a push) or
    // an existing object representing the push part of a MergeAttributes
    // object.
    addPushAttr(attr: string, push: any): void {
        if(!this.push || typeof(this.push) != "object")
            this.push = {};
        this.push[attr] = push;
    }
    
    popPathElement(elt: string): MergeAttributes {
        return new MergeAttributes(
            this.push instanceof Object? this.push[elt]: undefined,
            this.atomic instanceof Object? this.atomic[elt]: undefined
        );
    }

    // Merge the paths in 'attributes' with those in this object and
    // return a new merged object (the copy is as shallow as possible).
    // When there are two directives at a path and its extension, the
    // directive at the shorter path makes the other meaningless.
    // Two different directives at the same path, however, conflict.
    // Therefore, after the merge, we prune the trees to keep only the
    // shortests paths, and if two trees contain the same path, we keep
    // that which comes from the 'this' object.
    
    copyMerge(attributes: MergeAttributes): MergeAttributes  {

        // merge the paths in a and b
        function mergePaths(a: any,b: any): any {
            if(b === true || a === true)
                return true;
            // merge common attributes and add attributes from b to a.
            var merged: any = {};
            for (var attr in a)
                merged[attr] = a[attr];
            for (var attr in b)
                merged[attr] = (attr in a) ? mergePaths(a[attr],b[attr]) : b[attr];
            
            return merged;
        }
        
        if(!attributes)
            return this;
        var mergedAttributes = new MergeAttributes(this.push, this.atomic);
        if(attributes.push) {
            mergedAttributes.push = this.push ?
                mergePaths(this.push, attributes.push) : attributes.push;
        }
        if(attributes.atomic) {
            mergedAttributes.atomic = this.atomic ?
                mergePaths(this.atomic,attributes.atomic) : attributes.atomic; 
        }

        if(this.push)
            mergedAttributes.prunePaths(this.push, "push");
        if(this.atomic)
            mergedAttributes.prunePaths(this.atomic, "atomic");
        
        return mergedAttributes;
    }

    prunePaths(pruningPaths: any, pruneByDirective: string): void {
        
        // returns the pruned tree (may be a copy)
        function prune(pruningPaths: any, prunedPaths: any): any {
            if(pruningPaths === undefined)
                return prunedPaths;
            if(pruningPaths === true)
                return undefined; // prune everything
            if(prunedPaths === true || prunedPaths === undefined)
                return prunedPaths;
            var copyPaths: any = undefined;
            for(var attr in pruningPaths) {
                if(!(attr in prunedPaths))
                    continue;
                var prunedAttr = prune(pruningPaths[attr],prunedPaths[attr]);
                if(prunedAttr !== prunedPaths[attr]) {
                    // pruning took place, must create a new object
                    if(copyPaths === undefined) { // create a shallow copy
                        copyPaths = {};
                        for(var origAttr in prunedPaths)
                            copyPaths[origAttr] = prunedPaths[origAttr];
                    }
                    copyPaths[attr] = prunedAttr;
                }
            }
            return copyPaths ? copyPaths : prunedPaths
        } // end auxiliary function
        
        for(var mergeDirective in this) {
            if(mergeDirective == pruneByDirective)
                continue; // this is the directive by which we are pruning
            if(this[mergeDirective] === undefined)
                continue; // nothing to prune
            this[mergeDirective] = prune(pruningPaths, this[mergeDirective]);
        }
    }
}

