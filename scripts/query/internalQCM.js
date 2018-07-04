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


"use strict";

// The name of this object is somewhat outdated. It is cuurently used
// as a global object providing central allocation services for 
// path IDs, compression values, IDs etc. This object is shared by indexers, 
// root query calculation nodes, function result nodes and other objects
// making use of its services.

//
// Structure of the Internal QCM Object
//

// This object has the following structure:
//
// {
//     rootQueryCalcs: <Map>{
//         <indexer ID> + ";" + <query ID> + ";" + 
//                                 <projection path ID>: <InternalRootQueryCalc>
//         ......
//     }
//     compCalcs: <Map>{
//         <key>: <CompCalc>
//         ....
//     }
//     orderServices: <Map>{
//         <data object ID>: <OrderingService>
//         ....
//     }
//     pathIdAllocator: <InternalQCMPathIdAllocator>,
//     compression: <InternalQCMCompression>
//     queue: <IndexerQueue>
//     garbageCollector: <IndexerGarbageCollector>
// }
//
// rootQueryCalcs: this table is used for the allocation of root query
//    calculation nodes. These are allocated based on their indexer, 
//    projection path and query ID.
// compCalcs: this table is used for the allocation of comparison
//    calculation nodes. A Comprison calculation node is allocated based
//    on the ID of the comprison (Comparison) object which defines it,
//    the ID of the indexer whose data is compared and the prefix path ID.
//    A string concatenating these IDs (separated by ";") is used as the
//    identifying key of he entry in the 'compCalcs' table. By storing these
//    objects here, we are able to share these objects when necessary.
// orderServices: this table used for the allocation of OrderingService
//    nodes. The allocation is based on the data object (FuncResult object)
//    to which the ordering function which make use of the ordering service
//    are registered. The table therefore stores the OrderingService
//    nodes under the ID of the data object.
// pathIdAllocator: this object is used to allocate path IDs for all objects
//    which make use of this internal QCM.
// compression: this object is used for allocating compression values
//    for all simple and compound values.
// queue: this is the queue used for scheduling queued indexer processing.
// garbageCollector: this is the indexer garbage collector, which
//    receives notifications of objects (path nodes, etc.) which are no
//    longer needed, schedules them for destruction and destroys at the
//    scheduled moment if they do not again become needed in the meantime.
//

// %%include%%: "internalQCMPathIdAllocator.js"
// %%include%%: "internalQCMCompression.js"
// %%include%%: "indexerQueue.js"
// %%include%%: "indexerGarbageCollector.js"

//
// Constructor
//

// The roundingSpecs are passed directly to the compression module.
// See there for more information.

function InternalQCM(roundingSpecs, scheduleFunc)
{
	this.rootQueryCalcs = new Map();
    this.compCalcs = new Map();
    this.orderServices = new Map();

	this.pathIdAllocator = new InternalQCMPathIdAllocator();
	this.compression = new InternalQCMCompression(roundingSpecs,
                                                  this.getRootPathId());
    this.queue = new IndexerQueue(scheduleFunc);
    this.garbageCollector = new IndexerGarbageCollector();

    // initialize debugging (only if the appropriate debug flag is set)
    this.debugInitStoreObjects();
}

//
// ID generator
//

var internalQCMNextId = 1025;

InternalQCM.newId = function() { return internalQCMNextId++; };

///////////////////////
// Update Scheduling //
///////////////////////

// Schedule this path node's update epilogue for execution. This may 
// be called multiple times within the same update cycle (that is, without
// the update epilogue being called in between).

InternalQCM.prototype.schedulePathNode = internalQCMSchedulePathNode;

function internalQCMSchedulePathNode(pathNode)
{
    this.queue.schedulePathNode(pathNode);
}

// Schedule this identity indexer for delivering identity updates to 
// other indexers which depend on these identities. This may 
// be called multiple times within the same update cycle (that is, without
// the update buffer being flushed in between).

InternalQCM.prototype.scheduleIdentityUpdate = 
    internalQCMScheduleIdentityUpdate;

function internalQCMScheduleIdentityUpdate(identityIndexer)
{
    this.queue.scheduleIdentityUpdate(identityIndexer);
}

