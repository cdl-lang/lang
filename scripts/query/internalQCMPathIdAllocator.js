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

// This object has a single instance in an internal QCM and is responsible
// for allocating IDs to paths (sequences of attributes). It is used
// by all indexers of the internal QCM so that the same path is always
// assigned the same ID, across different indexers.
//
// The (numeric) IDs are allocated to the paths in such a way that the ID 
// of a path is always greater than the ID of any of its prefix paths.
// This way, if we have two paths and we know that one is a prefix
// of the other we can easily determine which is of the two paths is 
// the prefix.
//
// In addition to allocating IDs for paths this module provides an 
// additional function: given the IDs of two paths where one is a prefix
// of the other, this module can return the ID of the path which is 
// the difference between the two paths. For example, given the IDs of
// the paths [a,b,c] and [a] this function will return a ID for the path
// [b, c].
//
// Path Ordering
// -------------
//
// This module also assigns an ordering to the paths. The ordering
// is represented by a sort key (a number) which is assigned once to
// a path and never changes. The ordering represents a 'depth first'
// ordering meaning that when paths are sorted by the key, the traversal
// of the sorted list represents a depth-first traversal of the paths.
// Put formally, and writing sk(P) for the sort key of the path P,
// the assigned sort keys have the following property:
// 
//    if P' is a prefix of P but not a prefix of Q and sk(P') < sk(Q) then
//    sk(P') <= sk(P) < sk(Q) (with equality iff P' = P).
//
// The method for assigning the sort keys to the paths is based on the
// Stern-Brocot tree. Each path is assigned a pair of positive integers
// (and the quotient of these two integers is the sort key of the path).
// Let x be a path and assume that x = x'.a where is x' is the prefix of x'
// including all of x except for the last attribute and 'x' is the last 
// attribute of x (this representation holds for all paths except the root).
// Each such path x = x'.a stores, in addition to its own sort key pair also 
// the following sort key pairs:
// 1. x_highest: the sort key pair with the highest quotient assigned under 
//    the path x (that is to x or to some extension of x). This is simply
//    the last sort key pair assigned under x.
// 2. x_next: the sort key pair assigned to the first path x'.b added
//    after x'.a was added. If no such path was yet added, then x_next 
//    is equal to x'.next.
// The root path R is assigned the pair [1,1] and, initially, R_highest
// is [1,1] and R_next is [1,0].
// When a path x.c is added under x, its sort key pair is calculated based
// on x_highest and x_next. Assume that x_highest = [m1,n1] and 
// x_next = [m2,n2] then the key assigned to x.c is [m1+m2,n1+n2].
// When the key is assigned to x.c, the following values need to be updated:
// 1. *_highest is set to [m1+m2,n1+n2] on x.c and on all its prefix
//    paths which so far had [m1,n1] as their *_highest. These are those
//    paths which were the last (until now) to extend their prefix.
// 2. *_next is set to [m1+m2,n1+n2] on all node which until now
//    had *_next set to [m2,n2] and are extensions of x. These are all
//    the paths which are prefixes of the path which was assigned the 
//    sort key pair [m1,n1] (if this key was assigned to x, there are no
//    such paths). 
// To make this calculation simple, each path x stores the path extending
// it which was assigned the highest sort key so far (this may be x itself). 
// This path and all its prefix paths which have x as a prefix need to have 
// their *_next updated when a new path extending x is added.
//
// When a path x.a is removed, we do not change the *_highest or *_next
// of other paths but for every prefix path which stores x.a as the
// node which was assigned the highest sort key, we replace x.a with x.  
// 
//
// Module API
// ----------
//
// The API to this module consists of the following functions:
//
// allocatePathId(<prefix path ID>, <attribute>): this function requests
//    the ID of the path which is the extension of the path with
//    ID <prefix path ID> with the attribute <attribute>. <prefix path ID> 
//    must be an ID already allocated. This function checks whether 
//    an ID was already allocated for the requested path. If the path
//    was already allocated an ID, the function increases the reference
//    count for this path ID ('count' in the 'pathById' table) and
//    returns the ID. If not, it allocated the next available ID for this 
//    path and returns it. If this is the first time the path is allocated.
//    the function also increases the reference count of its prefix 
//    path.
//    The reference count for each path ID reflects the number of
//    times the function 'allocatePathId()' was called for that path
//    plus the number of entries for this path in the 'pathByPrefix'
//    table minus the number of times the function 'releasePathId()'
//    (see below) was called for these paths. An indexer should only
//    call 'allocatePathId()' once for a given path when it starts
//    using that path and then call 'releasePathId()' once when it no
//    longer needs that path. It can then call 'allocatePathId()' for
//    the same path again (and there is no guarantee that it will get
//    the same path ID again).  In addition, if this is the first time 
//    the path was allocated, this function also allocates the longest 
//    path of this path (this is the path with the first attribute removed).
//    This will allocate, recursively, the suffixes of the suffix, 
//    if necessary. 
//    This function may be called with <prefix path ID> undefined,
//    which is considered equivalent to calling it with the path ID of
//    the empty path.
//
// releasePathId(<path ID>): this function should be called when 
//    an indexer no longer makes use of a certain path for which it called
//    'allocatePathId()'. This causes the reference count for the path ID 
//    to be decreased. If the refrence count of the path dropped to zero,
//    its entry is destroyed and the reference count of its prefix is 
//    decrease. In addition, its suffix path is also released.
//
//  diffPathId(<path ID>, <prefix path ID>): this function should be 
//    called with the IDs of two paths which were already allocated
//    and such that the second one is a prefix of the first one. The
//    function returns the ID of the path which is the sequence of
//    attributes from the path with ID <prefix path ID> to the path
//    with ID <path ID> (this is the suffix of <path ID> which begins
//    at <prefix path ID>). The ID of this 'difference' path was
//    allocated when <path ID> was allocated (see 'allocatePathId()').
//
// getRootPathId(): this function returns the ID of the root (empty) path.
//    There is no need to allocate this path, it is always available.
//
// getSortKey(<path ID>): this function returns the sort key for
//    the given path ID. If the path ID was not yet allocated, this returns 0.
//
// Object Structure
// ----------------
//
// {
//     nextId: <next ID to allocate>,
//     rootId: <ID allocated to the empty path is always 1>
//     pathByPrefix: {
//        <prefix path ID>: {
//            <attr>: <path ID>  // ID assigned to <prefix path> + <attr>
//            ......
//        }
//     },
//     pathById: {
//        <path ID>: {
//            prefix: <ID of the path prefix (one fewer attribute)>,
//            length: <number of attributes in the path>
//            firstAttr: <ID of path consisting of first attribute only>
//            lastAttr: <string>
//            count: <reference count> // number of times this path was used
//            suffixes: {
//                // ID of suffix beginning at the given prefix
//                <prefix path ID>: <path ID>,
//                .....
//            },
//            skHighest: <array of two positive integers>,
//            skNext: <array of two positive integers>,
//            skHighestPathId: <path ID>
//            skPair: <array of two positive integers>,
//            sortKey: <quotient of the sort key pair numbers>,
//            strings: <string array with the path attributes>
//        },
//        .......
//     }
// }
//
// nextId: the ID (integer) to allocate to the next new path.
// rootId: the ID allocated to the empty path (the root of the path tree).
//    This is always 1025.
// pathByPrefix: this table allows to retrieve, given the ID of a prefix 
//    path and an attribute (a string) the ID for the path which is 
//    the extension of the prefix path with the given attribute. 
// pathById: this table stores information about each path ID which was 
//    allocated. In addition to storing its longest prefix (the path 
//    with the last attribute removed) and the shortest prefix (the path 
//    consisting of the first attribute only) and the reference count, this also
//    stores the IDs allocated to all suffixes of this path. 'firstAttr'
//    stores the pathId allocated to the path consisting of the 
//    first attribute of this path while 'lastAttr' is the string
//    which is the last attribute of this path. The fields 
//    skHighest, skNext, skHighestPathId, skPair, and sortKey are as 
//    mentioned above in the description of the sort-key assignment algorithm 
//    (skPair is the pair of integers defining the sort key and 
//    sortKey is their quotient).

