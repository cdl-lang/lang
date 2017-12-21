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


// This class implements a basic object for managing 'edges', that is,
// pairs of labels. The pairs of labels are not ordered (so regardless
// of the order of the two labels they refer to the same edge)
// but the two labels of each edge have a canonical order. The canonical
// orer of the labels of an edge is the orderin which they are first
// given (when the edge is first created). Each edge
// is assigned an ID.
//
// The edge can be looked up by using the two labels in either
// order. The result of such a lookup is the ID of the edge and
// whether the labels used in the lookup are the canonical order of
// the edge or the non-canonical order (the inverse order).  In
// addition, the edge can be looked up by its ID. This lookup provides
// the two labels defining the edge, in canonical order.
//
// One can also store an arbitrary object together with each edge.
// In fact, one can store two objects: one associated with the
// edge in canonical order and one asociated with the reverse order.
// These objects are only stored here. When an edge is removed,
// the pointer to these objects are lost, but the objects are not
// destroyed (this is the responsibility of the module which stores
// these objects here).
//
// Each edge has a reference count. When this reference count reaches
// zero, the edge is removed from the table.
//
// Object Structure
// ----------------
//
// {
//     edges: {
//         <label>: {
//            labels: {
//                 <label>: {
//                     id: <edge ID>,
//                     dir: <-1/+1>,
//                     prop: <any value>
//                 }
//                 .....
//            }
//            numLabels: <number of labels under 'labels'>
//         }
//         .....
//     }
//
//     edgesById: {
//         <edge ID>: {
//             labels: [<first label>, <second label>] // in canonical order
//             prop: <prop of canonical order>
//             revProp: <prop of reverse order>
//             refCount: <number>
//         }
//         .....
//     }
// }
//
// edges: this table stores the edges under their two labels. For every
//    edge there are two entries, one for each order of the labels.
//    Under each pair of labels, the following information is stored:
//      id: the ID of this pair (this is the same as for the reverse order
//          of labels.
//      dir: +1 if the order of the labels in the path leading to this
//          entry is the canonical order for this edge and -1 if
//          this is the reverse order of the labels.
//      prop: the optional object store by an external module for this
//         direction of the edge.
// edgesById: this is a table of the edges, indexed by their edge ID.
//    Each entry stores the following information:
//      labels: the two labels of the edge, in canonical order
//      prop: the optional property object stored by an exernal module
//         for the canonical order of the edge.
//      revProp: the optional property object stored by an exernal module
//         for the reverse order of the edge.
//      refCount: the reference count indicates the number of modules
//         which allocated. When this reference count reaches zero,
//         the edge is destroyed (adding it again will assign it a new ID).

//
// Constructor
//

function Edges()
{
    this.edges = {};
    this.edgesById = {};
}

/////////////////////
// Access to Edges //
/////////////////////

// This function returns the object describing the edge (label1,label2)
// in the edge table. The two labels can be given in any order.
// The object returned has the form:
// {
//    id: <the ID of this edge>,
//    dir: <+1 if the labels were given in the canonical order and -1 if
//          the labels were give in the reverse order>
//    prop: <the property object optionally stored here for this direction
//           of the edge>
// }
// If the edge does not exist, undefined is returned.

Edges.prototype.getEdge = edgesGetEdge;

function edgesGetEdge(label1, label2)
{
    var entry;
    if((label1 in this.edges) &&
       (label2 in (entry = this.edges[label1].labels)))
        return entry[label2]; // found entry

    return undefined;
}

// Return the ID of the edge with the two given labels as its end points.
// The order of the labels does not matter.
// If an edge with these labels is not found, undefined is returned.

Edges.prototype.getEdgeId = edgesGetEdgeId;

function edgesGetEdgeId(label1, label2)
{
    var entry = this.getEdge(label1, label2);

    return (entry === undefined ? undefined : entry.id);
}


// Get the two points (in canonical order) of the edge with the given ID.
// If no such edge exists, returns undefined. Otherwise, returns an array
// holding the two labels.

Edges.prototype.getEdgePoints = edgesGetEdgePoints;

function edgesGetEdgePoints(edgeId)
{
    if(!(edgeId in this.edgesById))
        return undefined;
    
    return this.edgesById[edgeId].labels;
}