// Schedule the given comparison function (CompCalc) to remove elements
// removed from it. 

InternalQCM.prototype.scheduleCompCalc = 
    internalQCMScheduleCompCalc;

function internalQCMScheduleCompCalc(compCalc)
{
    this.queue.scheduleCompCalc(compCalc);
}

// Schedule the given order service to refresh its ordering. 

InternalQCM.prototype.scheduleOrderService = 
    internalQCMScheduleOrderService;

function internalQCMScheduleOrderService(orderService)
{
    this.queue.scheduleOrderService(orderService);
}

// Schedules an incremental task for completion, which is called after path
// node and identity updates in order of scheduling. Scheduling can be cleared
// by setting the flag to false.

InternalQCM.prototype.scheduleCompleteIncrementalUpdate =
      internalQCMScheduleCompleteIncrementalUpdate;

function internalQCMScheduleCompleteIncrementalUpdate(taskObj)
{
    this.queue.scheduleCompleteIncrementalUpdate(taskObj);
}

// This function should be called when the given data element table requires
// some cleanup at the end of the refresh cycle. This cleanup is then scheduled
// here. The data element table is stored under the ID of its indexer.

InternalQCM.prototype.scheduleDataElements = 
    internalQCMScheduleDataElements;

function internalQCMScheduleDataElements(dataElements)
{
    this.queue.scheduleDataElements(dataElements);
}

// This function returns true if there are any path nodes of the indexer
// 'indexer' which are currently scheduled. Otherwise, it returns
// false. This continues to return true until the path node epilogue
// of the last scheduled path node of this indexer is completed.

InternalQCM.prototype.indexerIsScheduled = internalQCMIndexerIsScheduled;

function internalQCMIndexerIsScheduled(indexer)
{
    return this.queue.indexerIsScheduled(indexer);
}

// Execute scheduled path node update epilogues, identity updates and
// (if 'pathAndIdentityOnly' is not set) also scheduled order service
// updates and update completions. If a timer is given, 
// the update will stop when the timer expires. If the queue is not 
// yet empty at this point, false is returned and otherwise true is
// returned.

InternalQCM.prototype.executeScheduled = internalQCMExecuteScheduled;

function internalQCMExecuteScheduled(timer, pathAndIdentityOnly)
{
    var isQueueEmpty = this.queue.executeScheduled(timer, pathAndIdentityOnly);

    if(isQueueEmpty)
        this.compression.applyQueuedSimpleRelease();
    
    return isQueueEmpty;
}

// This function is called when the indexer with the given ID is destroyed.
// This function removes it (but not its individual path nodes) from
// queues in which it (or its data element table) appears.

InternalQCM.prototype.removeIndexerFromQueues =
    internalQCMRemoveIndexerFromQueues;

function internalQCMRemoveIndexerFromQueues(indexerId)
{
    this.queue.removeIndexerFromQueues(indexerId);
}

////////////////////////
// Garbage Collection //
////////////////////////

// This function is called when the index on the given path node is no
// longer needed. This function schedules the destruction of the indexes
// on the path node.

InternalQCM.prototype.scheduleIndexDestroy = internalQCMScheduleIndexDestroy;

function internalQCMScheduleIndexDestroy(pathNode)
{
    this.garbageCollector.scheduleIndexDestroy(pathNode);
}

// This cancels any pending scheduling for the destruction of the indexes
// on this path node. This should be called when indexing has become
// needed again.

InternalQCM.prototype.descheduleIndexDestroy =
    internalQCMDescheduleIndexDestroy;

function internalQCMDescheduleIndexDestroy(pathNode)
{
    this.garbageCollector.descheduleIndexDestroy(pathNode);
}

// This function is called when tracing on the given path node is no
// longer needed. This function schedules the termination of tracing on
// the path node (which may result in the destruction of the path node).

InternalQCM.prototype.scheduleTraceDeactivation =
    internalQCMScheduleTraceDeactivation;

function internalQCMScheduleTraceDeactivation(pathNode)
{
    this.garbageCollector.scheduleTraceDeactivation(pathNode);
}

// This cancels any pending scheduling for the termination of tracing
// on this path node. This should be called when tracing has become
// needed again.

