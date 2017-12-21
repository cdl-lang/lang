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

/// <reference path="../feg/externalTypes.basic.d.ts" />
/// <reference path="authorize/authorization.ts" />
/// <reference path="../feg/xdr.ts" />

var child_process: typeof ChildProcess = require("child_process");
var url: typeof NodeJS.url = require("url");
var crypto: Crypto = require("crypto");
requireBtoaAtob();

// this file deals with ways a client connection may authenticate itself as
//  associated with a specific username, when connecting to the
//  persistence server as a web-socket client
//
//
// there are two different ways:
//
// 1. username/password based:
//   The client sends an AUTHORIZATION header, following http 'basic'
//     authentication standard: a base64 of '<username>:<password>'
//
// 2. cookie based:
//   The client sends an 'mauth' cookie, which the server validates using an
//     external command
//

interface Cookie {
    name: string;
    value: string;
}

type ValidationCallback = (success: boolean, username: string) => void;

class WSAuth {
    
    static wwwRoot: string = "/var/www";
    
    static validate(headers: any, cookieList: Cookie[], authDB: MongoDB, cb: AuthorizationCallback<boolean>, flags: any): void {
        if (flags && flags.origin !== "not-required") {
            if (!WSAuth.validateOrigin(headers)) {
                cb(null, undefined, false);
                return;
            }
        }

        if ("authorization" in headers) {
            var authStr = headers["authorization"];
            RemotingLog.log(2, function() {
                return "validating authorization header '" + authStr + "'";
            });
            BasicWSAuth.validate(authStr, authDB, cb);
            return;
        }
    
        for (var i = 0; i < cookieList.length; i++) {
            var cookie = cookieList[i];
            if (cookie.name === "mauth") {
                RemotingLog.log(2, function() {
                    return "validating 'mauth' cookie '" + cookie.value + "'";
                });
                CookieAuth.validate(cookie.value, cb);
                return;
            }
        }
    
        RemotingLog.log(2, "no 'authorization' header nor 'mauth' cookie present");
    
        cb("no cookie", undefined, false);
    }
    
    static validateOrigin(headers: any): boolean {
        if (!("origin" in headers)) {
            RemotingLog.log(1, "WSAuth.validate: 'Origin' header missing");
            return false;
        }
    
        var origin = headers["origin"];
        var originUrlObj = url.parse(origin);
        var wsHostPort = headers["host"] || "";
        var wsHost = wsHostPort.split(":")[0];

        if (typeof(wsHost) !== "string" || wsHost !== originUrlObj.hostname ||
              originUrlObj.protocol !== "https:") {
            RemotingLog.log(1, function() {
                return "websocket host '" + String(wsHost) +
                       "' must match " + "'origin' host '" + originUrlObj.hostname +
                       "' and " + "origin.protocol '" + originUrlObj.protocol +
                       "' must be '" + "https:'";
            });
            return false;
        }
        return true;
    }
}

class BasicWSAuth {
    
    static passwordCheck = "/auth/passwordCheck.php";
    
    // --------------------------------------------------------------------------
    // validate (static)
    //
    // http basic authentication:
    //   the user and password are concatenated, separated by a colon ':',
    //   encoded with base64, then the string 'Basic' is prepended
    //
    // XXX  rumor has it that 'atob'/'btoa' does not support unicode
    static validate(authStr: string, authDB: MongoDB, cb: AuthorizationCallback<boolean>): void {
        if (! (/^Basic /.test(authStr))) {
            RemotingLog.log(2,
                "BasicWSAuth.validate: authStr does not start with 'Basic '");
            cb("basic authorization error", undefined, false);
            return;
        }
    
        var b64up = authStr.slice(6).trim();
        var userPassword = btoa(b64up);
        var upa = userPassword.split(":");
        if (!(upa instanceof Array) || upa.length !== 2) {
            RemotingLog.log(2, "BasicWSAuth.validate: upa.length != 2");
            cb("basic authorization error", undefined, false);
            return;
        }
    
        var username = upa[0];
        var password = upa[1];
        BasicWSAuth.validateLogin(authDB, username, password, cb);
    }
    
