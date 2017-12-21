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

/// <reference path="watcherProducer.ts" />
/// <reference path="taskScheduler.ts" />

declare var logValues: boolean;

// This feature doesn't work as it should; setting it to low values seems to
// make the system loop and spend an awful amount of time in positioning
// (possibly because of unstable intersections), and it doesn't even improve
// responsiveness.
var maxEvaluationsPerSlice: number = Number.MAX_VALUE;

var gDebugBreak: boolean = false;

/// Progress counter.
var gProgressValue: number = 0;

/**
 * If a node wishes to be informed before the writes or at the end of an
 * evaluation cycle, it should implement this interface and call the evaluation
 * queue's addTimeSensitiveNode.
 * 
 * @interface TimeSensitive
 */
interface TimeSensitive {
    isOnTimeQueue: boolean;
    preWriteNotification(cycle: number): void;
    endOfEvaluationCycleNotification(cycle: number): void;
}

interface Latchable {
    isLatched: boolean;
    release(): void;
}

// Implements a list. Nodes can be added to the end and popped from the front.
// Entries are set to undefined on pop. The array of nodes is not released.
class EvaluatorList {
    nodes: Evaluator[] = [];
    pos: number = 0;
    end: number = 0;

    push(en: Evaluator): number {
        var nextPos: number = this.end++;

        this.nodes[nextPos] = en;
        return nextPos;
    }

    pop(): Evaluator {
        var en: Evaluator =  this.nodes[this.pos];

        this.nodes[this.pos] = undefined;
        this.pos++;
        return en;
    }

    isEmpty(): boolean {
        return this.pos >= this.end;
    }

    isNotEmpty(): boolean {
        return this.pos < this.end;
    }

    reset(): void {
        this.pos = 0;
        this.end = 0;
    }

    addCompact(en: Evaluator): number {
        if (this.pos > 0) {
            this.pos--;
            this.nodes[this.pos] = en;
            return this.pos;
        } else {
            return this.push(en);
        }
    }

    clearAndCompact(pos: number): void {
        this.nodes[pos] = undefined;
        if (this.pos === pos) {
            while (this.pos < this.end && this.nodes[this.pos] === undefined) {
                this.pos++;
            }
            if (this.pos >= this.end) {
                this.reset();
            }
        } else if (this.pos === this.end - 1) {
            do {
                this.end--;
            } while (this.nodes[this.end - 1] === undefined);
        }
    }
}

class SinglePriorityQueue {
    priority: number;
    queue: EvaluatorList[];
    queueLowPos: number[];
    low: number = 0;
    high: number = -1;
    interrupt: boolean = false;
    nrProcessed: number = 0;
    maxResetStep: number = -1;
    nrMaxReset: number = 0;

    constructor(priority: number, maxScheduleStep: number) {
        var q: EvaluatorList[] = [];
        
        this.priority = priority;
        this.queue = q;
        for (var i: number = 0; i <= maxScheduleStep; i++) {
            q.push(new EvaluatorList());
        }
    }
    
    // Returns true when it finished without interruption, false when it was
    // interrupted, undefined on time out.
    runQueue(taskQueue: TaskQueue = undefined): boolean {
        this.interrupt = false;
        this.nrProcessed = 0;
        if (logValues && logPrototypes === undefined) {
            gSimpleLog.log("runQueue", this.priority);
        }
        while (this.low <= this.high && this.interrupt === false) {
            var thisStep: number = this.low;
            var stepQueue: EvaluatorList = this.queue[thisStep];
            while (stepQueue.isNotEmpty() && this.low === thisStep &&
                   this.interrupt === false) {
                var en: Evaluator = stepQueue.pop();
                // en can be undefined when the node has been unscheduled
                if (en !== undefined) {
                    en.scheduledAtPosition = -1;
                    // note that this can change this.low and stepQueue.end
                    en.updateOutput();
                    this.nrProcessed++;
                    gProgressValue++;
                    if (taskQueue !== undefined &&
                          ((this.nrProcessed >= maxEvaluationsPerSlice) ||
                           taskQueue.timedOut())) {
                        this.interrupt = undefined;
                    }
                }
            }
            if (stepQueue.pos === stepQueue.end) {
                stepQueue.reset();
                if (this.low === thisStep) {
                    this.low++;
                }
                globalInternalQCM.executeScheduled();
            }
        }
        if (logValues && logPrototypes === undefined) {
            gSimpleLog.log("runQueue end", this.low > this.high, this.interrupt);
        }
        if (this.low > this.high) {
            // The queue is empty; reset the queue pointers
            this.low = 0;
            this.high = -1;
            this.maxResetStep = -1;
            this.nrMaxReset = 0;
        }
        return this.interrupt === undefined? undefined: !this.interrupt;
    }

