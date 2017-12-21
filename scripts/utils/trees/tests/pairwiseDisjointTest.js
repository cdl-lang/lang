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
// %%include%%: <scripts/utils/trees/pairwiseDisjoint.js>

var previousSeeds = ["kmnrHbWgOJBI", "iP3iZm1xD6uD", "TfsUbaZzSZqW"];
var actualSeed; // = previousSeeds[0];

var degenerateOnly = false;
var generateDisjoint = true;
var testPairwiseDisjoint = new PairwiseDisjoint(generateDisjoint);
// the test intervals (position in array is the ID)
var intervals = [];
// the pairwise dijoint intervals
var disjointIntervals = new Map(); // disjoint intervals representing the set
var intervalsInSet = new Map(); // the intervals curently stored in the set

var testFailed = false;

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
//    startValue: <low key>, 
//    endValue: <high key>, 
//    startOpen: <low end open>, 
//    endOpen: <high end open>, 
//    string: <string representation of interval>
// };
// If the 'degenerate' flag is set, only degenerate intervals are returned

function generateRandomInterval(degenerate)
{
    var startValue = Math.floor(Math.random() * (maxKey - 1));
    var endValue;
    var startOpen;
    var endOpen;

    if(degenerate) {
        endValue = startValue;
        startOpen = endOpen = false;
    } else {
        endValue = startValue + 1 +
            Math.min(maxKey - startValue - 1, Math.floor(Math.random() * 50));
        // Math.floor(Math.random() * (maxKey - startValue));
        startOpen = !!(Math.floor(Math.random() * 2));
        endOpen = !!(Math.floor(Math.random() * 2));

        switch (Math.floor(Math.random() * 200)) {
        case 0:
            startValue = -Infinity;
            endValue = Infinity;
            startOpen = true;
            endOpen = true;
            break;
        case 1:
            startValue = -Infinity;
            startOpen = true;
            break;
        case 2:
            endValue = Infinity;
            endOpen = true;
            break;
        case 3:
            endValue = startValue;
            startOpen = false;
            endOpen = false;
            break;
        }
    }

    var intervalString = (startOpen ? "(" : "[") + startValue + "," + 
        endValue + (endOpen ? ")" : "]");
    
    return { startValue: startValue, 
             endValue: endValue, 
             startOpen: startOpen, 
             endOpen: endOpen, 
             string: intervalString };
}

function runTest()
{
    // set the seed
    if (!actualSeed) {
        actualSeed = getRandomString(12);
    }
    console.log("seed", actualSeed);
    Math.seedrandom(actualSeed);

    // generate random intervals
    var intervalCount = {};

    // generate and store the intervals
    for(var i = 0 ; i < 30 ; i++) {
        var interval = generateRandomInterval(degenerateOnly);
        intervals.push(interval);
        if(intervalCount[interval.string])
           intervalCount[interval.string]++;
        else
            intervalCount[interval.string] = 1;
        console.log("interval", i, ":", interval.string);
        checkCorrectness();
    }

    // number of different intervals
    var intervalNum = Object.keys(intervalCount).length;

    var startDate = new Date();
    
    // add the intervals to the pairwise disjoint structure
    for(var i = 0, l = intervals.length ; i < l ; ++i) {
        addIntervalToPairwiseDisjoint(i, intervals[i]);
    }

    // modify some intervals
    for(var i = 0 ; i < 10 ; ++i) {
        var modifiedId = Math.floor(Math.random() * intervals.length);
        var newInterval = generateRandomInterval(degenerateOnly);
        if(--intervalCount[intervals[modifiedId].string] == 0)
            delete intervalCount[intervals[modifiedId].string];
        if(intervalCount[newInterval.string])
            intervalCount[newInterval.string]++;
        else
            intervalCount[newInterval.string] = 1;
        modifyIntervalInPairwiseDisjoint(modifiedId, newInterval);

        checkCorrectness();
    }

    // generate some intervals to test the isDisjointRange() function

    console.log("testing isDisjointRange()");
    
    for(var i = 0 ; i < 30 ; ++i) {
        var range = generateRandomInterval(false);
        if(!checkDisjointRange(range))
            testFailed = true;
    }

    for(var i = 0 ; i < 30 ; ++i) {
        var range = generateRandomInterval(true);
        if(!checkDisjointRange(range))
            testFailed = true;
    }

    console.log("end testing isDisjointRange()");

    console.log("testing getCoveringIntervalId()");
    
    for(var i = 0 ; i < 30 ; ++i) {
        var range = generateRandomInterval(false);
        if(!checkOverlappingRange(range))
            testFailed = true;
    }

    for(var i = 0 ; i < 30 ; ++i) {
        var range = generateRandomInterval(true);
        if(!checkOverlappingRange(range))
            testFailed = true;
    }

    console.log("end testing getCoveringIntervalId()");
    
    // remove the intervals from the pairwise disjoint structure
    // at a random order
    var remainingIntervals = [];
    intervalsInSet.forEach(function(t, id) {
        remainingIntervals.push(id);
    });
    while(remainingIntervals.length > 0) {
        var pos = Math.floor(Math.random() * remainingIntervals.length);
        var removedId = remainingIntervals[pos];
        remainingIntervals[pos] =
            remainingIntervals[remainingIntervals.length - 1];
        remainingIntervals.length--;
        removeIntervalFromPairwiseDisjoint(removedId, intervals[removedId]);
        checkCorrectness();
    }

    if(testFailed)
        console.log("test failed!");
    else
        console.log("test completed successfully");
    
}

