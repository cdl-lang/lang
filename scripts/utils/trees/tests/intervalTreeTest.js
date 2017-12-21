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

function config2str(conf) {
    var str, i, attr;

    if (conf instanceof Array) {
        str = "[";
        for (i = 0; i != conf.length; i++) {
            if (i > 0) str += ", ";
            str += config2str(conf[i]);
        }
        str += "]";
    } else if (conf instanceof Object) {
        i = 0;
        str = "{";
        for (attr in conf) {
            if (i > 0) str += ", ";
            str += attr + ":" + config2str(conf[attr]);
            i++;
        }
        str += "}";
    } else {
        str = typeof conf === "string"? '"' + conf + '"': String(conf);
    }
    return str;
}


// %%include%%: <scripts/utils/utils.js>
// %%include%%: <scripts/utils/random.js>
// %%include%%: <scripts/utils/seedrandom.js>
// %%include%%: <scripts/utils/inheritance.js>
// %%include%%: <scripts/utils/trees/binaryTree.js>
// %%include%%: <scripts/utils/trees/redBlackTree.js>
// %%include%%: <scripts/utils/trees/intervalTree.js>
// %%include%%: <scripts/utils/trees/degenerateIntervalTree.js>

var actualSeed; // = "yohBziFZTrz4"; // "1XyyHtBfskk4"; // = "Z49HOhew3T4R";
var degenerateOnly = false;
var convertToNonDegenerate = false;
var checkEachStep = false;
var printConstructionSteps = false;

var testTree = degenerateOnly ? 
    new DegenerateIntervalTree() : new IntervalTree();