    // Runs the queue until the target is found or has been evaluated by
    // another call to this function. If that's the case, it returns undefined.
    // If the queue was emptied or interrupted from outside, it returns true
    // for an empty queue, and false otherwise.
    runUntil(target: Evaluator, maxStep: number): boolean {
        var done: boolean;

        this.interrupt = false;
        if (logValues && logPrototypes === undefined) {
            gSimpleLog.log("runUntil", this.priority);
        }
        while (this.low <= this.high && this.low <= maxStep &&
               this.interrupt === false) {
            var thisStep: number = this.low;
            var stepQueue: EvaluatorList = this.queue[thisStep];
            if (logValues && logPrototypes === undefined &&
                  stepQueue.end > stepQueue.pos)
                gSimpleLog.log("step", thisStep);
            while (stepQueue.isNotEmpty() && this.low === thisStep &&
                   this.interrupt === false) {
                var en: Evaluator = stepQueue.pop();
                if (en !== undefined) {
                    en.scheduledAtPosition = -1;
                    en.updateOutput();
                    this.nrProcessed++;
                    if (!target.isScheduled()) {
                        // Stop when the target has been evaluated or withdrawn
                        // in this or another call to runUntil().
                        this.interrupt = undefined;
                    }
                }
            }
            if (stepQueue.pos === stepQueue.end) {
                stepQueue.reset();
                if (this.low === thisStep) {
                    this.low++;
                }
            }
        }
        if (logValues && logPrototypes === undefined) {
            gSimpleLog.log("runUntil end", this.low > this.high, this.interrupt);
        }
        if (this.low > this.high) {
            this.low = 0;
            this.high = -1;
            done = this.interrupt === undefined? undefined: true;
            this.interrupt = false;
        } else if (this.low <= this.high && this.low <= maxStep) {
            done = this.interrupt === undefined? undefined: false;
            this.interrupt = true;
        } else if (target.isScheduled()) {
            done = false;
        }
        return done;
    }

    schedule(en: Evaluator, acceptQueueReset: boolean): void {
        var step: number = en.getScheduleStep();

        assert(step >= 0, "task not meant for scheduling?");
        if (step < this.low) {
            // NOTE: the following code checks for frequent queue resets. Enable
            // if there is a performance problem that might be caused by
            // superfluous updating.
            // if (!acceptQueueReset) {
            //     en.nrQueueResets++;
            //     if (step > this.maxResetStep) {
            //         this.maxResetStep = step;
            //         this.nrMaxReset = 1;
            //     } else if (step === this.maxResetStep) {
            //         // If the queue has been reset 300 times (a bit of a heuristic)
            //         // since being empty, offer the user the opportunity to not add
            //         // this evaluation node; this will halt any circular update.
            //         // (repeat every 50 steps, just in case).
            //         this.nrMaxReset++;
            //         if (this.nrMaxReset >= 300 && this.nrMaxReset % 50 === 0) {
            //             if (confirm("Reset level " + this.nrMaxReset + ". Abort?")) { 
            //                 return;
            //             }
            //         }
            //     }
            // }
            this.low = step;
        }
        if (this.high < step) {
            this.high = step;
        }
        en.scheduledAtPosition = this.queue[step].push(en);
    }

    unschedule(en: Evaluator): void {
        var step: number = en.getScheduleStep();
        
        assert(step >= 0, "task not meant for scheduling?");
        this.queue[step].nodes[en.scheduledAtPosition] = undefined;
        en.scheduledAtPosition = -1;
    }

