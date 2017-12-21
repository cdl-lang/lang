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


// This file implements auxiliary objects used in the merge indexer to
// keep track of the non-terminal nodes at each path, indexed by 
// their identity and the data element ID which dominates them.
//
// The nodes are indexed both by their base identity and by the
// additional identifications defined as 'target identifications'
// by mappings merging their result into the indexer.
// The basic non-terminal table is implemented by the NonTerminalsByIdentity
// class, which indexes the nodes based on their identity and by 
// the dominating node data element ID (at the root path node we
// use NonTerminalsByIdentityAtRoot instead, since in this case we
// do not have a dominating node).
// This table can then be stored multiple times in a single PathNonTerminals
// object: once for the base indetities and then once for each additional
// identification which applies to the path node. An additional identification
// applies to a path node iff it is the immediate prefix of an extension or 
// element target path of a mapping which uses the given additional 
// identification as its target identification. In case the non-terminals
// are operators, the identification applies not at the prefix path
// but at the element target paths and the extension paths.
//
// PathNonTerminals
// ----------------
//
// The PathNonTerminals structure holds one NonTerminalsByIdentity table
// for the base identities and a list of NonTerminalsByIdentity table
// for additional identifications:
//
// PathNonTerminals:
// {
//    indexer: <MergeIndexer>
//    atRootPath: true|false
//    numNonTerminals: <number of non-terminals stored here>
//    nonTerminalsByIdentity: <NonTerminalsByIdentity or 
//                             NonTerminalsByIdentityAtRoot object>
//    nonTerminalsByAdditionalIdentity: <Map>{
//        <identification ID>: <NonTerminalsByIdentity or 
//                              NonTerminalsByIdentityAtRoot object>
//        .....
//    }
// }
//
// indexer: this is the indexer where this object is used (on one of 
//    the indexer's path nodes).
// atRootPath: this is true if this stores non-terminals at the root
//    path (where there is no dominating node ID to take into account)
//    or not (where the dominating node ID is part of the key under
//    which the non-terminal is stored). This determines whether
//    NonTerminalsByIdentity or NonTerminalsByIdentityAtRoot objects
//    are used to store the non-terminals.
// numNonTerminals: the number of non-terminals stored in this table.
//    As the same non-terminal may be stored in this table under 
//    several identities (in case there are additional identities)
//    this number may be smaller than the sum of all the 'numNodes'
//    fields in the NonTerminalsByIdentity and NonTerminalsByIdentityAtRoot
//    tables storing these non-terminals.
// nonTerminalsByIdentity: this holds a single NonTerminalsByIdentity 
//    (or, at the root path, NonTerminalsByIdentityAtRoot) object
//    which is used to store non-terminals indexed by their base identity.
// nonTerminalsByAdditionalIdentity: this table has an entry for each 
//    additional identity defined by a mapping as its target identification.
//    For each path node, this table will only hold those additional
//    identifications which are defined on a mapping which has this 
//    path as the immediate prefix of one of the mapping's element target 
//    paths or extension paths (in case this table stores operator nodes,
//    this applies to paths which are an element target path or an extension
//    path of the mapping).
//    For nodes for which the additional idnetification does not define
//    a special identity, the base identity will be stored here.
//
// NonTerminalsByIdentity
// ----------------------
//
// For a specific identification (including the base identification) this 
// class implements a table which holds the non-terminal nodes at this 
// path node indexed by their identity and dominating node.
// This class implements function to update this table and retrieve 
// non-terminal nodes by their identity and dominating node.  
//
// The object has the following structure

