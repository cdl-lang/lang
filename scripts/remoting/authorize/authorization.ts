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

/// <reference path="../remotingLog.ts" />
/// <reference path="../mongojs.d.ts" />
/// <reference path="../../utils/node.d.ts" />

declare var fs: typeof FS;
var mongojs: (connectionString: string) => MongoDB = require('mongojs');

//
// this file defines the Authorization class, which allows maintaining an
//  authorization policy for resources, and making authorization queries,
//  testing whether a specific user (the 'accessor') should be allowed access
//  to a specific resource.
//
// In addition, if the second argument to Authorization constructor is non-null,
//  it is the path to the user-email file; for an accessor to be authorized, the
//  accessor must have a line in self file.
//
// A 'resource' in this class is defined using a triad:
//
//  owner - the user who is the owner of the resource
//  restype - the resource type
//  resname - the resource name
//
// For each resource an authorization policy may be defined. An authorization
//  policy is a map from 'accessors' (user names) to booleans, interpreted as
//  'allow' (true) and 'deny' (false). The authorization policy for each
//  resource may include a wildcard user, matching any user for which a
//  specific rule was not specified
//
// For each owner, there may also be defined an authorization policy for a
//  'wildcard' resource (type and name == '*').
//
// Specifically, given a query whether an accessor should be allowed / denied
//  access to a resource <owner;restype;resname>, the answer is derived as
//  follows:
//
// 1. if the accessor is the owner, access is allowed
//
// (otherwise)
// 2.
//   a. if the owner's wildcard policy explicitly denies access from the
//       accessor, access is denied
//   (otherwise)
//   b. if the owner's wildcard policy does not explicitly allow the accessor,
//       yet does have a rule denying the wildcard user, access is denied
//
// (otherwise)
// 3.
//   a. if the resource policy has a rule for the accessor, access is allowed
//       or denied as stated in self rule
//   (otherwise)
//   b. if the resource policy has a rule for the wildcard user, access is
//       allowed or denied as stated in self rule
//
// (otherwise)
// 4. if the wildcard policy has a rule accepting the accessor or the wildcard
//     user, access is allowed
//
// (otherwise)
// 5. access is denied
//
//
// API:
//  - constructor:
//     var authorization = new Authorization(mongoDBName);
//
//  - authorization query:
//     'cb' is called with a boolean 'isAuthorized' - unless error is truthy,
//        in which case 'isAuthorized' should be ignored
//
//     authorization.isAuthorized(owner, restype, resname, accessor, cb);
//
//     cb(error, isAuthorized);
//
//  - modifying an authorization policy:
//     restype, resname and accessor may be 'Authorization.wildcard'.
//     perm should be either boolean (for allow/deny) or the string 'DELETE'
//        (in order  to remove the accessor from the resource policy).
//     'isUpdated' should be true unless there was an error.
//
//     authorization.updateRule(owner, restype, resname, accessor, perm, cb);
//
//     cb(error, isUpdated);
//
//  - fetch authorization policy of a resource:
//     restype and resname may be 'Authorization.wildcard'.
//     when there is no error, policy is a boolean valued object indexed
//      by accessors
//
//      authorization.getResourcePolicy(owner, restype, resname, cb);
//
//     cb(error, policy);
//     policy = { 'gil': false, 'uri': true, '$*': false };
//
//  - fetch list of owners with at least one resource authorization policy:
//     when there is no error, cb's ownerList would be an array with owner names
//
//      authorization.getOwnerList(cb);
//
//      cb(error, ownerList);
//      ownerList = [ 'gil', 'uri' ];
//
//  - fetch a list of resources owned by the given owner for which a policy
//      is defined
//     when there is no error, cb's resourceList would be an array of objects,
//      each object having a 'restypoe:' and 'resname:' atttributes
//
//     authorization.getOwnerResourceList(owner, cb);
//
//     cb(error, resourceList);
//     resourceList = [
//          { restype: "appState", resname: "myLeanFSApp" },
//          { restype: "*", resname: "*" },
//          { restype: "appState", resname: "myFatFSApp" }
//     ];
//
// Implementation:
//
// The per-resource authorization policies are maintained as mongodb
//   collections. The policy for the resource <owner;restype;resname> is
//   stored in a collection named 'rra.<owner>:<restype>:<resname>'. Using
//   colons makes mongodb usage a bit awkward, but should make it easier to
//   allow periods in usernames ('gil.harari') if required.
// The database name is passed as an argument in Authorization construction.
//
// If the user-email file is passed as a non-null value, the isAuthorized method
//  also verifies self the accessor is still defined in self file. This is
//  done only if the modified time of the file is later than the last such test.
// The list of users in the file is cached as an object with user-name
//  attributes; this assumes self the list is not too long.
//  
//

