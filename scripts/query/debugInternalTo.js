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


// This file implements an object which generates a JS object or string
// representation of data based on the internal representation used by the 
// indexers (based on data elements and path IDs).
//
// The resulting structure is built of arrays (representing ordered sets), 
// javascript objects (representing a-v nodes) and terminal strings
// (representing all terminal values). Special class objects may also 
// be used. Currently, the following are used:
// 1. Object of class DebugNegationObj:
//    This object is simply an attribute value object storing the 
//    negated nodes as sub-nodes (each under the attribute which is 
//    its element ID). However, by constructing this object as 
//    an instance of DebugNegationObj, it is marked as a negation
//    object.  
// 2. Object of class DebugFuncAppObj:
//    This object is simply an attribute value object storing the 
//    function definition as an attribute-value structure (under the
//    attributes "f", "1", "2", "3", etc.). By constructing this object as 
//    an instance of DebugFuncAppObj, it is marked as a function application
//    object.  
// 3. Object of class DebugDefunObj:
//    This object is simply an attribute value object storing the 
//    function definition as an attribute-value structure (under the
//    attributes "f", "1", "2", "3", etc.). By constructing this object as 
//    an instance of DebugDefunObj, it is marked as a function application
//    object.  
// 4. Object of class DebugRangeObj:
//    This object is simply an attribute value object storing the 
//    nodes in the range as sub-nodes (each under the attribute which is 
//    its element ID). However, by constructing this object as 
//    an instance of DebugRangeObj, it is marked as a range
//    object.
//    This is used for ranges which are not active.
//
// This object must have access to the internal QCM in order to get 
// access to the path allocation table and possibly for other global services.
// The pointer to the internal QCM must be provided upon construction.
//
// The input data to this object is represented as a set of
// <data element ID, path ID, type, value> tuples.  Such tuples can be
// added and removed incrementally. These tuples must fulfill the following 
// conditions:
// 1. The path IDs must be allocated using the internl QCM's
//    interface for generating path IDs.
// 2. If the data consists of more than a single simple value, 
//    a data element table must be provided, which stores the same
//    information as the dataElements table of an indexer (see 
//    internalQCMIndexer.js for a description of this table).
//    This table does not have to be part of an indexer.
//    In addition, the root path of the data being added must be set.
//    This is the path of the root of the data relative to the 
//    root of the path structure represented by the data element table.
//    If this is not given, the root path is assumed.
// 3. All values added should be added using data element IDs appearing
//    in the data element table (and must be consistent with its structure).
//    The only exception here is the case where no data element table is
//    provided. In this case, the representation always consists of a single 
//    simple value.
// 4. The path IDs used when adding the values must be relative to the 
//    root path ID give.
// This object then constructs a JS object representation of this
// data and also converts it into a string. 
//
// The API for setting and modifying the data consists of the following
// functions:
//
//   setDataElementTable(<data element table>, <root path ID>):
//       If the data should consist of more than one simple value, 
//       this function should be called first to provide the data element
//       table which stores the data elements (and their structure information,
//       including sort values). If this table is not provided, the object
//       can only store a single simple value (see the addValue() function 
//       below). When a new data element table is set, the existing data
//       is cleared (as the relation between the existing data and the 
//       new data element table is costly to determine). Generally, one should
//       only call this function once (before the first value update).
//       The <root path ID> is the path (relative to the path structure in 
//       the data element table) where the root(s) of the data can be found.
//       If this is not given, it is assumed that the root is at root
//       of the data element structure.
//   addValue(<value>, <type>, <data element ID>, <path ID>): if there is 
///      no data element table defined (provided by a call to 
//       setDataElementTable()), this function ignores the last two 
//       arguments to this function. It then sets the data
//       to be a single content node with a simple value given by <value>
//       (a string, number of boolean) and of the type 'type' (if 'type' is
//       not provided, the typeof(<value>) will be used). If a data element 
//       table is defined, the two last arguments must be defined.
//       This function then adds the simple value defined by <type> and 
//       <value> (in the same way as in the single value case just described
//       above) at the given path under the given data element. It 
//       overwrites any existing value (including attribute value) at this 
//       path under the given data element node, but does not modify any 
//       other part of the data. 
//       Calling addValue() without a data element ID will result in the
//       data element table being removed (as if clear() was called) 
//       as this indicates that the data is a single value. 
//   removeValue(<data element ID>, <path ID>): this function removes the
//       value defined at the given path under the given data element.
//       If no data element table is defined, this is equivalent to clearValue()
//       (see below) and ignores its two argument.
//   clearValue(): this completely clears the data (sets the root content node
//       to an empty ordered set). The data element table remains the same
//       (until it is replaced by another). To also clear the data element
//       table, use clear().
//   clear(): this completely clears the result currently stored, including 
//       the data element table.
//
// Object Structure
// ----------------
//
// {
//    qcm: <pointer to the internal QCM>
//    root: <the root of the JS structure representing the data>
//    dataElements: <data element table>
//    nodes: {
//       <data element ID>: {
//            count: <number of paths below>
//            <path ID>: {
//               nodeObj: <JS object or DebugXObj>
//               numSubNodes: <number of nodes inserted directly under this 
//                             node>
//            }
//            ......
//       }
//       ......
//    }
// }
//
// qcm: this is the internal QCM which allocates the path ID used in 
//   the representation of the data.
// root: this is the root of the JAvaScript object representing the data.
// dataElements: this is a data element table which must have the same
//   form as the data element table of an indexer (see internalQCMIndexer.js
//   for more details).
// nodes: this table supports the management of the JS objects
//   constructed to represent the data and is used only when a dataElements
//   table is available. For each JS object constructed, the JS object 
//   is stored under the data element ID and path ID defining that node.
//   Arrays representing ordered sets (except for the root array) are 
//   stored under the dominating data element ID and the path ID leading 
//   to them. (the root array is simply stored in this.root).
//   This table stores, in addition to the JS object also
//   a count of the sub-nodes directly under a node (for attribute value
//   and ordered set values). When this drops from one to zero, the node can be 
//   removed (for terminal values, this number is not used and the node 
//   is removed only when it is explicitly removed).
//   The entry for the root node (which must always be an ordered set)
//   is stored under a 0 data element ID and the root path ID.

