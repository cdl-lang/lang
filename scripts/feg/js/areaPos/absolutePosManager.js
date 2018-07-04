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


// This file implements the conversion from the pair offsets as calculated
// by the positioning calculation module to the actual absolute values
// actually needed for the positioning of the areas on the screen.
// The term absolute positioning refers to:
// 1. The width and height of the frame and content of an area.
// 2. The offset of an area's frame left and top edges relative to the left
//    and top edges of the frame of the area's embedding area.
// 3. The offset of an area's content left and top edges relative to
//    the left and top edges of the frame of that same area.
//
// In practice, three sets of positioning values are maintained. This is
// due to the way HTML positions elements (DIVs) when these have a border.
// The content position as calculated by the positioning system is the
// position of the inner side of the border. In HTML, however,
// the 'width' and 'height' CSS properties refer to the inner size of
// the element (inside the border) but the left and top offsets are
// the offsets of the external (outside the border) top left corner.
// Therefore, we store two sets of content positioning values:
// 1. contentPos: this is the position as calculated by the positioning
//    system and refers to the inner part of the DIV (inside the borders).
//    The embeddingDiv (in which embedded areas are embedded) is positioned
//    using these offsets, as it has no border.
// 2. displayDivPos: this is the position for the displayDiv, which
//    actually performs the display for the area. This position is based
//    on contentPos, but when there is a border, the left and top offsets
//    area corrected to take account of this border (the border offset
//    is subtracted from the left/top offset in contentPos to get the
//    offset of the external top left corner.

// The AbsolutePosManager object manages the actual positioning of all areas.
// When an area is created, it registers itself with the global
// AbsolutePosManager. The AbsolutePosManager then registers (to the
// positioning calculation mechanism) a watched pair corresponding to each
// of the absolute offsets mentioned above. It then tracks changes to this
// pair and when the pair changes, it repositions the corresponding area.
//
// Rounding
// --------
//
// The positioning values as calculated by the positioning system are not
// necessarily integers. The actual positioning on the screen, however,
// is in integer pixel numbers. Therefore, we need to round the values
// returned from the positioning system.
//
// It is important to realize that rounding inside the positioning system
// is not desireable. For example, assume we have a window of width 100 and
// we want to partition it into six equal width columns. The width calculated
// by the positioning system for each column would then be 16.666... Rounding
// this to 16 (inside the positioning system) will not do, as this will result
// in 4 missing pixels for the total width of the columns, which will appear
// as spaces between the columns or as extra space between the columns
// and the edge of the window. What we actually want is to have two
// columns of 16 pixels and four columns of 17 pixels. This will not
// be noticed as long as the columns are positioned next to each other.
//
// For exactly the same reason, simply rounding the values returned by
// the positioning system before setting them on the HTML objects will
// not result in good positioning. There exist additional complications.
// For example, say we have two columns, A and B, which we want to be separated
// by 2 pixels (that is, B_l - A_r = 2). Say that the offsets calculated
// for the columns are as follows (C is the embedding area of A and B):
// A_l - C_l = 10.333333
// A_r - A_l = 13.333333
// B_l - C_l = 25.666666
// The point A_r is positioned at offset 23.33333 from C_l, which is
// is at an offset of 2 from B_l (as required). However, rounding these
// offsets will result in the following positioning (realtive to C_l):
// A_l: at offset 10 ( = round(10.3333))
// A_r: at offset 23 ( = round(10.3333) + round(13.3333))
// B_l: at offset 26 ( = round(25.6666))
// which results in an offset of 3 pixels between column A and B. Moreover,
// this offset between the columns is not stable: if A_l - C_l now becomes
// 10 then A_r will still be at rounded offset 23, but B_l will move to
// offset 25.
//
// The solution is to round the absolute position (relative to the screen area)
// of each edge point (left/right/top/bottom) rather than rounding the
// offsets. This is as if we position each edge of each area at its
// non-integer position (as calculated by the positioning system) and than
// display it at the nearest pixel. Specifically:
// 1. Two points aligned with each other in the non-integer positioning will
//    be rounded to the same pixel position.
// 2. Two points with an integer offset between them in the non-integer
//    positioning will preserve the same integer offset after rounding.
//    Specifically, this means that wherever a constraint specifies an
//    exact integer offset, this offset will be preserved.
// In the example given above, A_r would be positioning at
// 24 ( = round(10.33333 + 13.33333)) and B_l at 26 ( = round(25.66666)).
//
// To implement this, we store on each area its left and top positioning error,
// that is, the difference between its left/top non-integer positioning and the
// actual left/top integer position (this error is between -0.5 and less
// than 0.5). When caluclating the width or length of an area, we add the
// (non-integer) offset calculated by the positioning mechanism for the
// width/height to the positioning error of the left/top of the same area
// and then round off the value. The value before rounding is the offset
// between the actual (integer) positioning of the left/top edge of the area
// and the exact (non-integer) positioning of the right/bottom edge. Rounding
// this value results in the offset from the actual left/top to the
// integer position closest to the exact (non-integer) right/bottom.
// A similar calculation applies to the left/top of embedded areas and to
// content positioning.
//
// When the error for an area changes, this may influence the positioning
// of all embedded areas, as well as its width/height. The system must then
// propagate the error change to all embedded areas. While this seems
// an expensive operation, it is probably less common than one would expect,
// because most operations (such as dragging an area with the mouse) would
// leave its positioning error practically unchanged (because the mouse
// moves in integer steps).

