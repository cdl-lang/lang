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


// This file implements the DataElements object, which stores the data
// elements of an indexer (or multiple indexers) and the relations
// among them. Derived classes may store additional values under
// a data element's entry (e.g. a merge indexer may store the source ID
// and mapping group of a data element).
//
// For more information about data elements, see the documentation
// of InternalQCMIndexer.
//
// The DataElement object also stores the base identity of each data
// element (see also identityIndexer.js).
// The base identities are:
//
// 1. If the data element was mapped from a source indexer, the base identity
//    in the target indexer is the one provided by the mapping (this is 
//    defined below and may simply be the base identity in the source indexer).
// 2. If the data element was not mapped from another indexer:
//    If the base identity is explicitly provided by the function which
//    created the data element (by calling the addDataElementNode())
//    then this is the base identity. Otherwise, a default base identity is
//    defined, as follows:
//    a. If the data element has a parent and no siblings (another
//       data element at the same path under the same parent), the
//       base identity of the data element is equal to the base
//       identity of the parent.
//    b. Otherwise, the base identity of the data element is the data
//       element ID (a positive number).
//
// To preserve memory, data elements with the same parent and the same
// path ID may share the object describing their entry in the table.
// This object implicitly stores a default identity which is equal to
// the element ID. The reference count is stored separately.

//
// Object Structure
// ----------------
//
// {
//    indexer: <IdentityIndexer or derived class>
//    useDefaultIdentities: true|false,
//    dataElements: <IntHashPairMapUint>{
//        <data element ID>: [
//             <refrence count>,
//             {
//                 pathId: <number>,
//                 parent: <data element ID>,
//                 identity: <number or string>,
//                 defaultIdentity: true|false  // not on top data elements
//                 children: <Map>{
//                      <path ID>: <DataElementPathChildren>{
//                           childDefaultEntry: {
//                               parent: <data element ID>,
//                               pathId: <path ID>
//                           }          
//                           ids: <Uint31HashSet>{
//                               <data element ID>,
//                               ......
//                           },
//                      }
//                      .....
//                 },
//                 
//             }
//           ],
//           ......
//        }
//    }
//    rootDefaultEntry: {
//        pathId: <root path ID>
//    }
//    countByPath: <IntHashMapUint>{
//        <path ID>: <count>,
//        ....
//    }
//    pendingRemovals: <array of element IDs>,
//    pendingBaseIdentities: <Map>{
//         <element ID>: {
//             pathId: <path ID of this element ID>
//             verify: true|undefined // only for base identification 
//             identity: <new identity>
//         }
//         .....           
//     }
// }
//
// indexer: the indexer to which this data element table belongs. This must
//    be an IdentityIndexer or some derived class of IdentityIndexer.
// useDefaultIdentities: indicates whether this data element object stores
//    default identities (as described above) or not. The default is 'true'
//    but for merge indexer, for example, the value is 'false'.
//    When an indexer des not use default identities, the identities
//    must be specified explicitly when adding a data element. However,
//    there is still a default identity value which does not need to
//    be stored explicitly. This is the identity equal to the element ID.
// dataElements: this is a table of all data elements. Each entry
//    stores a pair.
//    The first value in the pair is the reference count. This is a reference
//       count for all nodes which use this data element. This is increased
//       for every entry in the 'nodes' table of a path node which appears
//       under the ID of this data element and is increased further by 1
//       when this data element has any children.
//    The second value is an object which describes the data element. Since
//    this object may be similar for many data elements, there is a single
//    default object which is shared by data elements which have the same parent
//    and the same path. This object only has the pathId and parent fields.
//    This means that the data element has no children and that its identity
//    is the default identity and is equal to its element ID. The default
//    data element entry is stored in 'rootDefaultEntry' for the root
//    data elements and under parent element entry for the children of that
//    parent.
//    The non-default entry has the following structure:
//       pathId: the ID of the path node at which the data element node is
//           found.
//       parent: this is the immediate parent data element of this data element 
//           If the data element does not have a parent (it is the first data
//           element along its path) this is undefined.
//       identity: this is the base identity of the data element. Often, it
//           is equal to the data element ID.
//       defaultIdentity: indicates whether the base identity is the default
//           one or not (see explanation in identityIndexer.js).
//       children: this field holds all data element IDs for which this
//           data element is a direct parent. The data elements are stored
//           under their path. The entry for each path stores two objects:
//              childDefaultEntry: the default object to use in the dataElements
//                  table for children of this parent under this path
//                  (that is, those appearing in the 'ids' table below).
//              ids: a list of all data element IDs of direct children at
//                   this path.
//    
//    When a node is removed from the indexer, the reference count and
//    the 'children' table of the data element table are updated immediately.
//    However, the entry for the data element is not removed until the
//    update epilogue of the path node (for the path of the data element)
//    is reached. At that point, data elements with a reference count
//    of zero are removed.
//    The entries of the data elements must remain in the table because 
//    queries are only updated in the update epilogue. To correctly 
//    update the query result (e.g. in case of intersection) the 
//    queries need to have access to the 'parent' information of the 
//    data elements which were removed.
//    This means that, temporarily, there may be data elements in the
//    table which have a reference count of zero.
//
// rootDefaultEntry: this is the object which is used in the 'dataElements'
//    table for entries at the root path which have a default structure
//    (no children, default identity etc.).
//
// countByPath: this table stores the number of data elements stored in
//    this table, by path. The count is decreased here only when the
//    data element is removed and not when its reference count drops
//    to zero (this ensures that after removal of data elements
//    the queries which need to refresh still have access to the information
//    as to whether data elements were defined at a certain path).
//    The DataElements object notifies the indexer when this number goes
//    from 0 to > 0 or from > 0 to 0 on a path.
// pendingRemovals: this is an array storing all data element IDs whose
//    reference count dropped to zero. These data elements remain in the
//    data element table until the end of the refresh cycle (so that the
//    data element strcture remains available for updates which are
//    dependent on this removal). At the end of the refresh cycle,
//    a cleanup function is called which removes these queued data elements
//    from the data element table (it is first checked that they can be
//    removed, so a data element may even appear twice in this list).
//
// pendingBaseIdentities: this table stores element IDs for which the
//    base identities have changed but the identities could not be
//    immediately updated on the data elements because notifications need
//    to be sent to external modules of the change in identity. Such
//    identities are updated only after notifications were sent to all
//    modules which registered for such an update.
//    Note that when the notification is sent, it may also apply to
//    non-base identifications (if the additional identification has
//    an 'undefined' explicit identity for an element, the base identity
//    becomes the additional identity for that element).
//    For each element ID, the following information is stored here:
//       pathId: teh path at which the data element is defined. This is
//           important in order to determine the modules which have to
//           be notified of the change.
//       verify: When set to true, 'identity' below is ignored. Instead,
//           when the update is applied, it is checked whether the base
//           identity is the default identity and if yes, determines the correct
//           value of that identity (and if this differs from the current
//           idnetity, this new identity is updated).
//       identity: the new identity for this element ID. This may be
//           undefined, which means the default identity.

// %%include%%: <scripts/utils/intHashTable.js>

//
// Constructor
//

// The constructor takes the indexer to which it belongs as its argument 