function InternalQCMPathIdAllocator()
{
	this.rootId = 1025;
	this.nextId = 1026;
	this.pathByPrefix = {};
	this.pathById = {};

	// create an entry for the empty path (with a reference count of 1,
	// so this is never removed)
	this.pathById[this.rootId] = { 
		count: 1,
        length: 0, // empty path
		skPair: [1,1],
		skNext: [1,0],
		skHighest: [1,1],
		skHighestPathId: this.rootId,
		sortKey: 1,
        strings: undefined
	}; // no prefix or suffixes
}

// This function requests the ID of the path which is the extension of
// the path with ID <prefix path ID> with the attribute
// <attribute>. <prefix path ID> must be an ID already allocated. This
// function checks whether an ID was already allocated for the
// requested path. If the path was already allocated an ID, the
// function increases the reference count for this path ID ('count' in
// the 'pathById' table) and returns the ID. If not, it allocated the
// next available ID for this path and returns it. If this is the
// first time the path is allocated.  the function also increases the
// reference count of its prefix path.
// The reference count for each path ID reflects the number of times
// the function 'allocatePathId()' was called for that path plus the
// number of entries for this path in the 'pathByPrefix' table minus
// the number of times the function 'releasePathId()' (see below) was
// called for these paths. An indexer should only call
// 'allocatePathId()' once for a given path when it starts using that
// path and then call 'releasePathId()' once when it no longer needs
// that path. It can then call 'allocatePathId()' for the same path
// again (and there is no guarantee that it will get the same path ID
// again).  In addition, if this is the first time the path was
// allocated, this function also allocates the longest path of this
// path (this is the path with the first attribute removed).  This
// will allocate, recursively, the suffixes of the suffix, if
// necessary.
// This function may be called with <prefix path ID> undefined, which
// is considered equivalent to calling it with the path ID of the
// empty path.
// This function returns undefined if the prefix ID is not known
// (this is not considered proper use of this function).

