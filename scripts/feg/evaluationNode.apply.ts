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

/// <reference path="evaluationNode.ts" />
/// <reference path="evaluationNode.state.ts" />

// Write the same value to all selected elements. The selected positions are
// s_1, s_2, ... If the input is o(i_1, i_2, ...), the output is o(i[s_1],
// i[s_2], ...). Hence, if the result is being written to p_1, p_2, ..., it
// should be written to inputs s[p_1], s[p_2], ... This is all under the
// assumption that there is no path, and therefore each selected position
// has length 1.
// Note that an undefined value for positions means all positions,
// i.e. s[i] === i.
function getSelectedWritePositionsNoPath(positions: DataPosition[], selectedPositions: DataPosition[]): DataPosition[] {
    if (positions === undefined) {
        return selectedPositions;
    } else if (selectedPositions === undefined ||
               selectedPositions.length === 0) {
        return positions;
    } else {
        var indexedPositions: DataPosition[] = [];
        for (var i: number = 0; i !== positions.length; i++) {
            var sp: DataPosition = positions[i].copy();
            if (sp.index !== undefined &&
                (sp.index !== 0 || sp.length !== 0)) { // 0,0 is 'no match'
                // The index is located inside the selected positions
                sp.index = selectedPositions[positions[i].index].index;
            }
            indexedPositions.push(sp);
        }
        return indexedPositions;
    }
}

// If there is a path, selected positions can have length > 1: s_1/l_1, s_2/l_2,
// etc. The the output is o(i[s_1][0], i[s_1][1], ..., i[s_1][l_1-1], i[s_2][0],
// ...  i[s_2][l_2-1], ...), so p_k writes to i[j][l] where s_j + sum(l_q, q<j)
// + l = p_k. The execption is writing to a position of an empty projection, and
// to the last position: they will take all the remaining positions.
function getSelectedWritePositionsWithPath(positions: DataPosition[], selectedPositions: DataPosition[], path: string[]): DataPosition[] {
    var indexedPositions: DataPosition[];
    var i: number, j: number;
    var sub: DataPosition;

    // When positions aren't indexed (assuming they can't be mixed with
    // indexed positions), ignore selected positions and extend the
    // identified/attributed positions; also do that when there are no
    // selected positions (i.e. no selection was made).
    if ((positions !== undefined && positions.length > 0 && positions[0].index === undefined) ||
          selectedPositions === undefined || selectedPositions.length === 0) {
        // This is the only case that handles paths of length > 1
        indexedPositions = positions;
        for (var i: number = path.length - 1; i >= 0; i--) {
            indexedPositions = [new DataPosition(0, 0, [path[i]],
                                                 indexedPositions === undefined?
                                                 [new DataPosition(0, 0)]:
                                                 indexedPositions)];
        }
    } else if (positions === undefined) {
        indexedPositions = [];
        for (i = 0; i < selectedPositions.length; i++) {
            sub = new DataPosition(0, selectedPositions[i].length);
            indexedPositions.push(new DataPosition(selectedPositions[i].index,
                                                   1, path, [sub]));
        }
    } else {
        indexedPositions = [];
        for (i = 0; i !== positions.length; i++) {
            var accumPos: number = 0;
            for (j = 0; j < selectedPositions.length; j++) {
                if (accumPos <= positions[i].index &&
                    (selectedPositions[j].length === 0 ||
                     j === selectedPositions.length - 1 ||
                     positions[i].index + positions[i].length <=
                      accumPos + selectedPositions[j].length)) {
                    sub = positions[i].copy();
                    sub.index = positions[i].index - accumPos;
                    indexedPositions.push(new DataPosition(
                        selectedPositions[j].index, 1, path, [sub]));
                }
                if (selectedPositions[j].length === 0) {
                    break;
                }
                accumPos += selectedPositions[j].length;
            }
        }
    }
    return indexedPositions;
}

// class EvaluationExecuteCompiledQuery extends EvaluationFunctionApplication {
//     selectedPositions: DataPosition[];

//     eval(): boolean {
//         var oldValue: any[] = this.result.value;
//         var oldIdentifiers: any[] = this.result.identifiers;
//         var queryDefined: boolean = this.arguments[0] !== undefined &&
//             this.arguments[0].compiledQuery !== undefined &&
//             this.arguments[0].compiledQuery.length !== 0;
//         var query: any = queryDefined?
//             this.arguments[0].compiledQuery[0]: undefined;
//         var queryArguments: SimpleQuery[] = queryDefined?
//             this.arguments[0].queryArguments[0]: undefined;
//         var identifiers: any[] = this.arguments[1] === undefined? undefined:
//                                  this.arguments[1].identifiers;
//         var data = this.arguments[1] === undefined? undefined:
//                    this.arguments[1].value;
//         var r: any[];
//         var ids: any[] = query === undefined || query.isProjection || identifiers === undefined?
//                          undefined: [];

//         this.inputHasChanged = false;
//         if (query !== undefined && data !== undefined) {
//             if (!this.prototype.writable) {
//                 // the compiled query functions do not return selection info
//                 r = query(data, queryArguments, identifiers, ids);
//             } else {
//                 r = [];
//                 this.selectedPositions = [];
//                 for (var i: number = 0; i !== data.length; i++) {
//                     var queryResult: any = query(data[i], queryArguments);
//                     if (queryResult !== undefined) {
//                         var len: number;
//                         if (ids !== undefined) {
//                             ids.push(identifiers[i]);
//                         }
//                         if (queryResult instanceof Array) {
//                             len = queryResult.length;
//                             if (queryResult.length !== 0) {
//                                 r = cconcat(r, queryResult);
//                             }
//                         } else {
//                             len = 1;
//                             r.push(queryResult);
//                         }
//                         this.selectedPositions.push(new DataPosition(i, len));
//                     }
//                 }
//             }
//         } else {
//             r = constEmptyOS;
//         }
//         this.result.copyLabels(this.arguments[1]);
//         this.result.value = r;
//         this.result.setIdentifiers(ids);
//         return !valueEqual(oldValue, r) || !valueEqual(ids, oldIdentifiers);
//     }

//     // Only single projection path supported
//     write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[]): void {
//         var sub: DataPosition[];
//         var selectedPositions: DataPosition[] = this.selectedPositions;
//         var wrPath: string[] = this.arguments[0].writePaths;

//         if (!this.prototype.writable || this.inputs[1] === undefined) {
//             Utilities.error("dead ended write: query not on writable path: " + this.prototype.idStr());
//             return;
//         }
//         if (this.arguments[0] === undefined || this.inputs[1] === undefined) {
//             Utilities.warn("dead ended write: cannot write through " + this.bif.name + " at " + gWriteAction);
//             return;
//         }

//     // Only single projection path supported
//     write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[]): void {
//         var selectedPositions: DataPosition[] = this.selectedPositions;
//         var wrPath: string[] = this.arguments[0].writePaths;

//         // Handle empty selections
//         if (this.selectedPositions !== undefined &&
//               this.selectedPositions.length === 0) {
//             // When the selection is empty, but the write comes from a
//             // projection, create a push on the target with the selection values
//             // included. When the write does not stem from a projection, refuse.
//             // Note that the assignment to positions above adds the projection
//             // path from this query.
//             var positionsWithPath = selectedPositions.filter((pos: DataPosition): boolean => {
//                 return pos.path.length !== 0;
//             });
//             if (positionsWithPath.length < selectedPositions.length) {
//                 assert(positionsWithPath.length === 0, "expecting all positions from the same source");
//                 Utilities.warn("dead ended write: cannot write non-projections through empty selection at " + gWriteAction);
//                 return;
//             }
//             var evCompFun = <EvaluationCompiledFunction> this.inputs[0];
//             var selectionAttributes: any = evCompFun.getSelectionObject();
//             if (selectionAttributes !== undefined) {
//                 // Create object with the values to be writting, merge the
//                 // selection attributes, and push the whole to the destination
//                 var pct = new PositionChangeTracker();
//                 var writeResult: any = determineWrite([{}], result, mode,
//                                             attributes, selectedPositions, pct);
//                 if (!(selectionAttributes instanceof Object) || selectionAttributes instanceof NonAV) {
//                     Utilities.warn("dead ended write: cannot write through projections on selections of non-objects at " + gWriteAction);
//                     return;
//                 }
//                 result = new Result(mergeConst(writeResult, selectionAttributes));
//                 selectedPositions = [new DataPosition(0, 1)];
//                 selectedPositions[0].addedAttributes = selectionAttributes;
//             }
//         }
//         this.inputs[1].write(result, mode, attributes, selectedPositions);
//     }

//     debugName(): string {
//         return "executeCompiledQuery";
//     }

//     isLargeQuery(minSize: number, onlyQuery: boolean): boolean {
//         return (this.inputs[0].result.isLargerThan(minSize, true) ||
//                 (!onlyQuery && this.inputs[1].result.isLargerThan(minSize, false)));
//     }
// }
// executeCompiledQuery.classConstructor = EvaluationExecuteCompiledQuery;

// Defuns are compiled as normal expressions. That means the links between all
// nodes are available, so all that is needed is to set the arguments to the
// actual value and let the evaluation run bottom-up until the top is reached.
// A defun's value is a reference to itself, so it can be passed on normally.
//   Note: the defun supposes its body implements the expression. That does mean
// that constructions like [defun, [{paramList:_}, ...], [{body: _}, ...]]  are
// out of the question.
class EvaluationDefun extends EvaluationNode {
    watcherId: number;
    environment: EvaluationEnvironment;

    constructor(prototype: DefunNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.environment = local.link();
        this.result.value = [new DefunReference(this)];
    }

    destroy(): void {
        this.environment.unlink();
        super.destroy();
    }

    isEqual(en: EvaluationNode): boolean {
        if (en instanceof EvaluationDefun) {
            return this.prototype === en.prototype &&
                   this.environment === en.environment;
        }
        return false;
    }

    isConstant(): boolean {
        return true;
    }

    updateInput(): void {
    }

    eval(): boolean {
        return false;
    }

    debugName(): string {
        return "defun";
    }

}

/// Sets up the evaluation environment for a defun by cloning the evaluation
/// environment and adding a new one for the defun's body. That means that the
/// defun will have access to its area's evaluation node (index 0), as well as
/// to the evaluation nodes of the defuns in which it is embedded. It also
/// allows to have the same defun in parallel instantiations with access to
/// the same environment, and possibly recursion.
class LocalEvaluationEnvironment implements EvaluationEnvironment {
    template: AreaTemplate;
    parentEnv: EvaluationEnvironment;
    cache: EvaluationNode[];
    evaluationNodes: EvaluationNode[][];
    refCount: number = 1;
    localToDefun: number;
    parameterSources: SourcePointer[];

    // static nextSeqNr: number = 0;
    // seqNr: number = LocalEvaluationEnvironment.nextSeqNr++;

    constructor(parentEnv: EvaluationEnvironment, defunNr: number, initSize: number, parameterSources: SourcePointer[]) {
        this.parentEnv = parentEnv.link();
        this.template = parentEnv.template;
        this.evaluationNodes = parentEnv.evaluationNodes.slice(0);
        this.evaluationNodes[defunNr] = this.cache = new Array<EvaluationNode>(initSize);
        this.localToDefun = defunNr;
        this.parameterSources = parameterSources;
    }

    destroy(): void {
        var cache: EvaluationNode[] = this.cache;
        this.parentEnv.unlink();
        for (var i: number = cache.length - 1; i >= 0; i--) {
            cache[i].destroy();
        }
        // make sure no-one can access old EvaluationNodes while constructing
        // new ones.
        this.cache.length = 0;
        this.cache = undefined;
        this.evaluationNodes = undefined;
    }

    link(): LocalEvaluationEnvironment {
        this.refCount++;
        return this;
    }

    unlink(): void {
        assert(this.refCount > 0, "debugging");
        this.refCount--;
        if (this.refCount === 0) {
            this.destroy();
        }
    }

    getOwnId(): string {
        return undefined;
    }

