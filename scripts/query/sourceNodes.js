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


// This table is stored inside a merge group and stores information
// about the source nodes mapped by the mappings in the group. The
// information in this table only depends on the source data and the
// mappings and not on the merging at the target indexer.
//
// When the group is not an identity group, all this object provides
// is a reference count table for source IDs. It is up to the MergeGroup
// object to decide when to increase and decrease the reference count
// and whether to reference count all, some or none of the source node IDs.
//
// When the group is an identity group, the objects implemented in this
// file, IdentitySourceNodes and DominatedIdentitySourceNodes are
// responsible for allocating virtual source IDs which represent the
// different identities of the source nodes mapped by the group.
//
// The difference between IdentitySourceNodes and DominatedIdentitySourceNodes
// is that while IdentitySourceNodes assigns the virtual identity node ID
// based on the identity of the source node alone, DominatedIdentitySourceNodes
// also takes the identity of the parent of the source node
// (that is, the dominating node at the immediate prefix path of the source
// path) into account (so a virtual identity ID is assigned to every
// <parent identity, identity> pair). DominatedIdentitySourceNodes is used
// for identity groups where both the source and the target path is not
// the root path and therefore the dominating nodes under which an identity
// node is merged are determined by the identity of the parent of the source
// node (and, therefore, two source nodes with the same identity but
// differnet parent identities must be assigned different virtual identity
// source IDs).

/////////////////
// SourceNodes //
/////////////////

// This is the basic class used for non-identity groups. It implements
// a simple reference count on element IDs.

// {
//     nodes: <Map>{
//         <source node ID>: <count>
//         .....
//     }
// }
//
// nodes: this Map object store the reference counts for the source node IDs
//     which are added to it.

/////////////////
// SourceNodes //
/////////////////

//
// Constructor
//

function SourceNodes()
{
    this.nodes = new Map();
}

// Returns true if the given source node is in the table

SourceNodes.prototype.hasNode = sourceNodesHasNode;

function sourceNodesHasNode(sourceId)
{
    return this.nodes.has(sourceId);
}

// returns the reference count of this given source ID. May return undefined
// if the source ID is not found in the table.

SourceNodes.prototype.getCount = sourceNodesGetCount;

function sourceNodesGetCount(sourceId)
{
    return this.nodes.get(sourceId);
}

// returns the number of elements stored in the 'nodes' table (number of
// elements for which reference counting took place and it is at least 1).

SourceNodes.prototype.numNodes = sourceNodesNumNodes;

function sourceNodesNumNodes()
{
    return this.nodes.size;
}

// This function increments by 1 the reference count for the given source
// node and returns true if this was the first time 'sourceId'
// was added and false if an entry for 'sourceId' already existed.

SourceNodes.prototype.incNode = sourceNodesIncNode;

function sourceNodesIncNode(sourceId)
{
    if(!this.nodes.has(sourceId)) {
        this.nodes.set(sourceId, 1);
        return true;
    }

    this.nodes.set(sourceId, this.nodes.get(sourceId) + 1);   
    return false;
}

// This function decrements by 1 the reference count for the given source
// node and returns the remaining reference count after the operation

SourceNodes.prototype.decNode = sourceNodesDecNode;

function sourceNodesDecNode(sourceId)
{
    var count = this.nodes.get(sourceId) - 1;

    if(count == 0)
        this.nodes.delete(sourceId);
    else
        this.nodes.set(sourceId, count);

    return count;
}

// Clear all source nodes

SourceNodes.prototype.clear = sourceNodesClear;

function sourceNodesClear()
{
    this.nodes.clear();
}

// Return all source node IDs currently stored in the table

SourceNodes.prototype.getAllSourceNodes = sourceNodesGetAllSourceNodes;

function sourceNodesGetAllSourceNodes()
{
    var sourceIds = [];
    
    this.nodes.forEach(function(c, sourceId) {
        sourceIds.push(sourceId);
    });

    return sourceIds;
}

// Return an array contaiing the subset of the elements in the input array
// 'sourceIds' which are stored in the 'nodes' table.

SourceNodes.prototype.filterSourceNodes = sourceNodesFilterSourceNodes;

function sourceNodesFilterSourceNodes(sourceIds)
{
    var filtered = [];

    if(this.nodes.size == 0)
        return filtered;
    
    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
        var sourceId = sourceIds[i];
        if(this.nodes.has(sourceId))
            filtered.push(sourceId);
    }

    return filtered;
}

/////////////////////////
// IdentitySourceNodes //
/////////////////////////