// NonTerminalsByIdentity:
//
// {
//    groupNum: <number of groups using this identification (not used for
//               base identification>
//    identities: <Map>{
//        <identity>: <Map>{
//            <dominating element ID>: <Map>{ 
//                 <data element ID>: true,
//                 .......
//            }
//            .....
//        }
//        .....
//    }
// }
//
// NonTerminalsByIdentityAtRoot
// ----------------------------
//
// This table is identical to NonTerminalsByIdentity, except that
// the nodes are only indexed by their identity and not by their
// dominating node (since at the root path node there is no dominating node).
//
// {
//    groupNum: <number of groups using this identification (not used for
//               base identification>
//    identities: <Map>{
//        <identity>: <Map>{
//            <data element ID>: true,
//            .......
//        }
//        .....
//    }
// }

//////////////////////
// PathNonTerminals //
//////////////////////

//
// Constructor
//

// Set the initial (no non-terminals) values. 'indexer' is the indexer
// inside which this object is stored. The argument 'atRootPath' is
// true if this object is used to store non-terminals at the root path
// (where there is no dominating node) or not (where the dominatin
// node is used as part of the key under which a non-teminal is
// stored). This determines whether NonTerminalsByIdentity or
// NonTerminalsByIdentityAtRoot objects will be used to store the
// non-terminals.

function PathNonTerminals(indexer, atRootPath)
{
    this.indexer = indexer;
    this.atRootPath = atRootPath;
    this.numNonTerminals = 0;
    this.nonTerminalsByIdentity = atRootPath ? 
        new NonTerminalsByIdentityAtRoot() : new NonTerminalsByIdentity();
    this.nonTerminalsByAdditionalIdentity = undefined;
}

// return the number of terminals stored in this table.

PathNonTerminals.prototype.getNum = pathNonTerminalsGetNum;

function pathNonTerminalsGetNum()
{
    return this.numNonTerminals;
}

// This function adds the given identification ID to the identifications
// which need to be applied to the non-terminals stored in this
// table. This creates an entry for this identification in 
// the nonTerminalsByAdditionalIdentity table and then goes over
// all non-terminals stored in the table (by looping oer all entries
// in the 'non-terminals by base identity' table) checks which of them is
// identified by the new identification ID and stores those non-terminals
// which are identified by the new identification in the new table
// created for the identification.  

PathNonTerminals.prototype.addAdditionalIdentification = 
    pathNonTerminalsAddAdditionalIdentification;

function pathNonTerminalsAddAdditionalIdentification(identificationId)
{
    if(this.nonTerminalsByAdditionalIdentity == undefined)
        this.nonTerminalsByAdditionalIdentity = new Map();

    var byIdentity;
    
    if(this.nonTerminalsByAdditionalIdentity.has(identificationId)) {
        // already added
        this.nonTerminalsByAdditionalIdentity[identificationId].incGroups();
        byIdentity =
            this.nonTerminalsByAdditionalIdentity.get(identificationId);
    } else {
        byIdentity =
            (this.atRootPath ?
             new NonTerminalsByIdentityAtRoot() : new NonTerminalsByIdentity());
        this.nonTerminalsByAdditionalIdentity.set(identificationId, byIdentity);
    
        // get all non-terminals already stored (under the base identity)
        // and add those which are identified by the new identification
        // to the new table.
        byIdentity.initAdditionalIdentities(this, identificationId);
    }
}

// This function removes the given identification ID from the identifications
// which need to be applied to the non-terminals stored in this
// table. There is not much to do here except for removing the entry for
// this identification from the additional identification table.

PathNonTerminals.prototype.removeAdditionalIdentification = 
    pathNonTerminalsRemoveAdditionalIdentification;

function pathNonTerminalsRemoveAdditionalIdentification(identificationId)
{
    if(this.nonTerminalsByAdditionalIdentity == undefined ||
       !this.nonTerminalsByAdditionalIdentity.has(identificationId))
        return; // nothing to remove

    var byIdentity =
        this.nonTerminalsByAdditionalIdentity.get(identificationId);
    if(byIdentity.decGroups() > 0)
        return; // still being used by some group.

    // remove the entry for this additional identification

    if(this.nonTerminalsByAdditionalIdentity.size == 1) // last entry
        this.nonTerminalsByAdditionalIdentity = undefined;
    else
        this.nonTerminalsByAdditionalIdentity.delete(identificationId);
}

