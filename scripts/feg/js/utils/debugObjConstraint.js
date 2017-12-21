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

var gPointNameMap = undefined;


function DebugObjConstraint()
{
    this.pointsArr = {};
    this.pointsOfAreaArr = {};
    this.allPairsCyclesMat = {};
    this.violations = {};

    this.violationMessageList = [];
    this.constraintIds = [];
    this.pointLabelById = [];
}

// --------------------------------------------------------------------------
// init
//
DebugObjConstraint.prototype.init = debugObjConstraintInit;
function debugObjConstraintInit()
{
    // find constraint-id -> area+constraint-name mapping
    this.mapConstraintIds();

    this.mapPointLabels();

    // Prepare the segments per area
    this.readAllLinearConstraints();
    this.readAllSegmentConstraints();
    this.fillInPointersToPoints();
    this.fillInPairsCycles();
    this.fillInViolations();
}

/*****************************************************************************/
DebugObjConstraint.prototype.mapConstraintIds = debugObjConstraintMapConstraintIds;
function debugObjConstraintMapConstraintIds() {
    for (var aid in allAreaMonitor.allAreas) {
        var aps = allAreaMonitor.allAreas[aid].allPosConstraints;
        if (! aps || ! aps.constraints)
            continue;
        for (var cname in aps.constraints) {
            var cobj = aps.constraints[cname];
            if (! cobj || ! cobj.constraint)
                continue;
            this.constraintIds[cobj.constraint.id] = {
                aid: aid,
                name: cname
            };
        }
    }
}

// --------------------------------------------------------------------------
// mapPointLabels
//
DebugObjConstraint.prototype.mapPointLabels = debugObjConstraintMapPointLabels;
function debugObjConstraintMapPointLabels()
{
    for (var label in globalPointLabelIds) {
        var id = globalPointLabelIds[label];
        this.pointLabelById[id] = label;
    }
}

/*****************************************************************************/

DebugObjConstraint.prototype.readAllLinearConstraints = debugObjConstraintReadAllLinearConstraints;
function debugObjConstraintReadAllLinearConstraints() {
    var constraintsById = globalPos.posCalc.linearConstraints.constraintById;
    var pairById = globalPos.posCalc.linearConstraints.pairById;
    var cyclesObj = globalPos.posCalc.linearConstraints.cycles;
    var i, j, areaID;

    for (var constraintID in constraintsById) {
        var shortId = getPointConstraintId(constraintID);
        var constraintSrc = this.constraintIds[shortId];
        // Get the involved area numbers
        
        var pairs = constraintsById[constraintID];
        if (!pairs || (pairs.length != 2)) {
            continue;
        }

        var points = [];
        for (var p in pairs) {
            var pair = pairs[p];
            var pairEntry = pairById[pair];
            if (! pairEntry)
                continue;
            for (var pointID in pairEntry.points) {
                points.push(pairEntry.points[pointID]);
            }
        }

        var edgeObj = cyclesObj.getEdge(pairs[0], pairs[1]);
        if (! edgeObj)
            continue;
        var props = (edgeObj.prop ? edgeObj.prop[0] : undefined);
        if (! props)
            continue;
        var priority = props.priority;
        var scalar = props.scalar;

        var involvedAreaIDArr = [];
        for (i = 0; i < points.length; i++) {
            areaID = this.getPointAreaID(points[i]);
            involvedAreaIDArr[i] = areaID;
        }

        // Add the cycles per pair
        this.addPairCycles(points[0], points[1]);
        this.addPairCycles(points[2], points[3]);

        // Generate the constraint Str
        var excludedStr = '';
        var violation = "";
        var constraintStr;
        var offset1 = globalPos.getPairOffset(points[0], points[1]);
        var offset2 = globalPos.getPairOffset(points[2], points[3]);
        var expectedOffset2 = offset1 * scalar;
        if (Math.round(expectedOffset2) != Math.round(offset2)) {
            violation = " ****OOOPS****";
        }
        var offset1Rounded = Math.round(offset1 * 100) / 100;
        var offset2Rounded = Math.round(offset2 * 100) / 100;

        // Add the constraint to the relevant areas
        for (i = 0; i < points.length; i++) {
            areaID = involvedAreaIDArr[i];
            if (!areaID) {
                continue;
            }
            var point = points[i];
            var pointEntry = this.getPointEntry(point, areaID);

            var pStr = [];  // A reacher string per point
            for (j = 0; j < points.length; j++) {
                pStr[j] = this.getFullName(points[j], involvedAreaIDArr[j], areaID);
            }

            constraintStr = "<" + pStr[0] + ", " + pStr[1] + ": " + offset1Rounded +
                    "> * " + scalar + " == <" +  pStr[2] + ", " + pStr[3] +
                    ": " + offset2Rounded + ">[ID=" + shortId + ";" +
                    (constraintSrc === undefined? "?":
                     constraintSrc.aid + ":" + constraintSrc.name) +
                    "; priority = " + priority + violation + excludedStr + "]";

            pointEntry[constraintStr] = {}; // Can be an overide
            for (j = 0; j < points.length; j++) {
                if (points[j] != point) {
                    pointEntry[constraintStr][points[j]] = '*';
                }
            }
        }
        if (violation.length > 0) {
            mMessage(constraintStr);
        }
    }
}