// The IdentitySourceNodes object is created to allocate and store the
// virtual source nodes for an identity group. This object is used in
// cases where either the source or the target path of the identity group
// is the root path and therefore no identity of the parents of the nodes
// mapped is needed in order to determine the dominating nodes under which
// the mapped nodes are to be merged (if the target path is the root path
// there are no dominating nodes to insert under and if the source path is the
// root path, there is no parent to use for this purpose).
//
// This object does not only store the source nodes mapped from the source
// indexer, but merely keeps a reference count of the number of nodes
// mapped to each virtual identity node ID, where each identity node ID
// is assigned to a single identity. In addition to this reference count,
// this object must store  mapping from the identities to the virtual
// identity node IDs assigned for them. This object is also responsible
// for fetching the identities from the source indexer. For this reason,
// this object stores both the source indexer and the source identification ID.
//
// {
//     sourceIndexer: <source indexer of these nodes>,
//     sourceIdentificationId: <identification ID>,
//
//     identityNodes: <Map>{
//         <identity node ID>: {
//              identity: <identity>,
//              count: <reference count>
//         }
//         .....
//     },
//     byIdentities: <Map>{
//         <identity>: <identityNodeId>
//         ......
//     }
//     raised: <Map>{
//         <element ID>: <count>
//         ......
//     }
// }
//
// sourceIndexer: the source indexer of the identity group which maps
//    the source nodes (provided upon construction). This may be replaced
//    after construction.
// sourceIdentificationId: the source identification of the identity group
//    which maps the source nodes (provided upon construction).
//    This may be replaced after construction.
// identityNodes: this a map whose keys are the virtual source IDs
//    allocated here for the identities. Under each node ID we store its
//    identity and its reference count.
// byIdentities: this table stores all identity node IDs indexed by their
//    identity.
// raised: this is an optional table which is only used when the group
//    this belongs to is not a maximal group and there are some operands
//    at the source path. In that case, operand source nodes which are
//    received from the previous group need to be raised to the operator
//    before being added to this group (as it is the operator's identity
//    which determines the identity here). The elements raised are stored
//    here with a reference count.

// Constructor:
// 'sourceIndexer' and 'sourceIdentificationId': the source indexer and
// identification of the group this object is created for.

function IdentitySourceNodes(sourceIndexer, sourceIdentificationId, isMaxGroup)
{
    this.sourceIndexer = sourceIndexer;
    this.sourceIdentificationId = sourceIdentificationId;
    
    this.identityNodes = new Map();
    this.byIdentities = new Map();
}

// This is an auxiliary function. Given a source data element ID
// (in the source indexer) this function returns its identity
// (in the source indexer) using the identification ID in
// this.sourceIdentificationId.

IdentitySourceNodes.prototype.getSourceIdentity =
    identitySourceNodesGetSourceIdentity;

function identitySourceNodesGetSourceIdentity(sourceId)
{
    return this.sourceIndexer.getIdentity(this.sourceIdentificationId,
                                          sourceId);
}

// Assign a identity data element ID to the given identity. If the identity
// is positive, it is a data element ID, so we can use it as its own
// identity data element ID. Otherwise, a new data element ID is assigned
// and returned.

IdentitySourceNodes.prototype.assignDataElementId =
    identitySourceNodesAssignDataElementId;

function identitySourceNodesAssignDataElementId(identity)
{
    if(identity > 0)
        // the identity is a data element ID, so can use directly
        return identity;

    return InternalQCMIndexer.getNextDataElementId();
}

// This function increases the reference count for the identity node for
// the identity of the given source node. The function determines the identity
// of the source node, and, if no node ID is yet assigned to this identity,
// assigns it an identity node ID. If an identity node Id was already
// assigned to this identity, its refernece coutn is increased. The function
// returns an object of the following form:
// {
//    idNodeId: <identity node ID>,
//    identity: <source identity>
//    isNew: true|false  
// }
// where idNodeId is the element ID assigned to the identity of 'sourceId',
// 'identity' is the source identity of 'sourceId' and 'isNew' indicates
// whether this is the first time a node with the given identity was added.

IdentitySourceNodes.prototype.incNode =
    identitySourceNodesIncNode;

function identitySourceNodesIncNode(sourceId)
{
    var identity = this.getSourceIdentity(sourceId);
    var idNodeId;
    var isNew;
    
    if(this.byIdentities.has(identity)) { // an existing identity
        idNodeId = this.byIdentities.get(identity);
        var entry = this.identityNodes.get(idNodeId);
        entry.count++;
        isNew = false;
    } else {
        // new identity, allocate a new identity node ID
        idNodeId = this.assignDataElementId(identity);
        this.byIdentities.set(identity, idNodeId);
        this.identityNodes.set(idNodeId, { identity: identity, count: 1 });
        isNew = true;
    }

    return { idNodeId: idNodeId, identity: identity, isNew: isNew };
}

// This function decreases the reference count of the identity node
// assigned to the identity of the given source ID. It is assumed that
// the reference count is never decreased more often than it is increased
// for a given identity. After decreasing the reference count and possibly
// removing the entry (if the reference count ropped to zero), the
// function returns an object of the following structure:
// {
//    idNodeId: <identity node ID>,
//    identity: <sourc identity>,
//    count: <remaining reference count after this decrease>
// }

IdentitySourceNodes.prototype.decNode =
    identitySourceNodesDecNode;

function identitySourceNodesDecNode(sourceId)
{
    var identity = this.getSourceIdentity(sourceId);
    var idNodeId = this.byIdentities.get(identity);
    var entry = this.identityNodes.get(idNodeId);

    if(--entry.count === 0) {
        this.identityNodes.delete(idNodeId);
        this.byIdentities.delete(identity);
    }

    return { idNodeId: idNodeId, identity: identity, count: entry.count };
}

// Call this when the original source ID (received form a previous group)
// needs to be raised to a dominating operator. The group should then register
// this element ID here, to keep track of th enumber of times it was mapped.
// This function returns the reference count of the element after this update.

IdentitySourceNodes.prototype.incRaised =
    identitySourceNodesIncRaised;

