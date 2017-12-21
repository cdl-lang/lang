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

// The InternalSubTree object defined in this file stores the information 
// required for monitoring a single sub-tree in the data. Such a sub-tree 
// is rooted at a single data node. The InternalSubTree object stores
// both the monitoring requests for this sub-tree and the terminal values
// of the sub-tree. It is also responsible for calculating the compression 
// of the sub-tree (if requested by the monitors).
//
// Monitors
// --------
//
// This objects receives registration for monitoring this sub-tree.
// Such requests are registered through the 'addMonitor()' function of
// this object. Each monitor is identified by an ID (allocated by the
// owner of the monitor). In addition, one can optionally provide the
// monitor object itself to the addMonitor() function. If no such
// object is provided, this is considered a compression request.
// The compression is then calculated by the InternalSubTree object 
// and it is up to the owner of the InternalSubTree object (e.g. an
// indexer) to pull the compression result and update the monitor.
//
// If, however, a monitor object is provided to addMonitor(), the 
// InternalSubTree object updates this monitor object with terminals
// added and removed from it. The monitor object must then implement
// the following interface functions:
// 
// updateSimpleElement(<path ID>, <element ID>, <type>, <key>):
//    this fuction indicates that the simple value defined by <type>
//    and <key> (where <type> is a string and <key> is a simple JavaScript
//    value, a range object or a negation object) was added to the sub-tree
//    at path <path ID> (relative to the root of the sub-tree) and 
//    under data element <element ID>. This can be used either to add
//    a new terminal or to replace an existing terminal at the same path
//    and under the same data element.
// removeSimpleElement(<path ID>, <element ID>):
//    this function indicates that the termina value at path <path ID>
//    (relative to the root of the sub-tree) and under data element <element ID>
//    was removed from the sub-tree.
// completeUpdate():
//    This function is called after all modifications to the sub-tree 
//    have been reported to the monitor through the updateSimpleElement()
//    and removeSimpleElement() functions. A call to this function indicates
//    to the monitor that it should not expect any more updates in this
//    update cycle and that it can perform any operations required to 
//    complete the update operation.
//
// Interface to Indexer
// --------------------
//
// The InternalSubTree also receives updates from the source of the data
// (an indexer) about the data in the tree. The updates are received
// through an interface similar to that used by a sub-tree monitor:
// updateSimpleElement(), removeSimpleElement() and completeUpdate().
// There are several differences, however, between these functions 
// (implemented by InternalSubTree and receiving updates from the data source)
// and the monitor interface (this is a short overview, for more details
// see the implementation of these functions below):
// 1. The <path ID> received by  updateSimpleElement() and 
//    removeSimpleElement() is relative to the root of the data source 
//    (the indexer) and not relative to the root of the sub-tree.
//    These functions are then responsible for converting this path 
//    into a path relative to the root of the sub-tree.
// 2. updateSimpleElement() may also receive the simple compressed value of
//    the simple value being added, if this is cached by the indexer. If this
//    compressed value is not provided and compression is required, 
//    the InternalSubTree object will calculate the simple compressed 
//    value and return it to the calling function (presumably the indexer)
//    which is then responsible for caching it or discarding it.
//    If the compressed value is provided (and compression is required)
//    the provided value is used. The compressed value will then be reallocated
//    (to increase its reference count, in case the indexer releases it).
// 3. completeUpdate() may be called for a specific monitor ID. If a monitor
//    ID is provided, only the update for that monitor will be completed.
//    If no monitor ID is provided, the update of all monitors is completed.
//
// Object Structure
// ----------------
//
// {
//    indexer: <indexer>,
//    pathId: <path ID>,
//    elementId: <data element ID>,
//    compression: <global compression value allocator>
//
//    monitors: <Map>{
//        <monitor ID>: <sub-tree monitor object>|false|true,
//        ......
//    }
//
//    elements: <Map>{
//        <path ID>: <Map>{
//             <element ID>: {
//                 type: <type string>,
//                 key: <simple JS value or range object>
//                 compressedValue: <simple compressed value>
//             }
//             ......
//        }
//    }
//    numElements: <number of elements in the 'elements' table>,
//
//    // compression fields
//   
//    numCompressionRequests: <integer>
//    numFullCompressionRequests: <integer>
//    compressedValue: <CompressedValue> // if this is a compound sub-tree
//    simpleCompressedValue: <number> // if this is a simple sub-tree
// }
//
// indexer: 
// pathId:
// elementId:
//    These three properties define the root of this sub-tree. This object
//    is stored inside the node entry for data element ID 'elementId'
//    in path node with ID 'pathId' in the given indexer.
//    While the sub-tree object does not access the data node information
//    directly, it does access some indexer information (such as 
//    the data element table) and global objects (such as the compression
//    module) which are assciated with or can be accessed through the 
//    indexer.
//    The sub-tree object also must know the path ID when it needs to
//    covert the path ID between path IDs relative to the sub-tree root
//    and path IDs relative to the indexer root.
// compression: in case compression is required, this points to 
//    this.indexer.qcm.compression which is the global object responsible
//    for allocating the compression values.
//
// monitors:
//    This table holds all sub-tree monitors registered to this sub-tree,
//    each under its ID (provided by the module making the registration).
//    If the monitor object is provided upon registration, it is stored
//    here (see addMonitor()). If the monitor object is not provided, 
//    this is considered a request for compression. In this case, 'false'
//    is stored when no full compression is requested (by this monitor)
//    and 'true' when full compression is requested by this monitor
//    (see setFullCompression() and unsetFullCompression()).
//
// elements:
//    This table holds all terminals in the sub-tree. These terminals
//    are defined by their path and data element ID. The path ID is relative
//    to the root of the sub-tree, not relative to the root of the indexer.
//    For each terminal, this table stores its value: a type (string)
//    and key (just as in the indexer: a simple JavaScript value or 
//    a range object or a negation object). If compression is required,
//    the entry also holds the simple compressed value for this terminal.
// numElements: total number of elements in 'elements'.
//
// Compression Fields:
//
// numCompressionRequests: this is an integer which is the number of 
//    monitors in 'monitors' which requested compression, that is,
//    for which no monitor object is stored in the 'monitors' table.
//    When this is not zero, the sub-tree object calculates the compression
//    of the sub-tree.
// numFullCompressionRequests: the number of monitors among those requesting
//    compression (see 'numCompressionRequests') which requested full
//    compression. When this number is not zero, full compression is 
//    requested from the compressedValue object used to calculate the 
// compressedValue: if the sub-tree is not a simple value, that is, 
//    it consists only of a single simple value at its root, 
//    and compression needs to be calculated, this field holds a 
//    CompressedValue object which is responsible for calculating the 
//    compression. This object is created once numElements becomes
//    larger than 1 or number of elements at the root path is smaller than 
//    numElements (that is, there are terminals which are not at the
//    root of the sub-tree).
// simplCompressedValue: in case the sub-tree is a simple value (that is,
//    it consists only of a single simple value at its root) and compression
//    was requested for it, this field stores the compressed value of
//    the sub-tree. This compressed value is the same as that stored in the
//    single entry in the 'elements' table. Therefore, there is no need
//    to calculate or allocate this compressed value again. This field
//    simply provides simple access to this number. 

