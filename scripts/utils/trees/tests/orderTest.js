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


// %%include%%: <scripts/utils/utils.js>
// %%include%%: <scripts/utils/random.js>
// %%include%%: <scripts/utils/seedrandom.js>
// %%include%%: <scripts/utils/inheritance.js>
// %%include%%: <scripts/utils/trees/partialOrder.js>
// %%include%%: <scripts/utils/intHashTable.js>

var previousSeeds = ["lMxDCVbsvAuK", "Pz9xF71M27EM", "wS0b5M4XOcmq",
                     "CIfpTqk2Oi57", "DTXdFUH00fOa",
                     "tgJfLTuIRpa8", "JOpOSXJXzuF0", "osNMTeeslqnJ",
                     "xond8U0gTsFL", "SNOA0yJnEPQM", "yfs4JwPGnDQC",
                     "WLmssINMgXm2", "2cG67Fd79t0A", "qywbXFnJ7uFq",
                     "Zt6zhfSvipbo", "XZfnU3VUvkTt", "NySbCDbIicmR",
                     "g1mUXngJFcTn", "U3Tfe83M6Uqx", "66lkO8w8FLfT",
                     "7QBc5aDAMPZN", "99oRG2PqrsyS", "IRST22ORrmUJ",
                     "PV7avoJH7aOm", "pnRTNpWahGUE", "wFlyN8SLMDIL",
                     "dlQxGv7NHMFp", "66lkO8w8FLfT", "lF93XXHpLwRw",
                     "gBel1U8a3HDh", "h9uKmQV1PMHJ"];
var actualSeed; // = previousSeeds[0];

var testFailed = false;

function main() {
    runTest();
}

var setSize = 1000;
var noHeapNodes = false;
var verifyTree = true;
var verifyMatches = true;
var numTestCycles = 30;
var orderTree;
var rangeRequirement;
var elementRequirement;
var complementRequirement;

var startTime;
var endTime;
var numComps = 0;

//var compFunc = function(a,b) { return a - b; };
/*var compFunc = function(a,b) { numComps++;
                               return (fullOrder.get(a) - fullOrder.get(b)); }*/
var leftArg;
var leftArgKey;
var compFunc = function(a,b) { numComps++;
                               if(a !== leftArg) {
                                   leftArg = a;
                                   leftArgKey = fullOrder.get(a);
                                   }
                               return (leftArgKey - fullOrder.get(b)); }

// an array storing the full ordered set (not by order! order is defined
// by 'fullOrder' below).
var sequence;
// The following table is a mapping from element to its position in the
// order set. This applies to the full set (in 'sequence').
var fullOrder;
var subSequence; // a sub-sequence of sequence
// position in 'subSequence' of each element based on the ordering defined
// in 'fullOrder'
var subOrder;
var subSetSize;


// This table defines the order restricted to the current subset
// (in 'subSequence') which is registered to the order tree
var subsetKeys = new Map();

