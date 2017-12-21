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


// This object, which is a derived class of the FuncResult base class,
// is the interface which allows a function to write its result to
// a merge indexer.
//
// These object is constructed with the properties which represent the 
// target information of the function:
// 1. The target (merge) indexer.
// 2. The minimal target path for the function. This is the place
//    where the root of the result of the function will be placed.
// 3. The priority: this is a property of the target since it is
//    the relative priority of the different functions which map to the
//    same place which determines the way they are merged.
// 4. The source identification ID: this is optional. If undefined is given,
//    this will be set to the identification provided by the data source.
//    To force the base identity here, use a 0 ID (rather than undefined).
// 5. The target identification ID.
// 6. 'under identity': if this property is set, the source nodes are
///   mapped under target nodes (at the prefix target path) which are
//    created for the identities of the source nodes mapped, one node
//    per identity. In this way, multiple source nodes with the same identity
//    may be gathered under a single node in the target indexer which
//    has the identity of those nodes.
// 7. 'identity only': if 'under identity' is set, setting also 'identity only'
//    results in the creation of the identity nodes for each of the identities
//    of the source nodes, but the source nodes themselves are not merged.
//    This property is ignored if the source of the mapping is a
//    multi-projection with more than one projection path (in that case,
//    the source nodes must be mapped to produce the projection result
//    structure).
//
// After the object is created, a setData() operation sets a function 
// result as the function which is to be mapped by this ResultToMerge
// to the merge indexer. This registration provides the properties
// associated with the source of the mapping:
// 1. Source indexer.
// 2. projection IDs and the associated path mappings. These path mappings
//    have the root path as their minimal target path. The minimal target
//    path provided when the ResultToMerge object was constructed 
//    is prefixed to the target paths received from the data result object.
// 3. source identification ID.
//
// After registering the mappings to the merge indexer, this object
// serves as a conduit for the match updates from the data result object
// to the merge indexer.
//
// Note that this object cannot be used as the data result object for some
// other function result.
//
// Object Structure
// ----------------
//
// {
//     // target properties
//     
//     targetIndexer: <MergeIndexer>,
//     minTargetPathId: <path ID in target indexer>,
//     priority: <number>,
//     sourceIdentificationId: undefined|<identification ID>,
//     targetIdentificationId: undefined|<identification ID>
//     underIdentity: true|false
//     identityOnly: true|false
//
//     // source properties
//     sourceIndexer: <indexer>
//     mappings: <Map>{
//        <projection ID>: <path mapping array>
//        .....
//     }
//     projId: <projection ID> // if there is a single projection
//
//     pendingAddMatches: undefined|
//         <Array of:
//            {
//                elementIds: <array of element IDs>,
//                projId: <ID of projection for which the matches are added>
//            }
//            .....
//         >
// }
//
// minTargetPathId: The minimal target path ID defined by this object.
// sourceIdentificationId: if this is provided, this overrides the 
//    identification provided by the data source as the source identification.
//    This should be set to 0 to force the base identity to be used. 
//    If set to undefined, this will get the identification from 
//    the data source.
// underIdentity: if this property is set, the source nodes are
///   mapped under target nodes (at the prefix of minTargetPathId, which
//    is not allowed to be the root path in this case) which are
//    created for the identities of the source nodes mapped, one node
//    per identity. In this way, multiple source nodes with the same identity
//    may be gathered under a single node in the target indexer which
//    has the identity of those nodes.
// identityOnly: if 'under identity' is set, setting also 'identityOnly'
//    results in the creation of the identity nodes for each of the identities
//    of the source nodes at 'minTargetPathId' and the source nodes
//    themselves are not merged.
//    This property is ignored if the source of the mapping is a
//    multi-projection with more than one projection path (in that case,
//    the source nodes must be mapped to produce the projection result
//    structure).
// mappings: this stores, for each projection ID (received from the 
//    data result object) the path mapping array for this projection
//    after the minimal target path was prefixed to its target paths.
//    This is stored here mainly because these target path IDs 
//    are allocated here and therefore also have to be released here
//    (when the mapping is modified or removed).
// projId: if the result data has a single projection path, this stores
//    the ID of this projection.
// pendingAddMatches: this field is undefined except within the 'activated()'
//    function (which activates this result to merge node). Within the
//    'activate()' function, this field is an array, which is used to
//    store all match updates (only additions) which were received from
//    the data object during the activation proces. These updates are queued
//    here and only forwarded to the merge indexer at the end of the
//    activation process, when the required registrations to the
//    merge indexer were made.