// 'qcm' is the internal QCM used to allocate the path IDs for the input data

function DebugInternalTo(qcm) 
{
    this.qcm = qcm;
    this.rootPathId = this.qcm.getRootPathId(); // default
    this.root = [];
}

// return the prefix of the given path, relative to the root path ID
// defined for this debug object.

DebugInternalTo.prototype.getElementPathId = 
    debugInternalToGetElementPathId;

function debugInternalToGetElementPathId(pathId)
{
    var elementPathId = 
        this.qcm.diffPathId(pathId, this.rootPathId);
    if(elementPathId === undefined)
        elementPathId = this.qcm.getRootPathId();

    return elementPathId;
}

// This function should be called when one wishes the DebugInternalTo
// object to be completely cleared. This not only removed all values
// from the JS structure, but also removed the data element table (if
// any).

DebugInternalTo.prototype.clear = debugInternalToClear;

function debugInternalToClear()
{
    // delete the data element table
    this.setDataElementTable(undefined, undefined);
    this.clearValue(); // clears the value, but not the data element table
}

// This function sets the data element table 'dataElements' which is used
// for representing the input data. If this is undefined, the 
// source data is a simple value. If the data element table is not the
// same as the one already stored here, the value is cleared.
// 'rootPathId' is the path in the path structure of the data element table
// where the root of the data is. If this is undefined, the empty root
// path is used. If the root path ID changes, the value has to cleared.

DebugInternalTo.prototype.setDataElementTable = 
    debugInternalToSetDataElementTable;

function debugInternalToSetDataElementTable(dataElements, rootPathId)
{
    if(rootPathId === undefined)
        rootPathId = this.qcm.getRootPathId();

    if(this.dataElements == dataElements && this.rootPathId == rootPathId)
        return;

    this.clearValue();
    this.dataElements = dataElements;
    
    if(dataElements)
        this.nodes = {};
    else
        this.nodes = undefined;

    this.rootPathId = rootPathId;
}

