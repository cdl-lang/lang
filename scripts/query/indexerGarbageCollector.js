// Copyright 2017 Yoav Seginer.
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


// This is the indexer garbage collection object. A single such object is
// assigned to each InternalQCM object.
// Via the InternalQCM object, various objects (such as path nodes) may
// be queued here for destruction. It is up to the calling function to
// decide when to schedule such a destruction.
//
// Currently, index destruction and path node destruction are implemented.
//
// For each object scheduled, the time at which it should be destroyed
// is determined and the object is inserted into a tree sorted by this
// scheduled time. If the garbage collecor has not yet been scheduled,
// or was scheduled to garbage collect at a later time, it is then scheduled
// to garbage collect at the specified time.
//
// When the garbage collection its triggered, objects whose destruction
// time has arrived are destroyed (until the process is timed out by the
// task maanger). If there are remaining objects in the garbage collection
// queue (whose timeout has not yet arrived) the garbage collector is
// set again.
//
// To avoid unnecessary multiple scheduling, the timeouts are rounded
// off to make multiple object garbage collect at the same time.
//
// Object Structure
// ----------------
//
// {
//    timerId: <ID of timer>,
//    scheduledTime: <Date>
//
//    queue: <PathNodeQueue>
// }
//
// timerId: ID of the timer currently set to schedule the garbage collection.
//    This is used to reset the timer (if needed). This is undefined
//    if garbage collection is not scheduled.
// scheduledTime: this is a Date object which defines the current time
//    at which garbage collection is scheduled. This is undefined if no
//    garbage collection is scheduled.
// queue: This is a queue of the path nodes which were either scheduled
//    to have their tracing terminated or their index destroyed. The path
//    nodes are sorted by their expiration time (there is a separate entry for
//    index destruction and for tracing termination).
//    This is implemented by a PathNodeQueue object (see below)

// %%include%%: <scripts/utils/trees/degenerateIntervalTree.js>

//
// Constructor 
//

function IndexerGarbageCollector()
{
    this.timerId = undefined;
    this.scheduledTime = undefined;

    this.queue = new PathNodeQueue();
}

// This defines the garabage collection time step. This is the accuracy
// with which the objects are destroyed relative to the time they requested.

IndexerGarbageCollector.collectionTimeStep = 5000;

// time to wait before terminating tracing on a path node which does not
// need tracing anymore
IndexerGarbageCollector.tracingTimeout = 5000; // 5 * 60 * 1000;
IndexerGarbageCollector.indexTimeout = 5000; // 5 * 60 * 1000;

// This function requests the scheduling of the garbage collector no later
// than the time given by 'timeToCollect' (a Date object for the time
// at which garbage collection should take place). This function checks
// whether garbage collection is scheduled earier than this time.
// If not, the garbage collection is scheduled for this time.

IndexerGarbageCollector.prototype.scheduleGarbageCollection =
    indexerGarbageCollectorScheduleGarbageCollection;

function indexerGarbageCollectorScheduleGarbageCollection(timeToCollect)
{
    if(this.scheduledTime !== undefined &&
       this.scheduledTime.getTime() - timeToCollect.getTime() <
       IndexerGarbageCollector.collectionTimeStep)
        // scheduled before or within a time step of the requested time,
        // nothing to do.
        return;

    if(this.timerId !== undefined)
        // clear the existing timer
        clearTimeout(this.timerId);
    
    this.timerId = setTimeout(scheduleIndexerGarbageCollectionTask,
                              timeToCollect.getTime() - Date.now());
    
    this.scheduledTime = timeToCollect;   
}

// This function is called when the index on the given path node is no
// longer needed. This function schedules the destruction of the indexes
// on the path node.

IndexerGarbageCollector.prototype.scheduleIndexDestroy =
    indexerGarbageCollectorScheduleIndexDestroy;

