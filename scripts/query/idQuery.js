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


// This is a variant of the Query object which allows a query to be
// constructed not based on a query description but on an explicit set
// of data element IDs. These data element IDs are the selection
// applied by this query. This query can be used in teh same way as
// a standard query but it is the responsibility of the module
// which updates the data element IDs matched by this query to make sure
// that the list of data element IDs is valid for the place where the
// query is applied.

// Data elements may be dynamically added or removed from the list of
// matched data element IDs.

// %%include%%: "idQueryCalc.js"

//
// Constructor
//

function IdQuery(internalQCM)
{
    // allocate ID from the same pool as other queries
    this.id = InternalQCM.newId();
    this.rootQueryCalcs = {};
    this.numRootQueryCalcs = 0;

    // list of data element IDs which should match
    this.matches = new Map();
}

// This function should be called when the IdQuery is no longer needed.
// If there are still root query calculation nodes registered to this
// query object, the query object cannot be destroyed. Instead, the
// destruction is suspended until the last root query calculation node
// is removed.

IdQuery.prototype.destroy = idQueryDestroy;

function idQueryDestroy()
{
    if(this.numRootQueryCalcs) {
        // cannot destroy yet, must wait until all root query calculation
        // nodes are removed.
        this.pendingDestroy = true;
        return;
    }

    // currently, the destroy function does not do anything
}

// Return the ID of this query object (unique among all queries).

IdQuery.prototype.getId = idQueryGetId;

function idQueryGetId()
{
    return this.id;
}

// The IdQuery is not a real query, since it does not need to compile itself
// from a description. Therefore, it is not a function result and does not
// require the isActive() function as part of the function result interface.
// However, the query result nodes sometimes need to know whether the query
// is already active (or needs to be activated). In this case, the ID query
// is always considered to be active.

IdQuery.prototype.isActive = idQueryIsActive;

function idQueryIsActive()
{
    return true;
}

// This function does nothing, since an IdQuery is always active.
// This function is only needed for the interface common with Query.

IdQuery.prototype.lockActive = idQueryLockActive;

function idQueryLockActive()
{
    return;
}

// This function does nothing, since an IdQuery is always active.
// This function is only needed for the interface common with Query.

IdQuery.prototype.unlockActive = idQueryUnlockActive;

function idQueryUnlockActive(lockName)
{
    return;
}

// This function returns false, because an ID query is always a selection

IdQuery.prototype.isProjection = idQueryIsProjection;

function idQueryIsProjection()
{
    return false;
}

// This function returns false, because an ID query is always a selection

IdQuery.prototype.isPureProjection = idQueryIsPureProjection;

function idQueryIsPureProjection()
{
    return false;
}

// Because different types of query objects may potentially exist,
// each with its own root query calculation class, it
// is up to the Query object to allocate the correct type of object.

IdQuery.prototype.newRootQueryCalc = idQueryNewRootQueryCalc;

function idQueryNewRootQueryCalc(indexer, prefixProjPathId, key) 
{
    return new InternalRootQueryCalc(this, indexer, prefixProjPathId, key);
}

// This function allows for a new root query calculation node to be
// registered to this query. This node is then added to the list of
// root query calculation nodes.

IdQuery.prototype.addRootQueryCalcNode = idQueryAddNewRootQueryCalcNode;

function idQueryAddNewRootQueryCalcNode(rootQueryCalc)
{
    // The node is stored under its ID.
    var rootId = rootQueryCalc.getId();
    
    if(this.rootQueryCalcs[rootId])
        return; // already registered

    this.rootQueryCalcs[rootId] = rootQueryCalc;
    this.numRootQueryCalcs++;

    // create an IdQueryCalc node and set it as the root query calculation
    var queryCalc = new IdQueryCalc(rootQueryCalc);
    queryCalc.assignAsRoot();

    // set the data elements which should be matched by this root query
    // calculation node
    if(this.matches.size > 0) {
        var matches = [];
        this.matches.forEach(function(t, elementId) {
            matches.push(elementId);
        });
        
        queryCalc.addDataElements(matches);
    }
    
    rootQueryCalc.refreshQuery();
}

// This function removes a root query calculation node from this query.
// The removal is by ID, which should be the ID of the root query calculation
// node. This function removes this node from the 'rootQueryCalcs'
// table and destroys all the query calculation nodes generated for
// this root query calculation node.
// This function does not destroy the root query calculation node.

IdQuery.prototype.removeRootQueryCalcNode = idQueryRemoveNewRootQueryCalcNode;

function idQueryRemoveNewRootQueryCalcNode(rootId)
{
    if(!(rootId in this.rootQueryCalcs))
        return;

    var rootQueryCalc = this.rootQueryCalcs[rootId];
    var queryCalc = rootQueryCalc.queryCalc;
    queryCalc.destroy(); // also detaches it from the root query calc node
    
    delete this.rootQueryCalcs[rootId];
    // if this is the last root query calculation node and a destroy is
    // pending, this is the time to destroy the query
    if(!--this.numRootQueryCalcs) {
        if(this.pendingDestroy)
            this.destroy();
    }
}

// This function refreshes the query. It calls the refresh query of all
// root query calculation nodes stored in it.

IdQuery.prototype.refreshQuery = idQueryRefreshQuery;

function idQueryRefreshQuery()
{
    // refresh the query under each of the root query calculation nodes
    for(var rootId in this.rootQueryCalcs)
        this.rootQueryCalcs[rootId].refreshQuery();
}

// This function is called to add data elements ID which should be matched
// by this query. The actual update will only take place when refreshQuery()
// is called.

IdQuery.prototype.addDataElements = idQueryAddDataElements;

function idQueryAddDataElements(elementIds)
{
    if(elementIds.length == 0)
        return;
    
    // update the local match list
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(!this.matches.has(elementId))
            this.matches.set(elementId, 1);
    }
    
    // refresh the query under each of the root query calculation nodes
    for(var rootId in this.rootQueryCalcs) {
        var queryCalc = this.rootQueryCalcs[rootId].queryCalc;
        queryCalc.addDataElements(elementIds);
    }
}

// This function is called to remove data elements ID which should be matched
// by this query. The actual update will only take place when refreshQuery()
// is called.

IdQuery.prototype.removeDataElements = idQueryRemoveDataElements;

function idQueryRemoveDataElements(elementIds)
{
    if(elementIds.length == 0)
        return;

    // update the local match list
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(!this.matches.has(elementId))
            continue;
        this.matches.delete(elementId);
    }
    
    // refresh the query under each of the root query calculation nodes
    for(var rootId in this.rootQueryCalcs) {
        var queryCalc = this.rootQueryCalcs[rootId].queryCalc;
        queryCalc.removeDataElements(elementIds);
    }
}