function runTest()
{
    // set the seed
    if (!actualSeed) {
        actualSeed = getRandomString(12);
    }
    console.log("seed", actualSeed);
    Math.seedrandom(actualSeed);

    sequence = generateRandomSequence(setSize);
    subSequence = sequence;
    subSetSize = subSequence.length;

    reorderSequence();
    
    orderTree = new PartialOrderTree(undefined, compFunc);

    if(noHeapNodes)
        orderTree.noHeapNodes = 1;

    rangeRequirement = new RangeOrderRequirement(orderTree, [0,10], false,
                                                 false, false, false, true);
    var listener = new DummyListener();
    rangeRequirement.addListener(listener);

    // forward offset of the given element
    elementRequirement = new ElementRequirement(63, false, true, true,
                                                orderTree);
    var offsetListener = new OffsetDummyListener();
    elementRequirement.addListener(offsetListener);

    numComps = 0;
    
    startTime = performance.now();

    addElements(subSequence);
    
    endTime = performance.now();
    
    console.log("tree total time: ", endTime - startTime);
    completeStep(rangeRequirement, listener, offsetListener);
    completeOffsetStep(elementRequirement, offsetListener);

    // new ordering

    reorderSequenceTest();
    completeStep(rangeRequirement, listener);
    completeOffsetStep(elementRequirement, offsetListener);
    
    startTime = performance.now();
    
    rangeRequirement.updateOffsets([30,38], false, false, false, false, true);

    endTime = performance.now();
    
    console.log("range move total time: ", endTime - startTime);
    completeStep(rangeRequirement, listener);
    completeOffsetStep(elementRequirement, offsetListener);

    startTime = performance.now();
    
    rangeRequirement.updateOffsets([35,48], false, false, false, false, true);

    endTime = performance.now();
    
    console.log("range overlapping move total time: ", endTime - startTime);
    completeStep(rangeRequirement, listener);
    completeOffsetStep(elementRequirement, offsetListener);

    for(var i = 0 ; i < numTestCycles ; ++i) {
    
        // remove some elements from the subsequence
        shortenSequenceTest();
        completeStep(rangeRequirement, listener);
        completeOffsetStep(elementRequirement, offsetListener);

        // add back some elements
        extendSequenceTest();
        completeStep(rangeRequirement, listener);
        completeOffsetStep(elementRequirement, offsetListener);

        // reorder the sequence
        reorderSequenceTest();
        completeStep(rangeRequirement, listener);
        completeOffsetStep(elementRequirement, offsetListener);
    }
    
    startTime = performance.now();
    
    rangeRequirement.updateOffsets([46,115], false, false, false, false, true);

    endTime = performance.now();
    
    console.log("range out of bounds overlapping move total time: ",
                endTime - startTime);
    completeStep(rangeRequirement, listener);
    completeOffsetStep(elementRequirement, offsetListener);

    
    console.log("clearing tree and adding all elements again");

    startTime = performance.now();
    
    orderTree.removeAllElements();
    addElements(subSequence);

    endTime = performance.now();

    console.log("clear and add back total time: ", endTime - startTime);
    completeStep(rangeRequirement, listener);
    completeOffsetStep(elementRequirement, offsetListener);

    startTime = performance.now();
    
    rangeRequirement.updateOffsets([2,1], true, false, false, false, true);

    endTime = performance.now();

    console.log("replace segment by complement:", endTime - startTime);
    completeStep(rangeRequirement, listener);
    completeOffsetStep(elementRequirement, offsetListener);
    
    startTime = performance.now();

    sequence.sort(compFunc);
    
    endTime = performance.now();

    console.log("sort total time: ", endTime - startTime);
    console.log("number of comparisons:", numComps);
    numComps = 0;
    
    var numHeap = 0;
    var numElement = 0;

    for(var node = orderTree.first ; node ; node = node.next) {
        if(node.heap === undefined)
            numElement++;
        else
            numHeap++;
    }

    console.log("heap:", numHeap, "element:", numElement);

    rangeRequirement.destroy();
    elementRequirement.destroy();
    
    if(testFailed)
        console.log("ERROR: test failed!");
    else
        console.log("test completed successfully");
}