type AuthorizationCallback<Result> = (error: Error|string, username: string, result: Result|undefined) => void;

type AuthorizationWildCard = {
    _w_c_: string;
}[];

type AuthorizationPart = string|AuthorizationWildCard;

type AuthorizationThreadInfo = {
    authorization: Authorization;
    resowner: string;
    restype: string;
    resname: string;
    accessor: string;
    cb: AuthorizationCallback<boolean>;
    wildcardPerm: boolean|undefined;
};

type CollectionName = {
    restype: string;
    resowner: string;
    resname: string;
};

class Authorization {

    lastFileCheckTime: number = undefined;
    lastFileCheckUserObj: any = undefined;

    /**
     * When true, access to database resources is granted to every subscriber
     */
    static publicDataAccess: boolean = false;
    /**
     * When true, user name/password combinations come from the user email file;
     * when false, they come from the global table 'userAdmin' in the mongo db.
     */
    static useAuthFiles: boolean = true;
    /**
     * When true, a request for creating a new user/password combination from
     * the browser is accepted.
     */
    static allowAddingUsers: boolean = false;

    constructor(public db: MongoDB, public userEmailFile: string) {
    }
    
    static alwaysAllowOwner = true;
    
    // the contents are irrelevant - the address ('pointer address') is all self
    //  matters
    static wildcard: AuthorizationWildCard = [ { _w_c_: '*' } ];
    
    /**
     * Calls cb with result of authorizing the current user for a given
     * resource specification.
     * 
     * The basis of authentication is a series of records in the database, which
     * is all or nothing. E.g., they do not specify read/write permissions. If
     * these are added, account switching must be adapted too.
     * 
     * @param resowner owner account name of the resource
     * @param restype resource type: app state, table or metadata
     * @param resname name of the resource
     * @param accessor name of the account that wants to access the resource
     * @param cb callback function
     */
    isAuthorized(resowner: string, restype: string, resname: string,
                 accessor: string, cb: AuthorizationCallback<boolean>): void {
        var self = this;
    
        RemotingLog.log(3, () =>  "Authorization.isAuthorized(ownr=" + resowner +
                           ", rtyp=" + restype + ", rname=" + resname +
                           ", accessor=" + accessor + ")"
        );
        if (!Authorization.isValidOwnername(resowner)) {
            RemotingLog.log(1, "Authorization.isAuthorized: invalid owner");
            cb("Invalid owner", undefined, false);
            return;
        }
        if (!Authorization.isValidUsername(accessor)) {
            RemotingLog.log(1, "Authorization.isAuthorized: invalid accessor");
            cb("Invalid accessor", undefined, false);
            return;
        }
        if (!Authorization.isValidResourcename(resname)) {
            RemotingLog.log(1, "Authorization.isAuthorized: invalid resource");
            cb("Invalid resource", undefined, false);
            return;
        }
    
        function isAuthorizedCont(perm: boolean): void {
            if (perm === true) {
                self.isAuthorizedCont1(resowner, restype, resname, accessor, cb);
            } else {
                cb(null, undefined, false);
            }
        }
    
        if (this.userEmailFile === null) {
            isAuthorizedCont(true);
            return;
        }
    
        function isAccessorInFileCont(): void {
            if  (self.lastFileCheckUserObj === undefined ||
                   !(accessor in self.lastFileCheckUserObj)) {
                RemotingLog.log(1, "Authorization.isAuthorized: accessor not in file");
                cb(null, undefined, false);
            } else {
                isAuthorizedCont(true);
            }
        }
    
        if (Authorization.useAuthFiles) {
            this.getUserEmailFileLastModifiedTime(
                function (mtime: number): void {
                    if (isNaN(self.lastFileCheckTime) || isNaN(mtime) ||
                        mtime >= self.lastFileCheckTime) {
                        self.updateUserEmailCache(isAccessorInFileCont);
                    } else {
                        isAccessorInFileCont();
                    }
                }
            );
        } else {
            this.db.collection("userHash").findOne(
                { userName: accessor },
                function(err: any, result: any): void {
                    if (err) {
                        RemotingLog.log(1, "Authorization.isAuthorized: accessor not in db");
                        cb(err, undefined, false);
                    } else {
                        isAuthorizedCont(true);
                    }
                }
            );
        }
    }
    
