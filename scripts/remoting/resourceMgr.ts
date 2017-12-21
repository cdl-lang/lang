// Copyright 2017 Yoav Seginer, Theo Vosse, Gil Harari, and Uri Kolodny.
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

/// <reference path="../feg/utilities.ts" />
/// <reference path="../feg/externalTypes.basic.d.ts" />
/// <reference path="remotingLog.ts" />
/// <reference path="mongojs.d.ts" />
/// <reference path="../feg/paidMgr.ts" />
/// <reference path="../feg/xdr.ts" />
/// <reference path="formatUpgrade.ts" />
/// <reference path="externalDataSourceAPI.ts" />

// Removes ambiguity when concatenating strings that potentially contain
// a period: replaces a period by _._, and _ by __. This results in a
// unique string that is also a legal mongodb collection name.
function escapeMongoName(str: string): string {
    return str.replace(/_/g, "__").replace(/\./g, "_._");
}

        /**
 * A ResourceManager maintains a set of resources. The current persistence
 * server has precisely one, which manages the resources of a specific profile.
 * Resources are identified by a 'spec': an a/v describing resource properties.
 * 
 * A resource has a unique numerical id, and an unfortunately named "resource
 * identifier", which have a one-to-one relation. The resource identifier,
 * however, is a string which is derived from the resource spec, and also
 * indicates the name of table in the mongodb that holds the corresponding data.
 * There are three types of resources, and their resource identifiers are
 * composed as follows:
 * - appState: "rrm.${stem}.${ownerName}.${appName}"
 * - table: "table.${databaseid}"
 * - metadata: "metadata" (i.e., there is only one such resource)
 * The three types have their own class, derived from class Resource, to manage
 * the data: AppStateResource, TableResource, and MetaDataResource. The latter
 * two both map to a single mongodb table, but AppStateResource uses three
 * mongodb tables: one for the actual data, one for indices, and one for
 * templates.
 * 
 * Note that table here corresponds to [database, <id>] in cdl, and metadata
 * corresponds to [databases]. Also note that the app state's table name
 * structure has a meaning in authorization.js.
 * 
 * For more information about templates and indices: see paidMgr.ts
 * 
 * @class ResourceMgr
 */
class ResourceMgr {
    /**
     * Maps each resource identifier to a Resource. Same resources as
     * resourceById.
     * 
     * @type {{[ident: string]: Resource}}
     * @memberof ResourceMgr
     */
    resourceByIdent: {[ident: string]: Resource} = {};
    /**
     * maps each numeric resource id to a Resource. Same resources as
     * resourceByIdent.
     * 
     * @type {{[id: number]: Resource}}
     * @memberof ResourceMgr
     */
    resourceById: {[id: number]: Resource} = {};
    /**
     * maps each numeric resource id to a resource type.
     * 
     * @memberof ResourceMgr
     */
    resourceTypeById: {[id: number]: string} = {};
    
    /**
     * A counter for assigning a unique id to each resource
     * 
     * @type {number}
     * @memberof ResourceMgr
     */
    nextResourceId: number = 1;

    /**
     *  The connection to mongodb
     * 
     * @type {MongoDB}
     * @memberof ResourceMgr
     */
    db: MongoDB;

    /**
     * A counter used to generate unique ids for each resource update message.
     * Each resource marks the id of the last update it sent, so that it knows
     * if a reconnecting client is still in sync. It's initialized with the
     * current time stamp, so that a restart of the server won't accidentally
     * hand out the same id twice (assuming there's not a resource update every
     * millisecond or faster; that could make the counter get ahead of the
     * value of a restarted instance).
     * 
     * @static
     * @type {number}
     * @memberof ResourceMgr
     */
    static nextResourceUpdateMessageId: number = Date.now();

    /**
     * List of the external data sources. Currently set by the persistence
     * server.
     */
    externalDataSources: ExternalDataSourceSpecification[] = [];
    externalDataSourceIds: {[id: string]: ExternalDataSourceSpecification};

    constructor(
        /**
         * The name of the database (not used)
         * 
        * @type {string}
        * @memberof ResourceMgr
         */
        public dbName: string
    ) {
        var mongojs = require("mongojs");
    
        this.db = mongojs(this.dbName);
    }

    destroy() {
        if (this.db !== undefined) {
            this.db.close();
            this.db = undefined;
        }
        this.resourceByIdent = undefined;
        this.resourceById = undefined;
        this.resourceTypeById = undefined;
    }
    
    /**
     * Meant to clear the resource manager when restarting the persistence
     * server
     * 
     * @memberOf ResourceMgr
     */
    reinitialize() {
        this.nextResourceId = 1;
        this.resourceByIdent = {};
        this.resourceById = {};
        this.resourceTypeById = {};
    }

    /**
     * Returns the indicated Resource. Creates it if necessary.
     * 
     * @param spec an A/V describing the resource
     * @returns the Resource corrresponding to the spec
     * 
     * @memberOf ResourceMgr
     */
    getResourceBySpec(spec: ResourceSpecification): Resource {
        if (typeof(spec) !== "object" || typeof(spec.type) !== "string") {
            return undefined;
        }
        switch (spec.type) {
          case "appState":
            return this.getAppStateResourceBySpec(spec);
          case "table":
            if (this.externalDataSourceIds === undefined) {
                this.externalDataSourceIds = {};
                for (var i = 0; i < this.externalDataSources.length; i++) {
                    var eds = this.externalDataSources[i];
                    this.externalDataSourceIds[eds.id] = eds;
                }
            }
            if (spec.app in this.externalDataSourceIds) {
                return this.getExternalResourceBySpec(spec, this.externalDataSourceIds[spec.app]);
            } else {
                return this.getDatabaseResourceBySpec(spec);
            }
          case "metadata":
            return this.getMetaDataResourceBySpec(spec);
        }
        RemotingLog.log(0, "ERROR in spec " + JSON.stringify(spec));
        return undefined;
    }
    
    // Returns the resource identifier for the app state in this.resourceByIdent.
    static makeAppStateResIdent(spec: ResourceSpecification): string {
        return "rrm." + spec.type + "." + escapeMongoName(spec.owner) + "." +
               escapeMongoName(spec.app);
    }

    /**
     * Creates (if needed) the AppStateResource for given ownerName and appName.
     * Sets up the connection to the three mongodb tables.
     * 
     * @param spec An A/V with type: "appState", and an ownerName and appName
     *             field of type string.
     * @returns the AppStateResource corresponding to the spec
     * 
     * @memberOf ResourceMgr
     */
    getAppStateResourceBySpec(spec: ResourceSpecification): Resource {
    
        function mkname(stem: string): string {
            return "rrm." + stem + "." + ownerName + "." + appName;
        }
    
        var ownerName = escapeMongoName(spec.owner);
        var appName = escapeMongoName(spec.app);
        var resIdent = ResourceMgr.makeAppStateResIdent(spec);
    
        if (typeof(ownerName) !== "string" || typeof(appName) !== "string" ||
              typeof(resIdent) !== "string") {
            RemotingLog.log(0, "ERROR in appState resourceSpec");
            return undefined;
        }
        var templateIdent = mkname(spec.type + ".template");
        var indexIdent = mkname(spec.type + ".index");
        var resource = this.resourceByIdent[resIdent];
    
        if (resource === undefined) {
            var id = this.nextResourceId++;
            var dataCollection = this.getCollectionHandle(resIdent);
            var templateCollection = this.getCollectionHandle(templateIdent);
            var indexCollection = this.getCollectionHandle(indexIdent);
    
            resource = new AppStateResource(resIdent, id, this.db, dataCollection,
                                            templateCollection, indexCollection);
            this.storeResourceById(id, resIdent, spec.type, resource);
        }
        return resource;
    }