InternalQCMPathIdAllocator.prototype.allocatePathId =
	internalQCMPathIdAllocatorAllocatePathId;

function internalQCMPathIdAllocatorAllocatePathId(prefixId, attr)
{
	if(prefixId === undefined)
		prefixId = this.rootId;

	var prefixEntry = this.pathById[prefixId];
	if(!prefixEntry)
		return undefined;

	if(!this.pathByPrefix[prefixId])
		this.pathByPrefix[prefixId] = {};
	
	var pathId;

	if(pathId = this.pathByPrefix[prefixId][attr]) {
		// already allocated, only need to increase the reference count
		this.pathById[pathId].count++;
		return pathId;
	}

	// allocate an ID for the path
	pathId = this.pathByPrefix[prefixId][attr] = this.nextId++;
	// allocate the path entry
	var pathEntry = this.pathById[pathId] = { 
		prefix: prefixId, 
        length: prefixEntry.length + 1,
		// if the prefix path does not have a 'firstAttr' the it is 
		// the root (empty) path so the first attribute of this path 
		// is the path itself. 
		firstAttr: prefixEntry.firstAttr ? prefixEntry.firstAttr : pathId,
		lastAttr: attr,
		count: 1,
	};

	// increase the reference count of the prefix
	prefixEntry.count++;

	// calculate the sort key for this path
	this.calculateSK(pathId);

	// create a table for the suffixes
    pathEntry.suffixes = {};

	return pathId;
}

// This function is similar to allocatePathId, except that instead of 
// a single attribute, it takes an array of attributes as input.
// The function then allocates an ID for the path which is a concatenation 
// of the path with ID prefixId (which must already have been allocated)
// and the sequence of attributes in 'attrs'. The reference counts on 
// the prefixes are increased in such a way that releasing the full path 
// would also release the prefixes (unless they were allocated separately
// or are a prefix of another allocated path).

InternalQCMPathIdAllocator.prototype.allocatePathIdFromPath =
	internalQCMPathIdAllocatorAllocatePathIdFromPath;

