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
// this file defines the Display classes, which interact with the browser to
//  render the areas.
// there are three display classes defined here:
//
// - ContentDisplay - handles the conversion of most of the display description
//    to DOM elements
//
// - Display (might be called 'AreaDisplay') - a derived class of ContentDisplay
//    adding additional divs requires by the area - frame and embedding,
//    as well as other interactions and callbacks from the display elements into
//    the area
//
// - SurveyDisplay - a derived class of ContentDisplay, which uses automatic
//    DOM layout features to measure a 'natural' size, mostly for text and
//    images
//
//
// ContentDisplay
//////////////////////////////////////////////////////////////////
//
// The ContentDisplay class manages the 'display div'.
// the display div contains one or more HTML element that visualize the actual
// content, which can be plain text, raw HTML, an image or canvas shapes
//
// The properties of the HTML element(s) created here depend on the
// properties appearing under the 'display' attribute of the description.
//
// displayElement: this is a description of the HTML elements which are embedded
//           in the displayDiv and which actually display the content. The type
//           and properties of this element and all elements embedded in it are
//           defined by the 'display' section of the area description. This
//           element is not positioned by the positioning system.  Usually (if
//           not always) it's size is 100% of the displayDiv.
//           The displayElement consists of four attributes:
//           - root: the highest HTML element that displays the content
//           - format: the HTML element that should receive style formatting
//           - content: the HTML element that contains the actual content
//           - type: a string indicating the display type.
//           The display element can also contain an object postAddAction,
//           which contains values that have to be assigned to the root element
//           after adding it to the dom.
//
// The type and properties of the display element are defined by the properties
// in the area description display section. The properties of the element(s)
// embedded inside it are determined both by properties in the display section
// of the description and by a 'text' string which is the 'content' of the
// display (the text to be displayed, the URL of an image, etc.).
//
// It is possible to refresh the display fully (in which case all display
// properties are refreshed) or to refresh only the content of the display
// (the 'text' of the display) in cases where we know that only the content,
// for example, the text, and not the display properties, has changed.
//
//
//
//
// Display (aka 'AreaDisplay')
//////////////////////////////////////////////////////////////////
//
// This object implements the displaying of an area. An area's root element is a
// div that represents the area, and which contains a div for displaying the
// contents, and a div for embedding other areas. 
//   This object also creates and destroys the frame and display DIVs, but
// does not manage their size (this is done by the positioning system).
//
// The display is managed by several HTML elements:
//
// frameDiv: This is a transparent DIV in which all other display elements
//           are embedded. This means that it provides a 'window' defining
//           the visible part of the display. The size of the frame DIV is
//           determined by the positioning system.
//           Some display properties may be implemented on the frame DIV.
//           Currently, the shadow is applied to the frame DIV (it is not
//           clear whether this is the right way to do this).
// embedding Div: Inside this DIV the frame DIVs of embedded areas are
//           embedded. This DIV is constructed only when embedded areas exist.
//           This DIV is transparent and has its position determined by
//           the positioning system (the 'content position').
// displayDiv: This DIV is used to actually perform the display of the
//           area. Some display properties are assigned to it directly
//           (such as borders and background color) while other properties
//           and content are embedded inside it. This element is positioned
//           by the positioning system (based on the 'content position' with
//           correction for the border width - see 'AbsolutePosManager' for
//           details). This element is created on demand.

//
//
// ContentDisplay Constructor
//

// The constructor only creates the necessary elements which must be part
// of any area. The display will be initialized when the description
// is provided to 'configurationUpdate'

// %%include%%: "element.js"

function ContentDisplay() {
    this.displayDiv = undefined;
    this.descriptionDisplay = undefined;
    this.prevProperties = undefined;
    this.prevDisplayType = undefined;
    this.displayType = undefined;
    this.displaySubType = undefined;
    this.displayElement = undefined;
    this.showEmbedding = true;
    this.nrTextNodes = 0;

    // The following attributes concern the placing of the canvas.
    // lineFrameOffset: when true, the embedded div must be placed at the
    // contentPos because there's no real border to push the div in its place;
    // when false, the embedded div is at the displayDivPos.
    this.lineFrameOffset = true;
    // extraWidth: nr extra pixels needed in the width for shadow or line caps
    this.extraWidth = 0;
    // extraHeight: nr extra pixels needed in the height for shadow or line caps
    this.extraHeight = 0;
    // negativeShiftLeft: nr pixels the canvas is shifted to the left (also for
    // shadow or line caps)
    this.negativeShiftLeft = 0;
    // negativeShiftTop: nr pixels the canvas is shifted above the top (also for
    // shadow or line caps)
    this.negativeShiftTop = 0;

    // Tracks whether display is in zero offset positioning mode
    this.inZeroOffsetPosMode = false;
}

// --------------------------------------------------------------------------
// destroy
//
ContentDisplay.prototype.destroy = function() {
    this.destroyDisplayElement("displayDiv");
    if (this.hasLinePositioningOffsets) {
        this.unregisterLinePositioningOffsets();
    }
}

// --------------------------------------------------------------------------
// destroyDisplayElement
//
ContentDisplay.prototype.destroyDisplayElement = function(domElemAttr) {
    if (typeof(this[domElemAttr]) !== "undefined") {
        removeElement(this[domElemAttr]);
        this[domElemAttr] = undefined;
    }
}

// --------------------------------------------------------------------------
// removeDisplayElement
//
// This function performs the actions required to completely remove
// the current display element, both from the Display object and from
// the HTML DOM tree.
//
ContentDisplay.prototype.removeDisplayElement = function() {
    var displayElement = this.displayElement;

    this.displayElement = undefined;
    if (displayElement && displayElement.root) {
        removeElement(displayElement.root);
    } 
}

// Places the embedding div at the content position: if there is independent
// content positioning or a border, the embedding div is shifted to that place.
// The display div can be put in another position if there is a border, since
// the border grows outwards. E.g., if the border to the top is 2px, the
// displayDiv is 2px higher than the embedding div, so they align.
// If there is no real border on the display, and the content offset is
// triggered by another display element (currently only display:line:, in order
// to allow rendering the line caps without clipping), the display div is
// also positioned according to the content pos.

ContentDisplay.prototype.updatePos = function(contentPos, displayPos) {
    if (this.displayDiv) {
        updateElementPos(this.displayDiv,
                         this.lineFrameOffset? contentPos: displayPos);
    }
    if (this.embeddingDiv) {
        updateElementPos(this.embeddingDiv, contentPos);
    }
    this.inZeroOffsetPosMode = false;
}

ContentDisplay.prototype.updateZeroOffsetPos = function(relative) {
    if (!this.inZeroOffsetPosMode) {
        if (this.displayDiv) {
            setZeroOffsetElementPos(this.displayDiv);
        }
        if (this.embeddingDiv) {
            setZeroOffsetElementPos(this.embeddingDiv);
        }
        this.inZeroOffsetPosMode = true;
    }
    if (this.displayDiv) {
        updateZeroOffsetElementPos(this.displayDiv, relative);
    }
    if (this.embeddingDiv) {
        updateZeroOffsetElementPos(this.embeddingDiv, relative);
    }
}

ContentDisplay.prototype.getRotation = function() {
    var transform = this.descriptionDisplay.transform;

    if (typeof(transform) === "object") {
        if (typeof(transform.rotation) === "number") {
            return transform.rotation;
        }
    }
    return 0;
}
    
// --------------------------------------------------------------------------
// configurationUpdate
//
// - configuration describes the new display.
// - when applyChange is true, the div will be changed to match configuration;
//   when applyChange is false, only internal changes are made.
// - applyTransition can be false in order to suppress setting transitions.
//
ContentDisplay.prototype.configurationUpdate = function(
    configuration, applyChange, applyTransition) {
    this.descriptionDisplay = configuration; // it's safe to use configuration
                                             // as it cannot be changed

    this.createDisplayDiv(); // does nothing if the DIV already exists

    this.displayContentRefresh(true, applyChange, applyTransition);

    // Store this
    this.prevProperties = this.displayProperties;
    this.prevDisplayType = this.displayType;
}

ContentDisplay.prototype.getTransitions = function() {
    return this.descriptionDisplay !== undefined?
          this.descriptionDisplay.transitions: undefined;
}


// --------------------------------------------------------------------------
// applyTransitionProperties
//
ContentDisplay.prototype.applyTransitionProperties = function(transitions) {
    if (this.descriptionDisplay !== undefined) {
        copyTransitionCssProp(
            this.displayDiv.style, this.displayElement, transitions);
        if(this.embeddingDiv)
            copyTransitionCssProp(
                this.embeddingDiv.style, this.displayElement, transitions);
    }
}

// Currently supported display types

ContentDisplay.displayTypes = {
    text: {value: true, input: true},
    foreign: {value: true},
    image: {src: true, svg: true},
    iframe: {src: true},
    html: {value: true},
    triangle: true,
    line: true,
    arc: true
};

ContentDisplay.displaySubTypes = {
    text: {preformatted: true}
};

// --------------------------------------------------------------------------
// displayContentRefresh
//
// This function reads the display definition of the area, calls the appropriate
// display function (which returns the displayElement) if necessary, and inserts
// it into the specified position in the area. This function modifies the
// existing display if it was already constructed.
//
ContentDisplay.prototype.displayContentRefresh = function(newContent, applyChange, applyTransition) {
    var display = this.descriptionDisplay;
    
    if (display === undefined) {
        return;
    }

    // Remark: the code below assumes a single display element per area
    // (no text + image, for example).
    
    var newDisplayElement;

    var displayType = ContentDisplay.getDisplayType(display);

    if (displayType.type !== this.displayType ||
          displayType.subType !== this.displaySubType) {
        this.setNewDisplayElement(display, displayType);
    }
    this.applyDisplayProperties(display, applyChange, applyTransition);
    if (applyChange) {
        this.setDisplayElementPos();
        this.refreshDisplayContentForType(display, displayType.type, newContent);
    }
}

// --------------------------------------------------------------------------
// getDisplayType (static)
//
ContentDisplay.getDisplayType = function(displayDescription) {
    var type = "empty";
    var subType = undefined;

    function wellDefined(v) {
        return v !== undefined && !(v instanceof Array && v.length === 0);
    }

    for (var displayType in ContentDisplay.displayTypes) {
        var reqSubAttr = ContentDisplay.displayTypes[displayType];
        if (displayDescription[displayType]) {
            if (reqSubAttr === true) {
                type = displayType;
            } else if (displayDescription[displayType] instanceof Object) {
                for (var attr in reqSubAttr) {
                    if (wellDefined(displayDescription[displayType][attr])) {
                        type = displayType;
                        break;
                    }
                }
            }
            if (type !== "empty") {
                break;
            }
        }
    }
    if (displayType in ContentDisplay.displaySubTypes) {
        var subTypeAttr = ContentDisplay.displaySubTypes[displayType];
        for (var attr in subTypeAttr) {
            if (isTrue(displayDescription[displayType][attr])) {
                subType = attr;
                break;
            }
        }
    }
    return { type: type, subType: subType };
}

// --------------------------------------------------------------------------
// setNewDisplayElement
//
// This function receives an object containing an attribute
// 'root' which stored the current or new display element.
// The object may contain additional attributes pointing to sub-elements
// of the display element. If the input object is not the same as
// the existing display element object, this function replaces the old display
// element object with this new object. This includes removing the old
// display element from the displayDiv and inserting the new display element
// instead.
//   When a line display is created, registerVerticalPositioningPoints() adds
// offsets for labels "y0" and "y1" to the absolute pos manager, or
// removes them when the display type no longer is a line.
//   This function also copies properties to the element after adding it to
// the DOM, since setting those properties before adding doesn't always work.
//
ContentDisplay.prototype.setNewDisplayElement = function(display, displayType) {
    // remove the old display element if it exists
    if (this.displayElement)
        this.removeDisplayElement();
    
    this.displayElement =
        this.createDisplayContentForType(display, displayType);
    this.checkLinePositioningOffsets();

    var attr;
    if (this.displayElement !== undefined) {
        // set the new element
        if(!this.displayDiv) {
            this.createDisplayDiv();
        }
        if (this.displayDiv) {
            if (this.displayElement.root) {
                this.displayDiv.appendChild(this.displayElement.root);
            }
            this.postAddActions();
        }
    }
    if (this.prevProperties) {
        for (attr in displayResetProperties) {
            delete this.prevProperties[attr];
        }
    }
    this.previousPositions = undefined;
}

// --------------------------------------------------------------------------
// postAddActions
//
ContentDisplay.prototype.postAddActions = function() {
    // nothing in ContentDisplay; can be overridden in a derived class
}

// --------------------------------------------------------------------------
// createDisplayDiv
//
ContentDisplay.prototype.createDisplayDiv = function(idstr) {
    if(this.displayDiv)
        return false;
    
    if (!this.descriptionDisplay) {
        return false; // No need for a display div
    }
    
    this.displayDiv = createDiv(idstr);
    this.inZeroOffsetPosMode = false;
    return true;
}

