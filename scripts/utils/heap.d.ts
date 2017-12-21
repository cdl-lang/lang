declare class Heap<T> {

    constructor(comparator: (a: T, b: T) => number);

    // Adds a single element to the heap
    addSingle(elt: T): void;

    // Adds multiple elements to the heap
    addMulti(elts: T[]): void;

    // Clears the heap
    clear(): void;
    
    // True iff there are no elements on the heap
    isEmpty(): boolean;

    // Number of elements on the heap
    getSize(): number;

    // Returns the smallest element and remove it
    pop(): T;

    // Returns the smallest element
    peek(): T;
}
