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

var initGlobalDefaults = {
    darkPrimaryColor: "#0097A7",
    primaryColor: "#00BCD4",
    lightPrimaryColor: "#B2EBF2",
    iconText: "#FFFFFF",
    accentColor: "#009688",
    primaryText: "#212121",
    secondaryText: "#757575",
    divider: "#BDBDBD",
    errorText: "red",
    stackColors: ["hsl(40,30%,66%)", "hsl(185,50%,66%)"]
}

var mkProjection = [defun, "attribute", {"#attribute": _}];
var mkSelection = [defun, o("attribute", "selection"), {"#attribute": "selection"}];

var mouseDownEvent = [{type: "MouseDown"}, [myMessage]];
var clickEvent = [{type: "MouseUp", subType: o("Click", "DoubleClick")}, [myMessage]];
var wheelEvent = [{type: "Wheel"}, [myMessage]];

var dragPriorities = {
    // priority of attachement of pointer to dragged element while dragging
    draggingPriority: -10,
    // priorities of offsets to be modified by dragging when no dragging
    // takes place this is the default priority assumed to be used by other
    // constraints which should not change during dragging)
    noDragPriority: 0,
    // priorities of offsets to be modified by dragging when dragging
    // takes place. This should be weak enough to allow the offset to change.
    dragPriority: -20,
    // the priority for wrapping constraints (constraints which wrap draggable
    // areas) when no dragging takes place. This needs to be stronger than
    // the dragPriority (so as not to change when there is no dragging)
    // but stronger than the noDrag priority (as it should only wrap, not
    // force any positioning).
    wrapPriority: -15
};

