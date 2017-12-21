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
    e1: {
        display: {
            background: "yellow",
            text: {
                value: [size, [embedded, [me]]],
                verticalAlign: "top"
            }
        },
        position: {
            left: [plus,
                   [mul, 60,
                    [{ param: { areaSetContent: _ } }, [me]]
                   ],
                   10
                  ],
            top: 60,
            width: 40,
            height: 2680
        },
        content: [sequence, r(0, [arg, "slength", 1])],
        children: {
            row: {
                data: [{ content: _ }, [me]],
                description: {
                    "class": "e2"
                }
            }
        }
    },
    e2: o(
        {
            qualifier: {
                sense: false
            },
            variant: {
                display: {
                    background: "red"
                }
            }
        },
        {
            qualifier: {
                sense: true
            },
            variant: {
                display: {
                    background: "green"
                }
            }
        },
        {
            variant: {
                context: {
                    sense: true
                },
                display: {
                    text: {
                        value: [
                                { param: { areaSetContent: _ } }, [me]]
                    }
                },
                position: {
                    top: [plus,
                          [mul, 60,
                           [{ param: { areaSetContent: _ } }, [me]]
                          ],
                          10
                         ],
                    left: 10,
                    width: 20,
                    height: 20
                }/*,
                write: {
                    onClick: {
                        upon: [{ subType: "Click" }, [myMessage]],
                        "true": {
                            switchBG: {
                                to: [{ sense: _ }, [me]],
                                merge: [not,
                                        [{ sense: _ }, [me]]]
                            }
                        }
                    }
                }*/
            }
        }
    )
};

var screenArea = {
    display: {
        background: "#cccccc",
        text: {
            //value: [size, [embeddedStar, [me]]],
            verticalAlign: "top",
            textAlign: "left"
        }
    },
    position: {
        // inset 10 points on each side
        leftFromParent: {
            point1: {
                element: [embedding, [me]],
                type: "left"
            },
            point2: {
                element: [me],
                type: "left"
            },
            equals: 10
        },
        topFromParent: {
            point1: {
                element: [embedding, [me]],
                type: "top"
            },
            point2: {
                element: [me],
                type: "top"
            },
            equals: 10
        },
        rightFromParent: {
            point1: {
                element: [me],
                type: "right"
            },
            point2: {
                element: [embedding, [me]],
                type: "right"
            },
            equals: 10
        },
        bottomFromParent: {
            point1: {
                element: [me],
                type: "bottom"
            },
            point2: {
                element: [embedding, [me]],
                type: "bottom"
            },
            equals: 10
        }
    },
    content: [sequence, r(0, [arg, "slength", 1])],
    children: {
        column: {
            data: [{ content: _ }, [me]],
            description: {
                "class": "e1"
            }
        }
    }
};