    // Returns the table resource according to specification; creates it if it
    // doesn't exist yet.
    getDatabaseResourceBySpec(spec: ResourceSpecification): TableResource {
        if (typeof(spec.app) !== "string") {
            RemotingLog.log(0, "ERROR in table resourceSpec " + JSON.stringify(spec.app));
            return undefined;
        }
        // Make sure that each path has a unique string, [] should not yield the
        // same id as [""], ["a,b"] not the same as ["a", "b"], etc.
        var pathAsString = spec.path.map(attr => "/" + encodeURIComponent(attr));
        var resIdent = "tables." + spec.app + "." + pathAsString; // resource identifier, table name and path
        var resource: TableResource = this.resourceByIdent[resIdent] as TableResource;
    
        if (resource === undefined) {
            var id = this.nextResourceId++;
            var dataCollection = this.getCollectionHandle("tables." + spec.app);
            var shadowCollection = this.getCollectionHandle("shadow." + spec.app); // TESTING
            resource = new TableResource(resIdent, id, this.db, dataCollection, spec.app, spec.path, shadowCollection);
            this.storeResourceById(id, resIdent, spec.type, resource);
        }
        return resource;
    }

    // Returns the external data resource according to specification; creates it
    // if it doesn't exist yet. Similar to TableResource
    // Query parameters are converted from an arbitrary os to an array of
    // values following the order in ExternalDataSourceSpecification.queryParameters
    getExternalResourceBySpec(spec: ResourceSpecification, eds: ExternalDataSourceSpecification): ExternalResource {
        var pathAsString = spec.path.map(attr => "/" + encodeURIComponent(attr));
        var resIdent = "external." + spec.app + "." + pathAsString; // resource identifier, table name and path
        var specParams = ensureOS(spec.params);
        var paramMap: {[parameterName: string]: any} = undefined;
        var queryParameters: any[] = undefined;
        var parameterError: boolean = false;

        // Copy valid parameters into a single object
        for (var i = 0; i < specParams.length; i++) {
            var specParam = specParams[i];
            if (isAV(specParam)) {
                for (var paramName in specParam) {
                    if (paramMap === undefined) {
                        paramMap = {};
                    }
                    paramMap[paramName] = mergeConst(specParam[paramName], paramMap[paramName]);
                }
            }
        }
        if (paramMap !== undefined && eds.queryParameters !== undefined) {
            // Check parameters for completeness and defaults, and put them in a list
            queryParameters = [];
            for (i = 0; i < eds.queryParameters.length; i++) {
                var qpd = eds.queryParameters[i];
                if (qpd.id in paramMap) {
                    queryParameters[i] = paramMap[qpd.id];
                } else if ("defaultValue" in qpd) {
                    queryParameters[i] = qpd.defaultValue;
                } else if (!qpd.optional) {
                    parameterError = true;
                    break;
                }
            }
            if (queryParameters !== undefined && queryParameters.length > 0) {
                resIdent += "?" + JSON.stringify(queryParameters);
            } else {
                queryParameters = undefined;
            }
        }
        
        var resource: ExternalResource = this.resourceByIdent[resIdent] as ExternalResource;
        if (resource === undefined && !parameterError) {
            var id = this.nextResourceId++;
            resource = new ExternalResource(resIdent, id, eds, queryParameters, spec.path);
            this.storeResourceById(id, resIdent, spec.type, resource);
        }
        return resource;
    }

    // Returns the (unique) metadata resource; creates it if it doesn't exist.
    getMetaDataResourceBySpec(spec: ResourceSpecification): Resource {
        var resIdent = "metadata"; // resource identifier and table name
        var resource = this.resourceByIdent[resIdent];
    
        if (resource === undefined) {
            var id = this.nextResourceId++;
            var dataCollection = this.getCollectionHandle(resIdent);
            resource = new MetaDataResource(resIdent, id, this.db, dataCollection, this);
            this.storeResourceById(id, resIdent, spec.type, resource);
        }
        return resource;
    }
    
    /**
     * Get the interface to a mongodb table 
     * 
     * @param {string} ident name of the mongodb table
     * @returns the collection object
     * 
     * @memberOf ResourceMgr
     */
    getCollectionHandle(ident: string): MongoDBCollectionHandle {
        return this.db.collection(ident);
    }
    
    /**
     * Returns resource with given numeric id
     * 
     * @param {number} id resource id
     * @returns {Resource}
     * 
     * @memberOf ResourceMgr
     */
    getResourceById(id: number): Resource {
        return this.resourceById[id];
    }

    /**
     * Stores resource under given ids
     * 
     * @param {number} id the numeric resource id
     * @param {string} resIdent the resource identifier/table name
     * @param {Resource} resource
     * 
     * @memberOf ResourceMgr
     */
    storeResourceById(id: number, resIdent: string, resType: string, resource: Resource): void {
        this.resourceByIdent[resIdent] = resource;
        this.resourceById[id] = resource;
        this.resourceTypeById[id] = resType;
    }

    // Signals termination of the server to the clients; does not do any cleanup
    // as it's supposed to halt any moment.
    signalTermination(reason: string): void {
        var terminatedConnections: {[id: number]: boolean} = {};

        for (var resIdent in this.resourceByIdent) {
            var resource: Resource = this.resourceByIdent[resIdent];
            for (var id in resource.subscriber) {
                var connection = resource.subscriber[id];
                if (!(connection.id in terminatedConnections)) {
                    connection.signalTermination(reason);
                    terminatedConnections[connection.id] = true;
                }
            }
        }
    }
}

type ResourceCallback = (error: any, result: any, revision: number) => void;
interface ResourceQueueElement {
    type: string;
    cb: ResourceCallback;
    fromRevision?: number;
    elementObj?: {[id: string]: any};
    originatingClientResourceId?: number;
};

/**
 * A single resource (e.g. the app data or a facet of a table).
 * 
 * A Resource consists of multiple elements, represented in a map that links
 * the element identifiers to a value. The identifiers' meaning can differ per
 * resource type. For app data, they map to specific app state context labels;
 * for tables, there is only one element.
 * 
 * A Resource potentially has multiple subscribers, which are supposed to
 * share the same data. If one subscriber changes the data, that changes is
 * propagated to all other clients.
 * 
 * On subscription, the Resource is responsible for checking authorization and
 * sending the initial update.
 * 
 * @class Resource
 */
