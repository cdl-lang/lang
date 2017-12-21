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

// %%classfile%%: "generalClasses.js"
// %%foreign%%: "simpleFunc.foreign.js"

var screenArea = {
    context: {
        "^inputValue": 1,
        func: [{test: _}, [foreignFunctions]],
        outputValue: [
            [{func: _}, [me]],
            [{inputValue: _}, [me]]
        ]
    },
    children: {
        input: {
            description: {
                "class": "LabeledTextValueInput",
                context: {
                    label: "input",
                    value: [{inputValue: _}, [embedding]],
                    validFun: true,
                    editable: true,
                    type: "text"
                },
                position: {
                    top: 10,
                    left: 10,
                    height: 20,
                    width: 300
                }
            }
        },
        output: {
            description: {
                "class": "LabeledTextValue",
                context: {
                    label: "output",
                    value: [{outputValue: _}, [embedding]]
                },
                position: {
                    top: 40,
                    left: 10,
                    height: 20,
                    width: 300
                }
            }
        },
        outputStatus: {
            description: {
                display: {
                    borderRadius: 10,
                    background: [
                        cond, [{state: _}, [remoteStatus, [{outputValue: _}, [embedding]]]], o(
                            { on: "remote", use: "green" },
                            { on: "waiting", use: "blue" },
                            { on: "error", use: "red" },
                            { on: null, use: "grey" }
                        )
                    ]
                },
                position: {
                    top: 40,
                    left: 310,
                    height: 20,
                    width: 20
                }
            }
        }
    }
};