    static validateLogin(authDB: MongoDB, username: string, password: string, cb: AuthorizationCallback<boolean>): void {
        if (authDB === undefined) {
            BasicWSAuth.doValidate(username, password, cb);
        } else {
            BasicWSAuth.doValidateFromDB(authDB, username, password, cb);
        }
    }

    // --------------------------------------------------------------------------
    // doValidate
    //
    static doValidate(username: string, password: string, cb: AuthorizationCallback<boolean>): void {
        var cmd = WSAuth.wwwRoot + BasicWSAuth.passwordCheck +
                " " + username + " " + password;

        child_process.exec(cmd, function (error: Error, stdout: string, stderr: string) {
            if (error === null && stdout.trim() === "yes") {
                RemotingLog.log(3, function() {
                    return "Password Matches! (user=" + username + ")";
                });
                cb(null, username, true);
            } else {
                RemotingLog.log(2, function() {
                    return "Password Check Error: " + error +
                           "(user=" + username + ")";
                });
                cb("login error", undefined, false);
            }
        });
    }

    /* Password hashing, adapted from the php scripts
     *
     * A new password is hashed a number of times with a randomly chosen salt.
     * User name, the chosen algorithm, number of iterations, salt and hash are
     * then stored as the hash (binary values are stored as hex strings).
     * 
     * When a user wants to get access, the hash is retrieved, and the entered
     * password is hashed according to the stored parameters. Both username and
     * hash have to be identical in order to get the go-ahead.
     */

    // Hash algorithm, nr iterations, key length and salt size can be changed
    // without affecting existing hashes. Note that keys are encoded as strings
    // of hex digits, so the length of the string is twice that of the buffer.
    static PBKDF2_HASH_ALGORITHM: string = "sha512";
    static PBKDF2_ITERATIONS: number = 3842;
    static PBKDF2_SALT_BYTE_SIZE: number = 56;
    static PBKDF2_KEY_LEN: number = 36;

    static HASH_SECTIONS: number = 5;
    static HASH_USERNAME_INDEX: number = 0;
    static HASH_ALGORITHM_INDEX: number = 1;
    static HASH_ITERATION_INDEX: number = 2;
    static HASH_SALT_INDEX: number = 3;
    static HASH_PBKDF2_INDEX: number = 4;

    static doValidateFromDB(authDB: MongoDB, username: string, password: string, cb: AuthorizationCallback<boolean>): void {
        var userHashCollection = authDB.collection("userHash");

        function verifyPwd(err: any, result: any): void {
            if (err !== null || !(result instanceof Object)) {
                cb("login error", undefined, false);
                return;
            }
            var hash: any = result.hash;
            if (typeof(hash) !== "string") {
                cb("internal error", undefined, false);
                return;
            }
            var hashComponents = hash.split("\t");
            if (hashComponents.length !== BasicWSAuth.HASH_SECTIONS) {
                cb("internal error", undefined, false);
                return;
            }
            var knownPwdHash: string = hashComponents[BasicWSAuth.HASH_PBKDF2_INDEX];
            var passwordHash = (<any>crypto).
                pbkdf2Sync(password,
                           hashComponents[BasicWSAuth.HASH_SALT_INDEX],
                           Number(hashComponents[BasicWSAuth.HASH_ITERATION_INDEX]),
                           knownPwdHash.length / 2,
                           hashComponents[BasicWSAuth.HASH_ALGORITHM_INDEX]).
                toString('hex');
            var auth = username === hashComponents[BasicWSAuth.HASH_USERNAME_INDEX] &&
                       knownPwdHash === passwordHash;
            cb(auth? null: "login error", username, auth);
        }

        if (userHashCollection) {
            userHashCollection.findOne({userName: username}, verifyPwd);
        } else {
            cb("internal error", undefined, false);
        }
    }

