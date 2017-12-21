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
    FileInput: {
        context: {
            fileObj: [{children: {dropButton: {param: {input: {value: _}}}}}, [me]],
            beingDraggedOver: [{children: {dropButton: {param: {input: {draggedOver: _}}}}}, [me]],
            hasDropped: [{children: {dropButton: {param: {input: {dropped: _}}}}}, [me]]
        },
        children: {
            dropButton: {
                description: {
                    display: {
                        opacity: 0,
                        text: {
                            input: {
                                type: "file"
                            }
                        }
                    },
                    position: {
                        top: 0, left: 0, right: 0, bottom: 0
                    },
                    stacking: {
                        onTop: {
                            higher: [me],
                            lower: [{children: {imgOrText: _}}, [embedding]]
                        }
                    }
                }
            },
            imgOrText: {
                description: {
                    context: {
                        fileDropped: [{fileObj: _}, [embedding]],
                        beingDraggedOver: [{beingDraggedOver: _}, [embedding]],
                        hasDropped: [{hasDropped: _}, [embedding]]
                    },
                    display: {
                        borderWidth: 1,
                        borderStyle: "solid",
                        borderColor: "orange",
                        borderRadius: 4,
                        text: {
                            fontSize: 18,
                            fontFamily: "sans-serif",
                            color: "orange",
                            value: o({
                                qualifier: {fileDropped: false},
                                variant: "DROP FILE HERE"
                            }, {
                                qualifier: {fileDropped: true},
                                variant: [{fileDropped: {name: _}}, [me]]
                            })
                        },
                        background: o({
                            qualifier: {beingDraggedOver: true},
                            variant: "gold"
                        }, {
                            qualifier: {hasDropped: true},
                            variant: "red"
                        })
                    },
                    position: {
                        top: 0, left: 0, right: 0, bottom: 0
                    }
                }
            }
        }
    },
    
    SwitchOnceButton: o({
        context: {
            "*value": false,
            mouseOver: [{param: {pointerInArea: _}}, [me]],
            "*mouseDown": false
        },
        display: {
            borderWidth: 2,
            borderStyle: "solid",
            borderRadius: 4
        },
        write: {
            switchToTrue: {
                upon: [{subType: "Click"}, [myMessage]],
                true: {
                    switchToTrue: {
                        to: [{value: _}, [me]],
                        merge: true
                    }
                }
            },
            mouseDown: {
                upon: [{type: "MouseDown"}, [myMessage]],
                true: {
                    setMouseDown: {
                        to: [{mouseDown: _}, [me]],
                        merge: true
                    }
                }
            },
            mouseUp: {
                upon: [{type: "MouseUp"}, [message]],
                continuePropagation: true,
                true: {
                    setMouseDown: {
                        to: [{mouseDown: _}, [me]],
                        merge: false
                    }
                }
            }
        }
    }, {
        qualifier: {mouseOver: false},
        display: {
            borderColor: "grey",
            text: {
                color: "grey"
            }
        }
    }, {
        qualifier: {mouseOver: true},
        display: {
            borderColor: "orange",
            text: {
                color: "orange"
            }
        }
    }, {
        qualifier: {mouseDown: true},
        display: {
            background: "#888888"
        }
    }),

    UploadApp: {
        context: {
            fileObj: [{children: {dbfile: {fileObj: _}}}, [me]],
            readyToUpload: [not, [empty, [{fileObj: _}, [me]]]],
            uploadAction: [and,
                            [{readyToUpload: _}, [me]],
                            [{children: {actionButton: {value: _}}}, [me]]
                            ],
            dbdata: [datatable, [{children: {dbfile: {fileObj: { fileHandle:_ } } } }, [me]]]
        },
        display: {
            background: "#eeeeee",
            borderWidth: 3,
            borderStyle: "solid",
            borderColor: "#aaaaaa",
            borderRadius: 20
        },
        position: {
            "horizontal-center": 0,
            "vertical-center": 0,
            height: 500,
            width: 500
        },
        write: {
            onSomething: {
                upon: [changed, [{fileObj: _}, [me]]],
                true: {
                    doSomething: {
                        to: [{children: {actionButton: {value: _}}}, [me]],
                        merge: false
                    }
                }
            }
        },
        children: {
            dbfile: {
                description: {
                    "class": "FileInput",
                    position: {
                        top: 30,
                        left: 30,
                        right: 30,
                        height: 80
                    }
                }
            },
            actionButton: {
                qualifier: {readyToUpload: true},
                description: {
                    "class": "SwitchOnceButton",
                    context: {
                        meta: {
                            attributes: [{dbdata: { attributes:_ } }, [embedding]],
                            data: [{dbdata: { data:_ } }, [embedding]],
                            name: [{dbdata: { name:_ } }, [embedding]],
                        }
                    },
                    display: {
                        text: {
                            fontSize: 24,
                            fontFamily: "sans-serif",
                            fontWeight: 600,
                            value: "Upload"
                        }
                    },
                    position: {
                        "horizontal-center": 0,
                        top: 200,
                        height: 40,
                        width: 100
                    },
                    write: {
                        onAction: {
                            upon: [{value: _}, [me]],
                            true: {
                                upload: {
                                    to: [databases],
                                    merge: [{meta: _}, [me]]
                                }
                            }
                        }
                    }
                }                        
            }
        }
    }

};

var screenArea = {
    children: {
        upload: {
            description: {
                "class": "UploadApp"
            }
        }
    }
};
