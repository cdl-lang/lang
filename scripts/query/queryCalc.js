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


"use strict";

// This file defines the base class for the query calculation nodes.
// This contains mainly the query calculation node interface and handling
// of some common administrative tasks.
// This file also contains some general documentation of the query calculation
// nodes.

//

///////////////
// Unique ID //
///////////////

// Every query calculation node must have a unique ID. These IDs are
// allocated here.

////////////////
// Interfaces //
////////////////

// A query calculation node must support the following interface:
//
// QueryCalc.getId():
//    Returns the unique ID of this node.
//
// QueryCalc.assignRoot(<root query calculation>):
//    This function assigns the given root query calculation node to this
//    query calcualtion node. Since at most one root node may be assigned
//    to a query calculation node, this function detaches any root
//    query calculation node previously associated with this query calculation
//    node.
//
// QueryCalc.isRoot():
//    returns true if a root query calculation node is associated with this
//    query calculation node and otherwise false.
//
// QueryCalc.addSubNode(<query calculation node>): adds the given
//    query calculation node as a sub-node of 'this' query calculation node.
// QueryCalc.removeSubNode(<query calc ID>): removes the sub-node 
//    with the given query calculation ID from the list of sub-nodes of 
//    this node.
// QueryCalc.destroy(): destroys this query calculation object.
//
// The following functions should be implemented by the derived class:
// 
// QueryCalc.refreshQuery(): this is a function which should
//    be defined in the derived class and implements the processing of
//    the update of the values of the QueryCalc node. This function is 
//    called when the update process is initiated by the root query calculation
//    node.
//

//
// Structure of the (base class) object:
//
// {
//     id: <unique ID>
//     rootQueryCalc: <root query calculation node>
//
//     parent: <dominating QueryCalc>  // optional
//     matchParent: <query calculation root query calculation node>
//     subNodes: {
//         <QueryCalc ID>: <QueryCalc>
//         .......
//     },
//     subNodeNum: <number of nodes in the subNodes list>
//
//     updatedSubNodes: {
//          <QueryCalc ID>: true|false
//          ......
//     }
// }
//
// id: the unique ID assigned to this node. This is a number, but it may
//     be converted into a string when used as the attribute in a table.
// rootQueryCalc: this is the root query calculation node to which this
//     query calculation node belongs. This is set at construction and
//     never changes.
// parent: if this node is a sub-node of another QueryCalc node, then the
//     attribute parent points at that parent QueryCalc node. The value is
//     undefined if there is no such parent. This attribute is maintained
//     by the base class (QueryCalc).
// matchParent: if this node has a parent query calculation node (this.parent)
//     then mathParent is equal to that parent. Otherwise, matchParent
//     is equal to the root query calculation node. The match parent must
//     always be defined. 
// subNodes: this table stores the query calculation nodes which are sub-nodes
//     of this node. Each node is stored under its ID. This table does not
//     exist if this node does not have any sub-nodes.
//     This table is maintained by the base class (QueryCalc).
// subNodeNum: the number of nodes in the subNodes table. This may be undefined
//     if the table does not exist.
// updateSubNodes: this is a list of all sub-nodes of this node which
//     are new, were modified, or themselves have a non-empty
//     'updatedSubNodes' table. The value is 'true' if the sub-node is
//     new and false otherwise. This is exactly the list of nodes to
//     which a query refresh needs to be applied. Under the assumption
//     that the query tree structure is seldom deep but may be broad,
//     this optimizes the number of nodes which needs to be traversed
//     in a refresh step.

// Derived Classes:
//
// A derived class may optionally defined the functions 
// 'clearSubNode(<sub node>)' and 'clearParent()' which are called on 
// a query calculation node when the given sub-node is removed from
// under it or when it is detached from its parent. These functions
// should handle removal and detaching operations on the query calculation
// nodes. 
// The queryRefresh() function is responsible for refreshing the query
// calculation tree after new nodes were created, new sub-nodes were
// added to existing nodes and selection values were modified on existing
// terminal nodes.
// 

//
// Constructor
//

function QueryCalc(rootQueryCalc)
{
    this.id = InternalQCM.newId();
    this.rootQueryCalc = rootQueryCalc;
}

QueryCalc.prototype.destroy = queryCalcDestroy;

function queryCalcDestroy()
{
	this.destroyed = true;

	// break the child/parent relations
	if(this.parent)
		this.parent.removeSubNode(this.id);
	for(var id in this.subNodes)
        this.subNodes[id].detachFromParent();

    if(this.rootQueryCalc && this.matchParent == this.rootQueryCalc) 
        // This is the top query calculation node, detach the root query 
        // calculation node form this node
        this.rootQueryCalc.detachFromQueryCalc();
}

