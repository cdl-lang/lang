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

/// <reference path="externalTypes.ts" />

// Task Queue

// The task queue is a global queue of tasks which are awaiting execution.
// Such tasks include the calculation of positioning and triggers
// (after constraints have been modified or triggers added) the calculation
// of maximal condition matches (after matches changed), positioning
// of the areas on the screen (after their positions were calculated)
// and the calculation and display of content.
//
// So as not to block processing of input events, the task handling
// slots are scheduled as timed events (with a zero timeout).
// Moreover, the display is not refreshed while code is running, so there is
// need to exit the code every once in a while to refresh the display
// (and then execution continues at the next task time slot).
// Each individual task may then block until it is completed. It is therefore
// important to break the process into tasks of the right size. If a task
// takes too long to complete it will block the system. If, on the other
// hand, each step is broken into many small tasks, the total time
// for completion of the computation will significantly increase, because
// even scheduling a task for immediate calculation through a timeout of 0
// still adds considerable time to the execution.
//
// Remark on scheduling on the browser:
// To ensure the code does not block for too long, we must exit the code
// periodically. To continue running the code, we schedule a timed even.
// However, on most (or all) browsers, scheduling a timed even with timeout 0
// will not execute the event, but only after a certain delay (10ms on
// Firefox, for example). To avoid this delay, we schedule the next call to
// the execution of pending tasks before starting to process the current call.
// As a result, the delay between one task execution slot and the next is
// reduced by the time it took to execute the tasks in the slot (which if
// is longer than the delay between the call to consecutive timed event
// means that the delay is zero).
//
// A task may call the function 'timedOut()' of the global
// task queue object. This function checks how much time has elapsed since
// the task started running. If this exceeds the time allocated to the
// task then this function returns true and the task should exit
// (after storing whatever state it needs to store to continue later).
// If the task function returns false then the task queue knows that it
// was terminated prematurely and schedules it for continuation later.

// Tasks can be registered to the task queue with a priority. Tasks of higher
// priority are executed first. They are repeatedly executed until they
// indicate that they have terminated or until a higher priority task
// is registered. Specifically, input events (mouse/keyboard/touch events)
// have a higher priority than any registered task and will therefore
// be executed as soon as a task function returns (even if the task was not
// yet completed).
//
// The 'TaskQueue' object defines a maximal priority and a default
// priority. Priorities higher than the maximal priority are replaced by the
// maximal priority. Undefined priorities are replaced by the default priority.
// The special geometry task has a special priority which is higher than
// the maximal (standard) priority.
//
// When a task indicates that it has completed, it is discarded from the queue.
// It will have to be rescheduled (as a result of some other task or as
// a result of an event) to be carried out again.

// Task ID

var taskLastId: number;

var debugTasks: boolean = false;

function nextTaskId(): number
{
    return ++taskLastId;
}

// enter debugger every this many iterations (set to a positive integer)
var debugTaskQueueStop: number;

///////////////////////
// Task Queue Class  //
///////////////////////

interface TaskQueueTask {
    currentTaskId?: number;
    executeTask(taskQueue: TaskQueue): boolean;
    name: string;
}

interface TaskQueueEntry {
    id: number;
    task: TaskQueueTask;
}

interface TimedOut {
    /// This function returns 'true' if the time allocated to the current task
    /// has elapsed. This function should be called periodically by the function
    /// carrying out a task to check whether it did not exceed the time
    /// allocated it. If it did, it must exit (after saving, if necessary, a
    /// state which would allow it to continue later).
    timedOut(): boolean;
}

// This is a list of tasks, sorted by priority.

class TaskQueue implements TimedOut {

    // the sorted list object implements the task list
    pendingTasks: SortedList<TaskQueueEntry> = new SortedList<TaskQueueEntry>();

    // this variable is set to true when a timed event is set to execute
    // pending tasks
    nextTaskScheduled: boolean = false;

    // The timeout ID for the timeout event which will then execute the
    // pending tasks
    timeoutId: number|NodeJS.Timer = undefined;

    // is an iteration currently running
    iterationRunning: boolean = false;

    // when true, no task will be executed
    isSuspended: boolean = false;

    // Time at which the execution of the current iteration started.
    // This is the time against which the task timeout is measured.
    iterationStartTime: number = undefined;

    // Iteration timeout (for now, fixed)
    iterationTimeout: number = 50; // ms 

    // When true, the task queue yields to the browser after the current task.
    yieldToBrowser: boolean = false;

    // counter to allow debugging infinite loops
    debugCounter: number = 0;

