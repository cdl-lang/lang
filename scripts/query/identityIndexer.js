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


// This class provides another layer in the indexer class hierarchy.
// This specific class takes care of managing identities: receiving 
// updates from the identification function, registering
// requests to receive updates on identity changes and delivering
// those updates.
//
// Identities
// ==========
//
// Data elements have identities. These identities are either negated 
// full compression values (negative numbers) or quick compression 
// values (strings) or data element IDs (positive numbers).
//
// Each data element in an indexer has a base identity. In addition, 
// an identification function may assign an additional identity to
// a subset of data elements (usually, at a given path). These identities are 
// then also stored in the source indexer to which the identification
// function is applied, but under the 'identification ID' which is unique
// to the identification function. In this way, the base identities and
// the additional identities are held separately.
//
// The identity assigned to a data element by an identification function
// is the identity as defined by that function, if defined, and the 
// base identity if no identity is defined by the identification 
// function.
//
// Additional identities may only be based on compression values or 
// IDs allocated from the data element ID pool as identities and therefore
// can no longer be allocated as IDs for data elements. This allows several
// identification functions to use a common set of identities which are
// guaranteed not to be generated anywhere else.
//
// The base identities are stored under the entry for each data element
// in the indexer's 'dataElements' table:
//
// dataElements: {
//    <data element ID>: {
//        identity: <number or string>
//        defaultIdentity: true|false  // not on top data elements
//        // additional fields (from other classes in the hierarchy)
//    }
//    ......
// }
//
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
// The additional identities are stored in the 'additionalIdentities'
// table of the indexer, under the identification ID unique to the relevant
// identification function:
//
// additionalIdentities: <Map>{
//     <identification ID>: <Map>{
//          <data element ID>: <identity>,
//          ......
//     }
//     ......
// }
//
// Updating Base Identities
// ========================
//
// The base identity is updated at each call to the 'addDataElementNode()'
// function. If this function is provided with an identity (one of its 
// arguments), this identity is used. Otherwise, a default identity 
// is calculated based on its data element ID:
// 1. If the data element has a parent and no siblings (another data 
//    element at the same path under the same parent), the base identity 
//    of the data element is equal to the base identity of the parent.
// 2. Otherwise, the base identity of the data element is the data
//    element ID (a positive number).
// If there are no registrations in the 'mappedIdentifications' table of the
// path of the data element whose base identity is modified, the
// base identity can be updated immediately. Otherwise, this update is
// queue and only performed in a batch when the notifications of identity
// changes are sent. This way, the identity registered into the index
// only changes once notifications have been sent (in cases where notifications
// should be sent).
// 
// Updating Additional Identities
// ==============================
//
// The additional identities are provided as the result of a
// function. An IdentityResult object is used as the interface with
// the function. Most of the work is carried out by the IdentityResult
// object. It then uses two function to update the identity indexer 
// with identities:
//
//   addIdentities(<element IDs>, <identities>, <identification ID>,
//                 <no notifications>):
//      this is called with two arrays <element IDs> (of data elements
//      identified by the identification with identification ID 
//      <identification ID>) and <identities> which provides (at the
//      corresponding position) with the identity. If the identity
//      provided is undefined, this is equivalent to removing the
//      identification for that element ID (this probably does not 
//      happen often).
//      <no notifications> can be set to true to indicate that there is
//      no need to send notifications of this identity change (if, for example,
//      the nodes are just being added and it is known that the modules which
//      require the notifications will have these nodes added after the
//      identities are updated).
//   removeIdentities(<element IDs>, <identification ID>, <no notifications>):
//      this indicates that the identification with ID <identification ID>
//      no longer identifies the given data element IDs.
//      <no notifications> can be set to true to indicate that there is
//      no need to send notifications of this identity change (since the
//      nodes are anyway about to be removed).
//
// Each identity result node must first register itself to the 
// identity indexer, by calling the function 
// registerIdentification(<identification ID>, <identity result node>)
// and deregister itself when it is no longer used by calling 
// unregisterIdentification(<identification ID>).
// A call to registerIdentification() returns the number of requests
// for this identification currently registered to this indexer.
// If this is zero, the identification function may decide
// to remain inactive.
//
// Since notifications from the IdentityResult object are batched already,
// we can immediately notify any objects registered for identity updates
// when the identities change (this is as opposed to base identities which
// may be modified one by one and therefore need to be queued before
// sending a notification).
//
// Notifications
// =============
//
// Before updating the identities in the indexer, the identity indexer
// must notify consumers of this information with the update.
// During the update process, the consumer gets the new identity in the
// update, but looking the update up from the identity indexer still
// returns the old identity. The consumer can also check for an arbitrary
// node whether it has any pending identity update.
//
// It is assumed by the consumers that a data element and its parent
// cannot be both modified in the same update. This way, when an update
// is received for either the data element or its parent, the identity
// of the other is either up to date or will be received in a subsequent
// update, when the new identity of this node has already been set
// (this rule is currently satisfied naturally, because an additional
// identification applies at an identified path and updates for the
// default base identities for an additional identification take place
// separately from the non-default identities). Moreover, for base
// identities, the updates are split per path.
//
// There are several types of consumers.
//
// This Indexer:
//
//    For this indexer (if it is a merge indexer) 
//    the identities serve as target identities of mappings to the indexer.
//    Before updating the identity, the updateTargetIdentity() function
//    of the merge indexer must be called, with the new
//    identity. The rest of the work is performed by this function.
//
// Target indexers of mappings with this indexer as source:
//
//    Here, the target indexer must register itself for receiving
//    identity updates for the relevant identifications. A mapping
//    registers such requests by path. A target indexer registers such
//    a request to a path S in the source indexer for identifications
//    used as source identifications in mappings which have S either
//    as a prefix of (possibly equal to) their maximal source path or
//    as an extension of that path.  For the structure of this table
//    ('mappedIdentifications') see below.  This table is updated by
//    MappingQueryCalc or MappingMonitor objects when they are
//    registered to the source indexer. This is done by calling the
//    functions addTracingIdentification(),
//    addMonitoringIdentification(), removeTracingIdentification(),
//    and removeMonitoringIdentification() (the 'tracing' functions
//    are used when registering a MappingQueryCalc object and the
//    'monitoring' functions when registering a MappingMonitor
//    object).  When a MappingQueryCalc is added for the maximal
//    source path, the identification is also added to the prefix
//    paths of the maximal source path. When a MappingMonitor is
//    added, the identification is also added to existing path nodes
//    extending the path to which the monitor is registered.  If later
//    child path nodes are created, they must read the list of
//    'mappedIdentifications' from the parent path node and add those
//    identifications for which 'numMonitors' is not zero.  When the
//    MappingQueryCalc or MappingMonitor objects are unregistered,
//    they also remove their identification registrations.
//
//    When the base identity of a node changes, it is checked which 
//    additional identifications apply to this node but do not 
//    define an explicit identification for the node. In that case, 
//    a notification for an identity change is generated also for 
//    such additional identifications.
// 
//    The identity changes are not necesarily reported immediately to
//    the indexers which use it as a source identification. Rather,
//    the system may queue the updates and push them to the registered
//    indexers in the path epilogue. Only after pushing the updates
//    the new identity becomes available through the 'getIdentity' function
//    of the identity indexer.
//
// Implementation
// ==============
//
// This class adds several tables to the base indexer class at the 
// class object level. In addition, this class requires the addition 
// of certain fields to the 'dataEements' structure of the indexer,
// and the 'pathNode' object. These additions are listed here below.
//
// Tables added to the class object:
// 
// {
//     additionalIdentityResults: {
//         <identification ID>: {
//              requestNum: <number of requests for this identification>,
//              identityResult: <identity result object>
//         }
//         .....
//     }
//     additionalIdentities: <Map>{
//         <identification ID>: <Map>{
//              <data element ID>: <identity>
//              ......
//         }
//         .....
//     }
//
//     identityUpdates: <Map>{
//         <target indexer ID>: {
//             indexer: <source indexer>,
//             refCount: <number>
//         }
//     }
//
//     pendingRemoveAll: <Map>{
//         <identification ID>: true,
//         ......
//     }
//
//     identityUpdatesScheduled: true|false
// }
//
// additionalIdentityResults:
//    This table stores various registration information about the
//    additional identifications. Currently it stores the following 
//    information:
//        requestNum: number of requests made to use this identification.
//           A call to requestIdentification(<identification ID>)
//           increases this counter by 1 and a call to 
//           releaseIdentification(<identification ID>) decreases it
//           by 1. When this counter is zero, no one is intersted
//           in this identification and there is no need to calculate it.
//        identityResult: pointer to the identity result object 
//           which calculates this identification. This may be undefined 
//           if a request for this identification was already registered, 
//           but no function for calculating it was registered yet.
// additionalIdentities: this table holds the additional identities 
//    assigned to data elements in this indexer by identification functions. 
//    Each such identification function has an identification ID 
//    and this table stores the identities assigned by that function 
//    under that identification ID. Under each such identification ID
//    we have a list of data element IDs stored in this indexer and 
//    the identity assigned to it by the identification function.
//    An identification function is not required to assign an identity 
//    to all data elements in the indexer, so this list is only required
//    to hold a subset of the data element IDs.
//
// identityUpdates: this table stores a list of indexers which require
//    identity updates from this identity indexer. Under the ID of
//    each indexer stored in this table we store the indexer object
//    (to which the update should be sent) and a reference count
//    (since multiple requests from a single indexer may be requested).
//
// pendingRemoveAll: this is a table of additional identifications for
//    which a request to remove all explicit identities has been received.
//    These requests are queued and not carried out immediately if there
//    are indexers which need to be sent notifications of identity
//    changes for thi identification. Since such a 'remove all' is
//    received during clean-up operation, we wait a little to give the
//    indexer a chance to remove the relevant nodes (if the nodes are removed,
//    there is no need to send a notification for the idnetity of that node).
//    This removal must take place before any subsequent update of the
//    additional identities.
//    
// identityUpdatesScheduled: this is set to true when the pending identity
//    updates in this indexer are scheduled for delivery and reset to false
//    once the update is flushed.
//
// Additional Fields in the Data Element Table:
// --------------------------------------------
//
// dataElements: {
//     <data element ID>: { // only the additional fields are listed
//         identity: <identity: string or number>
//         defaultIdentity: true|false|undefined
//     }
//     ......
// }
//
// The base identity of the data element is stored here under
// 'identity'.
// 'defaultIdentity' indicates whether this is the default identity or
// whether the identity was set explicitly. This is only needed on 
// data elements which have a parent data element, because these data 
// elements, when they become a single child of the parent need to
// inherit the identity of the parent. false and undefined are considered
// equivalent.
// 
// Additional Fields in the Path Node Object:
// ------------------------------------------
//
// <path node object>: {
//    mappedIdentifications: <Map>{
//        <identification ID>: <Map>{
//             <target indexer ID>: {
//                  numTracing: <reference count>
//                  numMonitors: <reference count>
//             }
//             .....
//        }
//    }
// }
//
// mappedIdentifications:
//    This table is updated by MappingQueryCalc or MappingMonitor objects 
//    when they are registered to the source indexer. This is done by 
//    calling the functions addTracingIdentification(), 
//    addMonitoringIdentification(), removeTracingIdentification(), 
//    and removeMonitoringIdentification() (the 'tracing' functions are
//    used when registering a MappingQueryCalc object and the 
//    'monitoring' functions when registering a MappingMonitor object). 
//    When a MappingQueryCalc is added for the maximal source path,
//    the identification is also added to the prefix paths of the
//    maximal source path. When a MappingMonitor is added, the
//    identification is also added to existing path nodes extending
//    the path to which the monitor is registered.  If later child
//    path nodes are created, they must read the list of
//    'mappedIdentifications' from the parent path node and add those
//    identifications for which 'numMonitors' is not zero.  When the
//    MappingQueryCalc or MappingMonitor objects are unregistered,
//    they also remove their identification registrations.
//    The 'numTracing' and 'numMonitors' are reference counts for the number
//    of times the identification was added to the path as a result
//    of a MappingQueryCalc registration ('numTracing') or of a 
//    MappingMonitor registration ('numMonitors').
//    A <identification ID> of 0 is used for the base identity 
//    (usually identified by an undefined identification ID).