// %%include%%: "compressedValue.js"

//
// Constructor
//

// 

function InternalSubTree(indexer, pathId, dataElementId, subTreeMonitorId, 
                         subTreeMonitor)
{
	this.indexer = indexer;
	this.pathId = pathId;
	this.dataElementId = dataElementId;

    this.monitors = new Map();

    this.elements = new Map();
    this.numElements = 0;

    this.numCompressionRequests = 0;
    this.numFullCompressionRequests = 0;

    if(subTreeMonitorId !== undefined)
        this.addMonitor(subTreeMonitorId, subTreeMonitor);
}

// This function destroys this object. At the moment, this is equivalent 
// to performing a 'clear()' operation (see below).

InternalSubTree.prototype.destroy = 
    internalSubTreeDestroy;

function internalSubTreeDestroy()
{
    this.clear();
}

// clear the sub-tree data, but keep the monitoring objects (including
// compression). This is in case this object needs to be re-activated.
// This function removes all terminals stored in the 'elements' table
// and releases their simple compression value (if stored).
// This function also removes all elements from the registered monitors 
// (if any).

InternalSubTree.prototype.clear = 
    internalSubTreeClear;

function internalSubTreeClear()
{
    // clear compression

    if(this.compressedValue) { // destroy the compressed value
        this.compressedValue.destroy();
        this.compressedValue = undefined;
    }
    if(this.numCompressionRequests)
        this.simpleCompressedValue = 0;
    
    var monitors; // non-compression monitors (if any)
    var ml = 0;
    var hasCompression = !!this.numCompressionRequests;

    if(this.monitors.size > this.numCompressionRequests) {
        // create list of monitors to be updated
        monitors = [];
        this.monitors.forEach(function(monitor, monitorId) {
            if(typeof(monitor) !== "boolean")
                monitors.push(monitor);
        });
        ml = monitors.length;
    }

    // clear the 'elements' table
    
    if(ml !== 0 || hasCompression) {

        // need to loop over all terminals

        var _self = this;
        
        this.elements.forEach(function(pathEntry, pathId) {
            pathEntry.forEach(function(elementEntry, elementId) {
                if(ml !== 0) {
                    for(var i = 0 ; i < ml ; ++i)
                        monitors[i].removeSimpleElement(pathId, elementId);
                }
                if(hasCompression) {
                    var compressedValue = elementEntry.compressedValue;
                    _self.compression.releaseSimpleCompressed(compressedValue);
                }
            });
        });
    }

    this.elements = new Map();
    this.numElements = 0;
}

