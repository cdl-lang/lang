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


// This file implements the class whose object represents each group of
// mappings registered to a merge indexer. In addition to storing the
// description of the group, this object may also provide common
// services associated with the group, such as access to the source
// nodes of each group, etc.

// Each object holds the information required to perform the mapping 
//    defined by the mappings in the group for the source and target 
//    paths of the group. Most merging functions below only need
//    to make use of the information in these gorup entries to properly 
//    perform the merge.
//
// Object Structure:
//
// {
//     targetIndexer: <MergeIndexer>
//     qcm: <InternalQCM>
//     groupId: <group ID>,
//     description: <group description string>,
//     priority: <number>,
//     prefixGroup: <MergeGroup>,
//     isMaxGroup: true|false,
//     isIdentityGroup: true|false,
//     nextGroups: <array of MergeGroup objects which have this group as prefix>
//     groupSequence: <array of group entries in this table>
//
//     sourceIdentificationId: undefined|<number>
//     targetIdentificationId: undefined|<number>
//
//     mappings: <Map>{
//        <function result ID>: {
//            funcResult: <function result object>,
//            projections: <Map>{
//                <proj ID>: true
//                ......
//            }
//        }
//        ......
//     },
//     projNum: <number>
//
//     sourceIndexer: <source indexer>,
//     sourcePathId: <source path ID of this mapping>,
//     sourceNodes: <SourceNodes or
//                   IdentitySourceNodes or
//                   DominatedIdentitySourceNodes>
//
//     targetPathNode: <target path node of this mapping>
//
//     obligatoryDataElements: true|false
//
//     sourceDataElements: undefined | <MappedDataElements>
//
//     subTreeMonitors: {
//        <target path ID>: <MappingMonitor object>,
//        .....
//     }
//
//     sourcePathMapping: {
//        <source path ID>: <target path ID>,
//        ......
//     }
// }
//
// targetIndexer: the Merge indexer which owns this group entry and
//     which is the target of the mapping represented by this group.
// qcm: this is the InternalQCM object responsible for the various
//     global services for the queries used here. This is the same QCM
//     as the one stored in 'targetIndexer' and is stored here only for
//     ease of access. 
// groupId: the ID of this group.
// description: the string describing this group. This string is generated
//     (see below) based on teh various properties of a mapping. Two
//     mappings mapping to the same target indexer and having the same
//     dexcription string, belong to the same group.
// priority: the priority of the mappings in this group (must be
//     the same for all mappings in the same group, by definition).
// prefixGroup: if the mappings in this group have a source path
//     shorter than the source path of this group, this is the MergeGroup
//     object of the group which maps the previous (prefix) source path
//     of these mappings.
// isMaxGroup: true if this group's source path is the maximal
//     source path of the mappings in the group (false otherwise).
// isIdentityGroup: true iff this is an identity group. An identity
//     group is always a minimal group and has the same source path
//     as the next group in the group sequence. It is never a
//     maximal group.
// nextGroups: this is an array which stores the 'next groups' for
//     this group. For non-maximal groups, it lists the groups which 
//     have this group as their prefix group. Since this list 
//     is probably short and not updated often (but may be used much 
//     more often) we store it as an array and perform removal by 
//     linear search (addition is by pushing, since only new groups 
//     are added here). For a maximal group, this is undefined.
// groupSequence: this appears only on  maximal groups (those
//     with 'isMaxGroup' true). On the maximal groups, this array
//     holds the sequence of groups which the mappings in the
//     maximal group belong to, that is, the prefix group of the maximal
//     group, the prefix group of that group etc. until a group is
//     reached which has no prefix group. The array holds the entries 
//     for these groups stored in this ('groupById') table. The groups
//     are ordered by decreasing source path ID (that is, the first 
//     entry is of the maximal group and each subsequent entry is
//     of the prefix group of the entry before it). The entries
//     in the 'mappings' table point at this array.
//
// sourceIdentificationId: this is optional. If defined, this is the
//     ID of the identification function used to assign additional
//     identities to the source nodes of this group (not every source
//     node needs to be assigned an identity by this identification
//     function - if no identity is assigned, the base identity is used).
//     The identities are stored in the 'additionalIdentities' table
//     of the source indexer (under the identification ID stored here).
//     A group and its prefix group must have the same source 
//     identification ID (including the the case of 'undefined'). This
//     is ensured by the inclusion of the source identification ID
//     in the group description.
// targetIdentificationId: this is optional. If defined, this is the
//     ID of the identification function used to assign additional
//     identities to target nodes when this group merges nodes
//     under them (not every target node needs to be assigned 
//     an identity by this identification function - if no identity 
//     is assigned, the base identity is used).
//     The identities are stored in the 'additionalIdentities' table
//     of this indexer (under the identification ID stored here).
//     A group and its prefix group must have the same target 
//     identification ID (including the the case of 'undefined'). This
//     is ensured by the inclusion of the target identification ID
//     in the group description.
//
// mappings: this table holds the mappings which belong to this group.
//     Each mapping is stored here by the entry under the function 
//     result ID and projection ID of the mapping.
//
// projNum: number of projections stored in the 'mappings' table. This is
//     the total number of all projections under all result IDs stored
//     in the 'mappings' table.
//
// sourceIndexer: the source indexer of the mappings in this group.
// sourcePathId: the source path ID being mapped by this group.
// sourceNodes: This is a SourceNodes object (on maximal groups) or
//     NonMaxSourceNodes object (on non-maximal groups) which stores 
//     information about the source nodes merged by this group which 
//     only depends on the source data and the mappings and not on 
//     the merging at the target indexer.
//     This table is required in order to keep track of two things:
//     1. Source nodes S mapped as a result of another source node 
//        (dominated by this node S) being added in the match list 
//        of an 'addProjMatches()' call of a mapping in this group.
//        In this case we need to keep track of the nodes actually added
//        by the 'addProjMatches()' call which resulted in mapping
//        the node S.
//        This always happens when the group is not maximal and sometimes
//        when the group is maximal, if operand nodes are mapped 
//        (resulting in the mapping of the operator node as well).
//     2. The number of times a node was mapped by this group. This is
//        needed in cases where multiple mappings belong to the group
//        or in cases where the node is mapped as the result of 
//        the mapping of multiple dominated nodes.
//     Because it is difficult to predict when these situations will 
//     arise (especially in the case of operators) this table is
//     always created, and in the simplest case (a maximal group
//     containing a single mapping and not mapping any operands)
//     it is simply a list of the node mapped by this group.
//     For more details, see sourceNodes.js
//
// targetPathNode: this is the path node in the merge indexer which 
//     is the target path of this group.
//
// obligatoryDataElements: if this is true, all nodes mapped by this
//     group must be mapped to data elements at the target path.
//     This is turned on when there are multiple groups with the same
//     priority and the same prefix group (possible both having no
//     prefix group) mapping to the target path of this group.
 
// sourceDataElements: this is a table recording those source data elements
//     which were mapped by this group to a data element in the target
//     indexer with a data element ID which is different from the 
//     source data element ID. For the structure of this table, see the
//     documentation of MappedDataElements. Every source data node
//     mapped to a target data node whose target ID differs from the 
//     source ID is stored here.
//     Note that the data element ID to which a source node is mapped
//     by this group does not necessarily belong to a data element 
//     mapped by this group. 
//
// subTreeMonitors: this table stores the mapping monitors created for
//     mapped and unmapped nodes merged by this group whose source 
//     needs to be monitored (for mapped nodes this is because the mapped
//     node is in a monitored sub-tree and for an unmapped node this 
//     is because there is a non-terminal at the same path and with the
//     same dominating node and identity as the unmapped node which is
//     in a monitored sub-tree). These mapping monitors are only created
//     at maximal groups. For such groups, a separate mapping monitor
//     is created for each target path (the explicit path and the 
//     extension paths). For this reason, the monitors are stored under
//     the target path ID. Each such monitor handles the monitoring 
//     of all source nodes at the corresponding source path. 
// sourcePathMapping: this file maps source path IDs to the corresponding
//     target path IDs for this group. This is used only with maximal
//     groups which registered mapping monitors to the source indexer.
//     When notifications are received from a mapping monitor, the
//     notification specifies the source path of the modification.
//     This table allows the translation to the target path to be cached.
//     The entries in this table are only cleared when the target
//     path node is destroyed.
//     to do: clear this table from the path node destroy function xxxxxxx
//     in addition: source paths added to this table should be allocated
//     before being added, so that they will not expire before they are
//     removed from thid table. xxxxxxxxxxxxxx

// %%include%%: "sourceNodes.js"
// %%include%%: "mappedDataElements.js"
// %%include%%: <scripts/utils/arrayUtils.js>
// %%include%%: "compResult.js"

//
// Constructor
//

// The constructor takes a set of arguments which uniquely describe the
// group to be constructed. These arguments are first stored on the
// object. Then, a sequence of initialization steps follow, including
// registration to other objects (e.g. the source and target indexers
// and the prefix group). This also checks some additional properties
// such as whether there are additional groups on the sam target path
// with the same priority (to set the 'obligatoryDataElements'
// property on this and those other groups).

function MergeGroup(targetIndexer, desc, sourceIndexer, prefixGroupEntry, 
                    isMaximal, isIdentity, sourcePathId, targetPathId,
                    priority, sourceIdentificationId, targetIdentificationId)
{
    this.targetIndexer = targetIndexer;
    this.qcm = this.targetIndexer.qcm;
    this.groupId = MergeGroup.nextGroupId++;
    this.description = desc;
    this.priority = priority;
    this.prefixGroup = prefixGroupEntry;
    this.isMaxGroup = isMaximal;
    this.isIdentityGroup = isIdentity;
    this.nextGroups = isMaximal ? undefined : [];
    this.groupSequence = undefined; // may be set later
    this.sourceIdentificationId = sourceIdentificationId;
    this.targetIdentificationId = targetIdentificationId;
    this.mappings = new Map();
    this.projNum = 0;
    this.sourceIndexer = sourceIndexer;
    this.sourcePathId = sourcePathId;
    
    this.sourceNodes = undefined; // will be set later
    this.targetPathNode = targetIndexer.addPath(targetPathId);
    this.obligatoryDataElements = false; // initial value may change later

    // perform various initializations and registrations
    this.initGroup();
}

// allocation of group IDs
MergeGroup.nextGroupId = 1025;

// This function creates the string which describes the group to which
// the mapping from the given source path ot the given target path
// belongs to given the properties of the mapping, as given by the 
// arguments. 'sourceIndexer' is the source indexer of the mapping,
// 'priority' is the priority of the mapping, 'isMaximal' indicates whether
// the given paths are the maximal source/target paths of the mapping,
// 'isIdentity' indicates whether this is an identity group
// and sourceIdentificationId and targetIdentificationId are the 
// IDs determining the source and target identification of the mapping
// (either or both may be undefined). 'prefixGroup' is the MergeGroup object 
// for the group of the previous (prefix) source and target path pair of
// this mapping (if exists, otherwise, this is undefined).
// This function then creates a string uniquely representing these
// properties, as explained in the introduction of mergeIndexer.js
// ('Mapping Groups'). 

MergeGroup.makeGroupDesc = mergeGroupMakeGroupDesc;

function mergeGroupMakeGroupDesc(sourceIndexer, prefixGroup, 
                                 isMaximal, isIdentity, sourcePathId,
                                 targetPathId, priority,
                                 sourceIdentificationId,
                                 targetIdentificationId)
{
    var desc = (sourcePathId + (isIdentity ? "id" : "") + ":" + targetPathId +
                ":" + (isMaximal ? "t" : "f"));

    if(!prefixGroup) { // minimal source/target path
        desc += ":" + sourceIndexer.id + ":" + priority + ":" + 
            (sourceIdentificationId === undefined ? 
             "" : sourceIdentificationId)+ ":" + 
            (targetIdentificationId === undefined ?
             "" : targetIdentificationId);
    } else
        desc += ":" + prefixGroup.groupId;

    return desc;
}

// This function is called after all properties were set on this object
// (in the constructor). This function then performs a set of initializations
// and registrations to other objects (such as the target and source indexers)
// required for the proper initialization of the group.

MergeGroup.prototype.initGroup = mergeGroupInitGroup;

function mergeGroupInitGroup()
{
    // if additional identifications used, register a request for these
    // identities on the relevant indexer
    if(this.sourceIdentificationId !== undefined)
        this.sourceIndexer.requestIdentification(this.sourceIdentificationId);
    if(this.targetIdentificationId !== undefined)
        this.targetIndexer.requestIdentification(this.targetIdentificationId);
    
    // set the group sequence if this is the maximal group
    if(this.isMaxGroup) {
        var group = this;
        this.groupSequence = [group];
        while(group.prefixGroup !== undefined) {
            group = group.prefixGroup;
            this.groupSequence.push(group);
        }
    }
    
    // set the source node table for this group
    if(this.isIdentityGroup) {
        if(!this.isDominated()) {
            this.sourceNodes =
                new IdentitySourceNodes(this.sourceIndexer,
                                        this.sourceIdentificationId);
        } else {
            this.sourceNodes =
                new DominatedIdentitySourceNodes(this.sourceIndexer,
                                                 this.sourceIdentificationId,
                                                 this.sourcePathId);
        }
    } else
        this.sourceNodes = new SourceNodes();

    if(this.prefixGroup !== undefined)
        this.prefixGroup.nextGroups.push(this);

    // add the group to the mappingGroups table of the target path.
    this.addMappingGroupToPath(this.targetPathNode, true);

    // check for other groups with same target path and prefix group
    // (possibly undefined) and same priority to set the
    // obligatoryDataElements property (does not apply to identity groups)
    if(!this.isIdentityGroup && this.targetPathNode.mappingGroups) {
        // loop over all other groups which have this path as a target path
        var _self = this;
        this.targetPathNode.mappingGroups.forEach(function(entry, otherGroupId){
            if(otherGroupId == _self.groupId)
                return; // skip the group added just now
            var otherGroup = _self.targetIndexer.groupById[otherGroupId];
            if(otherGroup.isIdentityGroup)
                return; // does not apply to identity groups
            if(otherGroup.prefixGroup == _self.prefixGroup &&
               otherGroup.priority == _self.priority) {
                otherGroup.obligatoryDataElements = true;
                _self.obligatoryDataElements = true;
            }
        });
    }

    if(this.isMaxGroup && !this.isIdentityGroup)
        // register mapping query calculation nodes on child paths which
        // have tracing set on them (this continues recursively).
        this.addGroupToTracingExtensionChildPaths(this.targetPathNode);

    // register group by source identification
    if(this.isIdentityGroup)
        this.targetIndexer.addIdentityGroupByIdentification(this);
    else
        this.targetIndexer.addGroupToGroupBySourceIdentification(this);
}

// // This function destroys this group. It is assumed that this is called
// when there are no more mappings in this group. It is also assumed that
// all target nodes created for this group were already removed.
// In destroying the group, this function removes all the
// registrations which were made in the initialization function.
// For example, it removes (and de-registers from the source indexer) all
// mapping query calculation nodes created for this group. If needed,
// this function also updates the 'obligatoryDataElements' property of other
// groups at the same element target path and the same priority.

MergeGroup.prototype.destroy = mergeGroupDestroy;

