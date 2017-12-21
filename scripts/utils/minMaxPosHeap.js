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

// Subclass of MinMaxHeap that keeps a reverse index on the elements
// This is somewhat slower than minMaxHeap (about x2) and takes more
// memory.
// Upon construction, one should provide a string "indexKey" which is
// the name of the attribute in the element objects added to the heap
// such that the value under this attribute uniquely identifies the
// elements. If "indexKey" is undefined, the elements added should
// be simple values (numbers or strings) and no too should be equal
// (so that the element value itself is a unique ID for the element).

// %%include%%: "minMaxHeap.js"

inherit(MinMaxPosHeap, MinMaxHeap);
function MinMaxPosHeap(comparator, indexKey) {
    this.MinMaxHeap(comparator);
    this.indexKey = indexKey;
    this.reverseIndex = new Map();
}

MinMaxPosHeap.prototype.clear = minMaxPosHeapClear;
function minMaxPosHeapClear() {
    this.MinMaxHeap_clear();
    this.reverseIndex = new Map();
}

MinMaxPosHeap.prototype.swap = minMaxPosHeapSwap;
function minMaxPosHeapSwap(n1, n2) {
    var n1Key;
    var n2Key;

    if(this.indexKey !== undefined) {
        n1Key = this.heap[n1][this.indexKey];
        n2Key = this.heap[n2][this.indexKey];
    } else {
        n1Key = this.heap[n1];
        n2Key = this.heap[n2];
    }
        
    var tmp = this.heap[n1];

    this.heap[n1] = this.heap[n2];
    this.heap[n2] = tmp;
    this.reverseIndex.set(n1Key, n2);
    this.reverseIndex.set(n2Key, n1);
}

MinMaxPosHeap.prototype.assignPos = minMaxPosHeapAssignPos;
function minMaxPosHeapAssignPos(pos, val) {
    var previousValue;

    if(pos < this.heap.length)
        previousValue = this.heap[pos];

    if(this.indexKey !== undefined) {
        if (previousValue !== undefined)
            this.reverseIndex.delete(previousValue[this.indexKey]);
        this.reverseIndex.set(val[this.indexKey], pos);
    } else {
        if (previousValue !== undefined)
            this.reverseIndex.delete(previousValue);
        this.reverseIndex.set(val, pos);
    }
    this.heap[pos] = val;
}

MinMaxPosHeap.prototype.popLastPos = minMaxPosHeapPopLastPos;
function minMaxPosHeapPopLastPos() {
    if(this.indexKey !== undefined)
        this.reverseIndex.delete(this.heap[this.heap.length-1][this.indexKey]);
    else
        this.reverseIndex.delete(this.heap[this.heap.length - 1]);
    return this.heap.pop();
}

MinMaxPosHeap.prototype.addArray = minMaxPosHeapAddArray;
function minMaxPosHeapAddArray(elts, forceMethod) {
    if(this.indexKey !== undefined)
        for (var i = 0; i !== elts.length; i++) {
            this.reverseIndex.set(elts[i][this.indexKey], this.heap.length + i);
        }
    else
        for (var i = 0; i !== elts.length; i++) {
            this.reverseIndex.set(elts[i], this.heap.length + i);
        }
    this.MinMaxHeap_addArray(elts, forceMethod);
}

MinMaxPosHeap.prototype.getIndex = minMaxPosHeapGetIndex;
function minMaxPosHeapGetIndex(index) {
    return this.heap[this.reverseIndex.get(index)];
}

MinMaxPosHeap.prototype.removeIndex = minMaxPosHeapRemoveIndex;
function minMaxPosHeapRemoveIndex(index) {
    this.removePos(this.reverseIndex.get(index));
}

MinMaxPosHeap.prototype.getPositionInHeap = minMaxPosHeapGetPositionInHeap;
function minMaxPosHeapGetPositionInHeap(index) {
    return this.reverseIndex.get(index) - 1;
}

MinMaxPosHeap.prototype.initWithSortedArray = minMaxPosHeapInitWithSortedArray;
function minMaxPosHeapInitWithSortedArray(elts, ascending, fronti, endi) {
    this.MinMaxHeap_initWithSortedArray(elts, ascending, fronti, endi);
    this.reverseIndex = new Map();
    if(this.indexKey !== undefined)
        for (var i = 1; i !== this.heap.length; i++) {
            this.reverseIndex.set(this.heap[i][this.indexKey], i);
        }
    else
        for (var i = 1; i !== this.heap.length; i++) {
            this.reverseIndex.set(this.heap[i], i);
        }
}

MinMaxPosHeap.prototype.inHeap = minMaxPosHeapInHeap;
function minMaxPosHeapInHeap(index) {
    return this.reverseIndex.has(index);
}

MinMaxPosHeap.prototype.update = minMaxPosHeapUpdate;
function minMaxPosHeapUpdate(element) {
    
    var pos;

    if(this.indexKey !== undefined)
        pos = this.reverseIndex.get(element[this.indexKey]);
    else
        pos = this.reverseIndex.get(element);

    this.removePos(pos);
    this.add(element);
}

MinMaxPosHeap.prototype.verify = minMaxPosHeapVerify;
function minMaxPosHeapVerify() {
    this.MinMaxHeap_verify();
    var _self = this;
    this.reverseIndex.forEach(function(pos, val) {
        if (!(pos in _self.heap)) {
            console.log("error !in");
            MinMaxHeap.errorCount++;
        } else if(_self.indexKey !== undefined) {
            if (_self.heap[pos][_self.indexKey] != val) {
                console.log("error !==");
                MinMaxHeap.errorCount++;
            }
        } else {
            if (_self.heap[pos] != val) {
                console.log("error !==");
                MinMaxHeap.errorCount++;
            }
        }
    });
}