// This function clears all simple compressed values stored in the element
// entries in the 'elements' table. This is called when compression is
// turned off and there is no need anymore to continue to update these
// compression values.

InternalSubTree.prototype.clearSimpleCompressedValues = 
    internalSubTreeClearSimpleCompressedValues;

function internalSubTreeClearSimpleCompressedValues()
{
    var _self = this;

    this.elements.forEach(function(pathEntry, pathId) {
        pathEntry.forEach(function(entry, elementId) {
            if(entry.compressedValue) {
                _self.compression.
                    releaseSimpleCompressed(entry.compressedValue);
                entry.compressedValue = undefined;
            }
        });
    });
}

/////////////////////////
// Auxiliary Functions //
/////////////////////////

// This function returns true iff the sub-tree is a simple value, that is,
// if it consist of a single terminal value at the root of the sub-tree.
// To test this, we check the total number of terminals in the tree 
// (which should be 1) and the number of terminals at the root of the 
// tree (which should also be 1).
// In case the tree is empty, this function returns false. 

InternalSubTree.prototype.isSimple =
    internalSubTreeIsSimple;

function internalSubTreeIsSimple()
{
    if(this.numElements != 1)
        return false;

    var rootPathId = this.indexer.getRootPathId();

    return (this.elements.has(rootPathId) && 
            this.elements.get(rootPathId).size == 1);
}

// This function returns true iff this sub-tree is empty (contains no
// terminals)

InternalSubTree.prototype.isEmpty =
    internalSubTreeIsEmpty;

function internalSubTreeIsEmpty()
{
    return (this.numElements == 0);
}

//////////////////////////
// Monitor Registration //
//////////////////////////

// This function is called with a sub-tree monitor (which may be 
// undefined) and the ID of that sub-tree monitor (which must be defined)
// and adds this monitor to the list of monitors monitoring this sub-tree. 
// If the sub-tree object, 'subTreeMonitor', is not undefined, this
// monitor object is updated with the terminals already added to this
// sub-tree. When additional terminals are added, removed and modified,
// the monitor object will be updated.
// If the monitor object is undefined, this is seen as a request for
// compression. The number of compression requests is incremented and
// if compression was not yet calculated, its calculation 
// is initialized and if any terminals were already assigned to the 
// sub-tree, these are added to the compression.
// In the case of compression, the monitor is not notified in any way.
// It is the responsibility of the indexer to make sure the monitor is
// updated with the compression value (when the time is ripe).