// To implement rounding, we store the positioning errors inside the
// this.relative and this.contentPos fields of each area. In addition,
// to simplify refresh, we store the original ('exact') offsets as received
// from the positioning system. The this.relative and this.contentPos
// fields of an Area therefore have the following format:
//
// {
//    // pixel offsets (integer offsets written to the HTML elements)
//    left: <integer>,
//    width: <integer>,
//    top: <integer>,
//    height: <integer>,
//    embedding: <embedding area>
//    exact: { // the exact offsets as calculated by the positioning system
//       left: <real number>,
//       width: <real number>,
//       top: <real number>,
//       height: <real number>
//    }
//    error: { // the left/top error of this error
//       left: <exact (non-integer) position - actual (integer) position>
//       top: <exact (non-integer) position - actual (integer) position>
//    }
// }
//
// For left/top it holds that:
//
// left = exact_left + embedding_error_left - error_left
// top = exact_top + embedding_error_top - error_top
//
// where embedding_error_* is the error as stored on the embedding position
// object (for content position this is the frame position of the same area and
// for frame position this is the content position of the embedding area).
//
// For width/height it holds that:
//
// width = round(exact_width + error_left)
// height = round(exact_height + error_top)
//
// Small Error Rounding
// --------------------
//
// The above discussion handles 'pixel rounding', that is, situations where
// the solution of the positioning constraints results in offsets which
// are not whole pixels. The non-integer offsets provided by the positioning
// system are the correct solution to the constraints, but have to be
// rounded to an integer value because of the pixel resoultion.
//
// There is, however, another need for rounding. This is due to inaccuracies
// in the arithmetic operations carried out inside the positioning system.
// An offset which should have been 33 could be reported as 32.99999999.
// Such inaccuracies can result in incorrect rounding being carried out
// by pixel rounding. Consider, for example where the top error of an
// area is -0.5, its content height (before any rounding) is 32 and
// its frame height (before rounding) is 32.9999999999. In this case,
// 32 is rounded to 32 (32 - 0.5 = 31.5 which is rounded to 32) but
// 32.9999999 is also rounded to 32 (32.9999999 - 0.5 = 32.4999999 which is
// also rounded to 32). So while the original offsets required a difference
// of 0.99999999 between the height of the frame and the content (allowing
// for a border to be drawn) after rounding, this difference becomes zero.
//
// These inaccuracies must, therefore, be rounded first. The rounding
// is simply rounding to several (binary) digits after the point.
// This can be performed at a fix number of digits after the point because
// all offsets received by the absolute position manager are offsets
// which are visible on the screen and therefore have a known range
// (0 - a few thousands at most). Neither very large nor very small
// numbers are possible here.
//
// The only place where an error can accumulate here is when going
// down the embedding chain (since the error is inherited from the
// embedding area). Therefore, rounding to about 10 binary digits
// after the point should be sufficient (the actual errors are usually
// much much smaller and, as the depth of embedding chains is in the
// order of magnitude of dozens and we eventually need an accuracy of
// whole numbers, the accumulated error due to this rounding is small).
//
// Structure of the AbsolutePosManager Object
// ------------------------------------------
//
// The AbsolutePosManager object holds one main table, which converts from
// point pairs (as registered to the positioning calculation mechanism)
// to area + absolute pos type (frame/content + left/top/width/height).
// Each time a pair is signalled as changed, this table allows the
// corresponding area to be repositioned. This table also registers
// the direction of the pair relative to its canonical order (as defined
// by the positioning calculation mechanism). For example,
// if AbsolutePosManager registered the pair A;B but the canonical order
// is B;A, this pair will be registered as being in the inverse direction
// (dir is -1 in the structure described below). This needs to be used when
// converting the offsets given by the positioning calculation system
// (which always gives the offsets in the canonical order).
//
// The absolute position manager also maintains a list ('this.newOffsets')
// of the offsets that were added (by a new area or a area whose embedding has
//  changed) and which were not yet repositioned on the screen. Offsets that
//  are undefined at that time are ignored. These offsets are not repositioned
//  immediately, but only after all positioning calculations terminated (at
//  that point, the function refreshPos should be called). If an offset in
//  'this.newOffsets' also appears in the list of changes from the positioning,
//  the older offset in newOffsets is ignored.
// 
// The method 'refreshPos' first processes the pairs from these two sources,
//  and updates the offset stores on the affected areas (in Area.relative,
//  Area.contentPos and Area.displayDivPos). In some cases a recursive
//  traversal of embedded areas is required. During this processing, a working
//  list of all the areas changed is kept in 'this.changedAreas'.
// Then 'refreshPos' iterates the areas in this.changedAreas, and updates the
//  display elements with current offsets as already stored in the areas.
//
//
// The structure of the AbsolutePosManager object is, therefore, as follows:
//
// {
//   pairToOffset: {
//      <pair ID>: {
//         dir: -1/+1,
//         area: <area ID>,
//         offset: <left|top|width|height>,
//         isContent: <true|false>  // is this for the frame or the content
//      }
//      ....
//   },
//   newOffsets: {
//      <pair ID>: <offset at the time that pair was registered, if defined>
//   },
//   changedAreas: {// empty except during 'refreshPos'
//       <area ID>: <area>
//       ....
//   }
// }
// 

