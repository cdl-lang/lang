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

/// <reference path="result.ts" />

var nextWatcherId: number = 1025;

function getNextWatcherId() {
    return nextWatcherId++;
}

interface Defer {
    // True when deferred
    isDeferred(): boolean;

    // This node has to wait until all its inputs have been evaluated.
    defer(): void;

    // Moving back to the evaluation queue (no guarantee that all inputs
    // are ready).
    undefer(): void;

    // Returns true when active
    isActive(): boolean;

    // Returns true when none of its inputs are deferred
    isReady(): boolean;
}

interface Watcher extends Defer {

    // The id of this watcher
    watcherId: number;

    // Indicates if this watcher is aware of data sources.
    // If it is false, it requires a Javascript Object as input.
    dataSourceAware: boolean;

    totalUpdateInputTime: number;
    attributedTime: number;

    updateInput(id: any, result: Result): void;

    debugName(): string;

    getDebugOrigin(): string[];

}

interface Producer {

    result: Result;

    addWatcher(watcher: Watcher, pos: any, forceFirstUpdate: boolean,
               conditionallyActivate: boolean, dataSourceAware: boolean): void;
    removeWatcher(watcher: Watcher, conditionallyDeactivate: boolean,
                  dataSourceAware: boolean): void;
    removeWatcherForPos(watcher: Watcher, pos: any,
                        conditionallyDeactivate: boolean,
                        dataSourceAware: boolean): void;
    markAsChanged(): void;
}

interface Evaluator extends Defer {

    // -1 means: not scheduled; -2 means: on hold; 0 or higher correponds to the
    // array index in the queue; -2 simulates being scheduled outside the
    // evaluation queue and is used by globalPositionDependency.
    scheduledAtPosition: number;

    // Counts the number of times this evaluation triggered a queue reset
    nrQueueResets: number;

    // Returns the scheduling priority
    getSchedulePriority(): number;

    // Returns the scheduling step (order within the priority()
    getScheduleStep(): number;

    // True when awaiting execution on queue
    isScheduled(): boolean;

    // Updates the output, and informs watchers
    updateOutput(): void;
}
