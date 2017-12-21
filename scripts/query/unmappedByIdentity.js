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
// unmapped nodes by their identity and their dominating node. 
// This serves two purposes (at least):
// 1. Merging of unmapped nodes as operands under operator nodes
//    mapped by other groups, based on their identity.
// 2. Registration of mapping sub-tree monitors on the unmapped node
//    when a non-terminal mapped node with the same identity and 
//    dominating node is inside a monitored sub-tree.
//
// This table is stored at the target path where the nodes are
// unmapped.  The identity under which the unmapped nodes are stored
// is the source identity of th unmapped node itself.  In addition to
// the identity, the node dominating the unmapped node is stored. This
// dominating node may not be available (is undefined) when the target
// path is the root path. We then use a 0 dominating node ID.
// 
// Under each identity and dominating node ID, the nodes are partitioned 
// by the group which maps them. Under each group, we store the 
// unmapped nodes mapped by this group.
//
// The object interface allows adding and removing nodes from this
// table.
//
// The table structure is as follows:
//
// UnmappedByIdentity
// ------------------
//
// This class is to be used to store unmapped node by their source identity and
// dominating node. This table is stored on the target path node of the 
// unmapped nodes.
//
// {
//     identities: {
//         <source identity>: {
//              dominatingNum: {
//              dominating: {
//                   <dominating element ID>: <UnmappedByIdentityEntry>
//                   .......
//              }
//         }
//         ......
//     }
// }
//
// UnmappedByIdentityEntry
// -----------------------
//
// This is the object stored under each identity and dominating ID in the
// UnmappedByIdentity table. This object has the following structure:
//
// {
//     groupNum: <number of groups below>,
//     groups: {
//         <group ID>: {
//             nodeNum: <number of nodes below>
//             nodes: {
//                <source element ID>: true,
//                .....
//             }
//         }
//         .....
//     }
// }

////////////////////////
// UnmappedByIdentity //
////////////////////////

// constructor

function UnmappedByIdentity()
{
    this.identities = {};
}
 
// This function adds a single unmapped node to the UnmappedByIdentity
// table. The identity is
// the source identity of the source node 'sourceElementId' being
// added and dominatingId is the dominating nodes under which
// this node is unmapped (this may be 0 if adding at the root path). 
// 'groupId' is
// the ID of the group of the mapping which mapped this unmapped node.
// An entry for the given source element 'sourceElementId' is created
// under the given identity and the given dominating ID, and group ID.

UnmappedByIdentity.prototype.addUnmapped = unmappedByIdentityAddUnmapped;

function unmappedByIdentityAddUnmapped(dominatingId, identity,
                                       sourceElementId, groupId)
{
    if(dominatingId === undefined)
        dominatingId = 0;

    var identityEntry;
    if(!(identityEntry = this.identities[identity])) {
        identityEntry = this.identities[identity] = { 
            dominatingNum: 0,
            dominating: {}
        }
    }

    var dominatingEntry;
    if(!(dominatingEntry = identityEntry.dominating[dominatingId])) {
        dominatingEntry = identityEntry.dominating[dominatingId] = 
            new UnmappedByIdentityEntry();
        identityEntry.dominatingNum++;
    }
    
    dominatingEntry.addUnmapped(sourceElementId, groupId);
}

// This function returns the UnmappedByIdentityEntry object stored
// under the given identity and domianting ID. Returns undefined if
// the entry does not exist.

UnmappedByIdentity.prototype.getUnmapped = unmappedByIdentityGetUnmapped;

function unmappedByIdentityGetUnmapped(identity, dominatingId)
{
    var identityEntry;
    if(!(identityEntry = this.identities[identity]))
        return undefined;

    return identityEntry.dominating[dominatingId]; // may be undefined
}

// This function removes the entry in this table for the node with the
// given source data element ID mapped by the group with ID 'groupId'
// whose source identity (under this group) is 'identity' and which 
// is dominated by node with ID 'dominatingId'.

UnmappedByIdentity.prototype.removeUnmapped = unmappedByIdentityRemoveUnmapped;

function unmappedByIdentityRemoveUnmapped(sourceId, groupId, identity, 
                                          dominatingId)
{
    var identityEntry;
    if(!(identityEntry = this.identities[identity]))
        return;

    dominatingEntry;
    if(!(dominatingEntry = identityEntry.dominating[dominatingId]))
        return;

    if(dominatingEntry.removeUnmapped(sourceId, groupId) === 0) {
        // entry is empty after this operation
        if(!--identityEntry.dominatingNum)
            delete this.identities[identity];
        else
            delete identityEntry.dominating[dominatingId];
    }
}

