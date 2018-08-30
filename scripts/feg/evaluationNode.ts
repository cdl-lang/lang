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
/// <reference path="functionNode.ts" />
/// <reference path="watcherProducer.ts" />
/// <reference path="evaluationQueue.ts" />
/// <reference path="result.ts" />
/// <reference path="area.ts" />
/// <reference path="simpleQuery.ts" />
/// <reference path="cdlDebugger.ts" />
/// <reference path="../query/fegValueIndexer.ts" />
/// <reference path="stringparser.ts" />
/// <reference path="evaluationNode.cycleCheck.ts" />

/*

TODO:

- Variants and area projections are not really data source aware, but pretend to
  be. When multiple variants are active, they should merge.

- internalApply can't set a new query on a DataSource

*/


/* Evaluation Nodes

   Contract: evaluation nodes inform their watchers only if their result has
   truly changed. If the inputs change, but the ouput doesn't, the watchers are
   not informed; if the input doesn't change, the eval function is not called
   and the watches will not receive an update either. An explicit call to
   forceUpdate() overrides that.


   How activation works
   ====================

   All nodes start inactive, with nrActiveWatchers at zero.

   If a node receives an updateInput(), it sets inputHasChanged to true. It is
   reset to false upon evaluation. A node doesn't have to be evaluated when
   inputHasChanged is false. Upon receiving and updateInput, an active node
   schedules itself for evaluation; an inactive node only marks that an input
   has changed.

   If a node is activated, it sends and activation message to its inputs, then
   checks if one of the inputs has changed, and if so, determines its new
   output and informs its watchers. The initial source of activation is an
   area's display, position, stacking and write.

   Notice that some inactive nodes (in particular, those watching an active
   node) can receive input updates. The difference with an active node is that
   they don't schedule themselves for execution, but wait until they are
   activated.

   Constant nodes are an exception. Since they will only evaluate once, and
   they need to evaluate once, and they don't accept watchers, evaluation is
   done immediately on construction, not when the node gets activated.
   Neither do they inform their inputs, since these have to be constant as
   well.

   Upon destruction, a node removes itself from all its inputs, and sends a
   deactivation message to each.

   The base class, EvaluationNode, provides all of the functionality, except for
   eval(), but certain classes may want to override the administration of their
   inputs. E.g., variant/qualifier nodes have a more complex structure and can
   deactivate nodes with false qualifiers, while other nodes can be watching
   results outside the activate/deactivate system (areas in particular).

   Note: the activate/deactivate messages are independent from adding and
   removing watchers.


   Watchers
   ========

   If a node watches another node for two (or more) different inputs, it
   should be aware that removeWatcher() will remove the node completely as a
   watcher. In the unlikely event that it wants to remove itself for only one
   input, it should add itself back for the other.


   Attributed time
   ===============

   During eval() and updateInput(), the CPU time spent is added to the node's
   time fields. In addition, that time divided by the number of watchers, is
   added to the watchers attributed time field. The total of that number gives
   an indication of the total time spent to compute the value.

   Problem: this measure is not completely fair. If a node is inactive, it
   gets attributed CPU time even though it isn't responsible for requesting
   the computation. Similarly, adding only to active nodes is also not totally
   fair, since it would not attribute time to a node that is first inactive,
   and only becomes active once the result is known, but seems the best
   alternative: it prevents nodes from accumulating attributed time while
   being inactive, which would make this time invisible during reporting.

   Note that time spent in an eval() that does not result in an update still
   stays invisible, as it is not propagated to a visible destination.


   Set mode
   ========

   When an evaluation accepts set mode and is switched to set mode, its inputs
   can contain an ordered set with identities that needs to be processed per
   identity. E.g, [plus, o(1, 10), o(1, 2)] results in o(2, 12) when not in
   set mode, but results in o(2, 3, 11, 12) when the first argument is in
   set mode, and has two identities, i1 and i2. It is as if o(1/i1, 10/i2) were
   split into two sets, and these were added to o(1, 2), i.e. the result is
   o([plus, o(1), o(1, 2)], [plus, o(10), o(1, 2)]).

   At the moment, set mode is only requested by map and filter, and allows them
   to process an os in a single defun instantiation, i.e. without the overhead
   of one defun instantiation per input element. Evaluation nodes can refuse set
   mode, in which case each element gets its own defun instance. Currently, AV
   construction, [cond] and the arithmetic functions accept set mode when at
   least one input has its locality inside the same defun, i.e. it is guaranteed
   that at least one input is a set with identities. This is a conservative
   approach which leads to unnecessary rejection of set mode, so refinement
   is needed when expanding this idea to area sets.


   Data Source Result Mode
   =======================

   When an EvaluationNode works in data source result mode, it passes a
   pointer to a FuncResult (in result.dataSource, hence the name) rather than
   computing a javascript object as the result. It also does not need to eval()
   any longer as long as its only watched by other nodes in data source result
   mode (see below); that task is taken over by the query mechanism. Instead,
   when the operation (e.g. the query itself) changes, the change is registered
   directly, and updates are propagated along the branches of the data source
   applications.

   Aggregating functions are a natural end point of such branches. When applying
   such a function to a data source result, the result will be a javascript
   value rather than another data element. Although not strictly necessary,
   there are multiple reasons to do so at this moment:
   1. Efficiency: the result of an aggregate function is a single value, and 
      is rarely if ever put in a large data set that is processed by further
      queries or aggregate functions.
   2. Interfacing with external sources: when we get to the point where the
      data comes from a source whose representation is beyond our control,
      such as a database or a web service, the outcome must be represented
      internally.

   Other functions, like [plus], need javascript input values. As soon as one of
   those registers on an EvaluationNode in data source result mode (and is
   active), the node also must keep it's javascript result object up to date.
   Propagation of that value then requires scheduling and updating the value
   in eval().

   Changes for EvaluationNodes in data source result mode:

   1. Output: a data source aware EvaluationNode works in data source result
      mode does so when its principal data input is in data source result
      mode. If the node is data source aware, it switches back and forth in this
      mode according to the input.

   2. Main input: if a node is not data source aware, nothing changes. The node
      it watches must provide javascript result values. If a node is data source
      aware, it must switch to data source result mode when the main input
      has a data result, and switch back when it doesn't.

   3. markAsChanged() is only called in data source aware mode when there are
      non-data source aware watchers; eval() converts the data to a normalized
      javascript object.

   4. a call to (de)activate (de)actives the data source application. [TODO]

   Special considerations:
   1. Variant nodes
   2. Writes to data sources are not allowed. If a write's merge: expression is
      a data source, the value must be converted at the moment of the write.
   3. identify/sort/pos
   4. map, filter are not supported for now.
   5. multiQuery
   6. [changed] and [time] on data sources are only supported via
      conversion to javascript objects for now.
   7. o(...), r(...) and n(...) are not data source aware.
   8. [os1, os2] should be replaced by [intersection, os1, os2].
   9. Area set data input will not be data source aware for now.

   Also: updates (and destroys) triggered from setData() can come during
   initialization, so it's necessary to be careful.

*/

declare var logValues: boolean;
// { templateId: true } will log all values in that template id,
// { templateId: { defunid: true } } will log all values of that defun in the template id
// { templateId: { defunid: { id: true } } } will log only one prototype
// Can be combined, e.g. { 163: true, 99: { 0: { 15: true } } }.
var logPrototypes: {[templateId: number]: any} = {};

declare var pathToExportId: PathAssociationTree<number>;

function getATDBIAttr(di: AreaTemplateDebugInfo, attr: string): AreaTemplateDebugInfo {
    return di !== undefined && "next" in di && attr in di.next? di.next[attr]: undefined;
}