    static addUserNamePasswordEmail(authDB: MongoDB, username: string,
            password: string, email: string, update: boolean,
            cb: AuthorizationCallback<boolean>): void {
        var userHashCollection = authDB.collection("userHash");

        function createHash(): string {
            var salt = (<any>crypto).randomBytes(BasicWSAuth.PBKDF2_SALT_BYTE_SIZE).toString('hex');
            var pwdHash = (<any>crypto).
                pbkdf2Sync(password, salt,
                           BasicWSAuth.PBKDF2_ITERATIONS,
                           BasicWSAuth.PBKDF2_KEY_LEN,
                           BasicWSAuth.PBKDF2_HASH_ALGORITHM
                ).toString('hex');
            var hashComponents: string[] = [];

            hashComponents[BasicWSAuth.HASH_USERNAME_INDEX] = username;
            hashComponents[BasicWSAuth.HASH_ALGORITHM_INDEX] = BasicWSAuth.PBKDF2_HASH_ALGORITHM;
            hashComponents[BasicWSAuth.HASH_ITERATION_INDEX] = String(BasicWSAuth.PBKDF2_ITERATIONS);
            hashComponents[BasicWSAuth.HASH_SALT_INDEX] = salt;
            hashComponents[BasicWSAuth.HASH_PBKDF2_INDEX] = pwdHash;
            return hashComponents.join("\t");
        }

        if (username.indexOf("\t") !== -1) {
            // Don't allow hash field separation character in user name
            cb("illegal character", undefined, false);
            return;
        }
        if (userHashCollection) {
            var hash: string = createHash();
            if (update) {
                userHashCollection.update(
                    { userName: username },
                    { userName: username, hash: hash, email: email },
                    { upsert: true },
                    function(err: any, result: any): void {
                        cb(err, username, err === null);
                    });
            } else {
                userHashCollection.findOne({ userName: username }, (err: Error, result: any) => {
                    if (err !== null) {
                        cb(err, undefined, false);
                    } else if (result) {
                        cb("user name already exists", username, false);
                    } else {
                        userHashCollection.insert(
                            { userName: username, hash: hash, email: email },
                            (err: Error, result: any) => cb(err, username, err === null)
                        )
                    }
                })
            }
        } else {
            cb("database error", undefined, false);
        }
    }

    // --------------------------------------------------------------------------
    // getAuthStr (static)
    //
    static getAuthStr(username: string, password: string): string {
        var userPassword = username + ":" + password;
        var b64up = atob(userPassword);
        var authStr = "Basic " + b64up;
    
        return authStr;
    }
    
}

class CookieAuth {
    
    private static cookieCheck: string = "/auth/cookieCheck.php";
    
    /// Executes the cookie check command and calls cb(true, username) when the
    /// cookie was verified, or cb(false, undefined) when it wasn't.
    public static validate(cookieStr: string, cb: AuthorizationCallback<boolean>): void {
        var cmd = WSAuth.wwwRoot + CookieAuth.cookieCheck + " " + cookieStr;
    
        RemotingLog.log(3, function() {
            return "validating cookie as '" + cmd + "'";
        });
    
        child_process.exec(cmd, function (error: Error, stdout: string, stderr: string): void {
            if (error === null) {
                var username = stdout.trim();
                if (username.length > 0) {
                    RemotingLog.log(3, function() {
                        return "Cookie verified! (user=" + username + ")";
                    });
                    cb(null, username, true);
                    return;
                }
            }
            RemotingLog.log(2, "Cookie was not verified");
            cb("could not verify cookie", undefined, false);
        });
    }

    /// Gets the user name from the document's cookie.    
    /// Returns undefined when it can't.
    public static getCookieUserName(): string|undefined {
        var mauthVal: string = document.cookie.replace(
                /(?:(?:^|.*;\s*)mauth\s*\=\s*([^;]*).*$)|^.*$/, "$1");
        if (typeof(mauthVal) !== "string" || mauthVal.length === 0) {
            return undefined;
        }
    
        var decodedMAuth: string = decodeURIComponent(mauthVal);
        var parts: string[] = decodedMAuth.split(":");

        return parts.length < 2? undefined: parts[0];
    }
}