function internalQCMPathIdAllocatorAllocatePathIdFromPath(prefixId, attrs)
{
    if(!prefixId)
        prefixId = this.rootId;
    var attrPos;
    var attrNum = attrs.length;

    if(!this.pathById[prefixId])
        return undefined; // prefix was not allocated yet

    // find the longest prefix of this path which is already allocated 
    for(attrPos = 0 ; attrPos < attrNum ; ++attrPos) {
        var attr = attrs[attrPos];
        if(this.pathByPrefix[prefixId] && this.pathByPrefix[prefixId][attr])
            prefixId = this.pathByPrefix[prefixId][attr];
        else
            break;
    }

    if(attrPos == attrNum) {
        // the path was already allocated, just increase its reference count
        this.pathById[prefixId].count++;
        return prefixId;
    }

    // allocate the remaining prefixes along the path. Each path ID allocated
    // here (except the last) has its reference count increased twice:
    // once when it is allocted and once when the next path is allocated
    // (allocating a new path ID increases the reference count of its prefix).
    // We therefore release one such allocation immediately. 
    var prevPrefixId; // previous allocated path ID in this loop
    for( ; attrPos < attrNum ; ++attrPos) {
        prefixId = this.allocatePathId(prefixId, attrs[attrPos]);
        if(prevPrefixId)
            this.releasePathId(prevPrefixId);
        prevPrefixId = prefixId;
    }
	
	return prefixId;
}

// This function allocates and returns the ID of the path which is the
// concatenation of the paths with IDs 'prefixId' and 'suffixId'.  The
// reference counts on the prefixes are increased in such a way that
// releasing the full path would also release the prefixes (unless
// they were allocated separately or are a prefix of another allocated
// path).

InternalQCMPathIdAllocator.prototype.allocateConcatPathId =
	internalQCMPathIdAllocatorAllocateConcatPathId;

function internalQCMPathIdAllocatorAllocateConcatPathId(prefixId, suffixId)
{
    if(suffixId == this.rootId) {
        this.allocatePathIdByPathId(prefixId);
        return prefixId;
    }

    var attrs = this.getPathStrings(suffixId);

    if(!attrs)
        return undefined;
        
    return this.allocatePathIdFromPath(prefixId, attrs);
}

// Given a path ID, this function increases the reference count for the
// given path ID. This path ID must have already been allocated,
// otherwise nothing happens.

InternalQCMPathIdAllocator.prototype.allocatePathIdByPathId =
	internalQCMPathIdAllocatorAllocatePathIdByPathId;

function internalQCMPathIdAllocatorAllocatePathIdByPathId(pathId)
{
    if(pathId == this.rootId)
        return; // no reference counting on the root

    if(this.pathById[pathId])
        this.pathById[pathId].count++;
}

// This function fetches the ID of the path which is the suffix of 
// pathId after the prefix path 'prefixId'. 'pathEntry' should
// be the entry of 'pathId' in the 'pathById' table. If 'prefixId'
// is not a prefix of 'pathId', this function returns undefined.
// This function caches the result in the 'suffixes' table of
// 'pathEntry' (including in the case where the result is undefined).
// This allows quick access to the result if it was already calculated,
// and, if the result is not undefined, allows the suffix ID to
// be released when 'pathId' is released.

InternalQCMPathIdAllocator.prototype.allocateSuffixPath =
	internalQCMPathIdAllocatorAllocateSuffixPath;

function internalQCMPathIdAllocatorAllocateSuffixPath(pathId, pathEntry, 
                                                      prefixId)
{
    if(prefixId > pathId)
        return undefined;

	if(prefixId == this.rootId)
		return pathId; // empty prefix, the suffix is the path itself

    if(prefixId == pathId)
        return this.rootId; 

    if(prefixId in pathEntry.suffixes)
        return pathEntry.suffixes[prefixId];

	// prefix of the suffix (the suffix without the last attribute)
	// this is the first suffix of the prefix unless the prefix is
	// a path of length 1, in which case it is the empty (root) path.
	var suffixPrefix = (pathEntry.prefix == prefixId) ?
		this.rootId : this.allocateSuffixPath(pathEntry.prefix, 
                                              this.pathById[pathEntry.prefix],
                                              prefixId);

    if(suffixPrefix === undefined)
        return (pathEntry.suffixes[prefixId] = undefined);

	var suffixId = pathEntry.suffixes[prefixId] = 
		this.allocatePathId(suffixPrefix, pathEntry.lastAttr);
	
    return suffixId;
}

// This function should be called when an indexer no longer makes use
// of a certain path for which it called 'allocatePathId()'. This
// causes the reference count for the path ID to be decreased. If the
// refrence count of the path dropped to zero, its entry is destroyed
// and the reference count of its prefix is decrease. In addition, its
// suffix paths are also released.

