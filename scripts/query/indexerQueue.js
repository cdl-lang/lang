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


// This file implements a simple queue for executing the update epilogues
// of path nodes, identity updates and incremental update completion.
//
// When some modification is queued in any of the queues of a path node,
// it is checked whether this path node is already scheduled for an 
// update and if not, it is added to the path node queue.
//
// Similarly, when an identity indexer queues identity updates, 
// they are added here to the identity queue.
//
// In addition, order service refreshes are also queued here. When an
// order service is notified that the ordering under it has refreshed,
// the comparison function which defines this ordering may still have
// not completed refreshing due to its dependence on queries. To avoid
// unnecessary refreshes, the order services are suspended and queued here,
// to be unsuspended after the path node queue has been emptied. 
//
// The path node queue is a heap ordered by the priority of the 
// path nodes (highest priority at the top, of course).
// See the comparison function for the exact definition of the priority.
//
// In addition to adding the path node to the heap, this object also
// maintains a table of indexers for which a path node is queued.
// This table maintains a count of the path nodes scheduled for each indexer
// and increases the count when path nodes are scheduled and decreases
// it when the update epilogues are completed. This way, various modules
// can check whether an indexer still has pending updates.

// The identity queue is a simple first in, first out queue.
// The identity queue has a higher priority than the path node
// queue.
//
// The queue for completing incremental updates is scheduled last, and is
// a simple FIFO with the lowest priority.
//
// Identity updates are carried out before path node updates and completion
// tasks.
//
// Finally, data element tables with pending removals are also queued so
// that their data elements can be removed at the end of the update cycle.

// %%include%%: <scripts/utils/heap.js>

function IndexerQueue(scheduleFunc)
{
    this.pathNodeQueue = new Heap(this.comparator);
    this.queuedIndexers = new Map();
    this.identityUpdateQueue = [];
    this.orderServiceQueue = [];
    this.compCalcQueue = [];
    this.completeIncrementalUpdateTasks = [];
    this.queuedDataElements = new Map();
    this.scheduleFunc = scheduleFunc;
}  

// Currently, ordering is by path ID only. Longer paths are scehduled
// before shorter paths (this is mainly for sub-tree updates).

IndexerQueue.prototype.comparator = function(a,b) {
    
    if(a.pathId < b.pathId)
        return 1;

    return (a.pathId == b.pathId) ? 0 : -1;
}

// schedule the given path node for the execution of its update epilogue(s)

IndexerQueue.prototype.schedulePathNode = indexerQueueSchedulePathNode;

function indexerQueueSchedulePathNode(pathNode)
{
    if(pathNode.scheduled)
        return;

    if (this.pathNodeQueue.isEmpty() && this.scheduleFunc !== undefined) {
        this.scheduleFunc();
    }

    pathNode.scheduled = true;
    this.pathNodeQueue.addSingle(pathNode);

    // increase the count for the indexer to which this path node belongs
    var indexerId = pathNode.indexer.getId();
    if(!this.queuedIndexers.has(indexerId))
        this.queuedIndexers.set(indexerId, 1);
    else
        this.queuedIndexers.set(indexerId,
                                this.queuedIndexers.get(indexerId) + 1);
}

// This function decreases by 1 the count for the indexer of the given
// path node in the 'queuedIndexers' table. This is the count of the number
// of path nodes belonging to this indexer which are still scheduled for
// update. This should be called after the update epilogue of this
// path node has been executed.

IndexerQueue.prototype.decreaseIndexerCount =
    indexerQueueDecreaseIndexerCount;

function indexerQueueDecreaseIndexerCount(pathNode)
{
    var indexerId = pathNode.indexer.getId();
    var count = this.queuedIndexers.get(indexerId) - 1;

    if(count == 0)
        this.queuedIndexers.delete(indexerId);
    else
        this.queuedIndexers.set(indexerId, count);
}

// This function is called when the indexer with the given ID is destroyed.
// This function removes it (but not its individual path nodes) from
// queues in which it (or its data element table) appears.

IndexerQueue.prototype.removeIndexerFromQueues =
    indexerQueueRemoveIndexerFromQueues;

function indexerQueueRemoveIndexerFromQueues(indexerId)
{
    if(this.queuedIndexers.has(indexerId))
        this.queuedIndexers.delete(indexerId);

    if(this.queuedDataElements.has(indexerId))
        this.queuedDataElements.delete(indexerId);
}

