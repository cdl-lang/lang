// Copyright 2018,2019 Yoav Seginer
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


//
// This file contains DOM element manipulation functions
//

//
// General element manipulation functions
//

function extractElementFromEmbedding(element)
{
    if(!element || !element.parentNode)
        return; // the element is not embedded

    element.parentNode.removeChild(element);
}

// This function updates the position of the given HTML element.
// The positioning properties are "left","top", "width" and "height".
// z-index is not a position property and is updated elsewhere.

function updateElementPos(element, pos) {
    if(!element || !pos)
        return;

    if (!isNaN(pos.left)) {
        element.style.left = pos.left + "px";
    }
    if (!isNaN(pos.top)) {
        element.style.top = pos.top + "px";
    }
    if (!isNaN(pos.width)) {
        element.style.width = pos.width + "px";
    }
    if (!isNaN(pos.height)) {
        element.style.height = pos.height + "px";
    }
}

// When in zero offset pos mode, element's left and top are at 0px from their
// embedding element's left and top

function setZeroOffsetElementPos(element, pos) {
    element.style.left = "0px";
    element.style.top = "0px";
}

// This function updates the position of the given HTML element.
// It assumes a left/top offset of zero, and therefore sets these offsets
// to zero and only reads the width and height from the 'pos' argument.

function updateZeroOffsetElementPos(element, pos) {
    var width = pos.width;
    var height = pos.height;

    if (!isNaN(width))
        element.style.width = width + "px";
    if (!isNaN(height))
        element.style.height = height + "px";
}

// This function embeds the given element at the given position inside the
// embedding element. Since all positions are absolute, the order of the
// elements inside the embedding element does not matter.

function embedElementAtPos(element, pos, embeddingElement, beforeElement, dontSetPos)
{
    if (dontSetPos !== true) {
        updateElementPos(element, pos);
    }
    embedElementInElement(element, embeddingElement, beforeElement);
}

// This function embeds the given element at the given position inside the
// embedding element. It assumes a left/top offset of zero, and therefore
// sets these offsets to zero and only reads the width and height from the
// 'pos' argument. Since all positions are absolute, the order of the
// elements inside the embedding element does not matter.

function embedZeroOffsetElementAtPos(element, pos, embeddingElement, beforeElement)
{
    setZeroOffsetElementPos(element, pos);
    updateZeroOffsetElementPos(element, pos);
    embedElementInElement(element, embeddingElement, beforeElement);
}

// This function embeds the given element inside the embedding element.
// This function does not set the position of the element. Since all
// positions are absolute, the order of the elements inside the embedding
// element does not matter.

function embedElementInElement(element, embeddingElement, beforeElement)
{
    assert(beforeElement !== undefined);
    // attach the div 
    
    if(!embeddingElement) {
        extractElementFromEmbedding(element);
        return;
    }
    
    if(element.parentNode != embeddingElement) {
        embeddingElement.insertBefore(element, beforeElement);
    }
}

// Same as above only that the element being positioned is the frameDiv
// of the given area and the 'pos' position object contains a reference
// to the embedding area object. If this is 'null', this is a screen
// area and should be embedded directly into the body element of the document.
// If this is 'undefined', the area is removed from the document's DOM
// structure (though the DIV object remains intact and can later be inserted
// into the document).

function embedAreaFrameElementAtPos(area, pos, dontSetPos)
{
    if(!area || !area.display.frameDiv)
        return;

    if(!pos || pos.embedding === undefined) {
        extractElementFromEmbedding(area.display.frameDiv);
        return;
    }
    
    var embeddingElement;
    
    if(!pos.embedding) {
        if(pos.embedding === null)
            embeddingElement = document.body;
        else
            embeddingElement = undefined;
    } else {
        // Embed in the embeddingDiv (create the embeddingDiv if doesn't exist)
        var embeddingArea = pos.embedding;
        assert(embeddingArea.display, "there can't be an area without display");
        embeddingElement = embeddingArea.display.getEmbeddingDiv();
    }

    if(embeddingElement) {
        embedElementAtPos(area.display.frameDiv, pos, embeddingElement, null, dontSetPos);
    }
}