function completeStep(rangeRequirement, listener)
{
    console.log("number of comparisons:", numComps);
    numComps = 0;
    var isCrossing = rangeRequirement.isComplement &&
        rangeRequirement.requirement.isCrossing;

    var beginRequirement = rangeRequirement.isComplement ?
        (isCrossing ?
         rangeRequirement.requirement.backwardRequirement :
         rangeRequirement.requirement.forwardRequirement) :
        rangeRequirement.requirement.beginRequirement;
    var endRequirement = rangeRequirement.isComplement ?
        (isCrossing ?
         rangeRequirement.requirement.forwardRequirement :
         rangeRequirement.requirement.backwardRequirement) :
        rangeRequirement.requirement.endRequirement;
    
    var startKey = beginRequirement.element !== undefined ?
        subOrder.get(beginRequirement.element) : undefined;
    var endKey = endRequirement.element !== undefined ?
        subOrder.get(endRequirement.element) : undefined;

    console.log("result: offset [",
                isCrossing ? -beginRequirement.offset : beginRequirement.offset,
                ",",
                rangeRequirement.isComplement && !isCrossing ?
                -endRequirement.offset : endRequirement.offset, "] elements: ",
                beginRequirement.element, "(", startKey, ")",
                endRequirement.element, "(", endKey, ")");

    // calculate the required offsets
    var beginOffset = beginRequirement.isBackward ?
        subSetSize - beginRequirement.offset - 1 : beginRequirement.offset;
    var endOffset = endRequirement.isBackward ?
        subSetSize - endRequirement.offset - 1 : endRequirement.offset;
    
    if((beginOffset >= 0 && beginOffset < subSetSize &&
        startKey != beginOffset) ||
       (beginOffset >= subSetSize && startKey !== undefined) ||
       (beginOffset < 0 && startKey !== undefined)) {
        console.log("ERROR: incorrect start of range");
        testFailed = true;
    }

    if((endOffset >= 0 && endOffset < subSetSize && endKey != endOffset) ||
       (endRequirement.offset >= subSetSize && endKey !== undefined) ||
       (endRequirement.offset < 0 && endKey !== undefined)) {
        console.log("ERROR: incorrect end of range");
        testFailed = true;
    }

    if(verifyTree && !testNoHeap(orderTree)) {
        console.log("ERROR: no heap count test failure");
        testFailed = true;
    }

    if(beginOffset < endOffset)
        listener.setNewForwardOffsets(beginOffset, endOffset);
    else
        listener.setNewForwardOffsets(endOffset, beginOffset);
    
    rangeRequirement.notifyListeners();

    if(!verifyMatches)
        return;
    
    // check the matches on the listener

    var numElementsInRange;
    if(startKey === undefined) {
        if(isCrossing) {
            if(endKey === undefined)
                numElementsInRange = subSetSize;
            else
                numElementsInRange = endKey + 1;
        } else
            numElementsInRange = 0;
    } else if(endKey === undefined)
        numElementsInRange = subSetSize - startKey;
    else
        numElementsInRange = endKey - startKey + 1;
    
    var numMatches = listener.matches.size;
    if(numMatches !== numElementsInRange) {
        console.log("ERROR: incorrect number of matches in listener");
        testFailed = true;
    }
    
    listener.matches.forEach(function(t, elementId) {
        var key = subOrder.get(elementId);
        if(key < startKey || key > endKey) {
            console.log("ERROR: match in listener is out of range:",
                        elementId + "(" + key + ")");
            testFailed = true;
        }
    });

    console.log("new low offset:", listener.lowOffset, "new high offset:",
                listener.highOffset, "ordered set:", listener.orderedSet);

    if(rangeRequirement.isOrderedRange) {
        if(listener.orderedSet.length != numElementsInRange) {
            console.log("ERROR: incorrect ordered set length in listener",
                        listener.orderedSet.length);
            testFailed = true;
        }
    }

    for(var i = listener.lowOffset ;
        i <= Math.min(subSetSize - 1, listener.highOffset) ; ++i) {
        var elementId = listener.orderedSet[i - listener.lowOffset];
        var key = subOrder.get(elementId);
        if(key != i) {
            console.log("ERROR: incorrect element", elementId, "(", key, ")",
                        "at position", i);
            testFailed = true;
        }
    }
}

function completeOffsetStep(offsetRequirement, offsetListener)
{
    if(offsetRequirement === undefined)
        return;
    
    offsetRequirement.notifyListeners();

    if(!verifyMatches || !offsetListener)
        return;
    
    // check the matches on the listener

    if(!offsetRequirement.isEnd)
        return; // no anchor range matches tracked
    
    if(offsetListener.offset === undefined) {
        if(offsetListener.matches.size !== 0) {
            console.log("ERROR: anchor not in set but range is not empty");
            testFailed = true;
            return;
        }
        if(offsetRequirement.isOrderedRange) {
            if(offsetListener.orderedSet.length !== 0) {
                console.log("ERROR:",
                            "anchor not in set but ordered range is not empty");
                testFailed = true;
                return;
            }
        }
    } else if(offsetListener.offset !== offsetListener.matches.size) {
        console.log("ERROR: range size", offsetListener.matches.size,
                    "does not match anchor offset", offsetListener.offset);
        testFailed = true;
        return;
        if(offsetRequirement.isOrderedRange) {
            if(offsetListener.offset !== offsetListener.orderedSet.length) {
                console.log("ERROR: ordered range size",
                            offsetListener.orderedSet.length,
                            "does not match anchor offset",
                            offsetListener.offset);
                testFailed = true;
                return;
            }
        }
    }

    // check that every element reported in the range is indeed in the range
    offsetListener.matches.forEach(function(t, element) {
        var elementOffset = subOrder.get(element);
        if(elementOffset === undefined) {
            console.log("ERROR: element", element,
                        "reported in anchor range but is not in ordered set");
            testFailed = true;
            return;
        }
        if(elementOffset >= offsetListener.offset) {
            console.log("ERROR: element", element, "at position", elementOffset,
                        "reported in anchor range but is beyond the anchor");
            testFailed = true;
            return;
        }
    });

    if(!offsetRequirement.isOrderedRange)
        return;

    for(var i = 0, l = offsetListener.orderedSet.length ; i < l ; ++i) {
        var element = offsetListener.orderedSet[i];
        var elementOffset = subOrder.get(element);
        if(elementOffset === undefined) {
            console.log("ERROR: element", element,
                        "reported in ordered anchor range",
                        "but is not in ordered set");
            testFailed = true;
            return;
        }
        if(elementOffset !== i) {
            console.log("ERROR: element", element, "at position", elementOffset,
                        "reported at position", i,
                        "in ordered anchor range");
            testFailed = true;
            return;
        }
    }
}

