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


// This is a special FuncResult node to be used by PartitionCompCalc
// node. The PartitionCompResult node should not be used by external
// modules which would like to add a comparison function into the
// function result chain.

// This is a function result node (derived class of FuncResult) which
// creates a function result chain in which the queries of a partition
// comparison function can be applied. This node is owned by a
// PartitionCompCalc node which implements the partition comparison
// function. The PartitionCompResult object defined here
// receives from its owner InternalQueryResult nodes which implement
// the queries defining the partition. These query result nodes are
// not yet part of any result function chain and therefore do not calculate
// any query. This object then provides these query result nodes with
// a data object (a DataResult object representing the data being
// compared) and registers itself on the query result objects as
// a composed function result. In this way, it receives the query updates
// and can pass them on to the PartitionCompCalc node which uses these
// matches to calculate the comparison function.

//
// Object Structure
//

// The following fields are defined here, in addition to the base class
// fields:
//
// {
//     compCalc: <PartitionCompCalc>
//     argNumByResultId: <Map>{
//         <query result ID>: <argument number>
//         ....
//     }
//     dataResult: <DataResult>
//
//     activationPending: true|false
// }
//
// compCalc: this is the PartitionCompCalc node which owns this object,
//     registers the query result nodes to it and receives match
//     updates from it.
// argNumByResultId: this tabel stores the argument number (position in
//     the 'dataObjs' table) of each query result node registered to this
//     object.
// dataResult: this field stores a DataResult object which provides
//     access to the data at the indexer and projection path
//     which define the data to which this comparison applies.
//     This data result object may be replaced if the indexer and
//     projection path of this comparison are changed.
//
// activationPending: this flag is set to true when the 'activated()'
//     function starts (to indicate to functions called in the activation
//     process that activation is in progress). This flag is reset at the
//     end of the activation process.

// %%include%%: "funcResult.js"

inherit(PartitionCompResult, FuncResult);

//
// Constructor
//

// The constructor takes as first argument the standard function result node
// constructor argument: the global internal QCM object used in the
// function result chains this object belongs to. It also receives the
// partition comparison calcultion node which owns it, 'compCalc'.
// In addtion, it may optionally receive the indexer and path in that
// indexer which define the data to which this comparison applies. If
// these are not provided here, they may be provided later.

function PartitionCompResult(internalQCM, compCalc, indexer, prefixProjPathId)
{
    this.FuncResult(internalQCM);
    
    // array to hold the query result nodes which are the data objects of
    // this node
    this.dataObjs = [];

    // initialize fields
    this.compCalc = compCalc;
    this.argNumByResultId = new Map();
    this.dataResult = undefined;

    this.activationPending = false;
    
    // create the data result object
    this.setDataResult(indexer, prefixProjPathId);
}

// Destructor: this function destroys the data result node and removes
// the query result nodes from the function result chain in created for
// them, but does not destroy the query result nodes (they are owned
// by the PartitionCompCalc node).

PartitionCompResult.prototype.destroy = partitionCompResultDestroy;

function partitionCompResultDestroy()
{
    if(this.dataObjs !== undefined) {
    
        // remove this object as composed with the query result nodes
        // and then remove the data result object as data of these
        // query result nodes

        for(var i = 0, l = this.dataObjs.length ; i < l ; ++i) {
            if(!this.dataObjs[i])
                continue;
            
            var dataObj = this.dataObjs[i];
            this.setData(undefined, i);
            dataObj.setData(undefined);
        }
    }
    
    if(this.dataResult !== undefined)
        this.dataResult.destroy();

    this.FuncResult_destroy();
}

// This function sets the data result object for the data which this object
// compares based on the given indexer and projection path. After checking
// whether the indexer and path have changed (if not, there is nothing
// to do) the data result object is created (it may be undefined if
// either the indexer or the path is undefined) and replaces the old
// data result with the new one as the data to which the query result nodes
// are applied. The old data result object (if any) is then destroyed.

PartitionCompResult.prototype.setDataResult = partitionCompResultSetDataResult;