InternalQCM.prototype.descheduleTraceDeactivation =
    internalQCMDescheduleTraceDeactivation;

function internalQCMDescheduleTraceDeactivation(pathNode)
{
    this.garbageCollector.scheduleTraceDeactivation(pathNode);
}

// This function is called by the task scheduler to perform any garbage
// collection which has been scheduled. The function receives the
// task queue object as input (which allows it to check whether it is
// timed out). This function then performs garbage collection until
// finished or timed out.
// The returns true if the task was completed and false if it was timed out.

InternalQCM.prototype.executeGarbageCollection =
    internalQCMExecuteGarbageCollection;

function internalQCMExecuteGarbageCollection(taskQueue)
{
    return this.garbageCollector.executeGarbageCollection(taskQueue);
}

////////////////////////
// Path ID allocation //
////////////////////////

// This function allocates an ID for the path whose prefix (the path
// except for the last attribute) has ID 'prefixId' (this should have
// already been allocated) and the last attribute is 'attr'. This function
// returns an integer.
// An indexer using a path should call this function once for every path
// it uses. It may call this function again for the same path only after
// releasing the path by calling 'releasePathId()'.
// For more details see the function with the same name in 
// 'internalQCMPathIdAllocator.js'.

InternalQCM.prototype.allocatePathId = internalQCMAllocatePathId;

function internalQCMAllocatePathId(prefixId, attr)
{
	return this.pathIdAllocator.allocatePathId(prefixId, attr);
}

// This function is similar to allocatePathId, except that instead of 
// a single attribute, it takes an array of attributes as input.
// The function then allocates an ID for the path which is a concatenation 
// of the path with ID prefixId (which must already have been allocated)
// and the sequence of attributes in 'attrs'. The reference counts on 
// the prefixes are increased in such a way that releasing the full path 
// would also release the prefixes (unless they were allocated separately
// or are a prefix of another allocated path).

InternalQCM.prototype.allocatePathIdFromPath = 
    internalQCMAllocatePathIdFromPath;

function internalQCMAllocatePathIdFromPath(prefixId, attrs)
{
	return this.pathIdAllocator.allocatePathIdFromPath(prefixId, attrs);
}

// This function allocates and returns the ID of the path which is the
// concatenation of the paths with IDs 'prefixId' and 'suffixId'.  The
// reference counts on the prefixes are increased in such a way that
// releasing the full path would also release the prefixes (unless
// they were allocated separately or are a prefix of another allocated
// path).

InternalQCM.prototype.allocateConcatPathId = 
    internalQCMAllocateConcatPathId;

function internalQCMAllocateConcatPathId(prefixId, suffixId)
{
	return this.pathIdAllocator.allocateConcatPathId(prefixId, suffixId);
}

// Given a path ID, this function increases the reference count for the
// given path ID. This path ID must have already been allocated,
// otherwise nothing happens.

InternalQCM.prototype.allocatePathIdByPathId = 
    internalQCMAllocatePathIdByPathId;

function internalQCMAllocatePathIdByPathId(pathId)
{
	this.pathIdAllocator.allocatePathIdByPathId(pathId);
}

// This function returns the path ID allocated to the path which extends
// the prefix path with ID prefixId with the given attribute ('attr').
// If no such path ID was allocated, the function returns undefined.
// This does not allocate the path or increase the refrence count of
// an already allocated path.

InternalQCM.prototype.getPathId = internalQCMGetPathId;

function internalQCMGetPathId(prefixId, attr)
{
	return this.pathIdAllocator.getPathId(prefixId, attr);
}

// This function releases a single allocation of the given path ID.
// An indexer which allocated a path ID should call this function 
// when it no loger makes use of that path ID.
// For more details see the function with the same name in 
// 'internalQCMPathIdAllocator.js'.

InternalQCM.prototype.releasePathId = internalQCMReleasePathId;

function internalQCMReleasePathId(pathId)
{
	return this.pathIdAllocator.releasePathId(pathId);
}