InternalSubTree.prototype.addMonitor =
    internalSubTreeAddMonitor;

function internalSubTreeAddMonitor(subTreeMonitorId, subTreeMonitor)
{
    if(this.monitors.has(subTreeMonitorId))
        // monitor already registered, so nothing more to do (it must be
        // the same monitor)
        return;

    if(!subTreeMonitor) {
        this.addCompressionMonitor(subTreeMonitorId);
        return;
    }
    
    // add the monitor to the monitor tableand update it with existing values
    
    this.monitors.set(subTreeMonitorId, subTreeMonitor);

    if(this.numElements === 0)
        return; // no elements, nothing more to do

    this.elements.forEach(function(pathEntry, pathId) {
        pathEntry.forEach(function(valueEntry, elementId) {
            subTreeMonitor.updateSimpleElement(pathId, elementId, 
                                               valueEntry.type, valueEntry.key);
        });
    });

    subTreeMonitor.completeUpdate();
}

// This function implements 'addMonitor()' for the case where this monitor
// requires compression. In tihs case, only the monitor ID is needed.
// The monitor ID is stored and the number of compression requests
// is updated. Initially, no full compression is requested for this monitor
// (this has to be requested explicitly through the setFullCompression()
// function). If this is the first compression request, compression 
// is initialized and the compression value is calculated based on the elements
// already in the sub-tree.

InternalSubTree.prototype.addCompressionMonitor =
    internalSubTreeAddCompressionMonitor;

function internalSubTreeAddCompressionMonitor(subTreeMonitorId)
{
    // already checked in addMonitor() that this is a new monitor 
    this.monitors.set(subTreeMonitorId, false); // no full compression (yet)
    
    if(++this.numCompressionRequests > 1)
        return; // compression already activated
    
    // initialize compression
    
    this.simpleCompressedValue = 0;
    this.compression = this.indexer.qcm.compression;

    if(this.isEmpty())
        return; // object still empty, nothing more to do

    var _self = this;
    
    if(this.isSimple()) {
        // compress the single terminal (which is at the root of the sub-tree)
        // and store the result at under simpleCompressedValue
        var rootPathElements = this.elements.get(this.indexer.getRootPathId());
        rootPathElements.forEach(function(entry, elementId) {// single iteration
            if(entry.compressedValue)
                _self.simpleCompressedValue = entry.compressedValue;
            else {
                _self.simpleCompressedValue = entry.compressedValue = 
                    _self.compression.simple(entry.type, entry.key);
            }
        });
    } else {
        // compress a compound object. Create a 'CompressedValue' object,
        // compress each of the simple elements and update the CompressedValue
        // object with these simple compressions.

        this.compressedValue = new CompressedValue(this.indexer, this.pathId, 
                                                   this.dataElementId);

        this.elements.forEach(function(pathEntry, pathId) {
            pathEntry.forEach(function(entry, elementId) {
                if(!entry.compressedValue) {
                    entry.compressedValue = 
                        _self.compression.simple(entry.type, entry.key);
                }
                _self.compressedValue.
                    updateSimpleElement(pathId, elementId, entry.type,
                                        entry.key, entry.compressedValue);
            });
        });
            
        this.compressedValue.completeUpdate();
    }
}

// This function removes the registration of the monitor with the given 
// ID from this sub-tree. If the monitor stored in the 'monitors' 
// table is a Boolean, then this monitor requested compression
// (and in the case of 'true' - also full compression). This
// function then decreases the number of compression requests (and, if
// 'true', full compression requests) on this sub-tree object.
// If these counters drop to zero, (full) compression is cleared.
// If the monitor stored is not a Boolean, this function removes
// all elements of the sub-tree from the monitor (this is because the monitor
// may be registered to multiple sub-trees and may not know which
// elements came from which sub-tree). If the monitor knows which 
// elements are about to be removed, it may ignore the calls to remove them.  