function mergeGroupDestroy()
{
    if(this.isMaxGroup && !this.isIdentityGroup)
        // remove group from extension target paths
        this.removeGroupFromExtensionChildPaths(this.targetPathNode);

    // remove group from the explicit target path of this group
    this.removeMappingGroupFromPath(this.targetPathNode);
    
    if(this.obligatoryDataElements) {
        // check whether after the removal of this group there remains
        // only one group with the same priority as the removed group,
        // in which case its 'obligatoryDataElements' property can be 
        // set to 'false'.
        var singleOtherGroup;
        // loop over all other groups which have this path as a target path
        // (this group was already removed from this list above)
        var _self = this;
        this.targetPathNode.mappingGroups.forEach(function(entry,otherGroupId){ 
            var otherGroup = _self.targetIndexer.groupById[otherGroupId];
            if(otherGroup.isIdentityGroup)
                return; // does not apply to identity groups
            if(otherGroup.prefixGroup == _self.prefixGroup &&
               otherGroup.priority == _self.priority) {
                if(singleOtherGroup !== undefined) {
                    // already the second such group
                    singleOtherGroup = false;
                } else
                    singleOtherGroup = otherGroup;
            }
        });
        if(singleOtherGroup)
            singleOtherGroup.obligatoryDataElements = false;
    }

    // if there is a prefix group, remove this group from its list of
    // 'next groups' (the list is short, so we use linear search).
    if(this.prefixGroup) {
        for(var i = 0, l = this.prefixGroup.nextGroups.length ; i < l ; ++i) {
            if(this.prefixGroup.nextGroups[i] == this) {
                this.prefixGroup.nextGroups.splice(i,1);
                break;
            }
        }
    }

    if(this.isIdentityGroup)
        this.targetIndexer.removeIdentityGroupByIdentification(this);
    else
        this.targetIndexer.removeGroupFromGroupBySourceIdentification(this);
    
    // if additional identifications used, release them (indicate to the
    // relevant indexer that the identities are no longer needed).
    if(this.sourceIdentificationId !== undefined)
        this.sourceIndexer.releaseIdentification(
            this.sourceIdentificationId);
    if(this.targetIdentificationId !== undefined)
        this.targetIndexer.releaseIdentification(this.targetIdentificationId);
}

// This function changes the source (indexer, identification and source path)
// of this group. When this function is called, the group object still carries
// the old source. 'sourcePathId' the new source path, 'sourceIndexer'
// the new source indexer and 'sourceIdentificationId' the new source
// identification.
// This function updates the group entry and re-registers object belonging
// to the group which are registered to the source indexer or are registered
// for notifications on source identities.
// It is assumed that this function is called in cases where the change
// in the source does not actually change the data mapped (or its
// identities), for example, when a result indexer is inserted in a
// query chain. Therefore, while the registrations to the source need
// to be updated, the mapped data stored does not need to be refreshed.

MergeGroup.prototype.changeGroupSource = mergeGroupChangeGroupSource;

function mergeGroupChangeGroupSource(sourcePathId, sourceIndexer,
                                     sourceIdentificationId)
{
    this.description =
        MergeGroup.makeGroupDesc(sourceIndexer, this.prefixGroup,
                                 this.isMaxGroup, this.isIdentityGroup,
                                 sourcePathId, this.targetPathNode.pathId,
                                 this.priority, sourceIdentificationId, 
                                 this.targetIdentificationId);

    // if needed, replace the source identification
    var sourceIdentificationChanged =
        (this.sourceIndexer != sourceIndexer ||
         this.sourceIdentificationId != sourceIdentificationId);

    if(sourceIdentificationChanged) {

        if(this.isIdentityGroup)
            this.targetIndexer.removeIdentityGroupByIdentification(this);
        else
            this.targetIndexer.removeGroupFromGroupBySourceIdentification(this);
        
        this.targetIndexer.
            changeUnmappedByIdentification(this, this.sourceIdentificationId,
                                           sourceIdentificationId);
        
        if(this.sourceIdentificationId !== undefined) {
            this.sourceIndexer.
                releaseIdentification(this.sourceIdentificationId);
        }
        this.sourceIdentificationId = sourceIdentificationId;
        if(sourceIdentificationId !== undefined)
            sourceIndexer.requestIdentification(sourceIdentificationId);
        // change the identification in the 'sourceNodes' object if it stores
        // such an identification
        if(this.sourceNodes.replaceSourceIdentification !== undefined) {
            this.sourceNodes.
                replaceSourceIdentification(sourceIndexer,
                                            sourceIdentificationId);
        }
    }

    // change the source properties of the group
    this.sourceIndexer = sourceIndexer;
    this.sourcePathId = sourcePathId;

    if(sourceIdentificationChanged) { // register under the new identification
        if(this.isIdentityGroup)
            this.targetIndexer.addIdentityGroupByIdentification(this);
        else
            this.targetIndexer.addGroupToGroupBySourceIdentification(this);
    }
    
    // any mapping query calculation nodes registered for this group must
    // be transferred from the old source to the new source (this is only
    // needed on maximal groups).
    if(this.isMaxGroup)
        this.replaceMappingQueryCalcSource(this.targetPathNode, sourcePathId,
                                           true);

    // MappingMonitor? xxxxxxxxxxxxxxxxxx
}

// This function returns an array of MergeGroup objects such that these
// are the maximal groups which have this group as a prefix (not necessarily
// a direct prefix). If this group is maximal, it returns an array containing
// itself.

MergeGroup.prototype.getMaxGroups = mergeGroupGetMaxGroups;

function mergeGroupGetMaxGroups()
{
    if(this.isMaxGroup)
        return [this];

    var maxGroups = [];
    
    for(var i = 0, l = this.nextGroups.length ; i < l ; ++i) {
        var group = this.nextGroups[i];
        if(group.isMaxGroup)
            maxGroups.push(group);
        else if(maxGroups.length == 0)
            maxGroups = group.getMaxGroups();
        else
            maxGroups = cconcat(maxGroups, group.getMaxGroups());
    }

    return maxGroups;
}

// This function is to be called on a group which only belongs to a single
// projection. The function returns an object:
// {
//     resultId: <result ID>,
//     projId: <projection ID>,
//     funcResult: <function result object>
// }
// which describes the single projection assigned to this group. If there
// is more than one such projection, undefined is returned.

MergeGroup.prototype.getSingleProj = mergeGroupGetSingleProj;

function mergeGroupGetSingleProj()
{
    if(this.projNum > 1)
        return undefined;

    var singleProj = {};

    // the double loop below performs only one iteration
    this.mappings.forEach(function(entry, resultId) {
        singleProj.resultId = resultId;
        singleProj.funcResult = entry.funcResult;
        entry.projections.forEach(function(t, projId) {
            singleProj.projId = projId;
        });
    });

    return singleProj;
}

// Returns true iff both the source path and the target path are not
// the root path. In this case, parent node identities are used to
// determine the dominating nodes under which to merge.

MergeGroup.prototype.isDominated = mergeGroupIsDominated;

function mergeGroupIsDominated()
{
    var rootId = this.qcm.getRootPathId();
    return this.sourcePathId != rootId && this.targetPathNode.pathId != rootId;
}

// Returns true if some prefix group of this group (not necessarily a
// direct prefix group) is an identity group. If this group itself is
// an identity group, this returns false.

MergeGroup.prototype.hasIdentityPrefixGroup = mergeGroupHasIdentityPrefixGroup;

function mergeGroupHasIdentityPrefixGroup()
{
    for(var prefixGroup = this.prefixGroup ; prefixGroup ;
        prefixGroup = prefixGroup.prefixGroup)
        if(prefixGroup.isIdentityGroup)
            return true;

    return false;
}

//////////////
// Mappings //
//////////////

// Add the given function result object and projection ID as a mapping
// which belongs to this group.
// If this is the second mapping to be added to this group (which is not
// an identity group), reference counting needs to be initialized in
// the SourceNodes table of this group (by fetching all matches of the
// already existing projection and adding them to the sourceNodes)

MergeGroup.prototype.addMapping = mergeGroupAddMapping;

function mergeGroupAddMapping(funcResult, projId)
{
    var resultId = funcResult.getId();

    var funcEntry;

    if(!this.isIdentityGroup && this.projNum == 1)
        // number of projections about to increase from 1 to 2, so need to
        // reference count all source IDs already mapped by the first projection
        // (if the existing projection already added its matches)
        this.refCountExistingProjMatches();
    
    if(this.mappings.has(resultId)) {
        funcEntry = this.mappings.get(resultId);
        if(funcEntry.projections.has(projId))
            return; // already added
    } else {
        funcEntry = {
            funcResult: funcResult,
            projections: new Map()
        };
        this.mappings.set(resultId, funcEntry);

        if(this.targetPathNode !== undefined &&
           this.targetPathNode.composedOrderStar !== undefined)
            // add existing composed order* on the from the target path. 
            this.targetPathNode.composedOrderStar.forEach(function(composedFunc,
                                                                   composedId) {
                funcResult.addOrderStarFunc(composedFunc);
            });
    }

    funcEntry.projections.set(projId, true);
    this.projNum++;
}

// Remove the given function result object and projection ID as a mapping
// which belongs to this group.
// If this removes the one but last projection, need to clear reference
// counting in the sourceNodes table of this group.
// This functon returns true if this remved the last mapping from this
// group and false otherwise.

MergeGroup.prototype.removeMapping = mergeGroupRemoveMapping;

function mergeGroupRemoveMapping(resultId, projId)
{
    var funcEntry = this.mappings.get(resultId);

    if(funcEntry === undefined)
        return;

    if(!funcEntry.projections.has(projId))
        return;

    this.projNum--;
    
    if(funcEntry.projections.size == 1) {
        this.mappings.delete(resultId); // last projection for this result
        if(this.targetPathNode !== undefined &&
           this.targetPathNode.composedOrderStar !== undefined)
            // remove composed order* 
            this.targetPathNode.composedOrderStar.forEach(function(composedFunc,
                                                                   composedId) {
                funcEntry.funcResult.removeOrderStarFunc(composedId);
            });
    } else
        funcEntry.projections.delete(projId);

    if(!this.isIdentityGroup && this.projNum == 1)
        // number of projections just to decreased from 2 to 1, so need to
        // remove reference counts of all source IDs mapped by the
        // remaining projection.
        this.clearRefCountOfRemainingProjMatches();

    return (this.mappings.size === 0);
}

/////////////////////////////////////
// Mapping Query Calculation Nodes //
/////////////////////////////////////

// This function adds an entry to the 'mappingGroups' table of the 
// given target path node for this group. 'isExplicit' is true if the path
// is an explicit target path (that is, not an extension path).
// If this group is not maximal, a simple entry is created for this 
// group, holding the value true.
// If this group is maximal, an entry holding the source path node and a
// flag 'isExtension' (the negation of 'isExplicit) is
// created. This can take one of two forms, depending on the path 
// tracing mode of the target path:
// 1. If path tracing is not active on the target path, an entry 
//    which only stores the source path node and the 'isExtension' property
//    is created:
//    {
//        sourcePathId: <source path ID>
//        isExtension: <true if this is an extension path for the group>
//    }
// 2. If path tracing is active on the target path, the entry holds
//    a MappingQueryCalc object which is registered to the source path
//    and provides updates from that path.
//    
// 'isExplicit' indicates whether the target path is an explicit target
// path (if 'isExplicit' is true) or an extension target path (if false).
// This is used in two ways:
// 1. Calculating the source path: if the target path is an explicit
//    target path, the source path is the source path of the group. If
//    the target path is an extension path, we need to calculate the
//    source path based on the source and target path of the
//    group.
// 2. If the target path is an explicit target path, the query calculation
//    node (if created) only needs to provide key updates, but no node
//    updates (as these are received directly from the mapping). It therefore
//    registers itself as a selection query calculation node without
//    any selection value. If, however, the target path is an extension path,
//    the query calculation node (if created) must also provide node 
//    updates (when data nodes are added or removed from the source path node).
//    It must therefore register itself as a projection to the source indexer.
// It is assumed here that the MergeGroup object is already initialized 
// when this function is called.
// If an entry already exists for this group on teh path node, the
// function checks whether there is need to update it. A group cannot
// change its source and target (or its maximality) so the only thing
// that may change is whether the target path node has path tracing or
// not. If this has changed, the entry is replaced.  The function
// returns the entry created.

MergeGroup.prototype.addMappingGroupToPath = 
    mergeGroupAddMappingGroupToPath;

function mergeGroupAddMappingGroupToPath(targetPathNode, isExplicit)
{
    var entry;

    if(!targetPathNode.mappingGroups)
        targetPathNode.mappingGroups = new Map();
    else
        entry = targetPathNode.mappingGroups.get(this.groupId);

    if(!entry) { // new group at this path

        var identificationId = this.targetIdentificationId;
        
        if(!this.prefixGroup && targetPathNode.parent &&
           targetPathNode == this.targetPathNode) {
            // minimal group explicit path with prefix path
            targetPathNode.parent.dominatedMinGroups++;
            if(targetPathNode.parent.nonTerminals === undefined)
                // initialize the non-terminal table of the parent path
                this.targetIndexer.initNonTerminals(targetPathNode);
            if(identificationId !== undefined) {
                targetPathNode.parent.nonTerminals.
                    addAdditionalIdentification(identificationId);
            }
        }

        if(this.priority > targetPathNode.maxGroupPriority)
            targetPathNode.maxGroupPriority = this.priority;
        
        if(this.priority < targetPathNode.minGroupPriority) {
            targetPathNode.minGroupPriority = this.priority;
            if(targetPathNode.minGroupPriority <
               targetPathNode.maxGroupPriority &&
               targetPathNode.nonTerminals === undefined)
                // initialize the non-terminal table of the path
                this.targetIndexer.initNonTerminals(targetPathNode);
        }

        if(identificationId !== undefined) {
            if(targetPathNode.nonTerminals !== undefined) {
                targetPathNode.nonTerminals.
                    addAdditionalIdentification(identificationId);
            }
            if(targetPathNode.dataElementOperators) {
                targetPathNode.dataElementOperators.
                    addAdditionalIdentification(identificationId);
            }
        }
        
        // register source identification (in case there are unmapped nodes)
        if(targetPathNode.unmappedNodes !== undefined &&
           targetPathNode.unmappedNodes.getNum() > 0) // has unmapped nodes
            this.addToUnmappedByIdentification(targetPathNode, this);

        // add composed order* from target path node
        this.addAllOrderStarFuncsFromPath(targetPathNode);
    }

    if(!this.isMaxGroup) {
        // here it does not matter whether an entry exists already or not
        targetPathNode.mappingGroups.set(this.groupId, true);
        return true;
    }

    var sourcePathId;

    if(entry) {
        if(targetPathNode.trace == (entry instanceof MappingQueryCalc))
            return entry; // no need to replace the entry
        else if(!targetPathNode.trace) {
            // replace the MappingQueryCalc with a simple object
            var sourcePathId = entry.sourcePathId;
            entry.destroy();
            entry = { 
                sourcePathId: sourcePathId,
                isExtension: !isExplicit
            };
            targetPathNode.mappingGroups.set(this.groupId, entry);
            return entry;
        }
        sourcePathId = entry.sourcePathId;
    }
    
    // calculate the source path ID.
    var groupTargetPathId;
    if(!sourcePathId) {
        if(isExplicit)
            // this is the value target path of the group, so the source path
            // is the source path of the group
            sourcePathId = this.sourcePathId;
        else { // non-explicit target path, that is, an extension path
            groupTargetPathId = this.targetPathNode.pathId;
            sourcePathId = this.qcm.
                allocateConcatPathId(this.sourcePathId,
                                     this.qcm.diffPathId(targetPathNode.pathId, 
                                                         groupTargetPathId));
        }
    }

    if(!targetPathNode.trace) {
        // in this case, we arrived here only if there is no existing entry
        entry = {
            sourcePathId: sourcePathId,
            isExtension: !isExplicit
        };
        targetPathNode.mappingGroups.set(this.groupId, entry);
        return entry;
    }

    // create a MappingQueryCalc object and register it to the source indexer
    entry =
        new MappingQueryCalc(this.targetIndexer, this.sourceIndexer,
                             targetPathNode, sourcePathId, this.groupId, 
                             this.sourceIdentificationId, !isExplicit,
                             !this.isIdentityGroup);
    targetPathNode.mappingGroups.set(this.groupId, entry);

    if(groupTargetPathId)
        this.qcm.releasePathId(sourcePathId);

    return entry;
}

// This function goes over the tracing child path nodes of the given path node.
// Unless a child path is explicitly marked as a 'nonExtensionPath', the
// function assumes that these path nodes are extension target paths for 
// the group, which must be a maximal non-identity
// group. The function then registers a mapping query calculation object 
// for this group on these child path nodes. The process continues
// recursively to the children of these path nodes. 

MergeGroup.prototype.addGroupToTracingExtensionChildPaths = 
    mergeGroupAddGroupToTracingExtensionChildPaths;

