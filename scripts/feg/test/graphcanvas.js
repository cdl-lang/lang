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
// %%foreign%%: "graphcanvas.foreign.js"

var nrSteps = 100;

var f = [
    defun, "x0",
    [using,
        "x", [mul, "x0", 6.283185307179586],
        "y", [plus,
                [minus,
                    [plus,
                        [minus, "x",
                            [div, [pow, "x", 3], 6]],
                        [div, [pow, "x", 5], 120]
                    ],
                    [div, [pow, "x", 7], 5040]
                ],
                [div, [pow, "x", 9], 362880]
        ],
        { x: "x", y: "y" }
    ]
];

var classes = {
    TrackDragging: o({
        context: {
            "^beingDragged": false,
            "^mouseDownX": 0,
            "^mouseDownY": 0,
            "^offsetX": 0,
            "^offsetY": 0
        }
    }, {
        qualifier: { beingDragged: false },
        write: {
            onMouseDown: {
                upon: [{type: "MouseDown"}, [myMessage]],
                true: {
                    setBeingDragged: {
                        to: [{beingDragged: _}, [me]],
                        merge: true
                    },
                    writeX: {
                        to: [{mouseDownX: _ }, [me]],
                        merge: [offset, {type: "left"}, {type: "left", element: [pointer]}]
                    },
                    writeY: {
                        to: [{mouseDownY: _ }, [me]],
                        merge: [offset, {type: "top"}, {type: "top", element: [pointer]}]
                    }
                }
            }
        }
    }, {
        qualifier: { beingDragged: true },
        write: {
            onChangeX: {
                upon: [changed, [offset, {type: "left"}, {type: "left", element: [pointer]}]],
                true: {
                    updateOffsetX: {
                        to: [{offsetX: _ }, [me]],
                        merge: [minus,
                            [{offsetX: _}, [me]],
                            [minus,
                                [offset, {type: "left"}, {type: "left", element: [pointer]}],
                                [{mouseDownX: _}, [me]]
                            ]
                        ]
                    },
                    updateMouseDownX: {
                        to: [{mouseDownX: _ }, [me]],
                        merge: [offset, {type: "left"}, {type: "left", element: [pointer]}]
                    }
                }
            },
            onChangeY: {
                upon: [changed, [offset, {type: "top"}, {type: "top", element: [pointer]}]],
                true: {
                    updateOffsetY: {
                        to: [{offsetY: _ }, [me]],
                        merge: [plus,
                            [{offsetY: _}, [me]],
                            [minus,
                                [offset, {type: "top"}, {type: "top", element: [pointer]}],
                                [{mouseDownY: _}, [me]]
                            ]
                        ]
                    },
                    updateMouseDownY: {
                        to: [{mouseDownY: _ }, [me]],
                        merge: [offset, {type: "top"}, {type: "top", element: [pointer]}]
                    }
                }
            },
            onMouseUp: {
                upon: [{type: "MouseUp", recipient: "end"}, [message]],
                true: {
                    setBeingDragged: {
                        to: [{beingDragged: _}, [me]],
                        merge: false
                    }
                }
            }
        }
    }),

    TrackDraggingDoubleClickReset: {
        write: {
            onDoubleClick: {
                upon: [{type: "MouseUp", subType: "DoubleClick"}, [myMessage]],
                true: {
                    clearOffsetX: {
                        to: [{offsetX: _}, [me]],
                        merge: 0
                    },
                    clearOffsetY: {
                        to: [{offsetY: _}, [me]],
                        merge: 0
                    }
                }
            }
        }
    }
};