function DataElements(indexer)
{
    this.indexer = indexer;
    this.useDefaultIdentities = false; // by default, don't use default identities
    this.rootDefaultEntry = {
        pathId: indexer.rootPathNodeId,
        parentId: undefined
    };
    this.dataElements = new IntHashPairMapUint(255);
    this.countByPath = new IntHashMapUint();
    this.pendingRemovals = [];
    this.pendingBaseIdentities = new Map();
}

// This function is called by the indexer which owns this data element table
// to notify it that the total number of paths in the indexer has changed.
// This affects the maximal possible reference count of a data element
// (once per path + 1 for all its child data elements).

DataElements.prototype.updateNumPathNodes =
    dataElementsUpdateNumPathNodes;

function dataElementsUpdateNumPathNodes(numPathNodes)
{
    this.dataElements.adjustByteNumber(numPathNodes + 1);
}

//////////////////////////
// Adding Data Elements //
//////////////////////////

// This functions tells the data element object how many additional data
// elements (on top of those already stored here) to expect. The data element
// table will then be set to a size large enough to accommodate this number
// of additional data elements. If the data element table is already
// larger it will not be made smaller.
// By setting this value correctly one can avoid unnecesary resizing of
// the tables and resizing these tables to be larger than actually needed.
// Note that this number is in addition to the existing number of data
// elements and that all data elements at all paths are counted here
// together.

DataElements.prototype.expectAdditionalDataElementNum = 
	dataElementsExpectAdditionalDataElementNum;

function dataElementsExpectAdditionalDataElementNum(dataElementNum)
{
    this.dataElements.expectSize(this.dataElements.size + dataElementNum);
}

// This function creates a new data element with the ID 'elementId'
// at the path 'pathId' under the parent data element with ID
// 'parentId'. This function creates the entry for this data element in
// the table. This function also updates the 'children' table of the
// parent data element ID (if such a parent exists).
// The function also sets the base identity of the new data element.
// If 'baseIdentity' is provided, it is used as the base identity
// of the node. If 'baseIdentity' is undefined, the default base identity
// is assigned (see identityIndexer.js for more details).
// 'groupId' and 'sourceId' are optional arguments used only in the merge
// indexer. These are then stored on the data element entry.
// It is assumed this function is called only if the corresponding node
// has just been created in the 'nodes' table of the path node.
// However, an entry (with a reference count of 0) may already
// exist for the data element in the 'dataElements' table in 
// case the node was already removed but the update epilogue did not
// clear its entry yet.

DataElements.prototype.addNewDataElement = dataElementsAddNewDataElement;

function dataElementsAddNewDataElement(pathId, elementId, parentId,
                                       baseIdentity, groupId, sourceId)
{
    if(this.dataElements.has(elementId)) {
        // since we are adding a new data element, this must be a data element
        // whose reference count dropped to zero and is now increased again
        // to 1. Enough to increase the reference count.
        this.dataElements.inc(elementId, 1);
        this.setBaseIdentityForExistingNode(elementId, baseIdentity);
        return;
    }

    if(this.countByPath.inc(pathId, 1) === 1)
        this.indexer.notifyPathHasDataElements(pathId);
    
    var parentEntry;
    var children, pathChildren;
    
    // add as a child of the parent
	if(parentId !== undefined) {
        // get the parent entry (converting to non-default, if needed)
        parentEntry = this.dataElements.getSecond(parentId);
        parentEntry = this.getNonDefaultElementEntry(parentId, parentEntry);
		if((children = parentEntry.children) === undefined) {
            this.dataElements.inc(parentId, 1); // 1 for all children together 
			children = parentEntry.children = new Map();
            pathChildren = this.getNewDataElementPathChildren(parentId, pathId);
            children.set(pathId, pathChildren);
        } else if(children.has(pathId)) {
            pathChildren = children.get(pathId);
        } else {
            pathChildren = this.getNewDataElementPathChildren(parentId, pathId);
            children.set(pathId, pathChildren);
        }
        
		pathChildren.ids.set(elementId);
	}

    var elementEntry =
        this.getEntryForNewElement(pathId, parentId, pathChildren,
                                   elementId, groupId, sourceId);

    // set the base identity (this may replace the element entry if
    // this is not the default identity and equals the element ID)
    elementEntry = 
        this.setBaseIdentityForNewNode(elementId, elementEntry, parentEntry, 
                                       pathChildren, baseIdentity);

    this.dataElements.setPair(elementId, 1, elementEntry);
}

// return a new DataElementPathChildren node (may be overridden in derived
// classes).

DataElements.prototype.getNewDataElementPathChildren =
    dataElementsGetNewDataElementPathChildren;

function dataElementsGetNewDataElementPathChildren(parentId, pathId)
{
    return new DataElementPathChildren(parentId, pathId);
}

// This function returns the initial entry to be stored for a new data element
// added at the given pth under the given parent ID (which may be undefined).
// If 'parentId' is not undefined, 'pathChildren' is the
// DataElementPathChildren object for the children of the given parent under
// the given path.
// This function assumes that the default entry for the given parent ID and
// path may be used. If this does not hold, subsequent functions may
// change this.
// Derived classes may override this function.

DataElements.prototype.getEntryForNewElement =
    dataElementsGetEntryForNewElement;

function dataElementsGetEntryForNewElement(pathId, parentId, pathChildren)
{
    if(pathChildren === undefined) // root entry
        return this.rootDefaultEntry;

    return pathChildren.childDefaultEntry;
}

// Create a new object to store a data element in the data element table
// (derived classes may override this function). This is used when the
// default entry object cannot be used.

DataElements.prototype.newDataElementEntry =
    dataElementsNewDataElementEntry;

function dataElementsNewDataElementEntry(pathId, parentId)
{
    return {
        pathId: pathId,
        parent: parentId,
        identity: undefined,
        defaultIdentity: true,
        children: undefined
    };
}

// This function is given an element ID and its current element entry
// and makes sure that this element ID has a non-default entry. This
// non-default entry is returned.
// The function first checks whether this is a default entry or not. If it
// is not a default entry, it returns it as is. If it is a default entry,
// a new non-default entry is created based on the default entry
// and this new non-default entry is stored as the new entry for this
// element ID and returned. 

DataElements.prototype.getNonDefaultElementEntry =
    dataElementsGetNonDefaultElementEntry;

function dataElementsGetNonDefaultElementEntry(elementId, elementEntry)
{
    if(elementEntry.defaultIdentity !== undefined)
        return elementEntry;
    
    elementEntry = this.newDataElementEntry(elementEntry.pathId,
                                            elementEntry.parent,
                                            elementEntry, elementId);

    elementEntry.identity = elementId; // the default identity
    
    this.dataElements.setSecond(elementId, elementEntry);
    
    return elementEntry;
}

// This function gets the entry of the given data element ID and increases
// its reference count. It returns the entry for this data element.

DataElements.prototype.incRef = dataElementsIncRef;

function dataElementsIncRef(elementId)
{
    var entry = this.dataElements.incAndGetSecond(elementId, 1);

    if(!entry) { // possibly 0 or undefined
        assert(false, "increasing reference count of non-exsistent element");
        this.dataElements.delete(elementId);
        return undefined;
    }
    
    return entry; 
}

////////////////////////////
// Removing Data Elements //
////////////////////////////