// %%include%%: "funcResult.js"

inherit(ResultToMerge, FuncResult);

//
// Constructor
//

// The constructor is initialized with an internal QCM and the target
// properties of the function: target (merge) indexer, the minimal
// target path, the priority, the target identification ID and the
// properties 'underIdentity' (which determines whether the result would
// be merged under identity nodes generated for each identity mapped)
// and 'identityOnly' (which determines, in case 'underIdentity' is set,
// whether only the special identity nodes will be generated and nothing
// else will be mapped). The constructor simply sets them on the object.

function ResultToMerge(internalQCM, targetIndexer, minTargetPathId, priority, 
                       sourceIdentificationId, targetIdentificationId,
                       underIdentity, identityOnly)
{
    this.FuncResult(internalQCM);

    this.targetIndexer = targetIndexer;
    this.minTargetPathId = minTargetPathId;

    // allocate the target path ID here. It will be release when the object
    // is destroyed
    this.qcm.allocatePathIdByPathId(minTargetPathId);
    this.priority = priority;
    this.sourceIdentificationId = sourceIdentificationId;
    this.targetIdentificationId = targetIdentificationId;
    this.underIdentity = !!underIdentity;
    this.identityOnly = !!identityOnly;    
    
    this.mappings = new Map();
    this.projId = undefined;

    this.pendingAddMatches = undefined;
    
    // register to the target indexer to receive notifications when the
    // target path becomes active
    this.targetIndexer.registerPathActiveNotifications(this.minTargetPathId, 
                                                       this);
}

// Destroy this function: in addition the base class destroy, this
// must also remove any mappings which are still registered to the
// merge indexer and release the mapping arrays stored for them
// (the target path IDs in these arrays need to be released). 

ResultToMerge.prototype.destroy =
    resultToMergeDestroy;

function resultToMergeDestroy()
{
    // unregister from the target indexer for receiving notifications when the
    // target path becomes active
    this.targetIndexer.unregisterPathActiveNotifications(this.minTargetPathId, 
                                                         this.getId());

    // remove all mappings registered to the target indexer and remove
    // the mapping arrays stored for them in the 'mappings' table.
    this.removeMapping();
    this.qcm.releasePathId(this.minTargetPathId);

    this.FuncResult_destroy();
}

// This object supports multi-projections, since the merge indexer does.

ResultToMerge.prototype.supportsMultiProj  =
    resultToMergeSupportsMultiProj;

function resultToMergeSupportsMultiProj()
{
    return true;
}

// This object is active if the minimal target path is active.

// xxxxxxxxx if the minimal path is not the root path, need to look at the
// parent, in case it has monitoring which may fall through to the group
// xxxxxxxxxxx

ResultToMerge.prototype.isActive =
    resultToMergeIsActive;

function resultToMergeIsActive()
{
    return this.targetIndexer.isPathActive(this.minTargetPathId);
}

// This function is called when the dominated indexer of the data result 
// object changes or when the dominated projection path changes. 
// In case the indexer has not changed, this function is not always
// called. refreshProjMappings() may be called instead, in cases
// where the list of changed mappings is available to the calling 
// function. 

ResultToMerge.prototype.refreshIndexerAndPaths  =
    resultToMergeRefreshIndexerAndPaths;

function resultToMergeRefreshIndexerAndPaths()
{
    if(this.sourceIndexer === undefined && this.dataObj === undefined)
        return; // nothing to do
    
    var oldSourceIndexer = this.sourceIndexer;
    this.sourceIndexer =
        this.dataObj ? this.dataObj.getDominatedIndexer() : undefined;

    var existingProjs = 
        this.targetIndexer.getRegisteredFuncProjections(this.getId());
    var newProjMappings = this.dataObj ?
        this.dataObj.getDominatedProjMappings() : undefined;

    if(oldSourceIndexer) {
        if(oldSourceIndexer != this.sourceIndexer || !newProjMappings) {
            // remove all existing registrations for this function
            this.removeMapping();
        } else if(existingProjs) {
            // remove existing registration which are no longer in the
            // list of projections of the result data object.
            var _self = this;
            existingProjs.forEach(function(entry, projId) {
                if(!newProjMappings.has(projId))
                    _self.removeMapping(projId);
            });
        }
        this.projId = undefined;
    }

    if(!this.sourceIndexer || !newProjMappings)
        return;
    
    // refresh the new and modified mappings
    this.refreshProjMappings(newProjMappings);
}

