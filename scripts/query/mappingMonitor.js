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


// This file implements the mapping sub-tree monitor, which is a sub-tree
// monitor registered by a merge indexer on a source indexer to receive
// updates on changes inside a sub-tree in the source indexer. This is
// used when a sub-tree monitor is registered on a node in the merge 
// indexer and the merge indexer must make sure that it will receive
// updates from the source indexers for any node which may be inserted
// inside that monitored sub-tree.
//
// After registering to the source indexer, the mapping monitor serves
// as a simple channel for updating the merge indexer. It collects 
// all updates it receives and then, when its completeUpdate() 
// function is called, pushes them to the merge indexer.
//
// The mapping monitor is constructed for one specific mapping group
// and for one specific source path of that group, which may be either 
// the maximal source path of the group or an extension source path
// of the group. It is then registered on every source node at the
// source path for which the monitor was constructed when the sub-tree
// rooted at that source node needs to be monitored.
//
// Therefore, the same monitor receives updates for all subtrees 
// rooted at its source path which need to be monitored. Since
// it is only a channel for transferring these updates, this does
// not cause any problem. 
//
// Being a monitor, it may receive updates for different paths extending
// the source path for which it was created. These paths must then be
// translated to their respective target paths. This is not the responsibility
// of the mapping monitor, however, but of the receiving merge indexer.
// The monitor does store the group ID and source path ID for which it 
// was constructed and provide the target indexer with this information 
// when delivering an update. It is then up to the target indexer
// to find the corresponding target path node (which it may have to
// create).
//
// The update from the mapping monitor to the merge monitor is provided
// in the form of an array of updates. This buffer simply stores the
// updates in the order in which they arrived. Both addition/modification
// and removals are stored in the same array. The order in which the 
// updates are stored is the order in which they were received, so 
// an addition followed by a removal for the same node will result in 
// the removal of the node.
//
// Because of the way the source indexer updates the monitor, the updates
// should appear in teh buffer in blocks for the same path ID (in case
// multiple nodes are updated at the same path). This can be relied on
// by the target indexer for the sake of optimizing performance but 
// not for the sake of correctness (that is, the receiving function
// must work correctly with any ordering of the updates).
//
// Object Structure
// ----------------
//
// {
//     sourceIndexer: <this indexer to which this monitor is registered>
//     targetIndexer: <the owner target indexer>,
//     groupId: <ID of the group for which it was constructed>,
//     sourceIdentificationId: <identification ID>,
//     sourcePathId: <source path ID>,
//
//     monitorId: <ID of this monitor assigned by the source indexer>
//     monitored: {
//         <element ID>: <reference count>,
//         ......
//     }
//     numMonitored: <number of entries in table above>
//
//     updates: [<array of updates>]
//
//     registrationInProgress: true|false
// }
//
// sourceIndexer: the indexer to which this monitor is registered.
// targetIndexer: this is the merge indexer which constructed this 
//    monitor and needs to receive the updates collected by this 
//    monitor.
// groupId: this is the ID of the mapping group (in the merge indexer)
//    for which this mapping  
// sourceIdentificationId: the source identification used by the group
//    for which this node was created. This allows this object to 
//    register for identity updates from the source indexer (the 
//    registrations and de-registrations take place through this object
//    but the notifications go directly to the target indexer).
// sourcePathId: the ID of the source path on which this monitor is registered.
//
// monitorId: this ID is assigned by the source indexer when the monitor
//    is registered to it. This ID needs to be stored as it is used 
//    for communicating with the source indexer.
//
// monitored: this is the list of nodes monitored by this monitor.
//    Each one has a reference count with the number of requests to 
//    monitor the node. When this number drops to zero, the monitoring
//    request is removed from the node.
// numMonitored: the number of entries (element IDs) in the table above.
//
// updates: this is an array of the updates made to this mapping monitor.
//    This is an array with entries of the form:
//    {
//        sourcePathId: <source path of the update>,
//        elementId: <element ID identifying the node at the source path
//                    where the update occured>,
//        type: <the type of the node after the update (undefined for removal)>,
//        key: <the simple key value (undefined if removal)>
//    }
//    All these updates refer to terminal nodes. When a node is removed,
//    it appears here with an undefined type.
// 
// registrationInProgress: this flag is set to true during the registration
//    of this monitor on a source node to be monitored. Node updates
//    (calls to 'updateSimpleElement(...)') are ignored as long as this
//    flag is set. This is because such updates, which happen during the
//    registration process are for nodes which existed in the source indexer
//    before the monitoring was registered. The target indexer then fetches
//    these nodes directly from the source indexer and does not need to 
//    receive an extra update from the mapping monitor for these nodes.

//
// Constructor
//

function MappingMonitor(targetIndexer, groupEntry, sourcePathId)
{
    this.sourceIndexer = groupEntry.sourceIndexer;
    this.targetIndexer = targetIndexer;
    this.groupId = groupEntry.groupId;
    this.sourceIdentificationId = groupEntry.sourceIdenitifcationId;
    this.sourcePathId = sourcePathId;

    this.monitored = {};
    this.numMonitored = 0;
    this.updates = [];

    this.registrationInProgress = false;

    // register the monitor to the source indexer
    this.monitorId = 
        this.sourceIndexer.addSubTreeMonitor(sourcePathId, this);

    // register to receive identification update notifications for
    // data elements at this path (and lower).
    this.sourceIndexer.addMonitoringIdentification(this.sourcePathId, 
                                                   this.targetIndexer,
                                                   this.sourceIdentificationId);
}

