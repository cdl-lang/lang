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

var labelHeight = 20;

var classes = {
    Slider: o({
        qualifier: "!",
        variant: {
            context: {
                max: 100,
                ratio: [div, [offset, {type: "top"}, {type: "bottom"}],
                        [minus, [offset, {type: "top", element: [embedding]}, {type: "bottom", element: [embedding]}], labelHeight]],
                ratio2: [div, [offset, {type: "top"}, {type: "bottom"}],
                        [offset, {type: "top", element: [embedding]}, {type: "bottom", element: [embedding]}]],
                value: [min, o([{max: _}, [me]],
                               [floor, [mul, [{ratio: _}, [me]],
                                        [{max: _}, [me]]]])],
                mouseDown: [{mouseDown: _}, [embedding]]
            },
            display: {
                background: "white",
                text: {
                    value: [{value: _}, [me]]
                }
            },
            position: {
                belowTop: {
                    point1: {type: "top", element: [embedding]},
                    point2: {type: "top"},
                    min: 0,
                    priority: 1
                },
                aboveBottom: {
                    point1: {type: "top"},
                    point2: {type: "bottom"},
                    min: 0,
                    priority: 1
                },
                left: 0,
                bottom: labelHeight,
                right: 0
            }
        }
    }, {
        qualifier: {mouseDown: false},
        variant: {
            position: {
                relTop: {
                    pair1: {
                        point1: {type: "top", element: [embedding]},
                        point2: {type: "bottom", element: [embedding]}
                    },
                    pair2: {
                        point1: {type: "top"},
                        point2: {type: "bottom"}
                    },
                    ratio: [{ratio2: _}, [me]]
                }
            },
            write: {
                onClick: {
                    upon: [{ type: "MouseDown" }, [myMessage]],
                    "true": {
                        doWrite: {
                            to: [{ mouseDown:_ }, [me]],
                            merge: true
                        }
                    }
                }
            }
        }
    }, {
        qualifier: {mouseDown: true},
        variant: {
            position: {
                mouseTop: {
                    point1: { type: "top" },
                    point2: { type: "top", element: [pointer] },
                    equals: 0
                }
            }
        }
    }),
    SliderFrame: o({
        qualifier: "!",
        variant: {
            context: {
                "^mouseDown": false,
                value: [{children: {slider: {value: _}}}, [me]]
            },
            display: {
                background: "white"
            },
            children: {
                slider: {
                    description: {
                        "class": "Slider"
                    }
                }
            }
        }
    }, {
        qualifier: {mouseDown: false},
        variant: {
            write: {
                onClick: {
                    upon: [{ type: "MouseDown" }, [myMessage]],
                    "true": {
                        doWrite: {
                            to: [{ mouseDown:_ }, [me]],
                            merge: true
                        }
                    }
                }
            }
        }
    }, {
        qualifier: {mouseDown: true},
        variant: {
            write: {
                onClick: {
                    upon: [{ type: "MouseUp" }, [message]],
                    "true": {
                        doWrite: {
                            to: [{ mouseDown:_ }, [me]],
                            merge: false
                        }
                    }
                }
            }
        }
    }),
    GenericSliderFrame: {
        "class": "SliderFrame",
        children: {
            slider: {
                description: {
                    context: {
                        max: 100
                    },
                    display: {
                        background: "red",
                        text: {
                            color: "white"
                        }
                    }
                }
            },
            label: {
                description: {
                    display: {
                        text: {
                            value: [{label: _}, [embedding]]
                        }
                    },
                    position: {
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: labelHeight
                    }
                }
            }
        },
        position: {
            top: 20,
            height: 120,
            width: 20
        }
    },
    HighlightPointerInArea: o({
        context: {
            pointerInArea: [{param: {pointerInArea: _}}, [me]]
        }
    }, {
        qualifier: {pointerInArea: true},
        display: {
            opacity: 0.5
        }
    })
};

