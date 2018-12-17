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
    borderTopLeftRadius: [
        "-webkit-border-top-left-radius", "-moz-border-radius-topleft",
        "border-top-left-radius"],
    borderTopRightRadius: [
        "-webkit-border-top-right-radius", "-moz-border-radius-topright",
        "border-top-right-radius"],
    borderBottomLeftRadius: [
        "-webkit-border-bottom-left-radius", "-moz-border-radius-bottomleft",
        "border-bottom-left-radius"],
    borderBottomRightRadius: [
        "-webkit-border-bottom-right-radius", "-moz-border-radius-bottomright",
        "border-bottom-right-radius"],
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
    fontFamily: "font-family",
    fontSize: "font-size",
    fontStyle: "font-style",
    fontWeight: "font-weight",
    fontVariant: "font-variant",
    lineHeight: "line-height",
    textDecoration: "text-decoration",
    boxShadow: ["box-shadow", "MozBoxShadow", "-webkit-box-shadow"],
    overflowX: "overflow-x",
    overflowY: "overflow-y",
    textFillColor: ["text-fill-color", "-webkit-text-fill-color",
                    "MozTextFillColor"],
    textStrokeWidth: ["text-stroke-width", "-webkit-text-stroke-width",
                    "MozTextStrokeWidth"],
    textStrokeColor: ["text-stroke-color", "-webkit-text-stroke-color",
                    "MozTextStrokeColor"],
    borderSpacing: "border-spacing",
    textAlign: "text-align",
    textIndent: "text-indent",
    textTransform: "text-transform",
    verticalAlign: "vertical-align",
    backgroundColor: "background-color",
    transform: ["transform", "-webkit-transform"],
    hoverText: "title",
    overflow: "text-overflow",
    whiteSpace: "white-space"
};

function num2Pixel(value) {
    value = getDeOSedValue(value);
    return isNaN(value)? value: value + "px";
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
      case "transitions":
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
                                     attrib, num2Pixel(value));
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
      case "overflowX":
      case "overflowY":
      case "paddingTop":
      case "paddingBottom":
      case "paddingLeft":
      case "paddingRight":
      case "opacity":
        assignCSSStyleProp(display.displayDiv.style, attrib, value);
        return;
      case "filter":
        assignCSSStyleProp(display.displayDiv.style, attrib, getCSSFilterString(value));
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
    var filterTranslate = {dropShadow: "drop-shadow", hueRotate: "hue-rotate"};
    var numberSuffix = {blur: "px", hueRotate: "deg"};

    if (!v || !(v instanceof Object)) {
        return "";
    }
    for (var attr in v) {
        var val = getDeOSedValue(v[attr]);
        if (typeof(val) === "number" && attr in numberSuffix) {
            val += numberSuffix[attr];
        }
        if (attr in filterTranslate) {
            attr = filterTranslate[attr];
        }
        filterString += " " + attr + "(" + val + ")";
    }
    return filterString;
}

var elementTransitionProperties = {
    transform: true,
    color: true
}

function copyTransitionCssProp(styleObj, displayElement, transitions) {

    function getTransitionStr(inElement) {
        var transitionStr = "";

        for (var attr in transitions) {
            if (inElement !== elementTransitionProperties[attr])
                continue;
            var cssProp = attr in cssPropTranslationTable?
                cssPropTranslationTable[attr]: attr;
            var transition = transitions[attr];
            for (var i = 0;
                (cssProp instanceof Array && i < cssProp.length) || i < 1;
                i++) {
                var cssPropI = cssProp instanceof Array? cssProp[i]: cssProp;
                if (transitionStr.length > 0) {
                    transitionStr += ",";
                }
                transitionStr += cssPropI + " ";
                if(transition instanceof Array)
                    transition = transition[0];
                switch (typeof(transition)) {
                case "number":
                    transitionStr += transition + "s";
                    break;
                case "string":
                    transitionStr += transition;
                    break;
                case "object":
                    if ("duration" in transition) {
                        transitionStr +=
                        typeof(transition.duration) === "number"?
                            transition.duration + "s":
                            transition.duration;
                        if ("timingFunction" in transition) {
                            transitionStr += " " +
                                transition.timingFunction;
                            if ("delay" in transition) {
                                transitionStr += " " + transition.delay;
                            }
                        }
                    }
                    break;
                }
            }
        }
        return transitionStr;
    }

    styleObj.setProperty("transition", getTransitionStr(undefined));
    if (displayElement !== undefined && displayElement.root !== undefined) {
        displayElement.root.style.setProperty("transition",
                                              getTransitionStr(true));
    }
}

function resetTransitionCssProp(styleObj, displayElement) {
    styleObj.removeProperty("transition");
    if (displayElement !== undefined && displayElement.root !== undefined) {
        displayElement.root.style.removeProperty("transition");
    }
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
      case "clip":
        // TODO
        break;
      case "textFillColor":
      case "textStrokeColor":
      case "fontFamily":
      case "fontStyle":
      case "fontWeight":
      case "fontVariant":
      case "color":
      case "textDecoration":
      case "borderSpacing":
        assignCSSStyleProp(elements.format.style, attrib, value);
        break;
      case "textStrokeWidth":
      case "fontSize":
        assignCSSStyleProp(elements.format.style, attrib, num2Pixel(value));
        break;
      case "overflow":
      case "whiteSpace":
      case "lineHeight":
      case "textAlign":
      case "textIndent":
      case "textTransform":
      case "verticalAlign":
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
      default:
        cdlAuthorError('Unsupported attribute: ' + attrib + '=' +
                           JSON.stringify(value));
        return;
    }
}

/******************************************************************************/

function getTransformObjectAsString(val, displayType, parentWidth) {
    var str = "";

    if (val instanceof Object) {
        if (typeof(val.rotate) === "number") {
            if (displayType === "text") {
                // A text display is not centered; the element resizes itself,
                // so a simple rotation will only rotate around the display's
                // center when the text fits.
                str += "translateX(-50%) translateX(" + parentWidth / 2 + "px) rotate(" + val.rotate + "deg) ";
            } else {
                str += "rotate(" + val.rotate + "deg) ";
            }
        }
        if (typeof(val.scale) === "number") {
            str += "scale(" + val.scale + ") ";
        } else if (val.scale instanceof Object) {
            if (typeof(val.scale.x) === "number") {
                str += "scaleX(" + val.scale.x + ") ";
            }
            if (typeof(val.scale.y) === "number") {
                str += "scaleY(" + val.scale.y + ") ";
            }
        }
        if (val.flip !== undefined) {
            if (val.flip === "horizontally" ||
                (val.flip instanceof Array && val.flip.indexOf("horizontally") !== -1)) {
                str += "matrix(-1,0,0,1,0,0) ";
            } else if (val.flip === "vertically" ||
                  (val.flip instanceof Array && val.flip.indexOf("vertically") !== -1)) {
                str += "matrix(1,0,0,-1,0,0) ";
            }
        }
    }
    return str;
}
