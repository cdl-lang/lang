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

/* Min-Max Heap
   Taken from ￼M.D. Atkinson, J.-R. Sack, N. Santoro, and T. Strothott (1986).
   Min-Max Heaps and Generalized Priority Queues. In: Programming Techniques
   and Data Structures. Ian Munro (Ed).

   Class invariants
     Structure:
       heap[0] = undefined, root = heap[1]
       parentIndex = i, leftChildindex = 2 * i, rightChildIndex =  2 * i + 1
       childIndex = i, parentIndex = i >> 1

     Values stored at nodes on even (odd) levels are smaller (greater) than
     or equal to the values stored at their descendants (if any)
     where the root is at level zero.
     => heap[1] = minimum element of entire heap
     => heap[2] or heap[3] = maximum element of entire heap (when existing)
*/

function MinMaxHeap(comparator) {
    this.comparator = comparator;
    this.comparatorInfo = undefined;
    this.heap = [undefined];
}

MinMaxHeap.prototype.setComparatorInfo = minMaxHeapSetComparatorInfo;
function minMaxHeapSetComparatorInfo(info) {
    this.comparatorInfo = info;
}

MinMaxHeap.prototype.getComparatorInfo = minMaxHeapGetComparatorInfo;
function minMaxHeapGetComparatorInfo() {
    return this.comparatorInfo;
}

MinMaxHeap.prototype.isSorted = false;

MinMaxHeap.prototype.clear = minMaxHeapClear;
function minMaxHeapClear() {
    this.heap = [undefined];    
}

MinMaxHeap.prototype.isEmpty = minMaxHeapIsEmpty;
function minMaxHeapIsEmpty() {
    return this.heap.length === 1;
}

MinMaxHeap.prototype.getSize = minMaxHeapGetSize;
function minMaxHeapGetSize() {
    return this.heap.length - 1;
}

MinMaxHeap.prototype.getMin = minMaxHeapGetMin;
function minMaxHeapGetMin() {
    return this.heap[1];
}

MinMaxHeap.prototype.getMax = minMaxHeapGetMax;
function minMaxHeapGetMax() {
    switch (this.heap.length) {
      case 1:
        return undefined;
      case 2:
        return this.heap[1];
      case 3:
        return this.heap[2];
      default:
        return this.compare(2, 3) > 0? this.heap[2]: this.heap[3];
    }
}

MinMaxHeap.prototype.compare = minMaxHeapCompare;
function minMaxHeapCompare(n1, n2) {
    return this.comparator(this.heap[n1], this.heap[n2], this.comparatorInfo);
}

MinMaxHeap.prototype.swap = minMaxHeapSwap;
function minMaxHeapSwap(n1, n2) {
    var tmp = this.heap[n1];

    this.heap[n1] = this.heap[n2];
    this.heap[n2] = tmp;
}

// Adds a single element to the heap
MinMaxHeap.prototype.add = minMaxHeapAdd;
function minMaxHeapAdd(elt) {
    this.assignPos(this.heap.length, elt);
    this.bubbleUp(elt, this.heap.length - 1);
}

MinMaxHeap.prototype.removePos = minMaxHeapRemovePos;
function minMaxHeapRemovePos(index) {
    var lastElt = this.popLastPos();

    if (index < this.heap.length) {
        this.assignPos(index, lastElt);
        this.trickleDown(index);
    }
}

MinMaxHeap.prototype.bubbleUp = minMaxHeapBubbleUp;
function minMaxHeapBubbleUp(elt, i) {
    var parent = i >> 1;

    if (MinMaxHeap.isOnMinLevel(i)) {
        if (parent > 0 && this.compare(i, parent) > 0) {
            this.swap(i, parent);
            this.bubbleUpMax(parent);
        } else {
            this.bubbleUpMin(i);
        }
    } else {
        if (parent > 0 && this.compare(i, parent) < 0) {
            this.swap(i, parent);
            this.bubbleUpMin(parent);
        } else {
            this.bubbleUpMax(i);
        }
    }
}

