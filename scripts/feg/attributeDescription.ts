// Copyright 2017 Theo Vosse.
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

/// <reference path="areaTemplate.ts" />

/* The main call to this file is verifyAreaAttributeDescription. Its
   purpose is to check the compiled template tree against the allowed
   attributes and warn when there is a problem as an aid for the
   author. The rest of the system does not rely on it.
*/

interface BasicDescriptionType {
    type: string; // the name of one of the fields in ValueType
    match?: RegExp;
}

var basicDescriptionTypes: {[typeName: string]: BasicDescriptionType[]} = {
    color: [{
        type: "string",
        match: /^#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]+$/i
    }, {
        type: "string",
        match: /^rgb\(( *[0-9]{1,3} *, *[0-9]{1,3} *, *[0-9]{1,3} *| *[0-9]{1,3}% *, *[0-9]{1,3}% *, *[0-9]{1,3}% *)\)$/
    }, {
        type: "string",
        match: /^rgba\( *([0-9]{1,3} *, *[0-9]{1,3} *, *[0-9]{1,3}|[0-9]{1,3}% *, *[0-9]{1,3}% *, *[0-9]{1,3}%) *, *(1|0|0?\.[0-9]+) *\)$/
    }, {
        type: "string",
        match: /^hsl\( *[0-9]{1,3} *, *[0-9]{1,3}% *, *[0-9]{1,3}% *\)$/
    }, {
        type: "string",
        match: /^hsla\( *[0-9]{1,3} *, *[0-9]{1,3}% *, *[0-9]{1,3}% *, *(1|0|0?\.[0-9]+) *\)$/
    }],
    numberOrString: [{
        type: "number"
    }, {
        type: "string"
    }],
    numberOrPixel: [{
        type: "number"
    }, {
        type: "string",
        match: /^\s*\d+(?:\.\d*)?\s*(?:px|em)?\s*$/
    }],
    numberOrPixelOrPercentage: [{
        type: "number"
    }, {
        type: "string",
        match: /^\s*\d+(?:\.\d*)?\s*(?:px|em|%)?\s*$/
    }],
    numberOrPercentage: [{
        type: "number"
    }, {
        type: "string",
        match: /^\s*\d+(?:\.\d*)?\s*%\s*$/
    }],
    degrees: [{
        type: "string",
        match: /^\s*[+\-]?\d+(?:\.\d*)?\s*(?:(deg|grad|rad|turn))?\s*$/
    }],
    pixelOrPercentage: [{
        type: "string",
        match: /^\s*\d+(?:\.\d*)?\s*(?:px|em|%)?\s*$/
    }],
    posPointShortHand: [{
        type: "string",
        match: /^(?:intersection|embedding|expression|referred)$/
    }],
    number: [{
        type: "number"
    }],
    boolOrString: [{
        type: "boolean"
    }, {
        type: "string"
    }],
    string: [{
        type: "string"
    }],
    any: [],
    "boolean": [{
        type: "boolean"
    }],
    areas: [{
        type: "areas"
    }],
    orderedSet: [{
        type: "orderedSet"
    }]
};

var zElementDescription: any = {
    or: ["string", // a global label
    {
        struct: {
            label: "string", // (optional) local label
            element: { orderedSet: "areas" },
            areaSet: "boolean" // treats areas per area set
        },
        name: "stacking element"
    }, {
        orderedSet: "areas"
    }],
    name: "stacking element"
};

var pointDescription: any = {
    or: [{
        struct: {
            element: "areas", // default: [me]
            type: { string: { "in": ["left", "right", "top", "bottom",
                                    "horizontal-center", "vertical-center"] } },
            content: "boolean",
            intersection: "boolean",
            label: "string",
            visibilityOf: "areas",
            relativeTo: "areas",
            includeFrame: "boolean"
        },
        name: "positioning point"
    },
    "string" // a global label
    ],
    name: "positioning point"
};

var pairDescription: any = {
    struct: {
        __mandatory__: ["point1", "point2"],
        point1: pointDescription,
        point2: pointDescription
    },
    name: "positioning pair"
};

