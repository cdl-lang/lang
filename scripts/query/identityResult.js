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


// This is a result node (derived from FuncResult) which makes a function
// into an identification function. This object provides the interface
// between the output of this function and the identity interface.
//
// This result object has two data result objects from which it 
// receives updates: the identifiedDataObj, which defines the set of
// nodes which need to be identified and the standard identificationObj, 
// which is the result of applying the identification function. 
// The identifiedDataObj is also set as the 'terminal data object' 
// of the 'identificationObj' so that the identification function is applied 
// to the identified data.
//
// One should not use the standard setData() function of the FuncResult
// class on this object, but, instead, use setIdentificationData()
// and setIdentifiedData() functions defined in this derived class to set
// the corresponding data object.
//
// This object can also be set as the data result object of another
// result object. In this case, this object simply passes on the 
// indexer, path and matches of its identified data object. The match count
// is always 1 and the dominated identification ID is the identification
// of this object.
//
// Currently, there are two types of identification:
// 1. identification by compression: the compression of the value under each
//        node returned by the data result object is the identity of 
//        the data element dominating that node at the identified path
//        of this identity result.
//        The compressed values are negated so that they are all negative
//        number. In this way they do not conflict with the identities
//        based on data element IDs.
//        While this can change in the future, we currently only support
//        the case where the data elements returned by the data result object
//        are taken from the identity indexer and are dominated by 
//        the data elements at the identified path (the indexer does not
//        need to be the same: there may be an intermediate result indexer
//        constructed to handle a multi-projection, but there may not be
//        multiple groups merged, so that the original data element IDs
//        are preserved).
// 2. Fixed identity: this is composed with a selection. Every data element
//        matched by the selection is assigned the constant identity which 
//        identifies it as belonging to the selected set.
//        The value of the fixed identity must be allocated from
//        data element ID pool (to make sure it does not conflict
//        with other identities).
//
// It is the responsibility of this node to compress the values and raise
// data element IDs (in case the data element IDs received as input are
// lower than the identified path).
//
// In case compression is needed, an IdentityMonitor object is used for this
// purpose (see the documentation of that object). To make sure the 
// IdentityMonitor receives the required key updates, this object 
// (which is anyway registered as a query calculation node to the source
// indexer) also registers to receive key updates.
//
// Object Structure
// ----------------
//
// {
//     dataObjs: <array of two FuncResult objects>
//     identifiedDataObj: <FuncResult> // points at dataObjs[0]
//     identificationObj: <FuncResult> // points at dataObjs[1]
//
//     identificationRoot: <FuncResult>
//
//     identityIndexer: <IdentityIndexer>
//     identifiedPathId: <path ID>
//     identifyAtIdentifiedPathOnly: true|false
//     identity: <fixed identity>
//
//     pathId: <projection path of the data result object>
//     doNotIndex: true        // constant value
//    
//     matchPoints: <Map>{
//         <path ID>: true,
//         .......
//     },
//     lowestMatchPoint: <path ID>
//
//     needToRaiseMatches: true|false
//
//     raisedIdentified: {
//         <identified element ID>: <counter>,
//              -- or --
//         <identified element ID>: {
//              numMatches: <number of entries below>
//              matches: {
//                 <matched ID>: true
//                 .....
//              }
//         }
//     }
//     monitor: <IdentityMonitor>
//
//     suspendedNewMatches: undefined|
//                          [<array of identified matches>,
//                           <array of identification matches>] 
// }
//
// dataObjs: this is the structure required by the base class to store
//     mutiple data objects. It should be created upon construction 
//     as an empty array of length 2. The fields identifiedDataObj
//     and identificationObj points at the same objects as in this
//     array for more meaningful access to these two objects.
// identifiedDataObj: this is a FuncResult object which defines 
//     the data which is being identified here. This is the same 
//     as dataObjs[0].
// identificationObj: this is the FuncResult which defines the 
//     identification function. This is the same as dataObjs[1].
// identificationRoot: when the identification data object is registered,
//     the identity result object registers the first function result
//     node in the chain that ends at the registered identification data object.
//     In this way, when the identified data is registered, it can be
//     set as the data of this result node (if it is not a terminal node)
//     and when the identified data is modified, it can be replaced at
//     the appropriate place in the chain.
// identityIndexer: this is the indexer whose data elements are being
//     identified. This is the dominated indexer of identifiedDataObj.
// identifiedPathId: data elements at this path are identified. This is the
//     dominated projection path of 'identifiedDataObj'. Lower (longer
//     path) data elements are not identified by this identity result.
//     If 'identifyAtIdentifiedPathOnly' (see below) is set, this
//     identification result will also not identify higher (shorter path)
//     data elements. This is optional (can be set upon construction).
//     This option can be used to identify the data elements at some
//     path (if they exist) while not affecting the identity of
//     higher data elements (where no lower data element exists).
// identifyAtIdentifiedPathOnly: this option can be set to true upon
//     construction of the identity result object. When this option
//     is set, this identity result only identifies data elements whose
//     is equal to the dominated projection path of the identified data
//     (this path is stored under 'identifiedPathId' above).
//     This means that in cases where a higher data element does not dominate
//     data elements at this path, the identification does not apply to the
//     higher data element (if this property is not set, the identity
//     will be assigned to the lowest dominating data element which is
//     at the identified path or higher). By default, this is set to false. 
//     
// identity: if not undefined, this is the constant identity assigned to
//     all node matche by the function under this identity result.
//
// sourceIndexer: this is the indexer provided by identificationObj.
//     This does not necessarily have to be the identityIndexer,
//     but the relevant data elements in it should have the same IDs
//     as the data elements they identify in identityIndexer. 
// pathId: this is equal to the projection path ID returned by
//     identificationObj. This is the path this object must register
//     on as a query calculation node in order to get key updates.
//     This field must have the name 'pathId' as this is the name
//     the indexer looks for.
// doNotIndex: this flag (which is always true) tells the indexer
//     this object is registered to as a query calculation node 
//     that even though this node is registered as a selection,
//     no indexing needs to take place.
//
// matchPoints: this is a list of path IDs (in the source indexer) which are
//    equal to pathId or are prefixes of it and on which data elements 
//    are defined. This list is maintained by calls to the appropriate
//    handlers by the source indexer (this is part of the query calculation
//    node interface).
// lowestMatchPoint: this is the largest path ID (longest path, lowest point)
//    appearing in the 'matchPoints' table. If this is the root path 
//    or if the source indexer is equal to identity indexer and this
//    match point is higher (shorter path) than or equal the identified path,
//    there is no need to raise the data elements received from
//    the data result object.
// needToRaiseMatches: this indicates whether matches received from
//    the data result object need to be raised to their parents
//    when looking for the data element identified by them (a data element
//    at the identified path). This property is set based on the 
//    lowest match point and whether the source indexer is the same as
//    the identity indexer or not. If the lowest match point is the root path 
//    or if the source indexer is equal to identity indexer and the lowest
//    match point is higher (shorter path) than or equal the identified path,
//    there is no need to raise the data elements received from
//    the data result object.
// raisedIdentified: this table holds information about data element IDs which 
//    were identified in case they were identified based on lower data
//    elements which were raised. If the identity is constant
//    (this.identity is defined) all this table needs to do is
//    maintain a count of the number of matched element IDs which
//    identify this element ID (so that when the last one is removed,
//    the identity would be removed).  If the identity is compression
//    based, and the matched node received from the data result object
//    is not the same as the data element it identifies, this table
//    holds a list of the data elements whose compressed identity was
//    used to identify the data element. In the future, when multiple 
//    idnetities are supported, the idetities of all these matched nodes
//    would be used. Currently, the last one received determines the identity.
//    When all matches are removed, the node's identification is removed
//    from the identity indexer.
// monitor: this is the IdentityMonitor which is responsible for 
//    for calculating the compressed values for the elements identified here.
//    This object exists iff this.identity is undefined. When the indexer
//    or path change, this object must be destroyed and a new one created.
//
// suspendedNewMatches: this field is set to an array of length 2 when the  
//   identified data is being refreshed. When in this process the new 
//   matches for the identities or identified data are received, these
//   are not immediately updated, but, instead, queued in this array
//   (the first position is for new identified matches 
//    and the second position is for new identification matches).
//   At the end of the refresh process, these matches are added.

