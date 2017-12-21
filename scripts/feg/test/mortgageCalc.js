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

/// PV * (1 - ((1 + r) ^ k - 1) / ((1 + r) ^ n - 1))
var annuityRemainder = [
    defun, o("PV", "r", "n", "k"),
    [mul,
        [minus,
            1,
            [div,
                [minus, [pow, [plus, 1, "r"], "k"], 1],
                [minus, [pow, [plus, 1, "r"], "n"], 1]
            ]
        ],
        "PV"
    ]
];
/// r * PV / (1 - (1 + r) ^ -n)
var annuityAmount = [
    defun, o("PV", "r", "n"),
    [div, [mul, "r", "PV"], [minus, 1, [pow, [plus, 1, "r"], [uminus, "n"]]]]
];
/// r * annuityRemainder(PV, r, n, k - 1)
var annuityInterest = [
    defun, o("PV", "r", "n", "k"),
    [mul, [annuityRemainder, "PV", "r", "n", [minus, "k", 1]], "r"]
];
/// amt - annuityInterest(PV, r, n, k)
var annuityPayment = [
    defun, o("PV", "r", "n", "k", "amt"),
    [minus, "amt", [annuityInterest, "PV", "r", "n", "k"]]
];
/// PV * (1 - i / n)
var linearRemainder = [
    defun, o("PV", "n", "i"),
    [mul, "PV", [minus, 1, [div, "i", "n"]]]
];
/// Repeats the same numerical value n times
var repeat = [
    defun, o("value", "n"),
    [plus, [mul, [sequence, r(1, "n")], 0], "value"]
];

var annuityTimeSeries = [
    defun, o("PV", "r", "n", "k"),
    [using,
        "amt", [annuityAmount, "PV", "r", "n"],
        {
            amount: "amt",
            interest:[annuityInterest, "PV", "r", "n", "k"], 
            payment: [annuityPayment, "PV", "r", "n", "k", "amt"],
            remainder: [annuityRemainder, "PV", "r", "n", "k"]
        }
    ]
];
var linearTimeSeries = [
    defun, o("PV", "r", "n", "k"),
    [using,
        "payment", [div, "PV", "n"],
        "interest", [mul, "r", [linearRemainder, "PV", "n", [minus, "k", 1]]],
        {
            amount: [plus, "payment", "interest"],
            interest: "interest",
            payment: "payment",
            remainder: [linearRemainder, "PV", "n", "k"]
        }
    ]
];