// %%include%%: "internalQCMIndexer.js"
// %%include%%: "identityResult.js"

inherit(IdentityIndexer, InternalQCMIndexer);

/////////////////
// Constructor //
/////////////////

// To construct the identity indexer, all we need is the internal QCM 
// for which it is being constructed.

function IdentityIndexer(internalQCM)
{
    // call the base class constructor
    this.InternalQCMIndexer(internalQCM);

    // initialize tables
    this.additionalIdentityResults = {};
    this.additionalIdentities = new Map();
    this.identityUpdates = new Map();
    this.identityUpdatesScheduled = false;
}

// Destructor.

// There is nothing to do here except for calling the base class destructor.

IdentityIndexer.prototype.destroy = identityIndexerDestroy;

function identityIndexerDestroy()
{
    this.InternalQCMIndexer_destroy();
}

// This function is required by the interface of the base class, but there
// is nothing to do here

IdentityIndexer.prototype.pathNodeActivated = identityIndexerPathNodeActivated;

function identityIndexerPathNodeActivated()
{
    return;
}

// This function is required by the interface of the base class, but there
// is nothing to do here

IdentityIndexer.prototype.pathNodeDeactivated =
    identityIndexerPathNodeDeactivated;

function identityIndexerPathNodeDeactivated()
{
    return;
}