function mergeGroupAddGroupToTracingExtensionChildPaths(pathNode)
{
    if(!pathNode.numTracingChildren)
        return; // nothing to do, no tracing children

    for(var attr in pathNode.tracingChildren) {
        var childPathNode = pathNode.tracingChildren[attr];
        if(childPathNode.nonExtensionPath)
            continue;
        this.addMappingGroupToPath(childPathNode, false);

        // continue recursively to children of this path node
        this.addGroupToTracingExtensionChildPaths(childPathNode);
    }
}

// This function is called when an existing group has its source changed.
// The assumption is that the nodes at the new source are equivalent
// to the nodes at the old source, so there is only need to transfer
// registrations from the old source to the new source, but there is no
// need to update any data nodes.
// This function transfers the MappingQueryCalc nodes registered by the
// group from the old source to the new source. To do so, the function
// destroys the old MappingQueryCalc objects and creates new objects.
// It is assumed that when this function is called, the group already
// carries the new source information.
// This group must be a maximal group, otherwise the function has nothing
// to do. 'targetPathNode' is the target path to which this operation should
// apply. If 'isExplicit' is true, this is an explicit target path
// of the group (which means that this is the target path defined on the
// group itself). If 'isExplicit' is false, this is an extension target path,
// that is, a target path extending the maximal explicit target path.
// 'sourcePathId' is the source path which the group maps to 'targetPathNode'.
// The function checks whether the target path node has a MappingQueryCalc
// object for this group. If it doesn't there is nothing more to do
// (the target path is probably not being traced). If it does, the
// old MappingQueryCalc node is destroyed and a new node is created for the
// new source. The function then continues recursively to the traced
// child paths of the target path. These must be extension paths of the
// group.

MergeGroup.prototype.replaceMappingQueryCalcSource =
    mergeGroupReplaceMappingQueryCalcSource;

function mergeGroupReplaceMappingQueryCalcSource(targetPathNode,
                                                 sourcePathId,
                                                 isExplicit)
{
    if(!this.isMaxGroup)
        return;

    var queryCalc = targetPathNode.mappingGroups.get(this.groupId);

    if(queryCalc === undefined || !(queryCalc instanceof MappingQueryCalc))
        return; // nothing to change

    queryCalc.destroy(); // this also de-registers from the source indexer

    // create a new mapping query calculation node (this registers to indexer)
    targetPathNode.mappingGroups.
        set(this.groupId,
            new MappingQueryCalc(this.targetIndexer, this.sourceIndexer,
                                 targetPathNode, sourcePathId, this.groupId,
                                 this.sourceIdentificationId, !isExplicit,
                                 !this.isIdentityGroup));

    // continue recursively to traced children of the target path
    
    if(!targetPathNode.numTracingChildren)
        return; // nothing to do, no tracing children

    for(var attr in targetPathNode.tracingChildren) {
        var childPathNode = targetPathNode.tracingChildren[attr];
        if(childPathNode.nonExtensionPath)
            continue;
        var childSourcePathId = this.qcm.allocatePathId(sourcePathId, attr);
        this.replaceMappingQueryCalcSource(childPathNode, childSourcePathId,
                                           false);
        this.qcm.releasePathId(childSourcePathId);
    }
}

// This function removes the entry for the given group from the 
// mappingGroups table of the given path node. If this entry stores 
// a mapping query calculation node, this query calculation node is 
// destroyed, which also results in its de-registration from the 
// source indexer.

MergeGroup.prototype.removeMappingGroupFromPath = 
    mergeGroupRemoveMappingGroupFromPath;

function mergeGroupRemoveMappingGroupFromPath(targetPathNode)
{
    if(!targetPathNode.mappingGroups)
        return;

    var entry = targetPathNode.mappingGroups.get(this.groupId);
    if(!entry)
        return;
    
    var identificationId = this.targetIdentificationId;

    if(this.prefixGroup === undefined && targetPathNode.parent &&
       targetPathNode == this.targetPathNode) {
        // minimal target path, merged under parent path 
        if(--targetPathNode.parent.dominatedMinGroups == 0) {
            // check if can destroy the non-terminal table of the parent path
            this.targetIndexer.destroyNonTerminals(targetPathNode);
        } else if(identificationId !== undefined) {
            targetPathNode.parent.nonTerminals.
                removeAdditionalIdentification(identificationId);
        }
    }

    if(this.priority == targetPathNode.minGroupPriority ||
       this.priority == targetPathNode.maxGroupPriority) {
        // set new minimal and maximal priorities
        targetPathNode.minGroupPriority = Infinity;
        targetPathNode.maxGroupPriority = Infinity;
        var _self = this;
        targetPathNode.mappingGroups.forEach(function(entry, otherGroupId){
            if(otherGroupId === _self.groupId)
                return;
            var otherGroup = _self.targetIndexer.groupById[otherGroupId];
            if(otherGroup.priority < targetPathNode.minGroupPriority)
                targetPathNode.minGroupPriority = otherGroup.priority;
            if(otherGroup.priority > targetPathNode.maxGroupPriority)
                targetPathNode.maxGroupPriority = otherGroup.priority;
        });

        // check if can destroy the non-terminal table of this path
        this.targetIndexer.destroyNonTerminals(targetPathNode);
    }

    if(identificationId !== undefined) {
        if(targetPathNode.nonTerminals !== undefined) {
            targetPathNode.nonTerminals.
                removeAdditionalIdentification(identificationId);
        }
        
        if(targetPathNode.dataElementOperators !== undefined) {
            targetPathNode.dataElementOperators.
                removeAdditionalIdentification(identificationId);
        }
    }
    
    // unregister source identification (in case there are unmapped nodes)
    if(targetPathNode.unmappedNodes !== undefined &&
       targetPathNode.unmappedNodes.getNum() > 0) // has unmapped nodes
        this.removeFromUnmappedByIdentification(targetPathNode, this);

    this.removeAllOrderStarFuncsFromPath(targetPathNode);
    
    targetPathNode.mappingGroups.delete(this.groupId);
    if(entry === true || !(entry instanceof MappingQueryCalc))
        return; // no query calculation object to de-register and destroy

    entry.destroy(); // this also de-registers from the source indexer
}


// This function goes over the child path nodes of the given target path node.
// It assumes that these path nodes are extension target paths for 
// this group, which must be a maximal non-identity group. The function
// then checks whether this group is registered in the 
// mappingGroups list for this path node. If it is, the mapping
// query calcualtion node for this group is destroyed (this also deregisters
// it from the source indexer) and the entry for the group is removed from
// the mappingGroups table. This function continues recursively 
// to the children of the child path nodes.

MergeGroup.prototype.removeGroupFromExtensionChildPaths = 
    mergeGroupRemoveGroupFromExtensionChildPaths;

function mergeGroupRemoveGroupFromExtensionChildPaths(pathNode)
{
    for(var attr in pathNode.children) {
        var childPathNode = pathNode.children[attr];

        if(childPathNode.mappingGroups.size === 0 ||
           !childPathNode.mappingGroups.has(this.groupId))
            // group not registered on this path, so it also can't be registered
            // of child path nodes of this path node
            continue;

        // continue recursively to children of this path node
        this.removeGroupFromExtensionChildPaths(childPathNode);

        // remvoe the group from this path node
        this.removeMappingGroupFromPath(childPathNode);
    }
}

//////////////////////////////////
// Access to Source Information //
//////////////////////////////////

// Returns the identity of the given source data element ID based on 
// the identity assigned to it by the group.
// If the group is an identity group, sourceElementId is an identity
// node which was allocated by the group's sourceNodes object
// (it is not a node in the source indexer, but just a virtual node from
// that indexer). In this case, the identity is retrieved from the
// sourceNodes object of the group.

MergeGroup.prototype.getSourceIdentity = mergeGroupGetSourceIdentity;

function mergeGroupGetSourceIdentity(sourceElementId)
{
    if(this.isIdentityGroup)
        return this.sourceNodes.getIdNodeIdentity(sourceElementId);

    return this.sourceIndexer.getIdentity(this.sourceIdentificationId,
                                          sourceElementId);
}

// This is the same as getSourceIdentity(), but instead of being
// applied to a single element ID, it applies to an array of element IDs
// (and returns an array of identities).

MergeGroup.prototype.getSourceIdentities = mergeGroupGetSourceIdentities;

function mergeGroupGetSourceIdentities(sourceIds)
{
    if(this.isIdentityGroup)
        return this.sourceNodes.getIdNodeIdentities(sourceIds);

    return this.sourceIndexer.getIdentities(this.sourceIdentificationId,
                                            sourceIds);
}

// This function takes as input a target path to which this merge group
// maps and a set (array) of source IDs (from the source indexer) mapped
// by the group to this target path. The function checks which of these
// is a data element (that is, for which of these the data element is
// defined below the prefix group source path (if this target path is
// the explicit target path) or at the source path being mapped (in case the
// target path is an extension target path). For those elements which are
// data elements, this function finds the source identity. The function
// returns an array of these source identities, where the identity is
// not undefined iff the source ID at the corresponding position is
// a data element (based on the definition above). The returned array
// may be shorter than the input sourceIds (this means that the prefix is
// only undefined entries). If there are no data elements among the source
// IDs, this function returns undefined.

MergeGroup.prototype.getIdentitiesOfSourceDataElements =
    mergeGroupGetIdentitiesOfSourceDataElements;

function mergeGroupGetIdentitiesOfSourceDataElements(targetPathNode,
                                                     sourceIds)
{
    if(!this.hasSourceDataElements(targetPathNode))
        return undefined; // no data elements mapped to the target path node

    var sourcePathId = this.getSourcePathId(targetPathNode);
    var prefixPathId;
    
    if(sourcePathId === this.sourcePathId && this.prefixGroup !== undefined)
        prefixPathId = this.prefixGroup.sourcePathId;
    else
        prefixPathId = this.qcm.getPrefix(sourcePathId);

    // for each source ID, check whether its element path is longer than the
    // prefix path. Such source IDs are data elements, and for those
    // source IDs we determine the source identity. 

    if(prefixPathId === undefined)
        // prefix is before root path, so all paths are longer than it
        return this.getSourceIdentities(sourceIds);

    var dataElements =
        this.sourceIndexer.filterDataElementsUnderPathId(sourceIds,
                                                         prefixPathId);

    var dataElementNum = dataElements.length;
    if(dataElementNum === 0)
        return undefined;
    
    var sourceIdentities = this.getSourceIdentities(dataElements);

    // reconstruct an array aligned with 'sourceIds'.
    return alignArrays(sourceIds, dataElements, sourceIdentities);
}

// given is an array of source identities of source elements mapped by
// this group (this should only be called on an identity group).
// This function returns an object of the form:
// {
//    types: <array of types>,
//    keys: <array of simple keys>
// }
// Where the entry in each array is the type/key which were compressed
// to create the given identity. If the identity is not the compression
// of a simple value, type isset to "attributeValue" and key to undefined.

MergeGroup.prototype.getSourceKeysByIdentity =
    mergeGroupGetSourceKeysByIdentity;

function mergeGroupGetSourceKeysByIdentity(identities)
{
    var types = [];
    var keys = [];
    
    for(var i = 0, l = identities.length ; i < l ; ++i) {

        var identity = identities[i];
        
        if(typeof(identity) !== "number" || identity > 0)
            types.push("attributeValue");
        else {
            var simpleValue = this.qcm.compression.getSimpleValue(-identity);
            if(simpleValue === undefined) {
                types.push("attributeValue");
            } else {
                types.push(simpleValue.type);
                keys[i] = simpleValue.roundedValue;
            }
        }
    }

    return { types: types, keys: keys };
}

// Given a target path of this merge group and a set of source IDs
// (from the source indexer) mapped to this target path by this group,
// this function returns the values of the given source IDs at the source
// path mapped to the given target path. The function returns an object
// with the following structure:
// {
//     keys: <array>,
//     types: <array>,
//     hasAttrs: <array>
// }
// where each position in each of the arrays in the returned object
// corresponds to the source ID in the corresponding position in the
// input array. The first array provides the current key of the given
// source ID at the source path, the second array provides the type and
// the third array provides a boolean which indicates whether the node
// has attributes under it or not.
// For source nodes which are not found at the source path, an undefined
// entry is returned in each of the arrays.

MergeGroup.prototype.getSourceValues = mergeGroupGetSourceValues;

function mergeGroupGetSourceValues(targetPathNode, sourceIds)
{
    var sourcePathId = this.getSourcePathId(targetPathNode);
    return this.sourceIndexer.getNodeValues(sourcePathId, sourceIds);
}

// This function fetches the non-attributes of the source nodes whose
// IDs are in the array 'sourceIds' and whose source path is mapped to the
// given taget path by this group. The non-attributes are those attributes
// such that children of the source node under the given attributes should
// not be monitored by a monitor monitoring the source node. This function
// returns an array of Map objects, each Map object storing the non-attributes
// of the source node in the corresponding position in the 'sourceIds' array.
// 'undefined' will appear in the returned array if the corresponding source
// node has no non-attributes. The returned array may be shorter than the
// input array if all remaining entries are undefined.

MergeGroup.prototype.getSourceNonAttrs = mergeGroupGetSourceNonAttrs;

function mergeGroupGetSourceNonAttrs(targetPathNode, sourceIds)
{
    var sourcePathId = this.getSourcePathId(targetPathNode);
    return this.sourceIndexer.getNodeNonAttrs(sourcePathId, sourceIds);
}

// This function returns true if the source nodes mapped by this group
// to the given target path node may contain nodes which are data elements.
// In case the target path is an extension path (the group is maximal)
// or the group is the minimal group, the data elements are required to
// be at the source path itself. If the target path is the explicit target
// path of the group and there is a prefix group, the data elements
// are allowed to be at any path between the source path of the group
// and the source path of the prefix group (but not at the source path of
// the prefix group). Since any intermediate paths are not mapped,
// any data elements at those paths translate appear after the mapping as
// data elements at the source path of the group.

MergeGroup.prototype.hasSourceDataElements = mergeGroupHasSourceDataElements;

function mergeGroupHasSourceDataElements(targetPathNode)
{
    var sourcePathId = this.getSourcePathId(targetPathNode);
    var prefixPathId;
    
    if(sourcePathId === this.sourcePathId && this.prefixGroup !== undefined)
        prefixPathId = this.prefixGroup.sourcePathId;
    else
        prefixPathId = this.qcm.getPrefix(sourcePathId);

    return this.sourceIndexer.hasLowerDataElements(sourcePathId, prefixPathId);
}

// This function returns true if the source nodes mapped by this group
// to the given target path node may contain operand nodes.

MergeGroup.prototype.hasSourceOperands = mergeGroupHasSourceOperands;

function mergeGroupHasSourceOperands(targetPathNode)
{
    var sourcePathId = this.getSourcePathId(targetPathNode);
    return this.sourceIndexer.pathHasOperands(sourcePathId);
}

// The given a target path of the group, this function returns the source
// path ID of the source path from which the group maps to this target path.
// For non-maximal groups, this is simply the source path of the group.
// For a maximal group, however, the target path may also be an extension
// path (extending the target path of the group). The source path which
// the group maps to that target path is then stored in the 'mappingGroups'
// table of the target path (under the ID of the group).

MergeGroup.prototype.getSourcePathId = mergeGroupGetSourcePathId;

function mergeGroupGetSourcePathId(targetPathNode)
{
    if(this.isMaxGroup)
        // for the maximal group, the source path is stored in the 
        // 'mappingGroups' table of the path node
        return targetPathNode.mappingGroups.get(this.groupId).sourcePathId;

    // otherwise, the source path is simply the source path of the group
    return this.sourcePathId;
}

// This function returns the list of source path IDs which map children
// to child paths of the given target path node. If 'isMonitored' is
// false, only source paths which have a target path which is traced
// are returned. If 'isMonitored' is true, all child paths of the
// source path are returned. Since a MappingQueryCalc and/or MappingMonitor
// object should have already been registered to the source indexer,
// all the relevant path nodes must already exist in the source node
// and the path ID should already exist.
// So as not to have to calculate the target path IDs from the source
// path IDs which are returned by this function, this function also
// returns information about the corresponding target path ID.
// The function returns an array of objects of the following form:
// {
//     sourcePathId: <path ID>,
//     targetPathId: <path ID>,
//     attr: <string>
// }
// Where 'attr' is the attribute of the child source/target path under the
// parent path.
// 'targetPathId' may be undefined in some of these entries if 'isMonitored'
// is true.