// %%include%%: "funcResult.js"
// %%include%%: "identityMonitor.js"

inherit(IdentityResult, FuncResult);

// all IdentityResult nodes created, by ID
// initialized, if needed, by InternalQCM
var debugAllIdentityResults = undefined;

//
// Constructor
//

// The argument identityIndexer is the indexer whose data elements 
// are being identified and which should receive updates from this 
// function.
// if identity is not undefined, this is the constant identity which 
// will be assigned to all nodes matched by the data result object. 
// identificationId is optional: if not given, an identification ID
// will be allocated here.
// 'identifyAtIdentifiedPathOnly' is also optional. If set to true, only data
// elements at exactly the dominated projection path of the
// identified data (the identified path) will be identified by this node
// (otherwise, the lowest dominating data element at or above the identified
// path is identified).
// The constructor registers this identity result to the identity indexer. 

function IdentityResult(internalQCM, identifiedDataObj,
                        identity, identificationId,
                        identifyAtIdentifiedPathOnly)
{
    this.dataObjs = [undefined, undefined];
    this.identifiedDataObj = undefined;
    this.identificationObj = undefined;
    this.identificationRoot= undefined;

    this.FuncResult(internalQCM);

    this.identifyAtIdentifiedPathOnly = identifyAtIdentifiedPathOnly;
    
    if(identity !== undefined)
        this.identity = identity;
    
    this.identificationId = (identificationId !== undefined) ?
        identificationId : IdentityResult.newId();

    this.pathId = undefined;
    this.doNotIndex = true;

    this.matchPoints = new Map();
    this.lowestMatchPoint = undefined;
    this.needToRaiseMatches = false;

    this.raisedIdentified = undefined;
    this.monitor = undefined;

    this.suspendedNewMatches = undefined;

    if(identifiedDataObj)
        this.setIdentifiedData(identifiedDataObj);

    if(debugAllIdentityResults !== undefined) // for debugging only
        debugAllIdentityResults[this.id] = this;
}

//
// identification ID generator
//

var identityResultNextId = 1025;

IdentityResult.newId = function() { return identityResultNextId++; };

// destroy the object. This unregisters this identity result from the identity
// function.

IdentityResult.prototype.destroy =
    identityResultDestroy;

function identityResultDestroy()
{
    if(this.monitor)
        this.monitor.destroy();
    if(this.sourceIndexer !== undefined)
        this.sourceIndexer.removeQueryCalcFromPathNode(this);
    this.identityIndexer.unregisterIdentification(this.identificationId, this);
    this.FuncResult_destroy();

    if(debugAllIdentityResults !== undefined) // for debugging only
        delete debugAllIdentityResults[this.id];
}

// Indicate that this function result object is transparent to matches,
// which means that its dominated matches are identical to those of its
// content (identified) data object.

IdentityResult.prototype.isMatchTransparent = identityResultIsMatchTransparent;

function identityResultIsMatchTransparent()
{
    return true;
}


// return the identification ID

IdentityResult.prototype.getIdentificationId =
    identityResultGetIdentificationId;

function identityResultGetIdentificationId()
{
    return this.identificationId;
}

// return the ID of the identified path

IdentityResult.prototype.getIdentifiedPathId =
    identityResultGetIdentifiedPathId;

function identityResultGetIdentifiedPathId()
{
    return this.identifiedPathId;
}

// This node is active if there are requests for the identification it
// represents in the identity indexer.

IdentityResult.prototype.isActive =
    identityResultIsActive;

function identityResultIsActive()
{
    return (this.identityIndexer !== undefined && 
            this.identityIndexer.
            hasIdentificationRequests(this.identificationId));
}

///////////////////////////////////////////
// Setting Identified and Identification //
///////////////////////////////////////////

// This function should be called to set the identified data object.

IdentityResult.prototype.setIdentifiedData = 
    identityResultSetIdentifiedData;

function identityResultSetIdentifiedData(identifiedDataObj)
{
    if(this.identifiedDataObj == identifiedDataObj)
        return; // nothing changed

    if(this.identifiedDataObj === this.identificationObj) {
        if(this.identificationRoot &&
           !this.identificationRoot.isTerminalResult()) {
            // remove the previous identified data as source of the
            // identifying data
            this.identificationRoot.setData(undefined);
        }
        this.identificationRoot = undefined;
    }
    
    this.identifiedDataObj = identifiedDataObj;
    
    if(this.identificationObj && this.identificationRoot &&
       !this.identificationRoot.isTerminalResult()) {
        this.suspendedNewMatches = [];
        this.identificationRoot.setData(identifiedDataObj);
    }

    // use the base class function to add this as the first data object.
    this.FuncResult_setData(identifiedDataObj, 0);

    if(this.suspendedNewMatches !== undefined) {
        // add the matches which were previously blocked
        var suspendedNewMatches = this.suspendedNewMatches;
        this.suspendedNewMatches = undefined; // before calling addMatches()
        if(suspendedNewMatches[1] !== undefined)
            this.addMatches(suspendedNewMatches[1], this.dataObjs[1]);
        if(suspendedNewMatches[0] !== undefined)
            this.addMatches(suspendedNewMatches[0], this.dataObjs[0]);
    }

    if(!this.isActiveStar()) {
        // since this node is not active*, the following function is not
        // called as part of the standard refresh process. However, we need
        // to know the indexer here so that the identity can be activated
        // when a request for it is registered.
        this.refreshIdentifiedIndexerAndPaths();
    }
}

