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

var mkProj = [defun, "attr", {"#attr": _}];

initGlobalDefaults.fontFamily = "sans-serif";
initGlobalDefaults.background = {
    openCloseButton: "#d0d0d0"
};

var initConfig = {
    display: {
        background: "#eeeeee"
    },
    position: {
        top: 0,
        topOf: "embedding",
        left: 0,
        leftOf: "embedding",
        height: 200,
        width: 200
    }
};

var clickEvent = { type: "MouseUp", subType: o("Click", "DoubleClick") };
var doubleClickEvent = { type: "MouseUp", subType: "DoubleClick" };

var attributeList = o({
    attribute: "display", type: "av", children: o({
        attribute: "background", type: "color"
    }, {
        attribute: "background", name: "gradient", type: "av", children: o({
            attribute: "linearGradient", name: "linear", type: "av", children: o({
                attribute: "start", type: "text"
            }, {
                attribute: "stops", type: "av", children: o({
                    attribute: "color", type: "color"
                }, {
                    attribute: "length", type: "text"
                })
            })
        })
    }, {
        attribute: "text", type: "av", children: o({
            attribute: "alignment", type: "nonAV", children: o({
                attribute: "textAlign", name: "horizontal",type: "text"
            }, {
                attribute: "verticalAlign", name: "vertical", type: "text"
            })
        }, {
            attribute: "font", type: "nonAV", children: o({
                attribute: "fontSize", name: "size", type: "number"
            }, {
                attribute: "fontFamily", name: "family", type: "text"
            }, {
                attribute: "fontWeight", name: "weight", type: "number"
            }, {
                attribute: "color", type: "color"
            })
        }, {
            attribute: "value", type: "text"
        }, {
            attribute: "textShadow", name: "shadow", type: "av", children: o({
                attribute: "horizontal", type: "number"
            }, {
                attribute: "vertical", type: "number"
            }, {
                attribute: "blurRadius", type: "number"
            }, {
                attribute: "color", type: "color"
            })
        })
    }, {
        attribute: "image", type: "av", children: o({
            attribute: "src", type: "text"
        }, {
            attribute: "alt", type: "text"
        }, {
            attribute: "size", type: "text"
        })
    }, {
        attribute: "triangle", type: "av", children: o({
            attribute: "baseSide", type: "text"
        }, {
            attribute: "color", type: "color"
        }, {
            attribute: "stroke", type: "color"
        }, {
            attribute: "shadow", type: "av", children: o({
                attribute: "color", type: "color"
            }, {
                attribute: "horizontal", type: "number"
            }, {
                attribute: "vertical", type: "number"
            }, {
                attribute: "blurRadius", type: "number"
            })
        })
    }, {
        attribute: "border", type: "nonAV", children: o({
            attribute: "borderWidth", name: "width", type: "number"
        }, {
            attribute: "borderStyle", name: "style", type: "text"
        }, {
            attribute: "borderColor", name: "color", type: "color"
        }, {
            attribute: "borderRadius", name: "radius", type: "number"
        })
    }, {
    attribute: "transform", type: "av", children: o({
        attribute: "rotate", type: "number"
    }, {
        attribute: "scale", type: "number"
    }, {
        attribute: "flip", type: "text"
    })
}, {
    attribute: "boxShadow", name: "shadow", type: "av", children: o({
        attribute: "horizontal", type: "number"
    }, {
        attribute: "vertical", type: "number"
    }, {
        attribute: "blurRadius", type: "number"
    }, {
        attribute: "color", type: "color"
    }, {
        attribute: "spread", type: "number"
    }, {
        attribute: "inset", type: "number"
    })
})
}, {
    attribute: "position", type: "av", children: o({
        attribute: "top", type: "number"
    }, {
        attribute: "topOf", type: "text"
    }, {
        attribute: "left", type: "number"
    }, {
        attribute: "leftOf", type: "text"
    }, {
        attribute: "width", type: "number"
    }, {
        attribute: "height", type: "number"
    })
});

var newAreaData = {
    display: {
        background: "pink"
    },
    position: {
        top: 10,
        topOf: "embedding",
        left: 10,
        leftOf: "embedding",
        width: 20,
        height: 20
    }
};

