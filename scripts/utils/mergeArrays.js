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


// This function takes two arrays 'sequence' and 'added' and merges
// them into the array 'sequence'.
// 'compFunc' is a comparison function which is applied to the elements of
// the two arrays (compFunc(x,y) < 0 if x is before y, compFunc(x,y) == 0
// if they have the same position and compFunc(x,y) < 0 is x is after y).
// The two arrays are expected to be already sorted by the ordering induced
// by compFunc, except for possible 'undefined' values which may appear
// throughout the arrays. These undefined values are ignored and will be
// removed from 'sequence' by the merge process. 'startPos' is an optional
// argument which indicates at which position of 'sequence' to begin the
// merge. All elements of sequence before that position are ignored
// (this can be used in case the caller knows that the merge cannot change
// anything before that position).

function mergeArrays(sequence, added, compFunc, startPos)
{
    if(!startPos)
        startPos = 0;
    
    var modPos = startPos;
    var addedLength = added.length;
    var addedPos = 0;
    var nextSeq = sequence;
    var nextLength = sequence.length;
    var nextPos = modPos;
    var buffer = []; // buffer for elements pushed to the end of the sequence
        
    while(nextPos < nextLength || addedPos < addedLength) {

        if(nextPos == nextLength && nextSeq != sequence) {
            nextPos = modPos;
            nextSeq = sequence;
            nextLength = sequence.length;
        }
        
        if(nextPos < nextLength && nextSeq[nextPos] == undefined) {
            nextPos++;
            continue;
        }
        if(addedPos < addedLength && added[addedPos] == undefined) {
            addedPos++;
            continue;
        }
        
        if(addedPos == addedLength ||
           (nextPos < nextLength && 
            compFunc(nextSeq[nextPos], added[addedPos]) <= 0)) {
            // next element from the 'nextSeq' array, could be the
            // sequence itself.
            if(nextSeq != sequence || modPos != nextPos) {
                var entry;
                if(entry = sequence[modPos]) {
                    // store to be re-inserted later
                    nextSeq.push(entry);
                    nextLength++;
                }
                sequence[modPos] = nextSeq[nextPos];
                nextSeq[nextPos] = undefined;
            }
            nextPos++;
        } else { // next element from the 'added' array
            var entry;
            if(entry = sequence[modPos]) {
                // store to be re-inserted later
                if(nextSeq == sequence) {
                    nextSeq = buffer;
                    nextPos = 0;
                    nextLength = 1;
                    nextSeq.push(entry);
                } else {
                    nextSeq.push(entry);
                    nextLength++;
                }
            }
            sequence[modPos] = added[addedPos];
            addedPos++;
        }
        modPos++;
    }
    
    if(modPos < sequence.length)
        sequence.length = modPos;
}