    // Returns the result of the requested relation
    getRelation(relation: string): any[] {
        return undefined;
    }

    // Returns the parent
    getParent(): EvaluationEnvironment {
        return this.parentEnv;
    }

    // Returns the parent with the given template id
    getParentWithTemplateId(id: number): EvaluationEnvironment {
        return this.parentEnv.getParentWithTemplateId(id);
    }

    getEvaluationArea(): CoreArea {
        return this.parentEnv.getEvaluationArea();
    }

    public isValid(): boolean {
        return this.parentEnv.isValid();
    }

    public getSource(fn: FunctionNode): SourcePointer {
        return this.parameterSources[fn.id];
    }
}

// This global constant does not represent an empty os, but it flags that the
// result is not a "FEG" result. This allows us to pass both a dataSource and
// a javascript FEG value in the same result. However, this is never used, so
// probably should be removed. TODO: check.
var emptyDataSourceResult: any[] = [];

// The application of a defun constructs the evaluation nodes from the defun's
// body in its own cache, i.e. separate from the area. Updates to the arguments
// are copied to the body's parameter nodes, and the value from the last
// expression in the body is copied to the result.
/**
 * The CDL form for this expression is [q, a_1, a_2, ...], where q is *not* a
 * built-in function, but some form of data. The node distinguishes two cases:
 * q is a single defun, or it isn't.
 *
 * The defun case
 * When "q" is a single defun, q's function body is built in a new
 * {LocalEvaluationEnvironment}. At the "bottom" of the body the parameters
 * await the values for a_i. Changes in a_i are buffered, and copied to the
 * parameters when eval() is called. This avoids repeated evaluation of the
 * body. When the top node of the body sends its update to this node, the result
 * is copied and sent to the watchers.
 *   The activation for the inputs must come from the parameters nodes, though,
 * as only they know if they should operate in dataSourceResultMode or not. A
 * consequence of this is that apply always activates its first input, but its
 * second only when in query mode.
 * 
 * The non-defun case (also applies when "q" is an os of more than once defun)
 * In this case, q is interpreted as a query on a_1. Futher arguments are
 * ignored.
 * 
 * @class EvaluationApply
 * @extends {EvaluationFunctionApplication}
 * @implements {OrderingResultWatcherInterface} for the non data source aware
 *             watchers that need the result in order
 */