function identitySourceNodesIncRaised(sourceId)
{
    if(this.raised === undefined)
        this.raised = new Map();

    if(this.raised.has(sourceId)) {
        var count = this.raised.get(sourceId) + 1;
        this.raised.set(sourceId, count);
        return count;
    } else {
        this.raised.set(sourceId, 1);
        return 1;
    }
}

// Call this when the original source ID (received form a previous group)
// needs to be raised to a dominating operator before being removed.
// The group should then call this function to register the removal.
// This allows the reference count of these raised nodes to be tracked.
// This function returns the count of the raised element after this removal.

IdentitySourceNodes.prototype.decRaised =
    identitySourceNodesDecRaised;

function identitySourceNodesDecRaised(sourceId)
{
    var count = this.raised.get(sourceId) - 1;

    if(count == 0)
        this.raised.delete(sourceId);
    else
        this.raised.set(sourceId, count);

    return count;
}

// Returns the reference count of this source element ID (from the souce
// indexer) in the 'raised' table, that is, only if this is an operator whose
// operands were mapped by the projection. This returns 0 if the node is not
// in the table.

IdentitySourceNodes.prototype.getRaisedCount =
    identitySourceNodesGetRaisedCount;

function identitySourceNodesGetRaisedCount(sourceId)
{
    if(this.raised === undefined)
        return 0;

    if(!this.raised.has(sourceId))
        return 0;

    return this.raised.get(sourceId);
}

// returns the number of elements in the 'raised' table.

IdentitySourceNodes.prototype.numRaised =
    identitySourceNodesNumRaised;

function identitySourceNodesNumRaised()
{
    if(this.raised === undefined)
        return 0;

    return this.raised.size;
}

// clear all nodes stored in this object

IdentitySourceNodes.prototype.clear =
    identitySourceNodesClear;

function identitySourceNodesClear()
{
    this.identityNodes.clear();
    this.byIdentities.clear();
    if(this.raised !== undefined)
        this.raised.clear();
}

// Return all identity node IDs currently stored in the table

IdentitySourceNodes.prototype.getAllSourceNodes =
    identitySourceNodesGetAllSourceNodes;

function identitySourceNodesGetAllSourceNodes()
{
    var idNodeIds = [];
    
    this.identityNodes.forEach(function(c, idNodeId) {
        idNodeIds.push(idNodeId);
    });

    return idNodeIds;
}

// If an identity node ID was already allocated for the identity of the
// given source node, this function returns that node ID. Otherwise,
// undefined is returned.

IdentitySourceNodes.prototype.getIdentityNodeId =
    identitySourceNodesGetIdentityNodeId;

function identitySourceNodesGetIdentityNodeId(sourceId)
{
    var identity = this.getSourceIdentity(sourceId);

    if(identity === undefined)
        return undefined;

    return this.byIdentities.get(identity);
}

// 'idNodeId' should be the ID of a virtual identity node allocated
// by this object. This function returns the identity for which it
// was allocated.

IdentitySourceNodes.prototype.getIdNodeIdentity =
    identitySourceNodesGetIdNodeIdentity;

function identitySourceNodesGetIdNodeIdentity(idNodeId)
{
    var entry = this.identityNodes.get(idNodeId);
    if(entry === undefined)
        return undefined;

    return entry.identity;
}

// Same as getIdNodeIdentity(), but applied to an array of identity
// node IDs and returning an array of identities.

IdentitySourceNodes.prototype.getIdNodeIdentities =
    identitySourceNodesGetIdNodeIdentities;

function identitySourceNodesGetIdNodeIdentities(idNodeIds)
{
    var identities = [];
    for(var i = 0, l = idNodeIds.length ; i < l ; ++i) {

        var entry = this.identityNodes.get(idNodeIds[i]);
        if(entry === undefined)
            continue;
        identities[i] = entry.identity;
    }

    return identities;
}

// This function replaces the identification for this object, which is
// defined by a source indexer and a source identification ID. All this
// function needs to do is replace the values stored on the object, as it
// is the responsibility of the calling function to make sure that any nodes
// affected by this change are updated.

IdentitySourceNodes.prototype.replaceSourceIdentification =
    identitySourceNodesReplaceSourceIdentification;

function identitySourceNodesReplaceSourceIdentification(sourceIndexer,
                                                        sourceIdentificationId)
{
    this.sourceIndexer = sourceIndexer;
    this.sourceIdentificationId = sourceIdentificationId;
}

// This function is called when the source identity of 'sourceId' changes
// to 'newIdentity'. When this function is called, the old identity can
// still be retrieved form the source indexer. 'refCount' is the reference count
// with which 'sourceId' was added to the group (and therefore also to
// this IdentitySourceNodes object). The function then subtracts the given
// reference count from the identity node for the old identity and
// adds it to the identity node of the new identity. If the reference count
// of the old identity node dropped to zero, the node ID is returned in
// the 'removed' list below and if a new identity node had to be allocated
// for the new identity, the new node ID is returned in the 'added' list
// below. The function returns the following object:
// {
//    added: <array of new identity nodes added, each represented by an object:
//             {
//                 idNodeId: <identity node ID>
//             }
//           >,
//    removed: <array of identity node IDs just removed>
// }
// (the reason the first array stores object is in order to have a common
// format with the objet returned by the 'updateIdentity()' function of
// DominatedIdentitySourceNodes.

IdentitySourceNodes.prototype.updateIdentity =
    identitySourceNodesUpdateIdentity;