abstract class Resource {
    static nextSubscriberId: number = 1;

    subscriber: {[id: number]: RemoteResourceUpdateServerToClient} = {};
    alsoNotifyWriter: boolean = false;
    readyQueue: ResourceQueueElement[] = [];
    isReady: boolean = true;
    // persisted revision counter (advanced with each write). This is set
    // initially after reading the data from the database
    lastRevision: number = undefined;

    constructor(public ident: string, public id: number,
                public db: MongoDB, public collection: MongoDBCollectionHandle) {
    }
    
    // Gets called when the resource is removed from the ResourceMgr's
    // resourceById(ent) tables.
    destroy(): void {
    }

    getId(): number {
        return this.id;
    }

    /**
     * Executes all entries from the readyQueue, which can be one of two types:
     * "getAllElement" and "write", which simply call the eponymous functions
     * with the arguments given by the entry.
     * 
     * This can be called in different steps of initialization. It is 
     * therefore possible for functions called here to simply be rescheduled
     * (and placed again on the 'readyQueue'). For this reason, a new 
     * queue is created before looping over the list of entries in the 
     * old queue.
     * 
     * @memberOf Resource
     */
    processReadyQueue(): void {
        if (this.readyQueue.length === 0) {
            return;
        }
        var readyQueue = this.readyQueue;
        this.readyQueue = []; // in case there is something to reschedule
        for (var i = 0; i < readyQueue.length; i++) {
            var entry = readyQueue[i];
            switch (entry.type) {
              case "getAllElement":
                this.getAllElement(entry.fromRevision, entry.cb);
                break;
              case "write":
                this.write(entry.originatingClientResourceId, entry.elementObj,
                           entry.cb);
                break;
              case "external":
                entry.cb(undefined, undefined, undefined);
                break;
            }
        }
    }
    
    /**
     * This function may be called by the 'getAllElement' function,
     * where 'elementList' is the set of elements just retrieved for this
     * resource from the database. This function then determines the highest
     * version number for the elements just retrieved and if this number
     * is greater than the 'lastRevision' of the resource, sets this
     * number on 'lastRevision' (this happens the first time 'getAllElement'
     * is called. If the argument 'fromRevision' is not undefined, this
     * function filters out a subset of 'elementList' consisting only those
     * elements which have a revision higher than 'fromRevision'. The function
     * returns this filtered list (or the full list, if no filtering took place)
     * and the maximal revision of an element in the list.
     * If 'fromRevision' is undefined, this a full update (rather than an
     * incremental one) so empty elements (null value) are not included.
     * 
     * @param {number} fromRevision
     * @param {any[]} elementList
     * @returns { filtered: any[], maxRevision: number }
     * @memberof Resource
     */
    filterAllElementRevision(fromRevision: number,
                             elementList: any[]): { filtered: any[],
                                                         maxRevision: number }
    {
        if (this.lastRevision === undefined) {
            this.lastRevision = 0; // first time, needs to be initialized
        }
        // determine the last revision in the resource. Moreover, if a
        // 'fromRevision' is specified, only 'elementList' is filtered
        // to include only elements with a revision larger than
        // 'fromRevision'

        // the maximal revision of a retrieved element
        var maxRevision: number = undefined;
        var filtered: Array<any> = [];
        for (var i = 0, l = elementList.length ; i < l ; i++) {
            var elem = elementList[i];
            var revision = elem._revision;
            if(revision !== undefined) {
                if (revision > this.lastRevision) {
                    this.lastRevision = revision;
                }
                if (maxRevision === undefined || revision > maxRevision) {
                    maxRevision = revision;
                }
                if ((fromRevision !== undefined && fromRevision < revision) ||
                      (fromRevision === undefined && elem.value !== null)) {
                    filtered.push(elem);
                }
            } else if (fromRevision === undefined && elem.value !== null) {
                filtered.push(elem);
            }
        }

        // if all elements have no revision, the revision is 0
        // (any additional updates will be added with a higher revision
        // number).
        
        return { filtered: filtered ? filtered : elementList,
                 maxRevision: maxRevision === undefined ? 0 : maxRevision };
    }
    
    getAllElement(fromRevision: number, cb: ResourceCallback): void {
        if (!this.isReady) {
            // if the resource is not ready yet, queue requests
            this.readyQueue.push({
                type: "getAllElement",
                cb: cb,
                fromRevision: fromRevision
            });
            return;
        }
    
        if (this.collection === undefined) {
            cb(null, o(), undefined);
        } else {
            var self = this;
            this.collection.find().toArray(function (err, elementList) {
                var elementObj = undefined;
                if (err === null) {
                    var filtered = self.filterAllElementRevision(fromRevision,
                                                                 elementList);
                    elementObj = self.getElementObj(filtered.filtered);
                    self.addExternalData(elementObj);
                }
                cb(err, elementObj, filtered.maxRevision);
                // process any writes pending this operation
                self.processReadyQueue();
            });
        }
    }
    
    // notify subscriber whenever this resource is modified
    subscribe(subscriber: RemoteResourceUpdate): number {
        var subscriberId = Resource.nextSubscriberId++;
    
        if (Utilities.isEmptyObj(this.subscriber)) {
            this.acquireResource();
        }
        this.subscriber[subscriberId] = subscriber;
        return subscriberId;
    }
    
    unsubscribe(subscriberId: number): void {
        delete this.subscriber[subscriberId];
        if (Utilities.isEmptyObj(this.subscriber)) {
            this.purgeResource();
        }
    }
    
    releaseResource(subscriberId: number): void {
        delete this.subscriber[subscriberId];
        if (Utilities.isEmptyObj(this.subscriber)) {
            this.purgeResource();
        }
    }
    
    /**
     * Gets called on the first subscription to the resource
     */
    acquireResource(): void {
    }

    /**
     * Gets called when there are no more subscriptions to the resource
     */
    purgeResource(): void {
    }

    /**
     * Effectuates a change in the resource, stores it in the database and
     * sends the change to other subcribers.
     * 
     * @param {number} originatingClientResourceId the originating client 
     *     resource id
     * @param {*} elementObj an a/v; any attribute in elementObj denotes 
     *     a resource element that is to be added/modified in this resource. 
     *     deletion is signalled by providing an undefined/null value
     * @param {ResourceCallback} cb called after all the updates/writes have 
     *     completed, with the arbitrary first error - or 'null' if no error 
     *     occurred
     * @returns {void} 
     * 
     * @memberof Resource
     */
    