// These attributes are shorthand for multiple attributes, but take a lower
// priority
var expandingAttributes = {
    borderRadius: ["borderTopLeftRadius", "borderTopRightRadius",
                   "borderBottomLeftRadius", "borderBottomRightRadius"],
    padding: ["paddingTop", "paddingLeft", "paddingBottom", "paddingRight"]
};

// --------------------------------------------------------------------------
// applyDisplayProperties
//
ContentDisplay.prototype.applyDisplayProperties =
  function(displayProperties, applyChange, applyTransition, noCopy) {
    if (! noCopy) {
        // duplicate, as we may want to change some values
        displayProperties = displayProperties?
            shallowCopy(displayProperties): {};
    }

    // First update the transition properties, otherwise they will apply to the
    // next property change
    if (this.displayDiv && applyTransition) {
        if ("transitions" in displayProperties) {
            copyTransitionCssProp(this.displayDiv.style, this.displayElement,
                                  displayProperties.transitions);
            if(this.embeddingDiv)
                copyTransitionCssProp(this.embeddingDiv.style,
                                      this.displayElement,
                                      displayProperties.transitions);
        } else {
            resetTransitionCssProp(this.displayDiv.style, this.displayElement,
                                   this.displayElement);
            if(this.embeddingDiv)
                resetTransitionCssProp(this.embeddingDiv.style,
                                       this.displayElement,
                                       this.displayElement);
        }
    }
    
    // Expand short hand attributes; don't overwrite more specific attributes.
    for (var expandingAttribute in expandingAttributes) {
        if (expandingAttribute in displayProperties) {
            var attributes = expandingAttributes[expandingAttribute];
            for (var i = 0; i < attributes.length; i++) {
                var attribute = attributes[i];
                if (!displayProperties[attribute]) {
                    displayProperties[attribute] =
                          displayProperties[expandingAttribute];
                }
            }
            delete displayProperties[expandingAttribute];
        }
    }

    // store the properties (after the processing above) for later use
    this.displayProperties = displayProperties;
    // Mark whether there is no content offset as a result of a line or not.
    // See updatePos() for usage.
    this.lineFrameOffset = displayProperties && isAV(displayProperties.line) &&
                           getDeOSedValue(displayProperties.line.width) > 1;

    if (this.prevProperties !== undefined) {
        // reset properties that are no longer set
        for (p in frameResetProperties) {
            if ((!(p in displayProperties) ||
                 displayProperties[p] === undefined) &&
                (p in this.prevProperties &&
                 this.prevProperties[p] !== undefined)) {
                copyDisplayCssProp(this, p, frameResetProperties[p]);
            }
        }
    }
    // Dispatch the top level displayProperties to the correct element (these
    // go to the top level element and not to the displayElement elements).
    // Suppress box-shadow when independentContentPosition is true.
    for (var p in displayProperties) {
        if (this.prevProperties === undefined ||
              displayProperties[p] !== this.prevProperties[p]) {
            copyDisplayCssProp(this, p, displayProperties[p]);
        }
    }
    // Apply the properties which are specific to the displayElement
    // elements
    if (this.displayType == "text" || this.displayType == "html") {
        this.applyDisplayElementProperties(
            this.displayElement, this.displayElement, applyTransition);
    }
}

// --------------------------------------------------------------------------
// applyDisplayElementProperties
//
// This function takes an object of the structure of 'this.displayElement'
// and applies to the elements in it the relevant properties in
// 'this.displayProperties'. Note that 'displayElement' does not
// have to be 'this.displayElement' and can also be some other element
// of the same structure
//
ContentDisplay.prototype.applyDisplayElementProperties =
  function(displayElement, applyTransition) {
    if (!this.displayType || !displayElement || !this.displayProperties)
        return;
    
    var displayType = this.displayType;
    var properties = this.displayProperties[displayType];
    var prevProperties = this.prevProperties === undefined? undefined:
          this.prevProperties[this.prevDisplayType];

    if (applyTransition) {
        if ("transitions" in this.displayProperties) {
            copyTransitionCssProp(displayElement.root.style,
                      this.displayElement, this.displayProperties.transitions);
        } else {
            resetTransitionCssProp(displayElement.root.style, 
                                   this.displayElement, displayElement);
        }
    }

    for (var p in properties) {
        copyDisplayTypeCssProp(displayType, displayElement, p, properties[p]);
    }
    if (prevProperties !== undefined) {
        for (p in displayResetProperties) {
            if ((!(p in properties) || properties[p] === undefined) &&
                  (p in prevProperties && prevProperties[p] !== undefined)) {
                copyDisplayTypeCssProp(displayType, displayElement, p,
                                       displayResetProperties[p]);
            }
        }
    }
}


// --------------------------------------------------------------------------
// createDisplayContentForType
//
// This function receives the display description section and the type
// of display it should create a display element for and create a
// display element for it.

ContentDisplay.prototype.createDisplayContentForType =
  function(displayDesc, type) {
    var oldSubType = this.displaySubType;
    this.displayType = type.type;
    this.displaySubType = type.subType;
    switch (type.type) {
      case "text":
        return this.textContentDisplay(displayDesc, oldSubType, type.subType);
      case "foreign":
        return this.foreignContentDisplay(displayDesc);
      case "html":
        // Just dump the given HTML into a div and display it.
        return this.htmlContentDisplay(displayDesc);
      case "image":
        return this.imageContentDisplay(displayDesc);
      case "iframe":
        return this.iframeContentDisplay(displayDesc);
      case "triangle":
      case "arc":
      case "line":
        return this.canvasContentDisplay(displayDesc, type.type);
      default:
        return undefined;
    }
}

// --------------------------------------------------------------------------
// refreshDisplayContentForType
//
// This function refreshes the contents, assuming that the display element
// is appropriate.
//
ContentDisplay.prototype.refreshDisplayContentForType =
  function(displayDesc, type, newContent) {
    switch (type) {
      case "text":
        if (newContent)
            this.refreshText(displayDesc);
        break;
      case "html":
        if (newContent)
            this.refreshHTML(displayDesc);
        break;
      case "image":
        if (newContent)
            this.refreshImage(displayDesc);
        break;
      case "iframe":
        if (newContent)
            this.refreshIFrame(displayDesc);
        break;
      case "triangle":
        this.refreshTriangle(displayDesc,
                             this.getContentWidth(), this.getContentHeight());
        break;
      case "arc":
        this.refreshArc(displayDesc,
                        this.getContentWidth(), this.getContentHeight());
        break;
      case "line":
        this.refreshLine(displayDesc,
                         this.getContentWidth(), this.getContentHeight());
        break;
    }
}

// --------------------------------------------------------------------------
// getContentWidth
//
ContentDisplay.prototype.getContentWidth = function() {
    return NaN; // override in a derived class
}

// --------------------------------------------------------------------------
// getContentHeight
//
ContentDisplay.prototype.getContentHeight = function() {
    return NaN; // override in a derived class
}

// --------------------------------------------------------------------------
// textContentDisplay
//
// Create (or refresh) the display element for text display. This consists
// of a span inside a div, with table-cell display for the span to allow
// horizontal and vertical centering.
//
// Note that a SurveyDisplay doesn't generate an input element
ContentDisplay.prototype.textContentDisplay =
  function(displayDesc, oldSubType, newSubType) {
    if (displayDesc && displayDesc.text && isTrue(displayDesc.text.input) &&
          this instanceof Display) {
        if (this.displayElement) {
            // Removes the div's content
            this.setText(this.displayElement, undefined);
        }
        return this.createInputCell(displayDesc);
    }

    var innerTag = newSubType === "preformatted"? "pre": "span";
    var innerElt = document.createElement(innerTag);
    if (this instanceof Display) {
        // A SurveyDisplay doesn't need centering in order to measure. It is
        // even counter-productive: it causes wrong sizes for italics (at
        // least in Chrome) and interferes with baseline alignment.
        innerElt.style.display = "table-cell";
        innerElt.style.verticalAlign = "middle";
        innerElt.style.textAlign = "center";
    }
    innerElt.style.overflow = "hidden";
    innerElt.style.width = "100%";
    innerElt.style.height = "100%";
    var div = document.createElement("div");
    div.style.display = "table";
    div.style.position = "absolute";
    div.style.left = '0px';
    div.style.top = '0px';
    div.appendChild(innerElt);
    this.nrTextNodes = 0;
    return {
        root: div,
        format: div,
        content: innerElt,
        type: "text",
        value: undefined
    };
}

// --------------------------------------------------------------------------
// setText
//
// Sets text nodes under the element needed to display parameter text. There is
// a text node for each line plus a <br> element in between. The nodes are
// added/removed when needed; the text of existing nodes is replaced.
//
ContentDisplay.prototype.setText = function(displayElement, text) {
    var element = displayElement.content;
    var textLines = text === undefined? []: text.split("\n");
    var nrLines = textLines.length;
    var i = 0;
    var childNodes = element.childNodes;

    // assert(Math.max(2 * this.nrTextNodes - 1, 0) === childNodes.length);
    // Remove superfluous nodes
    while (nrLines < this.nrTextNodes) {
        // Remove last text line
        element.removeChild(element.lastChild);
        if (this.nrTextNodes > 1) {
            // Remove the <br> element
            element.removeChild(element.lastChild);
        }
        this.nrTextNodes--;
    }
    // nrLines >= this.nrTextNodes
    // Now update text in existing text nodes; note that we skip the <br>
    // elements at the odd positions
    while (2 * i < childNodes.length) {
        childNodes[2 * i].data = textLines[i];
        i++;
    }
    // Add text nodes when needed
    while (i < nrLines) {
        if (i > 0) {
            // Separate with a <br> element
            element.appendChild(document.createElement("br"));
        }
        element.appendChild(document.createTextNode(textLines[i]));
        this.nrTextNodes++;
        i++;
    }
    // assert(Math.max(2 * this.nrTextNodes - 1, 0) === childNodes.length);
    // assert(this.nrTextNodes === nrLines);
}

var copyInputCellAttributes = {
    min: true,
    max: true,
    type: true,
    placeholder: true
};

var copyInputCellStyleAttributes = {
    // nothing for now
};

// --------------------------------------------------------------------------
// createInputCell
//
// Creates the input cell and initializes it with display:text:value:.
//
ContentDisplay.prototype.createInputCell = function(displayDescr) {
    var inputDescr = displayDescr.text.input;
    var inputElementType = "input";
    var inputElement;
    var initialValue = "text" in displayDescr? displayDescr.text.value:
          undefined;
    var extraAttributes = {};

    if (initialValue instanceof Array) {
        initialValue = initialValue[0];
    }
    switch (inputDescr.type) {
      case "number":
        if (initialValue === undefined) {
            initialValue = "";
        } else if (typeof(initialValue) !== "number") {
            initialValue = Number(initialValue);
            if (isNaN(initialValue)) {
                initialValue = 0;
            }
        }
        break;
      case "text":
        if (initialValue === undefined || !isSimpleType(initialValue)) {
            initialValue = "";
        }
        if (getDeOSedValue(inputDescr.multiLine) === true) {
            inputElementType = "textarea";
            extraAttributes.overflow = "scroll";
            extraAttributes.resize = "none";
        }
        break;
      case "password":
        if (initialValue === undefined || !isSimpleType(initialValue)) {
            initialValue = "";
        }
        break;
    }
    inputElement = document.createElement(inputElementType);
    inputElement.value = initialValue;

    for (var attr in inputDescr) {
        if (attr in copyInputCellAttributes) {
            if (copyInputCellAttributes[attr] === true) {
                inputElement[attr] = inputDescr[attr];
            } else {
                inputElement[copyInputCellAttributes[attr]] = inputDescr[attr];
            }
        }
        if (attr in copyInputCellStyleAttributes) {
            if (copyInputCellStyleAttributes[attr] === true) {
                inputElement.style[attr] = inputDescr[attr];
            } else {
                inputElement.style[copyInputCellStyleAttributes[attr]] =
                    inputDescr[attr];
            }
        }
    }

    // Default attributes
    inputElement.style.left = '0px';
    inputElement.style.top = '0px';
    inputElement.style.textAlign = "center";
    inputElement.style.overflow = "hidden";
    inputElement.style.border = 'none';
    inputElement.style.outline = 'none';
    inputElement.style.padding = '0px';
    for (var attr in extraAttributes) {
        inputElement.style[attr] = extraAttributes[attr];
    }

    return {
        root: inputElement,
        format: inputElement,
        content: inputElement,
        type: "input",
        inputType: inputDescr.type
    };
}