function identitySourceNodesUpdateIdentity(sourceId, refCount, newIdentity)
{
    var update = { added: [], removed: [] };
    var oldIdentity = this.getSourceIdentity(sourceId);
    if(oldIdentity == newIdentity)
        return update; // nothing changed
    
    // decrease reference count of old identity

    var idNodeId = this.byIdentities.get(oldIdentity);
    var oldEntry = this.identityNodes.get(idNodeId);

    oldEntry.count -= refCount;
    
    if(oldEntry.count <= 0) {
        this.identityNodes.delete(idNodeId);
        this.byIdentities.delete(oldIdentity);
        update.removed.push(idNodeId);
    }

    // increase reference count of new identity

    if(this.byIdentities.has(newIdentity)) { // an existing identity
        idNodeId = this.byIdentities.get(newIdentity);
        var newEntry = this.identityNodes.get(idNodeId);
        newEntry.count += refCount;
    } else {
        // new identity, allocate a new identity node ID
        idNodeId = this.assignDataElementId(newIdentity);
        this.byIdentities.set(newIdentity, idNodeId);
        this.identityNodes.set(idNodeId, { identity: newIdentity,
                                           count: refCount });
        update.added.push({ idNodeId: idNodeId });
    }

    return update;
}

//////////////////////////////////
// DominatedIdentitySourceNodes //
//////////////////////////////////

// This class is similar to IdentitySourceNodes except that it is to
// be used for identity classes which have both a source path and a target
// path which are not root paths. Therefore, the dominating nodes
// under which the identity nodes generated by this object depend on
// the identity of the parent nodes of the source nodes. Therefore,
// we here create a separate identity node for each combination of
// source node identity and parent source node identity.
//
// Both the identity and the parent identity of each source node are stored
// in the sourceNodes table. Because the parent source node is often the
// same data element as the source node itself (and therefore has the
// same identity), we store the parent identity separately
// only if the parent source node data element is not the same as
// the source node data element.
//
// The object structure is as follows:
// {
//     // fields in addition to those already found in the base class
//
//     sourceIndexer: <source indexer of these nodes>,
//     sourceIdentificationId: <identification ID>,
//     prefixSourcePathId: <prefix of the source path of this identity group>,
//
//     identityNodes: <Map>{ // same as in 
//         <identity node ID>: {
//             identity: <identity of node>
//              parentIdentity: <identity of parent>
//              count: <ref count>
//         }
//         ......
//     }
//
//     byIdentities: <Map>{
//         <identity>: {
//              idNodeId: <identity node ID> // if identity == parent identity
//              parentIdentities: <Map>{
//                  <parent identity>: <identity node ID>
//                  ......
//              }
//         },
//         ......
//     }
//
//     raised: <Map>{
//         <element ID>: <count>
//         ......
//     }
//     parents: <Map>{
//         <element ID>: <count>,
//         ......
//     }
// }
//
// sourceIndexer: the source indexer of the identity group which maps
//    the source nodes (provided upon construction). This may be replaced
//    after construction.
// sourceIdentificationId: the source identification of the identity group
//    which maps the source nodes (provided upon construction).
//    This may be replaced after construction.
// prefixSourcePathId: this is the prefix path of the source path of the
//    group to which this object belongs. This is the path at which the
//    parent source nodes are to be found.
// identityNodes: this a map whose keys are the virtual source IDs
//    allocated here for the identities, with a reference count. The reference
//    count is stored under 'count'. We also store here the identity of the
//    parent of the nodes which are assigned to identity node (this
//    is used to determine the domianting nodes when this node is mapped).
// byIdentities: this table stores all identity node IDs indexed by their
//    identity and their parent identity. Since it is often the case
//    that the identity and the parent identity are the same, the node
//    ID assigned in case the identity and the parent identity are the same
//    is stored under 'idNodeId' (it is set to undefined if there is no
//    such node ID, that is, the reference count of such a combination
//    is zero) . For cases where the parent identity is not the same as
//    the identity, the parent identities are stored in the table
//    'parentIdentities' (this table is created only when needed).
// raised: this is an optional table which is only used when the group
//    this belongs to is not a maximal group and there are some operands
//    at the source path. In that case, operand source nodes which are
//    received from the previous group need to be raised to the operator
//    before being added to this group (as it is the operator's identity
//    which determines the identity here). The elements raised are stored
//    here with a reference count.
// parents: this is an optional table stored only when source nodes
//    are added whose parent node has a different element ID. The parent
//    element IDs are then stored here, to make it simpler to determine
//    whether an element is a parent of a mapped source node and
//    what the reference count of this parent is.


// Constructor:
// 'sourceIndexer' and 'sourceIdentificationId': the source indexer and
// identification of the group this object is created for. 'sourcePathId'
// is the source path of the group to which this object belongs.

function DominatedIdentitySourceNodes(sourceIndexer, sourceIdentificationId,
                                      sourcePathId)
{
    this.sourceIndexer = sourceIndexer;
    this.sourceIdentificationId = sourceIdentificationId;
    this.prefixSourcePathId = sourceIndexer.qcm.getPrefix(sourcePathId);
    
    this.identityNodes = new Map();
    this.byIdentities = new Map();
}

// This is an auxiliary function. Given a source data element ID
// (in the source indexer) this function returns its identity
// (in the source indexer) using the identification ID in
// this.sourceIdentificationId. This can be used both for the source IDs
// and the parent source IDs mapped by this group.