// Removing a data element consists of two steps: releasing it and actually
// removing it. When a data element is removed, the queries which matched it
// may process this removal later and may need access to the parents of the
// data elements removed (or there may be need to access the removed children
// of a data element when a notification of the removal was not yet delivered).
// Therefore, the data elements need to remain in the table also after
// their reference count reached zero so as preserve this information.

// Given a data element ID, this function releases the data element,
// that is, decreases its reference count. If the reference count
// reached zero, the data element will be scheduled for removal.
// This function does not, therefore, remove the data
// element entry (or reduce the data element count for the path).  In
// this way, the data element structure is preserved until the queries
// which are updated by the removals which took place could use this
// information to update correctly. At the end of the update cycle,
// the function 'removeDataElement' is called to complete the process (for
// those data elements which reached a reference count of 0).  This function
// returns true if the reference count reached 0 and false otherwise.

DataElements.prototype.releaseDataElement = 
	dataElementsReleaseDataElement;

function dataElementsReleaseDataElement(elementId)
{
    // decrease refrence count (without deleting is count dropped to zero)
    // and return the entry only if the count dropped to zero.
    var entry = this.dataElements.decAndGetSecond(elementId, 1, true, true);

    if(entry !== undefined) { // true if found and count became 0
        if(this.pendingRemovals.length === 0)
            this.indexer.qcm.scheduleDataElements(this);
        this.pendingRemovals.push(elementId);
        return true;
    }

    return false;
}

// Given a data element ID whose reference count reached 0, this
// function removes its entry from the dataElements table (and if its
// parent's count also reached zero, continues recursively to remove that
// parent as well). This function then reduces the data element count
// for the path of the data element just removed here. If this 
// count reached zero, the indexer is notified.

DataElements.prototype.removeDataElement = 
	dataElementsRemoveDataElement;

function dataElementsRemoveDataElement(elementId)
{
    // if the count is zero, get the entry and delete the element from the table
    var entry = this.dataElements.getSecondIfZeroCount(elementId, true);

    if(entry === undefined)
        return; // no entry or count not zero

    this.removeDataElementFromParent(elementId, entry);
}

// This function is for internal use only. Given a data element ID
// (and the data element entry of that data element) whose reference
// count is known to have dropped to zero and to have been removed
// form the data element table, this function decreases the count for
// this data element's path (number of data elements at that path) and
// removes it as a child of the parent data element (if any). This may
// recursively result in the removal of the parent data element.

DataElements.prototype.removeDataElementFromParent = 
	dataElementsRemoveDataElementFromParent;

function dataElementsRemoveDataElementFromParent(elementId, elementEntry)
{
    // decrease path count
    var pathId = elementEntry.pathId;
    
    if(this.countByPath.dec(pathId, 1) === 0)
        this.indexer.notifyPathHasNoDataElements(pathId);

	if(elementEntry.parent === undefined)
        return; // top data element

    // remove from parent (and release parent if needed)
    
    // remove from the child list of the parent
    var parentEntry = this.dataElements.getSecond(elementEntry.parent);
    var childList = parentEntry.children.get(pathId).ids;
    if(childList.size == 1) {
        if(parentEntry.children.size === 1) {
            parentEntry.children = undefined;
            // no children anymore, decrease the parent reference count
            if(this.dataElements.dec(elementEntry.parent, 1) === 0)
                this.removeDataElementFromParent(elementEntry.parent,
                                                 parentEntry);
        } else
			parentEntry.children.delete(pathId);
    } else {
		childList.delete(elementId);
        if(childList.size == 1 && this.useDefaultIdentities) {
            var _self = this;
            childList.forEach(function(t,childId) {
                // base identity of child may be influenced by this change
                _self.verifyDefaultBaseIdentity(childId, 1);
            });
        }
    }
}

// This function is called at the end of the refresh cycle, to actually
// remove those data elements whose reference count dropped to zero
// and which were queued for removal. 

DataElements.prototype.removePendingRemovals =
    dataElementsRemovePendingRemovals;

function dataElementsRemovePendingRemovals()
{
    for(var i = 0, l = this.pendingRemovals.length ; i < l ; ++i) {
        var elementId = this.pendingRemovals[i];
        this.removeDataElement(elementId);
    }

    this.pendingRemovals = [];
}

// Returns true if there are any data elements queued for removal.

DataElements.prototype.hasPendingRemovals =
    dataElementsHasPendingRemovals;

function dataElementsHasPendingRemovals()
{
    return this.pendingRemovals.length !== 0;
}

/////////////////////
// Base Identities //
/////////////////////

// This function returns the base identity of the given data element ID.
// It is assumed (and not checked) that the data element ID appears in
// the dataElements table. If the data element entry does not carry an
// identity, the element ID is returned (this is the default identity).

DataElements.prototype.getBaseIdentity = 
    dataElementsGetBaseIdentity;

function dataElementsGetBaseIdentity(elementId)
{
    var entry = this.dataElements.getSecond(elementId);
    return entry.identity === undefined ? elementId : entry.identity;
}

// This function returns the base identities of the given data element IDs
// (an array of element IDs). It is assumed (and not checked) that all
// these data element IDs appear in the dataElements table.

DataElements.prototype.getBaseIdentities = 
    dataElementsGetBaseIdentities;

function dataElementsGetBaseIdentities(elementIds)
{
    var identities = [];
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(elementId === undefined)
            identities.push(undefined);
        else {
            var entry = this.dataElements.getSecond(elementId);
            identities.push(entry.identity === undefined ?
                            elementId : entry.identity);
        }
    }

    return identities;
}

// This function assigns the base identity to a data element node created
// just now. It may also modify the identity of its sibling node if that
// node was until now an only child of its parent (but now this new
// node was added is no single child anymore). Since the data element
// is new, it cannot have any children.
// In case 'identity' is not undefined, this is the identity assigned to
// the node. If it is undefined, the function must first check whether
// this node is the only child of its parent (if it has a parent). If it
// is, the identity of the parent is assigned to it. Otherwise, its
// data element ID is assigned as its identity.
// If this is the second child of its parent, this function also checks
// whether the identity of its sibling has to be updated (if it is
// the default identity, it should change from being equal to the identity 
// of its parent to being equal to its own data element ID).
// Since this function is called when the data element is created,
// the calling function provides it with all the entries in the
// dataElements table it needs: 'elementEntry' is the entry of
// the element just added, with ID 'elementId'. If this data element
// has a parent, the parent's entry is given in 'parentEntry'.
// In this case, 'pathChildren' is the entry in the 'children' table
// of the parent entry for the path of the new data element being added.
// Because the node is new, there is no need to notify of the 
// new identity (no one can be using the identity of this 
// data element yet) and the update can take place immediately. However,
// if the identity of the sibling is updated (and some module has to be
// notified of changes at its path) a notification is queued and the update
// will only take place when the notifications are sent.
// The 'elementEntry' provided is the default entry for this element (the
// one shared with element IDs with the same path and parent (and possibly
// group ID, etc.). If this function discovered that the identity assigned
// here is not the element ID itself, it creates a new element entry for this
// data element. This entry is returned by this function (otherwise,
// the original elementEntry is returned).

DataElements.prototype.setBaseIdentityForNewNode = 
    dataElementsSetBaseIdentityForNewNode;

