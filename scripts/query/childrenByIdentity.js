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


// This file implements a table used by the merge indexer to store
// nodes which are merged under dominating nodes determined by 
// identity. This applies to the source nodes mapped from the 
// minimal source path of a mapping where the minimal target path
// is not the root path. In such cases, identity is used to determine
// under which nodes to merge these source nodes.
//
// These nodes are stored in this table, which is stored on the 
// prefix path node of the minimal target path, that is, it is stored
// on the path node where the dominating nodes are stored. 
//
// We will therefore refer to the nodes stored in this table as 'child' nodes.
// These may be inserted under standard non-terminals,
// where the non-terminal is at the prefix path of the child.
//
// The identity stored in this table is the identity of the dominating
// node whose children are stored here. This is equal to the
// identity of the non-terminal under which these child nodes will be
// merged. The table is stored at the path node where the
// non-terminal is to be found.
//
// When the identity of the parent changes, we need to update the identity
// of the relevant children in this table. For this purpose, the object
// also stores a table mapping each parent node (whose idnetity is used
// her) to the child nodes which were stored under that parent.
// 
// As this table is stored on the path node of the non-terminals which
// should be selected by the identity, this means the table is at a
// prefix path of the child nodes stored in the table. The paths of
// the child nodes do not need to be stored here. This is because
// this path must be the target path of the minimal group which mapped
// the node. 
//
// The nodes are partitioned by the group which maps them.  Under each
// group, we store the child nodes mapped by this group.
//
// The object interface allows adding and removing nodes from this
// table.
//
// To simplify the removal of source nodes from the ChildrenByIdentity table
// we store, for each source node ID stored in this table, the identity
// under which it is stored in this table. This is partitioned by group 
// (as the removal of a source node is for a specific group).
//
// The table structure is as follows:
//
// ChildrenByIdentity:
// -------------------
//
// This class is to be used when looking for children to insert under
// standard (not operator) non-terminals. This table is stored on the
// prefix (parent) path node of the children stored in this table and
// the indentity used here is the source identity of the parent of the
// child nodes.
//
// {
//     identities: {
//         <dominating (source) identity>: <ChildrenByIdentityEntry>
//         .....
//     }
//     children: {
//         <source element ID>: {
//             numIdentities: <number of entries below>
//             identitiesByGroup: {
//                 <group ID>: <identity>
//                 ......
//             }
//         }
//         .....
//     }
//     numChildren: <number of entries in the 'children' table>
//     parents: {
//         <parent source ID>: {
//             sameId: <number of children with same ID as parent>,
//             children: { // only children with a different ID 
//                 <child source ID>: <count>
//                 .......
//             }
//             childNum: <number of children in the 'children' table>
//         }
//         .....
//     }
// }
//
// The 'children' table allows one to find, given a source element ID
// and group ID, all entries in the 'identities' table which store
// this source element ID under the given group. This is used to clear
// these entries from the table when the node with the given source
// element ID is no longer mapped by the group.
//
// The 'parents' table allows one to find all the children of a given
// node which are stored in this table. This parent is the node under whose
// identity the children are stored here. This may be 0 (if the source 
// path of the children is the root path). As the same node ID may be
// mapped by several groups, this table also holds a reference count
// for each child. Since many chilren may have the same element ID
// as the parent, all those children are simply counted in the field
// 'sameId' without listing their ID separately.
//
// When adding and removing child nodes from this table, the caller is
// expected to provide the ID both of the parent and the child. 
// 
//
// ChildrenByIdentityEntry
// -----------------------
//
// This is the object stored under each identity and dominating ID in the
// ChildrenByIdentity table. This object has the following structure:
//
// {
//     groupNum: <number of groups below>,
//     groups: {
//         <group ID>: {
//             nodeNum: <number of nodes below>,
//             nodes: {
//                <source element ID>: true
//                .....
//             }
//         }
//         .....
//     }
// }

////////////////////////
// ChildrenByIdentity //
////////////////////////

// constructor

function ChildrenByIdentity()
{
    this.identities = {};
    this.children = {};
    this.numChildren = 0;
    this.parents = {};
}
 
// This function adds a single child node to the ChildrenByIdentity
// table.  This is called when 'childId' (the 'child node') is
// to be merged under a dominating node based on indentity. The identity
// 'identity' is that of its parent node 'parentId' (which may be 0
// if childId is from the root path). A child is added to this table
// when the child node is from the minimal source path of the
// mapping so its dominating nodes are determined by identity.  This
// ChildByIdentity object is stored on its prefix path node.
// 'groupId' is the ID of the group which mapped this child node.
// Both the 'children', 'identities' and 'parentd' tables are updated here.

ChildrenByIdentity.prototype.addChild = childrenByIdentityAddChild;

