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

var classes = {
    Test: o({
        display: {
            background: "white"
        }
    },{
        qualifier: {x: true},
        variant: {
            display: {
                text: {
                    value: "true"
                }
            }
        }
    }, {
        qualifier: {x: false},
        variant: {
            display: {
                text: {
                    value: "false"
                }
            }
        }
    }, {
        variant: {
            display: {
                text: {
                    value: "undefined"
                }
            }
        }
    })
};

var screenArea = {
    context: {
        w: o(),
        y: true,
        z: false
    },
    display: {
        background: "#bbbbbb"
    },
    children: {
        undefChild: {
            description: {
                "class": "Test",
                context: {
                    x: [{x: _}, [embedding]]
                },
                position: {
                    top: 10,
                    left: 10,
                    height: 20,
                    width: 80
                }
            }
        },
        trueChild: {
            description: {
                "class": "Test",
                context: {
                    x: [{y: _}, [embedding]]
                },
                position: {
                    top: 40,
                    left: 10,
                    height: 20,
                    width: 80
                }
            }
        },
        falseChild: {
            description: {
                "class": "Test",
                context: {
                    x: [{z: _}, [embedding]]
                },
                position: {
                    top: 70,
                    left: 10,
                    height: 20,
                    width: 80
                }
            }
        },
        emptyOSChild: {
            description: {
                "class": "Test",
                context: {
                    x: [{w: _}, [embedding]]
                },
                position: {
                    top: 100,
                    left: 10,
                    height: 20,
                    width: 80
                }
            }
        }
    }
};