var classes = {

    // Empty class to mark App area
    App: {
    },

    Clickable: o(
        {
            context: {
                "^selected": false
            }
        },
        {
            qualifier: { selected: false },
            write: {
                onClickableMouseDown: {
                    upon: [{ type: "MouseDown" }, [myMessage]],
                    true: {
                        selected: {
                            to: [{selected: _ }, [me]],
                            merge: true
                        }
                    }
                }
            }
        },
        {
            qualifier: { selected: true },
            write: {
                onClickableMouseUp: {
                    upon: [{ type: "MouseUp", recipient: "end" }, [message]],
                    true: {
                        selected: {
                            to: [{selected: _ }, [me]],
                            merge: false
                        }
                    }
                }
            }
        }
    ),

    Draggable: o(
        {    
            "class": "Clickable",
            context: {
                verticallyDraggable: true, // default value
                draggedVerticalEdge: { type: "top" }, // default 
                horizontallyDraggable: true, // default value
                draggedHorizontalEdge: { type: "left" }, // default 
                draggingPriority: dragPriorities.draggingPriority,

                // 'selected' is defined by "Clickable" when the mouse is
                // down, "beingDragged" is for dragging purposes (and
                // for now, they are the same).
                beingDragged: [{ selected: _ }, [me]],
                
                "^mouseDownX": 0,
                "^mouseDownY": 0
            }
        },
        {
            qualifier: { beingDragged: false,
                         verticallyDraggable: true },
            write: {
                onDraggableMouseDown: {
                    upon: [{ type: "MouseDown" }, [myMessage]],
                    true: {
                        writeY: {
                            to: [{mouseDownY: _ }, [me]],
                            merge: [offset,
                                    [{ draggedVerticalEdge: _ }, [me]],
                                    { type: "top", element: [pointer] }]
                        }
                    }
                }
            }
        }, 
        {
            qualifier: { beingDragged: false,
                         horizontallyDraggable: true },
            write: {
                onDraggableMouseDown: {
                    upon: [{ type: "MouseDown" }, [myMessage]],
                    true: {
                        writeX: {
                            to: [{mouseDownX: _ }, [me]],
                            merge: [offset,
                                    [{ draggedHorizontalEdge: _ }, [me]],
                                    { type: "left", element: [pointer] }]
                        }
                    }
                }
            }
        },
        {
            qualifier: { beingDragged: true,
                         verticallyDraggable: true },
            position: {
                topDrag: {
                    point1: [{ draggedVerticalEdge: _ }, [me]],
                    point2: { type: "top", element: [pointer] },
                    equals: [{ mouseDownY: _ }, [me]],
                    priority: [{ draggingPriority: _ }, [me]]
                }
            }
        }, 
        {
            qualifier: { beingDragged: true,
                         horizontallyDraggable: true },
            position: {
                leftDrag: {
                    point1: [{ draggedHorizontalEdge: _ }, [me]],
                    point2: { type: "left", element: [pointer] },
                    equals: [{ mouseDownX: _ }, [me]],
                    priority: [{ draggingPriority: _ }, [me]]
                }
            }
        }
    ),

    BlockMouseDownFromPropagating: {
        write: {
            onBlockMouseDownFromPropagatingEvt: {
                upon: mouseDownEvent,
                true: {
                    continuePropagation: false
                }
            }
        }
    },

    DisplayWidth: {
        context: {
            displayWidth: [displayWidth]
        }
    },

    TextStyle: {
        display: {
            text: {
                fontFamily: "sans-serif",
                fontSize: 13,
                textAlign: "left"
            }
        }
    },

    LabelTextStyle: {
        "class": "TextStyle",
        display: {
            text: {
                textAlign: "left",
                fontWeight: 700,
                color: [{secondaryText: _}, [globalDefaults]]
            }
        }
    },

    ValueTextStyle: {
        "class": "TextStyle",
        display: {
            text: {
                textAlign: "left",
                fontWeight: 300,
                overflow: "ellipsis",
                whiteSpace: "nowrap",
                color: [{primaryText: _}, [globalDefaults]]
            }
        }
    },

    HeaderTextStyle: {
        "class": "TextStyle",
        display: {
            background: [{darkPrimaryColor: _}, [globalDefaults]],
            text: {
                textAlign: "center",
                fontWeight: 700,
                color: [{iconText: _}, [globalDefaults]]
            }
        }
    },

    /// Unpositioned text with LabelTextStyle. Displayed text must be in value.
    TextLabel: {
        "class": "LabelTextStyle",
        context: {
            value: mustBeDefined
        },
        display: {
            text: {
                value: [{value: _}, [me]]
            }
        }
    },

    /// Unpositioned text with ValueTextStyle. Displayed text must be in value.
    TextValue: {
        "class": "ValueTextStyle",
        context: {
            value: mustBeDefined
        },
        display: {
            text: {
                value: [{value: _}, [me]]
            }
        }
    },

    /// Unpositioned text with LabelTextStyle. Displayed text must be in value.
    TextHeader: {
        "class": "HeaderTextStyle",
        context: {
            value: mustBeDefined
        },
        display: {
            text: {
                value: [{value: _}, [me]]
            }
        }
    },

    /// Unpositioned text input; writes to value; type can be "text" or "number".
    TextValueInput: {
        context: {
            value: mustBeDefined,
            type: mustBeDefined
        },
        display: {
            borderBottomColor: [{primaryText: _}, [globalDefaults]],
            borderBottomWidth: 1,
            borderBottomStyle: "solid",
            text: {
                input: {
                    type: [{type: _}, [me]]
                }
            }
        },
        write: {
            onAcceptEdit: {
                upon: o(
                    [{type: "MouseDown", recipient: n("start", [me], "end")}, [message]],
                    [{type: "KeyDown", key: "Return"}, [myMessage]]
                ),
                true: {
                    writeValue: {
                        to: [{value: _}, [me]],
                        merge: [{param: {input: {value: _}}}, [me]]
                    },
                    endEdit: {
                        to: [{editMode: _}, [embedding]],
                        merge: false
                    }
                }
            },
            onRevert: {
                upon: [{type: "KeyDown", key: "Esc"}, [myMessage]],
                true: {
                    endEdit: {
                        to: [{editMode: _}, [embedding]],
                        merge: false
                    }
                }
            },
            blockAllMouseEvents: {
                upon: [{type: o("MouseDown", "MouseUp", "MouseGestureExpired")}, [myMessage]],
                true: {
                    continuePropagation: false
                }
            }
        }
    },

    LabeledValue: {
        "class": "BlockMouseDownFromPropagating",
        context: {
            label: mustBeDefined,
            value: mustBeDefined
        },
        children: {
            label: {
                description: {
                    "class": o("TextLabel", "DisplayWidth"),
                    context: {
                        value: [{label: _}, [embedding]]
                    },
                    position: {
                        top: 0,
                        left: 0,
                        bottom: 0,
                        width: [{displayWidth: _}, [me]]
                    }
                }
            },
            value: {
                description: {
                    context: {
                        value: [{value: _}, [embedding]]
                    },
                    position: {
                        top: 0,
                        left: {
                            point1: { type: "right", element: [{children: {label: _}}, [embedding]] },
                            point2: { type: "left" },
                            equals: 4
                        },
                        bottom: 0,
                        right: 0
                    }
                }
            }
        }
    },

    AlignLabeledValues: {
        context: {
            labelGroup: [embedded, [embedding]],
            labels: [{children: {label: _}}, [{labelGroup: _}, [me]]],
            labelWidth: [max, [{displayWidth: _}, [{labels: _}, [me]]]]
        },
        children: {
            label: {
                description: {
                    position: {
                        width: [{labelWidth: _}, [embedding]]
                    }
                }
            }
        }
    },

    /// Displays a label and a text value
    LabeledTextValue: {
        "class": "LabeledValue",
        children: {
            value: {
                description: {
                    "class": "TextValue"
                }
            }
        }
    },

    LabeledFixedNumberValue: {
        "class": "LabeledTextValue",
        children: {
            value: {
                description: {
                    display: {
                        text: {
                            numericFormat: {
                                type: "fixed",
                                numberOfDigits: 2,
                                useGrouping: true
                            }
                        }
                    }
                }
            }
        }
    },

    LabeledMonetaryValue: {
        "class": "LabeledTextValue",
        children: {
            value: {
                description: {
                    display: {
                        text: {
                            textAlign: "right",
                            numericFormat: {
                                type: "intl",
                                numberOfDigits: 2,
                                style: "currency",
                                currency: "EUR",
                                currencyDisplay: "symbol",
                                useGrouping: true
                            }
                        }
                    }
                }
            }
        }
    },

    /// Displays a label and a clickable URL
    LabelURL: {
        context: {
            label: mustBeDefined,
            value: mustBeDefined
        },
        children: {
            label: {
                description: {
                    "class": "TextLabel",
                    context: {
                        value: [{label: _}, [embedding]]
                    },
                    position: {
                        top: 0,
                        left: 0,
                        bottom: 0,
                        width: [displayWidth]
                    }
                }
            },
            value: {
                description: {
                    context: {
                        value: [concatStr, o(
                            "<a href=\"",
                            [{value: _}, [embedding]],
                            "\">",
                            [{value: _}, [embedding]],
                            "</a>"
                        )]
                    },
                    display: {
                        html: {
                            fontFamily: "sans-serif",
                            fontSize: 13,
                            fontWeight: 300,
                            value: [{value: _}, [me]]
                        }
                    },
                    position: {
                        left: {
                            point1: { type: "right", element: [{children: {label: _}}, [embedding]] },
                            point2: { type: "left" },
                            equals: 4
                        },
                        top: 0,
                        bottom: 0,
                        right: 0
                    }
                }
            }
        }
    },

    /// Adds validation to a value, and switch to edit mode on click
    EditableValidatingInputChild: o({
        context: {
            "*editMode": false,
            editable: mustBeDefined,
            validFun: mustBeDefined,
            valueIsValid: [
                [{validFun: _}, [me]],
                [cond, [{editMode: _}, [me]], o(
                    { on: true, use: [{children: {value: {param: {input: {value: _}}}}}, [me]] },
                    { on: false, use: [{value: _}, [me]] }
                )]
            ]
        },
        children: {
            value: {
                description: {
                    display: {
                        borderBottomColor: [cond, [{valueIsValid: _}, [embedding]], o(
                                { on: true, use: [{primaryText: _}, [globalDefaults]] },
                                { on: false, use: [{errorText: _}, [globalDefaults]] }
                            )],
                        text: {
                            color: [cond, [{valueIsValid: _}, [embedding]], o(
                                { on: true, use: [{primaryText: _}, [globalDefaults]] },
                                { on: false, use: [{errorText: _}, [globalDefaults]] }
                            )]
                        }
                    }
                }
            }
        }
    }, {
        qualifier: {editable: true, editMode: false},
        write: {
            onClick: {
                upon: [{type: "MouseUp", subType: "Click"}, [myMessage]],
                true: {
                    switchToEditMode: {
                        to: [{editMode: _}, [me]],
                        merge: true
                    }
                }
            }
        }
    }),

    EditableValidatingTextInputChild: o({
        qualifier: "!",
        "class": "EditableValidatingInputChild",
        context: {
            type: mustBeDefined
        }
    }, {
        qualifier: {editable: true, editMode: true},
        children: {
            value: {
                description: {
                    "class": "TextValueInput",
                    context: {
                        type: [{type: _}, [embedding]]
                    }
                }
            }
        }
    }),

    LabeledTextValueInput: {
        "class": o("EditableValidatingTextInputChild", "LabeledTextValue")
    },

    LeftAnchoredFloatingWindow: {
        independentContentPosition: false,
        embedding: "referred",
        context: {
            anchor: [expressionOf]
        },
        children: {
            body: {
                description: {
                    display: {
                        background: "white",
                        borderRadius: 6,
                        boxShadow: {
                            horizontal: 0,
                            vertical: 0,
                            blurRadius: 10,
                            color: "grey"
                        }
                    },
                    position: {
                        top: 2,
                        left: 21,
                        right: 2
                    }
                }
            },
            tip: {
                description: {
                    display: {
                        triangle: {
                            baseSide: "right",
                            color: "white",
                            shadow: {
                                color: "grey",
                                blurRadius: 1,
                                horizontal: -1,
                                vertical: 1
                            }
                        }
                    },
                    position: {
                        left: 2,
                        verticalCenter: {
                            point1: { element: [{anchor: _}, [embedding]], type: "vertical-center" },
                            point2: { type: "vertical-center" },
                            equals: 0,
                            priority: -1
                        },
                        width: 19,
                        height: 20
                    }
                }
            }
        },
        position: {
            left: {
                point1: { element: [{anchor: _}, [me]], type: "right" },
                point2: { type: "left" },
                equals: 1
            },
            bottom: {
                point1: { element: [{children: {body: _}}, [me]], type: "bottom" },
                point2: { type: "bottom" },
                equals: 2
            },
            verticalCenter: {
                point1: { element: [{anchor: _}, [me]], type: "vertical-center" },
                point2: { type: "vertical-center" },
                equals: 0,
                priority: -1
            },
            belowEmbeddingTop: {
                point1: { element: [embedding], type: "top" },
                point2: { type: "top" },
                min: 0,
                priority: 2
            },
            aboveEmbeddingBottom: {
                point1: { type: "bottom" },
                point2: { element: [embedding], type: "bottom" },
                min: 0,
                priority: 1
            }
        },
        stacking: {
            aboveSiblings: {
                lower: [embedded, [embedding]],
                higher: [me]
            }
        }
    },

    MenuItemStyle: o({
        "class": "TextStyle",
        context: {
            choice: mustBeDefined,
            pointerInArea: [{param: {pointerInArea: _}}, [me]],
            highlight: false
        },
        display: {
            paddingLeft: 4,
            paddingRight: 4,
            text: {
                value: [{choice: {text: _}}, [me]]
            }
        },
        position: {
            left: 0,
            right: 0,
            height: 18
        }
    }, {
        qualifier: { pointerInArea: true },
        display: {
            background: "#cee6bc"
        }
    }, {
        qualifier: { highlight: true },
        display: {
            background: "grey",
            text: {
                color: "white"
            }
        }
    }),

    PopUpMenu: o({
        context: {
            choices: mustBeDefined,
            openControl: mustBeDefined,
            /// Used to determine the current value and to 
            value: mustBeDefined,
            closeMenuOnSelection: true
        },
        children: {
            body: {
                description: {
                    children: {
                        options: {
                            data: [{choices: _}, [embedding]],
                            description: {
                                "class": o("DisplayWidth", "MenuItemStyle"),
                                context: {
                                    choice: [{param: {areaSetContent: _}}, [me]],
                                    highlight: [equal, [{choice: {value: _}}, [me]], [{value: _}, [embedding, [embedding]]]]
                                },
                                propagatePointerInArea: o(),
                                position: {
                                    top: {
                                        point1: { type: "bottom", element: [prev] },
                                        point2: { type: "top" },
                                        equals: 0
                                    }
                                },
                                write: {
                                    onMouseDown: {
                                        upon: [{type: "MouseDown"}, [myMessage]],
                                        true: {
                                            continuePropagation: false
                                        }
                                    },
                                    onClick: {
                                        upon: [{type: "MouseUp", subType: "Click"}, [myMessage]],
                                        true: {
                                            writeValue: {
                                                to: [{value: _}, [embedding, [embedding]]],
                                                merge: [{choice: {value: _}}, [me]]
                                            }
                                        }
                                    },
                                    onClick2: {
                                        upon: [and,
                                            [{closeMenuOnSelection: _}, [embedding, [embedding]]],
                                            [{type: "MouseUp", subType: "Click"}, [myMessage]]
                                        ],
                                        true: {
                                            writeValue: {
                                                to: [{openControl: _}, [embedding, [embedding]]],
                                                merge: false
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    position: {
                        firstChild: {
                            point1: { type: "top" },
                            point2: { type: "top", element: [first, [{children: {options: _}}, [me]]] },
                            equals: 0
                        },
                        width: [plus, [max, [{displayWidth: _}, [{children: {options: _}}, [me]]]], 4],
                        bottom: {
                            point1: { type: "bottom", element: [last, [{children: {options: _}}, [me]]] },
                            point2: { type: "bottom" },
                            equals: 0
                        }
                    }
                }
            }
        },
        write: {
            onAnyClickElsewhereOrEscape: {
                upon: [o(
                    {
                        type: "MouseDown",
                        recipient: n("start", "end", [embeddedStar], [me])
                    },
                    {
                        type: "KeyDown",
                        key: "Esc"
                    }
                 ), [message]],
                true: {
                    continuePropagation: false,
                    closeMenu: {
                        to: [{openControl: _}, [me]],
                        merge: false
                    }
                }
            }
        }
    }),

    EditableChoiceInputChild: o({
        qualifier: "!",
        "class": "EditableValidatingInputChild",
        context: {
            choices: mustBeDefined,
            validFun: true
        },
        children: {
            value: {
                description: {
                    display: {
                        borderBottomColor: [cond, [{valueIsValid: _}, [embedding]], o(
                                { on: true, use: [{primaryText: _}, [globalDefaults]] },
                                { on: false, use: [{errorText: _}, [globalDefaults]] }
                            )],
                        text: {
                            value: [{value: [{value: _}, [me]], text: _}, [{choices: _}, [embedding]]]
                        }
                    }
                }
            }
        }
    }, {
        qualifier: {editable: true, editMode: true},
        children: {
            value: {
                description: {
                    children: {
                        popupMenu: {
                            partner: [areaOfClass, "App"],
                            description: {
                                "class": o("PopUpMenu", "LeftAnchoredFloatingWindow", "BlockMouseDownFromPropagating"),
                                context: {
                                    choices: [{choices: _}, [embedding, [expressionOf]]],
                                    openControl: [{editMode: _}, [embedding, [expressionOf]]],
                                    value: [{value: _}, [embedding, [expressionOf]]]
                                }
                            }
                        }
                    }
                }
            }
        }
    }),

    /// Label plus value set by pop-up menu
    LabeledChoiceInput: {
        "class": o("EditableChoiceInputChild", "LabeledTextValue")
    },

    /// A simple container for placing children horizontally or vertically
    AdaptiveHVBox: {
        context: {
            maxWidth: mustBeDefined,
            maxHeight: mustBeDefined,
            availableWidth: [offset, {type: "left", element: [embedding]}, {type: "right", element: [embedding]}],
            availableHeight: [offset, {type: "top", element: [embedding]}, {type: "bottom", element: [embedding]}],
            spacing: mustBeDefined,
            orientation: [cond, [lessThan, [{availableWidth: _}, [me]], [{maxWidth: _}, [me]]], o(
                { on: true, use: "vertical" },
                { on: false, use: "horizontal" }
            )]
        },
        position: {
            bottom: {
                point1: { type: "bottom", element: [embedded] },
                point2: { type: "bottom" },
                min: 0
            },
            right: {
                point1: { type: "right", element: [embedded] },
                point2: { type: "right" },
                min: 0
            }
        }
    },

    /// Positions a child's top/left inside an AdaptiveHVBox
    AdaptiveHVBoxChild: o({
        context: {
            prevElement: mustBeDefined,
            orientation: [{orientation: _}, [embedding]]
        },
        display: {
            transitions: {
                top: 0.5,
                left: 0.5
            }
        },
        position: {
            tallestChildDefinesParentBottom: {
                point1: { type: "bottom" },
                point2: { type: "bottom", element: [embedding] },
                equals: 0,
                orGroups: { element: [embedding], label: "defineParentBottom" }
            },
            widestChildDefinesParentBottom: {
                point1: { type: "right" },
                point2: { type: "right", element: [embedding] },
                equals: 0,
                orGroups: { element: [embedding], label: "defineParentRight" }
            }
        }
    }, {
        qualifier: { prevElement: false },
        position: {
            top: 0,
            left: 0
        }
    }, {
        qualifier: { prevElement: true },
        position: {
            wrtEmbedding: {
                point1: { type: [{embEdgeLabel: _}, [me]], element: [{prevElement: _}, [me]] },
                point2: { type: [{embEdgeLabel: _}, [me]] },
                equals: 0
            },
            wrtPrev: {
                point1: { type: [{prevEdgeLabel: _}, [me]], element: [{prevElement: _}, [me]] },
                point2: { type: [{nextEdgeLabel: _}, [me]] },
                equals: [{spacing: _}, [embedding]]
            }
        }
    }, {
        qualifier: { orientation: "horizontal" },
        context: {
            prevEdgeLabel: "right",
            nextEdgeLabel: "left",
            embEdgeLabel: "top"
        }
    }, {
        qualifier: { orientation: "vertical" },
        context: {
            prevEdgeLabel: "bottom",
            nextEdgeLabel: "top",
            embEdgeLabel: "left"
        }
    }),

    ScrollingCanvas: o({
        context: {
            topmostChild: mustBeDefined,
            bottommostChild: mustBeDefined,
            "*scrollOffset": 0,
            offsetFromTopToCenterTopmostChild: [offset,
                { type: "top" },
                { type: "vertical-center", element: [{topmostChild: _}, [me]] }
            ],
            offsetFromCenterBottommostChildToBottom: [offset,
                { type: "vertical-center", element: [{bottommostChild: _}, [me]] },
                { type: "bottom" }
            ],
            elementHeight: [offset, { type: "top" }, { type: "bottom" }],
            totalContentHeight: [offset,
                { type: "top", element: [{topmostChild: _}, [me]] },
                { type: "bottom", element: [{bottommostChild: _}, [me]] }
            ],
            contentFits: [lessThanOrEqual, [{totalContentHeight: _}, [me]], [{elementHeight: _}, [me]]],
            "*offsetFromPointer": o()
        }
    }, {
        qualifier: { contentFits: false },
        position: {
            // Don't allow topmostChild to go below top, or bottommost above bottom
            blockTopmost: {
                point1: { type: "top", element: [{topmostChild: _}, [me]] },
                point2: { type: "top" },
                min: 0,
                priority: 1
            },
            blockBottommost: {
                point1: { type: "bottom" },
                point2: { type: "bottom", element: [{bottommostChild: _}, [me]] },
                min: 0,
                priority: 1
            }
        },
        write: {
            onWheel: {
                upon: wheelEvent,
                true: {
                    scroll: {
                        to: [{scrollOffset: _}, [me]],
                        merge: [
                            min,
                            [
                                max,
                                [plus, [{scrollOffset: _}, [me]], [{deltaY: _}, [myMessage]]],
                                [minus, [{elementHeight: _}, [me]], [{totalContentHeight: _}, [me]]]
                            ],
                            0
                        ]
                    }
                }
            }
        }
    }, {
        // When the mouse isn't dragging, fix the scroll distance
        qualifier: { contentFits: false, offsetFromPointer: false },
        position: {
            scrollTopmostChild: {
                point1: { type: "top" },
                point2: { type: "top", element: [{topmostChild: _}, [me]] },
                equals: [{scrollOffset: _}, [me]]
            }
        },
        write: {
            onMouseDown: {
                upon:mouseDownEvent,
                true: {
                    recordOffsetFromPointer: {
                        to: [{offsetFromPointer: _}, [me]],
                        merge: [offset,
                            { type: "top", element: [{topmostChild: _}, [me]] },
                            { type: "top", element: [pointer] }
                        ]
                    }
                }
            }
        }
    }, {
        // When the mouse is dragging, keep the distance between top and mouse
        qualifier: { contentFits: false, offsetFromPointer: true },
        position: {
            lockToPointer: {
                point1: { type: "top", element: [{topmostChild: _}, [me]] },
                point2: { type: "top", element: [pointer] },
                equals: [{offsetFromPointer: _}, [me]]
            }
        },
        write: {
            onMouseUp: {
                upon: [{type: "MouseUp"}, [message]],
                true: {
                    clearOffsetFromPointer: {
                        to: [{offsetFromPointer: _}, [me]],
                        merge: o()
                    },
                    recordOffsetFromTop: {
                        to: [{scrollOffset: _}, [me]],
                        merge: [offset,
                            { type: "top" },
                            { type: "top", element: [{topmostChild: _}, [me]] }
                        ]
                    }
                }
            }
        }
    }, {
        qualifier: { contentFits: false, offsetFromTopToCenterTopmostChild: r(-Infinity, 0) },
        children: {
            arrowUp: {
                description: {
                    display: {
                        pointerOpaque: true,
                        image: {
                            src: "design/img/arrowup.svg",
                            size: 1
                        }
                    },
                    position: {
                        height: 32,
                        width: 32,
                        top: 0,
                        right: 0
                    },
                    write: {
                        onMouseDown: {
                            upon: mouseDownEvent,
                            true: {
                                continuePropagation: false
                            }
                        },
                        onClick: {
                            upon: clickEvent,
                            true: {
                                scrollUp: {
                                    to: [{scrollOffset: _}, [embedding]],
                                    merge: 0
                                }
                            }
                        }
                    }
                }
            }
        }
    }, {
        qualifier: { contentFits: false, offsetFromCenterBottommostChildToBottom: r(-Infinity, 0) },
        children: {
            arrowDown: {
                description: {
                    display: {
                        pointerOpaque: true,
                        image: {
                            src: "design/img/arrowdown.svg",
                            size: 1
                        }
                    },
                    position: {
                        height: 32,
                        width: 32,
                        bottom: 0,
                        right: 0
                    },
                    write: {
                        onMouseDown: {
                            upon: mouseDownEvent,
                            true: {
                                continuePropagation: false
                            }
                        },
                        onClick: {
                            upon: clickEvent,
                            true: {
                                continuePropagation: false,
                                scrollUp: {
                                    to: [{scrollOffset: _}, [embedding]],
                                    merge: [minus, [{elementHeight: _}, [embedding]], [{totalContentHeight: _}, [embedding]]]
                                }
                            }
                        }
                    }
                }
            }
        }
    })
};
