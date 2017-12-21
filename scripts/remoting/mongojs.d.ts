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

declare class Cursor {
    toArray(callback: (err: Error, result: Array<any>) => void): void;
}

declare class MongoDB {
    _some_mongodb_construction_: any;

    collection(collectionName: string): MongoDBCollectionHandle;
    close(): void;
    getCollectionNames(cb: (err: any, docs: any) => void): void;
}

declare class MongoDBBulkOperation {
    insert(doc: any): void;
    execute(callback: (err: Error, result: any) => void): void;
}

declare class MongoDBCollectionHandle {
    _some_mongodb_construction_: any;
    update(queryTerm: any, replacement: any, options: any, cb: (err: Error, result: any) => void): void;

    find(callback?: (err: Error, result: Cursor) => void): Cursor;
    find(selector: Object, callback?: (err: Error, result: Cursor) => void): Cursor;
    find(selector: Object, projection: Object, callback?: (err: Error, result: Cursor) => void): Cursor;
    findOne(callback?: (err: Error, result: any) => void): Cursor;
    findOne(selector: Object, callback?: (err: Error, result: any) => void): Cursor;
    drop(callback?: (err: Error, result: any) => void): void;
    insert(query: any, callback?: (err: Error, result: any) => void): void;
    insert(query: any, options: { safe?: any; continueOnError?: boolean; keepGoing?: boolean; serializeFunctions?: boolean; }, callback?: (err: Error, result: any) => void): void;
    remove(selector: Object, callback?: (err: Error, result: any) => void): void;
    remove(selector: Object, options: { safe?: any; single?: boolean; }, callback?: (err: Error, result: any) => void): void;
    initializeOrderedBulkOp(): MongoDBBulkOperation;
}

declare var mongojs: (connectionString: string) => MongoDB;