DominatedIdentitySourceNodes.prototype.getSourceIdentity =
    dominatedIdentitySourceNodesGetSourceIdentity;

function dominatedIdentitySourceNodesGetSourceIdentity(sourceId)
{
    return this.sourceIndexer.getIdentity(this.sourceIdentificationId,
                                          sourceId);
}

// Assign a identity data element ID to the given identity and parent
// identity. If the identity and parent identity are equal and
// positive, it is a data element ID, so we can use it as its own
// identity data element ID. Otherwise, a new data element ID is assigned
// and returned.

DominatedIdentitySourceNodes.prototype.assignDataElementId =
    dominatedIdentitySourceNodesAssignDataElementId;

function dominatedIdentitySourceNodesAssignDataElementId(identity,
                                                         parentIdentity)
{
    if(identity > 0 && identity === parentIdentity)
        // the identity is a data element ID, so can use directly
        return identity;

    return InternalQCMIndexer.getNextDataElementId();
}


// This function increases (by 1) the reference count for the identity node for
// the identity of the given source node + identity of the parent node ID.
// The function begins by determining the parent ID. It then determines
// the identities of the source node and its parent, and, if no node ID is
// yet assigned to this pair of identities, assigns them an identity node ID.
// If an identity node Id was already assigned to this identity, its
// refernece count is increased. The function returns an object of
// the following form:
// {
//    idNodeId: < identity node ID>,
//    identity: <source identity>,
//    parentId: <source parent element ID>
//    parentIdentity: <parent source identity>
//    isNew: true|false  
// }
// where idNodeId is the element ID assigned to the identities of 'sourceId'
// and its parent, 'identity' is the source identity of 'sourceId',
// 'parentId' is the element ID of the parent source node,  
// 'parentIdentity' is the identity of the parent and 'isNew' indicates
// whether this is the first time a node with the given identities was added.

DominatedIdentitySourceNodes.prototype.incNode =
    dominatedIdentitySourceNodesIncNode;

function dominatedIdentitySourceNodesIncNode(sourceId)
{
    // find the parent source ID
    var parentSourceId =
        this.sourceIndexer.raiseToPath(sourceId, this.prefixSourcePathId);
    var identity = this.getSourceIdentity(sourceId);
    var parentIdentity;

    if(parentSourceId !== sourceId) {
        parentIdentity = this.getSourceIdentity(parentSourceId);
        this.incParent(parentSourceId);
    } else
        parentIdentity = identity;

    return this.incNodeWithParent(sourceId, parentSourceId, identity,
                                  parentIdentity, 1);
}

// This is an auxiliary function which should only be called fro inside this
// class.
// This function increases the reference count for the identity node for
// the identity of the given source node + identity of the parent node ID.
// As opposed to incNode(), this function receives not only the source ID,
// but also the parent source ID the identity of the source ID and the
// parent identity as input (this not only spares repeated lookup but also
// allows a new identity to be set before that identity is available
// from the source indexer, during an identity refresh).
// 'incCount' is the amount by which to increase the reference count.
// The function begins by finding the identity node already assigned to
// the node and parent identities and if no such identity node exists,
// allocates such a node.
// If an identity node Id was already assigned to this identity, its
// reference count is increased (by the amount given) and otherwise it is
// set to the amount given. The function returns an object of
// the following form:
// {
//    idNodeId: < identity node ID>,
//    identity: <source identity>,
//    parentId: <source parent element ID>
//    parentIdentity: <parent source identity>
//    isNew: true|false  
// }
// where idNodeId is the element ID assigned to the identities of 'sourceId'
// and its parent, 'identity' is the source identity of 'sourceId',
// 'parentId' is the element ID of the parent source node,  
// 'parentIdentity' is the identity of the parent and 'isNew' indicates
// whether this is the first time a node with the given identities was added.

DominatedIdentitySourceNodes.prototype.incNodeWithParent =
    dominatedIdentitySourceNodesIncNodeWithParent;

function dominatedIdentitySourceNodesIncNodeWithParent(sourceId, parentSourceId,
                                                       identity, parentIdentity,
                                                       incCount)
{
    var idNodeId;
    var isNew;
    var entry;
    
    if(this.byIdentities.has(identity))
        entry = this.byIdentities.get(identity);
    else {
        entry = { idNodeId: undefined, parentIdentities: undefined };
        this.byIdentities.set(identity, entry);
        isNew = true;
    }
    
    if(identity == parentIdentity) {
        if(entry.idNodeId !== undefined) {
            idNodeId = entry.idNodeId;
            isNew = false;
        } else { // new identity pair
            idNodeId = entry.idNodeId =
                this.assignDataElementId(identity, parentIdentity);
            isNew = true;
        }
    } else {
        if(entry.parentIdentities === undefined)
            entry.parentIdentities = new Map();
        else if(entry.parentIdentities.has(parentIdentity)) {
            idNodeId = entry.parentIdentities.get(parentIdentity);
            isNew = false;
        }

        if(isNew !== false) {
            isNew = true;
            idNodeId = this.assignDataElementId(identity, parentIdentity);
            entry.parentIdentities.set(parentIdentity, idNodeId);
        }
    }

    if(isNew)
        this.identityNodes.set(idNodeId, { identity: identity,
                                           parentIdentity: parentIdentity,
                                           count: incCount });
    else {
        var nodeEntry = this.identityNodes.get(idNodeId);
        nodeEntry.count += incCount;
    }
    
    return { idNodeId: idNodeId, parentId: parentSourceId,
             identity: identity, parentIdentity: parentIdentity, isNew: isNew };
}