// Merges a and b, assuming that a's top level object is the "accumulated" value
// of multiple sequential merges: it only makes copies of b, and assumes a is
// "owned" by the caller. Consequently, if a and b are objects, copies of
// attributes of b can be added to a.
//   This can be improved by keeping track of the state of the qualifiers and
// the inputs, combined with a merge function that knows when a change is made.
function mergeValueOverwrite(a: any, b: any): any {
    if (a instanceof Array) {
        if (a.length === 0) {
            return []; // This seems to be the behavior.
        }
        if (a.length !== 1 || b === undefined || (b instanceof Array && b.length !== 1)) {
            return a;
        }
    } else if (b instanceof Array && b.length !== 1) {
        return a;
    }
    var a0: any = a instanceof Array? a[0]: a;
    var b0: any = b instanceof Array? b[0]: b;
    if (!isAV(a0) || !isAV(b0)) {
        return a;
    }
    for (var attr in a0) {
        if (attr in b0) {
            a0[attr] = mergeValueCopy(a0[attr], b0[attr]);
        }
    }
    for (var attr in b0) {
        if (!(attr in a0)) {
            a0[attr] = b0[attr];
        }
    }
    return a;
}

// Merges a and b as above, but copies a when a change has to be made; if there
// is no change, it returns a or b.
function mergeValueCopy(a: any, b: any): any {
    if (a instanceof Array) {
        if (a.length === 0) {
            return []; // This seems to be the behavior.
        }
        if (a.length !== 1 || b === undefined || (b instanceof Array && b.length !== 1)) {
            return a;
        }
    } else if (b instanceof Array && b.length !== 1) {
        return a;
    }
    var a0: any = a instanceof Array? a[0]: a;
    var b0: any = b instanceof Array? b[0]: b;
    if (!isAV(a0) || !isAV(b0)) {
        return a;
    }
    var a0Empty: boolean = true; // Is a empty?
    var a0Repl: boolean = false; // has anything been replaced in a0?
    var o: any = {};
    for (var attr in a0) {
        a0Empty = false;
        if (attr in b0) {
            var repl: any = mergeValueCopy(a0[attr], b0[attr]);
            if (repl !== undefined) {
                o[attr] = repl;
                if (repl !== a0[attr]) {
                    a0Repl = true;
                }
            } else {
                a0Repl = true;
            }
        } else {
            o[attr] = a0[attr];
        }
    }
    if (a0Empty) {
        return b;
    }
    for (var attr in b0) {
        if (!(attr in a0)) {
            o[attr] = b0[attr];
            a0Repl = true;
        }
    }
    return a0Repl? [o]: a;
}

/**
 * Positions in the data that's being written to. The index indicates the
 * position in the top os. Length represents the length of the projection.
 * If there is a path, the data should be written to that path, and to the
 * positions indicated by "sub" under that path. E.g. write("x") to
 * { index: 0 } means that the first element in the os must be replaced by
 * "x". A write("x") to {index: 1, path: "a", sub:[{index: 1}]} means that "x"
 * must be written to the second element under "a" in the second element of
 * the os.
 * The field addedAttributes indicates that the data was written through an
 * empty selection which has added one or more attributes; these must be merged
 * with other writes with these attributes.
 * 
 * @class DataPosition
 */
class DataPosition {
    /// The position in the os; if undefined the identify or added attribute
    /// determines positions.
    index: number;
    /// Length of the segment being overwritten.
    length: number;
    /// Path in the os; can only contain 1 string
    path: string[];
    /// If writing goes deeper, sub specifies the position in the sub-os under path
    sub: DataPosition[];
    /// Attributes added during writing; since DataPosition only describes one
    /// level, this is just a mapping for current level attributes.
    addedAttributes: {[attr: string]: any};
    /// Identity of the element(s) being (over)written.
    identity: any;

    constructor(index: number, length: number, path?: string[], sub?: DataPosition[], addedAttributes?: {[attr: string]: any}, identity?: any) {
        this.index = index;
        this.length = length;
        if (path !== undefined && path.length > 1) {
            this.path = [path[0]];
            this.sub = [new DataPosition(0, 1, path.slice(1), sub)];
        } else {
            if (path !== undefined) {
                this.path = path;
            }
            if (sub !== undefined) {
                this.sub = sub;
            }
        }
        if (addedAttributes !== undefined) {
            this.addedAttributes = addedAttributes;
        }
        if (identity !== undefined) {
            this.identity = identity;
        }
    }

    copy(): DataPosition {
        return new DataPosition(this.index, this.length, this.path, this.sub,
                              shallowCopy(this.addedAttributes), this.identity);
    }

    addPath(path: string[], sub: DataPosition[]): DataPosition {
        if (this.path === undefined) {
            return new DataPosition(this.index, this.length, path, sub);
        } else {
            return new DataPosition(
                this.index, this.length, this.path,
                this.sub.map(function(dp: DataPosition): DataPosition {
                    return dp.addPath(path, sub);
                }));
        }
    }

    copyWithOffset(offset: number): DataPosition {
        return new DataPosition(this.index - offset, this.length, this.path,
                                this.sub, this.addedAttributes, this.identity);
    }

    copyWithIdentity(identity: any): DataPosition {
        assert(this.identity === undefined || this.identity === identity,
               "identity should not be overwritten");
        return new DataPosition(this.index, this.length, this.path,
                                this.sub, this.addedAttributes, identity);
    }

    copyWithAddedAttributes(attrs: any): DataPosition {
        var addedAttributes: any = this.addedAttributes === undefined? {}:
                                   shallowCopy(this.addedAttributes);
        
        for (var attr in attrs) {
            if (attr in addedAttributes &&
                  !objectEqual(attrs[attr], addedAttributes[attr])) {
                Utilities.warn("non-matching added attributes");
                return this;
            }
            addedAttributes[attr] = attrs[attr];
        }
        return new DataPosition(this.index, this.length, this.path,
                                this.sub, addedAttributes, this.identity);
    }

    static staticToString(dp: DataPosition): string {
        return dp.path === undefined? "(" + dp.index + ", " + dp.length + ")":
            "(" + dp.index + ", " + dp.length + ", " + dp.path.join(".") + 
            (dp.identity === undefined? "": ", " + dp.identity) + "=" +
            dp.sub.map(DataPosition.staticToString).join(";") + ")";
    }

    toString(): string {
        return this.path === undefined? "(" + this.index + ", " + this.length + ")":
            "(" + this.index + ", " + this.length + ", " + this.path.join(".") + "=" +
            this.sub.map(DataPosition.staticToString).join(";") + ")";
    }

    writesToPath(path: string[], offset: number = 0): boolean {
        if (!("sub" in this) || path.length === 0) {
            return !("sub" in this) && path.length === 0;
        }
        if (this.path[0] !== path[offset]) {
            return false;
        }
        return this.sub.some(function(dp: DataPosition): boolean {
            return dp.writesToPath(path, offset + 1);
        });
    }

    static toString(positions: DataPosition[]): string {
        return positions === undefined? "undefined":
               positions.map(DataPosition.staticToString).join(",");
    }
}

var gProfile: boolean = false; // switch by URL param profile=true
var gDoCheckCycles: boolean = false;

interface TimeStatistics {
    nrInstances?: number;
    nrCallsToUpdate: number;
    nrCallsToEval: number;
    nrTimesChanged: number;
    totalEvalTime: number;
    totalInformWatchersTime: number;
    totalUpdateInputTime: number;
    nrQueueResets: number;
    totalAttributedTime: number;
}

function dsaw_add(cnt: {[watcherId: number]: number}, watcherId: number, n: number): void {
    if (watcherId in cnt) {
        cnt[watcherId] += n;
    } else {
        cnt[watcherId] = n;
    }
}