function main() {
    runTest();
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

var maxKey = 1000;

// Returns a random interval as an object of the following form:
// { 
//    lowKey: <low key>, 
//    highKey: <high key>, 
//    lowOpen: <low end open>, 
//    highOpen: <high end open>, 
//    string: <string representation of interval>
// };
// If the 'degenerate' flag is set, only degenerate intervals are returned

function generateRandomInterval(degenerate)
{
    var lowKey = Math.floor(Math.random() * (maxKey - 1));
    var highKey;
    var lowOpen;
    var highOpen;

    if(degenerate) {
        highKey = lowKey;
        lowOpen = highOpen = false;
    } else {
        highKey = lowKey + 1 +
            Math.floor(Math.random() * (maxKey - lowKey));
        lowOpen = !!(Math.floor(Math.random() * 2));
        highOpen = !!(Math.floor(Math.random() * 2));

        switch (Math.floor(Math.random() * 50)) {
        case 0:
            lowKey = -Infinity;
            highKey = Infinity;
            lowOpen = true;
            highOpen = true;
            break;
        case 1:
            lowKey = -Infinity;
            lowOpen = true;
            break;
        case 2:
            highKey = Infinity;
            highOpen = true;
            break;
        case 3:
            highKey = lowKey;
            lowOpen = false;
            highOpen = false;
            break;
        }
    }

    var intervalString = (lowOpen ? "(" : "[") + lowKey + "," + 
        highKey + (highOpen ? ")" : "]");
    
    return { lowKey: lowKey, 
             highKey: highKey, 
             lowOpen: lowOpen, 
             highOpen: highOpen, 
             string: intervalString };
}

// given a value (number) and an interval of the format returned by 
// generateRandomInterval(), this function returns true if the value belongs
// to the interval and otherwise false

function valueInInterval(value, interval)
{
    return (interval.lowKey <= value &&
            (interval.lowKey < value || !interval.lowOpen) &&  
            interval.highKey >= value &&
            (interval.highKey > value || !interval.highOpen));
}

// 'interval1' and 'interval2' are interval objects as returned by 
// generateRandomInterval(). This function returns true if they overlap and
// false otherwise. 

function intervalsIntersect(interval1, interval2)
{
    return ((interval1.lowKey < interval2.highKey ||
             (interval1.lowKey == interval2.highKey && !interval1.lowOpen &&
             !interval2.highOpen)) &&
            (interval2.lowKey < interval1.highKey ||
             (interval2.lowKey == interval1.highKey && !interval2.lowOpen &&
             !interval1.highOpen)));
}

// 'contained' and 'containing' are interval objects as returned by 
// generateRandomInterval(). This function returns true if 'contained' is
// contained inside 'containing' and false otherwise.

function intervalContains(contained, containing)
{
    return ((containing.lowKey < contained.lowKey ||
             (containing.lowKey == contained.lowKey && 
              (!containing.lowOpen || contained.lowOpen))) &&
            (containing.highKey > contained.highKey ||
             (containing.highKey == contained.highKey && 
              (!containing.highOpen || contained.highOpen))));
}

function runTest()
{
    // set the seed
    if (!actualSeed) {
        actualSeed = getRandomString(12);
    }
    console.log("seed", actualSeed);
    Math.seedrandom(actualSeed);

    var intervals = [];
    var intervalCount = {};
    var removeQueue = [];
    var removedQueue = [];

    // generate and store the intervals
    for(var i = 0 ; i < 1000 ; i++) {
        var interval = generateRandomInterval(degenerateOnly);
        intervals.push(interval);
        if(intervalCount[interval.string])
           intervalCount[interval.string]++;
        else
            intervalCount[interval.string] = 1;
    }

    // number of different intervals
    var intervalNum = Object.keys(intervalCount).length;

    var startDate = new Date();

    // add the intervals to the test tree
    for(var i = 0, l = intervals.length ; i < l ; ++i) {
        if(degenerateOnly)
            testTree.insertPoint(i, intervals[i].lowKey);
        else
            testTree.insertInterval(i, intervals[i].lowKey, 
                                    intervals[i].highKey, 
                                    intervals[i].lowOpen, 
                                    intervals[i].highOpen);
        if(printConstructionSteps)
            console.log("inserting", i, intervals[i].string);
        if(checkEachStep && 
           !checkInsertedIntervals(intervals, i, removedQueue)){
            console.log("error found: test failed!");
            return;
        }
        if(Math.random() >= 0.3) {
            // insert in a random position in the array
            removeQueue.splice(Math.floor(Math.random() * removeQueue.length), 
                               0, i);
        }
        while(removeQueue.length) {
            if(Math.random() >= 0.6) {
                var removedId = removeQueue.shift();
                if(degenerateOnly)
                    testTree.removePoint(removedId, 
                                         intervals[removedId].lowKey);
                else
                    testTree.removeInterval(removedId, 
                                            intervals[removedId].lowKey,
                                            intervals[removedId].highKey,
                                            intervals[removedId].lowOpen,
                                            intervals[removedId].highOpen);
                removedQueue.push(removedId);
                if(printConstructionSteps)
                    console.log("removing", removedId,
                                intervals[removedId].string);
                if(checkEachStep && 
                   !checkInsertedIntervals(intervals, i, removedQueue)) {
                    console.log("error found: test failed!");
                    return;
                }
            } else
                break;
        }
        while(removedQueue.length) {
            if(Math.random() >= 0.6) {
                // get a random key out of the array
                var removedPos = 
                    Math.floor(Math.random() * removedQueue.length);
                var removedId = removedQueue[removedPos];
                if(degenerateOnly)
                    testTree.insertPoint(removedId, 
                                        intervals[removedId].lowKey);
                else
                    testTree.insertInterval(removedId, 
                                            intervals[removedId].lowKey,
                                            intervals[removedId].highKey,
                                            intervals[removedId].lowOpen,
                                            intervals[removedId].highOpen);
                if(printConstructionSteps)
                    console.log("re-inserting", removedId,
                                intervals[removedId].string);
                removedQueue.splice(removedPos, 1);
                if(checkEachStep && 
                   !checkInsertedIntervals(intervals, i, removedQueue)) {
                    console.log("error found: test failed!");
                    return;
                }
            } else
                break;
        }
    }

    while(removedQueue.length) {
        var removedId = removedQueue.shift();
        if(degenerateOnly)
            testTree.insertPoint(removedId, 
                                 intervals[removedId].lowKey);
        else
            testTree.insertInterval(removedId, 
                                    intervals[removedId].lowKey,
                                    intervals[removedId].highKey,
                                    intervals[removedId].lowOpen,
                                    intervals[removedId].highOpen);
        if(printConstructionSteps)
            console.log("re-inserting", removedId,
                        intervals[removedId].string);
        if(checkEachStep && 
           !checkInsertedIntervals(intervals, intervals.length-1, 
                                   removedQueue)) {
            console.log("error found: test failed!");
            return;
        }
    }

    if(degenerateOnly && convertToNonDegenerate) {
        var newTree = new IntervalTree();
        newTree.importFromDegenerateTree(testTree);
        testTree = newTree;
        degenerateOnly = false;
    }

    var endDate = new Date();
	console.log("construction time (ms):", 
                endDate.getTime() - startDate.getTime());

    var failed = false;

    // check that each of the intervals is stored on the nodes on which
    // it should be stored.
    failed = !checkInsertedIntervals(intervals, intervals.length-1, 
                                     removedQueue);
    if(!failed) {
        // test key lookup
        var lookupValue;
        for(var i = 0 ; i < 200 ; ++i) {
            lookupValue = Math.floor(Math.random() * maxKey);
            var result = testTree.find(lookupValue);
            var resultTable = {};
            // check if all intervals in the result indeed match
            for(var j = 0 ; j < result.length ; ++j) {
                var matched = result[j];
                if(!resultTable[matched])
                    resultTable[matched] = true;
                else {
                    console.log("interval", matched,
                                intervals[matched].string,
                                "appears multiple times in result for key",
                                lookupValue);
                    failed = true;
                }
                if(!valueInInterval(lookupValue, intervals[matched])) {
                    console.log("interval", matched, intervals[matched].string,
                                "matched by key", lookupValue);
                    failed = true;
                }
            }
            // check that all intervals that match the key are in the
            // result array
            for(var j = 0 ; j < intervals.length ; ++j) {
                if(!valueInInterval(lookupValue, intervals[j]))
                    continue; // not matched
                if(resultTable[j])
                    continue; // appears in the result
                console.log("interval", j,
                            intervals[j].string,
                            "was not matched by key", lookupValue);
                failed = true;
            }
        }
    }
    
    if(!failed) {
        // test interval lookup
        for(var i = 0 ; i < 200 ; ++i) {
            var searchInterval = generateRandomInterval(); 
            var result = testTree.findIntersections(searchInterval.lowKey, 
                                                    searchInterval.highKey,
                                                    searchInterval.lowOpen, 
                                                    searchInterval.highOpen);

            var resultTable = {};
            // check if all intervals in the result indeed match
            for(var j = 0 ; j < result.length ; ++j) {
                var matched = result[j];
                if(!resultTable[matched])
                    resultTable[matched] = true;
                else {
                    console.log("interval", matched,
                                intervals[matched].string,
                                "appears multiple times in result for interval",
                                searchInterval.string);
                    failed = true;
                }
                if(!intervalsIntersect(intervals[matched], searchInterval)) {
                    console.log("interval", matched, intervals[matched].string, 
                                "matched by interval", searchInterval);
                    failed = true;
                }
            }
            // check that all intervals that match the interval are in the
            // result array
            for(var j = 0 ; j < intervals.length ; ++j) {
                if(!intervalsIntersect(intervals[j], searchInterval))
                    continue; // not matched
                if(resultTable[j])
                    continue; // appears in the result
                console.log("interval", j, intervals[j].string,
                            "was not matched by interval", 
                            searchInterval.string); 
                failed = true;
            }
        }
    }

    if(!failed) {
        // test contained interval lookup
        for(var i = 0 ; i < 200 ; ++i) {
            var containing = generateRandomInterval();
            var result = testTree.findContained(containing.lowKey, 
                                                containing.highKey, 
                                                containing.lowOpen, 
                                                containing.highOpen);
            var resultTable = {};
            // check if all intervals in the result are indeed contained
            for(var j = 0 ; j < result.length ; ++j) {
                var matched = result[j];
                if(!resultTable[matched])
                    resultTable[matched] = true;
                else {
                    console.log("interval", matched, 
                                intervals[matched].string,
                                "appears multiple times in result", 
                                "for contained lookup for interval",
                                containing.string);
                    failed = true;
                }
                if(!intervalContains(intervals[matched], containing)) {
                    console.log("interval", matched,
                                intervals[matched].string, 
                                "matched as contained by interval",
                                containing.string);
                    failed = true;
                }
            }
            // check that all intervals that match the interval are in the
            // result array
            for(var j = 0 ; j < intervals.length ; ++j) {
                if(!intervalContains(intervals[j], containing))
                    continue; // not matched
                if(resultTable[j])
                    continue; // appears in the result
                console.log("interval", j, intervals[j].string,
                            "was not matched as contained in interval", 
                            containing.string);
                failed = true;
            }
        }
    }

    if(!failed) {
        // test intersection with upper bound lookup
        for(var i = 0 ; i < 200 ; ++i) {
            var intersecting = generateRandomInterval();
            // give the upper bound a high chance to be equal to the high key
            var upperBound;
            if(Math.random() < 0.3)
                upperBound = intersecting.highKey;
            else {
                upperBound = intersecting.highKey + 
                    Math.floor(Math.random() * (maxKey - 1));
            }
            var upperBoundOpen = (Math.random() < 0.5);
            var result = testTree.findWithUpperBound(intersecting.lowKey, 
                                                     intersecting.highKey, 
                                                     intersecting.lowOpen, 
                                                     intersecting.highOpen,
                                                     upperBound, 
                                                     upperBoundOpen);
            var resultTable = {};
            // check if all intervals in the result are indeed intersecting
            // and inside the upper bound.
            for(var j = 0 ; j < result.length ; ++j) {
                var matched = result[j];
                if(!resultTable[matched])
                    resultTable[matched] = true;
                else {
                    console.log("interval", matched, 
                                intervals[matched].string,
                                "appears multiple times in result", 
                                "for lookup for interval",
                                intersecting.string, "with upper bound", 
                                upperBound, 
                                upperBoundOpen ? "(open)" : "(closed)");
                    failed = true;
                }
                if(!intervalsIntersect(intervals[matched], intersecting)) {
                    console.log("interval", matched,
                                intervals[matched].string, 
                                "matched as intersecting with interval",
                                intersecting.string, "(with upper bound", 
                                upperBound, 
                                upperBoundOpen ? "(open)" : "(closed)", ")");
                    failed = true;
                }
                if(upperBound < intervals[matched].highKey ||
                   (!intervals[matched].highOpen && upperBoundOpen && 
                    upperBound == intervals[matched].highKey)) {
                    console.log("interval", matched,
                                intervals[matched].string, 
                                "matched as intersecting with interval",
                                intersecting.string, "with upper bound", 
                                upperBound, 
                                upperBoundOpen ? "(open)" : "(closed)");
                    failed = true;
                }
            }
            // check that all intervals that match the interval and are inside
            // the upper bound are in the result array
            for(var j = 0 ; j < intervals.length ; ++j) {
                if(!intervalsIntersect(intervals[j], intersecting))
                    continue; // not matched
                if(intervals[j].highKey > upperBound || 
                   (!intervals[j].highOpen && upperBoundOpen && 
                    intervals[j].highKey == upperBound))
                    continue; // extends beyond upper bound
                if(resultTable[j])
                    continue; // appears in the result
                console.log("interval", j, intervals[j].string,
                            "was not matched as intersecting with interval", 
                            intersecting.string, "with upper bound", 
                            upperBound, upperBoundOpen ? "(open)" : "(closed)");
                failed = true;
            }
        }
    }

    if(!failed) {
        // test intersection with lower bound lookup
        for(var i = 0 ; i < 200 ; ++i) {
            var intersecting = generateRandomInterval();
            // give the lower bound a high chance to be equal to the low key
            var lowerBound;
            if(Math.random() < 0.3)
                lowerBound = intersecting.lowKey;
            else {
                lowerBound = Math.floor(Math.random() * intersecting.lowKey);
            }
            var lowerBoundOpen = (Math.random() < 0.5);
            var result = testTree.findWithLowerBound(intersecting.lowKey, 
                                                     intersecting.highKey, 
                                                     intersecting.lowOpen, 
                                                     intersecting.highOpen,
                                                     lowerBound, 
                                                     lowerBoundOpen);
            var resultTable = {};
            // check if all intervals in the result are indeed intersecting
            // and inside the upper bound.
            for(var j = 0 ; j < result.length ; ++j) {
                var matched = result[j];
                if(!resultTable[matched])
                    resultTable[matched] = true;
                else {
                    console.log("interval", matched, 
                                intervals[matched].string,
                                "appears multiple times in result", 
                                "for lookup for interval",
                                intersecting.string, "with lower bound", 
                                lowerBound, 
                                lowerBoundOpen ? "(open)" : "(closed)");
                    failed = true;
                }
                if(!intervalsIntersect(intervals[matched], intersecting)) {
                    console.log("interval", matched,
                                intervals[matched].string, 
                                "matched as intersecting with interval",
                                intersecting.string, "(with lower bound", 
                                lowerBound, 
                                lowerBoundOpen ? "(open)" : "(closed)", ")");
                    failed = true;
                }
                if(lowerBound > intervals[matched].lowKey ||
                   (!intervals[matched].lowOpen && lowerBoundOpen && 
                    lowerBound == intervals[matched].lowKey)) {
                    console.log("interval", matched,
                                intervals[matched].string, 
                                "matched as intersecting with interval",
                                intersecting.string, "with lower bound", 
                                lowerBound, 
                                lowerBoundOpen ? "(open)" : "(closed)");
                    failed = true;
                }
            }
            // check that all intervals that match the interval and are inside
            // the lower bound are in the result array
            for(var j = 0 ; j < intervals.length ; ++j) {
                if(!intervalsIntersect(intervals[j], intersecting))
                    continue; // not matched
                if(intervals[j].lowKey < lowerBound || 
                   (!intervals[j].lowOpen && lowerBoundOpen &&
                    intervals[j].lowKey == lowerBound))
                    continue; // extends beyond upper bound
                if(resultTable[j])
                    continue; // appears in the result
                console.log("interval", j, intervals[j].string,
                            "was not matched as intersecting with interval", 
                            intersecting.string, "with lower bound", 
                            lowerBound, 
                            lowerBoundOpen ? "(open)" : "(closed)");
                failed = true;
            }
        }
    }

    if(failed)
        console.log("test failed!!!!");
    else
        console.log("test succeeded");
}

// This function checks whether the currently inserted intervals are 
// inserted properly. Returns true if they are and false if they aren't.

function checkInsertedIntervals(intervals, lastInserted, removedQueue)
{
    var failed = false;
    
    var removedIntervals = {};
    for(var j = 0, l = removedQueue.length ; j < l ; ++j)
        removedIntervals[removedQueue[j]]= true;

    if(degenerateOnly) {
        
        var inTree = {};

        // loop over all nodes and check that the IDs stored in them
        // match the intervals.
        for(var node = testTree.first ; node ; node = node.next) {
            var refCount = node.value ? node.value.size() : 0;
            
            if(refCount) {
                node.value.forEach(function(t,id) {
                    if(id in removedIntervals) {
                        console.log("degenerate interval tree:",
                                    "interval", id, intervals[id].string,
                                    "removed but still in tree");
                        failed = true;
                    }
                    inTree[id] = true;
                    if(intervals[id].lowKey != node.key) {
                        console.log("degenerate interval tree:",
                                    "interval", id, intervals[id].string,
                                    "stored under key", node.key);
                        failed = true;
                    }
                });
            }
        }

        // check that all intervals are in the tree
        for(var i = 0 ; i <= lastInserted ; ++i) {
            if(i in removedIntervals)
                continue;
            if(!(i in inTree)) {
                console.log("degenerate interval tree:",
                            "interval", i, intervals[i].string,
                            "not found in tree");
                failed = true;
            }
        }

        return !failed;
    }

    // check that each of the intervals which was already inserted is stored 
    // on the nodes on which it should be stored.
    for(var i = 0 ; i <= lastInserted ; ++i) {
        
        if(i in removedIntervals)
            continue;

        var spans = 
            checkInterval(i, intervals[i].lowKey, intervals[i].highKey, 
                          intervals[i].lowOpen, intervals[i].highOpen, 
                          intervals[i].string, testTree.root,
                          testTree.root.value, -Infinity, Infinity);
        if(!spans)
            failed = true;
    }

    if(!failed) {
        if(!checkForIncorrectEndPoints(testTree.root, intervals, lastInserted, 
                                       removedIntervals))
            failed = true;
    }

    return !failed;
}

// extract the nodes under the given node where the given interval should
// be stored and check whether it is indeed stored there. Returns the list
// of spans of these nodes (coded as a string <low>:<high>).

function checkInterval(id, lowKey, highKey, lowOpen, highOpen, intervalString, 
                       node, value, lowSpan, highSpan)
{
    if(lowSpan >= lowKey && highSpan <= highKey) {
        
        var result = [lowSpan + ":" + highSpan];

        if (lowKey === -Infinity && highKey === Infinity) {
            if (!testTree.entireDomainIntervals.has(id)) {
                console.log("interval", id, intervalString,
                            "not stored in entireDomainIntervals");
                return undefined;
            }
        } else if(highSpan == highKey) {
            if(!value.end.has(id)) {
                console.log("interval", id, intervalString,
                            "not stored as ending on node with span", 
                            "[", lowSpan, ",", highSpan, "]");
                return undefined;
            }
        } else {
            if(!value.dontEnd.has(id)) {
                console.log("interval", id, intervalString,
                            "not stored as not ending on node with span", 
                            "[", lowSpan, ",", highSpan, "]");
                return undefined;
            }
        }

        // check that this interval is not stored on any other node under this
        // node
        if(node) {
            if(node.left === undefined)
                value = node.value.leftLeaf;
            else
                value = node.left.value;
            if(!checkNotUnderNode(id, lowKey, highKey, intervalString, 
                                  node.left, value, lowSpan, node.key))
                return undefined;
            if(node.right === undefined)
                value = node.value.rightLeaf;
            else
                value = node.right.value;
            if(!checkNotUnderNode(id, lowKey, highKey, intervalString, 
                                  node.right, value, node.key, highSpan))
                return undefined;
        }

        return result;
    }

    if(!node) {
        console.log("search for interval", id, intervalString,
                   "reach leaf span ", "[", lowSpan, ",", highSpan, "]", 
                    "which is not contained in it");
        return undefined;
    }

    // check for end points
    if(lowKey == highKey) {
        // degenerate point
        if(node.key == lowKey) {
            if(node.degenerate && node.degenerate.has(id))
                result = []; // found, but no span
            else {
                console.log("degenerate interval", id, intervalString,
                            "not stored on node with key", node.key);
                return undefined;
            }
        }
    } else if(!lowOpen && node.key == lowKey) {
        if(!node.lowEnd || !node.lowEnd.has(id)) {
            console.log("interval", id, intervalString,
                        "not stored as having closed low end at node with key",
                        node.key);
            return undefined;
        }
    } else if(!highOpen && node.key == highKey) {
        if(!node.highEnd || !node.highEnd.has(id)) {
            console.log("interval", id, intervalString,
                        "not stored as having closed high end at node with key",
                        node.key);
            return undefined;
        }
    }

    var lowerMatchingNodes = [];

    // check for left child
    if(node.left === undefined)
        value = node.value.leftLeaf;
    else
        value = node.left.value;

    if(lowKey < node.key) {
        // continue recursion down left child.
        lowerMatchingNodes = 
            checkInterval(id, lowKey, highKey, lowOpen, highOpen, 
                          intervalString, node.left, value, lowSpan, node.key);
        if(!lowerMatchingNodes)
            return undefined;
    } else {
        // check that this interval is not stored under the left child
        if(!checkNotUnderNode(id, lowKey, highKey, intervalString, node.left, 
                              value, lowSpan, node.key))
            return undefined;
    }
     
    // check for right child
    if(node.right === undefined)
        value = node.value.rightLeaf;
    else
        value = node.right.value;

    if(highKey > node.key) {
        // continue recursion down right child.
        var result = 
            checkInterval(id, lowKey, highKey, lowOpen, highOpen, 
                          intervalString, node.right, value, node.key, 
                          highSpan);
        if(!result)
            return undefined;
        lowerMatchingNodes = lowerMatchingNodes.concat(result);
    } else {
        if(!checkNotUnderNode(id, lowKey, highKey, intervalString, node.right, 
                              value, node.key, highSpan)) 
            return undefined;
    }

    return lowerMatchingNodes;
}

// This function verifies that the interval with the given ID is not
// stored under this node or any of its children. Returns false if the
// test fails. The keys and the span is given here only for the sake of printing
// error messages. 

function checkNotUnderNode(id, lowKey, highKey, intervalString, node, value, 
                           lowSpan, highSpan)
{
    if(value.end.has(id)) {
        console.log("interval", id, intervalString, 
                   "stored as ending at node with span", 
                    "[", lowSpan, ",", highSpan, "]");
        return false;
    }
    if(value.dontEnd.has(id)) {
        console.log("interval", id, intervalString, 
                   "stored as not ending at node with span", 
                    "[", lowSpan, ",", highSpan, "]");
        return false;
    }

    if(!node)
        return true; // reached the leaf

    if(node.degenerate && node.degenerate.has(id)) {
        console.log("interval", id, intervalString, 
                   "stored as degenerate at node with key", node.key); 
        return false;
    }
    if(node.lowEnd && node.lowEnd.has(id)) {
        console.log("interval", id, intervalString, 
                   "stored as having a low end-point at node with key", 
                    node.key); 
        return false;
    }
    if(node.highEnd && node.highEnd.has(id)) {
        console.log("interval", id, intervalString, 
                   "stored as having a high end-point at node with key", 
                    node.key); 
        return false;
    }

    // continue to the child nodes

    value = node.left ? node.left.value : node.value.leftLeaf;
    if(!checkNotUnderNode(id, lowKey, highKey, intervalString, node.left, 
                          value, lowSpan, node.key))
        return false;

    value = node.right ? node.right.value : node.value.rightLeaf;
    if(!checkNotUnderNode(id, lowKey, highKey, intervalString, node.right, 
                          value, node.key, highSpan))
        return false;

    return true;
}

// given a node in the interval tree, the list of intervals, the index of
// the last interval inserted and a list of intervals (among those inserted)
// which were removed, this function goes over the end point lists of
// this node and all nodes under it. If it finds a an entry in one of these
// end point tables which should not be there, it reports the problem
// and returns false. Otherwise, it returns true).

function checkForIncorrectEndPoints(node, intervals, lastInserted, 
                                    removedIntervals)
{
    if(!node)
        return true;

    if(node.lowEnd) {
        node.lowEnd.forEach(function(t,id) {
            if(id in removedIntervals) {
                console.log("removed interval", id, intervals[id].string,
                            "still has low end at node with key", node.key);
                return false;
            }
            if(intervals[id].lowKey != node.key || intervals[id].lowOpen ||
               intervals[id].lowKey == intervals[id].highKey) {
                console.log("interval", id, intervals[id].string,
                            "incorrectly has low end at node with key", 
                            node.key);
                return false;
            }
        });
    }

    if(node.highEnd) {
        node.highEnd.forEach(function(t,id) {
            if(id in removedIntervals) {
                console.log("removed interval", id, intervals[id].string,
                            "still has high end at node with key", node.key);
                return false;
            }
            if(intervals[id].highKey != node.key || intervals[id].highOpen ||
               intervals[id].lowKey == intervals[id].highKey) {
                console.log("interval", id, intervals[id].string,
                            "incorrectly has high end at node with key", 
                            node.key);
                return false;
            }
        });
    }

    if(node.degenerate) {
        node.degenerate.forEach(function(t,id) {
            if(id in removedIntervals) {
                console.log("removed interval", id, intervals[id].string,
                            "still stored as degenerate at node with key", 
                            node.key);
                return false;
            }
            if(intervals[id].highKey != node.key || 
               intervals[id].lowKey != intervals[id].highKey) {
                console.log("interval", id, intervals[id].string,
                            "incorrectly stored as degenerate at node with key",
                            node.key);
                return false;
            }
        });
    }

    if(node.left && 
       !checkForIncorrectEndPoints(node.left, intervals, lastInserted, 
                                   removedIntervals))
        return false;

    if(node.right && 
       !checkForIncorrectEndPoints(node.right, intervals, lastInserted, 
                                   removedIntervals))
        return false;

    return true;
}