// global absolute position manager

var globalAbsolutePosManager;

// initialization function for the global absolute position manager
// adds callbacks from the global area monitor for changes to areas

function initAbsolutePosManager()
{
    globalAbsolutePosManager = new AbsolutePosManager();
}

// Constructor

function AbsolutePosManager()
{
    this.pairToOffset = {};
    this.newOffsets = {};
    this.changedAreas = {};
}

// This function creates an empty object describing the frame/content
// position (as described in the comment at the top of the file) 

AbsolutePosManager.makeEmptyPosObject = absolutePosManagerMakeEmptyPosObject;

function absolutePosManagerMakeEmptyPosObject()
{
    return { left: 0, width: 0, top: 0, height: 0,
            exact: { left: 0, width: 0, top: 0, height: 0 },
            error: { left: 0, top: 0 } };
}

///////////////////////////////////////////////////
// Area Registration / De-Registration Functions //
///////////////////////////////////////////////////

// This function registers a new area to the AbsolutePosManager. It adds all
// the needed watched pairs and registers them to the 'pairToOffset' table.
// This function should be given both the area and the embedding area.
// The embedding area may be 'undefined'.

AbsolutePosManager.prototype.addArea = absolutePosManagerAddArea;

function absolutePosManagerAddArea(area, embedding)
{
    // frame offsets
    assert(area instanceof DisplayArea, "only DisplayArea allowed");
    if(embedding != undefined) {
        assert(embedding instanceof DisplayArea, "only DisplayArea allowed");
        this.addOffset(leftLabel(embedding, true), leftLabel(area, false),
                       area.areaId, "left", false);
        this.addOffset(topLabel(embedding, true), topLabel(area, false),
                       area.areaId, "top", false);
    }
    this.addOffset(leftLabel(area, false), rightLabel(area, false),
                   area.areaId, "width", false);
    this.addOffset(topLabel(area, false), bottomLabel(area, false),
                   area.areaId, "height", false);
    
    // content offsets
    if(!area.isInZeroContentOffsetMode())
        this.addAreaContentOffsets(area);
}