    // --------------------------------------------------------------------------
    // getUserEmailFileLastModifiedTime
    //
    getUserEmailFileLastModifiedTime(cb: (mtime: number) => void) {
        fs.stat(
            this.userEmailFile,
            function (err: any, stats: any): void {
                if (!err && stats && stats.mtime) {
                    cb(stats.mtime.getTime());
                } else {
                    RemotingLog.log(2, "Authorization.isAuthorized: fs.stat error");
                    cb(undefined);
                }
            }
        );
    }
    
    // --------------------------------------------------------------------------
    // updateUserEmailCache
    //
    updateUserEmailCache(cb: () => void): void {
        var userCache: any = {};
        var userRegExp: RegExp = Authorization.usernameInUserEmailFileRegexp;
        var self = this;
    
        this.lastFileCheckTime = Date.now();
        try {
            fs.readFile(
                self.userEmailFile, 'utf8',
                function (err: any, data: string): void {
                    if (err) {
                        RemotingLog.log(
                            2, "Authorization.isAuthorized: readFile error");
                        self.lastFileCheckUserObj = {};
                    } else {
                        data.toString().split(/\n/).forEach(
                            function (line: string): void {
                                var res = userRegExp.exec(line);
                                if (res !== null) {
                                    var username  = res[1];
                                    userCache[username] = true;
                                }
                            }
                        );
                        self.lastFileCheckUserObj = userCache;
                    }
                    cb();
                }
            );
        } catch (e) {
            this.lastFileCheckUserObj = {};
            RemotingLog.log(2, "Authorization.isAuthorized: readfile exception");
            cb();
        }
    }
    
    // --------------------------------------------------------------------------
    // isAuthorizedCont1
    //
    isAuthorizedCont1(resowner: string, restype: string, resname: string,
                     accessor: string, cb: AuthorizationCallback<boolean>): void
    {
        if (Authorization.alwaysAllowOwner && resowner === accessor) {
            RemotingLog.log(2, "Authorization.isAuthorized: allow owner==accessor");
            cb(null, accessor, true);
            return;
        }
    
        var authResource =
                new AuthorizationResource(this.db, resowner, '*', '*');
        var thread: AuthorizationThreadInfo = {
            authorization: this,
            resowner: resowner,
            restype: restype,
            resname: resname,
            accessor: accessor,
            cb: cb,
            wildcardPerm: undefined
        };
    
        function isAuthorizedCont(err: any, username: string, perm: boolean): void {
            RemotingLog.log(2, function() {
                return "Authorization.isAuthorized(ownr=" + resowner +
                       ", res=*:*, accessor=" + accessor + "): bool(err)=" +
                       !!err + ", perm=" + perm;
            });
            thread.authorization.isAuthorizedCont2(thread, err, perm);
        }
    
        authResource.getAccessorPerm(accessor, isAuthorizedCont);
    }
    
