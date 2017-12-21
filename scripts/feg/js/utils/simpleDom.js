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

"use strict";

/* A very simple implementation of document and window, using only those
   functions that are actually in use. Several of these functions (like
   those changing properties and dom structure) could be made a NOP
   without any harm.
*/

var document, window;
var __usingJSDom = false;
var navigator;
var nrDOMElementsInDocument = 0;

function sdTranslateCSSAttribute(attr) {
    switch (attr) {
        case "zIndex": return "z-index";
        case "maxWidth": return "max-width";
        default: return attr;
    }
}

// Basic style object: no functionality
class DOMStyle {
    setProperty(attr, val) {
        this[attr] = val;
    }

    removeProperty(attr) {
        delete this[attr];
    }

    toString() {
        var str = "";

        for (var attr in this) {
            if (this.hasOwnProperty(attr)) {
                if (str.length > 0) str += " ";
                str += sdTranslateCSSAttribute(attr) + ": " + this[attr] + ";";
            }
        }
        return str;
    }
}

// Basic element: no functionality
class DOMElement {
    constructor(type) {
        this.type = type;
        this.style = new DOMStyle();
        this.parentNode = null;
        this.children = [];
    }

    insertBefore(element, beforeElement) {
        var index = this.children.indexOf(element);

        if (index !== -1) {
            this.children.splice(index, 0, element);
        } else {
            this.children.push(element);
        }
        element.parentNode = this;
        nrDOMElementsInDocument++;
    }

    removeChild(element) {
        var index = this.children.indexOf(element);

        if (index !== -1) {
            this.children.splice(index, 1);
        }
        element.parentNode = undefined;
        if (element.id !== undefined && element.id !== "") {
            delete document.elementsById[element.id];
        }
        nrDOMElementsInDocument--;
    }

    appendChild(element) {
        this.children.push(element);
        element.parentNode = this;
        nrDOMElementsInDocument++;
    }

    setAttribute(attribute, value) {
        if (attribute === "id") {
            if (this.id !== undefined && this.id !== "") {
                delete document.elementsById[this.id];
            }
            document.elementsById[value] = this;
        }
        this[attribute] = value;
    }

    getAttribute(attribute) {
        return this[attribute];
    }

    toHTML(indent) {
        var str;

        if (indent === undefined) {
            indent = "";
        }
        str = indent + '<' + this.type;
        if ("id" in this) {
            str += ' id="' + this.id + '"';
        }
        for (var attribute in this) {
            if (this.hasOwnProperty(attribute) && attribute !== "id" &&
                  attribute !== "childNodes" && attribute !== "parentNode" &&
                  attribute !== "mondriaDisplay" && attribute !== "type" &&
                  typeof(this[attribute]) !== "function") {
                var avStr = this[attribute].toString();
                if (avStr !== "") {
                    str += ' ' + attribute + '="' + avStr + '"';
                }
            }
        }
        // str += '>\n';
        console.log(str + '>');
        for (var i = 0; i !== this.children.length; i++) {
            str += this.children[i].toHTML(indent + "  ");
        }
        // str += indent + '</' + this.type + '>\n';
        console.log(indent + '</' + this.type + '>');
        // return str;
    }

    addEventListener(type, handler, bubble) {
    }

    dispatchEvent(evt) {
    }
}

class HTMLElement extends DOMElement {
    constructor(type) {
        super(type);
    }

    focus() {
        document.activeElement = this;
    }

    blur() {
        if (document.activeElement === this) {
            document.activeElement = document.body;
        }
    }

    // A pointless implementation
    getBoundingClientRect() {
        return {bottom: 0, height: 0, left: 0, right: 0, top:0, width: 0};
    }
}

class HTMLDivElement extends HTMLElement {
}

// Basic anchor element; no functionality
class HTMLAnchorElement extends HTMLElement {
    constructor(link) {
        super("a");
        this.href = link;
    }
}

// Basic input element; no functionality
class HTMLInputElement extends HTMLElement {
    constructor() {
        super("input");
    }
}

// Basic text node: no functionality
class DOMTextNode extends HTMLElement {
    constructor(text) { 
        super("textnode");
        this.text = text;
    }
    
    toHTML(indent) {
        // Should convert this.text to HTML entities, and perhaps surround it
        // with <p>...</p>.
        console.log(indent + this.text);
        // return indent + this.text + '\n';
    }
}

// Basic document: can create elements and return elements whose id is
// known.
// Bug: assigning an id only updates the elementsById table when done via
// element.setAttribute. Could be overcome by using ECMAScript7 observers.
class DOMDocument {
    constructor() {
        this.body = new HTMLElement("div");
        this.elementsById = {};
        this.URL = "";
        this.activeElement = this.body;
    }

    createElement(type) {
        switch (type) {
        case "input": return new HTMLInputElement();
        case "a": return new HTMLAnchorElement();
        default: return new HTMLElement(type);
        }
    }

    createTextNode(text) {
        return new DOMTextNode(text);
    }

    getElementById(id) {
        return id in this.elementsById? this.elementsById[id]: null;
    }

    toHTML() {
        console.log("<html>\n  <body>");
        this.body.toHTML("    ");
        console.log("  </body>\n</html>");
        // return "<html>\n  <body>\n" + this.body.toHTML("    ") +
        //       "  </body>\n</html>\n";
    }
}

// No functionality except innerWidth and innerHeight
class DOMWindow {
    constructor(document) {
        this.innerWidth = 1517;
        this.innerHeight = 714;
        this.document = document;
    }
    
    createElement(type) {
        return this.document.createElement(type);
    }
    
    addEventListener(type, handler, bubble) {
    }
}

// Creates the basics needed to run the tests: a document with a body and
// a div with id "mondriaRootDiv".
function createBasicMondriaDocument() {
    var rootDiv;

    document = new DOMDocument();
    document.body = new HTMLElement("div");
    nrDOMElementsInDocument = 1;
    rootDiv = new HTMLElement("div");
    document.body.appendChild(rootDiv);
    rootDiv.setAttribute("id", "mondriaRootDiv");
}

// new MouseEvent("click", domEvent) returns an ImpersonatedMouseDomEvent with
// the same type and coordinates.
class MouseEvent extends ImpersonatedMouseDomEvent {
    constructor(type, domEvent) {
        super(type, domEvent.clientX, domEvent.clientY, undefined, []);
    }
}

class File {
    constructor() {
        this.lastModifiedDate = new Date();
        this.lastModified = this.lastModifiedDate.getMilliseconds();
        this.name = "";
        this.size = 0;
        this.type = "";
    } 
}