    write(originatingClientResourceId: number, elementObj: any,
          cb: ResourceCallback): void
    {
        assert(typeof(originatingClientResourceId) === "number" &&
               typeof(elementObj) === "object" &&
               typeof(cb) === "function", "Resource.write: typecheck failed")
        
        if (!this.isReady || this.lastRevision === undefined) {
            this.readyQueue.push(
                {
                    type: "write",
                    elementObj: elementObj,
                    cb: cb,
                    originatingClientResourceId: originatingClientResourceId
                }
            );
            return;
        }
    
        var that = this;
        var revision = ++this.lastRevision;
        var revTimeStamp: string = new Date().toISOString();
        var writtenIds: Array<string> = []; // IDs of elements written
        
        // 'result' here is the number of records modified (should always
        // be 1, except, perhaps, in the case of deletion, if the deleted
        // entry does nto exist).
        function mfn(error: any, result: any): void {
            o.count--;
            if (error !== null && o.error === null) {
                o.error = error;
            }
            assert(o.count >= 0, "mfn: count");
            assert(o.wasCalled === false, "mfn: wasCalled");
            if (o.count === 0) {
                o.wasCalled = true;
                o.cb(o.error, o.writeAckInfo, revision);
                that.notify(writtenIds, originatingClientResourceId);
            }
        }
    
        var o = {
            count: 0,
            wasCalled: false,
            cb: cb,
            writeAckInfo: {}, // information to send with the write ack
            error: <any>null
        };
        
        for (var eid in elementObj) {
            var value = elementObj[eid];
            o.count++;
            if (value === undefined || value === null) {
                value = undefined;
            } else if (typeof(value) === "object" &&
                       value.value === xdrDeleteIdent) {
                value.value = undefined;
            }
            writtenIds.push(
                this.writeElement(originatingClientResourceId, eid, value,
                                  revision, revTimeStamp, o.writeAckInfo, mfn));
        }
    }

    // This function performs the write of a single element object.
    // 'eid' is the ID identifying it in the database, 'elementObj'
    // is the object to be written (the 'value' of the entry in the database)
    // and may be undefined if the element needs to be deleted.
    // 'revision' is the revision assigned to this write by the resource.
    // 'writeAckInfo' is an object which the writeElement() function can use
    // to store information which needs to be set on the write acknowledgement
    // message to be sent at the end of the write operation. This is optional
    // and depends on the resource and on the operation (the base class does
    // not store any information here).
    // 'cb' is a callback which is called when the write of the single
    // object has succeeded.
    // The function returns the ID of the element just written.
    
    writeElement(originatingClientResourceId: number, eid: string,
               elementObj: any, revision: number, revTimeStamp: string,
               writeAckInfo: any, cb: (err: Error, result: any) => void): string
    {
        this.collection.update({ _id: eid }, {
            _id: eid,
            _revision: revision,
            _revTimeStamp: revTimeStamp,
            value: elementObj
        },
        { upsert: true }, cb);
        return eid;
    }

    // notify clients of changes (is 'this.alsoNotifyWriter' is false,
    // the client which wrote the update is not notified).
    
    notify(idList: Array<string>, srcSID: number): void {
        var subscriber = this.subscriber;
        var alsoNotifyWriter = this.alsoNotifyWriter;

        var _self = this;
        
        this.collection.find({ _id: { $in: idList } }).toArray(
            function (err, elementList) {
                if (err === null) {
                    // Note: there's no need to add external data here
                    var elementObj = _self.getElementObj(elementList);
                    for (var sid in subscriber) {
                        if (Number(sid) !== srcSID || alsoNotifyWriter) {
                            subscriber[sid].resourceUpdate(sid, elementObj,
                                                           _self.lastRevision);
                        }
                    }
                }
            }
        );
    }

    // The input is a list of objects as extracted from the mongo DB.
    // This function converts these objects to the structure which
    // is sent to the client.
    
    getElementObj(elementList: any): ResourceElementMapByIdent {
        var elementObj: ResourceElementMapByIdent = {};
        var i: number;

        for (i = 0; i < elementList.length; i++) {

            // in case the entry is in an older format, upgrade it first
            var elem = AppStateFormatUpgrade.upgradeFormat(elementList[i]);

            if(!elem || !elem.value) {
                RemotingLog.log(0, "ERROR: empty app state element: " +
                                (elem ? ("ID: " + elem._id) : "null"));
                continue;
            }
            
            var attr = elem._id;
            elementObj[attr] = {
                ident: elem.value.ident,
                revision: elem._revision,
                value: !elem.value.value ? // undefined/null is deleted
                    xdrDeleteIdent : elem.value.value
            }
        }

        return elementObj;
    }

    // Adds external data to the resource element map
    addExternalData(elementObj: ResourceElementMapByIdent): void {
    }

    sendDirectUpdate(res: any): void {
        RemotingLog.log(3, function() {
            return "sendDirectUpdate " +
                (typeof(res) === "object" && res !== null? Object.keys(res).join(", "): "");
        });
        for (var sid in this.subscriber) {
            this.subscriber[sid].resourceUpdate(sid, res, this.lastRevision);
        }
    }

    getPaidMgr(): PaidMgrInterface {
        return undefined;
    }

    /**
     * Executes f() when the resource is ready, i.e. either immediately, or when
     * setReady() is called.
     * 
     * @param {() => void} f function to be executed
     * @memberof Resource
     */
    executeWhenReady(f: () => void) {
        if (this.isReady) {
            f();
        } else {
            this.readyQueue.push({
                type: "external",
                cb: f
            })
        }
    }

    abstract getXDRFunc(): XDRFunc;

    abstract getIdentStrFunc(): IdentFunc;
}

/**
 * This derived class of Resource adds a paidMgr which has its template and
 * index table associated with the arguments 'templateCollection' and
 * 'indexCollection' respectively.
 * The resource is only considered 'ready' after these collections were
 * loaded into the paidMgr. To load them, it calls the paidBackingStore's load
 * function which has an asynchronous callback. Requests arriving before the
 * resource is ready are queued in this.readyQueue.
 *  
 * @class AppStateResource
 * @extends {Resource}
 * @member {PaidBackingStore} paidBackingStore
 * @member {BackingStorePaidMgr} paidMgr 
 * @member {boolean} isReady true once the paidBackingStore has finished loading
 * @member {Entry[]} readyQueue list of actions to be executed once the resource
 *                   is loaded
 */
class AppStateResource extends Resource {
    private paidBackingStore: PaidBackingStore;
    private paidMgr: BackingStorePaidMgr;
    // Each app state resource has its own paid manager and translation
    // private remotePaidInterface: RemotePaidInterface;

    constructor(ident: string, id: number, db: MongoDB, dataCollection: MongoDBCollectionHandle,
                templateCollection: MongoDBCollectionHandle, indexCollection: MongoDBCollectionHandle) {
        super(ident, id, db, dataCollection);

        this.paidBackingStore = new PaidBackingStore(templateCollection, indexCollection);    
        this.paidMgr = new BackingStorePaidMgr(this.paidBackingStore);    
        // this.remotePaidInterface = new RemotePaidInterface(this.paidMgr);
        this.isReady = false;
    
        this.paidBackingStore.load((err: any, templateList?: PaidMgrTemplateEntry[], indexList?: PaidMgrIndexEntry[]): void => {
            if (err === null) {
                RemotingLog.log(2, "AppStateResource: loading templates/indices");
                RemotingLog.log(4, () => "AppStateResource: loaded template=\n" + JSON.stringify(templateList));
                RemotingLog.log(4, () => "AppStateResource: loaded index=\n" + JSON.stringify(indexList));

                this.paidMgr.preload(templateList, indexList);

                RemotingLog.log(3, "AppStateResource: templates/indices loaded");

                this.setReady();
            } else {
                // XXX TBD error handling
                RemotingLog.log(0, "AppStateResource: paid table load failed");
            }
        });
    }