// This function adds the offsets which define the position and size of
// the content of an area. This is called only when the area's content
// is not fixed at offset zero to the frame. This function can be called
// from the 'addArea' (as part of adding a new area) or independently
// when the content position of an existing area changes mode to a non-zero
// offset mode. In this case, this function needs to be called after the
// 'isInZeroContentOffsetMode' property of the area has actually been
// changed (otherwise, the labels generated by the functions below will
// not be the ones needed by the new setting).

AbsolutePosManager.prototype.addAreaContentOffsets =
    absolutePosManagerAddAreaContentOffsets;

function absolutePosManagerAddAreaContentOffsets(area)
{
    assert(area instanceof DisplayArea, "only DisplayArea allowed");
    this.addOffset(leftLabel(area, false), leftLabel(area, true),
                   area.areaId, "left", true);
    this.addOffset(topLabel(area, false), topLabel(area, true),
                   area.areaId, "top", true);
    this.addOffset(leftLabel(area, true), rightLabel(area, true),
                   area.areaId, "width", true);
    this.addOffset(topLabel(area, true), bottomLabel(area, true),
                   area.areaId, "height", true);

    // construct the content position objects of the area
    
    // the position of the content = position of the embeddingDiv
    area.contentPos = AbsolutePosManager.makeEmptyPosObject();
    area.contentPos.embedding = area;
    // When there is a border, the position of the display DIV may differ
    // from the content position
    area.displayDivPos = {};
    area.displayDivPos.embedding = area;
}

// This function removes all watched pairs registered for the given area
// and removes them also from the 'pairToOffset' table. This function should
// be called when an area is destroyed. If an area is merely removed from
// the display (by embedding it in an 'undefined' area) the function
// 'newEmbedding' (below) should be called.
// The 'embedding' area should be the last one given to the AbsolutePosManager
// for this area (either through the 'addArea' function or the
// 'newEmbedding' function).

AbsolutePosManager.prototype.removeArea = absolutePosManagerRemoveArea;

function absolutePosManagerRemoveArea(area, embedding)
{
    assert(area instanceof DisplayArea, "only DisplayArea allowed");
    assert(embedding instanceof DisplayArea, "only DisplayArea allowed");
    // frame offsets
    if(embedding != undefined) {
        this.removeOffset(leftLabel(embedding, true), leftLabel(area, false));
        this.removeOffset(topLabel(embedding, true), topLabel(area, false));
    }

    this.removeOffset(leftLabel(area, false), rightLabel(area, false));
    this.removeOffset(topLabel(area, false), bottomLabel(area, false));
    
    // content offsets
    if(!area.isInZeroContentOffsetMode())
        this.removeAreaContentOffsets(area);
}

// This the offsets which define the position and size of
// the content of an area. This is called only when the area's content
// can be positioned at a non-zero offset from the frame.  This function
// can be called from the 'removeArea' (as part of removing an area) or
// independently when the content position of an existing area becomes fixed
// at zero offset. In this case, this function needs to be called before the
// 'isInZeroContentOffsetMode' property of the area is actually changed
// (otherwise, the labels generated by the functions below will no longer
// be the ones which need to be removed).

AbsolutePosManager.prototype.removeAreaContentOffsets =
    absolutePosManagerRemoveAreaContentOffsets;