InternalQCMPathIdAllocator.prototype.releasePathId =
	internalQCMPathIdAllocatorReleasePathId;

function internalQCMPathIdAllocatorReleasePathId(pathId)
{
    if(pathId == this.rootId)
        return; // no reference counting on the root path ID

	var pathEntry = this.pathById[pathId];

	if(!pathEntry || --pathEntry.count)
		return; // no such path or path still allocated by others 

	var prefixId = pathEntry.prefix;

	// sort-key: for those paths which have this path as their highest SK
	// path, replace this path by its prefix path.
	var prefixEntry = this.pathById[prefixId];
	while(prefixEntry.skHighestPathId == pathId) {
		prefixEntry.skHighestPathId = prefixId;
		if(!prefixEntry.prefix)
			break; // root path
		prefixEntry = this.pathById[prefixEntry.prefix];
	}

    for(var prefixOfSuffixId in pathEntry.suffixes) {
        var suffixId = pathEntry.suffixes[prefixOfSuffixId];
        if(suffixId === undefined)
            continue;
        this.releasePathId(suffixId);
    } 

	// clear the path's entries
	if(this.pathByPrefix[pathId])
		delete this.pathByPrefix[pathId];
	delete this.pathByPrefix[prefixId][pathEntry.lastAttr];
	delete this.pathById[pathId];
	
	// release the prefix path
	this.releasePathId(prefixId);
}

// This function should be called with the IDs of two paths which were
// already allocated and such that the second one is a prefix of the
// first one. The function returns the ID of the path which is the
// sequence of attributes from the path with ID 'prefixId' to the path
// with ID 'pathId' (this is the suffix of pathId which begins at
// prefixId. The 'difference' path returned by this function is a
// suffix path of the path with ID 'pathId'. This suffix path was
// allocated when the path with ID 'pathId' was allocated and it can
// be found in the 'suffixes' table of the path entry.  This function
// returns undefined if one of the two argument IDs is not an
// allocated ID or if 'prefixId' is not the ID of a prefix of the path
// with ID 'pathId'.

InternalQCMPathIdAllocator.prototype.diffPathId =
	internalQCMPathIdAllocatorDiffPathId;

function internalQCMPathIdAllocatorDiffPathId(pathId, prefixId)
{
    if(prefixId == this.rootId)
        return pathId;

    if(pathId == prefixId)
        return this.rootId;

	var pathEntry = this.pathById[pathId];

	if(!pathEntry)
		return undefined;

    return this.allocateSuffixPath(pathId, pathEntry, prefixId);
}

// This function returns true if the second argument is a prefix
// of the path in the first argument (including the case where they are
// equal). Otherwise, false is returned.

InternalQCMPathIdAllocator.prototype.isPrefixOf =
	internalQCMPathIdAllocatorIsPrefixOf;

function internalQCMPathIdAllocatorIsPrefixOf(pathId, prefixId)
{
    if(prefixId == this.rootId || pathId == prefixId)
        return true;
    
	var pathEntry = this.pathById[pathId];

	if(!pathEntry)
		return false;

	return !!this.allocateSuffixPath(pathId, pathEntry, prefixId);
}

// Return the ID allocated to the root path (the empty path). The empty
// path does not need to be allocated.

InternalQCMPathIdAllocator.prototype.getRootPathId =
	internalQCMPathIdAllocatorGetRootPathId;

function internalQCMPathIdAllocatorGetRootPathId()
{
	return this.rootId;
}

// This function returns the path ID allocated to the path which extends
// the prefix path with ID prefixId with the given attribute ('attr').
// If no such path ID was allocated, the function returns undefined.
// This does not allocate the path or increase the reference count of
// an already allocated path.

InternalQCMPathIdAllocator.prototype.getPathId =
	internalQCMPathIdAllocatorGetPathId;

function internalQCMPathIdAllocatorGetPathId(prefixId, attr)
{
    var entry;

    if(!(entry = this.pathByPrefix[prefixId]))
        return undefined;
    
    return entry[attr];
}

// Given a path ID, this returns the length of the path (that is, the
// number of attributes in the path). The length of the root path is zero
// and the length of each path is one more than the length of its 
// immediate prefix.
// The function returns undefined if the path ID is unknown.

