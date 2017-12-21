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


// this file implements suffix based posPoints - points whose labels
// are the areaId suffixed by either an explicit string provided
// in the point description ('label' posPoints) or based on the
// point 'type' - one of a fixeded set of edge types, like 'top' and 'left'.
// Both kinds take an 'element' to name the areas.
//
// 'type' posPoints have this format:
//    {
//       element: <area matching condition definition>
//       type: <one of a set of predefined labels>
//       content: true|false // optional
//       intersection: true|false // optional
//    }
//    The set of labels allowed here are those appearing in
//    PosPoint.definedTypes:
//    "left", "right", "top", "bottom", "horizontal-center", "vertical-center"
//    If 'content' is set to true, a content point label is created.
//    Otherwise (if the value is false or missing) a frame point label is
//    created.
//    Any combination of these parameters results in standard labels for
//    the areas matched by the condition defined under 'element'.
//    If no 'element' field is given, the point refers to the baseAreaId area. 
//
//    'intersection: true' is only supported in combination with a 'type'
//    suffix point where the type is an edge type (as defined in
//    PosPoint.definedEdgeTypes: "left", "right", "top", "bottom").
//    In all other cases, 'intersection: true' is ignored.
//
//    'intersection: true' points use a modified point label suffix compared
//    with their 'intersection: false' counterparts. In addition, when
//    such a point label is added, some automatic constraints defining the
//    positions of such points are added.
//
//    'intersection: true' points and center ("horizontal-center",
//    "vertical-center") points are automatic constraint points: for
//    every point label generated for these PosPoints, a set of automatic
//    constraints are created to constrain the position of that point.
//    The list of constraints generated for each such point is defined
//    in the file 'automaticPointConstraints.js'.
//
// 'label' posPoints have this format: 
//    {
//        element: <area matching condition definition>
//        label: <any string>
//    }
//    This definition allows an arbitrary label to be used. The given label
//    is combined with the IDs of the areas matched by the condition
//    under 'element' to produce the point label.
//    If no 'element' field is given, the point refers to the baseAreaId area.
//
// a SuffixPosPoint object has these members:
//   baseAreaId:
//   posPoint: the posPoint using this suffixPosPoint
//   isLabel: 'true' for user defined label posPoint, 'false' for a predefined
//             type posPoint
//   label: this associative array is indexed by area-ids, and
//          its values are the complete labels - if they can be created (i.e.
//          if the type/label are defined)
//   autoConstraintIds: indexed by areaIds, this associative array holds
//          the ids returned by automatic constraint creation functions
//          called for point labels generated here.
//   attr: saves some attribute values from the point description
//   element: maintains condition matcher registrations
// 
//   id: a unique id for this object, to hash its identification when it
//      registers with the base area and with its contentPosManager for
//      zero-offset mode toggle
// 
//   isZMTRegistered: true when this SuffixPosPoint is a content point,
//     and is being registered with each matched area for zero-offset mode
//     being toggled
//    
// When a SuffixPosPoint has 'content:true', it registers with the area's
//  contentPosManager, so that it knows when the zero-offset mode toggles.
//  This is because in zero-offset mode, the content-point is assigned the same
//   label as the frame-point, while in non-zero-offset mode they have distinct
//   labels.
//  While it is a content-point,  SuffixPosPoint registers with every matched
//   area. The contentPosManager calls its callback 'zeroOffsetToggle' with
//   the current value and the area id.
//

// TODO:
// - other point implementations

function SuffixPosPoint(baseAreaId, posPoint, isLabel)
{
    this.baseAreaId = baseAreaId;
    this.posPoint = posPoint;
    this.isLabel = isLabel;

    this.label = {};
    this.attr = {};
    this.areas = {}; // maps area id onto number of times referenced in element
}

SuffixPosPoint.prototype.destroy = suffixPosPointDestroy;
function suffixPosPointDestroy()
{
    this.destroyAllLabels();
}

SuffixPosPoint.prototype.labelAttrs = {
    element: true,
    label: true
};

SuffixPosPoint.prototype.typeAttrs = {
    type: true,
    content: true,
    element: true,
    intersection: true
};