// remove the given element from the DOM structure

function removeElement(element)
{
    if (element && element.parentNode) {
        var parent = element.parentNode;
        if (document.activeElement === element) {
            gDomEvent.setGlobalFocus();
        }
        parent.removeChild(element);
        if (element.tagName === "INPUT") {
            // Input elements can cause the display div to scroll around, and
            // that sticks when replacing the input element by a text div, so we
            // reset scrollLeft and scrollTop.
            parent.parentNode.scrollLeft = 0;
            parent.parentNode.scrollTop = 0;
        }
    }
}

//
// Div manipulation functions
//

// This function creates a new div element with the given id, and sets it
// by default to overflow:hidden
function createDiv(id, overflow)
{
    if (id === "1:1") {
        return document.getElementById("cdlRootDiv");
    } else {
        var div = document.createElement("div");
        div.id = id;
        div.style.position = "absolute";
        div.style.overflow = overflow !== undefined? overflow: "hidden";
        div.style.left = "0px";
        div.style.top = "0px";
        div.style.width = "0px";
        div.style.height = "0px";
        return div;
    }
}

/******************************************************************************/

function cssValTranslate(tAttr, value) {
    if (tAttr === "background-color" && value === undefined) {
        return "";
    }
    return value;
}

function assignCSSStyleProp(styleObj, attrib, value)
{
    var tAttr = (attrib in cssPropTranslationTable?
                 cssPropTranslationTable[attrib]:
                 attrib);
    var tVal = cssValTranslate(tAttr, value);

    if (tAttr instanceof Array) {
        for (var i in tAttr) {
            styleObj.setProperty(tAttr[i], tVal, "");
        }
    } else {
        styleObj.setProperty(tAttr, tVal, "");
    }
}

function resetCssStyleProp(styleObj, attrib)
{
    if (attrib in cssPropTranslationTable) {
        var tAttr = cssPropTranslationTable[attrib];
        if (tAttr instanceof Array) {
            for (var i in tAttr) {
                styleObj.removeProperty(tAttr[i]);
            }
        } else {
            styleObj.removeProperty(tAttr);
        }
    } else {
        styleObj.removeProperty(attrib);
    }
}


// Given an array of element names, and an object of elements (where
// the attributes are the element names and the values the elements themselves)
// this function assigns the given attribute + value ('attrib', 'val')
// to the style object of the elements in 'elementNames' which appear in
// 'elements'.

function assignCSSStylePropToElements(elements, elementNames,
                                      attrib, val)
{
    if(!elements)
        return;
    
    for(var i in elementNames)
        if(elements[elementNames[i]])
            assignCSSStyleProp(elements[elementNames[i]].style,
                                         attrib, val);
}

/******************************************************************************/

function parseColorStopsArr(inputStopsStr) {
    var stopStr = "";

    if (inputStopsStr === undefined) {
        return undefined;
    }
    if (!(inputStopsStr instanceof Array)) {
        inputStopsStr = [inputStopsStr];
    }
    for (var i = 0; i < inputStopsStr.length; i++) {
        var e = inputStopsStr[i];
        if (!(e instanceof Object)) {
            return undefined;
        }
        if (e.color) {
            stopStr += e.color;
            if (e.length) {
                if (!isNaN(e.length)) {
                    stopStr += " " + e.length + "px";
                } else {
                    stopStr += " " + e.length;
                }
            }
            if (i < inputStopsStr.length - 1) {
                stopStr += ',';
            }
        }
    }
    return stopStr;
}

// This function receives a 'displayDiv' (an element which is designated
// as the display DIV in the Display object) and a linear background gradient
// ('gradientProps') description as follows:
// {
//      direction: 'left'/'top'/'left top'/'left bottom'/'right top'
//      stops: [[color, number], <additional-stops>]
// }
//
// This is based on the specifications given at:
//    https://developer.mozilla.org/en/CSS/linear-gradient
// The values themselves are not processed here, so anything which is
// supported by the browsers should also be supported here.
//
// The function sets the appropriate style properties on the display DIV
// to implement the gradient specification.
//