InternalQCMPathIdAllocator.prototype.getPathLength =
	internalQCMPathIdAllocatorGetPathLength;

function internalQCMPathIdAllocatorGetPathLength(pathId)
{
    return this.pathById[pathId] ? this.pathById[pathId].length : undefined; 
}

// Given a path ID, this returns the ID of the longest proper prefix of 
// the path (that is, the prefix path which is shorter by exactly one
// string). If the path ID is not known or is the root path ID 
// (and therefore has no prefix) undefined is returned. 

InternalQCMPathIdAllocator.prototype.getPrefix =
	internalQCMPathIdAllocatorGetPrefix;

function internalQCMPathIdAllocatorGetPrefix(pathId)
{
    if(pathId == this.rootId)
        return undefined; // root path has no prefix

    return this.pathById[pathId] ? this.pathById[pathId].prefix : undefined; 
}


// given an array of path IDs, this function returns the ID of the longest 
// common prefix of all these paths. The function does this by testing
// whether the first path in the list and then an increasingly shorter prefix
// of this first path is a prefix of all other paths. Once a prefix 
// is found to be a prefix of some path, the shorter prefixes do not need
// to be tested on it anymore (because they are obviously also prefixes of
// the same path).

InternalQCMPathIdAllocator.prototype.getCommonPrefix =
	internalQCMPathIdAllocatorGetCommonPrefix;

function internalQCMPathIdAllocatorGetCommonPrefix(pathIds)
{
    var prefixId = pathIds[0];
    var testPos = 1; // position to check for prefix
    var length = pathIds.length;
    
    while(testPos < length) {
        var pathId = pathIds[testPos];
        if(pathId == this.rootId)
            return this.rootId; // root path, so common prefix is root path
        while(pathId !== prefixId) {
            if(pathId < prefixId) {
                var tempId = prefixId;
                prefixId = pathId;
                pathId = tempId;
            }
            pathId = this.pathById[pathId].prefix;
        }
        testPos++; 
    }

    return prefixId;
}

// Given two path IDs where 'prefixId' is the ID of a path which is
// a strict prefix of the path with ID 'pathId' this function 
// returns the first attribute in the path 'pathId' after the 
// prefix 'prefixId'. If 'prefixId' is not a proper prefix of 'pathId',
// (or one of these two paths is not known) undefined is returned

InternalQCMPathIdAllocator.prototype.getFirstAttrAfterPrefix =
	internalQCMPathIdAllocatorGetFirstAttrAfterPrefix;

function internalQCMPathIdAllocatorGetFirstAttrAfterPrefix(prefixId, pathId)
{
    if(pathId == this.rootId || pathId == prefixId)
        return undefined;

    var entry = this.pathById[pathId];
 
    if(!entry)
        return undefined;
   
    if(prefixId != this.rootId) {
        // get the suffix following the given prefix
        var suffixId = this.allocateSuffixPath(pathId, entry, prefixId);
        if(suffixId == undefined)
            return undefined;
        entry = this.pathById[suffixId];
    }

    // return the first attribute in the suffix
    return entry.firstAttr ? 
        this.pathById[entry.firstAttr].lastAttr : undefined;
}

// given a path ID, this function returns the last attribute in the path.
// If the path ID is the root path ID or if the path ID is not allocated,
// undefined is returned.

InternalQCMPathIdAllocator.prototype.getLastPathAttr =
	internalQCMPathIdAllocatorGetLastPathAttr;

function internalQCMPathIdAllocatorGetLastPathAttr(pathId)
{
    var entry = this.pathById[pathId];

    if(!entry)
        return undefined;

    return entry.lastAttr; // may be undefined if this is the root path ID
}

// given a path ID, this function returns the array of strings which 
// is the path belonging to this ID. The array of strings is cached for
// the path ID and all its ancestors.
// If this path ID was not allocated, this function returns undefined.

InternalQCMPathIdAllocator.prototype.getPathStrings =
	internalQCMPathIdAllocatorGetPathStrings;

function internalQCMPathIdAllocatorGetPathStrings(pathId)
{
    var entry = this.pathById[pathId];

    if (entry === undefined)
        return undefined;

    if (entry.strings === undefined) {
        if (entry.lastAttr !== undefined) {
            entry.strings = this.getPathStrings(entry.prefix).
                  concat(entry.lastAttr);
        } else {
            entry.strings = [];
        }
    }
    return entry.strings;
}