//////////////////////////
// Access to Identities //
//////////////////////////

// This function returns the identity assigned by this identity indexer
// to the given element ID under the given identification. If identificationId
// is undefined, the base identity for the element ID is returned.
// In case an additional identification is requested, this function checks
// whether an additional identity is explicitly defined for the given element.
// If yes, it is returned. If not, the base identity is returned.

IdentityIndexer.prototype.getIdentity = 
    identityIndexerGetIdentity;

function identityIndexerGetIdentity(identificationId, elementId)
{
    var identity;
    
    if(identificationId !== undefined) {
        if((identity = 
            this.getAdditionalIdentity(identificationId,
                                       elementId)) !== undefined)
            return identity; // an additional identity is defined
    }

    // return the base identity
    return this.dataElements.getBaseIdentity(elementId);
}

// This function is identical to getIdentity() except that it returns
// an array of identities for an array of element IDs given in the
// array elementIds.

IdentityIndexer.prototype.getIdentities = 
    identityIndexerGetIdentities;

function identityIndexerGetIdentities(identificationId, elementIds)
{
    var identities = [];
    var identificationEntry;

    if(identificationId &&
       (identificationEntry = 
        this.additionalIdentities.get(identificationId)) !== undefined) {

        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(elementId === undefined) {
                identities.push(undefined);
                continue;
            }
            var identity = identificationEntry.get(elementId);
            if(identity === undefined) // use base identity
                identities.push(this.dataElements.getBaseIdentity(elementId));
            else
                identities.push(identity);
        }

        return identities;
        
    }
    
    // return the base identities
    return this.dataElements.getBaseIdentities(elementIds);
}

// This function returns the base identity of the given data element ID.
// It is assumed (and not checked) that the data element ID appears in
// the dataElements table.

IdentityIndexer.prototype.getBaseIdentity = 
    identityIndexerGetBaseIdentity;

function identityIndexerGetBaseIdentity(elementId)
{
    return this.dataElements.getBaseIdentity(elementId);
}

// Returns the additional identity of the given data element ID assigned
// to it by the identification function with the given ID.
// If this identification function does not define an additional identity
// for this node, this function returns undefined.
// This function should not usually be called by external modules
// (as it returns undefined if the additional identity is not explicitly
// defined). Use getIdentity() instead.

IdentityIndexer.prototype.getAdditionalIdentity = 
    identityIndexerGetAdditionalIdentity;

function identityIndexerGetAdditionalIdentity(identificationId, elementId)
{
    var identificationEntry;

    if((identificationEntry = 
        this.additionalIdentities.get(identificationId)) === undefined)
        return undefined;

    return identificationEntry.get(elementId); // may be undefined
}

// For an additional identity whose ID is 'identificationId', this function
// returns the full table of identities. This is an object whose attributes
// are element IDs and whose values are identities (under the given
// identification) of those element IDs. The object returned is the identity
// table as stored inside the identity indexer, so it should not be modified.
// This function does not apply to the base identity.

IdentityIndexer.prototype.getAllIdentities = 
    identityIndexerGetAllIdentities;

function identityIndexerGetAllIdentities(identificationId)
{
    return this.additionalIdentities.get(identificationId);
}

//////////////////////////
// Base Identity Update //
//////////////////////////

// By calling this function, one can reset the identity of an existing
// data element to the default identity.

IdentityIndexer.prototype.assignDefaultBaseIdentity = 
    identityIndexerAssignDefaultBaseIdentity;

function identityIndexerAssignDefaultBaseIdentity(elementId)
{
    this.dataElements.assignDefaultBaseIdentity(elementId);
}

// This function is used to set a new base identity on an existing
// data element. If the given 'identity' is undefined, the 
// default identity is set on the node.
// If notifications need to be sent for this update, the update is
// merely queued. Otherwise, it is carried out immediately.

IdentityIndexer.prototype.setBaseIdentityForExistingNode = 
    identityIndexerSetBaseIdentityForExistingNode;

function identityIndexerSetBaseIdentityForExistingNode(elementId, identity)
{
    this.dataElements.setBaseIdentityForExistingNode(elementId, identity);
}

///////////////////////////////////
// Identity Update Notifications //
///////////////////////////////////

// This should be called when an identity has changed and notifications
// are required. This function then schedules the identity update
// process (which will send the required notification). If an identity
// update is already scheuled, this function does nothing.

IdentityIndexer.prototype.scheduleIdentityUpdate =
    identityIndexerScheduleIdentityUpdate;

function identityIndexerScheduleIdentityUpdate()
{
    if(!this.identityUpdatesScheduled)
        this.qcm.scheduleIdentityUpdate(this);
}

// This function is called to take all pending base identities, send
// notifications of their change to indexers which require such a notification
// and then write the new base identity into the data element table.
// This function also checks whether the change in base identities also
// affects some additional identities (if an additional identity does not
// define an explicit value for a data element ID, the additional identity
// for that data element ID is its base identity). Notifications are also
// sent the additional identity changes.
// If, as a result of base identity changes, additional base identities change
// (because a single child of a data element inherits its base identity)
// those identity changes are scheduled in the pending base identity
// table (of the data element object) and those updates are processed
// immediately after the previous updates were processed.