// return the ID of this node

QueryCalc.prototype.getId = queryCalcGetId;

function queryCalcGetId()
{
    return this.id;
}

// Assign this as the top query calculation node.

QueryCalc.prototype.assignAsRoot = queryCalcAssignAsRoot;

function queryCalcAssignAsRoot()
{
    if(this.matchParent == this.rootQueryCalc)
        return; // already assigned as root

	if(this.parent) {
		this.parent.removeSubNode(this.id);
        this.detachFromParent();
	}
    this.matchParent = this.rootQueryCalc;
    this.rootQueryCalc.assignQueryCalc(this);
}

// This function removes the root query calculation node as the match parent
// of this node.

QueryCalc.prototype.removeTheRoot = queryCalcRemoveTheRoot;

function queryCalcRemoveTheRoot()
{
    if(this.matchParent == this.rootQueryCalc)
		delete this.matchParent;
}

// returns true iff this is the root of the query structure.

QueryCalc.prototype.isRoot = queryCalcIsRoot;

function queryCalcIsRoot()
{
    return (this.matchParent == this.rootQueryCalc);
}

///////////////////////////////
// Adding/Removing Sub-nodes //
///////////////////////////////

// This function adds the given query calculation node as a sub node
// of this node. If the given node is already a sub-node of this node,
// nothing changes (this is checked through the ID of the node).

QueryCalc.prototype.addSubNode = queryCalcAddSubNode;

function queryCalcAddSubNode(queryCalc)
{
	if(!queryCalc)
		return;

	var id = queryCalc.getId();

	if(!this.subNodes) {
		this.subNodes = {};
		this.subNodeNum = 0;
	} else if(id in this.subNodes)
		return; // nothing to do

	this.subNodeNum++;
	this.subNodes[id] = queryCalc;

	if(queryCalc.parent && queryCalc.parent != this)
		// remove from previous parent
		queryCalc.parent.removeSubNode(id);
	queryCalc.parent = this;
    queryCalc.matchParent = this;

	// record this node as updated
	this.addUpdatedSubNode(id, true);	
}

// This function removes the query calculation node with the given ID
// from the list of sub-nodes of 'this' node. The sub-node is
// not destroyed (it may be used elsewhere).

QueryCalc.prototype.removeSubNode = queryCalcRemoveSubNode;

function queryCalcRemoveSubNode(queryCalcId)
{
	if(!this.subNodes || !(queryCalcId in this.subNodes))
        return;

	var queryCalc = this.subNodes[queryCalcId];

	delete this.subNodes[queryCalcId];
	this.subNodeNum--;

    var isNewUpdate = false;
    
	if(this.updatedSubNodes && (queryCalcId in this.updatedSubNodes)) {
        var isNewUpdate = this.updatedSubNodes[queryCalcId];
		delete this.updatedSubNodes[queryCalcId];
	}

    if(!isNewUpdate) {
		// specific derived node clean-up
		if(this.clearSubNode)
			this.clearSubNode(queryCalc);
	}
    // otherwise removing a sub-node which is new, no need for cleanup

	if(queryCalc.parent == this)
		delete queryCalc.parent;
}

// Add the sub-node with the given ID to the list of sub-nodes which
// are new or were updated (or have a sub-node which was updated).
// This recursively updates all nodes above this node.
// 'isNew' should be true if this is a new sub-node just added to this node.
// Otherwise, 'isNew' should be false.
// 

QueryCalc.prototype.addUpdatedSubNode = queryCalcAddUpdatedSubNode;

function queryCalcAddUpdatedSubNode(id, isNew)

{
	if(!this.updatedSubNodes)
		this.updatedSubNodes = {};
	if(!this.updatedSubNodes[id])
		this.updatedSubNodes[id] = !!isNew;
	if(this.parent)
		this.parent.addUpdatedSubNode(this.id);
}

// This function detaches this node from its parent node.

QueryCalc.prototype.detachFromParent = queryCalcDetachFromParent;

function queryCalcDetachFromParent()
{
    if(!this.parent)
        return; // no parent

    this.parent = undefined;
    this.matchParent = undefined;

    if(this.clearParent)
        this.clearParent();
}

//////////////////////
// Query Properties //
//////////////////////

// This function returns true if this query calculation node, which is 
// assumed to be a generating projection, is also a terminal generating
// projection. This is true for all query calculation nodes except for
// intersection (which may be generating but not terminal). The intersection
// query calculation node must override this function.

QueryCalc.prototype.isGeneratingProjectionTerminal = 
	queryCalcIsGeneratingProjectionTerminal;

function queryCalcIsGeneratingProjectionTerminal()
{
    return true;
}