// --------------------------------------------------------------------------
// refreshText
//
ContentDisplay.prototype.refreshText = function(displayDesc) {
    var textSection = displayDesc && displayDesc.text;
    var value = textSection && textSection.value;
    var displayType = {
        type: "text",
        subType: textSection && isTrue(textSection.preformatted)?
                 "preformatted": undefined
    };
    var text;

    if (textSection && isTrue(textSection.input) && this instanceof Display) {
        if (this.displayElement.type !== "input" ||
              (this.prevProperties !== undefined &&
               this.prevProperties.text !== undefined &&
               this.prevProperties.text.input !== undefined &&
               this.prevProperties.text.input.multiLine !==
               textSection.input.multiLine)) {
            this.setNewDisplayElement(displayDesc, displayType);
            this.applyDisplayProperties(displayDesc, true, false);
            this.setDisplayElementPos();
        }
        // else leave input untouched
        return;
    } else if (this.displayElement.type !== "text" ||
               this.displaySubType !== displayType.subType) {
        this.setNewDisplayElement(displayDesc, displayType);
        this.applyDisplayProperties(displayDesc, true, false);
        this.setDisplayElementPos();
    }

    // Values now can be arrays
    if (value instanceof Array) {
        if (value.length === 0) {
            value = "";
        } else {
            value = value[0];
        }
    }
    if (value === undefined) {
        value = "";
    }
    if (runTests) {
        // Don't catch exceptions; they should be seen as errors in a test
        text = this.getDisplayText(value, textSection);
    } else {
        try {
            text = this.getDisplayText(value, textSection);
        } catch (e) {
            text = "<error>";
            Utilities.warn(e.toString());
        }
    }
    if (text !== this.displayElement.value) {
        this.displayElement.value = text;
        this.setText(this.displayElement, text);
    }
}

/******************************************************************************/

///////////////////////////////
// Text Extraction Functions //
///////////////////////////////

// --------------------------------------------------------------------------
// getDisplayValue (static)
//
// This function is given the value for displaying as it appears in
// the section of the display description to be displayed
// (for example, this may be text.value or text.value.values). If this
// input is defined, this function returns the input. Otherwise, it returns
// (a subsection of) the content.
// This is the raw object or value to be displayed.
//
ContentDisplay.getDisplayValue = function(value) {
    switch (typeof(value)) {
      case "number":
      case "string":
        return value;
      case "undefined":
        return undefined;
      default:
        return cdlify(value);
    }
}

// --------------------------------------------------------------------------
// getDisplayText
//
// This function returns the text of the content to be displayed.
//
ContentDisplay.prototype.getDisplayText = function(value, textSection) {
    value = ContentDisplay.getDisplayValue(value);

    if (value === undefined)
        return undefined;
    
    return this.makeContentText(value, textSection);
}

// --------------------------------------------------------------------------
// makeContentText
//
// given an object (the 'content' of the display), this function returns
// a text string representing the object.
//
ContentDisplay.prototype.makeContentText = function(content, textSection) {
    if (content === "undefined")
        return undefined;

    var text;
    var first;
    var numericFormat, dateFormat;
    var numericConversion = false;
    
    if (typeof(content) == "object") {
        if(content === null)
            return undefined;
        if (content instanceof Array) {
            first = true;
            // sub elements separated by commas
            for (var i in content) {
                var subText = this.makeContentText(content[i], textSection);
                if (subText) {
                    if (first) {
                        text = subText;
                        first = false;
                    } else {
                        text = text + ", " + subText;
                    }
                }
            }
            return text;

        } else if (content instanceof Date) {

            dateFormat = textSection.dateFormat;
            if (dateFormat === undefined || dateFormat.type !== "intl") {
                return content.toString();
            } else {
                var locale = dateFormat.locale;
                var formatter = new Intl.DateTimeFormat(locale, dateFormat);
                text = formatter.format(content);
            }

        } else {

            // 'content' is an object:
            // If it is a Value object we display it using the
            // format that was specified when creating the value
            // or the default format.

            text = "";
            first = true;
            for (var p in content) {

                if(first)
                    first = false;
                else
                    text += "; ";

                if(typeof(content[p]) == "undefined" ||
                   (typeof(content[p]) == "object" &&
                    (!content[p] || isEmptyObj(content[p]))))
                    text += p;
                else
                    text += p + ": " +
                    this.makeContentText(content[p], textSection);
            }
        }

    } else if (typeof(content) === "number" &&
               (numericFormat = suppressSet(textSection.numericFormat)) !== undefined &&
               ((0 <= numericFormat.numberOfDigits &&
                 numericFormat.numberOfDigits <= 20) ||
                numericFormat.type === "intl")) {

        // Number formatting options
        switch (numericFormat.type) {
          case "fixed":
            text = content.toFixed(numericFormat.numberOfDigits);
            numericConversion = true;
            break;
          case "exponential":
            text = content.toExponential(numericFormat.numberOfDigits);
            numericConversion = true;
            break;
          case "precision":
            text = numericFormat.numberOfDigits === 0?
                  content.toPrecision(): // Otherwise it throws an exception
                  content.toPrecision(numericFormat.numberOfDigits);
            numericConversion = true;
            break;
          case "hexadecimal":
          case "HEXADECIMAL":
            text = content.toString(16);
            if (numericFormat.type === "HEXADECIMAL") {
                text = text.toUpperCase();
            }
            while (text.length < numericFormat.numberOfDigits) {
                text = "0" + text;
            }
            break;
          case "intl":
            try {
                var locale = numericFormat.locale;
                var formatter = new Intl.NumberFormat(locale, numericFormat);
                text = formatter.format(content);
                numericConversion = true;
            } catch (e) {
                text = String(content);
            }
            break;
          default:
            text = String(content);
            break;
        }

    } else if (typeof(content) === "number" &&
               (dateFormat = suppressSet(textSection.dateFormat)) !== undefined &&
               dateFormat.type === "intl") {
        try {
            var locale = dateFormat.locale;
            var formatter = new Intl.DateTimeFormat(locale, dateFormat);
            text = formatter.format(new Date(content));
        } catch (e) {
            text = String(content);
        }

    } else if (typeof(content) === "number" && numericFormat !== undefined) {
        // Use default precision when numberOfDigits is missing or out of range
        switch (numericFormat.type) {
          case "fixed":
            text = content.toFixed();
            numericConversion = true;
            break;
          case "exponential":
            text = content.toExponential();
            numericConversion = true;
            break;
          case "precision":
            text = content.toPrecision();
            numericConversion = true;
            break;
          case "hexadecimal":
          case "HEXADECIMAL":
            text = content.toString(16);
            if (numericFormat.type === "HEXADECIMAL") {
                text = text.toUpperCase();
            }
            break;
          default:
            text = String(content);
            break;
        }

    } else {

        // Default conversion to string
        text = String(content);

    }

    if (numericConversion && /^-0(\.0*)?$/.test(text)) {
        text = text.slice(1);
    }

    return text;
}

// Create (or refresh) the display element for foreign display.
ContentDisplay.prototype.foreignContentDisplay = function(displayDesc) {
    if (!this.displayDiv) {
        return {};
    }

    var div = createDiv(this.displayDiv.id + ":foreign");

    div.style.left = '0px';
    div.style.top = '0px';
    div.style.width = '100%';
    div.style.height = '100%';
    return {
        root: div,
        format: div,
        content: div,
        type: "foreign",
        value: undefined
    };
}

// --------------------------------------------------------------------------
// htmlContentDisplay
//
// Create (or refresh) the display element for HTML display.
//
ContentDisplay.prototype.htmlContentDisplay = function(displayDesc) {
    if (! this.displayDiv) {
        return {};
    }

    var innerElt = document.createElement("span");
    if (this instanceof Display) {
        // A SurveyDisplay doesn't need centering in order to measure. It is
        // even counter-productive: it causes wrong sizes for italics (at
        // least in Chrome) and interferes with baseline alignment.
        innerElt.style.display = "table-cell";
        innerElt.style.verticalAlign = "middle";
        innerElt.style.textAlign = "center";
    }
    var div = createDiv(this.displayDiv.id + ":html");
    div.style.display = "table";
    div.style.left = '0px'; // default, will be overridden later
    div.style.top = '0px'; // default, will be overridden later
    div.appendChild(innerElt);
    return {
        root: div,
        format: div,
        content: innerElt,
        type: "html",
        value: undefined
    };
}

// --------------------------------------------------------------------------
// refreshHTML
//
ContentDisplay.prototype.refreshHTML = function(displayDesc) {
    function checkLinks(element) {
        if (element instanceof HTMLAnchorElement) {
            if (element.target === "") {
                // Prevent clicking on a link from killing the application.
                // If that's what the author wants, (s)he should set an explicit
                // target, like "_self" or "_top".
                element.target = "_blank";
            }
        } else if (element.children !== undefined) {
            for (var i = 0; i < element.children.length; i++) {
                checkLinks(element.children[i]);
            }
        }
    }

    var htmlSection = displayDesc && displayDesc.html;
    var value = htmlSection && htmlSection.value;

    if (value !== this.displayElement.value) {
        this.displayElement.value = value;
        this.displayElement.content.innerHTML = this.getDisplayText(value);
        checkLinks(this.displayElement.content);
    }
}

// --------------------------------------------------------------------------
// canvasContentDisplay
//
ContentDisplay.prototype.canvasContentDisplay = function(displayDesc, type) {
    var div = document.createElement("canvas");
    
    this.context = "getContext" in div? div.getContext("2d"): undefined;
    this.canvas = div;
    this.canvas.style.position = "absolute";
    return { root: div, format: div, content: div, type: type };
}

/// Relative coordinates of the three points of the triangle specified
/// either by baseSide or rightAngle.
var relativeTrianglePoints = {
    baseSide: {
          leftBottom: [[0.5,1], [1,0], [0,0.5]],
          left: [[0,0], [1,0.5], [0,1]],
          leftTop: [[0,0.5], [1,1], [0.5,0]],
          top: [[0,0], [0.5,1], [1,0]],
          rightTop: [[0.5,0], [0,1], [1,0.5]],
          right: [[1,0], [0,0.5], [1,1]],
          rightBottom: [[0.5, 1], [0,0], [1,0.5]],
          bottom: [[0, 1], [0.5,0], [1,1]]
    },
    rightAngle: {
          leftBottom: [[0,1], [0,0], [1,1]],
          leftTop: [[0,0], [1,0], [0,1]],
          rightTop: [[1,0], [1,1], [0,0]],
          rightBottom: [[1, 1], [0,1], [1,0]]
    }
};

function getTrianglePoints(baseSide, rightAngle) {
    return typeof(baseSide) === "string"?
            relativeTrianglePoints.baseSide[baseSide]:
            relativeTrianglePoints.rightAngle[rightAngle];
}

// --------------------------------------------------------------------------
// refreshTriangle
//
ContentDisplay.prototype.refreshTriangle =
  function(displayDesc, width, height) {
    var triangle = displayDesc.triangle;
    var baseSide = getDeOSedValue(triangle.baseSide); // default bottom
    var rightAngle = getDeOSedValue(triangle.rightAngle); // default bottom
    var ctx = this.context;
    var w = width;
    var h = height;
    var shadow = getDeOSedValue(triangle.shadow);
    var points = getTrianglePoints(baseSide, rightAngle); // array of relative coordinates along horizontal and vertical edge

    if (ctx === undefined || points === undefined) {
        return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0][0] * w, points[0][1] * h);
    ctx.lineTo(points[1][0] * w, points[1][1] * h);
    ctx.lineTo(points[2][0] * w, points[2][1] * h);
    ctx.lineTo(points[0][0] * w, points[0][1] * h);
    if (shadow instanceof Object && !(shadow instanceof Array)) {
        ctx.save();
        ctx.shadowBlur = getValueForCSSStyle(shadow.blurRadius);
        ctx.shadowColor = getValueForCSSStyle(shadow.color);
        ctx.shadowOffsetX = getValueForCSSStyle(shadow.horizontal);
        ctx.shadowOffsetY = getValueForCSSStyle(shadow.vertical);
        if ("color" in triangle) {
            ctx.fillStyle = getValueForCSSStyle(triangle.color);
            ctx.fill();
        }
        if ("stroke" in triangle) {
            ctx.strokeStyle = getValueForCSSStyle(triangle.stroke);
            ctx.stroke();
        }
        ctx.restore();
    }
    if ("color" in triangle) {
        ctx.fillStyle = getValueForCSSStyle(triangle.color);
        ctx.fill();
    }
    if ("stroke" in triangle) {
        ctx.strokeStyle = getValueForCSSStyle(triangle.stroke);
        ctx.stroke();
    }
    ctx.restore();
}

ContentDisplay.prototype.checkTriangleHit = function(dispConf, relativePoint) {
    var triangle = dispConf.triangle;
    var baseSide = getDeOSedValue(triangle.baseSide);
    var rightAngle = getDeOSedValue(triangle.rightAngle);
    var pts = getTrianglePoints(baseSide, rightAngle);

    // Copied from https://stackoverflow.com/a/9755252
    function intpoint_inside_trigon(s, a, b, c) {
        var as_x = s[0] - a[0];
        var as_y = s[1] - a[1];
        var s_ab = (b[0] - a[0]) * as_y - (b[1] - a[1]) * as_x > 0;

        if (((c[0] - a[0]) * as_y - (c[1] - a[1]) * as_x > 0) === s_ab) return false;
        if (((c[0] - b[0]) * (s[1] - b[1]) - (c[1] - b[1]) * (s[0] - b[0]) > 0) !== s_ab) return false;
        return true;
    }

    return pts !== undefined &&
           intpoint_inside_trigon(relativePoint, pts[0], pts[1], pts[2]);
}

