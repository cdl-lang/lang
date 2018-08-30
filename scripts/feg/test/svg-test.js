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
// %%foreign%%: "svg.foreign.js"

var screenArea = {
    children: {
        svg1: {
            description: {
                context: {
                    svg: [[{svg: _}, [foreignFunctions]],
                          { viewBox: { x: 79, y: 148, width: 184, height: 60 } }
                         ]
                },    
                display: {
                    borderWidth: 1,
                    borderColor: "lightgrey",
                    borderStyle: "solid",
                    foreign: {
                        value: [{svg: _}, [me]]
                    }
                },
                children: {
                    C: {
                        description: {
                            display: {
                                background: "rgb(128, 68, 54)",
                                foreign: {
                                    value: {
                                        type: "ellipse",
                                        cx: 137,
                                        cy: 164.5,
                                        rx: 58,
                                        ry: 60.5
                                    }
                                }
                            }
                        }
                    },
                    L: {
                        description: {
                            display: {
                                background: "rgb(54, 128, 92)",
                                foreign: {
                                    value: {
                                        type: "rect",
                                        x: 135,
                                        y: 166,
                                        width: 86,
                                        height: 90
                                    }
                                }
                            }
                        }
                    },
                    D: {
                        description: {
                            display: {
                                background: "rgb(88, 54, 128)",
                                foreign: {
                                    value: {
                                        type: "path",
                                        d: "M143.06 226.52 L209.53 121.23 L276.00 226.52 Z",
                                        transform: "rotate(90 209.53 173.88)"
                                    }
                                }
                            }
                        }
                    }
                },
                position: {
                    top: 10,
                    left: 10,
                    width: 100,
                    height: 100
                }
            }
        },
        svg2: {
            description: {
                context: {
                    hoverColor: [cond, [{param: {pointerInArea: _}}, [me]], o(
                        {on: true, use: "#bbb"},
                        {on: false, use: "#ddd"}
                    )],
                    svg: [[{svg: _}, [foreignFunctions]],
                          { viewBox: { width: 48, height: 48 } }
                         ]
                },    
                display: {
                    borderWidth: 1,
                    borderColor: "lightgrey",
                    borderStyle: "solid",
                    foreign: {
                        value: [{svg: _}, [me]]
                    }
                },
                children: {
                    cross: {
                        description: {
                            display: {
                                background: [{hoverColor: _}, [embedding]],
                                foreign: {
                                    value: {
                                        type: "path",
                                        d: "M38 12.83L35.17 10 24 21.17 12.83 10 10 12.83 21.17 24 10 35.17 12.83 38 24 26.83 35.17 38 38 35.17 26.83 24z"
                                    }
                                }
                            }
                        }
                    },
                    circle: {
                        description: {
                            display: {
                                background: "none",
                                borderColor: "#ddd",
                                borderWidth: 2,
                                foreign: {
                                    value: {
                                        type: "circle",
                                        cx: 24,
                                        cy: 24,
                                        r: 20
                                    }
                                }
                            }
                        }
                    }
                },
                position: {
                    top: 10,
                    left: 120,
                    width: 100,
                    height: 100
                }
            }
        }
    }
};
