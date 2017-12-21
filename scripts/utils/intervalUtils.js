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


// This file provides some utility functions for working with intervals.
// The interface here assumes that an interval is described by an object
// of the form:
// {
//     lowKey: <number>
//     lowOpen: <boolean>
//     highKey: <number>
//     highOpen: <boolean>
// }
// 'lowKey' and 'highKey' are the values at which the interval begins and ends.
// 'lowKey' should be smaller or equal to 'highKey'. 'lowOpen' indicates
// whether the interval is open on its lower end and 'highOpen' indicates
// whether the interval is open on its higher end.
//
// In addition, some functions support a simpler description of intervals,
// where each interval is described by an array [<low key>,<high key>]
// where the interval is always assumed to be closed.

//
// interval difference
//

// This function calculates the difference between the interval given
// by <lowKey, highKey, lowOpen, highOpen> and the interval given
// by <otherLowKey, otherHighKey, otherLowOpen, otherHighOpen>.
// 'compareFunc' should be a comparison function used to compare
// the values (the same as the comparison function used elsewhere).
// The difference is returned as an array of four values of the following 
// form:
//    [<in first>, { lowKey: <low key>, highKey: <high key>, 
//                   lowOpen: <boolean>, highOpen: <boolean> },
//     <in first>, { lowKey: <low key>, highKey: <high key>, 
//                   lowOpen: <boolean>, highOpen: <boolean> }]
// This describes the difference as two intervals. Each <in first> is
// a boolean flag indicating for the interval following it whether it
// is contained in the first interval, given by <lowKey, highKey,
// lowOpen, highOpen>, (if the flag is true) or in the 'other' interval 
// (if the flag is false). The two intervals returned are disjoint and 
// are sorted in ascending order. 
// Since the difference between the two intervals may consist of zero 
// intervals (if the two intervals are identical) or one interval (if one
// interval is a prefix or suffix of the other, e.g. [1,2] - [1,3]), 
// one or both of the interval positions in the array may be undefined. 
// In this case, the <in first> flag belonging to it should be ignored.
//
// When one interval is returned (that is, one interval position in
// the array is undefined) the intervals in the difference array should 
// still be considered 'sorted'. This means that if the first interval
// is undefined and the second defined then one interval compared is a
// prefix of the other while if the second interval returned is undefined,
// then the one interval compared is a suffix of the other interval.
// Examples (the intervals are written in standard interval notation):
// 1. [1,5] - (3,7) returns [true, [1,3], false, (5,7)]
// 2. [1,1] - [1,6] returns [undefined, undefined, false, (1,6]]
// 3. (1,5) - (3,5) returns [true, (1,3), undefined, undefined]
// 4. (1,5) - (3,5] returns [true, (1,3), false, [5,5]]

function calcIntervalDiff(lowKey, highKey, lowOpen, highOpen, otherLowKey,
                          otherHighKey, otherLowOpen, otherHighOpen,
                          compareFunc)
{
    var cmpHighKeyOtherLow = compareFunc(highKey, otherLowKey);
    var cmpLowKeyOtherHigh;
    var diff;

    // check for disjoint case (or single point overlap)
    if(cmpHighKeyOtherLow < 0)
        // disjoint, first interval is lower
        return [true, { lowKey: lowKey, lowOpen: lowOpen, highKey: highKey,
                        highOpen: highOpen },
                false, { lowKey: otherLowKey, lowOpen: otherLowOpen, 
                         highKey: otherHighKey, highOpen: otherHighOpen }];
    else if(cmpHighKeyOtherLow == 0) {
        // perhaps single point overlap (first interval lower)
        var cmpLowKeyHighKey = compareFunc(lowKey, highKey);
        var cmpOtherLowOtherHigh = compareFunc(otherLowKey, otherHighKey);
        return [true, 
                (cmpLowKeyHighKey || 
                 (!lowOpen && !highOpen && otherLowOpen)) ? 
                { lowKey: lowKey, lowOpen: lowOpen, highKey: highKey,
                  highOpen: (highOpen || !otherLowOpen) } : undefined,
                false, 
                (cmpOtherLowOtherHigh || 
                 (!otherHighOpen && !otherLowOpen && highOpen)) ?
                { lowKey: otherLowKey, 
                  lowOpen: (otherLowOpen || !highOpen), 
                  highKey: otherHighKey, 
                  highOpen: otherHighOpen } : undefined];

    } else if((cmpLowKeyOtherHigh = compareFunc(lowKey, otherHighKey)) > 0)
        // disjoint, second interval lower
        return [false, { lowKey: otherLowKey, lowOpen: otherLowOpen, 
                         highKey: otherHighKey, highOpen: otherHighOpen }, 
                true, { lowKey: lowKey, lowOpen: lowOpen, highKey: highKey,
                        highOpen: highOpen }];
    else if(cmpLowKeyOtherHigh == 0) {
        // perhaps single point overlap (first interval lower)
        var cmpLowKeyHighKey = compareFunc(lowKey, highKey);
        var cmpOtherLowOtherHigh = compareFunc(otherLowKey, otherHighKey);
        return [false, 
                (cmpOtherLowOtherHigh || 
                 (!otherLowOpen && !otherHighOpen && lowOpen)) ? 
                { lowKey: otherLowKey, lowOpen: otherLowOpen, 
                  highKey: otherHighKey,
                  highOpen: (otherHighOpen || !lowOpen) } : undefined,
                true,
                (cmpLowKeyHighKey || 
                 (!lowOpen && !highOpen && otherHighOpen)) ?
                { lowKey: lowKey, 
                  lowOpen: (lowOpen || !otherHighOpen), 
                  highKey: highKey, highOpen: highOpen } : undefined];
    } else {
        // overlapping intervals, compare the two low points, then the
        // two high points.
        var cmpLowKeyOtherLow = compareFunc(lowKey, otherLowKey);
        if(cmpLowKeyOtherLow < 0)
            diff = [true, { lowKey: lowKey, lowOpen: lowOpen, 
                            highKey: otherLowKey, highOpen: !otherLowOpen }];
        else if(cmpLowKeyOtherLow == 0) {
            if(lowOpen == otherLowOpen)
                diff = [undefined, undefined]; // exact overlap at low end
            else // end point of interval closed at that end point.
                diff = [!lowOpen, { lowKey: lowKey, lowOpen: false, 
                                    highKey: lowKey, highOpen: false }];
        } else
            diff = [false, { lowKey: otherLowKey, lowOpen: otherLowOpen, 
                             highKey: lowKey, highOpen: !lowOpen }];

        // exaclty the same calculation as above, but for the high ends
        var cmpHighKeyOtherHigh = compareFunc(highKey, otherHighKey);
        if(cmpHighKeyOtherHigh > 0)
            diff.push(true, { lowKey: otherHighKey, lowOpen: !otherHighOpen, 
                              highKey: highKey, highOpen: highOpen });
        else if(cmpHighKeyOtherHigh == 0) {
          if(highOpen !== otherHighOpen) {
              // end point of interval closed at that end point.
              diff.push(!highOpen, { lowKey: highKey, lowOpen: false, 
                                     highKey: highKey, highOpen: false });  
          } else
              diff.push(undefined, undefined);
        } else
            diff.push(false, { lowKey: highKey, lowOpen: !highOpen, 
                               highKey: otherHighKey, 
                               highOpen: otherHighOpen });
    }

    return diff;
}