function dataElementsSetBaseIdentityForNewNode(elementId, elementEntry, 
                                               parentEntry, pathChildren, 
                                               identity)
{
    if(identity === undefined) {
        if(this.useDefaultIdentities && parentEntry &&
           pathChildren.ids.size == 1) {
            // only child, inherits the identity of the parent
            // Therefore, cannot continue with the default element entry
            elementEntry = this.newDataElementEntry(elementEntry.pathId,
                                                    elementEntry.parent,
                                                    elementEntry, elementId);
            elementEntry.identity = parentEntry.identity;
        }
        // otherwise, no need to change the default settings
    } else if(!this.useDefaultIdentities && identity === elementId &&
              elementEntry.defaultIdentity === undefined) {
        // this identity does not need to be stored and the element entry
        // is the default element entry
        return elementEntry;
    } else {
        elementEntry = this.newDataElementEntry(elementEntry.pathId,
                                                elementEntry.parent,
                                                elementEntry, elementId);
        elementEntry.defaultIdentity = false;
        elementEntry.identity = identity;
    }

    if(this.useDefaultIdentities &&
       pathChildren !== undefined && pathChildren.ids.size == 2) {
        // this is the second node added under the parent data element
        // at this path. This means that the previous sibling is 
        // now no longer the only child at this path. If it has the default
        // identity, this should now be updated.
        var _self = this;
        pathChildren.ids.forEach(function(t,childId) {
            if(childId == elementId)
                return; // the newly added child
            // the other child
            _self.verifyDefaultBaseIdentity(childId, 2);
        });
    }

    return elementEntry;
}

// By calling this function, one can reset the identity of an existing
// data element to the default identity.

DataElements.prototype.assignDefaultBaseIdentity = 
    dataElementsAssignDefaultBaseIdentity;

function dataElementsAssignDefaultBaseIdentity(elementId)
{
    this.setBaseIdentityForExistingNode(elementId, undefined);
}

// This function is used to set a new base identity on an existing
// data element. If the given 'identity' is undefined, the 
// default identity is set on the node.
// If notifications need to be sent for this update, the update is
// merely queued. Otherwise, it is carried out immediately.
// It may be that this change requires a new data element entry to
// be created for this data element (in case the default entry was
// used so far but the identity is no longer the default identity).

DataElements.prototype.setBaseIdentityForExistingNode = 
    dataElementsSetBaseIdentityForExistingNode;

function dataElementsSetBaseIdentityForExistingNode(elementId, identity)
{
    var entry = this.dataElements.getSecond(elementId);

    if(entry === undefined)
        return;

    if(this.indexer.notificationRequired(entry.pathId, 0)) {
        // queue the update
        this.addBasePendingIdentity(elementId, entry.pathId, identity);
        return;
    }

    // can update immediately
    
    if(identity === undefined) {
        if(entry.defaultIdentity !== false)
            return; // already set to the default identity
        // set to the default identity
        entry.defaultIdentity = true;
        if(entry.parent === undefined)
            identity = entry.identity = elementId;
        else {
            
            var parentEntry = this.dataElements.getSecond(entry.parent);
            if(this.useDefaultIdentities &&
               parentEntry.children.get(entry.pathId).ids.size == 1)
                // this is an only child, so the default identity is
                // inherited from the parent
                identity = parentEntry.identity;
            else 
                identity = elementId;
        }
    } else if(!this.useDefaultIdentities && identity === elementId &&
              entry.defaultIdentity === undefined) {
        // this identity does not need to be stored and the element entry
        // is the default element entry
        return;
    } else if(entry.defaultIdentity !== false) {
        // make sure the entry is not the default entry
        entry = this.getNonDefaultElementEntry(elementId, entry);
        entry.defaultIdentity = false;
    }

    if(entry.identity == identity)
        return; // no change

    entry.identity = identity;

    if(this.useDefaultIdentities)
        this.updateSingleChildrenWithIdentity(entry);
}

// This function is called after the identity of the data element 
// whose entry in the dataElements table is 'elementEntry' has been
// updated. It then checks whether it has any children which are 
// single children. For such children, the identity assigned to them
// may need to be corrected, since if they have a default base identity 
// they inherit their identity from the parent ('elementEntry').
// The verification may either be postponed (if notifications need to
// be sent for updates) are carried out immediately, in which case
// the child's identity may be updated here.

DataElements.prototype.updateSingleChildrenWithIdentity = 
    dataElementsUpdateSingleChildrenWithIdentity;

function dataElementsUpdateSingleChildrenWithIdentity(elementEntry)
{
    // find single children of this node

    if(elementEntry.children === undefined)
        return;

    var _self = this;
    elementEntry.children.forEach(function(pathChildren, pathId) {

        var childIds = pathChildren.ids;
        
        if(childIds.size != 1)
            return; // not a single sibling
        
        // get the child ID (a single iteration loop)

        childIds.forEach(function(t,childId) {
            _self.verifyDefaultBaseIdentity(childId, 1);
        });
    });
}

// This function should be called when the number of siblings of 'elementId'
// changes or when the base identity of the parent changes and 'elementId'
// has no siblings. 'numSiblings' is the number of siblings including
// 'elementId' (so this must be at least 1).
// In such situations, if 'elementId' is assigned the default base identity,
// its identity may change.
// If notifications should be sent for identity updates of 'elementId',
// the default base identity verification is scheduled (if the node
// has a default identity, otherwise, there is no need to schedule as
// any subsequent change to default identity would itself be scheduled).
// If no notifications need to be sent, the update can take place immediately.
// If this resulted in a change to the base identity, verification
// needs to continue to the children of this element ID which have
// no siblings.

DataElements.prototype.verifyDefaultBaseIdentity =
    dataElementsVerifyDefaultBaseIdentity;

function dataElementsVerifyDefaultBaseIdentity(elementId, numSiblings)
{
    if(!this.useDefaultIdentities)
        return;
    
    var elementEntry = this.dataElements.getSecond(elementId);

    if(elementEntry.defaultIdentity === false)
        return; // not default identity, so no update
    
    if(elementEntry.parent === undefined)
        return; // default identity does not depend on structure
    
    if(this.indexer.notificationRequired(elementEntry.pathId, 0)) {
        // queue the update
        this.addBasePendingIdentity(elementId, elementEntry.pathId, undefined,
                                    true);
        return;
    }

    // applly the update immediately

    var identity;
    
    if(numSiblings > 1) {
        // should get its own element ID as identity
        if(elementEntry.defaultIdentity === undefined || // default entry
           elementEntry.identity === elementId)
            return;
        identity = elementEntry.identity = elementId;
    } else {
        // make sure the entry is not the default entry
        elementEntry = this.getNonDefaultElementEntry(elementId, elementEntry);
        var parentEntry = this.dataElements.getSecond(elementEntry.parent);
        if(elementEntry.identity === parentEntry.identity)
            return; // nothing change
        identity = elementEntry.identity = parentEntry.identity;
    }

    // check whether there are children which may be affected by this change

    this.updateSingleChildrenWithIdentity(elementEntry);
}

////////////////////////////////////////
// Base Identity Update Notifications //
////////////////////////////////////////

// This function adds a pending base identity to the list of pending identities.
// 'elementId' is the element for which the pending identity is added and
// 'pathId' should be the path at which the data element is defined.
// 'identity' is the new base idnetity for this element ID. This may
// be undefined (the default identity).
// If 'verify' is true, 'identity' is ignored and
// a verification update is registered (when the updates are applied, this
// checks whether the base identity is the default identity and if yes,
// makes sure the correct default identity is applied).

