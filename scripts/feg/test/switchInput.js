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
    SwitchInput: o({
        qualifier: "!",
        variant: {
            context: {
                "^edit": false,
                "^text": "xxx"
            },
            display: {
                text: {
                    value: [{text: _}, [me]]
                }
            }
        }
    }, {
        qualifier: {edit: false},
        variant: {
            display: {
                background: "#bbbbbb",
            },
            write: {
                onClick: {
                    upon: [{ subType: "Click" }, [myMessage]],
                    "true": {
                        beginEdit: {
                            to: [{ edit:_ }, [me]],
                            merge: true
                        }
                    }
                }
            }
        }
    }, {
        qualifier: {edit: true},
        variant: {
            display: {
                background: "#dddddd",
                text: {
                    input: {
                        type: "text",
                        placeholder: "text here",
                        init: {
                            selectionStart: 0,
                            selectionEnd: 3,
                            focus: true
                        }
                    }
                }
            },
            write: {
                onEnter: {
                    upon: [{type: "KeyDown", key: "Return"}, [myMessage]],
                    "true": {
                        updateText: {
                            to: [{ text:_ }, [me]],
                            merge: [{param: {input: {value: _}}}, [me]]
                        },
                        endEdit: {
                            to: [{ edit:_ }, [me]],
                            merge: false
                        }
                    }
                }
            }
        }
    })
};

var screenArea = {
    display: {
        background: "#bbbbbb"
    },
    children: {
        input1: {
            description: {
                "class": "SwitchInput",
                context: {
                },
                position: {
                    top: 10,
                    left: 10,
                    height: 30,
                    width: 100
                }
            }
        },
        input2: {
            description: {
                "class": "SwitchInput",
                context: {
                    "^text": "2"
                },
                position: {
                    top: 50,
                    left: 10,
                    height: 30,
                    width: 100
                }
            }
        }
    }
};