    // --------------------------------------------------------------------------
    // isAuthorizedCont2
    //
    isAuthorizedCont2(thread: AuthorizationThreadInfo, err: any, perm: boolean): void {
        var cb = thread.cb;
    
        // error
        if (err) {
            RemotingLog.log(2, function() {
                return "Authorization.isAuthorized(ownr=" + thread.resowner +
                       ", res=*:*, accessor=" + thread.accessor + "): err=" + err;
            });
            cb(err, undefined, false);
            return;
        }
        // wild-card denied
        if (perm === false) {
            RemotingLog.log(2, function() {
                return "Authorization.isAuthorized(ownr=" + thread.resowner +
                       ", res=*:*, accessor=" + thread.accessor +
                       ", perm=" + perm;
            });
            cb(err, undefined, false);
        }
    
        thread.wildcardPerm = perm;

        function isAuthorizedCont(err: any, username: string, perm: boolean): void {
            thread.authorization.isAuthorizedCont3(thread, err, perm);
        }
    
        var authResource = new AuthorizationResource(
            this.db, thread.resowner, thread.restype, thread.resname);
    
        authResource.getAccessorPerm(thread.accessor, isAuthorizedCont);
    }
    
    // --------------------------------------------------------------------------
    // isAuthorizedCont3
    //
    isAuthorizedCont3(thread: AuthorizationThreadInfo, err: any, perm: boolean): void {
        var cb = thread.cb;
    
        // error
        if (err) {
            RemotingLog.log(3, function() {
                return "Authorization.isAuthorized<3a>(ownr=" + thread.resowner +
                       ", rtyp=" + thread.restype + ", rname=" + thread.resname +
                       ", accessor=" + thread.accessor + "): err=" + err;
            });
            cb(err, undefined, false);
            return;
        }
    
        // explicit, specific answer
        if (perm === false || perm === true) {
            RemotingLog.log(3, function() {
                return "Authorization.isAuthorized<3b>(ownr=" + thread.resowner +
                       ", rtyp=" + thread.restype + ", rname=" + thread.resname +
                       ", accessor=" + thread.accessor + "): perm=" + perm;
            });
            cb(err, thread.accessor, perm);
            return;
        }

        if (thread.wildcardPerm === true) {
            RemotingLog.log(3, function() {
                return "Authorization.isAuthorized<3c>(ownr=" + thread.resowner +
                       ", rtyp=" + thread.restype + ", rname=" + thread.resname +
                       ", accessor=" + thread.accessor + "): wildcard allow";
            });
            cb(err, thread.accessor, true);
            return;
        }
    
        if (thread.resowner === thread.accessor) {
            RemotingLog.log(3, function() {
                return "Authorization.isAuthorized<3d>(ownr=" + thread.resowner +
                       ", rtyp=" + thread.restype + ", rname=" + thread.resname +
                       ", accessor=" + thread.accessor + "): allow owner==accessor";
            });
            cb(err, thread.accessor, true);
            return;
        }
    
        if (Authorization.publicDataAccess && (thread.restype === "table" || thread.restype === "metadata")) {
            RemotingLog.log(3, function() {
                return "Authorization.isAuthorized<3e>(ownr=" + thread.resowner +
                       ", rtyp=" + thread.restype + ", rname=" + thread.resname +
                       ", accessor=" + thread.accessor + "): allow owner==accessor";
            });
            cb(err, thread.accessor, true);
            return;
        }
    
        RemotingLog.log(3, function() {
                return "Authorization.isAuthorized<3f>(ownr=" + thread.resowner +
                       ", rtyp=" + thread.restype + ", rname=" + thread.resname +
                       ", accessor=" + thread.accessor + "): default deny";
        });
        cb(err, undefined, false);
    }
    
    
    // --------------------------------------------------------------------------
    // updateRule
    //
    updateRule(resowner: string, restype: AuthorizationPart, resname: AuthorizationPart,
               accessor: AuthorizationPart, perm: boolean|string, cb: AuthorizationCallback<boolean>): void
    {
        if (!Authorization.isValidOwnername(resowner)) {
            cb("Invalid owner", undefined, false);
            return;
        }
    
        if (accessor === Authorization.wildcard) {
            accessor = "$*";
        } else if (!Authorization.isValidUsername(accessor)) {
            cb("Invalid accessor", undefined, false);
            return;
        }
    
        if (resname === Authorization.wildcard) {
            resname = '*';
        } else if (!Authorization.isValidResourcename(resname)) {
            cb("Invalid resource", undefined, false);
            return;
        }
    
        if (restype === Authorization.wildcard) {
            restype = '*';
        } else if (! Authorization.isValidResourcename(restype)) {
            cb("Invalid resource type", undefined, false);
            return;
        }
    
        var authResource = new AuthorizationResource(this.db, resowner,
                                          restype as string, resname as string);
        authResource.updateAccessorRule(accessor as string, perm, cb);
    }
    
