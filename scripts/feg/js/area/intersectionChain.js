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


// For an intersection area, the object in this file stores all information
// about the chain of intersections which produced the intersection.
// It records, among other things, the two direct intersection parents
// of the area, the full list of areas participating in the intersection
// chain and a list of which areas in the intersection chain were used
// as referred areas, which were used as expression areas and with which
// condition(s) (by condition name, that is, if referred area R intersected
// with expression area E using conditions named "a" and "b" then
// we record [R, ["a", "b"]] in the list of referred areas in the chain
// and [E, ["a", "b"]] in the list of expression areas in the chain.
//
// One reason we need to collect this information is that we want to block
// infinite intersection loops. Without further checking, an infinite loop
// may occur in two different way:
// 1. An 'expression' loop where an expression area E intersects with the
//    result I of its intersection with R. Since I is now a maximal
//    match (in place of R, assuming the matches use the same condition)
//    the system discards the match with R and creates a match with I. Only
//    that in this process I is destroyed bringing us back to the original
//    maximal match between E and R. To avoid such a loop to begin with,
//    we do not allow an expression area E to match an area I with condition C
//    if I has E as an expression with condition C in its chain.
// 2. A 'referred' loop is a little (but not much) more difficult to create.
//    To do so, we need to construct an expression which produces an expression
//    area with similar properties to its own as its intersection. This
//    expression area can continue to intersect with the original referred
//    area to create an infinite loop. Here too, we do not allow an expression
//    intersection area I to match the referred area R with condition C
//    if R appears as a referred area with condition C in the intersection
//    chain of I.
//
// It shuold be noted that we may want to allow the same area to appear twice
// in an intersection chain. For example, say we have a database wih
// personal details (name, age, weight, etc.). We want to create a table
// where all persons are grouped by age. We add an expression area with
// a query on "age" as a column. We then create a table of the resulting
// age values where each cell in the table is a query on the age. This
// query is applied to the same base area from which the age data was
// extracted to begin with. The result is placed in a row area which now
// contains all persons with that row's age. Next, additional columns
// can be added across the rows to extract various values for each age
// group. To produce this construction, one needs the two queries applied
// to the base area (the one extracting the age and the other extracting
// persons by age) to have different names.
//
// Remark: previously, we ignored the condition name when checking for
// referred areas which appear multiple times in a chain. To allow the
// table construction described above, we added to the list of referred
// areas which are not allowed to intersect with the chain only those
// which were used in the chain as referred areas in a selection query
// (but not in a prjection query). In the above example, the intersection
// between the "age" expression and the persons database is a projection
// query and therefore does not block repeated intersection with the base
// set by the chain. This has been modified because we know whether
// a query is a selection or projection query only after we perfomred the
// query while we want to be able to construct the areas before calculating
// their content.

// The IntersectionChain object has the following structure (explanations
// follow):
// {
//    referredArea: <the referred parent of this area>
//    expressionArea: <the expression parent of this area>
//    fullChain: { // all areas in the intersection chain of this area
//       <area ID>: true
//       ....
//    },
//    referred: {
//       <area ID>: {
//           <condition name>: true,
//           ....
//       }
//       ....
//    },
//    expressions: {
//       <area ID>: {
//           <condition ID>: true,
//           ....
//       }
//       ....
//    }
// }
//
// The structure is stored under an intersection and 'this area' refers
// here to the area under which it is stored.
//
// 'referredArea' and 'expressionArea' simply store the two area whose
// intersection created this intersection area.
//
// The 'fullChain' is an object which holds the IDs of all areas participating
// in the intersection chain. This are the referred area, the expression
// area and all areas in the full chains of the referred and expression areas.
//
// The 'referred' entry lists all areas which were used as referred areas
// in the intersection chain together with the names of the conditions
// with which they were matched in this chain AT THE TIME THE INTERSECTION
// WAS CREATED. This means that if expression area E matched referred area R
// with conditions named "A" and "B" then R is recorded in the intersection
// chain with these two conditions and this is not changed if later
// these conditions do no longer match (but the match between E and R
// remains, otherwise the intersection is destroyed and the intersection
// chain object is also destroyed). It is much simpler to implement it this
// way and since this whole mechanism is only intended to block infinite
// loops, there is no reason to do anything more.
// The 'expressions' table is the same only condition are registered
// under their condition ID rather than under their name. The reason for
// this is that the conditions belong to the expression area, not the
// referred area and therefore their IDs are unique relative to the expression
// area and not the referred area.
//

function IntersectionChain(expressionArea, referredArea, intersectionName)
{
    var referredAreaId = referredArea.areaId;
    var expressionAreaId = expressionArea.areaId;

    this.referredArea = referredArea;
    this.expressionArea = expressionArea;

    // the full chain is a union of the chains of the two parents together
    // with the parents themselves
    this.fullChain = {};
    this.fullChain[referredAreaId] = true;
    this.fullChain[expressionAreaId] = true;

    // add the referred area to the 'referred' // table
    this.referred = {};
    this.referred[referredAreaId] = true;

    // add the expression area with the matching conditions to the
    // 'expressions' table.
    this.expressions = {};
    this.expressions[expressionAreaId] = {};
    this.expressions[expressionAreaId][intersectionName] = true;

    // merge in the chains of the expression and referred areas
    this.mergeIntersectionChain(referredArea);
    this.mergeIntersectionChain(expressionArea);
}

// This function merges the various chains (fullChain, referred, expressions)
// of the given area (which is either the referred or expression area
// of this area) into the corresponding chains of the current chain.

IntersectionChain.prototype.mergeIntersectionChain =
    intersectionChainMergeIntersectionChain;

function intersectionChainMergeIntersectionChain(area)
{
    var id;
    var areaId;
    var chain = area.intersectionChain;

    if (!chain) {
        return; // the given area is not an intersection area - nothing to do
    }
    // merge full chain
    for (id in chain.fullChain) {
        this.fullChain[id] = true;
    }
    // merge referred
    for (areaId in chain.referred) {
        this.referred[areaId] = true;
    }
    // merge expressions
    for (areaId in chain.expressions) {
        if (!this.expressions[areaId]) {
            this.expressions[areaId] = {};
        }
        for (id in chain.expressions[areaId]) {
            this.expressions[areaId][id] = true;
        }
    }
}

// Interface functions

// Given two areas, one a referred area and the other an expression area
// and given the condition ID and the name of the condition which match
// the expression with the referred area, this function checks whether
// the content chains of the two areas allow them to intersect using
// the given condition.

function chainsAllowIntersection(referredArea, expressionArea, intersectionName)
{
    if (referredArea.intersectionChain !== undefined &&
          referredArea.intersectionChain.expressions[expressionArea.areaId] &&
          referredArea.intersectionChain.
            expressions[expressionArea.areaId][intersectionName]) {
        // the expression area is in the chain of the referred area
        return false;
    }

    // console.log("chainsAllowIntersection", true);
    return true;
}

// This function returns true if the given area appears in the full
// intersection chain ('fullChain') of this area.
IntersectionChain.prototype.contains = intersectionChainContains;
function intersectionChainContains(area)
{
    return area && this.fullChain[area.areaId];
}