SuffixPosPoint.prototype.newDescription = suffixPosPointNewDescription;
function suffixPosPointNewDescription(pointDesc)
{
    var recreateLabels = false;
    var attrList = this.isLabel ? this.labelAttrs : this.typeAttrs;

    for (var attr in attrList) {
        var attrDesc = pointDesc ? pointDesc[attr] : undefined;
        var attrDesc0 = attrDesc instanceof Array? attrDesc[0]: attrDesc;

        switch (attr) {
            case "element":
                if((this.attr[attr] === undefined && attrDesc !== undefined) ||
                   (this.attr[attr] !== undefined && attrDesc === undefined)) {
                    recreateLabels = true;
                }
                this.attr[attr] = attrDesc;
                break;
            case "intersection":
                attrDesc0 = !!attrDesc0 &&
                  (getDeOSedValue(pointDesc.type) in PosPoint.definedEdgeTypes);
                /* falls through */
            case "label":
            case "type":
            case "content":
                if (this.attr[attr] !== attrDesc0) {
                    recreateLabels = true;
                    this.attr[attr] = attrDesc0;
                }
                break;
        }
    }
    
    var isContent = !!this.attr.content;

    if (recreateLabels) {
        this.destroyAllLabels();
        this.isZMTRegistered = isContent;
        if (this.attr.element === undefined) {
            this.addArea(this.baseAreaId);
        } else if (this.attr.element instanceof Array) {
            for (var i = 0; i !== this.attr.element.length; i++) {
                var elt = this.attr.element[i];
                if (elt instanceof ElementReference) {
                    this.addArea(elt.getElement());
                }
            }
        } else if (this.attr.element instanceof ElementReference) {
            this.addArea(this.attr.element.getElement());
        }
    } else {
        if (isContent != this.isZMTRegistered) {
            this.allAreasRegisterZeroModeToggle(isContent);
            this.isZMTRegistered = isContent;
        }
        var nAreas = {};
        if (this.attr.element === undefined) {
            nAreas[this.baseAreaId] = true;
        } else if (this.attr.element instanceof Array) {
            for (var i = 0; i !== this.attr.element.length; i++) {
                var elt = this.attr.element[i];
                if (elt instanceof ElementReference) {
                    nAreas[elt.getElement()] = true;
                }
            }
        } else if (this.attr.element instanceof ElementReference) {
            nAreas[this.attr.element.getElement()] = true;
        }
        this.updateAreas(nAreas);
    }

    this.posPoint.callHandlers();
}

SuffixPosPoint.prototype.destroyAllLabels = suffixPosPointDestroyAllLabels;
function suffixPosPointDestroyAllLabels()
{
    for (var areaId in this.label) {
        this.removeAreaLabel(areaId);
    }
    this.areas = {};
}

SuffixPosPoint.prototype.labelPrefixStr = "";

// Create a label given an area id and add it to the posPoint.
// A label is created by providing 'labelBySuffix' with the areaId and
// a suffix.
// If this is a 'label' posPoint ('isLabel'), the suffix is the label from the
//  description.
// For 'type' posPoints, the suffix is determined by getSuffixFunc.
//  Center points and intersection points also need to register a request
//  with the areaId's area, to create the automatic constraints which
//  define the position of these points.

SuffixPosPoint.prototype.createAreaLabel = suffixPosPointCreateAreaLabel;
function suffixPosPointCreateAreaLabel(areaId)
{
    var label;
    var suffix;
    var type;
    var isContent;
    var isIntersection;
    var autoConstraintId;
    var area;

    // calculate the suffix for this point label
    if (this.isLabel) {
        if(this.attr.label === undefined)
            return; // could not determine the suffix for this point label 
        suffix = this.labelPrefixStr + this.attr.label;
    } else {
        type = this.attr.type;
        isContent = this.attr.content;
        isIntersection = this.attr.intersection;
        suffix = this.getSuffixFunc(type, isContent, isIntersection);
    }

    if(suffix === undefined)
        return; // could not determine the suffix for this point label
    
    // create the point label
    label = labelBySuffix(areaId, suffix);
    this.label[areaId] = label;
    this.posPoint.addLabel(label);

    // add automatic constraints (if needed)
    
    if((type == "horizontal-center") || (type == "vertical-center")) {
        // center point automatic constraints
        area = allAreaMonitor.getAreaById(areaId);
        if (area)
            autoConstraintId = area.allPosConstraints.
                addCenterPointConstraints(label, type, isContent);
    } else if(isIntersection) {
        // intersection point automatic constraints
        area = allAreaMonitor.getAreaById(areaId);
        if (area)
            autoConstraintId = area.allPosConstraints.
                addIntersectionPointConstraints(label, type, isContent);
    }

    // if automatic constraints were requested, store the ID of this request
    if(autoConstraintId) {
        if(!this.autoConstraintIds)
            this.autoConstraintIds = {};
        this.autoConstraintIds[areaId] = autoConstraintId;
    }

    // register with zero-offset-mode
    if (this.isZMTRegistered) {
        this.registerZeroModeToggle(areaId);
    }
}

SuffixPosPoint.prototype.updateAreas = suffixPosPointUpdateAreas;
function suffixPosPointUpdateAreas(nAreas) {
    for (var areaId in this.areas) {
        if (!(areaId in nAreas)) {
            this.removeArea(areaId);
        }
    }
    for (var areaId in nAreas) {
        if (!(areaId in this.areas)) {
            this.addArea(areaId);
        }
    }
}

