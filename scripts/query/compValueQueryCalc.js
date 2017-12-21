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


// This is an auxiliary QueryCalc object which is used by the
// partition comparison calculation (PartitionCompCalc) to register to
// the indexer at the combined projection path ('compProjPathId')
// or at the projection path of those partition queries which are projections
// in order to receive information about the data at that path:
// 1. determine whether any raising needs to take place from these projection
//    paths (at which the matches are reported). This is based on match point
//    notifications from the indexer to the CompValueQueryCalc registered
//    at the projection path.
// 2. get key updates when the keys are used in the comparison function
//    (when 'valueAscending' is not undefined).
// 3. get the list of element IDs in case there are no partition queries
//    defined.
//
// When this object does not need to receive any match updates, it is registered
// as a selection query calculation object without registering any selection
// and setting the 'doNotIndex' flag.
//
// Object Structure
// ----------------
//
// {
//     id: <ID of this query calculation node>,
//
//     owner: <PartitionCompCalc>
//     pathId: <path ID in source indexer>,
//     pathNode: <path node for 'pathId'>
//     indexer: <InternalQCMIndexer>
//     doNotIndex: true,        // constant value
//
//     prefixProjPathId: <path ID>
//     needKeyUpdates: true|false
//     needMatchUpdates: true|false
//
//     matchPoints: <Map>{
//         <path ID>: true,
//         .......
//     }
// }
//
// id: this is the ID of this node, as a query calculation node. It is
//    allocated using InternalQCM.newId() to ensure it does not clash with
//    the IDs assigned to other query calculation nodes.
// owner: this is the PartitionCompCalc object which created this object
//    and which needs to receive notifications from it.
// resultIds: an array of result IDs defining the set of query result objects
//    which this object serves. The 'gap' query (all elements not matched
//    by any partition query) is not registered here (this can easily
//    be determined).
// pathId: this is the path at which this object is registered.
// pathNode: this is the path node for path 'pathId' in indexer 'indexer',
//    which is the path node where this CompValueQueryCalc object is
//    registered.
// indexer: the indexer to which this object is registered.
// doNotIndex: this is always set to true, to ensure that the path node
//    in the source indexer to which this query calculation node is registered
//    does not turn indexing on on account of this query calculation node
//    (whether it emulates a projection or a selection).
//
// prefixProjPathId: this is the path which defines the elements which
//    are compared by the comparison function. Any match points at or
//    above this path may be ignored (as there is no need to raise
//    beyond this path).
// needKeyUpdates: this flag (true or false) indicates whether this
//    QueryCalc object currently requests key updates from the indexer
//    or not. This may be changed dynamically.
// needMatchUpdates: when this flag is true, this QueryCalc object is
//    a projection and receives updates when elements are added or removed
//    at its projection path ('pathId'). In this case, the object notifies
//    the owner object of the matches added and removed.
//
// matchPoints: this is a table of the match points reported by the
//    indexer (that is, paths which are prefixes of 'pathId', including
//    'pathId') such that there are some data elements defined at that path.
//    This table does not store match points which are equal or smaller
//    than 'prefixProjPathId', as there is no need to raise beyond
//    'prefixProjPathId'.
//    When this table is empty, there is no need to raise matches.
//    As this table is often empty, the table is only create when needed
//    and this field may also be undefined.

//
// Constructor
//

// The constructor receives the following arguments:
// owner: the PartitionCompCalc which creates this object and needs to
//    receive notifications from it.
// resultId: the ID of the query result object of the query this
//    object serves. This may be undefined if this object was constructed
//    for the 'gap' query (all elements not matched by any query).
// indexer: the indexer to which this QueryCalc node should be registered
// pathId: the path in the indexer at which it needs to be registered.
// prefixProjPathId: the path at which the comparison applies. This is a prefix
//    of pathId (it is possible that prefixProjPathId === pathId).
// needKeyUpdates: if this flag is true, the query calculation node
//    registers to receive updates when keys at 'pathId' change.
// needMatchUpdates: if this flag is true, the query calculation node
//    is registered as a projection and is also responsible for notifying
//    its owner of matches added and removed.

function CompValueQueryCalc(owner, resultId, indexer, pathId, prefixProjPathId,
                            needKeyUpdates, needMatchUpdates)
{
    this.id = InternalQCM.newId();
    this.owner = owner;
    this.resultIds = resultId === undefined ? [] : [resultId];
    this.pathId = pathId;
    this.indexer = indexer;
    this.doNotIndex = true;
    this.prefixProjPathId = prefixProjPathId;
    this.needKeyUpdates = needKeyUpdates;
    this.needMatchUpdates = needMatchUpdates;
    this.matchPoints = undefined;
    
    // sets the query calculation node on the indexer
	this.pathNode = this.indexer.addQueryCalcToPathNode(this);

    this.setNeedKeyUpdates(needKeyUpdates);
}