function absolutePosManagerRemoveAreaContentOffsets(area)
{
    assert(area instanceof DisplayArea, "only DisplayArea allowed");
    this.removeOffset(leftLabel(area, false), leftLabel(area, true));
    this.removeOffset(topLabel(area, false), topLabel(area, true));
    this.removeOffset(leftLabel(area, true), rightLabel(area, true));
    this.removeOffset(topLabel(area, true), bottomLabel(area, true));

    // remove the content position objects of the area
    delete area.contentPos;
    delete area.displayDivPos;

    // so that the displayDiv and contentDiv would be repositioned according
    //  to the frame position
    this.changedAreas[area.areaId] = area;
}

// This function is called when the embedding of an area changes.
// Given the area object, the previous embedding (possibly undefined)
// and the new embedding (possibly undefined) this function de-registers
// and registers watched pairs (to the positioning calculation system)
// and updates the 'pairToOffset' table.
// This function does not add or remove offsets which are internal to
// the area, such as the width and height (both frame and content) and
// the offsets between the content and the frame. Therefore, the only
// offsets it handles are the top and left offsets of the frame.

AbsolutePosManager.prototype.newEmbedding =
    absolutePosManagerNewEmbedding;

function absolutePosManagerNewEmbedding(area, prevEmbedding, newEmbedding)
{
    assert(area instanceof DisplayArea, "only DisplayArea allowed");
    if(prevEmbedding != undefined) {
        assert(prevEmbedding instanceof DisplayArea, "only DisplayArea allowed");
        this.removeOffset(leftLabel(prevEmbedding, true),
                          leftLabel(area, false));
        this.removeOffset(topLabel(prevEmbedding, true),
                          topLabel(area, false));
    }

    if(newEmbedding != undefined) {
        assert(newEmbedding instanceof DisplayArea, "only DisplayArea allowed");
        this.addOffset(leftLabel(newEmbedding, true),
                       leftLabel(area, false), area.areaId, "left", false);
        this.addOffset(topLabel(newEmbedding, true),
                       topLabel(area, false), area.areaId, "top", false);
    }
}

// This function adds the given pair of points for the area with the given
// area ID and the offset of type 'offset' (which may take the values
// left/top/width/height) and which is a content offset iff 'isContent' is set.
// The function both creates the watched pair (and registers it to the
// positioning calculation module) and adds it to the 'pairToOffset' table.

AbsolutePosManager.prototype.addOffset = absolutePosManagerAddOffset;

function absolutePosManagerAddOffset(point1, point2, areaId, offset, isContent)
{
    var pair = globalPos.addWatchedCalcPair(point1, point2, this, undefined);

    var pairId = pair.id;

    if (pairId in this.pairToOffset) {
        mondriaInternalError("already have a registered pair for offset <",
                             point1, ";", point2, ">");
        return;
    }

    var curValue = globalPos.getOffsetByPairEntry(pair);
    if (typeof(curValue) == "number") {
        this.newOffsets[pairId] = curValue;
    }

    var entry = this.pairToOffset[pairId] = {};

    entry.dir = pair.dir;
    entry.area = areaId;
    entry.offset = offset;
    entry.isContent = isContent;
}

// This function removes the given pair of points for the area with the given
// area ID and the offset of type 'offset' (which may take the values
// left/top/width/height).
// The function both removes the watched pair (from the positioning
// calculation module) and removes it from the 'pairTooffset' table.

AbsolutePosManager.prototype.removeOffset = absolutePosManagerRemoveOffset;

function absolutePosManagerRemoveOffset(point1, point2)
{
    var pair = globalPos.getPair(point1, point2);

    if(!pair)
        return; // pair was already removed
    
    delete this.pairToOffset[pair.id];
    delete this.newOffsets[pair.id];

    globalPos.removeWatchedCalcPair(point1, point2, this, null);
}

///////////////////////////////
// Absolute Position Refresh //
///////////////////////////////

// This function updates the position of areas as a result of changes in
// positioning as calculated by the positioning calculation module, or as a
// result of embedding changes.

AbsolutePosManager.prototype.refreshPos = absolutePosManagerRefreshPos;