function dsaw_sub(cnt: {[watcherId: number]: number}, watcherId: number, n: number): void {
    assert(cnt[watcherId] >= n, "debugging");
    cnt[watcherId] -= n;
    if (cnt[watcherId] === 0) {
        delete cnt[watcherId];
    }
}

interface CleanUpUnusedEvaluationNodes {
    // Removes the evaluation node that implements this interface as a watcher
    // from the nodes it doesn't activate. This will allow the clean-up function
    // to remove it (when there are no other nodes watching it, of course).
    removeWatcherFromInactiveNodes(): void;
}

type WatcherMap = Map<number, {watcher: Watcher; pos: any[];}>;

// var gDeferralInitiatingNode: EvaluationNode = undefined;

abstract class EvaluationNode implements Watcher, Producer, Evaluator, TimeStatistics {

    isBeingInitialized: boolean = true;
    // Contains essential information such as priority, schedule step and
    // defun nr.
    prototype: FunctionNode;
    // The evaluation environment
    local: EvaluationEnvironment;
    
    // The result of this evaluation node after eval(). Valid when
    // inputHasChanged is false.
    result: Result = new Result();

    // Watcher interface
    watcherId: number = undefined;
    dataSourceAware: boolean = false;

    /// All watchers and their callback parameters
    watchers: WatcherMap = new Map<number, {watcher: Watcher; pos: any[];}>();
    /// Watchers that want an update even if there is no change in output
    forcedUpdate: WatcherMap;
    /// Evaluators waiting for evaluation of this node after being deferred
    awaitingThis: Map<number, Evaluator>;
    /// A node is active it is nrActiveWatchers is at least 1. Areas provide
    /// activation to the nodes they watch.
    nrActiveWatchers: number = 0;
    nrNonDataSourceAwareActiveWatchers: number = 0;

    // DEBUGGING: set of active non-data source aware watchers
    actndsaw: {[watcherId: number]: number} = {};

    /// When false, eval() will not be called
    inputHasChanged = true;
    /// List of all inputs; needed for default functionality, activation,
    /// query source ids, etc. Note that it references nodes that may have been
    /// deleted by cleanUpUnusedEvaluationNodes.
    inputs: EvaluationNode[];
    /// When dataSourceResultMode is true, the result of the operation is a
    /// data source whenever possible (not obligatory). When it is false, the
    /// result cannot be a data source.
    dataSourceResultMode: boolean;

    // NOTE: activeWatchersCount, and the src argument to activate and
    // deactivate are for debugging only [DEBUG]
    // activeWatchersCount: {[id: number]: {watcher: Watcher; count: number;}} = {};

    // Performance info for development
    nrCallsToUpdate: number = 0;
    nrCallsToEval: number;
    nrTimesChanged: number = 0;
    totalEvalTime: number;
    totalInformWatchersTime: number;
    totalUpdateInputTime: number;
    nrQueueResets: number;
    attributedTime: number;
    totalAttributedTime: number;
    // nrDeferralsInitiated: number = 0;

    // -1 means: not scheduled; -2 means: on hold; 0 or higher correponds to the
    // array index in the queue; when deferred is true, this is the position in
    // the secondary queue.
    scheduledAtPosition: number = -1;

    // When true, the node is awaiting completion of one of its inputs due to
    // out of order scheduling; scheduledAtPosition will have a positive value
    // in this case.
    // this.deferred <=> this in evaluationQueue.deferredQueues.
    deferred: boolean = false;

    static nrNodes: number = 0; // debugging

    lastSeenInCycleCheck: number;