// This function should be called to set the identification data object.

IdentityResult.prototype.setIdentificationData = 
    identityResultSetIdentificationData;

function identityResultSetIdentificationData(identificationObj)
{
    if(this.identificationObj == identificationObj)
        return; // nothing changed

    this.identificationObj = identificationObj;
    if(this.identificationRoot !== undefined &&
       !this.identificationRoot.isTerminalResult()) {
        // remove the data object of the root, which was previously set equal
        // to the identified data.
        this.identificationRoot.setData(undefined);
    }
    if(identificationObj !== undefined &&
       this.identificationObj != this.identifiedDataObj)
        // store the initial node in the identification result chain,
        // the identified data will be set as the data of this node later.
        this.identificationRoot = identificationObj.getFirstResult();
    else
        this.identificationRoot = undefined;
    
    // use the base class function to add this as the second data object.
    this.FuncResult_setData(identificationObj, 1);

    if(this.identificationObj && this.identificationRoot &&
       !this.identificationRoot.isTerminalResult())
        this.identificationRoot.setData(this.identifiedDataObj);
}

// In case the 'setData' function is called on this object, we interpret
// it as setting the identified data (and not the identification data).
// This overrides the default implementation of this function in the
// base class.

IdentityResult.prototype.setData = identityResultSetData;

function identityResultSetData(dataObj)
{
    this.setIdentifiedData(dataObj);
}

// This overrides the standard implementation of this function. This is because
// the identified data is set here as the terminal data of the identification
// function but if the identification function is not yet defined, 
// it is not itself set as the identification function (this is what
// the default implementation would do).

IdentityResult.prototype.setTerminalData = 
    identityResultSetTerminalData;

function identityResultSetTerminalData(dataObj)
{
    if(this.identifiedDataObj === undefined ||
       this.identifiedDataObj.isReplaceableTerminalResult()) {
        // set the data object as the identified data
        this.setIdentifiedData(dataObj);
    } else if(!this.identifiedDataObj.isTerminalResult())
        this.identifiedDataObj.setTerminalData(dataObj);
}

//  This function returns the data object which determines the content on this
// function result node (the data object out of which the dominated matches
// of this node are extracted). In the specific case of the IdentityResult,
// this function returns the identified data  object.

IdentityResult.prototype.getContentDataObj = identityResultGetContentDataObj;

function identityResultGetContentDataObj(argNum)
{
    return this.identifiedDataObj;
}

//  This function returns 'true' if th data object with the given
// argument number is one which determines the content on this
// function result node (the data object out of which the dominated matches
// of this node are extracted). In the specific case of the IdentityResult,
// this function returns true iff the 'argNum' is the argument number
// of the identified data.

IdentityResult.prototype.isContentDataObj = identityResultIsContentDataObj;

function identityResultIsContentDataObj(argNum)
{
    return argNum == 0; // this is the identifiedDataObj
}

// This function can be called either for the identificationObj or for the 
// identifiedDataObj (both of which are FuncResult objects). To determine
// which of the two it is, the object is given as an argument.
// Each case is handled by a different function (see documentation there).

IdentityResult.prototype.refreshIndexerAndPaths =
    identityResultRefreshIndexerAndPaths;

function identityResultRefreshIndexerAndPaths(dataObj)
{
    if(dataObj == this.identifiedDataObj)
        this.refreshIdentifiedIndexerAndPaths();
    if(dataObj == this.identificationObj)
        this.refreshIdentificationIndexerAndPaths();
}

// This function is called when a new identifiedDataObj is set.
// It is not the responsibility of this function to add or identities,
// but only to set the new identified indexer and path, handle the 
// registrations and deregistrations involved in this update and
// notify the active composed functions of this change. 

IdentityResult.prototype.refreshIdentifiedIndexerAndPaths =
    identityResultRefreshIdentifiedIndexerAndPaths;

function identityResultRefreshIdentifiedIndexerAndPaths()
{
    var identityIndexer = this.identifiedDataObj ? 
        this.identifiedDataObj.getDominatedIndexer() : undefined;
    var identifiedPathId = this.identifiedDataObj ? 
        this.identifiedDataObj.getDominatedProjPathId() : undefined;

    // when the identity result is in the process of becoming
    // active* (activeStarPending is true) we still need to cotinue to
    // the code below even if the identity indexer and identified path
    // did not change, as we need to update the composed active functions.
    if(this.identityIndexer == identityIndexer && 
       this.identifiedPathId == identifiedPathId && !this.activeStarPending)
        return; // nothing changed

    if(this.identityIndexer != identityIndexer) {
        if(this.identityIndexer) {
            this.identityIndexer.
                unregisterIdentification(this.identificationId, this);
        }
        if(identityIndexer)
            identityIndexer.registerIdentification(this.identificationId, this);
    }

    this.identityIndexer = identityIndexer;
    this.identifiedPathId = identifiedPathId;

    if(this.composedActiveNum > 0)
        for(var resultId in this.composedActive)
            this.composedActive[resultId].refreshIndexerAndPaths(this);
}

// This function handles the case where the indexer or path of
// this.identificationObj have changed.  It is assumed that when this
// happens, all matches were already removed either by the
// identificationObj node itself (if the data object itself did not
// change) or by another function by a call to removeDataObjMatches()
// (see below). So all this function does is remove its registration
// (as a query calculation node) from the previous indexer and path
// and adds a registration on the new indexer and path. If this
// identity result node provides a fixed identity (and therefore only
// needs the matched data element IDs and not their values), this
// function does not request to receive key updates. The registration
// to the indexer is still needed in order to get the match points
// (the paths which have data elements defined on them).

IdentityResult.prototype.refreshIdentificationIndexerAndPaths =
    identityResultRefreshIdentificationIndexerAndPaths;

function identityResultRefreshIdentificationIndexerAndPaths()
{
    var indexer = this.identificationObj ? 
        this.identificationObj.getDominatedIndexer(): undefined;
    var pathId = this.identificationObj ? 
        this.identificationObj.getDominatedProjPathId() : undefined;
    
    if(this.sourceIndexer == indexer && this.pathId == pathId)
        return; // nothing to refresh

    if(this.sourceIndexer) {
        if(this.monitor) {
            this.monitor.destroy();
            this.monitor = undefined;
        }
        this.sourceIndexer.removeQueryCalcFromPathNode(this);
    }

    this.sourceIndexer = indexer;
    this.pathId = pathId;

    if(this.sourceIndexer === undefined)
        return;

    // register to the new indexer and path (if defined)
    indexer.addQueryCalcToPathNode(this);
    if(this.identity === undefined) {
        // if the identity is not fixed, need key updates from the path
        this.sourceIndexer.needKeyUpdateForQuery(this);
        this.monitor = new IdentityMonitor(this, this.sourceIndexer, 
                                           this.pathId);
    }
}

