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

// This object simulates the interface of a non-indexed query calculation 
// node in order to allow the merge indexer to receive updates from 
// the source indexer when key values change and possibly (depending on
// the path) also when nodes are added or removed.
//
// This query calculation node is created for maximal mapping groups 
// (as defined in mergeIndexer.js). One query calculation node is created
// for the maximal source path of the group and one for each extension
// source path. Such a query calculation node is created only if the 
// corresponding target path has path tracing turned on (in case the
// maximal group has multiple explicit target paths, a query calculation
// node is created iff the element (shortest) target path has path
// tracing turned on, as this determines whether the nodes have to be
// merged into the target indexer).
//
// Each query calculation node stores both its source path node and its
// target path node. In case of the maximal source path, the corresponding
// target path is the value (longest) target path (as this is where the
// key values need to be mapped to).
//
// When registered to the maximal source path of the group, the query
// calculation node is only required to provide key value updates
// and there is no need for it to provide updates of nodes added or removed.
// This is because the mappings in the group are responsible for adding
// and removing the nodes being mapped.
//
// Therefore, in this case, the query calculation node registers itself
// to the source indexer as a selection query with an empty selection
// (this.isSelection() returns true but the query calculation node
// does not register any selection values). As a result, the query calculation
// node does not receive updates when node are added or removed, but
// it does receive updates when key values change.  
//
// When registering on an extension source node, the query calculation node
// must also provide the target indexer with updates when nodes are
// added or removed from the source path. Therefore, in this case, 
// the query calculation node registers itself as a projection to the
// source indexer.
//
// Object Structure
// ----------------
// {
//     id: <ID of this query calculation node>,
//
//     sourceIndexer: <InternalQCMIndexer>,
//     targetIndexer: <MergeIndexer>,
//
//     groupId: <path partition group ID>, 
//     sourceIdentificationId: <identification ID>
//     pathId: <path ID in source indexer>,
//     sourcePathId: <same as 'pathId'>
//     targetPathNode: <path node in the target indexer>,
//     isExtension: true|false
//
//     doNotIndex: true,        // constant value
//
//     matchPoints: <Map>{
//         <path ID>: true,
//         .......
//     },
//     lowestMatchPoint: <path ID>
// }
//
// id: this is the ID of this node, as a query calculation node. It is
//    allocated using InternalQCM.newId() to ensure it does not clash with
//    the IDs assigned to other query calculation nodes.
// sourceIndexer: this is the indexer to which this node will be registered
//    as a query calculation node.
// targetIndexer: this is the merge indexer which owns this node and
//    to which it delivers updates.
// groupId: this is the mapping group for which this node was created.
// sourceIdentificationId: the source identification used by the group
//    for which this node was created. This allows this object to 
//    register for identity updates from the source indexer (the 
//    registrations and de-registrations take place through this object
//    but the notifications go directly to the target indexer).
// pathId: this is the path ID in the source indexer to which this object
//    is registered as a query calculation node. This is required to
//    be stored under 'pathId' and this path ID should be allocated by
//    this object upon construction and released upon destruction.
// sourcePathId: this is the same as 'pathId', the ID of the path in the
//    source indexer to which this query calculation object is registered.
//    While 'pathId' is required by the interface of the source indexer,
//    'sourcePathId' is required by the interface to the target indexer. 
// targetPathNode: this is the path node in the merge indexer for which this
//    query calculation node was created. If this node is registered
//    to an extension source path of the group, this is the corresponding
//    extension target path and if this node is registered to the maximal
//    source path of the group then this is the value (longest) maximal
//    target path of the group.
// isExtension: this is true if the query calculation node is registered
//    to an extension source path of the group and is false if 
//    the query calculation node is registered to an explicit source path
//    (here, always the maximal explicit source path)
//
// doNotIndex: this is always set to true, to ensure that the path node
//    in the source indexer to which this query calculation node is registered
//    does not turn indexing on on account of this query calculation node
//    (whether it emulates a projection or a selection).
// matchPoints: this is a list of path IDs (in the source indexer) which are
//    equal to pathId or are prefixes of it and on which data elements 
//    are defined. This list is maintained by calls to the appropriate
//    handlers by the source indexer (this is part of the query calculation
//    node interface).
// lowestMatchPoint: this is the largest path ID (longest path, lowest point)
//    appearing in the 'matchPoints' table. This can be used to optimize
//    various processes in the target indexer.

/////////////////
// Constructor //
/////////////////

