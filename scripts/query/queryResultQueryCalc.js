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


// This object is used by FuncResult nodes with a result indexer to
// receive match updates from the result indexer belonging to the
// FuncResult itself.
//
// When a result indexer is created by a FuncResult to store
// the result of FuncResult, queries composed with this FuncResult register
// themselves directly to the result indexer. But all other function
// result nodes composed with this FuncResult do not and continue
// to expect match updates from the FuncResult node. Therefore,
// the FuncResult node must register on its own result indexer
// to receive notifications of changes and forward them to the composed
// function results. The query calculation node defined here provides
// this link.
//
// This query calculation node is registered as a projection (isSelection()
// returns false) on the root path of the result indexer. This means
// that it receives updates every time nodes are added or removed
// from the root of the result indexer (these are exactly the nodes which
// represent the result of the query).

// Object structure
// ----------------
//
// {
//    id: <ID>
//    result: <FuncResult>
//    pathId: <root path ID>
// }
//
// id: ID assigned to this node (from the InternalQCM pool)
// result: the owner of this query calculation node. Match updates are
//    sent to this result node.
// pathId: this is always the root path. This is required by the query
//    calculation node interface.

//
// Constructor
//

// 'result' is the FuncResult node which is the owner of this node.

function QueryResultQueryCalc(result)
{
    this.id = InternalQCM.newId();
    this.result = result;
    this.pathId = result.qcm.getRootPathId();

    if(this.result.resultIndexer)
        this.result.resultIndexer.addQueryCalcToPathNode(this);
}

// This function is called when this node is no longer needed. The node
// must then deregister itself from the result indexer.

QueryResultQueryCalc.prototype.destroy = queryResultQueryCalcDestroy;

function queryResultQueryCalcDestroy()
{
    if(this.result.resultIndexer)
        this.result.resultIndexer.removeQueryCalcFromPathNode(this);
}

// Return the ID of this query calculation node

QueryResultQueryCalc.prototype.getId = queryResultQueryCalcGetId;

function queryResultQueryCalcGetId() 
{
    return this.id;
}

// This function returns always false (this behaves like a projection)

QueryResultQueryCalc.prototype.isSelection = queryResultQueryCalcIsSelection;

function queryResultQueryCalcIsSelection()
{
    return false;
}

// This function receives a list of data element IDs which were added at
// the root of the result indexer and forwards them to the result node,
// which forwards them on to composed functions (which are not queries).

QueryResultQueryCalc.prototype.addMatches = queryResultQueryCalcAddMatches;

function queryResultQueryCalcAddMatches(matches)
{
    this.result.forwardResultIndexerAddMatches(matches);
}

// This function receives a list of data element IDs which were removed from
// the root of the result indexer and forwards their removal to the result node,
// which forwards the removal on to composed functions which are not queries.

QueryResultQueryCalc.prototype.removeMatches =
    queryResultQueryCalcRemoveMatches;

function queryResultQueryCalcRemoveMatches(matches)
{
    this.result.forwardResultIndexerRemoveMatches(matches);
}

// This function is called when the result indexer is cleared
// (possibly about to be destroyed). This function then gets all
// existing matches from the result indexer (these matches were not
// yet removed) and removes them using the standard 'removeMatches()'
// function.

QueryResultQueryCalc.prototype.removeAllIndexerMatches =
    queryResultQueryCalcRemoveAllIndexerMatches;

function queryResultQueryCalcRemoveAllIndexerMatches()
{
    var matches = this.result.resultIndexer.getAllMatches(this.pathId);
    this.removeMatches(matches);
}