var classes = {
    GreyOut: {
        qualifier: {enabled: false},
        display: {
            opacity: 0.5
        }
    },

    AttributeInspector: o({
        context: {
            attribute: [{param: {areaSetContent: {attribute: _}}}, [me]],
            name: [mergeWrite,
                    [{param: {areaSetContent: {name: _}}}, [me]],
                    [{param: {areaSetContent: {attribute: _}}}, [me]]
                  ],
            type: [{param: {areaSetContent: {type: _}}}, [me]],
            childAttributes: [{param: {areaSetContent: {children: _}}}, [me]],
            inspectedData: [[mkProj, [{attribute: _}, [me]]], [{inspectedData: _}, [embedding]]]
        },
        display: {
            transitions: {
                height: 0.5,
                top: 0.5
            }
        },
        position: {
            left: 6,
            right: 0,
            top: {
                point1: { element: [prev, [me]], type: "bottom"},
                point2: { type: "top" },
                equals: 2
            }
        },
        children: {
            attributeName: {
                description: {
                    display: {
                        text: {
                            fontFamily: "sans-serif",
                            fontSize: 12,
                            fontWeight: 500,
                            color: "white",
                            textAlign: "left",
                            verticalAlign: "top",
                            value: [{name: _}, [embedding]]
                        }
                    },
                    position: {
                        top: 0,
                        left: 6,
                        bottom: 0,
                        right: {
                            point1: {type: "right" },
                            point2: { label: "attributeValueSeparator", element: [areaOfClass, "Inspector"] },
                            equals: 0
                        }
                    }
                }
            }
        }
    }, {
        qualifier: {type: "av"},
        context: {
            "*open": false
        },
        children: {
            open: {
                description: {
                    "class": "OpenCloseButton"
                }
            }
        }
    }, {
        qualifier: {type: "nonAV"},
        context: {
            "*open": false,
            inspectedData: [{inspectedData: _}, [embedding]]
        },
        children: {
            open: {
                description: {
                    "class": "OpenCloseButton"
                }
            }
        }
    }, {
        qualifier: {type: o("av", "nonAV"), open: true},
        position: {
            bottomLastChild: {
                point1: { type: "bottom", element: [last, [{children: {attributes: _}}, [me]]]},
                point2: { type: "bottom" },
                equals: 0
            }
        }
    }, {
        qualifier: {type: o("av", "nonAV"), open: false},
        position: {
            atLeastFromTop: {
                point1: { type: "top" },
                point2: { type: "bottom" },
                equals: 16
            }
        }
    }, {
        qualifier: {type: "number"},
        "class": "ShowData",
        context: {
            editType: "number"
        }
    }, {
        qualifier: {type: o("color", "text")},
        "class": "ShowData",
        context: {
            editType: "text"
        }
    }, {
        qualifier: {type: o("color", "text", "number")},
        position: {
            height: 16
        }
    }),

    "OpenCloseButton": {
        context: {
            open: [{open: _}, [embedding]]
        },
        display: o({
            qualifier: {open: true},
            background: [{background: {openCloseButton: _}}, [globalDefaults]],
            borderRadius: 3
        }, {
            qualifier: {open: false},
            borderColor: "white",
            borderStyle: "solid",
            borderWidth: 1,
            borderRadius: 3
        }),
        position: {
            top: 4,
            left: 0,
            height: 6,
            width: 6
        },
        write: {
            onClick: {
                upon: [clickEvent, [myMessage]],
                "true": {
                    switch: {
                        to: [{open: _}, [me]],
                        merge: [not, [{open: _}, [me]]]
                    }
                }
            }
        }
    },

    ShowData: {
        children: {
            showData: {
                description: {
                    context: {
                        "*edit": false
                    },
                    display: o({
                        qualifier: "!",
                        text: {
                            fontFamily: "sans-serif",
                            fontSize: 12,
                            fontWeight: 500,
                            textAlign: "left",
                            verticalAlign: "top",
                            value: [{inspectedData: _}, [embedding]]
                        }
                    }, {
                        qualifier: {edit: false},
                        text: {
                            color: "white"
                        }
                    }, {
                        qualifier: {edit: true},
                        text: {
                            color: "black",
                            input: {
                                type: [{editType: _}, [embedding]]
                            }
                        }
                    }),
                    position: {
                        top: 0,
                        left: {
                            point1: { label: "attributeValueSeparator", element: [areaOfClass, "Inspector"] },
                            point2: {type: "left" },
                            equals: 6
                        },
                        bottom: 0,
                        right: 0
                    },
                    write: {
                        onClick: {
                            upon: clickEvent,
                            "true": {
                                continuePropagation: false
                            }
                        },
                        onDoubleClick: {
                            upon: [doubleClickEvent, [myMessage]],
                            "true": {
                                continuePropagation: false,
                                switch: {
                                    to: [{edit: _}, [me]],
                                    merge: true
                                }
                            }
                        },
                        onEnter: {
                            upon: [{type: "KeyPress", key: "Return", recipient: "start"}, [message]],
                            "true": {
                                switch: {
                                    to: [{edit: _}, [me]],
                                    merge: false
                                }
                            }
                        },
                        onClickElsewhere: {
                            upon: [{type: "MouseDown", recipient: "start"}, [message]],
                            "true": {
                                continuePropagation: true,
                                switch: {
                                    to: [{edit: _}, [me]],
                                    merge: false
                                }
                            }
                        },
                        onChange: {
                            upon: [and,
                                    [{edit: _}, [me]],
                                    [changed, [{param: {input: {value: _}}}, [me]]]
                                  ],
                            true: {
                                update: {
                                    to: [{inspectedData: _}, [embedding]],
                                    merge: [{param: {input: {value: _}}}, [me]]
                                }
                            }
                        }
                    }
                }
            }
        }
    },

    AttributeInspector1: {
        "class": "AttributeInspector",
        position: {
            firstChild: {
                point1: { type: "top" },
                point2: { element: [first, [{children: {attributes: _}}, [me]]], type: "top" },
                equals: 16
            }
        },
        children: {
            attributes: {
                qualifier: {open: true},
                data: [identify, {attribute: _}, [{childAttributes: _}, [me]]],
                description: {
                    "class": "AttributeInspector"
                }
            }
        }
    },

    AttributeInspector2: {
        "class": "AttributeInspector",
        position: {
            firstChild: {
                point1: { type: "top" },
                point2: { element: [first, [{children: {attributes: _}}, [me]]], type: "top" },
                equals: 16
            }
        },
        children: {
            attributes: {
                qualifier: {open: true},
                data: [{childAttributes: _}, [me]],
                description: {
                    "class": "AttributeInspector1"
                }
            }
        }
    },

    AttributeInspector3: {
        "class": "AttributeInspector",
        position: {
            firstChild: {
                point1: { type: "top" },
                point2: { element: [first, [{children: {attributes: _}}, [me]]], type: "top" },
                equals: 16
            }
        },
        children: {
            attributes: {
                qualifier: {open: true},
                data: [{childAttributes: _}, [me]],
                description: {
                    "class": "AttributeInspector2"
                }
            }
        }
    },

    AttributeInspector4: {
        "class": "AttributeInspector",
        position: {
            firstChild: {
                point1: { type: "top" },
                point2: { element: [first, [{children: {attributes: _}}, [me]]], type: "top" },
                equals: 16
            }
        },
        children: {
            attributes: {
                qualifier: {open: true},
                data: [{childAttributes: _}, [me]],
                description: {
                    "class": "AttributeInspector3"
                }
            }
        }
    },

    TextButton: {
        display: {
            borderColor: "white",
            borderRadius: 8,
            borderStyle: "solid",
            borderWidth: 1,
            text: {
                fontSize: 14,
                color: "white",
                fontFamily: "sans-serif"
            }
        },
        position: {
            width: 16,
            height: 16
        }
    },

    Inspector: o({
        propagatePointerInArea: o(),
        context: {
            inspectedArea: [{selected: true}, [areaOfClass, "AreaInterpreter"]],
            inspectedData: [{inspectedArea: {areaData: _}}, [me]],

            inspectedAreaEmbedding: [embedding, [{inspectedArea: _}, [me]]],
            inspectedAreaSiblings: [{children: {children: _}}, [{inspectedAreaEmbedding: _}, [me]]],
            inspectedAreaPosition: [index, [{inspectedAreaSiblings: _}, [me]], [{inspectedArea: _}, [me]]],

            attributeList: attributeList,
            "^resizeHorizontally": false,
            "^resizeVertically": false,
            "^width": 200,
            "^height": 300,
            "*clipboard": o()
        },
        display: {
            background: "black",
            opacity: 0.7,
            borderRadius: 10,
            borderStyle: "solid",
            borderColor: "black",
            borderWidth: 4
        },
        position: {
            top: 24,
            right: 20,
            firstChild: {
                point1: { type: "top" },
                point2: { element: [first, [{children: {attributes: _}}, [me]]], type: "top" },
                equals: 28
            },
            attributeValueSeparator: {
                pair2: {
                    point1: { type: "left" },
                    point2: { label: "attributeValueSeparator" }
                },
                pair1: {
                    point1: { type: "left" },
                    point2: { type: "right" }
                },
                ratio: 0.4
            }
        },
        children: {
            bar: {
                description: {
                    display: {
                        background: "black",
                        text: {
                            fontFamily: "sans-serif",
                            fontSize: 20,
                            fontWeight: 300,
                            color: "white",
                            textAlign: "left",
                            verticalAlign: "top",
                            value: "Inspector"
                        }
                    },
                    position: {
                        top: 0,
                        height: 24,
                        left: 0,
                        right: 0
                    }
                }
            },
            attributes: {
                data: [{attributeList: _}, [me]],
                description: {
                    "class": "AttributeInspector4"
                }
            },
            separator: {
                description: {
                    display: {
                        background: "white"
                    },
                    position: {
                        top: 28,
                        bottom: 0,
                        width: 1,
                        left: {
                            point1: { type: "left" },
                            point2: { label: "attributeValueSeparator", element: [embedding] },
                            equals: 0
                        }
                    }
                }
            },
            incrNrChildren: {
                description: {
                    "class": "TextButton",
                    context: {
                        inspectedArea: [{inspectedArea: _}, [embedding]]
                    },
                    display: {
                        text: {
                            value: "+"
                        }
                    },
                    position: {
                        top: 4,
                        right: 18
                    },
                    write: {
                        onClick: {
                            upon: [and,
                                [notEmpty, [{inspectedArea: _}, [me]]],
                                [clickEvent, [myMessage]]
                            ],
                            "true": {
                                addNewChild: {
                                    to: [{areaData: {children: _}}, [{inspectedArea: _}, [me]]],
                                    merge: push(newAreaData)
                                }
                            }
                        }
                    }
                }
            },
            decrNrChildren: {
                description: {
                    "class": "TextButton",
                    display: {
                        text: {
                            value: "-"
                        }
                    },
                    position: {
                        top: 4,
                        right: 1
                    },
                    write: {
                        onClick: {
                            upon: [and,
                                [notEmpty, [{inspectedArea: _}, [embedding]]],
                                [clickEvent, [myMessage]]
                            ],
                            "true": {
                                removeChild: {
                                    to: [{areaData: {children: _}}, [{inspectedAreaEmbedding: _}, [embedding]]],
                                    merge: atomic([
                                        pos, o(
                                            Rco(0, [{inspectedAreaPosition: _}, [embedding]]),
                                            Roc([{inspectedAreaPosition: _}, [embedding]], -1)
                                        ),
                                        [{areaData: {children: _}}, [{inspectedAreaEmbedding: _}, [embedding]]]
                                    ])
                                }
                            }
                        }
                    }
                }
            },
            copy: {
                description: {
                    "class": "TextButton",
                    context: {
                        inspectedArea: [{inspectedArea: _}, [embedding]]
                    },
                    display: {
                        text: {
                            value: "C"
                        }
                    },
                    position: {
                        top: 4,
                        right: 63
                    },
                    write: {
                        onClick: {
                            upon: [and,
                                [notEmpty, [{inspectedArea: _}, [me]]],
                                [clickEvent, [myMessage]]
                            ],
                            "true": {
                                copyToClipboard: {
                                    to: [{clipboard: _}, [embedding]],
                                    merge: [{inspectedArea: {areaData: _}}, [me]]
                                }
                            }
                        }
                    }
                }
            },
            paste: {
                description: {
                    "class": "TextButton",
                    context: {
                        inspectedArea: [{inspectedArea: _}, [embedding]]
                    },
                    display: {
                        text: {
                            value: "V"
                        }
                    },
                    position: {
                        top: 4,
                        right: 45
                    },
                    write: {
                        onClick: {
                            upon: [and,
                                [notEmpty, [{inspectedArea: _}, [me]]],
                                [clickEvent, [myMessage]]
                            ],
                            "true": {
                                copyToClipboard: {
                                    to: [{inspectedArea: {areaData: _}}, [me]],
                                    merge: [{clipboard: _}, [embedding]]
                                }
                            }
                        }
                    }
                }
            }
        },
        write: {
            onMouseDown1: {
                upon: [and,
                    [{type: "MouseDown"}, [message]],
                    [lessThan, [abs, [offset, {type: "left"}, {type: "left", element: [pointer]}]], 5]
                ],
                true: {
                    continuePropagation: false,
                    horizontallyResize: {
                        to: [{resizeHorizontally: _}, [me]],
                        merge: true
                    }
                }
            },
            onMouseDown2: {
                upon: [and,
                    [{type: "MouseDown"}, [message]],
                    [lessThan, [abs, [offset, {type: "bottom"}, {type: "top", element: [pointer]}]], 5]
                ],
                true: {
                    verticallyResize: {
                        to: [{resizeVertically: _}, [me]],
                        merge: true
                    }
                }
            },
            onMouseUp: {
                upon: [{type: "MouseUp"}, [message]],
                true: {
                    continuePropagation: true
                }
            }
        }
    }, {
        qualifier: {resizeHorizontally: false},
        position: {
            width: [{width: _}, [me]]
        }
    }, {
        qualifier: {resizeHorizontally: true},
        position: {
            width: {
                point1: { type: "left" },
                point2: { type: "left", element: [pointer] },
                equals: 0
            }
        },
        write: {
            onMouseUp: {
                true: {
                    horizontallyResize: {
                        to: [{resizeHorizontally: _}, [me]],
                        merge: false
                    },
                    storeWidth: {
                        to: [{width: _}, [me]],
                        merge: [offset, {type: "left", element: [pointer]}, {type: "right"}]
                    }
                }
            }
        }
    }, {
        qualifier: {resizeVertically: false},
        position: {
            height: [{height: _}, [me]]
        }
    }, {
        qualifier: {resizeVertically: true},
        position: {
            height: {
                point1: { type: "bottom" },
                point2: { type: "top", element: [pointer] },
                equals: 0
            }
        },
        write: {
            onMouseUp: {
                true: {
                    verticallyResize: {
                        to: [{resizeVertically: _}, [me]],
                        merge: false
                    },
                    storeHeight: {
                        to: [{height: _}, [me]],
                        merge: [offset, {type: "top"}, {type: "top", element: [pointer]}]
                    }
                }
            }
        }
    }),

    AreaInterpreter: o({
        "class": "AreaInterpreter",
        context: {
            "*selected": false,
            areaData: [{param: {areaSetContent: _}}, [me]],
            onHover: [{ param: { pointerInArea:_ } }, [me]],
            onHoverDisplayChanges: {
                borderStyle: "solid",
                borderWidth: 2,
                borderRadius: 3,
                borderColor: "gold",
                transitions: {
                    borderColor: 1
                }
            },

            isBorderDefined: [or,
                [notEmpty, [{areaData: {display: {borderWidth: _}}}, [me]]],
                [notEmpty, [{areaData: {display: {borderStyle: _}}}, [me]]],
                [notEmpty, [{areaData: {display: {borderColor: _}}}, [me]]],
                [notEmpty, [{areaData: {display: {borderRadius: _}}}, [me]]]
            ],
            isTextDefined: [notEmpty, [{areaData: {display: {text: {value: _}}}}, [me]]],
            isImageDefined: [notEmpty, [{areaData: {display: {image: {src: _}}}}, [me]]],
            isBackgroundDefined: [notEmpty, [{areaData: {display: {background: _}}}, [me]]],
            isTriangleDefined: [notEmpty, [{areaData: {display: {triangle: _}}}, [me]]],
            isShadowDefined:  [or,
                [notEmpty, [{areaData: {display: {boxShadow: {horizontal: _}}}}, [me]]],
                [notEmpty, [{areaData: {display: {boxShadow: {vertical: _}}}}, [me]]],
                [notEmpty, [{areaData: {display: {boxShadow: {blurRadius: _}}}}, [me]]],
                [notEmpty, [{areaData: {display: {boxShadow: {color: _}}}}, [me]]],
                [notEmpty, [{areaData: {display: {boxShadow: {spread: _}}}}, [me]]],
                [notEmpty, [{areaData: {display: {boxShadow: {inset: _}}}}, [me]]]
            ],
            isTransformDefined:  [or,
                [notEmpty, [{areaData: {display: {transform: {flip: _}}}}, [me]]],
                [notEmpty, [{areaData: {display: {transform: {rotate: _}}}}, [me]]],
                [notEmpty, [{areaData: {display: {transform: {scale: _}}}}, [me]]]
            ]
        },

        //propagatePointerInArea: o(),

        position: {
            top: [cond, [{areaData: {position: {topOf: _}}}, [me]], o({
                on: "prev", use: {
                    point1: {
                        type: "bottom",
                        element: [prev]
                    },
                    point2: { type: "top" },
                    equals: [{areaData: {position: {top: _}}}, [me]]
                }
            }, {
                on: "embedding", use: [{areaData: {position: {top: _}}}, [me]]
            })],
            left: [cond, [{areaData: {position: {leftOf: _}}}, [me]], o({
                on: "prev", use: {
                    point1: {
                        type: "right",
                        element: [prev]
                    },
                    point2: { type: "left" },
                    equals: [{areaData: {position: {left: _}}}, [me]]
                }
            }, {
                on: "embedding", use: [{areaData: {position: {left: _}}}, [me]]
            })],
            height: [{areaData: {position: {height: _}}}, [me]],
            width: [{areaData: {position: {width: _}}}, [me]]
        },

        write: {
            onClick: {
                upon: [clickEvent, [myMessage]],
                true: {
                    setAsInspectorTarget: {
                        to: [{selected: _}, [me]],
                        merge: true
                    },
                    deselectCurrentTarget: {
                        to: [{inspectedArea: {selected: _}}, [areaOfClass, "Inspector"]],
                        merge: false
                    }
                }
            }
        }
    }, {
        qualifier: {onHover: true},
        display: {
            variant: [{onHoverDisplayChanges: _}, [me]]
        }
    }, {
        qualifier: {isBorderDefined: true},
        display: {
            borderWidth: [{areaData: {display: {borderWidth: _}}}, [me]],
            borderStyle: [{areaData: {display: {borderStyle: _}}}, [me]],
            borderColor: [{areaData: {display: {borderColor: _}}}, [me]],
            borderRadius: [{areaData: {display: {borderRadius: _}}}, [me]]
        }
    }, {
        qualifier: {isTextDefined: true},
        display: {
            text: [{areaData: {display: {text: _}}}, [me]]
        }
    }, {
        qualifier: {isImageDefined: true},
        display: {
            image: [{areaData: {display: {image: _}}}, [me]]
        }
    }, {
        qualifier: {isTriangleDefined: true},
        display: {
            triangle: [{areaData: {display: {triangle: _}}}, [me]]
        }
    }, {
        qualifier: {isBackgroundDefined: true},
        display: {
            background: [{areaData: {display: {background: _}}}, [me]]
        }
    }, {
        qualifier: {isShadowDefined: true},
        display: {
            boxShadow: [{areaData: {display: {boxShadow: _}}}, [me]]
        }
    }, {
        qualifier: {isTransformDefined: true},
        display: {
            transform: [{areaData: {display: {transform: _}}}, [me]]
        }
    }),

    AreaInterpreter1: {
        "class": "AreaInterpreter",
        children: {
            children: {
                data: [{areaData: {children: _}}, [me]],
                description: {
                    "class": "AreaInterpreter"
                }
            }
        }
    },

    AreaInterpreter2: {
        "class": "AreaInterpreter",
        children: {
            children: {
                data: [{areaData: {children: _}}, [me]],
                description: {
                    "class": "AreaInterpreter1"
                }
            }
        }
    }
};