function copyBackgroundLinearGradientCssProp(displayDiv, gradientProps)
{
    gradientProps = getDeOSedValue(gradientProps);
    // translate stop properties into a string of stops
    var stops = parseColorStopsArr(gradientProps.stops);

    if(!stops)
        return;
    
    var linearGradientStr =
        'linear-gradient(' + (gradientProps.direction ?
                              gradientProps.direction + ', ' : "") +
        stops + ')';

    // Firefox, Chrome, Safari
    assignCSSStyleProp(displayDiv.style, "background",
                       linearGradientStr);
    // IE (advanced versions)
    assignCSSStyleProp(displayDiv.style, "background",
                       "-ms-" + linearGradientStr);
}

// This function receives a 'displayDiv' (an element which is designated
// as the display DIV in the Display object) and a radial background gradient
// ('gradientProps') description as follows:
// {
//      position: "left"|"right"|"center" "top"|"bottom"|"center"
//                or
//                x% y%
//                or
//                xpos ypos
//                or
//                "inherit",
//      shape: "circle"|"ellipse",
//      size: "closest-side"|"closest-corner"|"farthest-side"|
//            "farthest-corner"|"contain"|"cover"|<dimensions>
//      stops: [[color, length], [color, length], <additional-stops>]
// }
//
// This is based on the specifications given at:
//    https://developer.mozilla.org/en/CSS/radial-gradient
// The values themselves are not processed here, so anything which is
// supported by the browsers should also be supported here.
// 
// The function sets the appropriate style properties on the display DIV
// to implement the gradient specification.
// Remark: this is not really supported, at least for webkit browsers, see
// remark below.
//

function copyBackgroundRadialGradientCssProp(displayDiv, gradientProps)
{
    gradientProps = getDeOSedValue(gradientProps);
    
    var stops = parseColorStopsArr(gradientProps.stops);

    if(!stops)
        return;
    
    var radialGradientStr = "radial-gradient(";
    if(gradientProps.shape || gradientProps.size) {
        radialGradientStr +=
            (gradientProps.shape ? gradientProps.shape + " " : "") +
            (gradientProps.size ? gradientProps.size : "") +
            (gradientProps.centerPoint ? "" : ", ");
    }
    
    if(gradientProps.centerPoint) {
        radialGradientStr += " at " + gradientProps.centerPoint + ",";
    }

    radialGradientStr += stops + ')';

    assignCSSStyleProp(displayDiv.style, "background", radialGradientStr);
}

function copyBackgroundImage(displayDiv, value) {
    var resetAttributes = {position: true, size: true, repeat: true};

    for (var attr in value) {
        var v = getDeOSedValue(value[attr]);
        // Note: concatenation is 10x faster than lookup in all 3 major browsers
        assignCSSStyleProp(displayDiv.style, "background-" + attr,
                           attr === "image"? "url('" + v + "')": v);
    }
    for (attr in resetAttributes) {
        if (!(attr in value)) {
            assignCSSStyleProp(displayDiv.style, "background-" + attr, "");
        }
    }
}

/*****************************************************************************/

// This function takes as input a attribute + value pair and an object
// ('elements') which holds display elements which the given property could
// be applied to. The function then applies the property to the appropriate
// element(s) if they appear in the 'elements' object.
// The 'elements' object can contain any subset of the following fields
// (the possibilities here are the same as the elements which may be stored
// on the 'Display' object):
// {
//    frameDiv: <element>
//    embeddingDiv: <element>
//    displayDiv: <element>
//    displayElement: {
//       root: <element> // top level element inside display div
//       content: <element> // contains the image or text
//       format: <element> // applies formatting to the content
//    }
// }
// 

