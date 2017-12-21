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


// This file implements the tables which stores information about unmapped
// nodes at a path node. The information is stored in three tables, allowing
// for quick access in various situations.
//
// Note: as explained in mergeIndexer.js, operand source nodes (nodes
// which are operands at the source) can never be unmapped (because 
// when then the operator would have already been unmapped and the operands
// would not be merged). Therefore, no operand nodes are stored here as
// unmapped nodes.
// 
// The first table is indexed by the source data element ID of the unmapped 
// node. This allows one to quickly check whether a certain source node 
// was already merged (by a specific group) and that it was merged as 
// unmapped. Moreover, this table allows one to find the dominating
// nodes under which the node is unmapped. When a child of the source
// node has to be merged, this information is required in order to 
// determined under which mapped nodes the child node could be merged.
//
// As the same source node ID can be merged by different groups, this
// table stores under the entry for each source node the
// list of groups which merged it to this path as unmapped. If this
// table is not stored at the root path node, the table must also
// indicate under which dominating node(s) this source node was merged
// as unmapped (by each of these groups).
//
// This table also stores the source identity of each unmapped node 
// (this depends on the group, so it is stored under each group ID 
// separately).
//
// The second table stores the unmapped nodes indexed by their dominating
// node (unless the table is at the root path node, where there is no
// dominating node), which is the node under which they were merged as 
// unmapped, and the priority of the groups which merged the unmapped node.
// This table is used when the higher priority nodes merged at the
// same path and under the same dominating node(s) are removed. When
// this happens, the system needs to find the highest priority unmapped
// nodes under the dominating node and make them into mapped nodes.
//
// The thir table stores the unmapped nodes based on their identity and
// their domianting node. This is used when new non-terminals become 
// available and we need to find unmapped nodes which can be merged
// under these non-terminals (if the non-terminals are operators) or 
// whose children can be merged under the non-terminals (if the non-terminals
// are standard non-terminals). In both cases, merging is based on
// identity and dominating node.
// 
// The table has two variants: one for using at the root path node (where
// the unmapped nodes have no dominating node) and one for use at other path
// nodes. The interface of the two classes is the same except for the
// dominating node argument, which is missing in the root path node
// variant.
// Remark: in practice, the variant for non-root-path paths is used also 
// for root paths. This is because operators may introduce a dominating
// node. Even though this happens very rarely, it does not seem that
// using the non-root-path variant also for the root path causes any 
// problem.
//
// UnmappedNodes
// -------------
//
// This is the class to be used at non-root path nodes.
//
// {
//     bySourceId: {
//         <source data element ID>: {
//             groupNum: <number of groups below>
//             groups: {
//                 <group ID>: {
//                     identity: <source identity for this node and group>
//                     dominatingNum: <number of dominating nodes below>
//                     dominating: {
//                         <dominating element ID>: true
//                         .....
//                     }
//                 }
//                 .....
//             }
//         }
//         .....
//     }
//     sourceIdNum: <number of entries in the table above>
//
//     byDominating: {
//         <dominating element ID>: <SourceNodesByPriority>
//         ......   
//     }
//
//     byIdentity: <UnmappedByIdentity>
// }
//
// UnmappedNodesAtRoot
// -------------------
//
// Remark: this class is not currently used (see introduction)
//
// This is the class to be used at the root path node
//
// {
//     bySourceId: {
//         <source data element ID>: {
//             groupNum: <number of groups below>,
//             groups: {
//                 <group ID>: <identity>
//                 .....
//             }
//         }
//         .......
//     }
//     sourceIdNum: <number of entries in the table above>
//
//     byPriority: <SourceNodesByPriority>
//
//     byIdentity: <UnmappedByIdentity>
// }
// 
// Both these classes make use of the following class:
//
// SourceNodesByPriority:
//
// {
//     sourceNodes: {
//         <priority>: {
//             priority: <priority>,
//             groupNum: <number of groups below>,
//             groups: {
//                 <group ID>: {
//                      nodeNum: <number of entries in the 'nodes' table>
//                      nodes: {
//                          <source element ID>: true
//                          ......
//                      }
//                 }
//                 ........
//             }
//         },
//         ...............
//     }
//     byPriority: [<array of the entries above, sorted by priority>]
// }  
//
// This stores a list of unmapped nodes, partitioned by the priority of
// the group which mapped them. The entry for each priority is stored
// twice in this table: once in 'sourceNodes' under an attribute which
// is the priority of the groups which merged the nodes and once in 
// the 'byPriority' array, where the entries are sorted by their priority
// (highest priority first).
//
// It is assumed that a relatively small number of priorities are usually
// stored in this table, so insertion and deletion from the 'byPriority'
// array take place by linear search.
//