IdentityIndexer.prototype.notifyBaseIdentities =
    identityIndexerNotifyBaseIdentities;

function identityIndexerNotifyBaseIdentities()
{
    // create the base identity update lists (split by path ID)
    // and then the additional identity updates for default additional
    // identities (which are equal to the base identity).

    var baseNotifications = this.dataElements.createBaseIdentityNotifications();

    if(baseNotifications === undefined)
        return; // nothing to do
    
    // apply updates per path ID

    var _self = this;
    baseNotifications.forEach(function(update, pathId) {

        // first, send notifications for additional identifications
        // affected by this update
        var additional;
        if((additional = _self.createDefaultAdditionalNotifications(update)) !=
           undefined) {
            for(var i = 0, l = additional.length ; i < l ; ++i) {
                var notification = additional[i];
                _self.notifyOfAddedIdentities(notification.elementIds, pathId,
                                              notification.identities,
                                              notification.identificationId);
            }
        }
        
        // send notifications for base identities
        _self.notifyOfAddedIdentities(update.elementIds, pathId,
                                      update.identities, 0);
        
        // update the base idnetities
        
        _self.dataElements.setNotifiedBaseIdentities(update.elementIds,
                                                     update.identities);
    });

    if(this.dataElements.hasPendingBaseIdentities())
        // new pending base identities must have been added as a result
        // of updating the identities of parent data elements.
        this.notifyBaseIdentities();
}

// Given base identity notifications for a given path in an object of the
// form: { elementIds: <array>, identities: <array> }, this function checks
// whether this has any influence on additional identities.
// This applies to additional identities for which there is no explicit
// identity value defined.
// The function returns an array containing objects of the form:
// {
//     identificationId: <identification ID>, // additional identification ID
//     elementIds: <array of element IDs>
//     idnetities: <array of new idnetities for these element IDs>
// }
// The function returns undefined if there are no additiona identities.

IdentityIndexer.prototype.createDefaultAdditionalNotifications =
    identityIndexerCreateDefaultAdditionalNotifications;

function identityIndexerCreateDefaultAdditionalNotifications(baseNotifications)
{
    if(this.additionalIdentities.size == 0)
        return undefined; // no additional identities

    var _self = this;
    var additionalNotifications = [];
    
    this.additionalIdentities.forEach(function(identities, identificationId) {

        var elementIds = [];
        var newIdentities = [];
        
        for(var i = 0, l = baseNotifications.elementIds.length ; i < l ; ++i) {
            var elementId = baseNotifications.elementIds[i];
            if(identities.has(elementId))
                continue; // has an explicit additional identity
            elementIds.push(elementId);
            newIdentities.push(baseNotifications.identities[i]);
        }

        if(elementIds.length > 0)
            additionalNotifications.push({ identificationId: identificationId,
                                           elementIds: elementIds,
                                           identities: newIdentities });
    });

    return additionalNotifications;
}

// This function is called when the identities for identification
// 'identificationId' (which be an additional identification or the base
// identification, in which case 'identificationId' should be 0)
// have changed for the element IDs given in the array 'elementIds'.
// 'identities' is the array of the new identities (for the element ID at
// the correpsonding position in the 'elementIds' array). It is assumed
// that none of these identities is undefined (a different function needs
// to be called in that case).
// This function checks which indexers need to be notified of this change
// and then passes its arguments on to the indexers which need to be
// refreshed.
// To determine which indexers are to be notified, this function
// needs the path ID at which the identification applies (all given element IDs
// must be defined at that path). This path is given by 'identifiedPathId'.
// 'noNotification' can be set by the calling function to true to indicate
// that there is no need to send notifications of this identity change (for
// example, if the nodes are just being added and it is known that the
// modules which require the notifications will have these nodes added
// after the identities are updated). This applies only to source identification
// and not to target identification.

IdentityIndexer.prototype.notifyOfAddedIdentities =
    identityIndexerNotifyOfAddedIdentities;

function identityIndexerNotifyOfAddedIdentities(elementIds, identifiedPathId,
                                                identities, identificationId,
                                                noNotification)
{    
    if(this.requiresTargetIdentification !== undefined &&
       this.requiresTargetIdentification(identifiedPathId, identificationId))
        this.updateTargetIdentities(elementIds, identities, identificationId);

    if(noNotification)
        return;
    
    var pathNode = this.pathNodesById[identifiedPathId];
    
    if(pathNode.mappedIdentifications.size == 0 ||
       !pathNode.mappedIdentifications.has(identificationId))
        // no requests for notification for this identification
        return;

    var indexers = pathNode.mappedIdentifications.get(identificationId);
    var _self = this;
    indexers.forEach(function(entry, indexerId) {
        var indexer = _self.identityUpdates.get(indexerId).indexer;
        indexer.updateSourceIdentity(_self, elementIds, identities,
                                     identificationId);
    });
}

// queue the removal of all identities from the additional identity with
// the given identification. The removal is queued so as to allow the
// nodes to be removed (in which case there is no need to send notifications
// of the change). However, if an update for the identification arrives
// before the all identities are removed, such a removal will take place
// before the update is processed.

IdentityIndexer.prototype.queueRemoveAllIdentities =
    identityIndexerQueueRemoveAllIdentities;

function identityIndexerQueueRemoveAllIdentities(identificationId)
{
    if(this.pendingRemoveAll === undefined)
        this.pendingRemoveAll = new Map();
    this.pendingRemoveAll.set(identificationId, true);

    if(!this.identityUpdatesScheduled)
        this.qcm.scheduleIdentityUpdate(this);
}

// This function applies the 'remove all identities' operation which was
// scheduled for the given additional identification. The function first
// checks that such an operation is indeed scheduled.
// A notification needs to be sent only for those element IDs
// which are still defined. For those elements, the notification needs
// to set the base identity as the new identity for those elements for
// the given additional identity (since the explicit identity was removed).
// After sending the notification to all indexers which should receive it,
// this function clears the additional identity table.
// If 'ignoreElementIds' is not undefined, it is an array of element IDs
// for which the removal operation should not be carried out (this can
// be used in case this function is called when new identities are
// added after the old ones were cleared - 'ignoreElementIds' is the
// list of element IDs for which identities are being added).