MergeGroup.prototype.getSourceChildPaths = mergeGroupGetSourceChildPaths;

function mergeGroupGetSourceChildPaths(targetPathNode, isMonitored)
{
    var sourcePathId = this.getSourcePathId(targetPathNode);
    var childPaths = [];
    
    if(!isMonitored) {

        var children = targetPathNode.tracingChildren;
        for(var attr in children) {
            childPaths.push({
                sourcePathId: this.qcm.getPathId(sourcePathId, attr),
                targetPathId: targetPathNode.tracingChildren[attr].pathId,
                attr: attr
            });
        }
    } else {

        // need to get all source child paths from the source indexer

        var sourceChildPaths = this.sourceIndexer.getChildPaths(sourcePathId);

        for(var i = 0, l = sourceChildPaths.length ; i < l ; ++i) {

            var sourceChildPath = sourceChildPaths[i];

            // the target path ID may be undefined (we do not yet create
            // the target path, since we do not yet know whether there are
            // monitored elements to add).
            var childTargetPathId = this.qcm.getPathId(targetPathNode.pathId,
                                                       sourceChildPath.attr);

            childPaths.push({
                sourcePathId: sourceChildPath.childPathId,
                targetPathId: childTargetPathId,  // may be undefined
                attr: sourceChildPath.attr
            });
        }
    }

    return childPaths;
}

// 'sourceIds' is an array of source IDs defined at teh source path
// which is mapped by the group to 'targetPathNode'. The function
// returns the list of source nodes dominated by these source IDs at
// the child paths of the source path. In case 'sourceIds' contains
// operators, the operand children of these operators are returned
// (the child path is then the same as the parent source path).
// If there are operators with oeprands at the child path, only the
// highest operators are returned (the operands will be returned by
// the next call to this function).
// When 'isMonitored' is false, the targets of the source nodes are not
// monitored and therefore only child paths where the coresponding
// target child path is traced are considered. If 'isMonitored' is true,
// all source child paths are considered.
// The source IDs are returned in an array with one entry for each
// child path. Each such entry has the following structure:
// {
//     sourcePathId: <path ID>
//     targetPathId: <path ID> // may be undefined if 'isMonitored' is true
//                             // and the target path was not yet created
//     attr: <string> // attribute of child path under parent path
//                    // this is undefined in case of operands under operators
//     hasDataElements: true|false // are there any data element among the
//                                 // child nodes
//     sourceChildIds: <array of source IDs>|<array of arrays of source IDs> 
// }
//
// sourceChildIds stores an array where each position stores the child/children
// of the source ID at the corresponding position in 'sourceIds'.
// undefined appears in 'sourceChildIds' appears in the array if there are
// no children at this child path for the corresponding source ID.
// Otherwise, if 'hasDataElements' is false, a single child source ID
// is stored at the position (if there are no data elements at the child
// path node, there can be at most one child for each parent). In fact,
// this child ID must then be equal to the parent source ID (so it only
// indicates whether the child exists or not). Otherwise, an
// array of child source IDs is stored at each position (even if there is
// only one child ID).

MergeGroup.prototype.getSourceChildren = mergeGroupGetSourceChildren;

function mergeGroupGetSourceChildren(sourceIds, targetPathNode, isMonitored)
{
    var sourcePathId = this.getSourcePathId(targetPathNode);
    
    // find the child paths that extend targetPathNode.
    var sourceChildPaths =
        this.getSourceChildPaths(targetPathNode, isMonitored);

    var sourceChildIds = [];

    // check if the source nodes have any operand children at the same path
    var allOperandIds = this.sourceIndexer.getAllDirectOperands(sourceIds,
                                                                sourcePathId);

    if(allOperandIds !== undefined) {
        sourceChildIds.push({ sourcePathId: sourcePathId,
                              targetPathId: targetPathNode.pathId,
                              attr: undefined,
                              hasDataElements: true,
                              sourceChildIds: allOperandIds
                            });
    }
    
    // for each source path, get the children of the given source IDs
    // at that path.
    for(var i = 0, l = sourceChildPaths.length ; i < l ; ++i) {

        var childEntry = sourceChildPaths[i];
        var childSourceNodes =
            this.sourceIndexer.getAllDirectChildren(sourceIds,
                                                    childEntry.sourcePathId);

        if(childSourceNodes === undefined) // no children found
            continue;
        
        childEntry.hasDataElements = childSourceNodes.hasDataElements;
        childEntry.sourceChildIds = childSourceNodes.childIds;

        sourceChildIds.push(childEntry);
    }

    return sourceChildIds;
}

///////////////////////////////
// Access to Source Elements //
///////////////////////////////

// This function returns an array of source element IDs which are all
// the source element IDs mapped by this group. These are the source
// nodes as passed on to the merge indexer, so in case of an identity
// group, these are the identity source IDs.

MergeGroup.prototype.getAllSourceNodes = mergeGroupGetAllSourceNodes;

function mergeGroupGetAllSourceNodes()
{
    if(this.isIdentityGroup)
        // the source nodes are the identity nodes allocated by the
        // SourceNodes object, so get them fro there
        return this.sourceNodes.getAllSourceNodes();

    if(this.projNum > 1)
        // all nodes are reference counted, so can get the source nodes
        // from the SourceNodes object
        return this.sourceNodes.getAllSourceNodes();

    // only one projection, get the source nodes projected by the projection

    var proj = this.getSingleProj(); // get the single projection info

    if(!this.targetIndexer.projAlreadyAddedMatches(proj.resultId, proj.projId))
        // the matches of the projection were not yet added
        return [];
    
    var matches = proj.funcResult.getTerminalProjMatches(proj.projId);

    if(this.isMaxGroup)
        return matches;
    
    // Since this is not the maximal group, may need to raise the matches.

    var maxGroup =
        this.targetIndexer.getProjMaxGroup(proj.resultId, proj.projId);
    var maxSourcePathId = maxGroup.sourcePathId;
    
    // determine whether any raising may need to be performed
    var hasLowerDataElements =
        this.sourceIndexer.hasLowerDataElements(maxSourcePathId,
                                                this.sourcePathId);
    
    if(!hasLowerDataElements)
        return matches;

    var groupMatches = [];
    // as multiple matches may be raised to the same parent data element,
    // we store matches actually raised so as to add them only once.
    var raised = new Map();
    
    for(var i = 0, l = matches.length ; i < l ; ++i) {
        
        var sourceId = matches[i];
        var raisedId = this.raiseToGroup(sourceId);

        if(raisedId == sourceId)
            groupMatches.push();
        else if(raised.size > 0 && raised.has(raisedId))
            continue; // already added
        else {
            raised.set(raisedId, true);
            groupMatches.push(raisedId);
        }
    }

    return groupMatches;
}

// This function returns an array of source element IDs which are all
// the source element IDs mapped by this group which are dominated by the
// source IDs provided in the input array 'sourceIds'. These must all
// be nodes at the path 'sourcePathId' (which is a prefix of the source
// path ID of this group). This function should not be called on an
// identity group (it is actually mainly intended or calling on a
// non-minimal group, which is never an identity group).  When there
// are operators at the source path of the group, only the highest
// operator is returned, and not the operands dominated by it).

MergeGroup.prototype.getSourceNodesDominatedBy =
    mergeGroupGetSourceNodesDominatedBy;

function mergeGroupGetSourceNodesDominatedBy(sourceIds, sourcePathId)
{    
    // check whether any lowering is required
    if(this.sourceIndexer.hasLowerDataElements(sourcePathId,
                                               this.sourcePathId)) {
        sourceIds = this.sourceIndexer.getChildDataElements(this.sourcePathId,
                                                            sourceIds,
                                                            sourcePathId);
        // if the source path has operands, raise operands back to their
        // highest operators.
        sourceIds = this.sourceIndexer.raiseElementsToOperators(sourceIds);
    }

    // need to filter 'sourceIds' to the nodes actually mapped by one
    // of the projections belonging to the group.

    var filteredSourceIds;
    
    if(this.projNum > 1) {
        // source nodes are reference counted, so can check against the
        // source node table.
        filteredSourceIds = [];
        for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
            var sourceId = sourceIds[i];
            if(this.sourceNodes.hasNode(sourceId))
                filteredSourceIds.push(sourceId);
        }
        return filteredSourceIds;
    }

    // there is a single projection. Moreover, any raised source Ids are
    // reference counted, so it is enough to check against the referenced
    // source nodes and filter against the projection (without lowering
    // to the projection).

    var proj = this.getSingleProj();
    filteredSourceIds =
        proj.funcResult.filterTerminalProjMatches(proj.projId, sourceIds);

    if(filteredSourceIds.length === 0)
        return filteredSourceIds;
    
    if(this.isMaxGroup) // if this is a maximal group, no raising took place
        return filteredSourceIds;

    var maxGroup =
        this.targetIndexer.getProjMaxGroup(proj.resultId, proj.projId);

    if(!this.sourceIndexer.hasLowerDataElements(maxGroup.sourcePathId,
                                                this.sourcePathId))
        return filteredSourceIds; // no raising from max group to this group

    // loop over the elements in 'sourceIds'. Add to 'filteredSourceIds'
    // those which are in the source node table of this group or any
    // lower group of the projection which is not the maximal group.
    // (if raise, it must be in one of those source node tables).
    
    var group = maxGroup.prefixGroup;
    while(group !== undefined) {

        for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
            var sourceId = sourceIds[i];
            if(group.sourceNodes.hasNode(sourceId))
                filteredSourceIds.push(sourceId);
        }
        
        if(group == this)
            break;
        group = group.prefixGroup;
    }

    return filteredSourceIds;
}


// This function should only be called on non-maximal groups.
// Given an array 'sourceIds' of source IDs mapped by this group, this
// function returns those nodes added by each projection (that is,
// mapped by the maximal group) such that the mapping of those source nodes
// at the maximal group resulted in the mapping of 'sourceIds' at this
// group. Since a non-maximal group may be a prefix group of multiple
// maximal groups, this function also returns the maximal group which
// mapped each set of elements. The function therefore returns an array
// of objects of the form:
// {
//    group: <maximal group MergeGroup object>,
//    maxSourceIds: <array of element IDs>
// }
// The function is implemented by first finding the set of maximal groups
// for which this group is a prefix. Next, the children of the nodes
// 'sourceIds' at the source path of each of those groups are determined
// and then they are filtered by the projections of each group (to determine
// which nodes were actually mapped).

MergeGroup.prototype.getMaxSourceNodes = mergeGroupGetMaxSourceNodes;

function mergeGroupGetMaxSourceNodes(sourceIds)
{
    if(this.isIdentityGroup)
        // the source IDs are identity node IDs. We need to first convert them
        // into the original source IDs
        sourceIds = this.getSourceNodesOfIdentities(sourceIds);

    var maxGroups = this.getMaxGroups();
    var maxSourceNodes = [];
    
    for(var i = 0, l = maxGroups.length ; i < l ; ++i) {
        var maxGroup = maxGroups[i];
        var maxSourceIds = maxGroup.getSourceNodesDominatedBy(sourceIds);
        maxSourceNodes.push({
            group: maxGroup,
            maxSourceIds: maxSourceIds
        });
    }

    return maxSourceNodes;
}

// This function receives an array with a list of source node Ids
// which should be defined at the source path of this group. The function
// then checks whether any of these nodes has an operand at this path
// (that is, a child at the same path). The function then returns
// an array which is the subset of sourceIds which do not have operands
// under them (if there are no operands at the source path, the input
// array is returned, as is).

MergeGroup.prototype.filterOutOperators = mergeGroupFilterOutOperators;

function mergeGroupFilterOutOperators(sourceIds)
{
    if(!this.sourceIndexer.pathHasOperands(this.sourcePathId))
        return sourceIds; // no operands at this path

    var nonOperators = [];
    
    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
        var sourceId = sourceIds[i];
        if(this.sourceIndexer.getOperandDataElements(sourceId,
                                                     this.sourcePathId))
            continue; // has operands
        nonOperators.push(sourceId);
    }

    return nonOperators;
}

// This function should only be called on a maximal group which is not
// an identity group.
// This function receives an array 'sourceIds' of source element IDs
// which are to be mapped from the source path 'sourcePathId' which is
// an extension of the source path of the maximal group. The function
// then checks which of the nodes in 'sourceIds' are dominated by a node
// merged by the maximal group and returns an array with the subset of
// the input element IDs which are dominated by elements mapped by the
// group.

MergeGroup.prototype.filterDominatedByProj = mergeGroupFilterDominatedByProj;

function mergeGroupFilterDominatedByProj(sourceIds, sourcePathId)
{
    var toFilter;
    
    // check whether any raising needs to take place (raising should be
    // all the way to the highest operator, as that is what the group
    // should map).

    var hasLowerDataElements =
        this.sourceIndexer.hasLowerDataElements(sourcePathId,
                                                this.sourcePathId);

    if(hasLowerDataElements) {
        // raise the nodes
        toFilter = new Array(sourceIds.length);
        for(var i = 0, l = sourceIds.length ; i < l ; ++i)
            toFilter[i] = this.raiseToGroup(sourceIds[i]);
    } else // no raising
        toFilter = sourceIds;

    // check whether further raising to operators is required
    if(this.sourceIndexer.pathHasOperands(this.sourcePathId)) {
        var operators = new Array(sourceIds[i]);
        for(var i = 0, l = toFilter.length ; i < l ; ++i) {
            operators[i] =
                this.sourceIndexer.raiseToOperator(toFilter[i],
                                                   this.sourcePathId);
        }
        toFilter = operators;
    }

    // filter the matches in 'toFilter'
    var filtered;

    if(this.projNum > 1) {
        // source nodes are reference counted, so can filter by the source
        // nodes table
        filtered = [];
        for(var i = 0, l = toFilter.length ; i < l ; ++i) {
            if(this.sourceNodes.hasNode(toFilter[i]))
                filtered.push(sourceIds[i]);
        }
        return filtered;
    }

    // single projection: get the projection and use it to filter
    var proj = this.getSingleProj();

    if(!this.targetIndexer.projAlreadyAddedMatches(proj.resultId, proj.projId))
        // the matches of the projection were not yet added
        return [];
    
    filtered =
        proj.funcResult.filterTerminalProjMatches(proj.projId, toFilter);

    if(toFilter == sourceIds)
        return filtered;
    
    // some raising may have taken place, so we 'filtered' may contain
    // raised element IDs. need to find the positions in 'toFilter' which
    // are in 'filtered' and return the corresponding elements in sourceIds

    var filteredPos = 0;
    var numFiltered = filtered.length;
    
    for(var i = 0, l = toFilter.length ; i < l ; ++i) {
        if(toFilter[i] == filtered[filteredPos]) {
            filtered[filteredPos] = sourceIds[i]; // set ID before raising
            filteredPos++;
            if(filteredPos >= numFiltered)
                break;
        }
    }
    
    return filtered;
}

// This function returns true if the source path has operand nodes
// (nodes dominated by a node at the same path).

MergeGroup.prototype.sourcePathHasOperands = mergeGroupSourcePathHasOperands;

function mergeGroupSourcePathHasOperands()
{
    return this.sourceIndexer.pathHasOperands(this.sourcePathId);
}

// This function checks whether the given source element ID has dominating
// operators and returns an array with all dominating operators. It returns
// undefined if there are no such operator. Otherwise it returns an array
// with all those operators, ordered bottom up (from dominated to dominating).

MergeGroup.prototype.getAllDominatingOperators =
    mergeGroupGetAllDominatingOperators;

function mergeGroupGetAllDominatingOperators(sourceId)
{
    return this.sourceIndexer.raiseToAllOperators(sourceId);
}

// This function provides an interface to the source indexer's  
// raiseElementsToDirectOperators() function (see there for more details).

MergeGroup.prototype.getDirectDominatingOperators =
    mergeGroupGetDirectDominatingOperators;