// %%include%%: "unmappedByIdentity.js"

///////////////////
// UnmappedNodes //
///////////////////

//
// constructor
//

function UnmappedNodes()
{
    this.bySourceId = {};
    this.sourceIdNum = 0;
    this.byDominating = {};
    this.byIdentity = new UnmappedByIdentity();
}

// This function returns true if the given source element ID is an unmapped
// node for the given group.

UnmappedNodes.prototype.isUnmapped = unmappedNodesIsUnmapped;

function unmappedNodesIsUnmapped(sourceElementId, groupId)
{
    return ((sourceElementId in this.bySourceId) && 
            (groupId in (this.bySourceId[sourceElementId].groups)));
}

// return the number of source nodes stored in this table

UnmappedNodes.prototype.unmappedNum = unmappedNodesUnmappedNum;

function unmappedNodesUnmappedNum()
{
    return this.sourceIdNum;
}

// This function returns the list of dominating IDs under the entry of
// the given source element ID and group ID in the 'bySourceId' table.
// If there is no such entry, undefined is returned. 

UnmappedNodes.prototype.getDominating = unmappedNodesGetDominating;

function unmappedNodesGetDominating(sourceElementId, groupId)
{
    var sourceEntry;
    if(!(sourceEntry = this.bySourceId[sourceElementId]))
        return undefined;
    
    var groupEntry;
    if(!(groupEntry = sourceEntry.groups[groupId]))
        return undefined;

    return groupEntry.dominating;
}

// This function returns the list of groups stored under the given 
// source ID. This is extracted directly from the 'bySourceId' table.
// This returns undefined if no such groups were found. 

UnmappedNodes.prototype.getGroups = unmappedNodesGetGroups;

function unmappedNodesGetGroups(sourceElementId)
{
    var sourceEntry = this.bySourceId[sourceElementId];

    return sourceEntry ? sourceEntry.groups : undefined;
}

// return the entry in the byIdentity table for the unmapped nodes
// with the given identity and dominating ID.

UnmappedNodes.prototype.getByIdentity = unmappedNodesGetByIdentity;

function unmappedNodesGetByIdentity(identity, dominatingId)
{
    if(dominatingId === undefined)
        dominatingId = 0;
    return this.byIdentity.getUnmapped(identity, dominatingId);
}

// This function adds the node with source ID 'sourceElementId' mapped by
// group 'groupId' as an unmapped node to the target path at which this
// table is defined. 'dominatingId' is the data element ID
// of the target node dominating this unmapped node. 'priority' is the 
// priority of the group. 'identity' is the source identity of the 
// source node, as defined by the source identification of the group.

UnmappedNodes.prototype.addNode = unmappedNodesAddNode;

function unmappedNodesAddNode(sourceElementId, groupId, dominatingId,
                              priority, identity)
{
    if(dominatingId === undefined)
        dominatingId = 0;

    // update bySourceId

    var sourceEntry;

    if(!(sourceEntry = this.bySourceId[sourceElementId])) {
        sourceEntry = this.bySourceId[sourceElementId] = { 
            groupNum: 0,
            groups: {}
        };
        this.sourceIdNum++;
    }

    var groupEntry;

    if(!(groupEntry = sourceEntry.groups[groupId])) {
        groupEntry = sourceEntry.groups[groupId] = { 
            dominatingNum: 0, 
            dominating: {},
            identity: identity
        };
        sourceEntry.groupNum++;
    }

    if(!(dominatingId in groupEntry.dominating)) {
        groupEntry.dominating[dominatingId] = true;
        groupEntry.dominatingNum++;
    }

    // update byDominating

    var dominatingEntry;

    if(!(dominatingEntry = this.byDominating[dominatingId])) {
        dominatingEntry = this.byDominating[dominatingId] = 
            new SourceNodesByPriority();
    }

    dominatingEntry.addNode(sourceElementId, groupId, priority);

    this.byIdentity.addUnmapped(dominatingId, identity, sourceElementId, 
                                groupId);
}

// returns the SourceNodesByPriority object under the given dominating ID