// schedule identity updates to be delivered from the given identity
// indexer.

IndexerQueue.prototype.scheduleIdentityUpdate = 
    indexerQueueScheduleIdentityUpdate;

function indexerQueueScheduleIdentityUpdate(identityIndexer)
{
    if(identityIndexer.identityUpdatesScheduled)
        return;
    
    identityIndexer.identityUpdatesScheduled = true;
    this.identityUpdateQueue.push(identityIndexer);
}

// Schedule the given comparison function (CompCalc) to remove keys for
// element IDs removed from it.

IndexerQueue.prototype.scheduleCompCalc = 
    indexerQueueScheduleCompCalc;

function indexerQueueScheduleCompCalc(compCalc)
{
    if(compCalc.removalQueued)
        return; // already queued

    compCalc.removalQueued = true;
    this.compCalcQueue.push(compCalc);
}

// Schedule the given order service to refresh its ordering. 

IndexerQueue.prototype.scheduleOrderService = 
    indexerQueueScheduleOrderService;

function indexerQueueScheduleOrderService(orderService)
{
    if(orderService.refreshQueued)
        return; // already queued

    orderService.refreshQueued = true;
    this.orderServiceQueue.push(orderService);
}

IndexerQueue.prototype.scheduleCompleteIncrementalUpdate =
      indexerQueueScheduleCompleteIncrementalUpdate;
function indexerQueueScheduleCompleteIncrementalUpdate(taskObj)
{
    if (!taskObj.scheduledForCompleteIncrementalUpdateTask) {
        taskObj.scheduledForCompleteIncrementalUpdateTask = true;
        this.completeIncrementalUpdateTasks.push(taskObj);
    }
}

// This function should be called when the given data element table requires
// some cleanup at the end of the refresh cycle. This cleanup is then scheduled
// here. The data element table is stored under the ID of its indexer.

IndexerQueue.prototype.scheduleDataElements = 
    indexerQueueScheduleDataElements;

function indexerQueueScheduleDataElements(dataElements)
{
    // queue the data element table under the ID of its indexer
    this.queuedDataElements.set(dataElements.indexer.id, dataElements);
}

// Returns true when all queues are empty.
// If 'ignoreFinalCleanup' is true, this will ignore the final cleanup
// queues (which are performed once at the end of the update cycle).
// If 'pathAndIdentityOnly' is set, this only checks the
// path node queue and the identity queue (returns true if these two
// queues are empty). In this case, the final cleanup queue is alway ignored.

IndexerQueue.prototype.queuesEmpty = indexerQueueQueuesEmpty;

function indexerQueueQueuesEmpty(pathAndIdentityOnly, ignoreFinalCleanup)
{
    if(pathAndIdentityOnly)
        return (this.identityUpdateQueue.length === 0 &&
                this.pathNodeQueue.isEmpty());
    
    return this.identityUpdateQueue.length === 0 &&
        this.orderServiceQueue.length === 0 &&
        this.compCalcQueue.length === 0 &&
        this.completeIncrementalUpdateTasks.length === 0 &&
        this.pathNodeQueue.isEmpty() &&
        (!!ignoreFinalCleanup || this.queuedDataElements.size == 0);
}

// This function returns true if there are any path nodes of the indexer
// 'indexer' which are currently scheduled. Otherwise, it returns
// false. This continues to return true until the path node epilogue
// of the last scheduled path node of this indexer is completed.

IndexerQueue.prototype.indexerIsScheduled = indexerQueueIndexerIsScheduled;

function indexerQueueIndexerIsScheduled(indexer)
{
    if(indexer === undefined)
        return false;
    
    return this.queuedIndexers.has(indexer.getId());
}

// execute the update function of scheduled identity updates,
// the update epilogues of scheduled path nodes, and (optionally,
// if 'pathAndIdentityOnly' is not set) the order services and the
// update completion tasks.
//
// To avoid entering an infinite loop due to incorrect configuration,
// or just blocking longer than allowed by the task queue, the function
// can take a timer as argument. It then checks in each round whether
// it exceeded the time allocated it by the timer (typically, this timer
// is the task queue timer). If the time allocated was exceeded,
// the function exits, returning 'false' if there are still path nodes
// in the queue. If the function completes the calculation
// before being timed out, it returns true.