// This function decreases by 1 the reference count for the identity node for
// the identity of the given source node + identity of the parent node ID.
// The function begins by determining the parent ID. It then determines
// the identities of the source node and its parent and then determines
// the node ID assigned to this pair of identities. It then decreases
// the reference count for this node ID and if this drops to zero, clears
// the entry for this node ID (in all tables). The function returns an object
// with the following structure:
// {
//    idNodeId: < identity node ID>,
//    identity: <source identity>,
//    parentId: <source parent element ID>
//    parentIdentity: <parent source identity>
//    count: <number>  
// }
// where idNodeId is the element ID assigned to the identities of 'sourceId'
// and its parent, 'identity' is the source identity of 'sourceId',
// 'parentId' is the element ID of the parent source node,  
// 'parentIdentity' is the identity of the parent and 'count' is the
// reference count for this identity pair after this operation.

DominatedIdentitySourceNodes.prototype.decNode =
    dominatedIdentitySourceNodesDecNode;

function dominatedIdentitySourceNodesDecNode(sourceId, decCount)
{
    if(decCount === undefined)
        decCount = 1;
    
    // find the parent source ID
    var parentSourceId =
        this.sourceIndexer.raiseToPath(sourceId, this.prefixSourcePathId);
    var identity = this.getSourceIdentity(sourceId);
    var parentIdentity;

    if(parentSourceId !== sourceId) {
        parentIdentity = this.getSourceIdentity(parentSourceId);
        this.decParent(parentSourceId);
    } else
        parentIdentity = identity;
    
    return this.decNodeWithParent(sourceId, parentSourceId, identity,
                                  parentIdentity, 1);
}

// This is an auxiliary function which should only be called from inside this
// class.
// This function implements most of the work to be performed by decNode()
// and has the same return value.
// As opposed to decNode(), this function receives not only the source ID,
// but also the parent source ID, the identity of the source ID and the
// parent identity as input.
// 'decCount' is the amount by which to increase the reference count. 
// The function begins by determining the node ID assigned to this pair
// of identities. It then decreases the reference count for this node ID
// and if this drops to zero, clears the entry for this node ID (in all
// tables). The function returns an object with the following structure:
// {
//    idNodeId: < identity node ID>,
//    identity: <source identity>,
//    parentId: <source parent element ID>
//    parentIdentity: <parent source identity>
//    count: <number>  
// }
// where idNodeId is the element ID assigned to the identities of 'sourceId'
// and its parent, 'identity' is the source identity of 'sourceId',
// 'parentId' is the element ID of the parent source node,  
// 'parentIdentity' is the identity of the parent and 'count' is the
// reference count for this identity pair after this operation.

DominatedIdentitySourceNodes.prototype.decNodeWithParent =
    dominatedIdentitySourceNodesDecNodeWithParent;

function dominatedIdentitySourceNodesDecNodeWithParent(sourceId, parentSourceId,
                                                       identity, parentIdentity,
                                                       decCount)
{
    var entry = this.byIdentities.get(identity);
    var idNodeId;
    
    if(identity == parentIdentity)
        idNodeId = entry.idNodeId;
    else
        idNodeId = entry.parentIdentities.get(parentIdentity);

    var nodeEntry = this.identityNodes.get(idNodeId);

    nodeEntry.count -= decCount;
    if(nodeEntry.count == 0) {
        // delete the node ID and its identities
        this.identityNodes.delete(idNodeId);
        if(identity == parentIdentity) {
            if(entry.parentIdentities === undefined ||
               entry.parentIdentities.size == 0) // last node identity
                this.byIdentities.delete(identity);
            else
                entry.idNodeId = undefined;
        } else if(entry.parentIdentities.size == 1 &&
                  entry.idNodeId === undefined) {
            this.byIdentities.delete(identity);
        } else
            entry.parentIdentities.delete(parentIdentity);
    }

    return { idNodeId: idNodeId, parentId: parentSourceId,
             identity: identity, parentIdentity: parentIdentity,
             count: nodeEntry.count };
}

// Call this when the original source ID (received form a previous group)
// needs to be raised to a dominating operator. The group should then register
// this element ID here, to keep track of th enumber of times it was mapped.
// This function returns the reference count of the element after this update.

DominatedIdentitySourceNodes.prototype.incRaised =
    dominatedIdentitySourceNodesIncRaised;

function dominatedIdentitySourceNodesIncRaised(sourceId)
{
    if(this.raised === undefined)
        this.raised = new Map();

    if(this.raised.has(sourceId)) {
        var count = this.raised.get(sourceId) + 1;
        this.raised.set(sourceId, count);
        return count;
    } else {
        this.raised.set(sourceId, 1);
        return 1;
    }
}

// Call this when the original source ID (received form a previous group)
// needs to be raised to a dominating operator before being removed.
// The group should then call this function to register the removal.
// This allows the reference count of these raised nodes to be tracked.
// This function returns the count of the raised element after this removal.

DominatedIdentitySourceNodes.prototype.decRaised =
    dominatedIdentitySourceNodesDecRaised;

function dominatedIdentitySourceNodesDecRaised(sourceId)
{
    var count = this.raised.get(sourceId) - 1;

    if(count == 0)
        this.raised.delete(sourceId);
    else
        this.raised.set(sourceId, count);

    return count;
}