var transitionPropertyDescription: any = {
    or: [
        "number", // transition time in seconds
        {
            struct: {
                duration: "number",
                timingFunction: "string",
                delay: "number"
            },
            name: "transition time"
        }
    ],
    name: "transition time"
};

var areaAttributeDescription: any = {
    name: "area",
    struct: {
        embedding: { string: { in: ["referred"] } },
        independentContentPosition: "boolean",
        propagatePointerInArea: {
            or: [
                {string: {in: ["embedding", "referred", "expression"]}},
                "areas"
            ]
        },
        content: "any",
        context: {
            struct: {
                __any__: "any"
            },
            name: "context"
        },
        write: {
            struct: {
                __any__: {
                    struct: {
                        __mandatory__: "upon",
                        upon: "any",
                        true: {
                            struct: {
                                continuePropagation: "boolean",
                                __any__: {
                                    struct: {
                                        to: "any",
                                        merge: "any"
                                    },
                                    name: "to/merge section"
                                }
                            },
                            name: "write clause"
                        },
                        false: {
                            struct: {
                                continuePropagation: "boolean",
                                __any__: {
                                    struct: {
                                        to: "any",
                                        merge: "any"
                                    },
                                    name: "to/merge section"
                                }
                            },
                            name: "write clause"
                        }
                    },
                    name: "write section"
                }
            },
            name: "write"
        },
        display: {
            struct: {
                text: {
                    struct: {
                        value: "any",
                        textAlign: { string: { "in": [ "left", "center", "right" ] } },
                        textIndent: "numberOrString",
                        textTransform: "string",
                        verticalAlign: {or: [
                            "pixelOrPercentage",
                            { string: { "in": ["baseline", "sub", "super",
                                               "text-top", "text-bottom",
                                               "middle", "top", "bottom"] }}
                        ]},
                        color: "color",
                        textFillColor: "color",
                        textStrokeWidth: "numberOrPixel",
                        textStrokeColor: "color",
                        clip: "boolOrString",
                        fontSize: "numberOrString",
                        fontFamily: "string",
                        fontStyle: "string",
                        fontWeight: "numberOrString",
                        fontVariant: "string",
                        lineHeight: "numberOrPixelOrPercentage",
                        textDecoration: "string",
                        borderSpacing: "string",
                        overflow: "string",
                        whiteSpace: {string: {in: ["normal", "nowrap", "pre", "pre-wrap", "pre-line"]}},
                        numericFormat: {
                            struct: {
                                __mandatory__: "type",
                                type: { string: { "in": [ "fixed", "exponential", "precision", "hexadecimal", "HEXADECIMAL", "intl" ] } },
                                numberOfDigits: "number",
                                locale: "string",
                                localeMatcher: { string: { "in": ["lookup", "best fit"] } },
                                style: { string: { "in": ["decimal", "currency", "percent"] } },
                                currency: "string",
                                currencyDisplay: "string",
                                useGrouping: "boolean",
                                minimumIntegerDigits: "number",
                                minimumFractionDigits: "number",
                                maximumFractionDigits: "number",
                                minimumSignificantDigits: "number",
                                maximumSignificantDigits: "number"
                            },
                            name: "numeric format"
                        },
                        dateFormat: {
                            struct: {
                                __mandatory__: "type",
                                type: { string: { "in": [ "intl" ] } },
                                locale: "string",
                                localeMatcher: { string: { "in": ["lookup", "best fit"] } },
                                timeZone: "string",
                                hour12: "boolean",
                                weekday: { string: { "in": ["narrow", "short", "long"] } },
                                era: { string: { "in": ["narrow", "short", "long"] } },
                                year: { string: { "in": ["numeric", "2-digit"] } },
                                month: { string: { "in": ["numeric", "2-digit", "narrow", "short", "long"] } },
                                day: { string: { "in": ["numeric", "2-digit"] } },
                                hour: { string: { "in": ["numeric", "2-digit"] } },
                                minute: { string: { "in": ["numeric", "2-digit"] } },
                                second: { string: { "in": ["numeric", "2-digit"] } },
                                timeZoneName: "string"
                            },
                            name: "numeric format"
                        },
                        textShadow: {
                            orderedSet: {
                                struct: {
                                    __mandatory__: ["horizontal", "vertical", "color"],
                                    horizontal: "numberOrPixel",
                                    vertical: "numberOrPixel",
                                    color: "color",
                                    blurRadius: "numberOrPixel"
                                },
                                name: "text shadow"
                            }
                        },
                        input: {
                            struct: {
                                // configuration properties
                                __mandatory__: "type",
                                type: {
                                    string: {
                                        in: ["text", "number", "password", "file"]
                                    }
                                },
                                placeholder: "string",
                                // numeric type properties
                                min: "number",
                                max: "number",
                                multiLine: "boolean",
                                init: {
                                    struct: {
                                        selectionStart: "number",
                                        selectionEnd: "number",
                                        selectionDirection: { string: { in: [
                                            "forward", "backward", "none"
                                        ]}},
                                        focus: "boolean"
                                    }
                                },
                                // file type attributes
                                acceptFiles: "string"
                            },
                            name: "input"
                        }
                    },
                    name: "text display"
                },
                image: {
                    struct: {
                        __mandatory__: "src",
                        src: "string",
                        alt: "string",
                        size: "numberOrPercentage"
                    },
                    name: "image display"
                },
                iframe: {
                    struct: {
                        __mandatory__: "src",
                        src: "string",
                    },
                    name: "iframe"
                },
                html: {
                    struct: {
                        __mandatory__: "value",
                        value: "string",
                        textAlign: { string: { "in": [
                            "left", "center", "right", "start", "end", 
                            "justify", "justify-all" 
                        ] } },
                        verticalAlign: {or: [
                            "pixelOrPercentage",
                            { string: { "in": ["baseline", "sub", "super",
                                               "text-top", "text-bottom",
                                               "middle", "top", "bottom"] }}
                        ]},
                        color: "color",
                        textFillColor: "color",
                        textStrokeWidth: "numberOrString",
                        textStrokeColor: "color",
                        fontSize: "numberOrString",
                        fontFamily: "string",
                        fontStyle: "string",
                        fontWeight: "numberOrString",
                        fontVariant: "string",
                        lineHeight: "numberOrPixelOrPercentage",
                        textDecoration: "string",
                        borderSpacing: "string",
                        handleClick: "boolean",
                        overflow: {string: {in: ["visible", "hidden"]}},
                        whiteSpace: {string: {in: [
                            "normal", "nowrap", "pre", "pre-wrap", "pre-line"
                        ]}}
                    },
                    name: "html display"
                },
                triangle: {
                    struct: {
                        baseSide: {
                            string: {
                                    in: ["left", "right", "top", "bottom", "leftTop",
                                         "leftBottom", "rightTop", "rightBottom"]
                            }
                        },
                        color: "color",
                        stroke: "color",
                        shadow: {
                            struct: {
                                __mandatory__: "color",
                                color: "color",
                                horizontal: "numberOrPixel",
                                vertical: "numberOrPixel",
                                blurRadius: "numberOrPixel"
                            },
                            name: "triangle shadow"
                        },
                    },
                    name: "triangle display"
                },
                arc: {
                    struct: {
                        color: "color", // no default
                        x: "number", // defaults to center
                        y: "number", // defaults to center
                        start: "number", // default: 0
                        end: "number", // no default; excludes range
                        range: "number", // no default; excludes end
                        inset: "number", // default: 0
                        radius: "number" // no default
                    }
                },
                foreign: {
                    struct: {
                        __mandatory__: "value",
                        value: "any"
                    },
                    name: "foreign display"
                },
                background: {
                    or: ["color",
                    {
                        struct: {
                            linearGradient: {
                                struct: {
                                    start: {
                                        or:[{
                                            string: {
                                                    in: ["to left", "to top", "to left top", "to left bottom",
                                                         "to right", "to right top", "to right bottom", "to bottom"]
                                            }
                                        }, "degrees"],
                                    },
                                    stops: {
                                        orderedSet: {
                                            struct: {
                                                __mandatory__: "color",
                                                color: "color",
                                                length: "numberOrPixelOrPercentage"
                                            },
                                            name: "linear gradient stops"
                                        }
                                    }
                                },
                                name: "linear gradient"
                            }
                        }
                    }, {
                        struct: {
                            radialGradient: {
                                struct: {
                                    position: "string",
                                    angle: "degrees",
                                    shape: { string: { in: ["circle", "ellipse"] } },
                                    size: "string",
                                    stops: {
                                        orderedSet: {
                                            struct: {
                                                __mandatory__: "color",
                                                color: "color",
                                                length: "numberOrPixelOrPercentage"
                                            },
                                            name: "radial gradient stops"
                                        }
                                    }
                                },
                                name: "radial gradient"
                            }
                        },
                    }, {
                        struct: {
                            __mandatory__: "image",
                            image: "string",
                            repeat: "string",
                            position: "string",
                            size: "string",
                            color: "color"
                        }
                    }],
                    name: "display background"
                },
                borderRadius: "numberOrPixel",
                borderTopLeftRadius: "numberOrPixel",
                borderTopRightRadius: "numberOrPixel",
                borderBottomLeftRadius: "numberOrPixel",
                borderBottomRightRadius: "numberOrPixel",
                boxShadow: {
                    orderedSet: {
                        struct: {
                            __mandatory__: ["color", "horizontal", "vertical"],
                            color: "color",
                            horizontal: "numberOrPixel",
                            vertical: "numberOrPixel",
                            blurRadius: "numberOrPixel",
                            spread: "numberOrPixel",
                            inset: "boolean"
                        },
                        name: "box shadow"
                    }
                },
                borderStyle: "string",
                borderWidth: "numberOrPixel",
                borderColor: "color",
                borderLeftStyle: "string",
                borderLeftWidth: "numberOrPixel",
                borderLeftColor: "color",
                borderRightStyle: "string",
                borderRightWidth: "numberOrPixel",
                borderRightColor: "color",
                borderTopStyle: "string",
                borderTopWidth: "numberOrPixel",
                borderTopColor: "color",
                borderBottomStyle: "string",
                borderBottomWidth: "numberOrPixel",
                borderBottomColor: "color",
                overflow: { string: { in: ["hidden", "visible"] } },
                overflowX: { string: { in: ["hidden", "visible"] } },
                overflowY: { string: { in: ["hidden", "visible"] } },
                padding: "numberOrPixel",
                paddingTop: "numberOrPixel",
                paddingBottom: "numberOrPixel",
                paddingLeft: "numberOrPixel",
                paddingRight: "numberOrPixel",
                opacity: "number",
                transform: { // currently only applies to images
                    struct: {
                        rotate: "number", // degrees
                        scale: {
                            or: [
                                "number", // identical in both directions
                                {
                                    struct: {
                                        x: "number", // scale horizontal, default 1
                                        y: "number"  // scale vertical, default 1
                                    }
                                }
                            ]
                        },
                        flip: { string: { in: ["horizontally", "vertically"] } }
                    }
                },
                transitions: {
                    struct: {
                        top: transitionPropertyDescription,
                        left: transitionPropertyDescription,
                        width: transitionPropertyDescription,
                        height: transitionPropertyDescription,
                        color: transitionPropertyDescription,
                        background: transitionPropertyDescription,
                        borderWidth: transitionPropertyDescription,
                        borderColor: transitionPropertyDescription,
                        borderLeftWidth: transitionPropertyDescription,
                        borderLeftColor: transitionPropertyDescription,
                        borderRightWidth: transitionPropertyDescription,
                        borderRightColor: transitionPropertyDescription,
                        borderTopWidth: transitionPropertyDescription,
                        borderTopColor: transitionPropertyDescription,
                        borderBottomWidth: transitionPropertyDescription,
                        borderBottomColor: transitionPropertyDescription,
                        transform: transitionPropertyDescription
                    },
                    name: "transitions"
                },
                hoverText: "string",
                pointerOpaque: "boolean",
                windowTitle: "string",
                hideDuringPrinting: "boolean",
                filter: {
                    struct: {
                        blur: "number",
                        brightness: "numberOrPercentage",
                        contrast: "numberOrPercentage",
                        dropShadow: "string",
                        grayscale: "numberOrPercentage",
                        hueRotate: "degrees",
                        invert: "numberOrPercentage",
                        opacity: "numberOrPercentage",
                        saturate: "numberOrPercentage",
                        sepia: "numberOrPercentage"
                    },
                    name: "filter"
                }
            },
            name: "display"
        },
        position: {
            struct: {
                // The following attributes are rewritten using the above templates
                // Frame attributes:
                left: "numberOrPixelOrPercentage",
                right: "numberOrPixelOrPercentage",
                top: "numberOrPixelOrPercentage",
                bottom: "numberOrPixelOrPercentage",
                width: "numberOrPixelOrPercentage",
                height: "numberOrPixelOrPercentage",
                "content-width": "numberOrPixelOrPercentage",
                "content-height": "numberOrPixelOrPercentage",
                "horizontal-center": "numberOrPixelOrPercentage",
                "vertical-center": "numberOrPixelOrPercentage",
                frame: "numberOrPixelOrPercentage",
                content: "numberOrPixelOrPercentage",
                vertical: "numberOrPixelOrPercentage",
                horizontal: "numberOrPixelOrPercentage",
                // not implemented: "content-vertical": "numberOrPixelOrPercentage",
                // not implemented: "content-horizontal": "numberOrPixelOrPercentage",
                // And every attribute is also matched against a full pos point or
                // pos point pair description (note: __any__ is a last resort).
                __any__ : {
                    struct: {
                        point1: pointDescription,
                        point2: pointDescription,
                        equals: "number",
                        min: "numberOrString",
                        max: "number",
                        stability: "boolean",
                        preference: { string: { "in": ["min", "max"] } },
                        orGroups: pointDescription,
                        priority: "number",
                        pair1: pairDescription,
                        pair2: pairDescription,
                        ratio: "number"
                    },
                    name: "positioning constraint"
                }
            },
            name: "positioning"
        },
        stacking: {
            struct: {
                __any__: {
                    struct: {
                        higher: zElementDescription,
                        lower: zElementDescription,
                        priority: "number",
                    },
                    name: "stacking constraint"
                }
            },
            name: "area stacking",
        },
        children: {
            struct: {
                __any__: {
                    struct: {
                        description: undefined, // gets filled in later
                        data: "any",
                        partner: "areas"
                    },
                    name: "child"
                }
            },
            name: "children"
        },
        param: {
            struct: {
                pointerInArea: "boolean",
                dragInArea: "boolean",
                areaSetContent: "any",
                areaSetAttr: "any",
                input: {
                    struct: {
                        value: "numberOrString",
                        focus: "boolean",
                        selectionStart: "number",
                        selectionEnd: "number",
                        selectionDirection: "string"
                    },
                    name: "param.input"
                }
            },
            name: "param"
        }
    }
};

