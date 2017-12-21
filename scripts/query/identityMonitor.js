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


// This file implements a sub-tree monitor used for getting the
// compression values for a set of element IDs from a source indexer.
// The monitor is constructed for a specific indexer and path
// (if these change, the monitor must be destroyed and a new one
// must be created).
// The monitor then receives element IDs defining nodes at the given
// indexer and path. For each element ID, the monitor checks whether 
// the value under the element ID has attributes. If it doesn't, 
// it uses the compression module to compress the simple value 
// directly (when values change, it gets a key update from its owner,
// so it can check whether there is need to recalculate the compression).
//
// If the value has attributes, the monitor registers as a compression
// monitor to the source indexer and registers a compression request
// for the given node.
//
// When the compressed values change, this object notifies its owner
// of this.
// 
// The owner object is responsible for adding an removing requests for
// identification and is responsible for tracking which element IDs
// identification was requested for. It should implement the following
// interface:
//
// <owner>.updateCompressedValues(<element IDs>, <compressed values>)
//    This function is used by the monitor to update its owner of any changes
//    to the identities (compressed values) of element IDs already registered
//    for monitoring (that is, not of newly registered element IDs).
// <owner>.getMonitoredElements()
//    This function should return an array with the full list of element IDs
//    for which compression has been requested so far.
// <owner>.filterMonitoredElements(<element IDs>)
//    This function should return an array with the subset of the input array
//    <element IDs> for which compression has been requested.
//
// It should add and remove nodes which need to be compressed through
// calls to the functions:
// 
// <IdentityMonitor>.requestIdentity(<element IDs>)
// <IdentityMonitor>.releaseIdentity(<element IDs>)
//
// It is assumed that the owner adds and removes identity requests strictly
// incrementally, so it does not add a request for identity for
// the same element ID twice without releasing the request in between
// and it does not release a request for a data element for which no
// identification was requested (or was lareadt released).
//
// The owner should also register to the source indexer to receive key updates.
// When it receive the key updates it should pass them on to this 
// object by calling:
//
// <IdentityMonitor>.updateKeys(<element IDs>, <types>, <keys>,
//                              <previous types>, <previous keys>, <positions>) 
//
// The owner is required to filter this list for those element IDs 
// for which identification was requested. The array <positions> is
// an array of positions (non-negative integers) in the array <element IDs>
// where element IDs appear for which identification was requested.
// The update applies only to those positions in the arrays
// <element IDs>, <types>, <keys>, <previous types> and <previous keys>.
//
// (the reason that the owner object needs to register on the 
// source indexer to receive key updates is that it probably anyway
// needs to register itself as a query calculation node on the indexer,
// so then receiving the key updates is a small step).
//
// Object Structure
// ----------------
//
// {
//     owner: <owner object (e.g. IdentityResult)>
//     indexer: <source indexer>
//     pathId: <path ID>
//
//     compression: <pointer the global compressed value allocator>
//
//     numMonitored: <number of entries registered to the compression monitor>
//     monitorId: <ID assigned by indexer>
// }
//
// monitorId: this is the ID of the compression monitor registered to the
//     indexer in case compound values need to be compressed. This may
//     be undefined if there are no compound values to compress.
// numMonitored: this is the number of elements which were registered
//     to the compression monitor (these are element IDs which have
//     a compound value under them).

//
// Constructor
//

// This identity monitor is created for a given owner, indexer and path.
// When the indexer or path change, a new monitor needs to be created
// (anyway all information and registrations are lost).

function IdentityMonitor(owner, indexer, pathId)
{
    this.owner = owner;
    this.indexer = indexer;
    this.pathId = pathId;
    
    this.compression = indexer.qcm.compression;

    this.numMonitored = 0;
    this.monitorId = undefined;
}

// remove all registrations and deallocate all compressed values

IdentityMonitor.prototype.destroy = identityMonitorDestroy;

function identityMonitorDestroy()
{
    // get the list of identified element IDs from the owner
    var elementIds = this.owner.getMonitoredElements();

    // release compression/monitoring for the elements being compressed
    this.releaseIdentity(elementIds);

    if(this.monitorId !== undefined) {
        this.indexer.removeSubTreeMonitor(this.pathId, this.monitorId);
        this.monitorId = undefined;
    }
}

// This function is called when the source of the monitor (indexer
// and path) change, but it is knowns that the old and the new sources
// are identical for the identities requested (which means that for
// those element IDs for which identification was requested, the same
// elements and key values are stored in the old and the new source and
// that this also holds for all nodes dominated by them, which may be
// included in calcualting their identity).
// This function does not change its list of identities. It only adds
// a monitor registration (if needed) at the new indexer and path a removes
// and removes it from the old indexer and path.