// When the 'needMatchUpdates' is true, this is a projection, receiving
// notifications of all elements added or removed at the projection path.
// When no match updates are required, this is registered as selection
// QueryCalc, but without setting any selection. In this way,
// this queryCalc does not receive any match updates but only match point
// and (if requested) key updates. 

CompValueQueryCalc.prototype.isSelection = 
    compValueQueryCalcIsSelection;

function compValueQueryCalcIsSelection() 
{
    return !this.needMatchUpdates;
}

// Destroy function for this query calcualtion node. This de-registers
// the query calculation node from the indexer. 

CompValueQueryCalc.prototype.destroy = compValueQueryCalcDestroy;

function compValueQueryCalcDestroy() 
{
    // unregister from the indexer
    this.indexer.removeQueryCalcFromPathNode(this);
}

// return the ID of this object

CompValueQueryCalc.prototype.getId = 
    compValueQueryCalcGetId;

function compValueQueryCalcGetId() 
{
    return this.id;
}

// This function can be called by the CompCalc node to determine whether
// raising of matches is needed (for the projection path for which this
// QueryCalc was registered). The function returns true if raising may be
// needed and false if raising is certainly not needed.

CompValueQueryCalc.prototype.needToRaiseMatches =
    compValueQueryCalcNeedToRaiseMatches;

function compValueQueryCalcNeedToRaiseMatches()
{
    return (this.matchPoints !== undefined && this.matchPoints.size > 0)
}

// This function may be called to change the 'needKeyUpdates' flag
// on this object so as to start receiving key update notification
// ('needKeys' true) or stop these notifications ('needKeys' false).

CompValueQueryCalc.prototype.setNeedKeyUpdates =
    compValueQueryCalcSetNeedKeyUpdates;

function compValueQueryCalcSetNeedKeyUpdates(needKeys)
{
    if(needKeys === this.needKeyUpdates)
        return;

    this.needKeyUpdates = needKeys;
    
    if(needKeys)
        this.indexer.needKeyUpdateForQuery(this);
    else
        this.indexer.stopKeyUpdateForQuery(this);
}

// This function may be called to add a result ID of a query result object
// which makes use of this object. The function first checks whether the
// result ID is already registered on this object (it will not be registered
// twice).

CompValueQueryCalc.prototype.addResultId =
    compValueQueryCalcAddResultId;

function compValueQueryCalcAddResultId(resultId)
{
    if(resultId === undefined)
        return; // not registered
    
    for(var i = 0, l = this.resultIds.length ; i < l ; ++i) {
        if(this.resultIds[i] == resultId)
            return; // already registered
    }
    
    this.resultIds.push(resultId);
}

// This function may be called to remove a result ID of a query result object
// which made use of this object bu does not do so anymore.

CompValueQueryCalc.prototype.removeResultId =
    compValueQueryCalcRemoveResultId;

function compValueQueryCalcRemoveResultId(resultId)
{
    for(var i = 0, l = this.resultIds.length ; i < l ; ++i) {
        if(this.resultIds[i] == resultId) {
            if(i < l - 1)
                this.resultIds[i] = this.resultIds[l - 1];
            this.resultIds.length--;
            break;
        }
    }
}

// This function returns an array with the result IDs of all query result
// objects which make use of this value QueryCalc.

CompValueQueryCalc.prototype.getResultIds =
    compValueQueryCalcGetResultIds;

function compValueQueryCalcGetResultIds()
{
    return this.resultIds;
}

//
// Match points
//

// This function is called upon registration of this query calculation node
// to the indexer to set the initial list of match points for this
// query calculation node. 'matchPoints' is an array of path IDs (in the
// indexer) in decreasing order of path ID.
// We only register match points which are larger (longer paths) than
// 'this.prefixProjPathId' (which is the path at which the comparison applies).

CompValueQueryCalc.prototype.setMatchPoints = 
    compValueQueryCalcSetMatchPoints;
function compValueQueryCalcSetMatchPoints(matchPoints) 
{
    for(var i = 0, l = matchPoints.length ; i < l ; ++i) {
        var pathId = matchPoints[i];
        if(pathId <= this.prefixProjPathId)
            break; // no need to store this or any subsequent match point
        if(this.matchPoints === undefined)
            this.matchPoints = new Map();
        this.matchPoints.set(pathId, true);
    }
}

// This function is called to add the given path ID to the list of match
// points. The path is added to the list of match points only if it is
// larger than 'this.prefixProjPathId' (which is the path at which
// the comparison applies).

CompValueQueryCalc.prototype.addToMatchPoints = 
    compValueQueryCalcAddToMatchPoints;