IdentityIndexer.prototype.notifyRemoveAllIdentities =
    identityIndexerNotifyRemoveAllIdentities;

function identityIndexerNotifyRemoveAllIdentities(identificationId,
                                                  ignoreElementIds)
{
    if(this.pendingRemoveAll === undefined ||
       !this.pendingRemoveAll.has(identificationId))
        return;
    
    this.pendingRemoveAll.delete(identificationId);

    var additional = this.additionalIdentities.get(identificationId);
    if(additional === undefined)
        return; // removed since queued

    var toIgnore; // list of elements to ignore, as object

    if(ignoreElementIds) {
        toIgnore = new Map();
        for(var i = 0, l = ignoreElementIds.length ; i < l ; ++i)
            toIgnore.set(ignoreElementIds[i]);
    }
    
    // for those element IDs which still exist, create a notification
    // replacing the current identity with the base identity

    var elementIds = [];
    var identities = [];

    var _self = this;
    
    additional.forEach(function(identity, elementId) {

        if(toIgnore !== undefined && toIgnore.has(elementId))
            return; // don't remove this one
        
        if(!_self.dataElements.hasEntry(elementId))
            return; // element was deleted
        
        elementIds.push(elementId);
        identities.push(_self.dataElements.getBaseIdentity(elementId));
    });

    if(elementIds.length > 0) {
        var identifiedPathId = this.getIdentifiedPathId(identificationId);
        this.notifyOfAddedIdentities(elementIds, identifiedPathId,
                                     identities, identificationId);
    }

    // clear the explicit additional identities (including the ones in the
    // 'ignore' list, as these will soon be added back).
    this.additionalIdentities.set(identificationId, new Map());
}

// This function is called to execute all pending identity update tasks.
// It first updates pending base identities and then checks whether there
// are also pending 'remove all explicit additional identities' operations
// (which are then carried out).

IdentityIndexer.prototype.updatePendingIdentities =
    identityIndexerUpdatePendingIdentities;

function identityIndexerUpdatePendingIdentities()
{
    this.notifyBaseIdentities();

    if(this.pendingRemoveAll !== undefined) {

        var _self = this;
        
        this.pendingRemoveAll.forEach(function(t, identificationId) {
            _self.notifyRemoveAllIdentities(identificationId);
        });

        this.pendingRemoveAll = undefined;
    }
}

////////////////////////////////////////////
// Additional Identification Registration //
////////////////////////////////////////////

// This function needs to be called when registering a new function which
// calculates additional identities for the additional identification 
// with ID 'identificationId'. This provide the identity indexer with 
// a pointer to the identification function itself (in case it needs 
// to communicate with it) and allows the appropriate entries in various 
// tables to be allocated.   
// This function returns true if some requests for this identification
// were already registered and false if not.

IdentityIndexer.prototype.registerIdentification = 
    identityIndexerRegisterIdentification;

function identityIndexerRegisterIdentification(identificationId, 
                                               identityResult)
{
    var entry = this.additionalIdentityResults[identificationId];

    if(!entry) {
        this.additionalIdentityResults[identificationId] = {
            requestNum: 0,
            identityResult: identityResult
        }
        // also create an entry for this identification in the 
        // 'additionalIdentities' table
        if(!this.additionalIdentities.has(identificationId))
            this.additionalIdentities.set(identificationId, new Map());
        return false; // no requests for this identification
    } else
        return (entry.requestNum > 0);
}

// This function needs to be called when unregistering the function which
// calculates additional identities for the additional identification 
// with ID 'identificationId'. If no more requests for this identification
// exist, this clears this identification's entries in the identity
// indexer.

IdentityIndexer.prototype.unregisterIdentification = 
    identityIndexerUnregisterIdentification;

function identityIndexerUnregisterIdentification(identificationId)
{
    var entry = this.additionalIdentityResults[identificationId];

    if(!entry)
        return;

    if(entry.requestNum == 0) {
        // not used anymore, can clear
        delete this.additionalIdentityResults[identificationId];
        this.additionalIdentities.delete(identificationId);
    } else {
        // remove all remaining identities
        var identified = [];
        var additional = this.additionalIdentities.get(identificationId);
        if(additional.size > 0) {
            additional.forEach(function(identity, elementId) {
                identified.push(elementId);
            });
            this.removeIdentities(identified, identificationId);
        }
        entry.identityResult = undefined;
        this.additionalIdentities.set(identificationId, new Map());
    }
}

////////////////////////////////////////
// Additional Identification Requests //
////////////////////////////////////////

// This function is called by a consumer of an identification (e.g. 
// a mapping group in the merge indexer) to indicate that it is 
// intersted in the identification with the given ID. This allows
// the identity indexer to notify the identification indexer whether
// its identities are needed or not.
// This function should only be called for additional identities, that
// is, identificationId should not be undefined.

IdentityIndexer.prototype.requestIdentification = 
    identityIndexerRequestIdentification;

function identityIndexerRequestIdentification(identificationId)
{
    var entry = this.additionalIdentityResults[identificationId];

    if(!entry) {
        this.additionalIdentityResults[identificationId] = {
            requestNum: 1,
            identityResult: undefined
        }
        // also create an entry for this identification in the 
        // 'additionalIdentities' table
        if(!this.additionalIdentities.has(identificationId))
            this.additionalIdentities.set(identificationId, new Map());
    }
    else if(++entry.requestNum == 1) {
        // notify the identity result that its identities are
        // now required
        entry.identityResult.activated();
    }
}

// This function is called by a consumer of an identification (e.g. 
// a mapping group in the merge indexer) to indicate that it is no
// longer intersted in the identification with the given ID. This allows
// the identity indexer to notify the identification indexer whether
// its identities are needed or not.
// This function should only be called for additional identities, that
// is, identificationId should not be undefined.

IdentityIndexer.prototype.releaseIdentification = 
    identityIndexerReleaseIdentification;

function identityIndexerReleaseIdentification(identificationId)
{
    var entry = this.additionalIdentityResults[identificationId];

    if(!entry)
        return;

    if(--entry.requestNum == 0) {
        if(entry.identityResult) {
            // notify the identification function that it no longer needs
            // to calculate the identities.
            entry.identityResult.deactivated();
        } else {
            this.additionalIdentities.delete(identificationId);
            delete this.additionalIdentityResults[identificationId];
        }
    }
}