// --------------------------------------------------------------------------
// refreshArc
//
ContentDisplay.prototype.refreshArc = function(displayDesc, width, height) {
    var w = width;
    var h = height;
    var arc = displayDesc.arc;
    var x = ensureOS(arc.x);
    var y = ensureOS(arc.y);
    var radius = ensureOS(arc.radius);
    var relativeRadius = ensureOS(arc.relativeRadius);
    var start = ensureOS(arc.start);
    var range = ensureOS(arc.range);
    var end = ensureOS(arc.end);
    var color = ensureOS(arc.color);
    var inset = ensureOS(arc.inset);
    var ctx = this.context;
    var twoPI = Math.PI * 2;
    if (relativeRadius.length > 0 && radius.length === 0) {
        var normRadius = Math.min(w, h) / 2;
        radius = relativeRadius.map(function(val) { return val * normRadius; });
    }
    var nr = radius.length === 0 || color.length === 0? 0: // no defaults
             end.length !== 0? end.length: // pick end over range
             range.length !== 0? range.length: 0;

    if (ctx === undefined) {
        return;
    }
    for (var i = 0; i < nr; i++) {
        var start_i = (start[i % start.length] - 0.25) * twoPI;
        var end_i = end.length !== 0? (end[i % end.length] - 0.25) * twoPI:
                    range[i % range.length] * twoPI + start_i;
        var x_i = x.length !== 0? x[i % x.length]: w / 2;
        var y_i = y.length !== 0? y[i % y.length]: h / 2;
        var inset_i = inset.length !== 0? inset[i % inset.length]: 0;
        var radius_i = radius[i % radius.length];
        ctx.strokeStyle = color[i % color.length];
        ctx.beginPath();
        ctx.lineWidth = radius_i - inset_i;
        radius_i -= (radius_i - inset_i) / 2;
        ctx.arc(x_i, y_i, radius_i, start_i, end_i);
        ctx.stroke();
    }
}

ContentDisplay.prototype.checkArcHit = function(displayDesc, px, width, py, height) {
    var w = width;
    var h = height;
    var arc = displayDesc.arc;
    var x = ensureOS(arc.x);
    var y = ensureOS(arc.y);
    var radius = ensureOS(arc.radius);
    var relativeRadius = ensureOS(arc.relativeRadius);
    var start = ensureOS(arc.start);
    var range = ensureOS(arc.range);
    var end = ensureOS(arc.end);
    var color = ensureOS(arc.color);
    var inset = ensureOS(arc.inset);
    var twoPI = Math.PI * 2;
    if (relativeRadius.length > 0 && radius.length === 0) {
        var normRadius = Math.min(w, h) / 2;
        radius = relativeRadius.map(function(val) { return val * normRadius; });
    }
    var nr = radius.length === 0 || color.length === 0? 0: // no defaults
             end.length !== 0? end.length: // pick end over range
             range.length !== 0? range.length: 0;

    for (var i = 0; i < nr; i++) {
        var start_i = (start[i % start.length] - 0.25) * twoPI;
        var end_i = end.length !== 0? (end[i % end.length] - 0.25) * twoPI:
                    range[i % range.length] * twoPI + start_i;
        var x_i = x.length !== 0? x[i % x.length]: w / 2;
        var y_i = y.length !== 0? y[i % y.length]: h / 2;
        var inset_i = inset.length !== 0? inset[i % inset.length]: 0;
        var radius_i = radius[i % radius.length];
        var distance2 = (px - x_i) * (px - x_i) + (py - y_i) * (py - y_i);
        // At this point we draw have a circle segment: inside radius of circle
        // is inset_i, outside radius is radius_i
        if (inset_i * inset_i <= distance2 && distance2 <= radius_i * radius_i) {
            // Point falls inside circle, now check if it falls between start/end
            // get rid of negative values, shift circle to make start on top
            // and fold back to [0,2π) for comparison.
            var angle = (Math.atan2(py - y_i, px - x_i) + twoPI) % twoPI;
            var startK = Math.floor(start_i / twoPI);
            start_i -= startK * twoPI;
            end_i -= startK * twoPI;
            if (end_i - start_i >= twoPI) {
                return true;
            }
            if (start_i <= end_i) {
                if (start_i <= angle && angle <= end_i) {
                    return true;
                }
            } else {
                if (!(end_i < angle && angle < start_i)) {
                    return true;
                }
            }
        }
    }
    return false;
}

// --------------------------------------------------------------------------
// refreshTriangle
//
ContentDisplay.prototype.refreshLine = function(displayDesc, width, height) {
    var line = displayDesc.line;
    var direction = ensureOS(line.direction);
    var displayDivPos = this.baseArea.displayDivPos;
    var contentPos = this.baseArea.contentPos;
    var leftOffset = contentPos? contentPos.left - displayDivPos.left: 0;
    var topOffset = contentPos? contentPos.top - displayDivPos.top: 0;
    var linePos = this.baseArea.linePos;
    var dash = ensureOS(line.dash);
    var dashOffset = getDeOSedValue(line.dashOffset);
    var lineWidth = getDeOSedValue(line.width);
    var lineCap = getDeOSedValue(line.cap);
    var clip = isTrue(line.clip);
    var ctx = this.context;
    var shadow = getDeOSedValue(line.shadow);
    var x0, y0, x1, y1;

    this.registerChangedPositioningOffsets();
    if (ctx === undefined) {
        return;
    }
    if (typeof(lineWidth) !== "number") {
        lineWidth = 1;
    }
    ctx.save();
    ctx.lineWidth = lineWidth;
    ctx.lineCap = typeof(lineCap) === "string"? lineCap: "round";
    ctx.beginPath();
    if (dash.length > 0) {
        ctx.setLineDash(dash.filter(function(v) { return typeof(v) === "number"; }));
        if (typeof(dashOffset) === "number") {
            ctx.lineDashOffset = dashOffset;
        }
    }
    if (linePos === undefined || !("x0" in linePos)) {
        if (direction.indexOf("left-right") >= 0) {
            x0 = leftOffset; x1 = width + leftOffset;
        } else if (direction.indexOf("right-left") >= 0) {
            x1 = leftOffset; x0 = width + leftOffset;
        }
    } else {
        x0 = linePos.x0; x1 = linePos.x1;
    }
    if (linePos === undefined || !("y0" in linePos)) {
        if (direction.indexOf("top-bottom") >= 0) {
            y0 = topOffset; y1 = height + topOffset;
        } else if (direction.indexOf("bottom-top") >= 0) {
            y1 = topOffset; y0 = height + topOffset;
        }
    } else {
        y0 = linePos.y0; y1 = linePos.y1;
    }
    if (x0 === undefined || x1 === undefined ||
          y0 === undefined || y1 === undefined) {
        return;
    }
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    if (shadow instanceof Object && !(shadow instanceof Array)) {
        ctx.save();
        ctx.shadowBlur = getValueForCSSStyle(shadow.blurRadius);
        ctx.shadowColor = getValueForCSSStyle(shadow.color);
        ctx.shadowOffsetX = getValueForCSSStyle(shadow.horizontal);
        ctx.shadowOffsetY = getValueForCSSStyle(shadow.vertical);
        if ("color" in line) {
            ctx.strokeStyle = getValueForCSSStyle(line.color);
        } else {
            ctx.strokeStyle = shadowColor;
        }
        ctx.stroke();
        ctx.restore();
    }
    ctx.strokeStyle = "color" in line? getValueForCSSStyle(line.color): "black";
    ctx.stroke();
    ctx.restore();
}

ContentDisplay.prototype.checkLineHit =
  function(displayDesc, x, width, y, height) {
    var line = displayDesc.line;
    var direction = ensureOS(line.direction);
    var displayDivPos = this.baseArea.displayDivPos;
    var contentPos = this.baseArea.contentPos;
    var leftOffset = contentPos? contentPos.left - displayDivPos.left: 0;
    var topOffset = contentPos? contentPos.top - displayDivPos.top: 0;
    var linePos = this.baseArea.linePos;
    var lineWidth = getDeOSedValue(line.width);
    var x0, y0, x1, y1, dist, xlen, ylen;

    // Determine the two end points of the line
    x -= leftOffset; y -= topOffset;
    if (linePos === undefined || !("x0" in linePos)) {
        if (direction.indexOf("left-right") >= 0) {
            x0 = leftOffset; x1 = width + leftOffset;
        } else if (direction.indexOf("right-left") >= 0) {
            x1 = leftOffset; x0 = width + leftOffset;
        }
    } else {
        x0 = linePos.x0; x1 = linePos.x1;
    }
    if (linePos === undefined || !("y0" in linePos)) {
        if (direction.indexOf("top-bottom") >= 0) {
            y0 = topOffset; y1 = height + topOffset;
        } else if (direction.indexOf("bottom-top") >= 0) {
            y1 = topOffset; y0 = height + topOffset;
        }
    } else {
        y0 = linePos.y0; y1 = linePos.y1;
    }
    if (x0 === undefined || x1 === undefined ||
          y0 === undefined || y1 === undefined) {
        return;
    }
    // distance from (x,y) to line through (x0,y0),(x1,y1)
    // from: https://en.wikipedia.org/wiki/Distance_from_a_point_to_a_line
    xlen = x1 - x0;
    if (xlen === 0) {
        // It's a vertical line
        dist = Math.abs(x - x0);
    } else {
        ylen = y1 - y0;
        dist = Math.abs(ylen * x - xlen * y + x1 * y0 - x0 * y1) /
                    Math.sqrt(xlen * xlen + ylen * ylen);
    }
    if (dist > (typeof(lineWidth) === "number"? Math.max(1, lineWidth / 2): 1)) {
        return false;
    }
    // We still have to check if the point is beyond the start and end points
    if (xlen === 0) {
        const yLow = Math.min(y0, y1) - lineWidth / 2;
        const yHigh = Math.max(y0, y1) + lineWidth / 2;
        return yLow <= y && y <= yHigh;
    } else {
        // This formula does not deal with distance from the end points correctly
        // but the difference with the correct distance is small, unless the
        // line width is really high.
        const xLow = Math.min(x0, x1) - lineWidth / 2;
        const xHigh = Math.max(x0, x1) + lineWidth / 2;
        return xLow <= x && x <= xHigh;
    }
}

/******************************************************************************/
/*************************           Image           **************************/
/******************************************************************************/

ContentDisplay.imageCSSProperties = {'src': 1, 'alt': 1};
ContentDisplay.imageMondriaProperties = {'size': 1};

// --------------------------------------------------------------------------
// imageContentDisplay
//
// Returnes an image, not a div with image
//
ContentDisplay.prototype.imageContentDisplay = function(displayDesc) {
    var imageDesc = displayDesc.image;
    var innerEltType = "src" in imageDesc? "img": "span";
    var img = document.createElement(innerEltType);

    // store this display object so that it is accessible in the 'onload'
    // event handler.
    return {
        root: img,
        format: img,
        content: img,
        type: "image",
        value: undefined
    };
}

// --------------------------------------------------------------------------
// refreshImage
//
ContentDisplay.prototype.refreshImage = function(displayDesc) {
    var imageDesc = displayDesc.image;
    var img = this.displayElement.content;
    var self = this;

    if (this.prevProperties !== undefined) {
        var prevImageDesc = this.prevProperties.image;
        if (prevImageDesc !== undefined) {
            var curInnerEltType = "src" in imageDesc? "img": "span";
            var prevInnerEltType = "src" in prevImageDesc? "img": "span";
            if (curInnerEltType !== prevInnerEltType) {
                this.displayDiv.removeChild(this.displayElement.root);
                this.displayElement = this.imageContentDisplay(displayDesc);
                this.displayDiv.appendChild(this.displayElement.root);
                img = this.displayElement.content;
            }
        }
    }
    for (var i in imageDesc) {
        if (ContentDisplay.imageCSSProperties[i]) {
            img.setAttribute(i, imageDesc[i]);
        }
    }
    img.onload = function(arg) {
        var img = arg.currentTarget;
        self.imageUpdateHeightWidth(img);
    };
    if ("svg" in imageDesc) {
        img.innerHTML = imageDesc.svg;
    }
}