var cssPropTranslationTable = {
    borderTopLeftRadius: ["border-top-left-radius"],
    borderTopRightRadius: ["border-top-right-radius"],
    borderBottomLeftRadius: ["border-bottom-left-radius"],
    borderBottomRightRadius: ["border-bottom-right-radius"],
    borderStyle: "border-style",
    borderLeftStyle: "border-left-style",
    borderRightStyle: "border-right-style",
    borderTopStyle: "border-top-style",
    borderBottomStyle: "border-bottom-style",
    borderColor: "border-color",
    borderLeftColor: "border-left-color",
    borderRightColor: "border-right-color",
    borderTopColor: "border-top-color",
    borderBottomColor: "border-bottom-color",
    borderWidth: "border-width",
    borderLeftWidth: "border-left-width",
    borderRightWidth: "border-right-width",
    borderTopWidth: "border-top-width",
    borderBottomWidth: "border-bottom-width",
    boxShadow: "boxShadow",
    paddingTop: "padding-top",
    paddingBottom: "padding-bottom",
    paddingLeft: "padding-left",
    paddingRight: "padding-right",
    textShadow: "text-shadow",
    textOverflow: "text-overflow",
    wordBreak: "word-break",
    fontFamily: "font-family",
    fontSize: "font-size",
    fontStyle: "font-style",
    fontWeight: "font-weight",
    fontVariant: "font-variant",
    lang: "lang",
    direction: "direction",
    writingMode: "writing-mode",
    textOrientation: "text-orientation",
    hyphens: ["hyphens","-ms-hyphens","-webkit-hyphens"],
    letterSpacing: "letter-spacing",
    wordSpacing: "word-spacing",
    lineHeight: "line-height",
    textDecoration: "text-decoration",
    boxShadow: ["box-shadow", "MozBoxShadow", "-webkit-box-shadow"],
    textFillColor: ["text-fill-color", "-webkit-text-fill-color",
                    "MozTextFillColor"],
    textStrokeWidth: ["text-stroke-width", "-webkit-text-stroke-width",
                    "MozTextStrokeWidth"],
    textStrokeColor: ["text-stroke-color", "-webkit-text-stroke-color",
                    "MozTextStrokeColor"],
    textAlign: "text-align",
    textAlignLast: "text-align-last",
    textIndent: "text-indent",
    textTransform: "text-transform",
    verticalAlign: "vertical-align",
    backgroundColor: "background-color",
    transform: ["transform", "-webkit-transform"],
    hoverText: "title",
    whiteSpace: "white-space",
    viewFilter: "filter",
    viewOpacity: "opacity"
};

function num2Pixel(value) {
    var value2 = parseFloat(getDeOSedValue(value));
    return isNaN(value2)? value: value2 + "px";
}

// The input value can be a single or pair of length or percentage values.
// If one or both of the values are numbers, a "px" prefix is added to them.
function pair2Pixels(value) {
    value = getDeOSedValue(value);
    if(!isNaN(value)) // a pure number
        return value + "px";
    // check whether can be split into two
    var values = value.split(/\s+/);
    if(values.length < 2 || values[1] == "")
        return value; // single value, nothing more to do

    return num2Pixel(values[0]) + " " + num2Pixel(values[1]); 
}