function mergeGroupGetDirectDominatingOperators(sourceIds)
{
    return this.sourceIndexer.raiseElementsToDirectOperators(sourceIds,
                                                            this.sourcePathId);
}

// Given is a target path node which this group maps to (this may be either
// the explicit target path of the node or, in case of a maximal group,
// an extension target path) and a set (array) of source IDs at teh source
// path for that target path. This function then finds the source nodes
// dominating these source IDs either at the prefix source path (if this
// is an extension source path) or at the source path of the prefix group
// (if this is not a maximal group). These source nodes are returned in
// an array (with the positions of the dominating nodes aligned with those
// of the input source IDs). If the group is a minimal group and the
// given target path is its explicit target path, this function returns
// undefined.

MergeGroup.prototype.getDominatingSourceNodes =
    mergeGroupGetDominatingSourceNodes;

function mergeGroupGetDominatingSourceNodes(targetPathNode, sourceIds)
{
    var sourcePathId;
    var prefixSourcePathId;
    
    if(targetPathNode === this.targetPathNode) {
        if(this.prefixGroup === undefined)
            return undefined;
        sourcePathId = this.sourcePathId;
        prefixSourcePathId = this.prefixGroup.sourcePathId;
    } else {
        sourcePathId = this.getSourcePathId(targetPathNode);
        prefixSourcePathId = this.qcm.getPrefix(sourcePathId);
    }

    return this.sourceIndexer.raiseAllToPath(sourceIds, prefixSourcePathId,
                                             sourcePathId);
}


/////////////////////////////////
// Determining Reference Count //
/////////////////////////////////

// This function takes as input an array of source IDs which were possibly
// mapped by this group. The function returns an array with numbers which are
// the reference counts with which these source IDs were added to this
// group. If the flag 'noZeroRef' is set, then, by assumption, all source IDs
// in the input array must have a reference count of at least 1, otherwise
// there may also be nodes with reference count 0.
// When this is not an identity group, this function is simple: if the
// reference count is stored in SourceNodes table, use that reference count
// and otherwise, if 'noZeroRef' is true then the reference count is 1
// and otherwise the source nodes need to be filtered against their source:
// either the projection itself (if this is a maximal group) or the
// next group (there can be only one, since otherwise the nodes are
// reference counted.
// If this is an identity group, this function is implemented in
// 'getIdGroupRefCount()' (see there for more documentation).

MergeGroup.prototype.getRefCount = mergeGroupGetRefCount;

function mergeGroupGetRefCount(sourceIds, noZeroRef)
{
    if(this.isIdentityGroup)
        return this.getIdGroupRefCount(sourceIds, noZeroRef);

    // non-identity group

    var refCount;
    
    if(this.projNum > 1) {        
        // explicit reference counting, get the counts from SourceNodes
        refCount = new Array(sourceIds.length);
        for(var i = 0, l = sourceIds.length ; i < l ; ++i)
            refCount[i] = this.sourceNodes.getCount(sourceIds[i]);
        return refCount;
    }

    if(noZeroRef) {

        refCount = new Array(sourceIds.length);
        
        if(this.isMaxGroup || this.sourceNodes.numNodes() == 0) {
            // all counts are 1
            for(var i = 0, l = sourceIds.length ; i < l ; ++i)
                refCount[i] = 1;
            return refCount;
        }

        // some elements are reference counted. Need to check for each
        // node whether it is in the SourceNodes table. If it is, the table
        // determines its reference count. Otherwise, the reference count is 1.
        
        for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
            var count = this.sourceNodes.getCount(sourceIds[i]);
            refCount[i] = (count === undefined) ? 1 : count;
        }

        return refCount;
    }

    if(!this.isMaxGroup) {
        // get the reference counts from the previous group (there is only
        // one, since the number of projections is 1).
        refCount = this.nextGroups[0].getRefCount(sourceIds);
        // Convert all non-zeros into 1s.
        for(var i = 0, l = refCount.length ; i < l ; ++i) {
            if(refCount[i] > 1)
                refCount[i] = 1;
        }

        if(this.this.sourceNodes.numNodes() == 0) // no raising
            return refCount;
        
        // raising took place, should set reference count for raised elements
        // and set to zero the reference count of those that were raised.
        for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
            if(refCount[i] == 0) {
                // may be a raised node
                refCount[i] = this.sourceNodes.getCount(sourceIds[i]);
            } else { // verify that was not raised
                if(this.sourceIndexer.getDataElementPathId(sourceIds[i]) >
                   this.sourcePathId)
                    refCount[i] = 0;
            }
        }

        return refCount;
    }

    // maximal group (and a single projection) filter by the projection
    
    var proj = this.getSingleProj();
    refCount = new Array(sourceIds.length);

    if(!this.targetIndexer.projAlreadyAddedMatches(proj.resultId, proj.projId)){
        // the matches of the projection were not yet added, so all reference
        // counts are zero
        for(var i = 0, l = sourceIds.length ; i < l ; ++i)
            refCount[i] = 0;
        return refCount;
    }
    
    var filtered = proj.funcResult.filterTerminalProjMatches(proj.projId,
                                                             sourceIds);
    var filteredPos = 0;
    var filteredLength = filtered.length;
    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
        if(filteredPos >= filteredLength)
            refCount[i] = 0;
        else if(filtered[filteredPos] == sourceIds[i]) {
            refCount[i] = 1;
            filteredPos++;
        } else
            refCount[i] = 0;
    }

    return refCount;
}

// This function implements 'getRefCount()' for the case where this group
// is an identity group. When this is an identity group, the SourceNodes
// object only tracks the reference counts of the identities, not of
// the individual source nodes.
// There are then two cases:
// 1. If the indentity group is not a maximal group, the next group(s)
//    map the same source IDs and we fetch the reference counts from those
//    groups (and add them together, each next group contributing 1).
//    If any nodes were raised to operators before determining their identity,
//    the raise nodes are stored in the SourceNodes table. In this case we
//    need to assign the operator nodes their reference count according to
//    the SourceNodes table and, in addition, set to zero the reference counts
//    of operands which were raised.
// 2. If the identity group is a maximal group:
//    a. if a single projection belongs to the group and if 'noZeroRef' is set,
//       the reference count is always one.
//    b. otherwise, we need to filter the source nodes against each
//       projection and count the matches.

MergeGroup.prototype.getIdGroupRefCount = mergeGroupGetIdGroupRefCount;

function mergeGroupGetIdGroupRefCount(sourceIds, noZeroRef)
{
    if(!this.isIdentityGroup) // shouldn't happen, but can still be handled
        return this.getRefCount(sourceIds, noZeroRef);
    
    if(!this.isMaxGroup) {
        // fetch the reference counts from the next group(s), which map the
        // same source IDs.
        var refCount = this.nextGroups[0].getRefCount(sourceIds);
        for(var i = 0, l = refCount.length ; i < l ; ++i)
            if(refCount[i] > 1)
                refCount[i] = 1;
        // add reference counts of remaining next groups
        for(var i = 1, l = this.nextGroups.length ; i < l ; ++i) {
            var nextRefCount = this.nextGroups[1].getRefCount(sourceIds);
            for(var j = 0, m = nextRefCount.length ; j < m ; ++j)
                if(nextRefCount[j] > 0)
                    refCount[j]++;
        }

        if(this.sourceNodes.numRaised() == 0)
            return refCount;

        // check for raised operators
        for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
            var sourceId = sourceIds[i];
            if(refCount[i] == 0) {
                var count = this.sourceNodes.getRaisedCount(sourceIds);
                if(count > 0)
                    refCount[i] = count;
            } else if(this.sourceIndexer.isOperand(sourceId,
                                                   this.sourcePathId))
                refCount[i] = 0;
        }
        return refCount;
    }

    // maximal group
    
    if(this.projNum === 1 && noZeroRef) {
        // all reference counts are 1
        var refCount = new Array(sourceIds.length);
        for(var i = 0, l = refCount.length ; i < l ; ++i)
            refCount[i] = 1;
        
        return refCount;
    }
    
    // filter on projections (each projection contributes 1 to the
    // reference count).

    var refCount = new Array(sourceIds.length);
    for(var i = 0, l = refCount.length ; i < l ; ++i)
        refCount[i] = 0;
    
    var _self = this;
    
    this.mappings.forEach(function(entry, resultId) {
        entry.projections.forEach(function(t, projId) {
            
            if(!_self.targetIndexer.projAlreadyAddedMatches(resultId, projId))
                return; // matches not yet added      
      
            var filtered =
                entry.funcResult.filterTerminalProjMatches(projId, sourceIds);
            var filteredPos = 0;
            var numFiltered = filtered.length;
            for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
                if(filtered[filteredPos] == sourceIds[i]) {
                    refCount[i]++;
                    if(++filteredPos >= numFiltered)
                        break;
                }
            }
        });
    });

    return refCount;
}

/////////////////////////////
// Source Element Addition //
/////////////////////////////

// This function takes a source element ID from the source indexer of this
// group which is defined at the source path of the group or at some path
// extending this source path.
// This function then raises this source element ID to its lowest parent
// data element ID which is at the source path of the group or higher
// (this means that if there are operators at the group source path,
// the source element ID will be raised to the operand, but will not continue
// to be raised to the operator, which is defined at the same path).

MergeGroup.prototype.raiseToGroup = mergeGroupRaiseToGroup;

function mergeGroupRaiseToGroup(sourceId)
{
    return this.sourceIndexer.raiseToPath(sourceId, this.sourcePathId);
}

// This function is called when a projection belonging to this group
// adds matches. 'resultId' and 'projId' identify the projection which
// added the matches. This function is called first on the maximal group
// for the projection and later may be called recursively on prefix
// groups (if any). When called recusively on non-maximal groups,
// 'prevGroup' is the MergeGroup object for the group on which this
// function was previously called (that is 'this' group is its direct
// prefix group). When 'this' object is the maximal group, 'prevGroup'
// should be undefined.
//
// 'sourceElementIds' should be an array containing the IDs of those
// nodes which are projected at this group. When first called on the
// maximal group, this is the full array of added element IDs received from
// the projection. When called recursively on a non-maximal group,
// these are the elements mapped by the previous group. For elements
// which were already mapped previously this array contains 'undefined'
// in the corresponding position (there is no need to map them again,
// but we wish to keep the alignment for the return value of this
// function, see below). An element may have been already mapped for
// several reasons:
// 1. The group contains several projections and another projection already
//    mapped the element.
// 2. The group is not the maximal group and elements were raised
//    to the source path of the group. When raising takes place,
//    multiple elements mapped by the maximal group may be mapped to
//    the same element mapped by some prefix group. This may happen within
//    the same updated (so the first time within the update that an element
//    is raised to a certain element ID the raise element ID will appear in
//    the source element array but subsequent raising to this element ID
//    will be stored as an 'undefined' in this list).
// This function performs several tasks:
// 1. Raising, if needed (only on non-maximal groups and only if the
///   the source indexer contains data elements at the relevant paths).
// 2. Reference counting of mapped source nodes when nodes may be
//    mapped more than once (if there are multiple projections in the
//    group and/or if raising took place). This reference counting
//    takes place in the SourceNodes object.
// 3. In case the group has a prefix group, calling this function
//    recursively on that group with the source element ID list
//    consisting of the elements after raising and after replacing
//    elements which were already added with 'undefined'.
// 4. In case of an identity group, the source node ID is converted
//    to the corresponding identity node ID (which is a virtual
//    source node ID assigned to the identity of the source node).
//    This conversion takes place in the SourceNodes object and is
//    handled by a special function called here to manage this case.
// 5. For the minimal group, if the target path of the group is not
//    the root path, this function determines the dominating source parent
//    of the mapped source node whose identity is used to determine
//    the dominating target node(s) under which the mapped node should
//    be merged.
//    This parent and its identity are also stored in the relevant tables
//    to support future refresh of the parent's identity or of the
//    identity of the dominated target nodes.
// This function returns an array of arrays, as follows:
// 1. One array for this group and an additional array for each of its
//    prefix groups (in order of decreasing source/target path, that is,
//    each group's array before that of its prefix group's array).
// 2. Possibly an additional final array. Such an array is returned if
//    the target path of the minimal group is not the root path
//    or if there may be nodes mapped by the minimal group which have a
//    reference coutn of more than 1 (and the additional final array is
//    used to indicate which of these is mapped or hte first time and
//    which was already merged).
// 3. The arrays contain the source element IDs mapped by each group.
//    For an identity group, these are the identity node IDs rather than
//    the original source IDs received from the projection.
// 4. The element IDs in the different arrays are aligned so that for
//    each element ID appearing in the array for the maximal group, the
//    element IDs in the corresponding positions in the other arrays
//    are the elements dominating that element which were mapped by
//    the coresponding group.
// 5. In the array for the maximal group there are no 'undefined'
//    values, but in all other array there are (to keep the alignment).
// 6. When an element ID appears in an array for group G and there is
//    an undefined value at the same position in the next array then
//    that element was already mapped by group G. Otherwise, this is
//    the first time the element is mapped.
//    Note: in the maximal group array we never place elements which were
//    already mapped, so the next array should not contain any undefined
//    values.
// 7. If there is an additional array (following that for the minimal
//    group) that array contains elements as follows:
//    a. If the target path of the minimal group is not the root path,
//       this array contains element IDs whose identity is used to determine
//       the domainting nodes under which the nodes in the previous array
//       should be merged. The elements in the last array are not merged.
//    b. If the target path of the minimal group is the root path, this
//       array contains an 'undefined' in the position of elements in the
//       previous array which were mapped already and some other value
//       when the elements were mapped here for the first time.
//    If the target path of the minimal group is the root path and all
//    element IDs in the array of the minimal group are mapped for the first
//    time, this last array may be omitted.

MergeGroup.prototype.addSourceElements = 
    mergeGroupAddSourceElements;

function mergeGroupAddSourceElements(sourceElementIds, resultId, projId,
                                     prevGroup)
{
    if(this.isIdentityGroup) // special handling of identity group
        return this.addIdentityElements(sourceElementIds, prevGroup);

    if(this.isMaxGroup)
        // special case: no raising and duplicates are removed from array
        return this.addSourceElementsToMax(sourceElementIds, resultId, projId);

    // non-maximal, non-identity group

    if(!this.prefixGroup && !this.targetPathNode.parent &&
       !this.sourceIndexer.pathHasOperands(this.sourcePathId))
        // additional special case: the target path is the root (this also
        // implies there is no prefix group) and no operands
        return this.addSourceElementsAtRootTarget(sourceElementIds, prevGroup);
    
    // determine whether any raising may need to be performed
    var hasLowerDataElements =
        this.sourceIndexer.hasLowerDataElements(prevGroup.sourcePathId,
                                                this.sourcePathId);
    var toMerge = []; // source nodes to merge
    var underNodes = []; // array to pass on to the next function

    for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {
        var sourceId = sourceElementIds[i];
        if(sourceId === undefined)
            continue;

        var toMergeId = toMerge[i] = hasLowerDataElements ?
            this.raiseToGroup(sourceId) : sourceId;

        if(this.projNum > 1 || toMergeId != sourceId) {
            // need to keep track of reference count
            if(this.sourceNodes.incNode(toMergeId)) { // first time added
                underNodes[i] = toMergeId;
            }
        } else
            underNodes[i] = toMergeId;
    }

    // if there are operands at this path, reference count the operators
    // dominating the operands in 'underNodes' (that is, after raising to
    // the group path). The top operator which was not already added is
    // passed on to the next step.
    if(this.sourceIndexer.pathHasOperands(this.sourcePathId))
        underNodes = this.incOperatorRefCount(underNodes);
    
    // recusrive call
    if(this.prefixGroup !== undefined) {
        var allToMerge =
            this.prefixGroup.addSourceElements(underNodes, resultId, projId,
                                               this);
        // allToMerge is very short, so unshift is OK
        allToMerge.unshift(toMerge);
        return allToMerge;
    }
    
    // this is the minimal group, add the parents (for identification) if
    // target path is not the root and otherwise add 'underNodes' to indicate
    // which elements in 'toMerge' are new and which are not.
    var sourceParents = this.addSourceParents(underNodes);
    return sourceParents ? [toMerge, sourceParents] : [toMerge, underNodes];
}