// The constructor takes as its first two arguments the target indexer
// and source indexer which it is used to transfer nodes
// between. 'targetPathNode' is the path node in the target indexer for which
// this query calculation node was created. 'pathId' is the path in the
// source indexer to which it should be attached (this is the source path
// being mapped by this query calculation node). 'groupId' is the ID
// of the mapping group for which this query calculation node was created.
// 'sourceIdentificationId' is the ID of the identification used by the
// group for the source nodes mapped by it. This is needed here to 
// allow registration for updates on identity updates in the source
// indexer. 'isExtension' indicates whether the given source and target paths
// are extension or explicit target and source paths for this group.
// 'needKeyUpdates' indicates whether this object should register for
// receiving key update (which are then forwarded to the merge indexer).
// Identity groups, for example, do not require key updates, because they
// register for identity updates.
//
// In addition to storing the information provided by the arguments on 
// the object, the constructor also registers this query calculation node
// to the source indexer, either as a selection (with an empty selection)
// or as a projection, depending on the value of 'isExtension', as explained
// in the introduction.

function MappingQueryCalc(targetIndexer, sourceIndexer, targetPathNode, 
                          pathId, groupId, sourceIdentificationId, isExtension,
                          needKeyUpdates)
{
    this.id = InternalQCM.newId();
    this.doNotIndex = true;

    this.sourceIndexer = sourceIndexer;
    this.targetIndexer = targetIndexer;

    // allocate the path ID (the query calculation node is required to 
    // allocate it, as the calling function may release this path ID)
    this.sourceIndexer.qcm.allocatePathIdByPathId(pathId);

    this.pathId = pathId;
    this.sourcePathId = pathId;
    this.groupId = groupId;
    this.sourceIdentificationId = sourceIdentificationId;
    this.targetPathNode = targetPathNode; 

    this.isExtension = isExtension;

    // attach to the source indexer

	// sets the query calculation node on the indexer
	this.sourceIndexer.addQueryCalcToPathNode(this);
    if(needKeyUpdates)
        this.sourceIndexer.needKeyUpdateForQuery(this);

    this.sourceIndexer.addTracingIdentification(this.pathId,
                                                this.targetIndexer,
                                                this.sourceIdentificationId,
                                                this.isExtension);
}

// Returns true if data node tracing is active and false otherwise.
// Data node tracing is turned on iff the path in the source indexer
// on which this query calculation node is registered (this.pathId)
// is not equal (must be an extension of) the maximal source path of the
// mappings in the group for which this query calculation node was
// created.

MappingQueryCalc.prototype.isExtensionPath = 
    mappingQueryCalcIsExplicitPath;

function mappingQueryCalcIsExplicitPath()
{
    return this.isExtension;
}

// Destroy function for this query calcualtion node. This de-registers
// the query calculation node from the source indexer. 

MappingQueryCalc.prototype.destroy = mappingQueryCalcDestroy;

function mappingQueryCalcDestroy() 
{
    // unregister for identification updates from the source indexer
    this.sourceIndexer.removeTracingIdentification(this.pathId,
                                                   this.targetIndexer,
                                                   this.sourceIdentificationId,
                                                   this.isExtension);

    // unregister from the input indexer
    this.sourceIndexer.removeQueryCalcFromPathNode(this);
    // release the path ID
    this.targetIndexer.qcm.releasePathId(this.pathId);
}

// Return the ID of this query calculation node

MappingQueryCalc.prototype.getId = mappingQueryCalcGetId;

function mappingQueryCalcGetId() 
{
    return this.id;
}

// Get the path ID of the source path to which this mapping query calculation
// node is registered.

MappingQueryCalc.prototype.getSourcePathId = mappingQueryCalcGetSourcePathId;

function mappingQueryCalcGetSourcePathId() 
{
    return this.pathId;
}

// Does this query calculation node represent a selection? If updates
// for nodes added and removed from the source path node are required, this
// should not be a selection (that is, return false). As explained in the
// introduction to this file, updates for nodes added and removed are
// needed iff the target and source paths are not explicit target/source
// paths (that is, extension paths). Therefore, the isSelection() property
// is the negation of the isExtension property.

MappingQueryCalc.prototype.isSelection = 
    mappingQueryCalcIsSelection;

function mappingQueryCalcIsSelection() 
{
    return !this.isExtension;
}

/////////////
// Updates //
/////////////

// This function is called by the source indexer with a list (array) of data 
// element IDs representing node added to the source path node. If this
// query calculation node was created for an extension source/target path,
// this update is passed on to the target indexer.
// Note that the matches added here contain also nodes which should
// not be mapped to the target indexer because the dominating node was
// not mapped by the mappings of the group. It is up to the target indexer
// to filter the nodes it actully needs to map.

MappingQueryCalc.prototype.addMatches = mappingQueryCalcAddMatches;

function mappingQueryCalcAddMatches(matches) 
{
    if(this.isExtension)
        this.targetIndexer.addExtensionMatches(matches, this);
}

// This function is called by the source indexer with a list (array) of data 
// element IDs representing node removed from the source path node. If this
// query calculation node was created for an extension source/target path,
// this update is passed on to the target indexer.
// Note that the matches removed here contain also nodes which were
// not be mapped to the target indexer because the dominating node was
// not mapped by the mappings of the group. It is up to the target indexer
// to filter the nodes it actully needs to remove.

MappingQueryCalc.prototype.removeMatches = 
    mappingQueryCalcRemoveMatches;