class EvaluationApply extends EvaluationFunctionApplication
    implements OrderingResultWatcherInterface
{
    /**
     * There are five states (the other 3 are unreachable). There are 4
     * messages, activate, deactivate, setFunction, unsetFunction, but
     * deactivate can only be received when active, and vice versa.
     * By this schema, activation and creation of the evaluation nodes for
     * the function body are managed.
     * S0: !active && !fun && !cache
     * - activateFun -> S1, activate data source watcher
     * - setFunction -> S2, memorize function
     * - unsetFunction -> S0, set function to undefined
     * S1:  active && !fun && !cache
     * - deactivateFun -> S0, deactivate data source watcher
     * - setFunction -> S4, memorize function, build cache, activate body
     * - unsetFunction -> S1, no action required
     * S2: !active &&  fun && !cache
     * - activateFun -> S4, build cache, activate body
     * - setFunction -> S2, memorize new function
     * - unsetFunction -> S0, set function to undefined
     * S3: !active &&  fun &&  cache
     * - activateFun -> S4, activate body
     * - setFunction -> S2, deactivate body, remove cache, memorize new function
     * - unsetFunction -> S0, remove cache, set function to undefined
     * S4:  active &&  fun &&  cache
     * - deactivateFun -> S3, deactivate body
     * - setFunction -> S4, deactivate body, remove cache, memorize new function
     *                      build cache, activate body
     * - unsetFunction -> S1, deactivate body, remove cache, set function to
     *                        undefined
     * Apart from the above states: if "fun" exists (i.e., "fun" in this), this
     * node implements a defun application; if "query" exists, it implements a
     * query (possibly a compiled query).
    */
    state: number = 0;
    active: boolean = false;
    fun?: EvaluationDefun;
    parameters: EvaluationDefunParameter[];
    body: EvaluationNode;
    bodyResult: Result;
    environment: LocalEvaluationEnvironment;
    query?: any;
    queryIds?: any[];
    queryIsProjection?: boolean;
    testSimpleQuery: boolean = false; // When true, check for a SimpleQuery
    simpleQuery: SimpleQuery;
    compiledQuery: CompiledQuery;
    compiledQueryArguments: SimpleQuery[];
    selectedPositions: DataPosition[];
    arguments: Result[] = [];
    prevResultFromSameDefun: boolean = false;
    changedArguments: boolean[];
    foreignInterface?: ForeignInterface;
    /** When true, one of the watchers needs the result in order. */
    resultRequirements: MinimumResultRequirements = MinimumResultRequirements.ordered;
    /** When the result requirements ask for an ordered result, this object
     * provides the order of the data element ids. */
    orderingResultWatcher: OrderingResultWatcher;

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.inputHasChanged = false;
        this.dataSourceAware = true;
        this.dataSourceResultMode = true;
        this.result.value = emptyDataSourceResult;
    }

    destroy(): void {
        if ("fun" in this) {
            this.unsetFunction();
        }
        if ("query" in this) {
            this.unsetQuery();
        }
        if ("foreignInterface" in this) {
            this.unsetForeignInterface();
        }
        super.destroy();
    }

    removeAsWatcher(): void {
        if (this.inputs !== undefined) {
            var inputs = this.inputs;
            this.inputs = undefined;
            if (inputs[0] !== undefined) {
                inputs[0].removeWatcher(this, true, false);
            }
            if (inputs[1] !== undefined) {
                inputs[1].removeWatcher(this, "query" in this, true);
            }
            for (var i: number = 2; i < inputs.length; i++) {
                if (inputs[i] !== undefined) {
                    inputs[i].removeWatcher(this, false, "fun" in this);
                }
            }
        }
    }

    addArgument(i: number, evalNode: EvaluationNode): void {
        this.inputs[i] = evalNode;
        if (!evalNode.isConstant()) {
            this.constant = false;
            evalNode.addWatcher(this, i, true, true, i > 0);
        }
        if (i === 0) {
            this.setFunctionOrQuery(evalNode.result);
        } else {
            this.setArgument(evalNode.result, i - 1);
        }
    }

    updateInput(i: any, result: Result): void {
        if (result === undefined) {
            // Input is being destroyed; stop evaluation
            if ("fun" in this) {
                this.unsetFunction();
            }
            if ("query" in this) {
                this.unsetQuery();
            }
            if ("foreignInterface" in this) {
                this.unsetForeignInterface();
            }
        } else if (i === "result") {
            this.bodyResult = result;
            this.markAsChanged();
        } else if (i === 0) {
            this.setFunctionOrQuery(result);
        } else {
            // Note that setArgument will trigger markAsChanged if the output
            // of the function changes.
            this.setArgument(result, i - 1);
        }
    }

    setFunctionOrQuery(result: Result): void {
        var sv = result.value instanceof Array && result.value.length === 1?
                 result.value[0]: result.value;

        if (sv instanceof DefunReference) {
            var dr = <DefunReference> sv;
            this.constant = false;
            if ("query" in this) {
                this.unsetQuery();
            }
            if ("foreignInterface" in this) {
                this.unsetForeignInterface();
            }
            this.setFunction(dr);
        } else if (sv instanceof NativeObjectWrapper &&
                   sv.foreignInterfaceConstructor !== undefined) {
            if ("fun" in this) {
                this.unsetFunction();
            }
            if ("query" in this) {
                this.unsetQuery();
            }
            this.setForeignInterface(sv);
        } else if (sv !== undefined) {
            if ("fun" in this) {
                this.unsetFunction();
            }
            if ("foreignInterface" in this) {
                this.unsetForeignInterface();
            }
            this.setQuery(sv, result);
        } else {
            if ("fun" in this) {
                this.unsetFunction();
            }
            if ("query" in this) {
                this.unsetQuery();
            }
            this.result.set(undefined);
        }
        if (this.nrActiveWatchers > 0 && !this.active) {
            // This is here in case the apply was activated while waiting for an
            // update of the function/query. See: activateFun()
            this.activateFun();
        }
    }

    setQuery(q: any, result: Result): void {
        if (!("query" in this) && this.isActive() && this.inputs[1] !== undefined) {
            // When setting the query initially or after switching from defun
            // mode, this node becomes responsible for the activation of input[1]
            this.inputs[1].activate(this, true);
        }
        this.query = q;
        this.queryIds = result.identifiers;
        this.testSimpleQuery = true;
        delete this.simpleQuery;
        this.queryIsProjection = this.query !== _ && nrProjSitesInQuery(this.query) > 0;
        if (result.compiledQuery !== undefined &&
            result.compiledQuery.length === 1) {
            this.compiledQuery = result.compiledQuery[0];
            this.compiledQueryArguments = result.queryArguments[0];
        } else {
            this.compiledQuery = undefined;
            this.compiledQueryArguments = undefined;
        }
        if (this.arguments[0] !== undefined) {
            if (this.inputs[1] !== undefined &&
                  ("dataSource" in this.inputs[1].result || "dataSource" in this.result) &&
                  (this.inputs[1].isScheduled() || !this.inputs[1].isActive())) {
                // Wait with changing datasources until input has been updated
                this.inputs[1].addForcedUpdate(this);
            } else if (this.inputs[1] !== undefined && "dataSource" in this.inputs[1].result) {
                this.setDataSourceInput(this.inputs[1].result.dataSource);
            } else {
                this.markAsChanged();
            }
        }
    }

    unsetQuery(): void {
        if (this.dataSourceInput !== undefined) {
            this.dataSourceQuery.removeResultReceiver(this);
            if (this.orderingResultWatcher !== undefined) {
                this.orderingResultWatcher.destroy();
                this.orderingResultWatcher = undefined;
            }
            this.dataSourceInput = undefined;
            this.dataSourceQuery = undefined;
        }
        if ("query" in this && this.isActive() && this.inputs[1] !== undefined) {
            // When removing the query, this node is no longer responsible for
            // the activation of input[1]
            this.inputs[1].deactivate(this, true);
        }
        delete this.query;
        delete this.queryIds;
        delete this.queryIsProjection;
        delete this.compiledQuery;
        delete this.compiledQueryArguments;
        delete this.simpleQuery;
        this.testSimpleQuery = false;
        this.markAsChanged();
    }

    setForeignInterface(now: NativeObjectWrapper): void {
        this.constant = false; // Note: this is safe because constant queries on foreign functions get here before the first watcher
        if ("foreignInterface" in this) {
            this.foreignInterface.destroy();
        } else if (this.isActive()) {
            for (var i = 1; i < this.inputs.length; i++) {
                this.inputs[i].activate(this, false);
            }
        }
        this.foreignInterface = now.createForeignInterface();
        this.foreignInterface.local = this.local.getOwnId();
        this.result.foreignInterfaceSource = this.foreignInterface;
        for (var i = 1; i < this.inputs.length; i++) {
            this.foreignInterface.setArgument(i - 1, this.arguments[i]);
        }
        this.markAsChanged();
    }

    unsetForeignInterface(): void {
        this.foreignInterface.destroy();
        delete this.foreignInterface;
        if (this.isActive()) {
            for (var i = 1; i < this.inputs.length; i++) {
                this.inputs[i].deactivate(this, false);
            }
        }
        delete this.result.foreignInterfaceSource;
        this.markAsChanged();
    }

    setDataSourceInput(dataSource: DataSourceComposable): void {
        var querySourceId: number = this.inputs[0].querySourceId();

        if (this.dataSourceInput === dataSource &&
              this.dataSourceQuery instanceof DataSourceQueryByData &&
              this.dataSourceQuery.hasSameSource(querySourceId) &&
              this.query !== _) {
            (<DataSourceQueryByData>this.dataSourceQuery).updateQuery(this.query);
        } else if (this.dataSourceInput === dataSource &&
            this.dataSourceQuery instanceof DataSourceElementIdTransformation &&
            this.query === _) {
            // No change
        } else {
            if (allowSetData && this.dataSourceQuery !== undefined &&
                  this.dataSourceQuery.hasSameSource(querySourceId) &&
                  this.dataSourceQuery.canMoveTo(this, dataSource)) {
                // Move the query to the new data source when the depending
                // queries, functions, etc. belong to watchers of this node
                this.moveToDataSource(dataSource);
            } else {
                this.changeDataSource(dataSource, querySourceId);
            }
        }
    }

    // Change the input of this data source application. There is no need to
    // inform the watchers: changes are propagated via the FuncResult nodes.
    moveToDataSource(dataSource: DataSourceComposable): void {
        this.dataSourceQuery.moveToDataSource(this, dataSource);
        this.dataSourceInput = dataSource;
    }

    // Remove existing applications, and build a new one on the actual data
    // source.
    changeDataSource(dataSource: DataSourceComposable, querySourceId: number): void {
        if (this.dataSourceInput !== undefined) {
            this.dataSourceQuery.removeResultReceiver(this);
            if (this.orderingResultWatcher !== undefined) {
                this.orderingResultWatcher.destroy();
                this.orderingResultWatcher = undefined;
            }
        }
        this.dataSourceInput = dataSource;
        // Register the query on the new input
        this.dataSourceQuery = this.query !== _?
            dataSource.applyDataQuery(this.query, this, querySourceId):
            dataSource.applyElementIdTransformation("uniqueById", this);
        if (this.isActive() && !this.dataSourceResultMode) {
            assert(this.orderingResultWatcher === undefined, "debugging");
            this.addOrderingResultWatcher();
            this.dataSourceQuery.updateIndexerMonitoringForDominatedPath();
        }
        this.markAsChanged();
    }

    releaseDataSourceInput(): void {
        if (this.orderingResultWatcher !== undefined) {
            this.orderingResultWatcher.destroy();
            this.orderingResultWatcher = undefined;
        }
        this.dataSourceQuery.stopIndexerMonitoring();
        this.dataSourceQuery.removeResultReceiver(this);
        this.dataSourceQuery = undefined;
        this.dataSourceInput = undefined;
        this.markAsChanged();
    }

    // NOTE: only works for one watcher; doesn't remove orderingResultWatcher;
    // never called; etc.
    setMinimumResultRequirements(m: MinimumResultRequirements): void {
        this.resultRequirements = m;
        this.addOrderingResultWatcher();
    }

    addOrderingResultWatcher(): void {
        if (this.resultRequirements === MinimumResultRequirements.ordered &&
              this.orderingResultWatcher === undefined) {
            this.orderingResultWatcher =
                new OrderingResultWatcher(globalInternalQCM, this, undefined);
            this.orderingResultWatcher.init(this.dataSourceQuery);
            this.orderingResultWatcher.activate();
        }
    }

    dataSourceQuery: DataSourceComposable;
    // Counts the number of changes to the query output. 
    queryUpdateCounter: number = 0;
    // Last change count when data was extracted
    counterAtLastExtraction: number = -1;

    newDataSourceResult(v: any[]): void {
        Utilities.error("should not be called");
    }

    reextractData(): void {
        if (!this.dataSourceResultMode) {
            this.markAsChanged();
        }
    }

    updateDataElementPosition(elementIds: number[], firstOffset: number,
                              lastOffset: number, setSize: number): void {
        if (!this.dataSourceResultMode) {
            this.markAsChanged();
        }
    }

    refreshIndexerAndPaths(tag: any, dataObj: FuncResult): void {
        if (!this.dataSourceResultMode) {
            this.dataSourceQuery.updateIndexerMonitoringForDominatedPath();
            this.markAsChanged();
        }
    }

    replaceIndexerAndPaths(tag: any, prevPrefixPathId: number,
                           prefixPathId: number, dataObj: FuncResult): void {
        if (!this.dataSourceResultMode) {
            this.dataSourceQuery.updateIndexerMonitoringForDominatedPath();
            this.markAsChanged();
        }
    }

    extractDataSourceResult(): boolean {
        var oldValue: any[] = this.result.value;
        var res: any[] = this.dataSourceQuery.extractData(
            this.resultRequirements, this.orderingResultWatcher);
        var hadDataSource: boolean = "dataSource" in this.result;

        // console.log(this.prototype.idStr(), "apply.extractDataSourceResult",
        //             cdlify(this.query), "#" + res.length);
        this.counterAtLastExtraction = this.queryUpdateCounter;
        this.result.value = res; // Ensures result.value !== emptyDataSourceResult
        if (hadDataSource) {
            delete this.result.dataSource;
        }
        return hadDataSource || !valueEqual(oldValue, res);
    }

    setArgument(result: Result, i: number): void {
        this.arguments[i] = result;
        if ("fun" in this) {
            this.changedArguments[i] = true;
            this.markAsChanged();
        } else if ("query" in this) {
            // The query is already known
            if (("dataSource" in result || "dataSource" in this.result) &&
                  (this.inputs[1].isScheduled() || !this.inputs[1].isActive())) {
                // Wait with changing datasources until input has been updated
                this.inputs[1].addForcedUpdate(this);
            } else if ("dataSource" in result) {
                this.setDataSourceInput(result.dataSource);
            } else {
                if (this.dataSourceInput !== undefined) {
                    this.releaseDataSourceInput();
                }
                this.markAsChanged();
            }
        } else if ("foreignInterface" in this) {
            if (this.foreignInterface.setArgument(i, result)) {
                this.markAsChanged();
            }
        }
    }

    activateInputs(): void {
        if (this.inputs[0] !== undefined) {
            this.inputs[0].activate(this, false);
        }

        if ("query" in this && this.inputs[1] !== undefined) {
            this.inputs[1].activate(this, true);
        }
        if (!this.dataSourceResultMode && this.dataSourceQuery !== undefined) {
            assert(this.orderingResultWatcher === undefined, "debugging");
            this.orderingResultWatcher =
                new OrderingResultWatcher(globalInternalQCM, this, undefined);
            this.orderingResultWatcher.init(this.dataSourceQuery);
            this.orderingResultWatcher.activate();
        }

        if ("foreignInterface" in this) {
            for (var i = 1; i < this.inputs.length; i++) {
                this.inputs[i].activate(this, false);
            }
        }

        if (this.inputs[0] !== undefined && !this.inputs[0].isScheduled()) {
            this.activateFun();
        } else {
            // If the function can change, we force an update, and wait for the
            // result. This is necessary, as calling activateFun() at this point
            // can refer to a deleted area as its evaluation environment.
            this.unsetFunction();
            this.activateFun();
            if (this.inputs[0] !== undefined) {
                this.inputs[0].forceUpdate(this, false);
            }
        }
    }

    deactivateInputs(): void {
        if (this.orderingResultWatcher !== undefined) {
            this.orderingResultWatcher.destroy();
            this.orderingResultWatcher = undefined;
        }
        if (this.dataSourceQuery !== undefined) {
            this.dataSourceQuery.stopIndexerMonitoring();
        }
        this.deactivateFun();
        if (this.inputs !== undefined) {
            if (this.inputs[0] !== undefined) {
                this.inputs[0].deactivate(this, false);
            }
            if ("query" in this && this.inputs[1] !== undefined) {
                this.inputs[1].deactivate(this, true);
            } else if ("foreignInterface" in this) {
                for (var i = 1; i < this.inputs.length; i++) {
                    this.inputs[i].deactivate(this, false);
                }
            }
        }
    }

    // Checks if cache for query q already exists in a result
    // TODO: refactor so that assumptions about cache are in a more
    // appropriate place.
    static hasSuitableCache(r: Result, q: any): boolean {
        if (!("simpleQueryCache" in r) ||
            r.simpleQueryCache.result !== r.value) {
            // There is no cache, or it's outdated
            return false;
        }
        if (q instanceof RangeValue) {
            return "range" in r.simpleQueryCache.cache;
        }
        if (isAV(q)) {
            for (var attr in q) {
                if (!isSimpleValue(q[attr]) ||
                    !(("simplevalue_" + attr) in r.simpleQueryCache.cache)) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    setDataSourceResultMode(dataSourceResultMode: boolean): void {
        if (this.isActive() && this.dataSourceInput !== undefined) {
            if (dataSourceResultMode && !this.dataSourceResultMode) {
                // Switch to dataSourceResultMode, which means we only have to
                // remove the ordering observer (as we're no longer interested
                // in them): updates to watching data source applications are
                // handled by the query mechanism updates.
                if (this.orderingResultWatcher !== undefined) {
                    this.orderingResultWatcher.destroy();
                    this.orderingResultWatcher = undefined;
                }
                if (this.result !== undefined) {
                    this.result.value = emptyDataSourceResult;
                }
                this.dataSourceQuery.stopIndexerMonitoring();
                this.dataSourceResultMode = true;
                this.markAsChanged();
            } else if (!dataSourceResultMode && this.dataSourceResultMode) {
                assert(this.orderingResultWatcher === undefined, "debugging");
                this.dataSourceResultMode = false; // Must come before activate
                if (this.isActive() && this.dataSourceQuery !== undefined) {
                    this.orderingResultWatcher =
                        new OrderingResultWatcher(globalInternalQCM, this, undefined);
                    this.orderingResultWatcher.init(this.dataSourceQuery);
                    this.orderingResultWatcher.activate();
                    this.dataSourceQuery.updateIndexerMonitoringForDominatedPath();
                }
                this.markAsChanged();
            }
        } else {
            this.dataSourceResultMode = dataSourceResultMode;
        }
        if ("body" in this && this.isActive()) {
            if (dataSourceResultMode) {
                this.body.activeWatcherBecomesDataSourceAware(this);
            } else {
                this.body.activeWatcherNoLongerIsDataSourceAware(this);
            }
        }
    }

    eval(): boolean {
        var change: boolean = false;

        if ("fun" in this) {
            // We set the parameter values here and return false when there was
            // no change to the body result, so that changes to multiple
            // parameters do not trigger multiple evaluations of the body.
            var changedArgument: boolean = false;
            for (var i: number = 0; i < this.parameters.length; i++) {
                if (this.changedArguments[i] !== false) {
                    this.parameters[i].set(this.arguments[i]);
                    this.changedArguments[i] = false;
                    changedArgument = true;
                }
            }
            if (this.bodyResult !== undefined) {
                if (changedArgument) {
                    // Leave scheduled; if nothing changes, bodyResult will be
                    // copied on the next call; if something changes, we won't
                    // be sending an unnecessary update.
                    return undefined;
                } else {
                    var bodyResult: Result = this.bodyResult;
                    this.bodyResult = undefined;
                    if (!this.result.equal(bodyResult)) {
                        this.result.copy(bodyResult);
                        return true;
                    }
                }
            }
            return false;
        }
        this.prevResultFromSameDefun = false;

        if ("foreignInterface" in this) {
            return this.evalForeignInterface();
        }

        if (this.dataSourceInput !== undefined) {
            if (this.dataSourceResultMode) {
                // Update is propagated via the data source application chain
                // unless the FuncResult has changed
                if (this.result.dataSource !== this.dataSourceQuery) {
                    // Pass the query func result on as a data source
                    this.result.dataSource = this.dataSourceQuery;
                    this.result.value = emptyDataSourceResult;
                    return true;
                }
                return false;
            } else {
                return this.extractDataSourceResult();
            }
        } else if ("dataSource" in this.result) {
            delete this.result.dataSource;
            change = true;
        }

        // Input was a javascript value
        if (this.arguments.length !== 1 || this.arguments[0].value === undefined) {
            if (!change && this.result.value !== undefined && this.result.value.length === 0) {
                return false;
            }
            this.result.set(constEmptyOS);
            return true;
        }

        var oldResult: Result = this.result.clone();
        var data = this.arguments[0].value;
        var identifiers: any[] = this.arguments[0].identifiers;
        var subIdentifiers: any[] = this.arguments[0].subIdentifiers;
        var r: any[];
        var dataIds: SubIdentifiers = undefined;
        var ids: SubIdentifiers = undefined;

        if (identifiers !== undefined || subIdentifiers !== undefined) {
            dataIds = new SubIdentifiers(identifiers, subIdentifiers);
            ids = new SubIdentifiers(undefined,undefined);
        }
        if (this.prototype.writable) {
            this.selectedPositions = [];
        }
        var hasSimpleQueryCache: boolean =
            !this.prototype.writable && data.length > 30 &&
            (EvaluationApply.hasSuitableCache(this.arguments[0], this.query) ||
             this.inputs[1].nrSimpleQueryWatchers(this.query) >= 4) &&
            this.setSimpleQuery() &&
            this.simpleQuery.canCache();
        if (hasSimpleQueryCache) {
            this.result.copyLabelsMinusDataSource(this.arguments[0]);
            this.result.value = this.simpleQuery.executeAndCache(this.arguments[0], ids, this.selectedPositions);
        } else if (this.compiledQuery !== undefined && !this.prototype.writable) {
            // the compiled query functions do not return selection info
            this.result.copyLabelsMinusDataSource(this.arguments[0]);
            this.result.value = this.compiledQuery(data,
                                 this.compiledQueryArguments, dataIds, ids);
        } else if (this.setSimpleQuery()) {
            this.result.copyLabelsMinusDataSource(this.arguments[0]);
            this.result.value = this.simpleQuery.execute(data,
                dataIds, ids, this.selectedPositions, undefined);
        } else if ("query" in this) {
            // it may be that this code is never called, since under normal
            // conditions setSimpleQuery() above is always successful.
            this.result.copyLabelsMinusDataSource(this.arguments[0]);
            var sq: SimpleQuery = new SimpleQueryInterpretedQuery(this.query);
            this.result.value = sq.execute(data, dataIds, ids, this.selectedPositions, undefined);
        } else {
            if (this.prototype.writable) {
                this.selectedPositions = [];
            }
            this.result.set([]);
            ids = undefined;
        }
        this.result.setSubIdentifiers(ids);
        return change || !oldResult.isEqual(this.result);
    }

    foreignResultChanged: boolean;

    evalForeignInterface(): boolean {
        var self = this;
        var waiting = true;
        var oldRemoteStatus = this.result.remoteStatus;
        var oldResult = this.result.value;

        if (this.foreignResultChanged) {
            // We get here on an async callback when the result has changed.
            this.foreignResultChanged = false;
            return true;
        }

        // This function is used by the foreign interface to announce its status
        // and result once it's ready. 
        function update(status: string, result: any[]): void {
            if (status !== oldRemoteStatus || !valueEqual(result, oldResult)) {
                self.foreignResultChanged = true;
                self.result.value = result;
                self.result.remoteStatus = status;
                if (!waiting) {
                    // If waiting is false, the caller has already returned
                    self.markAsChanged();
                }
            }
            waiting = false;
        }

        if (this.foreignInterface.execute(update) && this.foreignInterface.isDisplay()) {
            allAreaMonitor.requestVisualUpdate(this.foreignInterface.getDisplayArea());
        }
        // At this point, this.foreignResultChanged === true means there was a
        // result and it's different; waiting === true means the callback hasn't
        // been made; waiting === false means the callback has been made.
        if (this.foreignResultChanged) {
            // The update is ready and the output has changed
            this.foreignResultChanged = false;
            return true;
        }
        // The output hasn't changed, but it can be because we're still waiting
        var newStatus = waiting? "waiting": this.result.remoteStatus;
        // Waiting set to false to let update() know that it it should signal
        // when the result changes
        waiting = false;
        // Result can't have changed, but status might have
        if (newStatus !== oldRemoteStatus) {
            this.result.remoteStatus = newStatus;
            return true;
        }
        return false;
    }

    write(result: Result, mode: WriteMode, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        var writePaths: string[][] = extractProjectionPaths(this.query);
        var selectedPositions: DataPosition[];

        if ("foreignInterface" in this) {
            return this.foreignInterface.write(result, mode,
                                               positions, reportDeadEnd);
        }
        if (!("query" in this)) {
            this.reportDeadEndWrite(reportDeadEnd,
                                    "cannot write through defun");
            return false;
        }
        if (writePaths !== undefined && writePaths.length > 1) {
            this.reportDeadEndWrite(reportDeadEnd,
                                    "cannot write to multiple projections");
            return false;
        }

        // Add projection path to positions (if such a path exists)
        var wrPath: string[] = writePaths !== undefined? writePaths[0]: undefined;
        selectedPositions = wrPath === undefined?
            getSelectedWritePositionsNoPath(positions, this.selectedPositions):
            getSelectedWritePositionsWithPath(positions, this.selectedPositions, wrPath);

        // Handle empty selections: see EvaluationExecuteCompiledQuery
        if ((this.selectedPositions !== undefined &&
             this.selectedPositions.length === 0) ||
            (selectedPositions && (selectedPositions.length == 0 ||
                                   selectedPositions[0].path === undefined ||
                                   selectedPositions[0].path.length === 0))) {
            var selectionAttributes: any = this.getSelectionObject();
            if (selectionAttributes !== undefined) {
                // Add selection to positions. E.g., if the query was {a: 1},
                // a write to an empty place must know it should add a: 1.
                selectedPositions = selectedPositions.length !== 0?
                    selectedPositions.map(
                        pos => pos.copyWithAddedAttributes(selectionAttributes)
                    ):
                    [new DataPosition(0, 0, undefined, undefined, selectionAttributes)];
            }
        } else if(selectedPositions && selectedPositions.length > 0 &&
                  selectedPositions[0].index == 0 &&
                  selectedPositions[0].length == 0) {
            // 'no match' position (must be first). Add attributes.
            var selectionAttributes: any = this.getSelectionObject();
            if(selectionAttributes) {
                selectedPositions[0] = selectedPositions[0].
                    copyWithAddedAttributes(selectionAttributes);
            }
        }
        return this.inputs[1].write(result, mode,
                                    selectedPositions, reportDeadEnd);
    }

    setSimpleQuery(): boolean {
        if (this.testSimpleQuery) {
            var sq: SimpleQuery = makeSimpleQueryWithId(this.query, this.queryIds);
            this.testSimpleQuery = false;
            if (sq !== undefined) {
                this.simpleQuery = sq;
                return true;
            } else {
                delete this.simpleQuery;
                return false;
            }
        } else {
            return "simpleQuery" in this;
        }
    }

    activateFun(): void {
        this.active = true;
        switch (this.state) {
          case 0:
            // if (this.dataSourceFunctionApplication !== undefined &&
            //       !this.dataSourceResultMode) {
            //     this.dataSourceFunctionApplication.activate();
            // }
            this.state = 1;
            break;
          case 2:
            this.buildFunctionNodes();
            this.activateBody();
            this.state = 4;
            break;
          case 3:
            this.activateBody();
            this.state = 4;
            break;
          default:
            assert(false, "already active?");
        }
    }

    deactivateFun(): void {
        if (this.active) {
            this.active = false;
            switch (this.state) {
              case 1:
                // if (this.dataSourceFunctionApplication !== undefined &&
                //       !this.dataSourceResultMode) {
                //     this.dataSourceFunctionApplication.deactivate();
                // }
                this.state = 0;
                break;
              case 4:
                this.deactivateBody();
                this.state = 3;
                break;
              default:
                assert(false, "already inactive?");
            }
        }
    }

    setFunction(dn: DefunReference): void { // Called from any state
        this.changedArguments = new Array<boolean>(this.inputs.length - 1);
        switch (this.state) {
          case 0:
            this.fun = dn.defun;
            this.state = 2;
            break;
          case 1:
            this.fun = dn.defun;
            this.buildFunctionNodes();
            this.activateBody();
            this.state = 4;
            break;
          case 2:
            this.fun = dn.defun;
            this.state = 2;
            break;
          case 3:
            assert(this.body.nrActiveWatchers === 0, "must be inactive in S3");
            this.removeFunctionNodes();
            this.fun = dn.defun;
            this.state = 2;
            break;
          case 4:
            this.deactivateBody();
            this.removeFunctionNodes();
            this.fun = dn.defun;
            this.buildFunctionNodes();
            this.activateBody();
            this.state = 4;
            break;
        }
    }

    unsetFunction(): void { // Called from any state
        delete this.changedArguments;
        switch (this.state) {
          case 0:
            this.state = 0;
            break;
          case 1:
            this.state = 1;
            break;
          case 2:
            delete this.fun;
            this.state = 0;
            break;
          case 3:
            this.removeFunctionNodes();
            delete this.fun;
            this.state = 0;
            break;
          case 4:
            this.deactivateBody();
            this.removeFunctionNodes();
            delete this.fun;
            this.state = 1;
            break;
          default:
            assert(false, "wrong state");
        }
    }

    buildFunctionNodes(): void {
        var defunNode = <DefunNode> this.fun.prototype;
        var defunNr: number = defunNode.defunNr;
        var templateId: number = this.fun.prototype.localToArea;
        var template: AreaTemplate = areaTemplates[templateId];
        var defunFNFunctionNodes: FunctionNode[] = template.defunFunctionNodes[defunNr];
        var inputs: EvaluationNode[] = this.inputs;
        var parameterSources = defunNode.parameterNodes.map(
            (s: StorageNode, i: number): SourcePointer => {
                return {node: inputs[i + 1], position: undefined};
            });

        if (!this.fun.environment.isValid()) {
            this.body = undefined;
            return;
        }
        this.environment = new LocalEvaluationEnvironment(this.fun.environment, defunNr, defunFNFunctionNodes.length, parameterSources);
        for (var nodeId: number = 0; nodeId !== defunFNFunctionNodes.length; nodeId++) {
            // The only defun in the cache is the current one, so embedded
            // defuns with lexical scope are not possible. A global variable
            // with the latest instantiation of each defun should work.
            buildEvaluationNode(defunFNFunctionNodes[nodeId], this.environment);
        }
        this.parameters = defunNode.parameterNodes.map(
            (s: StorageNode): EvaluationDefunParameter => {
                return <EvaluationDefunParameter> getEvaluationNode(s, this.environment);
            });
        this.body = getEvaluationNode(defunNode.body, this.environment);
        if (!this.body.isConstant()) {
            this.body.addWatcher(this, "result", false, false,
                                 this.dataSourceResultMode);
        } else {
            this.body.setDataSourceResultMode(this.dataSourceResultMode);
            this.result.copy(this.body.result);
            this.informAllWatchers();
        }
        if (this.parameters.length !== this.inputs.length - 1) {
            Utilities.warn("difference between parameters and arguments in defun application");
        }
    }

    activateBody(): void {
        for (var i: number = 0; i < this.parameters.length && i < this.arguments.length; i++) {
            this.parameters[i].set(this.arguments[i]);
        }
        this.body.activate(this, this.dataSourceResultMode);
    }

    removeFunctionNodes(): void {
        if (!this.body.isConstant()) {
            this.body.removeWatcher(this, false, this.dataSourceResultMode);
        }
        this.environment.unlink();
        this.body = undefined;
        this.environment = undefined;
        this.parameters = undefined;
    }

    deactivateBody(): void {
        this.body.deactivate(this, this.dataSourceResultMode);
    }

    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        super.specificExplanation(explanation, classDebugInfo);
        if (this.body !== undefined) {
            explanation["_body: " + this.body.debugName()] =
                this.body.explain(undefined);
        }
        return explanation;
    }

    isLargeQuery(minSize: number, onlyQuery: boolean): boolean {
        return this.query !== undefined &&
               (this.inputs[0].result.isLargerThan(minSize, true) ||
                (!onlyQuery && this.inputs[1].result.isLargerThan(minSize, false)));
    }

    /** Returns the function's query object without the projections.
     */
    getSelectionObject(): any {
        function filterSelection(q: any): any {
            if (q instanceof Array) {
                if (q.length !== 1) {
                    return undefined;
                }
                return filterSelection(q[0]);
            } else if (q === _) {
                return undefined;
            } else if (typeof(q) !== "object" || q instanceof NonAV) {
                return [q];
            } else {
                var sel: any = undefined;
                for (var attr in q) {
                    var as = filterSelection(q[attr]);
                    if (as !== undefined) {
                        if (sel === undefined) {
                            sel = {};
                        }
                        sel[attr] = as;
                    }
                }
                return sel;
            }
        }
        return filterSelection(this.query);
    }

    allInputs(): EvaluationNode[] {
        return this.body !== undefined? this.inputs.concat(this.body): this.inputs;
    }
}
internalApply.classConstructor = EvaluationApply;

/// When this variable is false, the bodies in constant maps will not be
/// removed, so they will be open to debugging.
var debugNoConstMaps: boolean = true;

// Like apply, but creates one instance of the function application for each
// element in the input os. There are two modes: setMode and non setMode. In the
// first mode, there is one environment that processes the entire os; in the
// second, there is an environment per input element.
// Note that in setMode, elements with the same identity must be consecutive,
// and that all input ids must appear in the output, with value undefined if
// it is o().
class EvaluationMap extends EvaluationFunctionApplication {
    fun?: EvaluationDefun;
    query?: any;
    funResultIsConstant?: boolean;

    parameters: EvaluationDefunParameter[];
    bodies: EvaluationNode[];
    environments: LocalEvaluationEnvironment[];
    values: Result[];
    arguments: any[]; // Note: this is not of type Result
    identifiers: any[];
    subIdentifiers: any[];

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.result.value = constEmptyOS;
        this.constant = false;
        delete this.arguments;
    }

    destroy(): void {
        this.destroyFunctionNodes();
        super.destroy();
    }

    destroyFunctionNodes(): void {
        if (this.arguments !== undefined) {
            var to: number = this.arguments.length;
            if (this.nrActiveWatchers > 0) {
                this.deactivateSingleFun(0, to);
            }
            if (this.bodies !== undefined) {
                for (var argi: number = 0; argi < to; argi++) {
                    if (this.bodies[argi] !== undefined) {
                        this.bodies[argi].removeWatcher(this, false, true);
                        this.environments[argi].unlink();
                    }
                }
            }
        }
        delete this.environments;
        delete this.arguments;
        delete this.identifiers;
        delete this.subIdentifiers;
        delete this.bodies;
        delete this.fun;
        delete this.parameters;
    }

    addArgument(i: number, evalNode: EvaluationNode): void {
        this.inputs[i] = evalNode;
        if (!evalNode.isConstant()) {
            evalNode.addWatcher(this, i, false, true, i === 1);
        }
        if (i === 0) {
            this.setFunction(evalNode.result.value);
        } else {
            this.setArgument(evalNode.result);
        }
    }

    updateInput(i: any, result: Result): void {
        var value: any = result !== undefined? result.value: undefined;

        switch (i) {
          case 0: // the function argument changed
            this.setFunction(value);
            this.markAsChanged();
            break;
          case 1: // the parameter argument changed
            this.setArgument(result);
            break;
          case 2: // the result of the defun body changed
            this.markAsChanged();
            break;
        default:
            var pos: number = - i - 1;
            assert(0 <= pos && pos < this.arguments.length, "DEBUGGING");
            this.values[pos] = result;
            this.markAsChanged();
            break;
        }
    }

    setFunction(value: any): void {
        var sv = value instanceof Array && value.length === 1? value[0]: value;

        this.destroyFunctionNodes();
        if (this.inputs[1] !== undefined && !this.inputs[1].isScheduled()) {
            this.setArgument(this.inputs[1].result);
        }
        if (sv instanceof DefunReference) {
            var dr = <DefunReference> sv;
            var defunNode = <DefunNode> dr.defun.prototype;
            if ("query" in this) {
                delete this.query;
            }
            if (defunNode.parameterNodes.length === 1) {
                this.fun = dr.defun;
                if (this.arguments !== undefined) {
                    this.instantiateSingleFun(0, this.arguments.length);
                }
            } else {
                Utilities.warn("map: wrong arguments to defun");
            }
        } else if (sv !== undefined) {
            this.query = sv;
        } else {
            if ("query" in this) {
                delete this.query;
            }
        }
    }

    multiQuerySourceIds(): number[] {
        return this.bodies === undefined? [this.watcherId]:
               this.bodies.map(function(body: EvaluationNode): number {
                   return body.watcherId;
               });
    }

    instantiateSingleFun(from: number, to: number): void {
        var defunNode = <DefunNode> this.fun.prototype;
        var defunNr: number = defunNode.defunNr;
        var templateId: number = this.fun.prototype.localToArea;
        var template: AreaTemplate = templateId > 0? areaTemplates[templateId]: undefined;
        var defunFNFunctionNodes: FunctionNode[] = templateId > 0?
            template.defunFunctionNodes[defunNr]: FunctionNode.globalDefunFunctionNodes[defunNr];
        var paramIsConstant: boolean = this.inputs[1].isConstant();

        if (this.parameters === undefined) {
            this.parameters = new Array<EvaluationDefunParameter>(to);
            this.bodies = new Array<EvaluationNode>(to);
            this.environments = new Array<LocalEvaluationEnvironment>(to);
            this.values = new Array<Result>(to);
            if (!paramIsConstant) {
                if (this.identifiers === undefined) {
                    this.identifiers = new Array<any>(to);
                } else {
                    this.identifiers.length = to;
                }
            } else {
                this.identifiers = this.inputs[1].result.identifiers;
                this.subIdentifiers = this.inputs[1].result.subIdentifiers;
            }
        }
        if (!this.fun.environment.isValid()) {
            return;
        }
        var parameterNode: FunctionNode = defunNode.parameterNodes[0];
        var parameterNodeId: number = parameterNode.id;
        var allBodiesConstant: boolean = true;
        for (var argi: number = from; argi < to; argi++) {
            var parameterSources: SourcePointer[] =
                [{node: this.inputs[1], position: argi}]; // There's only one parameter for a map defun
            var environment: LocalEvaluationEnvironment =
                new LocalEvaluationEnvironment(this.fun.environment, defunNr,
                                 defunFNFunctionNodes.length, parameterSources);
            this.environments[argi] = environment;
            // By constructing the parameter node like this before building the
            // other evaluation nodes, we can propagate constancy through the
            // body.
            this.parameters[argi] = <EvaluationDefunParameter>
                parameterNode.makeEvaluationNode(environment);
            this.parameters[argi].setSource(this.inputs[1], argi);
            this.setSingleParameter(argi, argi + 1);
            this.parameters[argi].init();
            this.parameters[argi].isBeingInitialized = false;
            for (var nodeId: number = 0; nodeId !== defunFNFunctionNodes.length; nodeId++) {
                if (nodeId !== parameterNodeId) {
                    // See notes in EvaluationApply
                    buildEvaluationNode(defunFNFunctionNodes[nodeId], environment);
                }
            }
            this.bodies[argi] = getEvaluationNode(defunNode.body, environment);
            if (!this.bodies[argi].isConstant()) {
                this.bodies[argi].addWatcher(this, -argi - 1, false, false, true);
                allBodiesConstant = false;
            } else {
                this.values[argi] = this.bodies[argi].result;
                this.markAsChanged();
            }
        }
        if (paramIsConstant && allBodiesConstant) {
            // NOTE: a constant [map] may not appear constant to *all* its
            // watchers. To achieve that, we should determine if the function
            // body guarantees a constant result on the first call to
            // addArgument. Since this will have a small benefit, it's not
            // considered worth the effort.
            this.funResultIsConstant = debugNoConstMaps;
            this.becomesConstant();
            this.constant = true;
        } else {
            this.activateSingleFun(from, to);
        }
    }

    deinstantiateSingleFun(from: number, to: number): void {
        if (this.nrActiveWatchers > 0) {
            this.deactivateSingleFun(from, to);
        }
        for (var argi: number = from; argi < to; argi++) {
            if (this.bodies[argi] !== undefined &&
                  !this.bodies[argi].isConstant()) {
                this.bodies[argi].removeWatcher(this, false, true);
                this.environments[argi].unlink();
            }
        }
        this.bodies.splice(from, to - from);
        this.environments.splice(from, to - from);
        this.parameters.splice(from, to - from);
        this.values.splice(from, to - from);
    }

    setArgument(result: Result): void {
        var value: any = result !== undefined? result.value: undefined;
        var curNrArgs: number = this.arguments !== undefined?
                                this.arguments.length: 0;

        this.result.copyLabelsMinusDataSource(result);
        if (result !== undefined) {
            this.identifiers = result.identifiers;
            this.subIdentifiers = result.subIdentifiers;
        }
        if (value === undefined) {
            this.arguments = [];
        } else if (value instanceof Array) {
            this.arguments = value;
        } else {
            this.arguments = [value];
        }
        if (this.fun !== undefined) {
            if (curNrArgs < this.arguments.length) {
                this.setSingleParameter(0, curNrArgs); // rest of arguments gets set below
                this.instantiateSingleFun(curNrArgs, this.arguments.length);
            } else {
                this.setSingleParameter(0, this.arguments.length);
                if (curNrArgs > 0) {
                    this.deinstantiateSingleFun(this.arguments.length, curNrArgs);
                    this.markAsChanged();
                }
            }
        }
    }

    setSingleParameter(from: number, to: number): void {
        for (var i: number = from; i < to; i++) {
            var paramValue: Result = new Result([this.arguments[i]]);
            if (this.identifiers !== undefined &&
                  this.identifiers[i] !== undefined) {
                paramValue.identifiers = [this.identifiers[i]];
            }
            if (this.subIdentifiers !== undefined &&
                this.subIdentifiers[i] !== undefined) {
                paramValue.subIdentifiers = [this.subIdentifiers[i]];
            }
            this.parameters[i].set(paramValue);
        }
    }

    activateInputs(): void {
        super.activateInputs();
        if (this.arguments !== undefined) {
            this.activateSingleFun(0, this.arguments.length);
        }
    }

    activateSingleFun(from: number, to: number): void {
        if (this.nrActiveWatchers > 0 && this.bodies !== undefined) {
            for (var i: number = from; i < to; i++) {
                var paramValue: Result = new Result([this.arguments[i]]);
                if (this.identifiers !== undefined &&
                      this.identifiers[i] !== undefined) {
                    paramValue.identifiers = [this.identifiers[i]];
                }
                if (this.subIdentifiers !== undefined &&
                    this.subIdentifiers[i] !== undefined) {
                    paramValue.subIdentifiers = [this.subIdentifiers[i]];
                }

                this.parameters[i].set(paramValue);
                this.bodies[i].activate(this, true);
            }
        }
    }

    deactivateInputs(): void {
        if (this.arguments !== undefined) {
            this.deactivateSingleFun(0, this.arguments.length);
        }
        super.deactivateInputs();
    }

    deactivateSingleFun(from: number, to: number): void {
        if (this.bodies !== undefined) {
            for (var i: number = from; i < to; i++) {
                this.bodies[i].deactivate(this, true);
            }
        }
    }

    eval(): boolean {
        var oldValue: any[] = this.result.value;
        var oldIdentifiers: any[] = this.result.identifiers;
        var oldSubIdentifiers: any[] = this.result.subIdentifiers;
        var r: any[];
        var ids: any[] = undefined;

        if ("fun" in this) {
            if (this.values !== undefined) {
                r = [];
                for (var i: number = 0; i < this.values.length; i++) {
                    if (this.values[i] !== undefined && this.values[i].value !== undefined) {
                        var v: Result = this.values[i];
                        if (v.value.length === 1) {
                            if (v.identifiers !== undefined) {
                                if (ids === undefined) {
                                    ids = new Array<any>(r.length + 1);
                                }
                                ids[r.length] = v.identifiers[0];
                            }
                            r.push(v.value[0]);
                        } else if (v.value.length > 1) {
                            if (v.identifiers !== undefined) {
                                if (ids === undefined) {
                                    ids = new Array<any>(r.length + v.value.length);
                                }
                                for (var j: number = 0; j < v.identifiers.length; j++) {
                                    ids[i + j] = v.identifiers[j];
                                }
                            }
                            Array.prototype.push.apply(r, v.value);
                        }
                    }
                }
                this.result.copyLabelsMinusDataSource(this.inputs[1].result);
                this.result.value = r;
                this.result.setIdentifiers(ids);
                if (this.funResultIsConstant) {
                    this.destroyFunctionNodes();
                    this.funResultIsConstant = false;
                }
            }
        } else if ("query" in this && this.arguments.length === 1) {
            var input0: Result = this.inputs[0].result;
            var dataIds: SubIdentifiers = undefined;
            var outIds: SubIdentifiers = undefined;
            if(input0.identifiers !== undefined ||
               input0.subIdentifiers !== undefined) {
                dataIds = new SubIdentifiers(input0.identifiers,
                                             input0.subIdentifiers);
                outIds = new SubIdentifiers(undefined, undefined);
            }
            this.result.copyLabelsMinusDataSource(this.inputs[1].result);
            if (dataIds !== undefined) {
                this.result.value = interpretedQueryWithIdentifiers(this.query,
                                             this.arguments, dataIds, outIds);
                this.result.setSubIdentifiers(outIds);
            } else {
                this.result.value = interpretedQuery(this.query, this.arguments);
                this.result.setSubIdentifiers(undefined);
            }
        } else {
            this.result.set([]);
        }
        return !valueEqual(oldValue, this.result.value) ||
            !valueEqual(oldIdentifiers, this.result.identifiers) ||
            !valueEqual(oldSubIdentifiers, this.result.subIdentifiers);
    }

    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        super.specificExplanation(explanation, classDebugInfo);
        if (this.bodies !== undefined) {
            var explList: any = {};
            for (var i: number = 0; i < this.bodies.length; i++) {
                explList[i + ": " + this.bodies[i].debugName()] =
                    this.bodies[i].explain(undefined);
            }
            explanation._bodies = explList;
        }
        return explanation;
    }

    allInputs(): EvaluationNode[] {
        return this.bodies !== undefined? this.inputs.concat(this.bodies):
               this.inputs;
    }
}
map.classConstructor = EvaluationMap;