// This function returns an array containing the identities of the given 
// node under the additional identitifactions which apply at this path node.
// The array has the format:
// [ { identity: <identity>, identification: <identification ID> },....]
// The base identity is not returned in this array, so if there are no
// additional identities defined, undefined is returned (instead of an array).
// Note that the identity returned for some identifications may still
// be the base identity (in cases where the identification does not
// define an identity for the node). 

PathNonTerminals.prototype.getAdditionalIdentities = 
    pathNonTerminalsGetAdditionalIdentities;

function pathNonTerminalsGetAdditionalIdentities(elementId)
{
    var additional;
    if((additional = this.nonTerminalsByAdditionalIdentity) === undefined)
        return undefined;

    var additionalIdentities = [];

    var _self = this;
    additional.forEach(function(byIdentity, identificationId) { 
        additionalIdentities.push({ 
            identity: _self.indexer.getIdentity(identificationId, elementId),
            identification: identificationId 
        });
    });

    return additionalIdentities;
}

// this function returns an object whose attributes are the target 
// identifications registered to this object (these are the target
// identifications used by groups mapping to the path at which this
// object is stored).

PathNonTerminals.prototype.getAdditionalIdentifications = 
    pathNonTerminalsGetAdditionalIdentifications;

function pathNonTerminalsGetAdditionalIdentifications()
{
    return this.nonTerminalsByAdditionalIdentity; 
}


// This function is used to add a single non-terminal to be stored in
// this object. 'elementId' is the data element ID of the non-terminal
// and 'dominatingId' is the data element ID of the node directly 
// dominating it (the two IDs may be the same). At the root node, 
// 'dominatingId' will be undefined. 'identity' is the base 
// identity of the node (in the indexer to which this object belongs).
// This function first checks whether the node has to be stored under
// additional identities. If yes, these identities are calculated and
// the node stored under them. Next, the node is stored under its 
// base identity.
// This function returns an array containing the identities under
// which the node was inserted, each with the identification ID to which
// it belongs (the same identity may appear multiple times here).
// The array has the format:
// [ { identity: <identity>, identification: <identification ID> },....]
// The base identity is not returned in this array, so if there are no
// additional identities defined, undefined is returned (instead of an array).
// Note that the identity returned for some identifications may still
// be the base identity (in cases where the identification does not
// define an identity for the node). 

PathNonTerminals.prototype.addNonTerminal = 
    pathNonTerminalsAddNonTerminal;

function pathNonTerminalsAddNonTerminal(dominatingId, elementId, 
                                        identity)
{
    if(dominatingId === undefined)
        dominatingId = 0;
    
    this.numNonTerminals++;

    // store under additional (target) identities 

    var additionalIdentities = this.getAdditionalIdentities(elementId);

    if(additionalIdentities) {
        var additional = this.nonTerminalsByAdditionalIdentity;
        for(var i = 0, l = additionalIdentities.length ; i < l ; ++i) {
            var identificationId = additionalIdentities[i].identification;
            var additionalIdentity = additionalIdentities[i].identity;
            additional.get(identificationId).addNonTerminal(elementId,
                                                            additionalIdentity,
                                                            dominatingId);
        }
    }

    // store under the base identity
    this.nonTerminalsByIdentity.addNonTerminal(elementId, identity, 
                                               dominatingId);

    return additionalIdentities;
}