// This function adds a value to the input data represented by the JS
// structure constructed by this object. if there is no data element table 
// defined, this function ignores the last two arguments to this function
// and sets the root node to be a simple value given by 'value' (a string, 
// number, boolean or RangeKey) and of the type 'type' (if 'type' is not 
// provided, the typeof(<value>) will be used). 
// If a data element table is defined, the two last arguments must be defined.
// This function then adds the simple value defined by 'type' and 
// 'value' (in the same way as in the single value case just described
// above) at the given path under the given data element. If there is still
// no JS object at this path under the given data element, such a node,
// and any dominating nodes needed, are added to the structure. 
// This overwrites any existing value at this path under the given data 
// element node (and any dominated nodes are removed), but does not modify 
// any other part of the data. 

DebugInternalTo.prototype.addValue = debugInternalToAddValue;

function debugInternalToAddValue(value, type, elementId, pathId)
{
    // create an object representing this value. In most cases it is 
    // a string, except for in the case of a negation node.
    var nodeObj;

    if(typeof(value) == "object") { 
        if(value.isEmpty()) {
            nodeObj = "r()";
        } else if(value.isActive()) {
            nodeObj = "r" + "(<" + value.getType() + ">:" + value.getMinKey() + 
                ", <" + value.getType() + ">:" + value.getMaxKey() + ")";
        } else {
            nodeObj = new DebugRangeObj();
        }
    } else if(type == "projector")
        nodeObj = "<" + type + ">:_";
    else if(type == "variableIndex")
        nodeObj = "<" + type + ">:$" + value;
    else if(type == "negation") {
        nodeObj = new DebugNegationObj();
    } else if(type == "functionApplication") {
        nodeObj = new DebugFuncAppObj();
    } else if(type == "defun") {
        nodeObj = new DebugDefunObj();
    } else if(type)
        nodeObj = "<" + type + ">:" + value;
    else
        nodeObj = "<" + typeof(value) + ">:" + value;

    if(!elementId && this.dataElements)
        this.clear();

    if(!this.dataElements) { // single value at root
        this.root = nodeObj;
        return;
    }
        

    // data element table exists, set the node to the given value, creating 
    // the node, if needed

    var nodeEntry; // entry in the 'nodes' table for this node

    if(this.nodes[elementId] && (nodeEntry = this.nodes[elementId][pathId])) {
        // node already exists
        if(type == "negation") {
            if(nodeEntry.nodeObj instanceof DebugNegationObj)
                return; // nothing changed
            if(nodeEntry.nodeObj instanceof Array) {
                // before the negation, this was simply an ordered set.
                // Transfer the elements from the array to the negation object
                for(var id in nodeEntry.nodeObj)
                    nodeObj[id] = nodeEntry.nodeObj[id]; 
                // update the entry and the dominating node
                nodeEntry.nodeObj = nodeObj;
                this.insertUnderDominating(elementId, pathId, nodeObj);
                return;
            }
        }
        if(nodeEntry.numSubNodes)
            // non-terminal is about to be replaced by terminal, destroy
            // all entries for nodes under it
            this.removeDominatedNodes(elementId, pathId, nodeEntry);
        nodeEntry.nodeObj = nodeObj;
        return;
    }

    // entry does not exist. Create a new entry
    this.createNewEntry(elementId, pathId, nodeObj);
}

// Given a data element ID and a path ID, this function returns the entry 
// in the 'nodes' table for the node dominating the node given by this
// data element ID and path ID. If such an entry does not exist, it is 
// created. If the given path is the path of the data element with the
// given ID, the node created is an array (ordered set). Otherwise, the node
// created is an object (attribute-value) node.
// If a new node is created, it will be an empty array (ordered set) or 
// object (attribute-value) node. This state is only allowed to exist 
// temporarily. The calling function should make sure some element is 
// added under the node returned by this fuction.
// If the dominating node is a negation node, it should already exist
// (this is the only way to know that the node is negated).

DebugInternalTo.prototype.getDominatingNode = 
    debugInternalToGetDominatingNode;