// This function is called to notify that the dominated indexer or path
// of one fo the data objects (or both, if they are the same) have changed
// but that this change is such that the actual matches (data elements
// and their keys and all dominated data elements and keys) did not change
// (for example, this may happen when a result indexer is inserted to
// index an intermediate result in the result chain).
// This function can be called either for the identificationObj or for the 
// identifiedDataObj (both of which are FuncResult objects). To determine
// which of the two it is, the object is given as an argument.
// Each case is handled by a different function (see documentation there).
// If the identified and the identification data objects are the same,
// they both change at the same time, but the change can be handled in
// two step (as if each change took place separately) because the
// updates required in each case is independent of the other (the only
// assumption is that the identity and the identifying indexers agree
// of the data element IDs they use, and this remains the case here).
// 'prevPrefixPathId' and 'prefixPathId' are standard parameters of the
// replaceIndexerAndPaths() function which indicate how the projection paths
// of the data object before and after the change are related. These parameters
// are ignored here, but need to be forwarded to composed functions
// which to which the replacement is forwarded (this only takes place for
// the identified data).

IdentityResult.prototype.replaceIndexerAndPaths =
    identityResultReplaceIndexerAndPaths;

function identityResultReplaceIndexerAndPaths(prevPrefixPathId, prefixPathId,
                                              newIndexerContained, dataObj)
{
    if(dataObj == this.identifiedDataObj)
        this.replaceIdentifiedIndexerAndPaths(prevPrefixPathId, prefixPathId,
                                              newIndexerContained);
    if(dataObj == this.identificationObj)
        this.replaceIdentificationIndexerAndPaths();
}

// This function is called to notify that the dominated indexer or path
// of the identified data have changed but that this change is such that
// the actual matches (data elements and their keys and all dominated data
// elements and keys) did not change (for example, this may happen when
// a result indexer is inserted to index an intermediate result in the result
// chain). Since the identities did not change, but there is a new
// identity index (the dominated index of the identified data) this function
// registers the identification with its identities to the new identity
// indexer and removes them from the old identity indexer. It then notifies
// the active composed functions of the change in indexer and path (since
// this is also the dominated indexer and path of the composed results).
// 'prevPrefixPathId' and 'prefixPathId' are standard parameters of the
// replaceIndexerAndPaths() function which indicate how the projection paths
// of the data object before and after the change are related. These parameters
// are ignored here, but need to be forwarded to composed functions
// which to which the replacement is forwarded.

IdentityResult.prototype.replaceIdentifiedIndexerAndPaths =
    identityResultReplaceIdentifiedIndexerAndPaths;

function identityResultReplaceIdentifiedIndexerAndPaths(prevPrefixPathId,
                                                        prefixPathId,
                                                        newIndexerContained)
{
    var identityIndexer = this.identifiedDataObj ? 
        this.identifiedDataObj.getDominatedIndexer() : undefined;
    var identifiedPathId = this.identifiedDataObj ? 
        this.identifiedDataObj.getDominatedProjPathId() : undefined;

    var oldIdentityIndexer = this.identityIndexer;

    // set the new values
    this.identityIndexer = identityIndexer;
    this.identifiedPathId = identifiedPathId;
    
    if(this.identityIndexer != oldIdentityIndexer) {
    
        // register the identification on the new indexer
        if(this.identityIndexer)
            this.identityIndexer.registerIdentification(this.identificationId,
                                                        this);

        var allIdentities =
            oldIdentityIndexer.getAllIdentities(this.identificationId);

        if(allIdentities !== undefined && allIdentities.size > 0) {
            // get the identities from the old identity indexer and add them
            // to the new identity indexer
            var identifiedIds = [];
            var identities = [];
            allIdentities.forEach(function(identity, elementId) {
                identifiedIds.push(elementId);
                identities.push(identity);
            });
        
            this.identityIndexer.addIdentities(identifiedIds, identities, 
                                               this.identificationId);
        }
    }
    
    if(this.composedActiveNum > 0)
        for(var resultId in this.composedActive) {
            this.composedActive[resultId].
                replaceIndexerAndPaths(prevPrefixPathId, prefixPathId,
                                       newIndexerContained, this);
        }

    // after the composed functions were notified, requests for identity
    // updates from those functions were transferred to the new indexer,
    // to the identification can be removed from the old identity indexer.
    if(oldIdentityIndexer && oldIdentityIndexer != this.identityIndexer)
        oldIdentityIndexer.unregisterIdentification(this.identificationId,
                                                    this);
}

// This function is called to notify that the dominated indexer or path
// of the identified data have changed but that this change is such that
// the actual matches (data elements and their keys and all dominated data
// elements and keys) did not change (for example, this may happen when
// a result indexer is inserted to index an intermediate result in the result
// chain). Since the identified elements and their identities did not change,
// all we need to do is transfer the registration of this object as
// a query calculation node from the old indexer and path to the new indexer
// and path and identity monitor (if any) from the old indexer to
// the new indexer. 

IdentityResult.prototype.replaceIdentificationIndexerAndPaths =
    identityResultReplaceIdentificationIndexerAndPaths;

function identityResultReplaceIdentificationIndexerAndPaths()
{
    var indexer = this.identificationObj ? 
        this.identificationObj.getDominatedIndexer(): undefined;
    var pathId = this.identificationObj ? 
        this.identificationObj.getDominatedProjPathId() : undefined;
    
    if(this.sourceIndexer == indexer && this.pathId == pathId)
        return; // nothing to refresh

    // replace the source of the monitor
    if(this.monitor)
        this.monitor.replaceSource(indexer, pathId);

    // remove the registration of this result node as a query calculation node
    // to the source indexer
    if(this.sourceIndexer !== undefined)
        this.sourceIndexer.removeQueryCalcFromPathNode(this);

    this.sourceIndexer = indexer;
    this.pathId = pathId;

    if(this.sourceIndexer === undefined || pathId === undefined)
        return; // dominated chain not fully initialized yet

    // register to the new indexer and path (if defined)
    indexer.addQueryCalcToPathNode(this);
    if(this.identity === undefined)
        // if the identity is not fixed, need key updates from the path
        this.sourceIndexer.needKeyUpdateForQuery(this);
}

// This function is called when the match count of the data  object is
// increased. If the match count increased from zero (to a non-zero value)
// the match count of this node also increases from 0 to 1 and this
// match count increase must be propagated to the active composed nodes
// (together with the matches, which are passed through as is).

IdentityResult.prototype.increaseMatchCount =
    identityResultIncreaseMatchCount;