var classes = {
    BarGraph: o({
        context: {
            minX: mustBeDefined,
            maxX: mustBeDefined,
            minY: mustBeDefined,
            maxY: mustBeDefined,
            data: mustBeDefined,
            scaledData: [div,
                [minus, [{data: _}, [me]], [{minY: _}, [me]]],
                [minus, [{maxY: _}, [me]], [{minY: _}, [me]]]
            ]
        },
        children: {
            bar: {
                data: [{scaledData: _}, [me]],
                description: {
                    display: {
                        background: [first, [{stackColors: _}, [globalDefaults]]]
                    },
                    position: {
                        bottom: 0,
                        left: [{param: {areaSetAttr: _}}, [me]],
                        width: 1,
                        height: {
                            pair1: {
                                point1: { type: "top", element: [embedding] },
                                point2: { type: "bottom", element: [embedding] }
                            },
                            pair2: {
                                point1: { type: "top" },
                                point2: { type: "bottom" }
                            },
                            ratio: [{param: {areaSetContent: _}}, [me]]
                        }
                    }
                }
            }
        }
    }),

    DualStackedGraph: o({
        context: {
            minX: mustBeDefined,
            maxX: mustBeDefined,
            minY: mustBeDefined,
            maxY: mustBeDefined,
            data1: mustBeDefined,
            data2: mustBeDefined,
            scaledData1: [div,
                [minus, [{data1: _}, [me]], [{minY: _}, [me]]],
                [minus, [{maxY: _}, [me]], [{minY: _}, [me]]]
            ],
            scaledData2: [div,
                [minus, [{data2: _}, [me]], [{minY: _}, [me]]],
                [minus, [{maxY: _}, [me]], [{minY: _}, [me]]]
            ]
        },
        children: {
            bar1: {
                data: [{scaledData1: _}, [me]],
                description: {
                    display: {
                        background: [first, [{stackColors: _}, [globalDefaults]]]
                    },
                    position: {
                        bottom: 0,
                        left: [{param: {areaSetAttr: _}}, [me]],
                        width: 1,
                        height: {
                            pair1: {
                                point1: { type: "top", element: [embedding] },
                                point2: { type: "bottom", element: [embedding] }
                            },
                            pair2: {
                                point1: { type: "top" },
                                point2: { type: "bottom" }
                            },
                            ratio: [{param: {areaSetContent: _}}, [me]]
                        }
                    }
                }
            },
            bar2: {
                data: [{scaledData2: _}, [me]],
                description: {
                    context: {
                        prevPoint: [pos, [{param: {areaSetAttr: _}}, [me]], [{scaledData1: _}, [embedding]]]
                    },
                    display: {
                        background: [pos, 1, [{stackColors: _}, [globalDefaults]]]
                    },
                    position: {
                        bottom: {
                            point1: { type: "top", element: [pos, [{param: {areaSetAttr: _}}, [me]], [{children: {bar1: _}}, [embedding]]] },
                            point2: { type: "bottom" },
                            equals: 0
                        },
                        left: [{param: {areaSetAttr: _}}, [me]],
                        width: 1,
                        height: {
                            pair1: {
                                point1: { type: "top", element: [embedding] },
                                point2: { type: "bottom", element: [embedding] }
                            },
                            pair2: {
                                point1: { type: "top" },
                                point2: { type: "bottom" }
                            },
                            ratio: [{param: {areaSetContent: _}}, [me]]
                        }
                        // top: {
                        //     pair1: {
                        //         point1: { type: "top", element: [embedding] },
                        //         point2: { type: "bottom", element: [embedding] }
                        //     },
                        //     pair2: {
                        //         point1: { type: "top" },
                        //         point2: { type: "bottom" }
                        //     },
                        //     ratio: [plus, [{param: {areaSetContent: _}}, [me]], [{prevPoint: _}, [me]]]
                        // }
                    }
                }
            }
        }
    }),

    StackedGraphByAttributes: o({
        context: {
            minX: mustBeDefined,
            maxX: mustBeDefined,
            minY: mustBeDefined,
            maxY: mustBeDefined,
            data: mustBeDefined,
            attributes: mustBeDefined,
            stackColors: [{stackColors: _}, [globalDefaults]]
        },
        children: {
            bars: {
                data: [{data: _}, [me]],
                description: {
                    context: {
                        segments: [{param: {areaSetContent: _}}, [me]]
                    },
                    children: {
                        segments: {
                            data: [{attributes: _}, [embedding]],
                            description: {
                                context: {
                                    segmentAttribute: [{param: {areaSetContent: _}}, [me]],
                                    value: [div,
                                        [
                                            [mkProjection, [{segmentAttribute: _}, [me]]],
                                            [{segments: _}, [embedding]]
                                        ],
                                        [minus,
                                            [{maxY: _}, [embedding, [embedding]]],
                                            [{minY: _}, [embedding, [embedding]]]
                                        ]
                                    ]
                                },
                                display: {
                                    background: [pos,
                                        [{param: {areaSetAttr: _}}, [me]],
                                        [{stackColors: _}, [embedding, [embedding]]]
                                    ]
                                },
                                position: {
                                    left: 0,
                                    right: 0,
                                    bottom: [cond, [prev], o({
                                        on: true, use: {
                                            point1: { type: "top", element: [prev] },
                                            point2: { type: "bottom" },
                                            equals: 0
                                        }   
                                    }, {
                                        on: false, use: 0
                                    })],
                                    height: {
                                        pair1: {
                                            point1: { type: "top", element: [embedding] },
                                            point2: { type: "bottom", element: [embedding] }
                                        },
                                        pair2: {
                                            point1: { type: "top" },
                                            point2: { type: "bottom" }
                                        },
                                        ratio: [{value: _}, [me]]
                                    }
                                }
                            }
                        }
                    },
                    position: {
                        top: 0,
                        bottom: 0,
                        left: [{param: {areaSetAttr: _}}, [me]],
                        width: 1
                    }
                }
            }
        }
    }),

    Parameters: {
        children: {
            heading: {
                description: {
                    "class": "TextHeader",
                    context: {
                        value: "Parameters"
                    },
                    position: {
                        top: 0,
                        left: 0,
                        height: 20,
                        right: 0
                    }
                }
            },
            interestInput: {
                description: {
                    "class": o("AlignLabeledValues", "LabeledTextValueInput"),
                    context: {
                        label: "Rente",
                        value: [{interestRate: _}, [areaOfClass, "App"]],
                        editable: true,
                        type: "number",
                        validFun: true
                    },
                    position: {
                        top: 20,
                        left: 0,
                        height: 20,
                        right: 0
                    }
                }
            },
            amountInput: {
                description: {
                    "class": o("AlignLabeledValues", "LabeledTextValueInput"),
                    context: {
                        label: "Bedrag",
                        value: [{amount: _}, [areaOfClass, "App"]],
                        editable: true,
                        type: "number",
                        validFun: r(0, Infinity)
                    },
                    position: {
                        top: 40,
                        left: 0,
                        height: 20,
                        right: 0
                    }
                }
            },
            timeInput: {
                description: {
                    "class": o("AlignLabeledValues", "LabeledTextValueInput"),
                    context: {
                        label: "Looptijd",
                        value: [{nrPeriods: _}, [areaOfClass, "App"]],
                        editable: true,
                        type: "number",
                        validFun: r(1, Infinity)
                    },
                    position: {
                        top: 60,
                        left: 0,
                        height: 20,
                        right: 0
                    }
                }
            },
            typeInput: {
                description: {
                    "class": o("AlignLabeledValues", "LabeledChoiceInput"),
                    context: {
                        label: "soort",
                        value: [{type: _}, [areaOfClass, "App"]],
                        choices: o({text: "Annuïteit", value: "annuity"}, {text: "Lineair", value: "linear"}),
                        editable: true
                    },
                    position: {
                        top: 80,
                        left: 0,
                        height: 20,
                        right: 0
                    }
                }
            }
        }
    },

    TermInfo: {
        context: {
            headerText: mustBeDefined,
            posFun: mustBeDefined,
            amountPerMonth: [{amountPerMonth: _}, [embedding]],
            paymentPerMonth: [{paymentPerMonth: _}, [embedding]],
            interestPerMonth: [{interestPerMonth: _}, [embedding]]
        },
        children: {
            header: {
                description: {
                    "class": "TextHeader",
                    context: {
                        value: [{headerText: _}, [embedding]]
                    },
                    position: {
                        top: 0,
                        left: 0,
                        height: 20,
                        right: 0
                    }
                }
            },
            amount: {
                description: {
                    "class": o("AlignLabeledValues", "LabeledFixedNumberValue"),
                    context: {
                        label: "Betaling",
                        value: [[{posFun: _}, [embedding]], [{amountPerMonth: _}, [embedding]]]
                    },
                    position: {
                        top: 20,
                        left: 0,
                        height: 20,
                        right: 0
                    }
                }
            },
            payment: {
                description: {
                    "class": o("AlignLabeledValues", "LabeledFixedNumberValue"),
                    context: {
                        label: "Aflossing",
                        value: [[{posFun: _}, [embedding]], [{paymentPerMonth: _}, [embedding]]]
                    },
                    position: {
                        top: 40,
                        left: 0,
                        height: 20,
                        right: 0
                    }
                }
            },
            interest: {
                description: {
                    "class": o("AlignLabeledValues", "LabeledFixedNumberValue"),
                    context: {
                        label: "Rente",
                        value: [[{posFun: _}, [embedding]], [{interestPerMonth: _}, [embedding]]]
                    },
                    position: {
                        top: 60,
                        left: 0,
                        height: 20,
                        right: 0
                    }
                }
            }
        }
    },

    OldMortgageCalculations: {
        context: {
            amount: mustBeDefined,
            interestRatePerMonth: mustBeDefined,
            nrPeriodsInMonths: mustBeDefined,

            annuityAmountPerMonth: [annuityAmount,
                [{amount: _}, [me]],
                [{interestRatePerMonth: _}, [me]],
                [{nrPeriodsInMonths: _}, [me]]
            ],
            annuityInterestPerMonth: [
                map,
                [defun, "k",
                    [annuityInterest,
                        [{amount: _}, [me]],
                        [{interestRatePerMonth: _}, [me]],
                        [{nrPeriodsInMonths: _}, [me]],
                        "k"
                    ]
                ],
                [sequence, r(1, [{nrPeriodsInMonths: _}, [me]])]
            ],
            annuityRemainderPerMonth: [
                map,
                [defun, "k",
                    [annuityRemainder,
                        [{amount: _}, [me]],
                        [{interestRatePerMonth: _}, [me]],
                        [{nrPeriodsInMonths: _}, [me]],
                        "k"
                    ]
                ],
                [sequence, r(1, [{nrPeriodsInMonths: _}, [me]])]
            ],
            annuityPaymentPerMonth: [
                map,
                [defun, "k",
                    [annuityPayment,
                        [{amount: _}, [me]],
                        [{interestRatePerMonth: _}, [me]],
                        [{nrPeriodsInMonths: _}, [me]],
                        "k",
                        [{annuityAmountPerMonth: _}, [me]]
                    ]
                ],
                [sequence, r(1, [{nrPeriodsInMonths: _}, [me]])]
            ],

            linearPaymentPerMonth: [repeat,
                [div,
                    [{amount: _}, [me]],
                    [{nrPeriodsInMonths: _}, [me]]
                ],
                [{nrPeriodsInMonths: _}, [me]]
            ],
            linearRemainderPerMonth: [mul,
                [{amount: _}, [me]],
                [minus,
                    1,
                    [div,
                        [sequence, r(1, [{nrPeriodsInMonths: _}, [me]])],
                        [{nrPeriodsInMonths: _}, [me]]
                    ]
                ]
            ],
            linearInterestPerMonth: [mul,
                [mul,
                    [{interestRatePerMonth: _}, [me]],
                    [{amount: _}, [me]]
                ],
                [minus,
                    1,
                    [div,
                        [sequence, Rco(0, [{nrPeriodsInMonths: _}, [me]])],
                        [{nrPeriodsInMonths: _}, [me]]
                    ]
                ]
            ]
        }
    },

    MortgageCalculations: {
        context: {
            amount: mustBeDefined,
            interestRatePerMonth: mustBeDefined,
            nrPeriodsInMonths: mustBeDefined,

            annuityTimeSeries: [map,
                [defun, "k",
                    [annuityTimeSeries,
                        [{amount: _}, [me]],
                        [{interestRatePerMonth: _}, [me]],
                        [{nrPeriodsInMonths: _}, [me]],
                        "k"
                    ]
                ],
                [sequence, r(1, [{nrPeriodsInMonths: _}, [me]])]
            ],
            linearTimeSeries: [map,
                [defun, "k",
                    [linearTimeSeries,
                        [{amount: _}, [me]],
                        [{interestRatePerMonth: _}, [me]],
                        [{nrPeriodsInMonths: _}, [me]],
                        "k"
                    ]
                ],
                [sequence, r(1, [{nrPeriodsInMonths: _}, [me]])]
            ]
        }
    }

};