function absolutePosManagerRefreshPos()
{
    var changedPairs = globalPos.getChangedPairs();

    // skip offsets that have more up-to-date values in changedPairs
    for (var pairId in this.newOffsets) {
        if (pairId in changedPairs)
            delete this.newOffsets[pairId];
    }

    // set offsets from new-born areas / re-embedded areas
    this.updatePairOffset(this.newOffsets);

    this.newOffsets = {};

    // set offsets from position changes
    this.updatePairOffset(changedPairs);

    // update the display elements
    for(var a in this.changedAreas) {

        // area might have been removed since it was added
        if (!allAreaMonitor.exists(a))
            continue;
        
        var area = this.changedAreas[a];
        
        area.updatePos(); // sets pos and calls embedAreaFrameElementAtPos()
                          // when area.updateVisuals() is called.

    }

    // clear the list
    this.changedAreas = {};
}

// The function goes over all pairs in the 'pairs', and for those which appear
// in the pairToOffset table, it updates the corresponding parameter of the
// relevant area.

// Remark: see remark at the beginning of the file concerning rounding.
AbsolutePosManager.prototype.updatePairOffset =
    absolutePosManagerUpdatePairOffset;
function absolutePosManagerUpdatePairOffset(pairs)
{
    for(var pairId in pairs) {
        
        var entry = this.pairToOffset[pairId];

        if(!entry)
            continue; // pair does not represent an absolute offset

        var area = allAreaMonitor.getAreaById(entry.area);
        // round the exact offset to 10 binary digits after the point
        // (see the introduction for an explanation)
        var exactOffset = Math.round(1024 * (entry.dir * pairs[pairId])) / 1024;
        
        switch(entry.offset) {
          case "left": case "top":
            this.updateCornerOffset(area, entry.isContent, entry.offset,
                                    exactOffset);
            break;
          case "width": case "height":
            this.updateSizeOffset(area, entry.isContent, entry.offset,
                                  exactOffset);
            break;
          default: // y0, y1, x0, x1
            // Pass value of offset on to the display. Rounding needed?
            if (area.linePos === undefined) {
                area.linePos = {};
            }
            area.linePos[entry.offset] = exactOffset;
            break;
        }

        if(entry.isContent) {
            // see the beginning of the file for an explanation of the
            // difference between contentPos and displayDivPos.
            area.displayDivPos[entry.offset] = area.contentPos[entry.offset];
            if(entry.offset == "left" || entry.offset == "top") {
                area.displayDivPos[entry.offset] -=
                    area.contentPosManager.getOffset(entry.offset);
            }
        }
        this.changedAreas[area.areaId] = area;

    }
}

// This function updates the integer corner (left/top/y0) offsets of the given
// area. The 'edge' argument is, therefore, either "left", or "top".
// If 'isContent' is set, the content position is updated and otherwise
// the frame position is updated. If 'exactOffset' is not undefined,
// this offset is used as the offset calculated by the positioning system
// which should serve as the basis for the calculation. If 'exactOffset'
// is undefined, the exact offset as already stored on the position object
// should be used. This mode is used when we want to refresh the integer
// offset as a result as an offset error change.
// If the error changes, the width/height and embedded element positioning
// are recalculated.
// For the details of this calculation, see comment at the beginning of
// the file.

AbsolutePosManager.prototype.updateCornerOffset =
    absolutePosManagerUpdateCornerOffset;