    /**
     * 
     * Called when the paidBackingStore has successfully loaded the template and
     * index tables. 
     * 
     * @memberOf AppStateResource
     */
    setReady(): void {
        this.isReady = true;
        this.processReadyQueue();
    }
    
    getPaidMgr(): PaidMgrInterface {
        return this.paidMgr;
    }

    getXDRFunc(): (cdlValue: AppStateElement, xdr: XDR) => AppStateElement {
        return XDR.xdrAppStateElement;
    }
    
    getIdentStrFunc(): IdentFunc {
        return function (elem) {
            var ident = elem.ident;
            return ident.templateId + ":" + ident.indexId + ":" + ident.path;
        };
    }
}

/**
 * Implements persistent storage of paid information using two given mongodb
 * collections, one for the templates, and one for the indices.
 * 
 * @class PaidBackingStore
 */
class PaidBackingStore {
    templateMapCopy: any = {}; // For debugging !!!

    constructor(public templateHandle: MongoDBCollectionHandle,
                public indexHandle: MongoDBCollectionHandle) {
    }
    
    /**
     * Stores the template entry under the template id in the database.
     * Call returns immediately, without confirmation, but crashes the
     * application on failure.
     * 
     * @param {number} templateId
     * @param {PaidMgrTemplateEntry} templateEntry
     * 
     * @memberOf PaidBackingStore
     */
    addTemplate(templateId: number, templateEntry: PaidMgrTemplateEntry): void {
        function cb(error: any, result: any): void {
            assert(error === null, "addTemplateCB");
        }

        this.verifyAddTemplateMap(Number(templateId), templateEntry, "addTemplate"); // !!!

        this.templateHandle.update({ _id: templateId },
                                   { _id: templateId, value: templateEntry },
                                   { upsert: true }, cb);
    }
    
    // DEBUG CHECK!!!
    // A test similar to the one of PaidMgr.preload, but before writing to
    // the database.
    verifyAddTemplateMap(templateId: number, tEntry: PaidMgrTemplateEntry, caller: string): void {
        var parentId = tEntry.parentId;
        var childType = tEntry.childType;
        var childName = tEntry.childName;
        var referredId = tEntry.referredId;
        var tIdent = parentId + ":" + childType + ":" + childName;
        if (childType === "intersection") {
            tIdent += ":" + referredId;
        }
        assert(!(tIdent in this.templateMapCopy) || templateId === this.templateMapCopy[tIdent],
                "PaidBackingStore." + caller + ": templateId must not change: ident=" +
                tIdent + ", " + templateId + "(" + typeof(templateId) + ") != " +
                this.templateMapCopy[tIdent] + "(" +
                typeof(this.templateMapCopy[tIdent]) + ")");
        this.templateMapCopy[tIdent] = templateId;
    }

    /**
     * Stores the index entry under the index id in the database.
     * Call returns immediately, without confirmation, but crashes the
     * application on failure.
     * 
     * @param {number} indexId
     * @param {PaidMgrIndexEntry} indexEntry
     * 
     * @memberOf PaidBackingStore
     */
    addIndex(indexId: number, indexEntry: PaidMgrIndexEntry): void {
        function cb(error: any, result: any): void {
            assert(error === null, "addIndexCB");
        }
    
        this.indexHandle.update({ _id: indexId },
                                { _id: indexId, value: indexEntry },
                                { upsert: true }, cb);
    }
    
    /**
     * Retrieves the contents of the template and index tables, and calls the
     * callback function when done with the data and error status. Note that
     * this is asynchronous.
     * 
     * @param {(err, templateObj, indexObj) => void} cb the callback function
     * 
     * @memberOf PaidBackingStore
     */
    load(cb: (error: any, templateObj?: PaidMgrTemplateEntry[], indexObj?: PaidMgrIndexEntry[])=>void) {
        var self = this;
    
        this.templateHandle.find().toArray(
            function(err, templateList: Array<any>) {
                if (err !== null) {
                    cb(err);
                    return;
                }
                
                self.indexHandle.find().toArray(
                    function(err, indexList: Array<any>) {
                        var templates: PaidMgrTemplateEntry[] = [];
                        var indices: PaidMgrIndexEntry[] = [];
                        var i: number;
                        for (i = 0; i < templateList.length; i++) {
                            var templateElement: any = templateList[i];
                            templates[templateElement._id] =
                                templateElement.value;
                        }
                        for (i = 0; i < indexList.length; i++) {
                            var indexElement: any = indexList[i];
                            indices[indexElement._id] = indexElement.value;
                        }
                        if (err === null) {
                            cb(null, templates, indices);
                        } else {
                            cb(err);
                        }
                    }
                );
            }
        );
    }
}

// TableResource takes care of retrieving and storing data tables. Data is
// stored using one record per path, which contains an array with simple
// values per data element for that path. The empty path contains the mapping
// information, in particular the number of elements.
// The table name is "tables.<ident>". This convention is set in
// ResourceMgr.getDatabaseResourceBySpec().
class TableResource extends Resource {

    constructor(ident: string, id: number, db: MongoDB, collection: MongoDBCollectionHandle,
                public app: string, public path: string[], public shadowCollection: MongoDBCollectionHandle) {
        super(ident, id, db, collection);
        this.alsoNotifyWriter = true;
    }
    
    getXDRFunc(): (cdlValue: any, xdr: XDR) => any {
        return function (elem: any, xdr: XDR): any {
            return elem;
        };
    }
    
    getIdentStrFunc(): IdentFunc {
        return function (elem) {
            var ident = elem.ident;
            return ident.templateId + ":" + ident.indexId + ":" +
                   ident.path.map((e: string) => "/" + encodeURIComponent(e));
        };
    }
    
    getAllElement(fromRevision: number, cb: ResourceCallback): void {
        if (!this.isReady) {
            // if the resource is not ready yet, queue requests
            this.readyQueue.push({
                type: "getAllElement",
                cb: cb,
                fromRevision: fromRevision
            });
            return;
        }
    
        if (this.collection === undefined) {
            cb(null, [], undefined);
        } else {
            var _self = this;
            this.collection.find({path: this.path}).
                toArray(function (err, data) {
                    var filtered = _self.filterAllElementRevision(fromRevision,
                                                                  data);
                    cb(err, { data: filtered.filtered }, filtered.maxRevision);
                    // process any writes pending this operation
                    _self.processReadyQueue();
                });
        }
    }
    