// This function implements 'addSourceElements()' for an identity group.
// The documentation of that function also covers the case implemented
// by this function.

MergeGroup.prototype.addIdentityElements = 
    mergeGroupAddIdentityElements;

function mergeGroupAddIdentityElements(sourceElementIds, prevGroup)
{
    // There may be operators dominating the source node at the same path.
    // We need to find the highest such dominating operator, as this is
    // the node whose identity determines the identity node.
    // The projection must map the highest operator at its path, so
    // if this is the maximal group no raising is needed.
    var raiseToOperator = !this.isMaxGroup &&
        this.sourceIndexer.pathHasOperands(this.sourcePathId);
    
    var parentPath = this.targetPathNode.parent; // may be undefined
    if(parentPath !== undefined && !parentPath.childrenByIdentity)
        parentPath.childrenByIdentity = new ChildrenByIdentity();
    
    // true if both source and target paths of the group are not the root path
    // (if isDominated is true, parentPath must be defined).
    var isDominated = this.isDominated();
    var toMerge = []; // the identity source IDs to merge
    // the identity source ID under which to merge (if the target path is
    // not the root path).
    var toMergeUnder =
        (parentPath !== undefined || !this.isMaxGroup) ? [] : undefined; 
    
    for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {

        var sourceId = sourceElementIds[i];
        if(sourceId === undefined)
            continue; // was already mapped by the next group
        
        if(raiseToOperator) { // may need to raise to a dominating operator
            var raisedId =
                this.sourceIndexer.raiseToOperator(sourceId,
                                                   this.sourcePathId);
            if(raisedId !== sourceId) {
                this.sourceNodes.incRaised(raisedId);
                sourceId = raisedId;
            }
        }

        // the SourceNodes object calculates the identity node ID
        // (and also determines whether this is the first time this identity
        // was added).
        var idNode = this.sourceNodes.incNode(sourceId);
        var idNodeId = idNode.idNodeId;

        if(this.isMaxGroup) { // only need to return if not yet merged
            if(idNode.isNew)
                toMerge.push(idNodeId);
        } else
            toMerge[i] = idNodeId;

        if(!idNode.isNew)
            continue;

        if(parentPath === undefined) {
            if(toMergeUnder !== undefined)
                toMergeUnder[i] = idNodeId;
            continue;
        }

        // there is a parent target path, so need to store information to
        // determine dominating node
        
        // add the identity node mapped by the minimal group to
        // 'childrenByIdentity' under the identity of the parent node.
        // This ensures proper update of the insertion of the identity
        // node under its dominating nodes.
        var parentId = isDominated ? idNodeId : 0;
        if(this.isMaxGroup)
            toMergeUnder.push(parentId);
        else
            toMergeUnder[i] = parentId;
        
        var parentIdentity = isDominated ?
            idNode.parentIdentity : this.sourceNodes.getSourceIdentity(0);
            
        parentPath.childrenByIdentity.addChild(parentIdentity, parentId,
                                               idNodeId, this.groupId);
    }
    
    return toMergeUnder ? [toMerge, toMergeUnder] : [toMerge];
}

// This function implements 'addSourceElements()' for a maximal group
// which is not an identity group.
// The documentation of that function also covers the case implemented
// by this function. Here, the array of source elements constructed
// only includes source IDs which were not already mapped (and there is
// no need to insert undefined for such elements). In addition, no raising
// can take place here.
// Note: at the maximal group, the source elements are those mapped by
// the projection. In case of operators with operands, the projection
// is required not to map operands, but only their dominating operators
// (so that no partial mapping of the object under the operator is possible).
// Therefore, as opposed to non-maximal groups, there is no need to
// reference count dominating operators for the maximal group.

MergeGroup.prototype.addSourceElementsToMax = 
    mergeGroupAddSourceElementsToMax;

function mergeGroupAddSourceElementsToMax(sourceElementIds, resultId, projId)
{
    var toMerge;

    if(this.projNum == 1)
        toMerge = sourceElementIds; // no duplicates possible
    else {
        toMerge = [];
        for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {
            var sourceId = sourceElementIds[i];
            if(this.sourceNodes.incNode(sourceId)) // first time added
                toMerge.push(sourceId);
        }
    }
    
    if(this.prefixGroup) { // call recursively
        var allToMerge = this.prefixGroup.addSourceElements(toMerge, resultId,
                                                            projId, this);
        // allToMerge is very short, so unshift is OK
        allToMerge.unshift(toMerge);
        return allToMerge;
    }

    // this is also the minimal group, check whether we need the parent source
    // nodes to determine the dominating target nodes
    
    var sourceParents = this.addSourceParents(toMerge);

    if(sourceParents === undefined)
        return [toMerge]; // mapped to the root target path, so no domination

    return [toMerge, sourceParents];
}

// This function implements the special case of addSourceElements()
// when the group is not maximal, not an identity group but its
// target path is the root path (which also implies that it is a minimal group)
// and the source path has no operands.
// As a result, there is no need to construct an array to be passed as
// input to the next element source mapping function (a recursive call
// on the prefix group or a call to addSourceParents()). Instead,
// this function returns an array of two arrays: the element IDs mapped by
// this group (the same as the input array except for possible raising) and
// a second array which has 'undefined' in the position of elements of the
// first array which are either undefined or were already mapped by the
// group (the reference count is larger than 1) and 0 in the position of
// all other elements. In the special case where no reference count larger
// than 1 is possible (if there is a single projection and no raising)
// this function only returns an array with a single array (the first of
// these two arrays).

MergeGroup.prototype.addSourceElementsAtRootTarget = 
    mergeGroupAddSourceElementsAtRootTarget;

function mergeGroupAddSourceElementsAtRootTarget(sourceElementIds, prevGroup)
{
    // determine whether any raising may need to be performed
    var hasLowerDataElements =
        this.sourceIndexer.hasLowerDataElements(prevGroup.sourcePathId,
                                                this.sourcePathId);
    
    if(!hasLowerDataElements) { // no raising, output equals input array
        
        if(this.projNum > 1) { // need reference counting

            var isNew = []; 
            
            for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {
                var sourceId = sourceElementIds[i];
                if(sourceId === undefined)
                    continue;
                if(this.sourceNodes.incNode(sourceId))
                    isNew[i] = sourceId;
            }

            return [sourceElementIds, isNew];
        }

        // no raising and a single projection, so all elements in
        // 'sourceElementIds' must have a reference count of 1
        return [sourceElementIds];
    }
    
    // need to raise (so may also need to reference count)

    var toMerge = []; // source nodes to merge
    var isNew = [];
    
    for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {
        var sourceId = sourceElementIds[i];
        if(sourceId === undefined)
            continue;
        var toMergeId = toMerge[i] = this.raiseToGroup(sourceId);
        if(this.projNum > 1 || toMergeId != sourceId) {
            // need to keep track of reference count
            if(this.sourceNodes.incNode(toMergeId))
                isNew[i] = toMergeId;
        } else
            isNew[i] = toMergeId;
    }

    return [toMerge, isNew];
}

// This function is only called for a minimal group which is not an identity
// group to implement the last step for a call to addSourceElements() for
// this group.
// This function checks whether the parents of the source nodes given
// in 'sourceElementIds' (which are the new source nodes mapped by this
// group) are needed in order to determine the dominating target nodes
// under which to merge by the minimal group. This returns undefined if
// the target path is the root path (there are then no dominating target
// nodes). Otherwise, this function goes over the data elements in
// 'sourceElementIds' and returns an array with the source parent IDs for
// these source elements at the immediate prefix source path of the source
// path of this group. There are several special cases:
// 1. The source path of this group is the root path. The in this case, the
//    parent source ID is always 0 for those elements in sourceElementIds
//    which are not undefined (and undefined for those which are).
// 2. Otherwise, if the source indexer does not have any data elements
//    defined at the source path of this group, the parent source IDs
//    are identical to the input source IDs. In this case, we only need
//    to record the fact that their identities are used (and return the
//    input array).
// In all other cases, we need to get the list of parents (by raising if
// needed), record the fact that their identity is used and return an
// array with those parent source IDs.
// If 'dontAddToIdentifiedChildren' is set to true, this function will not
// record the fact that the identity of these nodes is used
// (in the identifiedChildren table). This is intended for cases where this
// function is called to look up the parents of nodes already added.

MergeGroup.prototype.addSourceParents = 
    mergeGroupAddSourceParents;

function mergeGroupAddSourceParents(sourceElementIds,
                                    dontAddToIdentifiedChildren)
{
    var parentPath = this.targetPathNode.parent;
    if(parentPath === undefined)
        return undefined; // no dominating target nodes

    // get the immediate prefix of the source path (may be undefined if this
    // is the root path).
    var prefixPathId = this.qcm.getPrefix(this.sourcePathId);
    var parentIds = new Array(sourceElementIds.length);

    if(prefixPathId == undefined) { // parent ID is always 0
        if(this.isMaxGroup) { // no 'undefined' in array
            for(var i = 0, l = sourceElementIds.length ; i < l ; ++i)
                parentIds[i] = 0;
        } else {
            for(var i = 0, l = sourceElementIds.length ; i < l ; ++i)
                if(sourceElementIds[i] !== undefined)
                    parentIds[i] = 0;
        }
        return parentIds;
    }

    // determine whether any raising may need to be performed
    var hasLowerDataElements =
        this.sourceIndexer.hasLowerDataElements(this.sourcePathId,
                                                prefixPathId);

    for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {
        var sourceId = sourceElementIds[i];
        if(sourceId === undefined)
            continue;

        var parentId = parentIds[i] = hasLowerDataElements ?
            this.raiseToGroup(sourceId) : sourceId;
        var parentIdentity = this.getSourceIdentity(parentId);
        // record the fact that the source identity of this element Id is used
        if(!dontAddToIdentifiedChildren)
            this.addToIdentifiedChildren(sourceId, parentId, parentIdentity);
    }

    return parentIds;
}

// This function is only called on non-maximal groups (which are also
// not identity groups). 'sourceElements' are elements already raised
// to the source path of this group. But they are raised to the lowest
// possible element at this path, that is, in case of operators, to the
// lowest operand. This function then checks for each element whether it
// is domianted by an operator at this path and if it is, increases
// the reference count of that operator. If that operator is itself
// an operand at this node and it was first added here, its parent
// operator's reference count is also increased and the process continues
// recursively in this way (until there are no more dominating operators
// at this path or an operator is reached which was already added).
// This function returns an array containing the highest raised operator
// for each ID in the original array (or the original element ID if
// no raising took place) which was not added before.

MergeGroup.prototype.incOperatorRefCount = mergeGroupIncOperatorRefCount;

function mergeGroupIncOperatorRefCount(sourceElementIds)
{
    if(!this.sourceIndexer.pathHasOperands(this.sourcePathId))
        return sourceElementIds;

    var raised = [];
    
    for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {
        var sourceId = sourceElementIds[i];
        if(sourceId === undefined)
            continue;
        raised[i] = sourceId;
        var operatorIds = this.sourceIndexer.raiseToAllOperators(sourceId);
        if(operatorIds === undefined)
            continue;
        
        var operatorId;
        for(var j = 0, m = operatorIds.length ; j < m ; ++j) {
            operatorId = operatorIds[j];
            if(!this.sourceNodes.incNode(operatorId))
                break; // not first time added
            raised[i] = operatorId;
        }
    }

    return raised;
}

// This function is called when the merge group (still) has only one
// projection and the matches added so far by the group were not added
// the the SourceNodes object (so they were not reference counted).
// This function then adds all matches of the single projection already
// registered to this group to the SourceNodes object (thus reference counting
// them). This will typically be used when a second projection is about
// to be added to the group (so reference counting becomes necessary).
// This function is not called on identity groups (which always need to
// add their nodes to the SourceNodes object).
// If raising takes place (when this group is not minimal) then elements
// which were actually raised do not need to be added here (as raised
// elements are always added to the SourceNodes table, even when there is
// a single projection).

MergeGroup.prototype.refCountExistingProjMatches =
    mergeGroupRefCountExistingProjMatches;

function mergeGroupRefCountExistingProjMatches()
{
    // get the single projection
    var proj = this.getSingleProj();

    // check whether this projection already added any matches
    if(!this.targetIndexer.projAlreadyAddedMatches(proj.resultId,
                                                   proj.projId))
        return; // no matches to reference count

    var matches = proj.funcResult.getTerminalProjMatches(proj.projId);
    var needToRaise = false;

    // is any raising required? (never on a maximal group)
    if(!this.isMaxGroup) {
        // get the maximal group
        var maxGroup = this.targetIndexer.getProjMaxGroup(proj.resultId,
                                                          proj.projId);
        needToRaise = 
            this.sourceIndexer.hasLowerDataElements(maxGroup.sourcePathId,
                                                    this.sourcePathId);
    }
    
    if(!needToRaise) {
        // no raising required, so simply add the matches, as is
        for(var i = 0, l = matches.length ; i < l ; ++i)
            this.sourceNodes.incNode(matches[i]);
    } else {

        // raise each match and only reference count when the result of raising
        // is equal to the non-raised element (raised matches were already
        // reference counted).

        for(var i = 0, l = matches.length ; i < l ; ++i) {
            var sourceId = matches[i];
            var raisedId = this.raiseToGroup(sourceId);
            if(sourceId == raisedId)
                this.sourceNodes.incNode(sourceId);
        }
    }
}

// This function is called when the number of projections in the merge group
// has just dropped from 2 to 1, which means that no reference counting
// of the source nodes added is needed anymore (this is not called on
// an identity group). This is called after the other projections have been
// reoved, so only the matches of the last remaining projection remain.
// This function then removes the reference count of the matches of this
// last projection from the SourceNodes object (this is needed, since if
// later refernece counting is again required, leaving those matches would
// result in corrupted reference counting).
// All matches must be removed, except for those which are raised
// (raised matches are always reference counted).

MergeGroup.prototype.clearRefCountOfRemainingProjMatches =
    mergeGroupClearRefCountOfRemainingProjMatches;

function mergeGroupClearRefCountOfRemainingProjMatches()
{
    // get the single projection
    var proj = this.getSingleProj();

    // check whether this projection already added any matches
    if(!this.targetIndexer.projAlreadyAddedMatches(proj.resultId,
                                                   proj.projId))
        return; // no matches to remove their reference count

    var matches = proj.funcResult.getTerminalProjMatches(proj.projId);
    var needToRaise = false;

    // is any raising required? (never on a maximal group)
    if(!this.isMaxGroup) {
        // get the maximal group
        var maxGroup = this.targetIndexer.getProjMaxGroup(proj.resultId,
                                                          proj.projId);
        needToRaise = 
            this.sourceIndexer.hasLowerDataElements(maxGroup.sourcePathId,
                                                    this.sourcePathId);
    }
    
    if(!needToRaise) {
        // no raising required, so remove all nodes
        this.sourceNodes.clear();
    } else {

        // raise each match and only remove when the result of raising
        // is equal to the non-raised element (raised matches must remain
        // reference counted).

        for(var i = 0, l = matches.length ; i < l ; ++i) {
            var sourceId = matches[i];
            var raisedId = this.raiseToGroup(sourceId);
            if(sourceId == raisedId)
                this.sourceNodes.decNode(sourceId);
        }
    }
}

///////////////////////////
// Source Element Lookup //
///////////////////////////

