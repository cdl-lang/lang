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

// Support stuff for positioning

function isArray(v) {
    return v instanceof Array;
}

function isEmptyObj(obj) {
    return obj === undefined || Object.keys(obj).length === 0;
}

function objFirstProp(obj) {
    for(var i in obj)
        return i;
    return undefined;
}

// Auxiliary functions for associative structures

function addAssociationPath(obj, path, value, start) {
    var i;
    var ptr = obj;

    for (i = (start === undefined? 0: start); i < path.length - 1; i++) {
        if (!(path[i] in ptr) || !ptr[path[i]] ||
           !(ptr[path[i]] instanceof Object)) {
            ptr[path[i]] = {};
        }
        ptr = ptr[path[i]];
    }
    ptr[path[path.length - 1]] = value;
}

function getAssociationPath(obj, path, start) {
    var i;
    var ptr = obj;

    for (i = (start === undefined? 0: start); i < path.length; i++) {
        if (!(ptr instanceof Object) || !(path[i] in ptr)) {
            return undefined;
        }
        ptr = ptr[path[i]];
    }
    return ptr;
}

function hasAssociationPath(obj, path, start) {
    return getAssociationPath(obj, path, start) !== undefined;
}

// Like removeAssociation, but with the path in an array. Returns the deleted
// value, or undefined if there wasn't any.
function deleteAssociationPath(obj, path, index) {
    var val;

    if (index === undefined) {
        index = 0;
    }
    if (obj instanceof Object) {
        if (path[index] in obj) {
            if (index == path.length - 1) {
                val = obj[path[index]];
                delete obj[path[index]];
            } else {
                val = deleteAssociationPath(obj[path[index]], path, index + 1);
                if (isEmptyObj(obj[path[index]])) {
                    delete obj[path[index]];
                }
            }
        }
    }
    return val;
}

function isEqualNaN(n) {
    return isNaN(n);
}
