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


// This file implements a table mapping data element IDs between a source
// indexer and a target indexer. Such a table belongs to one or more
// merge groups (a merge group may share this table with its prefix group,
// as they merge to different paths).
//
// The mapped target data element IDs may depend on the source data
// element ID, the dominating ID (in the target indexer) and the target
// path ID.
// The interface of this object allows one to request a data element ID
// to be assigned to a given source data element, path (in the target indexer)
// and dominating ID (in the target indexer). If such a data element ID
// was already allocated, it is returned. Otherwise, a new data element ID
// is allocated, stored and returned. One can later clear the entry
// when the target node is removed.
// This can be used not only for the paths at which the target data element
// is allocated but also for lower paths. In this case, the 
// target ID is equal to the domianting ID (note that this ID may belong to
// a different group).
// It is up to the module using this table to decide which data element IDs
// to store inside it.
//
// The mapped target data element Ids are indexed by source ID and
// dominating node ID. When there is no dominating node ID, a group may assign
// only one target element ID for each source ID and the target path must be
// the root path. When the dominating node ID is given, the target
// data element may either be equal to the dominating node ID
// (but different from the source ID) in which case it does not define
// a new data element, or different from the dominating node ID
// (in which case it does define a new data element). In the second case,
// it is possible for different target element IDs to be assigned
// to the same source ID and same dominating ID at different paths
// (this is, however, rare, as it requires conflicting groups with the
// same priority as the group to which this data element mapping object
// belongs to map to different extension paths of the group). Moreover, in the
// first case, while only one target ID is possible (by definition, as it is
// equal to the dominating ID), it may be mapped to multiple paths. It is
// then convenient to store the information as to which paths the mapping
// took place at inside this table.
//
// Since the set of paths at which mapping takes place is probably relatively
// small and, moreover, it is likely that if a merge group has multiple
// target paths at which a source node is translated then most source
// nodes are translated at all these paths (these are the explicit target
// path and the extension target paths of the group) we assign an ordering
// to the paths at which the elements are added to this object and
// under each source ID + dominating ID store an array of target IDs,
// where each target ID is the target ID assigned at the path corresponding to
// the given position in the array.
//
// It is assumed that a separate MappedDataElements object is used for every 
// mapping group, so the group ID is not included in the information 
// stored here. 
//
// Object Structure
// ----------------
//
// {
//     rootPathId: <ID of root path>
//     pathIdPos: <Map>{
//         <path ID>: <index into the 'pathIds' array>
//         .....
//     }
//     pathIds: [<array of path IDs>]
//     pathIdCount: [<array of counts>]
//     sourceIds: <Map>{
//         <source ID>: {
//            undominated: <target element ID> // may be undefined
//            byDominating: <Map>{
//                 <dominating ID>: [<array of target IDs>],
//                 .....
//            }
//        }
//     }
// }
//
// pathIdPos:
// pathIds:
//    These two objects define an ordering on the target path IDs at
//    which translation takes place. 'pathIdPos' allows one to find the
//    position allocated to a given path ID while 'pathIds' allows one
//    to determine the path ID to which a certain position was allocated.
// pathIdCount:
//    Each position in this array counts the number of entries added
//    for the path whose ID is at the same position in the 'pathIds' array.
//    When this drops to zero, the path ID is removed from the
//    'pathIdPos' table and its position will be used by the next new
//    path ID added to the table.
//    The path ID counts here only apply to dominated entries.
// sourceIds: this table stores the transations. 'undominated' stores the
//    translation without a dominating node (this takes place at the root
//    target path) while 'byDominating' stores the translations for mapping
//    under dominating nodes. Under each dominating ID the table stores
//    an array, where the position corresponding to the position of a certain
//    path ID in 'pathIds' stores the target ID assigned to the source ID
//    at that path ID under the dominating ID. Some entries in this array
//    may be undefined and some may contain an ID equal to the domianting ID.

