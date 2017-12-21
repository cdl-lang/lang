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

// Displays two instances of google maps. Center of left and right map are
// synchronized on change via write on change. Left map can also be controlled
// via text input.

var classes = {
    MapPositionValue: o({
        "class": "LabeledTextValueInput",
        context: {
            source: [{mapPosition1: _}, [embedding]],
            valueQuery: mustBeDefined,
            value: [[{valueQuery: _}, [me]], [{source: _}, [me]]],
            editable: true,
            validFun: true,
            type: "number"
        }
    })
};

var screenArea = {
    context: {
        "^options1": {
            zoom: 3,
            center: { lat: 52.103094423347315, lng: 5.123873800039274 }
        },
        "^options2": {
            zoom: 12,
            center: { lat: 52.103094423347315, lng: 5.123873800039274 },
            styles: o(
                { elementType: 'geometry', stylers: o({ color: '#242f3e' }) },
                { elementType: 'labels.text.stroke', stylers: o({ color: '#242f3e' }) },
                { elementType: 'labels.text.fill', stylers: o({ color: '#746855' }) },
                {
                    featureType: 'administrative.locality',
                    elementType: 'labels.text.fill',
                    stylers: o({ color: '#d59563' })
                },
                {
                    featureType: 'poi',
                    elementType: 'labels.text.fill',
                    stylers: o({ color: '#d59563' })
                },
                {
                    featureType: 'poi.park',
                    elementType: 'geometry',
                    stylers: o({ color: '#263c3f' })
                },
                {
                    featureType: 'poi.park',
                    elementType: 'labels.text.fill',
                    stylers: o({ color: '#6b9a76' })
                },
                {
                    featureType: 'road',
                    elementType: 'geometry',
                    stylers: o({ color: '#38414e' })
                },
                {
                    featureType: 'road',
                    elementType: 'geometry.stroke',
                    stylers: o({ color: '#212a37' })
                },
                {
                    featureType: 'road',
                    elementType: 'labels.text.fill',
                    stylers: o({ color: '#9ca5b3' })
                },
                {
                    featureType: 'road.highway',
                    elementType: 'geometry',
                    stylers: o({ color: '#746855' })
                },
                {
                    featureType: 'road.highway',
                    elementType: 'geometry.stroke',
                    stylers: o({ color: '#1f2835' })
                },
                {
                    featureType: 'road.highway',
                    elementType: 'labels.text.fill',
                    stylers: o({ color: '#f3d19c' })
                },
                {
                    featureType: 'transit',
                    elementType: 'geometry',
                    stylers: o({ color: '#2f3948' })
                },
                {
                    featureType: 'transit.station',
                    elementType: 'labels.text.fill',
                    stylers: o({ color: '#d59563' })
                },
                {
                    featureType: 'water',
                    elementType: 'geometry',
                    stylers: o({ color: '#17263c' })
                },
                {
                    featureType: 'water',
                    elementType: 'labels.text.fill',
                    stylers: o({ color: '#515c6d' })
                },
                {
                    featureType: 'water',
                    elementType: 'labels.text.stroke',
                    stylers: o({ color: '#17263c' })
                }
            )
        },
        mapState1: [{state: _}, [remoteStatus, [{mapPosition1: _}, [me]]]],
        mapPosition1: [{children: {googleMaps1: {googleMaps: _}}}, [me]],
        mapState2: [{state: _}, [remoteStatus, [{mapPosition2: _}, [me]]]],
        mapPosition2: [{children: {googleMaps2: {googleMaps: _}}}, [me]],
        "^mapOpen": true
    },
    write: {
        map12: {
            upon: [and,
                [equal, [{mapState1: _}, [me]], "remote"],
                [changed, [{mapPosition1: {center: _}}, [me]]]
            ],
            true: {
                copyToMap2: {
                    to: [{mapPosition2: {center: _}}, [me]],
                    merge: [{mapPosition1: {center: _}}, [me]]
                }
            }
        },
        map21: {
            upon: [and,
                [equal, [{mapState2: _}, [me]], "remote"],
                [changed, [{mapPosition2: {center: _}}, [me]]]
            ],
            true: {
                copyToMap2: {
                    to: [{mapPosition1: {center: _}}, [me]],
                    merge: [{mapPosition2: {center: _}}, [me]]
                }
            }
        }
    },
    children: {
        zoomLevel: {
            description: {
                "class": "MapPositionValue",
                context: {
                    label: "zoom",
                    valueQuery: {zoom: _}
                },
                position: {
                    top: 400,
                    left: 10,
                    height: 20,
                    width: 75
                }
            }
        },
        latitude: {
            description: {
                "class": "MapPositionValue",
                context: {
                    label: "latitude",
                    valueQuery: {center: {lat: _}}
                },
                children: {
                    value:{
                        description: {
                            display: {
                                text: {
                                    numericFormat: {
                                        type: "fixed",
                                        numberOfDigits: 5
                                    }
                                }
                            }
                        }
                    }
                },
                position: {
                    top: 400,
                    left: 95,
                    height: 20,
                    width: 110
                }
            }
        },
        longitude: {
            description: {
                "class": "MapPositionValue",
                context: {
                    label: "longitude",
                    valueQuery: {center: {lng: _}}
                },
                children: {
                    value:{
                        description: {
                            display: {
                                text: {
                                    numericFormat: {
                                        type: "fixed",
                                        numberOfDigits: 5
                                    }
                                }
                            }
                        }
                    }
                },
                position: {
                    top: 400,
                    left: 215,
                    height: 20,
                    width: 110
                }
            }
        },
        readyLight: {
            description: {
                context: {
                    state: [{state: _}, [remoteStatus, [{mapPosition1: _}, [embedding]]]]
                },
                display: {
                    borderRadius: 5,
                    background: [
                        cond, [{state: _}, [me]], o(
                            { on: "remote", use: "green" },
                            { on: "waiting", use: "blue" },
                            { on: "error", use: "red" },
                            { on: null, use: "lightgrey" }
                        )
                    ]
                },
                write: {
                    onDblClick: {
                        upon: [{type: "MouseUp", subType: "DoubleClick"}, [myMessage]],
                        true: {
                            openClose: {
                                to: [{mapOpen: _}, [embedding]],
                                merge: [not, [{mapOpen: _}, [embedding]]]
                            }
                        }
                    }
                },
                position: {
                    top: 10,
                    left: 0,
                    height: 10,
                    width: 10
                }
            }
        },
        googleMaps1: {
            qualifier: { mapOpen: true },
            description: {
                context: {
                    googleMaps: [
                            [{google: {maps: _}}, [foreignFunctions]],
                            [{options1: _}, [embedding]]
                        ]
                },
                display: {
                    foreign: {
                        value: [{googleMaps: _}, [me]]
                    }
                },
                position: {
                    top: 10,
                    left: 10,
                    height: 360,
                    width: 360
                }
            }
        },
        googleMaps2: {
            qualifier: { mapOpen: true },
            description: {
                context: {
                    googleMaps: [
                            [{google: {maps: _}}, [foreignFunctions]],
                            [{options2: _}, [embedding]]
                        ]
                },
                display: {
                    foreign: {
                        value: [{googleMaps: _}, [me]]
                    }
                },
                position: {
                    top: 10,
                    left: 380,
                    height: 360,
                    width: 360
                }
            }
        },
        test1: {
            description: {
                "class": "LabeledTextValue",
                context: {
                    label: "conv",
                    value: [debugNodeToStr,
                        [
                            [{google: {offsetToGeo: _}}, [foreignFunctions]],
                            [{mapPosition1: _}, [embedding]],
                            { top: 180, left: 180}
                        ]
                    ]
                },
                position: {
                    top: 420,
                    left: 10,
                    height: 20,
                    width: 500
                }
            }
        },
        test2: {
            description: {
                "class": "LabeledTextValue",
                context: {
                    label: "conv",
                    "^value": "no click"
                },
                position: {
                    top: 440,
                    left: 10,
                    height: 20,
                    width: 500
                },
                write: {
                    writeCoordinates: {
                        upon: [{type: "GoogleMaps", subType: o("Click", "DoubleClick"), recipient: "start"}, [message]],
                        true: {
                            writeValue: {
                                to: [{value: _}, [me]],
                                merge: [debugNodeToStr, [{lat: _, lng: _}, [message]]]
                            }
                        }
                    }
                }
            }
        }
    }
};
