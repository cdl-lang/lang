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
        disp: {
            description: {
                context: {
                    "^writable": {
                        a: 1,
                        b: 2
                    }
                },
                display: {
                    background: "#eeeeee",
                    text: {
                        value: [debugNodeToStr, [{writable: _}, [me]], false]
                    }
                },
                write: {
                    onClick: {
                        upon: [{ subType: "Click" }, [myMessage]],
                        "true": {
                            doWrite: {
                                to: [{ writable: {a: _ }}, [me]],
                                merge: [plus,
                                        [{ writable: {a: _ }}, [me]],
                                        1]
                            }
                        }
                    }
                },
                position: {
                    top: 10,
                    left: 10,
                    height: 100,
                    width: 500
                }
            }
        }
    }
};