function MappedDataElements(rootPathId)
{
    this.rootPathId = rootPathId;
    this.pathIdPos = new Map();
    this.pathIds = [];
    this.pathIdCount = [];
    this.sourceIds = new Map();
}

// Returns true if there are no element IDs assigned in this table and
// false if there are.

MappedDataElements.prototype.isEmpty = mappedDataElementsIsEmpty;

function mappedDataElementsIsEmpty()
{
    return (this.sourceIds.size == 0);
}

// This function should be called for a path ID which is not in the table
// 'pathIdPos'. This function then assigns the first available position
// to this path ID and returns that position.

MappedDataElements.prototype.assignPathPos = mappedDataElementsAssignPathPos;

function mappedDataElementsAssignPathPos(pathId)
{
    var i = 0;
    var l = this.pathIdCount.length;
    
    // loop over the array of path IDs until an empty slot is found.
    for( ; i < l ; ++i) {
        if(this.pathIdCount[i] === 0) {
            this.pathIdPos.set(pathId, i);
            this.pathIds[i] = pathId;
            return i;
        }
    }

    // no empty position found, append at end
    this.pathIdCount.push(0);
    this.pathIdPos.set(pathId, l);
    this.pathIds[l] = pathId;

    return l;
}

// Given a source data element ID, a path ID and a dominating target 
// element ID (which may be undefined) this function returns 
// the target data element ID to which this source data element ID
// is mapped (under the given path and dominating ID).
// If 'targetEqualsDominating' is true, then the function returns
// 'dominatingId' (it is then called only to set the entry, in case
// it does not exist).
// If no entry yet exists in the table, it is created.
// If 'targetEqualsDominating' is true, the target ID of this entry is
// set to 'dominatingId'. Otherwise, a new data element ID is allocated
// for it from the data element ID pool.

MappedDataElements.prototype.addTargetId = mappedDataElementsAddTargetId;

function mappedDataElementsAddTargetId(sourceId, pathId, dominatingId,
                                       targetEqualsDominating)
{
    var sourceEntry;

    if(!this.sourceIds.has(sourceId)) {
        sourceEntry = {
            undominated: undefined,
            byDominating: undefined
        };
        this.sourceIds.set(sourceId, sourceEntry);
    } else
        sourceEntry = this.sourceIds.get(sourceId);
        
    if(!dominatingId) {
        if(sourceEntry.undominated !== undefined)
            return sourceEntry.undominated;
        return (sourceEntry.undominated =
                InternalQCMIndexer.getNextDataElementId());
    }

    var pathIndex;
    if(!this.pathIdPos.has(pathId)) {
        pathIndex = this.assignPathPos(pathId);
    } else
        pathIndex = this.pathIdPos.get(pathId);    

    var targetIds;
    
    if(sourceEntry.byDominating === undefined) {
        sourceEntry.byDominating = new Map();
        targetIds = [];
        sourceEntry.byDominating.set(dominatingId, targetIds);
    } else if(sourceEntry.byDominating.has(dominatingId))
        targetIds = sourceEntry.byDominating.get(dominatingId);
    else {
        targetIds = [];
        sourceEntry.byDominating.set(dominatingId, targetIds);
    }

    var targetId = targetIds[pathIndex];
    if(targetId === undefined)
        this.pathIdCount[pathIndex]++;
    
    if(targetEqualsDominating) {
        targetIds[pathIndex] = dominatingId;
        return dominatingId;
    } else if(targetId !== undefined && targetId !== dominatingId)
        return targetId;
   
    targetId = InternalQCMIndexer.getNextDataElementId();
    targetIds[pathIndex] = targetId;

    return targetId;
}

// This function removes from this table the target data element ID stored for 
// the given source data element ID, path ID and dominating data element ID.
// The function returns false if after this removal the table is empty and
// true if it is not empty after this removal.

MappedDataElements.prototype.removeTargetId = mappedDataElementsRemoveTargetId;

