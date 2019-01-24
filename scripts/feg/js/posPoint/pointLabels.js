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

//////////////////////////////////////
// Label and Label Suffix Functions //
//////////////////////////////////////

// The label assigned a point is 'area ID + suffix' where the area ID
// is the ID of the area for which the point is defined (there may also
// be point labels which are not based on an area ID, but these are
// not handled here, because they have a free format). The suffix is a function
// of the type of the point, but may also depend on the area for which the
// label is create (see below).


// 
// The following functions define the suffixes for different types of points.
// These functions are global.
// For each type of point there are two types of suffix functions:
// 1. A suffix function which takes an area object as input and supports
//    content points. Content points may or may not get the same label suffix
//    as the corresponding frame points, depending on the area for which
//    the point is defined. Therefore, these functions take the area object
//    as an argument (even though the area ID as such is not part of the
//    label suffix).
// 2. A suffix function which only supports frame labels. This suffix
//    function does not depend on the area and therefore does not need
//    the area as an argument.
// In practice, the second type of functions simply call the first type
// of functions with an undefined area. However, for any external call to
// the suffix functions, one should use the second version of the function
// if one does not wish (or cannot) provide an area object. 

// This function returns the suffix of the suffix - the part which is common
// to all sides (left/right/top/bottom/center) of an area. The properties
// encoded in this suffix are the 'content' property (whether this is
// a frame or content point) and the 'intersection' property (whether this
// is an intersection point).
// The coding of the content property depends on the area for which the point
// label is being created: areas where the frame and content positions are
// not fixed at zero offset from eahc other have different suffixes for frame
// and content points while areas which fix the content to the frame
// at offset 0, have the same suffix for frame
// and content points (effectively making them one point). For this reason,
// the function also takes an area object as input.
// The frame (isContent == false) point are the same whether the content
// and frame points are identical or not (in other words, if frame and content
// points are identical, the content is also assigned the frame label).
// Therefore, it is possible to call the function with an undefined
// area object if isContent == false. This, however, should only be done
// by functions defined in this sections (to make sure external modules do
// not make assumptions about the inner workings of the suffix functions).

function posPointLabelSuffixSuffix(area, isContent, isIntersection)
{
    return ((isContent && area && ( !area.isInZeroContentOffsetMode())) ?
            "c" : "f") + (isIntersection ? "i" : "");
}

// In all the following functions, 'isContent' should be set for the content
// position and unset for the frame position. 
// The functions take an area object as their first argument, because the
// suffix may differ for different areas (see explanation above).

function leftSuffix(area, isContent, isIntersection)
{
    return "l" + posPointLabelSuffixSuffix(area, isContent, isIntersection);
}

function leftFrameSuffix()
{
    return leftSuffix(undefined, false, false);
}

function rightSuffix(area, isContent, isIntersection)
{
    return "r" + posPointLabelSuffixSuffix(area, isContent, isIntersection);
}

function rightFrameSuffix()
{
    return rightSuffix(undefined, false, false);
}

function topSuffix(area, isContent, isIntersection)
{
    return "t" + posPointLabelSuffixSuffix(area, isContent, isIntersection);
}

function topFrameSuffix()
{
    return topSuffix(undefined, false, false);
}

function bottomSuffix(area, isContent, isIntersection)
{
    return "b" + posPointLabelSuffixSuffix(area, isContent, isIntersection);
}

function bottomFrameSuffix()
{
    return bottomSuffix(undefined, false, false);
}

// 'center' points appear in two variants: horizontal and vertical.
// Center points can be defined both for the frame and for the content.
// Just as above, the label suffix may depend on the area, so the function
// takes the area for which this sufix is defined as input.

function centerSuffix(area, isVertical, isContent)
{
    return "c" + (isVertical ? "v" : "h") +
        posPointLabelSuffixSuffix(area, isContent, false);
}

function centerFrameSuffix(isVertical)
{
    return centerSuffix(undefined, isVertical, false);
}

// The following functions combine the output of the suffix functions above
// with the ID of the given area to create a point label.
// As in the suffix functions, there are two variants here:
// 1. Label function which take an area object and 'isContent' and
//    'isIntersection' flags as input. These can create content/intersection
//    points whose suffix depends on the area on which they are defined.
// 2. Label functions which take an area ID and no 'isContent' flag
//    as arguments. These functions can only create non-intersection frame
//    labels and therefore do not need to have access to the area object,
//    only to its ID (and the ID does not need to be an ID of an existing
//    area).

function leftLabel(area, isContent, isIntersection)
{
    return pointId(area.areaId + leftSuffix(area, isContent, isIntersection));
}

function leftFrameLabel(areaId)
{
    return pointId(areaId + leftFrameSuffix());
}

function rightLabel(area, isContent, isIntersection)
{
    return pointId(area.areaId + rightSuffix(area, isContent, isIntersection));
}

function rightFrameLabel(areaId)
{
    return pointId(areaId + rightFrameSuffix());
}

function topLabel(area, isContent, isIntersection)
{
    return pointId(area.areaId + topSuffix(area, isContent, isIntersection));
}

function topFrameLabel(areaId)
{
    return pointId(areaId + topFrameSuffix());
}

function bottomLabel(area, isContent, isIntersection)
{
    return pointId(area.areaId + bottomSuffix(area, isContent, isIntersection));
}

function bottomFrameLabel(areaId)
{
    return pointId(areaId + bottomFrameSuffix());
}