    // Priority definitions in order of priority. The order is as follows
    // Remoting has the highest priority. Every time the queue is resumed, the
    // first thing checked is the remote task (which flushes the outgoing
    // requests). In principle, this can wait until the content task is
    // finished, since all outgoing requests originate in the content task and
    // don't need to be flushed if the content task is interrupted. With the
    // new commit-writes task, there will not be outgoing requests until that
    // task has finished. TODO: check this (it might also affect receiving
    // data) and lower priority if true.
    static remotingPriority: number = 130;
    // The content task defines the content for all other tasks: positioning
    // and visual updates. Since the content can change during processing, it is
    // best to delay the dependent tasks until content is finished.
    static contentPriority: number = 120;
    // Once content is ready, the positioning constraints should be ready too,
    // so the geometry task is run. This can change offsets and intersections
    // in the content task, so that might get scheduled again, leading to new
    // constraints, etc. For this reason, scheduleContentTask and schedule-
    // GeometryTask have a counter which gives an alarm for a potential loop.
    static geometryPriority: number = 110;
    // Once content and geometry are done, we can write. Before writing, we must
    // call the 'time sensitive' nodes. These are [changed] and the upon:
    // handlers. [changed] can trigger an upon, and should not swap too often,
    // so should evaluate as late as possible, even though it can trigger
    // another round of content evaluation (e.g. [and, [changed, ...], ...] will
    // do that). The upon: handler can also trigger another round of content
    // evaluation for the to and merge nodes, but these evaluations cannot
    // alter the outcome of [changed] or the upon: condition.
    static preWritesPriority: number = 100;
    // Once content, positioning and pre-write are finished, the application is
    // ready at its current time point. All the state changes are now known, so
    // this is the moment to commit them. This may of course trigger a new round
    // of content/positioning calculations and new writes, although the latter
    // is considered an non-preferred practice.
    static commitWritesPriority: number = 90;
    // After the writes, the next message on the message queue can be processed.
    static nextMessagePriority: number = 85; 
    // After the messages are gone, check pointer in area for all areas
    static reupdatePointerInAreaPriority: number = 82;
    // When there are no more writes, messages and changes to pointerInArea, the
    //  state of the display is fixed and can be updated.
    static areaDisplayUpdatePriority: number = 80;
    static visualFlushPriority: number = 70;
    static visualWrapupPriority: number = 60;
    // After the visuals have been updated, allow processing of queued events.
    static queuedEventPriority: number = 50;
    // After normal content, check if there's anything left on the path node queue
    static executePathNodeQueuePriority: number = 45;
    // At this point, all normal content is done, and the debugger can be
    // updated. This should trigger only debugger related content changes. If
    // not, it could cause an undetected infinite loop.
    static debuggerPriority: number = 40;
    // Allow print/image download functions to run
    static printPriority: number = 35;
    // When the application is done loading, perform the init phase cleanup.
    static concludeInitPhasePriority: number = 30;
    // Check if there has been a content loop.
    static concludeLoopWarningPriority: number = 20;
    // Priority for resizing the screen is very low, meaning that all updates
    // will be shown during resizing. Not sure if that's the best way.
    static screenResizePriority: number = 17;
    // Priority of the indexer garbage collection task: this gets scheduled at
    // regular intervals, and should not interrupt normal processing
    static indexerGarbageCollectionPriority: number = 15;
    // Once the queue is empty, and we're sure everything is visible, update the
    // app's focus.
    static setFocusPriority: number = 12;
    // Scanning open file handles for modifications should happen only
    // when the system has time to do so.
    static fileHandleScanPriority: number = 11;
    // And finally run the next test, which will insert an event or put some
    // test on the content queue. This task should run when everything else has
    // finished.
    static testPriority: number = 10;

    // This function may be called to schedule a task. The task should be an
    // object with the following properties:
    // 1. It should have a member function 'executeTask' which will be called
    //    to execute the task. This function should periodically check the
    //    TaskQueue.timedOut function to see whether it has exceeded its
    //    allocated time slot. If the function does not complete before being
    //    timed out it should return 'false' and otherwise 'true'. A task whose
    //    'executeTask' function returns false is rescheduled for execution.
    //    If the task returns true, it is discarded from the queue.
    // 2. The object must allow the TaskQueue to use the 'currentTaskId'
    //    attribute on the object. The TaskQueue uses this to register the
    //    task ID it assigned the task object and in this way avoid multiple
    //    queuing of the same task.
    //
    // The task is scheduled with a priority. Higher priority tasks are executed
    // first. The 'TaskQueue' object defines a maximal priority and a default
    // priority. Priorities higher than the maximal priority are replaced by the
    // maximal priority. Undefined priorities are replaced by the default
    // priority.
    // The special geometry task has a special priority which is higher than
    // the maximal (standard) priority.
    //
    // The 'executeAtOnce' should be set to 'true' if the task should be
    // executed at once if this is possible. If this is false, the task will
    // only be performed after the execution of pending tasks is called from
    // a timed event. One should use this option if the task should wait until
    // additional information for this task and other tasks are added.

