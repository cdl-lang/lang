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

// Concatenate two arrays.
// When l2 is small enough to fit on the stack, it is pushed directly
// into l1, otherwise both are concatenated.
// Call like this: l1 = cconcat(l1, l2).

function cconcat(l1, l2) {
    if (l2.length < 10000) {
        Array.prototype.push.apply(l1, l2);
        return l1;
    } else {
        return l1.concat(l2);
    }
}

// This function is given four arrays:
// fullArray: an array of simple values
// partialArray: an array which is a subset of 'fullArray'. It is assumed
//    that the partial array preserves the ordering in the fullArray.
// partialMappedArray: an array of the same size as 'partialArray'
//    representing values assigned to the corresponding entries in
//    'partialArray'.
// alignedMappedArray: this is optional, and may be omitted. If given, the
//    result is written into this array.
// This function then creates an array containing the values in
// 'partialMappedArray' where each value in 'partialMappedArray'
// is aligned with the position in 'fullArray' where the value it corresponds
// to in 'partialArray' appears. If 'alignedMappedArray' is not provided,
// the function creates an array and all other positions in the array
// (those not aligned with the partial array) are undefined. If
// alignedMappedArray is given, the aligned values are written into that
// array and all other positions in the array remain unchanged.
// If the same value appears several times in 'fullArray' the value in
// 'partialArray' are aligned with the first matching value in
// 'fullArray' while preserving the ordering. The returned array may
// be shorter than fullArray if all remaining values would have been
// undefined.
// For example, the partial array [1,4,2] is aligned with [1,2,3,1,4,5,1,2] as
// follows: [1,undefined,undefined,undefined,4,undefined,undefined,2] while
// the partial array [1,2] is aligned as [1,2]. 

function alignArrays(fullArray, partialArray, partialMappedArray,
                     alignedMappedArray)
{
    var partialArrayLength = partialArray.length;
    if(alignedMappedArray === undefined)
        alignedMappedArray = [];
    
    if(partialArrayLength === 0)
        return alignedMappedArray;
    
    var partialPos = 0;
    for(var i = 0, l = fullArray.length ; i < l ; ++i) {
        if(fullArray[i] !== partialArray[partialPos])
            continue;
        
        alignedMappedArray[i] = partialMappedArray[partialPos];
        if(++partialPos >= partialArrayLength)
            return alignedMappedArray; // allowed to be shorter
    }

    return alignedMappedArray;
}

// array1 and array2 are two arrays of arrays. Some of the entries in each
// array may be undefined or contain an empty array. This function merges
// the shortest of these two arrays into the longer of the two such that
// each position in the returned array is the concatenation of the arrays
// in the corresponding position in the two input arrays. If both arrays
// have 'undefined' at a certain position, this remains the value and
// if one is undefined and the other an empty array, an empty array is
// placed at that position.

function mergeArraysOfArrays(array1, array2)
{
    if(array1 === undefined)
        return array2;
    if(array2 === undefined)
        return array1;
    
    var firstShorter = array1.length < array2.length;
    var shortList = firstShorter ? array1 : array2;
    var longList = firstShorter ? array2 : array1;
    
    for(var i = 0, l = shortList.length ; i < l ; ++i) {
        var shortEntry = shortList[i];
        if(shortEntry === undefined)
            continue;
        var longEntry = longList[i];
        if(longEntry === undefined || longEntry.length === 0)
            longList[i] = shortEntry;
        else if(shortEntry.length === 0)
            continue;
        longList[i] = cconcat(longEntry, shortEntry);
    }

    return longList;
}