UnmappedNodes.prototype.getByDominating = unmappedNodesGetByDominating;

function unmappedNodesGetByDominating(dominatingId)
{
    if(dominatingId === undefined)
        return this.byDominating[0];
    return this.byDominating[dominatingId];
}

// returns an array with all dominating IDs which are stored in this object.

UnmappedNodes.prototype.getAllDominatingIds = unmappedNodesGetAllDominatingIds;

function unmappedNodesGetAllDominatingIds()
{
    var dominatingIds = [];
    
    for(var dominatingId in this.byDominating)
        dominatingIds.push(dominatingId);

    return dominatingIds;
}

// are there any unmapped nodes under the given dominating ID? If the
// dominating ID is undefined, returns true if there are any unmapped
// nodes (under whatever dominating ID).

UnmappedNodes.prototype.hasUnmapped = unmappedNodesHasUnmapped;

function unmappedNodesHasUnmapped(dominatingId)
{
    if(dominatingId === undefined)
        return (this.sourceIdNum > 0);
    return (dominatingId in this.byDominating);
}

// This function is used when it becomes possible to make unmapped nodes
// under a given dominating node into mapped nodes. This function 
// returns the highest priority unmapped nodes under the given domianting ID
// and removes those nodes from the table (only the instances under the
// given dominating ID are removed, of course).
// This function returns a structure of the form:
// {
//     <group ID>: {
//          nodeNum: <number of nodes below>,
//          nodes: {
//             <source element ID>: true
//             ......
//          }
//     }
// }
// which is the structure stored under the 'groups' attribute of the 
// highest priority entry in the SourceNodeByPriority object for the 
// given dominating ID. This function also removes this entry from the
// SourceNodesByPriority object and, if this object becomes empty 
// as a result of this operation, removes the whole SourceNodesByPriority.
// This function also clears the corresponding entries from the 
// 'bySourceid' table.

UnmappedNodes.prototype.getHighestPriority = 
    unmappedNodesGetHighestPriority;

function unmappedNodesGetHighestPriority(dominatingId)
{
    if(dominatingId === undefined)
        dominatingId = 0;

    var dominatingEntry;
    if(!(dominatingEntry = this.byDominating[dominatingId]))
        return undefined;

    // get the highest priority nodes from the entry (this also clears them
    // from this entry).
    var highestPriority = dominatingEntry.getHighestPriority();

    if(dominatingEntry.isEmpty())
        delete this.byDominating[dominatingId];

    // delete these nodes from the 'bySourceId' and 'byIdentity' table. 
    for(var groupId in highestPriority)
        for(var sourceId in highestPriority[groupId].nodes)
            this.removeFromBySource(sourceId, groupId, dominatingId);

    return highestPriority;
}

// This function removes the entries for all unmapped nodes stored in this
// table under the dominating node 'dominatingId'. This first goes over all
// entries stored in the SourceNodesByPriority entry for this dominating ID
// and removes the corresponding source node + group + dominating node 
// entries in the 'bySourceId' table. It then removes 
// the SourceNodesByPriority entry. 

UnmappedNodes.prototype.removeByDominating = unmappedNodesRemoveByDominating;

function unmappedNodesRemoveByDominating(dominatingId)
{
    if(dominatingId === undefined)
        dominatingId = 0;

    var dominatingEntry = this.byDominating[domiantingId];

    if(!dominatingEntry)
        return;

    for(var i = 0, l = dominatingEntry.byPriority.length ; i < l ; ++l) {
        var groups = dominatingEntry.byPriority[i].groups;
        for(var groupId in groups) {
            var groupNodes = groups[groupId];
            for(var sourceId in groupNodes.nodes)
                this.removeFromBySource(sourceId, groupId, dominatingId);
        }
    }

    delete this.byDominating[domiantingId];
}

// This function removes a single entry stored in this table: an unmapped
// node 'sourceId' mapped by the group 'groupId' under the dominating 
// node 'dominatingId'. 'priority' should be the priority of the 
// group.

UnmappedNodes.prototype.removeSingleEntry = unmappedNodesRemoveSingleEntry;

function unmappedNodesRemoveSingleEntry(dominatingId, sourceId, groupId,
                                        priority)
{
    if(dominatingId === undefined)
        dominatingId = 0;

    var dominatingEntry = this.byDominating[domiantingId];

    if(!dominatingEntry)
        return;

    if(!dominatingEntry.removeNode(sourceId, groupId, priority))
        delete this.byDominating[domiantingId];
    this.removeFromBySource(sourceId, groupId, dominatingId);
}