    scheduleTask(task: TaskQueueTask, priority: number,
                 executeAtOnce: boolean = false): void
    {
        assert(priority !== undefined, "debugging");
        var taskId: number = task.currentTaskId;

        // If no task ID is given, create an ID for the task and use this as its
        // name when adding it to the task list.
        if (taskId === undefined)
            task.currentTaskId = taskId = nextTaskId();

        // if the task is already scheduled, check its currently scheduled
        // priority
        var node: SortedListNode<TaskQueueEntry> =
            this.pendingTasks.getNode(taskId, true);

        if (node === undefined || node.sortVal < priority)
            // not yet scheduled, or scheduled with a lower priority. Add or
            // move in the sorted list. The last argument should be true (start
            // searching for the insertion point at the end) if the priority is
            // low.
            this.pendingTasks.insert({ id: taskId, task: task },
                                     taskId, priority, true);

        // If we are not called inside the task execution loop then we can
        // execute the pending tasks immediately, if so required.
        if (!this.iterationRunning && executeAtOnce)
            this.executePendingTasks(false);
        else // schedule execution of the task
            this.scheduleNextIteration(false);
    }


    // This function sets the priority of a scheduled task based on the
    // given priority, the default and maximal priorities defined by
    // the task queue and the type of task 

    // This function schedules the next iteration of the task execution loop
    scheduleNextIteration(isTimedOut: boolean): void {
        if (this.isSuspended || this.nextTaskScheduled) {
            // Don't schedule when suspended, nor when already scheduled
            return;
        }
        if (this.timeoutId !== undefined) {
            if (debugTasks) console.log("repeated scheduling");
            return;
        }
        if (debugTasks && this.yieldToBrowser) console.log("scheduling after yield");
        if (isTimedOut && slowDownFactor !== undefined) {
            var delay = (Date.now() - this.iterationStartTime) * (slowDownFactor - 1);
            this.timeoutId = setTimeout(timedExecutePendingTasks, delay);
        } else {
            this.timeoutId = setTimeout(timedExecutePendingTasks,
                                        this.yieldToBrowser? 2: 0);
        }
        this.nextTaskScheduled = true;
    }

    // This function clears the scheduling of the next iteration of the task
    // execution loop
    clearNextIteration(): void {
        if(!this.nextTaskScheduled)
            return; // nothing to clear
    
        this.nextTaskScheduled = false;
        clearTimeout(<any> this.timeoutId);
        this.timeoutId = undefined;
    }

    // Suspends all execution until resume() is called. Scheduling tasks is
    // still permitted.
    suspend(): void {
        this.isSuspended = true;
        this.clearNextIteration();
    }

    // Resumes all tasks.
    resume(): void {
        this.isSuspended = false;
        this.scheduleNextIteration(false);
    }

    // This function executes a sequence of pending tasks until the execution
    // slot is timed out. In case the queue is not empty, this function also
    // schedules a new (immediate) timed call to itself.
    // The argument 'calledFromTimedEvent' is true if the function was called
    // through a scheduled timed event.
    // The actual implementation of this function is in doExecutePendingTasks()
    // (below) and this function only manages some of the book keeping
    // which wraps the actual execution of the tasks.
    executePendingTasks(calledFromTimedEvent: boolean): void {
        if (calledFromTimedEvent) {
            if (debugTasks && this.yieldToBrowser) {
                console.log("end yield");
            }
            this.yieldToBrowser = false;
            this.timeoutId = undefined;
        }
        if (!this.pendingTasks.isEmpty()) {
            if (gInitPhase) {
                taskQueueInitProgressHook(evaluationQueue.getProgressIndicatorValue());
            } else {
                taskQueueRunningHook();
            }
        }

        if (this.isSuspended) {
            return;
        }

        debugStartTimer("task queue", "executing pending tasks");

        this.iterationRunning = true;
        this.doExecutePendingTasks(calledFromTimedEvent);
        this.iterationRunning = false;

        // debug timing
        debugStopTimer("executing pending tasks");

        if (this.pendingTasks.isEmpty()) {
            // first time around we get an empty queue inidcates that
            // initialization has been completed.
            debugStopTimer("total initial configuration");
            taskQueueEmptyHook();
            debugNoPendingTasksNotification();
        }
    }