// add a single interval to the pairwise disjoint structure and update the
// list of pairwise disjoint intervals generated based on this.

function addIntervalToPairwiseDisjoint(id, interval)
{
    var wasDisjoint = testPairwiseDisjoint.isDisjoint();
    
    intervalsInSet.set(id, true);
    
    var modified = testPairwiseDisjoint.addInterval(interval.startValue,
                                                    interval.startOpen,
                                                    interval.endValue, 
                                                    interval.endOpen, id);
        
    if(modified === undefined) {
        // add this interval to the list of disjoint intervals
        var disjointInterval = {
            id: id,
            startValue: interval.startValue,
            startOpen: interval.startOpen,
            endValue: interval.endValue, 
            endOpen: interval.endOpen
        };
        disjointIntervals.set(id, disjointInterval);
        console.log("adding added interval", i, interval.string,
                    "to disjoint set");
    } else {
        if(modified.removedIntervals && modified.removedIntervals.length) {
            console.log("removing intervals", modified.removedIntervals,
                        "from disjoint set after adding interval", id,
                        interval.string);
            for(var i = 0, l = modified.removedIntervals.length ; i < l ; ++i){
                disjointIntervals.delete(modified.removedIntervals[i]);
            }
        }
        if(modified.coveringInterval !== undefined) {
            disjointIntervals.set(modified.coveringInterval.id,
                                  modified.coveringInterval);
            console.log("adding/modifying covering interval:",
                        modified.coveringInterval, "when adding", id,
                        interval.string);
        }
    }

    if(wasDisjoint !== testPairwiseDisjoint.isDisjoint()) {
        if(!wasDisjoint)
            console.log("ERROR: changed from non-disjoint to disjoint",
                        "as a result of adding", id, interval.string);
        else
            console.log("set became non-disjoint after adding", id,
                        interval.string);
    }
}

// Modify the given interval to 'newInterval' and update the disjoint
// intervals

function modifyIntervalInPairwiseDisjoint(modifiedId, newInterval)
{
    var wasDisjoint = testPairwiseDisjoint.isDisjoint();

    var interval = intervals[modifiedId];
    
    console.log("modifying interval",
                modifiedId, interval.string, "->",newInterval.string);

    var modified =
        testPairwiseDisjoint.modifyInterval(newInterval.startValue,
                                            newInterval.startOpen,
                                            newInterval.endValue, 
                                            newInterval.endOpen,
                                            interval.startValue,
                                            interval.startOpen,
                                            interval.endValue, 
                                            interval.endOpen, modifiedId);
    
    if(modified === undefined) {
        // update this interval in the list of disjoint intervals
        var disjointInterval = {
            id: modifiedId,
            startValue: newInterval.startValue,
            startOpen: newInterval.startOpen,
            endValue: newInterval.endValue, 
            endOpen: newInterval.endOpen
        };
        disjointIntervals.set(modifiedId, disjointInterval);
        console.log("modified interval", modifiedId, newInterval.string,
                    "remains in disjoint set");
    } else {
        if(modified.removedIntervals && modified.removedIntervals.length) {
            console.log("removing intervals", modified.removedIntervals,
                        "from disjoint set after modifying interval",
                        modifiedId, interval.string, "->",newInterval.string);
            for(var i = 0, l = modified.removedIntervals.length ; i < l ; ++i){
                disjointIntervals.delete(modified.removedIntervals[i]);
            }
        }
        if(modified.coveringInterval !== undefined) {
            disjointIntervals.set(modified.coveringInterval.id,
                                  modified.coveringInterval);
            console.log("adding/modifying covering interval:",
                        modified.coveringInterval, "when modifying interval",
                        modifiedId, interval.string, "->",newInterval.string);
        }
        if(modified.restoredIntervals) {
            for(var i = 0, l = modified.restoredIntervals.length ; i < l ; ++i){
                disjointIntervals.set(modified.restoredIntervals[i].id,
                                      modified.restoredIntervals[i]);
                console.log("restoring interval", modified.restoredIntervals[i],
                            "when modifying interval",
                            modifiedId, interval.string, "->",
                            newInterval.string);
            }
        }
        if(modified.modifiedInterval) {
            var id = modified.modifiedInterval.id;
            // modify this interval
            console.log("modifying interval",
                        disjointIntervals.get(id), "to",
                        modified.modifiedInterval,
                        "when modifying interval",
                        modifiedId, interval.string, "->",
                        newInterval.string);
            disjointIntervals.set(id, modified.modifiedInterval);
        }
    }
    
    intervals[modifiedId] = newInterval;

    if(wasDisjoint !== testPairwiseDisjoint.isDisjoint()) {
        console.log("set changed from", wasDisjoint ? "" : "not",
                    "disjoint to",
                    testPairwiseDisjoint.isDisjoint() ? "" : "not",
                    "disjoint",
                    "when modifying interval",
                    modifiedId, interval.string, "->",
                    newInterval.string)
    }
}