/// Filter is like map, except it copies the input values when the result of the
/// function application is true.
class EvaluationFilter extends EvaluationMap {

    setArgument(result: Result): void {
        super.setArgument(result);
        this.markAsChanged();
    }

    eval(): boolean {
        var oldValue: any[] = this.result.value;
        var oldIdentifiers: any[] = this.result.identifiers;
        var oldSubIdentifiers: any[] = this.result.subIdentifiers;

        if ("fun" in this) {
            var r: any[] = [];
            var argumentValues: any[];
            var argumentIdentifiers: any[];
            var argumentSubIdentifiers: any[];
            var ids: SubIdentifiers = undefined;
            if (this.values !== undefined) {
                argumentValues = this.arguments;
                argumentIdentifiers = this.inputs[1].result.identifiers;
                argumentSubIdentifiers = this.inputs[1].result.subIdentifiers;
                var dataIds: SubIdentifiers = undefined;
                if(argumentIdentifiers || argumentSubIdentifiers) {
                    dataIds = new SubIdentifiers(argumentIdentifiers,
                                                 argumentSubIdentifiers);
                    ids = new SubIdentifiers(undefined, undefined);
                    ids.init(!!argumentIdentifiers,!!argumentSubIdentifiers);
                }
                for (var i: number = 0; i < this.values.length; i++) {
                    if (this.values[i] !== undefined &&
                          isTrue(this.values[i].value)) {
                        r.push(argumentValues[i]);
                        if(dataIds !== undefined) {
                            if(dataIds.identifiers)
                                ids.identifiers.push(dataIds.identifiers[i]);
                            if(dataIds.subIdentifiers)
                                ids.subIdentifiers.push(dataIds.subIdentifiers[i]);
                        }
                    }
                }
            }
            this.result.copyLabels(this.inputs[1].result);
            this.result.value = r;
            this.result.setSubIdentifiers(ids);
                
            if (this.funResultIsConstant) {
                this.destroyFunctionNodes();
                this.funResultIsConstant = false;
            }
        } else if ("query" in this && this.arguments.length === 1) {
            
            if (this.identifiers !== undefined ||
                this.subIdentifiers !== undefined) {
                var dataIds: SubIdentifiers =
                    new SubIdentifiers(this.identifiers, this.subIdentifiers);
                var ids: SubIdentifiers = new SubIdentifiers(undefined,undefined);
                this.result.value = interpretedQueryWithIdentifiers(
                    this.query, this.arguments, dataIds, ids);
                this.result.setSubIdentifiers(ids);
            } else {
                this.result.value = interpretedQuery(this.query, this.arguments);
                this.result.setSubIdentifiers(undefined);
            }
        } else {
            this.result.set([]);
        }
        return !valueEqual(oldValue, this.result.value) ||
            !valueEqual(oldIdentifiers, this.result.identifiers) ||
            !valueEqual(oldSubIdentifiers, this.result.subIdentifiers);
    }