// This function is used to remove a single non-terminal stored in
// this object. 'elementId' is the data element ID of the non-terminal
// and 'dominatingId' is the data element ID of the node directly 
// dominating it (the two IDs may be the same). At the root node, 
// 'dominatingId' will be undefined. 'identity' is the base 
// identity of the node (in the indexer to which this object belongs).
// This function should only be called when it is known that this 
// node was registered as a non-terminal to this table.
//
// This function first checks whether there are any additional identities
// the node may have been stored under. If yes, it removes it from
// under those entries. Next, the node is removed from under its 
// base identity.
// This function returns an array containing the identities under
// which the node was removed, each with the identification ID to which
// it belongs (the same identity may appear multiple times here).
// The array has the format:
// [ { identity: <identity>, identification: <identification ID> },....]
// The base identity is not returned in this array, so if there are no
// additional identities defined, undefined is returned (instead of an array).
// Note that the identity returned for some identifications may still
// be the base identity (in cases where the identification does not
// define an identity for the node).

PathNonTerminals.prototype.removeNonTerminal = 
    pathNonTerminalsRemoveNonTerminal;

function pathNonTerminalsRemoveNonTerminal(dominatingId, elementId, 
                                           identity)
{
    this.numNonTerminals--;

    // remove under additional (target) identities 

    var additionalIdentities = this.getAdditionalIdentities(elementId);

    if(additionalIdentities) {
        var additional = this.nonTerminalsByAdditionalIdentity;
        for(var i = 0, l = additionalIdentities.length ; i < l ; ++i) {
            var identificationId = additionalIdentities[i].identification;
            var additionalIdentity = additionalIdentities[i].identity;
            additional.get(identificationId).
                removeNonTerminal(elementId, additionalIdentity, dominatingId);
        }
    }

    // remove under the base identity
    this.nonTerminalsByIdentity.removeNonTerminal(elementId, identity, 
                                                  dominatingId);

    return additionalIdentities;
}

// This function updates the identity for the element 'elementId'
// dominated by 'dominatingId' for the (target) identification 
// with ID 'identificationId' (this should be undefined for an update
// of the base identity). 'oldIdentity' should be be the identity
// before the update and 'newIdentity' the identity after the update.
// If the identification function did not provide an identification for
// this element before the change or does not provide such an identification
// after the change, 'oldIdentity' or 'newIdentity' (respectively)
// should be equal to the base identity at the time the change took place
// (by definition, this is the identity of that element under this 
// identification just before/after the change).

PathNonTerminals.prototype.updateIdentity = pathNonTerminalsUpdateIdentity;

function pathNonTerminalsUpdateIdentity(elementId, dominatingId, 
                                        oldIdentity, newIdentity, 
                                        identificationId)
{
    var byIdentity;

    if(identificationId === undefined)
        byIdentity = this.nonTerminalsByIdentity;
    else if(!this.nonTerminalsByAdditionalIdentity || 
            !(byIdentity = 
              this.nonTerminalsByAdditionalIdentity,get(identificationId)))
        return;

    // remove the old identity, if found in the table (otherwise, nothing
    // more to do here).
    if(!byIdentity.removeNonTerminal(elementId, oldIdentity, dominatingId))
        return;
    
    // add the new identity
    byIdentity.addNonTerminal(elementId, newIdentity, dominatingId);

    return;
}

// This function returns an array with the data element IDs of the 
// non-terminals stored in this table which are dominated by the nodes
// whose IDs appear in 'dominatingIds' and have identity 'identity'
// as defined by the identification with ID 'identificationId'. 
// 'dominatingIds' may be undefined in two cases: if the non-terminals
// are at the root path node or if we want to retrieve all non-terminals
// with the given identity, regardless of their dominating node.
// If 'identificationId' is undefined, this means that non-terminals
// with 'identity' as their base identity will be returned. If 
// 'identificationId' is not undefined, this function returns the 
// non-terminals with identity 'identity' under the identification 
// with ID 'identificationId'.
// If no matching non-terminals are found, the function may return undefined.

PathNonTerminals.prototype.getNonTerminals = 
    pathNonTerminalsGetNonTerminals;