// This function returns an array with the other labels of all edges whose
// first label is 'label'. If 'canonicalOrderOnly' is set, only edge
// where 'label' is the first label in the canonical order are considered.
// The function always returns an array (possibily empty).

Edges.prototype.edgeOtherEnd = edgesEdgeOtherEnd;

function edgesEdgeOtherEnd(label, canonicalOrderOnly)
{
    var otherEnd = [];

    if(!(label in this.edges))
        return otherEnd;

    var entry;
    
    for(var other in (entry = this.edges[label].labels)) {
        if(canonicalOrderOnly && entry[other].dir < 0)
            continue;
        otherEnd.push(other);
    }

    return otherEnd;
}

// This function returns the entries for all edges which have one end at
// the label 'label'. The object returned is the object stored under
// the 'labels' field of the relevant label in the 'edges' table and
// has the following form:
// {
//     <other label of edge>: {
//         id: <ID of the edge>,
//         dir: +1/-1
//         prop: <optional property object, if stored>
//     }
//     ......
// }

Edges.prototype.allLabelEdges = edgesAllLabelEdges;

function edgesAllLabelEdges(label)
{
    if(!(label in this.edges))
        return undefined;

    return this.edges[label].labels;
}

// given a label and an edge ID such the label is one of the ends of
// the edge, this function returns the other label in the same edge
// (if the edge is not defined or does not contain the given label,
// undefined is returned).

Edges.prototype.edgeOppositeEnd = edgesEdgeOppositeEnd;

function edgesEdgeOppositeEnd(label, edgeId)
{
    if(!(edgeId in this.edgesById))
        return undefined;

    var ends = this.edgesById[edgeId].labels;

    if(ends[0] == label)
        return ends[1];
    if(ends[1] == label)
        return ends[0];

    return undefined;
}

// Return the property ('prop') set for the canonical order of the edge
// given by 'edgeId'. This can return undefined in two case: if the edge
// is not known or if the edge has no property object defined.

Edges.prototype.getEdgePropById = edgesGetEdgePropById;

function edgesGetEdgePropById(edgeId)
{
    if(!(edgeId in this.edgesById))
        return undefined;

    return this.edgesById[edgeId].prop;
}

//////////////////
// Adding Edges //
//////////////////

// This function creates the edge (label1,label2) in the edge table and
// returns it. If the edge already exists, it returns the existing entry.
// If the edge does not yet exist and edgeId is not undefined, this
// pair ID is assigned to the new edge. If edgeId is undefined and 
// a new edge is created, it is assigned a new ID.
// If 'prop' and/or 'revProp' are not 'undefined', these values are set
// on the 'prop' field of [label1][label2] and [label2][label1] respectively.
// The values are not duplicated.
// These values are set (if they are not undefined) even if the entry
// already exists. However, if the value of prop and/or revProp is undefined
// this does not override an existing value.
// If a new edge is created, it is created with a reference count of zero.
// The module calling this function should allocate this edge if this
// is the first time it makes use of it (the edge may not be new in case
// it was already created for another module). To allocate the edge through
// this function, the flag 'allocate' should be set. It is also possible
// to allocate the edge by calling the function 'allocateEdge()'.

Edges.prototype.addEdge = edgesAddEdge;

function edgesAddEdge(label1, label2, edgeId, allocate, prop, revProp)
{
    var entry;
    var revEntry;
    
    if(!(label1 in this.edges) ||
       !(label2 in (entry = this.edges[label1]).labels)) {

        // create the edge

        var id = (edgeId === undefined) ? makePairId(label1, label2) : edgeId;
        
        if(!entry)
            entry = this.edges[label1] = { labels: {}, numLabels: 0 };
        if((revEntry = this.edges[label2]) === undefined)
            revEntry = this.edges[label2] = { labels: {}, numLabels: 0 };

        entry.numLabels++;
        entry = entry.labels[label2] = { id: id, dir: 1 };
        revEntry.numLabels++;
        revEntry = revEntry.labels[label1] = { id: id, dir: -1 };

        var idEntry = this.edgesById[id] = {
            labels: [label1,label2],
            refCount: allocate ? 1 : 0
        };

        if(prop !== undefined) {
            entry.prop = prop;
            idEntry.prop = prop;
        }
        if(revProp !== undefined) {
            revEntry.prop = revProp;
            idEntry.revProp = revProp;
        }
        
    } else {
        entry = entry.labels[label2];
        if(allocate)
            this.edgesById[entry.id].refCount++;
        if(prop !== undefined) {
            entry.prop = prop;
            this.edgesById[entry.id].prop = prop;
        }
        if(revProp !== undefined) {
            this.edges[label2].labels[label1].prop = revProp;
            this.edgesById[entry.id].revProp = revProp;
        }
    }
    
    return entry;
}