function checkAttributes(node: PathTreeNode, valueType: ValueType, attrDescription: any, report: boolean = true): boolean {

    function firstAttribute(attrDescription: any): string {
        var keys: string[] = Object.keys(attrDescription);

        for (var i: number = 0; i !== keys.length; i++) {
            if (keys[i] !== "name") {
                return keys[i];
            }
        }
        assert(false, "empty object in the type description?");
        return undefined;
    }

    function nodeSyntaxError(node: PathTreeNode, msg: string, depth: number = 0): void {
        var errLocStrs: {[err: string]: string} = {};

        function collectErrLocStrs(node: PathTreeNode, depth: number): void {
            for (var i: number = 0; i < node.values.length; i++) {
                if (!(node.values[i] instanceof ExpressionClassName)) {
                    var errLocStr: string = node.values[i].getShortErrorLocation(depth);
                    if (!(errLocStr in errLocStrs)) {
                        errLocStrs[errLocStr] = errLocStr;
                    }
                }
            }
        }

        collectErrLocStrs(node, depth);
        Utilities.syntaxError(msg + " for " + objValues(errLocStrs).join(", ") +
                              " at " + getShortChildPath(node.getPath()));
    }

    function valueSyntaxError(value: PathInfo, msg: string): void {
        Utilities.syntaxError(msg + " at " + value.getShortErrorLocation(0));
    }

    function typeMatch(value: PathInfo, typeName: any): boolean {
        var typeDescr: BasicDescriptionType[] = basicDescriptionTypes[typeName];

        function functionValueTypeMatch(vt: ValueType, td: BasicDescriptionType): boolean {
            return vt.undef || vt.anyData || vt.unknown || td.type in vt;
        }

        function functionConstTypeMatch(fn: FunctionNode, td: BasicDescriptionType): boolean {
            if (!(fn instanceof ConstNode)) {
                return true;
            }
            var cn = <ConstNode> fn;
            var value: any = cn.value;
            if (value === undefined) {
                return true; // empty os
            }
            if (!(value instanceof Array)) {
                value = [value];
            }
            for (var i: number = 0; i < value.length; i++) {
                if (typeof(value[i]) !== td.type &&
                      !(value[i] instanceof ElementReference && td.type === "areas")) {
                    return false;
                }
                if (td.match !== undefined && !td.match.test(value[i])) {
                    return false;
                }
            }
            return true;
        }

        // This is a bit crude: since function applications cannot be inspected,
        // it can only verify simple values.
        function cdlValueTypeMatch(val: any, td: BasicDescriptionType): boolean {
            if (val instanceof Object || val instanceof Array) {
                return true;
            }
            if (typeof(val) !== td.type) {
                return false;
            }
            if (td.match !== undefined && !td.match.test(val)) {
                return false;
            }
            return true;
        }

        // Attempt to verify against the function node (which has most detailed
        // type information); if there is no function node, try the cdl value.
        if (typeDescr.length === 0) {
            return true;
        }
        for (var i: number = 0; i !== typeDescr.length; i++) {
            var fn: FunctionNode = undefined;
            if (value.node !== undefined) {
                fn = value.node.functionNode;
                if (fn !== undefined &&
                      functionConstTypeMatch(fn, typeDescr[i]) &&
                      functionValueTypeMatch(fn.valueType, typeDescr[i])) {
                    return true;
                }
            }
            if (fn === undefined &&
                  cdlValueTypeMatch(value.expression.expression, typeDescr[i])) {
                return true;
            }
        }
        return false;
    }

    function attributeContextError(attr: string, attrDescription: any, node: PathTreeNode): string {
        var str: string = "attribute '" + attr + "' not allowed";

        if (node !== undefined) {
            str += " under '" + node.parentAttr + "'";
        }
        if (attrDescription instanceof Object) {
            var orList1: any[];
            var allowedAttributes: string[] = [];
            var hintAttributes: {[attr: string]: boolean} = undefined;
            if ("name" in attrDescription) {
                str += " in " + attrDescription.name + " object";
            }
            switch (firstAttribute(attrDescription)) {
              case "or": orList1 = attrDescription.or; break;
              case "struct": orList1 = [attrDescription]; break;
              default: orList1 = []; break;
            }
            for (var i: number = 0; i < orList1.length; i++) {
                var or1_i: any = orList1[i];
                if (or1_i instanceof Object) {
                    if (firstAttribute(or1_i) === "struct") {
                        allowedAttributes = allowedAttributes.concat(Object.keys(or1_i.struct));
                        for (var nestedAttr in or1_i.struct) {
                            var nestedDescr: any = or1_i.struct[nestedAttr];
                            if (nestedDescr instanceof Object) {
                                var orList2: any[];
                                switch (firstAttribute(nestedDescr)) {
                                  case "or": orList2 = nestedDescr.or; break;
                                  case "struct": orList2 = [nestedDescr]; break;
                                  default: orList2 = []; break;
                                }
                                for (var j: number = 0; j < orList2.length; j++) {
                                    var or2_j: any = orList2[j];
                                    if (or2_j instanceof Object && firstAttribute(or2_j) === "struct") {
                                        if ((attr in or2_j.struct || "__any__" in or2_j.struct) &&
                                            checkAttributes(node, undefined, or2_j.struct[attr in or2_j.struct? attr: "__any__"], false)) {
                                            if (hintAttributes === undefined) {
                                                hintAttributes = {};
                                            }
                                            hintAttributes[nestedAttr] = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (hintAttributes !== undefined) {
                str += " (did you forget " + Object.keys(hintAttributes).join(" or ") + "?)";
            } else if (allowedAttributes.length !== 0) {
                str += " (" + allowedAttributes.slice(0, 3).join(", ") + " etc. expected instead)";
            }
        }
        return str;
    }

    function valueTypeMatch(valueType: ValueType, attrDescription: any, msgs: string[], node: PathTreeNode): boolean {
        if (valueType.undef || valueType.anyData || valueType.unknown) {
            return true;
        }
        if (typeof(attrDescription) === "string") {
            var td: BasicDescriptionType[] = basicDescriptionTypes[attrDescription];
            if (td.length === 0 || td.some(function(btd: BasicDescriptionType) {
                      return btd.type in valueType;
                  })) {
                return true;
            }
            msgs.push(getDescrErr(attrDescription));
            return false;
        } else {
            var descrAttr: string = firstAttribute(attrDescription);
            switch (descrAttr) {
              case "in": // there are only types, no values
                return true;
              case "or":
                var minErr: string[] = undefined;
                for (var i: number = 0; i < attrDescription.or.length; i++) {
                    var orMsgs: string[] = [];
                    if (valueTypeMatch(valueType, attrDescription.or[i], orMsgs, node)) {
                        return true;
                    }
                    if (minErr === undefined || orMsgs.length < minErr.length) {
                        minErr = orMsgs;
                    }
                }
                msgs.push.apply(msgs, minErr);
                return false;
              case "struct":
                if (valueType.object === undefined) {
                    msgs.push(getDescrErr(attrDescription));
                    return false;
                }
                if ("__mandatory__" in attrDescription.struct) {
                    var mandAttrs: any = attrDescription.struct.__mandatory__;
                    if (!(mandAttrs instanceof Array)) {
                        mandAttrs = [mandAttrs];
                    }
                    for (var i: number = 0; i < mandAttrs.length; i++) {
                        if (!(mandAttrs[i] in valueType.object)) {
                            msgs.push("missing attribute '" + mandAttrs[i] + "'");
                            return false;
                        }
                    }
                }
                for (var attr in valueType.object) {
                    // Skip attributes that are in valueType.object but not in
                    // struct, but only when in an 'or'; this is a bit
                    // permissive, but value types are the result of merges and
                    // can contain mixed structs.
                    if (!(attr in attrDescription.struct) &&
                          !("__any__" in attrDescription.struct)) {
                        msgs.push(attributeContextError(attr, attrDescription, node));
                        return false;
                    } else if (!(attr in attrDescription.struct &&
                                 valueTypeMatch(valueType.object[attr],
                                                attrDescription.struct[attr],
                                                msgs, undefined)) &&
                               !("__any__" in attrDescription.struct &&
                                 valueTypeMatch(valueType.object[attr],
                                                attrDescription.struct.__any__,
                                                msgs, undefined))) {
                        return false;
                    }
                }
                return true;
              case "orderedSet":
                return valueTypeMatch(valueType, attrDescription.orderedSet, msgs, node);
              default:
                return valueTypeMatch(valueType, descrAttr, msgs, node);
            }
        }
    }

    // Returns the value type of attr under vt. If this function returns
    // undefined, the value type is ignored in the check.
    function getNextValueType(vt: ValueType, attr: string): ValueType {
        if (vt === undefined || vt.undef || vt.unknown) {
            return undefined;
        }
        if (vt.anyData) {
            return vt;
        }
        if (vt.object !== undefined) {
            return vt.object[attr];
        }
        return undefined;
    }

    function constMatch(val: any, values: any[]): boolean {
        return !isSimpleValue(val) || values.indexOf(val) >= 0;
    }

    function getDescrErr(attrDescription: any): string {
        return typeof(attrDescription) === "string"? "not a " + attrDescription:
            "name" in attrDescription? "malformed " + attrDescription.name:
            "no matching value";
    }

    if ("templateId" in node && !areaTemplates[node.templateId].doesExist) {
        // skip checks on non-existing areas
        return true;
    }
    var match: boolean = true;
    if (valueType === undefined && node.functionNode !== undefined) {
        valueType = node.functionNode.valueType;
    }
    var vtmMsgs: string[] = [];
    if (valueType !== undefined &&
          !valueTypeMatch(valueType, attrDescription, vtmMsgs, node)) {
        if (report) {
            nodeSyntaxError(node, vtmMsgs.join(", and "));
        }
        if (attrDescription.struct === undefined ||
              Utilities.isEmptyObj(node.next)) {
            return false;
        }
    }
    if (typeof(attrDescription) === "string") {
        if (attrDescription !== "any") {
            for (var i: number = 0; i < node.values.length; i++) {
                if (!typeMatch(node.values[i], attrDescription)) {
                    match = false;
                    if (report) {
                        valueSyntaxError(node.values[i], getDescrErr(attrDescription));
                    }
                }
            }
        }
        return match;
    } else {
        var descrAttr: string = firstAttribute(attrDescription);
        switch (descrAttr) {
          case "in":
            for (var i: number = 0; i < node.values.length; i++) {
                if (!constMatch(node.values[i].expression.expression, attrDescription.in)) {
                    match = false;
                    if (report) {
                        valueSyntaxError(node.values[i],
                                         convertValueToString(node.values[i].expression.expression) +
                                         " is not a permitted value");
                    }
                }
            }
            return match;
          case "or":
            for (var i: number = 0; i < attrDescription.or.length; i++) {
                if (checkAttributes(node, valueType, attrDescription.or[i], false)) {
                    return true;
                }
            }
            if (report) {
                nodeSyntaxError(node, getDescrErr(attrDescription));
            }
            return false;
          case "struct":
            if (Utilities.isEmptyObj(node.next) && valueType !== undefined) {
                // Value comes from function and was approved.
                return match;
            }
            if ("__mandatory__" in attrDescription.struct) {
                var mandAttrs: any = attrDescription.struct.__mandatory__;
                if (!(mandAttrs instanceof Array)) {
                    mandAttrs = [mandAttrs];
                }
                for (var i: number = 0; i < mandAttrs.length; i++) {
                    if (!(mandAttrs[i] in node.next)) {
                        match = false;
                        if (report) {
                            nodeSyntaxError(node, "attribute '" + mandAttrs[i] + "' missing");
                        }
                    }
                }
            }
            if (Utilities.isEmptyObj(node.next)) {
                match = false;
            }
            for (var attr in node.next) {
                var hasAny: boolean = "__any__" in attrDescription.struct;
                var nextNode: PathTreeNode = node.next[attr];
                var nextValueType: ValueType = getNextValueType(valueType, attr);
                var descr1: any = attrDescription.struct[attr];
                var descr2: any = attrDescription.struct.__any__;
                if (descr1 === undefined && descr2 === undefined) {
                    match = false;
                    if (report) {
                        nodeSyntaxError(nextNode, attributeContextError(attr, attrDescription, node), 1);
                    }
                } else if (!(descr1 !== undefined &&
                             checkAttributes(nextNode, nextValueType, descr1, report && !hasAny)) &&
                           !(descr2 !== undefined &&
                             checkAttributes(nextNode, nextValueType, descr2, report))) {
                    match = false;
                }
            }
            return match;
          case "orderedSet":
            return checkAttributes(node, valueType, attrDescription.orderedSet, report);
          default:
            return checkAttributes(node, valueType, attrDescription[descrAttr], report) &&
                checkAttributes(node, valueType, descrAttr, report);
        }
    }
}

function verifyAreaAttributeDescription(template: AreaTemplate): void {
    // Make children.*.description recursive
    if (Number(buildInfo.cdlRevision) < 6746) {
        return; // Don't check old revisions; they're ok.
    }
    areaAttributeDescription.struct.children.struct.__any__.struct.description = areaAttributeDescription;
    checkAttributes(template.areaNode, undefined, areaAttributeDescription);
}