    // --------------------------------------------------------------------------
    // getResourcePolicy
    //
    getResourcePolicy(resowner: string, restype: AuthorizationPart, resname: AuthorizationPart, cb: AuthorizationCallback<{[id: string]: boolean}>): void {
        if (!Authorization.isValidOwnername(resowner)) {
            cb("Invalid owner", resowner, {});
            return;
        }
    
        if (resname === Authorization.wildcard) {
            resname = '*';
        } else if (! Authorization.isValidResourcename(resname)) {
            cb("Invalid resource", resowner, {});
            return;
        }
    
        if (restype === Authorization.wildcard) {
            restype = '*';
        } else if (!Authorization.isValidResourcename(restype)) {
            cb("Invalid resource type", resowner, {});
            return;
        }

        var authResource = new AuthorizationResource(this.db, resowner,
                                          restype as string, resname as string);
    
        authResource.getRuleSet(cb);
    }
    
    // --------------------------------------------------------------------------
    // getOwnerList
    //
    getOwnerList(cb: AuthorizationCallback<string[]>): void {

        function findOwnerCB(error: any, docs: any[]) {
            if (error) {
                cb(error, undefined, []);
                return;
            }
            if (!Array.isArray(docs)) {
                cb("Authorization.getOwnerList: Unexpected type", undefined, []);
                return;
            }
    
            var ownerObj: {[id: string]: boolean} = {};
            for (var i = 0; i < docs.length; i++) {
                var colname = docs[i];
                var resobj = AuthorizationResource.parseCollectionName(colname);
                if (resobj === undefined) {
                    RemotingLog.log(3, "non-authorization collection '" +
                                       colname + "'");
                    continue;
                }
                ownerObj[resobj.resowner] = true;
            }
            cb(error, undefined, Object.keys(ownerObj));
        }
    
        this.db.getCollectionNames(findOwnerCB);
    }
    
    // --------------------------------------------------------------------------
    // getOwnerResourceList
    //
    getOwnerResourceList(owner: string, cb: AuthorizationCallback<any[]>) {

        function findOwnerResourceCB(error: string, docs: any[]): void {
            if (error) {
                cb(error, undefined, []);
                return;
            }
    
            if (!Array.isArray(docs)) {
                cb("Authorization.getOwnerResourceList: Unexpected type", undefined, []);
                return;
            }
    
            var resourceList = [];
            for (var i = 0; i < docs.length; i++) {
                var colname = docs[i];
                var resobj = AuthorizationResource.parseCollectionName(colname);
                if (resobj === undefined) {
                    RemotingLog.log(3, "non-authorization collection '" +
                                       colname + "'");
                    continue;
                }
                if (resobj.resowner === owner) {
                    resourceList.push(resobj);
                }
            }
            cb(error, undefined, resourceList);
        }
    
        if (!Authorization.isValidOwnername(owner)) {
            cb("Invalid owner", undefined, []);
            return;
        }
        this.db.getCollectionNames(findOwnerResourceCB);
    }

    
    static validUsernameRegex = /^[^\t]+$/;
    static validResourcenameRegex = /^[a-zA-Z0-9_]+$/;
    static usernameInUserEmailFileRegexp = /^([a-zA-Z0-9_]+):/;

    // --------------------------------------------------------------------------
    // isValidOwnername (static)
    //
    static isValidOwnername(username: AuthorizationPart): boolean {
        return typeof(username) === "string" &&
               Authorization.validUsernameRegex.test(username);
    }
    
    // --------------------------------------------------------------------------
    // isValidUsername (static)
    //
    static isValidUsername(username: AuthorizationPart): boolean {
        return Authorization.isValidOwnername(username) &&
               username !== "anonymous";
    }
    
    // --------------------------------------------------------------------------
    // isValidResourcename (static)
    //
    static isValidResourcename = function(resname: AuthorizationPart): boolean {
        return typeof(resname) === "string" &&
               Authorization.validResourcenameRegex.test(resname);
    }
}