// Algorithm taken from http://aggregate.org/MAGIC/
// First determines the highest bit set, then locates its position
// and checks whether it's odd or even.
// Assumes heap size will not exceed 2^31-1.
MinMaxHeap.isOnMinLevel = minMaxHeapIsOnMinLevel;
function minMaxHeapIsOnMinLevel(x) {
    x |= (x >> 1);
    x |= (x >> 2);
    x |= (x >> 4);
    x |= (x >> 8);
    x |= (x >> 16);
    x -= ((x >> 1) & 0x55555555);
    x = (((x >> 2) & 0x33333333) + (x & 0x33333333));
    x = (((x >> 4) + x) & 0X0F0F0F0F);
    x += (x >> 8);
    x += (x >> 16);
    return (x & 0x00000001) == 1;
}

MinMaxHeap.prototype.bubbleUpMin = minMaxHeapBubbleUpMin;
function minMaxHeapBubbleUpMin(i) {
    var grandParent = i >> 2;

    if (grandParent > 0 && this.compare(i, grandParent) < 0) {
        this.swap(i, grandParent);
        this.bubbleUpMin(grandParent);
    }
}

MinMaxHeap.prototype.bubbleUpMax = minMaxHeapBubbleUpMax;
function minMaxHeapBubbleUpMax(i) {
    var grandParent = i >> 2;

    if (grandParent > 0 && this.compare(i, grandParent) > 0) {
        this.swap(i, grandParent);
        this.bubbleUpMax(grandParent);
    }
}

MinMaxHeap.prototype.assignPos = minMaxHeapAssignPos;
function minMaxHeapAssignPos(pos, val) {
    this.heap[pos] = val;
}

MinMaxHeap.prototype.popLastPos = minMaxHeapPopLastPos;
function minMaxHeapPopLastPos() {
    return this.heap.pop();
}

MinMaxHeap.prototype.popMin = minMaxHeapPopMin;
function minMaxHeapPopMin() {
    if (this.heap.length > 2) {
        var min = this.heap[1];
        this.assignPos(1, this.popLastPos());
        this.trickleDownMin(1);
        return min;
    } else if (this.heap.length === 2) {
        return this.popLastPos();
    } else {
        return undefined;
    }
}

MinMaxHeap.prototype.popMax = minMaxHeapPopMax;
function minMaxHeapPopMax() {
    if (this.heap.length >= 4) {
        var maxIndex = this.getMaxIndex([2, 3]);
        if (this.heap.length === 4 && maxIndex === 3) {
            return this.popLastPos(); // avoid assigning it back to itself...
        } else {
            var max = this.heap[maxIndex];
            this.assignPos(maxIndex, this.popLastPos());
            this.trickleDownMax(maxIndex);
            return max;
        }
    } else if (this.heap.length >= 2) {
        return this.popLastPos();
    } else {
        return undefined;
    }
}

MinMaxHeap.prototype.trickleDown = minMaxHeapTrickleDown;
function minMaxHeapTrickleDown(i) {
    if (MinMaxHeap.isOnMinLevel(i)) {
        this.trickleDownMin(i);
    } else {
        this.trickleDownMax(i);
    }
}

MinMaxHeap.prototype.trickleDownMin = minMaxHeapTrickleDownMin;
function minMaxHeapTrickleDownMin(i) {
    var iParent = i >> 1;
    var iGrandParent = i >> 2;

    if (iGrandParent > 1 && this.compare(i, iGrandParent) < 0) {
        this.swap(i, iGrandParent);
        this.bubbleUpMin(iGrandParent);
        return;
    } else if (iParent > 1) {
        if (this.compare(i, iParent) > 0) {
            // console.log("TRICKLEDOWNMIN 1");
            this.swap(i, iParent);
            this.bubbleUpMax(iParent);
        }
    }
    while (2 * i < this.heap.length) { // i.e., i has children
        var m = this.getMinIndex([2*i, 2*i+1, 4*i, 4*i+1, 4*i+2, 4*i+3]);
        if (this.compare(m, i) >= 0) {
            break;
        }
        this.swap(m, i);
        if (m >= 4 * i) { // i.e., m is a grand child of i
            var mParent = m >> 1;
            if (this.compare(m, mParent) > 0) {
                this.swap(m, mParent);
            }
            i = m;
        } else {
            break;
        }
    }
}