// This function takes as input two path IDs allocated already by a call
// to 'allocatePathId()' (and not released yet). The second argument 
// should be the ID of a path which is a proper prefix of the path with
// ID 'pathId'. If this is not the case, the function returns undefined.
// Otherwise, this function returns the ID of the path which is the suffix
// of the path with ID 'pathId' beginning where the prefix with ID
// 'prefixId' ends. For example, if 'pathId' is the ID of the path [a,b,c,d]
// and 'prefixId' is the ID of the path [a,b] then this function returns
// the ID of the path [c,d]. 

InternalQCM.prototype.diffPathId = internalQCMDiffPathId;

function internalQCMDiffPathId(pathId, prefixId)
{
	return this.pathIdAllocator.diffPathId(pathId, prefixId);
}

// This function returns the ID of the root path (the empty path).
// This path does not have to be allocated (or released).

InternalQCM.prototype.getRootPathId = internalQCMGetRootPathId;

function internalQCMGetRootPathId()
{
	return this.pathIdAllocator.getRootPathId();
}

// This function returns the sort key for the given path ID. If the path ID
// was not yet allocated, this returns 0.

InternalQCM.prototype.getPathSortKey = internalQCMGetPathSortKey;

function internalQCMGetPathSortKey(pathId)
{
	return this.pathIdAllocator.getSortKey(pathId);
}

// Given a path ID, this function returns the range of sort keys
// which are allocated to paths which extend the given path. This range
// begins with the sort key of the path given and ends with the highest
// sort key allocated so far to a path extending this path (there may be
// no path with this sort key if the path allocated with this key
// was removed). The paths extending the given path (including the path
// itself) are exactly those paths which have a sort key in this range.
// The range is returned as an array of two numbers:
// [<start of range>, <end of range>].
// If the given path ID is not allocated, undefined is returned.

InternalQCM.prototype.extensionSortKeyRange = 
	internalQCMExtensionSortKeyRange;

function internalQCMExtensionSortKeyRange(pathId)
{
    return this.pathIdAllocator.extensionSortKeyRange(pathId);
}

// This function returns true if the second argument is a prefix
// of the path in the first argument (including the case where they are
// equal). Otherwise, false is returned.

InternalQCM.prototype.isPrefixOf = internalQCMIsPrefixOf;

function internalQCMIsPrefixOf(pathId, prefixId)
{
    return this.pathIdAllocator.isPrefixOf(pathId, prefixId);
}

// Given a path ID, this returns the length of the path (that is, the
// number of attributes in the path). The length of the root path is zero
// and the length of each path is one more than the length of its 
// immediate prefix.
// The function returns undefined if the path ID is unknown.

InternalQCM.prototype.getPathLength = internalQCMGetPathLength;

function internalQCMGetPathLength(pathId)
{
    return this.pathIdAllocator.getPathLength(pathId);
}

// Given a path ID, this returns the ID of the longest proper prefix of 
// the path (that is, the prefix path which is shorter by exactly one
// string). If the path ID is not known or is the root path ID 
// (and therefore has no prefix) undefined is returned. 

InternalQCM.prototype.getPrefix = internalQCMGetPrefix;

function internalQCMGetPrefix(pathId)
{
    return this.pathIdAllocator.getPrefix(pathId);
}

// given an array of path IDs, this function returns the ID of the longest 
// common prefix of all these paths.

InternalQCM.prototype.getCommonPrefix = internalQCMGetCommonPrefix;

function internalQCMGetCommonPrefix(pathIds)
{
    return this.pathIdAllocator.getCommonPrefix(pathIds);
}

// Given two path IDs where 'prefixId' is the ID of a path which is
// a strict prefix of the path with ID 'pathId' this function 
// returns the first attribute in the path 'pathId' after the 
// prefix 'prefixId'. If 'prefixId' is not a proper prefix of 'pathId',
// undefined is returned

InternalQCM.prototype.getFirstAttrAfterPrefix = 
    internalQCMGetFirstAttrAfterPrefix;

function internalQCMGetFirstAttrAfterPrefix(prefixId, pathId)
{
    return this.pathIdAllocator.getFirstAttrAfterPrefix(prefixId, pathId);
}

// given a path ID, this function returns the last attribute in the path.
// If the path ID is the root path ID or if the path ID is not allocated,
// undefined is returned.