class AuthorizationResource {

    collection: any = undefined;

    constructor(public db: MongoDB, public resowner: string,
                public restype: string, public resname: string) {
        var cname =
                AuthorizationResource.getCollectionName(resowner, restype, resname);
    
        this.collection = this.db.collection(cname);
    }
    
    // --------------------------------------------------------------------------
    // getCollectionName (static)
    //
    static getCollectionName(resowner: string, restype: string, resname: string): string {
        //return "rra." + resowner + ":" + restype + ":" + resname;
        return "rrm." + resowner + "." + restype + "." + resname;
    }
    
    static collectionNameParseRegex: RegExp =
        ///^rra.([^.:]+):([^.:]+):([^.:]+)$/;
        /^rrm.([^.:]+).([^.:]+).([^.:]+)$/;
    
    //rrm.appState.uri.myLeanZCApp
    //(1) appState = type
    //(2) uri = owner
    //(3) myLeanZCApp = name
    
    static parseCollectionName(cname: string): CollectionName {
        var res = AuthorizationResource.collectionNameParseRegex.exec(cname);

        if (typeof(res) !== "object" || res === null || res[1] === undefined ||
              res[2] === undefined || res[3] === undefined) {
            return undefined;
        }
        return {
            restype: res[1],  // resowner: res[1],
            resowner: res[2], // restype: res[2],
            resname: res[3]   // resname: res[3]
        };
    }
    
    updateAccessorRule(accessor: string, perm: boolean|string, cb: AuthorizationCallback<boolean>): void {
        if (typeof(perm) === "boolean") {
            this.collection.update(
                { _id: accessor},
                { _id: accessor, perm: perm },
                { upsert: true },
                cb
            );
        } else if (perm === "DELETE") {
            this.collection.remove( { _id: accessor }, false, cb);
        } else {
            RemotingLog.log(1, "Authorization.updateAccessorRule: " +
                            "unexpected 'perm' (" + typeof(perm) + ")");
            cb("unexpected perm", undefined, false);
        }
    }
    
    getRuleSet(cb: AuthorizationCallback<{[id: string]: boolean}>): void {
        this.collection.find(
            function (err: any, ruleSet: any[]) {
                var ruleObj: {[id: string]: boolean} = undefined;
                if (err === null) {
                    ruleObj = {};
                    for (var i = 0; i < ruleSet.length; i++) {
                        var rule = ruleSet[i];
                        ruleObj[rule._id] = rule.perm;
                    }
                }
                cb(err, undefined, ruleObj);
            }
        );
    }
    
    getAccessorPerm(accessor: string, cb: AuthorizationCallback<boolean>): void {
        var self = this;
    
        function getAccessorPermCont(error: any, docs: any): void {
            self.getAccessorPermCont(accessor, cb, error, docs, 1);
        }
            
        this.collection.find({_id: accessor}, getAccessorPermCont);
    }
    
    // --------------------------------------------------------------------------
    // getAccessorPermCont
    //
    getAccessorPermCont(accessor: string, cb: AuthorizationCallback<boolean>, error: any, docs: any, stage: number): void {
        if (error) {
            cb(error, undefined, false);
            return;
        }
        if (docs instanceof Array && docs.length === 1) {
            var perm = docs[0].perm;
            if (typeof(perm) !== "boolean") {
                cb("Non-boolean perm", undefined, false);
                return;
            }
            cb(error, undefined, perm);
            return;
        }
    
        var self = this;
        function getAccessorPermCont(error: any, docs: any): void {
            self.getAccessorPermCont(accessor, cb, error, docs, stage);
        }
    
        if (stage === 1) {
            stage++;
            if (accessor === this.resowner) {
                this.collection.find({_id: "$owner"}, getAccessorPermCont);
                return;
            }
        }
    
        if (stage === 2) {
            stage++;
            this.collection.find({_id: "$*"}, getAccessorPermCont);
            return;
        }
    
        if (stage === 3) {
            stage++;
            cb(error, undefined, null);
            return;
        }
    
        cb("Unexpected stage", undefined, false);
    }
}