// This function provides the same functionality as calcIntervalDiff() for the 
// special case where it is known that both intervals are degenerate.
// The returned value has exactly the same form as for calcIntervalDiff() 
// (see above) except that here only two possibilities exist:
// 1. The two intervals are identical: in this case an array of 
//    four undefines is returned ([undefined, undefined, undefined, undefined]).
// 2. The two intervals are different. In this case, an array of
//    the form:
//    [<boolean>, <interval object>, <boolean>, <interval object>]
//    where the <interval object>s are objects describing the two
//    degenerate intervals in teh format used for intervals,
//    representing the two intervals compared, with the lower 
//    interval appearing first. The <boolean> before each interval
//    indicates wither this interval is the interval given by 'key'
//    (<boolean> is true) or by 'otherKey'. One of these will be true
//    and the other false.  

function calcDegenerateIntervalDiff(key, otherKey, compareFunc)
{
    var cmpKeyOtherKey = compareFunc(key, otherKey);

    if(cmpKeyOtherKey == 0) // identical intervals
        return [undefined, undefined, undefined, undefined];
    else if(cmpKeyOtherKey < 0)
        return [true, { lowKey: key, highKey: key, 
                        lowOpen: false, highOpen: false },
                false, { lowKey: otherKey, highKey: otherKey, 
                         lowOpen: false, highOpen: false }];
    else
        return [false, { lowKey: otherKey, highKey: otherKey, 
                         lowOpen: false, highOpen: false },
                true, { lowKey: key, highKey: key,
                        lowOpen: false, highOpen: false }];
}

//
// Merging interval sequences
//

// This function asumes that 'sequence' is an array of intervals each
// of the form [<low key>,<high key>] (all are considered closed intervals)
// such that the intervals in the sequence are disjoint and ordered in
// increasing order. 'interval' is an interval of the format as the
// intervals in the sequence.
// This function finds all intervals in 'sequence' which overlap
// with 'interval' and merges those with 'interval' and replaces these
// ranges in the sequence with the single combined (merged) interval.
// If no overlapping intervals are found, 'interval' is inserted into
// the sequence so that the sequence remains sorted.
// The function returns the new sequence. If 'sequence' is undefined,
// a new 'sequence' array is created. 'sequence' is returned by
// this function.

function mergeIntervalIntoSequence(sequence, interval)
{
    // duplicate the interval, as it may be modified
    interval = interval.concat();
    
    if(sequence === undefined)
        return [interval];

    // search for overlapping intervals, beginning from the end
    var mergeBefore;
    var i;
    for(i = sequence.length - 1 ; i >= 0 ; --i) {
        var sequenceInterval = sequence[i];
        if(sequenceInterval[1] < interval[0])
            break;
        if(sequenceInterval[0] > interval[1])
            continue;

        if(mergeBefore === undefined)
            mergeBefore = i + 1;
        // interval overlap
        if(sequenceInterval[1] > interval[1])
            interval[1] = sequenceInterval[1];
        if(sequenceInterval[0] < interval[0])
            interval[0] = sequenceInterval[0];
    }
    
    if(mergeBefore !== undefined)
        // replaced the merged ranges with the new range
        sequence.splice(i+1, mergeBefore - i - 1, interval);
    else
        sequence.push(interval);

    return sequence;
}