function copyDisplayCssProp(display, attrib, value) {
    if (display.displayDiv === undefined) {
        return;
    }
    value = getDeOSedValue(value);
    switch (attrib) {
      case "displayType":
      case "text":
      case "html":
      case "iframe":
      case "triangle":
      case "arc":
      case "line":
      case "image":
      case "pointerOpaque":
      case "transition":
      case "foreign":
        return;
      case "background":
        var resetBackgroundColor = true, resetBackgroundImage = true;
        if (value instanceof Object) {
            if ("linearGradient" in value) {
                copyBackgroundLinearGradientCssProp(display.displayDiv,
                                                    value.linearGradient);
                resetBackgroundColor = false;
                resetBackgroundImage = false;
            } else if ("radialGradient" in value) {
                copyBackgroundRadialGradientCssProp(display.displayDiv,
                                                    value.radialGradient);
                resetBackgroundColor = false;
                resetBackgroundImage = false;
            } else if ("image" in value) {
                copyBackgroundImage(display.displayDiv, value);
                resetBackgroundImage = false;
                if ("color" in value) {
                    resetBackgroundColor = false;
                }
            }
        } else {
            if(typeof(value) == "string" &&
               (value.indexOf("-webkit-") != -1 ||
                value.indexOf("gradient") != -1)) {
                cdlAuthorError("Unsupported attribute: " +
                                   attrib + "=" + vstringify(value));
            } else {
                assignCSSStyleProp(display.displayDiv.style,
                                   "backgroundColor", value);
                resetBackgroundColor = false;
            }
        }
        if (resetBackgroundColor) {
            assignCSSStyleProp(display.displayDiv.style,
                               "backgroundColor", "");
        }
        if (resetBackgroundImage) {
            assignCSSStyleProp(display.displayDiv.style,
                               "background-image", "");
        }
        return;
      case "borderTopLeftRadius":
      case "borderTopRightRadius":
      case "borderBottomLeftRadius":
      case "borderBottomRightRadius":
        assignCSSStylePropToElements(display, ["displayDiv", "frameDiv"],
                                     attrib, pair2Pixels(value));
        return;
      case "boxShadow":
        if (value !== "" && !display.independentContentPosition) {
            var finalVal = "";
            if (!(value instanceof Array))
                value = [value];
            for (var i = 0; i !== value.length; i++) {
                if (value[i].color !== undefined &&
                      value[i].horizontal !== undefined &&
                      value[i].vertical !== undefined) {
                    if (i !== 0)
                        finalVal += ", ";
                    if (value[i].inset)
                        finalVal += "inset ";
                    finalVal += num2Pixel(value[i].horizontal) + " " +
                          num2Pixel(value[i].vertical);
                    if (value[i].blurRadius !== undefined) {
                        finalVal += " " + num2Pixel(value[i].blurRadius);
                        if (value[i].spread !== undefined) {
                            finalVal += " " + num2Pixel(value[i].spread);
                        }
                    }
                    finalVal += " " + getDeOSedValue(value[i].color);
                }
            }
            if (display.frameDiv) {
                display.frameDiv.style.overflow =
                      finalVal !== ""? "visible": "hidden";
            }
            assignCSSStyleProp(display.displayDiv.style,
                               attrib, finalVal);
        } else {
            if (display.frameDiv) {
                display.frameDiv.style.overflow = "hidden";
            }
            assignCSSStyleProp(display.displayDiv.style, attrib, "");
        }
        return;
      // Non webkit/moz specific
      case "borderStyle":
      case "borderWidth":
      case "borderColor":
      case "borderLeftStyle":
      case "borderLeftWidth":
      case "borderLeftColor":
      case "borderRightStyle":
      case "borderRightWidth":
      case "borderRightColor":
      case "borderTopStyle":
      case "borderTopWidth":
      case "borderTopColor":
      case "borderBottomStyle":
      case "borderBottomWidth":
      case "borderBottomColor":
      case "paddingTop":
      case "paddingBottom":
      case "paddingLeft":
      case "paddingRight":
      case "opacity":
        assignCSSStyleProp(display.displayDiv.style, attrib, value);
        return;
      case "viewOpacity":
        if(display.frameDiv)
            assignCSSStyleProp(display.frameDiv.style, "opacity", value);
        return;
      case "filter":
        assignCSSStyleProp(display.displayDiv.style, attrib,
                           getCSSFilterString(value));
        return;
      case "viewFilter":
        var filterCSSString = getCSSFilterString(value);
        if(display.frameDiv)
            assignCSSStyleProp(display.frameDiv.style, "filter",
                               filterCSSString);
        return;
      case "hoverText":
        display.displayDiv.title = value;
        return;
      case "windowTitle":
        if (typeof(value) === "string") {
            document.title = value;
        }
        return;
      case ".tag": // a place to store some kind of information
        return;
      case "transform":
        display.applyHTMLTransform(value);
        return;
      default:
        cdlAuthorError("Unsupported attribute: " + attrib + "=" +
                           vstringify(value));
        return;
    }
}