/*****************************************************************************/

DebugObjConstraint.prototype.readAllSegmentConstraints = debugObjConstraintReadAllSegmentConstraints;
function debugObjConstraintReadAllSegmentConstraints() {
  var id, i, j, areaID, pStr;
  var pairById = globalPos.posCalc.segmentConstraints.pairById;
  var orGroups = globalPos.posCalc.orGroups.orGroups;

  for (var pairId in pairById) {
      // Get the involved area numbers
      var points = pairById[pairId].points;
      if (points.length === 0) {
          continue;
      }
    
      var involvedAreaIDArr = [];
      for (i = 0; i < points.length; i++) {
          areaID = this.getPointAreaID(points[i]);
          involvedAreaIDArr[i] = areaID;
      }

      // Add the cycles per pair
      this.addPairCycles(points[0], points[1]);
      // get the actual offset for this pair of points
      var offset = globalPos.getPairOffset(points[0], points[1]);
      // rounded offset (for printing)
      var roundedOffset = Math.round(offset * 100) / 100;
      
      // Construct the suffix of the string, detailing the constraints defined
      // on this pair
      
      var constraintList = [];
      var violations = []; // sub-list of the above, of violated strings
      var forwardPairId = points[0] + ";" + points[1];
      var backwardPairId = points[1] + ";" + points[0];
      var violationObj = {};
      
      // loop over the different constraints defined for this pair of points
      for (id in pairById[pairId].ids) {
          
          // string representing a single constraint. Begins with the
          // constraint ID after removing the point pair string from the
          // constraint ID
          var shortId = parseInt(id); // id.replace(pairRegExp, "");
          if (isNaN(shortId)) shortId = id;
          var singleStr = "[ID=" + (gPointNameMap? "#": shortId) + ";";
          var constraintSrc = this.constraintIds[shortId];
          if (constraintSrc) {
              if (gPointNameMap !== undefined &&
                  constraintSrc.aid in gPointNameMap) {
                  singleStr += gPointNameMap[constraintSrc.aid] + ":" +
                        constraintSrc.name + ";";
              } else {
                  singleStr += constraintSrc.aid + ":" +
                        constraintSrc.name + ";";
              }
          }
          
          var violated = false; // is this constraint violated
          var softViolation = false;
          
          var entry = pairById[pairId].ids[id];

          // if this constraint belongs to or-groups and all or-groups
          // are satisfied, this should remain true, otherwise, false.
          var orGroupsSatisfied = true;
          
          if(entry.orGroups) {
              singleStr += " groups=";
              var first = true;
              for(var label in entry.orGroups.labels) {
                  if(!first)
                      singleStr += ",";
                  else
                      first = false;
                  singleStr += label;

                  // is the or-group satisfied?
                  if(!orGroups[label] || !orGroups[label].numSatisfied)
                      // no constraints satisfied for this or-group
                      orGroupsSatisfied = false;
              }
              if(first) {
                  orGroupsSatisfied = false; // no or-groups
                  singleStr += "<none>";
              }
              singleStr += ";";
          } else
              orGroupsSatisfied = false;
          
          if(entry.min !== undefined) {
              singleStr += " min=" + entry.min;
              if(!orGroupsSatisfied && entry.min != Infinity &&
                 entry.min > offset) {
                  if ((entry.min === 0) && (entry.preference == "min")) {
                      softViolation = true;
                  } else {
                      violated = true;
                  }
              }
          }
          
          if(entry.max !== undefined) {
              singleStr += " max=" + entry.max;
              if(!orGroupsSatisfied && entry.max != -Infinity &&
                 entry.max < offset) {
                  if ((entry.max === 0) && (entry.preference == "min")) {
                      softViolation = true;
                  } else {
                      violated = true;
                  }
              }
          }
          
          if(entry.stability)
              singleStr += " stability=true";
          
          if(entry.preference)
              singleStr += " preference=" + entry.preference;
          
          singleStr += " priority=" + entry.priority;
          
          if(violated)
              singleStr += " *violated*";
          
          singleStr += "]";
          constraintList.push(singleStr);
          if(violated)
              violations.push(singleStr);
          
          if(violated || softViolation) {
              this.addSegmentViolation(pairId, id);
          }
      }
      
      // Add the constraint to the relevant areas
      for (i = 0; i < points.length; i++) {
          areaID = involvedAreaIDArr[i];
          if (!areaID)
              continue;
          
          var point = points[i];
          var pointEntry = this.getPointEntry(point, areaID);
          
          pStr = [];  // A reacher string per point
          for (j = 0; j < points.length; j++) {
              pStr[j] = this.getFullName(points[j], involvedAreaIDArr[j], 
                                           areaID);
          }
          
          var constraintStr = 
              "<" + pStr[0] + ", " + pStr[1] + ": " + roundedOffset + ">" +
              constraintList.join(" ");
          
          pointEntry[constraintStr] = {}; // Can be an overide
          for (j = 0; j < points.length; j++) {
              if (points[j] != point) {
                  // Temporarily put a '*', soon to be replaced with pointer
                  pointEntry[constraintStr][points[j]] = '*';
              }
          }
      }
      
      if (violations.length > 0) {
          // construct the area independent variant of the constraint name
          pStr = [];
          for (j = 0; j < points.length; j++) {
              pStr[j] = this.getFullName(points[j], involvedAreaIDArr[j], 
                                           undefined);
          }
          var violationMessage = 
              "<" + pStr[0] + ", " + pStr[1] + ": " + roundedOffset + ">" +
              violations.join("");
          this.violationMessageList.push(violationMessage);
      }
  }
}