function identityResultIncreaseMatchCount(incMatchCount, dataResultMatches,
                                          source)
{
    if(source !== this.identifiedDataObj)
        return; // only the identified data object match count is relevant
    
    if(incMatchCount === 0 ||
       this.identifiedDataObj.getDomMatchCount() - incMatchCount > 0)
        return; // did not increase from zero to non-zero

    for(var resultId in this.composedActive) {
        var composedResult = this.composedActive[resultId];
        composedResult.increaseMatchCount(1, dataResultMatches, this);
    }
}

// This function is called when the match count of the data  object is
// decreased. If the match count decreased to zero (from a non-zero value)
// the match count of this node also decreases from 1 to 0 and this
// match count decrease must be propagated to the active composed nodes
// (together with the matches, which are passed through as is).

IdentityResult.prototype.decreaseMatchCount =
    identityResultDecreaseMatchCount;

function identityResultDecreaseMatchCount(decMatchCount, dataResultMatches,
                                          source)
{
    if(source !== this.identifiedDataObj)
        return; // only the identified data object match count is relevant
    
    if(decMatchCount === 0 || this.identifiedDataObj.getDomMatchCount() > 0)
        return; // did not drop from non-zero to zero

    for(var resultId in this.composedActive) {
        var composedResult = this.composedActive[resultId];
        composedResult.decreaseMatchCount(1, dataResultMatches, this);
    }
}

// This function is called just after either one of the data result objects 
// was set or replaced. 'indexerAndPathChanged' indicates whether either
// the indexer or the projection path of the new data object differ
// from those of the old data object. If they do, this function gets 
// all matches from the new data object and adds their identities. Since 
// refreshIndexerAndPath() was called, the initial registrations required
// for the new indexer and path were already made.
// If the indexer and path did not change, this function finds the
// new matches which were added (it gets the old data object as
// an argument for this) and only adds those.

IdentityResult.prototype.addDataObjMatches =
    identityResultAddDataObjMatches;

function identityResultAddDataObjMatches(oldDataObj, indexerAndPathChanged,
                                         argNum)
{
    var newDataObj;
    if(!(newDataObj = this.dataObjs[argNum]))
        return; // nothing to add

    if(newDataObj != this.identificationObj &&
       newDataObj.getDomMatchCount() == 0 && !this.hasNonQueryActiveComposed())
        // nothing to do, this is teh idetified data and this node is
        // directly composed with the indexer and queries have direct access
        // to the indexer
        return;

    this.FuncResult_addDataObjMatches(oldDataObj, indexerAndPathChanged,
                                      argNum);
}

// This function is called just before on eof the data result objects is 
// about to be set or replaced. 'indexerAndPathChanged' indicates whether either
// the indexer or the projection path of the new data object differ
// from those of old data object. If they do, this function clears
// all values received from the old data object, releasing compressed
// values, if needed and removes all identities
// from the identity indexer. Since refreshIndexerAndPath()
// is about to be called, there is no need to clear registrations to 
// the indexer.
// If the indexer and path did not change, this function finds the
// old matches which were removed (it gets the new data object as
// an argument for this) and only removes those.

IdentityResult.prototype.removeDataObjMatches =
    identityResultRemoveDataObjMatches;

function identityResultRemoveDataObjMatches(newDataObj, indexerAndPathChanged,
                                            argNum)
{
    var oldDataObj;
    if(!(oldDataObj = this.dataObjs[argNum]))
        return; // nothing to remove

    if(indexerAndPathChanged)
        // do nothing: everything will be cleared when the refesh takes place
        return;
    
    if(oldDataObj != this.identificationObj &&
       oldDataObj.getDomMatchCount() == 0 && !this.hasNonQueryActiveComposed())
        // nothing to do, this is teh idetified data and this node is
        // directly composed with the indexer and queries have direct access
        // to the indexer
        return;

    this.FuncResult_removeDataObjMatches(newDataObj, indexerAndPathChanged,
                                         argNum);
}

// This function receives a list of matches added to the matches of one
// of its data result objects. 'source' is the data object from which the
// update was received. If the data object is the identifiedDataObj object,
// this function simply forwards the maches to the active composed
// result nodes. 
// If the data object is the identificationObj, this function needs 
// to update the identity indexer with the identities of the data elements 
// whose identity depends on these data elements.
// First, for each data element ID in the 'matches' list, this function needs
// to determine which data element at the identified path is identified
// by it. getIdentifiedId() is used to determine the identified ID 
// (see details there). 
// If 'needToRaiseMatches' is set, multiple matches can identify the
// same data element. In case of a constant identity, we only need to keep
// track of the number of matches which contributed to the identification.
// In case where the idnetity is the compression of the value under the
// match, we compress each of the matches separately. In the future, 
// we could create multiple identities. Currently, this is not allowed 
// and we simply replace the idnetity each time with the last one which 
// was updated (this shouldn't really be used). 

IdentityResult.prototype.addMatches =
    identityResultAddMatches;

function identityResultAddMatches(matches, source)
{
    if(matches.length == 0)
        return;

    if(source == this.identificationObj) {
        if(this.suspendedNewMatches) {
            // refresh is still in progress, store the matches for later update
            this.suspendedNewMatches[1] = matches;
            return;
        }
        if(this.needToRaiseMatches)
            this.addMatchesWithRaising(matches, source);
        else
            this.addMatchesWithoutRaising(matches, source);
    }
    
    if(source == this.identifiedDataObj && this.composedActiveNum > 0) { 

        // if the match count is zero, no need to update composed queries
        var updateNonQueriesOnly = (this.getDomMatchCount() == 0);

        if(updateNonQueriesOnly && !this.hasNonQueryActiveComposed())
            return;
        
        if(this.suspendedNewMatches) {
            // refresh is still in progress, store the matches for later update
            this.suspendedNewMatches[0] = matches;
            return;
        }
        
        // update from this.identifiedDataObj
        // if there are active composed results, forward the matches to them
        for(var resultId in this.composedActive) {
            var composed = this.composedActive[resultId];
            if(updateNonQueriesOnly &&
               (composed instanceof InternalQueryResult))
                continue;
            
            composed.addMatches(matches, this);
        }
    }
}

// Implements addMatches() when raising is not required.

IdentityResult.prototype.addMatchesWithoutRaising =
    identityResultAddMatchesWithoutRaising;