// return true if there are any requests registered for this identification

IdentityIndexer.prototype.hasIdentificationRequests = 
    identityIndexerHasIdentificationRequests;

function identityIndexerHasIdentificationRequests(identificationId)
{
    if(!(identificationId in this.additionalIdentityResults))
        return false;

    return this.additionalIdentityResults[identificationId].requestNum > 0;
}

// this function may be called with the identification ID of an additional
// identification (that is 'identificationId' should not be undefined or 0).
// The function then returned the path ID of the path identified by this
// additional identiifcation. If the additional identification is not
// defined, undefined is returned.

IdentityIndexer.prototype.getIdentifiedPathId = 
    identityIndexerGetIdentifiedPathId;

function identityIndexerGetIdentifiedPathId(identificationId)
{
    var identityResult = 
        this.additionalIdentityResults[identificationId].identityResult;

    if(identityResult === undefined)
        return undefined;
    
    return identityResult.getIdentifiedPathId();
}

////////////////////////////////////////
// Requests for Source Identification //
////////////////////////////////////////

// This function determines whether notifications need to be sent for
// updates to the given identification for data element IDs defined
// at 'pathId' (or higher). It returns true if such notifications are required
// and false otherwise. 
// 'identificationId' should be undefined or zero for the base identification.
// In case of the base identification, true is returned if there is need to
// provide notifications for some identification. This is because the
// base identity serves as a default value for the additional identities.
// It is later up to the functions adding the identity to detemrine whether
// there is need to notify for the specific element ID (or to queue it anyway).

IdentityIndexer.prototype.notificationRequired =
    identityIndexerNotificationRequired;

function identityIndexerNotificationRequired(pathId, identificationId)
{
    if(this.requiresTargetIdentification !== undefined &&
       this.requiresTargetIdentification(pathId, identificationId))
        return true;
    
    var pathNode = this.pathNodesById[pathId];

    if(!identificationId)
        return pathNode.mappedIdentifications.size > 0;
    
    return (pathNode.mappedIdentifications.size > 0 &&
            pathNode.mappedIdentifications.has(identificationId));
}

// This function gets the entry for the given identification and 
// indexer from the mappedIdentifications table of the given path node.
// If such an entry does not exist, it is created. In this case,
// the reference count for this indexer is increased in the 'identityUpdates'
// table (and, if needed, an entry for this target indexer is created).
// This function then returns the entry for the given indexer and 
// identification. It does not increase the counters 'numTracing'
// or 'numMonitors' on this entry. Instead, it leaves it to the calling
// function to decide which of these two counters needs to be increased.

IdentityIndexer.prototype.addMappedIdentification = 
    identityIndexerAddMappedIdentification;

function identityIndexerAddMappedIdentification(pathNode, targetIndexer, 
                                                identificationId)
{
    var idEntry;

    if(pathNode.mappedIdentifications.has(identificationId))
        idEntry = pathNode.mappedIdentifications.get(identificationId);
    else {
        idEntry = new Map();
        pathNode.mappedIdentifications.set(identificationId, idEntry);
    }

    var indexerId = targetIndexer.getId();
    var indexerEntry;

    if(idEntry.size > 0 && idEntry.has(indexerId))
        indexerEntry = idEntry.get(indexerId);
    else {
        indexerEntry = {
            numTracing: 0,
            numMonitors: 0
        };
        idEntry.set(indexerId, indexerEntry);

        if(this.identityUpdates.has(indexerId)) {
            var entry = this.identityUpdates.get(indexerId);
            entry.refCount++;
        } else {
            var entry = {
                indexer: targetIndexer,
                refCount: 1
            };
            this.identityUpdates.set(indexerId, entry);
        }
    }

    return indexerEntry;
}

// This function decreases the reference count on the entry for the given
// identification and indexer in the mappedIdentifications table of the 
// given path node. The argument 'tracing' indicates which of the two
// counters 'numTracing' or 'numMonitors' needs to be decreased.
// If the count of both these counter then reaches zero, this function
// performs the necessary cleanup.

IdentityIndexer.prototype.removeMappedIdentification = 
    identityIndexerRemoveMappedIdentification;

function identityIndexerRemoveMappedIdentification(pathNode, targetIndexer, 
                                                   identificationId, tracing)
{
    var idEntry = pathNode.mappedIdentifications.get(identificationId);
    var indexerId = targetIndexer.getId();
    var indexerEntry = idEntry.get(indexerId);

    if(tracing)
        indexerEntry.numTracing--;
    else
        indexerEntry.numMonitors--;

    if(indexerEntry.numTracing == 0 && indexerEntry.numMonitors == 0) {
        // remove from identityUpdates table
        var indexerEntry = this.identityUpdates.get(indexerId);
        if(--indexerEntry.refCount == 0)
            this.identityUpdates.delete(indexerId);
        // remove the entry from this table
        if(idEntry.size == 1)
            pathNode.mappedIdentifications.delete(identificationId);
        else
            delete idEntry.delete(indexerId);
    }

}

// This function is called when a MappingQueryCalc is registered to path ID
// 'pathId' which is the ID of a path node in this indexer. 'targetIndexer' is
// the target indexer of the corresponding mapping and 'identificationId'
// is the source identification for the mapping (this may be undefined
// to indicate the base identification). This source identification is
// stored on this identity indexer. Therefore, the given target indexer
// is registered as requiring identity updates for data elements at this
// node, for the given identification ID. 'isExtension' indicates whether
// 'pathNode' is an extension source path for the mapping. If it is not,
// it must be the maximal source path. In this case, the registration
// takes place not only on this path, but also on all its prefixes.

IdentityIndexer.prototype.addTracingIdentification =
    identityIndexerAddTracingIdentification;

function identityIndexerAddTracingIdentification(pathId, targetIndexer, 
                                                 identificationId, isExtension)
{
    var pathNode = this.pathNodesById[pathId];

    if(pathNode === undefined)
        return;
    
    this.addTracingIdentificationToPath(pathNode, targetIndexer, 
                                        identificationId, isExtension);
}

