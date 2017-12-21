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
// %%foreign%%: "googlemaps.foreign.js"
// %%foreign%%: "getGeoJSON.foreign.js"

var rgb = [
    defun, o("r", "g", "b"),
    [concatStr, o("rgb(", "r", ",", "g", ",", "b", ")")]
];

var range = 0.2;

var mapr = [
    defun, "x",
    [max, [min, [round, [mul, [div, [plus, "x", range], 2 * range], 255]], 255], 0]
];

var classes = {

    TrackMouseDown: {
        context: {
            "^mouseDown": false
        },
        write: {
            onMouseDown: {
                upon: [{ type: "MouseDown" }, [myMessage]],
                true: {
                    doWrite: {
                        to: [{ mouseDown:_ }, [me]],
                        merge: true
                    }
                }
            },
            onMouseUp: {
                upon: [{ type: "MouseUp" }, [message]],
                true: {
                    continuePropagation: true,
                    doWrite: {
                        to: [{ mouseDown:_ }, [me]],
                        merge: false
                    }
                }
            }
        }
    },

    GeoFeature: {
        context: {
            featureData: [{param: {areaSetContent: _}}, [me]],
            geometry: [{featureData: {geometry: _}}, [me]],
            properties: [{featureData: {properties: _}}, [me]],
            name: [{properties: {NAME: _}}, [me]],

            associatedData: [
                {state: [{name: _}, [me]]},
                [{electionYearData: _}, [embedding, [embedding]]]
            ],

            red: [{"perc rep": _}, [{associatedData: _}, [me]]],
            blue: [{"perc dem": _}, [{associatedData: _}, [me]]],

            // Color is red when republican - democrat >= 0.2 and blue when
            // democrat - republican >= 0.2, or some interpolated shade for
            // the cases in between.
            color: [rgb,
                [mapr, [minus, [{red: _}, [me]], [{blue: _}, [me]]]],
                0,
                [mapr, [minus, [{blue: _}, [me]], [{red: _}, [me]]]]
            ]
        },
        display: {
            background: [{color: _}, [me]],
            borderWidth: 1,
            borderColor: "black",
            opacity: 0.8,
            foreign: {
                value: [{featureData: _}, [me]]
            }
        }
    },

    Slider: {
        context: {
            minRange: mustBeDefined,
            maxRange: mustBeDefined,
            "^value": [{minRange: _}, [me]]
        },
        children: {
            low: {
                description: {
                    "class": "TextStyle",
                    display: {
                        text: {
                            value: [{minRange: _}, [embedding]]
                        }
                    },
                    position: {
                        top: 0,
                        left: 0,
                        height: 20,
                        width: [displayWidth]
                    }
                }
            },
            high: {
                description: {
                    "class": "TextStyle",
                    display: {
                        text: {
                            value: [{maxRange: _}, [embedding]]
                        }
                    },
                    position: {
                        top: 0,
                        right: 0,
                        height: 20,
                        width: [displayWidth]
                    }
                }
            },
            axis: {
                description: {
                    display: {
                        borderTopColor: "grey",
                        borderTopWidth: 1,
                        borderTopStyle: "solid"
                    },
                    position: {
                        top: 10,
                        left: {
                            point1: { type: "right", element: [{children: {low: _}}, [embedding]] },
                            point2: { type: "left" },
                            equals: 6
                        },
                        height: 1,
                        right: {
                            point1: { type: "right" },
                            point2: { type: "left", element: [{children: {high: _}}, [embedding]] },
                            equals: 6
                        }
                    }
                }
            },
            marker: {
                description: {
                    "class": "Marker",
                    context: {
                        value: [{value: _}, [embedding]],
                        elt: [{children: {axis: _}}, [embedding]],
                        max: [{maxRange: _}, [embedding]],
                        min: [{minRange: _}, [embedding]],
                        stepSize: [{stepSize: _}, [embedding]]
                    }
                }
            }
        }
    },

    Marker: o({
        qualifier: "!",
        variant: {
            "class": "TrackMouseDown",
            context: {
                elt: mustBeDefined,
                max: mustBeDefined,
                min: mustBeDefined
            },
            display: {
                borderRadius: 6,
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: "darkGrey",
                background: "white"
            },
            position: {
                "vertical-center": 0,
                horizontalCenter: {
                    pair1: {
                        point1: {type: "left", element: [{elt: _}, [me]]},
                        point2: {type: "right", element: [{elt: _}, [me]]}
                    },
                    pair2: {
                        point1: {type: "left", element: [{elt: _}, [me]]},
                        point2: {type: "horizontal-center", element: [me]}
                    },
                    ratio: [div,
                            [minus, [{value: _}, [me]], [{min: _}, [me]]],
                            [minus, [{max: _}, [me]], [{min: _}, [me]]]
                           ]
                    
                },
                height: 13,
                width: 13
            }
        }
    }, {
        qualifier: {mouseDown: true},
        variant: {
            context: {
                rawMouseValue: [min,
                             [{max: _}, [me]],
                             [max,
                              [{min: _}, [me]],
                              [plus,
                               [mul,
                                [div,
                                 [offset,
                                  {type: "left", element: [{elt: _}, [me]]},
                                  {type: "left", element: [pointer]}
                                 ],
                                 [offset,
                                  {type: "left", element: [{elt: _}, [me]]},
                                  {type: "right", element: [{elt: _}, [me]]}
                                 ]
                                ],
                                [minus,
                                 [{max: _}, [me]],
                                 [{min: _}, [me]]
                                ]
                               ],
                               [{min: _}, [me]]
                              ]
                             ]
                            ]
            },
            write: {
                onClick: {
                    upon: [changed, [{mouseValue: _}, [me]]],
                    "true": {
                        doWrite: {
                            to: [{value: _}, [me]],
                            merge: [{mouseValue: _}, [me]]
                        }
                    }
                }
            }

        }
    }, {
        qualifier: {mouseDown: true, stepSize: true},
        context: {
            mouseValue: [plus,
                [
                    mul,
                    [
                        round,
                        [
                            div,
                            [minus, [{rawMouseValue: _}, [me]], [{min: _}, [me]]],
                            [{stepSize: _}, [me]]
                        ]
                    ],
                    [{stepSize: _}, [me]]
                ],
                [{min: _}, [me]]
            ]
        }
    }, {
        qualifier: {mouseDown: true, stepSize: false},
        context: {
            mouseValue: [{rawMouseValue: _}, [me]]
        }
    }),

    Bar: {
        context: {
            label: mustBeDefined,
            value: mustBeDefined,
            max: mustBeDefined,
            color: mustBeDefined
        },
        children: {
            value: {
                description: {
                    "class": "TextLabel",
                    context: {
                        value: [{value: _}, [embedding]]
                    },
                    position: {
                        bottom: {
                            point1: { type: "bottom" },
                            point2: { type: "top", element: [{children: {bar: {children: {variableBar: _}}}}, [embedding]]},
                            equals: 0
                        },
                        left: 0,
                        right: 0,
                        height: 20
                    }
                }
            },
            bar: {
                description: {
                    position: {
                        top: 20,
                        "horizontal-center": 0,
                        width: 60,
                        bottom: 20
                    },
                    children: {
                        variableBar: {
                            description: {
                                display: {
                                    background: [{color: _}, [embedding, [embedding]]]
                                },
                                position: {
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    height: {
                                        pair1: {
                                            point1: { type: "top", element: [embedding] },
                                            point2: { type: "bottom", element: [embedding] }
                                        },
                                        pair2: {
                                            point1: { type: "top" },
                                            point2: { type: "bottom" }
                                        },
                                        ratio: [div, [{value: _}, [embedding, [embedding]]],
                                                     [{max: _}, [embedding, [embedding]]]]
                                    }
                                }
                            }
                        }
                    }
                }
            },
            label: {
                description: {
                    "class": "TextLabel",
                    display: {
                        text: {
                            textAlign: "center"
                        }
                    },
                    context: {
                        value: [{label: _}, [embedding]]
                    },
                    position: {
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: 20
                    }
                }
            }
        }
    }
};