// --------------------------------------------------------------------------
// imageUpdateHeightWidth
//
// This function detemrines and sets the actual size at which the image will be
// displayed. The natural proportions of the image are always preserved.  There
// is a single attribute 'size' which determines the actual size of the image
// displayed. If it is not defined, the image is displayed in its natural size
// (regardless of the size of the area in which it is embedded).  If given,
// 'size' is a fraction (either expressed as percentage in a string, or as a
// number). This is then taken to mean the fraction of the parent element size
// which needs to be assigned to the image (e.g. "80%" means that the image
// needs to be "80%" of the size of the parent element). Since the proportions
// of the parent element are not necessarily the same as those of the image, the
// 'size' percentage is applied to the dimension (width/height) which is
// proportionally smaller (that is the one whose ratio with the natural size of
// the corresponding image dimension is smaller). For example, if the size is
// set to "100%", the image will be given the largest size which is contained in
// the parent.
// Choosing the 'proportionally smaller' dimension of the parent can fail in
// one case: when the proportions of the parent are exactly those of the
// image, up to rounding of the values to the nearest pixel. For example,
// assume there is an image of natural size 149 x 260 and a parent element
// of proportions 57 x 100. Here, the 'proportionally smaller' dimension
// is the width (57) because 57/149 < 100/260. Choosing to set the width of
// the image to 57 will result in a height of 99.46, which is then rounded
// to 99, making it just one pixel smaller than the parent element.
// However, if the height of the image is set to 100, the resulting width
// is 57.30 which is rounded to 57. This will result in the image fitting
// exactly into the parent area. To allow exact fit into an parent area,
// this special situation (of the prportions of the parent element being
// equal to those of the image up to rounding) is specifically tested for.
//
ContentDisplay.prototype.imageUpdateHeightWidth = function(img) {
    var imageDescr = this.descriptionDisplay.image;
    var parentWidth = this.getContentWidth();
    var parentHeight = this.getContentHeight();

    if (!(imageDescr instanceof Object)) {
        // Undefined, strings, etc. cannot be correct values
        return;
    }

    if (this instanceof SurveyDisplay) {
        parentWidth = this.swidth !== undefined? this.swidth: Infinity;
        parentHeight = this.sheight !== undefined? this.sheight: Infinity;
    } else if (isNaN(parentWidth) || isNaN(parentHeight) ||
        (parentWidth == 0) || (parentHeight == 0)) {
        return; // Either parent did not get its size yet, or no room for img
    }

    // Based on the parent dimensions and img dimensions and conf
    //  calculate the desired width, height, top, left
    // The image is always centered
    // Note that resizing svg is not supported.
    var naturalWidth, naturalHeight;
    if ("src" in imageDescr) {
        naturalWidth = img.naturalWidth;
        naturalHeight = img.naturalHeight;
    }
    if (!naturalWidth || !naturalHeight) {
        return;
    }

    var widthRatio = naturalWidth / parentWidth;
    var heightRatio = naturalHeight / parentHeight;

    var requestedRatio;
    if (imageDescr.size !== undefined) {
        var type = typeof(imageDescr.size);
        if (type === "string") { // Was percentage
            requestedRatio = imageDescr.size.split('%')[0] / 100;
        } else if (type === "number") {
            requestedRatio = imageDescr.size;
        }
        if (this instanceof SurveyDisplay) {
            parentWidth = naturalWidth;
            parentHeight = naturalHeight;
        }
    }
    else {
        requestedRatio = Math.max(widthRatio, heightRatio);
        if (this instanceof SurveyDisplay && requestedRatio === 0) {
            requestedRatio = 1;
            parentWidth = naturalWidth;
            parentHeight = naturalHeight;
        }
    }
    if (isNaN(requestedRatio)) {
        cdlAuthorError('Illegal size=' + vstringify(imageDescr.size));
    }

    var widthRotScale = parentWidth / naturalWidth;
    var heightRotScale = parentHeight / naturalHeight;
    var rotScale = Math.min(widthRotScale, heightRotScale);

    // Adapt natural width to effect of rotation
    naturalWidth = Math.round(img.naturalWidth * rotScale);
    naturalHeight = Math.round(img.naturalHeight * rotScale);

    // decide which dimension to set and which to leave free to adjust
    // automatically (by the proportions of the image). See explanation
    // before start of function.
    var setWidth;

    if(parentHeight == Math.round(parentWidth * naturalHeight / naturalWidth))
        setWidth = true;
    else if(parentWidth ==
            Math.round(parentHeight * naturalWidth / naturalHeight))
        setWidth = false;
    else
        setWidth = (widthRatio >= heightRatio);

    img.style.position = "absolute";
    if (setWidth) {
        // The width will obey the mondriasize
        var widthToSet = Math.round(requestedRatio * parentWidth);
        var derivedHeight =
            Math.round(widthToSet * naturalHeight / naturalWidth);
        if (this instanceof SurveyDisplay) {
            this.notifyImageSize(widthToSet, derivedHeight);
            return;
        }
        img.style.width = widthToSet + "px";
        img.style.removeProperty("height"); // Keep the proportions
        img.style.left =
            Math.round((this.paddingLeft ? this.paddingLeft : 0) +
                       (parentWidth - widthToSet) / 2) + "px";
        img.style.top =
            Math.round((this.paddingTop ? this.paddingTop : 0) +
                       (parentHeight - derivedHeight) / 2) + "px";
    }
    else {
        // The height will obey the mondriasize
        var heightToSet = Math.round(requestedRatio * parentHeight);
        var derivedWidth =
            Math.round(heightToSet * naturalWidth / naturalHeight);
        if (this instanceof SurveyDisplay) {
            this.notifyImageSize(derivedWidth, heightToSet);
            return;
        }
        img.style.height = heightToSet + "px";
        img.style.removeProperty("width"); // Keep the proportions
        img.style.left = 
            Math.round((this.paddingLeft ? this.paddingLeft : 0) +
                       (parentWidth - derivedWidth) / 2) + "px";
        img.style.top =
            Math.round((this.paddingTop ? this.paddingTop : 0) +
                       (parentHeight - heightToSet) / 2) + "px";
    }
}

ContentDisplay.prototype.iframeContentDisplay = function(displayDesc) {
    var iframe = document.createElement("iframe");

    iframe.frameBorder = 0;
    iframe.scrolling = "auto";
    return {
        root: iframe,
        format: iframe,
        content: iframe,
        type: "iframe",
        value: undefined
    };
}

// --------------------------------------------------------------------------
// refreshImage
//
ContentDisplay.prototype.refreshIFrame = function(displayDesc) {
    var iframeDesc = displayDesc.iframe;
    var iframe = this.displayElement.content;

    if (iframeDesc !== undefined && iframeDesc["src"] !== undefined) {
        iframe.src = iframeDesc["src"];
    }
}

// --------------------------------------------------------------------------
// setDisplayElementPos
//
// This function sets the position (left/top/width/height) of the 'root'
// display element. It uses contentWidth()/contentHeight() + the
// left/top padding stored on the Display object. The display element has the
// width and height specified by the contentPos and has a left/top offset
// (relative to its embedding displayDiv) equal to the padding. This is because
// elements embedded inside displayDiv are embedded relative to the padding
// edge, not the content edge (don't ask me why).
// This function should be called in the following cases:
// 1. A new display element is created
// 2. The display properties have changed (in case the padding changed)
// 3. The content position has changed.
// Depending on the display type, different actions may need to be taken.
//
ContentDisplay.prototype.setDisplayElementPos = function() {
    if(!this.displayElement)
        return;

    var root = this.displayElement.root;

    if(!root)
        return;

    this.updateSizeRequirements();

    var width = this.getContentWidth();
    var height = this.getContentHeight();

    var ewidth = isNaN(width) ? 0 : (width + this.extraWidth + this.negativeShiftLeft);
    var eheight = isNaN(height) ? 0 : (height + this.extraHeight + this.negativeShiftTop);

    switch(this.displayType) {
      case "image":
        // images require special processing
        this.imageUpdateHeightWidth(root);
        break;
      case "arc":
      case "triangle":
      case "line":
        this.canvas.width = ewidth;
        this.canvas.height = eheight;
        root.style.width = ewidth + "px";
        root.style.height = eheight + "px";
        root.style.top = ((this.paddingTop? this.paddingTop: 0) -
                          this.negativeShiftTop) + "px";
        root.style.left = ((this.paddingLeft? this.paddingLeft: 0) -
                           this.negativeShiftLeft) + "px";
        break;
      case "text":
        root.style.width = ewidth + "px";
        root.style.height = eheight + "px";
        root.style.top = (this.paddingTop ? this.paddingTop : 0) + "px";
        root.style.left = (this.paddingLeft ? this.paddingLeft : 0) + "px";
        if (!isNaN(width) && this.descriptionDisplay !== undefined &&
              this.descriptionDisplay.text !== undefined &&
              this.descriptionDisplay.text.value !== undefined) {
            // Update the table cell's max-width property for text-overflow
            // when there is a proper width for this display
            var textDescr = this.descriptionDisplay.text;
            this.displayElement.content.style.maxWidth =
                textDescr.overflow !== undefined &&
                textDescr.overflow !== "clip" &&
                textDescr.whiteSpace === "nowrap"?
                ewidth + "px": "";
        }
        if (this.getRotation() !== 0) {
            this.applyHTMLTransform(this.descriptionDisplay.transform);
        }
        break;
      case "html":
      case "iframe":
      case "foreign":
        if (this.previousPositions === undefined) {
            this.previousPositions = {
                top: undefined, left: undefined, width: undefined, height: undefined
            }
        } else if (this.previousPositions.width === ewidth &&
                   this.previousPositions.height === eheight &&
                   this.previousPositions.top === (this.paddingTop? this.paddingTop: 0) &&
                   this.previousPositions.left === (this.paddingLeft? this.paddingLeft: 0)) {
            return;
        }
        this.previousPositions.width = ewidth;
        this.previousPositions.height = eheight;
        this.previousPositions.top = (this.paddingTop? this.paddingTop: 0);
        this.previousPositions.left = (this.paddingLeft? this.paddingLeft: 0);
        root.style.width = ewidth + "px";
        root.style.height = eheight + "px";
        root.style.top = (this.paddingTop ? this.paddingTop : 0) + "px";
        root.style.left = (this.paddingLeft ? this.paddingLeft : 0) + "px";
        if (this.displayElement.foreignElement !== undefined) {
            var foreignElement = this.displayElement.foreignElement;
            foreignElement.style.width = ewidth + "px";
            foreignElement.style.height = eheight + "px";
        }
        break;
      case "empty":
        break;
      default:
        cdlInternalError("setting element pos for unknown type: ",
                             this.displayType);
    }
}

// --------------------------------------------------------------------------
// updateSizeRequirements
//
// When canvas elements have a shadow, the size of the canvas must be adapted
// to encompass the shadow. That is done by computing the extra width and height
// required. These are then added to the canvas width and height. By not
// setting overflow:hidden on the display and frame div, the shadows can be
// seen outside their normal position.
//   This trick only works for "positive" offsets. If space is needed to
// accomodate shadows above the top or to the left of the left side, the canvas
// must be positioned there, and extra offsets must be taken into account when
// drawing.
//   Shadows are currently only supported on triangles.
//
ContentDisplay.prototype.updateSizeRequirements = function() {
    this.extraWidth = 0;
    this.extraHeight = 0;
    this.negativeShiftLeft = 0;
    this.negativeShiftTop = 0;
    switch (this.displayElement.type) {
      case "line":
        var line = this.descriptionDisplay.line;
        var lineWidth = getDeOSedValue(line.width);
        var clip = line.clip;
        if (lineWidth > 1 && isFalse(clip)) {
            var frameWidth = Math.floor((lineWidth + 1) / 2);
            this.extraWidth += frameWidth;
            this.extraHeight += frameWidth;
            this.negativeShiftLeft += frameWidth;
            this.negativeShiftTop += frameWidth;
        }
        // fall through: shadow for triangle and line are treated identically
      case "triangle":
        var shadow = "triangle" in this.descriptionDisplay?
                     getDeOSedValue(this.descriptionDisplay.triangle.shadow):
                     getDeOSedValue(this.descriptionDisplay.line.shadow);
        if (shadow instanceof Object && !(shadow instanceof Array)) {
            var shadowBlur = getNumberForCSSStyle(shadow.blurRadius);
            var shadowOffsetX = getNumberForCSSStyle(shadow.horizontal);
            var shadowOffsetY = getNumberForCSSStyle(shadow.vertical);
            this.extraWidth += Math.max(shadowOffsetX + shadowBlur, 0);
            this.extraHeight += Math.max(shadowOffsetY + shadowBlur, 0);
            this.negativeShiftLeft += Math.min(shadowOffsetX + shadowBlur, 0);
            this.negativeShiftTop += Math.min(shadowOffsetY + shadowBlur, 0);
        }
        break;
    }
}

ContentDisplay.prototype.setForeignElement= function(foreignElement) {
    if (this.displayElement !== undefined) {
        this.displayElement.foreignElement = foreignElement;
        if (foreignElement !== undefined && this.previousPositions !== undefined) {
            foreignElement.style.width = this.previousPositions.width;
            foreignElement.style.height = this.previousPositions.height;
        }
    }
}

ContentDisplay.prototype.setShowEmbedding = function(showEmbedding) {
    this.showEmbedding = !!showEmbedding;
}

