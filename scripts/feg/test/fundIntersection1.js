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

//
// %%datafile%%: <MSFund50.js>
// 

var rowHeight = 32;

var classes = {

    ///////////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////
    Draggable: o(
        { // variant-controller
            qualifier: "!", 
            variant: {
                context: { 
                    verticallyDraggable: true,
                    horizontallyDraggable: true                
                }
            }
        },
        {
            qualifier: {
                selected: false,
                verticallyDraggable: true
            },
            variant: {
                write: {
                    onMouseDown: {
                        upon: [{ type: "MouseDown" }, [myMessage]],
                        "true": {
                            writeY: {
                                to: [{mouseDownY: _ }, [me]],
                                merge: [minus,
                                        [{absY:_}, [myMessage]],
                                        [{y: _}, [coordinates, [me]]]]
                            }
                        }
                    }
                }
            }
        }, 
        {
            qualifier: {
                selected: false,
                horizontallyDraggable: true
            },
            variant: {
                write: {
                    onMouseDown: {
                        upon: [{ type: "MouseDown" }, [myMessage]],
                        "true": {
                            writeX: {
                                to: [{mouseDownX: _ }, [me]],
                                merge: [minus,
                                        [{absX:_}, [myMessage]],
                                        [{x: _}, [coordinates, [me]]]]
                            }
                        }
                    }
                }
            }
        }, 
        {
            qualifier: {
                selected: true,
                verticallyDraggable: true
            },
            variant: {
                position: {
                    topDrag: {
                        point1: { type: "top" },
                        point2: { type: "top", element: [pointer] },
                        equals: [
                            { mouseDownY: _ },
                            [me]
                        ],
                        priority: [
                            { draggingPriority: _ },
                            [me]
                        ]
                    }
                }
            }
        }, 
        {
            qualifier: {
                selected: true,
                horizontallyDraggable: true
            },
            variant: {
                position: {
                    leftDrag: {
                        point1: { type: "left" },
                        point2: { type: "left", element: [pointer] },
                        equals: [
                            { mouseDownX: _ },
                            [me]
                        ],
                        priority: [
                            { draggingPriority: _ },
                            [me]
                        ]
                    }
                }
            }
        }, 
        {    
            "class": "Clickable",
            context: {
                draggable: true,
                draggingPriority: 1,
                
                "^mouseDownX": 0,
                "^mouseDownY": 0
            },
            display: {
                text: {
                    value: [debugNodeToStr, [me]],
                    textAlign: "left",
                    verticalAlign: "top"
                }
            }
        }
    ),

    ////////////////////////////////////////////////////////////////////
    // A area class that raises the 'selected' context label for the
    //  duration of the mouse being held down. By default, this class
    //  does not propagate the MouseDown/MouseUp messages - inheriting
    //  classes may override this value.
    ////////////////////////////////////////////////////////////////////
    Clickable: o(
        {
            qualifier: { selected: false },
            variant: {
                write: {
                    onMouseDown: {
                        upon: [{ type: "MouseDown" }, [myMessage]],
                        "true": {
                            selected: {
                                to: [{selected: _ }, [me]],
                                merge: true
                            }
                        }
                    }
                }
            }
        },
        {
            qualifier: { selected: true },
            variant: {
                write: {
                    onMouseUp: {
                        upon: [{ type: "MouseUp" }, [message]],
                        "true": {
                            selected: {
                                to: [{selected: _ }, [me]],
                                merge: false
                            }
                        }
                    }
                }
            }
        }, 
        {
            context: {
                "^selected": false
            }
        }
    ),


    db: {
        position: {
            firstChild: {
                point1: { type: "top" },
                point2: { type: "top", element: [first, [{children: {rows: _}}, [me]]]  },
                equals: 2
            }
        },
        children: {
            rows: {
                data: [{content: _}, [me]],
                description: {
                    "class": "row"
                }
            }
        }
    },
    row: o(
        {
            qualifier: { odd: true },
            variant: {
                display: {
                    background: "#aaaaaa"
                }
            }
        },
        {
            qualifier: { odd: false },
            variant: {
                display: {
                    background: "#777777"
                }
            }
        },
        {
            context: {
                nr: [{param: {areaSetAttr: _}}, [me]],
                odd: [not, [{odd: _}, [prev, [me]]]],
                row: true
            },
            content: [{param: {areaSetContent: _}}, [me]],
            position: {
                left: 5,
                right: 5,
                height: rowHeight,
                top: {
                    point1: { type: "bottom", element: [prev, [me]] },
                    point2: { type: "top", element: [me] },
                    equals: 5
                }
            },
            children: {
                index: {
                    description: {
                        display: {
                            text: {
                                value: [
                                    {nr: _},
                                    [embedding, [me]]
                                ]
                            }
                        },
                        position: {
                            left: 1,
                            top: 1,
                            bottom: 1,
                            width: 20
                        }
                    }
                }
            }
        }
    ),
    intersectionCell: {
        display: {
            background: "#bbbbbb"
        },
        independentContentPosition: true,
        content: [
                  [{content: _}, [expressionOf, [me]]],
                  [{content: _}, [referredOf, [me]]]],
        position: {
            leftFConstraint: {
                point1: { intersection: true, type: "left" },
                point2: { type: "left" },
                equals: 2
            },
            rightFConstraint: {
                point1: { type: "right" },
                point2: { intersection: true, type: "right" },
                equals: 2
            },
            topFConstraint: {
                point1: { intersection: true, type: "top" },
                point2: { type: "top" },
                equals: 1
            },
            bottomFConstraint: {
                point1: { type: "bottom" },
                point2: { intersection: true, type: "bottom" },
                equals: 1
            },
            leftCConstraint: {
                point1: {
                    // content: true,
                    type: "left",
                    element: [expressionOf, [me]]
                },
                point2: { content: true, type: "left" },
                equals: 2
            },
            rightCConstraint: {
                point1: {
                    // content: true,
                    type: "right",
                    element: [expressionOf, [me]]
                },
                point2: { content: true, type: "right" },
                equals: 2
            },
            topCConstraint: {
                point1: {
                    // content: true,
                    type: "top",
                    element: [referredOf, [me]]
                },
                point2: { content: true, type: "top" },
                equals: 1
            },
            bottomCConstraint: {
                point1: { content: true, type: "bottom" },
                point2: {
                    // content: true,
                    type: "bottom",
                    element: [referredOf, [me]]
                },
                equals: 1
            }
        }
    },
    textCell: {
        "class": "intersectionCell",
        display: {
            text: {
                value: [{content: _}, [me]],
                textAlign: "left"
            }
        }
    },
    ratingCell: o(
        {
            qualifier: { rating: 1 },
            variant: {
                display: {
                    text: {
                        value: "*"
                    }
                }
            }
        },
        {
            qualifier: { rating: 2 },
            variant: {
                display: {
                    text: {
                        value: "**"
                    }
                }
            }
        },
        {
            qualifier: { rating: 3 },
            variant: {
                display: {
                    text: {
                        value: "***"
                    }
                }
            }
        },
        {
            qualifier: { rating: 4 },
            variant: {
                display: {
                    text: {
                        value: "****"
                    }
                }
            }
        },
        {
            qualifier: { rating: 5 },
            variant: {
                display: {
                    text: {
                        value: "*****"
                    }
                }
            }
        },
        {
            variant: {
                display: {
                    text: {
                        value: "n/a"
                    }
                }
            }
        },
        {
            "class": "intersectionCell",
            context: {
                rating: [{content: _}, [me]]
            },
            display: {
                text: {
                    value: [{content: _}, [me]],
                    textAlign: "left"
                }
            }
        }
    ),
    column: {
        "class": "Draggable",
        context: {
            column: true
        },
        display: {
            background: "#cccccc",
            text: {
                value: [{name: _}, [me]],
                textAlign: "center",
                verticalAlign: "top"
            }
        },
        position: {
            left: {
                point1: { type: "left", element: [embedding, [me]] },
                point2: { type: "left" },
                stability: true
            },
            top: 45,
            bottom: 10
        },
        children: {
            cells: {
                partner: [{row: true}]
            }
        }
    },
    textColumn: {
        "class": "column",
        children: {
            cells: {
                description: {
                    "class": "textCell"
                }
            }
        }
    },
    ratingColumn: {
        "class": "column",
        children: {
            cells: {
                description: {
                    "class": "ratingCell"
                }
            }
        }
    },
    appArea: {
        display: {
            background: "#777777"
        },
        position: {
            left: 0, right: 0, top: 0, height: 10000
        },
        children: {
            db: {
                description: {
                    "class": "db",
                    position: {
                        left: 5,
                        width: 760,
                        top: 90,
                        bottom: 5
                    },
                    display: {
                        background: "#999999"
                    },
                    context: {
                        rawDB: productList,
                        elemRange: r(0, [minus, [arg, "nrrows", 12], 1])
                    },
                    content: [pos, [{elemRange: _}, [me]], [{ rawDB: _}, [me]]]
                }
            },
            ticker: {
                description: {
                    "class": "textColumn",
                    context: { name: "Ticker" },
                    content: { ticker:_ },
                    position: {
                        left: { equals: 45 },
                        width: 70
                    }
                }
            },
            category: {
                description: {
                    "class": "textColumn",
                    context: { name: "Category" },
                    content: { "Morningstar Category": _ },
                    position: {
                        left: { equals: 130 },
                        width: 190
                    }
                }
            },
            rating: {
                description: {
                    "class": "ratingColumn",
                    context: { name: "Rating" },
                    content: { "Morningstar Rating": _ },
                    position: {
                        left: { equals: 335 },
                        width: 45
                    }
                }
            },
            assets: {
                description: {
                    "class": "textColumn",
                    context: { name: "Net Assets" },
                    content: { "Total net assets": _ },
                    position: {
                        left: { equals: 395 },
                        width: 60
                    }
                }
            },
            closePrice: {
                description: {
                    "class": "textColumn",
                    context: { name: "Close Price" },
                    content: { "Today's close": _ },
                    position: {
                        left: { equals: 470 },
                        width: 60
                    }
                }
            },
            Yield: {
                description: {
                    "class": "textColumn",
                    context: { name: "Yield" },
                    content: { Yield: _ },
                    position: {
                        left: { equals: 545 },
                        width: 50
                    }
                }
            },
            threeYearReturn: {
                description: {
                    "class": "textColumn",
                    context: { name: "3 Year Return" },
                    content: { "3 year total return": _ },
                    position: {
                        left: { equals: 610 },
                        width: 50
                    }
                }
            },
            beta: {
                description: {
                    "class": "textColumn",
                    context: { name: "Beta" },
                    content: { "Beta": _ },
                    position: {
                        left: { equals: 675 },
                        width: 50
                    }
                }
            }
        }
    }
};

var screenArea = {
    context: {
        "^screenAreaHeight": 800,
        "^screenAreaWidth": 1000
    },
    position: {
        left: 0,
        top: 0,
        width: [{screenAreaWidth: _}, [me]],
        height: [{screenAreaHeight: _}, [me]]
    },
    children: {
        appArea: {
            description: {
                "class": "appArea"
            }
        }
    }
};