/*****************************************************************************/

// Some of the points were not available at the time, so we inserted a '*' to
//  signify their existance. Now replace the '*' with a pointer to the actual point.
DebugObjConstraint.prototype.fillInPointersToPoints = debugObjConstraintFillInPointersToPoints;
function debugObjConstraintFillInPointersToPoints() {
    for (var point in this.pointsArr) {
        var pointEntry = this.pointsArr[point];
        for (var constraint in pointEntry) {
            for (var otherPoint in pointEntry[constraint]) {
                pointEntry[constraint][otherPoint] = this.getPointEntry(otherPoint);
            }
        }
    }
}

/*****************************************************************************/

// Per pair, add its points' cycles
DebugObjConstraint.prototype.fillInPairsCycles = debugObjConstraintFillInPairsCycles;
function debugObjConstraintFillInPairsCycles() {
    // Scan the previously collected pairs cycles in this.allPairsCyclesMat[p1][p2]
    for (var p0 in this.allPairsCyclesMat) {
        var p0Arr = this.allPairsCyclesMat[p0];
        for (var p1 in p0Arr) {
            if (p0Arr[p1] == '*') {
                continue;   // No real value
            }
            // We have cycles for this pair
            var offset = globalPos.getPairOffset(p0, p1);
            var pStr0 = this.getFullName(p0, this.getPointAreaID(p0), 'unusedAreaID');
            var pStr1 = this.getFullName(p1, this.getPointAreaID(p1), 'unusedAreaID');
            var pairName = "<" + pStr0 + ", " + pStr1 + "> = " + offset;
            // Add the pair's cycles to both points' cycles
            var points = [p0, p1];
            for (var p in points) {
                var pointEntry = this.getPointEntry(points[p]);
                if (!pointEntry.Cycles) {
                    pointEntry.Cycles = {};
                }
                if (!pointEntry.Cycles[pairName]) {
                    pointEntry.Cycles[pairName] = {};
                }
                for (var cycle in p0Arr[p1]) {
                    pointEntry.Cycles[pairName][cycle] = p0Arr[p1][cycle];
                }
            }
        }
    }
}