function generateRandomSequence(setSize)
{
    var sequence = new Array(setSize);

    for(var i = 0 ; i < setSize ; ++i)
        sequence[i] = i;

    for(var i = 0 ; i < setSize ; ++i) {

        var j = i + Math.floor(Math.random() * (setSize - i));
        var v = sequence[i];
        sequence[i] = sequence[j];
        sequence[j] = v;
    }

    return sequence;
}

// Remove a random set of 'numToRemove' elements from 'sequence' (returns
// object with two array: the sub-sequence and the set of elements removed).
// (the array of removed elements are not necessarily in their order
// in the input sequence).

function createSubSequence(sequence, numToRemove)
{
    if(numToRemove >= sequence.length)
        return { newSequence: [], removed: [].concat(sequence) };

    var subSequence = [].concat(sequence);
    var removed = [];
    
    for(var i = 0 ; i < numToRemove ; ++i) {
        var j = Math.floor(Math.random() * subSequence.length);
        removed.push(subSequence[j]);
        subSequence.splice(j,1);
    }

    return { newSequence: subSequence, removed: removed };
}

// Add a random set of 'numToAdd' elements from 'fullSequence' to
// 'subSequence' where 'subSequence' should be a sub-sequence of
// 'fullSequence'. returns object with two array: the new sub-sequence and
// the set of elements added.

function extendSubSequence(subSequence, fullSequence, numToAdd)
{
    // extract the positions in the full sequence which are not in the
    // sub-sequence (elements in the full and sub-sequence are in the same
    // order).

    var subPos = 0;
    var fullPos = 0;
    var fullLength = fullSequence.length;
    var subLength = subSequence.length;
    var remainingPos = [];

    while(fullPos < fullSequence.length) {
        if(subPos >= subLength || subSequence[subPos] != fullSequence[fullPos]){
            remainingPos.push(fullPos);
        } else
            subPos++;

        fullPos++;
    }

    // select 'numToAdd' random positions out of 'remainingPos'

    var selected = [];
    
    for(var i = 0 ; i < numToAdd ; ++i) {

        if(remainingPos.length == 0)
            break;
        
        var j = Math.floor(Math.random() * remainingPos.length);
        selected.push(remainingPos[j]);
        if(j < remainingPos.length - 1)
            remainingPos[j] = remainingPos[remainingPos.length - 1];
        remainingPos.length--;
    }

    selected.sort(function(a,b) { return a - b }); // sort the positions to add

    var newSequence = [];
    fullPos = 0;
    subPos = 0;
    var selectedPos = 0;
    var selectedLength = selected.length;

    // create the new sequence
    
    while(fullPos < fullSequence.length &&
          (subPos < subLength || selectedPos < selectedLength)) {
        if(subPos < subLength && subSequence[subPos] == fullSequence[fullPos]){
            newSequence.push(fullSequence[fullPos]);
            subPos++;
        } else if(selectedPos < selectedLength &&
                  fullPos == selected[selectedPos]) {
            newSequence.push(fullSequence[fullPos]);
            selectedPos++;
        }
        fullPos++;
    }

    // replace positions by values
    for(var i = 0 ; i < selectedLength ; ++i)
        selected[i] = fullSequence[selected[i]];

    return { newSequence: newSequence, added: selected };
}