IndexerQueue.prototype.executeScheduled = indexerQueueExecuteScheduled;

function indexerQueueExecuteScheduled(timer, pathAndIdentityOnly)
{
    var pathNode;

    while (!this.queuesEmpty(pathAndIdentityOnly, true)) {

        // highest priority: the identity updates
        if(!this.executeIdentityUpdates(timer)) {
            // timed out
            return this.queuesEmpty(pathAndIdentityOnly);
        }        

        if(!this.executePathNodeUpdates(timer)) {
            // timed out
            return this.queuesEmpty(pathAndIdentityOnly);
        }        

        if(this.identityUpdateQueue.length !== 0)
            continue; // identities go first, return to the top of the loop

        if(pathAndIdentityOnly) {
            return true;
        }

        if(!this.executeCompCalcUpdates(timer)) {
            // timed out
            return this.queuesEmpty();
        }
        
        if(!this.executeOrderServiceUpdates(timer)) {
            // timed out
            return this.queuesEmpty();
        }

        if(this.identityUpdateQueue.length > 0 ||
           !this.pathNodeQueue.isEmpty())
            continue; // higher priority queues, so return to loop start

        if(!this.executeCompleteIncrementalUpdateTasks(timer)) {
            // timed out
            return this.queuesEmpty();
        }
    }

    if(!this.executeFinalCleanups(timer)) {
        // timed out
        return this.queuesEmpty();
    }
    
    return true;
}

// This function should be called when all queues have been 

IndexerQueue.prototype.executeFinalCleanups = indexerQueueExecuteFinalCleanups;

function indexerQueueExecuteFinalCleanups(timer)
{
    if(!this.executeDataElementCleanup(timer))
        return this.queuesEmpty();

    return true;
}

// This function goes over the identity update queue and performs the
// identity updates. The function exits either when the queue is empty
// or when the the timer ('timer', which is optional) times out.
// In case the function exits because of a time-out, it returns
// false and otherwise true.

IndexerQueue.prototype.executeIdentityUpdates =
    indexerQueueExecuteIdentityUpdates;

function indexerQueueExecuteIdentityUpdates(timer)
{
    // the queue length may possibly increase during processing,
    // so we continually look at the length of the queue (this is
    // probably negligible compared to the update itself).
    for(var i = 0 ; i < this.identityUpdateQueue.length ; ++i) {
        
        var identityIndexer = this.identityUpdateQueue[i];
        identityIndexer.identityUpdatesScheduled = false;
        identityIndexer.updatePendingIdentities();
            
        if(timer && timer.timedOut()) {
            // there still can be queued identity updates; clear only
            // the updates executed (possible all).
            this.identityUpdateQueue.splice(0,i+1);
            return false;
        }
    }
    
    // clear the queue
    this.identityUpdateQueue.length = 0;

    return true;
}

// This function goes over the path node update queue and performs the
// path node updates. The function exits either when the queue is empty,
// when the identity update queue is not empty (it must have been empty
// when this function is called and this means an identity update was
// scheduled as a result of a path node update and as identity updates
// have priority, this function terminates) or when the the timer ('timer',
// which is optional) times out. In case the function exits because of
// a time-out, it returns false and otherwise true.

IndexerQueue.prototype.executePathNodeUpdates =
    indexerQueueExecutePathNodeUpdates;

function indexerQueueExecutePathNodeUpdates(timer)
{
    var pathNode;
    
    while(pathNode = this.pathNodeQueue.pop()) {

        if(!pathNode.scheduled)
            continue; // scheduling was turned off since the node was queued
        
        pathNode.scheduled = false;

        pathNode.indexer.updateEpilogForPathNode(pathNode);

        // decrease the count of pending path nodes for the indexer
        this.decreaseIndexerCount(pathNode);
            
        if(timer && timer.timedOut())
            return false;

        if(this.identityUpdateQueue.length > 0)
            break; // identity updates have priority
    }

    return true;
}

// This function goes over the order service suspension queue and performs the
// order service unsuspend. The function exits either when the queue is empty
// or when the the timer ('timer', which is optional) times out or when
// either the identity or path node update queues are no longer empty
// (they should both be empty when this function is entered and should
// be emptied before this queue).
// In case the function exits because of a time-out, it returns
// false and otherwise true.

IndexerQueue.prototype.executeOrderServiceUpdates =
    indexerQueueExecuteOrderServiceUpdates;

