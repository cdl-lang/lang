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
    (v: any, args: SimpleQuery[], allIds?: SubIdentifiers, selectedIds?: SubIdentifiers) => any;

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
    // Identifiers at lower paths (one entry per element in the value
    // ordered set)
    subIdentifiers?: any[];

    // Label for data sources
    dataSource?: DataSourceComposable;

    // Label to indicate the status of app data or external sources (foreign
    // interfaces). Its value can be
    // "local": locally initialized or written
    // "remote": in sync with server/foreign interface
    // "waiting": waiting for server/foreign interface to return app state
    // "error": not properly synced to server or error during execution
    remoteStatus?: string;

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
        if ("subIdentifiers" in this) {
            delete this.subIdentifiers;
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
        if ("subIdentifiers" in r) {
            this.subIdentifiers = r.subIdentifiers;
        } else if ("subIdentifiers" in this) {
            delete this.subIdentifiers;
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
        if ("subIdentifiers" in this) {
            delete this.subIdentifiers;
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

    setMergeAttributesUnderAttr(attr: string,
                                mergeAttributes: MergeAttributes[]): void {
        if(!mergeAttributes || mergeAttributes.length == 0)
            return;
        
        if(this.mergeAttributes === undefined)
            this.mergeAttributes = [new MergeAttributes(undefined, undefined)];
        
        this.mergeAttributes[0].addUnderAttr(attr, mergeAttributes);
    }
    
    setIdentifiers(identifiers: any[]): void {
        if (identifiers !== undefined) {
            this.identifiers = identifiers;
        } else if ("identifiers" in this) {
            delete this.identifiers;
        }
    }

    // sets both identifiers and sub-identifiers, depending on the input
    // (which may be an array (identifiers only) an A-V (sub-identifiers
    // only) or a SubIdentifiers object (both identifiers and sub-identifiers).
    // Empty arrays are considered equivalent to undefined.
    setSubIdentifiers(subIdentifiers: any): void {
        if(subIdentifiers === undefined) {
            if(this.identifiers)
                this.identifiers = undefined;
            if(this.subIdentifiers)
                this.subIdentifiers = undefined;
            return;
        }
        if(subIdentifiers instanceof SubIdentifiers) {
            if(subIdentifiers.identifiers && subIdentifiers.identifiers.length > 0)
                this.identifiers = subIdentifiers.identifiers;
            else if(this.identifiers !== undefined)
                this.identifiers = undefined;
            if(subIdentifiers.subIdentifiers && subIdentifiers.subIdentifiers.length > 0)
                this.subIdentifiers = subIdentifiers.subIdentifiers;
            else if(this.subIdentifiers !== undefined)
                this.subIdentifiers = undefined;
        } else if(subIdentifiers instanceof Array) {
            if(subIdentifiers.length > 0)
                this.identifiers = subIdentifiers;
            else if(this.identifiers !== undefined)
                this.identifiers = undefined;
            if(this.subIdentifiers)
                this.subIdentifiers = undefined;
        } else { // A-V and therefore represents sub-identifiers
            this.subIdentifiers = [subIdentifiers];
            if(this.identifiers)
                this.identifiers = undefined;
        }
    }

    // Add the given identifiers and sub-identifiers as sub-identifiers
    // under the given attribute. One of the two input arrays may be
    // undefined, but if both are defined, both are expected to have the same
    // length.
    
    addSubIdentifiersUnderAttr(attr: string, identifiers: any[],
                               subIdentifiers: any[]): void
    {
        if(!identifiers && !subIdentifiers)
            return;

        var attrSubIdentifiers: any;

        if(subIdentifiers) {
            if(identifiers || subIdentifiers.length > 1) {
                attrSubIdentifiers =
                    new SubIdentifiers(identifiers, subIdentifiers);
            } else
                attrSubIdentifiers = subIdentifiers[0];
        } else
            attrSubIdentifiers = identifiers;

        if(this.subIdentifiers === undefined)
            this.subIdentifiers = [{}];
        this.subIdentifiers[0][attr] = attrSubIdentifiers; 
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
        if ("subIdentifiers" in this) {
            if (labels === undefined) {
                labels = {subIdentifiers: this.subIdentifiers};
            } else {
                labels.subIdentifiers = this.subIdentifiers;
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
               "identifiers" in this || "subIdentifiers" in this ||
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
                this.subIdentifiers === undefined &&
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
             valueEqual(this.subIdentifiers, lbls.subIdentifiers) &&
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
        if ("subIdentifiers" in this && this.subIdentifiers !== undefined) {
            res.subIdentifiers = this.subIdentifiers.slice(pos, pos + length);
        }
        if ("anonymize" in this) {
            res.anonymize = this.anonymize;
        }
        return res;
    }

    // Return a array of identifiers. This function makes sure that the array
    // returned has the same length as the number of elements in the value
    // (ordered set). If needed, the array is padded by undefined elements.
    
    getIdentifiers(): any[] {
        if(this.value === undefined)
            return [];
        var identifiers = this.identifiers;
        var length = (this.value instanceof Array) ? this.value.length : 1;
        
        if(identifiers === undefined) {
            // create an array with one entry for each value, where all
            // identities are undefined 
            identifiers = [];
            identifiers.length = length;
        } else if(identifiers.length < length) {
            identifiers = identifiers.slice(0);
            identifiers.length = length;
        }
        return identifiers;
    }

    // Doesn't test all labels, only value, identifiers and dataSource
    isEqual(r: Result): boolean {
        if (!valueEqual(this.value, r.value) ||
            !valueEqual(this.identifiers, r.identifiers) ||
            !valueEqual(this.subIdentifiers, r.subIdentifiers)) {
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
// An attribute in this a-v strcture can also hold an array. Each entry in
// the array may then store an a-v structure representing paths which are
// atomic/push. Such an array only appears at a path corresponding to
// identified elements (this is because if at that path there is more than
// one element but the elements are not identified merging is anyway atomic
// (or push) for the ordered set of elements as a whole (since there is
// no way to align them for merging). This means that where there are no
// identifiers, on can process the MergeAttributes object under the assumption
// that the value under each attribute is either an a-v or 'true'.
// No array can appear directly at the top of this structure (under 'push'
// or 'atomic'). If the elements at this level are identified and have
// different merge attributes these are stored as seperate MergeAttributes
// objects (in an array).

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

    // Add the given merge attributes under the given attribute of this
    // MergeAttributes object. This would overwrite any other values
    // under that attribute (the assumption is that there aren't any).
    // If 'attributes' contains a single MergeAttributes object, its
    // atomic/push structure are added as is under 'attr'. If
    // 'attributes' more than one entry, all the atomic entries are collected
    // into an array and all the push entries are collected into an array
    // and these arrays are placed under the attribute.
    addUnderAttr(attr: string, attributes :MergeAttributes[]): void
    {
        if(!attributes || attributes.length == 0)
            return;

        var push: any = undefined;
        var atomic: any = undefined;

        if(attributes.length == 1) {
            if(attributes[0] !== undefined) {
                push = attributes[0].push;
                atomic = attributes[0].atomic;
            }
        } else {
            push = attributes.map(x => x ? x.push : undefined);
            if(!push.some((x: any): boolean => !!x)) // all entries are empty
                push = undefined;
            atomic = attributes.map(x => x ? x.atomic : undefined);
            if(!atomic.some((x: any): boolean => !!x)) // all entries are empty
                atomic = undefined;
        }
        
        if(push && this.push !== true) {
            if(!this.push)
                this.push = {};
            this.push[attr] = push;
        }

        if(atomic && this.atomic !== true) {
            if(!this.atomic)
                this.atomic = {};
            this.atomic[attr] = atomic;
        }
    }
    
    // Only to be used when the values under 'elt' are not identified
    // (otherwise there may be an array of merge attributes under
    // push[elt] or atomic[elt]).
    popPathElement(elt: string): MergeAttributes {
        return new MergeAttributes(
            this.push instanceof Object? this.push[elt]: undefined,
            this.atomic instanceof Object? this.atomic[elt]: undefined
        );
    }

    // When the elements under 'elt' are identified, use this function
    // to pop the merge attributes. This may return either undefined
    // (if there are not merge attributes under 'elt') or an array of
    // merge attribute objects.
    // 'numElements' may optionally be used to indicate the number of
    // elements in the ordered set these merge attributes are associated with.
    popPathElementSequence(elt: string, numElements?: number): MergeAttributes[]
    {
        var atomic: any = (this.atomic instanceof Object) ?
            this.atomic[elt] : undefined;
        var push: any =
            (this.push instanceof Object) ? this.push[elt] : undefined;

        if(atomic === undefined && push === undefined)
            return undefined;

        if(!(atomic instanceof Array)) {
            if(!(push instanceof Array))
                return [new MergeAttributes(push, atomic)];
            if(numElements !== undefined && numElements > push.length)
                push.length = numElements;
            return push.map(p => new MergeAttributes(p, atomic));
        }

        if(!(push instanceof Array)) {
            if(numElements !== undefined && numElements > atomic.length)
                atomic.length = numElements;
            return atomic.map(a => new MergeAttributes(push, a));
        }

        if(numElements !== undefined) {
            if(numElements > push.length)
                push.length = numElements;
            if(numElements > atomic.length)
                atomic.length = numElements;
        }

        var sequence: MergeAttributes[] = [];
        
        for(var i = 0, l = Math.max(atomic.length, push.length) ; i < l ; ++i)
            sequence.push(new MergeAttributes(push[i], atomic[i]));

        return sequence;
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

// 'identifiers' is always an array of values which are the identities of
// the o-s elements in the corresponding positions.
// 'subIdentifiers' is an array (of the same length as 'identifiers')
// which stores a-v objects which describe the identities under the
// corresponding path in the o-s element corresponding to the position
// in the 'subIdentifiers' array.
// Under each attribute in these a-v objects one can have either another
// a-v object (to extend the paths) or an array (which then represents
// the identifiers at that path) or another SubIdentifiers object
// (in case there are both identifiers and sub-identifiers under the path
// or if there is more than one sub-identifier object).

class SubIdentifiers {
    identifiers: any[];
    subIdentifiers: any[]; // paths where there are sub-identifiers

    constructor(identifiers: any[], subIdentifiers: any[]) {
        this.identifiers = identifiers;
        this.subIdentifiers = subIdentifiers;
    }

    init(hasIdentifiers: boolean, hasSubIdentifiers: boolean): void {
        if(hasIdentifiers)
            this.identifiers = [];
        else
            this.identifiers = undefined;
        if(hasSubIdentifiers)
            this.subIdentifiers = [];
        else
            this.subIdentifiers = undefined;
    }
    
    isEmpty(): boolean {
        return !this.identifiers && !this.subIdentifiers;
    }

    // Return a SubIdentifiers object representing the same identifiers as
    // the input IDs, which can be either an SubIdentifiers object
    // (this function returns the object itself) or an Array
    // (these are identifiers without sub-identifiers) or an A-V (this is
    // a single sub-identifiers specification).
    static makeSubIdentifiers(ids: any): SubIdentifiers {
        if(!ids)
            return undefined;
        if(ids instanceof SubIdentifiers)
            return ids;
        if(ids instanceof Array) // identifiers only
            return new SubIdentifiers(ids, undefined);
        // must be single A-V, is single entry of sub-identifiers
        return new SubIdentifiers(undefined, [ids]);
    }

    // return the 'short' representation of this object: if it has both
    // identifiers and sub-identifiers, return the object itself, if it only
    // has identifiers, return them as an array, and if there is a single
    // sub-identifier (and no identifiers) returns that sub-identifier
    // (it must be an A-V).

    shortForm(): any {
        if(this.identifiers !== undefined && this.identifiers.length > 0) {
            if(this.subIdentifiers !== undefined &&
               this.subIdentifiers.length > 0)
                return this;
            return this.identifiers;
        } else if(this.subIdentifiers !== undefined &&
                  this.subIdentifiers.length == 1) {
            return this.subIdentifiers[0];
        } else
            return this;
    }
    
    // make this object's identities equal to the projection on attribute
    // 'attr' of the identifiers in 'ids'. 'data' is the (pre-projection)
    // data on which 'ids' are defined. This is needed in order to determine
    // the correct position in the array of the projected identities
    // (they must be aligned with the data).
    
    projectAttr(attr: string, data: any[], ids: SubIdentifiers): void {
        if(ids === undefined || ids.subIdentifiers === undefined) {
            this.identifiers = undefined;
            this.subIdentifiers = undefined;
            return;
        }
        this.identifiers = [];
        this.subIdentifiers = [];
        
        var totalDataLen: number = 0;
        for(var i: number = 0, l: number = data.length ; i < l ; ++i) {
            // need to reserve space for the data under this attribute,
            // even if it is not assigned (sub-)identifiers
            var data_i = data[i];
            if(typeof(data_i) !== "object" || !(attr in data_i))
                continue;
            var attrData: any = data_i[attr];
            var dataLen: number = attrData === undefined ? 0 :
                ((attrData instanceof Array) ? attrData.length : 1);
            if(dataLen === 0)
                continue;
            
            var subIds: any = ids.subIdentifiers[i];
            var attrIds: any;
            if(subIds === undefined || (attrIds = subIds[attr]) === undefined)
                continue;

            if(attrIds instanceof Array) {
                // identifiers
                if(this.identifiers.length < totalDataLen)
                    this.identifiers.length = totalDataLen;
                this.identifiers = cconcat(this.identifiers, attrIds);
            } else if(attrIds instanceof SubIdentifiers) {
                if(attrIds.identifiers !== undefined) {
                    if(this.identifiers.length < totalDataLen)
                        this.identifiers.length = totalDataLen;
                    this.identifiers = cconcat(this.identifiers,
                                               attrIds.identifiers);
                }
                if(attrIds.subIdentifiers !== undefined) {
                    if(this.subIdentifiers.length < totalDataLen)
                        this.subIdentifiers.length = totalDataLen;
                    this.subIdentifiers = cconcat(this.subIdentifiers,
                                                  attrIds.subIdentifiers);
                }
            } else { // must be A-V (of sub-identifiers)
                if(this.subIdentifiers.length < totalDataLen)
                    this.subIdentifiers.length = totalDataLen;
                this.subIdentifiers.push(attrIds);
            }

            totalDataLen += dataLen;
        }

        if(this.identifiers.length === 0)
            this.identifiers = undefined;
        else if(this.identifiers.length < totalDataLen)
            this.identifiers.length = totalDataLen;

        if(this.subIdentifiers.length === 0)
            this.subIdentifiers = undefined;
        else if(this.subIdentifiers.length < totalDataLen)
            this.subIdentifiers.length = totalDataLen;
    }

    // Same as projectAttr() but continues recursively down a path
    // of attributes.
    projectAttrPath(path: string[], data: any[], ids: SubIdentifiers): void {
        
        if(ids === undefined || ids.subIdentifiers === undefined) {
            this.identifiers = undefined;
            this.subIdentifiers = undefined;
            return;
        }

        var subIds: any[] = ids.subIdentifiers;
        
        // loop over all attributes of the path except the last one
        // (which is handled by the single attribute projection function)
        for(var j: number = 0 ; j < path.length - 1 ; ++j) {
            
            var attr: string = path[j];

            var projData: any[] = [];
            var projSubIds: any[] = [];
            
            var totalDataLen: number = 0;
            for(var i: number = 0, l: number = data.length ; i < l ; ++i) {
                // need to reserve space for the data under this attribute,
                // even if it is not assigned (sub-)identifiers
                var data_i = data[i];
                if(typeof(data_i) !== "object" || !(attr in data_i))
                    continue;
                var attrData: any = data_i[attr];
                var dataLen: number = attrData === undefined ? 0 :
                    ((attrData instanceof Array) ? attrData.length : 1);
                if(dataLen === 0)
                    continue;

                // store the projected data for the next step
                if(attrData instanceof Array)
                    projData = cconcat(projData, attrData);
                else
                    projData.push(attrData)

                var attrIds: any;
                if(subIds[i] === undefined ||
                   (attrIds = subIds[i][attr]) === undefined)
                    continue;

                if(attrIds instanceof Array)
                    // identifiers (don't store: will continue down the path)
                    continue;
                else if(attrIds instanceof SubIdentifiers) {
                    if(attrIds.subIdentifiers !== undefined) {
                        if(projSubIds.length < totalDataLen)
                            projSubIds.length = totalDataLen;
                        projSubIds = cconcat(projSubIds, attrIds.subIdentifiers);
                    }
                } else { // must be A-V (of sub-identifiers)
                    if(projSubIds.length < totalDataLen)
                        projSubIds.length = totalDataLen;
                    projSubIds.push(attrIds);
                }
                totalDataLen += dataLen;
            }

            if(projSubIds.length === 0) {
                this.identifiers = undefined;
                this.subIdentifiers = undefined;
                return;
            }

            if(projSubIds.length < totalDataLen)
                projSubIds.length = totalDataLen;

            data = projData;
            subIds = projSubIds;
        }

        this.projectAttr(path[path.length-1], data,
                         new SubIdentifiers(undefined,subIds));
    }
};