// This function is called when the dominated indexer of the data result 
// object changes or when the dominated projection path changes but when
// it is known that the result represented after this change is identical
// to that before the change (that is, the same data element IDs and same keys).
// This function first checks whether the target merge indexer is able to
// replace the previous source with the new source without having to
// refresh the matches (that is, without having to add and remove nodes).
// If it cannot, the 'refreshIndexerAndPath()' function is called, which
// performs a full replacement of the source, including complete removal
// of the original matches and addition of the new matches.
// 'prevPrefixPathId' and 'prefixPathId' indicate how the projection paths
// of the data object before and after the change are related. For every
// projection path, removing the prefix 'prevPrefixPathId' from the old
// prefix path and adding 'prefixPathId' before it should result in the new
// projection path.

ResultToMerge.prototype.replaceIndexerAndPaths  =
    resultToMergeReplaceIndexerAndPaths;

function resultToMergeReplaceIndexerAndPaths(prevPrefixPathId, prefixPathId,
                                             newIndexerContained)
{
    var newProjMappings = this.dataObj.getDominatedProjMappings();

    if(newProjMappings === undefined)
        return; // nothing to do, dominated function chain not yet initialized
    
    // prefix the  minimal target path to the target paths of the mappings
    var _self = this;
    newProjMappings.forEach(function(mapping, projId) {
        // prefix the minimal target path to the target paths of the
        // mappings before adding them to the merge indexer
        mapping = _self.prefixMinTargetPath(mapping, projId);
        newProjMappings.set(projId, mapping);
    });
    
    var sourceIndexer = this.dataObj.getDominatedIndexer();
    
    if(!this.targetIndexer.replaceFuncSource(this, newProjMappings,
                                             prevPrefixPathId, prefixPathId,
                                             sourceIndexer,
                                             this.sourceIdentificationId)) {
        // cannot replace, need a full refresh
        this.refreshIndexerAndPaths();
        return;
    }

    // update the projection mappings

    // clear the previous projections
    this.removeProjMappingArray(undefined);
    this.projId = undefined; // will be set below
    var singleProjId;

    // set the new mappings (those with an undefined mapping array
    // will be removed).
    newProjMappings.forEach(function(mapping, projId) {
        _self.mappings.set(projId, mapping);
        if(singleProjId !== undefined) 
            // not the first projection, clear this.projId
            _self.projId = undefined;
        else 
            // first projection, set it on the object 
            _self.projId = projId;
    });
}

// This function is called when the projection paths of the data result
// object have changed but the indexer did not. projMappings is a Map object
// describing the changes in the path mappings. This is an object whose
// keys are projection IDs and where the value under each projection ID
// is an array of path IDs representing the mapping. An undefined value
// indicates that the projection was removed.
// When this function is called, refreshIndexerAndPaths() is not called.

ResultToMerge.prototype.refreshProjMappings =
    resultToMergeRefreshProjMappings;

function resultToMergeRefreshProjMappings(projMappings)
{
    var sourceIdentificationId;

    if(this.sourceIdentificationId == undefined) 
        sourceIdentificationId = this.dataObj.getDominatedIdentification();
    else if(this.sourceIdentificationId != 0)
        sourceIdentificationId = this.sourceIdentificationId;
    // otherwise (if this.sourceIdentificationId is zero) this remains 
    // undefined to indicate the base identity.

    this.projId = undefined; // will be set below
    var singleProjId;

    // set the new mappings (those with an undefined mapping array
    // will be removed).
    var _self = this;
    projMappings.forEach(function(mapping, projId) {
        if(_self.mappings.has(projId))
            _self.removeProjMappingArray(projId);
        // prefix the minimal target path to the target paths of the mappings
        // before adding them to the merge indexer
        mapping = _self.prefixMinTargetPath(mapping, projId);
        _self.targetIndexer.addMapping(_self, projId, _self.sourceIndexer,
                                      mapping, _self.priority, 
                                      sourceIdentificationId, 
                                      _self.targetIdentificationId,
                                      _self.underIdentity, _self.identityOnly);
        if(mapping) {
            _self.mappings.set(projId, mapping);
            if(singleProjId !== undefined) 
                // not the first projection, clear this.projId
                _self.projId = undefined;
            else 
                // first projection, set it on the object 
                _self.projId = projId;
        }
    });
}