// This function implements 'addTracingIdentification()'. The difference
// is that this function receives the path node object as input instead
// of the path ID. This is more convenient for the recursive application
// of this function but should only be used internally (as external objects
// should only use the path ID and not the path node object directly).

IdentityIndexer.prototype.addTracingIdentificationToPath =
    identityIndexerAddTracingIdentificationToPath;

function identityIndexerAddTracingIdentificationToPath(pathNode, targetIndexer, 
                                                       identificationId,
                                                       isExtension)
{
    if(identificationId === undefined)
        identificationId = 0;

    if(pathNode.parent && !isExtension) // recursively call on prefix path
        this.addTracingIdentificationToPath(pathNode.parent, targetIndexer, 
                                            identificationId, false);

    var indexerEntry = this.addMappedIdentification(pathNode, targetIndexer, 
                                                    identificationId);
    
    indexerEntry.numTracing++;
}

// This function is called when a MappingQueryCalc is unregistered from 
// 'pathNode'. This performs the exact opposite operations to those 
// carried out by 'addTracingIdentification()' (and has the same 
// arguments).

IdentityIndexer.prototype.removeTracingIdentification =
    identityIndexerRemoveTracingIdentification;

function identityIndexerRemoveTracingIdentification(pathId, targetIndexer, 
                                                    identificationId, 
                                                    isExtension)
{
    var pathNode = this.pathNodesById[pathId];
    
    if(pathNode === undefined)
        return;

    this.removeTracingIdentificationFromPath(pathNode, targetIndexer, 
                                             identificationId, isExtension);
}

// This function implements 'removeTracingIdentification()'. The difference
// is that this function receives the path node object as input instead
// of the path ID. This is more convenient for the recursive application
// of this function but should only be used internally (as external objects
// should only use the path ID and not the path node object directly).

IdentityIndexer.prototype.removeTracingIdentificationFromPath =
    identityIndexerRemoveTracingIdentificationFromPath;

function identityIndexerRemoveTracingIdentificationFromPath(pathNode,
                                                            targetIndexer, 
                                                            identificationId, 
                                                            isExtension)
{
    if(identificationId === undefined)
        identificationId = 0;

    this.removeMappedIdentification(pathNode, targetIndexer, 
                                    identificationId, true);

    if(pathNode.parent && !isExtension) // recursively call on prefix path
        this.removeTracingIdentificationFromPath(pathNode.parent,
                                                 targetIndexer, 
                                                 identificationId, false);
}

// This function is called when a MappingMonitor is registered to the
// path ID 'path ID' which is the ID of a path node in this indexer.
// 'targetIndexer' is the target indexer of the corresponding mapping
// and 'identificationId' is the source identification for the mapping
// (this may be undefined to indicate the base identification). This
// source identification is stored on this identity
// indexer. Therefore, the given target indexer is registered as
// requiring identity updates for data elements at this node, for the
// given identification ID. Since this is a monitor registration, this
// also applies to all child path nodes of this path node, which are
// updated recursively.

IdentityIndexer.prototype.addMonitoringIdentification =
    identityIndexerAddMonitoringIdentification;

function identityIndexerAddMonitoringIdentification(pathId, targetIndexer, 
                                                    identificationId)
{
    var pathNode = this.pathNodesById[pathId];

    if(pathNode === undefined)
        return;

    // the following function actually implements the operation
    this.addMonitoringIdentificationToPath(pathNode, targetIndexer,
                                           identificationId);
}

// This function implements 'addMonitoringIdentification()'. The difference
// is that this function receives the path node object as input instead
// of the path ID. This is more convenient for the recursive application
// of this function but should only be used internally (as external objects
// should only use the path ID and not the path node object directly).

IdentityIndexer.prototype.addMonitoringIdentificationToPath =
    identityIndexerAddMonitoringIdentificationToPath;

function identityIndexerAddMonitoringIdentificationToPath(pathNode,
                                                          targetIndexer, 
                                                          identificationId)
{
    if(identificationId === undefined)
        identificationId = 0;

    var indexerEntry = this.addMappedIdentification(pathNode, targetIndexer, 
                                                    identificationId);
    
    indexerEntry.numMonitors++;
    
    for(var attr in pathNode.children)
        this.addMonitoringIdentificationToPath(pathNode.children[attr], 
                                               targetIndexer, identificationId);
}

// This function is called when a MappingMonitor is unregistered from
// the path with ID 'pathId'. This performs the exact opposite
// operations to those carried out by 'addMonitoringIdentification()'
// (and has the same arguments).

IdentityIndexer.prototype.removeMonitoringIdentification =
    identityIndexerRemoveMonitoringIdentification;

function identityIndexerRemoveMonitoringIdentification(pathId, targetIndexer, 
                                                       identificationId)
{
    var pathNode = this.pathNodesById[pathId];
    
    if(pathNode === undefined)
        return;
    
    // the following function actually implements the operation
    this.removeMonitoringIdentificationFromPath(pathNode, targetIndexer,
                                                identificationId);
}

// This function implements 'removeMonitoringIdentification()'. The difference
// is that this function receives the path node object as input instead
// of the path ID. This is more convenient for the recursive application
// of this function but should only be used internally (as external objects
// should only use the path ID and not the path node object directly).

IdentityIndexer.prototype.removeMonitoringIdentificationFromPath =
    identityIndexerRemoveMonitoringIdentificationFromPath;

function identityIndexerRemoveMonitoringIdentificationFromPath(pathNode,
                                                               targetIndexer, 
                                                               identificationId)
{
    if(identificationId === undefined)
        identificationId = 0;

    this.removeMappedIdentification(pathNode, targetIndexer, identificationId,
                                    false);

    for(var attr in pathNode.children)
        this.removeMonitoringIdentificationFromPath(pathNode.children[attr], 
                                                    targetIndexer,
                                                    identificationId);
}

// This function is created when a new path node is created and is
// used to intialize the 'mappedIdentifications' table of this path node.
// This is done based on the same table on the parent. If this table 
// on the parent contains entries with 'numMonitors' greater than zero
// then these entries need to be copied to this path's table too 
// (because the nodes on this path node are also monitored by the 
// same monitor).

IdentityIndexer.prototype.initMappedIdentifications =
    identityIndexerInitMappedIdentifications;

