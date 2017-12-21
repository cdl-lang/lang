interface HeapInterface<T> {
}

declare class MinMaxHeap<T> implements HeapInterface<T> {
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

    addArray(elts: T[], forceMethod: number): void;

    // Returns index of first undefined element in the heap
    getFirstElement(): number;

    // Returns index of last undefined element in the heap
    getLastElement(): number;

    // Copies an array of sorted elements onto the heap; ascending is a boolean
    // indicating the order in elts (true by default). Ignores undefined values.
    initWithSortedArray(elts: T[], ascending: boolean): void;

    dump(): void;

    dumpHorizontal(incr: string = "    ", i: number = 1, indent: string = ""): string;
}