DataElements.prototype.addBasePendingIdentity =
    dataElementsAddBasePendingIdentity;

function dataElementsAddBasePendingIdentity(elementId, pathId, identity,
                                            verify)
{
    var pendingEntry;

    if(!this.pendingBaseIdentities.has(elementId)) {
        if(verify)
            pendingEntry = { pathId: pathId, verify: true };
        else
            pendingEntry = { pathId: pathId, identity: identity };
        this.pendingBaseIdentities.set(elementId, pendingEntry);
    } else if(!verify) {
        // if only verification is required and there is a pending update
        // already, there is no need to add anything (the verification will
        // take place when the update is processed).
        pendingEntry = this.pendingBaseIdentities.get(elementId);
        pendingEntry.identity = identity;
        penidngEntry.verify = undefined;
    }

    this.indexer.scheduleIdentityUpdate();
}

// This function returs true if there are some pending base identity updates
// and false otherwise.

DataElements.prototype.hasPendingBaseIdentities =
    dataElementsHasPendingBaseIdentities;

function dataElementsHasPendingBaseIdentities()
{
    return this.pendingBaseIdentities.size > 0;
}

// This function goes over all pending base identity updates in the
// 'this.pendingBaseIdentities' and determines for each pending element ID
// the new identity for that element ID (taking into account number of
// siblings, etc., as appropriate) and whether it has changed.
// This function already sets the 'defaultIdentity' property of the
// data elements, but does not update the actual identity yet.
// Those identities which have changed are stored in update arrays,
// one for each path ID (of the data elements). The returned structure
// has the following structure:
// <Map>{
//    <path ID>: {
//        elementIds: <array of element IDs>,
//        identities: <array of identities for the corresponding element IDs>
//    }
//    .....
// }
// If there are not pending base identities, this function returns undefined.

DataElements.prototype.createBaseIdentityNotifications =
    dataElementsCreateBaseIdentityNotifications;

function dataElementsCreateBaseIdentityNotifications()
{
    if(this.pendingBaseIdentities.size == 0)
        return undefined;
    
    var baseNotifications = new Map(); // by path ID
    var queuePathId;
    var baseQueue;
    
    var _self = this;
    
    this.pendingBaseIdentities.forEach(function(update, elementId) {

        var elementEntry = _self.dataElements.getSecond(elementId);
        if(elementEntry === undefined)
            return; // was removed since the identity update was queued

        if(update.verify && elementEntry.defaultIdentity === false)
            return; // no need to verify non-default identities

        var newIdentity = update.verify ? undefined : update.identity;
        var isDefault = false;
        
        if(newIdentity === undefined) {
            isDefault = true;
            // determine the default identity
            if(elementEntry.parent === undefined ||
               _self.dataElementHasSiblings(elementId))
                newIdentity = elementId;
            else
                newIdentity = _self.getBaseIdentity(elementEntry.parent);
        }

        if(newIdentity === elementEntry.identity) {
            // identity did not change
            elementEntry.defaultIdentity = isDefault;
            return;
        }

        if(isDefault && newIdentity === elementId &&
           elementEntry.defaultIdentity === undefined)
            // default element entry and identity unchanged
            return;
        
        // queue the identity for update under its path ID
        if(elementEntry.pathId != queuePathId) {
            if(baseNotifications.has(elementEntry.pathId))
                baseQueue = baseNotifications.get(elementEntry.pathId);
            else {
                baseQueue = { elementIds: [], identities: [] };
                baseNotifications.set(elementEntry.pathId, baseQueue);
            }
            queuePathId = elementEntry.pathId;
        }
        baseQueue.elementIds.push(elementId);
        baseQueue.identities.push(newIdentity);
    });

    this.pendingBaseIdentities = new Map();
    
    return baseNotifications;
}

// This function is called by the identity indexer's notification function
// once it completed notfying all relevant modules of changes in the
// base identity of the element IDs given in the array 'elementIds'.
// These identities (provided in the array 'identities') can now be registered
// to the data element entries, which is what this function does.

DataElements.prototype.setNotifiedBaseIdentities =
    dataElementsSetNotifiedBaseIdentities;

function dataElementsSetNotifiedBaseIdentities(elementIds, identities)
{
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var elementId = elementIds[i];
        var identity = identities[i];
        var elementEntry = this.dataElements.getSecond(elementId);

        // make sure the entry is not the default entry
        // (a notification here implies that the identity changes, so this
        // cannot remain the default identity).
        elementEntry = this.getNonDefaultElementEntry(elementId, elementEntry);
        
        elementEntry.identity = identity;
        
        if(this.useDefaultIdentities && elementEntry.children !== undefined)
            this.updateSingleChildrenWithIdentity(elementEntry);
    }
}

////////////////////////////////////
// Access to Data Element Entries //
////////////////////////////////////

// returns true if the given element ID appears in the data element list.

DataElements.prototype.hasEntry = dataElementsHasEntry;

function dataElementsHasEntry(elementId)
{
    return this.dataElements.has(elementId);
}

// Returns the entry of the given data element ID. Returns undefined if
// not found.

DataElements.prototype.getEntry = dataElementsGetEntry;

function dataElementsGetEntry(elementId)
{
    return this.dataElements.getSecond(elementId);
}

// Returns the ID of the parent of the given element ID. This may be undefined
// if either the given element ID is not in the table or does not have
// a parent.

DataElements.prototype.getParentId = dataElementsGetParentId;

function dataElementsGetParentId(elementId)
{
    var entry = this.dataElements.getSecond(elementId);

    if(entry !== undefined)
        return entry.parent;

    return undefined;
}

// Returns the path ID of the given element ID. Returns undefined if the
// element ID does not appear in the table.

DataElements.prototype.getPathId = dataElementsGetPathId;

function dataElementsGetPathId(elementId)
{
    var entry = this.dataElements.getSecond(elementId);

    if(entry !== undefined)
        return entry.pathId;

    return undefined;
}


/////////////////////////////
// Data Element Properties //
/////////////////////////////

// This function returns true if the given data element has siblings, that
// is, whether there are other data elements with the same parent data element
// and at the same path. The function returns false if the given data element
// is (no longer) in the indexer's data element table.
// When the given data element has no parent, this function always returns
// true, since such a data element is always treated as if it has siblings.

DataElements.prototype.dataElementHasSiblings = 
	dataElementsDataElementHasSiblings;

function dataElementsDataElementHasSiblings(elementId)
{
    var entry = this.dataElements.getSecond(elementId);

    if(!entry)
        return false;
    
    if(entry.parent === undefined)
        // top data element, always behaves as if it has siblings
        return true;

    // get the parent and check the number of children it has under
    // the path of this child data element
    var parentEntry = this.dataElements.getSecond(entry.parent);
    return parentEntry.children.get(entry.pathId).ids.size > 1;
}

/////////////////////////////////////////////////
// Access to Data Element Domination Structure //
/////////////////////////////////////////////////

// This function returns teh number of direct child data elements
// at path 'childPathId' of data element 'elementId'. This counts only
// data elements defined at 'childPathId' which are direct children
// of 'elementId' (no intermediate data elements).
// The count here includes child data elements which were already released
// (their reference count dropped to zero) but were not removed yet.