InternalQCM.prototype.getLastPathAttr = 
    internalQCMGetLastPathAttr;

function internalQCMGetLastPathAttr(pathId)
{
    return this.pathIdAllocator.getLastPathAttr(pathId);
}

// given a path ID, this function returns the array of strings which 
// is the path belonging to this ID. 
// If this path ID was not allocated, this function returns undefined.

InternalQCM.prototype.getPathStrings = 
    internalQCMGetPathStrings;

function internalQCMGetPathStrings(pathId)
{
    return this.pathIdAllocator.getPathStrings(pathId);
}

// return the suffix of the path with ID 'pathId' beginning after the
// prefix 'prefixId'. If 'pathId' is not allocated or 'prefixId' is 
// not a prefix of it, undefined is returned.

InternalQCM.prototype.getPathSuffix = 
    internalQCMGetPathSuffix;

function internalQCMGetPathSuffix(pathId, prefixId)
{
    return this.pathIdAllocator.getPathSuffix(pathId, prefixId);
}

////////////////////////////////////////////
// Root Query Calculation Node Management //
////////////////////////////////////////////

// This function receives a query result object, a Query object, an
// indexer object and (optionally) the ID of a prefix projection
// path.  This ID can be undefined (interpreted as an empty path)
// or the ID of the corresponding path. Any other
// ID will cause this function to return undefined.  
// This function checks whether a root query calculation node was already 
// created for this query + indexer + projection path combination.  If yes,
// this root query calculation node is returned. Otherwise, a new root
// query calculation node is created and returned.
// The given query result node is assigned to the root query calculation
// node. This assignment can be un-done by calling releaseRootQueryCalc(). 

InternalQCM.prototype.getRootQueryCalc = internalQCMGetRootQueryCalc;

function internalQCMGetRootQueryCalc(queryResult, query, indexer, 
									 prefixProjPathId)
{
	if(!queryResult || !query || !indexer)
		return undefined;

	if(!prefixProjPathId)
		// get the path ID of the root of the indexer
		prefixProjPathId = this.getRootPathId();

	var key = indexer.getId() + ";" + query.getId() + ";" + prefixProjPathId;
	
	var rootQueryCalc;

    if(this.rootQueryCalcs.has(key))
        rootQueryCalc = this.rootQueryCalcs.get(key);
    else {
		rootQueryCalc = query.newRootQueryCalc(indexer, prefixProjPathId, key);
        this.rootQueryCalcs.set(key, rootQueryCalc);
    }
	
	rootQueryCalc.addQueryResult(queryResult);

	return rootQueryCalc;
}

// This function is called by a query result object when it no longer
// makes use of the given root query calculation object. The association
// between the root query calculation object and the query result object
// is removed. If no more query result objects are associated with
// the root query calculation object after this operation, it is destroyed.

InternalQCM.prototype.releaseRootQueryCalc = internalQCMReleaseRootQueryCalc;

function internalQCMReleaseRootQueryCalc(queryResult, rootQueryCalc)
{
	if(!rootQueryCalc || !queryResult)
		return;

	if(!rootQueryCalc.removeQueryResult(queryResult)) {
		// no more query result nodes registered to this root query calculation
		// node, it can be destroyed
		var key = rootQueryCalc.getQCMKey();
		rootQueryCalc.destroy();
		this.rootQueryCalcs.delete(key);
	}
}

////////////////////////////////////////////
// Comparison Calculation Node Management //
////////////////////////////////////////////

// This function receives a comparison result object 'compResult'
// and a Comparison 'comparison' object (which defines a comparison
// description). The function also receives certain properties of the
// data object of 'compResult' (that is, the data to which the comparison
// is applied). This includes the dominated indexer 'indexer', the
// and the dominated projection path id 'prefixPathId'. These two parameters
// together with the ID of the Comparison object define a unique
// comparison ID (allocated out of the general InternalQCM pool) and a
// unique CompCalc object for implementing the comparison (the
// comparison ID is the ID of this CompCalc object). This function
// checks whether a CompCalc object was already allocated for this
// tuple of IDs. If it was, the existing CompCalc object is assigned
// to the given CompResult node. Otherwise, a new CompCalc node is
// created (and stored) and this new CompCalc node is assigned to the
// CompResult object.
// This assignment can be un-done by calling releaseCompCalc().
// The CompCalc object assigned here is returned by the function.