    defer(en: Evaluator): void {
        var step: number = en.getScheduleStep();

        if (logValues && logPrototypes === undefined)
            gSimpleLog.log("defer", en.toString());
        if (step < this.low) {
            this.low = step;
        }
        if (this.high < step) {
            this.high = step;
        }
        en.scheduledAtPosition = this.queue[step].addCompact(en);
    }

    undefer(en: Evaluator): void {
        var step: number = en.getScheduleStep();
        
        if (logValues && logPrototypes === undefined)
            gSimpleLog.log("undefer", en.toString());
        this.queue[step].clearAndCompact(en.scheduledAtPosition);
        en.scheduledAtPosition = -1;
    }

    isEmpty(): boolean {
        return this.low > this.high;
    }

    allInactive(): boolean {
        for (var step: number = this.low; step <= this.high; step++) {
            var q = this.queue[step];
            if (q !== undefined) {
                for (var pos = q.pos; pos < q.end; pos++) {
                    var n = q.nodes[pos];
                    if (n !== undefined && n.isActive()) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    // Deferred queues do not update low and high positions. So before calling
    // isEmpty(), this function must be called to assign them the correct value.
    compact(): void {
        while (this.low <= this.high && this.queue[this.low].isEmpty()) {
            this.queue[this.low].reset();
            this.low++;
        }
        if (this.low > this.high) {
            // The queue is empty; reset the queue pointers
            this.low = 0;
            this.high = -1;
        }
    }

}

// Implements evaluation of nodes in the correct order. Called from
// content task.
// Note that it is assumed that all nodes involved in triggering a
// write have the high priority.
class EvaluationQueue {

    // Increased after every external change (event, message, unlatch).
    cycle: number = 1;

    // evaluationSteps: {[id: number]: Evaluator}[] = [];
    // nrEvaluationSteps: number = 0;

    // One queue per priority.
    priorityQueues: SinglePriorityQueue[] = [];

    // TODO: more efficient implementation???!!!
    deferredQueues: SinglePriorityQueue[] = [];

    // The priority of the evaluation node that is to be executed next.
    prio: number = -1;

    // When true, the queue with priority prio is active.
    running: boolean = false;

    // Primitive way to improve responsiveness. Every maxEvaluationsPerSlice
    // evaluations, the queue is suspended and the browser is given time.
    nrProcessed: number = 0;

    // Call to scheduleContentTask already made?
    scheduleTaskCalled: boolean = false;

    // Message queue, belonging to [message]. We don't process low priorities
    // until it's empty.
    globalMessageQueue: EvaluationMessageQueue;

    init(prio: number, maxScheduleStep: number): void {
        this.priorityQueues[prio] = new SinglePriorityQueue(prio, maxScheduleStep);
        this.deferredQueues[prio] = new SinglePriorityQueue(prio, maxScheduleStep);
    }

    setGlobalMessageQueue(gmq: Evaluator): void {
        this.globalMessageQueue = <EvaluationMessageQueue> gmq;
    }

    // Runs the priority queues from high to low. If a higher priority node gets
    // scheduled while running, the current queue is interrupted, and focus is
    // shifted to the higher one.
    // When minPrio has been reached, all held nodes are added to the queue,
    // and the queue is run again. That means that held nodes with a priority
    // lower than minPrio will not be executed (immediately).
    runQueue(minPrio: number, taskQueue: TaskQueue): boolean {
        if (this.suspendAllEvaluations) {
            return true;
        }
        this.running = true;
        while (this.prio >= minPrio) {
            var sq: SinglePriorityQueue = this.priorityQueues[this.prio];
            var st: boolean = sq.runQueue(taskQueue);
            if (st === true) {
                if (this.prio >= minPrio) {
                    this.prio--;
                }
            }
            this.nrProcessed += sq.nrProcessed;
            if (st === undefined && gInitPhase) {
                var pos = (this.priorityQueues[0].high === -1? this.priorityQueues[0].queue.length: this.priorityQueues[0].low) +
                    (this.priorityQueues[1].high === -1? this.priorityQueues[1].queue.length: this.priorityQueues[1].low);
                var max = this.priorityQueues[0].queue.length + this.priorityQueues[1].queue.length;
                this.setProgressIndicatorValue(pos / max * 100);
                break;
            }
            if (this.suspendAllEvaluations ||
                    (taskQueue !== undefined && taskQueue.timedOut())) {
                break;
            }
        }
        this.running = false;
        if (this.prio < minPrio) {
            // queue empty
            this.scheduleTaskCalled = false;
            if (this.isEmpty(0)) {
                if (!globalPosConstraintSynchronizer.isEmpty()) {
                    globalPosConstraintSynchronizer.flushBuffer();
                }
                return true;
            }
        }
        // else give the browser some time; we do not yet release the latched
        // expressions, because the queue is not empty.
        return false;
    }

    // runUntil is a bit like runQueue, but its only goal is to make sure that
    // the target expression can be evaluated. So it does not post new messages
    // or release write nodes, flush buffers, etc.
    runUntil(target: Evaluator): void {
        var minPrio: number = target.getSchedulePriority();
        var pRunning: boolean = this.running;
        var pPrio: number = this.prio;

        if (target.scheduledAtPosition < 0) {
            return;
        }
        while (this.prio < minPrio) {
            this.priorityQueues[this.prio].interrupt = true;
            this.prio++;
        }
        this.running = true;
        while (this.prio >= minPrio) {
            var maxStep: number = target.isDeferred() || this.prio > minPrio?
                                  Infinity: target.getScheduleStep();
            var sq: SinglePriorityQueue = this.priorityQueues[this.prio];
            var st: boolean = sq.runUntil(target, maxStep);
            this.nrProcessed += sq.nrProcessed;
            if (st === undefined) {
                // We've reached our goal, leave the rest as it is.
                break;
            } else if (st === true) {
                // this queue is empty; since this call can be re-entrant,
                // don't lower the priority further than needed.
                if (target.scheduledAtPosition < 0) {
                    // target has been evaluated elsewhere
                    break;
                }
                if (this.prio >= minPrio) {
                    this.prio--;
                }
            } else {
                // the queue was interrupted, or the target was deferred,
                // so resume if the queue is not yet empty.
                if (this.isEmpty(minPrio)) {
                    break;
                }
            }
        }
        this.running = pRunning;
        this.prio = pPrio;
    }

    // When > 0, nodes are not added to the queue
    disabled: number = 0;

    // Disables scheduling. Not used.
    suspendScheduling(): void {
        this.disabled++;
    }

    resumeScheduling(): void {
        this.disabled--;
    }

    // Put the evaluation node on the queue with corresponding priority.
    // Raise the current priority if needed, and interrupt the currently
    // running queue.
    schedule(en: Evaluator, acceptQueueReset: boolean): void {
        if (this.disabled === 0 && en.scheduledAtPosition === -1) {
            var prio: number = en.getSchedulePriority();
            this.priorityQueues[prio].schedule(en, acceptQueueReset);
            if (prio > this.prio) {
                if (logValues && logPrototypes === undefined)
                    gSimpleLog.log("priority to", prio);
                if (this.running) {
                    for (var p = this.prio; p < prio; p++) {
                        this.priorityQueues[p].interrupt = true;
                    }
                }
                this.prio = prio;
            }
            if (!this.scheduleTaskCalled) {
                globalContentTask.schedule();
                this.scheduleTaskCalled = true;
            }
        }
    }

    unschedule(en: Evaluator): void {
        if (en.scheduledAtPosition > -1) {
            this.priorityQueues[en.getSchedulePriority()].unschedule(en);
        }
    }

    /** List for delayed writes */
    uncommitedWrites: ToMergeEvaluationNode[] = []

    // Puts the toMerge node on the queue for commit when positioning is ready
    hold(toMerge: ToMergeEvaluationNode): void {
        this.uncommitedWrites.push(toMerge);
    }

    // Remove the toMerge node from the queue for commit
    unhold(toMerge: ToMergeEvaluationNode): void {
        var pos: number = this.uncommitedWrites.indexOf(toMerge);

        assert(pos >= 0, "node should be on hold list");
        this.uncommitedWrites.splice(pos, 1);
    }

    // Commits all the to/merge nodes.
    commitWrites(): void {
        if (gDebugBreak) {
            breakIntoDebugger();
            gDebugBreak = false;
        }
        for (var i: number = 0; i !== this.uncommitedWrites.length; i++) {
            if (debugWritesEval) {
                gSimpleLog.log("release", this.uncommitedWrites[i].toString());
            }
            this.uncommitedWrites[i].commit();
        }
        this.uncommitedWrites.length = 0;
        this.releaseLatched();
        this.markEndOfEvaluationMoment();
    }

    /** List for writable nodes that have had a write in this cycle */
    private latchedWrites: Latchable[] = [];

    // Stores a node that has been written to.
    latch(l: Latchable): void {
        if (!l.isLatched) {
            this.latchedWrites.push(l);
            l.isLatched = true;
        }
    }

    // Makes the changed writable nodes finalize the change 
    releaseLatched(): void {
        for (var i: number = 0; i !== this.latchedWrites.length; i++) {
            var l: Latchable = this.latchedWrites[i];
            if (l.isLatched) {
                if (debugWritesEval) {
                    gSimpleLog.log("unlatch", l.toString());
                }
                l.isLatched = false;
                l.release();
            }
        }
        this.latchedWrites.length = 0;
    }

    // Nodes that need to be informed before the writes and/or at the end of the
    // evaluation cycle
    private timeSensitiveNodes: TimeSensitive[] = [];

    addTimeSensitiveNode(tn: TimeSensitive): void {
        if (!tn.isOnTimeQueue) {
            this.timeSensitiveNodes.push(tn);
            tn.isOnTimeQueue = true;
            globalPreWriteNotificationTask.schedule();
        }
    }

    removeTimeSensitiveNode(tn: TimeSensitive): void {
        if (tn.isOnTimeQueue) {
            tn.isOnTimeQueue = false;
        }
    }

    preWritesNotification(): void {
        for (var i = 0; i < this.timeSensitiveNodes.length; i++) {
            var tn: TimeSensitive = this.timeSensitiveNodes[i];
            if (tn.isOnTimeQueue) {
                if (debugWritesEval) {
                    gSimpleLog.log("preWriteNotify", tn.toString());
                }
                tn.preWriteNotification(this.cycle);
            }
        }
    }

    // Informs some nodes that the evaluation cycle has ended 
    markEndOfEvaluationMoment(): void {
        var tns: TimeSensitive[] = [];

        for (var i = 0; i < this.timeSensitiveNodes.length; i++) {
            var tn: TimeSensitive = this.timeSensitiveNodes[i];
            if (tn.isOnTimeQueue) {
                tn.isOnTimeQueue = false;
                tns.push(tn);
            }
        }
        this.timeSensitiveNodes.length = 0;
        for (var i = 0; i < tns.length; i++) {
            var tn: TimeSensitive = tns[i];
            if (debugWritesEval) {
                gSimpleLog.log("endOfEvaluation", tn.toString());
            }
            tn.endOfEvaluationCycleNotification(this.cycle);
        }
        this.cycle++;
    }

    isEmpty(minPrio: number): boolean {
        for (var prio: number = minPrio; prio < this.priorityQueues.length; prio++) {
            if (!this.priorityQueues[prio].isEmpty()) {
                return false;
            }
        }
        return true;
    }

    isReady(): boolean {
        return this.timeSensitiveNodes.length === 0 &&
               this.latchedWrites.length === 0 &&
               this.isEmpty(0);
    }

    // Put the evaluation node on the deferred queue. Does not change the state
    // of the queue.
    defer(en: Evaluator): void {
        var prio: number = en.getSchedulePriority();

        assert(en.scheduledAtPosition === -1, "unschedule before deferring");
        this.deferredQueues[prio].defer(en);
    }

    undefer(en: Evaluator): void {
        var prio: number = en.getSchedulePriority();

        assert(en.scheduledAtPosition !== -1, "cannot undefer");
        this.deferredQueues[prio].undefer(en);
    }

    isDeferredEmpty(minPrio: number): boolean {
        for (var prio: number = minPrio; prio < this.deferredQueues.length; prio++) {
            this.deferredQueues[prio].compact();
            if (!this.deferredQueues[prio].isEmpty() &&
                !this.deferredQueues[prio].allInactive()) {
                return false;
            }
        }
        return true;
    }

    printStatus() {
        function pra(q: SinglePriorityQueue[]): void {
            for (var prio: number = 0; prio < q.length; prio++) {
                var pq: SinglePriorityQueue = q[prio];
                for (var stepNr: number = pq.low; stepNr <= pq.high; stepNr++) {
                    var step: EvaluatorList = pq.queue[stepNr];
                    if (step !== undefined) {
                        for (var pos: number = step.pos; pos < step.end; pos++) {
                            var en: Evaluator = step.nodes[pos];
                            if (en !== undefined) {
                                console.log(String(prio), stepNr, pos,
                                            en.toString());
                            }
                        }
                    }
                }
            }
        }

        function prd(q: SinglePriorityQueue[]): void {
            for (var prio: number = 0; prio < q.length; prio++) {
                var pq: SinglePriorityQueue = q[prio];
                for (var stepNr: number = pq.low; stepNr <= pq.high; stepNr++) {
                    var step: EvaluatorList = pq.queue[stepNr];
                    if (step !== undefined) {
                        for (var pos: number = step.pos; pos < step.end; pos++) {
                            var en: Evaluator = step.nodes[pos];
                            if (en !== undefined) {
                                var inputs: string;
                                if (en instanceof EvaluationNode){
                                    inputs = "#" + en.watcherId + "->" +
                                        en.allInputs().filter(function(n: EvaluationNode): boolean {
                                            return n !== undefined && n.scheduledAtPosition !== -1;
                                        }).map(function(n: EvaluationNode): string {
                                            return "#" + n.watcherId;
                                        }).join(",");
                                } else {
                                    inputs = "unknown";
                                }
                                if (!en.isActive()) {
                                    inputs = "*inactive* " + inputs;
                                }
                                console.log(String(prio), stepNr, pos,
                                            en.toString(), inputs);
                            }
                        }
                    }
                }
            }
        }

        console.log("scheduled");
        pra(this.priorityQueues);
        console.log("deferred");
        prd(this.deferredQueues);
    }

    // When true, all evaluations are to be suspended immediately.
    suspendAllEvaluations: boolean = false;

    suspend(): void {
        this.suspendAllEvaluations = true;
        for (var prio: number = 0; prio < this.priorityQueues.length; prio++) {
            this.priorityQueues[prio].interrupt = true;
        };
    }

    resume(): void {
        this.suspendAllEvaluations = false;
    }

    // Interface to progress bar

    progressIndicatorValue: number;

    setProgressIndicatorValue(p: number): void {
        this.progressIndicatorValue = p;
    }

    getProgressIndicatorValue(): number {
        return this.progressIndicatorValue;
    }

    printLoops(maxNrLoops: number = Infinity, maxDepth: number = Infinity): string {
        var q = this.deferredQueues;
        var allStr: string = "";
        var nrLoops: number = 0;

        for (var prio: number = 0; prio < q.length; prio++) {
            var pq: SinglePriorityQueue = q[prio];
            for (var stepNr: number = pq.low; stepNr <= pq.high; stepNr++) {
                var step: EvaluatorList = pq.queue[stepNr];
                if (step !== undefined) {
                    for (var pos: number = step.pos; pos < step.end; pos++) {
                        var en: Evaluator = step.nodes[pos];
                        if (en instanceof EvaluationNode && en.isActive()) {
                            var logStr: string = "";
                            if (en.collectLoopInfo(maxDepth, function(line: string): void {
                                logStr += line + "\n";
                            })) {
                                allStr += logStr + "\n";
                                nrLoops++;
                                if (nrLoops >= maxNrLoops) {
                                    return allStr;
                                }
                            }
                        }
                    }
                }
            }
        }
        return allStr;
    }
}

var evaluationQueue: EvaluationQueue = new EvaluationQueue();

function setGDebugBreak(): void {
    gDebugBreak = true;
}