MinMaxHeap.prototype.trickleDownMax = minMaxHeapTrickleDownMax;
function minMaxHeapTrickleDownMax(i) {
    var iParent = i >> 1;
    var iGrandParent = i >> 2;

    if (iGrandParent > 1 && this.compare(i, iGrandParent) > 0) {
        this.swap(i, iGrandParent);
        this.bubbleUpMax(iGrandParent);
        return;
    } else if (iParent > 1) {
        if (this.compare(i, iParent) < 0) {
            // console.log("TRICKLEDOWNMAX 2");
            this.swap(i, iParent);
            this.bubbleUpMin(iParent);
        }
    }
    while (2 * i < this.heap.length) { // i.e., i has children
        var m = this.getMaxIndex([2*i, 2*i+1, 4*i, 4*i+1, 4*i+2, 4*i+3]);
        if (this.compare(m, i) <= 0) {
            break;
        }
        this.swap(m, i);
        if (m >= 4 * i) { // i.e., m is a grand child of i
            var mParent = m >> 1;
            if (this.compare(m, mParent) < 0) {
                this.swap(m, mParent);
            }
            i = m;
        } else {
            break;
        }
    }
}

MinMaxHeap.prototype.getMinIndex = minMaxHeapGetMinIndex;
function minMaxHeapGetMinIndex(indexList) {
    var minIndex = indexList[0] < this.heap.length? indexList[0]: undefined;

    for (var i = 1; i !== indexList.length && indexList[i] < this.heap.length; i++) {
        if (this.compare(indexList[i], minIndex) < 0) {
            minIndex = indexList[i];
        }
    }
    return minIndex;
}

MinMaxHeap.prototype.getMaxIndex = minMaxHeapGetMaxIndex;
function minMaxHeapGetMaxIndex(indexList) {
    var maxIndex = indexList[0] < this.heap.length? indexList[0]: undefined;

    for (var i = 1; i !== indexList.length && indexList[i] < this.heap.length; i++) {
        if (this.compare(indexList[i], maxIndex) > 0) {
            maxIndex = indexList[i];
        }
    }
    return maxIndex;
}

MinMaxHeap.errorCount = 0;

MinMaxHeap.prototype.verify = minMaxHeapVerify;
function minMaxHeapVerify() {
    for (var i = 1; i !== this.heap.length; i++) {
        var parent = i >> 1;
        var grandParent = parent >> 1;
        if (MinMaxHeap.isOnMinLevel(i)) {
            if (parent > 0 && this.compare(i, parent) > 0) {
                console.log("error 1", i);
                MinMaxHeap.errorCount++;
            }
            if (grandParent > 0 && this.compare(i, grandParent) < 0) {
                console.log("error 2", i);
                MinMaxHeap.errorCount++;
            }
        } else {
            if (parent > 0 && this.compare(i, parent) < 0) {
                console.log("error 3", i);
                MinMaxHeap.errorCount++;
            }
            if (grandParent > 0 && this.compare(i, grandParent) > 0) {
                console.log("error 4", i);
                MinMaxHeap.errorCount++;
            }
        }
    }
}

/* Experimentation shows that method 1 (trickleDown from halfway the
   new heap) loses to method 2 (adding element by element) when the
   data is randomly organized. When the data is sorted ascending,
   method 1 wins when n is much smaller than m (approximately n <
   m/20). When the data is sorted descending, method 1 wins from
   method 2 when (approximately) n < 2m.

   With method 2, MinMaxHeap beats Symmetic-MinMaxHeap by a factor 2
   on random data. On data sorted ascending, it beats it almost by
   factor 4. Since there is no method 1 for the latter, we cannot
   compare that.
 */
MinMaxHeap.prototype.addArray = minMaxHeapAddArray;
function minMaxHeapAddArray(elts, forceMethod) {
    var n = this.heap.length, m = elts.length, i;

    if (forceMethod === 1 || (!forceMethod && n < m / 20)) {
        this.heap = this.heap.concat(elts);
        for (i = this.heap.length - 1; i >= 1; i--) {
            this.trickleDown(i);
        }
    } else {
        for (i = 0; i !== m; i++) {
            this.add(elts[i]);
        } 
    }
}

// Returns index of first undefined element in the heap
MinMaxHeap.prototype.getFirstElement = minMaxHeapGetFirstElement;
function minMaxHeapGetFirstElement() {
    return 1;
}