function pathNonTerminalsGetNonTerminals(dominatingIds, identity, 
                                         identificationId)
{
    if(this.numNonTerminals == 0)
        return undefined;

    var identificationEntry;
    var nonTerminals;

    if(identificationId === undefined) {
        return this.nonTerminalsByIdentity.getNonTerminals(identity, 
                                                           dominatingIds);
    } else if(this.nonTerminalsByAdditionalIdentity &&
              (identificationEntry = 
               this.nonTerminalsByAdditionalIdentity.get(identificationId))) {
        return identificationEntry.getNonTerminals(identity, dominatingIds);
    }

    return undefined;
}

// Given an array of dominating IDs (possibly an undefined array) and
// a corresponding array of identities (aligned with the array of
// dominating ID) and a (target) identification ID, this function returns an
// array aligned with the input array which stores at each position
// an array with the set of non-terminals with the given identity and dominated
// by the given dominating ID at the corrsponding position in the array.
// If no such non-terminals are found, the function returns undefined or
// an empty array at the corresponding position. The returned array
// may be shorter than the input arrays (all missing positions in the array
// are then considered undefined). 'dominatingIds' may be undefined
// at the root path.

PathNonTerminals.prototype.getAllNonTerminals = 
    pathNonTerminalsGetAllNonTerminals;

function pathNonTerminalsGetAllNonTerminals(dominatingIds, identities, 
                                            identificationId)
{
    if(this.numNonTerminals == 0)
        return [];

    var identificationEntry = (identificationId === undefined) ?
        this.nonTerminalsByIdentity :
        this.nonTerminalsByAdditionalIdentity.get(identificationId);

    if(identificationEntry === undefined)
        return [];
    
    var allNonTerminals = [];

    if(dominatingIds === undefined) {
        var dominatingId = [0]; // dominating ID for top nodes
        for(var i = 0, l = identities.length ; i < l ; ++i) {
            var identity = identities[i];
            if(identity === undefined)
                continue;
            var nonTerminals =
                identificationEntry.getNonTerminals(identity, dominatingId);
            if(nonTerminals !== undefined && nonTerminals.length > 0)
                allNonTerminals[i] = nonTerminals;

        }
        return allNonTerminals;
    }

    for(var i = 0, l = identities.length ; i < l ; ++i) {
        var identity = identities[i];
        if(identity === undefined)
            continue;
        var dominatingId = dominatingIds[i];
        if(dominatingId === undefined)
            continue;
        var nonTerminals =
            identificationEntry.getNonTerminals(identity, [dominatingId]);
        if(nonTerminals !== undefined && nonTerminals.length > 0)
            allNonTerminals[i] = nonTerminals;
    }
    return nonTerminals;
}

////////////////////////////
// NonTerminalsByIdentity //
////////////////////////////

// constructor

function NonTerminalsByIdentity()
{
    this.groupNum = 1;
    this.identities = new Map();
}

// increase by 1 the number of groups which make use of the identification
// to which this entry belongs

NonTerminalsByIdentity.prototype.incGroups = 
    nonTerminalsByIdentityIncGroups;

function nonTerminalsByIdentityIncGroups()
{
    return ++this.groupNum;
}

// increase by 1 the number of groups which make use of the identification
// to which this entry belongs

NonTerminalsByIdentity.prototype.decGroups = 
    nonTerminalsByIdentityDecGroups;

function nonTerminalsByIdentityDecGroups()
{
    return --this.groupNum;
}

// This function adds the non-terminal whose data element ID is 
// 'elementId' and is dominated by 'dominatingId' and has identity
// 'identity' to this table under the given identity and dominating node.

NonTerminalsByIdentity.prototype.addNonTerminal = 
    nonTerminalsByIdentityAddNonTerminal;

function nonTerminalsByIdentityAddNonTerminal(elementId, identity, dominatingId)
{
    var dominatingEntry;
    var identityEntry;

    if(!this.identities.has(identity)) {
        identityEntry = new Map();
        this.identities.set(identity, identityEntry);
    } else
        identityEntry = this.identities.get(identity);

    if(!identityEntry.has(dominatingId)) {
        dominatingEntry = new Map();
        identityEntry.set(dominatingId, dominatingEntry);
    } else {
        dominatingEntry = identityEntry.get(dominatingId);
        if(dominatingEntry.has(elementId))
            return; // already in table
    }

    dominatingEntry.set(elementId, true);
}