var screenArea = {
    display: {
        background: "#bbbbbb"
    },
    children: {
        interactiveArc: {
            description: {
                position: { top: 0, left: 0, width: 430, height: 310 },
                children: {
                    instructions: {
                        description: {
                            display: {
                                text: {
                                    textAlign: "left",
                                    verticalAlign: "top",
                                    value: "Move the sliders, e.g. to 74, 90, 55, 23"
                                }
                            },
                            position: {
                                left: 10,
                                bottom: 10,
                                width: 100,
                                height: 150
                            }
                        }
                    },
                    arc: {
                        description: {
                            "class": "HighlightPointerInArea",
                            display: {
                                // background: "white",
                                arc: {
                                    color: "red",
                                    range: [div, [{children: {range: {value: _}}}, [embedding]], 100],
                                    radius: [{children: {radius: {value: _}}}, [embedding]],
                                    start: [div, [{children: {start: {value: _}}}, [embedding]], 100],
                                    inset: [{children: {inset: {value: _}}}, [embedding]]
                                }
                            },
                            position: {
                                top: 10,
                                left: 130,
                                height: 300,
                                width: 300
                            }
                        }
                    },
                    radius: {
                        description: {
                            "class": "GenericSliderFrame",
                            context: { label: "r" },
                            position: { left: 10 }
                        }
                    },
                    range: {
                        description: {
                            "class": "GenericSliderFrame",
                            context: { label: "s" },
                            position: { left: 40 }
                        }
                    },
                    start: {
                        description: {
                            "class": "GenericSliderFrame",
                            context: { label: "b" },
                            position: { left: 70 }
                        }
                    },
                    inset: {
                        description: {
                            "class": "GenericSliderFrame",
                            context: { label: "i" },
                            position: { left: 100 }
                        }
                    }
                }
            }
        },
        multipleArcs: {
            description: {
                context: {
                    t1: [mul, 0.11, [time, true, 0.04, 100000]],
                    t2: [mul, 0.09, [time, true, 0.04, 100000]],
                    t3: [mul, 0.07, [time, true, 0.04, 100000]],
                    t4: [mul, 0.03, [time, true, 0.04, 100000]],
                    t5: [mul, 0.02, [time, true, 0.04, 100000]],
                },
                display: {
                    background: "white",
                    arc: {
                        color: o("rgb(227, 227, 227)", "rgb(54, 55, 55)", "rgb(254, 191, 20)", "rgb(157, 197, 205)", "rgb(195, 220, 181)", "rgb(237, 218, 149)", "rgb(223, 197, 226)", "rgb(179, 213, 137)", "rgb(160, 220, 231)"),
                        range: o(0.3, 0.3, 0.3, 0.3, 0.3, 0.3),
                        radius: o(65, 60, 55, 50, 45, 40),
                        start: o([{t5: _}, [me]], [{t4: _}, [me]], [{t3: _}, [me]], [{t2: _}, [me]], [{t1: _}, [me]]),
                        inset: o(45, 40, 35, 30, 25, 20)
                    }
                },
                position: {
                    top: 10,
                    left: 450,
                    height: 300,
                    width: 300
                }
            }
        },
        pieChart: {
            description: {
                display: {
                    background: "white",
                    arc: {
                        color: o("rgb(227, 227, 227)", "rgb(54, 55, 55)", "rgb(254, 191, 20)", "rgb(157, 197, 205)", "rgb(195, 220, 181)", "rgb(237, 218, 149)", "rgb(223, 197, 226)", "rgb(179, 213, 137)", "rgb(160, 220, 231)"),
                        range: o(0.2, 0.25, 0.1, 0.35, 0.1),
                        start: o(0.0, 0.2, 0.45, 0.55, 0.9),
                        radius: 120,
                        x: o(150, 158, 150, 150, 150),
                        y: o(150, 153, 150, 150, 150)
                    }
                },
                position: {
                    top: 320,
                    left: 10,
                    height: 300,
                    width: 300
                }
            }
        }
    }
};