function debugInternalToGetDominatingNode(elementId, pathId)
{
    // the element entry out of the data elements table
    var elementEntry = this.dataElements.getEntry(elementId);
    
    // entry in the 'nodes' table
    var nodeEntry;
    // true if the dominating node should be an ordered set or a negation node
    var isOrderedSet;

    // get the data element ID and path ID for the dominating node
    var elementPathId = this.getElementPathId(elementEntry.pathId);
    var parentPathId;
    if(elementEntry.parent)
        parentPathId = this.dataElements.getPathId(elementEntry.parent);
    if(isOrderedSet = (elementPathId == pathId)) {
        elementId = (elementEntry.parent && parentPathId >= this.rootPathId) ? 
            elementEntry.parent : 0;
    } else // dominating node is an attribute-value
        pathId = this.qcm.getPrefix(pathId);

    if(this.nodes[elementId] && (nodeEntry = this.nodes[elementId][pathId])) {
        // the node exists, verify that it is indeed of the correct type
        // (otherwise, replace it)
        if(!nodeEntry.nodeObj || typeof(nodeEntry.nodeObj) !== "object" ||
           isOrderedSet !== 
           ((nodeEntry.nodeObj instanceof Array) || 
            (nodeEntry.nodeObj instanceof DebugNegationObj) ||
            (nodeEntry.nodeObj instanceof DebugRangeObj))) {
            if(nodeEntry.numSubNodes)
                this.removeDominatedNodes(elementId, pathId, nodeEntry);
            nodeEntry.nodeObj = isOrderedSet ? [] : {};
        }
        return nodeEntry;
    } else // create a new entry
        return this.createNewEntry(elementId, pathId, isOrderedSet ? [] : {});
}

// This function creates a new node entry for the given data element ID 
// and path ID and sets the given JS node object as the value of the node.
// If elementId is zero, this is the root node and the root node
// is simply set as the node object for this entry (its value must then
// be an array (ordered set), so there is no need to set the given node
// object on it).

DebugInternalTo.prototype.createNewEntry = 
    debugInternalToCreateNewEntry;

function debugInternalToCreateNewEntry(elementId, pathId, nodeObj)
{
    if(!this.nodes[elementId])
        this.nodes[elementId] = { count: 0 };

    var nodeEntry = this.nodes[elementId][pathId] = { numSubNodes: 0 };
    this.nodes[elementId].count++;

    if((nodeObj instanceof DebugNegationObj) || 
       (nodeObj instanceof DebugRangeObj) || 
       (nodeObj instanceof DebugFuncAppObj) || 
       (nodeObj instanceof DebugDefunObj)) {
        // count the number of sub-nodes already inserted under this node
        for(var attr in nodeObj)
            nodeEntry.numSubNodes++;
    }

    // if this is the root node, simply set it and return the entry
    if(!elementId) {
        nodeEntry.nodeObj = this.root = nodeObj;
        return nodeEntry;
    }

    nodeEntry.nodeObj = nodeObj;
    // insert the node under the dominating node (if any)
    this.insertUnderDominating(elementId, pathId, nodeObj);

    return nodeEntry;
}

// This inserts the entry at the given element ID and path and whose
// node object is given by 'nodeObj' under its dominating node
// (this dominating node is created is it does not yet exist).
// This will replace any existing sub-node under the same
// attribute or element ID.

DebugInternalTo.prototype.insertUnderDominating = 
        debugInternalToInsertUnderDominating;

function debugInternalToInsertUnderDominating(elementId, pathId, nodeObj)
{
    // get the dominating node and insert the new node under it
    var parentEntry = this.getDominatingNode(elementId, pathId);

    if(!parentEntry)
        return;

    var parentObj = parentEntry.nodeObj;
    if(typeof(parentObj) == "object" && 
       ((parentObj instanceof Array) || 
        (parentObj instanceof DebugNegationObj) ||
        (parentObj instanceof DebugRangeObj))) {
        if(parentObj[elementId] === undefined)
            parentEntry.numSubNodes++;
        parentObj[elementId] = nodeObj;
    } else { 
        // inserting under an attribute-value (this also applies to
        // DebugFuncAppObj and DebugDefunObj nodes)
        var attr = this.qcm.getLastPathAttr(pathId);
        if(parentObj[attr] === undefined)
            parentEntry.numSubNodes++;
        parentObj[attr] = nodeObj;
    }
}