    multiQuerySourceIds(): number[] {
        if (this.bodies === undefined) {
            return [this.watcherId];
        } else {
            var ids: number[] = [];
            for (var i: number = 0; i < this.values.length; i++) {
                if (this.values[i] !== undefined && isTrue(this.values[i].value)) {
                    ids.push(this.bodies[i].watcherId);
                }
            }
            return ids;
        }
    }
}
filter.classConstructor = EvaluationFilter;

type DSComp = {
    v: DataSourceComposable;
    previous: DSComp;
    step: number;
};

function findMaxLenSrcIdPath(v0: DataSourceComposable, sourceIds: Map<number, any>): number[] {
    var paths: DSComp[][] = [[{v: v0, previous: undefined, step: undefined}]];
    var distance: number = 0;

    function inHistory(v: DSComp, step: number): boolean {
        var ptr = v;

        while (ptr !== undefined) {
            if (ptr.step === step) {
                return true;
            }
            ptr = ptr.previous;
        }
        return false;
    }

    function steps(v: DSComp): number[] {
        var ptr = v;
        var stps: number[] = [];

        while (ptr.previous !== undefined) {
            stps.push(ptr.step);
            ptr = ptr.previous;
        }
        return stps.reverse();
    }

    while (distance < sourceIds.size && paths[distance].length > 0) {
        var curPaths: DSComp[] = paths[distance];
        distance++;
        paths.push([]);
        for (var i: number = 0; i < curPaths.length; i++) {
            var curStep: DSComp = curPaths[i];
            sourceIds.forEach(function(query: any, sourceId: number): void {
                var nextStep: DataSourceComposable =
                    curStep.v.getQueryApplicationWithSourceId(sourceId);
                if (nextStep !== undefined && !inHistory(curStep, sourceId)) {
                    paths[distance].push({v: nextStep, previous: curStep, step: sourceId});
                }
            });
        }
    }
    if (paths[distance].length === 0) {
        // when the full list was not present in the tree, the loop breaks with
        // distance 1 larger than the longest path.
        distance--;
    }
    // best distance found, all equally interesting
    return distance === 0? constEmptyOS: steps(paths[distance][0]);
}