function mappingQueryCalcRemoveMatches(matches) 
{
    if(this.isExtension)
        this.targetIndexer.removeExtensionMatches(matches, this);
}

// This function may be called by the indexer to which this query calculation
// node is registered to notify it that all matches need to be removed
// (this happens when the path node to which this query calculation node is
// registered is about to be cleared). When this function is called,
// the matches are still stored on the path node, so it is possible to
// retrieve them from the indexer.
// This function only needs to do something if it updated the target indexer
// with matches (and not only with key changes). This is iff this node was
// created for an extension path.

MappingQueryCalc.prototype.removeAllIndexerMatches = 
    mappingQueryCalcRemoveAllIndexerMatches;

function mappingQueryCalcRemoveAllIndexerMatches()
{
    if(!this.isExtension)
        return;

    this.removeMatches(this.sourceIndexer.getAllMatches(this.pathId));
}

// This function is called by the source indexer with key updates for
// the path node on which this query calculation node is registered.
// The update consists of five arrays: 'elementIds', 'types', 'keys',
// 'prevTypes' and 'prevKeys'.
// Position i in all arrays consists of the i'th update. 
// For more information, see InternalQCMIndexer.setKeysOnNodes().
// This function calls the target indexer's 'updateKeys' function 
// which actually does the work of converting these updates into
// updates of the target indexer.
// These updates may include updates for nodes which were not mapped
// to the target indexer. 

MappingQueryCalc.prototype.updateKeys = 
    mappingQueryCalcUpdateKeys;

function mappingQueryCalcUpdateKeys(elementIds, types, keys, prevTypes,
                                    prevKeys)
{
    this.targetIndexer.updateKeys(this, elementIds, types, keys, prevTypes,
                                  prevKeys);
}

//////////////////
// Match Points //
//////////////////

// This function is called upon registration of this query calculation node
// to the source indexer to set the initial list of match points for this
// query calculation node. 'matchPoints' is an array of path IDs (in the
// source indexer) in decreasing order of path ID.

MappingQueryCalc.prototype.setMatchPoints = 
    mappingQueryCalcSetMatchPoints;
function mappingQueryCalcSetMatchPoints(matchPoints) 
{
    this.matchPoints = new Map();

    for(var i = 0, l = matchPoints.length ; i < l ; ++i)
        this.matchPoints.set(matchPoints[i], true);

    // the lowest match point is the first in the list
    this.lowestMatchPoint = matchPoints[0];
}

// This function is called to add the given path ID to the list of match
// points. In addition to adding this path ID to the 'matchPoints' table,
// this function also checks whether this path ID has become the new
// lowest match point (the one with the largest path ID). 

MappingQueryCalc.prototype.addToMatchPoints = 
    mappingQueryCalcAddToMatchPoints;

function mappingQueryCalcAddToMatchPoints(pathId) 
{
    this.matchPoints.set(pathId, true);
    
    if(pathId > this.lowestMatchPoint)
        this.lowestMatchPoint = pathId;
}

// This function is called to remove the given path ID from the list of match
// points. In addition to removing this path ID from the 'matchPoints' table,
// this function also checks whether this requires the lowest match point
// (the one with the largest path ID) to be recalculated.

MappingQueryCalc.prototype.removeFromMatchPoints =
    mappingQueryCalcRemoveFromMatchPoints;

function mappingQueryCalcRemoveFromMatchPoints(pathId) 
{
    this.matchPoints.delete(pathId);

    if(this.lowestMatchPoint == pathId) {
        // search for the new lowest match point
        this.lowestMatchPoint = 0;
        var _self = this;
        this.matchPoints.forEach(function(t, pathId) {
            if(pathId > _self.lowestMatchPoint)
                _self.lowestMatchPoint = pathId;
        });
    }
}

/////////////////////////////////
// Content Module Dependencies //
/////////////////////////////////

// Given the root of the content module of the path node to which this
// query calculation node is registered, this function registers a
// synthetic dependency of the owner path node content module (in the
// target indexer) on the root node. This ensures that when the owner
// path node is active, so is the path node to which it is registered.
// This function is called by the source indexer when the query calculation
// node is registered to it.

MappingQueryCalc.prototype.addPathNodeDependencies = 
	mappingQueryCalcAddPathNodeDependencies;

function mappingQueryCalcAddPathNodeDependencies(pathNodeRoot)
{
    this.targetPathNode.cm.register(["mappingQueryCalc", this.id],
                                    pathNodeRoot, "synthetic");
}

// Since it is not clear here which refresh is the cause of this
// removal, it is also not possible to queue it. Therefore, this
// function performs the removal of the dependency immediately.

MappingQueryCalc.prototype.queueRemovalOfPathNodeDependency =
    mappingQueryCalcQueueRemovalOfPathNodeDependency;

function mappingQueryCalcQueueRemovalOfPathNodeDependency() 
{
    this.targetPathNode.cm.unregister(["mappingQueryCalc", this.id]);
}