// This function is similar in nature (and interface) to addSourceElements()
// except that it is called for source elements which were already added
// and therefore only generates the list of nodes to be merged, without
// changing the reference counts of the source nodes.
// Moreover, if this is an identity group, the source IDs received as
// input here are the identity node IDs and not the original source IDs.
// This means that this function does not need to perform any conversion
// from source indexer source IDs to identity node IDs. 
// This function is called with a list (array) of element IDs 'sourceElementIds'
// which were mapped by a projection belonging to this group, if it is
// a maximal group, or by a group which has this group as a prefix group
// if this is a non-maximal group. It is also called with a target path node,
// which is either the target path node of this group or of one of its
// dominating groups. Finally, it is called with a flag which indicates
// whether the list of source elements to generate should also include
// source nodes for the group whose target path is equal to the given
// target path or whether the process should stop at the previous group
// (this saves the calling function then need to figure out which target
// path is the one before the given target path, as this is easily discovered
// during the process which takes place inside this function).
// This function returns an array of arrays, the first for this
// group and the following arrays for its prefix groups, up to the
// prefix group which has the given target path (including that group if
// 'underTargetPath' is false and excluding that group if 'underTargetPath'
// is true).
// If targetPathNode is not specified or is a prefix of the target path
// of the minimal group, this function continues all the way to the
// minimal group and then, if the target path of the minimal group is
// not the root path, adds the 'dominating parents' of the source
// nodes (these are returned as the last array). The behavior here is
// to that of 'addSourceElements()'.
// In each array, the set of elements dominating the input elements and
// mapped by this group are given. The same position in the different
// arrays represents a set of elements domianting each other.
// The source nodes are raised to the lowest domianting node at the source
// path of each group ('lowest' meaning that if there is an operator
// with operands, the operand and not the operator appears). If the group
// is an identity group, the identity node ID is returned.

MergeGroup.prototype.getSourceElements = mergeGroupGetSourceElements;

function mergeGroupGetSourceElements(sourceElementIds, targetPathNode,
                                     underTargetPath, prevGroup)
{
    var toMerge;
    
    if(this.isIdentityGroup) {
        // must be the last group
        toMerge = sourceElementIds;

        // do we also need to return an array for the dominating nodes?
        if(this.targetPathNode.parent === undefined ||
           this.targetPathNode === targetPathNode)
            return [toMerge]; // no need for the dominating nodes

        if(this.isDominated())
            return [toMerge, toMerge]; // identity nodes are also dominating

        // dominating are all zeros
        var dominating = new Array(toMerge.length);
        for(var i = 0, l = dominating.length ; i < l ; ++i)
            dominating[i] = 0;

        return [toMerge, dominating];
    }

    // determine whether any raising may need to be performed
    var hasLowerDataElements = (prevGroup !== undefined) && 
        this.sourceIndexer.hasLowerDataElements(prevGroup.sourcePathId,
                                                this.sourcePathId);

    if(!hasLowerDataElements)
        toMerge = sourceElementIds;
    else {
        toMerge = new Array(sourceElementIds.length);
        for(var i = 0, l = sourceElementIds.length ; i < l ; ++i)
            toMerge[i] = this.raiseToGroup(sourceElementIds[i]);
    }
    
    if(this.prefixGroup === undefined) {
        if(this.targetPathNode == targetPathNode)
            return [toMerge];
        // also need to return the dominating parents
        var sourceParents = this.addSourceParents(toMerge, true);
        return (sourceParents === undefined) ?
            [toMerge] : [toMerge, sourceParents];
    } else if(this.targetPathNode == targetPathNode ||
              (underTargetPath &&
               this.prefixGroup.targetPathNode == targetPathNode))
        return [toMerge]; // last group to map

    var allToMerge = this.prefixGroup.getSourceElements(toMerge, targetPathNode,
                                                        underTargetPath, this);
    allToMerge.unshift(toMerge);
    return allToMerge;
}

////////////////////////////
// Source Element Removal //
////////////////////////////

// This function is the equivalent of addSourceElements() for removal.
// When a projection removes matches from the merge indexer, this
// function is first called on the maximal group of the projection with
// 'sourceElementIds' being an array of the element IDs which are removed.
// It is then called recursively on the prefix groups with 'sourceElementIds'
// being each time the source elements which were removed at the previous
// group.
// 'resultId' and 'projId' identify the projection. 'prevGroup' is undefined
// when this function is called on the maximal group and is the previous
// group on which this function was called when the function is called
// recursively on the prefix group of 'prevGroup'. To determine which
// nodes need to be removed, this function first performs any raising
// which needs to take place (needed only on non-maximal groups) and then
// decreases the reference count if needed (in those cases where reference
// counting takes place, see 'addSourceElements()'). Those nodes whose
// reference count reached zero are those nodes which are to be removed
// (when no reference counting takes place, the reference count is implicitly
// one and therefore drops to zero). The recursive call takes place with
// the source elements of the previous group after they have been raised
// and includes only those nodes whose reference count dropped to zero.
// When this function is called on a minimal group (which is not an identity
// group) if the target path is not the root path, the dominating nodes
// under which the source nodes were merged are determined by identity.
// For those source nodes which are removed at this group, information stored
// to trace these identities and to allow proper merging is cleared.
// Finally, for identity groups a similar process takes place, except that
// the removed nodes are the identity source nodes (alllocated by the
// SourceNodes object).
// This function returns an array of arrays, the first array for this group
// and an additional array for each of its prefix groups (ordered from
// longest paths to shortest). Each array holds those element IDs which
// were removed at the corresponding group. The arrays are aligned so that
// each position in the array from a prefix group represents an element
// dominating the element at the corresponding position in the array for
// the previous group. 'undefined' appear where elements are not removed
// (because the reference count did not drop to zero). In case operators
// exist, the highest operator removed at a group is returned in the array
// corresponding to that group.

MergeGroup.prototype.removeSourceElements = 
    mergeGroupRemoveSourceElements;

function mergeGroupRemoveSourceElements(sourceElementIds, resultId, projId,
                                        prevGroup)
{
    if(this.isIdentityGroup) // special handling of identity group
        return this.removeIdentityElements(sourceElementIds, prevGroup);

    if(this.isMaxGroup)
        // special case: no raising and duplicates are removed from array
        return this.removeSourceElementsFromMax(sourceElementIds, resultId,
                                                projId);

    // non-maximal, non-identity group
    
    // determine whether any raising may need to be performed
    var hasLowerDataElements =
        this.sourceIndexer.hasLowerDataElements(prevGroup.sourcePathId,
                                                this.sourcePathId);
    var toRemove = []; // source nodes remove at this group

    if(this.projNum == 1 && !hasLowerDataElements) {
        toRemove = !this.sourceIndexer.pathHasOperands(this.sourcePathId) ?
            sourceElementIds : [].concat(sourceElementIds);
    } else { // may need to update and check reference count
        for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {
            var sourceId = sourceElementIds[i];
            if(sourceId === undefined)
                continue;
            var toRemoveId = hasLowerDataElements ?
                this.raiseToGroup(sourceId) : sourceId;

            if(this.projNum > 1 || toRemoveId != sourceId) {
                // need to keep track of reference count
                if(this.sourceNodes.decNode(toRemoveId) == 0) // last instance
                    toRemove[i] = toRemoveId;
            } else
                toRemove[i] = toRemoveId;
        }
    }

    // if there are operands at this path, decrease reference count
    // for the operators dominating the operands. This may affect
    // 'toRemove' (additional raising) and the list propagated to the
    // prefix group.
    var toPropagate;
    if(this.sourceIndexer.pathHasOperands(this.sourcePathId))
        toPropagate = this.decOperatorRefCount(toRemove);
    else
        toProagate = toRemove;
    
    // recusrive call
    if(this.prefixGroup !== undefined) {
        var allToRemove =
            this.prefixGroup.removeSourceElements(toPropagate, resultId, projId,
                                                  this);
        allToRemove.unshift(toRemove);
        return allToRemove;
    }
    
    // this is the minimal group, remove parent identification information
    // if needed (if target path is not the root).
    this.removeSourceParents(toPropagate);
    return [toRemove];
}

// This function implements 'removeSourceElements()' for an identity group.
// The documentation of that function also covers the case implemented
// by this function.

MergeGroup.prototype.removeIdentityElements = 
    mergeGroupRemoveIdentityElements;

function mergeGroupRemoveIdentityElements(sourceElementIds, prevGroup)
{
    // There may be operators dominating the source node at the same path.
    // We need to find the highest such dominating operator, as this is
    // the node whose identity determines the identity node.
    var raiseToOperator = this.sourceIndexer.pathHasOperands(this.sourcePathId);
    
    var parentPath = this.targetPathNode.parent; // may be undefined
    
    // true if both source and target paths of the group are not the root path
    // (if isDominated is true, parentPath must be defined).
    var isDominated = this.isDominated();
    var toRemove = []; // the identity source IDs to remove
    
    for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {

        var sourceId = sourceElementIds[i];
        if(sourceId === undefined)
            continue; // was already not removed by the next group
        
        if(raiseToOperator) { // may need to raise to a dominating operator
            var raisedId =
                this.sourceIndexer.raiseToOperator(sourceElementId,
                                                   this.sourcePathId);
            if(raisedId !== sourceId) {
                this.sourceNodes.decRaised(raisedId);
                sourceId = raisedId;
            }
        }

        // the SourceNodes object calculates the identity node ID
        // and decreases there reference count for this idnetity node ID.
        var decResult = this.sourceNodes.decNode(sourceId);
        var idNodeId = decResult.idNodeId;

        if(decResult.count == 0) {
            if(this.isMaxGroup)
                toRemove.push(idNodeId);
            else
                toRemove[i] = idNodeId;
        }
        
        if(decResult.count > 0 || parentPath === undefined)
            continue;

        // there is a parent target path, need to clear information stored to
        // determine dominating node
        
        // clear the identity node mapped by the minimal group from
        // 'childrenByIdentity' under the identity of the parent node.
        var parentId = isDominated ? idNodeId : 0;
        var parentIdentity = isDominated ?
            decResult.parentIdentity : this.sourceNodes.getSourceIdentity(0);
            
        parentPath.childrenByIdentity.removeChild(parentId, idNodeId,
                                                  this.groupId);
    }
    
    return [toRemove];
}

// This function implements 'removeSourceElements()' for a maximal group
// which is not an identity group.
// The documentation of that function also covers the case implemented
// by this function. Here, the array of source elements constructed
// only includes source IDs which may be removed (that is, whose reference
// count dropped to zero). In addition, no raising can take place here.
// Note: at the maximal group, the source elements are those mapped by
// the projection. In case of operators with operands, the projection
// is required not to map operands, but only their dominating operators
// (so that no partial mapping of the object under the operator is possible).
// Therefore, as opposed to non-maximal groups, there is no need to
// decrease reference count of dominating operators for the maximal group.

MergeGroup.prototype.removeSourceElementsFromMax =
    mergeGroupRemoveSourceElementsFromMax;

function mergeGroupRemoveSourceElementsFromMax(sourceElementIds, resultId,
                                               projId)
{
    var toRemove;

    if(this.projNum == 1)
        toRemove = sourceElementIds; // no duplicates possible
    else {
        toRemove = [];
        for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {
            var sourceId = sourceElementIds[i];
            if(this.sourceNodes.decNode(sourceId) == 0) // last instance removed
                toRemove.push(sourceId);
        }
    }
    
    if(this.prefixGroup) { // call recursively
        var allToRemove =
            this.prefixGroup.removeSourceElements(toRemove, resultId, projId,
                                                  this);
        // allToRemove is very short, so unshift is OK
        allToRemove.unshift(toRemove);
        return allToRemove;
    }

    // this is the minimal group, remove parent identification information
    // if needed (if target path is not the root).
    this.removeSourceParents(toRemove);

    return [toRemove];
}

// This function takes as input an array of source element IDs which are
// about to be removed at this group (which is not a maximal group and not
// an identity group). It then checks whether these are operands dominated
// by operators. For those elements which are, the reference count of
// dominating operators (at the source path of the group) is decreased
// and the highest operator whose reference count dropped to zero is
// replaces the operand raised in the array 'sourceElementIds'.
// The function returns a subset of the array 'sourceElementIds'
// (aligned with that array such that elements which are not included
// in the returned array have 'undefined' in the corresponding position
// of the array). This subset consists of those elements in 'sourceElementIds'
// (after the raising to the operators) such that the element cannot be
// raised further to an operator at this node (this means that there is
// no dominating operator at this node whose reference count did drop
// to zero yet).

MergeGroup.prototype.decOperatorRefCount =
    mergeGroupDecOperatorRefCount;

function mergeGroupDecOperatorRefCount(sourceElementIds)
{
    if(!this.sourceIndexer.pathHasOperands(this.sourcePathId))
        return sourceElementIds;

    var fullyRaised = [];
    
    for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {
        var sourceId = sourceElementIds[i];
        if(sourceId === undefined)
            continue;
        var operatorIds = this.sourceIndexer.raiseToAllOperators(sourceId);
        if(operatorIds === undefined) {
            fullyRaised[i] = sourceId;
            continue;
        }
        var operatorId;
        for(var j = 0, m = operatorIds.length ; j < m ; ++j) {
            operatorId = operatorIds[j];
            if(this.sourceNodes.decNode(operatorId) > 0) {
                operatorId = undefined;
                break; // reference count did not drop to zero
            } else
                sourceElementIds[i] = operatorId;
        }
        if(operatorId !== undefined)
            fullyRaised[i] = operatorId;
    }

    return fullyRaised;
}

// This function is only called for a minimal group which is not an identity
// group to remove registrations made by the function addSourceParent()
// for the given elements (which are to be removed) when thy were added.
// This function checks whether the parents of the source nodes given
// in 'sourceElementIds' (which are the source nodes removed from those
// mapped by this group) are needed in order to determine the dominating
// target nodes under which to merge by the minimal group. This returns
// immediately if the target path is the root path (there are then no
// dominating target nodes). Otherwise, this function goes over the data
// elements in 'sourceElementIds' and finds the source parent IDs for
// these source elements at the immediate prefix source path of the source
// path of this group. There are several special cases:
// 1. The source path of this group is the root path. The in this case, the
//    parent source ID is always 0 and there is nothg to do here.
// 2. Otherwise, if the source indexer does not have any data elements
//    defined at the source path of this group, the parent source IDs
//    are identical to the input source IDs.
// In all other cases, we need to get the list of parents (by raising if
// needed). We then record the fact that their identity is not used anymore.

MergeGroup.prototype.removeSourceParents =
    mergeGroupRemoveSourceParents;

function mergeGroupRemoveSourceParents(sourceElementIds)
{
    var parentPath = this.targetPathNode.parent;
    if(parentPath === undefined)
        return; // no dominating target nodes

    // get the immediate prefix of the source path (may be undefined if this
    // is the root path).
    var prefixPathId = this.qcm.getPrefix(this.sourcePathId);
    if(prefixPathId == undefined)
        return; // domianting identity is always 0

    // determine whether any raising may need to be performed
    var hasLowerDataElements =
        this.sourceIndexer.hasLowerDataElements(this.sourcePathId,
                                                prefixPathId);

    if(!hasLowerDataElements) {
        // parent ID is the same as the source ID
        for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {
            var sourceId = sourceElementIds[i];
            if(sourceId === undefined)
                continue;
            // remove the registration of the fact that the source identity
            // of this element Id is used
            this.removeFromIdentifiedChildren(sourceId, sourceId);
        }
    } else {
        for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {
            var sourceId = sourceElementIds[i];
            if(sourceId === undefined)
                continue;

            var parentId = this.raiseToGroup(sourceId);
            // remove the registration of the fact that the source identity
            // of this element Id is used
            this.removeFromIdentifiedChildren(sourceId, parentId);
        }
    }
}

MergeGroup.prototype.clearAllSourceElements = mergeGroupClearAllSourceElements;

function mergeGroupClearAllSourceElements()
{
    // clear recursively all source elements of the next groups

    if(this.nextGroups !== undefined) {
        for(var i = 0, l = this.nextGroups ; i < l ; ++i)
            this.nextGroups[i].clearAllSourceElements();
    }

    // clear the source nodes table
    this.sourceNodes.clear();

    var parentPath;
    
    if(this.prefixGroup === undefined &&
       (parentPath = this.targetPathNode.parent) !== undefined) {
        // minimal group with non-root target path, need to clear entries
        // for this group added in the 'childrenByIdentity' table of the
        // parent path
        if(parentPath.childrenByIdentity)
            parentPath.childrenByIdentity.removeGroup(this.groupId);
    }
}

///////////////////////////////////
// Identification Administration //
///////////////////////////////////