DataElements.prototype.getNumDirectChildDataElements =
    dataElementsGetNumDirectChildDataElements;

function dataElementsGetNumDirectChildDataElements(elementId, childPathId)
{
    var elementEntry = this.dataElements.getSecond(elementId);

    if(elementEntry === undefined || elementEntry.children === undefined ||
       !elementEntry.children.has(childPathId))
        return 0;

    return elementEntry.children.get(childPathId).ids.size;
}

// This function returns an array with all the direct child data elements
// at path 'childPathId' of data element 'elementId'. This means that the
// returned element IDs are all of data elements defined at 'childPathId'
// and that they are direct children of 'elementId' (no intermediate data
// elements).
// These children include children whose reference count dropped to zero
// but were not yet removed.
// This function returns undefined if no such children exist.

DataElements.prototype.getDirectChildDataElements =
    dataElementsGetDirectChildDataElements;

function dataElementsGetDirectChildDataElements(elementId, childPathId)
{
    var elementEntry = this.dataElements.getSecond(elementId);

    if(elementEntry === undefined || elementEntry.children === undefined ||
       !elementEntry.children.has(childPathId))
        return undefined;

    var childIds = elementEntry.children.get(childPathId).ids;
    var children = [];

    childIds.forEach(function(t, childId) {
        children.push(childId);
    });

    return children;
}

// This is identical to 'getDirectChildDataElements()' except that
// 'getDirectChildDataElements()' returns an array of data element IDs
// while this function returns the set of child element IDs as
// a Map object (whose keys are the child element IDs). The calling
// function is not allowed to modify the returned Map object.
// These children include children whose reference count dropped to zero
// but were not yet removed.

DataElements.prototype.getDirectChildDataElementsAsObj = 
	dataElementsGetDirectChildDataElementsAsObj;

function dataElementsGetDirectChildDataElementsAsObj(elementId, childPathId) 
{
    var elementEntry = this.dataElements.getSecond(elementId);

    if(elementEntry === undefined || elementEntry.children === undefined ||
       !elementEntry.children.has(childPathId))
        return undefined;

    return elementEntry.children.get(childPathId).ids;
}

// Given a data element ID and a path ID, this function checks whether
// this data element has direct data element children at this path
// and returns true if it does and false if it doesn't. 
// These must be direct children of this node, so if there are any 
// intermediate children at higher paths this function will return nothing.
// Specifically, even if 'elementId' defined a node at the immeidate
// prefix path of 'childPathId' but is an operator, this function will 
// return false.
// These children include children whose reference count dropped to zero
// but were not yet removed.

DataElements.prototype.hasDirectChildDataElements = 
	dataElementsHasDirectChildDataElements;

function dataElementsHasDirectChildDataElements(elementId, childPathId)
{
	var entry;

    var elementEntry = this.dataElements.getSecond(elementId);

    if(elementEntry === undefined || elementEntry.children === undefined ||
       !elementEntry.children.has(childPathId))
        return false;

    return true;
}

// Given a data element ID, this function returns all data elements dominated 
// by it, in a depth-first ordering. The result is returned in an array.
// 'elementId' is not included in the returned array.
// If a 'result' array is provided as argument, the function appends 
// the dominated data elements to the 'result' array and returns that array.
// Otherwise,the function creates a new array and returns it (the array
// may be empty).
// These data elements include data elements whose reference count dropped
// to zero but were not yet removed.

DataElements.prototype.getAllDominatedDataElements = 
	dataElementsGetAllDominatedDataElements;

function dataElementsGetAllDominatedDataElements(elementId, result)
{
	if(result === undefined)
        result = [];

    var entry;

	if(!(entry = this.dataElements.getSecond(elementId)) || 
       !(entry = entry.children))
        return result;

    var _self = this;
    entry.forEach(function(pathEntry, pathId) {
        pathEntry.ids.forEach(function(t, childElementId) {
            result.push(childElementId);
            _self.getAllDominatedDataElements(childElementId, result);
        });
    });

	return result;
}

// Given a child path ID 'childPathId' and one or more data element
// IDs 'elementIds' (an array of data element IDs) this function returns
// an array of the data element IDs
// of all data elements which are lowest data elements on the given
// child path and are dominated by the given data element(s).
// One must provide a path 'minPathId' at which all the data element IDs
// in 'elementIds' are lowest data elements (that is, there is no data
// element dominated by these data elements whose path is a prefix of
// 'minPathId'). This allows the search to begin at this path.
// If any of the given data element is lower than the given child path, 
// it is returned.
// The search is performed by first creating the list of prefix paths
// of 'childPathId' which also extend 'minPathId' (or the path of the single
// data element in 'elementIds').
// We then loop over these prefixes in increasing order (short prefixes
// first) collecting all child nodes of the given data elements at 
// the given prefix. Once such children are found, the original 
// data elements are removed from the search and the search continue on
// the children. When no more new children can be found, the remaining 
// search list is the result of the function.
// Note: a data element ID is returned if it is lowest at the child path
// node even if no node under that data element ID 
// actually exists at the child path (but such a node could be added).
// Therefore, the fact that a data element ID is returned in this list does not 
// indicate that there actually is a node at the given child path node
// under this data element ID. It only indicates that if there is a
// node at this path node, dominated by any of the input data elements
// then its data element ID will be in the returned list.
// Moreover, these data elements include data elements whose reference count
// dropped to zero but were not yet removed.

DataElements.prototype.getChildDataElements = 
	dataElementsGetChildDataElements;

function dataElementsGetChildDataElements(childPathId, elementIds, minPathId)
{
    var result = [];
    var candidates = [];
    var entries = []; // entries of the candidates
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        var elementEntry = this.dataElements.getSecond(elementId);
        if(elementEntry.children === undefined)
            result.push(elementId); // has no children
        else {
            candidates.push(elementId);
            entries.push(elementEntry);  // entries of the candidates
        }
    }
    
    if(candidates.length == 0)
        return result;

    // create the prefix list
    var prefixes = [];
    var prefixId;

    for(prefixId = childPathId ; prefixId > minPathId ; 
        prefixId = this.indexer.qcm.getPrefix(prefixId)) {
        if(this.countByPath.has(prefixId))
            prefixes.push(prefixId);
    }

    if(this.indexer.pathHasOperands(minPathId, true))
        // may have operands under these nodes, must also add minPathId itself
        prefixes.push(minPathId);
    
    var start = 0; // position in the array where the candidates begin
    var children, id;
    var _self = this;
    
    for(var i = prefixes.length - 1 ; i >= 0 ; --i) {
        prefixId = prefixes[i];
        var hasOperands = (prefixId === minPathId ||
                           this.indexer.pathHasOperands(minPathId, true));
        // the length of the candidate list my increase, but, except
        // for at prefix paths with operands, we only loop over the
        // elements which were there before the step started (the
        // others were added for that prefix)
        for(var c = start, l = candidates.length ; c < l ; ++c) {
            var entry = entries[c];
            if(!entry.children.has(prefixId))
                continue; // no children at this path
            children = entry.children.get(prefixId);
            // remove the current candidate (by copying the first candidates
            // to it - it may be one and the same - and advancing the start
            // position) and add its children.
            if(c != start) {
                candidates[c] = candidates[start];
                entries[c] = entries[start];
            }
            start++;
            if(prefixId == childPathId && !hasOperands) {
                children.ids.forEach(function(t, id) {
                    result.push(id);
                });
            } else {
                children.ids.forEach(function(t, id) {
                    entry = _self.dataElements.getSecond(id);
                    if(entry.children === undefined)
                        result.push(id);
                    else {
                        candidates.push(id);
                        entries.push(entry);
                        if(hasOperands)
                            l++; // need to check if has operand children.
                    }
                });
            }
        }
    }

    // push the remaining candidates (beginning at 'start') at the end of 
    // the result list.
    result = cconcat(result, candidates.slice(start));
    return result;
}