ContentDisplay.prototype.checkLinePositioningOffsets = function() {
    var needsLinePositioningOffsets = this.displayType === "line";

    if (needsLinePositioningOffsets) {
        this.registerChangedPositioningOffsets();
    } else if (!needsLinePositioningOffsets && this.hasLinePositioningOffsets) {
        this.unregisterLinePositioningOffsets();
    }
}

ContentDisplay.prototype.registerChangedPositioningOffsets = function() {
    var line = this.descriptionDisplay.line;
    var direction = ensureOS(line.direction);
    var needsLinePositioningOffsets = {
        horizontal: !direction.some(function(dir) {
            return dir === "top-bottom" || dir === "bottom-top";
        }),
        vertical: !direction.some(function(dir) {
            return dir === "left-right" || dir === "right-left";
        })
    };
    var area = this.baseArea;
    var linePos = area.linePos;

    if (this.hasLinePositioningOffsets === undefined) {
        this.hasLinePositioningOffsets = {
            horizontal: false,
            vertical: false
        };
    }
    if (needsLinePositioningOffsets.horizontal &&
          !this.hasLinePositioningOffsets.horizontal) {
        globalAbsolutePosManager.addOffset(topLabel(area, false),
                                           linePointLabel(area, "y0"),
                                           area.areaId, "y0", false);
        globalAbsolutePosManager.addOffset(topLabel(area, false),
                                           linePointLabel(area, "y1"),
                                           area.areaId, "y1", false);
    } else if (!needsLinePositioningOffsets.horizontal &&
               this.hasLinePositioningOffsets.horizontal) {
        globalAbsolutePosManager.removeOffset(topLabel(area, false),
                                              linePointLabel(area, "y0"));
        globalAbsolutePosManager.removeOffset(topLabel(area, false),
                                              linePointLabel(area, "y1"));
        if (linePos !== undefined) {
            delete linePos.y0;
            delete linePos.y1;
        }
    }
    if (needsLinePositioningOffsets.vertical &&
          !this.hasLinePositioningOffsets.vertical) {
        globalAbsolutePosManager.addOffset(leftLabel(area, false),
                                           linePointLabel(area, "x0"),
                                           area.areaId, "x0", false);
        globalAbsolutePosManager.addOffset(leftLabel(area, false),
                                           linePointLabel(area, "x1"),
                                       area.areaId, "x1", false);
    } else if (!needsLinePositioningOffsets.vertical &&
               this.hasLinePositioningOffsets.vertical) {
        globalAbsolutePosManager.removeOffset(leftLabel(area, false),
                                              linePointLabel(area, "x0"));
        globalAbsolutePosManager.removeOffset(leftLabel(area, false),
                                              linePointLabel(area, "x1"));
        if (linePos !== undefined) {
            delete linePos.x0;
            delete linePos.x1;
        }
    }
    this.hasLinePositioningOffsets = needsLinePositioningOffsets;
}

// Remove the offsets between area's frame and the line offsets when needed.
ContentDisplay.prototype.unregisterLinePositioningOffsets = function() {
    var area = this.baseArea;

    if (this.hasLinePositioningOffsets.horizontal) {
        globalAbsolutePosManager.removeOffset(topLabel(area, false),
                                              linePointLabel(area, "y0"));
        globalAbsolutePosManager.removeOffset(topLabel(area, false),
                                              linePointLabel(area, "y1"));
    }
    if (this.hasLinePositioningOffsets.vertical) {
        globalAbsolutePosManager.removeOffset(leftLabel(area, false),
                                              linePointLabel(area, "x0"));
        globalAbsolutePosManager.removeOffset(leftLabel(area, false),
                                              linePointLabel(area, "x1"));
    }
    if (area.linePos !== undefined) {
        area.linePos = undefined;
    }
    this.hasLinePositioningOffsets = undefined;
}

inherit(Display, ContentDisplay);

function Display(baseArea) {
    this.ContentDisplay();
    
    this.baseArea = baseArea;
    // create the frame DIV, but don't position it, the positioning system
    // will do that. The display DIV is created on demand.
    // We do create the display div here. The embedding div is created when
    // AbsolutePosManager.refreshPos() knows its position.
    this.frameDiv = createDiv(baseArea.areaId);
    this.frameZ = "";
    this.displayZ = "";
    this.embeddingDiv = null; // null because it is used in DOM::insertChild()
    this.independentContentPosition = false;
}

// destructor
Display.prototype.destroy = function() {
    this.destroyDisplayElements();
    this.ContentDisplay_destroy();
}

Display.prototype.getEmbeddingDiv = function() {
    if (this.embeddingDiv === null) {
        this.embeddingDiv = createDiv(this.baseArea.areaId + ":embedding");
        this.inZeroOffsetPosMode = false;
        if (this.showEmbedding) {
            if (this.baseArea.contentPos) {
                embedElementAtPos(this.embeddingDiv, this.baseArea.contentPos,
                                this.frameDiv, null);
            } else {
                embedZeroOffsetElementAtPos(this.embeddingDiv,
                                            this.baseArea.relative,
                                            this.frameDiv, null);
            }
        }
    }
    return this.embeddingDiv;
}

///////////////////////////////////
// Description Refresh Functions //
///////////////////////////////////

// This function is called every time the 'display' section in the description
// is updated. It updates the display to agree with the given description.
//
Display.prototype.configurationUpdate = function(
    configuration, applyChange, applyTransition) {
    // Clear the properties set on the frameDiv
    this.resetFrame(configuration, applyTransition);

    this.ContentDisplay_configurationUpdate(
        configuration, applyChange, applyTransition);
}

Display.prototype.applyTransitionProperties = function(transitions) {
    this.ContentDisplay_applyTransitionProperties(transitions);
    if (this.descriptionDisplay !== undefined) {
        copyTransitionCssProp(this.frameDiv.style, undefined, transitions);
        if(this.embeddingDiv)
            copyTransitionCssProp(this.embeddingDiv.style, undefined,
                                  transitions);
    }
}

Display.prototype.contentOffsetModeChange =
  function(areaId, prevMode, newMode, userInfo) {
    var newICP = newMode === "independent";
    var changed = newICP !== this.independentContentPosition;

    this.independentContentPosition = newICP;
    if (changed && this.descriptionDisplay !== undefined &&
          "boxShadow" in this.descriptionDisplay) {
        copyDisplayCssProp(this, "boxShadow",
                           (newICP? "":  this.descriptionDisplay.boxShadow));
    }
}

/////////////////////
// Display Refresh //
/////////////////////

// This function is called when the positioning of the area changes.
// It takes action required to update the displayElement as a result of
// this positioning change.

Display.prototype.refreshPos = function() {
    if (this.displayType === "triangle" || this.displayType === "arc" ||
          this.displayType === "line")
        this.displayContentRefresh(false, true, false);
    else
        this.setDisplayElementPos();
}

function getValueForCSSStyle(os) {
    return os instanceof Array? (os.length === 1? os[0]: ""):
           os instanceof Object? "":
           os;
}

function getNumberForCSSStyle(os) {
    var val = Number(getValueForCSSStyle(os));

    return isNaN(val)? 0: val;
}

// --------------------------------------------------------------------------
// getContentWidth
//
Display.prototype.getContentWidth = function() {
    var contentSize = this.baseArea.contentPos?
            this.baseArea.contentPos: this.baseArea.relative;
    return contentSize.width;
}

// --------------------------------------------------------------------------
// getContentHeight
//
Display.prototype.getContentHeight = function() {
    var contentSize = this.baseArea.contentPos?
            this.baseArea.contentPos: this.baseArea.relative;
    return contentSize.height;
}

/**** Transformation properties ****/

Display.prototype.getScaleX = function() {
    var transform = this.descriptionDisplay.transform;

    if (typeof(transform) === "object") {
        if (typeof(transform.scale) === "number") {
            return transform.scale;
        }
        if (typeof(transform.scale) === "object" && typeof(transform.scale.x) === "number") {
            return transform.scale.x;
        }
    }
    return 1;
}

Display.prototype.getScaleY = function() {
    var transform = this.descriptionDisplay.transform;

    if (typeof(transform) === "object") {
        if (typeof(transform.scale) === "number") {
            return transform.scale;
        }
        if (typeof(transform.scale) === "object" && typeof(transform.scale.y) === "number") {
            return transform.scale.y;
        }
    }
    return 1;
}

var selectableInputElementTypes = {
    text: true,
    password: true,
    textarea: true
};

// Creates the input cell and initializes it with display:text:value:.
Display.prototype.createInputCell = function(displayDescr) {
    var res = this.ContentDisplay_createInputCell(displayDescr);

    var inputDescr = ("text" in displayDescr) ? displayDescr.text.input :
            undefined;
    var recipient = this.baseArea.areaReference;
    var postAddAction = {};
    var callbackObject = this;
    var initialValue = "text" in displayDescr? displayDescr.text.value:
          undefined;
    var currentValue = initialValue;
    var baseArea = this.baseArea;

    if (initialValue instanceof Array) {
        initialValue = initialValue[0];
    }

    var inputElement = res.root;
    inputElement.style.background = "transparent";

    if (inputDescr.type in selectableInputElementTypes && inputElement &&
          typeof(inputElement) === "object") {
        postInputParamChangeEvent(this.baseArea, false, {
            selectionStart: inputElement.selectionStart,
            selectionEnd: inputElement.selectionEnd,
            selectionDirection: inputElement.selectionDirection,
            value: initialValue === ""? constEmptyOS: initialValue
        }, inputElement);
    }

    // Attach listeners for user input and other changes
    inputElement.addEventListener("input", function (e) {
        if (inputElement.value !== currentValue) {
            currentValue = inputElement.value;
            callbackObject.oninput(e, inputElement);
        }
    }, false);
    if (inputDescr.type === "file") {
        inputElement.addEventListener("change", function (e) {
            callbackObject.oninput(e, inputElement);
            inputElement.value = ""; // In case user picks same file again
        }, false);
    } else {
        inputElement.addEventListener("change", function (e) {
            if (inputElement.value !== currentValue) {
                currentValue = inputElement.value;
                callbackObject.oninput(e, inputElement);
            }
        }, false);
    }
    inputElement.addEventListener("select", function (e) {
        if (inputElement.value !== currentValue) {
            currentValue = inputElement.value;
            callbackObject.oninput(e, inputElement);
        }
    }, false);
    inputElement.addEventListener("focus", function (e) {
        callbackObject.onfocus(true, inputElement);
    }, false);
    inputElement.addEventListener("blur", function (e) {
        callbackObject.onfocus(false, inputElement);
    }, false);
    switch (inputDescr.type) {
      case "text":
      case "number":
      case "password":
        // These listeners relay key events to gDomEvent and blocks them
        inputElement.addEventListener("keydown", function (e) {
            postKeyEvent(e, recipient);
            postInputParamChangeEvent(baseArea, true, {
                selectionStart: inputElement.selectionStart,
                selectionEnd: inputElement.selectionEnd,
                selectionDirection: inputElement.selectionDirection
            }, inputElement);
        }, false);
        inputElement.addEventListener("keyup", function (e) {
            postKeyEvent(e, recipient);
        }, false);
        inputElement.addEventListener("keypress", function (e) {
            if (postKeyEvent(e, recipient) && e.ctrlKey && e.keyCode === 10 &&
                  inputElement.type === "textarea") {
                // Implements backspace
                var selStart = inputElement.selectionStart;
                var str1 = inputElement.value.substr(0, selStart);
                var str2 = inputElement.value.substr(inputElement.selectionEnd);
                inputElement.value = str1 + "\n" + str2;
                inputElement.setSelectionRange(selStart + 1, selStart + 1);
            }
        }, false);
        break;
      case "file":
        inputElement.addEventListener("dragenter", function (e) {
            gDomEvent.dragEnterHandler(e);
        }, false);
        inputElement.addEventListener("dragleave", function (e) {
            gDomEvent.dragLeaveHandler(e);
        }, false);
        inputElement.addEventListener("drop", function (e) {
            e.preventDefault();
        }, false);
        if (inputDescr.acceptFiles !== undefined) {
            var acc = inputDescr.acceptFiles;
            if (acc instanceof Array) {
                acc = acc.filter(function(v) {return typeof(v) === "string"; }).
                          join(",");
            }
            if (typeof(acc) === "string") {
                inputElement.accept = acc;
            } else {
                inputElement.accept = "";
            }
        }
        break;
    }

    // The following initializes the input element according to the description
    // in display:text:input:init. This is perhaps not the final design.
    // Note that this is strictly initialization. Later changes to any of these
    // values have no effect.
    if (inputDescr.type in selectableInputElementTypes &&
          inputDescr.init !== undefined) {
        var initDesc = getDeOSedValue(inputDescr.init);
        var value = getDeOSedValue(initDesc.selectionStart);
        if (value >= 0) {
            postAddAction.selectionStart = value;
            this.baseArea.updateParamInput({selectionStart: value}, false, false);
        }
        value = getDeOSedValue(initDesc.selectionEnd);
        if (value < 0) {
            value += inputElement.value.length + 1;
        }
        if (value >= 0) {
            postAddAction.selectionEnd = value;
            if (inputElement.selectionEnd !== value) {
                this.baseArea.updateParamInput({selectionEnd: value}, false, false);
            }
        }
        value = getDeOSedValue(initDesc.selectionDirection);
        if (value === "forward" || value === "backward" || value === "none") {
            postAddAction.selectionDirection = value;
            if (inputElement.selectionDirection !== value) {
                this.baseArea.updateParamInput({selectionDirection: value},
                                               false, false);
            }
        }
        if (!("focus" in initDesc) || isTrue(initDesc.focus)) {
            postAddAction.focus = true;
            this.baseArea.updateParamInput({focus: [true]}, false, false);
        } else {
            this.baseArea.updateParamInput({focus: [false]}, false, false);
        }
    } else {
        postAddAction.focus = true;
        this.baseArea.updateParamInput({focus: [true]}, false, false);
    }

    res.postAddAction = postAddAction;

    return res;
}