    removeTable(cb: ResourceCallback): void {
        var self = this;
    
        if (this.collection === undefined) {
            cb(null, [], undefined);
        } else {
            this.collection.drop(function(err, result) {
                if (!err) {
                    self.sendDirectUpdate([[]]);
                }
                if (self.shadowCollection !== undefined) { // TESTING
                    self.shadowCollection.drop(function(err, result){});
                }
                cb(err, result, undefined);
            });
        }
    }
    
    // Calls cb(err, exists, revision) with a boolean indicating the existence
    // of the table.
    // err and revision are always null and undefined (respectively). 
    checkExistence(cb: ResourceCallback): void {
        if (this.collection === undefined) {
            cb(null, false, undefined);
        } else {
            this.collection.findOne({}, function(err, data) {
                cb(null, !err && data, undefined);
            })
        }
    }
    
    // Writes using the bulk interface, which is apparently limited to 1000
    // records. The real reason seems to be that there is a 16MB limit on BSON,
    // so it might be that the 1000 is just a magic number and that proper operation
    // can be broken with 1000 very large records. [LIMITATION]
    write(originatingClientResourceId: number, tableData: any, cb: ResourceCallback): void {
        assert(typeof(originatingClientResourceId) === "number" &&
               typeof(tableData) === "object" &&
               typeof(cb) === "function", "TableResource.write: typecheck failed");

        var _self = this;
        
        if(this.lastRevision === undefined) {
            // still need to determine the revision by reading any data
            // already available (queue the write to take place when this is
            // completed)
            this.readyQueue.push(
                {
                    type: "write",
                    elementObj: tableData,
                    cb: cb,
                    originatingClientResourceId: originatingClientResourceId
                }
            );
            
            this.collection.find({path: this.path}, { _revision: true }).
                toArray(function (err, data) {
                    // this sets the revision number on the resource
                    _self.filterAllElementRevision(undefined, data);
                    // process any writes pending this operation
                    _self.processReadyQueue();
                });
            return;
        }
        
        var dbOp = this.collection;

        var revision: number = ++this.lastRevision;
        var revTimeStamp: string = new Date().toISOString();
        for (var i = 0, l = tableData.values.length; i < l; ++i) {
            tableData.values[i]._revision = revision;
            tableData.values[i]._revTimeStamp = revTimeStamp;
        }
        
        function insertValues(i: number): void {
            if (i === tableData.values.length) {
                // no callback, just for testing; disabled for now.
                // _self.writeShadow(tableData);
                cb(null, undefined, revision);
            } else {
                dbOp.insert(tableData.values[i], function(err, result) {
                    if (!err) {
                        insertValues(i + 1);
                    } else {
                        cb(err, undefined, revision);
                    }
                });
            }
        }

        dbOp.remove({}, function(err: any, result: any): void {
            if (!err) {
                dbOp.insert({
                    path: [],
                    _revision: revision,
                    mapping: tableData.mapping
                }, function(err, result) {
                    if (!err) {
                        insertValues(0);
                    } else {
                        cb(err, undefined, revision);
                    }
                });
            } else {
                cb(err, undefined, revision);
            }
        });
    }

    // TESTING. Doesn't do callbacks or anything, just unpacks the data in another
    // format in a shadow table. Can only handle single attributes.
    writeShadow(tableData: any): void {
        var data = new Array(tableData.mapping.nrDataElements);
        var self = this;
        var attrMap: {[attr: string]: string} = {};

        function decompressRawData(compressedData: any[], indexedValues: any[]|undefined): any[] {
            var data: any[] = [];
            var i: number, j: number;
            var offset: any, values: any;

            if (indexedValues === undefined) {
                for (i = 0; i < compressedData.length; i++) {
                    offset = compressedData[i].o;
                    values = compressedData[i].v;
                    for (j = 0; j < values.length; j++) {
                        data[offset + j] = values[j];
                    }
                }
            } else {
                for (i = 0; i < compressedData.length; i++) {
                    offset = compressedData[i].o;
                    values = compressedData[i].v;
                    for (j = 0; j < values.length; j++) {
                        data[offset + j] = indexedValues[values[j]];
                    }
                }
            }
            return data;
        }

        /// MongoDB doesn't like $ and . in attribute names, nor attributes
        /// starting with an underscore. These are removed; uniqueness is
        /// guaranteed by suffixing with a number.
        function remapAttributes(obj: any): any {
            if (typeof(obj) !== "object") {
                return obj;
            }
            if (obj instanceof Array) {
                return obj.map(remapAttributes);
            }
            var remapped: any = {};
            for (var attr in obj) {
                if (!(attr in attrMap)) {
                    var nAttr: string = attr.replace(/^_+/, "").replace(/[$.]/g, "");
                    if (nAttr in attrMap) {
                        var suffix: number = 0;
                        while ((nAttr + " " + suffix) in attrMap) {
                            suffix++;
                        }
                        nAttr += " " + suffix;
                    }
                    attrMap[attr] = nAttr;
                }
                remapped[attrMap[attr]] = remapAttributes(obj[attr]);
            }
            return remapped;
        }

        function insertShadowData(i: number): void {
            var bulk = self.shadowCollection.initializeOrderedBulkOp();

            if (i < data.length) {
                for (var j = i; j < data.length && j < i + 1000; j++) {
                    if (data[j] !== undefined) {
                        bulk.insert(remapAttributes(data[j]));
                    }
                }
                bulk.execute(function(err: any, result: any): void {
                    insertShadowData(i + 1000);
                });
            }
        }

        attrMap["_id"] = "_id"; // Don't remap this attribute
        for (var i = 0; i < tableData.values.length; i++) {
            var path = tableData.values[i].path;
            if (path.length !== 1) {
                continue;
            }
            var attr: string = path[0];
            var values = decompressRawData(tableData.values[i].pathValuesRanges,
                                           tableData.values[i].indexedValues);
            for (var j = 0; j < values.length; j++) {
                var v = values[j];
                if (v !== undefined && v !== null) {
                    if (data[j] === undefined) {
                        data[j] = {};
                        data[j]._id = j + 1; // Map data element id to _id; note that 0 is not a good _id
                    }
                    data[j][attr] = v;
                }
            }
        }
        insertShadowData(0);
    }
}

/* The meta data resource describes the tables known to the system, i.e. those
   accessible under tables.<ident> in one single os.
     For every table, a record with a single AV exists, and it must contain:
   - id: the identifier, so "tables." + id will retrieve the actual table;
     this value cannot be changed.
   - name: the full name; can be changed
   - attributes: an array of objects with the following attributes
        - name: can be changed
        - originalName: cannot be changed
        - type: can be changed, but changes carry a risk
        - uniqueValues: (optional; cannot be changed)
        - min: (optional; change on type change?)
        - max: (optional; change on type change?)
   It may also contain
   - lastUpdate: the numeric representation of a Date() which reflects the time
     of the last change.
   - tags: a mutable list of strings.
   - state: ?

   The data is stored in the table "metadata" (see ResourceMgr.
   getMetaDataResourceBySpec). It has one record per table, and the
   format of each record is a an xdr'ed version of the object. The _id of the
   record (since this server relies on mongo) must be the id of the table.

   Note that there is only one metadata resource.
*/