// This function allocates the edge with the given ID, which means that
// it increases its reference count by 1.
// Each odule making use of an edge should allocate it once and then
// release it once when it no longer makes use of it (edges whose reference
// count reaches zero are discarded).
// The function returns the new reference count (this is 1 if this is
// the first time the edge is allocated).

Edges.prototype.allocateEdge = edgesAllocateEdge;

function edgesAllocateEdge(edgeId)
{
    if(!(edgeId in this.edgesById))
        return undefined;
    
    return ++this.edgesById[edgeId].refCount;
}

// If the edge [label1][label2] exists, this sets the value given in 'prop'
// on the 'prop' property of edges[label1][label2].
// This will be done even if the value of 'prop' is undefined.

Edges.prototype.setEdgeProp = edgesSetEdgeProp;

function edgesSetEdgeProp(label1, label2, prop)
{
    var entry;
    if(!(label1 in this.edges) ||
       !(label2 in (entry = this.edges[label1].labels)))
        return;
    entry = entry[label2];
    entry.prop = prop;
    if(entry.dir == 1)
        this.edgesById[entry.id].prop = prop;
    else
        this.edgesById[entry.id].revProp = prop;
}

////////////////////
// Removing Edges //
////////////////////

// This function should be called by a module which previously allocated
// the edge with ID 'edgeId' when it no longer makes use of this edge.
// This will result in the reference count of the edge being decreased
// by 1. If, as a result, the reference count reaches 0, the edge is removed.
// The function returns 'true' if the reference count reached 0 and false
// otherwise.

Edges.prototype.releaseEdge = edgesReleaseEdge;

function edgesReleaseEdge(edgeId)
{
    if(!(edgeId in this.edgesById))
        return false;

    var entry = this.edgesById[edgeId];
    if(--entry.refCount > 0)
        return false;

    // remove the edge
    this.removeEdge(edgeId, entry);
    return true;
}

// This function is for the internal use of the Edges class and its
// derived classes. This function actually removes all entries created
// for the given edge ID. It does not check the reference count (or other
// conditions) to check whether this removal is allowed.
// 'edgeId' is the ID of the edge to be removed, and is required.
// 'edgeEntry' is the entry for that edge in the edgesById table.
// This should be provided by the calling function if already available.
// Otherwise, it will be looked-up by this function.

Edges.prototype.removeEdge = edgesRemoveEdge;

function edgesRemoveEdge(edgeId, edgeEntry)
{
    if(edgeEntry === undefined)
        edgeEntry = this.edgesById[edgeId];
    
    // remove the edge

    var labels = edgeEntry.labels;
        
    // remove the edge from the list of edges
    var entry = this.edges[labels[0]];
    delete entry.labels[labels[1]];
    if(--entry.numLabels == 0)
        delete this.edges[labels[0]];

    entry = this.edges[labels[1]];
    delete entry.labels[labels[0]];
    if(--entry.numLabels == 0)
        delete this.edges[labels[1]];
    
    delete this.edgesById[edgeId];
}

////////////////////////
// Pair ID Allocation //
////////////////////////

// Currently, this is a global function, for historic reasons.

// This function is used to assigned IDs to point pairs. This function
// does not really depend on its arguments. However, below there is 
// an alternative defintion of this function which creates a string 
// pair ID in which the two point labels of the pair can be identified.
// The alternative implementation results in slower run-time (because
// numeric keys are handled more quickly than string keys) but is 
// useful when debugging.  

var nextPointPairId = 1026;

// Only even IDs are assigned here. This is in order to make it easy to
// distinguish between IDs assigned to point pairs (in this file) and IDs
// assigned to shifted pairs in indexedPairs.js (because when the shift
// is trivial, we simply use the point pair ID, which means that the two
// types of IDs appear in the same contexts).

/*function makePairId(label1, label2)
{
    return (nextPointPairId+=2);
}*/

// uncomment this function to use string pair IDs representing the 
// pairs.

function makePairId(label1, label2)
{
    return label1 + ";" + label2;
}
