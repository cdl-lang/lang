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
    TrackMySelectableFacetXIntOverlay: {
        context: {
            mySelectableFacetXIntOverlay: [{ // myFacet: [{ myFacet:_ }, [me]], only one slider facet in this test!
                                            myOverlay: [{ myOverlay:_ }, [me]]},
                                           [areaOfClass, "SelectableFacetXIntOverlay"]]
        }
    },
    TestFacetXIntOSR: o(
        { // default
            context: {
                facetXIntOSR: true,  

                myOverlay: [{ children: { overlay:_ } }, [embedding]]
            }
        }
    ),
    SelectableFacetXIntOSR: o(
        { // variant-controller
            qualifier: "!",
            context: { 
                showSolutionSet: [{ myOverlay: { showSolutionSet:_ } }, [me]]
            }
        },
        { // default
            "class": o("TestFacetXIntOSR", "TrackMySelectableFacetXIntOverlay"),
            context: {
                selectableFacetXIntOSR: true,  

                facetUniqueID: [{ myFacet: { uniqueID:_ } }, [me]],

                // the selectionsObj is the transientSelectionsObj from my SelectableFacetXIntOverlay (which equates the (stable)selectionsObj when no modification takes place,
                // and tracks the selectors of the slider being modified, when that happens).
                selectionsObj: [{ mySelectableFacetXIntOverlay: { transientSelectionsObj:_ } }, [me]]
            },
            content: { 
                disabled: [{ selectionsObj: { disabled:_ } }, [me]]
            }
        }
    ),
    SliderFacetSelections: o(
        { // variant-controller
            qualifier: "!",
            context: {
                highValEqualsPlusInfinity: [{ highValEqualsPlusInfinity:_ }, [embedding]],
            }
        },
        { // default
            context: {
                sliderFacetSelections: true
            },
            position: { frame: 0 },
        },
        {
            qualifier: { highValEqualsPlusInfinity: false },
            children: {
                highValSelection: {
                    description: {
                        "class": "SliderFacetSelection",
                        context: {
                            highValSelection: true,
                            val: [{ content: { highVal:_ } }, [embedding, [embedding]]],
                            infinityVal: "plusInfinity"
                        }
                    }
                }
            }
        }
    ),
    
    SliderFacetSelection: {
        context: {
            sliderFacetSelection: true
        },
        position: { frame: 0 },
        display: { text: { value: [{ val:_ }, [me]] } }
    },
    
    SliderFacetXIntOSR: o(
        { // default
            context: {
                sliderFacetXIntOSR: true,                               
                lowValEqualsMinusInfinity: [{ mySelectableFacetXIntOverlay: { lowValEqualsMinusInfinity:_ } }, [me]],
                highValEqualsPlusInfinity: [{ mySelectableFacetXIntOverlay: { highValEqualsPlusInfinity:_ } }, [me]]
            },
            content: { 
                lowVal: [{ selectionsObj: { lowVal:_ } }, [me]],
                highVal: [{ selectionsObj: { highVal:_ } }, [me]],
            },
            children: {
                selections: {
                    description: {
                        "class": "SliderFacetSelections",
                        position: { frame: 5 }
                    }            
                }
            }
        }
    ),
    TrackMyFacet: o(
        { // variant-controller    
            qualifier: "!",
            context: {
                facetType: [{ myFacet: { facetType:_ } }, [me]],
                facetState: [{ myFacet: { state:_ } }, [me]],
                facetEmbedsAmoeba: [{ myFacet: { embedAmoeba:_ } }, [me]],
                minimizedFacet: [{ myFacet: { minimized:_ } }, [me]]
            }
        },
        { // default
            context: {
                myEmbeddingFacet: [{ facet: true }, [embeddingStar, [me]]],
                myFacet: [{ myEmbeddingFacet:_ }, [me]]
            }
        }
    ),
    NonOMFacetXIntOSR: o( 
        { // variant-controller
            qualifier: "!",
            context: { 
                selectionsMade: [{ mySelectableFacetXIntOverlay: { selectionsMade:_ } }, [me]]
            }
        },      
        { // default 
            "class": o("SelectableFacetXIntOSR", // inherits TestFacetXIntOSR, which provides the definition of myFacet that overrides the one provided in TrackMyFacet 
                       "TrackMyFacet"           // as it is inherited before TrackMyFacet
                      ),
            context: {
                nonOMFacetXIntOSR: true,  

                // supporting copy-paste of NonOMFacetXIntOSR selections from one intensional overlay's OSR to another's.
                coselectedFacetXIntOSRs: [{ coselected: true },
                                          [areaOfClass, "SelectableFacetXIntOSR"]
                                         ],                
                // this area is the destination of a dragged facetSelections operation if one of the singleFacetSelections dragged matches
                // this area's facetUniqueID (e.g. if we're dragging only the price facet's selections, then the quality facet can't be its destination).
                destinationOfDraggedFacetSelections:[notEmpty,
                                                     [
                                                      [{ facetUniqueID:_ }, [me]], 
                                                      [{ coselectedFacetXIntOSRs: { facetUniqueID:_ } }, [me]]
                                                     ]
                                                    ],
                mySourceFacetXIntOSR: [{ facetUniqueID: [{ facetUniqueID:_ }, [me]] },
                                       [{ coselectedFacetXIntOSRs:_ }, [me]]
                                      ]
            }
        }
    ),
    LeanNonOMFacetXIntOSR: o(
        { // default
            "class": "NonOMFacetXIntOSR"
        }
    ),
    LeanSliderFacetXIntOSR: {
        "class": o("LeanNonOMFacetXIntOSR", "SliderFacetXIntOSR")
    },
    IntOverlay: o(
        { // variant-controller
            qualifier: "!",
            context: {
                // true iff at least one of the children selectableFacetXIntOverlays has selectionsMade: true
                // currently doesn't have to be in the variant-controller. placed here nonetheless so as to be symmetric wrt ExtOverlayCore
                selectionsMade: [notEmpty, 
                                 [{ children: { selectableFacetXIntOverlays: { selectionsMade: true } } }, [me]]
                                ]
            }
        },
        { // default
            context: {
                intOverlay: true, 
                color: [{ param: { areaSetContent: { color:_ } } }, [me]],
                selectionsObjOS: [{ content:_ }, [me]],
                /*selectionsObjOS: [map,
                                  [defun,
                                   o("selectableFacetUniqueID"),
                                   [cond,
                                    [empty,
                                     [ // the object representing the selectableFacetUniqueID in the overlay's content
                                      { "uniqueID": "selectableFacetUniqueID" },
                                      [{ content:_ }, [me]]
                                     ]
                                    ],
                                    o(
                                      { // if selectableFacetUniqueID is not represented in the overlay's content, obtain the object from the corresponding SelectableFacet
                                          on: true, 
                                          use: [
                                                { 
                                                      uniqueID: "selectableFacetUniqueID",
                                                      selectionsObj:_
                                                },
                                                [areaOfClass, "SelectableFacet"]
                                               ]
                                      },
                                      { // otherwise, take that object from the overlay's content.
                                          on: false, 
                                          use: [ // the object representing the selectableFacetUniqueID in the overlay's content
                                                { "uniqueID": "selectableFacetUniqueID" },
                                                [{ content:_ }, [me]]
                                               ]
                                      }
                                     )
                                   ]
                                  ],
                                  [{ selectableFacetUniqueIDs:_ }, [me]]
                                 ],*/
                selectableFacetUniqueIDs: o("52 week low", "52 week high"),
            },
            content: [{ param: { areaSetContent: { selections:_ } } }, [me]],
            children: {
                selectableFacetXIntOverlays: {
                    data: [{ selectionsObjOS:_ }, [me]],
                    description: {
                        "class": "SelectableFacetXIntOverlay"
                    }
                }
            }           
        }
    ),
    SelectableFacetXIntOverlay: o(
        { // variant-controller
            qualifier: "!",
            context: {
                // note that the following three reflect the 'transient', i.e. the current selection, including during MouseDown.
                highValEqualsPlusInfinity: [equal,
                                            "plusInfinity", 
                                            [{ transientSelectionsObj: { highVal:_ } }, [me]]
                                           ]
            }
        },
        { // default
            context: {
                selectableFacetXIntOverlay: true,                

                // when representing an OMF of an overlay that's in DependentZoomBoxer state, this context label will not be defined (as there will be no OMF!)
                myFacet: [{ uniqueID: [{ stableSelectionsObj: { uniqueID:_ } }, [me]] },
                          [areaOfClass, "SelectableFacet"]
                         ],
                myOverlay: [embedding], // embedded in the associated overlay.
                
                stableSelectionsObj: [{ param: { areaSetContent:_ } }, [me]],
                
                // except for when a Slider's valSelectors are being modified (see SliderFacetXIntOverlay), 
                // the rest of the time (and always for MS and OMF), the transientSelectionsObj = stableSelectionsObj
                transientSelectionsObj: [{ stableSelectionsObj:_ }, [me]],
            }
        }
    ),
    SliderOverlayXWidget: {
        "class": "TrackMySelectableFacetXIntOverlay",
        context: {
            overlayXWidgetCore: true, // for TrackMyOverlayXWidget
            // the selectionsObj is the transientSelectionsObj from my SelectableFacetXIntOverlay (which equates the (stable)selectionsObj when no modification takes place,
            // and tracks the selectors of the slider being modified, when that happens).
            selectionsObj: [{ mySelectableFacetXIntOverlay: { transientSelectionsObj:_ } }, [me]],
            myOverlay: [{ param: { areaSetContent:_ } } , [me]],
            color: [{ myOverlay: { color:_ } }, [me]],
            
            // context labels indicating whether we're at the minusInfinity/plusInfinity points, and whether the selectors are on the same value.
            lowValEqualsMinusInfinity: [equal,
                                        "minusInfinity", 
                                        [{ content: { lowVal:_ } }, [me]]
                                       ],
            highValEqualsPlusInfinity: [equal,
                                        "plusInfinity", 
                                        [{ content: { highVal:_ } }, [me]]
                                       ],
            valSelectorsOfEqualValue: [equal,
                                       [{ content: { lowVal:_ } }, [me]], 
                                       [{ content: { highVal:_ } }, [me]]
                                      ],
            selectionsMade: [{ mySelectableFacetXIntOverlay: { selectionsMade:_ } }, [me]],
            
            // a set of context labels to indicate whether one of the embedded tmdable elements is being dragged:
            // this could be either one of the valSelectors, the connector that allows co-dragging them (when they're both within the continuous range), or the band that allows
            // positioning one of them on mouseDown, and the other on mouseUp (as if stretching a rubber band from one nail (mouseDown) to another (mouseUp)).
            lowValSelectorBeingModified: [{ children: { lowValSelector: { tmd:_ } } }, [me]],
            highValSelectorBeingModified: [{ children: { highValSelector: { tmd:_ } } }, [me]],
            valSelectorBeingModified: [or,
                                       o(
                                         [{ lowValSelectorBeingModified:_ }, [me]],
                                         [{ highValSelectorBeingModified:_ }, [me]]
                                        )
                                      ],

            valSelectorsConnectorTmd:[{ children: { valSelectorsConnector: { tmd:_ } } }, [me]],
            valSelectorsBandTmd: [and, 
                                  [not, [{ valSelectorsConnectorTmd:_ }, [me]]],
                                  [{ children: { continuousRange: { tmd:_ } } }, [me]]
                                 ],
            bothValSelectorsBeingModified: [or, // either valSelectorsConnectorTmd or valSelectorsBandTmd are true
                                            o(
                                              [{ valSelectorsConnectorTmd:_ }, [me]],
                                              [{ valSelectorsBandTmd:_ }, [me]]
                                             )
                                           ],
                                  
            // stableSelectionsObj: the valSelectors retrieve their corresponding attribute from it, and write to it their value on the appropriate MouseUp
            stableSelectionsObj: [{ mySelectableFacetXIntOverlay: { stableSelectionsObj:_ } }, [me]]
        },
        position: {
            frame: 10,
            labelEndSideAnchor: { // we separate the definition of "endSideAnchor" into the two axis-specific variants because the offset from the frame corner isn't 0!
                point1: { label: "endSideAnchor" },
                point2: { type: "right" },
                equals: 2
            },                  
            labelBandedSelectionBeginningAnchor: {
                point1: { 
                    element: [areaOfClass, "ScreenArea"],
                    type: "top"
                }, 
                point2: { 
                    label: "bandedSelectionBeginningAnchor"
                },
                equals: [{ children: { continuousRange: { continuousRangeY:_ } } }, [me]]
            },
            attachBeginningGirthToBeginningSideAnchor: {
                point1: { type: [{ beginningGirth:_ }, [me]] },
                point2: { label: "beginningSideAnchor" },
                equals: 0
            },
            attachLowHMTLLengthOfContinuousRangeToThatOfBaseOverlayXWidget: {
                point1: {
                    element: [{ children: { sliderBaseOverlayXWidget: { children: { continuousRange:_ } } } }, [embedding]],
                    type: [{ lowHTMLLength:_ }, [me]]
                },
                point2: {
                    element: [{ children: { continuousRange:_ } }, [me]],
                    type: [{ lowHTMLLength:_ }, [me]]
                },
                equals: 0
            },
            attachHighHTMLLengthOfContinuousRangeToThatOfBaseOverlayXWidget: {
                point1: {
                    element: [{ children: { continuousRange:_ } }, [me]],
                    type: [{ highHTMLLength:_ }, [me]]
                },
                point2: { 
                    element: [{ children: { sliderBaseOverlayXWidget: { children: { continuousRange:_ } } } }, [embedding]],
                    type: [{ highHTMLLength:_ }, [me]]
                },
                equals: 0
            }
        },
        children: {
            continuousRange: { 
                description: {
                    "class": "SliderContinuousRange"
                }
            },
            plusInfinityRange: {
                description: {
                    "class": "SliderPlusInfinityRange"
                }
            },          
            highValSelector: {
                description: {
                    "class": "HighValSelector"
                }
            }
        },
        stacking: {
            continuousRangeBelowSiblings: {
                higher: [embedded],
                lower: [{ children: { continuousRange:_ } }, [me]],
            },
            valSelectorsAboveSiblings: {
                higher: o([{ children: { highValSelector:_ } }, [me]],
                          [{ children: { lowValSelector:_ } }, [me]]),
                lower: [embedded]
            }
        },      
        content: [{ selectionsObj:_ }, [me]],
        display: { 
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "black",
            background: "white"
        }
    },  
    TrackMySliderWidget: o(
        { // default
            "class": "TrackMyWidget",
            context: { 
                trackMySliderWidget: true
            }
        },
        {
            qualifier: { ofVerticalWidget: true },
            "class": "VerticalNumericElement"
        }       
    ),
    VerticalSliderElement: {
        context: { 
            verticalSliderElement: true,
            
            lowValLength: "bottom",
            centerValLength: "vertical-center",
            highValLength: "top"
        }
    },  
    SliderContinuousRange: { 
        "class": o("TrackMySliderWidget"),
        context: {
            sliderContinuousRange: true,
        },
        display: { background: [{ color:_ }, [embedding]] },
        position: {
            top: 50,
            alignHorizontalCenterConstraint: {
                point1: { 
                    element: [embedding],
                    type: "horizontal-center",
                    content: true
                },
                point2: {
                    type: "horizontal-center"
                },
                equals: 0
            },
            lengthConstraint: {
                point1: { type: [{ lowHTMLLength:_ }, [me]] },
                point2: { type: [{ highHTMLLength:_ }, [me]] },
                equals: 200
            },
            girthConstraint: {
                point1: { type: [{ lowHTMLGirth:_ }, [me]] },
                point2: { type: [{ highHTMLGirth:_ }, [me]] },
                equals: 10
            },
            girthSideConstraint: {
                point1: {
                    type: [{ endGirth:_ }, [me]]
                },
                point2: {
                    element: [embedding],
                    label: "endSideAnchor"
                },
                equals: 0
            }
        }
    },
    SliderInfinityRange: {
        "class": o("TrackMySliderWidget"),
        context: {
            sliderInfinityRange: true
        },
        position: {
            height: 20,
            width: 10,
            alignHorizontalWithContinuousRange: {
                point1: { type: "horizontal-center" },
                point2: { element: [{ children: { continuousRange:_ } }, [embedding]],
                          type: "horizontal-center" },
                equals: 0
            }
        },
        display: { 
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "black"
        }
    },
    SliderPlusInfinityRange: {
        "class": "SliderInfinityRange",
        context: {
            sliderPlusInfinityRange: true
        },
        position: {
            attachToContinuousRange: {
                point1: { 
                    type: [{ lowValLength:_ }, [me]]
                },
                point2: {                   
                    element: [{ children: { continuousRange:_ } }, [embedding]],
                    type: [{ highValLength:_ }, [me]]
                },
                equals: 0
            },
            labelCrossOverToInfinityPoint: {
                pair1: {
                    point1: { label: "infinityPoint" },
                    point2: { label: "crossOverToInfinityPoint" }
                },
                pair2: {
                    point1: { label: "crossOverToInfinityPoint" },
                    point2: { type: [{ lowValLength:_ }, [me]] }
                },
                ratio: 1
            },
            
            // see SliderInfinityRange for attachInfinitySideI:
            // the top should be attached to the highValSelector's center, and should not go below the bottom
            attachInfinitySideII: {
                point1: { type: [{ highValLength:_ }, [me]] },
                point2: { 
                    element: [{ children: { highValSelector:_ } }, [embedding]],
                    type: [{ centerValLength:_ }, [me]]
                },
                equals: 0,
                priority: -201
            },
            positionInfinityPoint: {
                point1: { 
                    label: "infinityPoint" 
                },
                point2: { 
                    element: [last, [{ children: { infinityLines:_ } }, [me]]],
                    type: [{ highValLength:_ }, [me]]
                },
                equals: 2
            }
        }
    },
    SliderMinusInfinityRange: {
        "class": "SliderInfinityRange",
        context: {
            sliderMinusInfinityRange: true
        },
        position: {
            attachToContinuousRange: {
                point1: {                   
                    element: [{ children: { continuousRange:_ } }, [embedding]],
                    type: [{ lowValLength:_ }, [me]]
                },
                point2: { 
                    type: [{ highValLength:_ }, [me]]
                },
                equals: 0
            },
            labelCrossOverToInfinityPoint: {
                pair1: {
                    point1: { type: [{ highValLength:_ }, [me]] },
                    point2: { label: "crossOverToInfinityPoint" }
                },
                pair2: {
                    point1: { label: "crossOverToInfinityPoint" },
                    point2: { label: "infinityPoint" }
                },
                ratio: 1
            },
            
            //see SliderInfinityRange for attachInfinitySideI
            // the bottom should be attached to the lowValSelector's center, and should not go above the top
            attachInfinitySideII: {
                point1: { type: [{ lowValLength:_ }, [me]] },
                point2: { 
                    element: [{ children: { lowValSelector:_ } }, [embedding]],
                    type: [{ centerValLength:_ }, [me]]
                },
                equals: 0,
                priority: -201
            },
            positionInfinityPoint: {
                point1: { 
                    element: [last, [{ children: { infinityLines:_ } }, [me]]],
                    type: [{ lowValLength:_ }, [me]]
                },
                point2: { 
                    label: "infinityPoint" 
                },
                equals: 2
            }
        }
    },  
    
    TrackMyOverlayXWidget: o(
        { // variant-controller
            qualifier: "!",
            context: { 
                selectionsMade: [{ myOverlayXWidget: { selectionsMade:_ } }, [me]]
            }
        },
        { 
            context: {
                //myOverlayXWidget: [tempMyEmbedding, { overlayXWidgetCore: true }]
                myOverlayXWidget: [{ overlayXWidgetCore: true }, [embeddingStar, [me]]]
            }
        }
    ),
    
    TranslateCanvasPositionToValue: {
        context: {
            // add to the minVal the (maxVal-minVal range) * (the current location of the valSelector as a % of the maxValPoint - minValPoint offset)
            translateCanvasPositionToValue: [defun, o("posPoint", "sliderWidget"), [plus,
                                                                                      [{ minVal:_ }, "sliderWidget"],
                                                                                      [mul,
                                                                                       [minus,
                                                                                        [{ maxVal:_ }, "sliderWidget"],
                                                                                        [{ minVal:_ }, "sliderWidget"]
                                                                                       ],
                                                                                       [div,
                                                                                        // either both offsets below are positive (vertical widget), or both are 
                                                                                        // negative (horizontal widget). either way, their quotient is positive
                                                                                        [offset,
                                                                                         "posPoint",
                                                                                         {
                                                                                            element: "sliderWidget",
                                                                                            label: "minValPoint"
                                                                                         }
                                                                                        ],
                                                                                        [offset,
                                                                                         {
                                                                                            element: "sliderWidget",
                                                                                            label: "maxValPoint"
                                                                                         },
                                                                                         {
                                                                                            element: "sliderWidget",
                                                                                            label: "minValPoint"
                                                                                         }
                                                                                        ]
                                                                                       ]
                                                                                      ]
                                                                                     ]]
        }
    },
    
    ValSelector: o(
        { // variant-controller
            qualifier: "!",
            context: {
                selectorIsBeingMoved: [bool,
                                       o([{ tmd:_ }, [me]],
                                         [{ valSelectorsBandTmd:_ }, [me]],
                                         [{ valSelectorsConnectorTmd:_ }, [me]]
                                        )
                                      ],
                                             
                valSelectorsBandTmd: [{ valSelectorsBandTmd:_ }, [embedding]], 
                valSelectorsConnectorTmd: [{ valSelectorsConnectorTmd:_ }, [embedding]],
                
                showLittleHandleOnHover: [{ inArea:_ }, [embedded, [embedding]]],
                valSelectorsOfEqualValue: [{ valSelectorsOfEqualValue:_ }, [embedding]],
                
                // for TranslateValSelectorPositionToValue (inherited via ValSelector): see inheriting classes for assignment of values to the posPoints in the offsets)
                selectorBeyondExtremumPoint: [greaterThan, 
                                              [offset, 
                                               [{ beyondExtremumPointLowHTMLElement:_ }, [me]],
                                               [{ beyondExtremumPointHighHTMLElement:_ }, [me]]
                                              ],
                                              0
                                             ],
                selectorCrossedOverToInfinityPoint: [greaterThan, 
                                                     [offset,  
                                                      [{ beyondInfCrossOverPointLowHTMLElement:_ }, [me]],
                                                      [{ beyondInfCrossOverPointHighHTMLElement:_ }, [me]]
                                                     ],
                                                     0
                                                    ], 
                
                // cdl-implementation of lazy-write
                preSelections: [{ mySelectableFacetXIntOverlay: { preSelections:_ } }, [embedding]]
            }
        },
        { // default
            "class": o("TrackMySliderWidget", "TrackMyOverlayXWidget"),
            context: {
                valSelector: true,
                // by default - see variant below where we handle val being determined by the selector's position on the canvas (when the selector is being dragged).
                val: [{ transientVal:_ }, [me]], 
                                
                // BoundedDraggable params              
                boundedDragPoint: { type: [{ centerValLength:_ }, [me]] },
                // additional params for BoundedDraggable in inheriting classes & in variants below
            },
            position: {
                width: 30,
                height: 20,
                alignHorizontalWithContinuousRange: {
                    point1: { type: "horizontal-center" },
                    point2: { element: [{ children: { continuousRange:_ } }, [embedding]],
                              type: "horizontal-center" },
                    equals: 0
                }               
            },
            display: {
                background: "red",
                text: { value: [{ val:_ }, [me]] }
            }
        },
        {
            qualifier: { ofVerticalWidget: true },
            context: {
                // BoundedDraggable params              
                horizontallyDraggable: false                    
            }
        },
        {
            qualifier: { selectorIsBeingMoved: false,
                         selectorlValIsInfinity: true },
            position: {
                anchorToInfinityPoint: {
                    point1: { 
                        type: [{ centerValLength:_ }, [me]]
                    },
                    point2: { 
                        element: [{ myInfinityRange:_ }, [me]],
                        label: "infinityPoint"
                    },
                    equals: 0
                }
            }
        },
        {
            qualifier: { selectorIsBeingMoved: false,
                         selectorlValIsInfinity: false },
            "class": "SliderCanvas"
            // params for SliderCanvas in two variants that follow
        },
        {
            qualifier: { selectorIsBeingMoved: false,
                         selectorlValIsInfinity: false,
                         ofVerticalWidget: true },
            context: {
                positionOnVerticalSliderCanvas: true,  
                verticalSliderWidget: [{ myWidget:_ }, [me]],
                verticalSliderVal: [{ val:_ }, [me]]
            }
        },
        // the following three variants store the value of the selector in translateValSelectorPositionToValue, depending on its position:
        // if its on the continuous range, or in one of the two sub-regions of the infinity range (selectorCrossedOverToInfinityPoint: true/false).
        {
            qualifier: { selectorBeyondExtremumPoint: false,
                         selectorCrossedOverToInfinityPoint: false },
            "class": "TranslateCanvasPositionToValue",
            context: {
                translateValSelectorPositionToValue: [[{ translateCanvasPositionToValue:_ }, [me]], 
                                                      { type: [{ centerValLength:_ }, [me]] },
                                                      [{ myWidget:_ }, [me]]
                                                     ]
            }
        },
        {
            qualifier: { selectorBeyondExtremumPoint: true,
                         selectorCrossedOverToInfinityPoint: false },
            context: { 
                translateValSelectorPositionToValue: [{ extremumVal:_ }, [me]]
            }
        },
        {
            qualifier: { selectorBeyondExtremumPoint: true, 
                         selectorCrossedOverToInfinityPoint: true },
            context: { 
                translateValSelectorPositionToValue: [{ infinityVal:_ }, [me]]
            }
        }       
    ),
    
    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    // This class represents the highVal selector in a slider. it is embedded in SliderIntOverlayXWidgetCore. it inherits ValSelector.
    // Note the nonInfinityBoundedDragPoint orGroup defined for the direct dragging of this valSelector: it is the closer of the two posPoints: the other valSelector and the far end
    // of the continuous range.
    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    HighValSelector: o(
        { // variant-controller
            qualifier: "!",
            context: {
                selectorlValIsInfinity: [{ highValEqualsPlusInfinity:_ }, [embedding]] 
            }
        },
        { // default  
            "class": "ValSelector",
            context: {
                highValSelector: true,
                                
                stableVal: [{ myOverlayXWidget: { stableSelectionsObj: { highVal:_ } } }, [me]],
                transientVal: [{ myOverlayXWidget: { content: { highVal:_ } } }, [me]],
                extremumVal: [{ myWidget: { maxVal:_ } }, [me]],
                infinityVal: "plusInfinity",
                myInfinityRange: [{ children: { plusInfinityRange:_ } }, [embedding]],
                
                // for lazy-write: 
                valSelectorSelectionsObj: [merge,
                                           { highVal: [{ val:_ }, [me]] },
                                           [{ myFacet: { selectionsObj:_ } }, [me]]
                                          ]
            }
        },
        {
            qualifier: { ofVerticalWidget: true },
            context: {
                beyondExtremumPointLowHTMLElement: { 
                    type: [{ centerValLength:_ }, [me]]
                },
                beyondExtremumPointHighHTMLElement: {
                    element: [{ myWidget:_ }, [me]],
                    label: "maxValPoint"
                },
                beyondInfCrossOverPointLowHTMLElement: {
                    type: [{ centerValLength:_ }, [me]]
                },
                beyondInfCrossOverPointHighHTMLElement: {
                    element: [{ myInfinityRange:_ }, [me]],
                    label: "crossOverToInfinityPoint"
                }
            }
        },
        {
            qualifier: { tmd: true,
                         ofVerticalWidget: true },
            context: {
                // BoundedDraggable: additional params
                boundedDragBeginning: {
                    element: [{ myInfinityRange:_ }, [me]],
                    label: "infinityPoint"
                },
                boundedDragEnd: {
                    label: "nonInfinityBoundedDrag" // defined in the position object below.
                }
            },
            position: {                                                 
                nonInfinityBoundedDragHigherValThanOtherSelector: {
                    point1: {
                        label: "nonInfinityBoundedDrag"
                    },
                    point2: {
                        element: [{ children: { lowValSelector:_ } }, [embedding]],
                        type: [{ centerValLength:_ }, [me]]
                    },
                    min: 0
                },
                nonInfinityBoundedDragHigherValThanMinValPoint: {
                    point1: {
                        label: "nonInfinityBoundedDrag"
                    },
                    point2: {  
                        element: [{ myWidget:_ }, [me]],
                        label: "minValPoint"
                    },
                    min: 0
                },
                nonInfinityBoundedDragEqualsTheHigherValOfTheTwoI: {
                    point1: {
                        label: "nonInfinityBoundedDrag"
                    },
                    point2: {
                        element: [{ children: { lowerValSelector:_ } }, [embedding]],
                        type: [{ centerValLength:_ }, [me]]
                    },
                    max: 0,
                    priority: -1,
                    orGroups: { label: "nonInfinityBoundedDragPoint" }
                },
                nonInfinityBoundedDragEqualsTheHigherValOfTheTwoII: {
                    point1: {
                        label: "nonInfinityBoundedDrag"
                    },
                    point2: {
                        element: [{ myWidget:_ }, [me]],
                        label: "minValPoint"
                    },
                    max: 0,
                    priority: -1,
                    orGroups: { label: "nonInfinityBoundedDragPoint" }
                }                               
            }
        },
        {
            qualifier: { valSelectorsBandTmd: true,
                         ofVerticalWidget: true },
            context: {
                // BoundedDraggable: additional params
                boundedDragBeginning: {
                    element: [{ myInfinityRange:_ }, [me]],
                    label: "infinityPoint"
                },
                boundedDragEnd: {
                    element: [embedding],  
                    label: "bandedSelectionBeginningAnchor" // defined in the embedding area
                }
            }
        },
        { // for lazy-write when we're IN the selectors band mode; see ValSelector for handling lazy-write when we're NOT in selectors band mode.
            qualifier: { selectorIsBeingMoved: true,
                         preSelections: true,
                         valSelectorsBandTmd: true },
            write: {
                onValSelectorTmdAnyMouseUp: { 
                    // upon: see { selectorIsBeingMoved: true } variant in ValSelector
                    "true": {
                        pushOntoOverlayContent: {
                            to: [{ mySelectableFacetXIntOverlay: { myOverlay: { content:_ } } }, [embedding]],
                            merge: push([merge, // in a single write, we need to include in the object the val of both the lowValSelector and of the highValSelector
                                         { lowVal: [{ children: { lowValSelector: { val:_ } } }, [embedding]] },
                                         [{ valSelectorSelectionsObj:_ }, [me]] // contains val for HighValSelector
                                        ])
                        }
                    }
                }
            }
        }       
    ),
    
    SliderCanvas: o( 
        { // // default 
        },
        {
            qualifier: { positionOnVerticalSliderCanvas: true },
            context: {
                // In order to avoid division by 0, we handle separately the case where the val equals the minVal of the slider.
                verticalValEqualsMinVal: [equal,
                                          [{ verticalSliderVal:_ }, [me]], 
                                          [{ verticalSliderWidget: { minVal:_ } }, [me]]
                                         ]
            }
        },
        {
            qualifier: { positionOnVerticalSliderCanvas: true,
                         verticalValEqualsMinVal: false },
            position: {
                attachToVerticalCanvas: { // offsets are both positive (vertical widget) or both negative (horizontal widget). either way, their ratio is positive.
                    pair1: {
                        point1: {
                            element: [{ verticalSliderWidget:_ }, [me]],
                            label: "maxValPoint"
                        },
                        point2: {
                            element: [{ verticalSliderWidget:_ }, [me]],
                            label: "minValPoint"
                        }
                    },
                    pair2: {
                        point1: {
                            type: "vertical-center"
                        },
                        point2: {
                            element: [{ verticalSliderWidget:_ }, [me]],
                            label: "minValPoint"
                        }
                    },
                    ratio: [div, 
                            [minus, 
                             [{ verticalSliderVal:_ }, [me]], 
                             [{ verticalSliderWidget: { minVal:_ } }, [me]]
                            ],
                            [minus, 
                             [{ verticalSliderWidget: { maxVal:_ } }, [me]],
                             [{ verticalSliderWidget: { minVal:_ } }, [me]]
                            ]
                           ]
                            
                }
            }
        },
        {
            qualifier: { positionOnVerticalSliderCanvas: true,
                         verticalValEqualsMinVal: true },
            position: {
                attachToVerticalCanvas: {
                    point1: {
                        type: "vertical-center"
                    },
                    point2: {
                        element: [{ verticalSliderWidget:_ }, [me]],
                        label: "minValPoint"
                    },
                    equals: 0
                }
            }
        },
        {
            qualifier: { positionOnHorizontalSliderCanvas: true },
            context: {                
                // In order to avoid division by 0, we handle separately the case where the val equals the minVal of the slider.
                horizontalValEqualsMinVal: [equal,
                                            [{ horizontalSliderVal:_ }, [me]], 
                                            [{ horizontalSliderWidget: { minVal:_ } }, [me]]
                                           ]
            }
        },
        {
            qualifier: { positionOnHorizontalSliderCanvas: true,
                         horizontalValEqualsMinVal: false },
            position: {
                attachToHorizontalCanvas: { // offsets are both positive (vertical widget) or both negative (horizontal widget). either way, their ratio is positive.
                    pair1: {
                        point1: {
                            element: [{ horizontalSliderWidget:_ }, [me]],
                            label: "maxValPoint"
                        },
                        point2: {
                            element: [{ horizontalSliderWidget:_ }, [me]],
                            label: "minValPoint"
                        }
                    },
                    pair2: {
                        point1: {
                            type: "horizontal-center"
                        },
                        point2: {
                            element: [{ horizontalSliderWidget:_ }, [me]],
                            label: "minValPoint"
                        }
                    },
                    ratio: [div, 
                            [minus, 
                             [{ horizontalSliderVal:_ }, [me]], 
                             [{ horizontalSliderWidget: { minVal:_ } }, [me]]
                            ],
                            [minus, 
                             [{ horizontalSliderWidget: { maxVal:_ } }, [me]],
                             [{ horizontalSliderWidget: { minVal:_ } }, [me]]
                            ]
                           ]
                            
                }
            }
        },
        {
            qualifier: { positionOnHorizontalSliderCanvas: true,
                         horizontalValEqualsMinVal: true },
            position: {
                attachToHorizontalCanvas: {
                    point1: {
                        type: "horizontal-center"
                    },
                    point2: {
                        element: [{ horizontalSliderWidget:_ }, [me]],
                        label: "minValPoint"
                    },
                    equals: 0
                }
            }
        }
    ),    

    Vertical: {
        context: {
            vertical: true,

            lowHTMLLength: "top",
            highHTMLLength: "bottom",
            
            lowHTMLGirth: "left",
            highHTMLGirth: "right",
            
            beginning: "top",
            end: "bottom",
            center: "vertical-center",
            
            beginningGirth: "left",
            endGirth: "right",
            centerGirth: "horizontal-center",
            
            // in case this class is inherited by an area which also inherits DraggableWeakMouseAttachment:
            horizontallyDraggable: false            
        }
    },
    TrackMyWidget: o(
        { // variant-controller
            qualifier: "!",
            context: {
                ofPrimaryWidget: [bool, [{ myWidget: { primaryWidget:_ } }, [me]]],
                ofVerticalWidget: [bool, [{ myWidget: { vertical:_ } }, [me]]]
            }
        },
        { // default
            context: {
                //myWidget: [tempMyEmbedding, { widget: true }],
                myWidget: [{ widget: true }, [embeddingStar, [me]]],
                // this is to ensure that when we're in a secondaryWidget, the facet pointed to is the correct one!
                myFacet: [{ myWidget: { myFacet:_ } }, [me]]
            }
        },
        {
            qualifier: { ofVerticalWidget: true },
            "class": "Vertical"
        }
    ),  
    Widget: {
        "class": "Vertical",
        context: {
            widget: true,
            primaryWidget: true
        },
        children: {
            permOverlayXWidgets: {                
                data: [areaOfClass, "IntOverlay"],
                description: {
                    "class": "SliderOverlayXWidget"
                }
            }
        },
        position: {
            left: 200,
            top: 100,
            height: 400,
            width: 100
        },
        display: { 
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "black",
            background: "yellow" 
        }
    },
    FSApp: {
        context: {
            "^defaultOverlayData": o(
                { 
                    name: "Primary", 
                    uniqueID: -4,
                    color: "#88a6ba",
                    type: "Intensional",
                    state: "Standard",
                    show: true,
                    showSolutionSet: true,
                    selections: o( 
                                  { 
                                        uniqueID: "52 week low",
                                        disabled: false,
                                        type: "Slider",
                                        highVal: 88,//"plusInfinity",
                                        lowVal: "minusInfinity"
                                  }/*,
                                  { 
                                        uniqueID: "52 week high",
                                        disabled: false,
                                        type: "Slider",
                                        highVal: "plusInfinity",
                                        lowVal: "minusInfinity"
                                  },
                                  { 
                                        uniqueID: "p/e ratio",
                                        disabled: false,
                                        type: "Slider",
                                        highVal: "plusInfinity",
                                        lowVal: "minusInfinity"
                                  } */                                
                                 )
                }
            )
        },
        position: { frame: 0 },
        children: {
            widget: {
                description: {
                    "class": "Widget"
                }
            },
            facetXIntOSR: {
                data: o(1),
                description: {
                    "class": "LeanSliderFacetXIntOSR",
                    position: {
                        top: 10, left: 10,
                        height: 300, width: 100
                    }
                }
            },
            overlay: {
                data: [{ defaultOverlayData:_ }, [me]],
                description: {
                    "class": "IntOverlay",
                    position: {
                        top: 10, left: 360,
                        height: 300, width: 100
                    }
                }
            }
        }
    }
};

var screenArea = {
    display: {
        background: "#bbbbbb"
    },
    children: {
        fsApp: {
            description: {
                "class": "FSApp"
            }
        }
    }
};