// multiQuery applies an os of queries or defuns to a data set resulting in the
// intersection of the applications. It is worth noting that multiQuery is
// strictly meant for data selection, and optimizes using that property.

//   First, the list is split between queries and defuns. The defuns are applied
// to the data first (purely for convenience). Then, the (remaining) queries are
// applied. If the os of queries and defuns changes, multiQuery tries to
// minimize the amount of work to be done by starting evaluation at the first
// defun/query changed.
//   For non-dataSourceAware mode, the following strategy is followed.
//   In case of a changing defun, multiQuery replaces the bodies of the defuns,
// and copies the latest unaffected result to the first changed defun's
// parameter, which triggers evaluation.
//   In case of a changing query, that query gets placed after unchanged queries
// (firstQueryChanged). Since intermediate results are saved, the consequence is
// that only one query needs to be run when a user is make consecutive changes
// within a single facet (a common occurrence for dragging the slider or when
// adding and removing categories).
//   For dataSourceAware mode, query order isn't changed, but queries are added
// updated, and removed as the input changes. Defuns are not supported yet.
class EvaluationMultiQuery extends EvaluationFunctionApplication {
    // The list of functions or queries that has to be applied; we assume
    // they are all selections, so the order doesn't matter
    funList: any[] = undefined;
    // Defuns are applied first
    defuns: DefunReference[] = [];
    parameters: EvaluationStore[] = [];
    bodies: EvaluationNode[] = [];
    environments: LocalEvaluationEnvironment[] = [];
    lastFunOutput: Result = undefined;
    // Queries are applied to the result of the defun
    queries: any[] = [];
    querySourceIds: number[] = [];
    simpleQueries: SimpleQuery[] = [];
    compiledQueries: CompiledQuery[] = [];
    compiledQueryArguments: SimpleQuery[][] = [];
    firstQueryChanged: number = 0;
    queryResults: Result[] = [];
    // The unique input
    argument: Result = undefined;
    identifiers: any[] = undefined;

    constructor(prototype: FunctionApplicationNode, area: CoreArea) {
        super(prototype, area);
        this.result.value = constEmptyOS;
        this.dataSourceAware = true;
        this.dataSourceResultMode = true;
    }

    destroy(): void {
        if (linearMultiQuery && this.dataSourceChainEnd !== undefined) {
            this.dataSourceChainEnd.removeResultReceiver(this);
        }
        this.argument = undefined;
        this.clearFunctions(0);
        this.clearQueries(0);
        super.destroy();
    }

    addArgument(i: number, evalNode: EvaluationNode): void {
        this.inputs[i] = evalNode;
        if (!evalNode.isConstant()) {
            this.constant = false;
            evalNode.addWatcher(this, i, true, true, true);
        } else {
            if (i === 0) {
                this.setFunctionList(evalNode.result);
            } else if (i === 1) {
                this.setArgument(evalNode.result);
            } else {
                Utilities.warn("too many arguments to multiQuery");
            }
        }
    }

    updateInput(i: any, result: Result): void {
        if (i === 0) {
            this.setFunctionList(result);
            this.markAsChanged();
        } else if (i === 1) {
            this.setArgument(result);
        } else if (i === -this.bodies.length) {
            this.lastFunOutput = result;
            this.firstQueryChanged = 0;
            this.markAsChanged();
        } else if (this.parameters.length > -i) {
            // Copy result to the input parameter of the next function
            this.parameters[-i].set(result);
        }
    }