/*****************************************************************************/

// The pairs are always sorted such that p0 < p1
// Add the pair's cycles to this.allPairsCyclesMat[p0][p1]
DebugObjConstraint.prototype.addPairCycles = DebugObjConstraintAddPairCycles;
function DebugObjConstraintAddPairCycles(point0, point1) {
    // "Sort" the two points
    var p0 = (point0 < point1 ? point0 : point1);
    var p1 = (point0 < point1 ? point1 : point0);
    // Add the pair's cycles to this.allPairsCyclesMat[p0][p1]
    var p0Arr = this.allPairsCyclesMat[p0];
    if (!p0Arr) {
        p0Arr = this.allPairsCyclesMat[p0] = {};
    }
    if (p0Arr[p1]) {
        return; // Already calculated
    }
    var cyclesArr = globalPos.debugGetPairCycles(p0, p1);
    p0Arr[p1] = (cyclesArr? cyclesArr: '*'); // Mark that it is calculated already
}

/*****************************************************************************/

// get (add as needed) a point. Note that this is the debugObj point.
DebugObjConstraint.prototype.getPointEntry = debugObjConstraintGetPointEntry;
function debugObjConstraintGetPointEntry(pointStr, pointAreaID) {
    if (this.pointsArr[pointStr]) {
        return this.pointsArr[pointStr];
    }
    if (!pointAreaID) {
        pointAreaID = this.getPointAreaID(pointStr);
    }
    // Make sure that the Area's entry exists
    var pointsOfAreaEntry = this.pointsOfAreaArr[pointAreaID];
    if (!pointsOfAreaEntry) {
        this.pointsOfAreaArr[pointAreaID] = pointsOfAreaEntry = {};
    }
    // Add the point's entry
    var pointEntry = this.pointsArr[pointStr] = pointsOfAreaEntry[pointStr] = {};
    return pointEntry;
}

/*****************************************************************************/

// --------------------------------------------------------------------------
// getFullName
//
DebugObjConstraint.prototype.getFullName = debugObjConstraintGetFullName;
function debugObjConstraintGetFullName(pointId, pointAreaID, curAreaID)
{
    var pointStr = this.pointLabelById[pointId];

    if (gPointNameMap === undefined && pointAreaID == curAreaID && pointStr.search(pointAreaID) === 0)
        return "___" + pointStr.substr(String(pointAreaID).length);
    if (gPointNameMap === undefined)
        return pointStr;
    var areaId = this.getPointAreaID(pointStr);
    if (areaId === undefined)
        return pointStr;
    if (areaId in gPointNameMap)
        return gPointNameMap[areaId] + pointStr.substr(areaId.length);
    return pointStr;
}

/*****************************************************************************/

// Extract the constraintId from pointStr (using regExp)
var getPointConstraintIDRegExp;
function getPointConstraintId(pointStr) {
    if (!getPointConstraintIDRegExp) {
        getPointConstraintIDRegExp = new RegExp("^([0-9]+)");
    }
    var matchArr = getPointConstraintIDRegExp.exec(pointStr);
    return (matchArr? matchArr[0] : undefined);
}