function identityIndexerInitMappedIdentifications(pathNode)
{
    pathNode.mappedIdentifications = new Map();

    // initialize this table based on the same table at the parent path node.

    var parentPath = pathNode.parent;
    if(!parentPath || parentPath.mappedIdentifications.size == 0)
        return;

    parentPath.mappedIdentifications.forEach(function(parentIdEntry,
                                                      identificationId){
        var idEntry; // at this path node, will be created if needed
        parentIdEntry.forEach(function(parentIndexer, indexerId) {
            var numMonitors = parentIndexer.numMonitors;
            if(numMonitors == 0)
                return;
            if(!idEntry) {
                idEntry = new Map();
                pathNode.mappedIdentifications.set(identificationId, idEntry);
            }
            idEntry.set(indexerId, { numTracing: 0, numMonitors: numMonitors });
        });
    });
}

//////////////////////
// Identity Updates //
//////////////////////

// This function is given a list of element IDs and an array of identities
// assigned to them (each identity to the element ID in the corresponding place
// in the elementIds array) for identification with ID 'identificationId'.
// This function then updates these identities. If there are modules
// which need to be notified of these changes, these notifications
// are sent first. Then, the new identities are set. It is assumed that
// when a sequence of changes takes place, this function is called once with
// the full list of identity updates and therefore there is no need to
// buffer these updates before forwarding them to the nodes which require them.
// It is assumed that no identity received here is 'undefined'
// (one should call 'removeIdentities()' to remove additional identities).
// noNotification can be set by the calling function to true to indicate
// that there is no need to send notifications of this identity change (for
// example, if the nodes are just being added and it is known that the
// modules which require the notifications will have these nodes added
// after the identities are updated).

IdentityIndexer.prototype.addIdentities = 
    identityIndexerAddIdentities;

function identityIndexerAddIdentities(elementIds, identities, identificationId,
                                      noNotification)
{    
    var identifiedPathId = this.getIdentifiedPathId(identificationId);
    var additionalIdentities = this.additionalIdentities.get(identificationId);

    // notify of this update directly, if needed, before updating in
    // the additional identity tables.
    this.notifyOfAddedIdentities(elementIds, identifiedPathId, identities,
                                 identificationId, noNotification);

    if(this.pendingRemoveAll !== undefined &&
       this.pendingRemoveAll.has(identificationId)) {
        // a 'remove all' is still pending for this identification, so must
        // first carry out this operation on all remaining element IDs,
        // before setting the new additional identities
        this.notifyRemoveAllIdentities(identificationId, elementIds);
    }
    
    // set the identities
    for(var i = 0, l = elementIds.length ; i < l ; ++i)
        additionalIdentities.set(elementIds[i], identities[i]);
}

// This removes the additional identities (for the additional identity
// with given identification ID) for the given data element IDs.
// If the element ID is no longer a node at the identified path,
// there is no need to send notifications and the additional identity
// is simply cleared from the tables. Otherwise, if notifications need
// to be sent, this function first determines the base identity of
// the element IDs (these are the new identities for this additional
// identity) and sends a notification that these are then new identities
// (the base identities used here are the current identities, even if there
// are updates pending for the base identities - this keeps things simple).
// After sending the required notification, the identities are removed from
// the additional identification's tables.
// The argument 'noNotification' may be set to true by the calling function
// to indicate that it knows that there is no need to send notification
// of the identity change. This, for example, happens if the calling function
// knows that these nodes are also removed from all modules which registered
// for this identity and therefore there is no need to update them.

IdentityIndexer.prototype.removeIdentities = 
    identityIndexerRemoveIdentities;

function identityIndexerRemoveIdentities(elementIds, identificationId,
                                         noNotification)
{
    if(this.pendingRemoveAll !== undefined &&
       this.pendingRemoveAll.has(identificationId))
        return; // all about to be removed, no need for this specific one
    
    var identifiedPathId = this.getIdentifiedPathId(identificationId);

    if(!noNotification &&
       this.notificationRequired(identifiedPathId, identificationId)) {

        var pathNode = this.pathNodesById[identifiedPathId];
        var notifyElementIds = [];
        var notifyIdentities = [];
        
        // create the sub-list of nodes for which notifications need to
        // be sent
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(!pathNode.nodes.has(elementId))
                continue; // node no longer exists
            // current base identity
            notifyElementIds.push(elementId);
            notifyIdentities.push(this.getBaseIdentity(elementId));
        }

        this.notifyOfAddedIdentities(notifyElementIds, identifiedPathId,
                                     notifyIdentities, identificationId);
    }

    // remove the element IDs fro the additional identification table

    var additionalIdentities = this.additionalIdentities.get(identificationId);
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var elementId = elementIds[i];
        
        if(!additionalIdentities.has(elementId))
            continue;

        additionalIdentities.delete(elementId);
    }
}

// This removes all additional identities for the additional identity
// with the given identification ID. If notifications need to be sent for
// changes in this additional identification, the request is queued
// (to allow time for the identified nodes to be removed, in which case
// there is no longer need to send a notification). If no notification
// needs to be sent, the additional identities table is simply cleared.

IdentityIndexer.prototype.removeAllIdentities = 
    identityIndexerRemoveAllIdentities;

function identityIndexerRemoveAllIdentities(identificationId)
{
    var identifiedPathId = this.getIdentifiedPathId(identificationId);

    if(this.notificationRequired(identifiedPathId, identificationId)) {
        this.queueRemoveAllIdentities(identificationId);
        return;
    }

    // no notifications, can remove immediately
    this.additionalIdentities.set(identificationId, new Map());
}

/////////////////////////
// Path Node Interface //
/////////////////////////

// This function overrides the base class implementation of this 
// function, which is called to create a new path node object.
// The base class function is called first and, then, when it is done,
// this function adds the tables of the path node which belong to the
// identity indexer.

IdentityIndexer.prototype.createPathNode = 
    identityIndexerCreatePathNode;

function identityIndexerCreatePathNode(pathId)
{
    if(pathId in this.pathNodesById)
        return this.pathNodesById[pathId]; // already exists

    // create the path node object
    var pathNode = this.InternalQCMIndexer_createPathNode(pathId);

    // set the identity indexer tables on the path node

    this.initMappedIdentifications(pathNode);

    return pathNode;
}