// This function removes from this table the non-terminal whose data 
// element ID is 'elementId' and whose identity in this table is 
// 'identity' and whose dominating node data element ID is 'dominatingId'.
// This function returns true if the entry was found and removed
// and false if no entry was found.

NonTerminalsByIdentity.prototype.removeNonTerminal = 
    nonTerminalsByIdentityRemoveNonTerminal;

function nonTerminalsByIdentityRemoveNonTerminal(elementId, identity, 
                                                 dominatingId)
{
    var dominatingEntry;
    var identityEntry;

    if(!this.identities.has(identity))
        return false;

    identityEntry = this.identities.get(identity);
    if(!identityEntry.has(dominatingId))
        return false;

    dominatingEntry = identityEntry.get(dominatingId);

    if(!dominatingEntry.has(elementId))
        return false;
    
    if(dominatingEntry.size === 1) { // last element
        if(identityEntry.size == 1)
            this.identities.delete(identity);
        else
            identityEntry.delete(dominatingId);
    } else
        dominatingEntry.delete(elementId);

    return true;
}

// This function is called on a new NonTerminalsByIdentity object
// which has just been created to store non-terminals under the 
// identities assigned by identification with ID 'identificationId'.
// This function also receives the PathNonTerminals object which owns it
// ('owner') as argument.
// This function then goes over all non-terminals already added to
// its owner object (by looping over all nodes in the table for the base 
// identity), and adds their identity under this identification. 

NonTerminalsByIdentity.prototype.initAdditionalIdentities = 
    nonTerminalsByIdentityInitAdditionalIdentities;

function nonTerminalsByIdentityInitAdditionalIdentities(owner, 
                                                        identificationId)
{
    if(owner.numNonTerminals == 0)
        return; // no nodes to add

    var indexer = owner.indexer;
    var baseIdentities = owner.nonTerminalsByIdentity.identities;

    var _self = this;
    baseIdentities.forEach(function(identityEntry, identity) {
        identityEntry.forEach(function(dominatingEntry, dominatingId) {
            dominatingEntry.forEach(function(t, elementId) {
                _self.addNonTerminal(elementId,
                                     indexer.getIdentity(identificationId,
                                                         elementId),
                                     dominatingId);
            });
        });
    });
}

// This function returns an array with the data element IDs of the 
// non-terminals stored in this table which have identity 'identity'
// and are dominated by one of the dominating node in the array
// 'dominatingIds'.
// If 'dominatingIds' is undefined, all nodes stored under the given 
// identity (regardless of the dominating ID) are returned. 
// The function may return undefined if no non-terminals are found.

NonTerminalsByIdentity.prototype.getNonTerminals = 
    nonTerminalsByIdentityGetNonTerminals;

function nonTerminalsByIdentityGetNonTerminals(identity, dominatingIds)
    {
        
    var identityEntry = this.identities.get(identity);

    if(identityEntry === undefined)
        return undefined;

    var nonTerminals = [];

    if(dominatingIds === undefined) {
        for(var dominatingId in identityEntry.dominating) {
            var nodes = identityEntry.dominating[dominatingId];
            nodes.forEach(function(t, elementId) {
                nonTerminals.push(elementId);
            });
        }
    } else {
        for(var i = 0, l = dominatingIds.length ; i < l ; ++i) {
            var nodes = identityEntry.dominating[dominatingIds[i]];
            if(nodes)
               nodes.forEach(function(t, elementId) {
                nonTerminals.push(elementId);
            }); 
        }
    }

    return nonTerminals.length ? nonTerminals : undefined;
}

//////////////////////////////////
// NonTerminalsByIdentityAtRoot //
//////////////////////////////////