    setFunctionList(result: Result): void {
        var i: number = 0;
        var firstQueryChanged: number = this.firstQueryChanged;

        if (this.inputs[1] !== undefined &&
              ("dataSource" in this.inputs[1].result || "dataSource" in this.result) &&
              (this.inputs[1].isScheduled() || !this.inputs[1].isActive())) {
            // Wait with changing datasources until input has been updated
            this.inputs[1].addForcedUpdate(this);
            return;
        } else if (this.inputs[1] !== undefined && "dataSource" in this.inputs[1].result) {
            this.setDataSourceInput(this.inputs[1].result.dataSource);
            this.markAsChanged();
            return;
        } else if (this.dataSourceInput !== undefined) {
            this.setDataSourceQueryList([], []);
            this.setDataSourceInput(undefined);
            this.markAsChanged();
        }

        this.funList = result.value;
        if (this.funList === undefined) {
            this.clearFunctions(0);
            this.clearQueries(0);
            if (this.dataSourceInput !== undefined) {
                delete this.result.dataSource;
                this.setDataSourceQueryList([], []);
                this.setDataSourceInput(undefined);
            }
            this.markAsChanged();
            return;
        }

        // Find changes to defuns; keep them ordered as they were.
        var fi: number = 0;
        var lastFunctionInput: EvaluationNode = this.inputs[1]; // Tracks the input for the next function
        i = 0;
        while (i < this.funList.length) {
            if (this.funList[i] instanceof DefunReference) {
                if (fi === this.defuns.length ||
                      !this.defuns[fi].isEqual(this.funList[i])) {
                    break;
                }
                lastFunctionInput = this.bodies[fi];
                i++;
                fi++;
            } else {
                i += result.compiledQuery !== undefined && result.nrQueryElements[i] !== undefined?
                     result.nrQueryElements[i]: 1;
            }
        }
        var firstDefunChanged: number = fi;
        this.clearFunctions(fi);
        while (i < this.funList.length) {
            if (this.funList[i] instanceof DefunReference) {
                var defunRef: EvaluationDefun = this.funList[i].defun;
                if (!defunRef.environment.isValid()) {
                    continue;
                }
                var defunNode = <DefunNode> defunRef.prototype;
                var defunNr: number = defunNode.defunNr;
                var templateId: number = defunNode.localToArea;
                var template: AreaTemplate = areaTemplates[templateId];
                var defunFNFunctionNodes: FunctionNode[] = template.defunFunctionNodes[defunNr];
                var parameterSources: SourcePointer[] = [{node: lastFunctionInput, position: undefined}]; // There's only one parameter for a map defun
                var environment: LocalEvaluationEnvironment = new LocalEvaluationEnvironment(defunRef.environment, defunNr, defunFNFunctionNodes.length, parameterSources);
                this.environments[fi] = environment;
                this.defuns[fi] = this.funList[i];
                for (var nodeId: number = 0; nodeId !== defunFNFunctionNodes.length; nodeId++) {
                    buildEvaluationNode(defunFNFunctionNodes[nodeId], environment);
                }
                this.parameters[fi] = <EvaluationStore> getEvaluationNode(
                                      defunNode.parameterNodes[0], environment);
                this.bodies[fi] = getEvaluationNode(defunNode.body, environment);
                if (!this.bodies[fi].isConstant()) {
                    this.bodies[fi].addWatcher(this, -fi - 1, false, false, true);
                } else {
                    this.updateInput(-fi - 1, this.bodies[fi].result);
                }
                lastFunctionInput = this.bodies[fi];
                i++;
                fi++;
            } else {
                i += result.compiledQuery !== undefined && result.nrQueryElements[i] !== undefined?
                     result.nrQueryElements[i]: 1;
            }
        }
        if (fi !== firstDefunChanged) {
            // TODO: check if this leads to superfluous evaluation
            // This could happen when the defun nodes become next on the queue
            // while the argument parameter is also waiting
            this.parameters[firstDefunChanged].set(this.lastFunOutput);
        }

        // Find changes to queries; make sure to keep as many of the initial
        // query chain in tact as possible. We do this by splitting this.queries
        // out of queries.
        var qi: number;
        var queries: {
            dataRepr: any;
            compiledQueries: CompiledQuery;
            compiledQueryArguments: SimpleQuery[];
            newToOldPos: number;
        }[] = [];
        var oldToNewPosMap: number[] = new Array<number>(this.queries.length + 1);
        i = 0;
        while (i < this.funList.length) {
            if (this.funList[i] instanceof DefunReference) {
                i++;
            } else {
                var nrQE: number = result.compiledQuery !== undefined && result.nrQueryElements[i] !== undefined?
                    result.nrQueryElements[i]: 1;
                var dataRepr: any = nrQE === 1? this.funList[i]:
                                    this.funList.slice(i, nrQE);
                for (var qi: number = 0;
                     qi < this.queries.length &&
                       !objectEqual(this.queries[qi], dataRepr);
                     qi++);
                oldToNewPosMap[qi] = queries.length;
                queries.push({
                    dataRepr: dataRepr,
                    compiledQueries: result.compiledQuery !== undefined? result.compiledQuery[i]: undefined,
                    compiledQueryArguments: result.compiledQuery !== undefined? result.queryArguments[i]: undefined,
                    newToOldPos: qi
                });
                i += nrQE;
            }
        }
        for (var i: number = 0; i < this.queries.length && i < firstQueryChanged; i++) {
            if (oldToNewPosMap[i] === undefined) {
                firstQueryChanged = i;
                break;
            }
            queries[oldToNewPosMap[i]].dataRepr = undefined; // mark as accounted for
        }
        queries.sort(function(a, b): number {
            return a.newToOldPos - b.newToOldPos;
        });
        this.clearQueries(firstQueryChanged);
        for (var qi: number = 0; qi < queries.length; qi++) {
            if (queries[qi].dataRepr !== undefined) { // not in the list already
                if (result.compiledQuery !== undefined) {
                    this.compiledQueries.push(queries[qi].compiledQueries);
                    this.compiledQueryArguments.push(queries[qi].compiledQueryArguments);
                }
                this.queries.push(queries[qi].dataRepr);
                this.simpleQueries.push(makeSimpleQuery(queries[qi].dataRepr, undefined));
            }
        }
        if (firstQueryChanged < this.firstQueryChanged) {
            this.firstQueryChanged = firstQueryChanged;
        }
        this.markAsChanged();
        this.activateFuns();
    }

    clearFunctions(from: number): void {
        if (from === this.bodies.length) {
            return;
        }
        if (this.funList !== undefined) {
            if (this.nrActiveWatchers > 0) {
                this.deactivateFuns(from);
            }
            for (var funi: number = from; funi < this.bodies.length; funi++) {
                if (this.bodies[funi] !== undefined) {
                    this.bodies[funi].removeWatcher(this, false, true);
                }
                this.environments[funi].unlink();
            }
        }
        this.defuns.length = from;
        this.bodies.length = from;
        this.environments.length = from;
        this.parameters.length = from;
        this.lastFunOutput = from === 0? this.argument:
                                         this.bodies[from - 1].result;
        this.firstQueryChanged = 0;
    }

    clearQueries(from: number): void {
        this.queries.length = from;
        this.simpleQueries.length = from;
        this.compiledQueries.length = from;
        this.compiledQueryArguments.length = from;
        this.queryResults.length = from;
    }

    setDataSourceInput(dataSource: DataSourceComposable): void {
        if (this.dataSourceInput !== dataSource) {
            // remove current application
            if (this.dataSourceInput !== undefined) {
                this.setDataSourceQueryList([], []);
            }
            this.dataSourceInput = dataSource;
            if (linearMultiQuery) {
                if (this.dataSourceChainEnd === undefined) {
                    // Create a fixed 'pass through' result under which the
                    // selections are constructed
                    this.dataSourceChainEnd = dataSource.applyDataQuery(
                        _, this, DataSourceQueryByData._idForSelectionChain,
                        this.watcherId);
                }
            }
            this.markAsChanged();
        }
    }

    dataSourceQuerySet: Map<number, DataSourceQueryByData> =
        new Map<number, DataSourceQueryByData>();
    dataSourceChainEnd: DataSourceComposable = undefined;

    // Switches query application strategy based on linearMultiQuery.
    // Do *NOT* change linearMultiQuery after initialization.
    setDataSourceQueryList(queryList: any[], querySourceIds: number[]): void {
        if (linearMultiQuery) {
            if (this.querySourceIdPosition === undefined) {
                this.querySourceIdPosition = new Map<number, number>();
                this.querySourceIdOrder = [];
            }
            this.setDataSourceQueryListInChain(queryList, querySourceIds);
        } else {
            this.setDataSourceQueryListInTree(queryList, querySourceIds);
        }
    }

    // Try to apply the queries by their source id in such a way that it uses
    // the longest path of already existing query applications on the source.
    setDataSourceQueryListInTree(queryList: any[], querySourceIds: number[]): void {
        var queryBySourceId: Map<number, any> = new Map<number, any>();

        // get queries by source id, and skip defuns and duplicates
        for (var i: number = queryList.length - 1; i >= 0; i--) {
            var query_i: any = queryList[i];
            if (query_i instanceof ComparisonFunctionValue) {
                if (query_i.elements.length === 1) { 
                    query_i = query_i.elements[0];
                } else {
                    if (query_i.elements.length > 1) {
                        Utilities.warn("too many elements in c()");
                    }
                    query_i = undefined;
                }
            } 
            if (query_i !== undefined && !(query_i instanceof DefunReference) &&
                  !queryBySourceId.has(querySourceIds[i])) {
                queryBySourceId.set(querySourceIds[i], query_i);
            }
        }

        // Remove query source ids that are no longer in the list
        this.dataSourceQuerySet.forEach((dsq: DataSourceQueryByData, sourceId: number): void => {
            if (!queryBySourceId.has(sourceId)) {
                dsq.removeResultReceiver(this);
                this.dataSourceQuerySet.delete(sourceId);
            }
        });

        // Look for a query that is already applied to the input, and update
        // it, and then use that as the next step, until there are no queries
        // that can be updated; these will be applied consecutively to the
        // end point.
        this.dataSourceChainEnd = this.inputs[1].result.dataSource;
        var maxApplChainSourceIds: number[] = 
            findMaxLenSrcIdPath(this.dataSourceChainEnd, queryBySourceId);
        for (var i: number = 0; i < maxApplChainSourceIds.length; i++) {
            var sourceId = maxApplChainSourceIds[i];
            var appl = this.dataSourceChainEnd.
                getQueryApplicationWithSourceId(sourceId);
            if (this.dataSourceQuerySet.has(sourceId) &&
                  appl === this.dataSourceQuerySet.get(sourceId)) {
                appl.updateQuery(queryBySourceId.get(sourceId));
            } else {
                if (this.dataSourceQuerySet.has(sourceId)) {
                    this.dataSourceQuerySet.get(sourceId).
                        removeResultReceiver(this);
                }
                appl = this.dataSourceChainEnd.applyDataQuery(
                    queryBySourceId.get(sourceId), this, sourceId);
                this.dataSourceQuerySet.set(sourceId, appl);
            }
            queryBySourceId.delete(sourceId);
            this.dataSourceChainEnd = appl;
        }

        // Attach whatever is left to the end; perhaps there is some strategy
        // to optimize reuse, but now it's in whatever order for-in yields.
        queryBySourceId.forEach((query: any, sourceId: number): void => {
            if (this.dataSourceQuerySet.has(sourceId)) {
                this.dataSourceQuerySet.get(sourceId).
                    removeResultReceiver(this);
            }
            var appl = this.dataSourceChainEnd.
                applyDataQuery(query, this, sourceId);
            this.dataSourceQuerySet.set(sourceId, appl);
            this.dataSourceChainEnd = appl;
        });
    }

    querySourceIdPosition: Map<number, number>;
    querySourceIdOrder: number[];