function removeIntervalFromPairwiseDisjoint(id, interval)
{
    var wasDisjoint = testPairwiseDisjoint.isDisjoint();
    
    console.log("removing interval", id, interval.string);
    intervalsInSet.delete(id);
    var modified = testPairwiseDisjoint.removeInterval(interval.startValue,
                                                       interval.startOpen,
                                                       interval.endValue, 
                                                       interval.endOpen, id);

    if(modified === undefined) {
        // remove the interval itself from the set of disjoint intervals
        disjointIntervals.delete(id);
        console.log("removing the interval itself from disjoint set", id,
                    interval.string)
    } else {
        if((!modified.restoredIntervals || !modified.restoredIntervals.length)
           && !modified.modifiedInterval) {
            console.log("no changes in disjoint set required after removal");
        }
           
        if(modified.restoredIntervals) {
            for(var i = 0, l = modified.restoredIntervals.length ; i < l ; ++i){
                disjointIntervals.set(modified.restoredIntervals[i].id,
                                      modified.restoredIntervals[i]);
                console.log("restoring interval", modified.restoredIntervals[i],
                            "after removing interval", id, interval.string);
            }
        }
        if(modified.modifiedInterval) {
            if(modified.modifiedInterval.id == id) {
                // remove the removed interval (may have a different range)
                console.log("removing disjoint interval",
                            "with same ID as removed interval:", id,
                            interval.string, disjointIntervals.get(id)); 
                disjointIntervals.delete(id);
            } else {
                var modifiedId = modified.modifiedInterval.id;
                // modify this interval
                console.log("modifying interval",
                            disjointIntervals.get(modifiedId), "to",
                            modified.modifiedInterval,
                            "as a result of removing", id, interval.string);
                disjointIntervals.set(modifiedId, modified.modifiedInterval);
            }
        }
    }

    if(wasDisjoint !== testPairwiseDisjoint.isDisjoint()) {
        if(wasDisjoint)
            console.log("ERROR: changed from disjoint to non-disjoint",
                        "as a result of removing", id, interval.string);
        else
            console.log("set became disjoint after removing", id,
                        interval.string);
    }
}

// check correctness of the current state. Prints and error message
// and sets the 'testFailed' flag if not.

function checkCorrectness()
{
    if(generateDisjoint) {
        if(!checkDisjointCoveredByIntervals() ||
           !checkIntervalsContainedInDisjoint()) {
            // debugger;
            testFailed = true;
        }
    }

    if(!checkDisjoint()) {
        // debugger;
        testFailed = true;
    }    
}

// 'contained' and 'containing' are interval objects.
// This function returns true if 'contained' is
// contained inside 'containing' and false otherwise.

function intervalContains(contained, containing)
{
    return ((containing.startValue < contained.startValue ||
             (containing.startValue == contained.startValue && 
              (!containing.startOpen || contained.startOpen))) &&
            (containing.endValue > contained.endValue ||
             (containing.endValue == contained.endValue && 
              (!containing.endOpen || contained.endOpen))));
}

// Returns true if every interval in 'intervalsInSet' is contained in
// some interval in the disjoint list and false otherwise.