IdentityMonitor.prototype.replaceSource = identityMonitorReplaceSource;

function identityMonitorReplaceSource(indexer, pathId)
{
    if(this.numMonitored > 0) {
        
        // some nodes are monitored, so this monitoring has to be transferred
        
        // register a monitor to the new indexer and path
        var newMonitorId = indexer.addSubTreeMonitor(pathId, this);

        // loop over the identified elements which require monitoring and
        // register their monitoring on the new indexer and path and
        // de-register their monitoring on the old indexer and path

        var elementIds = this.owner.getMonitoredElements();
        var sourceNodes = this.indexer.getDataNodesAtPath(this.pathId);

        for(var i = 0, l = elementIds.length ; i < l ; ++i) {

            var elementId = elementIds[i];
            var nodeEntry = sourceNodes.get(elementId);

            if(nodeEntry.hasAttrs !== true)
                continue; // no monitoring
            
            indexer.registerCompressionOnNode(pathId, elementId, newMonitorId);
            this.indexer.unregisterCompressionOnNode(this.pathId, elementId, 
                                                     this.monitorId);
        }

        // unregister the old monitoring
        this.indexer.removeSubTreeMonitor(this.pathId, this.monitorId);

        this.monitorId = newMonitorId;
    }
    
    this.indexer = indexer;
    this.pathId = pathId;
}

// This function is called by the owner to request the compressed values
// of a set of nodes (given as an array of data element IDs). The function
// returns the compressed values in an array (with each position corresponding 
// to the position in element ID in the input array). If the compression
// cannot be immediately determined, undefined is returned in the corresponding
// position in the returned array.
// This function can choose whether to compress the value directly
// (if it it does not have attributes and is, therefore, a simple value)
// or to register a request for compression through a compression monitor
// registered on the indexer. If such a monitor is not yet registered,
// it is registered here.

IdentityMonitor.prototype.requestIdentity = identityMonitorRequestIdentity;

function identityMonitorRequestIdentity(elementIds)
{
    var sourceNodes = this.indexer.getDataNodesAtPath(this.pathId);
    var identities = [];

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        var nodeEntry = sourceNodes.get(elementId);

        if(nodeEntry.hasAttrs !== true) {
            // perform the compression directly
            var compressedValue;
            if(nodeEntry.type === undefined || nodeEntry.key === undefined)
                compressedValue = undefined;
            else
                compressedValue = this.compression.simple(nodeEntry.type, 
                                                          nodeEntry.key);
            identities.push(compressedValue);
        } else {
            // register compression monitoring
            if(this.monitorId === undefined)
                this.monitorId = this.indexer.addSubTreeMonitor(this.pathId, 
                                                                this);
            this.indexer.registerCompressionOnNode(this.pathId, elementId, 
                                                   this.monitorId);
            // need to wait for the compressed value
            identities.push(undefined);
            this.numMonitored++;
        }
    }

    return identities;
}

// This function is called by the owner to indicate that it is no longer 
// intersted in the compressed values of the given data element IDs.
// This function then clears them from the identities table, either 
// releasing the compressed value or removing the compression registration
// (depending on whether the corresponding node is monitored or not).

IdentityMonitor.prototype.releaseIdentity = identityMonitorReleaseIdentity;

function identityMonitorReleaseIdentity(elementIds)
{
    // the values known at the time of the previous update
    var sourceValues = this.indexer.getKnownNodeValues(this.pathId, elementIds);
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        
        var elementId = elementIds[i];
        
        if(sourceValues.hasAttrs[i] === true) {
            this.indexer.unregisterCompressionOnNode(this.pathId, elementId, 
                                                     this.monitorId);
            this.numMonitored--;
            // we do not remove the monitor here, since it seems likely 
            // that it will soon be needed again.
        } else {
            var type = sourceValues.types[i];
            var key = sourceValues.keys[i];
            if(type !== undefined && key !== undefined)
                // release the compressed value
                this.compression.releaseSimple(type, key);
        }
    }
}

// This function is similar to releaseIdentity(), but instead of receiving
// a list of identities which need to be released, this function releases
// all identities currently stored (this is called in cases where a
// full refresh is required).

IdentityMonitor.prototype.releaseAllIdentities =
    identityMonitorReleaseAllIdentities;

function identityMonitorReleaseAllIdentities()
{
    // get the list of identified element IDs from the owner
    var elementIds = this.owner.getMonitoredElements();
    
    // release compression/monitoring for the elements being compressed
    this.releaseIdentity(elementIds);
}