function identityResultAddMatchesWithoutRaising(matches, source)
{
    var identifiedIds = [];
    var identities = [];
    var identifiedId;


    if(this.identity === undefined) {
        var allIdentities = this.monitor.requestIdentity(matches);

        for(var i = 0, l = matches.length ; i < l ; ++i) {

            var elementId = matches[i];
            
            if((identifiedId = this.getIdentifiedId(elementId)) == undefined)
                continue; // does not identify any data element
            
            var identity = allIdentities[i];

            if(identity !== undefined) {
                identifiedIds.push(identifiedId);
                identities.push(-identity);
            }
        }
        
    } else { // fixed identity

        for(var i = 0, l = matches.length ; i < l ; ++i) {

            var elementId = matches[i];

            if((identifiedId = this.getIdentifiedId(elementId)) == undefined)
                continue; // does not identify any data element

            identifiedIds.push(identifiedId);
            identities.push(this.identity);
        }
    }

    // notify the identity indexer 
    this.identityIndexer.addIdentities(identifiedIds, identities, 
                                       this.identificationId,
                                       source == this.identifiedDataObj);
}

// Implements addMatches() when raising is required.

IdentityResult.prototype.addMatchesWithRaising =
    identityResultAddMatchesWithRaising;

function identityResultAddMatchesWithRaising(matches, source)
{
    var identifiedIds = [];
    var identities = [];
    var identifiedId;

    if(this.identity === undefined) {
        var allIdentities = this.monitor.requestIdentity(matches);

        for(var i = 0, l = matches.length ; i < l ; ++i) {

            var elementId = matches[i];
            
            if((identifiedId = this.getIdentifiedId(elementId)) == undefined)
                continue; // does not identify any data element
            
            var identity = allIdentities[i];

            if(identity !== undefined) {
                identifiedIds.push(identifiedId);
                identities.push(-identity);
            }

            if(elementId == identifiedId) {
                if(identifiedId in this.raisedIdentified)
                    delete this.raisedIdentified[identifiedId];
            } else if(!(identifiedId in this.raisedIdentified[identifiedId])) {
                var entry = this.raisedIdentified[identifiedId] = {
                    numMatches: 1,
                    matches: {}
                }
                entry.matches[elementId] = identity;
            } else  {
                var entry = this.raisedIdentified[identifiedId];
                if(!(elementId in entry.matches))
                    entry.numMatches++;
                entry.matches[elementId] = identity;
            }
        }
        
    } else { // fixed identity, simply update the count

        for(var i = 0, l = matches.length ; i < l ; ++i) {

            var elementId = matches[i];

            if((identifiedId = this.getIdentifiedId(elementId)) == undefined)
                continue; // does not identify any data element

            if(elementId == identifiedId) {
                if(identifiedId in this.raisedIdentified)
                    delete this.raisedIdentified[identifiedId];
                else {
                    identifiedIds.push(identifiedId);
                    identities.push(this.identity);
                }
            } else if(!(identifiedId in this.raisedIdentified)) {
                this.identified[identifiedId] = 1;
                identifiedIds.push(identifiedId);
                identities.push(this.identity);
            } else
                this.identified[identifiedId]++;
        }
    }

    // notify the identity indexer 
    this.identityIndexer.addIdentities(identifiedIds, identities, 
                                       this.identificationId,
                                       source == this.identifiedDataObj);
}

// Given a data element ID received as a match from the data result object,
// this function determines which node it identifies. If 'needToRaiseMatches'
// is not set, this is simply the given element ID itself. We then only
// need to check whether the data element is at the identified path (only 
// then is it identified by this identification). If not, undefined is
// returned. Otherwise, the data element ID is returned.
// If 'needToRaiseMatches' is set, we need to loop up the data element 
// domination chain to find the data element ID identified by 'elementId'.
// If the source indexer and the identity indexer are not the same, this
// process begins in the source indexer but switches to the identity
// indexer once a data element ID is reached which is found in that 
// indexer. The process then continues until the identified 
// path is reached. If we reached a data element at that path, that
// is the identified data element. Otherwise, undefined is returned.

IdentityResult.prototype.getIdentifiedId = identityResultGetIdentifiedId;

function identityResultGetIdentifiedId(elementId)
{
    var identityDataElements = this.identityIndexer.getDataElements();
    
    // determine the element which is identified by this match
    if(!this.needToRaiseMatches) {
        if(identityDataElements.hasEntry(elementId) &&
           (!this.identifyAtIdentifiedPathOnly ||
            identityDataElements.getPathId(elementId) == this.identifiedPathId))
            return elementId;
        else
            return undefined;
    }

    if(this.identityIndexer != this.sourceIndexer) {
        var sourceDataElements = this.sourceIndexer.getDataElements();
        // loop up until a data element is reached which is in the identity
        // indexer.
        while(!identityDataElements.hasEntry(elementId)) {
            if((elementId = sourceDataElements.getParentId(elementId)) ===
               undefined)
                return undefined; // not found
        }
    }

    // loop up the data elements in the identity indexer, until the 
    // identified path is reached.
    if(this.identifyAtIdentifiedPathOnly)
        // returns undefined if the raised data element is not exactly at
        // the identified path
        return identityDataElements.raiseExactlyToPath(elementId,
                                                       this.identifiedPathId);

    return identityDataElements.raiseToPath(elementId, this.identifiedPathId);
}

// This function receives a list of matches removed from one of the
// data result objects. 'source' is this data result object. If it is
// the identifiedObj data result object the matches are simply forwarded
// to all active composed result nodes. Otherwise ('source' is the 
// identificationObj data result object), the function determines 
// the data element identified by each of the matches.
// This function then notifies the identity indexer that the identity was
// removed. In case no raising took place, this only needs to verify that 
// the node is at the identified path (this is done by getIdentifiedId()).
// In case raising took place, this function uses the raisedIdentified
// table to see whether all matches raised to the idnetified data element
// have been removed. If yes, it notifies the identity indexer to 
// remove the identity.

IdentityResult.prototype.removeMatches =
    identityResultRemoveMatches;

function identityResultRemoveMatches(matches, source)
{
    if(matches.length == 0)
        return;

    if(source == this.identifiedDataObj && this.composedActiveNum > 0) {
        // update is from this.identifiedDataObj
        // if there are active composed results, forward the matches to them

        // if the match count is zero, no need to update composed queries
        var updateNonQueriesOnly = (this.getDomMatchCount() == 0);

        if(updateNonQueriesOnly && !this.hasNonQueryActiveComposed())
            return;
        
        for(var resultId in this.composedActive) {
            var composed = this.composedActive[resultId];
            if(updateNonQueriesOnly &&
               (composed instanceof InternalQueryResult))
                continue;
                
            composed.removeMatches(matches, this);
        }
    }

    if(source == this.identificationObj) {
        var removedIdentifiedIds = [];
        var identifiedId;
        
        for(var i = 0, l = matches.length ; i < l ; ++i) {
            
            var elementId = matches[i];
            
            if((identifiedId = this.getIdentifiedId(elementId)) == undefined)
                continue; // does not identify any data element
            
            if(elementId == identifiedId) {
                removedIdentifiedIds.push(identifiedId);
                continue;
            }
            
            if(this.identity) {
                if(!--this.raisedIdentified[identifiedId]) {
                    delete this.raisedIdentified[identifiedId];
                    removedIdentifiedIds.push(identifiedId);
                }
            } else {
                var entry = this.raisedIdentified[identifiedId];
                if(!--entry.numMatches) {
                    delete this.raisedIdentified[identifiedId];
                    removedIdentifiedIds.push(identifiedId);
                } else
                    delete entry.matches[elementId];
            }
        }
        
        this.identityIndexer.removeIdentities(removedIdentifiedIds, 
                                              this.identificationId,
                                              source == this.identifiedDataObj);

        if(this.identity === undefined)
            this.monitor.releaseIdentity(matches);

    }
}