InternalSubTree.prototype.removeMonitor = 
    internalSubTreeRemoveMonitor;

function internalSubTreeRemoveMonitor(subTreeMonitorId)
{
    var monitor = this.monitors.get(subTreeMonitorId);

    if(monitor === undefined)
        return;

    this.monitors.delete(subTreeMonitorId);

    if(typeof(monitor) != "boolean") {
        // not a compression monitor, remove the simple elements from it
        this.elements.forEach(function(pathEntry, pathId) {
            pathEntry.forEach(function(elementEntry, elementId) {
                monitor.removeSimpleElement(pathId, elementId);
            });
        });
        return;
    }

    // compression monitor

    if(!--this.numCompressionRequests) { // clear compression
        this.numFullCompressionRequests = 0;
        if(this.compressedValue) {
            this.compressedValue.destroy();
            this.compressedValue = undefined;
        }
        this.simpleCompressedValue = 0;
        
        // clear the compressed values of all elements
        this.clearSimpleCompressedValues();

    } else if(monitor === true && (!--this.numFullCompressionRequests) &&
              this.compressedValue) { // turn off full compression
        this.compressedValue.deactivateFullCompression();
    }
}

// returns a Map object whose keys are the IDs of the monitors registered
// to this sub-tree object. This is simply the this.monitors object, so the
// calling function is not allowed to modify it.

InternalSubTree.prototype.getMonitorIds = 
    internalSubTreeGetMonitorIds;

function internalSubTreeGetMonitorIds()
{
    return this.monitors;
}

//////////////////////
// Terminal Updates //
//////////////////////

// This function is called to add or modify a terminal in the sub-tree.
// The terminal is found at the path 'pathId' and under the data element
// 'elementId' where 'pathId' is relative to the root of the indexer
// (and not relative to the root of the sub-tree). Therefore, the first
// thing this function needs to do is convert the path ID into a path 
// relative to the root of the sub-tree.
// The type and key of the simple value are also given. These are then
// stored in the 'elements' table under the given path ID and element ID.
// If the key is an object (range or negation object) it first needs to 
// be duplicated before being stored (as it may change).
// This function then loops over all monitors which are not compression
// monitors (that is, have a monitor object stored in the 'monitors' table)
// and updates them with this new value.
// If compression is required, this function must also update the compression.
// 'compressedValue', if given, is the compressed value of the value given
// by 'type' and 'key'. If this is undefined, this function must calculate 
// this compressed value.
// If compression is required, this function returns the compressed value
// of ther simple value just added (whether this function calculated it
// or not). Otherwise, this function returns undefined.

InternalSubTree.prototype.updateSimpleElement = 
    internalSubTreeUpdateSimpleElement;

function internalSubTreeUpdateSimpleElement(pathId, elementId, type, key,
                                            compressedValue)
{
    // convert to a path relative to the root fo the sub-tree
    pathId = this.indexer.qcm.diffPathId(pathId, this.pathId);

    // update the elements table
    
    if(typeof(key) == "object")
        key = key.simpleCopy(); // store a copy

    var pathEntry;
    var valueEntry;

    if(!this.elements.has(pathId)) {
        pathEntry = new Map();
        this.elements.set(pathId, pathEntry);
    } else
        pathEntry = this.elements.get(pathId);

    if(!pathEntry.has(elementId)) {
        valueEntry = {
            type: type,
            key: key
        };
        pathEntry.set(elementId, valueEntry);
        this.numElements++;
    } else {
        valueEntry = pathEntry.get(elementId);
        valueEntry.type = type;
        valueEntry.key = key;
    }
    
    // update non-compression monitors
    if(this.monitors.size > this.numCompressionRequests) {
        this.monitors.forEach(function(monitor, monitorId) {
            if(typeof(monitor) === "boolean")
                return; // compression monitor
            monitor.updateSimpleElement(pathId, elementId, type, key);
        });
    }
    
    if(this.numCompressionRequests) { // update the compression
        // calculate/reallocate simple value's compressed value
        if(!compressedValue)
            compressedValue = this.compression.simple(type, key);
        else
            this.compression.reallocateSimple(compressedValue);
            
        if(valueEntry.compressedValue) {
            this.compression.
                releaseSimpleCompressed(valueEntry.compressedValue);
        }
        valueEntry.compressedValue = compressedValue;

        if(!this.isSimple()) {
            if(!this.compressedValue) {
                this.compressedValue = 
                    new CompressedValue(this.indexer, this.pathId, 
                                        this.dataElementId);
                this.simpleCompressedValue = 0;
            }
            this.compressedValue.updateSimpleElement(pathId, elementId, 
                                                     type, key, 
                                                     compressedValue);
            // even if full compression is required, we do not set it here
            // but in the 'completeUpdate()' function, as this is more
            // efficient.
        } else
            this.simpleCompressedValue = compressedValue;
    }
}