// Returns the reference count of this source element ID (from the souce
// indexer) in the 'raised' table, that is, only if this is an operator whose
// operands were mapped by the projection. This returns 0 if the node is not
// in the table.

DominatedIdentitySourceNodes.prototype.getRaisedCount =
    dominatedIdentitySourceNodesGetRaisedCount;

function dominatedIdentitySourceNodesGetRaisedCount(sourceId)
{
    if(this.raised === undefined)
        return 0;

    if(!this.raised.has(sourceId))
        return 0;

    return this.raised.get(sourceId);
}

// returns the number of elements in the 'raised' table.

DominatedIdentitySourceNodes.prototype.numRaised =
    dominatedIdentitySourceNodesNumRaised;

function dominatedIdentitySourceNodesNumRaised()
{
    if(this.raised === undefined)
        return 0;

    return this.raised.size;
}

// Call this when the parent of the original source ID (used to determine
// the dominating identity) is not the same as the source ID mapped.
// The incNode() function then register this element ID here, to keep track
// of th enumber of times it was mapped.
// This function returns the reference count of the element after this update.

DominatedIdentitySourceNodes.prototype.incParent =
    dominatedIdentitySourceNodesIncParent;

function dominatedIdentitySourceNodesIncParent(parentId)
{
    if(this.parents === undefined)
        this.parents = new Map();

    if(this.parents.has(parentId)) {
        var count = this.parents.get(parentId) + 1;
        this.parents.set(parentId, count);
        return count;
    } else {
        this.parents.set(parentId, 1);
        return 1;
    }
}

// This is called by the decNode() function when the parent of the original
// source ID being removed is not the same as the source ID mapped. This
// decreases the count of the parent ID in the 'parents' table allowing to
// trace the number of times this parent was used.
// This function returns the count of the parent element after this removal.

DominatedIdentitySourceNodes.prototype.decParent =
    dominatedIdentitySourceNodesDecParent;

function dominatedIdentitySourceNodesDecParent(parentId)
{
    var count = this.parents.get(parentId) - 1;

    if(count == 0)
        this.parents.delete(parentId);
    else
        this.parents.set(parentId, count);

    return count;
}

// Returns the reference count of this parent element ID (from the source
// indexer) in the 'parents' table, that is, only if teh parent ID is different
// from the element ID of the source node mapped. This returns 0 if the node
// is not in the table.

DominatedIdentitySourceNodes.prototype.getParentCount =
    dominatedIdentitySourceNodesGetParentCount;

function dominatedIdentitySourceNodesGetParentCount(parentId)
{
    if(this.parents === undefined)
        return 0;

    if(!this.parents.has(parentId))
        return 0;

    return this.parents.get(parentId);
}

// returns the number of elements in the 'parents' table.

DominatedIdentitySourceNodes.prototype.numParents =
    dominatedIdentitySourceNodesNumParents;

function dominatedIdentitySourceNodesNumParents()
{
    if(this.parents === undefined)
        return 0;

    return this.parents.size;
}

// clear all nodes stored in this object

DominatedIdentitySourceNodes.prototype.clear =
    dominatedIdentitySourceNodesClear;

function dominatedIdentitySourceNodesClear()
{
    this.identityNodes.clear();
    this.byIdentities.clear();
    if(this.raised !== undefined)
        this.raised.clear();
    if(this.parents !== undefined)
        this.parents.clear();
}

// This function replaces the identification for this object, which is
// defined by a source indexer and a source identification ID. All this
// function needs to do is replace the values stored on the object, as it
// is the responsibility of the calling function to make sure that any nodes
// affected by this change are updated.

DominatedIdentitySourceNodes.prototype.replaceSourceIdentification =
    dominatedIdentitySourceNodesReplaceSourceIdentification;

function dominatedIdentitySourceNodesReplaceSourceIdentification(sourceIndexer,
                                                        sourceIdentificationId)
{
    this.sourceIndexer = sourceIndexer;
    this.sourceIdentificationId = sourceIdentificationId;
}

// Return all identity node IDs currently stored in the table

DominatedIdentitySourceNodes.prototype.getAllSourceNodes =
    dominatedIdentitySourceNodesGetAllSourceNodes;

function dominatedIdentitySourceNodesGetAllSourceNodes()
{
    var idNodeIds = [];
    
    this.identityNodes.forEach(function(c, idNodeId) {
        idNodeIds.push(idNodeId);
    });

    return idNodeIds;
}

// If an identity node ID was already allocated for the identity of the
// given source node and its parent, this function returns that node ID.
// Otherwise, undefined is returned.

DominatedIdentitySourceNodes.prototype.getIdentityNodeId =
    dominatedIdentitySourceNodesGetIdentityNodeId;

function dominatedIdentitySourceNodesGetIdentityNodeId(sourceId)
{
    // find the parent source ID
    var parentSourceId =
        this.sourceIndexer.raiseToPath(sourceId, this.prefixSourcePathId);
    var identity = this.getSourceIdentity(sourceId);
    var parentIdentity = (parentSourceId == sourceId) ?
        identity : this.getSourceIdentity(parentSourceId);

    var entry = this.byIdentities.get(identity);

    if(entry === undefined)
        return undefined;
    
    if(identity == parentIdentity)
        return entry.idNodeId;

    if(entry.parentIdentities == undefined)
        return undefined;
    
    return entry.parentIdentities.get(parentIdentity);
}

