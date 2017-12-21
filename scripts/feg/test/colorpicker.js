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
    Slider: o({
        qualifier: "!",
        variant: {
            context: {
                max: 100,
                ratio: [div, [offset, {type: "top"}, {type: "bottom"}],
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
                bottom: 0,
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
                    ratio: [{ratio: _}, [me]]
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
    ShowRGBColor: {
        display: {
            background: [concatStr, o([{red: _}, [me]], [{green: _}, [me]], [{blue: _}, [me]]),
                         {prefix: "rgb(", infix: ",", postfix: ")"}
                        ]
        }
    },
    ShowHSLColor: {
        display: {
            background: [concatStr, o("hsla(", [{hue: _}, [me]], ",",
                                               [{sat: _}, [me]], "%,",
                                               [{lum: _}, [me]], "%,1)")]
        }
    },
    ByteSlider: {
        context: {
            max: 255
        },
        display: {
            text: {
                numericFormat: {
                    type: "HEXADECIMAL",
                    numberOfDigits: 2
                }
            }
        }
    },
    AngleSlider: {
        context: {
            max: 359
        },
        display: {
            text: {
                color: "white"
            }
        }
    },
    PercentageSlider: {
        context: {
            max: 100
        },
        display: {
            text: {
                color: "white"
            }
        }
    }
};

var screenArea = {
    display: {
        background: "#bbbbbb"
    },
    children: {
        rgb: {
            description: {
                position: {
                    top: 0, left: 0, height: 300, right: 300
                },
                children: {
                    red: {
                        description: {
                            "class": "SliderFrame",
                            children: {
                                slider: {
                                    description: {
                                        "class": "ByteSlider",
                                        display: {
                                            background: "red"
                                        }
                                    }
                                }
                            },
                            position: {
                                top: 20,
                                left: 10,
                                height: 256,
                                width: 20
                            }
                        }
                    },
                    green: {
                        description: {
                            "class": "SliderFrame",
                            children: {
                                slider: {
                                    description: {
                                        "class": "ByteSlider",
                                        display: {
                                            background: "green"
                                        }
                                    }
                                }
                            },
                            position: {
                                top: 20,
                                left: 40,
                                height: 256,
                                width: 20
                            }
                        }
                    },
                    blue: {
                        description: {
                            "class": "SliderFrame",
                            children: {
                                slider: {
                                    description: {
                                        "class": "ByteSlider",
                                        display: {
                                            background: "blue"
                                        }
                                    }
                                }
                            },
                            position: {
                                top: 20,
                                left: 70,
                                height: 256,
                                width: 20
                            }
                        }
                    },
                    color: {
                        description: {
                            "class": "ShowRGBColor",
                            context: {
                                red: [{children: {red: {value: _}}}, [embedding]],
                                green: [{children: {green: {value: _}}}, [embedding]],
                                blue: [{children: {blue: {value: _}}}, [embedding]]
                            },
                            position: {
                                top: 84,
                                left: 100,
                                height: 128,
                                width: 128
                            }
                        }
                    }
                }
            }
        },
        hsl: {
            description: {
                position: {
                    top: 0, left: 300, height: 300, right: 300
                },
                children: {
                    hue: {
                        description: {
                            "class": "SliderFrame",
                            children: {
                                slider: {
                                    description: {
                                        "class": "AngleSlider",
                                        display: {
                                            background: "black"
                                        }
                                    }
                                }
                            },
                            position: {
                                top: 20,
                                left: 10,
                                height: 256,
                                width: 20
                            }
                        }
                    },
                    sat: {
                        description: {
                            "class": "SliderFrame",
                            children: {
                                slider: {
                                    description: {
                                        "class": "PercentageSlider",
                                        display: {
                                            background: "black"
                                        }
                                    }
                                }
                            },
                            position: {
                                top: 20,
                                left: 40,
                                height: 256,
                                width: 20
                            }
                        }
                    },
                    lum: {
                        description: {
                            "class": "SliderFrame",
                            children: {
                                slider: {
                                    description: {
                                        "class": "PercentageSlider",
                                        display: {
                                            background: "black"
                                        }
                                    }
                                }
                            },
                            position: {
                                top: 20,
                                left: 70,
                                height: 256,
                                width: 20
                            }
                        }
                    },
                    color: {
                        description: {
                            "class": "ShowHSLColor",
                            context: {
                                hue: [{children: {hue: {value: _}}}, [embedding]],
                                sat: [{children: {sat: {value: _}}}, [embedding]],
                                lum: [{children: {lum: {value: _}}}, [embedding]]
                            },
                            position: {
                                top: 84,
                                left: 100,
                                height: 128,
                                width: 128
                            }
                        }
                    }
                }
            }
        }
    }
};
