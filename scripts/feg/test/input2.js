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

var screenArea = {
    display: {
        background: "#bbbbbb"
    },
    children: {
        inputelement1: {
            description: {
                context: {
                    value: [{param: {input: {value: _}}}, [me]],
                    focus: [{param: {input: {focus: _}}}, [me]]
                },
                display: {
                    text: {
                        fontSize: 18,
                        input: {
                            type: "number"
                        }
                    }
                },
                position: {
                    top: 10,
                    left: 10,
                    height: 30,
                    width: 80
                }
            }
        },
        showinput1: {
            description: {
                display: {
                    background: [cond, [{children: {inputelement1: {focus: _}}}, [embedding]],
                                 o({on: true, use: "red"})],
                    text: {
                        value: [{children: {inputelement1: {value: _}}},
                                [embedding]]
                    }
                },
                position: {
                    top: 60,
                    left: 10,
                    height: 30,
                    width: 80
                }
            }
        },
        inputelement2: {
            description: {
                context: {
                    value: [{param: {input: {value: _}}}, [me]],
                    focus: [{param: {input: {focus: _}}}, [me]]
                },
                display: {
                    text: {
                        value: "",
                        input: {
                            type: "text",
                            min: 5,
                            max: 10,
                            placeholder: "type here"
                        }
                    }
                },
                position: {
                    top: 10,
                    left: 120,
                    height: 30,
                    width: 80
                }
            }
        },
        showinput2: {
            description: {
                display: {
                    background: [cond, [{children: {inputelement2: {focus: _}}}, [embedding]],
                                 o({on: true, use: "red"})],
                    text: {
                        value: [{children: {inputelement2: {value: _}}},
                                [embedding]]
                    }
                },
                position: {
                    top: 60,
                    left: 120,
                    height: 30,
                    width: 80
                }
            }
        }
    }
};
