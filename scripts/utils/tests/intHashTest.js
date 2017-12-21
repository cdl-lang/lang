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


// This file implements a test of various integer hash tables (and compares
// their performance with the JavaScript Map()).


// %%include%%: <scripts/utils/utils.js>
// %%include%%: <scripts/utils/random.js>
// %%include%%: <scripts/utils/seedrandom.js>
// %%include%%: <scripts/utils/intHashTable.js>

var previousSeeds = ["VXiqy42tvN6d", "hWZhh0feSoP2"];

var actualSeed = previousSeeds[0];

var testFailed = false;

var startTime;
var endTime;
var setSize = 1000000;
var rangeSize = 10000000;
var rangeStart = 1025000;
var table;
var mapTable;

function runTest()
{
    // set the seed
    if (!actualSeed) {
        actualSeed = getRandomString(12);
    }
    console.log("seed", actualSeed);
    Math.seedrandom(actualSeed);

    table = new IntHashMap(); // new Uint32HashSet();
    mapTable = new Map();

    var sequence = generateRandomSequence(setSize, rangeSize, rangeStart);

    sequence.sort(function(a,b) { return a - b; });   

    // hash table test
    
    startTime = performance.now();
    
    for(var i = 0, l = sequence.length / 2; i < l ; ++i) {
        table.set(sequence[i], true);
    }

    endTime = performance.now();
    console.log("sequence add total time: ", endTime - startTime);

    startTime = performance.now();
    
    for(var i = 0, l = sequence.length / 2; i < l ; ++i) {
        if(!table.has(sequence[i])) {
            console.log("Error: table does not store value", sequence[i]);
        }
    }

    endTime = performance.now();
    console.log("sequence test total time: ", endTime - startTime);

    startTime = performance.now();

    var notInTable = [];
    var numNotInTable = 0;
    
    for(var i = rangeStart ; i < rangeStart + rangeSize ; ++i) {
        if(!table.has(i)) {
            notInTable.push(i);
            if(++numNotInTable >= setSize)
                break;
        }
    }
    
    endTime = performance.now();
    console.log("complement generation total time: ", endTime - startTime);

    startTime = performance.now();
    
    for(var i = 0, l = sequence.length / 4 ; i < l ; ++i) {
        table.delete(sequence[i], true);
    }

    endTime = performance.now();
    console.log("sequence delete total time: ", endTime - startTime);

    startTime = performance.now();
    
    for(var i = sequence.length / 2, l = sequence.length ; i < l ; ++i) {
        table.set(sequence[i], true);
    }

    endTime = performance.now();
    console.log("sequence re-add total time: ", endTime - startTime);

    var countValues = 0;

    startTime = performance.now();
    table.forEach(function(value, key) { countValues++; });
    endTime = performance.now();
    console.log("forEach (" + countValues, "values) total time: ",
                endTime - startTime);
    
    // Map test
    
/*    startTime = performance.now();
    
    for(var i = 0, l = sequence.length / 2 ; i < l ; ++i) {
        mapTable.set(sequence[i], true);
    }

    endTime = performance.now();
    console.log("map add total time: ", endTime - startTime);

    startTime = performance.now();
    
    for(var i = 0, l = sequence.length / 2 ; i < l ; ++i) {
        if(!mapTable.has(sequence[i])) {
            console.log("Error: map does not store value", sequence[i]);
        }
    }

    endTime = performance.now();
    console.log("map test total time: ", endTime - startTime);

    startTime = performance.now();
    
    var notInMapTable = [];
    var numNotInMapTable = 0;
    
    for(var i = 0 ; i < rangeSize ; ++i) {
        if(!mapTable.has(i)) {
            notInMapTable.push(i);
            if(++numNotInMapTable >= setSize)
                break;
        }
    }
    
    endTime = performance.now();
    console.log("map complement generation total time: ", endTime - startTime);

    startTime = performance.now();
    
    for(var i = 0, l = sequence.length / 4 ; i < l ; ++i) {
        mapTable.delete(sequence[i], true);
    }

    endTime = performance.now();
    console.log("map delete total time: ", endTime - startTime);

    startTime = performance.now();
    
    for(var i = sequence.length / 2, l = sequence.length ; i < l ; ++i) {
        mapTable.set(sequence[i], true);
    }

    endTime = performance.now();
    console.log("map re-add total time: ", endTime - startTime); */
}

function generateRandomSequence(setSize, rangeSize, rangeStart)
{
    var sequence = new Array(setSize);
    var range = new Array(rangeSize);

    for(var i = 0 ; i < rangeSize ; ++i)
        range[i] = rangeStart + i;

    for(i = 0 ; i < setSize ; ++i) {
        var j = i + Math.floor(Math.random() * (rangeSize - i));
        var v = range[i];
        sequence[i] = range[i] = range[j];
        range[j] = v;
    }

    return sequence;
}

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