// This function receives a path mapping array as input. Thia array
// has the format:
// [<target path ID 1>, <source path ID 1>, ...,
//                               <target path ID n>, <source path ID n>]
// It then creates a new array with the same source paths but where
// the target paths a prefixed by the minimal target path of this object,
// this.minTargetPathId.

ResultToMerge.prototype.prefixMinTargetPath =
    resultToMergePrefixMinTargetPath;

function resultToMergePrefixMinTargetPath(pathMapping)
{
    if(pathMapping === undefined)
        return undefined;

    var newMapping = [];

    for(var i = 0, l = pathMapping.length ; i < l ; i += 2) {
        newMapping.push(this.qcm.allocateConcatPathId(this.minTargetPathId, 
                                                      pathMapping[i]), 
                        pathMapping[i+1]);
    }

    return newMapping;
}

// This function removes the mapping with the given projection ID.
// The function both removes its registration from the target indexer
// and removes the mapping array stored in the 'mappings' table for 
// this projection.
// If projId is undefined, all projections are removed.

ResultToMerge.prototype.removeMapping = resultToMergeRemoveMapping;

function resultToMergeRemoveMapping(projId)
{
    if(projId === undefined) {
        this.targetIndexer.removeMapping(this);
        this.removeProjMappingArray();
    } else {
        this.targetIndexer.removeMapping(this, projId);
        this.removeProjMappingArray(projId);
    }
}

// This function removes the entry for projection 'projId' from the 
// this.mappings table.
// The main thing this function needs to do is release the target path
// IDs stored in the mapping array (as these were allocated in this 
// object). 
// If projId is undefined, all projection mappings are removed.

ResultToMerge.prototype.removeProjMappingArray =
    resultToMergeRemoveProjMappingArray;

function resultToMergeRemoveProjMappingArray(projId)
{
    if(projId === undefined) {
        var _self = this;
        this.mappings.forEach(function(t,projId) {
            _self.removeProjMappingArray(projId);
        });
    } else {
        var mapping = this.mappings.get(projId);
        if(mapping === undefined)
            return;
        // release the target path IDs
        for(var i = 0, l = mapping.length ; i < l ; i += 2)
            this.qcm.releasePathId(mapping[i]);
        
        this.mappings.delete(projId);

        if(this.mappings.size == 1) { // single iteration below
            
            var _self = this;
            
            this.mappings.forEach(function(projId, mappingEntry) {
                _self.projId = projId;
            });
            
        } else if(this.mappings.size == 0)
            this.projId = undefined;
    }
}

// this function is called after a new data object was set and its projections
// were registered. It should pull the matches from the new data object
// and set them on the target (merge) indexer. If 'indexerAndPathChanged'
// is true, the function 'refreshIndexerAndPath()' was called just before
// this function was called and all matches due to the previous data result
// object were removed. Therefore, this function simply has to fetch the
// matches from each of the projections and add them to the target indexer.
// However, if 'indexerAndPathChanged' is false, the indexer and 
// the dominated path of the data result object did not change and there 
// is only one dominated path. In this case, this function only needs
// to update the merge indexer with the difference between the old matches
// and the new matches. In this situation, 'removeDataObjMatches()' already
// removed the old matches which are not new matches, so this function 
// only needs to add the new matches. To determine which matches are 
// new, this function gets the old data object.

ResultToMerge.prototype.addDataObjMatches  =
    resultToMergeAddDataObjMatches;

function resultToMergeAddDataObjMatches(oldDataObj, indexerAndPathChanged)
{
    if(indexerAndPathChanged) {
        // fetch the matches of each projection and add them to the
        // merge indexer
        var _self = this;
        this.mappings.forEach(function(t,projId) {
            _self.targetIndexer.
                addProjMatches(_self.dataObj.getDominatedMatches(projId), 
                               _self.getId(), projId);
        });
    } else {
        // single projection path and the indexer and path did not change.
        // get the new and old matches, and find those matches which are
        // new and add them to the merge indexer.
        var newMatches = this.dataObj.getDominatedMatches();
        var oldMatches = oldDataObj.getDominatedMatchesAsObj();
        var addedMatches = [];

        for(var i = 0, l = newMatches.length ; i < l ; ++i) {
            var elementId = newMatches[i];
            if(!oldMatches.has(elementId))
                addedMatches.push(elementId);
        }

        this.targetIndexer.addProjMatches(addedMatches, this.getId(), 
                                          this.projId);
    }
}

