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

/* Heap API on an array under the assumption it is sorted and all operations
   maintain it that way. Providing the comparator is only needed when calling
   functions such as verify() or staysSorted().

   Conversion to a min-max heap:
   var h = new MinMaxHeap(this.comparator);
   h.initWithSortedArray(this.heap);

   Class invariants:
   - this.minIndex <= this.heap.length
   - this.heap[0 .. this.minIndex - 1] = undefined
   - this.heap[i] < this.heap[i + k] (for k > 0, unless undefined)
   - this.minIndex == this.heap.length => this.heap.length === 0
*/

function SortedHeap(comparator) {
    this.heap = [];
    this.minIndex = 0;
    this.comparator = comparator;
}

SortedHeap.prototype.isSorted = true;

SortedHeap.prototype.setComparatorInfo = sortedHeapSetComparatorInfo;
function sortedHeapSetComparatorInfo(info) {
    this.comparatorInfo = info;
}

SortedHeap.prototype.getComparatorInfo = sortedHeapGetComparatorInfo;
function sortedHeapGetComparatorInfo() {
    return this.comparatorInfo;
}

SortedHeap.prototype.clear = sortedHeapClear;
function sortedHeapClear() {
    this.heap = [];
    this.minIndex = 0;
}

SortedHeap.prototype.isEmpty = sortedHeapIsEmpty;
function sortedHeapIsEmpty() {
    return this.minIndex === this.heap.length;
}

SortedHeap.prototype.getSize = sortedHeapGetSize;
function sortedHeapGetSize() {
    return this.heap.length - this.minIndex;
}

SortedHeap.prototype.getMin = sortedHeapGetMin;
function sortedHeapGetMin() {
    return this.heap[this.minIndex];
}

SortedHeap.prototype.getMax = sortedHeapGetMax;
function sortedHeapGetMax() {
    return this.heap[this.heap.length - 1];
}

// We assume that elt >= last element in heap
SortedHeap.prototype.add = sortedHeapAdd;
function sortedHeapAdd(elt) {
    this.heap.push(elt);
}

SortedHeap.prototype.removePos = sortedHeapRemovePos;
function sortedHeapRemovePos(index) {
    this.heap[index] = undefined;
    while (this.heap.length > 0 &&
           this.heap[this.heap.length - 1] === undefined) {
        this.heap.pop();
    }
    this.updateMinPos();
}

SortedHeap.prototype.updateMinPos = sortedHeapUpdateMinPos;
function sortedHeapUpdateMinPos() {
    while (this.minIndex < this.heap.length &&
           this.heap[this.minIndex] === undefined) {
        this.minIndex++;
    }
    if (this.minIndex >= this.heap.length) {
        this.clear();
    }
}

SortedHeap.prototype.popLastPos = sortedHeapPopLastPos;
function sortedHeapPopLastPos() {
    var max = this.heap.pop();

    if (this.minIndex === this.heap.length) {
        this.clear();
    }
    return max;
}

SortedHeap.prototype.popMin = sortedHeapPopMin;
function sortedHeapPopMin() {
    if (this.minIndex < this.heap.length) {
        var min = this.heap[this.minIndex];
        this.removePos(this.minIndex);
        return min;
    } else {
        return undefined;
    }
}

SortedHeap.prototype.popMax = sortedHeapPopMax;
function sortedHeapPopMax() {
    return this.isEmpty()? undefined: this.popLastPos();
}

SortedHeap.prototype.addArray = sortedHeapAddArray;
function sortedHeapAddArray(elts) {
    this.heap = this.heap.concat(elts);
}

SortedHeap.prototype.getFirstElement = sortedHeapGetFirstElement;
function sortedHeapGetFirstElement() {
    return this.minIndex;
}

SortedHeap.prototype.getLastElement = sortedHeapGetLastElement;
function sortedHeapGetLastElement() {
    return this.heap.length - 1;
}

SortedHeap.prototype.initWithSortedArray = sortedHeapInitWithSortedArray;
function sortedHeapInitWithSortedArray(elts, ascending) {
    this.clear();
    if (ascending || ascending === undefined) {
        this.addArray(elts);
    } else {
        for (var i = elts.length - 1; i >= 0; i--) {
            this.add(elts[i]);
        }
    }
}

SortedHeap.errorCount = 0;

SortedHeap.prototype.verify = sortedHeapVerify;
function sortedHeapVerify() {
    var prevValue;

    for (var i = 0; i !== this.heap.length; i++) {
        var value = this.heap[i];
        if (value !== undefined) {
            if (i < this.minIndex) {
                if (value !== undefined) {
                    console.log("error minIndex", i);
                    SortedHeap.errorCount++;
                }
            } else {
                if (prevValue !== undefined &&
                    this.comparator(prevValue, value, this.comparatorInfo) > 0) {
                    console.log("error compare", i);
                    SortedHeap.errorCount++;
                }
            }
        }
        prevValue = value;
    }
}