function compValueQueryCalcAddToMatchPoints(pathId) 
{
    if(pathId <= this.prefixProjPathId)
        return; // no need to add

    if(this.matchPoints === undefined)
        this.matchPoints = new Map();
    this.matchPoints.set(pathId, true);
}

// This function is called to remove the given path ID from the list of match
// points. If the path ID is smaller or equal 'this.prefixProjPathId' it was
// not added and therefore there is no need to remove it.

CompValueQueryCalc.prototype.removeFromMatchPoints =
    compValueQueryCalcRemoveFromMatchPoints;

function compValueQueryCalcRemoveFromMatchPoints(pathId) 
{
    if(pathId <= this.prefixProjPathId || this.matchPoints === undefined)
        return; // no need to remove

    this.matchPoints.delete(pathId);
}

//
// Match updates
//

// When this object is registered as a projection, this function is
// called by the indexer (which is the 'source' argument) to notify of
// elements added at the projection path 'this.pathId'. This function
// simply passes this notification to the owner object.

CompValueQueryCalc.prototype.addMatches = 
    compValueQueryCalcAddMatches;

function compValueQueryCalcAddMatches(elementIds, source)
{
    this.owner.addProjPathMatches(elementIds);
}

// If this object is in 'needMatchUpdates' mode, this function returns
// all current matches at the path at which this QueryCalc is registered.
// If the object is not in 'needMatchUpdates' mode, this function
// should not be called (it returns undefined).

CompValueQueryCalc.prototype.getAllMatches =
    compValueQueryCalcGetAllMatches;

function compValueQueryCalcGetAllMatches()
{
    if(!this.needMatchUpdates)
        return undefined;
    
    return this.indexer.getAllMatches(this.pathId);
}

// When this object is registered as a projection, this function is
// called by the indexer (which is the 'source' argument) to notify of
// elements removed at the projection path 'this.pathId'. This function
// simply passes this notification to the owner object.

CompValueQueryCalc.prototype.removeMatches = 
    compValueQueryCalcRemoveMatches;

function compValueQueryCalcRemoveMatches(elementIds, source)
{
    this.owner.removeProjPathMatches(elementIds);
}

// This function is called when the path node this object is registered to
// is about to be cleared of all its nodes. If this value query calculation
// node needs to update matches, this function then fetches
// those nodes and then removes them.

CompValueQueryCalc.prototype.removeAllIndexerMatches = 
    compValueQueryCalcRemoveAllIndexerMatches;

function compValueQueryCalcRemoveAllIndexerMatches()
{
    if(!this.needMatchUpdates)
        return;
    
    this.owner.removeProjPathMatches(this.indexer.getAllMatches(this.pathId));
}

//
// Key Updates
//

// This function is called by the indexer with key updates for
// the path node on which this query calculation node is registered.
// The update consists of five arrays: 'elementIds', 'types', 'keys',
// 'prevTypes' and 'prevKeys'.
// Position i in all arrays consists of the i'th update. 
// For more information, see InternalQCMIndexer.setKeysOnNodes().
// This function simply forwards the update to the owner PartitionCompCalc
// object.

CompValueQueryCalc.prototype.updateKeys = 
    compValueQueryCalcUpdateKeys;

function compValueQueryCalcUpdateKeys(elementIds, types, keys, prevTypes,
                                      prevKeys)
{
    this.owner.updateKeys(this, elementIds, types, keys, prevTypes,
                          prevKeys);
}

// Given the element ID of node at the projection path 'this.pathId',
// this function returns the key of the node at path 'this.pathId'
// with the given ID. Only the simple key (including range objects)
// is returned and no type information is returned (the partition must make sure
// that only values of comparable type are used as value keys for each
// partition).
// It is assumed this function is used during match update (as opposed to
// 'getKeys()') and therefore returns the current value, as stored in the
// indexer, ignoring any previous value still stored until the end of the
// update.

CompValueQueryCalc.prototype.getProjKey = 
    compValueQueryCalcGetProjKey;

function compValueQueryCalcGetProjKey(elementId)
{
    var key = this.pathNode.nodes.get(elementId);
    return key === undefined ? undefined : key.key;
}

// Given the element ID of node at the projection path 'this.pathId',
// this function returns the 'known' key of the node at path 'this.pathId'
// with the given ID (the 'known' key is the key which is currently
// known outside the indexer, that is, before any changes whose notification
// is still pending, specifically, for removed elements, this is the previous
// key, before the removal). Only the simple key (including range objects)
// is returned and no type information is returned (the partition must make sure
// that only values of comparable type are used as value keys for each
// partition).
// This function may be used during match removal update.

CompValueQueryCalc.prototype.getKnownKey = 
    compValueQueryCalcGetKnownKey;

function compValueQueryCalcGetKnownKey(elementId)
{
    var key = this.indexer.getKnownKey(this.pathNode, elementId);
    return key === undefined ? undefined : key.key;
}