function mappedDataElementsRemoveTargetId(sourceId, pathId, dominatingId)
{
    if(!this.sourceIds.has(sourceId))
        return !this.isEmpty();

    var sourceEntry = this.sourceIds.get(sourceId);
    
    if(!dominatingId) { // undominated node
        if(sourceEntry.undominated === undefined)
            return true; // nothing to remove
        sourceEntry.undominated = undefined;
        if(sourceEntry.byDominating !== undefined &&
           sourceEntry.byDominating.size > 0)
            return true;

        // remove source entry
        this.sourceIds.delete(sourceId);
        return !this.isEmpty();
    }

    // dominated entry
    
    if(sourceEntry.byDominating === undefined ||
       !sourceEntry.byDominating.has(dominatingId))
        return true; // nothing to remove

    var pathIndex = this.pathIdPos.get(pathId);
    if(pathIndex === undefined)
        return true;
        
    var targetIds = sourceEntry.byDominating.get(dominatingId);

    if(targetIds[pathIndex] === undefined)
        return true; // nothing to remove

    if(--this.pathIdCount[pathIndex] == 0) { // last mapping for this path
        this.pathIdPos.delete(pathId);
        this.pathIds[pathIndex] = undefined;
    }
        
    if(pathIndex === targetIds.length - 1) {
        // last index, can reduce the size of the array
        for(var i = pathIndex-1 ; i >= 0 ; --i) {
            if(targetIds[i] !== undefined) {
                targetIds.length = i + 1;
                return true; // still some entries in array
            }
        }
        // array is empty
        if(sourceEntry.byDominating.size > 1) {
            sourceEntry.byDominating.delete(dominatingId);
            return true;
        }

        // delete source entry
        this.sourceIds.delete(sourceId);
        return !this.isEmpty();
        
    } else {
        targetIds[pathIndex] = undefined;
        return true;
    }
}

// This function returns an array with all target data element IDs the
// given source data element ID was mapped to at the given path 
// (regardless of the dominating ID). The result is returned as an array 
// of target element IDs.

MappedDataElements.prototype.getTargetIdsAtPath = 
    mappedDataElementsGetTargetIdsAtPath;

function mappedDataElementsGetTargetIdsAtPath(sourceId, pathId)
{
    if(this.sourceIds.size === 0)
        return [];
    
    if(!sourceIds.has(sourceId))
        return [];

    var targetIds = [];
    var sourceEntry = this.sourceIds.get(sourceId);
    
    if(pathId === this.rootPathId && sourceEntry.undominated !== undefined)
        targetIds.push(sourceEntry.undominated);

    if(sourceEntry.byDominating === undefined ||
       sourceEntry.byDominating.size === 0)
        return targetIds;

    var pathIndex = this.pathIdPos.get(pathId);
    if(pathIndex === undefined)
        return targetIds;

    sourceEntry.byDominating.forEach(function(mappedIds, dominatingId) {
        var targetId = mappedIds[pathIndex];
        if(targetId !== undefined)
            targetIds.push(targetId);
    });
    
    return targetIds;
}

// This function takes a set (array) of source IDs mapped at the given
// target path and returns an array of target IDs (or an array of
// arrays of target IDs) to which these source IDs were mapped. If
// 'origSourceIfNotTranslated' is set, the function returns the
// original source ID as its target ID if no translation is found in
// the table.
// 'returnFlat' indicates whether all target IDs should be returned in
// one array (in which case, if there are multiple target IDs for the same
// source ID the alignment between the input source IDs and the target IDs
// is lost) or in an array of arrays, where each position in the returned
// array holds an array of target IDs to which the source ID in the
// corresponding position in the 'sourceIds' array is mapped to (such an
// array may be empty).

MappedDataElements.prototype.getAllTargetIdsAtPath = 
    mappedDataElementsGetAllTargetIdsAtPath;