function childrenByIdentityAddChild(identity, parentId, childId, groupId)
{
    // prepare to add to the 'children' table

    var sourceEntry;
    if(!(sourceEntry = this.children[childId])) {
        sourceEntry = this.children[childId] = {
            numIdentities: 0,
            identitiesByGroup: {}
        };
        this.numChildren++;
    }

    if(!(groupId in sourceEntry.identitiesByGroup))
        sourceEntry.numIdentities++;
    sourceEntry.identitiesByGroup[groupId] = identity;

    // prepare to add to the 'identities' table

    var identityEntry;
    if(!(identityEntry = this.identities[identity]))
        identityEntry = this.identities[identity] = 
            new ChildrenByIdentityEntry();

    identityEntry.addChild(childId, groupId);

    // add to the 'parents' table
    var parentEntry;
    if(!(parentEntry = this.parents[parentId])) {
        parentEntry = this.parents[parentId] = {
            sameId: 0,
            children: {},
            childNum: 0
        }
    }
    if(parentId == childId)
        parentEntry.sameId++;
    else if(childId in parentEntry.children)
        parentEntry.children[childId]++;
    else {
        parentEntry.children[childId] = 1;
        parentEntry.childNum++;
    }
}

// This function removes the entry for the given child node mapped
// by the given group ID and stored in this table under the indentity
// of the parent node 'parentId' ('parentId' may be 0 if the child
// node is mapped from the root path node).
// It first looks up in the 'children' table the identity under which
// the node is stored. It then removes the corresponding entries in
// the 'identities' table (in addition to removing the entry in the
// 'children' table and the 'parents').

ChildrenByIdentity.prototype.removeChild = childrenByIdentityRemoveChild;

function childrenByIdentityRemoveChild(parentId, childId, groupId)
{
    var sourceEntry = this.children[childId];
    if(!sourceEntry)
        return;
    
    var identity = sourceEntry.identitiesByGroup[groupId];
    if(identity === undefined)
        return;

    // remove entry inside the 'identities' table
    var identityEntry = this.identities[identity];
    
    identityEntry.removeChild(childId, groupId);
    if(identityEntry.groupNum == 0)
        delete this.identities[identity];

    if(!--sourceEntry.numIdentities) {
        delete this.children[childId];
        this.numChildren--;
    } else
        sourceEntry.identitiesByGroup[groupId];

    // remove from the 'parents' table
    var parentEntry = this.parents[parentId];
    
    if(parentId == childId) {
        if(!--parentEntry.sameId && !parentEntry.childNum)
            delete this.parents[parentId];
    } else if(!--parentEntry.children[childId]) {
        if(!--parentEntry.childNum && !parentEntry.sameId)
            delete this.parents[parentId];
        else
            delete parentEntry.children[childId];
    }
}

// This function removes all entries in this object which were registered
// by the group with group ID 'groupId'. 

ChildrenByIdentity.prototype.removeGroup = childrenByIdentityRemoveGroup;

function childrenByIdentityRemoveGroup(groupId)
{
    // remove group from children

    var removedChildren = [];
    
    for(var sourceId in this.children) {
        var entry = this.children[sourceId];
        if(groupId in entry.identitiesByGroup) {
            if(entry.numIdentities === 1) {
                delete this.children[sourceId];
                this.numChildren--;
            } else {
                delete entry.identitiesByGroup[groupId];
                entry.numIdentities--;
            }
            removedChildren.push(sourceId);
        }
    }

    if(this.numChildren == 0) {
        // only this group added children, can clear all other tables
        this.identities = {};
        this.parents = {};
        return;
    }

    // remove the children removed from the 'parents' table

    var childIds = new Map();

    for(var i = 0, l = removedChildren.length ; i < l ; ++i)
        childIds.set(removedChildren[i], true);
    
    for(var parentId in this.parents) {
        var parentEntry = this.parents[parentId];
        if(childIds.has(parentId)) {
            if(--parentEntry.sameId == 0 && parentEntry.childNum == 0)
                delete this.parents[parentId];
        } else if(parentEntry.childNum > 0) {
            for(var childId in parentEntry.children) {
                if(!childIds.has(childId))
                    continue;
                if(--parentEntry.children[childId] > 0)
                    continue;
                if(--parentEntry.childNum == 0) {
                    if(parentEntry.sameId == 0)
                        delete this.parents[parentId];
                    parentEntry.children = {};
                } else
                    delete parentEntry.children[childId];
            }
        }
    }
    
    for(var dominatingId in this.identities) {
        var entry = this.identities[dominatingId];
        if(entry.removeGroup(groupId) == 0)
            delete this.identities[dominatingId];
    }
}

// This function is called when the source identity under identification 
// 'identificationId' of the node 'parentId' mapped from indexer 
// 'sourceIndexer' changed to 'newIdentity'.
// This function first finds all children of 'parentId' which were
// stored in this object and then, for each of these children, all groups 
// for which this node was stored here. Of these groups, we are only
// interested in those which have the source indexer and 
// source identification ID given as input to this function.
// For these groups, the old identity (which is stored in the table) 
// is removed and the new identity added.
// The function returns an array with the list of groups and children 
// for which this update took place and the old identity for each of them 
// (in prinicple, this should usually be the same for all groups, as they 
// use the same identification, but if the identity update was queued while 
// a node was added by a group, it may be recorded with a newer identity 
// than previous groups). The array returned has entries of the form:
// {
//    childId: <source data element ID>
//    groupId: <group ID>,
//    oldIdentity: <old identity stored here for this group>
// }
//
// 'groupEntries' is the 'groupById' table of the (target) indexer inside 
// which this table is stored. This allows this function to fetch the
// group entry of each group.