// Destroy this mapping monitor. This shoudl be called only when
// there are no more registrations on specific nodes left (that is,
// 'getNumMonitored()' returns zero). It removes the registrations
// made by the constructor.

MappingMonitor.prototype.destroy = mappingMonitorDestroy;

function mappingMonitorDestroy()
{
    this.sourceIndexer.
        removeMonitoringIdentification(this.sourcePathId, 
                                       this.targetIndexer,
                                       this.sourceIdentificationId);

    this.sourceIndexer.removeSubTreeMonitor(this.sourcePathId, 
                                            this.monitorId);
}

// This function, called by the target indexer, requests the monitor
// to register itself to monitor the sub-tree rooted at the source node 
// with the given element ID (at the path for which this monitor was 
// created). This request comes with a refrence count indicating the 
// number of monitoring sub-trees at the target indexer for which this
// registration was required. This increases the reference count for the
// given node and if the reference count was previously 0, registers
// the monitoring request to the source indexer.

MappingMonitor.prototype.registerOn = mappingMonitorRegisterOn;

function mappingMonitorRegisterOn(elementId, refCount)
{
    if(this.monitored[elementId]) {
        this.monitored[elementId] += refCount;
        return;
    }

    this.numMonitored++;
    this.monitored[elementId] = refCount;
    this.registrationInProgress = true;
    this.sourceIndexer.
        registerSubTreeRetrievalOnNode(this.sourcePathId, elementId,
                                       this.monitorId, this);
    this.registrationInProgress = false;
}


// This function, called by the target indexer, requests the monitor
// to unregister itself from monitoring the sub-tree rooted at the source node 
// with the given element ID (at the path for which this monitor was 
// created). This request comes with a refrence count indicating the 
// number of monitoring sub-trees at the target indexer for which this
// unregistration was required. This decreases the reference count for the
// given node and if the reference count reaches 0, unregisters
// the monitoring request from the source indexer.
// If refCount is undefined, the refrence count for the element is decreased
// to zero and the the monitoring request on the source node is removed.

MappingMonitor.prototype.unregisterFrom = mappingMonitorUnregisterFrom;

function mappingMonitorUnregisterFrom(elementId, refCount)
{
    if(!(elementId in this.monitored))
        return;

    if(refCount && (this.monitored[elementId] -= refCount) > 0)
        return; // reference count remains positive
    
    this.sourceIndexer.
        unregisterSubTreeRetrievalOnNode(this.sourcePathId, elementId,
                                         this.monitorId);

    delete this.monitored[elementId];
    this.numMonitored--;
}

// Return the number of nodes to which this monitor is currently 
// registered (for monitoring the sub-tree rooted at that node).

MappingMonitor.prototype.getNumMonitored = mappingMonitorGetNumMonitored;

function mappingMonitorGetNumMonitored()
{
    return this.numMonitored;
}

///////////////////////////////////
// Interface with Source Indexer //
///////////////////////////////////

// This function receives an update when a terminal value in one of the
// sub-tree monitored by this monitor is added or its value changes.
// The function then pushes this update on the 'updates' queue.
// If the registrationInProgress flag is set, this function does not 
// push the update, because this update is for a node which already 
// existed in teh source indexer at the time the monitor was registered.
// These nodes are fetched by the target indexer directly. 
 
MappingMonitor.prototype.updateSimpleElement = 
    mappingMonitorUpdateSimpleElement;

function mappingMonitorUpdateSimpleElement(pathId, elementId, type, key)
{
    if(this.registrationInProgress)
        return; // no need to store, the target indexer fetches these nodes

    this.updates.push({ sourcePathId: pathId, elementId: elementId, 
                        type: type, key: key });
}

// This function receives an update when a terminal value in one of the
// sub-tree monitored by this monitor is removed.
// The function then pushes this update on the 'updates' queue
// (with an undefined type, to indicate its removal).

MappingMonitor.prototype.removeSimpleElement = 
    mappingMonitorRemoveSimpleElement;

function mappingMonitorRemoveSimpleElement(pathId, elementId)
{
    this.updates.push({ sourcePathId: pathId, elementId: elementId, 
                        type: undefined });
}

// This function is called for each monitored sub-tree which completed
// its update cycle.
// The mapping monitor does nothing here. It simply waits for 
// subTreeUpdate() to be called and then flushes all its updates to 
// the target indexer.

MappingMonitor.prototype.completeUpdate = mappingMonitorCompleteUpdate;

function mappingMonitorCompleteUpdate()
{
    return;
}

// This function is called when all sub-tree updates (calls to 
// updateSimpleElement() and removeSimpleElement()) for this 
// update cycle have completed. This function then flushes these updates
// to the target indexer.

MappingMonitor.prototype.subTreeUpdate = mappingMonitorSubTreeUpdate;

function mappingMonitorSubTreeUpdate(sourcePathId, elementIds, monitorId)
{
    // call the target indexer with the array of updates.
    this.targetIndexer.mappingMonitorUpdate(this.updates);
    this.updates = [];
}