function getCSSFilterString(v) {
    var filterString = "";

    if (!v || !(v instanceof Object)) {
        return "";
    }
    
    if(v instanceof Array) {
        for(var i = 0, l = v.length ; i < l ; ++i)
            filterString += " " + getCSSFilterString(v[i]);
        return filterString;
    }
    
    var filterTranslate = {dropShadow: "drop-shadow", hueRotate: "hue-rotate"};
    var numberSuffix = {blur: "px", hueRotate: "deg"};

    for (var attr in v) {
        var val = getDeOSedValue(v[attr]);
        if(attr == "url")
            val = '"' + val + '"';
        else {
            if (typeof(val) === "number" && attr in numberSuffix) {
                val += numberSuffix[attr];
            }
            if (attr in filterTranslate) {
                attr = filterTranslate[attr];
            }
        }
        filterString += " " + attr + "(" + val + ")";
    }
    return filterString;
}

//
// CSS Transitions
//

// Convert the CDL description of the properties of a CSS transition
// to the corresponding CSS string. 'transitionSpec' may be a number,
// string or object (possibly wrapped in an array).

function getCSSTransitionSpecStr(transitionSpec) {

    var transitionStr;
    
    if(transitionSpec instanceof Array)
        transitionSpec = transitionSpec[0];
    
    switch (typeof(transitionSpec)) {
    case "number":
        transitionStr = transitionSpec + "s";
        break;
    case "string":
        transitionStr = transitionSpec;
        break;
    case "object":
        transitionStr = "";
        if ("duration" in transitionSpec) {
            transitionStr += typeof(transitionSpec.duration) === "number"?
                transitionSpec.duration + "s" : transitionSpec.duration;
            if ("delay" in transitionSpec) {
                transitionStr += " " +
                    (typeof(transitionSpec.delay) === "number"?
                     transitionSpec.delay + "s" : transitionSpec.delay);
            }
        }
        if ("timingFunction" in transitionSpec)
            transitionStr += " " + transitionSpec.timingFunction;
        break;
    }

    return transitionStr;
}

var elementTransitionProperties = {
    transform: true,
    color: true
}

// The transition properties defined for each type of DOM element

var transitionPropertiesByElement = {
    frame: {
        top: true,
        left: true,
        width: true,
        height: true,
        borderRadius: true,
        borderTopLeftRadius: true,
        borderTopRightRadius: true,
        borderBottomLeftRadius: true,
        borderBottomRightRadius: true,
        viewFilter: true,
        viewOpacity: true,
        shadowBox: true
    },
    display: {
        width: true,
        height: true,
        background: true,
        borderColor: true,
        borderLeftColor: true,
        borderRightColor: true,
        borderTopColor: true,
        borderBottomColor: true,
        borderWidth: true,
        borderLeftWidth: true,
        borderRightWidth: true,
        borderTopWidth: true,
        borderBottomWidth: true,
        borderRadius: true,
        borderTopLeftRadius: true,
        borderTopRightRadius: true,
        borderBottomLeftRadius: true,
        borderBottomRightRadius: true,
        opacity: true,
        filter: true
    },
    root: {
        width: true,
        height: true,
        transform: true,
        color: true
    }
}

// Given the object 'transitions' describing the 'transition' display
// property of an area and an 'elementName' indicating which of the
// DOM elements these transitions should be set on ("frame" for the
// frame DIV, "display" for the display DIV and "root" for the root of
// the display element), this function returns the string which should be
// set under the 'transition' CSS property of that element.