function indexerQueueExecuteOrderServiceUpdates(timer)
{
    var timedOut = false;
    
    // the queue length may possibly increase during processing,
    // so we continually look at the length of the queue (this is
    // probably negligible compared to the update itself).
    for(var i = 0 ; i < this.orderServiceQueue.length ; ++i) {
        
        var orderService = this.orderServiceQueue[i];

        if(orderService.destroyed)
            continue;
        
        orderService.refreshQueued = false;
        orderService.unsuspend();
            
        if((timer && (timedOut = timer.timedOut())) ||
           this.identityUpdateQueue.length > 0 ||
           !this.pathNodeQueue.isEmpty()) {
            // perhaps prematurely terminated, only remove those updates
            // which were performed.
            this.orderServiceQueue.splice(0,i+1);
            return !timedOut;
        }
    }
    
    // clear the queue
    this.orderServiceQueue.length = 0;

    return true;
}

// This function goes over the comparison function removal queue and performs
// the removal. The function exits either when the queue is empty
// or when the timer ('timer', which is optional) times out or when
// either the identity or path node update queues are no longer empty
// (they should both be empty when this function is entered and should
// be emptied before this queue).
// In case the function exits because of a time-out, it returns
// false and otherwise true.

IndexerQueue.prototype.executeCompCalcUpdates =
    indexerQueueExecuteCompCalcUpdates;

function indexerQueueExecuteCompCalcUpdates(timer)
{
    var timedOut = false;
    
    // the queue length may possibly increase during processing,
    // so we continually look at the length of the queue (this is
    // probably negligible compared to the update itself).
    for(var i = 0 ; i < this.compCalcQueue.length ; ++i) {
        
        var compCalc = this.compCalcQueue[i];

        if(!compCalc.removalQueued)
            continue; // no longer scheduled (perhaps destroyed)
        
        compCalc.removalQueued = false;
        compCalc.applyQueuedRemovals();
            
        if((timer && (timedOut = timer.timedOut())) ||
           this.identityUpdateQueue.length > 0 ||
           !this.pathNodeQueue.isEmpty()) {
            // perhaps prematurely terminated, only remove those updates
            // which were performed.
            this.compCalcQueue.splice(0,i+1);
            return !timedOut;
        }
    }
    
    // clear the queue
    this.compCalcQueue.length = 0;

    return true;
}

// This function performs the tasks which should be carried out at the
// end of the update cycle. Thee tasks do not schedule new updates into
// any of the queues in this object. Therefore, it may only exit when the
// queue is empty or when it has been timed out (if a timer, which is
// optional, is provided). The function returns true if it completed
// without timeout and false if it was timed out.

IndexerQueue.prototype.executeCompleteIncrementalUpdateTasks =
    indexerQueueExecuteCompleteIncrementalUpdateTasks;

function indexerQueueExecuteCompleteIncrementalUpdateTasks(timer)
{
    for (var i = 0; i < this.completeIncrementalUpdateTasks.length; i++) {
        
        var taskObj = this.completeIncrementalUpdateTasks[i];

        if(taskObj.destroyed || !taskObj.isActive()) {
            taskObj.completeIncrementalUpdateTaskCancelled = true;
            continue;
        }
        
        if (taskObj.scheduledForCompleteIncrementalUpdateTask) {
            taskObj.scheduledForCompleteIncrementalUpdateTask = false;
            taskObj.completeIncrementalUpdate();
            if (timer && timer.timedOut()) {
                // there can still be tasks in the queue; clear only the
                // those completed (possibly the entire list).
                this.completeIncrementalUpdateTasks.splice(0, i + 1);
                return false;
            }
        }
    }

    this.completeIncrementalUpdateTasks.length = 0;

    return true;
}

// Perform the cleanup operation for all data element tables which were
// queued for such a cleanup.

IndexerQueue.prototype.executeDataElementCleanup =
    indexerQueueExecuteDataElementCleanup;

function indexerQueueExecuteDataElementCleanup(timer)
{
    var timedOut = false;
    var _self = this;
    
    this.queuedDataElements.forEach(function(dataElements, indexerId) {
        if(timedOut)
            return;
        dataElements.removePendingRemovals();
        _self.queuedDataElements.delete(indexerId);
        if(timer)
            timedOut = timer.timedOut();
    });

    return !timedOut;
}