// this function is called when a new data object is about to be set and 
// its projections registered. It should pull the matches from the old
// data object and remove them on the target (merge) indexer. 
// If 'indexerAndPathChanged' is true, the function 'refreshIndexerAndPath()' 
// will be called just after
// this function is called and all matches due to the new data result
// object will be added. Therefore, this function simply has to fetch the
// matches from each of the projections and remove them from the target indexer.
// However, if 'indexerAndPathChanged' is false, the indexer and 
// the dominated path of the data result object did not change and there 
// is only one dominated path. In this case, this function only needs
// to update the merge indexer with the difference between the old matches
// and the new matches. In this situation, 'addDataObjMatches()' will
// add the new matches which are not old matches, so this function 
// only needs to remove the old matches (which are not among the new matches). 
// To determine which matches should be removed, this function gets the 
// new data object.

ResultToMerge.prototype.removeDataObjMatches =
    resultToMergeRemoveDataObjMatches;

function resultToMergeRemoveDataObjMatches(newDataObj, indexerAndPathChanged)
{
    if(indexerAndPathChanged) {
        // fetch the matches of each projection and add them to the
        // merge indexer
        var _self = this;
        this.mappings.forEach(function(t, projId) {
            _self.targetIndexer.
                removeProjMatches(_self.dataObj.getDominatedMatches(projId), 
                                  _self.getId(), projId);
        });
    } else {
        // single projection path and the indexer and path did not change.
        // get the new and old matches, and find those matches which are
        // removed and remove them from the merge indexer.
        var oldMatches = this.dataObj.getDominatedMatches();
        var newMatches = newDataObj.getDominatedMatchesAsObj();
        var removedMatches = [];

        for(var i = 0, l = oldMatches.length ; i < l ; ++i) {
            var elementId = oldMatches[i];
            if(!newMatches.has(elementId))
                removedMatches.push(elementId);
        }

        this.targetIndexer.removeProjMatches(removedMatches, this.getId(), 
                                             this.projId);
    }
}

// This function is called to add matches from the data result object 
// in cases where it only has a single projection. This function then
// adds these matches to the merge indexer under its own result ID
// and the projection ID (which is known to it).

ResultToMerge.prototype.addMatches  =
    resultToMergeAddMatches;

function resultToMergeAddMatches(matches)
{
    if(this.pendingAddMatches !== undefined) {
        // the ResultToMerge is begin activated, queue the update
        this.pendingAddMatches.push({ elementIds: matches,
                                      projId: this.projId });
        return;
    }
    
    this.targetIndexer.addProjMatches(matches, this.getId(), this.projId);
}

// This function is called to remove matches from the data result object 
// in cases where it only has a single projection. This function then
// removes these matches from the merge indexer under its own result ID
// and the projection ID (which is known to it).

ResultToMerge.prototype.removeMatches  =
    resultToMergeRemoveMatches;

function resultToMergeRemoveMatches(matches)
{
    this.targetIndexer.removeProjMatches(matches, this.getId(), this.projId);
}

// This function may be called to remove all matches from the data result
// object in cases where it only has a single projection. It is assumed
// (by the requirements of this interface) the at this point, the data
// source can still provide the full list of matches. This function tehrefore
// gets the full list of matches and removes it, using the standard
// removeMatches() function. This is probably not the most efficient way
// of doing this, but it is currently not yet clear whether it is worth the
// effort to optimize this.

ResultToMerge.prototype.removeAllMatches  =
    resultToMergeRemoveAllMatches;

function resultToMergeRemoveAllMatches(matches)
{
    this.removeMatches(this.dataObj.getDominatedMatches());
}

// This function is called to add matches from the data result object
// for the given projection ID. 'resultId' is the ID of the data
// result object. This function then adds these matches to the merge
// indexer under its own result ID and the given projection ID.

ResultToMerge.prototype.addProjMatches =
    resultToMergeAddProjMatches;