// Creates an area label, maintaining the ref count for the area id
SuffixPosPoint.prototype.addArea = suffixPosPointAddArea;
function suffixPosPointAddArea(aid) {
    if (aid in this.areas) {
        this.areas[aid]++;
    } else {
        this.createAreaLabel(aid);
        this.areas[aid] = 1;
    }
}

// Removes area label when ref count becomes 0
SuffixPosPoint.prototype.removeArea = suffixPosPointRemoveArea;
function suffixPosPointRemoveArea(aid) {
    assert(aid in this.areas && this.areas[aid] >= 0, "area count");
    this.areas[aid]--;
    if (this.areas[aid] === 0) {
        this.removeAreaLabel(aid);
        delete this.areas[aid];
    }
}

// Remove the label of 'areaId' from the posPoint.
// If this areaId also has a center-point registration, tell the areaId's area
//  that this posPoint no longer uses it.
SuffixPosPoint.prototype.removeAreaLabel = suffixPosPointRemoveAreaLabel;
function suffixPosPointRemoveAreaLabel(areaId)
{
    var label = this.label[areaId];
    if (label)
        this.posPoint.removeLabel(label);

    if (this.autoConstraintIds) {
        var autoConstraintId = this.autoConstraintIds[areaId];

        if (typeof(autoConstraintId) != "undefined") {
            var area = allAreaMonitor.getAreaById(areaId);
            if (area) {
                area.allPosConstraints.
                    removeAutomaticPointConstraints(autoConstraintId);
            }
            delete this.autoConstraintIds[areaId];
        }
    }

    delete this.label[areaId];

    // unregister with zero-offset-mode
    if (this.isZMTRegistered) {
        this.unregisterZeroModeToggle(areaId);
    }
}

SuffixPosPoint.prototype.getSuffixFunc = suffixPosPointGetSuffixFunc;
function suffixPosPointGetSuffixFunc(type, isContent, isIntersection)
{
    // 'isIntersection' applies only to the first four types, which are
    // the 'edge types'.
    switch(type) {
      case "left":
      case "right":
      case "top":
      case "bottom":
          return getEdgeSuffixFunction(type, isContent, isIntersection);
      case "horizontal-center":
        return getCenterSuffixFunction(false, isContent);
      case "vertical-center":
        return getCenterSuffixFunction(true, isContent);
      case undefined:
        return undefined;
      default:
        // If you get here with type = {}, perhaps the type label is not
        // supported by the configDescription.
        mondriaInternalError("unsupported point type: ", type);
        return undefined;
    }
}

// --------------------------------------------------------------------------
// zeroOffsetToggle
// 
// this callback is called by an area's contentPosManager when it toggles its
//  zero-offset-mode
//
SuffixPosPoint.prototype.zeroOffsetToggle = suffixPosPointZeroOffsetToggle;
function suffixPosPointZeroOffsetToggle(aid, izInZeroOffset)
{
    assert(aid in this.label);
    this.removeAreaLabel(aid);
    this.createAreaLabel(aid);
    this.posPoint.applyChanges();
}

SuffixPosPoint.prototype.allAreasRegisterZeroModeToggle =
      suffixPosPointAllAreasRegisterZeroModeToggle;
function suffixPosPointAllAreasRegisterZeroModeToggle(register) {
    for (var areaId in this.areas) {
        if (register) {
            this.registerZeroModeToggle(areaId);
        } else {
            this.unregisterZeroModeToggle(areaId);
        }
    }
}

var suffixPosPointNextUid = 1;

// --------------------------------------------------------------------------
// registerZeroModeToggle
//
SuffixPosPoint.prototype.registerZeroModeToggle =
    suffixPosPointRegisterZeroModeToggle;
function suffixPosPointRegisterZeroModeToggle(areaId)
{
    var area = allAreaMonitor.getAreaById(areaId);

    if (! this.isZMTRegistered)
        return;

    if (typeof(this.uid) === "undefined") {
        this.uid = ++suffixPosPointNextUid;
    }

    if (area) {
        var cpm = area.contentPosManager;
        cpm.registerZeroOffsetModeToggle("suffixPosPoint", this.uid, this);
    }
}

// --------------------------------------------------------------------------
// unregisterZeroModeToggle
//
SuffixPosPoint.prototype.unregisterZeroModeToggle =
    suffixPosPointUnregisterZeroModeToggle;
function suffixPosPointUnregisterZeroModeToggle(areaId)
{
    var area = allAreaMonitor.getAreaById(areaId);

    if (area) {
        var cpm = area.contentPosManager;
        cpm.unregisterZeroOffsetModeToggle("suffixPosPoint", this.uid);
    }
}