var screenArea = {
    "class": o("App", "MortgageCalculations", "ScrollingCanvas"),

    display: {
        background: "#EEF2F3"
    },

    context: {

        // Parameter values
        "^interestRate": 0.05,
        interestRatePerMonth: [minus, [pow, [plus, [{interestRate: _}, [me]], 1], [div, 1, 12]], 1],
        "^amount": 250000,
        "^nrPeriods": 30,
        nrPeriodsInMonths: [mul, 12, [{nrPeriods: _}, [me]]],
        "^type": "annuity",

        topmostChild: [{children: {box1: _}}, [me]],
        bottommostChild: [{children: {box2: {children: {graph2: _}}}}, [me]],

        timeSeries: [
            cond, [{type: _}, [me]], o(
                { on: "annuity", use: [{annuityTimeSeries: _}, [me]] },
                { on: "linear", use: [{linearTimeSeries: _}, [me]] }
            )
        ],

        // Display values over all months for given parameters
        remainderPerMonth: [{remainder: _}, [{timeSeries: _}, [me]]],
        interestPerMonth: [{interest: _}, [{timeSeries: _}, [me]]],
        paymentPerMonth: [{payment: _}, [{timeSeries: _}, [me]]],
        amountPerMonth: [{amount: _}, [{timeSeries: _}, [me]]]
    },

    children: {

        box1: {
            description: {
                "class": "AdaptiveHVBox",
                display: {
                    transitions: {
                        top: 0.5,
                        left: 0.5
                    }
                },
                context: {
                    maxWidth: 620,
                    maxHeight: 320,
                    spacing: 10,
                    remainderPerMonth: [{remainderPerMonth: _}, [embedding]],
                    interestPerMonth: [{interestPerMonth: _}, [embedding]],
                    paymentPerMonth: [{paymentPerMonth: _}, [embedding]],
                    amountPerMonth: [{amountPerMonth: _}, [embedding]]
                },
                position: {
                    left: 10
                },
                children: {
                    parameters: {
                        description: {
                            "class": o("Parameters", "AdaptiveHVBoxChild"),
                            context: {
                                prevElement: o()
                            },
                            position: {
                                width: 200,
                                height: 100
                            }
                        }
                    },
                    firstTerm: {
                        description: {
                            "class": o("TermInfo", "AdaptiveHVBoxChild"),
                            context: {
                                prevElement: [{children: {parameters: _}}, [embedding]],
                                headerText: "Eerste Termijn",
                                posFun: [defun, "values", [first, "values"]]
                            },
                            position: {
                                width: 200,
                                height: 80
                            }
                        }
                    },
                    lastTerm: {
                        description: {
                            "class": o("TermInfo", "AdaptiveHVBoxChild"),
                            context: {
                                prevElement: [{children: {firstTerm: _}}, [embedding]],
                                headerText: "Laatste Termijn",
                                posFun: [defun, "values", [last, "values"]]
                            },
                            position: {
                                width: 200,
                                height: 80
                            }
                        }
                    }
                }
            }
        },

        box2: {
            description: {
                "class": "AdaptiveHVBox",
                display: {
                    transitions: {
                        top: 0.5,
                        left: 0.5
                    }
                },
                context: {
                    maxWidth: [plus, [mul, [{nrPeriodsInMonths: _}, [me]], 2], [{spacing: _}, [me]]],
                    maxHeight: [plus, [mul, [{nrPeriodsInMonths: _}, [me]], 2], [{spacing: _}, [me]]],
                    spacing: 10,
                    nrPeriodsInMonths: [{nrPeriodsInMonths: _}, [embedding]],
                    amountPerMonth: [{amountPerMonth: _}, [embedding]],
                    paymentPerMonth: [{paymentPerMonth: _}, [embedding]],
                    interestPerMonth: [{interestPerMonth: _}, [embedding]],
                    remainderPerMonth: [{remainderPerMonth: _}, [embedding]],
                    timeSeries: [{timeSeries: _}, [embedding]]
                },
                position: {
                    top: {
                        point1: { type: "bottom", element: [{children: {box1: _}}, [embedding]]},
                        point2: { type: "top" },
                        equals: 10
                    },
                    left: 10
                },
                children: {
                    graph1Box: {
                        description: {
                            "class": "AdaptiveHVBoxChild",
                            context: {
                                prevElement: o()
                            },
                            position: {
                                height: 320,
                                width: [{nrPeriodsInMonths: _}, [embedding]]
                            },
                            children: {
                                header: {
                                    description: {
                                        "class": "TextHeader",
                                        context: {
                                            value: "Betaling"
                                        },
                                        position: {
                                            top: 0,
                                            left: 0,
                                            height: 20,
                                            right: 0
                                        }
                                    }
                                },
                                graph: {
                                    description: {
                                        "class": "DualStackedGraph",
                                        context: {
                                            minX: 0,
                                            maxX: [minus, [{nrPeriodsInMonths: _}, [embedding, [embedding]]], 1],
                                            minY: 0,
                                            maxY: [max, [{amountPerMonth: _}, [embedding, [embedding]]]],
                                            data1: [{paymentPerMonth: _}, [embedding, [embedding]]],
                                            data2: [{interestPerMonth: _}, [embedding, [embedding]]]
                                            // data: [{timeSeries: _}, [embedding, [embedding]]],
                                            // attributes: o("payment", "interest")
                                        },
                                        position: {
                                            top: 20,
                                            left: 0,
                                            bottom: 0,
                                            right: 0
                                        }
                                    }
                                },
                                text1: {
                                    description: {
                                        "class": "TextStyle",
                                        display: {
                                            text: {
                                                color: [{lightPrimaryColor: _}, [globalDefaults]],
                                                value: "Rente"
                                            }
                                        },
                                        position: {
                                            top: 20,
                                            left: 0,
                                            height: 20,
                                            right: 0
                                        }
                                    }
                                },
                                text2: {
                                    description: {
                                        "class": "TextStyle",
                                        display: {
                                            text: {
                                                textAlign: "right",
                                                color: [{lightPrimaryColor: _}, [globalDefaults]],
                                                value: "Aflossing"
                                            }
                                        },
                                        position: {
                                            bottom: 0,
                                            left: 0,
                                            height: 20,
                                            right: 0
                                        }
                                    }
                                }
                            }
                        }
                    },
                    graph2Box: {
                        description: {
                            "class": "AdaptiveHVBoxChild",
                            context: {
                                prevElement: [{children: {graph1Box: _}}, [embedding]]
                            },
                            position: {
                                height: 320,
                                width: [{nrPeriodsInMonths: _}, [embedding]]
                            },
                            children: {
                                header: {
                                    description: {
                                        "class": "TextHeader",
                                        context: {
                                            value: "Restschuld"
                                        },
                                        position: {
                                            top: 0,
                                            left: 0,
                                            height: 20,
                                            right: 0
                                        }
                                    }
                                },
                                graph: {
                                    description: {
                                        "class": "BarGraph",
                                        context: {
                                            minX: 0,
                                            maxX: [minus, [{nrPeriodsInMonths: _}, [embedding, [embedding]]], 1],
                                            minY: 0,
                                            maxY: [max, [{remainderPerMonth: _}, [embedding, [embedding]]]],
                                            data: [{remainderPerMonth: _}, [embedding, [embedding]]]
                                        },
                                        position: {
                                            top: 20,
                                            left: 0,
                                            bottom: 0,
                                            right: 0
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
};