// This is a key update for the path from which this object compresses
// the identities. The first five arguments are the standard key update
// received from the indexer, so they may contain element IDs which are not 
// identified here. For this reason the argument 'positions' (an array of
// non-negative integers) is provided. This array contains the positions in
// the arrays 'elementIds', 'types' and 'keys' which correspond to
// elements for which identification was already requested.
// This function goes over the list of positions. For each element, it checks
// whether it currently has attributes. If it does, this function only
// checks whether the update is <"attribute", true> (which means that
// it previously was not monitored). In this case it must release
// the simple compression for the previous type and key and register
// a compression request to the indexer (in all other cases compression
// monitoring is already or will be registered and the rest of the
// update will take place through the monitor). If the current value has
// no attributes, the function checks the update. If it is <"attribute", true>,
// monitoring has to be removed and the simple compression calculated.
// Otherwise, the compression of the previous type and key needs to be
// released and the new simple compression calculated. 
// This function then calls the 'updateCompressedValues()' function of the
// owner with the nodes whose compression changed. 

IdentityMonitor.prototype.updateKeys = identityMonitorUpdateKeys;

function identityMonitorUpdateKeys(elementIds, types, keys, prevTypes,
                                   prevKeys, positions)
{
    if(positions.length === 0)
        return;
    
    var updateElementIds = [];
    var updateCompressedValues = [];
    // track updates so as not to update twice for the same element ID
    var updatedAsObj = new Map();
    var sourceNodes = this.indexer.getDataNodesAtPath(this.pathId);
    var pathNode = this.indexer.pathNodesById[this.pathId];
    
    for(var i = 0, l = positions.length ; i < l ; ++i) {
    
        var pos = positions[i];
        var elementId = elementIds[pos];
        var nodeEntry = sourceNodes.get(elementId);

        if(nodeEntry.hasAttrs === true) { // currently has attribute
            if(updatedAsObj.has(elementId))
                continue;
            updatedAsObj.set(elementId, true);

            var prevKey = this.indexer.getPrevKey(pathNode, elementId);
            if(prevKey && prevKey.hasAttrs === true)
                continue; // 'hasAttrs' property did not change
            
            // changed from no attributes to attributes, release the old
            // simple compressed value and register compression monitoring
            var prevKey = this.indexer.getPrevKey(pathNode, elementId);
            if(prevKey && prevKey.type !== undefined &&
               prevKey.key !== undefined)
                this.compression.releaseSimple(prevKey.type, prevKey.key);
            // register compression monitoring
            if(this.monitorId === undefined)
                this.monitorId = this.indexer.addSubTreeMonitor(this.pathId, 
                                                                this);
            this.indexer.registerCompressionOnNode(this.pathId, elementId, 
                                                   this.monitorId);
            this.numMonitored++;
            // need to wait for the compressed value (so not added to list of
            // updated identities)
            continue;
        }

        // current key is a simple key

        if(updatedAsObj.has(elementId))
            continue;
        updatedAsObj.set(elementId, true);
        
        var compressed = this.compression.simple(nodeEntry.type, 
                                                 nodeEntry.key);
        updateElementIds.push(elementId);
        updateCompressedValues.push(compressed);

        var prevKey = this.indexer.getPrevKey(pathNode, elementId);

        if(prevKey === undefined)
            continue;
        
        if(prevKey.hasAttrs === true) {
            // stop monitoring
            this.indexer.unregisterCompressionOnNode(this.pathId, elementId, 
                                                     this.monitorId);
            this.numMonitored--;
        } else if(prevKey.type !== undefined && prevKey.key !== undefined)
            // release the old key compression
            this.compression.releaseSimple(prevKey.type, prevKey.key);
    }

    this.owner.updateCompressedValues(updateElementIds, updateCompressedValues);
}

// This function is called by the indexer to indicate that the compressed
// value of the nodes in 'elementIds' have been updated. Not all these
// element IDs must necessarily have been requested by this monitor.
// For those which are monitored by this monitor, this function updates
// the compressed value and then notifies the owner of the new compressed
// values.

IdentityMonitor.prototype.subTreeUpdate = identityMonitorSubTreeUpdate;

function identityMonitorSubTreeUpdate(pathId, elementIds, monitorId)
{
    if(pathId != this.pathId || monitorId != this.monitorId ||
      this.numMonitored == 0)
        return;

    elementIds = this.owner.filterMonitoredElements(elementIds);
    
    var updateElementIds = [];
    var updateCompressedValues = [];

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];

        var compression = 
            this.indexer.getCompression(this.pathId, elementId);
        if(compression[1] === undefined)
            compression = this.indexer.setFullCompression(this.pathId, 
                                                          elementId, 
                                                          this.monitorId);
        updateElementIds.push(elementId);
        updateCompressedValues.push(compression[1]);
    }

    this.owner.updateCompressedValues(updateElementIds, updateCompressedValues);
}