// Sends the current state of the input element to the area's param:input:
Display.prototype.oninput = function(domEvent, element) {
    if (element.type in selectableInputElementTypes) {
        postInputParamChangeEvent(this.baseArea, true, {
            value: element.value === ""? constEmptyOS: element.value,
            selectionStart: element.selectionStart,
            selectionEnd: element.selectionEnd,
            selectionDirection: element.selectionDirection
        }, element);
    } else if (element.type === "file") {
        gDomEvent.pickFile(domEvent, this.baseArea, element.files)
    } else {
        var value = element.value === ""? constEmptyOS: element.value;
        postInputParamChangeEvent(this.baseArea, true, {value: value}, element);
    }
}

// Sends the current focus state of the input element to the area's param:input:
Display.prototype.onfocus = function(newValue, element) {
    gDomEvent.recordComment("focus " + newValue + " on " + this.baseArea.areaId);
    postInputParamChangeEvent(this.baseArea, true, {focus: newValue}, element);
}

Display.prototype.applyHTMLTransform = function(value) {
    if (this.displayElement && this.displayElement.root) {
        var parentArea = this.baseArea.parent;
        var parentWidth = parentArea === undefined?
            this.baseArea.relative.width: parentArea.relative.width;
        assignCSSStyleProp(this.displayElement.root.style, "transform",
            getTransformObjectAsString(value, this.displayType, parentWidth));
    }
}

Display.prototype.hasActiveInputElement = function() {
    return this.displayElement !== undefined &&
          this.displayElement.type === "input" &&
          this.displayElement.inputType !== "file" &&
          !this.displayElement.disabled;
}

Display.prototype.inputElementIsValid = function() {
    return this.displayElement === undefined ||
          this.displayElement.type !== "input" ||
          this.displayElement.root.validity.valid;
}

Display.prototype.takeFocus = function() {
    gDomEvent.recordComment("takeFocus " + this.baseArea.areaId);
    this.displayElement.root.focus();
}

Display.prototype.hasFocus = function() {
    return this.displayElement !== undefined &&
           this.displayElement.type === "input" &&
           !this.displayElement.disabled &&
           this.displayElement.root === document.activeElement;
}


Display.prototype.releaseFocus = function() {
    gDomEvent.recordComment("releaseFocus " + this.baseArea.areaId);
    gDomEvent.setNextFocussedArea(this.baseArea, false);
}

Display.prototype.willHandleClick = function() {
    return this.descriptionDisplay !== undefined &&
           this.descriptionDisplay.html !== undefined &&
           isTrue(this.descriptionDisplay.html.handleClick);
}

Display.prototype.getInputChanges = function() {
    if (this.displayElement !== undefined &&
          this.displayElement.type === "input") {
        var element = this.displayElement.content;
        return [{
            selectionStart: [element.selectionStart],
            selectionEnd: [element.selectionEnd],
            selectionDirection: [element.selectionDirection]
        }];
    } else {
        return undefined;
    }
}

// Changes the content and state of the input element.
Display.prototype.setInputState = function(attrib, value) {
    if (this.displayElement === undefined ||
          this.displayElement.type !== "input") {
        return false;
    }
    var inputElement = this.displayElement.root;
    switch (attrib) {
      case "value":
        if (value instanceof NonAV) {
            value = value.toString();
        }
        if (!isSimpleType(value)) {
            if (isEmptyOS(value)) {
                value = "";
            } else {
                return false;
            }
        }
        if (inputElement.type in selectableInputElementTypes) {
            // Changing the value should preserve selection start, end and
            // direction If that's not possible (e.g. because the new string is
            // shorter than the selection position), writes the updated values
            // back.
            var st = inputElement.selectionStart;
            var se = inputElement.selectionEnd;
            var sd = inputElement.selectionDirection;
            var changes = {
                value: value === ""? constEmptyOS: value
            };
            inputElement.value = value;
            inputElement.selectionStart = st;
            if (inputElement.selectionStart !== st) {
                changes.selectionStart = inputElement.selectionStart;
            }
            inputElement.selectionEnd = se;
            if (inputElement.selectionEnd !== se) {
                changes.selectionEnd = inputElement.selectionEnd;
            }
            inputElement.selectionDirection = sd;
            if (inputElement.selectionDirection !== sd) {
                changes.selectionDirection = inputElement.selectionDirection;
            }
            this.baseArea.updateParamInput(changes, true, true);
        }
        break;
      case "focus":
        gDomEvent.setNextFocussedArea(this.baseArea, isTrue(value));
        break;
      case "selectionStart":
        if (inputElement.type in selectableInputElementTypes && value >= 0) {
            inputElement.selectionStart = value;
            if (inputElement.selectionStart !== value) {
                this.baseArea.updateParamInput({selectionStart: value}, true, true);
            }
        } else {
            return false;
        }
        break;
      case "selectionEnd":
        if (inputElement.type in selectableInputElementTypes && value >= 0) {
            inputElement.selectionEnd = value;
            if (inputElement.selectionEnd !== value) {
                this.baseArea.updateParamInput({selectionEnd: value}, true, true);
            }
        } else {
            return false;
        }
        break;
      case "selectionDirection":
        if (inputElement.type in selectableInputElementTypes &&
            (value === "forward" || value === "backward" || value === "none")) {
            inputElement.selectionDirection = value;
            if (inputElement.selectionDirection !== value) {
                this.baseArea.updateParamInput({selectionDirection: value}, true, true);
            }
        } else {
            return false;
        }
        break;
    }
    return true;
}

// --------------------------------------------------------------------------
// postAddActions
//
Display.prototype.postAddActions = function() {
    if ("postAddAction" in this.displayElement) {
        for (var attr in this.displayElement.postAddAction) {
            if (attr === "focus") {
                if (this.displayElement.postAddAction.focus) {
                    gDomEvent.setNextFocussedArea(this.baseArea, true);
                }
            } else {
                this.displayElement.root[attr] =
                    this.displayElement.postAddAction[attr];
            }
        }
    }

    if ("canvas" in this) {
        // Canvas functions should show and hide as much as is required
        if (this.displayDiv) {
            this.displayDiv.style.overflow = "";
        }
        if (this.frameDiv) {
            this.frameDiv.style.overflow = "";
        }
    }
}


//////////////////////////////////////////////////////
// Construction and Destruction of the Display DIVs //
//////////////////////////////////////////////////////

// If not created yet, this function creates the display DIV and positions
// it based on the current value of the area's 'displayDivPos' specification.
// (in principle, this is the responsibility of the positioning system, but
// as the positioning may not have changed (and therefore the positioning
// may not be called) we set this at the current position calculated for it
// by the positioning system.

Display.prototype.createDisplayDiv = function() {
    var idstr = this.baseArea.areaId + ":display";
    if (! this.ContentDisplay_createDisplayDiv(idstr)) {
        return false;
    }

    var rel = this.baseArea.relative;
    embedElementAtPos(this.displayDiv,
                      this.baseArea.displayDivPos?
                        this.baseArea.displayDivPos: 
                        {left: '0', top: '0', width: rel.width, height: rel.height},
                      this.frameDiv, this.embeddingDiv);
    this.displayDiv.style.zIndex = this.displayZ;

    return true;
}

// This function removes the DIVs of this area from the DOM structure.
// It is enough to remove the frame DIV, as all the others are embedded
// inside it.

Display.prototype.destroyDisplayElements = function() {
    if (this.hasFocus()) {
        this.releaseFocus();
        gDomEvent.setGlobalFocus();
    }
    this.destroyDisplayElement("frameDiv");
    this.destroyDisplayElement("embeddingDiv");
    this.removeDisplayElement();
}

///////////////////////////////////////
// Application of Display Properties //
///////////////////////////////////////

// Properties which have to be reset on the outer element when they are missing
// from the display description.
var frameResetProperties = {
    background: "",
    borderSpacing: "",
    boxShadow: "",
    hoverText: "",
    opacity: "",
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderStyle: "",
    borderWidth: "",
    borderColor: "",
    paddingLeft: "",
    paddingRight: "",
    paddingTop: "",
    paddingBottom: "",
    overflow: "",
    transform: "",
    filter: ""
};

// Properties which have to be reset on the inner element when they are missing
// from the display description.
var displayResetProperties = {
    clip: false,
    color: "",
    fontFamily: "",
    fontSize: "",
    fontStyle: "",
    fontVariant: "",
    fontWeight: "",
    lineHeight: "",
    textShadow: "",
    textAlign: "center",
    textDecoration: "",
    textFillColor: "",
    textIndent: "",
    textStrokeColor: "",
    textStrokeWidth: "",
    textTransform: "",
    verticalAlign: "middle",
    overflowX: "",
    overflowY: "",
    overflow: "",
    whiteSpace: ""
};

// This function applies the current display properties (as recorded in the
// description 'display' section) to the various display elements belonging
// to this area.

Display.prototype.applyDisplayProperties =
  function(displayProperties, applyChange, applyTransition, nopCopy) {
    // duplicate, as we may want to change some values
    displayProperties = displayProperties? shallowCopy(displayProperties): {};

    // this operation registers the offsets between the frame and the content
    // as implied by the css properties. These properties are then converted
    // in the 'displayProperties' object to pixel units, to ensure uniformity
    // between the offsets calculated and the values registered on
    // the HTML elements. The object returned carries the changed properties
    // only, with number values (rather than in the "<number>px" format).
    //
    // (to repeat:) with the 2nd argument 'modify=true', this function modifies
    //  the first argument 'displayProperties', setting on it border and padding
    //  attributes
    var propsSet =
            this.baseArea.registerContentOffsets(displayProperties, true);

    if (!applyChange) {
        return;
    }

    // suppress boxShadow in independentContentPosition mode
    if (this.independentContentPosition) {
        if ("boxShadow" in displayProperties) {
            delete displayProperties.boxShadow;
        }
    }

    // third arg 'noCopy=true', so base-class uses the same 'displayProperties'
    //  which was already shallowCopy'ed above
    this.ContentDisplay_applyDisplayProperties(displayProperties, true,
                                               applyTransition, true);

    // store left/top padding (for positioning, if necessary)
    this.paddingLeft = propsSet.paddingLeft ? propsSet.paddingLeft : 0;
    this.paddingTop = propsSet.paddingTop ? propsSet.paddingTop : 0;
    this.paddingRight = propsSet.paddingRight ? propsSet.paddingRight : 0;
    this.paddingBottom = propsSet.paddingBottom ? propsSet.paddingBottom : 0;
}

Display.prototype.resetFrame = function(definedProps, applyTransition) {
    if (applyTransition) {
        if ("transitions" in definedProps) {
            copyTransitionCssProp(this.frameDiv.style, undefined, definedProps.transitions);
            if(this.embeddingDiv)
                copyTransitionCssProp(this.embeddingDiv.style, undefined, definedProps.transitions);
        } else {
            resetTransitionCssProp(this.frameDiv.style, undefined, undefined);
            if(this.embeddingDiv)
                resetTransitionCssProp(this.embeddingDiv.style, undefined,
                                       undefined);
        }
    }
}

Display.prototype.setZIndex = function(frameZ, displayZ) {
    this.frameZ = frameZ;
    if (this.frameDiv) {
        this.frameDiv.style.zIndex = frameZ;
    }
    this.displayZ = displayZ;
    if (this.displayDiv) {
        this.displayDiv.style.zIndex = displayZ;
    }
}

// --------------------------------------------------------------------------
// isOpaque
//
// a display is considered 'opaque' if it is explicitly configured as
//  'pointerOpaque: true'
// or if it is not explicitly configured as 'pointerOpaque: false', and does
//  have a 'background'
//
// Outdated
// Display.prototype.isOpaque = function() {
//     var displayConfiguration = this.descriptionDisplay;

//     throw "do not call";
//     return displayConfiguration !== undefined &&
//           (displayConfiguration.pointerOpaque !== undefined?
//            displayConfiguration.pointerOpaque:
//            displayConfiguration.background !== undefined ||
//            (displayConfiguration.image !== undefined &&
//             displayConfiguration.image.src !== undefined) ||
//            (displayConfiguration.triangle !== undefined &&
//             displayConfiguration.triangle.color !== undefined) ||
//            (displayConfiguration.arc !== undefined &&
//             displayConfiguration.arc.color !== undefined));
// }