var screenArea = {
    context: {
        "^storage": initConfig,
        "^selectedStorageIndex": 0,
        selectedStorage: [pos, [{selectedStorageIndex: _}, [me]], [{storage: _}, [me]]]
    },
    children: {
        inspector: {
            description: {
                "class": "Inspector"
            }
        },
        mainArea: {
            description: {
                "class": "AreaInterpreter2",
                context: {
                    "*selected": true,
                    areaData: [{selectedStorage: _}, [embedding]] 
                }
            }
        },
        // Selector for stored configuration
        storage: {
            description: {
                context: {
                    index: [{selectedStorageIndex: _}, [embedding]],
                    storage: [{selectedStorage: _}, [embedding]]
                },
                children: {
                    minus: {
                        description: {
                            "class": "GreyOut",
                            context: {
                                enabled: [greaterThan, [{index: _}, [embedding]], 0]
                            },
                            display: {
                                background: "black",
                                text: {
                                    color: "white",
                                    value: "-"
                                }
                            },
                            write: {
                                onClick: {
                                    upon: [and,
                                        [greaterThan, [{index: _}, [embedding]], 0],
                                        [clickEvent, [myMessage]]
                                    ],
                                    true: {
                                        prev: {
                                            to: [{index: _}, [embedding]],
                                            merge: [minus, [{index: _}, [embedding]], 1]
                                        }
                                    }
                                }
                            },
                            position: {
                                top: 0,
                                left: 0,
                                bottom: 0,
                                width: 20
                            }
                        }
                    },
                    counter: {
                        description: {
                            display: {
                                text: {
                                    fontFamily: "sans-serif",
                                    value: [{index: _}, [embedding]]
                                }
                            },
                            position: {
                                top: 0,
                                left: 20,
                                bottom: 0,
                                width: 40
                            }
                        }
                    },
                    plus: {
                        description: {
                            "class": "GreyOut",
                            context: {
                                enabled: [lessThan, [{index: _}, [embedding]], [size, [{storage: _}, [embedding, [embedding]]]]]
                            },
                            display: {
                                background: "black",
                                text: {
                                    color: "white",
                                    value: "+"
                                }
                            },
                            write: {
                                onClick: {
                                    upon: [and,
                                        [clickEvent, [myMessage]],
                                        [lessThan,
                                            [{index: _}, [embedding]],
                                            [size, [{storage: _}, [embedding, [embedding]]]]
                                        ]
                                    ],
                                    true: {
                                        next: {
                                            to: [{index: _}, [embedding]],
                                            merge: [plus, [{index: _}, [embedding]], 1]
                                        }
                                    }
                                }
                            },
                            position: {
                                top: 0,
                                left: 60,
                                bottom: 0,
                                width: 20
                            }
                        }
                    },
                    init: {
                        description: {
                            display: {
                                background: "black",
                                text: {
                                    color: "yellow",
                                    value: "╳"
                                }
                            },
                            write: {
                                onClick: {
                                    upon: [clickEvent, [myMessage]],
                                    true: {
                                        nukeStorage: {
                                            to: [{storage: _}, [embedding]],
                                            merge: initConfig
                                        }
                                    }
                                }
                            },
                            position: {
                                top: 0,
                                left: 80,
                                bottom: 0,
                                width: 20
                            }
                        }
                    }
                },
                position: {
                    top: 0,
                    right: 20,
                    width: 100,
                    height: 20
                }
            }
        }
    },
    position: {
        top: 0,
        left: 0,
        bottom: 0,
        right: 0
    }
};