function partitionCompResultSetDataResult(indexer, prefixProjPathId)
{
    var newDataResult;

    // check whether there is need to replace the data result object and,
    // if yes, create the new data result.
    if(indexer === undefined || prefixProjPathId === undefined) {
        if(this.dataResult === undefined)
            return; // nothing to do
        newDataResult = undefined;
    } else {
        if(this.dataResult !== undefined &&
           indexer == this.dataResult.getDominatedIndexer() &&
           prefixProjPathId == this.dataResult.getDominatedProjPathId())
            return; // nothing changed

        newDataResult =
            new DataResult(this.qcm, indexer, prefixProjPathId, undefined,
                           false);
    }

    // set the new data result as the data of the query result nodes
    for(var i = 0, l = this.dataObjs.length ; i < l ; ++i) {
        if(this.dataObjs[i])
            this.dataObjs[i].setData(newDataResult);
    }

    if(this.dataResult !== undefined)
        this.dataResult.destroy();

    this.dataResult = newDataResult;
}

// This function adds the given query result object to the set of query result
// objects which are inserted into the function result chain implemented
// by this object (with the query result object inserted into a chain
// between 'this.dataResult' and 'this'). The function first checks whether
// the query result node is already registered (if it is, the function
// simply returns). If the query result is not yet registered, its argument
// number is determined (the next position in the argument array) and
// it is added as composed with 'this.dataResult' and then added as a
// data object of 'this' object (with the chosen argument number).

PartitionCompResult.prototype.addQueryResult =
    partitionCompResultAddQueryResult;

function partitionCompResultAddQueryResult(queryResult)
{
    if(this.argNumByResultId.has(queryResult.getId()))
        return; // already added

    var argNum = this.dataObjs.length;
    this.argNumByResultId.set(queryResult.getId(), argNum);

    this.setData(queryResult, argNum);

    // set the data (a match update may be received by 'this' object
    // fro inside this called).
    if(this.dataResult !== undefined)
        queryResult.setData(this.dataResult);
}

// This function removes the given query result object from the set of
// query result objects which are inserted into the function result chain
// implemented by this object (with the query result object inserted into
// a chain between 'this.dataResult' and 'this'). After this object is removed
// as being composed with the given query result and the query result is
// removed as being composed with 'this.dataResult', this query result
// object is removed from the this.dataObjs list of this result node and
// the dataObjs list is shortened by 1 (by transferring the last argument
// in the list to the position just vacated).

PartitionCompResult.prototype.removeQueryResult =
    partitionCompResultRemoveQueryResult;

function partitionCompResultRemoveQueryResult(queryResult)
{
    var resultId = queryResult.getId();
    
    if(!this.argNumByResultId.has(resultId))
        return; // not inserted into this function chain.
    
    var argNum = this.argNumByResultId.get(resultId);
    var lastArg = this.dataObjs.length - 1;

    this.setData(undefined, argNum);
    queryResult.setData(undefined);
    
    if(argNum != lastArg) {
        this.dataObjs[argNum] = this.dataObjs[lastArg];
        this.argNumByResultId.set(this.dataObjs[argNum].getId(), argNum);
    }
    this.dataObjs.length--;

    this.argNumByResultId.delete(resultId);
}

// This object does not support multiple projections in any of the
// query results registered into its result chain (a multi-projection will
// therefore generate a result indexer in the query result).

PartitionCompResult.prototype.supportsMultiProj =
    partitionCompResultSupportsMultiProj;

function partitionCompResultSupportsMultiProj()
{
    return false;
}

// This object is active iff its owner is active

PartitionCompResult.prototype.isActive =
    partitionCompResultIsActive;

function partitionCompResultIsActive()
{
    return this.compCalc.isActive();
}

// Most of the activation is handled by the base class, but here we also
// set a flag which indicates to functions called in the activation process
// that the activation is still in progress.

PartitionCompResult.prototype.activated = partitionCompResultActivated;

function partitionCompResultActivated()
{
    this.activationPending = true;
    this.FuncResult_activated();
    this.activationPending = false;
}

// The deactivation function simply calls the base class implementation of
// this function.

PartitionCompResult.prototype.deactivated = partitionCompResultDeactivated;

function partitionCompResultDeactivated()
{
    this.FuncResult_deactivated();
}

// This function is called when the dominated indexer and path of the
// query result node 'dataObj' have been refreshed. Since this will only
// be called if the indexer and/or path have actually changed,
// this function needs to remove all current matches due to this query
// (the new matches will be received later). In case the projected keys
// are required for the comparison, these keys must also be fetched.
// As this is the responsibility of the owner object, this call is
// forwarded to the owner.