function indexerGarbageCollectorScheduleIndexDestroy(pathNode)
{
    var timeToDestroy =
        new Date(Date.now() + IndexerGarbageCollector.indexTimeout);

    this.queue.add(pathNode, "index", timeToDestroy.getTime());
    this.scheduleGarbageCollection(timeToDestroy);
}

// This cancels any pending scheduling for the destruction of the indexes
// on this path node. This should be called when indexing has become
// needed again.

IndexerGarbageCollector.prototype.descheduleIndexDestroy =
    indexerGarbageCollectorDescheduleIndexDestroy;

function indexerGarbageCollectorDescheduleIndexDestroy(pathNode)
{
    this.queue.remove(pathNode, "index");
}

// This function is called when tracing on the given path node is no
// longer needed. This function schedules the termination of tracing on
// the path node (which may result in the destruction of the path node).

IndexerGarbageCollector.prototype.scheduleTraceDeactivation =
    indexerGarbageCollectorScheduleTraceDeactivation;

function indexerGarbageCollectorScheduleTraceDeactivation(pathNode)
{
    var timeToDestroy =
        new Date(Date.now() + IndexerGarbageCollector.tracingTimeout);

    this.queue.add(pathNode, "tracing", timeToDestroy.getTime());
    this.scheduleGarbageCollection(timeToDestroy);
}

// This cancels any pending scheduling for the termination of tracing
// on this path node. This should be called when tracing has become
// needed again.

IndexerGarbageCollector.prototype.descheduleTraceDeactivation =
    indexerGarbageCollectorDescheduleTraceDeactivation;

function indexerGarbageCollectorDescheduleTraceDeactivation(pathNode)
{
    this.queue.remove(pathNode, "tracing");
}

// This function is called by the task scheduler to perform any garbage
// collection which has been scheduled. The function receives the
// task queue object as input (which allows it to check whether it is
// timed out). This function then performs garbage collection until
// finished or timed out. The task is finished when there are no more
// queue path nodes which have expired. There may, however, be path nodes
// on the queue which did not expire yet. In this case, the task is considered
// finished, but is scheduled to be added to the task scheduled later again.
// The returns true if the task was completed (whether the queue is empty
// or not) and false if it was timed out.

IndexerGarbageCollector.prototype.executeGarbageCollection =
    indexerGarbageCollectorExecuteGarbageCollection;

function indexerGarbageCollectorExecuteGarbageCollection(taskQueue)
{
    this.timerId = undefined;
    this.scheduledTime = undefined;
    
    do {        
        var expirationTime = this.queue.peek();
        if(expirationTime === undefined)
            return true; // task completed
        
        if(expirationTime - Date.now() >
           IndexerGarbageCollector.collectionTimeStep) {
            // should not be handled in this round, but schedule for later
            this.scheduleGarbageCollection(new Date(expirationTime));
            return true; // completed for now
        }

        // handle this entry
        
        var entry = this.queue.pop();
        var pathNode = entry.pathNode;
        
        switch(entry.type) {
        case "index":
//            console.log("destroying index for path", pathNode.pathId,
//                        "indexer", pathNode.indexer.getId());
            pathNode.indexer.destroyIndexAtNode(pathNode);
            break;
        case "tracing":
//            console.log("removing tracing for path", pathNode.pathId,
//                        "indexer", pathNode.indexer.getId());

            pathNode.indexer.removePathNodeTracing(pathNode);
            break;
        }
        
    } while(!taskQueue.timedOut());
    
    return this.queue.isEmpty() ? true : false;
}


///////////////////
// PathNodeQueue //
///////////////////

