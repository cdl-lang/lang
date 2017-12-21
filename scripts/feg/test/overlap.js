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
    IntersectionParent: {
    },
    ReactToOverlap: o({
        qualifier: "!",
        variant: {
            context: {
                overlap: [overlap, [pointer], [me]]
            },
            display: {
                borderWidth: 3,
                borderColor: "grey",
                borderStyle: "solid"
            }
        }
    }, {
        qualifier: {overlap: true},
        variant: {
            display: {
                background: "gold"
            }
        }
    }, {
        qualifier: {overlap: false},
        variant: {
            display: {
                background: "grey"
            }
        }
    }),
    ReactToPointerInArea: o({
        qualifier: "!",
        variant: {
            context: {
                pointerInArea: [{param: {pointerInArea: _}}, [me]]
            },
            display: {
                borderWidth: 3,
                borderStyle: "solid"
            }
        }
    }, {
        qualifier: {pointerInArea: true},
        variant: {
            display: {
                borderColor: "blue",
            }
        }
    }, {
        qualifier: {pointerInArea: false},
        variant: {
            display: {
                borderColor: "grey"
            }
        }
    })
};

var screenArea = {
    display: {
        background: "#eeeeee"
    },
    children: {
        simpleOverlap: {
            description: {
                "class": "ReactToOverlap",
                position: {
                    top: 10,
                    left: 10,
                    height: 40,
                    width: 40
                }
            }
        },
        overlapEmbedding: {
            description: {
                "class": "ReactToOverlap",
                position: {
                    top: 10,
                    left: 60,
                    height: 80,
                    width: 80
                },
                children: {
                    inner: {
                        description: {
                            "class": "ReactToOverlap",
                            position: {
                                top: 40,
                                left: 40,
                                height: 40,
                                width: 40
                            }
                        }
                    }
                }
            }
        },
        simplePIA: {
            description: {
                "class": "ReactToPointerInArea",
                position: {
                    top: 100,
                    left: 10,
                    height: 40,
                    width: 40
                }
            }
        },
        propagateToEmbedding: {
            description: {
                "class": "ReactToPointerInArea",
                position: {
                    top: 100,
                    left: 60,
                    height: 80,
                    width: 80
                },
                children: {
                    inner: {
                        description: {
                            "class": "ReactToPointerInArea",
                            position: {
                                top: 40,
                                left: 40,
                                height: 40,
                                width: 40
                            }
                        }
                    }
                }
            }
        },
        doNotPropagateToEmbedding: {
            description: {
                "class": "ReactToPointerInArea",
                position: {
                    top: 100,
                    left: 150,
                    height: 80,
                    width: 80
                },
                children: {
                    inner: {
                        description: {
                            "class": "ReactToPointerInArea",
                            propagatePointerInArea: o(),
                            display: {
                                pointerOpaque: true
                            },
                            position: {
                                top: 40,
                                left: 40,
                                height: 40,
                                width: 40
                            }
                        }
                    }
                }
            }
        },
        parentA: {
            description: {
                "class": o("ReactToPointerInArea", "IntersectionParent", "ReactToOverlap"),
                position: {
                    top: 190,
                    left: 150,
                    height: 80,
                    width: 80
                }
            }
        },
        parentB: {
            description: {
                "class": o("ReactToPointerInArea", "ReactToOverlap"),
                position: {
                    top: 230,
                    left: 190,
                    height: 80,
                    width: 80
                },
                children: {
                    inner: {
                        partner: [areaOfClass, "IntersectionParent"],
                        description: {
                            "class": "ReactToPointerInArea",
                            propagatePointerInArea: o("expression", "referred"),
                            display: {
                                pointerOpaque: true
                            },
                            position: {
                                leftConstraint: {
                                    point1: {
                                        intersection: true,
                                        type: "left"
                                    },
                                    point2: { type: "left" },
                                    equals: 0
                                },
                                rightConstraint: {
                                    point1: { type: "right" },
                                    point2: {
                                        intersection: true,
                                        type: "right"
                                    },
                                    equals: 0
                                },
                                topConstraint: {
                                    point1: {
                                        intersection: true,
                                        type: "top"
                                    },
                                    point2: { type: "top" },
                                    equals: 20
                                },
                                bottomConstraint: {
                                    point1: {
                                        intersection: true,
                                        type: "bottom"
                                    },
                                    point2: { type: "bottom" },
                                    equals: 20
                                }
                            },
                            independentContentPosition: false
                        }
                    }
                }
            }
        }
    }
};