function resultToMergeAddProjMatches(matches, resultId, projId)
{
    if(this.pendingAddMatches !== undefined) {
        // the ResultToMerge is begin activated, queue the update
        this.pendingAddMatches.push({ elementIds: matches,
                                      projId: projId });
        return;
    }

    this.targetIndexer.addProjMatches(matches, this.getId(), projId);
}

// This function is called to remove matches from the data result object
// for the given projection ID. 'resultId' is the ID of the data
// result object. This function then removes these matches from the merge
// indexer under its own result ID and the given projection ID.

ResultToMerge.prototype.removeProjMatches  =
    resultToMergeRemoveProjMatches;

function resultToMergeRemoveProjMatches(matches, resultId, projId)
{
    this.targetIndexer.removeProjMatches(matches, this.getId(), projId);
}

//////////////////////////////////
// Access to Projection Matches //
//////////////////////////////////

// The terminal projection matches are actually those of the data object.

ResultToMerge.prototype.getTerminalProjMatches =
    resultToMergeGetTerminalProjMatches;

function resultToMergeGetTerminalProjMatches(projId)
{
    if(this.dataObj === undefined)
        return [];

    return this.dataObj.getTerminalProjMatches(projId);
}

// The terminal projection matches are actually those of the data object.

ResultToMerge.prototype.filterTerminalProjMatches =
    resultToMergeFilterTerminalProjMatches;

function resultToMergeFilterTerminalProjMatches(projId, elementIds)
{
    if(this.dataObj === undefined)
        return [];

    return this.dataObj.filterTerminalProjMatches(projId, elementIds);
}

////////////////
// Activation //
////////////////

// This function is called by the target indexer when the target path
// of this resultToMerge object becomes active (and therefore this 
// result object becomes active).

ResultToMerge.prototype.pathActivated = 
    resultToMergePathActivated;

function resultToMergePathActivated(pathId)
{
    this.activated();
}

// This function is called when this function result node is activated.
// It first calls the base class (FuncResult) activation function
// which adds this function result as an active composed function of its
// data object (if any). This process may result in this function result
// receiving a 'refreshIndexerAndPaths()' call which will activate this
// ResultToMerge node and perform the required registrations to the
// merge indexer. However, if this.sourceIndexer is undefined (and
// a dataObj is defined and that dataObj has a dominated indexer)
// then such a refresh call was not yet received and therefore we call this
// function here (which results in activation of this function result
// and registration of the mappings to the merge indexer).
// Match updates received within the call to this function a queued and
// forwarded to the merge indexer only at the end of the activation process.

ResultToMerge.prototype.activated = resultToMergeActivated;

function resultToMergeActivated()
{
    this.pendingAddMatches = [];
    
    this.FuncResult_activated();
    
    if(this.sourceIndexer === undefined) {
        
        // not yet activated by the call above
        
        // refresh the indexer and path to complete activation and registration
        // of mappings to the merge indexer
        this.refreshIndexerAndPaths();
    }

    // push pending matches to the indexer

    for(var i = 0, l = this.pendingAddMatches.length ; i < l ; ++i) {
        var update = this.pendingAddMatches[i];
        // pending matches which were added without a projection ID
        // must have been added by 'addMatches' (=> a single projection)
        this.targetIndexer.addProjMatches(update.elementIds, this.getId(),
                                          update.projId === undefined ?
                                          this.projId : update.projId);
    }

    this.pendingAddMatches = undefined;
}

// This function is called by the target indexer when the target path
// of this resultToMerge object becomes active (and therefore this 
// result object becomes active).

ResultToMerge.prototype.pathDeactivated = 
    resultToMergePathDeactivated;

function resultToMergePathDeactivated(pathId)
{
    this.deactivated();
}

// This function is called when this function result node is deactivated.
// It first calls the base class (FuncResult) deactivation function
// which removes this function result as an active composed function of its
// data object (if any). Next, it removes the source indexer and the
// mappings registered to the merge indexer.

ResultToMerge.prototype.deactivated = resultToMergeDeactivated;

function resultToMergeDeactivated()
{
    this.FuncResult_deactivated();
    
    if(this.sourceIndexer === undefined)
        return; // not previously active or already deactivated

    this.sourceIndexer = undefined;
    this.removeMapping(); // removes all mapping registrations
    
    // refresh the indexer and path to complete activation and registration
    // of mappings to the merge indexer
    this.refreshIndexerAndPaths();
}