// This function removes the entry for the given source element ID, 
// group ID and dominating node ID from the bySourceId table.

UnmappedNodes.prototype.removeFromBySource = unmappedNodesRemoveFromBySource;

function unmappedNodesRemoveFromBySource(sourceId, groupId, dominatingId)
{
    if(dominatingId === undefined)
        dominatingId = 0;

    var sourceEntry;
    if(!(sourceEntry = this.bySourceId[sourceId]))
        return;

    var groupEntry;
    if(!(groupEntry = sourceEntry.groups[groupId]))
        return;

    this.byIdentity.removeUnmapped(sourceId, groupId, groupEntry.identity, 
                                   dominatingId);

    if(dominatingId in groupEntry.dominating) {
        if(!--groupEntry.dominatingNum) {
            if(!--sourceEntry.groupNum) {
                delete this.bySourceId[sourceId];
                this.sourceIdNum--;
            } else
                delete sourceEntry.groups[groupId];
        } else
            delete groupEntry.dominating[dominatingId];
    }
}

// This function removes all entries in this table for the given
// source element ID and group ID (that is, for all dominating IDs).
// 'priority' is the priority of this group.
// If there are no dominating IDs under which the node is unmapped,
// this function returns undefined. Otherwise, the function returns 
// an object of the form:
// {
//     identity: <identity of the node removed>,
//     domiantingIds: <array of dominating IDs>
// }
// 'dominatingIds' is a list of dominating IDs under which these
// source node and group were unmapped.

UnmappedNodes.prototype.removeBySource = unmappedNodesRemoveBySource;

function unmappedNodesRemoveBySource(sourceId, groupId, priority)
{
    var sourceEntry;
    if(!(sourceEntry = this.bySourceId[sourceId]))
        return undefined;
    
    var groupEntry;
    if(!(groupEntry = sourceEntry.groups[groupId]))
        return undefined;

    // clear entries from the 'byDominating' and byIdentity table

    for(var dominatingId in groupEntry.dominating) {
        this.byIdentity.removeUnmapped(sourceId, groupId, groupEntry.identity, 
                                       dominatingId);
        if(this.byDominating[dominatingId].removeNode(sourceId, 
                                                      groupId, priority) == 0)
            delete this.byDominating[dominatingId];
    }

    if(!--sourceEntry.groupNum) {
        delete this.bySourceId[sourceId];
        this.sourceIdNum--;
    } else
        delete sourceEntry.groups[groupId];
    
    return { identity: groupEntry.identity, 
             dominatingIds: Object.keys(groupEntry.dominating) };
}

// This function is called when the source identity under identification 
// 'identificationId' of the node 'sourceId' mapped from indexer 
// 'sourceIndexer' changed to 'newIdentity'.
// This function first finds all groups under which this node was stored
// which have these source indexer and source identification ID.
// For these groups, the old identity (which is stored in the table) 
// is removed and the new identity added.
// The function returns an array with the list of groups for which this
// update took place and the old identity for each of them (in prinicple,
// this should usually be the same for all groups, as they use the same
// identification, but if the identity update was queued while the node
// was added by a group, it may be recorded with a newer identity 
// than previous groups). The array returned has entries of the form:
// {
//    groupId: <group ID>,
//    oldIdentity: <old identity stored here for this group>
//    dominatingIds: <domianting IDs for this node and group>
// }
//
// 'groupEntries' is the 'groupById' table of the (target) indexer inside 
// which this table is stored. This allows this function to fetch the
// group entry of each group.

UnmappedNodes.prototype.updateIdentity = unmappedNodesUpdateIdentity;

function unmappedNodesUpdateIdentity(sourceId, newIdentity, groupEntries,
                                     sourceIndexer, identificationId)
{
    var sourceEntry;
    if(!(sourceEntry = this.bySourceId[sourceId]))
        return;

    var updated = [];
    var oldIdentity;
    
    // loop over the groups which mapped this node and check which of them
    // has the required source identification
    for(var groupId in sourceEntry.groups) {
        
        var groupEntry = groupEntries[groupId];
        if(groupEntry.sourceIndexer != sourceIndexer ||
           groupEntry.sourceIdentificationId != identificationId)
            continue;

        var unmappedGroupEntry = sourceEntry.groups[groupId];

        // get the old identity and replace it with the new one
        oldIdentity = unmappedGroupEntry.identity;
        unmappedGroupEntry.identity = newIdentity;

        var dominatingIds = Object.keys(unmappedGroupEntry.dominating);
        this.byIdentity.updateIdentity(sourceId, dominatingIds, groupId, 
                                       oldIdentity, newIdentity);

        updated.push({ groupId: groupId, oldIdentity: oldIdentity,
                       dominatingIds: dominatingIds });
    }

    return updated;
}