// Remark: since currently a new CompCalc object is created when the
// indexer or path change (but not when they are replaced by an equivalent
// indexer and path) and since the PartitionCompResult object belongs to
// a single CompCalc and gets its dominated indexer and path from it,
// the function below is only called upon activation and is never used
// to replace one indexer by another.

PartitionCompResult.prototype.refreshIndexerAndPaths =
    partitionCompResultRefreshIndexerAndPaths;

function partitionCompResultRefreshIndexerAndPaths(dataObj)
{
    if(dataObj === undefined)
        return; // query removed (by the 'compCalc' object, so is cleared there)

    if(!this.activationPending)
        // was already active, so all existing matches must be removed
        this.compCalc.removeAllMatches(dataObj);
    this.compCalc.refreshProjectedKeyPath(dataObj);
}

// This function is called when the indexer and path of the query result
// 'dataObj' have changed in such a way that the new indexer and path
// point at the same data as before the change (this happens, for example,
// when a result indexer is created for the query result node). This function
// will probably never be called here, but when it is called, the only effect
// this change has is on the fetching of the projected keys, in case these keys
// are required for the comparison. As this is the responsibility of the
// owner object, this call is forwarded to the owner. 

PartitionCompResult.prototype.replaceIndexerAndPaths =
    partitionCompResultReplaceIndexerAndPaths;

function partitionCompResultReplaceIndexerAndPaths(prevPrefixPathId,
                                                   prefixPathId,
                                                   newIndexerContained, dataObj)
{
    this.compCalc.refreshProjectedKeyPath(dataObj);
}

// This function is called just before a new query result is set as a
// data object of this object. It allows this object to prepare itself
// for this operation. Since such an addition of a query result was
// performed by 'this' object itself, there is nothing to do here.

PartitionCompResult.prototype.aboutToSetData =
    partitionCompResultAboutToSetData;

function partitionCompResultAboutToSetData(newDataObj, argNum)
{
    return;
}

// This function is called when a new (possibly empty) query result
// node is set as argument 'argNum'. Since this function is triggered
// by an operation which takes place inside 'this' object, we ignore
// it here and handle this updated where it was triggered.

PartitionCompResult.prototype.removeDataObjMatches =
    partitionCompResultRemoveDataObjMatches;

function partitionCompResultRemoveDataObjMatches(oldDataObj,
                                                 indexerOrPathChanged, argNum)
{
    return;
}

// This function is called when a new query result node is set as argument
// 'argNum'. Since this function is triggered by an operation which takes
// place inside 'this' object, we ignore it here and handle this updated
// where it was triggered.

PartitionCompResult.prototype.addDataObjMatches =
    partitionCompResultAddDataObjMatches;

function partitionCompResultAddDataObjMatches(oldDataObj, indexerOrPathChanged,
                                              argNum)
{
    return;
}

// This function simply forwards the matches to its own CompCalc object 

PartitionCompResult.prototype.addMatches =
    partitionCompResultAddMatches;

function partitionCompResultAddMatches(elementIds, source)
{
    this.compCalc.addMatches(elementIds, source);
}

// This function simply forwards the matches to its own CompCalc object 

PartitionCompResult.prototype.removeMatches =
    partitionCompResultRemoveMatches;

function partitionCompResultRemoveMatches(elementIds, source)
{
    this.compCalc.removeMatches(elementIds, source);
}

// This function simply forwards the request to its own CompCalc object 

PartitionCompResult.prototype.removeAllMatches =
    partitionCompResultRemoveAllMatches;

function partitionCompResultRemoveAllMatches(source)
{
    this.compCalc.removeAllMatches(source);
}

// This function simply forwards the matches to its own CompCalc object 

PartitionCompResult.prototype.addProjMatches =
    partitionCompResultAddProjMatches;

function partitionCompResultAddProjMatches(elementIds, resultId, projId)
{
    this.addProjMatches(elementIds, resultId, projId)
}

// This function simply forwards the matches to its own CompCalc object 

PartitionCompResult.prototype.removeProjMatches =
    partitionCompResultRemoveProjMatches;

function partitionCompResultRemoveProjMatches(elementIds, resultId, projId)
{
    this.removeProjMatches(elementIds, resultId, projId)
}