// Generates a random ordering on the given sequence of unique elements and
// stores it in a Map object which maps each element to its position in the
// ordering (first position is 0). This map object is returned.

function generateOrdering(sequence)
{
    var keySequence = generateRandomSequence(sequence.length);
    var elementOrder = new IntHashMap();
    elementOrder.expectSize(sequence.length);
    
    for(var i = 0, l = sequence.length ; i < l ; i++)
        elementOrder.set(sequence[i], keySequence[i]);

    return elementOrder;
}

// reorders the global sequence and also updates the sub-order on the
// sub-sequence

function reorderSequence()
{
    fullOrder = generateOrdering(sequence);
    leftArg = undefined; // cached left argument comparison function
    subOrder = getSubOrdering(subSequence, compFunc);
}

function shortenSequenceTest()
{
    // remove some elements from the subsequence
    var removal =
        createSubSequence(subSequence,
                          Math.floor(Math.random() * subSequence.length));
    subSequence = removal.newSequence;
    subOrder = getSubOrdering(subSequence, compFunc);
    subSetSize = subSequence.length;

    startTime = performance.now();
    
    removeElements(removal.removed);

    endTime = performance.now();
    console.log("removed", removal.removed.length, "elements:",
                removal.removed);
    console.log("element removal total time: ", endTime - startTime);
}

function extendSequenceTest()
{
    var numToAdd = Math.floor(Math.random() *
                              (sequence.length - subSequence.length + 1));
    var toAdd = extendSubSequence(subSequence, sequence, numToAdd);
    
    subSequence = toAdd.newSequence;
    subOrder = getSubOrdering(subSequence, compFunc);
    subSetSize = subSequence.length;

    startTime = performance.now();
    
    addElements(toAdd.added);
    
    endTime = performance.now();
    console.log("added", toAdd.added.length, "elements:", toAdd.added);
    console.log("element addition total time: ", endTime - startTime);
}

function reorderSequenceTest()
{
    reorderSequence();
    
    startTime = performance.now();
        
    orderTree.refreshOrder();
        
    endTime = performance.now();

    console.log("re-order total time: ", endTime - startTime);
}

// add the given elements to the order tree

function addElements(elements)
{
    for(var i = 0, l = elements.length ; i < l ; ++i) {
        orderTree.insertElement(elements[i]);
        if(verifyTree && !testFailed) {
            var errorNodes = [];
            testSubTreeSize(orderTree.root, errorNodes);
            if(errorNodes.length > 0) {
                console.log("step", i, "node size error when inserting",
                            elements[i]);
                testFailed = true;
            }
            checkTree(orderTree);
            if(testFailed)
                console.log("failure in step", i);
            if(!testNoHeap(orderTree)) {
                testFailed = true;
                console.log("no heap count test failure in step", i);
            }
        }
    }
}

// remove the given elements from the order tree

function removeElements(elements)
{
    for(var i = 0, l = elements.length ; i < l ; ++i) {
        orderTree.removeElement(elements[i]);
        if(verifyTree && !testFailed) {
            var errorNodes = [];
            testSubTreeSize(orderTree.root, errorNodes);
            if(errorNodes.length > 0) {
                console.log("step", i, "node size error when removing",
                            elements[i]);
                testFailed = true;
            }
            checkTree(orderTree);
            if(testFailed)
                console.log("failure in step", i);
            if(!testNoHeap(orderTree)) {
                testFailed = true;
                console.log("no heap count test failure in step", i);
            }
        }
    }
}

// Given the subsequence and a comparison function, this function returns
// the order on the sub-sequence (returns a table element -> position in the
// sub-sequence).

function getSubOrdering(subSequence, compareFunc)
{
    // duplicate the subsequence and sort it
    var dupSubSequence = [].concat(subSequence);

    dupSubSequence.sort(compareFunc);

    var subOrder = new Map();
    
    for(var i = 0, l = dupSubSequence.length ; i < l ; ++i)
        subOrder.set(dupSubSequence[i], i);

    return subOrder;
}