// This function is called when this is a minimal group (which is not
// an identity group) and both its target and source paths are not the
// root path. In this case, the identity of the dominating nodes
// (at the prefix of the target path) under which the nodes are to be
// mapped are determined by the source identity of the parent source
// node of the source node being mapped (where the parent source node is
// the dominating node at the immediate prefix path of the source path).
// This source parent ID and its identity are determined by the calling
// function and are provided here as 'parentSourceId' and
// 'parentSourceIdentity' (while 'sourceId' is the source ID of the
// element being mapped by this group). This function then records
// the fact that this source identity was used in the list of children
// by identity on the parent target path (when nodes are added to the parent
// target path this allows the candidates for merging under them to be found).

MergeGroup.prototype.addToIdentifiedChildren =
    mergeGroupAddToIdentifiedChildren;

function mergeGroupAddToIdentifiedChildren(sourceId, parentSourceId,
                                           parentSourceIdentity)
{
    // must be defined when this function is called
    var parentTargetPath = this.targetPathNode.parent;
    
    if(parentTargetPath.childrenByIdentity === undefined)
        parentTargetPath.childrenByIdentity = new ChildrenByIdentity();
    parentTargetPath.childrenByIdentity.
        addChild(parentSourceIdentity, parentSourceId, sourceId, this.groupId);
}

// This function removes registrations made by addToIdentifiedChildren().
// This function is called when this is a minimal group (which is not
// an identity group) and both its target and source paths are not the
// root path. In this case, the identity of the dominating nodes
// (at the prefix of the target path) under which the nodes are to be
// mapped are determined by the source identity of the parent source
// node of the source node being mapped (where the parent source node is
// the dominating node at the immediate prefix path of the source path).
// This source parent ID is determined by the calling function and is
// provided here as 'parentSourceId' (while 'sourceId' is the source ID of the
// element being mapped by this group). This function remove the registration
// of the fact that this source identity was used from the list of children
// by identity on the parent target path (when nodes are added to the parent
// target path this allows the candidates for merging under them to be found).

MergeGroup.prototype.removeFromIdentifiedChildren =
    mergeGroupRemoveFromIdentifiedChildren;

function mergeGroupRemoveFromIdentifiedChildren(sourceId, parentSourceId)
{
    // must be defined when this function is called
    var parentTargetPath = this.targetPathNode.parent;
    
    parentTargetPath.childrenByIdentity.
        removeChild(parentSourceId, sourceId, this.groupId);
}

////////////////////
// Identity Nodes //
////////////////////

// The following functions should only be used on identity groups. They
// provide access to information concerning the identity node IDs
// and the related identities and source nodes.

// This function should only be called on an identity group for which
// isDominated() is true. For the given identity node ID (allocated
// by the SourceNodes object of this group) this function returns the
// identity of the parent source nodes for the nodes to which this
// identity node ID is assigned.

MergeGroup.prototype.getParentIdentity = mergeGroupGetParentIdentity;

function mergeGroupGetParentIdentity(idNodeId)
{
    return this.sourceNodes.getParentIdentity(idNodeId);
}

// This function should only be called if this group is an identity group.
// This function is called when the source identity of the elements in the
// array 'sourceIds' changes. 'newIdentities' are the new identities
// of these element IDs (the old identity can still be retrieved from
// the source indexer at this point).
// This function first determines the reference count of each of the
// input source elements as a source element maped by this node.
// For those nodes where the reference count is not zero, the identity
// change is forwarded to the SourceNodes object,
// which is responsible for keeping track of the identities mapped by this
// group and the identity node IDs assigned to them. The SourceNodes
// object is responsible for decreasing the reference count for the old
// identity and increasing the reference count for the new identity, possibly
// also allocating a new identity node ID for the new identity (in case
// it is added for the first time).
// The main task of the current function is to determine the reference count
// with which each source ID was added to the group and whether teh source ID
// itself was added or the source ID is the parent ID of a source node added.
// If this group uses parent IDs to determine the dominating nodes
// to merge under (this is iff 'isDominated()' is true), this function
// also checks whether each source ID is in the 'parents' table of the
// SourceNodes (which also provides it with a reference count). If it is,
// the SourceNodes is also update for the change in parent identity.
// Having udated the SourceNodes objects, this function then returns an object
// of this form (where 'parentIdentity' only appears when that identity
// is used for determining the domianting nodes):
// {
//    added: <array of new identity nodes added, each represented by an object:
//             {
//                 idNodeId: <identity node ID>
//                 parentIdentity: <parent identity for this identity node>
//             }
//           >,
//    removed: <array of identity node IDs just removed>
// }
// where 'added' and 'removed' are the identity nodes added and removed
// as a result of this identity update.
// Note that a node which was removed cannot be added again (because the
// new node for the same identities will have a new ID). A node added
// cannot be usually removed (because its positive reference count resulting
// from one node update cannot be undone by changing the identity of another
// node) unless there is also an update for the identity of its parent.
// However, the identity updates for a source node and its parent may never
// appear in the same update call (because they have different paths)
// so it is guaranteed that the 'added' and 'removed' lists are disjoint.

MergeGroup.prototype.updateIdentity = mergeGroupUpdateIdentity;

function mergeGroupUpdateIdentity(sourceIds, newIdentities)
{
    var refCount = this.getRefCount(sourceIds);
    var added = [];
    var removed = [];

    // first, update source nodes of the group (not parents)
    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
        var count = refCount[i];
        if(count == 0)
            continue;
        var update = this.sourceNodes.updateIdentity(sourceIds[i], count,
                                                     newIdentities[i]);
        if(update.added.length > 0)
            added = cconcat(added, update.added);
        if(update.removed.length > 0)
            removed = cconcat(removed, update.removed);
    }

    if(!this.isDominated() || this.sourceNodes.numParents() == 0)
        return { added: added, removed: removed }; // no parent identity changes

    // check for parent identity changes
    
    for(var i = 0,  l = sourceIds.length ; i < l ; ++i) {

        if(refCount[i] > 0)
            continue; // source node of group, cannot be parent

        var sourceId = sourceIds[i];
        if(this.sourceNodes.getParentCount(sourceId) == 0)
            continue;

        var childIds =
            this.sourceIndexer.getDirectChildDataElements(sourceId,
                                                          this.sourcePathId);
        var childCount = this.getRefCount(childIds);
        var update =
            this.sourceNodes.updateParentIdentity(childIds, childCount,
                                                  sourceId, newIdentities[i]);
        if(update.added.length > 0)
            added = cconcat(added, update.added);
        if(update.removed.length > 0)
            removed = cconcat(removed, update.removed);
    }

    return { added: added, removed: removed };
}

// This function should only be called on an identity group. xxxxxxxxxxxxxx

MergeGroup.prototype.getSourceNodesOfIdentities =
    mergeGroupGetSourceNodesOfIdentities;

function mergeGroupGetSourceNodesOfIdentities(identityNodeIds)
{
    assert(false, "still needs to be implemented");
    // xxxxxxxxxxxxxxxxxx
}

//////////////////////////
// Ordering Propagation //
//////////////////////////

// This function returns the comparison information for the function result
// which is mapped by this group. This returns undefined or a CompInfo object.
// This function only returns a result if there is a single projection
// associated with this group. Otherwise, undefined is returned.

MergeGroup.prototype.getDominatedComparison = mergeGroupGetDominatedComparison;

function mergeGroupGetDominatedComparison()
{
    // get the dominated comparison

    var domCompInfo;
    
    var proj = this.getSingleProj();
    if(proj !== undefined)
        domCompInfo = proj.funcResult.getDominatedComparison();

    if(!this.isIdentityGroup)
        return domCompInfo; // no extra sorting by the group

    // identification adds its own sorting
    
    return new MergeGroupCompInfo(this, domCompInfo);
}

// This function is called when the given function result node (which should
// be a DataResult node) is registered to a target path of this group and
// has become order*. The function then registers it as composed order*
// with the function results mapping through this group.

MergeGroup.prototype.addOrderStarFunc = mergeGroupAddOrderStarFunc;

function mergeGroupAddOrderStarFunc(composedFunc)
{
    this.mappings.forEach(function(entry, resultId) {
        entry.funcResult.addOrderStarFunc(composedFunc);
    });
}

// This function is called when the function result node with the given
// ID, which was registered to a target path of this group and
// was order*, no longer fulfills these conditions. The function then
// unregisters it as composed order* from the function results mapping
// through this group.

MergeGroup.prototype.removeOrderStarFunc = mergeGroupRemoveOrderStarFunc;

function mergeGroupRemoveOrderStarFunc(composedFuncId)
{
    this.mappings.forEach(function(entry, resultId) {
        entry.funcResult.removeOrderStarFunc(composedFuncId);
    });
}

// Add all order* functions from the given target path node to the mappings
// of this group.

MergeGroup.prototype.addAllOrderStarFuncsFromPath =
    mergeGroupAddAllOrderStarFuncsFromPath;

function mergeGroupAddAllOrderStarFuncsFromPath(targetPathNode)
{
    if(this.mappings ===  undefined || this.mappings.size === 0)
        return;

    var mappings = this.mappings;
    
    if(targetPathNode.composedOrderStar !== undefined)
        targetPathNode.composedOrderStar.forEach(function(composedFunc,
                                                          composedFuncId) {
            mappings.forEach(function(entry, resultId) {
                entry.funcResult.addOrderStarFunc(composedFunc);
            });
        });
}

// Remove all order* functions from the given target path node from the mappings
// of this group.

MergeGroup.prototype.removeAllOrderStarFuncsFromPath =
    mergeGroupRemoveAllOrderStarFuncsFromPath;

function mergeGroupRemoveAllOrderStarFuncsFromPath(targetPathNode)
{
    if(this.mappings ===  undefined || this.mappings.size === 0)
        return;

    var mappings = this.mappings;
    
    if(targetPathNode.composedOrderStar !== undefined)
        targetPathNode.composedOrderStar.forEach(function(composedFunc,
                                                          composedFuncId) {
            mappings.forEach(function(entry, resultId) {
                entry.funcResult.removeOrderStarFunc(composedFuncId);
            });
        });
}

///////////////////////////
// Target ID Translation //
///////////////////////////

// This function returns true if any source ID -> target ID translation
// applies to source IDs mapped by this group.

MergeGroup.prototype.hasSourceIdTranslation = mergeGroupHasSourceIdTranslation;

function mergeGroupHasSourceIdTranslation()
{
    return (this.sourceDataElements !== undefined &&
            !this.sourceDataElements.isEmpty());
}

// This function takes a set (array) of source IDs mapped by this
// group at the given target path and returns an array of target IDs
// (or an array of arrays of target IDs) to which these source IDs
// were mapped. The target IDs are determined by looking them up in the
// group's element ID translation table. If 'origSourceIfNotTranslated' is
// set, the function returns the original source ID as its target ID if no
// translation is found in the table.
// 'returnFlat' indicates whether all target IDs should be returned in
// one array (in which case, if there are multiple target IDs for the same
// source ID the alignment between the input source IDs and the target IDs
// is lost) or in an array of arrays, where each position in the returned
// array holds an array of target IDs to which the source ID in the
// corresponding position in the 'sourceIds' array is mapped to (such an
// array may be empty).

MergeGroup.prototype.getAllTargetIdsAtPath = mergeGroupGetAllTargetIdsAtPath;

function mergeGroupGetAllTargetIdsAtPath(sourceIds, targetPathId,
                                         origSourceIfNotTranslated,
                                         returnFlat)
{
    if(this.sourceDataElements === undefined ||
       this.sourceDataElements.isEmpty()) {
        if(!origSourceIfNotTranslated)
            return [];
        if(returnFlat)
            return sourceIds;
        var targetIds = new Array(sourceIds.length);
        for(var i = 0, l = sourceIds.length ; i < l ; ++i)
            targetIds[i] = [sourceIds[i]];
        return targetIds;
    }

    return this.sourceDataElements.
        getAllTargetIdsAtPath(sourceIds, targetPathId,
                              origSourceIfNotTranslated, returnFlat);
}

// This function returns the translated target ID for the given source ID,
// target path and dominating ID. If no such target ID is found, undefined
// is returned (that is, in case no translation took place).

MergeGroup.prototype.getTargetId = mergeGroupGetTargetId;

function mergeGroupGetTargetId(sourceId, targetPathId, dominatingId)
{
    if(this.sourceDataElements === undefined ||
       this.sourceDataElements.isEmpty())
        return undefined;

    return this.sourceDataElements.getTargetId(sourceId, targetPathId,
                                               dominatingId);
}

// This function receives a set (array) of source IDs mapped under the
// dominating target IDs given in 'dominatingIds' (one dominating ID
// per source ID) and assigned a target ID to the source ID and the given
// dominating ID. These target IDs are returned in an array. If
// 'equalToDominating' is true, the source ID should be translated to
// a target ID equal to the dominating ID (the calling function must verify
// that this is the correct thing to do, which requires that teh dominating
// ID was mapped fro the same source ID by this group). Otherwise, the
// source IDs are mapped to new data element IDs (and are data elements
// at the target path).
// 'dominatingIds' may also be undefined if targetPathNode is the root
// path. In this case, the function always assigns new data element IDs
// to the source IDs.

MergeGroup.prototype.translateSourceIds = mergeGroupTranslateSourceIds;

function mergeGroupTranslateSourceIds(targetPathId, sourceIds, dominatingIds,
                                      equalToDominating)
{
    if(this.sourceDataElements === undefined) {
        this.sourceDataElements =
            new MappedDataElements(this.qcm.getRootPathId());
    }
    
    var translation = this.sourceDataElements;
    var targetIds = [];
    
    if(dominatingIds === undefined) {
        for(var i = 0, l = sourceIds.length ; i < l ; ++i)
            targetIds.push(translation.addTargetId(sourceIds[i], targetPathId,
                                                   undefined, false));
    } else {
        for(var i = 0, l = sourceIds.length ; i < l ; ++i)
            targetIds.push(translation.addTargetId(sourceIds[i], targetPathId,
                                                   dominatingIds[i],
                                                   equalToDominating));
    }

    return targetIds;
}

//////////////////////////
// Merge Group Ordering //
//////////////////////////

// The CompInfo object to represent the comparison induced by a merge group
// (currently, only when the group is an identity group).

inherit(MergeGroupCompInfo, CompInfo);

function MergeGroupCompInfo(mergeGroup, domCompInfo)
{
    this.CompInfo(mergeGroup);
    this.domCompInfo = domCompInfo;
}

// This function generates a comparison function based on the properties
// in this CompInfo object and returns the function. Using closure, the
// returned function contains enough information to perform the comparison.

MergeGroupCompInfo.prototype.getCompareFunc = mergeGroupCompInfoGetCompareFunc;

function mergeGroupCompInfoGetCompareFunc()
{
    var mergeGroup = this.compResult;
    var targetDataElements = mergeGroup.targetIndexer.dataElements;
    var compression = mergeGroup.qcm.compression;
    var domCompFunc;
    
    if(this.domCompInfo !== undefined)
        domCompFunc = this.domCompInfo.getCompareFunc();

    return function(elementId1, elementId2) {

        var identity1 = targetDataElements.getBaseIdentity(elementId1);
        var identity2 = targetDataElements.getBaseIdentity(elementId2);

        if(identity1 == identity2)
            return (elementId1 - elementId2);

        if(identity1 === undefined)
            return -1;

        if(identity2 === undefined)
            return 1;
        
        if(identity1 * identity2 <= 0)
            return (identity1 - identity2);

        // both identities have same sign
        
        if(identity1 > 0) { // the identities are data element IDs
            var cmp = 0;
            if(domCompFunc !== undefined)
                cmp = domCompFunc(elementId1, elementId2);
            if(cmp === 0)
                return (elementId1 - elementId2);
            else
                return cmp;
        } else if(identity1 == identity2) {
            return (elementId1 - elementId2);
        } else {
            var key1 = compression.getSimpleValue(-identity1);
            var key2 = compression.getSimpleValue(-identity2);

            if(key1 === key2)
                return (elementId1 - elementId2);
            
            if(key1 === undefined)
                return -1;

            if(key2 === undefined)
                return 1;

            if(key1.type != key2.type)
                return key1.type < key2.type ? -1 : 1;

            if(key1.type == "range")
                return 0; // must be empty range
            
            if(key1.roundedValue == key2.roundedValue)
                return 0;
            
            return key1.roundedValue < key2.roundedValue ? -1 : 1
        }
    }
}