function centerLabel(area, isVertical, isContent)
{
    return pointId(area.areaId + centerSuffix(area, isVertical, isContent));
}

function centerFrameLabel(areaId, isVertical)
{
    return pointId(areaId + centerFrameSuffix(isVertical));
}

// Returns a label for a point of a line; it's simply the label
function linePointLabel(area, point)
{
    return pointId(area.areaId + point);
}

var posPointLabelFuncByEdge = {
    left: leftLabel,
    right: rightLabel,
    top: topLabel,
    bottom: bottomLabel
};

// This function calls one of the above label functions, based on the
// 'edge' specified.

function edgeLabel(area, edge, isContent)
{
    if (! (edge in posPointLabelFuncByEdge))
        return undefined;
    
    return posPointLabelFuncByEdge[edge](area, isContent);
}

var posPointFrameLabelFuncByEdge = {
    left: leftFrameLabel,
    right: rightFrameLabel,
    top: topFrameLabel,
    bottom: bottomFrameLabel
};

// This function is the same as edgeLabel except for two differences:
// 1. it can only be used to get the edge labels of the frame. This means
//    that the label suffix does not depend on the area itself. The labels
//    returned by this function are therefore guaranteed to be completely
//    static (even if the properties of the area change).
// 2. The function takes the area ID, not the area object as input (this
//    is essentially equivalent, under the assumption that the area still
//    exists). 

function edgeFrameLabel(areaId, edge)
{
    if (!(edge in posPointFrameLabelFuncByEdge))
        return undefined;
    
    return posPointFrameLabelFuncByEdge[edge](areaId);
}

// given an area ID and a suffix, this function constructs the corresponding
// point label. If the suffix is a string, it is used as is. The suffix
// may also be a function. In that case, that function takes the area
// with the given ID as an argument and returns a suffix string (this
// allows the suffix to depend on the area). 

function labelBySuffix(areaId, suffix)
{
    var suffixString; 
    
    if(typeof(suffix) == "function")
        suffixString = suffix(allAreaMonitor.getAreaById(areaId));
    else
        suffixString = suffix;
    
    return pointId(areaId + suffixString);
}

// The relativeVisibility edge 'edge' of area 'id' with respect to 'frameId'.
// The 'includeFrame' flag indicates whether the relative visibility is
// defined from 'outside' or 'inside' the frame (see
// 'relativeVisibilityPoint.js' for an explanation of this). 

function rvLabel(id, frameId, edge, includeFrame)
{
    return edgeFrameLabel(id + (includeFrame ? "rvi" : "rv") + frameId, edge);
}

//
// Suffix functions
//

// Given the edge (left/right/top/bottom) and the isContent and isIntersection
// flags, this function returns a suffix function which, given an area
// object, returns the suffix for that area for the specified type of point.
// The function being returned is cached so that two calls with identical
// parameters will also return exactly the same function object (this is
// important when we want to check whether the suffix function specified
// by a new description is equal to that of the previous description).

var edgePointSuffixFunctions = {};

function getEdgeSuffixFunction(edge, isContent, isIntersection)
{
    var key = edge + (!!isContent) + (!!isIntersection);

    if(!edgePointSuffixFunctions[key]) {
        switch(edge) {
            case "left":
                edgePointSuffixFunctions[key] =
                    function(area) { return leftSuffix(area, isContent,
                                                       isIntersection); };
                break;
            case "right":
                edgePointSuffixFunctions[key] =
                    function(area) { return rightSuffix(area, isContent,
                                                        isIntersection); };
                break;
            case "top":
                edgePointSuffixFunctions[key] =
                    function(area) { return topSuffix(area, isContent,
                                                      isIntersection); };
                break;
            case "bottom":
                edgePointSuffixFunctions[key] =
                    function(area) { return bottomSuffix(area, isContent,
                                                         isIntersection); };
                break;
            default:
                cdlInternalError("suffix function type not supported: ",
                                     edge);
                return undefined;
        }
    }

    return edgePointSuffixFunctions[key];
}

// Same as 'getEdgeSuffixFunction' (above) only for center points.

var centerPointSuffixFunctions = {};

function getCenterSuffixFunction(isVertical, isContent)
{
    var key = "" + (!!isVertical) + (!!isContent);

    if(!centerPointSuffixFunctions[key])
        centerPointSuffixFunctions[key] =
            function(area) { return centerSuffix(area, isVertical,
                                                 isContent); };

    return centerPointSuffixFunctions[key];
}

// global string -> numeric ID table (leaks!)

var nextPointLabelId = 1025;
var globalPointLabelIds = {};

function pointId(pointLabel)
{
    if(pointLabel in globalPointLabelIds)
        return globalPointLabelIds[pointLabel];
    return (globalPointLabelIds[pointLabel] = nextPointLabelId++);
    // return (globalPointLabelIds[pointLabel] = pointLabel);
}

var globalAuxPointIds = {}; // this table, too, leaks!

// Creates an 'auxiliary' point ID for a given point. Multiple auxiliary
// point IDs may be generated for the same point. There is, therefore,
// no need to store a mapping from the original point ID to the auxiliary
// point ID. However, we do store the inverse mapping, for debugging
// purposes.
// It is guaranteed that their ID is unique and will not be reused for
// any other point.

function auxPointId(pointId)
{
    var auxId = nextPointLabelId++;
    globalAuxPointIds[auxId] = pointId;
    return auxId;
}