function checkIntervalsContainedInDisjoint()
{
    var disjointList = [];
    disjointIntervals.forEach(function(interval, id) {
        disjointList.push(interval);
    });

    var notContained = [];

    intervalsInSet.forEach(function(t,id) {

        var interval = intervals[id];
        var contained = false;
        
        for(var i = 0, l = disjointList.length ; i < l ; ++i) {
            var disjointInterval = disjointList[i];
            if(intervalContains(interval, disjointInterval)) {
                contained = true;
                break;
            }
        }

        if(!contained)
            notContained.push(id);
    });

    if(notContained.length > 0)
       console.log("ERROR: intervals", notContained,
                   "not contained in disjoint set");
    
    return (notContained.length == 0);
}

// check whether all disjoint intervals are covered by the union of
// intervals added. Returns true if yes, false if not

function checkDisjointCoveredByIntervals()
{
    var notCovered = []; // list of disjoint intervals which are not covered
    disjointIntervals.forEach(function(interval, id) {
        if(!checkContainedInIntervals(interval.startValue,
                                      interval.startOpen,
                                      interval.endValue,
                                      interval.endOpen))
            notCovered.push(id);
    });

    if(notCovered.length > 0)
        console.log("ERROR: disjoint intervals", notCovered,
                    "not covered by intervals");
    
    return (notCovered.length == 0);
}

// check whether the given interval is contained in
// the union of the intervals whose IDs are in 'intervalsInSet'.
// We do this simply but inefficiently by looking for an interval
// which covers the lowest point in a disjoint interval, removing that interval
// from the disjoint interval and then continuing until nothing is
// left (success) or no interval can be found (failure).

function checkContainedInIntervals(startValue, startOpen, endValue, endOpen)
{
    var inSet = [];
    intervalsInSet.forEach(function(t,id) {
        inSet.push(id);
    });

    while(1) {

        var reduced = false;
        
        for(var i = 0, l = inSet.length ; i < l ; ++i) {
            var interval = intervals[inSet[i]];
            if(interval.startValue > startValue ||
               (interval.startValue == startValue && !startOpen &&
                interval.startOpen))
                continue; // does not cover start point

            if(interval.endValue < startValue ||
               (interval.endValue == startValue && (startOpen ||
                                                    interval.endOpen)))
                continue; // does not cover start point

            reduced = true;
            
            // update start point
            startValue = interval.endValue;
            startOpen = !interval.endOpen;

            if(startValue > endValue ||
               (startValue == endValue && (startOpen || endOpen)))
                return true; // covered
        }

        if(!reduced)
            return false; // could not find overlap
    }
}

// This function tests the 'isDisjoint()' function: whether the intervals
// are indeed disjoint when it says they are and are not disjoint when it says
// they are not.

function checkDisjoint()
{
    var sortedIntervals = []; // sorted by start point

    intervalsInSet.forEach(function(t,id) {
        sortedIntervals.push(intervals[id]);
    });

    sortedIntervals.sort(function(a,b) {
        if(a.startValue == b.startValue)
            // open after closed (true after false)
            return a.startOpen - b.startOpen;
        else
            return a.startValue - b.startValue;
    });

    // check whether each sorted intervals ends before the next one starts

    var areDisjoint = true;
    
    for(var i = 0, l = sortedIntervals.length - 1 ; i < l ; ++i) {

        var first = sortedIntervals[i];
        var second = sortedIntervals[i+1];

        if(first.endValue < second.startValue ||
           (first.endValue == second.startValue &&
            (first.endOpen || second.startOpen)))
            continue; // do not overlap

        areDisjoint = false;
        break;
    }

    if(areDisjoint !== testPairwiseDisjoint.isDisjoint()) {
        console.log("claimed to be",
                    testPairwiseDisjoint.isDisjoint() ? "" : "not",
                    "disjoint", "while actually is",
                    areDisjoint ? "" : "not", "disjoint");
        return false;
    }

    return true;
}

// Given an object representing an interval, this function tests the
// isDisjointRange() function. It takes all disjoint intervals in
// this object together with 'range' and sorts them. It then checks whether
// the sequence each start is after the end whic happears before it.