/////////////////////////
// UnmappedNodesAtRoot //
/////////////////////////

//
// constructor
//

function UnmappedNodesAtRoot()
{
    this.bySourceId = {};
    this.sourceIdNum = 0;
    this.byPriority = new SourceNodesByPriority();
    this.byIdentity = new UnmappedByIdentity();
}

// This function returns true if the given source element ID is an unmapped
// node for the given group.

UnmappedNodesAtRoot.prototype.isUnmapped = unmappedNodesAtRootIsUnmapped;

function unmappedNodesAtRootIsUnmapped(sourceElementId, groupId)
{
    return ((sourceElementId in this.bySourceId) && 
            (groupId in (this.bySourceId[sourceElementId].groups)));
}

// return the number of source nodes stored in this table

UnmappedNodesAtRoot.prototype.unmappedNum = unmappedNodesAtRootUnmappedNum;

function unmappedNodesAtRootUnmappedNum()
{
    return this.sourceIdNum;
}

// This function adds the node with source ID 'sourceElementId' mapped by
// group 'groupId' as an unmapped node to the target path at which this
// table is defined. 'priority' is the priority of the group. 'identity'
// is the source identity of this node, as defined by the source identification
// of the group. 

UnmappedNodesAtRoot.prototype.addNode = unmappedNodesAtRootAddNode;

function unmappedNodesAtRootAddNode(sourceElementId, groupId, priority, 
                                    identity)
{
    // update bySourceId
    
    var sourceEntry;

    if(!(sourceEntry = this.bySourceId[sourceElementId])) {
        sourceEntry = this.bySourceId[sourceElementId] = { 
            groupNum: 1,
            groups: {}
        };
        this.sourceIdNum++;
        sourceEntry.groups[groupId] = identity;
    } else if(!(groupId in sourceEntry.groups)) {
        sourceEntry.groups[groupId] = identity;
        sourceEntry.groupNum++;
    }

    // update byPriority
    this.byPriority.addNode(sourceElementId, groupId, priority);

    this.byIdentity.addUnmapped(0, identity, sourceElementId, groupId);
}

// returns the SourceNodesByPriority object stored inside this object.
// The dominating node is always 'undefined' here, but the function 
// was given its name to allow calling functions ignore the difference
// between this class and UnmappedNodes.

UnmappedNodesAtRoot.prototype.getByDominating = 
    unmappedNodesAtRootGetByDominating;

function unmappedNodesAtRootGetByDominating()
{
    return this.byPriority;
}

// This function returns the list of groups stored under the given 
// source ID. This is extracted directly from the 'bySourceId' table.
// This returns undefined if no such groups were found. 

UnmappedNodesAtRoot.prototype.getGroups = unmappedNodesAtRootGetGroups;

function unmappedNodesAtRootGetGroups(sourceElementId)
{
    var sourceEntry = this.bySourceId[sourceElementId];

    return sourceEntry ? sourceEntry.groups : undefined;
}
// return the entry in the byIdentity table for the unmapped nodes
// with the given identity.

UnmappedNodesAtRoot.prototype.getByIdentity = unmappedNodesAtRootGetByIdentity;

function unmappedNodesAtRootGetByIdentity(identity)
{
    return this.byIdentity.getUnmapped(identity, 0);
}

// are there any unmapped nodes stored in this table?

UnmappedNodesAtRoot.prototype.hasUnmapped = unmappedNodesAtRootHasUnmapped;

function unmappedNodesAtRootHasUnmapped()
{
    return (this.sourceIdNum > 0);
}

// This function is used when it becomes possible to make unmapped
// nodes into mapped nodes. This function returns the highest priority
// unmapped nodes stored in this table and removes those nodes from
// the table.
// This function returns a structure of the form:
// {
//     <group ID>: {
//          nodeNum: <number of nodes below>,
//          nodes: {
//             <source element ID>: true
//             ......
//          }
//     }
// }
// which is the structure stored under the 'groups' attribute of the 
// highest priority entry in the SourceNodeByPriority object of this table. 
// This function also removes this entry from the SourceNodesByPriority object.
// This function also clears the corresponding entries from the 
// 'bySourceid' table.