function absolutePosManagerUpdateCornerOffset(area, isContent, edge,
                                              exactOffset)
{
    // get the relevant position objects

    // positioning object for this offset
    var posObj = isContent ? area.contentPos : area.relative;
    
    // positioning object relative to which this position is defined.
    // For content positioning this is the relative (frame) position of
    // the same area, for frame positioning, the content positioning of
    // the embedding area.
    var embeddingPos;
    if(isContent)
        embeddingPos = area.relative;
    else if(area.relative.embedding) {
        if(area.relative.embedding.contentPos)
            embeddingPos = area.relative.embedding.contentPos;
        else
            // areas where the content is at offset zero from the frame
            // may omit the contentPos and then we can use the frame position.
            embeddingPos = area.relative.embedding.relative;
    }

    if(exactOffset == undefined)
        exactOffset = posObj.exact[edge];
    else
        posObj.exact[edge] = exactOffset;

    // calculate the offset between the exact position of the left/top
    // point and the integer position of the embedding position.
    var offsetFromInteger = exactOffset +
        (embeddingPos ? embeddingPos.error[edge] : 0);

    // new integer offset
    var prevOffset = posObj[edge];
    posObj[edge] = Math.round(offsetFromInteger);

    if(prevOffset != posObj[edge]) {
        this.changedAreas[area.areaId] = area;
    }
    
    var prevError = posObj.error[edge];
    posObj.error[edge] = offsetFromInteger - posObj[edge];

    if(isContent) 
        // Update the display DIV position. See the beginning of the file
        // for the difference between contentPos and displayDivPos.
        area.displayDivPos[edge] = area.contentPos[edge] -
            area.contentPosManager.getOffset(edge);
    
    if(prevError != posObj.error[edge]) { // error changed
        // refresh the width/height of this element
        this.updateSizeOffset(area, isContent,
                              edge == "left" ? "width" : "height", undefined);
        // refresh positioning of embedded elements
        if(!isContent && area.contentPos) {
            // only if the content and frame pos may differ
            this.updateCornerOffset(area, true, edge, undefined);
        } else {
            var embeddedAreaList =
                  areaRelationMonitor.getRelation(area.areaId, "embedded");
            for (var i = 0; i < embeddedAreaList.length; i++) {
                var cur = embeddedAreaList[i];
                var embeddedArea = allAreaMonitor.getAreaById(cur.getElement());
                if (embeddedArea instanceof DisplayArea) {
                    this.updateCornerOffset(embeddedArea, false, edge,
                                            undefined);
                }
            }
        }
    }
}

// This function updates the integer size (width/height) offsets of the given
// area. The 'dim' argument is, therefore, either "width" or "height".
// If 'isContent' is set, the content position is updated and otherwise
// the frame position is updated. If 'exactOffset' is not undefined,
// this offset is used as the offset calculated by the positioning system
// which should serve as the basis for the calculation. If 'exactOffset'
// is undefined, the exact offset as already stored on the position object
// should be used. This mode is used when we want to refresh the integer
// offset as a result as an offset error change.
// For the details of this calculation, see comment at the beginning of
// the file.

AbsolutePosManager.prototype.updateSizeOffset =
    absolutePosManagerUpdateSizeOffset;

function absolutePosManagerUpdateSizeOffset(area, isContent, dim,
                                            exactOffset)
{
    // get the relevant position objects
    
    // positioning object for this offset
    var posObj = isContent ? area.contentPos : area.relative;

    if(exactOffset == undefined)
        exactOffset = posObj.exact[dim];
    else
        posObj.exact[dim] = exactOffset;

    // new integer offset
    var prevOffset = posObj[dim];
    posObj[dim] = Math.round(exactOffset +
                             posObj.error[dim == "width" ? "left" : "top"]);

    if(isContent) // Update the display DIV position.
        area.displayDivPos[dim] = area.contentPos[dim];
    
    if(prevOffset != posObj[dim])
        this.changedAreas[area.areaId] = area;
}

// This function is used to refresh the difference between contentPos and
// displayDivPos. It should be called by the ContentPosManager when
// either its left or its top offset changes. Usually, this
// is not really needed, as the content offset calculated by the positioning
// system will also change in this case (and trigger the usual update flow)
// but is the contentPosManager is in 'independent content position' mode
// then the content offset as calculated by the positioning system will
// remain unchanged, and a separate refresh is needed. Therefore, this
// function needs to be called when:
// 1. The ContentPosManager is in 'independent content position' mode
// 2. Either the left or the top offset maintained by the ContentPosManager
//    has changed.
// In the function below, 'edge' is either "left" or "top" and 'offset'
// is the new offset for that side, as calculated by the ContentPosManager.

AbsolutePosManager.prototype.refreshDisplayOffset =
    absolutePosManagerRefreshDisplayOffset;

function absolutePosManagerRefreshDisplayOffset(area, edge, offset)
{
    if(edge != "left" && edge != "top")
        return;
    
    area.displayDivPos[edge] = area.contentPos[edge] - offset;
    this.changedAreas[area.areaId] = area;
}
