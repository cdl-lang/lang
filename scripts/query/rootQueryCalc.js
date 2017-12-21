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

// This file implements the RootQueryCalc class which provides the
// generic functionality of the root of the query calculation
// tree associated with a Query.
//
// Among the responsibilities of the root query calculation node is the 
// generation of new query calculation nodes.
//
// A root query calculation node is generated when a query result node
// is activated and needs to calculate the query. Several query result
// nodes which share the same query and are applied using the same query
// calculation module may share the same root query calculation node.
// The decision as whether to share the root query calc node is up to
// the implementation of the specific query calculation module and the
// associated result object.
//
// Every root query calculation node has a unique ID which distinguishes
// it from all other query calculation nodes (so that if two are 
// registered to the same query they could be distinguished).

// API:
//
// RootQueryCalc.getId(): this returns the ID of this root query calculation
//   node (allocated fro the InternalQCM pool).
//
// RootQueryCalc.refreshQuery(): this function is called by the query 
//   compilation object (to which this root query calculation node is
//   registered) every time the query is recompiled. The root query calculation
//   node then needs to refresh the query calculation nodes.
//   This function should be implemented by the derived class.
//
// Object Structure:
//
// {
//    id: <the ID of this root query calculation node>
// }
//
// id: a unique ID () for this node (allocated from the InternalQCM pool).

//
// Constructor
//

function RootQueryCalc()
{
	this.id = InternalQCM.newId();
}

// return the unique ID

RootQueryCalc.prototype.getId = rootQueryCalcGetId;

function rootQueryCalcGetId()
{
    return this.id;
}

