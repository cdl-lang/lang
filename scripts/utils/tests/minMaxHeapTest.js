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


// run this test with the argument time=true to time the test (in which
// case the result is not verified for correctness, as the verification is
// time consuming). Witohut this flag, no timing takes place, but the
// result is verified to be correct.

var testLog = false;
var actualSeed; // = "JWoWEOsI6MSl";

// %%include%%: "../minMaxHeap.js"
// %%include%%: <scripts/utils/random.js>
// %%include%%: <scripts/utils/seedrandom.js>
// %%include%%: <scripts/utils/argParse.js>

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
        var h = new MinMaxHeap(function (a, b) { return a - b; });
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
           } else if (rnd < 0.7) {
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
            if (testLog) console.log("heap", h.heap);
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

function runBenchmark(sorted) {
    var nrCompares = 0;
    var cmp = function (a, b) { nrCompares++; return a - b; };
    var h1, h2;
    var i, val;
    var nc1, nc2;
    var lwb = Math.round(Math.pow(10, strWidth - 1));

    for (var n = 0; n <= 10000; n += 1000) {
        for (var m = 1000; m <= 20000; m += 1000) {
            // first create a heap of size n
            h1 = new MinMaxHeap(cmp);
            h2 = new MinMaxHeap(cmp);
            for (i = 0; i !== n; i++) {
                val = Math.floor(Math.random() * 9 * lwb) + lwb;
                h1.add(val);
                h2.add(val);
            }
            // create arrays of length n/10 .. n in 10 steps
            var arr = [];
            while (arr.length < m) {
                if (sorted == 1) {
                    arr.push(arr.length);
                } else if (sorted == 2) {
                    arr.push(m - arr.length);
                } else {
                    arr.push(Math.floor(Math.random() * 9 * lwb) + lwb);
                }
            }
            nrCompares = 0;
            h1.addArray(arr, 1);
            nc1 = nrCompares;
            nrCompares = 0;
            h2.addArray(arr, 2);
            nc2 = nrCompares;
            console.log(n+"", m, nc1, nc2, nc1 - nc2);
        }
    }
}

function main() {
    var argParser = getArgParser();
    runTest(argParser.hasArg("time"));
}

if (typeof window === "undefined") {
    var argi = 2;
    var benchmark = undefined;
    while (argi < process.argv.length) {
        if (process.argv[argi] === "-l") {
            testLog = true;
            argi++;
        } else if (process.argv[argi] === "-b") {
            argi++;
            benchmark = process.argv[argi++];
            if (benchmark != 0 && benchmark != 1 && benchmark != 2) {
                console.log("benchmark is 0, 1, or 2");
                process.exit(1);
            }
        } else {
            break;
        }
    }
    if (argi !== process.argv.length) {
        actualSeed = process.argv[argi++];
    }
    if (benchmark !== undefined) {
        for (var run = 0; run != 30; run++) {
            runBenchmark(benchmark);
        }
    } else {
        runTest();
    }
}
