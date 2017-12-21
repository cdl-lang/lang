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


// This test is identical to minMaxPosHeapTest except that instead of
// adding objects with key and value fields (both of which contain
// the same value) the test simple stores atomic values in the heap.

// run this test with the argument time=true to time the test (in which
// case the result is not verified for correctness, as the verification is
// time consuming). Witohut this flag, no timing takes place, but the
// result is verified to be correct.

var testLog = false;
var actualSeed; // = "FZxCJ4t3eBfN";

// %%include%%: <scripts/utils/inheritance.js>
// %%include%%: <scripts/utils/utils.js>
// %%include%%: <scripts/utils/random.js>
// %%include%%: <scripts/utils/seedrandom.js>
// %%include%%: <scripts/utils/argParse.js>
// %%include%%: "../minMaxPosHeap.js"

function stringmult(str, n) {
    var s = "";

    for (var i = 0; i < n; i++) {
        s += str;
    }
    return s;
}

function runTest(timeTest) {
    var nrAdds = 0, nrAddArray = 0, nrPopMin = 0, nrPopMax = 0, nrRemovePos = 0;
    var i, newVal;
    var nrRuns = 0;
    var sumHeapSize = 0;
    var lwb = Math.round(Math.pow(10, 5));

    if (!actualSeed) {
        actualSeed = getRandomString(12);
    }
    Math.seedrandom(actualSeed);
    console.log("seed", actualSeed);

    var startTime = new Date();

    if(timeTest)
        console.log("timing the test: verification disabled");
    
    for (var mc = 0; mc !== 250; mc++) {
        if (testLog) console.log("test run", mc + 1);
        var h = new MinMaxPosHeap(function (a, b) { return a - b; });

        var lastMin, lastMax;
        for (var ic = 0; ic !== 1000; ic++) {
            var rnd = Math.random();
            if (rnd < 0.1) {
                var arr = [];
                var nrToAdd = Math.random() * 10 + 1;
                for (i = 0; i < nrToAdd; i++) {
                    newVal = Math.floor(Math.random() * 9 * lwb) + lwb;
                    if (lastMin === undefined || newVal < lastMin) {
                        lastMin = newVal;
                    }
                    if (lastMax === undefined || newVal > lastMax) {
                        lastMax = newVal;
                    }
                    arr.push(newVal);
                }
                if (testLog) console.log("addArray", arr);
                h.addArray(arr);
                nrAddArray++;
            } else if (rnd < (timeTest ? 0.7 : 0.3)) {
                newVal = Math.floor(Math.random() * 9 * lwb) + lwb;
                if (lastMin === undefined || newVal < lastMin) {
                    lastMin = newVal;
                }
                if (lastMax === undefined || newVal > lastMax) {
                    lastMax = newVal;
                }
                if (testLog) console.log("add", newVal);
                h.add(newVal);
                nrAdds++;
            } else if (rnd < 0.8) {
                if (!h.isEmpty()) {
                    var poppedMin = h.popMin();
                    if (testLog) console.log("popmin", poppedMin);
                    if (!(poppedMin >= lastMin)) {
                        console.log("error popMin");
                        MinMaxHeap.errorCount++;
                    }
                    lastMin = poppedMin;
                    nrPopMin++;
                }
            } else if (rnd < 0.9) {
                if (!h.isEmpty()) {
                    var poppedMax = h.popMax();
                    if (testLog) console.log("popmax", poppedMax);
                    if (!(poppedMax <= lastMax)) {
                        console.log("error popMax");
                        MinMaxHeap.errorCount++;
                    }
                    lastMax = poppedMax;
                    nrPopMax++;
                }
            } else {
                if (!h.isEmpty()) {
                    var removePos = Math.floor(Math.random() * h.getSize() + 1);
                    if (testLog) console.log("removePos", removePos);
                    h.removePos(removePos);
                    nrRemovePos++;
                }
            }
            if (testLog && !h.isEmpty()) console.log("heap", h.heap.map(function(e){return e;}));
            // verification is expensive, so run only if not in timing mode
            if(!timeTest)
                h.verify();
            if (MinMaxHeap.errorCount !== 0) {
                process.exit(1);
            }
            nrRuns++;
            sumHeapSize += h.heap.length - 1;
        }
    }
    console.log("nrAdds="+nrAdds, "nrAddArray="+nrAddArray,
                "nrPopMins="+nrPopMin, "nrPopMax="+nrPopMax,
                "nrRemovePos="+nrRemovePos);
    console.log(""+nrRuns, "runs,", sumHeapSize / nrRuns, "average heap size");
    if(timeTest) {
        var endTime = new Date();
        console.log("total time:", endTime.getTime() - startTime.getTime());
    }
}

function main() {
    var argParser = getArgParser();
    runTest(argParser.hasArg("time"));
    console.log("test ok");
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
}