// This function is called by one of the data objects when it wishes to notify
// this node that all matches previously added should be removed.
// If this data source is the identification data source, all identities
// are cleared. If it is the identified data source, the call is forwarded
// to the active composed nodes.

IdentityResult.prototype.removeAllMatches =
    identityResultRemoveAllMatches;

function identityResultRemoveAllMatches(source)
{
    if(source == this.identificationObj) {

        if(this.raisedIdentified)
            this.raisedIdentified = {};
        
        this.identityIndexer.removeAllIdentities(this.identificationId);
        if(this.identity === undefined)
            this.monitor.releaseAllIdentities();
        
    }

    if(source == this.identifiedDataObj && this.composedActiveNum > 0) {
        // update is from this.identifiedDataObj
        // if there are active composed results, forward the request to them
        for(var resultId in this.composedActive)
            this.composedActive[resultId].removeAllMatches(this);
    }
}

// another interface to addMatches

IdentityResult.prototype.addProjMatches =
    identityResultAddProjMatches;

function identityResultAddProjMatches(matches, resultId)
{
    var dataObj = (this.identifiedDataObj !== undefined && 
                   resultId == this.identifiedDataObj.getId()) ? 
        this.identifiedDataObj : this.identificationObj;
    this.addMatches(matches, dataObj);
}

// another interface to removeMatches

IdentityResult.prototype.removeProjMatches =
    identityResultRemoveProjMatches;

function identityResultRemoveProjMatches(matches, resultId)
{
    var dataObj = (this.identifiedDataObj !== undefined && 
                   resultId == this.identifiedDataObj.getId()) ? 
        this.identifiedDataObj : this.identificationObj;
    this.removeMatches(matches, dataObj);
}

//////////////////////////////////////
// Interface to Compression Monitor //
//////////////////////////////////////

// This function may be called by the compression monitor to request
// the full list of element IDs for which compression has been requested
// so far (these are simply the matches of the identification object).
// This list of element IDs is returned as an array.

IdentityResult.prototype.getMonitoredElements =
    identityResultGetMonitoredElements;

function identityResultGetMonitoredElements()
{
    if(!this.identificationObj)
        return [];
    
    return this.identificationObj.getDominatedMatches();
}

// This function may be called by the compression monitor to request
// the subset of the element IDs in the array 'elementIds' for which
// compression has been requested. The result is returned in an array
// which stores a subset of the elements in 'elementIds'.

IdentityResult.prototype.filterMonitoredElements =
    identityResultFilterMonitoredElements;

function identityResultFilterMonitoredElements(elementIds)
{
    if(!this.identificationObj)
        return [];

    return this.identificationObj.filterDominatedMatches(elementIds);
}

// This is called by the indexer to update of key changes at the path
// projection path of the data result object. If there is a 
// compression monitor, this is simply forwarded to it. Otherwise, 
// this is ignored. 

IdentityResult.prototype.updateKeys =
    identityResultUpdateKeys;

function identityResultUpdateKeys(elementIds, types, keys, prevTypes, prevKeys)
{
    if(this.monitor) {
        // need to indicate to the monitor for which of these elements
        // comporession was requested
        var positions =
            this.identificationObj.filterDominatedMatchPositions(elementIds);
        this.monitor.updateKeys(elementIds, types, keys, prevTypes, prevKeys,
                                positions);
    }
}

// This is called by the compression monitor when new / modified
// compressed values become available. This then pushes this update
// to the identity indexer. As the elementIds here come from the 
// projection path of the data result object and not necessarily 
// from the identified path of the idnetity indexer, this function
// first finds the identified data element which is indentified 
// by each of these identities before adding these identified 
// data elements with the compression values provided here 
// to the identity indexer.

IdentityResult.prototype.updateCompressedValues =
    identityResultUpdateCompressedValues;

function identityResultUpdateCompressedValues(elementIds, compressedValues)
{
    var identifiedIds = [];
    var identities = [];
    var identifiedId;

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var elementId = elementIds[i];
            
        if((identifiedId = this.getIdentifiedId(elementId)) == undefined)
            continue; // does not identify any data element

        identifiedIds.push(identifiedId);
        identities.push(-compressedValues[i]);
    }

    // notify the identity indexer 
    this.identityIndexer.addIdentities(identifiedIds, identities, 
                                       this.identificationId);
}

/////////////////////////////////////
// Interface as Data Result Object //
/////////////////////////////////////

// return the value from the identified data result object.

IdentityResult.prototype.getDominatedIndexer =
    identityResultGetDominatedIndexer;

function identityResultGetDominatedIndexer()
{
    if(this.identifiedDataObj === undefined)
        return undefined;
    
    return this.identifiedDataObj.getDominatedIndexer();
}

// return the value from the identified data result object.

IdentityResult.prototype.getDominatedProjPathId =
    identityResultGetDominatedProjPathId;

function identityResultGetDominatedProjPathId()
{
    if(this.identifiedDataObj === undefined)
        return undefined;
    
    return this.identifiedDataObj.getDominatedProjPathId();
}

// return the value from the identified data result object.

IdentityResult.prototype.getDominatedProjPathNum =
    identityResultGetDominatedProjPathNum;

function identityResultGetDominatedProjPathNum()
{
    if(this.identifiedDataObj === undefined)
        return undefined;
    
    return this.identifiedDataObj.getDominatedProjPathNum();
}

// return the value from the identified data result object.

IdentityResult.prototype.getDominatedProjMappings =
    identityResultGetDominatedProjMappings;

function identityResultGetDominatedProjMappings()
{
    if(this.identifiedDataObj === undefined)
        return undefined;

    // use default implementation
    return this.FuncResult_getDominatedProjMappings();
}

// The terminal projection matches are the dominated matches of the identified
// data object.

IdentityResult.prototype.getTerminalProjMatches =
    identityResultGetTerminalProjMatches;

function identityResultGetTerminalProjMatches(projId)
{
    if(this.identifiedDataObj === undefined)
        return [];

    return this.identifiedDataObj.getDominatedMatches();
}