var screenArea = {
    context: {
        functionValues: [
            map,
            f,
            [div, [sequence, r(0, nrSteps)], nrSteps]
        ]
    },
    children: {
        graphCanvas1: {
            description: {
                "class": o("TrackDragging", "TrackDraggingDoubleClickReset"),
                context: {
                    xAxisOffset: [div, [{offsetX: _}, [me]], 62],
                    yAxisOffset: [div, [{offsetY: _}, [me]], 30],
                    graphCanvas: [
                            [{graphCanvas: _}, [foreignFunctions]], {
                                xLow: [{xAxisOffset: _}, [me]],
                                xHigh: [plus, 6.283185307179586, [{xAxisOffset: _}, [me]]],
                                yLow: [plus, -1.5, [{yAxisOffset: _}, [me]]],
                                yHigh: [plus, 1.5, [{yAxisOffset: _}, [me]]],
                                backgroundColor: "white",
                                shadowColor: "lightgrey",
                                shadowBlur: 0,
                                shadowOffsetX: 3,
                                shadowOffsetY: 3
                            }
                        ]
                },    
                display: {
                    borderWidth: 1,
                    borderColor: "lightgrey",
                    borderStyle: "solid",
                    foreign: {
                        value: [{graphCanvas: _}, [me]]
                    }
                },
                children: {
                    features: {
                        data: [{functionValues: _}, [embedding]],
                        description: {
                            context: {
                                point: [{param: {areaSetContent: _}}, [me]]
                            },
                            display: {
                                foreign: {
                                    value: {
                                        x: [{point: {x: _}}, [me]],
                                        y: [{point: {y: _}}, [me]],
                                        type: "circle",
                                        strokeColor: "grey",
                                        fillColor: "white",
                                        connect: true,
                                        lineColor: "darkGrey"
                                    }
                                }
                            }
                        }
                    }
                },
                position: {
                    top: 10,
                    left: 10,
                    bottom: {
                        point1: { type: "bottom" },
                        point2: { type: "vertical-center", element: [embedding]},
                        equals: 10
                    },
                    right: {
                        point1: { type: "right" },
                        point2: { type: "horizontal-center", element: [embedding]},
                        equals: 10
                    }
                }
            }
        },
        graphCanvas2: {
            description: {
                context: {
                    data1: o(
                        {x: 0, y: 425},
                        {x: 10, y: 45},
                        {x: 20, y: 403},
                        {x: 30, y: 865},
                        {x: 40, y: 1624},
                        {x: 50, y: 13023},
                        {x: 60, y: 2471},
                        {x: 70, y: 2349},
                        {x: 80, y: 18168},
                        {x: 90, y: 445},
                        {x: 100, y: 51}
                    ),
                    data2: o(
                        {x: 0, y: 2425},
                        {x: 10, y: 45},
                        {x: 20, y: 8403},
                        {x: 30, y: 3865},
                        {x: 40, y: 1624},
                        {x: 50, y: 10023},
                        {x: 60, y: 2471},
                        {x: 70, y: 2349},
                        {x: 80, y: 7168},
                        {x: 90, y: 445},
                        {x: 100, y: 1051}
                    ),
                    graphCanvas: [
                            [{graphCanvas: _}, [foreignFunctions]], {
                                xLow: -5,
                                xHigh: 105,
                                yLow: 0,
                                yHigh: 20000,
                                backgroundColor: "white"
                            }
                        ]
                },
                display: {
                    borderWidth: 1,
                    borderColor: "lightgrey",
                    borderStyle: "solid",
                    foreign: {
                        value: [{graphCanvas: _}, [me]]
                    }
                },
                children: {
                    features1: {
                        data: [{data1: _}, [me]],
                        description: {
                            context: {
                                point: [{param: {areaSetContent: _}}, [me]]
                            },
                            display: {
                                foreign: {
                                    value: {
                                        x: [{point: {x: _}}, [me]],
                                        y: [{point: {y: _}}, [me]],
                                        type: "bar",
                                        fillColor: "lightblue",
                                        width: "5%"
                                    }
                                }
                            }
                        }
                    },
                    features2: {
                        data: [{data2: _}, [me]],
                        description: {
                            context: {
                                point: [{param: {areaSetContent: _}}, [me]]
                            },
                            display: {
                                foreign: {
                                    value: {
                                        x: [plus, [{point: {x: _}}, [me]], 5],
                                        y: [{point: {y: _}}, [me]],
                                        type: "bar",
                                        fillColor: "#FF8000",
                                        width: "10px"
                                    }
                                }
                            }
                        }
                    }
                },
                position: {
                    top: 10,
                    left: {
                        point1: { type: "horizontal-center", element: [embedding]},
                        point2: { type: "left" },
                        equals: 10
                    },
                    bottom: {
                        point1: { type: "bottom" },
                        point2: { type: "vertical-center", element: [embedding]},
                        equals: 10
                    },
                    right: 10
                }
            }
        },
        graphCanvas3: {
            description: {
                context: {
                    data: o(
                        {x:2, y:1, z: 34.87927835},
                        {x:3, y:1, z: 52.13740458},
                        {x:2, y:2, z: 41.64804469},
                        {x:3, y:2, z: 46.04128302},
                        {x:5, y:2, z: 66.67},
                        {x:1, y:3, z: 85},
                        {x:2, y:3, z: 85.51428571},
                        {x:3, y:3, z: 86.13095238},
                        {x:5, y:3, z: 91.89},
                        {x:1, y:4, z: 85},
                        {x:2, y:4, z: 85},
                        {x:3, y:4, z: 85},
                        {x:5, y:4, z: 91.89},
                        {x:1, y:5, z: 85},
                        {x:2, y:5, z: 69.57954365},
                        {x:3, y:5, z: 69.27648579},
                        {x:5, y:5, z: 91.89},
                        {x:2, y:6, z: 58.0011535},
                        {x:3, y:6, z: 59.76321053},
                        {x:2, y:7, z: 54.53488372},
                        {x:3, y:7, z: 54.53488372},
                        {x:1, y:8, z: 74.66},
                        {x:2, y:8, z: 77.03911111},
                        {x:3, y:8, z: 85},
                        {x:2, y:9, z: 68.82393563},
                        {x:3, y:9, z: 69.83938547},
                        {x:5, y:9, z: 91.89},
                        {x:2, y:10, z: 50},
                        {x:3, y:10, z: 50},
                        {x:2, y:11, z: 48.01495447},
                        {x:3, y:11, z: 60.705},
                        {x:5, y:11, z: 77.54103704},
                        {x:1, y:12, z: 85},
                        {x:2, y:12, z: 73.44809866},
                        {x:3, y:12, z: 72.66272189},
                        {x:5, y:12, z: 87.35},
                        {x:1, y:13, z: 85},
                        {x:2, y:13, z: 85},
                        {x:3, y:13, z: 85},
                        {x:5, y:13, z: 91.89},
                        {x:1, y:14, z: 84.99950276},
                        {x:2, y:14, z: 78.07157058},
                        {x:3, y:14, z: 77.50745645},
                        {x:5, y:14, z: 91.89},
                        {x:2, y:15, z: 50},
                        {x:3, y:15, z: 50},
                        {x:5, y:15, z: 66.67},
                        {x:2, y:16, z: 56.65162608},
                        {x:3, y:16, z: 53.78180662},
                        {x:5, y:16, z: 75},
                        {x:1, y:17, z: 85},
                        {x:2, y:17, z: 85},
                        {x:3, y:17, z: 85},
                        {x:5, y:17, z: 91.89},
                        {x:2, y:18, z: 42.36842105},
                        {x:3, y:18, z: 50},
                        {x:1, y:19, z: 85},
                        {x:2, y:19, z: 85},
                        {x:3, y:19, z: 85},
                        {x:5, y:19, z: 91.89},
                        {x:1, y:20, z: 85},
                        {x:2, y:20, z: 81.78571429},
                        {x:3, y:20, z: 80},
                        {x:2, y:21, z: 38.82582677},
                        {x:3, y:21, z: 49.30555556},
                        {x:1, y:22, z: 85},
                        {x:2, y:22, z: 84.49695122},
                        {x:3, y:22, z: 84.92580379},
                        {x:5, y:22, z: 91.89},
                        {x:1, y:23, z: 85},
                        {x:2, y:23, z: 76.77092711},
                        {x:3, y:23, z: 80.39087943},
                        {x:5, y:23, z: 91.89},
                        {x:1, y:24, z: 83.24324324},
                        {x:2, y:24, z: 81.99428571},
                        {x:3, y:24, z: 83.47133758},
                        {x:5, y:24, z: 91.89},
                        {x:2, y:25, z: 49.32320442},
                        {x:3, y:25, z: 50},
                        {x:5, y:25, z: 66.67},
                        {x:1, y:26, z: 85},
                        {x:2, y:26, z: 78.10744681},
                        {x:3, y:26, z: 80},
                        {x:5, y:26, z: 88.89},
                        {x:1, y:27, z: 83.04347826},
                        {x:2, y:27, z: 69.61582126},
                        {x:3, y:27, z: 69.33566434},
                        {x:5, y:27, z: 90.01},
                        {x:2, y:28, z: 74.06733363},
                        {x:4, y:28, z: 84.51456311},
                        {x:2, y:29, z: 58.44835178},
                        {x:3, y:29, z: 55.76019002},
                        {x:5, y:29, z: 67.63}
                    ),
                    graphCanvas: [
                            [{graphCanvas: _}, [foreignFunctions]], {
                                yLow: 0.5,
                                yHigh: 5.5,
                                xLow: 0.5,
                                xHigh: 29.5,
                                backgroundColor: "white"
                            }
                        ]
                },
                display: {
                    borderWidth: 1,
                    borderColor: "lightgrey",
                    borderStyle: "solid",
                    foreign: {
                        value: [{graphCanvas: _}, [me]]
                    }
                },
                children: {
                    features: {
                        data: [{data: _}, [me]],
                        description: {
                            context: {
                                point: [{param: {areaSetContent: _}}, [me]]
                            },
                            display: {
                                foreign: {
                                    value: {
                                        x: [{point: {y: _}}, [me]],
                                        y: [{point: {x: _}}, [me]],
                                        type: "arc",
                                        range: [div, [{point: {z: _}}, [me]], 100],
                                        strokeColor: "#F1B724",
                                        radius: 0.5,
                                        inset: 0.2
                                    }
                                }
                            }
                        }
                    }
                },
                position: {
                    top: {
                        point1: { type: "vertical-center", element: [embedding]},
                        point2: { type: "top" },
                        equals: 10
                    },
                    left: 10,
                    bottom: 10,
                    right: {
                        point1: { type: "right" },
                        point2: { type: "horizontal-center", element: [embedding]},
                        equals: 10
                    }
                }
            }
        },
        graphCanvas4: {
            description: {
                context: {
                    data: o(
                        {ms:1, gdp: 59200.0}, {ms:1, gdp: 40400.0}, {ms:1, gdp: 28600.0}, {ms:1, gdp: 31500.0}, {ms:1, gdp: 37200.0}, {ms:1, gdp: 33200.0}, {ms:1, gdp: 37400.0}, {ms:1, gdp: 22100.0}, {ms:1, gdp: 24700.0}, {ms:1, gdp: 21800.0}, {ms:1, gdp: 23500.0},
                        {ms:2, gdp: 8400.0}, {ms:2, gdp: 9500.0}, {ms:2, gdp: 11200.0}, {ms:2, gdp: 11300.0}, {ms:2, gdp: 22000.0}, {ms:2, gdp: 9600.0},
                        {ms:3, gdp: 51400.0}, {ms:3, gdp: 23300.0}, {ms:3, gdp: 22300.0}, {ms:3, gdp: 18800.0}, {ms:3, gdp: 20700.0}, {ms:3, gdp: 23500.0}, {ms:3, gdp: 21000.0}, {ms:3, gdp: 20900.0},
                        {ms:4, gdp: 47100.0}, {ms:4, gdp: 25200.0}, {ms:4, gdp: 33200.0}, {ms:4, gdp: 32800.0}, {ms:4, gdp: 30300.0},
                        {ms:5, gdp: 46700.0}, {ms:5, gdp: 40200.0}, {ms:5, gdp: 34800.0}, {ms:5, gdp: 38700.0}, {ms:5, gdp: 51400.0}, {ms:5, gdp: 35200.0}, {ms:5, gdp: 37300.0}, {ms:5, gdp: 33000.0}, {ms:5, gdp: 39100.0}, {ms:5, gdp: 35900.0}, {ms:5, gdp: 35600.0}, {ms:5, gdp: 34400.0}, {ms:5, gdp: 25600.0}, {ms:5, gdp: 45800.0}, {ms:5, gdp: 59500.0}, {ms:5, gdp: 47100.0}, {ms:5, gdp: 30300.0}, {ms:5, gdp: 33100.0}, {ms:5, gdp: 24000.0}, {ms:5, gdp: 37700.0}, {ms:5, gdp: 33900.0}, {ms:5, gdp: 24400.0}, {ms:5, gdp: 31100.0}, {ms:5, gdp: 38400.0}, {ms:5, gdp: 38000.0}, {ms:5, gdp: 30200.0}, {ms:5, gdp: 34000.0}, {ms:5, gdp: 31500.0}, {ms:5, gdp: 30300.0}, {ms:5, gdp: 27500.0}, {ms:5, gdp: 33700.0}, {ms:5, gdp: 34100.0}, {ms:5, gdp: 27000.0}, {ms:5, gdp: 25000.0}, {ms:5, gdp: 29100.0}, {ms:5, gdp: 24300.0}, {ms:5, gdp: 29100.0}, {ms:5, gdp: 25400.0},
                        {ms:6, gdp: 26800.0}, {ms:6, gdp: 15000.0}, {ms:6, gdp: 21900.0}, {ms:6, gdp: 16800.0}, {ms:6, gdp: 13800.0}, {ms:6, gdp: 15100.0}, {ms:6, gdp: 18200.0}, {ms:6, gdp: 13900.0}, {ms:6, gdp: 14700.0}, {ms:6, gdp: 18300.0}, {ms:6, gdp: 14400.0}, {ms:6, gdp: 16700.0}, {ms:6, gdp: 16000.0},
                        {ms:7, gdp: 22900.0}, {ms:7, gdp: 22800.0}, {ms:7, gdp: 23400.0}, {ms:7, gdp: 34400.0}, {ms:7, gdp: 32500.0}, {ms:7, gdp: 28200.0}, {ms:7, gdp: 28500.0}, {ms:7, gdp: 35400.0}, {ms:7, gdp: 24300.0}, {ms:7, gdp: 20100.0}, {ms:7, gdp: 17800.0}, {ms:7, gdp: 30900.0}, {ms:7, gdp: 23000.0}, {ms:7, gdp: 27000.0}, {ms:7, gdp: 19200.0}, {ms:7, gdp: 21000.0}, {ms:7, gdp: 21100.0}, {ms:7, gdp: 19100.0}, {ms:7, gdp: 21500.0},
                        {ms:8, gdp: 50900.0}, {ms:8, gdp: 25800.0}, {ms:8, gdp: 22900.0}, {ms:8, gdp: 26400.0}, {ms:8, gdp: 25200.0}, {ms:8, gdp: 24400.0}, {ms:8, gdp: 25800.0}, {ms:8, gdp: 24900.0}, {ms:8, gdp: 23300.0}, {ms:8, gdp: 28400.0}, {ms:8, gdp: 23600.0}, {ms:8, gdp: 27400.0}, {ms:8, gdp: 25900.0}, {ms:8, gdp: 25200.0}, {ms:8, gdp: 26600.0}, {ms:8, gdp: 27400.0}, {ms:8, gdp: 23100.0}, {ms:8, gdp: 30500.0}, {ms:8, gdp: 25000.0}, {ms:8, gdp: 22800.0}, {ms:8, gdp: 28500.0}, {ms:8, gdp: 24500.0}, {ms:8, gdp: 19800.0}, {ms:8, gdp: 22400.0}, {ms:8, gdp: 15300.0}, {ms:8, gdp: 20400.0}, {ms:8, gdp: 9100.0},
                        {ms:9, gdp: 29600.0}, {ms:9, gdp: 35100.0}, {ms:9, gdp: 31000.0}, {ms:9, gdp: 36600.0}, {ms:9, gdp: 25200.0}, {ms:9, gdp: 19800.0}, {ms:9, gdp: 17600.0}, {ms:9, gdp: 18100.0}, {ms:9, gdp: 20400.0}, {ms:9, gdp: 17100.0}, {ms:9, gdp: 17600.0}, {ms:9, gdp: 20100.0}, {ms:9, gdp: 42400.0}, {ms:9, gdp: 35500.0}, {ms:9, gdp: 31600.0}, {ms:9, gdp: 29900.0}, {ms:9, gdp: 34500.0}, {ms:9, gdp: 30200.0}, {ms:9, gdp: 24600.0}, {ms:9, gdp: 26900.0}, {ms:9, gdp: 31800.0},
                        {ms:10, gdp: 41500.0}, {ms:10, gdp: 26100.0}, {ms:10, gdp: 26200.0}, {ms:10, gdp: 30200.0}, {ms:10, gdp: 31000.0}, {ms:10, gdp: 28300.0}, {ms:10, gdp: 43300.0}, {ms:10, gdp: 47400.0}, {ms:10, gdp: 37000.0}, {ms:10, gdp: 28800.0}, {ms:10, gdp: 38000.0}, {ms:10, gdp: 31200.0}
                    ),
                    graphCanvas: [
                            [{graphCanvas: _}, [foreignFunctions]], {
                                xLow: 0,
                                xHigh: 100000,
                                yLow: 0,
                                yHigh: 11,
                                backgroundColor: "white",
                                xGrid: 10000,
                                yGrid: 1
                            }
                        ]
                },
                display: {
                    borderWidth: 1,
                    borderColor: "lightgrey",
                    borderStyle: "solid",
                    foreign: {
                        value: [{graphCanvas: _}, [me]]
                    }
                },
                children: {
                    features: {
                        data: [{data: _}, [me]],
                        description: {
                            context: {
                                elt: [{param: {areaSetContent: _}}, [me]]
                            },
                            display: {
                                foreign: {
                                    value: {
                                        x: [{elt: {gdp: _}}, [me]],
                                        y: [{elt: {ms: _}}, [me]],
                                        type: "circle",
                                        fillColor: "red"
                                    }
                                }
                            }
                        }
                    }
                },
                position: {
                    top: {
                        point1: { type: "vertical-center", element: [embedding]},
                        point2: { type: "top" },
                        equals: 10
                    },
                    left: {
                        point1: { type: "horizontal-center", element: [embedding]},
                        point2: { type: "left" },
                        equals: 10
                    },
                    bottom: 10,
                    right: 10
                }
            }
        }
    }
};