    constructor(prototype: FunctionNode, local: EvaluationEnvironment) {
        this.watcherId = getNextWatcherId();
        this.prototype = prototype;
        this.local = local;
        EvaluationNode.nrNodes++;
        if (gProfile) {
            this.nrCallsToEval = 0;
            this.totalEvalTime = 0;
            this.totalInformWatchersTime = 0;
            this.totalUpdateInputTime = 0;
            this.nrQueueResets = 0;
            this.attributedTime = 0;
            this.totalAttributedTime = 0;
        }
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"EvaluationNode",id:this.watcherId});
    }

    destroy(): void {
        // EvaluationNode.unregister(this);
        if (this.deferred) {
            this.inputHasChanged = false; // needed for undefer
            this.undefer();
        } else  if (this.isScheduled()) {
            if (this.deferred) {
                evaluationQueue.undefer(this);
            } else {
                evaluationQueue.unschedule(this);
            }
        }
        this.result = undefined;
        if (this.watchers !== undefined) {
            this.informAllWatchers();
        }
        this.removeAsWatcher();
        if (this.nrActiveWatchers !== 0) {
            // We expect that all watchers have been removed, except for defuns
            // that were returned by the area where the defun originated. The
            // following is for debugging only.
            var localToArea: number = this.prototype.localToArea;
            this.watchers.forEach(function (w): void {
                var watcher: Watcher = w.watcher;
                if (watcher instanceof EvaluationNode) {
                    assert(watcher.prototype.localToDefun && watcher.prototype.localToArea === localToArea,
                           "only defuns in same area can be watching after destroy");
                } else {
                    Utilities.error("non-evaluation node watching after destroy");
                }
            });
        }
        this.inputs = undefined;
        this.watchers = undefined;
        if (this.awaitingThis !== undefined) {
            this.awaitingThis.forEach(function (ev: Evaluator): void {
                ev.undefer();
                evaluationQueue.schedule(ev, false);
            });
            this.awaitingThis = undefined;
        }
        if (gProfile) {
            this.accumulateTime();
        }
        EvaluationNode.nrNodes--;
    }

    getScheduleStep(): number {
        return this.prototype.scheduleStep;
    }

    getSchedulePriority(): number {
        return this.prototype.prio;
    }

    // Note that result === undefined means the input no longer exists; this
    // cannot happen to a "normal" evaluation node, as it means the area is
    // being destroyed, but it can happen to a projection or selection.
    abstract updateInput(id: any, result: Result): void;

    isScheduled(): boolean {
        return this.scheduledAtPosition !== -1;
    }

    // called by scheduler (which must check this.isScheduled)
    updateOutput(): void {
        assert(!this.isBeingInitialized, "no eval during initialization");
        assert(!this.deferred, "cannot evaluate deferred nodes");
        this.nrCallsToUpdate++;
        var evalState: boolean;
        if (this.nrActiveWatchers > 0) {
            // If there is a potential scheduling error, we need to check the
            // state of all inputs. If some of them are still scheduled, this
            // node and all nodes depending on it will be deferred.
            if ("schedulingError" in this.prototype && !this.isReady()) {
                this.defer();
                return;
            }
            if (this.inputHasChanged) {
                evalState = this.evalt();
            } else {
                evalState = false;
            }
        } else {
            evalState = false;
        }
        if (this.deferred) {
            return;
        }
        if (evalState !== undefined && this.awaitingThis !== undefined) {
            this.awaitingThis.forEach((ev: Evaluator): void => {
                ev.undefer();
                evaluationQueue.schedule(ev, false);
            });
            this.awaitingThis = undefined;
        }
        switch (evalState) {
          case true:
            this.nrTimesChanged++;
            if (logValues && this.isLogNode())
                gSimpleLog.log(this.logValString(), "=",
                            JSON.stringify(this.result.value));
            if (this.scheduledAtPosition !== -1) {
                this.addAllWatchersToForcedUpdate();
            } else {
                this.informAllWatchers();
            }
            break;
          case false:
            if ("forcedUpdate" in this && !this.deferred) {
                var forcedUpdate = this.forcedUpdate;
                delete this.forcedUpdate;
                this.inform(forcedUpdate);
            }
            break;
          case undefined:
            this.inputHasChanged = true;
            evaluationQueue.schedule(this, false);
            break;
        }
    }

    // This node has changed and needs to be scheduled to evaluate and inform
    // its watchers. Note that inactive nodes are scheduled once they become
    // active.
    markAsChanged(): void {
        this.inputHasChanged = true;
        if (this.deferred) {
            this.undefer();
        }
        if (this.nrActiveWatchers > 0) {
            evaluationQueue.schedule(this, false);
        }
    }

    // Updates the actual value; const nodes don't need to do anything
    abstract eval(): boolean;

    // calls eval, and maintains some statistics
    evalt(): boolean {
        var changed: boolean;

        this.inputHasChanged = false;
        if (g_noTryAndCatchUpdate) {
            if (gProfile) {
                var t0: number = performance.now();
                changed = this.eval();
                var t1: number = performance.now() - t0;
                this.totalEvalTime += t1;
                this.attributedTime += t1;
                this.nrCallsToEval++;
                return changed;
            } else {
                return this.eval();
            }
        } else {
            try {
                if (gProfile) {
                    var t0: number = performance.now();
                    changed = this.eval();
                    var t1: number = performance.now() - t0;
                    this.totalEvalTime += t1;
                    this.attributedTime += t1;
                    this.nrCallsToEval++;
                    return changed;
                } else {
                    return this.eval();
                }
            } catch (ex) {
                console.log("run time error during eval:", ex.toString());
            }
            return false;
        }
    }

    // Prepares this for use: constant nodes are evaluated (so their values will
    // be available); non-constant nodes should just await first execution,
    // although special needs could be initialized here.
    init(): void {
        if (this.isConstant()) {
            this.eval();
            if (logValues && this.isLogNode())
                gSimpleLog.log(this.logValString(), "=", JSON.stringify(this.result.value));
            this.watchers = undefined;
        }
    }

    // Should be overridden. When it returns true, this node is not supposed
    // to generate any updates.
    isConstant(): boolean {
        return false;
    }

    // Call when changing an evaluation node from not constant to constant.
    // It suffices to remove the watchers object. If there is a forcedUpdate
    // pending, it will be cleared after the scheduled call to updateOutput().
    // Note that updateOutput()'s call to eval() should return false.
    becomesConstant(): void {
        assert(!this.deferred, "cannot be deferred");
        this.watchers = undefined;
        this.nrActiveWatchers = 0;
        this.deactivateInputs();
    }

    // Returns true when the result of the function is only applicable at this
    // moment, and the function cannot change inputHasChanged. Examples are
    // area coordinates and clock functions. This only serves to inform
    // cycle detection it's ok that a function's inputs change during its
    // updateOutput.
    resultIsTransient(): boolean {
        return false;
    }

    // forceFirstUpdate makes sure that this node is scheduled and will call
    // the watcher, even if there is no change. forceFirstUpdate is ignored on
    // nodes that are local to a defun.
    addWatcher(watcher: Watcher, pos: any, forceFirstUpdate: boolean, conditionallyActivate: boolean, dataSourceAware: boolean): void {
        if (!this.isConstant()) {
            if (this.watchers.has(watcher.watcherId)) {
                this.watchers.get(watcher.watcherId).pos.push(pos);
            } else {
                var positions: any[] = new Array(1);
                positions[0] = pos;
                this.watchers.set(watcher.watcherId, {
                    watcher: watcher,
                    pos: positions
                });
            }
            if (forceFirstUpdate && this.prototype.localToDefun === 0) {
                this.forceUpdate(watcher, false);
            }
            if (gDoCheckCycles) {
                singleChangeCycleCheck(this);
            }
            if (conditionallyActivate && watcher.isActive()) {
                assert(dataSourceAware !== undefined, "debugging");
                this.activate(watcher, dataSourceAware);
            }
        }
    }

    isActive(): boolean {
        return this.nrActiveWatchers > 0;
    }

    forceUpdate(watcher: Watcher, acceptQueueReset: boolean): void {
        if (!this.isScheduled()) {
            evaluationQueue.schedule(this, acceptQueueReset);
        }
        this.addForcedUpdate(watcher);
    }

    // Can be called when this is scheduled.
    addForcedUpdate(watcher: Watcher): void {
        if (this.forcedUpdate === undefined) {
            this.forcedUpdate = new Map<number, {watcher: Watcher; pos: any[];}>();
        }
        if (this.watchers.has(watcher.watcherId)) {
            this.forcedUpdate.set(watcher.watcherId, this.watchers.get(watcher.watcherId));
        }
    }

    // Adds all watchers to the forced update list. This is called when this is
    // not yet ready, but we are not sure the output will change.
    addAllWatchersToForcedUpdate(): void {
        if (this.forcedUpdate === undefined) {
            this.forcedUpdate = new Map<number, {watcher: Watcher; pos: any[];}>();
        }
        this.watchers.forEach((w, watcherId): void => {
            if (!this.forcedUpdate.has(watcherId) &&
                  this.watchers.has(watcherId)) {
                this.forcedUpdate.set(watcherId, this.watchers.get(watcherId));
            }
        });
    }

    // Removes one position, or all positions when omitting pos
    removeWatcher(watcher: Watcher, conditionallyDeactivate: boolean, dataSourceAware: boolean): void {
        if (!this.isConstant() && this.watchers !== undefined &&
              this.watchers.has(watcher.watcherId)) {
            var nrDeactivates: number = this.watchers.get(watcher.watcherId).pos.length;
            this.watchers.delete(watcher.watcherId);
            if (conditionallyDeactivate && watcher.isActive()) {
                assert(dataSourceAware !== undefined, "debugging");
                while (nrDeactivates > 0) {
                    this.deactivate(watcher, dataSourceAware);
                    nrDeactivates--;
                }
            }
            if (this.awaitingThis !== undefined && this.awaitingThis.has(watcher.watcherId)) {
                this.removeAwaitingThis(watcher.watcherId);
                if (watcher.isDeferred()) {
                    watcher.undefer();
                }
            }
            if ("forcedUpdate" in this) {
                this.forcedUpdate.delete(watcher.watcherId);
            }
        }
    }

    removeWatcherForPos(watcher: Watcher, pos: any, conditionallyDeactivate: boolean, dataSourceAware: boolean): void {
        if (!this.isConstant() && this.watchers !== undefined &&
              this.watchers.has(watcher.watcherId)) {
            var w = this.watchers.get(watcher.watcherId);
            var posIndex = w.pos.indexOf(pos);
            assert(posIndex >= 0, "DEBUGGING");
            if (w.pos.length === 1) {
                // If it's the only one, remove, update, etc. completely
                this.removeWatcher(watcher, conditionallyDeactivate, dataSourceAware);
            } else {
                // watcher is still interested in this node; only remove
                // the tag, and take out one activation when requested
                w.pos.splice(posIndex, 1);
                if (conditionallyDeactivate && watcher.isActive()) {
                    assert(dataSourceAware !== undefined, "debugging");
                    this.deactivate(watcher, dataSourceAware);
                }
            }
        }
    }

    addAwaitingThis(watcherId: number, evaluator: Evaluator): void {
        if (this.awaitingThis === undefined) {
            this.awaitingThis = new Map<number, Evaluator>();
        }
        this.awaitingThis.set(watcherId, evaluator);
    }

    removeAwaitingThis(watcherId: number): void {
        this.awaitingThis.delete(watcherId);
        if (this.awaitingThis.size === 0) {
            this.awaitingThis = undefined;
        }
    }

    activate(src: Watcher, dataSourceAware: boolean): void {
        if (this.isBeingInitialized) console.log(this.watcherId + " did not complete initialization before activation");
        if (!this.isConstant()) {
            // if (src.watcherId in this.activeWatchersCount) {
            //     this.activeWatchersCount[src.watcherId].count++;
            // } else {
            //     this.activeWatchersCount[src.watcherId] = {
            //         watcher: src,
            //         count: 1
            //     };
            // }
            if (!dataSourceAware) {
                dsaw_add(this.actndsaw, src.watcherId, 1);
                this.nrNonDataSourceAwareActiveWatchers++;
                if (this.nrNonDataSourceAwareActiveWatchers === 1) {
                    this.setDataSourceResultMode(false);
                }
            }
            this.nrActiveWatchers++;
            assert(this.nrActiveWatchers >= this.nrNonDataSourceAwareActiveWatchers &&
                   this.nrNonDataSourceAwareActiveWatchers >= 0, "debugging");
            if (this.nrActiveWatchers === 1) {
                // just became active; activate inputs, determine the current
                // value, and tell the others if anything has changed
                if (logValues && this.isLogNode()) gSimpleLog.log("activate", this.logValString());
                this.activateInputs();
                if (this.inputHasChanged && !this.isScheduled()) {
                    evaluationQueue.schedule(this, false);
                }
            }
        }
    }

    // Must be overridden when not using this.inputs[] or when the internal
    // state depends on an input which might have changed while "this" was
    // inactive, or when inputs are mixed datasoure aware
    activateInputs(): void {
        assert(!this.isConstant(), "debugging");
        if (this.inputs !== undefined) {
            for (var i: number = 0; i !== this.inputs.length; i++) {
                if (this.inputs[i] !== undefined) {
                    this.inputs[i].activate(this, this.dataSourceAware);
                }
            }
        }
    }

    // Runs the queue to force the evaluation of this (and possibly quite a
    // few other nodes as well). Only called rom the debug functions.
    forceActive(src: Watcher, dataSourceAware: boolean): boolean {
        if (this.isConstant()) {
            return true;
        }
        this.activate(src, dataSourceAware);
        this.markAsChanged();
        evaluationQueue.runUntil(this);
        if (this.isScheduled()) {
            // Can possibly be deferred because offset is waiting for positioning
            assert(this.deferred, "should have been evaluated now");
            if (globalTaskQueue.isScheduled(globalGeometryTask)) {
                globalPosConstraintSynchronizer.flushBuffer();
                globalPos.reposition(undefined);
                evaluationQueue.runUntil(this);
            }
        }
        return !this.isScheduled();
    }

    deactivate(src: Watcher, dataSourceAware: boolean): void {
        if (!this.isConstant()) {
            assert(this.nrActiveWatchers > 0, "too many deactivates");
            this.nrActiveWatchers--;
            // assert(src.watcherId in this.activeWatchersCount, "not an active watcher");
            // this.activeWatchersCount[src.watcherId].count--;
            // if (this.activeWatchersCount[src.watcherId].count === 0) {
            //     delete this.activeWatchersCount[src.watcherId];
            // }
            if (this.awaitingThis !== undefined && this.awaitingThis.has(src.watcherId)) {
                this.removeAwaitingThis(src.watcherId);
            }
            if (this.nrActiveWatchers === 0 && !this.isConstant()) {
                if (logValues && this.isLogNode()) gSimpleLog.log(this.logValString(), "deactivate");
                this.deactivateInputs();
                if (this.deferred) {
                    this.undefer();
                } else if (this.isScheduled()) {
                    evaluationQueue.unschedule(this);
                }
            }
            if (!dataSourceAware) {
                dsaw_sub(this.actndsaw, src.watcherId, 1);
                this.nrNonDataSourceAwareActiveWatchers--;
                if (this.nrNonDataSourceAwareActiveWatchers === 0) {
                    this.setDataSourceResultMode(true);
                }
            }
            assert(this.nrActiveWatchers >= this.nrNonDataSourceAwareActiveWatchers &&
                   this.nrNonDataSourceAwareActiveWatchers >= 0, "debugging");
        }
    }

    // Must be overridden when not using this.inputs[] and for mixed data source
    // aware inputs
    deactivateInputs(): void {
        assert(!this.isConstant(), "debugging");
        if (this.inputs !== undefined) {
            for (var i: number = 0; i !== this.inputs.length; i++) {
                if (this.inputs[i] !== undefined) {
                    this.inputs[i].deactivate(this, this.dataSourceAware);
                }
            }
        }
    }

    // If dataSourceResultMode becomes false, the result must be a javascript
    // object. If it becomes true, the node can choose, but must keep the data
    // source path up to date. This function must be implemented by data source
    // aware classes.
    setDataSourceResultMode(dataSourceResultMode: boolean): void {
        assert(!this.dataSourceAware, "DEBUGGING");
    }

    // When an active watcher goes from non data source aware to data source
    // aware, it has to call this function for every input for which it wants to
    // be datasourcee aware (even if it registers multiple times on the same
    // input). This function then updates the data source result mode of the
    // input. This function should not be called when there is no change in data
    // source awareness or for non active watchers.
    activeWatcherBecomesDataSourceAware(watcher: Watcher): void {
        if (!this.isConstant()) {
            dsaw_sub(this.actndsaw, watcher.watcherId, 1);
            this.nrNonDataSourceAwareActiveWatchers--;
            assert(this.nrActiveWatchers >= this.nrNonDataSourceAwareActiveWatchers &&
                this.nrNonDataSourceAwareActiveWatchers >= 0, "debugging");
            if (this.nrNonDataSourceAwareActiveWatchers === 0) {
                this.setDataSourceResultMode(true);
            }
        }
    }

    // The opposite of watcherBecomesDataSourceAware().
    activeWatcherNoLongerIsDataSourceAware(watcher: Watcher): void {
        if (!this.isConstant()) {
            dsaw_add(this.actndsaw, watcher.watcherId, 1);
            this.nrNonDataSourceAwareActiveWatchers++;
            assert(this.nrActiveWatchers >= this.nrNonDataSourceAwareActiveWatchers &&
                this.nrNonDataSourceAwareActiveWatchers >= 0, "debugging");
            if (this.nrNonDataSourceAwareActiveWatchers === 1) {
                this.setDataSourceResultMode(false);
            }
        }
    }

    informAllWatchers(): void {
        if ("forcedUpdate" in this) {
            delete this.forcedUpdate;
        }
        if (this.watchers !== undefined) {
            this.inform(this.watchers);
        }
    }

    inform(watchers: WatcherMap): void {
        var result: Result = this.result;
        // This checks the proper use of result.dataSource and
        // result.value === emptyDataSourceResult
        if (result !== undefined && result.dataSource !== undefined && result.value !== emptyDataSourceResult)
            debugger;

        if (gProfile) {
            var t0: number = performance.now();
            var tUpdSum: number = 0;
            var activeWatchers: Watcher[] = [];
            watchers.forEach(function (w): void {
                var watcher = w.watcher;
                if (watcher.isActive()) {
                    activeWatchers.push(watcher);
                }
                for (var i: number = w.pos.length - 1; i >= 0 ; i--) {
                    try {
                        var t1: number = performance.now();
                        watcher.updateInput(w.pos[i], result);
                        t1 = performance.now() - t1;
                        watcher.totalUpdateInputTime += t1;
                        watcher.attributedTime += t1;
                        tUpdSum += t1;
                    } catch (ex) {
                        console.log("run time error during updateInput:", ex.toString());
                    }
                }
            });
            var t1: number = performance.now() - t0 - tUpdSum;
            this.totalInformWatchersTime += t1;
            this.attributedTime += t1;
            if (activeWatchers.length > 0) {
                this.totalAttributedTime += this.attributedTime;
                var propagatedTime: number = this.attributedTime / activeWatchers.length;
                this.attributedTime = 0;
                for (var wi: number = 0; wi < activeWatchers.length; wi++) {
                    activeWatchers[wi].attributedTime += propagatedTime;
                }
            }
        } else {
            if (g_noTryAndCatchUpdate) {
                watchers.forEach(function (w): void {
                    for (var i: number = w.pos.length - 1; i >= 0 ; i--) {
                        w.watcher.updateInput(w.pos[i], result);
                    }
                });
            } else {
                watchers.forEach(function (w): void {
                    for (var i: number = w.pos.length - 1; i >= 0 ; i--) {
                        try {
                            w.watcher.updateInput(w.pos[i], result);
                        } catch (ex) {
                            console.log("run time error during updateInput:", ex.toString());
                        }
                    }
                });
            }
        }
        if (this.result !== undefined && "incremental" in this.result) {
            this.result.incremental = false;
        }
    }

    // Must be overridden when not using this.inputs[] or when using mixed
    // data source aware inputs
    removeAsWatcher(): void {
        if (this.inputs !== undefined) {
            for (var i: number = 0; i !== this.inputs.length; i++) {
                if (this.inputs[i] !== undefined) {
                    this.inputs[i].removeWatcher(this, true, this.dataSourceAware);
                }
            }
            this.inputs = undefined;
        }
    }

    /**
     * Override if you can implement a write
     * The to part of the write clause, of which is node is a part, has been
     * fully activated.
     * 
     * @param result the written value
     * @param mode 
     * @param attributes 
     * @param positions undefined when overwriting the entire result, otherwise an
     *                  ordered list of positions in the result to which the new value must be
     *                  written.
     */
    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[]): void {
        Utilities.warn("dead ended write: " + this.prototype.idStr() + " at " + gWriteAction);
    }

    // Returns true when the qualifiers enable a result. Only overruled in
    // EvaluationVariant.
    isQualified(): boolean {
        return true;
    }

    // Returns true when the node is ready to be evaluated, i.e. all its inputs
    // have completed evaluation, but only when the flag "schedulingError" is
    // set in the prototype. Note that a deferred input has a non-zero
    // scheduling position, so it's also interpreted as not ready.
    isReady(): boolean { 
        var inputs: EvaluationNode[] = this.allInputs();
        for (var i: number = 0; i !== inputs.length; i++) {
            if (inputs[i] !== undefined && inputs[i].scheduledAtPosition >= 0) {
                return false;
            }
        }
        return true;
    }

    isDeferred(): boolean {
        return this.deferred;
    }

    defer(): void {
        var inputs: EvaluationNode[] = this.allInputs();

        // if (gDeferralInitiatingNode === undefined) {
        //     gDeferralInitiatingNode = this;
        // }
        // gDeferralInitiatingNode.nrDeferralsInitiated++;
        this.deferred = true;
        evaluationQueue.defer(this);
        for (var i: number = 0; i !== inputs.length; i++) {
            var input: EvaluationNode = inputs[i];
            if (input !== undefined && input.scheduledAtPosition !== -1) {
                if (input.awaitingThis === undefined) {
                    input.awaitingThis = new Map<number, Evaluator>();
                }
                input.awaitingThis.set(this.watcherId, this);
            }
        }
        this.watchers.forEach(watcher => {
            var w = watcher.watcher;
            if (w instanceof EvaluationNode) {
                if ("schedulingError" in w.prototype && !w.isDeferred() &&
                      w.isDeferableInput(watcher.pos, w)) {
                    if (w.isScheduled()) {
                        evaluationQueue.unschedule(w);
                    }
                    w.defer();
                }
            } else if (w instanceof TestNode) {
                if (!w.isDeferred()) {
                    if (w.isScheduled()) {
                        evaluationQueue.unschedule(w);
                    }
                    w.defer();
                }
            }
        });
        // if (gDeferralInitiatingNode === this) {
        //     // If there are cycles, this isn't correct
        //     gDeferralInitiatingNode = undefined;
        // }
    }

    undefer(): void {
        var inputs: EvaluationNode[] = this.allInputs();

        assert(this.deferred, "then don't call it");
        this.deferred = false;
        evaluationQueue.undefer(this);
        for (var i: number = 0; i !== inputs.length; i++) {
            var input: EvaluationNode = inputs[i];
            if (input !== undefined && input.awaitingThis !== undefined &&
                  input.awaitingThis.has(this.watcherId)) {
                input.removeAwaitingThis(this.watcherId);
            }
        }
        if (this.inputHasChanged && this.isActive()) {
            evaluationQueue.schedule(this, false);
        }
    }

    isDeferableInput(pos: any, input: EvaluationNode): boolean {
        return true;
    }

    // Returns a list of all nodes that affect the evaluation of this node.
    // Override when not (only) using this.inputs.
    allInputs(): EvaluationNode[] {
        var inputs = this.inputs;

        return inputs === undefined? []: inputs;
    }

    // Like allInputs(), but includes non-active inputs as well; override when
    // allInputs() does not include all inputs.
    allLogInputs(): EvaluationNode[] {
        return this.allInputs();
    }

    // Override this
    debugName(): string {
        var x: any = this;
        return x.__proto__.constructor.name;
    }

    static explainFunctionNodes: {[watcherId: number]: any} = {};

    static resetExplainFunctionNodes(): void {
        EvaluationNode.explainFunctionNodes = {}; 
    }

    explain(classDebugInfo: AreaTemplateDebugInfo): any {
        var explanation: any;
        
        if (this.watcherId in EvaluationNode.explainFunctionNodes) {
            explanation = EvaluationNode.explainFunctionNodes[this.watcherId];
        } else {
            explanation = {};
            EvaluationNode.explainFunctionNodes[this.watcherId] = explanation;
            this.specificExplanation(explanation, classDebugInfo);
        }
        if (classDebugInfo !== undefined && "values" in classDebugInfo &&
              !("_definedIn" in explanation)) {
            var values: number[] = classDebugInfo.values;
            explanation._definedIn = stripArray(values.map(getClassPath));
        }
        var origStrs: string[] = this.getDebugOrigin();
        if (origStrs !== undefined) {
            explanation._origin = origStrs.length === 1? origStrs[0]: origStrs;
        }
        return explanation;
    }

    getDebugOrigin(): string[] {
        if (typeof(functionNodeToExpressionPaths) !== "undefined" && this.prototype !== undefined) {
            var templateId: number = this.prototype.localToArea !== undefined?
                                     this.prototype.localToArea: 0;
            var defunId: number = this.prototype.localToDefun;
            var nodeId: number = this.prototype.id;
            if (functionNodeToExpressionPaths[templateId] !== undefined &&
                  functionNodeToExpressionPaths[templateId][defunId] !== undefined &&
                  functionNodeToExpressionPaths[templateId][defunId][nodeId] !== undefined) {
                var parentArea: CoreArea = this.local.getEvaluationArea();
                var parentAreaId: string = parentArea !== undefined? parentArea.areaId: "global";
                var parentAreaTemplateId: number = parentArea !== undefined? parentArea.template.id: undefined;
                var orig: number[] = functionNodeToExpressionPaths[templateId][defunId][nodeId];
                var origStrs: string[] = [];
                for (var i = 0; i < orig.length; i += 2) {
                    if (orig[i] === parentAreaTemplateId) {
                        origStrs.push(parentAreaId + ":" +
                            functionNodeToExpressionPathsStringCache[orig[i + 1]]
                        );
                    }
                }
                return origStrs;
            }
        }
        return undefined;
    }

    // Must be overridden when not using this.inputs[]
    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        explanation["_id"] = this.prototype.idStr();
        if (this.result !== undefined && "dataSource" in this.result) {
            var dsc: DataSourceComposable = this.result.dataSource;
            var domPathId: number = dsc.funcResult === undefined ?
                undefined : dsc.funcResult.getDominatedProjPathId();
            explanation["_result: dataSource"] = {
                path: domPathId === undefined? "unknown":
                    globalInternalQCM.getPathStrings(domPathId).join("."),
                nrDataElements: dsc.debugMatchList(),
                funcResultId: dsc.funcResult.id,
                dataSourceId: dsc.id
            }
        } else {
            explanation["_result"] = this.result !== undefined && !this.result.hasLabels()?
                this.result.value: this.result;
        }
        explanation["_active"] = this.nrActiveWatchers;
        if (!ignoreInputs && this.inputs !== undefined) {
            for (var i: number = 0; i !== this.inputs.length; i++) {
                if (this.inputs[i] !== undefined) {
                    explanation[i + ": " + this.inputs[i].debugName()] =
                        this.inputs[i].explain(undefined);
                }
            }
        }
        if (gProfile) {
            explanation["_attributedTime"] = this.totalAttributedTime;
        }
        return explanation;
    }

    toString(): string {
        return this.prototype.idStr() + "=" + this.debugName() + 
            (this.inputs === undefined? " = ":
             "(" + this.inputs.map(function(en: EvaluationNode): string {
                 return cdlifyLim(en.result.value, 80);
             }).join(", ") + ") = ") +
            cdlifyLim(this.result.value, 80);
    }

    toFullString(): string {
        return (this.nrActiveWatchers === 0 && !this.isConstant()?
                "_" + this.debugName(): this.debugName()) +
            (this.inputs === undefined? "":
             "(" + this.inputs.map(function(en: EvaluationNode): string {
                 return en.toFullString();
             }).join(", ") + ")") + " = " + cdlifyLim(this.result.value, 80);
    }

    // Memory leak debugging. The following functions provide a simple counting
    // mechanism to track construction/destruction of evaluation nodes. The
    // main idea is to ensure that on destruction of an area no evaluation node
    // it created is left behind. Nodes in defun bodies are excluded, as they
    // are (potentially) controlled by other areas.
    // It adds quite a bit of overhead, so the calls have been commented out
    // in the rest of code.

    static regNodes: {[watcherId: number]: string} = {};
    static regEnvs: {[envId: string]: number} = { "undefined": 0};

    static register(env: EvaluationEnvironment, en: EvaluationNode): void {
        if (en.prototype.localToDefun === 0) {
            var envId: string = env === undefined? "undefined": env.getOwnId();
            assert(!(en.watcherId in EvaluationNode.regNodes), "error reg");
            EvaluationNode.regNodes[en.watcherId] = envId;
            EvaluationNode.regEnvs[envId]++;
        }
    }

    static unregister(en: EvaluationNode): void {
        if (en.prototype.localToDefun === 0) {
            assert(en.watcherId in EvaluationNode.regNodes, "error unreg");
            EvaluationNode.regEnvs[EvaluationNode.regNodes[en.watcherId]]--;
            delete EvaluationNode.regNodes[en.watcherId];
        }
    }

    static registerEnv(envId: string): void {
        assert(!(envId in EvaluationNode.regEnvs), "error regEnv");
        EvaluationNode.regEnvs[envId] = 0;
    }

    static unregisterEnv(envId: string): void {
        assert(EvaluationNode.regEnvs[envId] === 0, "error unregEnv");
        delete EvaluationNode.regEnvs[envId];
    }

    nrSimpleQueryWatchers(q: any): number {
        var nr: number = 0;

        if (this.watchers !== undefined) {
            if (q instanceof RangeValue) {
                this.watchers.forEach(function (w): void {
                    var watcher = w.watcher;
                    if (watcher instanceof EvaluationApply) {
                        if (watcher.query instanceof RangeValue) {
                            nr++;
                        }
                    }
                });
            } else if (q instanceof Object && isAV(q)) {
                this.watchers.forEach(function (w): void {
                    var watcher = w.watcher;
                    if (watcher instanceof EvaluationApply) {
                        if (watcher.query instanceof Object && isAV(watcher.query)) {
                            nr++;
                        }
                    }
                });
            }
        }
        return nr;
    }

    static accumulatedTimes: TimeStatistics[][][] = [];

    accumulateTime(): void {
        var p: FunctionNode = this.prototype;
        var at1: TimeStatistics[][][] = EvaluationNode.accumulatedTimes;
        var at2: TimeStatistics[][];
        var at3: TimeStatistics[];
        var at: TimeStatistics;

        if (at1[p.localToArea] !== undefined) {
            at2 = at1[p.localToArea];
        } else {
            at1[p.localToArea] = at2 = [];
        }
        if (at2[p.localToDefun] !== undefined) {
            at3 = at2[p.localToDefun];
        } else {
            at2[p.localToDefun] = at3 = [];
        }
        if (at3[p.id] !== undefined) {
            at = at3[p.id];
            at.nrInstances++;
            at.nrCallsToUpdate += this.nrCallsToUpdate;
            at.nrCallsToEval += this.nrCallsToEval;
            at.nrTimesChanged += this.nrTimesChanged;
            at.totalEvalTime += this.totalEvalTime;
            at.totalInformWatchersTime += this.totalInformWatchersTime;
            at.totalUpdateInputTime += this.totalUpdateInputTime;
            at.totalAttributedTime += this.totalAttributedTime;
            at.nrQueueResets += this.nrQueueResets;
        } else {
            at3[p.id] = {
                nrInstances: 1,
                nrCallsToUpdate: this.nrCallsToUpdate,
                nrCallsToEval: this.nrCallsToEval,
                nrTimesChanged: this.nrTimesChanged,
                totalEvalTime: this.totalEvalTime,
                totalInformWatchersTime: this.totalInformWatchersTime,
                totalUpdateInputTime: this.totalUpdateInputTime,
                nrQueueResets: this.nrQueueResets,
                totalAttributedTime: this.totalAttributedTime
            };
        }
    }

    toWatchIdBreakPoint(): string {
        return "this.watcherId === " + this.watcherId;
    }

    toProtoBreakPoint(): string {
        return "this.prototype.id === " + this.prototype.id +
            " && this.prototype.localToArea === " + this.prototype.localToArea +
            " && this.prototype.localToDefun === " + this.prototype.localToDefun +
            " && this.local.areaId === \"" + (<any>this.local).areaId + "\"";
    }

    printWatchers(maxlvl: number = 0, lvl: number = 0): void {
        this.watchers.forEach((watcher, watcherId): void => {
            var w = watcher.watcher;
            var indent: string = "";
            for (var i = 0; i < lvl; i++) {
                indent += "  ";
            }
            var str: string = indent;
            var origStrs: string[] = w.getDebugOrigin();
            if (watcherId in this.actndsaw) str += "*** ";
            if (origStrs !== undefined) {
                str += origStrs.join(",") + " ";
            }
            str += "#" + String(watcherId) + " " + w.debugName() +
                " active="+w.isActive() + " dataSourceAware=" + w.dataSourceAware +
                " pos="+watcher.pos;
            console.log(str);
            if (lvl < maxlvl) {
                if (w instanceof EvaluationNode) {
                    w.printWatchers(maxlvl, lvl + 1);
                } else {
                    console.log(indent + "  " + w.debugName());
                }
            }
        });
    }

    traceActNDSAW(indent: string = ""): string {
        var str: string = "";

        this.watchers.forEach((watcher, watcherId): void => {
            if (watcherId in this.actndsaw) {
                var w = watcher.watcher;
                var origStrs: string[] = w.getDebugOrigin();
                str += "\n" + indent;
                if (origStrs !== undefined) {
                    str += origStrs.join(",") + " ";
                }
                str += "#" + String(watcherId) + " " + w.debugName() + " pos="+watcher.pos;
                if (w instanceof EvaluationNode) {
                    str += w.traceActNDSAW(indent + "  ");
                }
            }
        });
        return str;
    }

    isLargeQuery(minSize: number, onlyQuery: boolean): boolean {
        return false;
    }

    // Returns an id for a query that guarantees that queries shared under this
    // id can be updated safely. The implementation is now the id of the input,
    // as propagating the id through projections, cond and var doesn't seem to
    // be worth the trouble.
    querySourceId(): number {
        return this.watcherId;
    }

    // Same for multiQuery
    multiQuerySourceIds(): number[] {
        return [this.watcherId];
    }

    collectLoopInfo(maxDepth: number, stream: (line: string) => void,
                    visited: Map<number, number> = new Map<number, number>(),
                    cache: Map<number, boolean> = new Map<number, boolean>()): boolean {
        var local = this.local;
        var allInputs: EvaluationNode[];
        var found: boolean = false;

        if (!this.deferred || maxDepth === 0 || !this.isActive()) {
            return false;
        }
        if (cache.has(this.watcherId)) {
            if (cache.get(this.watcherId)) {
                var str: string = "";
                for (var i: number = 0; i < visited.size; i++) {
                    str += "  ";
                }
                stream(str + "**CACHED** #" + this.watcherId);
                return true;
            } else {
                return false;
            }
        }
        if (visited.has(this.watcherId)) {
            return visited.get(this.watcherId) === 0; // only true for full cycle
        }
        allInputs = this.allLogInputs();
        visited.set(this.watcherId, visited.size);
        for (var i: number = 0; i < allInputs.length; i++) {
            if (allInputs[i] !== undefined &&
                  allInputs[i].collectLoopInfo(maxDepth - 1, stream, visited, cache)) {
                found = true;
            }
        }
        cache.set(this.watcherId, found);
        visited.delete(this.watcherId);
        if (!found) {
            return false;
        }
        var str: string = "";
        for (var i: number = 0; i < visited.size; i++) {
            str += "  ";
        }
        if (local instanceof CoreArea) {
            var attributes: string[] = local.getDebugAttributeFor(this);
            if (attributes !== undefined) {
                str += "@" + local.areaId + " context: " +
                    attributes.join(", ") + " ";
            }
        }
        stream(str + this.toString() + " #" + this.watcherId);
        return true;
    }

    logThis?: number;

    isLogNode(): boolean {
        if ("logThis" in this || logPrototypes === undefined) {
            return true;
        }
        var prototype: FunctionNode = this.prototype;
        if (!(prototype.localToArea in logPrototypes)) {
            return false;
        }
        var logPrototypesOfTemplate = logPrototypes[prototype.localToArea];
        return logPrototypesOfTemplate === true ||
            (prototype.localToDefun in logPrototypesOfTemplate &&
             (logPrototypesOfTemplate[prototype.localToDefun] === true ||
              prototype.id in logPrototypesOfTemplate[prototype.localToDefun]));
    }

    logValString(): string {
        var origStrs: string[] = this.getDebugOrigin();
        var str: string;

        if (origStrs !== undefined) {
            str = origStrs.join(",") + "#" + this.watcherId;
        } else {
            str = (this.prototype === undefined? "<undefined>": this.prototype.idStr()) + "#" + this.watcherId;
            if (this.local instanceof CoreArea) {
                str += "@" + (<CoreArea>this.local).areaId;
            }
        }
        return str;
    }

    logAllInputs(maxDepth?: number): void {
        if (maxDepth !== 0) {
            var allInputs: EvaluationNode[] = this.allLogInputs();
            var nDepth: number = maxDepth === undefined? undefined: maxDepth - 1;
            if ("logThis" in this) {
                this.logThis++;
            } else {
                this.logThis = 1;
                if (allInputs !== undefined) {
                    for (var i: number = 0; i < allInputs.length; i++) {
                        allInputs[i].logAllInputs(nDepth);
                    }
                }
            }
        }
    }

    unlogAllInputs(): void {
        this.logThis--;
        if (this.logThis === 0) {
            var allInputs: EvaluationNode[] = this.allLogInputs();
            delete this.logThis;
            if (allInputs !== undefined) {
                for (var i: number = 0; i < allInputs.length; i++) {
                    allInputs[i].unlogAllInputs();
                }
            }
        }
    }

    reasonForBeingEmpty(addDefaultReason: boolean = true): string {
        return undefined;
    }

    printClosestContextLabels(done: {[idStr: string]: boolean} = {}): void {
        var idStr: string = this.prototype.idStr();

        if (idStr in done) {
            return;
        }
        var local: EvaluationEnvironment = this.local;
        done[idStr] = true;
        if (local instanceof CoreArea) {
            var attributes: string[] = local.getDebugAttributeFor(this);
            if (attributes !== undefined) {
                console.log("@" + local.areaId + " " +
                            local.template.getChildPath().join(".") +
                            ".context." + attributes.join(", "));
                return;
            }
        }
        this.watchers.forEach(function(watcher): void {
            var w = watcher.watcher;
            if (w instanceof EvaluationNode) {
                w.printClosestContextLabels(done);
            }
        });
    }
}