// This class implements a simple queue for path nodes which are scheduled
// by their expiration time, given by the value returned by the getTime()
// function of the Date object which defines their expiration time.
//
// Each path node is assigned an ID which is a string of the form
// "<path ID>:<indexer ID>:<type>" which together identify the path node
// uniquely together with the type of event queued for this path node.
// These IDs are stored in a DegenerateIntervalTree object
// whose keys are the expiration time of the path nodes (the result of
// getTime() applied to their expiration time Date() object).
// In addition to this binary tree, there is a Map structure which
// stores, for each ID, the path node object, the expiration time and the
// type of event. In this way, the path node can be removed from the tree
// (as this requires the expiration time to be known).
//
// Object Structure
// ----------------
// {
//     queue: <DegenerateIntervalTree>,
//     byId: <Map>{
//         <path node ID>: {
//             pathNode: <path node>,
//             type: <string>,
//             expirationTime: <expiration time>
//         }
//         ......
//     }
// }
//

//
// Constructor
//

function PathNodeQueue()
{
    this.queue = new DegenerateIntervalTree(PathNodeQueue.stringCompare);
    this.byId = new Map();
}

// Comparison function for strings

PathNodeQueue.stringCompare = function(a,b)
{
    if(a == b)
        return 0;

    return (a < b) ? -1 : 1;
}

// Returns the ID assigned to this path node (which depends both on the
// path ID of the path node and the ID of the indexer to which it belongs).

PathNodeQueue.prototype.getPathNodeId = pathNodeQueueGetPathNodeId;

function pathNodeQueueGetPathNodeId(pathNode, type)
{
    return pathNode.pathId + ":" + pathNode.indexer.getId() + ":" + type;
}

// This function adds the given path node and event type to the queue
// with the given expiration time. The function first checks whether the
// path node was already added for the same type with a different expiration
// time. If it was, that expiration time is removed and returned by the
// function. Otherwise, the function returns undefined.

PathNodeQueue.prototype.add = pathNodeQueueAdd;

function pathNodeQueueAdd(pathNode, type, expirationTime)
{
    var id = this.getPathNodeId(pathNode, type);
    var entry;
    var prevExpirationTime;
    
    if(this.byId.has(id)) {
        entry = this.byId.get(id);
        prevExpirationTime = entry.expirationTime;
        this.queue.removePoint(id, prevExpirationTime);
    }

    if(entry !== undefined)
        entry.expirationTime = expirationTime;
    else
        this.byId.set(id, { pathNode: pathNode,
                            type: type,
                            expirationTime: expirationTime });
    this.queue.insertPoint(id, expirationTime);

    return prevExpirationTime;
}

// Remove the entry for the given path node and event type. If the entry
// exists, the function returns the expiration time for the path node
// and otherwise, undefined.

PathNodeQueue.prototype.remove = pathNodeQueueRemove;

function pathNodeQueueRemove(pathNode, type)
{
    var id = this.getPathNodeId(pathNode, type);

    if(!this.byId.has(id))
        return;

    var entry = this.byId.get(id);
    this.queue.removePoint(id, entry.expirationTime);
    this.byId.delete(id);

    return entry.expirationTime;
}

// This function returns the expiration time of the first path node in
// the queue. If the queue is empty, undefined is returned.

PathNodeQueue.prototype.peek = pathNodeQueuePeek;

function pathNodeQueuePeek()
{
    if(this.byId.size == 0)
        return undefined;

    return this.queue.getFirstKey(); // first key in the tree
}

// This function removes the first path node in the queue and returns
// an object of the form:
// {
//    pathNode: <path node>,
//    type: <event type>
//    expirationTime: <number>
// }
// which describes the first entry in the queue.

PathNodeQueue.prototype.pop = pathNodeQueuePop;

function pathNodeQueuePop()
{
    if(this.byId.size == 0)
        return undefined;

    var first = this.queue.getFirst(); // first IDs in the tree

    if(first.length == 0)
        return undefined;

    var id = first[0];
    
    var entry = this.byId.get(id);

    this.queue.removePoint(id, entry.expirationTime);
    this.byId.delete(id);

    return entry;
}

// returns true if the queue is empty and false if it is not.

PathNodeQueue.prototype.isEmpty = pathNodeQueueIsEmpty;

function pathNodeQueueIsEmpty()
{
    return this.byId.size == 0;
}