function getDepth(node)
{
    if(!node.left && !node.right)
        return [1,1];
    
    var leftDepths;
    var rightDepths;
    
    if(node.left)
        leftDepths = getDepth(node.left);

    if(!node.right) {
        leftDepths[0] = 1;
        leftDepths[1]++;
        return leftDepths;
    }

    rightDepths = getDepth(node.right);    

    if(!node.left) {
        rightDepths[0] = 1;
        rightDepths[1]++;
        return rightDepths;
    }
    
    return [Math.min(leftDepths[0],rightDepths[0])+1,
            Math.max(leftDepths[1],rightDepths[1])+1];
}

function getMatchesStr(elementIds)
{
    var str = "";

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(i > 0)
            str += ",";
        str += elementId + "(" + subOrder.get(elementId) + ")";
    }

    return str;
}


function checkTree(tree)
{
    for(var node = tree.first ; node ; node = node.next)
        checkNode(node);

    if(tree.root) {
        checkPosTraceForward(tree.root);
        if(testRB(tree.root) === undefined) {
            console.log("ERROR: R-B property violated");
            testFailed = true;
        }
    }
}

function checkNode(node)
{
    if(node.element === undefined && node.heap === undefined) {
        console.log("node with undefined value");
        testFailed = true;
    }
        
    if(node.left) {
        if(node.left.parent != node) {
            console.log("left child of", debugGetOrderTreeNodeStr(node),
                        "has other parent");
            testFailed = true;
        }
    }

    if(node.right) {
        if(node.right.parent != node) {
            console.log("right child of", debugGetOrderTreeNodeStr(node),
                        "has other parent");
            testFailed = true;
        }
    }
}

function checkPosTraceForward(node)
{
    var posTrace = 0;
    var numRequirements = 0;
    
    if(node.right)
        numRequirements = checkPosTraceForward(node.right);

    if(numRequirements !== node.posTraceForward) {
        console.log("ERROR: incorrect forward trace on ",
                    debugGetOrderTreeNodeStr(node),
                    ":", node.posTraceForward, "instead of", numRequirements);
        testFailed = true;
    }

    if(node.left)
        numRequirements += checkPosTraceForward(node.left);
    
    if(node.absForward)
        numRequirements += node.absForward.length;
    if(node.elementForward)
        numRequirements++;
    
    return numRequirements;
}

function testSubTreeSize(node, errorNodes)
{
    var leftSize = node.left ? testSubTreeSize(node.left, errorNodes) : 0;

    if(leftSize === undefined)
        return undefined; // error 
    
    var rightSize = node.right ? testSubTreeSize(node.right, errorNodes) : 0;

    if(rightSize === undefined)
        return undefined; // error
    
    var selfSize = node.heap ? node.heap.getSize() : 1;

    var totalSize = leftSize + selfSize + rightSize;
    
    if(leftSize == 0 && rightSize == 0 && node.subTreeSize !== undefined) {
        console.log("terminal node sub-tree size defined:",
                    debugGetShortOrderTreeNodeStr(node));
        if(errorNodes)
            errorNodes.push(node);
        return totalSize;
    }

    if((leftSize != 0 || rightSize != 0) && node.subTreeSize === undefined) {
        console.log("non-terminal node sub-tree size undefined:",
                    debugGetShortOrderTreeNodeStr(node));
        if(errorNodes)
            errorNodes.push(node);
        return totalSize;
    }

    if(node.subTreeSize === undefined)
        return totalSize;
    
    if(totalSize != node.subTreeSize) {
        console.log("non-terminal", debugGetShortOrderTreeNodeStr(node),
                    "incorrect sub-tree size:",
                    node.subTreeSize, "instead of", leftSize, "+",
                    selfSize, "+", rightSize, "=", totalSize);
        if(errorNodes)
            errorNodes.push(node);
        return totalSize;
    }
    
    return totalSize;
}