// Extract the areaID from pointStr (using regExp)
var getPointAreaIDRegExp;
function getPointAreaID(pointStr) {
    // Build the regExp
    if (!getPointAreaIDRegExp) {
        getPointAreaIDRegExp = new RegExp("^(p[0-9]+|[0-9]+:)(?:(?:[0-9-]+|<[^>]*>)(?:\\.(?:[0-9-]+|<[^>]*>))*)?");
    }
    var matchArr = getPointAreaIDRegExp.exec(pointStr);
    return (matchArr? matchArr[0] : undefined);
}

// --------------------------------------------------------------------------
// getPointAreaID
//
DebugObjConstraint.prototype.getPointAreaID = debugObjConstraintGetPointAreaID;
function debugObjConstraintGetPointAreaID(pointId)
{
    var pointLabel = this.pointLabelById[pointId];
    return getPointAreaID(pointLabel);
}

/*****************************************************************************/

var singleConstraintLabelsIgnore = "";
DebugObjConstraint.prototype.verifyConsistency = debugObjMgrVerifyConsistency;
function debugObjMgrVerifyConsistency() {
    if (singleConstraintLabelsIgnore === "") {
        return;
    }
    // Look for labeled constraints that appear in a single constraint.
    mMessage('*** Single constraints labels (singleConstraintLabelsIgnore="' +
             singleConstraintLabelsIgnore + '") ***');
    for (var areaID in this.pointsOfAreaArr) {
        for (var point in this.pointsOfAreaArr[areaID]) {
            var pointEntry = this.pointsOfAreaArr[areaID][point];
            var nConstraints = 0;
            for (var constraint in pointEntry) {
                nConstraints++;
            }
            if (nConstraints <= 1) {
                var p = point.substr(areaID.length, 6); // 6 chars following the areaID
                switch (p) {
                    case 'lf':
                    case 'rf':
                    case 'tf':
                    case 'bf':
                    case 'cvf':
                    case 'chf':
                    case 'lfb':
                    case 'rfb':
                    case 'tfb':
                    case 'bfb':
                    case 'lc':
                    case 'rc':
                    case 'tc':
                    case 'bc':
                    case 'cvc':
                    case 'chc':
                    case 'lcb':
                    case 'rcb':
                    case 'tcb':
                    case 'bcb':
                    case 'rvarea':
                    case 'extrem':
                        break;
                    default:
                        var pStr = this.getFullName(point, areaID, 'unusedAreaID') ;
                        if (!pStr.match(singleConstraintLabelsIgnore)) {
                            console.log(pStr);
                        }
                        break;
                }
            }
        }
    }
}

/*****************************************************************************/
// --------------------------------------------------------------------------
// addSegmentViolation
//
DebugObjConstraint.prototype.addSegmentViolation = debugObjConstraintAddSegmentViolation;
function debugObjConstraintAddSegmentViolation(pairId, cid)
{
    if (!this.violations) {
        this.violations = {};
    }

    if (! this.violations.byPoint) {
        this.violations.byPoint = {};
    }

    var v = debugGetViolationObj(pairId, cid);
    if (!v)
        return;
    if (v.point) {
        for (var pnt in v.point) {
            if (! this.violations.byPoint[pnt])
                this.violations.byPoint[pnt] = {};
            this.violations.byPoint[pnt][cid] = v;
        }
    }
}