    // This function executes a sequence of pending tasks until the execution
    // slot is timed out. In case the queue is not empty, this function also
    // schedules a new (immediate) timed call to itself.
    // The argument 'calledFromTimedEvent' is true if the function was called
    // through a scheduled timed event. 
    doExecutePendingTasks(calledFromTimedEvent: boolean): void
    {
        if (!calledFromTimedEvent)
            // clear any pending call to this function through a timed iteration
            this.clearNextIteration();
        else { // clear the timed event which called this function
            this.nextTaskScheduled = false;
            this.timeoutId = undefined;
        }

        // if the queue is empty, quit and don't schedule any return to the loop
        if (this.pendingTasks.isEmpty())
            return;

        if (debugTaskQueueStop) {
            this.debugCounter++;
            if (this.debugCounter % debugTaskQueueStop === 0)
                breakIntoDebugger();
        }

        this.iterationStartTime = Date.now();

        // execute the tasks in the queue until the timeout is reached (or the
        // queue is empty).
        while (!this.isSuspended) {

            if (testDurationGuardTime !== undefined && Date.now() > testDurationGuardTime) {
                debugger; // set testDurationGuardTime to undefined to continue
                if (testDurationGuardTime !== undefined) {
                    Utilities.error("Test runs too long");
                }
            }

            var entry = this.pendingTasks.first.entry;
            var rc: boolean;

            debugTotalTimeStart(entry.task.name);

            if (debugTasks) console.log("execute task", entry.task.name);
            if (g_noTryAndCatchUpdate) {
                rc = entry.task.executeTask(this);
            } else {
                try {
                    rc = entry.task.executeTask(this);
                } catch (e) {
                    rc = true;
                    signalRuntimeException(String(e));
                }
            }

            debugTotalTimeStop(entry.task.name);

            if (rc) {
                // task completed. Remove it from the list
                this.pendingTasks.remove(entry.id);
                // check whether there are any more tasks pending
                if(this.pendingTasks.isEmpty()) {
                    // No more tasks. Remove the schedules event
                    this.clearNextIteration();
                    return;
                }
            }
            // some tasks still pending, check whether there is still time in
            // this slot

            if (this.timedOut()) {
                if (!this.nextTaskScheduled) {
                    this.scheduleNextIteration(true);
                }
                return; // will continue as a result of a timed event
            }

            // continue executing the tasks
        }
    }

    // See interface TimedOut
    
    timedOut(): boolean {
        if (this.yieldToBrowser) {
            if (debugTasks) console.log("yielding to browser");
            return true;
        }

        if (noTimeOut) {
            return false;
        }

        // get the current time
        var now = Date.now();

        return (this.iterationRunning &&
                now - this.iterationStartTime >= this.iterationTimeout);
    }

    // Returns true when a task is scheduled
    isScheduled(task: TaskQueueTask): boolean {
        return task.currentTaskId !== undefined &&
            this.pendingTasks.getNode(task.currentTaskId, true) !== undefined;
    }
}

// global task queue

var globalTaskQueue: TaskQueue;

// this function initialized the global task queue 
function initTaskQueue(): void
{
    globalTaskQueue = new TaskQueue();
    taskLastId = 0;

    if (gArgParser.getArg("noYield", false)) {
        // no yield approximated by a slice of 150 seconds
        globalTaskQueue.iterationTimeout = 150 * 1000;
    }
}

// This function is called as a timed event and calls the task execution
// function of the global task queue.

function timedExecutePendingTasks(): void {
    if (mondriaMutex) {
        console.log("suppressing re-entrancy");
        return;
    }

    mondriaMutex = true;

    debugTotalTimeStop("timed-out task delay");

    // invalidate cache, as it is no longer up to date (we're gonna do
    //  something below)
    if (debugObjCache) {
        resetDebugObjCache();
    }

    debugStartTimer("task queue", "task queue");
    globalTaskQueue.executePendingTasks(true);
    debugStopTimer("task queue");

    debugTotalTimeStart("timed-out task delay");

    mondriaMutex = false;
}

function yieldToBrowser(): void {
    if (!globalTaskQueue.yieldToBrowser) {
        if (debugTasks) console.log("requesting yielding to browser");
        globalTaskQueue.yieldToBrowser = true;
        globalTaskQueue.clearNextIteration();
    }
}

function tasksInQueue(): boolean {
    return !globalTaskQueue.pendingTasks.isEmpty();
}