// A display is opaque for positions x,y if there is a background or text at
// that position. This function determines pointer and event propagation.
Display.prototype.isOpaquePosition = function(x, y) {
    var displayConfiguration = this.descriptionDisplay;

    function getRadius(xSide, ySize) {
        var attr = "border" + xSide + ySide + "Radius";
        var cornerRadius = displayConfiguration[attr];

        return cornerRadius === undefined? displayConfiguration.borderRadius:
                                           cornerRadius;
    }

    if (displayConfiguration === undefined) {
        return false;
    }
    // pointerOpaque overrides display definition
    if (displayConfiguration.pointerOpaque !== undefined) {
        return displayConfiguration.pointerOpaque;
    }
    // Check if point is outside the borderRadius
    var pos = this.hasVisibleBorder()? this.baseArea.getPos():
                this.baseArea.getPosCorrectedForOffset();
    var xCenter = pos.width / 2;
    var yCenter = pos.height / 2;
    var xSide = x < xCenter? "Left": "Right";
    var ySide = y < yCenter? "Top": "Bottom";
    var cornerRadius = getRadius(xSide, ySide);
    if (typeof(cornerRadius) === "string" && cornerRadius.endsWith("%")) {
        cornerRadius = parseFloat(cornerRadius) * Math.min(xCenter, yCenter) / 100;
    }
    // We only handle a single radius at this moment.
    if (!isNaN(cornerRadius)) {
        // Limit to minimum of 0.5 * width and 0.5 * height
        cornerRadius = Math.min(cornerRadius, Math.min(xCenter, yCenter));
        // Map to distance from center to make all 4 quadrants behave the same
        var xDistFromCenter = Math.abs(x - xCenter);
        var yDistFromCenter = Math.abs(y - yCenter);
        // Determine distance from center of radius terminates
        var xDistFromCorner = xDistFromCenter - xCenter + cornerRadius;
        var yDistFromCorner = yDistFromCenter - yCenter + cornerRadius;
        if (xDistFromCorner >= 0 && yDistFromCorner >= 0 &&
              (xDistFromCorner * xDistFromCorner +
                yDistFromCorner * yDistFromCorner >
                cornerRadius * cornerRadius)) {
            // Point is in the part where there is a radius, and falls
            // falls outside the circle
            return false;
        }
    }
    // Within the border and radius
    if (displayConfiguration.background !== undefined) {
        // When there's a background, it's a hit, even if the color is
        // completely transparent.
        return true;
    }

    switch (this.displayType) {
      case "empty":
        return false;
      case "triangle":
        return this.checkTriangleHit(displayConfiguration, [x / pos.width, y / pos.height]);
      case "arc":
        return this.checkArcHit(displayConfiguration, x, pos.width, y, pos.height);
      case "line":
        return this.checkLineHit(displayConfiguration, x, pos.width, y, pos.height);
    }
    // text, image, iframe, html are considered opaque
    // empty is also considered opaque
    return true;
}

// --------------------------------------------------------------------------
// hasVisibleBorder
//
// Returns true when the border of this display is visible, i.e. has a
// border-style and border-width > 0; border-color is black by default.
// Does not check opacity of the border color.
Display.prototype.hasVisibleBorder = function() {
    var displayConfiguration = this.descriptionDisplay;

    if (displayConfiguration === undefined) {
        return false;
    }

    function isDefined(attr) {
        return attr !== undefined && attr !== "" && attr !== "none";
    }

    var hasBorderStyle =
        isDefined(displayConfiguration.borderStyle) ||
        isDefined(displayConfiguration.borderTopStyle) ||
        isDefined(displayConfiguration.borderLeftStyle) ||
        isDefined(displayConfiguration.borderBottomStyle) ||
        isDefined(displayConfiguration.borderRightStyle);
    var hasBorderWidth =
        isDefined(displayConfiguration.borderWidth) ||
        isDefined(displayConfiguration.borderTopWidth) ||
        isDefined(displayConfiguration.borderLeftWidth) ||
        isDefined(displayConfiguration.borderBottomWidth) ||
        isDefined(displayConfiguration.borderRightWidth);

    return hasBorderStyle && hasBorderWidth;
}

// --------------------------------------------------------------------------
// debugGetDescription
//
Display.prototype.debugGetDescription = function() {
    return this.descriptionDisplay;
}

/**
 * When showEmbedding becomes false, the embeddingDiv is removed from the frame
 * div, but is saved: that means that areas can still embed, but just won't
 * be displayed. When it's set to true, the embeddingDiv is re-embedded and all
 * child areas will display properly.
 */
Display.prototype.setShowEmbedding = function(showEmbedding) {
    if (!this.showEmbedding === !showEmbedding) {
        return; // no action when identical
    }
    if (this.embeddingDiv) {
        if (showEmbedding) {
            if (this.baseArea.contentPos) {
                embedElementAtPos(this.embeddingDiv, this.baseArea.contentPos,
                                this.frameDiv, this.frameDiv.firstChild);
            } else {
                embedZeroOffsetElementAtPos(this.embeddingDiv,
                                          this.baseArea.relative, this.frameDiv,
                                          this.frameDiv.firstChild);
            }
        } else {
            this.frameDiv.removeChild(this.embeddingDiv);
        }
    }
    this.showEmbedding = !!showEmbedding;
}

inherit(SurveyDisplay, ContentDisplay);

function SurveyDisplay(areaId, surveyor) {
    requireSurveyMode();

    this.areaId = areaId;
    this.surveyor = surveyor;
    this.swidth = undefined;
    this.sheight = undefined;
    this.nrTextNodes = 0;
}

SurveyDisplay.embeddingDiv = undefined;

// --------------------------------------------------------------------------
// getEmbeddingDiv (static)
//
// returns (creating, of required a document.body child div, which hosts all
//  of the survey divs
//
SurveyDisplay.getEmbeddingDiv = function() {
    if (SurveyDisplay.embeddingDiv === undefined) {
        var sdDiv = createDiv("surveyDivContainer");
        sdDiv.style.position = "absolute";
        sdDiv.style.left = 0;
        sdDiv.style.top = 0;
        sdDiv.style.width = "100000px";

        document.body.appendChild(sdDiv);

        SurveyDisplay.embeddingDiv = sdDiv;
    }
    return SurveyDisplay.embeddingDiv;
}

// Inserts a span with font size 0 to the element in the display div to measure
// the baseline. The offsetTop of the span is the baseline height for the
// span containing the text.
SurveyDisplay.prototype.setNewDisplayElement = function(display, displayType) {
    this.ContentDisplay_setNewDisplayElement(display, displayType);
    if (this.displayElement !== undefined) {
        if (this.displayElement.type === "text" || this.displayElement.type === "html") {
            var zeroHeightDiv = document.createElement("span");
            zeroHeightDiv.style.fontSize = "0";
            zeroHeightDiv.style.visibility = "hidden";
            zeroHeightDiv.style.background = "red";
            zeroHeightDiv.innerText = "a";
            this.displayElement.root.insertBefore(zeroHeightDiv,
                                                this.displayElement.content);
        }
    }
}

// --------------------------------------------------------------------------
// update
//
// called by a client surveyor to notify that the configuration has changed
//
SurveyDisplay.prototype.update = function(dispDesc, width, height) {
    this.swidth = width;
    this.sheight = height;

    this.configurationUpdate(dispDesc, true, false);
    if (this.displayElement !== undefined) {

        var rootElem = this.displayElement.root;
        if (typeof(width) == "number") {
            rootElem.style.width = width + "px";
        } else {
            rootElem.style.width = "auto";
        }
        if (typeof(height) == "number") {
            rootElem.style.height = height + "px";
        } else {
            rootElem.style.height = "auto";
        }
    }

    if (this.displayType !== "image") {
        this.surveyor.surveyNotification();
    }
}

SurveyDisplay.prototype.applyHTMLTransform = function(value) {
    if (this.displayElement && this.displayElement.root) {
        assignCSSStyleProp(this.displayElement.root.style, "transform",
            getTransformObjectAsString(value, this.displayType, 0));
    }
}

SurveyDisplay.prototype.notifyImageSize = function(width, height) {
    this.surveyor.imageSizeNotification(width, height);
}


// --------------------------------------------------------------------------
// createDisplayDiv
//
SurveyDisplay.prototype.createDisplayDiv = function() {
    this.ContentDisplay_createDisplayDiv(this.areaId + ":survey");
    if (this.displayDiv) {
        var parent = SurveyDisplay.getEmbeddingDiv();
        parent.appendChild(this.displayDiv);
        this.displayDiv.style.left = "inherit";
        this.displayDiv.style.top = "inherit";
        this.displayDiv.style.width = "inherit";
        this.displayDiv.style.height = "inherit";
        this.displayDiv.style.visibility = "hidden";
    }
}

// --------------------------------------------------------------------------
// getWidth
//
SurveyDisplay.prototype.getWidth = function() {
    if (typeof(this.displayElement) === "undefined") {
        return 0;
    }

    var rootElem = this.displayElement.root;
    if (this.displayType === "image") {
        if (typeof(this.swidth) === "number") {
            return this.swidth;
        }
        var image = rootElem;
        var nwidth = image.naturalWidth;
        if (typeof(this.sheight) === "number") {
            if (image.naturalHeight) {
                return Math.round(nwidth *
                                  (this.sheight / image.naturalHeight));
            }
            return 0;
        }
        return nwidth;
    } else {
        if (runtimeEnvironment.surveyMode === "estimate") {
            return this.getEstimateWidth();
        }

        var bcr = rootElem.getBoundingClientRect();
        var bcrWidth = bcr.right - bcr.left;
        return Math.ceil(bcrWidth);
    }
}

// --------------------------------------------------------------------------
// getHeight
//
SurveyDisplay.prototype.getHeight = function() {
    if (typeof(this.displayElement) === "undefined") {
        return 0;
    }

    var rootElem = this.displayElement.root;
    if (this.displayType === "image") {
        if (typeof(this.sheight) === "number") {
            return this.sheight;
        }
        var image = rootElem;
        var nheight = image.naturalHeight;
        if (typeof(this.swidth) === "number") {
            if (image.naturalWidth) {
                return Math.round(nheight *
                                  (this.swidth / image.naturalWidth));
            }
            return 0;
        }
        return nheight;
    } else {
        if (runtimeEnvironment.surveyMode === "estimate") {
            return this.getEstimateHeight();
        }

        var bcr = rootElem.getBoundingClientRect();
        var bcrHeight = bcr.bottom - bcr.top;
        return Math.ceil(bcrHeight);
    }
}

SurveyDisplay.prototype.getSize = function() {
    if (this.displayElement === undefined) {
        return [0, 0];
    }
    if (this.displayType === "image") {
        return [this.getWidth(), this.getHeight()];
    } else {
        if (runtimeEnvironment.surveyMode === "estimate") {
            var s = this.getEstimateSize();
            return [s.width, s.height];
        } else {
            var rootElem = this.displayElement.root;
            var bcr = rootElem.getBoundingClientRect();
            var bcrHeight = bcr.bottom - bcr.top;
            var bcrWidth = bcr.right - bcr.left;
            var baseLine = this.displayElement.root.firstChild.offsetTop;
            return [Math.ceil(bcrWidth), Math.ceil(bcrHeight), Math.ceil(baseLine)];
        }
    }
}

// --------------------------------------------------------------------------
// getEstimateWidth
//
SurveyDisplay.prototype.getEstimateWidth = function() {
    var size = this.getEstimateSize();
    return size.width;
}

// --------------------------------------------------------------------------
// getEstimateHeight
//
SurveyDisplay.prototype.getEstimateHeight = function() {
    var size = this.getEstimateSize();
    return size.height;
}

// --------------------------------------------------------------------------
// getEstimateSize
//
SurveyDisplay.prototype.getEstimateSize = function() {
    switch (this.displayType) {
      case "text":
        return this.getEstimateTextSize();

      default:
        Utilities.warnOnce("SurveyDisplay.getWidth: estimate environment " +
                           "does not support display type '" +
                           this.displayType + "'");
        return { width: 0, height: 0 };
    }
}

// --------------------------------------------------------------------------
// getEstimateTextSize
//
// rather arbitrary:
//
//  the width is the string character length multiplied by the font-size, and
//   then by an arbitrary factor (0.63, for now)
//
//  the height is the font-size multiplied by another factor (1.2 for now)
//
SurveyDisplay.prototype.getEstimateTextSize = function() {
    var desc = this.descriptionDisplay;
    var textDesc = desc.text;
    var textStr = textDesc.value;
    if (textStr instanceof Array) {
        textStr = textStr[0];
    }
    var fontSize = typeof(textDesc.fontSize) === "number"? textDesc.fontSize:11;

    var width = (String(textStr)).length * fontSize * 0.63;
    var height = fontSize * 1.2;

    return { width: width, height: height };
}