// return the suffix of the path with ID 'pathId' beginning after the
// prefix 'prefixId'. If 'pathId' is not allocated or 'prefixId' is 
// not a prefix of it, undefined is returned.

InternalQCMPathIdAllocator.prototype.getPathSuffix =
	internalQCMPathIdAllocatorGetPathSuffix;

function internalQCMPathIdAllocatorGetPathSuffix(pathId, prefixId)
{
    if(prefixId == this.rootId)
        return pathId;
    
    if(pathId == prefixId)
        return this.rootId;

    var entry;
    if(!(entry = this.pathById[pathId]))
        return undefined;

    return this.allocateSuffixPath(pathId, entry, prefixId);
}

////////////////////////
// Sort Key Functions //
////////////////////////

// This function returns the sort key for the given path ID. If the path ID
// was not yet allocated, this returns 0.

InternalQCMPathIdAllocator.prototype.getSortKey = 
	internalQCMPathIdAllocatorGetSortKey;

function internalQCMPathIdAllocatorGetSortKey(pathId)
{
    var entry;

    if(!(entry = this.pathById[pathId]))
        return 0;

    return entry.sortKey;
}

// Given a path ID, this function returns the range of sort keys
// which are allocated to paths which extend the given path. This range
// begins with the sort key of the path given and ends with the highest
// sort key allocated so far to a path extending this path (there may be
// no path with this sort key if the path allocated with this key
// was removed). The paths extending the given path (including the path
// itself) are exactly those paths which have a sort key in this range.
// The range is returned as an array of two numbers:
// [<start of range>, <end of range>].
// If the given path ID is not allocated, undefined is returned.

InternalQCMPathIdAllocator.prototype.extensionSortKeyRange = 
	internalQCMPathIdAllocatorExtensionSortKeyRange;

function internalQCMPathIdAllocatorExtensionSortKeyRange(pathId)
{
    var entry;
    
    if(!(entry = this.pathById[pathId]))
        return undefined;

    return [entry.sortKey, entry.skHighest[0] / entry.skHighest[1]];
}

// This function is given a path ID which is just being allocated. This
// function assigns this path ID a sort key and updates all sort-key
// related fields on the entries for this path and all other paths
// which are effected by this allocation. 

InternalQCMPathIdAllocator.prototype.calculateSK = 
	internalQCMPathIdAllocatorCalculateSK;

function internalQCMPathIdAllocatorCalculateSK(pathId)
{
	var pathEntry = this.pathById[pathId];
	var prefixId = pathEntry.prefix;
	var prefixEntry = this.pathById[prefixId];
	
	pathEntry.skPair = [prefixEntry.skHighest[0] + prefixEntry.skNext[0],
						prefixEntry.skHighest[1] + prefixEntry.skNext[1]];
	pathEntry.sortKey = pathEntry.skPair[0] / pathEntry.skPair[1]; 

	// nextSK assignment

	// this path gets the next sort key of its prefix
	pathEntry.skNext = prefixEntry.skNext;
	
	// Assign the sort key of this path as the next sort key for the path 
	// with ID prefixHighestId up to (but not including) the prefix node
	var nextId = prefixEntry.skHighestPathId;
	while(nextId != prefixId) {
		var entry = this.pathById[nextId];
		entry.skNext = pathEntry.skPair;
		nextId = entry.prefix;
	}
	
	// highestSK assignment

	// the path is its own highest
	pathEntry.skHighestPathId = pathId;
	pathEntry.skHighest = pathEntry.skPair;

	// this path is also the highest of its immediate prefix path and all
	// prefixes of that path which had the same highest before
	var prefixPrevHighestId = prefixEntry.skHighestPathId;
	do {
		prefixEntry.skHighestPathId = pathId;
		prefixEntry.skHighest = pathEntry.skPair;
		
		if(!prefixEntry.prefix) // the root path
			break;
		
		// continue to the prefix paths
		prefixEntry = this.pathById[prefixEntry.prefix];
	} while(prefixEntry.skHighestPathId == prefixPrevHighestId);
}