function checkDisjointRange(range)
{
    var sortedIntervals = []; // sorted by start point

    disjointIntervals.forEach(function(interval,id) {
        sortedIntervals.push(interval);
    });

    sortedIntervals.push(range);
    
    sortedIntervals.sort(function(a,b) {
        if(a.startValue == b.startValue)
            // open after closed (true after false)
            return a.startOpen - b.startOpen;
        else
            return a.startValue - b.startValue;
    });

    // check whether each sorted intervals ends before the next one starts

    var areDisjoint = true;
    
    for(var i = 0, l = sortedIntervals.length - 1 ; i < l ; ++i) {

        var first = sortedIntervals[i];
        var second = sortedIntervals[i+1];

        if(first.endValue < second.startValue ||
           (first.endValue == second.startValue &&
            (first.endOpen || second.startOpen)))
            continue; // do not overlap

        areDisjoint = false;
        break;
    }

    console.log("testing range", range.string, "which is",
                areDisjoint ? "" : "not", "disjoint");
    
    if(areDisjoint !== testPairwiseDisjoint.isDisjointRange(range.startValue,
                                                            range.startOpen,
                                                            range.endValue,
                                                            range.endOpen)) {
        console.log("range", range.string, "claimed to be ",
                    !areDisjoint ? "" : "not",
                    "disjoint", "while are actually",
                    areDisjoint ? "" : "not", "disjoint");
        return false;
    }

    return true;
}


// Given an object representing an interval, this function tests the
// getCoveringIntervalId() function. It takes all disjoint intervals in
// this object together with 'range' and sorts them by start point. For
// 'range', the start and end are reversed during sorting so that
// its end point, rather than its start point is compared. It therefore
// appears after all intervals which begin before it ends and
// before all intervals which begin after its end. For intervals which
// begin at the point it ends, if that interval is closed at its low
// end and range is closed at its high end, 'range' appears after it.
// Otherwise, range appears first.
// After sorting the ranges, the function can check the correctness of
// the function getCoveringIntervalId() by checking that the sequence
// of intervals is disjoint if getCoveringIntervalId() is undefined
// and if getCoveringIntervalId() returned an ID, that this is the ID
// of the interval which appears just before 'range' in the sorted list.

function checkOverlappingRange(range)
{
    range.isTested = true; // mark this interval
    
    var sortedIntervals = []; // sorted by start point

    disjointIntervals.forEach(function(interval,id) {
        sortedIntervals.push(interval);
    });

    sortedIntervals.push(range);
    
    sortedIntervals.sort(function(a,b) {
        if(a.isTested) {
            if(a.endValue == b.startValue)
                return (!a.endOpen && !b.startOpen) ? 1 : -1;
            else
                return a.endValue - b.startValue;
        } else if(b.isTested) {
            if(a.startValue == b.endValue)
                return (!b.endOpen && !a.startOpen) ? -1 : 1;
            else
                return a.startValue - b.endValue;
        } else {
            if(a.startValue == b.startValue)
                // open after closed (true after false)
                return a.startOpen - b.startOpen;
            else
                return a.startValue - b.startValue;
        }
    });

    // find the 'range' interval and check whether it is disjoint from
    // interval before it (if any). If it is, check whether
    // getCoveringIntervalId() returned undefined. If they are not disjoint,
    // check whether the ID of the interval before 'range' is the
    // id returned by getCoveringIntervalId().

    var rangePos;
    
    for(var i = 0, l = sortedIntervals.length ; i < l ; ++i) {
        if(sortedIntervals[i].isTested) {
            rangePos = i;
            break;
        }
    }

    var overlappingId = undefined;
    var overlapping = undefined;
    
    if(rangePos > 0) {
        var tested = sortedIntervals[rangePos];
        var previous = sortedIntervals[rangePos - 1];

        if(previous.endValue > tested.startValue ||
           (previous.endValue == tested.startValue &&
            !previous.endOpen && !tested.startOpen)) {
            overlappingId = previous.id;
            overlapping = previous;
        }
    }
        
    
    var coveringId =
        testPairwiseDisjoint.getCoveringIntervalId(range.startValue,
                                                   range.startOpen,
                                                   range.endValue,
                                                   range.endOpen);

    console.log("testing covering of range", range.string, "which is",
                overlappingId === undefined ? "" : "not", "disjoint");

    var coveringInterval;

    if(coveringId !== undefined) {
        for(var i = 0, l = sortedIntervals.length - 1 ; i < l ; ++i) {
            if(sortedIntervals[i].id == coveringId) {
                coveringInterval = sortedIntervals[i];
                break;
            }
        }
    }
    
    if(overlappingId != coveringId) {
        console.log("range", range.string, "claimed to be covered by ",
                    coveringId,
                    (coveringId === undefined) ? "" : coveringInterval,
                    "but is covered by", overlappingId, overlapping);
        return false;
    }

    return true;
}