    // Set up a chain of unshared queries and keep the end node identical by
    // inserting new queries below it. All queries are owned by this node and are
    // not shared.
    setDataSourceQueryListInChain(queryList: any[], querySourceIds: number[]): void {
        var addedQuerySourceIds: number[] = [];
        var removedQuerySourceIds: number[] = [];
        var queryBySourceId: Map<number, any> = new Map<number, any>();
        var updates: { queryDS: DataSourceQueryByData; query: any; }[] = [];

        // Determine changes: added and removed queries
        for (var i: number = 0; i < queryList.length; i++) {
            var query_i: any = queryList[i];
            if (query_i instanceof ComparisonFunctionValue) {
                if (query_i.elements.length === 1) { 
                    query_i = query_i.elements[0];
                } else {
                    if (query_i.elements.length > 1) {
                        Utilities.warn("too many elements in c()");
                    }
                    query_i = undefined;
                }
            } 
            if (query_i !== undefined && !(query_i instanceof DefunReference)) {
                var querySourceId: number = querySourceIds[i];
                queryBySourceId.set(querySourceId, query_i);
                if (this.querySourceIdPosition.has(querySourceId)) {
                    // Update the query, but delay it for efficiency
                    updates.push({
                        queryDS: this.dataSourceQuerySet.get(querySourceId),
                        query: query_i
                    });
                } else {
                    addedQuerySourceIds.push(querySourceId);
                }
            }
        }
        this.querySourceIdPosition.forEach((pos: number, querySourceId: number): void => {
            if (!queryBySourceId.has(querySourceId)) {
                removedQuerySourceIds.push(querySourceId);
            }
        });

        // Remove outdated queries. This can be improved by updating "isolated"
        // removed ids first, so that there are less moves in the next block.
        var addedQuerySourceIds2: number[] = [];
        var removedQuerySourceIds2: number[] = [];
        // First reuse them for added queries when possible
        while (addedQuerySourceIds.length > 0 && removedQuerySourceIds.length > 0) {
            var addedQSId: number = addedQuerySourceIds.pop();
            var removedQSId: number = removedQuerySourceIds.pop();
            var queryDS = this.dataSourceQuerySet.get(removedQSId);
            assert(queryDS.ownerId === this.watcherId, "must own queryDS before altering it");
            if (queryDS.querySourceId === removedQSId) {
                // We can and must change it
                queryDS.updateQuery(queryBySourceId.get(addedQSId));
                this.changeQuerySourceId(queryDS, removedQSId, addedQSId);
            } else if (queryDS.querySourceId === addedQSId) {
                // Has already been changed
                this.changeQuerySourceId(queryDS, removedQSId, addedQSId);
            } else {
                // We need to create a new application
                addedQuerySourceIds2.push(addedQSId);
                removedQuerySourceIds2.push(removedQSId);
            }
        }
        addedQuerySourceIds = addedQuerySourceIds.concat(addedQuerySourceIds2);
        removedQuerySourceIds = removedQuerySourceIds.concat(removedQuerySourceIds2);
        
        if (removedQuerySourceIds.length > 0) {
            // Before removing, first sort positions of the query source ids
            // to be removed.
            var remPositions: number[] = removedQuerySourceIds.
                map((remQSId: number): number => {
                    return this.querySourceIdPosition.get(remQSId);
                }).
                sort(function(a: number, b: number) { return a - b; });
            // Then for each chunk of consecutive queries to be removed, move the
            // application of the subsequent query to the input of the first in the
            // chunk.
            var i: number = 0;
            while (i < remPositions.length) {
                var startPos: number = remPositions[i];
                var endPos: number = startPos + 1;
                i++;
                // get all consecutive positions
                while (i < remPositions.length && remPositions[i] === endPos) {
                    endPos++;
                    i++;
                }
                var startQueryDS: DataSourceComposable =
                    startPos > 0?
                    this.dataSourceQuerySet.get(this.querySourceIdOrder[startPos - 1]):
                    this.dataSourceInput;
                var endQueryDS: DataSourceComposable =
                    endPos < this.querySourceIdOrder.length?
                    this.dataSourceQuerySet.get(this.querySourceIdOrder[endPos]):
                    this.dataSourceChainEnd;
                if (!endQueryDS.alreadyRegisteredOn(this, startQueryDS)) {
                    endQueryDS.moveToDataSource(this, startQueryDS);
                }
                for (var j: number = startPos; j < endPos; j++) {
                    this.querySourceIdOrder[j] = undefined;
                }
            }
            // The chain is ok, now compact the administration
            this.querySourceIdOrder = this.querySourceIdOrder.filter(function(qsid: number): boolean {
                return qsid !== undefined;
            });
            this.querySourceIdPosition.clear();
            for (var i: number = 0; i < this.querySourceIdOrder.length; i++) {
                this.querySourceIdPosition.set(this.querySourceIdOrder[i], i);
            }
            // Get rid of the removed queries' applications
            for (var i: number = 0; i < removedQuerySourceIds.length; i++) {
                var remQSId: number = removedQuerySourceIds[i];
                var queryDS = this.dataSourceQuerySet.get(remQSId);
                this.dataSourceQuerySet.delete(remQSId);
                queryDS.removeResultReceiver(this);
            }
        }

        // Find the end of the chain after removal
        var nrQueries: number = this.querySourceIdOrder.length;
        var chainEnd: DataSourceComposable = nrQueries === 0?
            this.dataSourceInput:
            this.dataSourceQuerySet.get(this.querySourceIdOrder[nrQueries - 1]);

        // Append new queries
        for (var i: number = 0; i < addedQuerySourceIds.length; i++) {
            var addedQSId: number = addedQuerySourceIds[i];
            var queryDS = chainEnd.applyDataQuery(
                queryBySourceId.get(addedQSId), this, addedQSId, this.watcherId);
            this.dataSourceQuerySet.set(addedQSId, queryDS);
            this.querySourceIdPosition.set(addedQSId, nrQueries);
            this.querySourceIdOrder[nrQueries] = addedQSId;
            chainEnd = queryDS;
            nrQueries++;
        }
        // Update the changed queries; this is delayed because it seems more
        // efficient to do that once the chain is in order.
        for (var i: number = 0; i < updates.length; i++) {
            assert(updates[i].queryDS.ownerId === this.watcherId, "must own queryDS before altering it");
            updates[i].queryDS.updateQuery(updates[i].query);
        }
        // and move the input of the terminating projection to the end of the
        // chain. This is a nop when there is no change.
        if (this.dataSourceChainEnd !== undefined) {
            this.dataSourceChainEnd.moveToDataSource(this, chainEnd);
        }
    }

    changeQuerySourceId(queryDS: DataSourceQueryByData, oldId: number, newId: number): void {
        var queryPos: number = this.querySourceIdPosition.get(oldId);

        this.dataSourceQuerySet.set(newId, queryDS);
        this.querySourceIdPosition.set(newId, queryPos);
        this.querySourceIdOrder[queryPos] = newId;
        this.dataSourceQuerySet.delete(oldId);
        this.querySourceIdPosition.delete(oldId);
        queryDS.changeQuerySourceId(newId);
    }

    newDataSourceResult(v: any[]): void {
        Utilities.error("should not be called");
    }

    reextractData(): void {
        assert(false, "should not be called");
    }

    setArgument(result: Result): void {
        this.argument = result;
        if (this.parameters.length !== 0) {
            this.parameters[0].set(result);
        } else {
            if (("dataSource" in result || "dataSource" in this.result) &&
                  (this.inputs[1].isScheduled() || !this.inputs[1].isActive())) {
                // Wait with changing datasources until input has been updated
                this.inputs[1].addForcedUpdate(this);
            } else if ("dataSource" in result) {
                this.setDataSourceInput(result.dataSource);
            } else {
                if (this.dataSourceInput !== undefined) {
                    this.setDataSourceInput(undefined);
                }
                this.lastFunOutput = result;
                this.firstQueryChanged = 0;
                this.markAsChanged();
            }
        }
    }

    activateInputs(): void {
        this.activateFuns();
        super.activateInputs();
    }

    activateFuns(): void {
        if (this.funList !== undefined) {
            if (this.bodies.length !== 0) {
                this.parameters[0].set(this.argument);
            }
            for (var i: number = 0; i !== this.bodies.length; i++) {
                this.bodies[i].activate(this, true);
            }
        }
    }

    deactivateInputs(): void {
        this.deactivateFuns(0);
        super.deactivateInputs();
    }

    deactivateFuns(from: number): void {
        if (this.funList !== undefined) {
            for (var i: number = from; i !== this.bodies.length; i++) {
                if (this.bodies[i] !== undefined) {
                    this.bodies[i].deactivate(this, true);
                }
            }
        }
    }

    // If there is a dataSourceInput, this function will operate in
    // data source result mode, whether the enviroment likes it or not.
    // This breaks write initialization at this moment, e.g.
    // "^myOverlaySolutionSetItemsOnLastSort": [{ myOverlay: { solutionSetItems:_ } }, [me]].
    // which looks problematic anyway (live write might help, but
    // how to merge?).
    setDataSourceResultMode(dataSourceResultMode: boolean): void {
    }

    // Even though we're supposed to return a javascript object, we're not going
    // to for now as it yields very large objects. If the program doesn't work,
    // the cdl should be adapted at this moment. To make it work, uncomment some
    // lines in eval(). Note: requires (de)activate; currently is internally
    // activated/deactivated depending on the queries or functions registered
    // on it.
    extractDataSourceResult(): boolean {
        this.result.value = emptyDataSourceResult;
        Utilities.warn("TODO: IMPLEMENT");
        return false;
    }

    eval(): boolean {
        var change: boolean = false;
        var oldResult: Result = this.result.clone();

        if (this.dataSourceInput !== undefined) {
            this.setDataSourceQueryList(this.inputs[0].result.value,
                                        this.inputs[0].multiQuerySourceIds());
            // if (this.dataSourceResultMode) {
                // Update is propagated via the data source application chain
                this.result.value = emptyDataSourceResult;
                if (this.result.dataSource !== this.dataSourceChainEnd) {
                    // Pass the query func result on as a data source
                    this.result.dataSource = this.dataSourceChainEnd;
                    return true;
                }
                return false;
            // } else {
            //     if ("dataSource" in this.result) {
            //         delete this.result.dataSource;
            //         change = true;
            //     }
            //     return this.extractDataSourceResult() || change;
            // }
        }

        if ("dataSource" in this.result) {
            delete this.result.dataSource;
            change = true;
        }

        if (this.lastFunOutput === undefined) {
            if (!valueEqual(this.result.value, undefined)) {
                this.result.set(undefined);
                return true;
            }
            return change;
        }

        var r: any = this.firstQueryChanged === 0? this.lastFunOutput.value:
            this.queryResults[this.firstQueryChanged - 1].value;
        var ids: SubIdentifiers = undefined;
        var oids: SubIdentifiers = undefined;
        var idResult: Result = this.firstQueryChanged === 0 ?
            this.lastFunOutput : this.queryResults[this.firstQueryChanged - 1];

        if(idResult && (idResult.identifiers || idResult.subIdentifiers))
            ids = new SubIdentifiers(idResult.identifiers,
                                     idResult.subIdentifiers);
        
        if (r !== undefined) {
            for (var i: number = this.firstQueryChanged; i < this.queries.length; i++) {
                if (this.simpleQueries[i] !== undefined &&
                      (this.compiledQueries[i] === undefined ||
                       (this.simpleQueries[i].canCache() && r.length > 30))) {
                    if (ids !== undefined) {
                        oids = ids;
                        ids = new SubIdentifiers(undefined,undefined);
                    }
                    if (this.simpleQueries[i].canCache()) {
                        var res: Result = i === 0? this.lastFunOutput: this.queryResults[i - 1];
                        r = this.simpleQueries[i].executeAndCache(res, ids, undefined);
                    } else {
                        r = this.simpleQueries[i].execute(r, oids, ids, undefined, undefined);
                    }
                } else if (ids !== undefined) {
                    oids = ids;
                    ids = new SubIdentifiers(undefined,undefined);
                    if (this.compiledQueries[i] !== undefined) {
                        r = this.compiledQueries[i](r, this.compiledQueryArguments[i], oids, ids);
                    } else {
                        r = interpretedQueryWithIdentifiers(this.queries[i], r, oids, ids);
                    }
                } else {
                    if (this.compiledQueries[i] !== undefined) {
                        r = this.compiledQueries[i](r, this.compiledQueryArguments[i]);
                    } else {
                        r = interpretedQuery(this.queries[i], r);
                    }
                }
                this.queryResults[i] = new Result(r);
                this.queryResults[i].setSubIdentifiers(ids);
            }
        }
        this.result.value = r;
        this.result.setSubIdentifiers(ids);
        if ("dataSource" in this.lastFunOutput) {
            this.result.dataSource = this.lastFunOutput.dataSource;
        } else {
            delete this.result.dataSource;
        }
        this.firstQueryChanged = this.queries.length;
        return change || !oldResult.isEqual(this.result);
    }

    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        super.specificExplanation(explanation, classDebugInfo);
        if (this.bodies !== undefined) {
            var explList: any = {};
            for (var i: number = 0; i < this.bodies.length; i++) {
                explList[i + ": " + this.bodies[i].debugName()] =
                    this.bodies[i].explain(undefined);
            }
            explanation._bodies = explList;
        }
        return explanation;
    }

    allInputs(): EvaluationNode[] {
        return this.bodies !== undefined? this.inputs.concat(this.bodies):
               this.inputs;
    }
}
multiQuery.classConstructor = EvaluationMultiQuery;
