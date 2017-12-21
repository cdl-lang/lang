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

/// <reference path="../feg/globals.ts" />

var gRemoteDebug: number = 0;

class RemotingLog {

    static shouldLog(severity: number): boolean {
        return gRemoteDebug >= severity;
    }
    
    public static log(severity: number, msg: (() => string) | string) {
        if (RemotingLog.shouldLog(severity)) {
            var dt = new Date().toString() + ":";
            if (typeof(msg) === "function") {
                console.log(dt, msg());
            } else {
                console.log(dt, msg);
            }
        }
    }
}