// Returns index of last undefined element in the heap
MinMaxHeap.prototype.getLastElement = minMaxHeapGetLastElement;
function minMaxHeapGetLastElement() {
    return this.heap.length - 1;
}

// Copies an array of sorted elements onto the heap; ascending is a boolean
// indicating the order in elts (true by default). Ignores undefined values.
MinMaxHeap.prototype.initWithSortedArray = minMaxHeapInitWithSortedArray;
function minMaxHeapInitWithSortedArray(elts, ascending, fronti, endi) {
    if(fronti === undefined)
        fronti = 0;
    if(endi === undefined)
        endi = elts.length - 1;
    var dest = 1;
    var minLevel = ascending || ascending === undefined;
    var levelSize = 1, levelEnd = 2;
    var elt;
    
    this.heap = [undefined];
    while (fronti <= endi) {
        if (minLevel) {
            elt = elts[fronti++];
            if (elt !== undefined) {
                this.assignPos(dest, elt);
            }
        } else {
            elt = elts[endi--];
            if (elt !== undefined) {
                this.assignPos(dest, elt);
            }
        }
        if (elt !== undefined) {
            dest++;
            if (dest === levelEnd) {
                minLevel = !minLevel;
                levelSize *= 2;
                levelEnd += levelSize;
            }
        }
    }
}

// This function only formats properly when all values are length strWidth...
MinMaxHeap.prototype.dump = sMMHeapDump;
function sMMHeapDump() {
    var nrBottom =
          Math.pow(2, Math.floor(Math.log(this.heap.length - 1) / Math.log(2)));
    var level = 0;
    var nrInLevel = 1;
    var levelCount = 0;
    var childWidth, sepString, levelString;
    var strWidth = 0;
    var strings = [];

    function stringmult(str, n) {
        if (n > 1) {
            var half = stringmult(str, n >> 1);
            return n % 2 === 0? half + half: half + half + str;
        } else {
            return n === 1? str: "";
        }
    }
    function pad(str) {
        var r = strWidth - str.length;
        return stringmult(" ", r >> 1) + str + stringmult(" ", (r + 1) >> 1);
    }

    for (var i = 1; i !== this.heap.length; i++) {
        if ("dataElementId" in this.heap[i]) {
            strings[i] = this.heap[i].sortValues === undefined? this.heap[i].dataElementId:
                  this.heap[i].dataElementId + ":" + this.heap[i].sortValues.map(function(e){return e.value;}).toString();
        } else {
            strings[i] = JSON.stringify(this.heap[i]);
        }
        if (strings[i].length > strWidth) {
            strWidth = strings[i].length;
        }
    }
    childWidth = nrBottom * (strWidth + 1) - 1;
    levelString = stringmult(" ", Math.floor(childWidth / 2));
    for (i = 1; i !== this.heap.length; i++) {
        levelString += pad(strings[i]);
        levelCount++;
        if (levelCount === nrInLevel || i === this.heap.length - 1) {
            console.log(levelString);
            level++;
            nrInLevel *= 2;
            levelCount = 0;
            childWidth = Math.floor(childWidth / 2) - 1;
            sepString = stringmult(" ", childWidth - 1);
            levelString = stringmult(" ", Math.floor(childWidth / 2));
        } else {
            levelString += sepString;
        }
    }
}

MinMaxHeap.prototype.dumpHorizontal = minMaxHeapDumpHorizontal;
function minMaxHeapDumpHorizontal(incr, i, indent) {
    if (incr === undefined) incr = "    ";
    if (i === undefined) i = 1;
    if (indent === undefined) indent = "";
    var str = i >= this.heap.length? undefined:
          "dataElementId" in this.heap[i]?
          (this.heap[i].sortValues === undefined? this.heap[i].dataElementId:
           this.heap[i].dataElementId + ":" + this.heap[i].sortValues.map(function(e){return e.value;}).toString()):
          JSON.stringify(this.heap[i]);
    return i >= this.heap.length? "":
          this.dumpHorizontal(incr, 2 * i + 1, indent + incr) +
          indent + str + " [" + i + (MinMaxHeap.isOnMinLevel(i)? ",min]": ",max]") + "\n" +
          this.dumpHorizontal(incr, 2 * i, indent + incr);
}