/*****************************************************************************/
// --------------------------------------------------------------------------
// fillInViolations
//
DebugObjConstraint.prototype.fillInViolations = debugObjConstraintFillInViolations;
function debugObjConstraintFillInViolations() {
    if (! this.violations)
        return;
    for (var p in this.violations.byPoint) {
        var pointEntry = this.getPointEntry(p);
        if (! pointEntry.Violations)
            pointEntry.Violations = {};
        for (var cid in this.violations.byPoint[p]) {
            var v = this.violations.byPoint[p][cid];
            if (!v) {
                pointEntry.Violations[cid] = undefined;
                continue;
            }
            var pArea = this.getPointAreaID(p);
            var expandedV = {};

            pointEntry.Violations[cid] = expandedV;

            if (v.target !== undefined)
                expandedV.target = v.target;

            if (v.blocking) {
                expandedV.blocking = {};
                for (var blk in v.blocking) {
                    var blkEntry = v.blocking[blk];
                    expandedV.blocking[blk] = {};
                    expandedV.blocking[blk].direction =
                        v.violation.blockedBy[blk].direction;
                    for (var pairId in blkEntry) {
                        var pairEntry = globalPos.posCalc.segmentConstraints.pairById[pairId];
                        if (! pairEntry)
                            continue;
                        var points = pairEntry.points;
                        var pointObj = {};
                        var pStr = [];
                        for (var i in points) {
                            var aid = this.getPointAreaID(points[i]);
                            pStr[i] = this.getFullName(points[i], aid, pArea);
                            pointObj[pStr[i]] = this.getPointEntry(points[i]);
                        }
                        var pairStr = "<" + pStr[0] + ";" + pStr[1] + ">";

                        expandedV.blocking[blk][pairStr] = pointObj;
                    }
                }
            }
        }
    }
}

// --------------------------------------------------------------------------
// getConstraintOfArea
//
DebugObjConstraint.prototype.getConstraintOfArea =
    debugObjConstraintGetConstraintOfArea;
function debugObjConstraintGetConstraintOfArea(areaId)
{
    var pointLabelObj = {};
    var pointIdObj = this.pointsOfAreaArr[areaId];
    for (var pointId in pointIdObj) {
        var pointLabel = this.pointLabelById[pointId];
        pointLabelObj[pointLabel] = pointIdObj[pointId];
    }

    return pointLabelObj;
}

DebugObjConstraint.prototype.visualizeConstraints =
      debugObjConstraintVisualizeConstraints;
function debugObjConstraintVisualizeConstraints(pointLabelObj) {
    for (var l1 in pointLabelObj) {
        var l1id = globalPointLabelIds[l1];
        var cnstrnts = pointLabelObj[l1];
        for (var cnstrnt in cnstrnts) {
            if (cnstrnt !== "Cycles" && cnstrnt !== "Violations") {
                var l2id = Object.keys(cnstrnts[cnstrnt])[0];
                var l2 = this.pointLabelById[l2id];
                // console.log(l1, l1id, l2, l2id);
            }
        }
    }
}


/*****************************************************************************/
//
// for the given pairId/constraint id, find the list of violating variables;
// for each violating variable, list its offsets
//
function debugGetViolationObj(pairId, cid)
{
    var pairEntry = globalPos.posCalc.segmentConstraints.pairById[pairId];
    if (! pairEntry)
        return undefined;

    var result = {
        point: {}
    };
    result.point[pairEntry.points[0]] = true;
    result.point[pairEntry.points[1]] = true;

    // get the variable on which the constraint with the given ID is defined.
    // this is not necessarily the main variable associated with the pair,
    // as the variable may have clones
    
    var pairSegmentEntry = 
        globalPos.posCalc.segmentConstraints.pairById[pairId];

    if(!pairSegmentEntry)
        return undefined;
    
    var constraintEntry = pairSegmentEntry.ids[cid];
    
    if(!constraintEntry)
        return undefined;
    
    var varId = (constraintEntry.cloneIndex !== undefined) ? 
        constraintEntry.cloneIndex : pairSegmentEntry.index;
    
    var violation = globalPos.posCalc.equations.debugGetViolation(varId);
    
    result.target = violation.target;
    result.violation = violation;
    
    result.blocking = {};
    
    for(var blocking in violation.blockedBy) {
        var bentry = result.blocking[blocking] = {};

        // get the main variable associated with this variable 
        var mainVar =
            globalPos.posCalc.linearConstraints.getMainVariable(blocking);
        
        var varentry = globalPos.posCalc.linearConstraints.variables[mainVar];
        if (! varentry)
            continue;
        for (var pid in varentry.pairs) {
            bentry[pid] = true;
        }
    }

    return result;
}