var screenArea = {
    context: {
        "^options": {
            zoom: 4,
            center: { lat: 38, lng: -96 },
            mapTypeId: 'roadmap',
            styles: o({
                    featureType: 'all',
                    elementType: 'all',
                    stylers: o({ visibility: "off" })
                }
            )
        },
        mapState: [{state: _}, [remoteStatus, [{mapPosition: _}, [me]]]],
        mapPosition: [{children: {googleMaps: {googleMaps: _}}}, [me]],
        geoJSONData: [
            { type: "FeatureCollection", features: _ },
            [
                [{getGeoJSON: _}, [foreignFunctions]],
                "https://storage.googleapis.com/mapsdevsite/json/states.js"
            ]
        ],
        electionData: [datatable, "./us-presidential-elections.csv"],
        year: [{children: {yearSlider: {value: _}}}, [me]],
        electionYearData: [
            { year: [{year: _}, [me]] },
            [{data: _}, [{electionData: _}, [me]]]
        ]
    },
    children: {
        googleMaps: {
            description: {
                context: {
                    googleMaps: [
                            [{google: {maps: _}}, [foreignFunctions]],
                            [{options: _}, [embedding]]
                        ]
                },
                display: {
                    foreign: {
                        value: [{googleMaps: _}, [me]]
                    }
                },
                children: {
                    features: {
                        data: [{geoJSONData: _}, [embedding]],
                        description: {
                            "class": "GeoFeature"
                        }
                    }
                },
                position: {
                    top: 10,
                    left: 10,
                    right: 290,
                    bottom: 40
                }
            }
        },
        yearSlider: {
            description: {
                "class": "Slider",
                context: {
                    minRange: 1992,
                    maxRange: 2016,
                    stepSize: 4
                },
                position: {
                    left: 10,
                    width: 400,
                    height: 20,
                    bottom: 10
                }
            }
        },
        evDem: {
            description: {
                "class": "Bar",
                context: {
                    label: "EV Dem",
                    value: [sum, [{electionYearData: { "ev dem":_ }}, [embedding]]],
                    max: [sum, o(
                        [sum, [{electionYearData: { "ev dem":_ }}, [embedding]]],
                        [sum, [{electionYearData: { "ev rep":_ }}, [embedding]]],
                        [sum, [{electionYearData: { "ev 3rd":_ }}, [embedding]]]
                    )],
                    color: "blue"
                },
                position: {
                    right: 10,
                    width: 60,
                    top: 10,
                    bottom: 20
                }
            }
        },
        evRep: {
            description: {
                "class": "Bar",
                context: {
                    label: "EV Rep",
                    value: [sum, [{electionYearData: { "ev rep":_ }}, [embedding]]],
                    max: [sum, o(
                        [sum, [{electionYearData: { "ev dem":_ }}, [embedding]]],
                        [sum, [{electionYearData: { "ev rep":_ }}, [embedding]]],
                        [sum, [{electionYearData: { "ev 3rd":_ }}, [embedding]]]
                    )],
                    color: "red"
                },
                position: {
                    right: 80,
                    width: 60,
                    top: 10,
                    bottom: 20
                }
            }
        },
        percDem: {
            description: {
                "class": "Bar",
                context: {
                    label: "EV Dem",
                    value: [sum, [{electionYearData: { "nr dem":_ }}, [embedding]]],
                    max: [sum, [{electionYearData: { "total":_ }}, [embedding]]],
                    color: "blue"
                },
                position: {
                    right: 150,
                    width: 60,
                    top: 10,
                    bottom: 20
                }
            }
        },
        percRep: {
            description: {
                "class": "Bar",
                context: {
                    label: "EV Rep",
                    value: [sum, [{electionYearData: { "nr rep":_ }}, [embedding]]],
                    max: [sum, [{electionYearData: { "total":_ }}, [embedding]]],
                    color: "red"
                },
                position: {
                    right: 220,
                    width: 60,
                    top: 10,
                    bottom: 20
                }
            }
        }
    }
};