ChildrenByIdentity.prototype.updateIdentity = childrenByIdentityUpdateIdentity;

function childrenByIdentityUpdateIdentity(parentId, newIdentity, 
                                          groupEntries, sourceIndexer, 
                                          identificationId)
{
    var parentEntry = this.parents[parentId];

    if(!parentEntry)
        return [];

    var updated = [];

    if(parentEntry.sameId > 0)
        this.updateChildIdentity(parentId, newIdentity, groupEntries, 
                                 sourceIndexer, identificationId, updated);

    if(parentEntry.childNum)
        for(var childId in parentEntry.children)
            this.updateChildIdentity(childId, newIdentity, groupEntries, 
                                     sourceIndexer, identificationId, updated);

    return updated;
}

// This function updates the identity (as described in updateIdentity(....)) 
// for a single child node ID. 'childId' is this child and 'updated'
// is an array on to which this function pushes the list of updates
// which actually took place (in the format returned by the function 
// updateIdentity(...)). It is this function that goes over the various
// groups which mapped this child node and selectes the ones with 
// the matching source indexer and source identification.
// 
// This function should only be used internally.

ChildrenByIdentity.prototype.updateChildIdentity = 
    childrenByIdentityUpdateChildIdentity;

function childrenByIdentityUpdateChildIdentity(childId, newIdentity, 
                                               groupEntries, sourceIndexer, 
                                               identificationId, updated)
{
    var sourceEntry = this.children[childId];
    if(!sourceEntry)
        return;
    
    var oldIdentity;
    
    // loop over the groups which mapped this node and check which of them
    // has the required source identification

    for(var groupId in sourceEntry.identitiesByGroup) {

        var groupEntry = groupEntries[groupId];
        if(groupEntry.sourceIndexer != sourceIndexer ||
           groupEntry.sourceIdentificationId != identificationId)
            continue;

        // get the old identity and replace it with the new one
        oldIdentity = sourceEntry.identitiesByGroup[groupId];
        sourceEntry.identitiesByGroup[groupId] = newIdentity;

        // remove this source node and group from the entry under the 
        // old identity and add it to the entry under the new identity
        
        var identityEntry = this.identities[oldIdentity];
        identityEntry.removeChild(childId, groupId);
        if(identityEntry.groupNum == 0)
            delete this.identities[oldIdentity];
        
        if(!(identityEntry = this.identities[newIdentity]))
            identityEntry = this.identities[newIdentity] = 
            new ChildrenByIdentityEntry();
        
        identityEntry.addChild(childId, groupId);
        
        updated.push({ childId: childId, groupId: groupId, 
                       oldIdentity: oldIdentity });
    }
}

// This function returns the ChildrenByIdentityEntry object stored
// under the given identity.

ChildrenByIdentity.prototype.getChildren = childrenByIdentityGetChildren;

function childrenByIdentityGetChildren(identity)
{
    return this.identities[identity];
}

/////////////////////////////
// ChildrenByIdentityEntry //
/////////////////////////////

function ChildrenByIdentityEntry()
{
    this.groupNum = 0;
    this.groups = {};
}

// This function adds a single child to this entry.

ChildrenByIdentityEntry.prototype.addChild = childrenByIdentityEntryAddChild;

function childrenByIdentityEntryAddChild(childId, groupId)
{
    var groupEntry;
    if(!(groupEntry = this.groups[groupId])) {
        groupEntry = this.groups[groupId] = { nodeNum: 1, nodes: {}};
        this.groupNum++;
        groupEntry.nodes[childId] = true;
    } else if(!(childId in groupEntry.nodes)) {
        groupEntry.nodes[childId] = true;
        groupEntry.nodeNum++;
    }
}

// This function removes the entry for the given child node and group.

ChildrenByIdentityEntry.prototype.removeChild = 
    childrenByIdentityEntryRemoveChild;

function childrenByIdentityEntryRemoveChild(childId, groupId)
{
    var groupEntry = this.groups[groupId];

    if(!groupEntry || !(childId in groupEntry.nodes))
        return;

    if(!--groupEntry.nodeNum) {
        this.groupNum--;
        delete this.groups[groupId];
    } else
        delete groupEntry.nodes[childId];
}

// This function remove all entries for the given group ID and returns the
// number of groups which still have an entry in the table.

ChildrenByIdentityEntry.prototype.removeGroup = 
    childrenByIdentityEntryRemoveGroup;

function childrenByIdentityEntryRemoveGroup(groupId)
{
    if(groupId in this.groups) {
        delete this.groups[groupId];
        return --this.groupNum;
    }

    return this.groupNum;
}