InternalQCM.prototype.getCompCalc = internalQCMGetCompCalc;

function internalQCMGetCompCalc(compResult, comparison, indexer, 
								prefixProjPathId)
{
	if(!compResult || !comparison || !indexer)
		return undefined;

	if(!prefixProjPathId) // get the path ID of the root of the indexer
		prefixProjPathId = this.getRootPathId();

    // calculate the unique key of this triple
	var key = indexer.getId() + ";" + comparison.getId() + ";" +
        prefixProjPathId;
	
	var compCalc;

    if(this.compCalcs.has(key))
        compCalc = this.compCalcs.get(key);
    else {
        compCalc = comparison.newCompCalc(indexer, prefixProjPathId, key);
        this.compCalcs.set(key, compCalc);
    }
	
	compCalc.addCompResult(compResult);

	return compCalc;
}

// This function is called by a comparison result object when it no longer
// makes use of the given comparison calculation object. The association
// between the comparison calculation object and the comparison result object
// is removed. If no more comparison result objects are associated with
// the comparison calculation object after this operation, it is destroyed.

InternalQCM.prototype.releaseCompCalc = internalQCMReleaseCompCalc;

function internalQCMReleaseCompCalc(compResult, compCalc)
{
	if(!compCalc || !compResult)
		return;

	if(!compCalc.removeCompResult(compResult)) {
		// no more query result nodes registered to this root query calculation
		// node, it can be destroyed
		var key = compCalc.getQCMKey();
		compCalc.destroy();
		this.compCalcs.delete(key);
	}
}

///////////////////////////////////
// Order Service Node Management //
///////////////////////////////////

// This function is called when 'dataObj' is set as the data of the
// order function result node 'orderResult'. This function then checks
// whether an OrderService object was already created for this data object.
// If it wasn't, such an object is created and cached on the InternalQCM
// object.
// The order service object is then returned.

InternalQCM.prototype.getOrderService = internalQCMGetOrderService;

function internalQCMGetOrderService(orderResult, dataObj) 
{
    if(dataObj === undefined)
        return undefined;

    var dataObjId = dataObj.getId();
    var orderService;
    
    if(this.orderServices.has(dataObjId)) {
        // ordering service already exists
        orderService = this.orderServices.get(dataObjId);
    } else {
        // create a new ordering service with 'dataObj' as its data.
        orderService = new OrderService(this);
        orderService.setData(dataObj);
        this.orderServices.set(dataObjId, orderService);
    }

	return orderService;
}

// This function is called by an order result object when its data object
// changes (or it is being destroyed). Since it no longer applies to the
// same data object, it no longer makes use of the same order service.
// Therefore, this functio removes the registration of 'orderResult'
// on its current order service node. If this was the last order result
// registered on the order service node, the order service node is also
// destroyed.

InternalQCM.prototype.releaseOrderService = internalQCMReleaseOrderService;

function internalQCMReleaseOrderService(orderResult)
{
	if(!orderResult)
		return;

    var orderService = orderResult.orderService;

    if(orderService === undefined)
        return;

    if(!orderService.removeOrderResult(orderResult)) {
    
        // no more order results registered to this order service, can
        // destroy it

        var dataObjId = orderService.dataObj.getId();
        this.orderServices.delete(dataObjId);
        
        orderService.destroy();
	}
}

///////////////
// Debugging //
///////////////

var debugInternalQCMStoreObjects = true;

InternalQCM.prototype.debugInitStoreObjects = internalQCMDebugInitStoreObjects;

function internalQCMDebugInitStoreObjects()
{
    if(!debugInternalQCMStoreObjects)
        return;
    
    // set the global debug objects
    debugAllCompResults = {};
    debugAllOrderResults = {};
    debugAllIdentityResults = {};
    debugAllQueryResults = {};
    debugAllMergeIndexers = {};

    // tree objects
    // debugAllDegenerateIntervalTrees = [];
    // debugAllIntervalTrees = [];
}