// This function is given the data element ID and path ID defining
// an entry in the 'nodes' table. 'nodeEntry' is the entry defined by these
// two parameters. This function then removes all nodes dominated
// by this node. When it returns, the numSubNodes counter on 'nodeEntry'
// is zero, but the entry itself is not removed (it is assumed the 
// calling function may want to replace it with something else, otherwise,
// the calling function should destroy it).
// The entries from the 'nodes' table must be removed. If this node is 
// an attribute-value, the function loops over all attributes under 
// the attribute-value, calculating the path ID for the nodes under these 
// attributes (the dominating data element remains the same). If this node 
// is an ordered set, the function loops over the entries of the ordered 
// set, which are the data element IDs in this ordered set (the path ID
// of these data elements is the same as of the ordered set node).
// This provides the nodes immediately dominated by this node.
// The function can then continue recursively down these nodes.

DebugInternalTo.prototype.removeDominatedNodes = 
    debugInternalToRemoveDominatedNodes;

function debugInternalToRemoveDominatedNodes(elementId, pathId, nodeEntry)
{
    if(!nodeEntry.numSubNodes)
        return;

    if((nodeEntry.nodeObj instanceof Array) || 
       (nodeEntry.nodeObj instanceof DebugNegationObj) ||
       (nodeEntry.nodeObj instanceof DebugRangeObj)) {
        // find the data element IDs in this ordered set (these are the
        // indexes of the ordered set).
        for(var subElementId in nodeEntry.nodeObj) {
            var subEntry = this.nodes[subElementId][pathId];
            if(subEntry.numSubNodes)
                this.removeDominatedNodes(subElementId, pathId, subEntry);
            delete this.nodes[subElementId];
        }
        nodeEntry.nodeObj = [];
    } else { 
        // attribute-value node or DebugFuncAppObj node or DebugDefunObj node
        for(var attr in nodeEntry.nodeObj) {
            var subPathId = this.qcm.getPathId(pathId, attr);
            var subEntry = this.nodes[elementId][subPathId];
            if(subEntry.numSubNodes)
                this.removeDominatedNodes(elementId, subPathId, subEntry);
            if(!--this.nodes[elementId].count)
                delete this.nodes[elementId];
        }
        nodeEntry.nodeObj = {};
    }

    nodeEntry.numSubNodes = 0;
}

// This function removes the nodes at the given path under the given data
// element from the JS structure and removes the corresponding
// entry from the 'nodes' table. If the node dominating the removed node 
// has become empty as a result of this removal, it too is removed, and
// so on, recursively (only the root node is not removed if it is empty).
// If the node to be removed is a compound node, all nodes under it
// are also removed.
// If there is no data element table defined, this function ignores its
// arguments and simply clears the root node value.

DebugInternalTo.prototype.removeValue = debugInternalToRemoveValue;