// This function is called to remove a terminal in the sub-tree.
// The terminal is found at the path 'pathId' and under the data element
// 'elementId' where 'pathId' is relative to the root of the indexer
// (and not relative to the root of the sub-tree). Therefore, the first
// thing this function needs to do is convert the path ID into a path 
// relative to the root of the sub-tree.
// The function removes this terminal from the 'elements' table
// (if this terminal cannot be found in the table, the function exits).
// This function then removes this terminal value from all non-compression
// monitors. If compression is required, this function also removes it 
// from the compression calculation.

InternalSubTree.prototype.removeSimpleElement = 
    internalSubTreeRemoveSimpleElement;

function internalSubTreeRemoveSimpleElement(pathId, elementId)
{
    // convert to a path relative to the root fo the sub-tree
    pathId = this.indexer.qcm.diffPathId(pathId, this.pathId);

    // remove the element from the elements table
    
    var pathEntry;
    var valueEntry;

    if((pathEntry = this.elements.get(pathId)) === undefined)
        return;

    if((valueEntry = pathEntry.get(elementId)) === undefined)
        return;
    
    if(valueEntry.compressedValue) // release the compression value
        this.compression.releaseSimpleCompressed(valueEntry.compressedValue); 
    
    this.numElements--;
    if(pathEntry.size === 1)
        this.elements.delete(pathId);
    else
        pathEntry.delete(elementId);

    if(this.monitors.size > this.numCompressionRequests) {
        // update the non-compression monitors
        this.monitors.forEach(function(monitor, monitorId) {
            if(typeof(monitor) === "boolean")
                return; // compression monitor
            monitor.removeSimpleElement(pathId, elementId);
        });
    }
    
    if(this.numCompressionRequests) { // update the compression
        if(this.isEmpty()) {
            if(this.compressedValue) {
                this.compressedValue.destroy();
                this.compressedValue = undefined;
            } else
                this.simpleCompressedValue = 0;
        } else if(this.isSimple()) {
            if(this.compressedValue) {
                this.compressedValue.destroy();
                this.compressedValue = undefined;
            }
            var rootPathElements =
                this.elements.get(this.indexer.getRootPathId());
            var _self = this;
            rootPathElements.forEach(function(entry, elementId) {
                // single iteration
                _self.simpleCompressedValue = entry.compressedValue;
            });
        } else
            this.compressedValue.removeSimpleElement(pathId, elementId);
    }
}

// complete the update of the monitors. This function may optionally receive
// a monitor ID. If such a monitor ID is given, only the update of this
// monitor is completed, otherwise, the update of all monitors is completed.
// For non-compression monitors, the completeUpdate() function of the 
// monitor is called. For compression monitors, the completeUpdate()
// function of the CompressedValue object is called (if exists). This will
// happen only once for all compression monitors. 

InternalSubTree.prototype.completeUpdate = 
    internalSubTreeCompleteUpdate;