// 'idNodeId' should be the ID of a virtual identity node allocated
// by this object. This function returns the identity for which it
// was allocated.

DominatedIdentitySourceNodes.prototype.getIdNodeIdentity =
    dominatedIdentitySourceNodesGetIdNodeIdentity;

function dominatedIdentitySourceNodesGetIdNodeIdentity(idNodeId)
{
    var entry = this.identityNodes.get(idNodeId);
    if(entry === undefined)
        return undefined;

    return entry.identity;
}

// this function returns the identity of the parent source nodes for
// the nodes to which this identity node ID is assigned.

DominatedIdentitySourceNodes.prototype.getParentIdentity =
    dominatedIdentitySourceNodesGetParentIdentity;

function dominatedIdentitySourceNodesGetParentIdentity(idNodeId)
{
    var entry = this.identityNodes.get(idNodeId);

    if(entry === undefined)
        return undefined;

    return entry.parentIdentity;
}

// This function is called when the source identity of 'sourceId' changes
// to 'newIdentity'. When this function is called, the old identity
// of both this node and possibly its parent node (if relevant) can
// still be retrieved from the source indexer (if both the source node's
// identity and its parent's identity changed, two updates are received
// here, once calling this function and once updateParentIdentity()).
// 'refCount' is the reference count with which 'sourceId' was added
// to the group (and therefore also to this DominatedIdentitySourceNodes
// object). The function then subtracts the given reference count from
// the identity node for the old identity and adds it to the identity
// node of the new identity. If the reference count of the old
// identity node dropped to zero, the node ID is returned in the
// 'removed' list below and if a new identity node had to be allocated
// for the new identity, the new node ID is returned in the 'added'
// list below. The function returns the following object:
// {
//    added: <array of new identity nodes added, each represented by an object:
//             {
//                 idNodeId: <identity node ID>
//                 parentIdentity: <parent identity for this identity node>
//             }
//           >,
//    removed: <array of identity node IDs just removed>
// }

DominatedIdentitySourceNodes.prototype.updateIdentity =
    dominatedIdentitySourceNodesUpdateIdentity;

function dominatedIdentitySourceNodesUpdateIdentity(sourceId, refCount,
                                                    newIdentity)
{
    var update = { added: [], removed: [] };

    // decrease reference count of old identity
    
    // find the parent source ID
    var parentSourceId =
        this.sourceIndexer.raiseToPath(sourceId, this.prefixSourcePathId);
    var identity = this.getSourceIdentity(sourceId);
    var parentIdentity = (parentSourceId == sourceId) ?
        identity : this.getSourceIdentity(parentSourceId);
    
    var decResult = this.decNodeWithParent(sourceId, parentSourceId,
                                           identity, parentIdentity,
                                           refCount);

    if(decResult.count == 0)
        update.removed.push(decResult.idNodeId);

    // increase the reference count of the identity node for the new identity

    var newParentIdentity = (decResult.parentId == sourceId) ?
        newIdentity : decResult.parentIdentity;
    
    var idNode = this.incNodeWithParent(sourceId, decResult.parentId,
                                        newIdentity, newParentIdentity,
                                        refCount);

    if(idNode.isNew)
        update.added.push({ idNodeId: idNode.idNodeid,
                            parentIdentity: idNode.parentIdentity });

    return update;
}

// This function receives a set (array) of source element IDs 'sourceIds',
// with a corresponding array of reference counts (the number of times
// each of these source nodes was mapped by the group this object belongs to)
// such that all these source elements have a common parent ID (which must
// be diffrent from the source IDs) and such that the identity of the parent
// node just changed to 'newParentIdentity' (when this function is called,
// the getIdentity() function of the source indexer still returns the old
// identities, from before the update). This function then updates
// the identity nodes by decreasing the reference count of the identity
// nodes to which the source nodes belonged under the old parent identity
// and increasing the reference count of the identity nodes to which the
// source nodes belong under the new parent identity. The function
// returns an object of the following structure:
// {
//    added: <array of new identity nodes added, each represented by an object:
//             {
//                 idNodeId: <identity node ID>
//                 parentIdentity: <parent identity for this identity node>
//             }
//           >,
//    removed: <array of identity node IDs just removed>
// }
// This object lists the identity nodes which were added and removed as
// a result of this identity update.

DominatedIdentitySourceNodes.prototype.updateParentIdentity =
    dominatedIdentitySourceNodesUpdateParentIdentity;

function dominatedIdentitySourceNodesUpdateParentIdentity(sourceIds, refCount,
                                                          parentId,
                                                          newParentIdentity)
{
    var update = { added: [], removed: [] };

    // loop over the source IDs

    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {

        var sourceId = sourceIds[i];
        
        // decrease reference count for the old identities
        var decResult = this.decNode(sourceId, refCount[i]);

        if(decResult.count == 0)
            update.removed.push(decResult.idNodeId);

        // increase the reference count of the identity node for the
        // new parent identity
    
        var idNode = this.incNodeWithParent(sourceId, decResult.parentId,
                                            decResult.identity,
                                            newParentIdentity,
                                            refCount[i]);

        if(idNode.isNew)
            update.added.push({ idNodeId: idNode.idNodeid,
                                parentIdentity: newParentIdentity });
    }

    return update;
}