var gMetaDataResource: MetaDataResource;

class MetaDataResource extends Resource {
    objectId: any;

    constructor(ident: string, id: number, db: MongoDB, collection: MongoDBCollectionHandle,
                public resourceManager: ResourceMgr) {    
        super(ident, id, db, collection);
        var mongojs = require("mongojs");

        this.alsoNotifyWriter = true;
        this.objectId = mongojs.ObjectId;
        if (gMetaDataResource !== undefined) {
            RemotingLog.log(0, "ERROR : multiple metadata resources " +
                            ident + " " + id);
        }
        gMetaDataResource = this;
    }

    getXDRFunc(): (cdlValue: MetadataElement, xdr: XDR) => MetadataElement {
        return XDR.xdrMetadataElement;
    }

    // metadata update entries has a simple identifier stored under their
    // 'ident' entry.
    getIdentStrFunc(): IdentFunc {
        return function (elem) {
            return elem.ident;
        };
    }

    // The input is a list of objects as extracted from the mongo DB and the
    // external data sources.
    // This function converts these objects to the structure which
    // is sent to the client.
    
    getElementObj(elementList: any): ResourceElementMapByIdent {
        var elementObj: ResourceElementMapByIdent = {};
        var i: number;

        for (i = 0; i < elementList.length; i++) {
            // in case the entry is in an older format, upgrade it first
            var elem = MetadataFormatUpgrade.upgradeFormat(elementList[i]);
            if (!elem) {
                RemotingLog.log(0, "ERROR: empty metadata element");
                continue;
            }            
            elementObj[elem._id] = {
                ident: elem._id,
                revision: elem._revision,
                value: !elem.value ? // undefined/null is deleted
                    xdrDeleteIdent : elem.value
            }
        }
        return elementObj;
    }

    // Add external data sources (but only needed info; no connection info).
    addExternalData(elementObj: ResourceElementMapByIdent): void {
        var xdr = new AgentXDR(XDRDirection.Marshal, undefined);

        for (var i = 0; i < this.resourceManager.externalDataSources.length; i++) {
            var obj = this.resourceManager.externalDataSources[i];
            var eds = normalizeObject({
                name: obj.name,
                id: obj.id,
                attributes: obj.attributes,
                parameters: obj.queryParameters
            });
            elementObj[obj.id] = {
                ident: obj.id,
                revision: obj.revision === undefined? 1: obj.revision,
                value: xdr.xdrOS(eds)
            }
        }
    }
    
    // This function is called within the write() function (implemented
    // in the base class) to write a single element (given by 'elementObj')
    // into the metadata collection. 'eid' is the identfier of the metadata.
    // This should be the table ID for the relevant table, which should
    // also appear in the 'id' field of 'elementObj'. However, if this
    // is a new table, it was not yet assigned an ID by the mongo DB database.
    // Therefore, 'eid' would be the name of the database (which is not
    // necessarily unique, but is unique for a single write operation)
    // and 'id' would be missing in 'elementObj'. In that case, a new ID
    // is assigned to this entry (which creates a new metadata entry in
    // the database). This ID is then provided back to the writing client
    // through the write acknowledgement. The new ID assigned is stored in
    // the 'writeAckInfo' under an attribute equal to the old (temporary) ID.
    // If 'elementObj' contains a 'data' field, this is used to store
    // the relevant data in the data resources. This field is then
    // removed and not stored in the metadata table.
    // If a metadata entry already exist in the database for this ID,
    // the update is merged with the existing entry (which means that
    // fields which are missing in 'elementObj' will remain unchanged in
    // the database).
    // An undefined 'elementObj' or one which has 'remove: true' attribute
    // can be used to delete the corresponding table.
    // The function returns the ID of the element just written. If this
    // is assigned in this function, it is the ID assigned in the database
    // which is returned, which may differ from the original (temporary) ID.
    
    writeElement(originatingClientResourceId: number, eid: string,
                 elementObj: any, revision: number, revTimeStamp: string,
                 writeAckInfo: any,
                 cb: (err: Error, result: any) => void): string
    {
        if(elementObj !== undefined &&
           (elementObj.value === undefined ||
            elementObj.value.value === undefined)) {
            cb(new Error("value missing in metadata update"), undefined);
            return eid;
        }
        
        if(elementObj === undefined ||
           XDR.isTrue(elementObj.value.value.remove)) {
            // need to remove this table (eid must be a table ID)
            this.removeTable(eid, revision, revTimeStamp, cb);
            return eid;
        }

        // set the revision
        elementObj._revision = revision;
        elementObj._revTimeStamp = revTimeStamp; 
        
        var isNew = (elementObj.value.value.id === undefined);
        
        // determine the table ID for this entry (if there is an 'id'
        // field in 'elementObj', then this is the table ID and otherwise
        // a new table ID is allocated (and set on the object).
        var tableId = this.setUpdateTableId(elementObj);
        if(tableId === undefined) { // cound not assign a table ID
            cb(new Error("corrupted table ID in DB"), undefined);
            return eid;
        }

        if(isNew) { // notify of the new ID through the write acknowledgement
            writeAckInfo[eid] = tableId;
        }

        var _self = this;
        
        function updateMetadata(err: any, result: any, revision: number) {
            if (err) {
                RemotingLog.log(0, "ERROR: MetaDataResource.write " +
                                "bulk write failed");
                cb(err, result);
            } else {
                _self.collection.update({_id: tableId}, elementObj, 
                                        {upsert:true}, cb);
            }
        }

        function mergeAndUpdateMetadata(err: any, result: any,
                                        revision: number) {

            if(isNew) { // no need to merge with existing entry
                updateMetadata(err, result, revision);
                return;
            }
            
            // get the existing entry from the mongo DB (if exists) to merge
            // the update with it.
            _self.collection.find({_id: tableId}).toArray(
                function (err, elementList: Array<any>) {
                    if(err) {
                        cb(err, undefined);
                        return;
                    }

                    if (elementList.length === 1) {
                        // existing entry found, need to merge with update
                        elementObj = XDR.mergeXDRValues(elementObj,
                                                        elementList[0]);
                    }
                    updateMetadata(err, result, revision);
                })
        }

        // Take out the data from the update object
        var data = elementObj.value.value.data;
        delete elementObj.value.value.data;
    
        var hasData = data !== undefined && !XDR.isEmptyOS(data);

        if (hasData){
            this.writeData(originatingClientResourceId, tableId, data,
                           mergeAndUpdateMetadata);
        } else {
            updateMetadata(null, undefined, revision);
        }
        return tableId;
    }
    
    // When the metadata update received has a 'data' field, this function
    // stores this data in the table resource. There is no need to notify
    // other clients, as they only subscribe to the table resource as needed.
    // The callback provided to this function continues the metadata
    // update process.
    