function internalSubTreeCompleteUpdate(subTreeMonitorId)
{
    if(subTreeMonitorId !== undefined) {
        var monitor = this.monitors.get(subTreeMonitorId);
        if(monitor === undefined)
            return;
        if(typeof(monitor) == "boolean") {
            // update the compression
            if(this.compressedValue) {
                if(this.numFullCompressionRequests > 0 && 
                   !this.compressedValue.hasFullCompression())
                    this.compressedValue.requestFullCompression();
                else
                    this.compressedValue.completeUpdate();
            }
        } else
            monitor.completeUpdate();
    } else { // complete update for all monitors
        // compression monitors
        if(this.numCompressionRequests && this.compressedValue) {
            if(this.numFullCompressionRequests > 0 && 
               !this.compressedValue.hasFullCompression())
                this.compressedValue.requestFullCompression();
            else
                this.compressedValue.completeUpdate();
        }
        // non-compression monitors
        if(this.monitors.size > this.numCompressionRequests) {
            this.monitors.forEach(function(monitor, monitorId) {
                if(typeof(monitor) !== "boolean") // non-compression
                    monitor.completeUpdate();
            });
        }
    }
}

///////////////////////////
// Compression Interface //
///////////////////////////

// If compression has been requested for this sub-tree, this
// function returns an array of length 2, with the following fields:
// [<quick compression>, <full compression>]
// If the sub-tree value is simple (a tree with a single root node and no
// other terminal), both fields are defined and both are a number.
// If the sub-tree value is not simple, the <quick compression> field
// is a string. If full compression has been set, <full compression> is
// a number and otherwise, undefined. If the quick compression of 
// two elements is equal and a string, full compression needs to be
// requested for these two elements to determine whether they are 
// equal or not.

InternalSubTree.prototype.getCompression =
    internalSubTreeGetCompression;

function internalSubTreeGetCompression() 
{
    if(this.compressedValue === undefined) // simple value
        return [this.simpleCompressedValue, this.simpleCompressedValue];

    // compound value

    return this.compressedValue.getCompression();
}

// This function returns the full compression of this sub-tree. This is 
// the same as the second element returned by getCompression().

InternalSubTree.prototype.getFullCompression =
    internalSubTreeGetFullCompression;

function internalSubTreeGetFullCompression() 
{
    if(this.compressedValue === undefined) // simple value
        return this.simpleCompressedValue;

    // compound value

    return this.compressedValue.getFullCompression();
}

// This function requests full compression to be calculated for this 
// sub-tree. The request is for the compression monitor with the given ID
// (as multiple monitors may request full compression and then cancel 
// that request, we need to know when full compression can be cancelled). 
// This function turns on full compression calculation and returns the 
// compressed value (including the newly calculated full compression) in the 
// same format as used by getCompression() (see above).

InternalSubTree.prototype.setFullCompression =
    internalSubTreeSetFullCompression;

function internalSubTreeSetFullCompression(monitorId)
{
    if(this.monitors.get(monitorId) !== false)
        // monitor not registered (undefined) or not a compression monitor
        // (an object is stored) or full compression already set (true)
        return;

    this.monitors.set(monitorId, true);
    if(++this.numFullCompressionRequests > 1)
        return; // not first request, full compression already activated

    if(this.compressedValue)
        this.compressedValue.requestFullCompression();

    return this.getCompression();
}

// This function is used to cancel the request for the calculation of 
// full compression on this sub-tree for the monitor with the given ID. 
// If this monitor is not registered as having requested full compression,
// this function does nothing. Otherwise, this function decreases the 
// number of full compression requests and if this number dropped to zero,
// stops the calculation of the full compression.
// This function does ot return any value, but from this point on, 
// the full compression value returned for non-simple sub-trees will be
// undefined.

InternalSubTree.prototype.unsetFullCompression =
    internalSubTreeUnsetFullCompression;

function internalSubTreeUnsetFullCompression(monitorId)
{
    if(this.monitors.get(monitorId) !== true)
        // monitor not registered (undefined) or not a compression monitor
        // (an object is stored) or full compression not set (false)
        return;

    this.monitors.set(monitorId, false);

    if(--this.numFullCompressionRequests > 0)
        return; // there still are additional full compression requests

    if(this.compressedValue)
        this.compressedValue.deactivateFullCompression();
}