function getTransitionStr(transitions, elementName) {
    
    var transitionStr = "";

    // returns a new object with the transitions which need to be set on the
    // element of the given type
    function getAttrList(transitions, elementName) {
        var newTransitions = {};
        // transition properties for the given DOM element
        var elementTransitions = transitionPropertiesByElement[elementName];

        if(elementTransitions === undefined)
            return newTransitions;
        
        for (var attr in transitions) {
            if(!(attr in elementTransitions))
                continue;
            if(attr in expandingAttributes) {
                // attribute should be expanded to multiple attribute, but
                // without overriding the more specific attribute (if defined
                // explicitly)
                var expanding = expandingAttributes[attr];
                for(var i = 0; i < expanding.length; i++) {
                    if(!(expanding[i] in transitions)) // not explicitly defined
                        newTransitions[expanding[i]] = transitions[attr];
                }
            } else
                newTransitions[attr] = transitions[attr];
        }

        return newTransitions;
    }
    
    transitions = getAttrList(transitions, elementName);

    for(var attr in transitions) {
        var cssProp = attr in cssPropTranslationTable?
            cssPropTranslationTable[attr]: attr;
        var transition = transitions[attr];
        for (var i = 0;
             (cssProp instanceof Array && i < cssProp.length) || i < 1;
             i++) {
            var cssPropI = cssProp instanceof Array? cssProp[i]: cssProp;
            if (transitionStr.length > 0)
                transitionStr += ",";
            transitionStr +=
                cssPropI + " " + getCSSTransitionSpecStr(transition);
        }
    }
    return transitionStr;
}


// 'styleObj' is the style object of a DOM element to which transitions
// should be applied. 'elementName' indicates which element it is:
// "frame" for the frame DIV, "display" for the display DIV and
// "root" for the root element of the display element. 'transitions' is
// the object describing the transition property for this area.
// This function decides which of the properties specified in
// 'transitions' need to have its transition set of the given style object.
// The function then sets the transition as needed.

function copyTransitionCssProp(styleObj, elementName, transitions) {
    styleObj.setProperty("transition",
                         getTransitionStr(transitions, elementName));
}

function resetTransitionCssProp(styleObj) {
    styleObj.removeProperty("transition");
}

/*****************************************************************************/

// This function takes as input a attribute + value pair and an object
// ('elements') which holds display elements which the given property could
// be applied to. The function then applies the property to the appropriate
// element(s) if they appear in the 'elements' object.
// The 'elements' object should be of the same format as the 'displayElement'
// object of the Display object.
// {
//     root: <element>
//     table: <element> // optional
//     row: <element>   // optional
//     cell: <element>  // optional
// }
// The difference between this function and copyDisplayCssProp is that this
// function handles properties which are defined in specific display type
// (e.g. 'text') section and applies them to the 'displayElement' elements
// whereas copyDisplayCssProp handles top level (defined directly under
// 'display') properties which are applied to the frame/display/embedding DIVs.
// For this reason, this function also has a 'dsplayType' argument
// (the display type under which the properties appear).

var elementsWithTextProperties = {
    text: true,
    div: true,
    input: true
};