function testNoHeap(tree)
{
    // check 'noHeapNext' property

    var noHeapCount = 0;

    for(var node = tree.first ; node ; node = node.next) {

        if(node.noHeapNext < 0) {
            console.log("negative noHeapNext on node",
                        debugGetShortOrderTreeNodeStr(node));
            return false;
        }
            
        if(node.absForward !== undefined) {
            for(var i = 0, l = node.absForward.length ; i < l ; ++i) {
                var requirement = node.absForward[i];
                if(!requirement.isOrderedRange)
                    continue;
                if(requirement.isBegin)
                    noHeapCount++;
                else if(requirement.isEnd)
                    noHeapCount--;
            }
        }

        if(node.elementBackward && node.elementBackward.isOrderedRange)
            noHeapCount++;

        if(node.noHeapNext !== noHeapCount) {
            console.log("noHeapNext on node",
                        debugGetShortOrderTreeNodeStr(node),
                        "is", node.noHeapNext, "but should be", noHeapCount);
            return false;
        }

        if(node.heap !== undefined && node.prev && node.prev.noHeapNext > 0) {
            console.log("node", debugGetShortOrderTreeNodeStr(node),
                        "is heap node though previous node indicates no heap"); 
            return false;
        }
    }

    // check 'noHeapPrev' property

    var noHeapCount = 0;
    
    for(var node = tree.last ; node ; node = node.prev) {

        if(node.noHeapPrev < 0) {
            console.log("negative noHeapPrev on node",
                        debugGetShortOrderTreeNodeStr(node));
            return false;
        }
            
        if(node.absBackward !== undefined) {
            for(var i = 0, l = node.absBackward.length ; i < l ; ++i) {
                var requirement = node.absBackward[i];
                if(!requirement.isOrderedRange)
                    continue;
                if(requirement.isBegin)
                    noHeapCount++;
                else if(requirement.isEnd)
                    noHeapCount--;
            }
        }

        if(node.elementForward && node.elementForward.isOrderedRange)
            noHeapCount++;

        
        if(node.noHeapPrev !== noHeapCount) {
            console.log("noHeapPrev on node",
                        debugGetShortOrderTreeNodeStr(node),
                        "is", node.noHeapPrev, "but should be", noHeapCount);
            return false;
        }

        if(node.heap !== undefined && node.next && node.next.noHeapPrev > 0) {
            console.log("node", debugGetShortOrderTreeNodeStr(node),
                        "is heap node though next node indicates no heap"); 
            return false;
        }
    }

    return true;
}

// given a node in a red black tree, this function checks whether the
// tree fulfills the red black properties. It returns the number
// of black nodes on the path from the node to any of the leaf nodes
// under it if the properties hold and undefined otherwise. 

function testRB(node)
{
    if(node.left === undefined && node.right === undefined)
        return (node.red ? 1 : 2);

    if(node.red && node.left && node.left.red) {
        console.log("red node with key", node.left.key, 
                    "is left child of red node with key", node.key);
        return undefined;
    }
    if(node.red && node.right && node.right.red) {
        console.log("red node with key", node.right.key, 
                    "is right child of red node with key", node.key);
        return undefined;
    }

    var depthLeft = node.left ? testRB(node.left) : 1;

    if(!depthLeft)
        return undefined;
    
    var depthRight = node.right ? testRB(node.right) : 1;
    
    if(!depthRight)
        return undefined;
    
    if(depthLeft != depthRight) {
        console.log("left black path depth under node with key ", node.key, 
                   "is", depthLeft, "but the right black path depth is", 
                   depthRight);
        return undefined;
    }
    
    return depthLeft + (node.red ? 0 : 1);
}

//
// Dummy Listener
//

function DummyListener()
{
    this.matches = new Map();
}

// low and high forward offsets (corrected for set size) 

DummyListener.prototype.setNewForwardOffsets =
    dummyListenerSetNewForwardOffsets;

function dummyListenerSetNewForwardOffsets(lowOffset, highOffset)
{
    if(lowOffset < 0)
        lowOffset = 0;
    this.newLowOffset = lowOffset;
    this.newHighOffset = highOffset;
}

DummyListener.prototype.addMatches = dummyListenerAddMatches;

function dummyListenerAddMatches(elementIds)
{
    if(elementIds.length <= 100) {
        var matchesStr = getMatchesStr(elementIds);
        console.log("added matches:", matchesStr);
    } else
        console.log("added", elementIds.length, "matches");

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(this.matches.has(elementId)) {
            console.log("Error: adding element", elementId,
                        "which is already a match");
        } else
            this.matches.set(elementId, true);
    }
}