UnmappedNodesAtRoot.prototype.getHighestPriority = 
    unmappedNodesAtRootGetHighestPriority;

function unmappedNodesAtRootGetHighestPriority(dominatingId)
{
    var highestPriority = this.byPriority.getHighestPriority();

    if(!highestPriority)
        return undefined; // no more unmapped nodes
        
    // remove these nodes from the sourceById table.

    for(var groupId in highestPriority)
        for(var sourceId in highestPriority[groupId].nodes)
            this.removeFromBySource(sourceId, groupId);

    return highestPriority;
}

// This function removes the entry for the given source element ID 
// and group ID from the bySourceId table. As opposed to 'removeBySource'
// this function is only used internally.

UnmappedNodesAtRoot.prototype.removeFromBySource = 
    unmappedNodesAtRootRemoveFromBySource;

function unmappedNodesAtRootRemoveFromBySource(sourceId, groupId)
{
    var sourceEntry;
    if(!(sourceEntry = this.bySourceId[sourceId]))
        return;
    
    if(!(groupId in sourceEntry.groups))
        return;

    this.byIdentity.removeUnmapped(sourceId, groupId, 
                                   sourceEntry.groups[groupId], 0);

    if(!--sourceEntry.groupNum) {
        delete this.bySourceId[sourceId];
        this.sourceIdNum--;
    } else
        delete sourceEntry.groups[groupId];
}

// This function removes all entries in this table for the given
// source element ID and group ID (that is, for all dominating IDs).
// 'priority' is the priority of this group.
// To mimic the interface for UnmappedNodes.removeBySource(), this function
// returns undefined if the given node was not found in the table and
// the object:
// {
//     identity: <identity of the node removed>,
//     dominatingIds: [0]
// }

UnmappedNodesAtRoot.prototype.removeBySource = 
    unmappedNodesAtRootRemoveBySource;

function unmappedNodesAtRootRemoveBySource(sourceId, groupId, priority)
{
    var sourceEntry;
    if(!(sourceEntry = this.bySourceId[sourceId]))
        return undefined;
    
    if(!(groupId in sourceEntry.groups))
        return undefined;
    
    var identity = sourceEntry.groups[groupId];

    // remove from the 'byIdentity' table
    this.byIdentity.removeUnmapped(sourceId, groupId, identity, 0); 

    // clear from 'byPriority' table

    this.byPriority.removeNode(sourceId, groupId, priority);

    if(!--sourceEntry.groupNum) {
        delete this.bySourceId[sourceId];
        this.sourceIdNum--;
    } else
        delete sourceEntry.groups[groupId];

    return { identity: identity, dominatingIds: [0] };
}

// This function is called when the source identity under identification 
// 'identificationId' of the node 'sourceId' mapped from indexer 
// 'sourceIndexer' changed to 'newIdentity'.
// This function first finds all groups under which this node was stored
// which have these source indexer and source identification ID.
// For these groups, the old identity (which is stored in the table) 
// is removed and the new identity added.
// The function returns an array with the list of groups for which this
// update took place and the old identity for each of them (in prinicple,
// this should usually be the same for all groups, as they use the same
// identification, but if the identity update was queued while the node
// was added by a group, it may be recorded with a newer identity 
// than previous groups). The array returned has entries of the form:
// {
//    groupId: <group ID>,
//    oldIdentity: <old identity stored here for this group>
// }
//
// 'groupEntries' is the 'groupById' table of the (target) indexer inside 
// which this table is stored. This allows this function to fetch the
// group entry of each group.

UnmappedNodesAtRoot.prototype.updateIdentity = 
    unmappedNodesAtRootUpdateIdentity;

function unmappedNodesAtRootUpdateIdentity(sourceId, newIdentity, groupEntries,
                                           sourceIndexer, identificationId)
{
    var sourceEntry;
    if(!(sourceEntry = this.bySourceId[sourceId]))
        return;

    var updated = [];
    var oldIdentity;
    
    // loop over the groups which mapped this node and check which of them
    // has the required source identification
    for(var groupId in sourceEntry.groups) {
        
        var groupEntry = groupEntries[groupId];
        if(groupEntry.sourceIndexer != sourceIndexer ||
           groupEntry.sourceIdentificationId != identificationId)
            continue;

        // get the old identity and replace it with the new one
        oldIdentity = sourceEntry.groups[groupId];
        sourceEntry.groups[groupId] = newIdentity;

        this.byIdentity.updateIdentity(sourceId, [0], groupId, 
                                       oldIdentity, newIdentity);

        updated.push({ groupId: groupId, oldIdentity: oldIdentity });
    }

    return updated;
}