// The terminal projection matches are the dominated matches of the identified
// data object.

IdentityResult.prototype.filterTerminalProjMatches =
    identityResultFilterTerminalProjMatches;

function identityResultFilterTerminalProjMatches(projId, elementIds)
{
    if(this.identifiedDataObj === undefined)
        return [];

    return this.identifiedDataObj.filterDominatedMatches(elementIds);
}

// The dominated match count is either 0 or 1. When the identified data
// has a match count of 0, the identity result also has a match count
// of zero, since the identity result does not perform any filtering
// on the data (which is the full indexer data, in this case).

IdentityResult.prototype.getDomMatchCount =
    identityResultGetDomMatchCount;

function identityResultGetDomMatchCount()
{
    if(!this.identifiedDataObj)
        return 0; // there's anyway no dominated indexer
    
    return this.identifiedDataObj.getDomMatchCount() == 0 ? 0 : 1; 
}

// return the matches of the identified data result object (if it exists)

IdentityResult.prototype.getDominatedMatches =
    identityResultGetDominatedMatches;

function identityResultGetDominatedMatches()
{
    if(this.identifiedDataObj === undefined)
        return [];
    
    return this.identifiedDataObj.getDominatedMatches();
}

// return the matches of the identified data result object (if it exists)

IdentityResult.prototype.getDominatedMatchesAsObj =
    identityResultGetDominatedMatchesAsObj;

function identityResultGetDominatedMatchesAsObj()
{
    if(this.identifiedDataObj === undefined)
        return new Map();
    
    return this.identifiedDataObj.getDominatedMatchesAsObj();
}

// This function receives as input a list (array) of data element IDs
// and returns an array with a subset of the input array of element IDs
// which are matches of this identity result, which means they are in
// its identified data. This function is implemented by passing the
// call to identified data object.

IdentityResult.prototype.filterDominatedMatches =
    identityResultFilterDominatedMatches;

function identityResultFilterDominatedMatches(elementIds)
{
    if(this.identifiedDataObj === undefined)
        return [];
    
    return this.identifiedDataObj.filterDominatedMatches(elementIds);
}

// This function receives as input a list (array) of data element IDs
// and returns an array with the positions in the input array of element IDs
// which are matches of this identity result, which means they are in
// its identified data. This function is implemented by passing the
// call to identified data object.

IdentityResult.prototype.filterDominatedMatchPositions =
    identityResultFilterDominatedMatchPositions;

function identityResultFilterDominatedMatchPositions(elementIds)
{
    if(this.identifiedDataObj === undefined)
        return [];
    
    return this.identifiedDataObj.filterDominatedMatchPositions(elementIds);
}

// The dominated identification is the identification applied by this
// object

IdentityResult.prototype.getDominatedIdentification =
    identityResultGetDominatedIdentification;

function identityResultGetDominatedIdentification()
{
    return this.identificationId;
}

// The comparison defining the ordering of the elements is that of the
// identified data.

IdentityResult.prototype.getDominatedComparison = 
    identityResultGetDominatedComparison;

function identityResultGetDominatedComparison()
{
    if(this.identifiedDataObj !== undefined)
        return this.identifiedDataObj.getDominatedComparison();

    return undefined;
}

// Registers as a selection to the source indexer. As no selection values
// are registered, this results in no match updates (but match points
// are updated and key updates, if requested, are received).

IdentityResult.prototype.isSelection =
    identityResultIsSelection;

function identityResultIsSelection()
{
    return true;
}

// Since the identity result may be registered as a selection to the indexer
// (in order to get match point updates) it must implement the following
// function which is called when the indexer is cleared. This function does
// not need to do anything, since the matches will actually be cleared
// by a call from the data source (which is responsible for match
// updates - since the registration to the indexer is as a selection but
// without specifying any selection criteria, this is the empty selection
// which produces no updates).

IdentityResult.prototype.removeAllIndexerMatches =
    identityResultRemoveAllIndexerMatches;

function identityResultRemoveAllIndexerMatches()
{
    return;
}

//////////////////
// Match Points //
//////////////////

// Upon registration to the indexer as a query calculation node, this
// function receives an array with the match points for the path at
// which the registration took place: all prefixes of this path,
// including the path itself, which have data elements.  This function
// stores these match points and calculates the lowest one (longest
// path). If the only match point is the root path ID or if the source
// indexer is equal to the identity indexer and all match points are
// prefixes of the identified path, a flag is set indicating that no
// raising of data element IDs needs to take place.

IdentityResult.prototype.setMatchPoints =
    identityResultSetMatchPoints;

function identityResultSetMatchPoints(matchPoints)
{
    this.matchPoints = new Map();

    for(var i = 0, l = matchPoints.length ; i < l ; ++i)
        this.matchPoints.set(matchPoints[i], true);

    // the lowest match point is the first in the list
    this.lowestMatchPoint = matchPoints[0];

    this.calcNeedToRaiseMatches();
}

// This function is called to add the given path ID to the list of match
// points. In addition to adding this path ID to the 'matchPoints' table,
// this function also checks whether this path ID has become the new
// lowest match point (the one with the largest path ID) and if it did,
// whether this has any effect on the 'needToRaiseMatches' property.

IdentityResult.prototype.addToMatchPoints =
    identityResultAddToMatchPoints;

function identityResultAddToMatchPoints(pathId)
{
    this.matchPoints.set(pathId, true);
    
    if(pathId > this.lowestMatchPoint) {
        this.lowestMatchPoint = pathId;
        if(!this.needToRaiseMatches) // can only change from false to true
            this.calcNeedToRaiseMatches();
    }
}

// This function is called to remove the given path ID from the list of match
// points. In addition to removing this path ID from the 'matchPoints' table,
// this function also checks whether this requires the lowest match point
// (the one with the largest path ID) to be recalculated. If this changes,
// the 'nnedToRaiseMatches' property is also updated.

IdentityResult.prototype.removeFromMatchPoints =
    identityResultRemoveFromMatchPoints;

function identityResultRemoveFromMatchPoints(pathId)
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

        if(this.needToRaiseMatches) // can only change from true to false
            this.calcNeedToRaiseMatches();
    }
}

// Calculate the 'needToRaiseMatches' property

IdentityResult.prototype.calcNeedToRaiseMatches =
    identityResultCalcNeedToRaiseMatches;

function identityResultCalcNeedToRaiseMatches()
{
    this.needToRaiseMatches = 
        (this.lowestMatchPoint !== this.qcm.getRootPathId() && 
         (this.sourceIndexer != this.identityIndexer || 
          this.lowestMatchPoint > this.identifiedPathId));

    if(this.needToRaiseMatches != !this.raisedIdentified)
        this.raisedIdentified = this.needToRaiseMatches ? {} : undefined; 

    return this.needToRaiseMatches;
}