function mappedDataElementsGetAllTargetIdsAtPath(sourceIds, pathId,
                                                 origSourceIfNotTranslated,
                                                 returnFlat)
{
    if(this.sourceIds.size === 0)
        return [];

    var pathIndex = this.pathIdPos.get(pathId);
    if((pathIndex === undefined && pathId !== this.rootPathId) ||
       this.sourceIds.size === 0) {
        // no translations
        // (path index may be undefined only if there are no dominating nodes)
        if(!origSourceIfNotTranslated)
            return []; // no target IDs to return
        if(returnFlat)
            return sourceIds;
        var targetIds = new Array(sourceIds.length);
        for(var i = 0, l = sourceIds.length ; i < l ; ++i)
            targetIds[i] = [sourceIds[i]];
        return targetIds;
    }
    
    var targetIds = [];

    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
        var sourceId = sourceIds[i];
        if(sourceId === undefined) {
            if(!returnFlat)
                targetIds.push([]);
            else if(origSourceIfNotTranslated)
                targetIds.push(undefined);
            continue;
        }

        if(!this.sourceIds.has(sourceId)) {
            if(origSourceIfNotTranslated)
                targetIds.push(returnFlat ? sourceId : [sourceId]);
            else if(!returnFlat)
                targetIds.push([]);
            continue;
        }

        var sourceEntry = this.sourceIds.get(sourceId);
        var target = returnFlat ? targetIds : [];
        var found = false;
        
        if(sourceEntry.undominated !== undefined && pathId === this.rootPathId){
            target.push(sourceEntry.undominated);
            found = true;
        }
        
        if(sourceEntry.byDominating !== undefined) {
            sourceEntry.byDominating.forEach(function(mappedIds, dominatingId) {
                var targetId = mappedIds[pathIndex];
                if(targetId !== undefined) {
                    target.push(targetId);
                    found = true;
                }
            });
        }
        
        if(!found && origSourceIfNotTranslated)
            target.push(sourceId);

        if(!returnFlat)
            targetIds.push(target);
    }
    
    return targetIds;
}

// Return the target data element ID stored for the given source data element,
// path ID and dominating ID. This may return undefined if the target
// data element is no found.

MappedDataElements.prototype.getTargetId = 
    mappedDataElementsGetTargetId;

function mappedDataElementsGetTargetId(sourceId, pathId, dominatingId)
{
    if(this.sourceIds.size === 0)
        return undefined;
    
    if(!sourceIds.has(sourceId))
        return undefined;

    var sourceEntry = this.sourceIds.get(sourceId);

    if(!dominatingId)
        return sourceEntry.undominated; // may be undefined
    
    if(sourceEntry.byDominating === undefined ||
       sourceEntry.byDominating.size === 0)
        return undefined;

    var pathIndex = this.pathIdPos.get(pathId);
    if(pathIndex === undefined)
        return undefined;

    var targetIds = sourceEntry.byDominating.get(dominatingId);
    return targetIds[pathIndex];
}

// Return the target data element ID stored for the given source data element,
// such that the target ID is not equal to the dominating ID. This 
// provides a list of all target data element IDs allocated as a mapping
// of this source node.
// The result is returned as an array of target data element Ids.

MappedDataElements.prototype.getAllocatedTargetIds = 
    mappedDataElementsGetAllocatedTargetIds;

function mappedDataElementsGetAllocatedTargetIds(sourceId)
{
    if(this.sourceIds.size === 0)
        return [];
    
    if(!sourceIds.has(sourceId))
        return [];

    var targetIds = [];
    var sourceEntry = this.sourceIds.get(sourceId);
    
    if(sourceEntry.undominated !== undefined)
        targetIds.push(sourceEntry.undominated);

    if(sourceEntry.byDominating === undefined ||
       sourceEntry.byDominating.size === 0)
        return targetIds;

    sourceEntry.byDominating.forEach(function(mappedIds, dominatingId) {
        for(var i = 0, l = mappedIds.length ; i < l ; ++i) {
            var targetId = mappedIds[i];
            if(targetId !== undefined && targetId !== dominatingId)
                targetIds.push(targetId);
        }
    });
    
    return targetIds;
}