///////////////////////////
// SourceNodesByPriority //
///////////////////////////

// constructor

function SourceNodesByPriority()
{
    this.sourceNodes = {};
    this.byPriority = [];
}

// This function is to be used for adding the given source node as
// unmapped for the given group, with the given priority. If this
// priority is new in this table, a new entry is created for it and
// this entry is also inserted into the correct place in the
// 'byPriority' array. The insertion takes place by linear search, as
// it is assumed that the list is usually very short (and does not
// change much).

SourceNodesByPriority.prototype.addNode = sourceNodesByPriorityAddNode;

function sourceNodesByPriorityAddNode(sourceId, groupId, priority)
{
    var priorityEntry;
    if(!(priorityEntry = this.sourceNodes[priority])) {
        priorityEntry = this.sourceNodes[priority] = {
            priority: priority,
            groupNum: 0,
            groups: {}
        };
        // this.byPriority is an array of the objects in 
        // this.sourceNodes, sorted by their priority. It is assumed
        // this array is short, so insertion is conducted by linear search.
        var insertAt;
        for(insertAt = 0, l = this.byPriority.length ; insertAt < l ; 
            ++insertAt) {
            if(this.byPriority[insertAt].priority < priority)
                break;
        }
        this.byPriority.splice(insertAt, 0, priorityEntry);
    }
 
    var groupEntry;

    if(!(groupEntry = priorityEntry.groups[groupId])) {
        groupEntry = priorityEntry.groups[groupId] = {
            nodeNum: 1,
            nodes: {}
        };
        priorityEntry.groupNum++;
        groupEntry.nodes[sourceId] = true;
    } else if(!(sourceId in groupEntry.nodes)) {
        groupEntry.nodes[sourceId] = true;
        groupEntry.nodeNum++;
    }
}

// This function removes the entry for the given source node under the given
// group ID. 'priority' is the priority of the group.
// If this was the last entry at this priority, the entry for this 
// priority is removed. 
// The function returns the length of the 'byPriority' array after
// this operation (if this is zero, the object is empty and can be destroyed).

SourceNodesByPriority.prototype.removeNode = sourceNodesByPriorityRemoveNode;

function sourceNodesByPriorityRemoveNode(sourceId, groupId, priority)
{
    var priorityEntry;
    var groupEntry;

    if(!(priorityEntry = this.sourceNodes[priority]) ||
       !(groupEntry = priorityEntry.groups[groupId]) ||
       !(sourceId in groupEntry.nodes))
        return this.byPriority.length; // entry not found

    if(!--groupEntry.nodeNum) {
        if(!--priorityEntry.groupNum) {
            // remove this priority entry from the 'byPriority' array
            // (using linear search, assuming this array is short)
            for(var i = 0, l = this.byPriority.length ; i < l ; ++i) {
                if(this.byPriority[i] == priorityEntry) {
                    this.byPriority.splice(i,1);
                    break;
                }
            }
            delete this.sourceNodes[priority];
        } else
            delete priorityEntry.groups[groupId];
    } else
        delete groupEntry.nodes[sourceId];

    return this.byPriority.length;
}

// This function returns the object under the 'groups' attribute of
// the highest priority entry in this table and removes that highest
// priority entry.
// undefined is returned if the table is empty.

SourceNodesByPriority.prototype.getHighestPriority = 
    sourceNodesByPriorityGetHighestPriority;

function sourceNodesByPriorityGetHighestPriority()
{
    if(this.byPriority.length === 0)
        return undefined; // the table is empty

    var highestPriority = this.byPriority[0];
    
    // clear the entry
    delete this.sourceNodes[highestPriority.priority];
    this.byPriority.splice(0,1);

    return highestPriority.groups;
}

// returns true if this table is empty.

SourceNodesByPriority.prototype.isEmpty = 
    sourceNodesByPriorityIsEmpty;

function sourceNodesByPriorityIsEmpty()
{
    return (this.byPriority.length == 0);
}
