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
    context: {
        "^x": 0,
        "^y": 0,
        "^count": 0
    },
    display: {
        background: "white"
    },
    children: {
        name: {
            description: {
                display: {
                    background: [cond, [mod, [{count: _}, [embedding]], 2],
                                 o({on: 1, use: "#ffff00"},
                                   {on: 0, use: "#0000ff"})],
                    transform: {
                        rotate: [cond, [mod, [{count: _}, [embedding]], 2],
                                o({on: 0, use: 0}, {on: 1, use: 45})],
                    },
                    transitions: {
                        top: 1,
                        left: 1,
                        width: 1,
                        height: 1,
                        background: {
                            duration: 2,
                            timingFunction: "linear"
                        },
                        transform: 1
                    }
                },
                position: {
                    top: [{y: _}, [embedding]],
                    left: [{x: _}, [embedding]],
                    height: 50,
                    width: 50
                }
            }
        }
    },
    write: {
        on: {
            upon: [{ subType: "Click" }, [myMessage]],
            true: {
                setX: {
                    to: [{ x:_ }, [me]],
                    merge: [{absX: _}, [myMessage]]
                },
                setY: {
                    to: [{ y:_ }, [me]],
                    merge: [{absY: _}, [myMessage]]
                },
                incr: {
                    to: [{ count:_ }, [me]],
                    merge: [plus, [{count: _}, [me]], 1]
                },
                db: {
                    to: [debugBreak],
                    merge: true
                }
            }
        }
    }
};
