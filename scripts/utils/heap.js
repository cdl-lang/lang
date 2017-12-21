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

/* Class invariant
   parentIndex = i, childIndex = 2 * i + 1, 2 * i + 2
   childIndex = i, parentIndex = (i - 1) >> 1
   this.compare(heap[parentIndex], heap[childIndex]) < 0
*/

function Heap(comparator) {
    this.compare = comparator;
    this.heap = [];
}

Heap.prototype.addSingle = heapAddSingle;
function heapAddSingle(elt) {
    this.heap.push(elt);
    this.bubbleUp(this.heap.length - 1);
}

Heap.prototype.addMulti = heapAddMulti;
function heapAddMulti(elts) {
    this.heap = this.heap.concat(elts);
    for (var i = (this.heap.length + 1) << 1 - 1; i >= 0; i--) {
        this.maxHeapify(i);
    }
}

Heap.prototype.pop = heapPop;
function heapPop() {
    var min;

    if (this.heap.length > 1) {
        min = this.heap[0];
        this.heap[0] = this.heap.pop();
        this.maxHeapify(0);
    } else {
        min = this.heap.pop();
    }
    return min;
}

Heap.prototype.peek = heapPeek;
function heapPeek() {
    return this.heap[0];
}

Heap.prototype.bubbleUp = heapBubbleUp;
function heapBubbleUp(childIndex) {
    var parentIndex = (childIndex - 1) >> 1;

    while (childIndex > 0 &&
           this.compare(this.heap[parentIndex], this.heap[childIndex]) > 0) {
        var tmp = this.heap[parentIndex];
        this.heap[parentIndex] = this.heap[childIndex];
        this.heap[childIndex] = tmp;
        childIndex = parentIndex;
        parentIndex = (childIndex - 1) >> 1;
    }
}

Heap.prototype.maxHeapify = heapMaxHeapify;
function heapMaxHeapify(i) {
    var left, right, tmp;
    var smallest = i;

    for (;;) {
        left = 2 * i + 1;
        right = left + 1;
        if (left < this.heap.length && this.compare(this.heap[left], this.heap[smallest]) < 0) {
            smallest = left;
        }
        if (right < this.heap.length && this.compare(this.heap[right], this.heap[smallest]) < 0) {
            smallest = right;
        }
        if (smallest === i) {
            break;
        }
        tmp = this.heap[i];
        this.heap[i] = this.heap[smallest];
        this.heap[smallest] = tmp;
        i = smallest;
    }
}

Heap.prototype.isEmpty = heapIsEmpty;
function heapIsEmpty() {
    return this.heap.length === 0;
}

Heap.prototype.getSize = heapGetSize;
function heapGetSize() {
    return this.heap.length;
}