DummyListener.prototype.removeMatches = dummyListenerRemoveMatches;

function dummyListenerRemoveMatches(elementIds)
{
    if(elementIds.length <= 100) {
        var matchesStr = getMatchesStr(elementIds);
        console.log("removed matches:", matchesStr);
    } else
        console.log("removed", elementIds.length, "matches");

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(!this.matches.has(elementId)) {
            console.log("Error: removing element", elementId,
                        "which is not a match");
        } else
            this.matches.delete(elementId);
    }
}

DummyListener.prototype.updatePos = dummyListenerUpdatePos;

function dummyListenerUpdatePos(elementIds, firstOffset, lastOffset,
                                setSize)
{
    if(elementIds.length <= 100) {
        var matchesStr = getMatchesStr(elementIds);
        console.log("updatePos:", matchesStr, "from offset", firstOffset,
                    "to offset", lastOffset, "size:", setSize);
    } else {
        console.log("updatePos:", "from offset", firstOffset,
                    "to offset", lastOffset, "size:", setSize);
    }

    var orderedSet = [];
    
    if(this.newLowOffset < firstOffset) // existing prefix
        orderedSet = this.orderedSet.splice(this.newLowOffset - this.lowOffset,
                                            firstOffset - this.lowOffset);

    orderedSet = orderedSet.concat(elementIds);

    var lastOrderedOffset = orderedSet.length + this.newLowOffset - 1;
    
    if(Math.min(setSize - 1, this.highOffset) > lastOrderedOffset) {
        orderedSet = orderedSet.
            concat(this.orderedSet.slice(lastOrderedOffset + 1 - this.lowOffset,
                                         Math.min(setSize,
                                                  this.newHighOffset+1) -
                                         this.lowOffset)); 
    }

    this.orderedSet = orderedSet;
    this.lowOffset = this.newLowOffset;
    this.highOffset = this.newHighOffset;
}

//
// Dummy listener for element offset requirements 
//

function OffsetDummyListener()
{
    this.offset = undefined;
    this.matches = new Map();
    this.orderedSet = undefined;
}


OffsetDummyListener.prototype.updateOffset = offsetDummyListenerUpdateOffset;

function offsetDummyListenerUpdateOffset(elementId, offset)
{
    this.offset = offset;
    console.log("new offset of element", elementId, "is", offset);

    if(this.offset !==  subOrder.get(elementId)) {
        console.log("ERROR: calculated offset of element", elementId,
                    "is", this.offset, "but should be",
                    subOrder.get(elementId));
        testFailed = true;
    }
}

OffsetDummyListener.prototype.addMatches = offsetDummyListenerAddMatches;

function offsetDummyListenerAddMatches(elementIds)
{
    if(elementIds.length <= 100) {
        var matchesStr = getMatchesStr(elementIds);
        console.log("added anchor range matches:", matchesStr);
    } else
        console.log("added", elementIds.length, "anchor range matches");

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(this.matches.has(elementId)) {
            console.log("Error: adding element", elementId,
                        "which is already an anchor range match");
        } else
            this.matches.set(elementId, true);
    }
}

OffsetDummyListener.prototype.removeMatches = offsetDummyListenerRemoveMatches;

function offsetDummyListenerRemoveMatches(elementIds)
{
    if(elementIds.length <= 100) {
        var matchesStr = getMatchesStr(elementIds);
        console.log("removed anchor range matches:", matchesStr);
    } else
        console.log("removed", elementIds.length, "anchor range matches");

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(!this.matches.has(elementId)) {
            console.log("Error: removing element", elementId,
                        "which is not an anchor range match");
        } else
            this.matches.delete(elementId);
    }
}

OffsetDummyListener.prototype.updatePos = offsetDummyListenerUpdatePos;

function offsetDummyListenerUpdatePos(elements, firstOffset, lastOffset,
                                      setSize)
{
    this.orderedSet = elements;
}

if (typeof window === "undefined") {
    var argi = 2;
    while (argi < process.argv.length) {
        if (process.argv[argi] === "-l") {
            testLog = true;
            argi++;
        } else {
            break;
        }
    }
    if (argi !== process.argv.length) {
        actualSeed = process.argv[argi++];
    }
    runTest();
}

