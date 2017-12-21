declare class SortedHeap<T> {

SortedHeap.prototype.updateMinPos = sortedHeapUpdateMinPos;
    constructor(comparator: (a: T, b: T) => number);

    setComparatorInfo(info: any): void;

    getComparatorInfo(): any;

    clear(): void;

    isEmpty(): boolean;

    getSize(): number;

    getMin(): T;

    getMax(): T;

    // Adds a single element to the heap
    add(elt: T): void;

    removePos(index: number): void;

    popMin(): T;

    popMax(): T;

    static errorCount: number;

    verify(): void;

    addArray(elts: T[]): void;

    // Returns index of first undefined element in the heap
    getFirstElement(): number;

    // Returns index of last undefined element in the heap
    getLastElement(): number;

    initWithSortedArray(elts: T[], ascending: boolean): void;
}
