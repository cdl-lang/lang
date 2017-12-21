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


// This is a derived class of QueryCalc which matches a set of data
// element IDs which are set externally on it. It is possible to add
// are remove matched data element IDs. This query calculation node
// cannot (and does not) control in any way the validity of these data
// element IDs. All it does is implement the required QueryCalc interface
// so that these data element IDs could be treated as if they are the result
// of a selection query (and it is up to the function which updates the
// list of IDs to make sure that these IDs are valid data element IDs
// at the path and indexer at which this QueryCalc is defined).

// Since this is a terminal query calculation node and it does not make
// use of any indexer, this class only needs to implement the interface
// to the root query calculation node and to the query compilation
// object (which, in this case, is very simple). To update the list
// of data element IDs which are matched by this query calculation node,
// the query object simply calls the update functions (similar to the
// simple query calculation node):
//
// addDataElements(<array of data element IDs>)
// removeDataElements(<array of data element IDs>)
//
// Adding or removing data element IDs does not immediately update the
// root query calculation node with the new matches. Instead, the
// changes are queued and only pushed to the root query calculation
// node when the function refreshQuery() is called.

// %%include%%: "internalQueryCalc.js"

inherit(IdQueryCalc, InternalQueryCalc);

//
// Constructor
//

// The constructor must be given the root query calculation node
// (an InternalRootQueryCalc object) to which this query calculation node
// belongs. In addition, an optional list of initial matching data
// element IDs may be given as an array of numbers in 'elementIds'.

function IdQueryCalc(rootQueryCalc, elementIds)
{
    // call base constructor
	this.InternalQueryCalc(rootQueryCalc);

    this.pathId = rootQueryCalc.prefixProjPathId;

    // IDs defining the query which are in the indexer
    this.matches = new Map();
    // IDs defining the query which are not in the indexer
    this.otherQueryIds = new Map();

    this.updateQueue = [];

    this.indexer.addQueryCalcToPathNode(this);
    
    if(elementIds)
        this.addDataElements(elementIds);
}

// Detach from indexer and destroy

IdQueryCalc.prototype.destroy = idQueryCalcDestroy;

function idQueryCalcDestroy()
{
    this.detachFromIndexer();
    this.InternalQueryCalc_destroy();
}

// The isProjection() function is used by objects looking at the query
// from 'outside' such as the root query calculation node and the function
// result nodes. For them, this is always a selection. Compare this to the
// function 'isSelection()' below, which is used by the indexer to which this
// query applies.

IdQueryCalc.prototype.isProjection = idQueryCalcIsProjection;

function idQueryCalcIsProjection()
{
	return false;
}

// The isSelection() function is used by the indexer to which this query
// is applied. For the indexer, this is not a selection, since the selection
// does not take place in the sub-indexes of the indexer, but in
// the IdQueryCalc node itself.

IdQueryCalc.prototype.isSelection = idQueryCalcIsSelection;

function idQueryCalcIsSelection()
{
	return false;
}

//
// Query Update and Refresh
//

// This function is called to add data elements ID which should be matched
// by this query calculation node. All this function does is store this
// array for later processing.

IdQueryCalc.prototype.addDataElements = idQueryCalcAddDataElements;

function idQueryCalcAddDataElements(elementIds)
{
    this.updateQueue.push({ elementIds: elementIds, add: true });
}

// This function is called to remove data elements ID which should be matched
// by this query calculation node. All this function does is store this
// array for later processing.

IdQueryCalc.prototype.removeDataElements = idQueryCalcRemoveDataElements;

function idQueryCalcRemoveDataElements(elementIds)
{
    this.updateQueue.push({ elementIds: elementIds, add: false });
}

// This function is called when it is time to refresh the query. It processes
// the data elements added or removed which are currently queued in
// the 'updateQueue' queue. It calculates the difference between this list
// and the existing list and sends an add/remove matches update to its
// parent.

IdQueryCalc.prototype.refreshQuery = idQueryCalcRefreshQuery;

function idQueryCalcRefreshQuery()
{
    if(this.updateQueue.length == 0)
        return; // no updates

    if(this.updateQueue.length == 1) {
        var update = this.updateQueue[0];
        this.updateQueue = [];
        this.refreshQueryAfterSingleUpdate(update);
        return;
    }
    
    var added = new Map();
    var removed = new Map();
    var hasPendingAdded = this.indexer.pathHasAdditionsPending(this.pathId,
                                                               this.id);
    
    for(var i = 0, l = this.updateQueue.length ; i < l ; ++i) {

        var update = this.updateQueue[i];

        if(update.add) {
            // filter the added IDs against the indexer
            var filtered = 
                this.indexer.filterDataNodesAtPathWithDiff(this.pathId,
                                                           update.elementIds,
                                                           !hasPendingAdded,
                                                           false);
                
            for(var j = 0, m = filtered.matches.length ; j < m ; ++j) {
                var elementId = filtered.matches[j];
                if(this.matches.has(elementId))
                    continue;
                this.matches.set(elementId, 1);
                if(removed.has(elementId))
                    removed.delete(elementId);
                else
                    added.set(elementId, true);
            }

            for(var j = 0, m = filtered.removed.length ; j < m ; ++j) {
                var elementId = filtered.removed[j];
                if(!this.otherQueryIds.has(elementId))
                    this.otherQueryIds.set(elementId, true);
            }
            
        } else {
            for(var j = 0, m = update.elementIds.length ; j < m ; ++j) {
                var elementId = update.elementIds[j];

                if(this.otherQueryIds.has(elementId)) {
                    this.otherQueryIds.delete(elementId);
                    continue;
                }
                
                if(!this.matches.has(elementId))
                    continue;
                this.matches.delete(elementId);
                if(added.has(elementId))
                    added.delete(elementId);
                else
                    removed.set(elementId, true);
            }
        }
    }

    this.updateQueue = [];

    if(!this.matchParent)
        return;

    if(added.size) {
        var addedMatches = [];
        added.forEach(function(t, elementId) {
            addedMatches.push(elementId);
        });

        if(this.matchParent)
            this.matchParent.addMatches(addedMatches, this);
    }

    if(removed.size) {
        var removedMatches = [];
        removed.forEach(function(t, elementId) {
            removedMatches.push(elementId);
        });

        if(this.matchParent)
            this.matchParent.removeMatches(removedMatches, this);
    }
}