class GlobalEvaluationEnvironment implements EvaluationEnvironment {
    evaluationNodes: EvaluationNode[][]; // indices: defun nr, prototype id
    template: AreaTemplate;
    localToDefun: number = 0;

    constructor(evaluationNodes: EvaluationNode[]) {
        this.evaluationNodes = [evaluationNodes];
    }

    public getOwnId(): string {
        return undefined;
    }

    public getRelation(relation: string): any[] {
        return undefined;
    }

    public getParent(): EvaluationEnvironment {
        return undefined;
    }

    public getParentWithTemplateId(id: number): EvaluationEnvironment {
        return undefined;
    }

    public link(): GlobalEvaluationEnvironment {
        return this;
    }

    public unlink(): void {
    }

    public getEvaluationArea(): CoreArea {
        return undefined;
    }

    public isValid(): boolean {
        return true;
    }

    public getSource(fn: FunctionNode): SourcePointer {
        return undefined;
    }
}

var globalEvaluationNodes: EvaluationNode[] = [];
var globalEvaluationEnv: EvaluationEnvironment = new GlobalEvaluationEnvironment(globalEvaluationNodes);

function getEvaluationNode(fn: FunctionNode, local: EvaluationEnvironment): EvaluationNode {
    if (fn === undefined) {
        return undefined;
    }
    if (fn.localToDefun !== 0) {
        return local.evaluationNodes[fn.localToDefun][fn.id];
    }
    if (!fn.localToArea) {
        if (globalEvaluationNodes[fn.id] === undefined) {
            buildEvaluationNode(FunctionNode.globalFunctionNodes[fn.id], globalEvaluationEnv);
        }
        return globalEvaluationNodes[fn.id];
    }
    var target: EvaluationEnvironment = local;
    while (target.template.id !== fn.localToArea ||
           target.localToDefun !== fn.localToDefun) {
        target = target.getParent();
    }
    // The following statement avoids above loop, but copying the parent table
    // per area is apparently more expensive than that loop.
    // var target: EvaluationEnvironment = local.getParentWithTemplateId(fn.localToArea);
    if (target.evaluationNodes[0][fn.id] === undefined) {
        buildEvaluationNode(fn, target);
    }
    return target.evaluationNodes[0][fn.id];
}
