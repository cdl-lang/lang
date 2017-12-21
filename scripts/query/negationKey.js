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


// This file implements a simple object which is used as the key of 
// a negation node in the query query compilation object. This object
// is not used inside the indexer (which simply stores a key of 0 under
// negation nodes, as the negation structure is implicit in the 
// domination structure. 
// The negation key stores the list of data elements defining the
// nodes being negated. The node being negated is always a data
// element and, therefore, there is no need to indicate the path - the
// path is the path of the given data element.
//
// The structure of the negation key is as follows:
//
// {
//     negated: <Uint31HashSet>{
//         <data element ID>
//         ......
//     }
// }
//
//

// %%include%%: <scripts/utils/intHashTable.js>

function NegationKey()
{
    this.negated = new Uint31HashSet(8);
}

// This function adds a data element ID to the list of data element IDs
// negated by this negation key. The data element ID is allowed to 
// already be in the negated list. 

NegationKey.prototype.addNegated = negationKeyAddNegated;

function negationKeyAddNegated(elementId)
{
    this.negated.set(elementId);
}

// This function removes a data element ID from the list of data element IDs
// negated by this negation key. If the data element ID is not in 
// the negated list, this function does nothing.

NegationKey.prototype.removeNegated = negationKeyRemoveNegated;

function negationKeyRemoveNegated(elementId)
{
    this.negated.delete(elementId);
}

// Returns the number of nodes negated by this negation key

NegationKey.prototype.numNegated = negationKeyNumNegated;

function negationKeyNumNegated()
{
    return this.negated.size;
}

// Thia function checks whether the given data element is negated by this
// negation key. It returns true if the element ID is found in the negated
// table and false otherwise.

NegationKey.prototype.isNegated = negationKeyIsNegated;

function negationKeyIsNegated(elementId)
{
    return this.negated.has(elementId);
}

// returns an set whose keys are the IDs of the data elements
// negated by this negation key. This is simply the internal table of 
// this key, so the calling function is not allowed to change it.

NegationKey.prototype.getNegated = negationKeyGetNegated;

function negationKeyGetNegated()
{
    return this.negated;
}

// This function returns a new negation key object which is a copy of
// itself (this is called a 'simple' copy because this function is 
// also used with other classes, such as RangeKey, where the copy is
// 'simpler' than the original).

NegationKey.prototype.simpleCopy = negationKeySimpleCopy;

function negationKeySimpleCopy()
{
    var copy = new NegationKey();
    copy.negated.expectSize(this.negated.size);
    
    this.negated.forEach(function(e, negatedId) {
        copy.addNegated(negatedId);
    });

    return copy;
}