function debugInternalToRemoveValue(elementId, pathId)
{
    if(!this.dataElements) { // clear the root node value.
        this.root = [];
        return;
    }

    // get the entry for this node
    
    var nodeEntry;

    if(!this.nodes[elementId] || !(nodeEntry = this.nodes[elementId][pathId]))
        return;

    if((nodeEntry.nodeObj instanceof DebugNegationObj) || 
       (nodeEntry.nodeObj instanceof DebugRangeObj)) {
        // replace the operator entry by an ordered set (array) if there are
        // any operands
        if(nodeEntry.numSubNodes) {
            var newNodeObj = []; 
            for(var operandId in nodeEntry.nodeObj)
                newNodeObj[operandId] = nodeEntry.nodeObj[operandId];
            nodeEntry.nodeObj = newNodeObj;
            // insert the new entry under the dominating node
            this.insertUnderDominating(elementId, pathId, newNodeObj);
        }
        // otherwise, continue below to remove this node like any terminal node
    } else if(nodeEntry.numSubNodes)
        this.removeDominatedNodes(elementId, pathId, nodeEntry);

    // find the dominating node element ID and path ID and remove this node 
    // from it

    var elementEntry = this.dataElements.getEntry(elementId);
    var elementPathId = this.getElementPathId(elementEntry.pathId);
    var isDataElement = (elementPathId == pathId); 
    var dominatingElementId = isDataElement ? 
        (elementEntry.parent ? elementEntry.parent : 0) : elementId; 
    var dominatingPathId = 
        isDataElement ? pathId : this.qcm.getPrefix(pathId);

    var dominatingEntry = this.nodes[dominatingElementId][dominatingPathId];

    var attr = isDataElement ? 
        elementId : this.qcm.getLastPathAttr(pathId);
    delete dominatingEntry.nodeObj[attr];
    if(!--dominatingEntry.numSubNodes && dominatingElementId)
        // dominatingElementId == 0 means the root node, which is not removed
        this.removeValue(dominatingElementId, dominatingPathId);

    // remove the entry of the removed value
    delete this.nodes[elementId][pathId];
    if(!--this.nodes[elementId].count)
        delete this.nodes[elementId];
}

// This function completely removed all values stored in this object,
// setting the value to an empty ordered set. The data element table is
// not cleared.

DebugInternalTo.prototype.clearValue = debugInternalToClearValue;

function debugInternalToClearValue(elementId, pathId)
{
    if(this.nodes)
        this.nodes = {};
    
    this.root = [];
}

// This function returns a string representation of the structure under
// 'obj', which should be part of the JS structure constructed by this
// object. If this is undefined, this.root is used. This should be called
// with an argument other than undefined only in the recursive call
// of the function. 

DebugInternalTo.prototype.getDescStr = debugInternalToGetDescStr;

function debugInternalToGetDescStr(obj)
{
    var str;

    if(obj === undefined)
        obj = this.root;

    if(typeof(obj) == "object") {
        if(obj instanceof Array || obj instanceof DebugNegationObj ||
           obj instanceof DebugRangeObj) {
            str = (obj instanceof DebugNegationObj) ? 
                "n(" : ((obj instanceof DebugRangeObj) ? "r-(" : "o(");
            var first = true;
            for(var elementId in obj) {
                if(first) {
                    str += elementId + ": " + this.getDescStr(obj[elementId]);
                    first = false;
                } else {
                    str += ", " + elementId + ": " + 
                        this.getDescStr(obj[elementId]);
                }
            }
            str += ")";
        } else if(obj instanceof DebugFuncAppObj || 
                  obj instanceof DebugDefunObj) {
            str = (obj instanceof DebugDefunObj) ? "defun[" : "[";
            if("f" in obj)
                str += this.getDescStr(obj["f"]);
            else
                str += "--";
            for(var i = 1 ; (i in obj) ; ++i) {
                str += ", " + this.getDescStr(obj[i]);
            }
            str += "]"
        } else {
            str = "{";
            var first = true;
            for(var attr in obj) {
                if(first) {
                    str += " " + attr + ": " + this.getDescStr(obj[attr]);
                    first = false;
                } else {
                    str += ", " + attr + ": " + 
                        this.getDescStr(obj[attr]);
                }
            }
            str += " }";
        }
        return str;
    } else
        return obj; // is a string
}


//////////////////////
// Auxiliary Object //
//////////////////////

// This object is used exactly like an standard JavaScript object. 
// All we need is that it can be identified as an instance of a 
// DebugNegationObj.

function DebugNegationObj()
{
}

// This object is used exactly like an standard JavaScript object. 
// All we need is that it can be identified as an instance of a 
// DebugFuncAppObj.

function DebugFuncAppObj()
{
}

// This object is used exactly like an standard JavaScript object. 
// All we need is that it can be identified as an instance of a 
// DebugDefunObj.

function DebugDefunObj()
{
}

// This object is used exactly like an standard JavaScript object. 
// All we need is that it can be identified as an instance of a 
// DebugRangeObj.

function DebugRangeObj()
{
}