    writeData(originatingClientResourceId: number, tableId: string,
              data: any, cb: ResourceCallback): void
    {
        // Get the resource for the table as we need to update it. It
        // does not need to call "getAllElement" or anything, we just
        // need it to get a unique handle to it and its database
        // interface.
        var tableResource =
            this.resourceManager.getDatabaseResourceBySpec({
                app: tableId,
                path: []
            });
        
        // Decode the data (tables are written as is) and update the table
        // and (when successful) the metadata
        var agentXDR = new AgentXDR(XDRDirection.Unmarshal, undefined);
        
        var tableData = agentXDR.xdrCdlObj(data);
        if (tableData instanceof Array) {
            if (tableData.length !== 1) {
                RemotingLog.log(0, "ERROR: MetaDataResource.write tableData");
                return;
            }
            tableData = tableData[0];
        }
        tableResource.write(originatingClientResourceId, tableData, cb);
    }
    
    // This function receives as input an update received from the client.
    // This is an object with a 'value' field which contains the actual
    // information. This function sets the _id field (next to the 'value'
    // field) which identifies this for insertion into the database.
    // If the 'value' object contains an 'id' field, this is the value
    // used. Otherwise, a new ID is generated and assigned (and also
    // placed under the 'id' field of 'value'). This function both modifies
    // the input object and returns the ID.
    
    setUpdateTableId(tableMetaDataUpdate: any): string {

        // Get the record id if specified, assuming that the sent record is
        // denormalized and assign _id before inserting/upserting
        var tableId = tableMetaDataUpdate.value.value.id;
        if (tableId === undefined) {
            // If not specified, ask mongo for a new, unique id
            var newId = new this.objectId();
            tableId = tableMetaDataUpdate.value.value.id = newId.toString();
            RemotingLog.log(1, "Allocated new table id: " + tableId);
        } else {
            if (typeof(tableId) !== "string") {
                RemotingLog.log(0, "ERROR: MetaDataResource.setUpdateTableId");
                return undefined;
            }
        }
        // assign _id (before inserting/upserting the mongo DB)
        tableMetaDataUpdate._id = tableId;

        return tableId;
    }
    
    // Remove the table, and when successful, remove the table's metadata
    
    removeTable(tableId: string, revision: number, revTimeStamp: string, 
                cb: (err: Error, result: any) => void): void
    {
        // Get the resource for the table as we need to update it.
        var tableResource =
            this.resourceManager.getDatabaseResourceBySpec({
                app: tableId,
                path: []
            });
        
        var _self = this;

        // update the metadata entry with an 'undefined' value. If no entry
        // is found in the mongo DB, this does not write a new entry into
        // the database.
        function removeMetaData() {
            _self.collection.update({ _id: tableId },
                                    { _id: tableId, _revision: revision,
                                      revTimeStamp,
                                      value: undefined },
                                    undefined, cb);
        }
    
        RemotingLog.log(1, function() {return "Removing table " + tableId;});
        tableResource.removeTable(function(err, result) {
            if (!err) {
                RemotingLog.log(1, function() {
                    return "Table removed " + tableId;
                });
                removeMetaData();
            } else {
                tableResource.checkExistence(function (_err, exists, revision) {
                    if (!exists) {
                        removeMetaData();
                    } else {
                        // Note: error from call to removeTable
                        cb(err, result);
                    }
                });
            }
        });
    }
}

function mergeXDRById(elem: any, os: any): { position: number; changed: boolean; } {
    for (var i = 0; i < os.os.length; i++) {
        if (os.os[i]._id === elem._id) {
            var origOsElem = os.os[i];
            os.os[i] = XDR.mergeXDRValues(elem, os.os[i]);
            os.os[i]._id = elem._id; // Can get removed by XDR.mergeXDRValues
            return {
                position: i,
                changed: !objectEqual(os.os[i], origOsElem)
            };
        }
    }
    os.os.push(elem);
    return {
        position: os.os.length - 1,
        changed: true
    };
}

function deleteFromXDRById(elem: any, os: any): boolean {
    for (var i = 0; i < os.os.length; i++) {
        if (os.os[i]._id === elem._id) {
            os.os.splice(i, 1);
            return true;
        }
    }
    return false;
}

// ExternalResource takes care of interacting with the external data source API
class ExternalResource extends Resource {

    externalDataSource: ExternalDataSource;

    constructor(ident: string, id: number,
        /**
         * The specification of the external data source
         */
        public externalDataSourceSpecification: ExternalDataSourceSpecification,
        /**
         * The parameters for the query
         */
        public parameterValues: any[],
        /**
         * The path within the external data source
         */
        public path: string[]
    ) {
        super(ident, id, undefined, undefined);
    }
    
    acquireResource(): void {
        if (this.externalDataSource === undefined) {
            for (var i = 0; i < externalDataSourceClasses.length; i++) {
                var edsc = externalDataSourceClasses[i];
                if (edsc.accepts(this.externalDataSourceSpecification, this.path)) {
                    this.externalDataSource = new edsc.classConstructor(
                        this.externalDataSourceSpecification,
                        ensureOS(this.parameterValues),
                        this.path);
                    return;
                }
            }
        }
        // Note that there won't be an externalDataSource when none of the
        // classes accepts the spec
    }

    purgeResource(): void {
        if (this.externalDataSource !== undefined) {
            this.externalDataSource.destroy();
            this.externalDataSource = undefined;
        }
    }

    getXDRFunc(): (cdlValue: any, xdr: XDR) => any {
        return function (elem: any, xdr: XDR): any {
            return elem;
        };
    }
    
    getIdentStrFunc(): IdentFunc {
        var queryParamStr = JSON.stringify(this.parameterValues);

        return function (elem) {
            var ident = elem.ident;
            return ident.templateId + ":" + ident.indexId + ":" +
                   ident.path.map((e: string) => "/" + encodeURIComponent(e)) +
                   "." + queryParamStr;
        };
    }
    
    getAllElement(fromRevision: number, cb: ResourceCallback): void {
        if (this.externalDataSource === undefined) {
            cb("no such external data source", [], 1);
        } else if (!this.isReady) {
            // if the resource is not ready yet, queue requests
            this.readyQueue.push({
                type: "getAllElement",
                cb: cb,
                fromRevision: fromRevision
            });
        } else {
            this.externalDataSource.getData((err: any, data: any): void => {
                var elementObj: ResourceElementMapByIdent = {};
                elementObj[this.id] = data;
                cb(err, elementObj, 1);
            });
        }
    }
    
    setReady(): void {
        this.isReady = true;
        this.processReadyQueue();
    }

    removeTable(cb: ResourceCallback): void {
        cb("can't remove external data source", [], undefined);
    }
    
    // Calls cb(err, exists, revision) with a boolean indicating the existence
    // of the table.
    // err and revision are always null and undefined (respectively). 
    checkExistence(cb: ResourceCallback): void {
        cb(null, false, undefined);
    }
}
