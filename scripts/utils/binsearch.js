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

// =======================================================================
// binarySearch
//
// search for val inside the sorted array 'arr', where 'comp' is a function
// called as "comp(arr[x], val) ", that should return negative, 0, positive if
// arr[x] is less-than, equals-to, greater than 'val', respectively.
// The return value is the non-negative index i of 'arr' for which
//  comp(arr[i], val) == 0), or if none exists the negative integer i such that
//  comp(arr[-(i+1)], val) < 0) && comp(arr[-(i+2)], val) > 0) (with the
//  appropriate adjustments for the two boundary conditions).
// This can be used with:
// i = binarySearch(arr, val, comp);
// if (i < 0) {
//   i = -(i + 1);
//   arr.splice(i, 0, newElementFor(val));
// }
// and now 'i' is the correct index for 'val'.
//
function binarySearch(arr, val, comp, from, to, compInfo)
{
    from = typeof(from) === "undefined" ? 0 : from;
    to = (typeof(to) === "undefined") ? arr.length - 1 : to;

    var i = 0;

    var res;

    if (from > to)
        return -1;

    while (from < to) {
        i = Math.floor((to + from) / 2);
        res = comp(arr[i], val, compInfo);
        if (res < 0) {
            from = i + 1;
        } else if (res > 0) {
            to = i - 1;
        } else {
            return i;
        }
    }

    res = comp(arr[from], val, compInfo);
    if (res < 0) {
        return - (from + 2);
    } else if (res > 0) {
        return - (from + 1);
    } else {
        return from;
    }
}

// This function is very similar to binarySearch() above. There are two
// differences, however:
// 1. In case the 'k' being searched is equal (as defined by the 'comp'
//    function) to multiple elements in the array 'arr', the position of
//    the first of these equal values is returned (rather than an arbitrary
//    one of these values, as is returned by binarySearch()).
// 2. The return value of this function does not distinguish between
//    the case where there is an existing entry in the array which is
//    equal (by 'comp') to the searched 'val' and the case where there
//    is no such existing entry in the array. In either case, the function
//    returns a non-negative integer which is the position of the
//    first element in the array which is larger or equal to 'val'.
//    If all values in the array are smaller, the position returned is
//    the length of the array (the first position after the end of the
//    array).
// 3. Skips undefined values in a by moving down to the lower bound of the
//    current iteration until it finds a defined value. If it doesn't, the
//    lower bound is set the initial undefined value
function binarySearch2(a, k, comp, start, end) {
    start = start === undefined? 0: start;
    end = end === undefined? a.length - 1: end;
    var l = start - 1, h = end + 1; 

    // we consider a[start-1] = -inf, a[end+1] = +inf, so a[l] < k <= a[h]
    while (l + 1 < h) {
        var m = Math.floor((l + h) / 2);
        var m2 = m; // l < m == m2 < h
        while (m > l && a[m] === undefined) m--;
        if (a[m] === undefined || comp(a[m], k) < 0)
            l = m2;
        else
            h = m;
        // distance between l and h has decreased and still a[l] < k <= a[h]
    }
    // l + 1 >= h && a[l] < k <= a[h]
    // l + 1 == h => l + 1 is the answer
    // l + 1 > h => empty array => l + 1 == end => l + 1 is the answer
    return l + 1;
}
