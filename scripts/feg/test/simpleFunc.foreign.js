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

// A simple implementation of the foreign interface
// It calls back with squares of the numbers in the argument after 5 seconds.
// If the input does not contain only numbers, the result is o() and the status
// is set to "error".
// Note that it clears the timeout when execute() is called before the result
// has been published.

class SimpleFunc extends ForeignInterface {
    constructor() {
        super();
        this.timeoutid = undefined;
    }

    execute(cb) {
        var self = this;

        if (this.timeoutid !== undefined) {
            clearTimeout(this.timeoutid);
        }
        if (this.arguments === undefined || this.arguments[0] === undefined ||
              this.arguments[0].value === undefined ||
              this.arguments[0].some(x => typeof(x) !== "number")) {
            cb("error", []);
        } else {
            var res = this.arguments[0].value.map(x => x * x);
            this.timeoutid = setTimeout(function() {
                self.timeoutid = undefined;
                cb("remote", res);
            }, 5000);
        }
    }
}

addForeignInterface({test: wrapForeignInterface(SimpleFunc)});
