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
    DefaultFont: {
        fontSize: 11,
        fontFamily: "sans-serif"
    },

    DBItem: {
        context: {
            name: [{param: {areaSetContent: {name: _}}}, [me]]
        },
        display: {
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "black"
        },
        position: {
            top: {
                point1: { type: "bottom", element: [prev, [me]] },
                point2: { type: "top" },
                equals: 4
            },
            left: 10,
            height: 27,
            width: 200
        },
        children: {
            name: {
                description: {
                    "class": "TextEdit",
                    context: {
                        name: [{name: _}, [embedding]]
                    },
                    display: {
                        text: {
                            "class": "DefaultFont",
                            value: [{name: _}, [me]],
                            textAlign: "left"
                        }
                    },
                    position: {
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 74
                    }
                }
            },
            delete: {
                description: {
                    "class": "DeleteButton",
                    position: {
                        top: 0,
                        right: 2
                    },
                    write: {
                        onClick: {
                            true: {
                                removeDatabase: {
                                    to: [{id: [{param: {areaSetAttr: _}}, [embedding]]}, [databases]],
                                    merge: {remove: true}
                                },
                                show: {
                                    to: [{selectedDatabaseId: _}, [embedding, [embedding]]],
                                    merge: o()
                                },
                                info: {
                                    to: [{infoDatabaseId: _}, [embedding, [embedding]]],
                                    merge: o()
                                }
                            }
                        }
                    }
                }
            },
            show: {
                description: {
                    "class": "ShowButton",
                    position: {
                        top: 0,
                        right: 26
                    },
                    write: {
                        onClick: {
                            true: {
                                show: {
                                    to: [{selectedDatabaseId: _}, [embedding, [embedding]]],
                                    merge: [{param: {areaSetAttr: _}}, [embedding]]
                                },
                                info: {
                                    to: [{infoDatabaseId: _}, [embedding, [embedding]]],
                                    merge: o()
                                }
                            }
                        }
                    }
                }
            },
            info: {
                description: {
                    "class": "InfoButton",
                    position: {
                        top: 0,
                        right: 50
                    },
                    write: {
                        onClick: {
                            true: {
                                show: {
                                    to: [{selectedDatabaseId: _}, [embedding, [embedding]]],
                                    merge: o()
                                },
                                info: {
                                    to: [{infoDatabaseId: _}, [embedding, [embedding]]],
                                    merge: [{param: {areaSetAttr: _}}, [embedding]]
                                }
                            }
                        }
                    }
                }
            }
        }
    },

    TextEdit: o({
        qualifier: "!",
        variant: {
            context: {
                "*edit": false
            },
            display: {
                text: {
                    value: [{name: _}, [me]]
                }
            }
        }
    }, {
        qualifier: {edit: false},
        variant: {
            write: {
                onClick: {
                    upon: [{ subType: "DoubleClick" }, [myMessage]],
                    "true": {
                        beginEdit: {
                            to: [{ edit:_ }, [me]],
                            merge: true
                        }
                    }
                }
            }
        }
    }, {
        qualifier: {edit: true},
        variant: {
            display: {
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: "black",
                padding: 2,
                text: {
                    input: {
                        type: "text"
                    }
                }
            },
            write: {
                onEnter: {
                    upon: [{type: "KeyDown", key: "Return"}, [myMessage]],
                    "true": {
                        updateText: {
                            to: [{name: _}, [me]],
                            merge: [{param: {input: {value: _}}}, [me]]
                        },
                        endEdit: {
                            to: [{ edit:_ }, [me]],
                            merge: false
                        }
                    }
                }
            }
        }
    }),
    TextIconButton: {
        display: {
            text: {
                fontSize: 18
            }
        },
        position: {
            width: 22,
            height: 22
        },
        write: {
            onClick: {
                upon: [{subType: "Click"}, [myMessage]]
            }
        }
    },
    DeleteButton: {
        "class": "TextIconButton",
        display: {
            text: {
                value: "❎"
            }
        }
    },
    ShowButton: {
        "class": "TextIconButton",
        display: {
            text: {
                value: "🔎"
            }
        }
    },
    InfoButton: {
        "class": "TextIconButton",
        display: {
            text: {
                value: "ℹ️"
            }
        }
    },

    DataRow: {
        context: {
            value: [{param: {areaSetContent: _}}, [me]]
        },
        display: {
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "black",
            text: {
                "class": "DefaultFont",
                value: [debugNodeToStr, [{value: _}, [me]]],
                textAlign: "left"
            }
        },
        position: {
            top: {
                point1: { type: "bottom", element: [prev, [me]] },
                point2: { type: "top" },
                equals: -1
            },
            left: 250,
            height: 27,
            width: 500
        }
    }
};

var screenArea = {
    context: {
        "*selectedDatabaseId": o(),
        "*infoDatabaseId": o(),
        data: [database, [{selectedDatabaseId: _}, [me]]],
        nrItems: [size, [{data: _}, [me]]]
    },
    position: {
        firstDbList: {
            point1: { type: "top" },
            point2: { type: "top", element: [first, [{children: {dbList: _}}, [me]]] },
            equals: 10
        },
        firstDataRow: {
            point1: { type: "bottom", element: [{children: {dataCounter: _}}, [me]]},
            point2: { type: "top", element: [first, [{children: {dataList: _}}, [me]]] },
            equals: 10
        },
        firstInfoRow: {
            point1: { type: "bottom", element: [{children: {dataCounter: _}}, [me]]},
            point2: { type: "top", element: [first, [{children: {dbInfo: _}}, [me]]] },
            equals: 10
        }
    },
    children: {
        dbList: {
            data: [identify, {id: _}, [databases]],
            description: {
                "class": "DBItem"
            }
        },
        dataCounter: {
            description: {
                display: {
                    text: {
                        value: [concatStr, o([{nrItems: _}, [embedding]], " items")]
                    }
                },
                position: {
                    top: 10,
                    left: 250,
                    width: 500,
                    height: 20
                }
            }
        },
        dataList: {
            data: [pos, r(0, 9), [{data: _}, [me]]],
            description: {
                "class": "DataRow"
            }
        },
        dbInfo: {
            qualifier: {infoDatabaseId: true},
            data: o(
                {id: [{infoDatabaseId: _}, [me]]},
                [{attributes: _, id: [{infoDatabaseId: _}, [me]]}, [databases]]
            ),
            description: {
                "class": "DataRow"
            }
        }
    }
};