// constructor

function NonTerminalsByIdentityAtRoot()
{
    this.groupNum = 1;
    this.identities = new Map();
}

// increase by 1 the number of groups which make use of the identification
// to which this entry belongs

NonTerminalsByIdentityAtRoot.prototype.incGroups = 
    nonTerminalsByIdentityAtRootIncGroups;

function nonTerminalsByIdentityAtRootIncGroups()
{
    return ++this.groupNum;
}

// increase by 1 the number of groups which make use of the identification
// to which this entry belongs

NonTerminalsByIdentityAtRoot.prototype.decGroups = 
    nonTerminalsByIdentityAtRootDecGroups;

function nonTerminalsByIdentityAtRootDecGroups()
{
    return --this.groupNum;
}

// This function adds the non-terminal whose data element ID is
// 'elementId' and has identity 'identity' to this table under the
// given identity.

NonTerminalsByIdentityAtRoot.prototype.addNonTerminal = 
    nonTerminalsByIdentityAddNonTerminalAtRoot;

function nonTerminalsByIdentityAddNonTerminalAtRoot(elementId, identity)
{
    var identityEntry;

    if(!this.identities.has(identity)) {
        identityEntry = new Map();
        this.identities.set(identity, identityEntry);
    } else {
        identityEntry = this.identities.get(identity);
        if(identityEntry.has(elementId))
            return; // already added
    }

    identityEntry.set(elementId, true);
}

// This function removes from this table the non-terminal whose data 
// element ID is 'elementId' and whose identity in this table is 
// 'identity'.
// This function returns true if the entry was found and removed
// and false if no entry was found.

NonTerminalsByIdentityAtRoot.prototype.removeNonTerminal = 
    nonTerminalsByIdentityAtRootRemoveNonTerminal;

function nonTerminalsByIdentityAtRootRemoveNonTerminal(elementId, identity)
{
    var identityEntry;

    if(!this.identities.has(identity))
        return false;

    identityEntry = this.identities.get(identity);

    if(!identityEntry.has(elementId))
        return false;

    if(identityEntry.size === 1)
        this.identities.delete(identity);
    else
        identityEntry.delete(elementId);

    return true;
}

// This function is called on a new NonTerminalsByIdentityAtRoot object
// which has just been created to store non-terminals under the 
// identities assigned by identification with ID 'identificationId'.
// This function also receives the PathNonTerminals object which owns it
// ('owner') as argument.
// This function then goes over all non-terminals already added to
// its owner object (by looping over all nodes in the table for the base 
// identity), and adds their identity under the given identification.

NonTerminalsByIdentityAtRoot.prototype.initAdditionalIdentities = 
    nonTerminalsByIdentityAtRootInitAdditionalIdentities;

function nonTerminalsByIdentityAtRootInitAdditionalIdentities(owner, 
                                                              identificationId)
{
    var indexer = owner.indexer;
    var baseIdentities = owner.nonTerminalsByIdentity.identities;
    var _self = this;
    baseIdentities.forEach(function(identityEntry, identity) {
        identityEntry.forEach(function(t, elementId) {
            _self.addNonTerminal(elementId,
                                 indexer.getIdentity(identificationId, 
                                                     elementId));
        });
    });
}

// This function returns an array with the data element IDs of the 
// non-terminals stored in this table which have identity 'identity'.
// The function may return undefined if no non-terminals are found.

NonTerminalsByIdentityAtRoot.prototype.getNonTerminals = 
    nonTerminalsByIdentityAtRootGetNonTerminals;

function nonTerminalsByIdentityAtRootGetNonTerminals(identity)
{
    var nodes = this.identities.get(identity);

    if(nodes === undefined || nodes.size == 0)
        return undefined;

    var nonTerminals = [];
    nodes.forEach(function(t, elementId) {
        nonTerminals.push(elementId);
    });

    return nonTerminals;
}