// This is a more efficient implementation of refreshQuery() when the
// update queue contains a single update (which is the input to this function).

IdQueryCalc.prototype.refreshQueryAfterSingleUpdate =
    idQueryCalcRefreshQueryAfterSingleUpdate;

function idQueryCalcRefreshQueryAfterSingleUpdate(update)
{
    if(update.add) { // element IDs added
        var addedMatches = [];
        var hasPendingAdded = this.indexer.pathHasAdditionsPending(this.pathId,
                                                                   this.id);

        // filter the added IDs against the indexer
        var filtered = 
            this.indexer.filterDataNodesAtPathWithDiff(this.pathId,
                                                       update.elementIds,
                                                       !hasPendingAdded, false);
        for(var j = 0, m = filtered.matches.length ; j < m ; ++j) {
            
            var elementId = filtered.matches[j];
            if(this.matches.has(elementId))
                continue;
            this.matches.set(elementId, 1);
            addedMatches.push(elementId);
        }
        for(var j = 0, m = filtered.removed.length ; j < m ; ++j) {
            var elementId = filtered.removed[j];
            if(!this.otherQueryIds.has(elementId))
                this.otherQueryIds.set(elementId, true);
        }

        if(addedMatches.length == 0)
            return;

        if(this.matchParent)
            this.matchParent.addMatches(addedMatches, this);

        return;
    }

    // element IDs removed

    var removedMatches = [];
    
    for(var j = 0, m = update.elementIds.length ; j < m ; ++j) {
        var elementId = update.elementIds[j];
        if(this.matches.has(elementId)) {
            this.matches.delete(elementId);
            removedMatches.push(elementId);
        } else if(this.otherQueryIds.has(elementId))
            this.otherQueryIds.delete(elementId);
    }

    if(removedMatches.length == 0)
        return;

    if(this.matchParent)
        this.matchParent.removeMatches(removedMatches, this);
}

//////////////////////////
// Updates from Indexer //
//////////////////////////

// This function is called by the indexer to indicate that new element IDs
// were added to the path on which this query is registered. This function
// then only needs to check whether any elements IDs which define the query
// have been added to the path. Those which were become new matches.

IdQueryCalc.prototype.addMatches = idQueryCalcAddMatches;

function idQueryCalcAddMatches(elementIds, source)
{
    if(this.otherQueryIds.size == 0)
        return; // all element IDs defining the query were already on the path

    var otherQueryIds = [];
    this.otherQueryIds.forEach(function(c, elementId) {
        otherQueryIds.push(elementId);
    });
    
    var addedMatches = this.indexer.filterNodesJustBeingAdded(this.pathId,
                                                              otherQueryIds);

    if(addedMatches.length == 0)
        return;
    
    for(var i = 0, l = addedMatches.length ; i < l ; ++i) {
        var elementId = addedMatches[i];
        this.matches.set(elementId, 1);
        this.otherQueryIds.delete(elementId);
    }
    
    if(this.matchParent !== undefined)
        this.matchParent.addMatches(addedMatches, this);
}

// This function is called by the indexer to indicate that element IDs
// were removed from the path on which this query is registered. This function
// then only needs to check whether any element IDs which define the query
// have been added to the path. Those which were become new matches.

IdQueryCalc.prototype.removeMatches = idQueryCalcRemoveMatches;

function idQueryCalcRemoveMatches(elementIds, source)
{
    if(this.matches.size === 0)
        return;

    var matches = [];
    this.matches.forEach(function(c, elementId) {
        matches.push(elementId);
    });

    var removedMatches =
        this.indexer.filterNodesJustBeingRemoved(this.pathId, matches);
    
    if(removedMatches.length == 0)
        return;

    for(var i = 0, l = removedMatches.length ; i < l ; ++i) {
        var elementId = removedMatches[i];
        this.otherQueryIds.set(elementId, true);
        this.matches.delete(elementId);
    }

    if(this.matchParent !== undefined)
        this.matchParent.removeMatches(removedMatches, this);
}