function copyDisplayTypeCssProp(displayType, elements, attrib, value)
{
    if(elements === undefined || elements.format === undefined)
        return;
    
    value = getDeOSedValue(value);
    // Filter out non-CSS fields
    switch (displayType) {
        case 'text':
        case 'html':
            switch (attrib) {
                case 'value':
                case 'numericFormat':
                case 'dateFormat':
                case 'input':
                case 'handleClick':
                    return;
                default:
                    break;
            }
            break;
        case 'image':
            switch (attrib) {
                case "URL":
                    return;
                default:
                    break;
            }
            break;
        default:
            break;
    }

    switch (attrib) {
      case "preformatted":
        break;
      case "textFillColor":
      case "textStrokeColor":
      case "fontFamily":
      case "fontStyle":
      case "fontWeight":
      case "fontVariant":
      case "color":
      case "textDecoration":
      case "writingMode":
        assignCSSStyleProp(elements.format.style, attrib, value);
        break;
      case "textStrokeWidth":
      case "fontSize":
      case "letterSpacing":
      case "textIndent":
      case "wordSpacing":
        assignCSSStyleProp(elements.format.style, attrib, num2Pixel(value));
        break;
      case "textOverflow":
      case "whiteSpace":
      case "lineHeight":
      case "textAlign":
      case "textAlignLast":
      case "textTransform":
      case "verticalAlign":
      case "hyphens":
      case "wordBreak":
      case "direction":
      case "textOrientation":
        // These properties are not inherited, since they mean something else
        // in a cell than in a div.
        if (elements.content !== undefined) {
            assignCSSStyleProp(elements.content.style, attrib, value);
        }
        break;
      case "textShadow":
        if (elements.type in elementsWithTextProperties && elements.format) {
            value = ensureOS(value);
            var finalVal = "";
            for (var i = 0; i !== value.length; i++) {
                if (i !== 0)
                    finalVal += ", ";
                finalVal += num2Pixel(value[i].horizontal) + " " +
                        num2Pixel(value[i].vertical);
                if (value[i].blurRadius) {
                    finalVal += " " + num2Pixel(value[i].blurRadius);
                }
                finalVal += " " + getDeOSedValue(value[i].color);
            }
            assignCSSStyleProp(elements.format.style, attrib,
                               finalVal === ""? "none": finalVal);
        }
        break;
      case "lang":
        // This is a global attribute, not a style attribute, so it is set
        // directly on the element
        if (elements.content !== undefined)
            elements.content.setAttribute(attrib, value);
        break;
      default:
        cdlAuthorError('Unsupported attribute: ' + attrib + '=' +
                           JSON.stringify(value));
        return;
    }
}

/******************************************************************************/

function getTransformObjectAsString(val) {
    var str = "";

    if(val instanceof Array) {
        for(var i = 0, l = val.length ; i < l ; ++i)
            str += getTransformObjectAsString(val[i]);
        return str;
    }
    
    if (val instanceof Object) {
        var rotate = getDeOSedValue(val.rotate);
        if (typeof(rotate) === "number") {
            str += "rotate(" + rotate + "deg) ";
        }
        var scale = getDeOSedValue(val.scale);
        if (typeof(scale) === "number") {
            str += "scale(" + scale + ") ";
        } else if (scale instanceof Object) {
            var x = getDeOSedValue(scale.x);
            if (typeof(x) === "number") {
                str += "scaleX(" + x + ") ";
            }
            var y = getDeOSedValue(scale.y);
            if (typeof(y) === "number") {
                str += "scaleY(" + y + ") ";
            }
        }
        var skew = getDeOSedValue(val.skew);
        if (skew instanceof Object) {
            var x = getDeOSedValue(skew.x);
            if(x !== undefined)
                str += "skewX(" + x + ((typeof(x) == "number") ? "deg) ":") ");
            var y = getDeOSedValue(skew.y);
            if(y !== undefined)
                str += "skewY(" + y + ((typeof(y) == "number") ? "deg) ":") ");
        }
        if (val.flip !== undefined) {
            var flip = getDeOSedValue(val.flip);
            if (flip === "horizontally" ||
                (flip instanceof Array && flip.indexOf("horizontally") !== -1)) {
                str += "matrix(-1,0,0,1,0,0) ";
            } else if (flip === "vertically" ||
                  (flip instanceof Array && flip.indexOf("vertically") !== -1)) {
                str += "matrix(1,0,0,-1,0,0) ";
            }
        }
        var matrix = getDeOSedValue(val.matrix); 
        if(matrix instanceof Object) {
            var a = getDeOSedValue(matrix.a);
            var b = getDeOSedValue(matrix.b);
            var c = getDeOSedValue(matrix.c);
            var d = getDeOSedValue(matrix.d);
            var tx = getDeOSedValue(matrix.tx);
            var ty = getDeOSedValue(matrix.ty);
            str += "matrix("+a+","+b+","+c+","+d+","+tx+","+ty+") "
        }
    }
    return str;
}