// This function receives an array of element IDs which are at or above
// some prefix path P and a list (array) of path IDs ('pathIds') which all
// have this prefix path P as a prefix. The function attempts to lower the
// given data elements to the given paths, that is, it tries to find all
// children of the given data elements at the given paths. The function
// assumes two things:
// 1. for every path x which appears in the list 'pathIds', if there 
//    are data elements at path x and these have a parent at path y which is 
//    not a prefix of P then y is also included in 'pathIds'. 
// 2. The element IDs in 'elementIds' are already lowered to P, that is,
//    for each element d in 'elementIds', if d has a child, then this
//    child has a path which extends P. 
// These two assumptions mean that, for each data element, this function
// only checks whether it has children at the paths in 'pathIds'. When
// such children are found, they are added to the list and the test is
// applied to them too.
// The lowered data elements are appended to the list and the function 
// returns this list.
// These children include children whose reference count dropped to zero
// but were not yet removed.

DataElements.prototype.lowerDataElementsTo = 
	dataElementsLowerDataElementsTo;

function dataElementsLowerDataElementsTo(elementIds, pathIds)
{
    if(pathIds.length == 0)
        return elementIds;

    var dataElements = this.dataElements;

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        
        var elementId = elementIds[i];

        if(!dataElements.has(elementId))
            continue; // data element already destroyed

        var childDataElements = dataElements.getSecond(elementId).children;
        if(childDataElements === undefined)
            continue;
        
        for(var p = 0, lp = pathIds.length ; p < lp ; ++p) {

            var projPathId = pathIds[p];

            if(!childDataElements.has(projPathId))
                continue;
                
            // add at end of the list (may be lowered again)
            var children = childDataElements.get(projPathId);
            children.ids.forEach(function(t, id) {
                elementIds.push(id);
            });
        }
    }

    return elementIds;
}

// This function takes an element ID which is defined at a path which extends
// the path 'pathId'.
// This function then raises this element ID to its lowest parent
// data element ID which is at 'pathId' (this means that if there are
// operators at path 'pathId', element ID will be raised to the operand,
// but will not continue to be raised to the operator, which is defined at
// the same path).

DataElements.prototype.raiseToPath = dataElementsRaiseToPath;

function dataElementsRaiseToPath(elementId, pathId)
{
    var entry;
    while((entry = this.dataElements.getSecond(elementId)).pathId > pathId)
            elementId = entry.parent;

    return elementId;
}

// This function takes an element ID which is defined at a path which extends
// the path 'pathId'.
// This function then raises this element ID to its lowest parent
// data element ID which is at 'pathId' (this means that if there are
// operators at path 'pathId', element ID will be raised to the operand,
// but will not continue to be raised to the operator, which is defined at
// the same path). This function requires, however, that the resulting
// data element be exactly at 'pathId'. If it is not, undefined is returned.

DataElements.prototype.raiseExactlyToPath = dataElementsRaiseExactlyToPath;

function dataElementsRaiseExactlyToPath(elementId, pathId)
{
    var entry;
    while((entry = this.dataElements.getSecond(elementId)).pathId > pathId)
            elementId = entry.parent;

    return entry.pathId == pathId ? elementId : undefined;
}

// This function takes an array of element IDs which are defined at
// paths which extend 'pathId' and raises each
// of them to its lowest parent data element ID which is at 'pathId'
// (this means that if there are operators at path 'pathId', element ID
// will be raised to the operand, but will not continue to be raised to
// the operator, which is defined at the same path).
// The raised element IDs are returned in an array.

DataElements.prototype.raiseAllToPath = dataElementsRaiseAllToPath;

function dataElementsRaiseAllToPath(elementIds, pathId)
{
    var raised = [];
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        var entry;
        while((entry = this.dataElements.getSecond(elementId)).pathId > pathId)
            elementId = entry.parent;
        raised.push(elementId);
    }

    return raised;
}

// 'elementId' is assumed to be dominated by parentElementId (with the
// two possibly equal). This function returns the lowest parent of
// 'elementId' (possibly 'elementId' itself) with siblings which is lower
// than 'parentElementId'. If no such parent is found, 'parentElementId'
// is returned.
// If paretElementId is zero or undefined, this continues all the way
// to the top of the indexer and returns the top data element reached
// if the search does not find an appropriate parent before that.

DataElements.prototype.getLowestParentWithSiblings =
    dataElementsGetLowestParentWithSiblings;

function dataElementsGetLowestParentWithSiblings(elementId, parentElementId)
{
    if(elementId === parentElementId)
        return elementId;
    
    var parentEntry = this.dataElements.getSecond(elementId);

    if(parentElementId === undefined)
        parentElementId = 0;
    
    while(elementId > parentElementId) {

        var entry = parentEntry;

        parentEntry = this.dataElements.getSecond(entry.parent);
        if(parentEntry.parent === undefined ||
           parentEntry.children.get(entry.pathId).ids.size > 1)
            return entry.parent;
        
        elementId = entry.parent;
    }

    return parentElementId;
}

// Returns an array which is an ordered subset of the element IDs in
// 'elementIds' whose path ID is larger than the given path ID.
// Under the assumption that all 'elementIds' are IDs of nodes at a
// path which extends 'prefixPathId' this returns the subset for which
// the data element is defined at a path extending 'prefixPathId'.

DataElements.prototype.filterDataElementsUnderPathId = 
	dataElementsFilterDataElementsUnderPathId;

function dataElementsFilterDataElementsUnderPathId(elementIds, prefixPathId)
{
    if(prefixPathId === undefined)
        return elementIds;

    var filtered = [];
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        var entry = this.dataElements.getSecond(elementId);

        if(entry !== undefined && entry.pathId > prefixPathId)
            filtered.push(elementId);
    }

    return filtered;
}

//
// Sub-Objects
//

//
// Object for storing the direct children of a data element, at a given path.
//

function DataElementPathChildren(parentId, pathId)
{
    this.childDefaultEntry = {
        parent: parentId,
        pathId: pathId
    };

    this.ids = new Uint31HashSet();
}

///////////////////////
// MergeDataElements //
///////////////////////

// MergeDataElements is a derived class of DataElements which is used by
// merge indexers. The main difference is that the entries in the
// data elements of the merge indexer contain additional fields (to store
// relevant source information). In addition, the default entry objects
// for the data elements are different for each group ID. This means the
// following difference in structure:

// {
//    dataElements: <IntHashPairMapUint>{
//        <data element ID>: [
//             <refrence count>,
//             {
//                 pathId: <number>,
//                 parent: <data element ID>,
//                 identity: <number or string>,
//                 defaultIdentity: true|false  // not on top data elements
//                 children: <Map>{
//                      <path ID>: <MergeDataElementPathChildren>{
//                           childDefaultEntry: <IntHashMap>{
//                               <group ID>: {
//                                   parent: <data element ID>,
//                                   pathId: <path ID>,
//                                   groupId: <group ID>
//                               }
//                               .....
//                           }          
//                           ids: <Uint31HashSet>{
//                               <data element ID>,
//                               ......
//                           },
//                      }
//                      .....
//                 },
//                 groupId: <group ID>,
//                 sourceId: <source ID>
//             }
//           ],
//           ......
//        }
//    }
//    rootDefaultEntry: <IntHashMap>{
//        <group ID>: {
//            pathId: <root path ID>,
//            groupId: <group ID>
//        },
//        ......
//    }

// xxxxxxxxxxxx to do: keep reference count per group for the default entry
// of thet group, so that it can be discarded when no longer needed.
// xxxxxxxxxxxxx

//
// Constructor
//

// Nothing to do here except call the base class constructor and create
// the default entry table

inherit(MergeDataElements, DataElements);

function MergeDataElements(indexer)
{
    this.DataElements(indexer);

    // Merge indexers never use default identities
    this.useDefaultIdentities = false;
    
    // replace the default root element entry by a table (one entry for each
    // group)
    this.rootDefaultEntry = new IntHashMap(4);
}

// overrides the base class implementation

MergeDataElements.prototype.getNewDataElementPathChildren =
    mergeDataElementsGetNewDataElementPathChildren;

function mergeDataElementsGetNewDataElementPathChildren(parentId, pathId)
{
    return new MergeDataElementPathChildren(parentId, pathId);
}

// This function returns the initial entry to be stored for a new data element
// added at the given path under the given parent ID (which may be undefined)
// and for the given group ID. The target element ID (whose entry it is that
// is returned here) and the source ID are also given. If this source ID
// is not undefined and not equal to the data element ID, a new entry needs
// to be created and returned. Otherwise, the default entry for this group,
// parent and path may be used. If 'parentId' is not undefined, 'pathChildren'
// is the MergeDataElementPathChildren object for the children of the given
// parent under the given path. This stored the default entries for
// the different group IDs.

MergeDataElements.prototype.getEntryForNewElement =
    mergeDataElementsGetEntryForNewElement;

function mergeDataElementsGetEntryForNewElement(pathId, parentId, pathChildren,
                                                elementId, groupId, sourceId)
{
    if(sourceId !== undefined && sourceId !== elementId)
        // cannot use the default entry
        return this.newInitialDataElementEntry(pathId, parentId, groupId,
                                               sourceId);

    // can use the default entry. Get it (by group ID)

    var defaultEntries = (parentId === undefined) ?
        this.rootDefaultEntry : pathChildren.childDefaultEntry;
    
    var entry = defaultEntries.get(groupId);
    if(entry)
        return entry;

    entry = {
        pathId: pathId,
        parent: parentId,
        groupId: groupId,
    };

    defaultEntries.set(groupId, entry);
    return entry;
}

// Create a new object to store a data element in the data element table
// This overrides (extends) the default structure defined in the base class.

MergeDataElements.prototype.newInitialDataElementEntry =
    mergeDataElementsNewInitialDataElementEntry;

function mergeDataElementsNewInitialDataElementEntry(pathId, parentId, groupId,
                                                     sourceId)
{
    return {
        pathId: pathId,
        parent: parentId,
        identity: undefined,
        defaultIdentity: false, // merge indexer identities are never default
        children: undefined,

        // fields unique to the merge indexer
        
        groupId: groupId,
        sourceId: sourceId
    };
}

// Create a new object to store a data element in the data element table
// when an existing element entry already exists. The existing entry is given
// in 'elementEntry' and 'elementId' is the element to which the entry
// belongs. If this is not the default entry, this function returns the
// input entry. If it is the default entry, the function creates a new
// entry based on the values in 'elementEntry'.

MergeDataElements.prototype.newDataElementEntry =
    mergeDataElementsNewDataElementEntry;

function mergeDataElementsNewDataElementEntry(pathId, parentId, elementEntry,
                                              elementId)
{
    if(elementEntry.defaultIdentity !== undefined)
        return elementEntry; // not a default entry

    return {
        pathId: elementEntry.pathId,
        parent: elementEntry.parent,
        identity: undefined,
        defaultIdentity: false, // merge indexer identities are never default
        children: undefined,

        // fields unique to the merge indexer
        
        groupId: elementEntry.groupId,
        sourceId: elementId // by default, source ID and target ID equal
    };
}

// Returns the source ID for the given element ID. If the source ID is
// not stored on the element entry, this must be a default entry and
// the source ID is equal to the target ID.

MergeDataElements.prototype.getGroupId =
    mergeDataElementsGetGroupId;

function mergeDataElementsGetGroupId(elementId)
{
    var entry = this.dataElements.getSecond(elementId);
    
    if(entry === undefined)
        return undefined;

    return entry.groupId;
}

// Returns the source ID for the given element ID. If the source ID is
// not stored on the element entry, this must be a default entry and
// the source ID is equal to the target ID.

MergeDataElements.prototype.getSourceId =
    mergeDataElementsGetSourceId;

function mergeDataElementsGetSourceId(elementId)
{
    var entry = this.dataElements.getSecond(elementId);

    if(entry === undefined)
        return undefined;

    return entry.sourceId === undefined ? elementId : entry.sourceId;
}

// This function is given a list of data element IDs which are in this
// data element table and the ID of a path at which there are nodes with
// these data element IDs. It checks which of them were translated, that is,
// the data element ID differs from its source ID. The function returns the
// subset of translated element IDs sorted by their group in a Map with
// the following structure:
//
// <Map>{
//    <group ID>: {
//        dominating: [<array of dominating target IDs>]
//        source: [<array of source IDs>]
//    }
//    ....
// }
// The arrays of dominating IDs are the nodes dominating the input
// element IDs at the parent path of 'pathId'. If an element ID is
// a data element at path 'pathId', this is its dominating parent data
// element (which may be undefined if 'pathId' is the root path). 'source'
// are the source nodes from which the target nodes were mapped.
// Each target ID appear in the entry for the group that mapped it.

MergeDataElements.prototype.filterTranslated =
    mergeDataElementsFilterTranslated;

function mergeDataElementsFilterTranslated(elementIds, pathId)
{
    var byGroup = new Map();
    var groupId;
    var forGroup; // entry for a single group
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var elementId = elementIds[i];
        var entry = this.dataElements.getSecond(elementId);

        if(entry === undefined || entry.sourceId === undefined ||
           entry.sourceId === elementId)
            continue; // source ID is the same as the target ID

        if(entry.groupId !== groupId) {
            groupId = entry.groupId;
            if(byGroup.has(groupId))
                forGroup = byGroup.get(groupId);
            else {
                forGroup = { source: [], dominating: [] };
                byGroup.set(groupId, forGroup);
            }
        }

        forGroup.source.push(entry.sourceId);
        forGroup.dominating.push(entry.pathId === pathId ?
                                 entry.parent : elementId);
    }

    return byGroup;
}

//
// Sub-Objects
//

//
// Object for storing the direct children of a data element, at a given path.
//

function MergeDataElementPathChildren(parentId, pathId)
{
    this.childDefaultEntry = new IntHashMap(4);
    this.ids = new Uint31HashSet();
}