// This function is called when the identification of the given source 
// element ID 'sourceId' changes under the source identification which
// applies to the groups whose group IDs are listed in the array 
// 'groupIds'. 'newIdentity' is the new identity of this node under
// this identification. In order to be able to find the entry in this
// table, this function also needs the old identity (under which the
// node is currently stored in this table).
// This function removes the source node's entry under the old identification
// and creates entries under the new identification.
// Note: it is up to the calling function to determine which groups
// this update applies to. Specifically, if the change is to the base
// identity, the calling function must not only find the groups which
// use the base identity, but also the groups which have another identification
// but this identification does not provide an identity for this node.

UnmappedByIdentity.prototype.updateIdentity = unmappedByIdentityUpdateIdentity;

function unmappedByIdentityUpdateIdentity(sourceId, dominatingIds, groupId, 
                                          oldIdentity, newIdentity)
{
    var oldIdentityEntry = this.identities[oldIdentity];

    if(!oldIdentityEntry)
        return;

    var newIdentityEntry;

    for(var i = 0, l = dominatingIds.length ; i < l ; ++i) {
        
        var dominatingId = dominatingIds[i];
        var dominatingEntry;

        if(!(dominatingEntry = oldIdentityEntry.dominating[dominatingId]))
            continue;

        if(dominatingEntry.removeUnmapped(sourceId, groupId) === false)
            continue;

        if(dominatingEntry.getGroupNum() == 0) {
            if(!--oldIdentityEntry.dominatingNum)
                delete this.identities[oldIdentity];
            else
                delete oldIdentityEntry.dominating[dominatingId];
        }

        // add this node under the new identity

        if(!newIdentityEntry) {
            if(newIdentity in this.identities)
                newIdentityEntry = this.identities[newIdentity];
            else
                newIdentityEntry = this.identities[newIdentity] =  {
                    dominatingNum: 0,
                    dominating: {}
                }
        }

        dominatingEntry;
        if(!(dominatingEntry = newIdentityEntry.dominating[dominatingId])) {
            dominatingEntry = newIdentityEntry.dominating[dominatingId] = 
                new UnmappedByIdentityEntry();
            newIdentityEntry.dominatingNum++;
        }

        dominatingEntry.addUnmapped(sourceId, groupId);
    }
}

/////////////////////////////
// UnmappedByIdentityEntry //
/////////////////////////////

function UnmappedByIdentityEntry()
{
    this.groupNum = 0;
    this.groups = {};
}

// This function adds a single unmapped node to this entry.

UnmappedByIdentityEntry.prototype.addUnmapped = 
    unmappedByIdentityEntryAddUnmapped;

function unmappedByIdentityEntryAddUnmapped(sourceElementId, groupId)
{
    var groupEntry;
    if(!(groupEntry = this.groups[groupId])) {
        groupEntry = this.groups[groupId] = { nodeNum: 1, nodes: {}};
        this.groupNum++;
    } else if(sourceElementId in groupEntry.nodes) {
        return; // already added
    } else
        groupEntry.nodeNum++;

    groupEntry.nodes[sourceElementId] = true;
}

// This function removes the entry for the given source data element ID
// and group ID from this entry. If anything was removed, the function 
// returns the number of group entries remaining after this operation 
// (0 means that the object is empty). Otherwise (if nothing was removed)
// false is returned.

UnmappedByIdentityEntry.prototype.removeUnmapped = 
    unmappedByIdentityEntryRemoveUnmapped;

function unmappedByIdentityEntryRemoveUnmapped(sourceElementId, groupId)
{
    var groupEntry;
    if(!(groupEntry = this.groups[groupId]) || 
       !(sourceElementId in groupEntry.nodes))
        return false;

    if(!--groupEntry.nodeNum) {
        delete this.groups[groupId];
        this.groupNum--;
    } else
        delete groupEntry.nodes[sourceElementId];

    return this.groupNum;
}

// Return the number of group entries stored in this object (0 if this 
// object is empty).

UnmappedByIdentityEntry.prototype.getGroupNum = 
    unmappedByIdentityEntryGetGroupNum;

function unmappedByIdentityEntryGetGroupNum()
{
    return this.groupNum;
}
