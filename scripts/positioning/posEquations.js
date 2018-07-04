// Copyright 2017 Yoav Seginer.
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


// This file implements the solution of a set of linear equations under
// segment (min and max value) constraints and stability requirements (relative
// to the previous solution).
//

// The main external interface of this object consists of three groups of
// functions:
// 1. transferValue(), addEquation(), setEquation() and removeEquation()
//    which are used to modify the set of equations.
// 2. prepareAndSolve(), which solves the equations, beginning with the
//    last solution available.
// 3. clearSolutionChanges(), to be called after the changes in the solution
//    have been processed by the calling module.

// The structure of the object is as follows:
// {
//    // objects from the parent PosCalc
//    posCalc: <parent PosCalc object>
//    segmentConstraints: <SegmentConstraints object from the parent PosCalc>
//
//    equations: <CombinationVectors object>
//    equationVecs: <the set of combination vectors inside 'equations'>
//
//    changedEquations: {
//         <equation ID>: true
//         ....
//    }
//
//    solution: {
//        <variable>: <value>
//        .....
//    }
//    solutionChanges: {
//        <variable>: <new value>
//        .....
//    }
//
//    innerProductObj: <VecInnerProducts object>
//    innerProducts: <the table of inner products from inside innerProductObj>
//    errorDerivatives: {
//        <variable>: <error derivative in the direction of this variable>
//        .... 
//    }
//    variablesByResistance: <SortedList object>
//
//    satOrGroupVariables: {
//        <free variable>: true
//        ........
//    }
//
//    boundVars: {
//        <bound variable>: <equation ID for which the variable is bound>
//        ....
//    }
//    boundVarsByEq: {
//        <equation ID>: <bound variable in this equation>
//        .....
//    }
//    needToRefreshBoundVar: {
//        <equation ID>: true
//        ......
//    }
//
//    resistance: <Resistance object>
//
//    violatedVars: <sortedList>
//
//    optimizationSuspension: {
//        blocked: {
//            <free variable>: {
//                priority: <blocked priority>
//                blocking: <equation ID of equation in which
//                           this variable was blocked>
//                relativeSign: <non-zero number>,
//                resistanceDir: <non-zero number>
//                blockedEq: <Map>{
//                    <blocked equation ID>: true,
//                    ....
//                }
//                .....
//            }
//            ....
//        }
//        selfBlocked: {
//            <variable>: {
//                resistance: <minimum of up and down resistance>,
//                equations: {
//                   <equation ID>: true,
//                   .....
//                }
//            }
//            .....
//        }
//        equations: {
//            <equation ID>: {
//                 suspensionId: <ID>,
//                 optimizationPriority: <priority>,
//                 optimizationDir: <non-zero number>,
//                 blocked: {
//                     <blocked variable>: true,
//                     ......
//                 }
//                 blocking: {
//                     <blocking variable>: true,
//                     .....
//                 }
//                 selfBlocked: {
//                     <variable>: true
//                     .....
//                 }
//            }
//            .....
//        }
//        nextSuspensionId: <next suspension ID to assign>
//    }
//    optimizationVar: <variable>
//    optimizationDir: -1|+1
//    optimizationTarget: <value>
//    optimizationPriority: <priority>
//
//    doDebugging: false|<object with debug flags>
// }
//
// Fields from the parent PosCalc object:

// posCalc: the parent PosCalc object
// segmentConstraints: the SegmentConstraints object stored on the parent
//            PosCalc object. This provides this object direct access
//            to the current values of these constraints.
//
// The equations:
//
// equations: this field holds the actual equations set to be solved. It
//            stores both the set of equations as defined by external
//            modules and a linear transformation of these equations
//            on which the actual solution process takes place.
// equationVecs: this is simply a shortcut to the set of linearly transformed
//            equations.
// changedEquations: this is a list of equations which were modified
//            between the previous round of calculation and this round.
//            this does not necessarily include new equations added
//            (but does include equations removed).
//
// The solution:
//
// solution: This is the solution vector. The attributes are the variable
//           names and the values are the values assigned to these variables
//           by the solution. Variables to which the solution assigns
//           a value of zero may, but do not need to, appear in the solution
//           vector.
// solutionChanges: a table of all variables whose value has changed since
//           this table was last cleared (the table is cleared by the external
//           which makes use of the equation solution). The values of new
//           variables are always recorded here.
//
// Equation errors:
//
// innerProductObj: this object calculates the inner products between
//           the linearly transformed equations (equationVecs) and the solution
//           vector.
// innerProducts: the actual table of inner products, as calculated by the
//           innerProductObj object. This is a simple table with equation IDs
//           as attributes and the inner product of each equation with the
//           solution vector as values.
// errorDerivatives: this table holds for each variable the derivative of
//           the error in the direction of the variable. Only variables
//           with non-zero error derivative appear in this table.
// variablesByResistance: this is a sorted list holding all variables
//           with a non-zero error derivative, sorted by the pair
//           (resistance, total resistance) of the variable in the direction 
//           of error reduction (the 'resistance' is the resistance in that 
//           direction due only to  the variable itself, while 
//           'total resistance' also includes resistance due to bound 
//           variables in zero error equations, but excluding resistance 
//           due to satisfied or-groups which the variable satisfies but 
//           is not the only variable which satisfies (see the 'Position.pdf' 
//           document for more details).
//           The entry stored in this list has the following structure:
//           {
//              variable: <the variable for which this entry was created>
//              resistingVar: <a bound variable whose induced
//                             resistance is equal to the total resistance
//                             and larger than the resistance of
//                             the variable>
//              resistingOrGroup: <in case the total resistance is due to
//                                 an or-group, the name of the or-group>
//           }
//           The 'resistingVar' field is undefined if there is no
//           such variable. If 'resistingOrGroup' is not undefined,
//           'resistingVar' is a representative of that or-group.
//
// satOrGroupVariables: this table is intended to handle variables in
//           'variablesByResistance' which are at the (lowest resistance) end
//           of the 'variablesByResistance' list when their resistance 
//           excludes satisfied or-groups but has additional resistance due 
//           to satisfied or-groups. The actual resistance offered by such 
//           variables to movement is that given by the satisfied or-groups.
//           However, if exchanged with a bound variable their resistance 
//           induced on the movement of other variables (not in the satisfied 
//           or-group) is the (lower) resistance without the satisfied 
//           or-groups. For this reason, these variables may be either listed
//           in 'variablesByResistance' under their resistance without 
//           satisfied or-groups or including the resistance of satisfied 
//           or groups. When such a variable is listed under its resistance
//           including the satisfied or-groups, it also appears in the
//           'satOrGroupVariables'.
//
//           Initially (every time the variablesByResistance table is cleared
//           and recreated) all variables are placed at the position 
//           corresponding to their resistance without satisfied or-groups.
//           A variable with satisfied or-group resistance remains at the
//           position in the list corresponding to its resistance without
//           satisfied or-groups as long as it is not the lowest resistance
//           variable in the list. Once the variable is the lowest resistance
//           variable in the list, if its total resistance is greater than
//           its own resistance and greater than the satisfied or-group
//           resistance then it can be exchanged with a bound variable
//           and the variable no longer appears in the 'variablesByResistance'
//           list. When this is not the case, the variable can either be 
//           exchanged with one of the bound variables in the satisfying 
//           or-group or it is moved to the position in the list 
//           corresponding to the resistance including the satisfied 
//           or-groups (both the own resistance and the total resistance are 
//           considered to have this value).
//           For an exchange with a bound variable of the same or-group to
//           be useful, it should result in a variable with lower 
//           resistance than the lowest resistance variable in the 
//           variablesByResistance list (excluding the variable being 
//           exchanged, of course). Such a resistance decrease can result
//           only from a sign change of the error derivative for some 
//           free variable in the equation where the exchange takes place.
//           If such an exchange takes place, the variable is removed
//           from the 'variablesByResistance' list. If such an exchange
//           does not take place, the variable is moved to the position
//           in the list corresponding to its resistance with satisfied
//           or-groups. Total resistance must continue to be calculated
//           for this variable. The variable is also registered to the 
//           'satOrGroupVariables' table. It then remains in this state
//           until the end of the resistance reduction cycle.
//           
//           When the table is empty, it is destroyed to make it easier
//           to detect the fact that it is empty. 
//
// Bound variables:
//
// boundVars: a list of all bound variable. For each bound variable,
//            the value in the table is the equation ID of the equation
//            in which it is bound.
// boundVarsByEq: the inverse table of 'boundVars'. For each equation where
//            a bound variable is defined, this gives the bound variable
//            of that equation. During initialization, there may be equations
//            which do not appear in this table (because no bound variable
//            was yet selected for them).
// needToRefreshBoundVar: a list of equations for which the bound variable
//            has to be refreshed. This list includes both equations which
//            have no bound variable assigned to them (either because
//            they are new or because the previous bound variable of the
//            equation does not exist anymore or is not in the equation
//            anymore) and equations where Gaussian elimination has to
//            be applied to the existing bound variable (this is needed if
//            the equations were changed and the bound variable now appears in
//            other equations as well).
// resistance: This is a resistance object which holds the resistance of
//             each variable in the equations at its current value.
//
// Optimization step:
//
// violatedVars: This is a sorted list of variables which
//             the value assigned to them violates some of the segment
//             constraints defined for them. This priority of each such entry
//             is defined to be the maximal priority of
//             all violated constraints. The entries are sorted by this
//             priority. Each entry has the following form:
//             {
//                variable: <variable>
//                target: <value at which the violation occurred>
//                suspended: true // true when suspended
//             }
//             The 'target' field holds the value of the first violated
//             constraint with the maximal violation priority. This is the
//             target for movement for the optimization step.
//             If 'suspended' is not undefined, the optimization for this
//             variable is suspended.
// optimizationSuspension: this table holds three sub-tables, with the
//             following structure:
//             optimizationSuspension: {
//                blocked: {
//                   <free variable>: {
//                       priority: <blocked priority>
//                       blocking: <equation ID of equation in which
//                                  this variable was blocked>
//                       relativeSign: <non-zero number>,
//                       resistanceDir: <non-zero number>,
//                       blockedEq: <Map>{
//                           <blocked equation ID>: true,
//                           ....
//                       }
//                       .....
//                   }
//                   ....
//                }
//                selfBlocked: {
//                    <variable>: {
//                         resistance: <minimum of up and down resistance>
//                         equations: {
//                             <equation ID>: true,
//                             .....
//                         }
//                    }
//                    .....
//                }
//                equations: {
//                   <equation ID>: {
//                       suspensionId: <ID>,
//                       optimizationPriority: <priority>,
//                       optimizationDir: <non-zero number>,
//                       boundVar: <bound variable of the equation>
//                       blocked: {
//                          <blocked variable>: true,
//                          ......
//                       }
//                       blocking: {
//                          <blocking variable>: true,
//                          .....
//                       }
//                       selfBlocked: {
//                          <variable>: true
//                          .....
//                       }
//                   }
//                   .....
//                }
//                nextSuspensionId: <next suspension ID to assign>
//             }
//             See the Positioning document for the definition of suspended
//             and blocked variables, which will be used below.
//             The 'blocked' table has an entry for each free variable
//             which is blocked (that is, cannot be moved by moving any
//             combination of variables with a resistance less than the
//             priority specified in 'priority'). Under each such
//             free variable, we store not only the priority at which it
//             was blocked ('priority') but also the equation which blocked it
//             ('blocking'). In addition, we store the relative sign of
//             the free variable and bound variable in the blocking equation
//             (this is a positive number if both have the same sign and
//             negative if not). If this changes, we may need to recalculate
//             blocking and suspension.
//             We also store the direction in which the blocked free variable
//             resists movement in the direction which would optimize
//             the bound variable. The resistance in this direction needs
//             to remain higher or equal to the blocking priority.
//             In 'blockedEq' we hold the list of blocking equations
//             which are blocking as a result of this variable
//             being blocked (this does not include the variable which caused
//             the free variable to be blocked).
//             The 'selfBlocked' table holds the list of all variables
//             which appear in blocking equations and whose resistance
//             in both directions is higher than or equal to the optimization 
//             priority of those equations and therefore they block these 
//             equations without being blocked variables themselves. Under 
//             each variable we record the resistance of this variable (the 
//             minimum of its up and down resistance) and all blocking 
//             equations in which the variable appears. The same variable 
//             cannot be both blocked and self-blocked. If its blocked priority
//             is higher, then it is blocked otherwise, it is self-blocked.
//             The 'equations' table holds a list of all equations which
//             block some blocked variable. Each such equation receives
//             a 'suspension ID' which is assigned serially by the order
//             in which the equations become blocking. A blocked free variable
//             can only block equations with a lower priority (the priority
//             of optimization of their bound variable) or with the same
//             priority but a higher (or unassigned) suspension ID.
//             Each entry holds the optimization priority and direction at
//             the time the variable's optimization was suspended.
//             In addition, each equation entry holds the list of free
//             variables which are 'blocked' by it, the list of blocked
//             variables which are 'blocking' for it (that is, were blocked
//             by some previously blocked equation) and the list of
//             self-blocking variables which appear in the equation.
//             Note: in a blocked equation, there may be free variables which
//             are neither blocked, blocking or self-blocking. Moreover,
//             a variable which could be blocking for an equation does not
//             necessarily have to be registered as such. The only requirement
//             is consistency: a variable appears in the 'blocking' list
//             of an equation iff the equation appears in the blockedEq
//             list of the variable.
//
// optimizationVar: during an optimization step, this holds the variable
//             which the current step is trying to optimize. During
//             the search for a feasible solution, this variable is undefined.
// optimizationDir: during an optimization step, this holds the direction
//             (+1 or -1) in which the optimized variable should be moved.
// optimizationTarget: during an optimization step, this variable holds
//             the value which the variable should have in order to satisfy the
//             violated constraint. This is the 'target' which appears in the
//             relevant entry in 'violatedVars'.
// optimizationPriority: during an optimization step, this holds the priority
//             of the violated constraint.
//
// Debugging:
//
// doDebugging: set this variable to an object with debug flags as attributes
//              to enable debugging. For the list of debug flags, see
//              debugPosEquations.js.

// constants

// maximal number of error reduction steps allowed in one feasiblity search
// cycle. When this number is reached, an error is thrown, so it should
// be high enough to be hit only when the process is caught in an
// infinite loop.
var posEquationsMaxReductionStepNum = 5000;
// maximal number of optimization attempts + error reduction in an optimization
// set allowed in a single optimization cycle. When this number is reached,
// an error is thrown, so it should be high enough to be hit only when
// the process is caught in an infinite loop.
var posEquationsMaxOptimizationSteps = 5000;
// This is the maximal times the same pair of variables is allowed to be 
// exchanged within the same resistance reduction cycle. One repeated exchange
// is almost certainly possible (for various reasons) but a larger number of
// repeated exchanges seems like an indication of an error.
var posEquationsMaxRepeatExchanges = 10;

//
// Constructor
//

// The constructor takes as input the segment constraints This is a pointer
// to the original structure, not a copy, so it allows direct access to
// the updated values.
//
// The 'zeroRounding' argument of the Constructor allows the caller to
// specify the absolute value under which certain numbers are rounded off
// to zero (the numbers rounded to zero are the inner products (the errors)
// and the error derivatives. If no zeroRounding is given (or a zero or
// negative value is given), the system applies the default zero rounding. 

// %%include%%: "combinationVectors.js"
// %%include%%: "vecInnerProducts.js"
// %%include%%: "resistance.js"
// %%include%%: "../utils/sortedList.js"

inherit(PosEquations, DebugTracing);
function PosEquations(posCalc)
{
    this.posCalc = posCalc;
    
    // zero rounding
    this.zeroRounding = posCalc.zeroRounding;
    
    // Constraints (from the parent PosCalc object)
    this.segmentConstraints = posCalc.segmentConstraints;

    // Equations

    // threshold of combination number above which the system will try to
    // re-normalize a combination vector. 
    this.normalizationThreshold = 1000;
    // This vector set represents the actual set of equations to be solved.
    this.equations = new CombinationVectors(this.zeroRounding,
                                            this.normalizationThreshold);
    // shortcut to the equation vectors
    this.equationVecs = this.equations.combinationSet.vectors;
    // list of changed equations
    this.changedEquations = {};
    
    // Solution

    // The solution vector
    this.solution = {};
    // changes in the solution vector. This table records under the variable
    // name the new solution value. Only values which have changed are
    // recorded here.
    this.solutionChanges = {};

    // Equation errors 
    
    // object for calculating inner products
    this.innerProductObj = new VecInnerProducts(this.equations.combinationSet,
                                                this.solution,
                                                this.zeroRounding);
    // the table of inner products
    this.innerProducts = this.innerProductObj.innerProducts;
    // vector of error derivatives
    this.errorDerivatives = {};
    // list sorted by a pair of resistance values
    this.variablesByResistance = new PairSortedList();
    // variables belonging to a satisfied or-group listed in the main
    // 'variablesByResistance' table under their resistance including 
    // satisfied or-group resistance. Initially, the table is empty and
    // therefore 'undefined' (to make its empty state easier to check).
    this.satOrGroupVariables = undefined;
    
    // Bound variables
    
    this.boundVars = {};
    this.boundVarsByEq = {};
    this.needToRefreshBoundVar = {};
    
    // resistance tracking object
    this.resistance = new Resistance(this);
    // list of variables with violated constraints.
    this.violatedVars = new SortedList();
    this.optimizationSuspension = {
        blocked: {},
        selfBlocked: {},
        equations: {},
        nextSuspensionId: 1
    };
    this.optimizationVar = undefined;
    this.optimizationDir = undefined;
    this.optimizationTarget = undefined;
    this.optimizationPriority = undefined;

    // debugging

    // inherit from DebugTracing
    // The log cycle priority (1) should be lower than that of PosCalc.
    this.DebugTracing(1);
}

/////////////////////////
// Interface Functions //
/////////////////////////

// This function returns true if the given variable appears in the equations
// an false otherwise.

PosEquations.prototype.hasVariable = posEquationsHasVariable;

function posEquationsHasVariable(variable)
{
    return this.equations.hasComponent(variable);
}

//////////////////////
// Equation Refresh //
//////////////////////

// this function calls the 'transferValue' function of the underlying
// equations. In addition, if one of the modified variables is a bound
// variable in any of the equations, it is added to the list of variables
// for which Gaussian elimination may have to be applied again.

PosEquations.prototype.transferValue = posEquationsTransferValue;

function posEquationsTransferValue(vectorId, prevName, prevValue,
                                   newName, newValue)
{
    this.equations.transferValue(vectorId, prevName, prevValue, newName,
                                 newValue);

    // if any of the two variables involved is a bound variable in an equation,
    // record the equation in which it is bound in a list of equations whose
    // bound variable needs to be refreshed.

    if(prevName && this.boundVars[prevName] != undefined)
        this.needToRefreshBoundVar[this.boundVars[prevName]] = true;
    if(newName && this.boundVars[newName] != undefined)
        this.needToRefreshBoundVar[this.boundVars[newName]] = true;

    // store this change for refresh at calculation initialization
    this.recordModifiedBaseEq(vectorId);
}

// This function is called to add a new equation to the set of equations,
// with values as specified in 'values'. This is an array whose 
// entries have the form { name: <variable ID>, 
//                         value: <value of this variable in this equation> }
// Entries whose value is zero are allowed. These will be removed
// by this function (modifying the input 'values' array).
// This function also adds the equation to the list of equations for which
// a bound variable needs to be selected. In addition, if any of the
// non-zero variables in this equation is already a bound variable in
// another equation, that equation is also added to the list of equations
// for which Gaussian elimination may have to be applied again. 
//
// The function returns the ID of the base vector added.

PosEquations.prototype.addEquation = posEquationsAddEquation;

function posEquationsAddEquation(values)
{
    var i = 0;
    var l = values.length;
    while(i < l) {
        var entry = values[i];
        if(entry.value == 0) { // remove this entry from the array
            if(i < l-1)
                values[i] = values[l-1];
            l = --values.length;
            continue; // repeat again for the same i after the change
        }
        var variable = entry.name;
        if(variable in this.boundVars)
            this.needToRefreshBoundVar[this.boundVars[variable]] = true;
        ++i;
    }

    var eqIds = this.equations.newVector(values, true);

    // add the combination equation added to the list of equations for which
    // a bound variable needs to be selected.
    this.needToRefreshBoundVar[eqIds[1]] = true;
    
    return eqIds[0];
}

// This function is called to set new values to the equation with ID 'eqId'.
// The new values are specified in 'values' (this is an array whose 
// entries have the form { name: <variable ID>, 
//                         value: <value of this variable in this equation> }
// (only non-zero values are listed).
// If a variable whose value is changed is bound in some other equation,
// that equation is added to the list of equations whose bound variable
// needs to be refreshed.

PosEquations.prototype.setEquation = posEquationsSetEquation;

function posEquationsSetEquation(eqId, values)
{
    // all variables which are non-zero in the new vector
    for(var i = 0, l = values.length ; i < l ; ++i) {
        var variable = values[i].name;
        if(variable in this.boundVars)
            this.needToRefreshBoundVar[this.boundVars[variable]] = true;
    }
    
    // Go over all variables which are non-zero in the original vector
    var equation = this.equations.baseSet.vectors[eqId];
    for(var i = 0, l = equation.length ; i < l ; ++i) {
        var variable = equation[i].name;
        if(variable in this.boundVars)
            this.needToRefreshBoundVar[this.boundVars[variable]] = true;
    }
    
    this.equations.setVector(eqId, values);

    // store this change for refresh at calculation initialization
    this.recordModifiedBaseEq(eqId);
}

// This function is called to remove the given base set equation. It also
// removes one vector from the combination set (see the comment
// before 'removeOneCombinationVector()' for details as to how this
// is done).

PosEquations.prototype.removeEquation = posEquationsRemoveEquation;

function posEquationsRemoveEquation(eqId)
{
    this.removeOneCombinationVector(eqId);

    // if the removed base variable contains any variables which are bound,
    // the bound variables may have to be refreshed
    var equation = this.equations.baseSet.vectors[eqId];
    for(var i = 0, l = equation.length ; i < l ; ++i) {
        var variable = equation[i].name;
        if(variable in this.boundVars)
            this.needToRefreshBoundVar[this.boundVars[variable]] = true;
    }

    this.equations.removeVector(eqId);
}

// This function is called after a base vector is removed from the base set.
// The function is called with the ID of the removed vector. It then
// needs to remove a vector from the combination set so that the combinations
// in the set (after the removal of the vector from the base set) remain
// linearly independent.
//
// Explanation:
//
// When a vector is added to the base set of the equations, it
// is also added as a new vector to the combinations set of the equations.
// From there on, the only operation performed on the combination set is
// the addition of a multiple of one vector to another. Such an operation
// has the property that if the combinations defining each vector are
// linearly independent, they remain so after the operation (that is,
// the vectors representing 'CombinationVectors.combinations' remain
// linearly indpendent). Since the combinations are initialized to be
// linearly independent (by adding every new base vector as a new combination
// vector) this means that the combinations remain independent as long
// as no base vector is removed. When a base vector is removed, we need
// to remove a combination vector such that the remaining set of combinations
// remains linearly independent after the removal of the base set vector.
//
// There are various ways of doing this (for example, returning to the
// "no combination" state where each combination consists of one base set
// vector) but these all seem to be computationally more expensive than
// needed (because it will require complete re-diagonalization).
// The simplest way I could find for doing this (though there may be better
// ways) is to take one combination vector which has the base set vector
// being removed as a (non-zero) component and add/substract it from all
// other combination vectors which have the base set vector as a component
// so that the base set vector no longer appears in the combination for these
// vectors. It is then possible to remove the unique combination vector
// which contains the removed base set vector as a component.
// The remaining set of combinations must be linearly independent after
// the removal of the base set vector since it does not contain this vector
// in any of its combinations, which means that if the set is linearly
// dependent then it would also be linearly dependent before the removal
// of the base set vector, contradicting the linear independence
// claimed above.
//
// This method keeps intact the bound variables of all combination vectors from
// which the vector to be removed is substracted (because the bound variables
// of those combination vectors do not appear in the combination being
// substracted. Only the bound variable of the combination vector being
// substracted needs to be removed from the list of bound variables.

PosEquations.prototype.removeOneCombinationVector =
    posEquationsRemoveOneCombinationVector;

function posEquationsRemoveOneCombinationVector(baseVectorId)
{
    var combinations = this.equations.combinations[baseVectorId];
    
    var selectedCombId;
    var selectedComb;
    var selectedAbsComb = 0;
    var allCombIds = [];
    var allCombs = [];

    // loop over the non-zero combinations of the base vector. Select the
    // one with the highest absolute coefficient (this ensures that the
    // resulting coefficients do not become unnecessarily large).
    for(var combId in combinations) {
        var comb = combinations[combId];
        if(!comb)
            continue;
        var absComb = Math.abs(comb);
        if(absComb > selectedAbsComb) {
            selectedCombId = combId;
            selectedComb = comb;
            selectedAbsComb = absComb;
        }
        
        allCombIds.push(combId);
        allCombs.push(comb);
    }

    for(var i = 0, l = allCombIds.length ; i < l ; ++i) {

        var combId = allCombIds[i];
        
        // this equation is about to be changed or removed
        this.changedEquations[combId] = true;

        if(combId == selectedCombId)
            continue;
        
        // add/substract the selected combination vector from this combination
        // vector so that its component for the base vector becomes zero
        this.equations.addCombToCombVector(combId, selectedCombId,
                                           -allCombs[i] / selectedComb);
    }
    
    var boundVar = this.boundVarsByEq[selectedCombId];
    
    // remove the bound variable assigned to the equation about to be removed
    if(boundVar != undefined) {
        
        delete this.boundVars[boundVar];
        delete this.boundVarsByEq[selectedCombId];
        delete this.needToRefreshBoundVar[selectedCombId];
        
        // calculate the effect of the removal on total and or-group resistance
        this.resistance.refreshAfterBoundVarRemoved(boundVar);
    }

    // check whether the vector contains any additional bound variables
    // (may happen in the process of modifying the equations)
    var equation = this.equationVecs[selectedCombId];
    for(var i = 0, l = equation.length ; i < l ; ++i) {
        var variable = equation[i].name;
        if(variable in this.boundVars)
            this.needToRefreshBoundVar[this.boundVars[variable]] = true;
    }
    
    this.equations.removeCombVector(selectedCombId);
}

// This function receives the ID of an existing base equation which was
// modified. It then adds to the list of modified combination equations
// all those combination equations which this base equation is a component of.

PosEquations.prototype.recordModifiedBaseEq =
    posEquationsRecordModifiedBaseEq;

function posEquationsRecordModifiedBaseEq(baseId)
{
    for(var eqId in this.equations.combinations[baseId])
        this.changedEquations[eqId] = true;
}

////////////////////////////
// Main Solution Function //
////////////////////////////

// This function should be called when a solution to the current set of
// equations should be found. It initializes the process and then solves
// the equations.

PosEquations.prototype.prepareAndSolve = posEquationsPrepareAndSolve;

function posEquationsPrepareAndSolve()
{
    debugStartTimer("positioning", "prepare to solve equations");
    var changed = this.prepareToSolve();
    debugStopTimer("prepare to solve equations");
    // having initialized the solution process, we can discard the list of
    // changes made to the equations since the solution was last calculated.
    this.clearAllInputChanges();
    
    if(!changed)
	return; // nothing changed, no need to recalculate

    // Find a feasible solution
    debugStartTimer("positioning", "find feasible solution");
    this.findFeasibleSolution();
    debugStopTimer("find feasible solution");
    // Find an optimal solution
    debugStartTimer("positioning", "find optimal solution");
    this.findOptimalSolution();
    debugStopTimer("find optimal solution");

    // reset the resistance of variables which changed, adding the stability
    // resistance (this should be done now before the list of changed
    // variables is cleared).
    this.setResistanceForNextRound();
    // clear the total resistance from all variables
    this.resistance.removeAllTotalResistanceVariablesExcept();
    
    if(this.doDebugging) {
        this.debugRecordStatistics();
        this.debugBreakOnOptimizationSuspensionErrors();
    }
}

//////////////////////////////////////
// Solution Vector Update Functions //
//////////////////////////////////////

// This function removes the given variable from the solution.

PosEquations.prototype.removeFromSolution = posEquationsRemoveFromSolution;

function posEquationsRemoveFromSolution(variable)
{
    var value = this.solution[variable];
    
    if(value)
        this.innerProductObj.addDualToProducts(variable, -value);
    if(value != undefined)
        delete this.solution[variable];

    delete this.solutionChanges[variable];
}

// This function sets the value of the given variable in the solution to
// the given value. This also updates the inner products of the solution
// with the equation combination vectors.

PosEquations.prototype.setSolution = posEquationsSetSolution;

function posEquationsSetSolution(variable, value)
{
    // round small values to zero
    if(value && value < this.zeroRounding && -this.zeroRounding < value)
        value = 0;

    if(value != this.solution[variable])
        this.solutionChanges[variable] = value;
    
    var prevVal = this.solution[variable];
    this.solution[variable] = value;
    this.innerProductObj.addDualToProducts(variable,
                                           prevVal ? value - prevVal : value); 
}

// This function adds the given diff to the value of the given variable
// in the solution. This also updates the inner products of the solution
// with the equation combination vectors.

PosEquations.prototype.addToSolution = posEquationsAddToSolution;

function posEquationsAddToSolution(variable, diff)
{
    var value =
        this.solution[variable] ? this.solution[variable] + diff : diff;

    this.setSolution(variable, value);
}

////////////////////
// Initialization //
////////////////////

// The initialization functions are called once at the beginning of each
// calculation round. They set up the initial variable values, calculate
// the initial resistance for each variable, select the bound variable
// for each equation and initialize the error derivative vector. Since many of
// the relevant values are available from the previous calculation round,
// only those values which may have changed have to be calculated.
// The function returns false if it discovers that no recalculation is
// necessary (that is, nothing changed). If recalculation is possibly
// needed, this function returns true.

PosEquations.prototype.prepareToSolve = posEquationsPrepareToSolve;

function posEquationsPrepareToSolve()
{
    // repair damage to the combination vectors due to arithmetic errors.
    this.equations.repairCombinations();
    
    debugStartTimer("positioning", "initialize values");
    var refreshed = this.initializeValues();
    debugStopTimer("initialize values");
    
    // now we can check whether any further calculation is necessary
    // (it is necessary if any variable was refreshed, some equation was
    // changed or the bound variable of some equation needs to be
    // refreshed).
    if(isEmptyObj(refreshed) && isEmptyObj(this.changedEquations) &&
       isEmptyObj(this.needToRefreshBoundVar))
	return false;

    // there are some changes, so there will be a new solution cycle - 
    // if needed, debug it.
    this.debugNewSolutionCycle(refreshed); // if debugging is on
    if(this.doDebugging)
        this.debugRecord("before initialization: ",
                         ["optimizationSuspension"]);

    debugStartTimer("positioning",
                    "initializing changed variable resistance");
    this.initializeChangedVariableResistance(refreshed);
    debugStopTimer("initializing changed variable resistance");
    
    // check whether any equation vectors need to be re-normalized
    debugStartTimer("positioning", "normalize equations");
    this.normalizeEquations();
    debugStopTimer("normalize equations");

    debugStartTimer("positioning", "initialize bound variables");
    this.assignMissingBoundVariables();
    debugStopTimer("initialize bound variables");

    debugStartTimer("positioning", "reduce error by bound variables");
    this.reduceErrorByNoResistanceBoundVars();
    debugStopTimer("reduce error by bound variables");

    debugStartTimer("positioning", "initialize error derivatives");
    this.initializeErrorDerivatives();
    debugStopTimer("initialize error derivatives");

    debugStartTimer("positioning", "complete resistance initialization");
    // complete the calculation of the resistance and the violation
    // and optimization suspension tables
    this.completeResistanceInitialization();
    debugStopTimer("complete resistance initialization");
    
    // create a list of variable with non-zero error derivative,ordered by
    // the resistance of the variable and its total resistance in the
    // direction of error reduction.
    debugStartTimer("positioning", "initialize variables by resistance");
    this.initializeVariablesByResistance();
    debugStopTimer("initialize variables by resistance");

    return true;
}

///////////////////////////////////
// Variable Value Initialization //
///////////////////////////////////

// Go over all variables which are either new or whose segment constraints
// have changed (this includes the case where a change in linear constraints
// induces a change in the segment constraints). For these variable, set the
// variable to the initial value, taking into account the variable's
// segment constraints and stability (if the variable is not new).
// The function returns the list of refreshed values. The attributes of the
// list a re the variables and the value is either "new" or "old" depending
// on whether the variable is new or old.

PosEquations.prototype.initializeValues =
    posEquationsInitializeValues;

function posEquationsInitializeValues()
{
    var refreshed = {}; // variables refreshed by this function
    
    // variables added/removed from the equation
    var changed = this.equations.getComponentChanges();

    // add the new variables and remove the ones which are defunct
    for(var variable in changed) {
        if(changed[variable] == "removed")
            this.removeVariable(variable);
        else // new variable
            this.refreshSingleVariable(variable, refreshed);
    }

    // go over segment constraints which changed
    var changes = this.segmentConstraints.changes;

    for(var variable in changes)
        if(!refreshed[variable])
            this.refreshSingleVariable(variable, refreshed);

    return refreshed;
}

// This function is called when a variable is removed. It removes it from
// all internal tables in which it appears.

PosEquations.prototype.removeVariable = posEquationsRemoveVariable;

function posEquationsRemoveVariable(variable)
{
    this.removeFromSolution(variable);
    this.removeFromViolationList(variable);
    if(this.boundVars[variable]) {
        this.needToRefreshBoundVar[this.boundVars[variable]] = true;
        delete this.boundVarsByEq[this.boundVars[variable]];
        delete this.boundVars[variable];
        this.resistance.refreshAfterBoundVarRemoved(variable);
    }
    this.resistance.remove(variable);
}

// This function is given the name 'variable' of a variable and a list
// 'refreshed' of variables already refreshed.
// If the variable is in the equations and does not appear in the refreshed
// list yet, the function calculates the preferred value for the variable
// (based on the segment constraints and stability
// requirements of the variable). If the variable is new, the stability
// requirement is ignored.
// This function sets the value of the variable in the solution vector,
// updates the solution changes table (if necessary) and adds the variable
// to the list of variable refreshed. In addition, it also refreshes the
// resistance entry of this variable (based on the new value).

PosEquations.prototype.refreshSingleVariable =
    posEquationsRefreshSingleVariable;

function posEquationsRefreshSingleVariable(variable, refreshed)
{
    if(refreshed[variable] || !this.equations.hasComponent(variable))
        return; // variable already refreshed or isn't in the equations

    // refresh the resistance
    var resEntry = this.resistance.refreshEntry(variable);

    // get the current value (if already known)
    var lastValue = this.posCalc.getLastValue(variable);

    // make an undefined value into zero (this is the default)
    var value = lastValue ? lastValue : 0;
    
    // if the current value is within the min/max range, leave it unchanged
    // otherwise, calculate an initial value
    if(value > resEntry.max || value < resEntry.min)
        value = this.segmentConstraints.getPreferredValue(variable, lastValue);
    
    this.setSolution(variable, value);

    // update group satisfaction based on this value
    this.updateOrGroupSatisfaction(variable, lastValue);
    
    refreshed[variable] = (lastValue == undefined) ? "new" : "old";
}

///////////////////////////////
// Resistance Initialization //
///////////////////////////////

// This function refreshes the resistance of variables which were added 
// or changed. The function receives the list of variables whose value has 
// been refreshed as input.
// This is only the first step in updating the resistance. The rest of
// the resistance update will take place in completeResistanceInitialization()
// (after the bound variables are assigned and some trivial solution steps
// are made).

PosEquations.prototype.initializeChangedVariableResistance =
    posEquationsInitializeChangedVariableResistance;

function posEquationsInitializeChangedVariableResistance(refreshedVars)
{
    // refresh the resistance (and violations)
    for(var variable in refreshedVars) {
        if(((variable in this.posCalc.variables) ||
            refreshedVars[variable] != "new") &&
           this.resistance.setStableValue(variable))
            continue;
        this.resistance.calcResistance(variable, this.solution[variable]);
    }
}

// This function completes the initilization of the resistance, including
// violations and optimization suspension tables. This function completes
// the calculations scheduled by previous functions (as the total/or-group
// resistance may depend on the assignment of bound variables to equations).
// This function does not initialize the 'variableByResistance' table
// (which depend on the resistance of variables, but also on the errors
// in the equations). This table is initialized in
// 'initializeVariablesByResistance()'.

PosEquations.prototype.completeResistanceInitialization =
    posEquationsCompleteResistanceInitialization;

function posEquationsCompleteResistanceInitialization()
{
    // First, complete the calculation of the total resistance
    
    for(var eqId in this.changedEquations)
        this.resistance.refreshAfterEquationChange(eqId);

    // remove resistance due to bound variables in error equations
    // (skipping equations already handled by the loop above)
    for(var eqId in this.innerProducts)
        if(!(eqId in this.changedEquations))
           this.resistance.refreshAfterBoundVarRemoved(this.boundVarsByEq[eqId],
                                                       true);
    
    // perform all pending resistance calculations
    this.calcAllPendingResistance();
    
    // update violation and optimization suspension tables based on the
    // resistance changes
    this.updateViolationsAfterResistanceChanges();
    this.updateOptimizationSuspensionOfChangedEquations();
    
    // clear the lists of changes
    this.changedEquations = {};
    this.resistance.clearResistanceChanges();
}

///////////////////
// Normalization //
///////////////////

// This function goes over all equations which were marked as candidates
// for re-normalization (multiplication by a constant to make their
// co-efficients closer to 1) and checks whether they need to be normalized.
// If they need to be normalized, they are normalized here.

PosEquations.prototype.normalizeEquations =
    posEquationsNormalizeEquations;

function posEquationsNormalizeEquations()
{
    if(!this.normalizationThreshold)
        return;
    
    // normalize even if the normalization ratio is somewhat smaller than
    // the threshold for which we attempt to normalize.
    var threshold = this.normalizationThreshold / 10;
    
    for(var eqId in this.equations.normalizationCandidates) {
        
        var normalizer = this.equations.calcNormalizationConstant(eqId);
        var absNormalizer = Math.abs(normalizer); 
        
        if(absNormalizer > threshold || absNormalizer < 1/threshold) {
            this.equations.normalize(eqId, normalizer, true);
            if(this.doDebugging)
                this.debugMessage("normalizing equation ", eqId, " by ", 
                                  normalizer);
        }
    }
    
    this.equations.clearNormalizationCandidates();
}

///////////////////////////////////
// Bound Variable Initialization //
///////////////////////////////////

// The bound variable has to be selected for equations which currently
// have no bound variable, that is, equations which are new or where
// the previous bound variable has been removed.
// In addition, where equations have changed, it may be that a bound variable
// no longer appears only in its own equation but may also appear in
// other equations. In this case, Guassian elimination may have to be applied
// to the bound variable.
// The list of all equations where this may have to be done appears
// in 'needToRefreshBoundVar'. The function below goes over this list
// and for each equation which appears in it, selects the bound variable.
// If the equation already has a bound variable assigned to it and this
// variable still appears in the equation, Gaussian elimination is applied
// to ensure the variable does not appear in any other equation. If
// no variable is assigned as the bound variable of the equation or the
// bound variable assigned to the equation does not appear in the equation
// anymore, a new bound variable is selected.

//
// The function first processes the equations where a bound variable is
// already assigned. This is because the bound variables of these equations
// may also appear in other equations (before Gaussian elimination is 
// applied) and therefore may be considered as candidates for the bound
// variables in those equations. The Gaussian elimination for these
// bound variables may then create new candidate bound variables for the
// equations in which those bound variables appeared (but were not bound). 

PosEquations.prototype.assignMissingBoundVariables =
    posEquationsAssignMissingBoundVariables;

function posEquationsAssignMissingBoundVariables()
{
    var missingBoundVars = [];

    // first, process only equations where a bound variable is already assigned
    for(var eqId in this.needToRefreshBoundVar) {

        // get the current bound variable (if defined)
        var boundVar = this.boundVarsByEq[eqId];
        
        if(boundVar == undefined) {
            missingBoundVars.push(eqId);
            continue; // will be processed in the next step
        }

        if(this.equations.getValue(eqId, boundVar) !== 0) {
            // bound variable is defined and appears in the equation,
            // just apply Gaussian elimination (to ensure it does not
            // appear in any other equation).
            this.eliminate(boundVar, eqId, true);
            if(this.doDebugging)
                this.debugIncCounter("refreshed bound variable");
        } else {
            // delete this bound variable assignment (the equation will 
            // be processed again in the next step)
            delete this.boundVarsByEq[eqId];
            delete this.boundVars[boundVar];
            this.resistance.refreshAfterBoundVarRemoved(boundVar);
            missingBoundVars.push(eqId);
        }
    }

    // the remaining equations in the list have no bound variable assigned.
    // for each equation, search for the lowest resistance variable appearing 
    // in the equation. For two equal resistance variables, choose the one 
    // which appears in the fewest equations.
    for(var i = 0, l = missingBoundVars.length ; i < l ; ++i) {

        var eqId = missingBoundVars[i];

        if(this.doDebugging)
            this.debugIncCounter("missing bound variable");

        var boundVarCandidate = this.findBoundVarCandidate(eqId);
        
        if(boundVarCandidate == undefined)
            // this is an all-zero equation (may happen if not all equations
            // are linearly independent)
            continue;

        // assign the bound variable
        this.boundVarsByEq[eqId] = boundVarCandidate;
        this.boundVars[boundVarCandidate] = eqId;
        // eliminate the bound variable from other equations
        this.eliminate(boundVarCandidate, eqId, true);
        // recalculate the total and or-group resistance as a result of this
        // new bound var
        if(!this.innerProducts[eqId])
            this.resistance.refreshAfterBoundVarAdded(boundVarCandidate);
    }

    // clear the list of equations to refresh
    this.needToRefreshBoundVar = {};
}

// Given an equation ID, this function selects the variable which should
// become the bound variable in this equation (under the assumption that
// no bound variable is yet assigned to the equation). The selection
// is designed to decrease the number of steps taken by the Gaussian
// elimination, bth in assigning this variable as bound and in future
// free-bound excahnges. Therefore, the algorithm first tries to decrease
// the need for future free-bound exchanges (by selecting a low-resistance
// variable) and among the remaining alternatives, selects the variable
// which would require the fewest steps in the Gaussian elimination
// (namely, the variable which appears in the least number of equations).
//
// More precisely, the function compares the resistance of the variables
// in the equation and looks for the variable with the least resistance
// (selecting a higher resistance variable means that later on the variables
// may have to be exchanged). Since the up and down resistances of
// the variables do not need to be the same, we need to compare each
// direction separately. We define an ordering of the variables by their
// resistance:
// 1. In case the equation has an error, we compare the resistance of each
//    variable in the error reducing direction.
// 2. In case the equation has no error, we compare both directions,
//    each direction separately. We write d_v for the down resistance
//    of variable v if its coefficient in the equation is positive and
//    and for the up resistance if the coefficient is negative. Similarly, we
//    write u_v for the up resistance of the variable v if its coefficient in
//    the equation is positive and for down resistance if the coefficient is
//    negative. This defines a partial ordering on the resistance of
//    the variables by defining [d_v1, u_v1] < [d_v2, u_v2] iff
//    d_v1 <= d_v2 and u_v1 <= u_v2 and at least one of the inequalities
//    is a strict inequality.
// Given the ordering, we look at the minimal variables under this ordering.
// Of these, we select the one which appears in the least number of equations
// to be the bound variable (if there are several variables which appear
// in the same number of equations, the choice is arbitrary). Taking the
// variable which appears in the least number of equations makes the
// Gaussian elimination faster and reduces the 'mixing' between the equations).
//
// This function returns undefined if the equation is a zero equation
// (no variable appears in it) and the candidate bound variable otherwise.

PosEquations.prototype.findBoundVarCandidate =
    posEquationsFindBoundVarCandidate;

function posEquationsFindBoundVarCandidate(eqId)
{
    var vector = this.equationVecs[eqId];
    // set of minimal variables (by the ordering defined above)
    var minimal = [];

    // direction of resistance to be used for the comparison. The direction
    // is given for variables with a positive coefficient in the equations,
    // for variables with a negative coefficient, the direction is reversed.
    // Direction 0 means both directions.
    var direction = (this.innerProducts[eqId] > 0) ?
        -1 : (this.innerProducts[eqId] < 0 ? 1 : 0);

    // find the minimal variables in this ordering
    
    for(var j = 0, m = vector.length ; j < m ; ++j) {
        var entry = vector[j];
        var variable = entry.name;
        var value = entry.value;
        
        var resistance; // the resistance of this variable

        if(!direction)
            resistance = value > 0 ? 
                [this.resistance.getDownResistance(variable),
                 this.resistance.getUpResistance(variable)] :
                [this.resistance.getUpResistance(variable),
                 this.resistance.getDownResistance(variable)];
        else if(direction * value > 0)
            resistance = this.resistance.getUpResistance(variable);
        else
            resistance = this.resistance.getDownResistance(variable);

        // compare with the resistance of the current minimal variables
        
        var isMinimal = undefined;
        
        for(var v = 0, l = minimal.length ; v < l ; v++) {

            if(direction) {

                // in this case, all variables in the 'minimal' set have
                // the same resistance, so it is enough to check the first
                if(resistance > minimal[v].resistance)
                    isMinimal = false;
                else if(resistance < minimal[v].resistance) {
                    isMinimal = true;
                    minimal = [];
                    l = 0;
                }
                break;
            } else {

                // check whether one of the minimal variables is smaller in the
                // ordering than this one (once this variable is smaller than
                // any of the variables in the previous set of minimal, there
                // is no longer any need to check this as this would mean that
                // the set contained two variables where one is smaller than
                // the other).
                if(!isMinimal) {
                    if(resistance[0] >= minimal[v].resistance[0] &&
                       resistance[1] >= minimal[v].resistance[1] &&
                       (resistance[0] > minimal[v].resistance[0] ||
                        resistance[1] > minimal[v].resistance[1])) {
                        // not minimal
                        isMinimal = false;
                        break;
                    }
                }

                if(resistance[0] <= minimal[v].resistance[0] &&
                   resistance[1] <= minimal[v].resistance[1] &&
                   (resistance[0] < minimal[v].resistance[0] ||
                    resistance[1] < minimal[v].resistance[1])) {
                    l--;
                    if(v < l) {
                        minimal[v] = minimal[l];
                        v--; // stay in place
                    }
                    isMinimal = true;
                }
            }
        }

        if(isMinimal || isMinimal === undefined) {
            minimal[l] = { variable: variable, resistance: resistance };
            minimal.length = l+1;
        } else
            minimal.length = l;
    }

    // of the variables in the minimal set, select the one which appears
    // in the least number of equations

    var minResistanceVar = undefined;
    var minResistanceVarCount;
    var componentIndex = this.equations.combinationSet.componentIndex;
    
    for(var v = 0, l = minimal.length ; v < l ; ++v) {
        variable = minimal[v].variable;
        var componentCount = componentIndex.get(variable).size;
        if(minResistanceVar == undefined) {
            minResistanceVar = variable;
            minResistanceVarCount = componentCount;
        } else if(componentCount < minResistanceVarCount) {
            minResistanceVar = variable;
            minResistanceVarCount = componentCount;
        }
    }

    return minResistanceVar;
}

// This function should be called just after all bound variables were assigned
// but before any further error derivative or resistance calculations take 
// place. The function goes over all equations with an error and checks 
// whether the error can be removed by moving the bound variable. Such 
// movement is allowed only if the bound variable offers no resistance to 
// such movement. For every bound variable for which such movement is 
// allowed, the bound variable is moved. The resistance of the variable
// then needs to be recalculated.
// This function optimizes the search for a feasible solution, but is not
// necessary for finding the correct solution. The moves performed by this
// function would have been performed by the standard algrithm, but the
// search for them is less efficient.   

PosEquations.prototype.reduceErrorByNoResistanceBoundVars = 
    posEquationsReduceErrorByNoResistanceBoundVars;

function posEquationsReduceErrorByNoResistanceBoundVars()
{
    for(var eqId in this.innerProducts) {
        
        var boundVar = this.boundVarsByEq[eqId];
        
        var move = -this.innerProducts[eqId] / 
            this.equations.getValue(eqId, boundVar);
        var target = move + this.solution[boundVar];
        
        var allowed = this.segmentConstraints.
            allowsMovement(boundVar, move > 0 ? "up" : "down", target);
        
        if(!allowed)
            continue; // not allowed
        
        if(allowed !== true) {
            // a list of or-groups which resist this movement on this
            // variable. Check whether these groups are satisfied on other
            // variables (in which case there is no resistance to this
            // movement).
            
            var resisted = false;
            
            for(var orGroup in allowed) {
                if(!this.posCalc.orGroups.
                   isOrGroupSatisfiedOnOtherVariable(orGroup, boundVar)){
                    resisted = true;
                    break;
                }
            }
            
            if(resisted)
                continue;
        }
        
        // movement allowed
        
        this.setSolution(boundVar, target);
        // make sure the resulting inner product is zero
        this.innerProductObj.setToZero(eqId);
        
        // re-calculate the resistance
        this.updateOrGroupSatisfaction(boundVar);
        this.resistance.calcResistance(boundVar, this.solution[boundVar]);
        this.resistance.refreshAfterBoundVarAdded(boundVar);
    }
}

///////////////////////////////////////////////
// Error and Error Derivative Initialization //
///////////////////////////////////////////////

// The error of each equation is the inner product of the solution
// with that equation. Since we are interested in the absolute value
// of the errors, the error derivative vector is the sum of the equations
// with positive error minus the sum of equations with a negative error.
//
// The following function initializes the error derivative vector by looping
// over the inner product table (which contains only the non-zero inner
// products) and adding or substracting the corresponding equation vector.

PosEquations.prototype.initializeErrorDerivatives =
    posEquationsInitializeErrorDerivatives;

function posEquationsInitializeErrorDerivatives()
{
    this.errorDerivatives = {};
    
    // loop over equations with non-zero error (inner product)
    for(var eqId in this.innerProducts) {
        if(this.innerProducts[eqId] > 0)
            this.addEquationToErrorDerivatives(eqId, 1);
        else if(this.innerProducts[eqId] < 0)
            this.addEquationToErrorDerivatives(eqId, -1);
    }
}

/////////////////////////////////////////
// Sorted Variable List Initialization //
/////////////////////////////////////////

// This function initializes the list of variables with non-zero error
// derivative, sorted by their resistance and total resistance. The function
// simply loops over the error derivative vector and for each variable in
// this vector (only variables with non-zero values appear in the vector)
// the function calculates the resistance and the total resistance
// in the direction of error reduction.
// Each variable is inserted into the 'variablesByResistance' table
// with the sort value (resistance, total resistance).

PosEquations.prototype.initializeVariablesByResistance =
    posEquationsInitializeVariablesByResistance;

function posEquationsInitializeVariablesByResistance()
{
    this.recalcAllErrorReducingResistance();
}

//////////////////////////
// Gaussian Elimination //
//////////////////////////

// This function takes an equation ID and a variable which appears in that
// equation and performs Gaussian elimination so that after the operation
// this variable appears only in the given equation.
// The actual Gaussian elimination is performed by the 'this.equations'
// object. In addition, this function updates the optimization suspension
// mechanism of the equations which changed as a result of this operation.
// These equations include all equations from which the given variable was
// eliminated (but not the equation in which the variable remains).

PosEquations.prototype.eliminate = posEquationsEliminate;

function posEquationsEliminate(variable, equationId, dontRefreshResistance)
{
    // store the list of equations from which the variable is about to
    // be eliminated.
    
    var eqIds = [];
    var zeroInnerProd = this.innerProducts[equationId] ? undefined : {};

    var _self = this;
    this.equations.combinationComponentIndex(variable).forEach(function(e,id){
        if(id == equationId)
            return; // this is the one equation which does not change
        eqIds.push(id);
        if(zeroInnerProd && !(id in _self.innerProducts))
            zeroInnerProd[id] = true;
    });
    
    this.equations.eliminate(variable, equationId);
    
    // loop over the equations from which the variable was eliminated
    // and refresh properties affected by these changes
    for(var i = eqIds.length - 1 ; i >= 0 ; --i) {
        if(!dontRefreshResistance)
            this.resistance.refreshAfterEquationChange(eqIds[i]);
        this.changedEquations[eqIds[i]] = true;
        if(zeroInnerProd && zeroInnerProd[eqIds[i]])
            this.innerProductObj.setToZero(eqIds[i]);
    }
}

/////////////////////////////////
// Finding a Feasible Solution //
/////////////////////////////////

// This function should be called after initialization. It then repeatedly
// reduces the error until a feasible solution is found.

PosEquations.prototype.findFeasibleSolution = posEquationsFindFeasibleSolution;

function posEquationsFindFeasibleSolution()
{
    var reductionSteps = 0;

    if(this.doDebugging)
        this.debugRecord("before search for feasible solution",
                         ["errors", "derivatives", "solution",
                          "error-equations", "zero-error-equations",
                          "resistance", "variablesByResistance", "orGroups"]);
    
    // reduce the error until no error remains in the equations
    while(!isEmptyObj(this.innerProducts)) {

        if(!this.reduceError())
            return;

        if(this.doDebugging)
            this.debugRecord("after error reduction",
                             ["errors", "derivatives", "solution",
                              "error-equations", "zero-error-equations",
                              "resistance", "variablesByResistance"]);
        
        if(++reductionSteps > posEquationsMaxReductionStepNum) {
            mondriaInternalError("too many error reduction steps");
            return;
        }
    }
}

/////////////////////////////////
// Finding an Optimal Solution //
/////////////////////////////////

// This function should be called after a feasible solution was found.
// It modifies the solution until an optimal solution is found.
// The function loops over the variables which have
// a segment constraint violation. The variables are iterated in
// decreasing order of priority (of the violation). For each
// variable, the function first checks whether the resistance of the
// variable allows moving the variable in the direction
// which would decrease the violation. If the variable
// itself allows the move, there are two possibilities:
// 1. The variable is a free variable. In this case, the function assigns
//    an error derivative vector which is all zero except for the variable
//    being optimized, for which the derivative is set to either is 1 or -1
//    (opposite to the direction in which the variable should be moved, as
//    the error derivative gives the direction of error increase).
// 2. The variable is a bound variable. As optimization takes place when
//    all equations have a zero error, this bound variable can only move
//    as a result of movement of one of the free variables in the equation
//    where the variable is bound. Therefore, a derivative error vector is
//    created where each of the free variables in this equation has an
//    error derivative of 1 or -1, depending on the direction in which
//    the free variable should move for the bund variable to move in its
//    optimization direction.
// In the second case, it is checked whether any of these free variables
// allows movement in the required direction with resistance lower than
// the priority of the optimization.
//
// Having defined the error derivative vector, the function performs
// a sequence of error reduction steps. These steps are the same as those
// carried out in the process of finding a feasible solution, except for
// two differences:
// 1. When determining how much to move the optimized variable, the target
//    of the optimization is taken into account.
// 2. If the resistance to error reduction is greater or equal to the
//    optimization priority, no error reduction is performed. When this
//    happens, the error reduction function returns false and optimization
//    (for that variable) stops.
//
// Nodes in the violatedVars list can move while processing
// this list. However, this movement is restricted:
// 1. A node which appears before the currently processed node cannot
//    move as a result of movement of the curent node (if it could be moved,
//    it would have moved when it was processed).
// 2. A moved node cannot move across the currently processed node
//    (an optimization of a given priority cannot result in violations of
//    higher priority).
// Therefore, when a variable is moved in the optimization step, we store
// the previous node in the violatedVars list. We then advance
// to the following variable (which may be the variable we just processed).
// If the variable cannot be moved in the optimization step, we continue
// to the next node in the list.

PosEquations.prototype.findOptimalSolution = posEquationsFindOptimalSolution;

function posEquationsFindOptimalSolution()
{
    var optimizationSteps = 0;
    
    var nodeIter = new SortedListIter(this.violatedVars);
    var node;

    // loop over the variables to optimize (in decreasing order of priority).
    while(node = nodeIter.next()) {

        if(++optimizationSteps > posEquationsMaxOptimizationSteps){
            mondriaInternalError("too many optimization steps");
            return;
        }

        // has this variable been suspended for optimization?
        if(node.entry.suspended) {
            if(this.doDebugging)
                this.debugIncCounter("suspended violations");
            node = node.next;
            continue;
        }

        var variable = node.entry.variable;
        var priority = node.sortVal;

        if(this.doDebugging) {
            this.debugRecord("optimization", ["violations"],
                             "optimizing variable ",
                             this.debugGetVarStr(variable), "(value = ",
                             this.solution[variable], ")");
        }
        
        // calculate the direction of optimization movement 
        var direction =
            this.calcOptimizationDirection(variable, node.entry.target,
                                           priority);

        if(this.doDebugging)
            this.debugMessage("optimization direction: ", direction,
                              " priority: ", priority);
        
        if(!direction) { // cannot optimize this variable, go to next
            if(doDebugging)
                this.debugIncCounter("self-suspending violation");
            node = node.next;
            continue;
        }

        if(this.doDebugging)
            this.debugIncCounter("active violation");
        
        // calculate the derivatives
        this.calcOptimizationErrorDerivatives(variable, priority, direction);
        // check whether movement is possible (and if it is, update the
        // variableByResistance table)
        if(!this.checkOptimizationResistance(priority)) {
            // cannot move, suspend this variable and go to the next.
            this.suspendOptimization(variable, priority, direction);
            node = node.next;
            continue;
        }

        // if this variable is bound in a blocking equation (can happen)
        // remove the blocking equation
        if(this.boundVars[variable] != undefined)
            this.removeBlockingEquation(this.boundVars[variable]);
        
        if(this.doDebugging)
            this.debugRecord("calculated optimization derivative: ",
                             ["solution", "zero-error-equations",
                              "derivatives", "resistance",
                              "variablesByResistance"]);

        // set the global optimization variables
        this.optimizationVar = variable;
        this.optimizationDir = direction;
        this.optimizationPriority = priority;
        this.optimizationTarget = node.entry.target;

        // reduce the error while possible (and the target is not reached)
        // The optimization has been carried out when the violation priority
        // of the variable has dropped below the optimization priority
        // (the variable does not necessarily need to reach the target -
        // if it is part of an or-group another variable in the group 
        // may have reached the target).
        while(priority == this.resistance.getViolationPriority(variable)) {
            
            var rc = this.reduceError();
            
            if(!rc || rc == -1) {
                
                if(rc === false) {
                    // failed to move so the variable remains violated,
                    // suspend the optimization
                    this.suspendOptimization(variable, priority, direction);
                }

                // If rc == 0 then we did not reach the target, because it was
                // inifinite, but the optimization was completed. The violation
                // node remains unchanged, but there is no optimization
                // suspension. If rc == -1 the resistance reduction process
                // was incomplete so even though the error could not be
                // reduced, we do not want to suspend the variable's
                // optimization.
                
                break; // cannot reduce error anymore
            }
            
            if(++optimizationSteps > posEquationsMaxOptimizationSteps) {
                nodeIter.destroy();
                mondriaInternalError("too many optimization error steps");
                return;
            }
        }
        
        if(this.doDebugging)
            this.debugRecord("after optimization step: ", ["solution"]);
    }
    
    // clear the 'global' optimization variables
    this.optimizationVar = undefined;
    this.optimizationDir = undefined;
    this.optimizationPriority = undefined;
    this.optimizationTarget = undefined;
}

// This function receives a variable which needs to be optimized, that
// variable's target for movement from 'violatedVars' and
// the priority of the optimization. The function calculates the direction
// in which the optimization should move the value of the variable.
// The function then also checks whether the variable's resistance to movement
// in this direction is smaller than the priority of the optimization.
// If it is not, no movement is possible and zero is returned. Otherwise, the
// direction of movement (-1/+1) is returned.

PosEquations.prototype.calcOptimizationDirection =
    posEquationsCalcOptimizationDirection;

function posEquationsCalcOptimizationDirection(variable, target, priority)
{
    var value = this.solution[variable];
    
    var direction; // +1/-1: direction in which the variable should move
        
    // calculate the optimization direction
    direction = (value < target) ? 1 : -1;
        
    // compare the optimization priority with the resistance of the
    // variable in the given direction
    if((direction > 0 &&
        priority <= this.resistance.getUpResistance(variable))
       ||
       (direction < 0 &&
        priority <= this.resistance.getDownResistance(variable)))
        // blocked by its own resistance, cannot move
        return 0;

    return direction;
}

// This function checks whether optimization is possible under the
// error derivative vector as calculated for the optimization step.
// The function receives the optimization priority as input and assumes
// that the error derivative vector for the optimization has already been
// calculated. For every variable appearing in the error derivative
// vector it then checked whether the resistance of the vector to movement
// in the error reducing direction (opposite to the error derivative direction)
// is less than the optimization priority. If it is, then optimization is
// not impossible (optimization may still be blocked indirectly by
// the total resistance of the variables).
// If this test fails for all variables (meaning that optimization is blocked
// directly by the resistance of all variables appearing in the
// error derivative vector), the function returns false.
// Otherwise, it initializes the 'variableByResistance' table and returns
// true.

PosEquations.prototype.checkOptimizationResistance =
    posEquationsCheckOptimizationResistance;

function posEquationsCheckOptimizationResistance(priority)
{
    var canMove = false;

    for(var freeVar in this.errorDerivatives) {

        if(this.errorDerivatives[freeVar] > 0) {
            if(priority > this.resistance.getDownResistance(freeVar)) {
                canMove = true;
                break;
            }
        } else {
            if(priority > this.resistance.getUpResistance(freeVar)) {
                canMove = true;
                break;
            }
        }
    }

    if(!canMove) {
        if(this.doDebugging)
            this.debugRecord("cannot move: ", ["derivatives", "resistance"]);
        return false;
    }
    
    this.recalcAllErrorReducingResistance();
    
    return true;
}

// This function create the derivative error vector for optimization
// of the given variable. In addition to the variable to be optimized, this
// function also receives the 'priority' of the optimization of the variable
// and the 'direction' (+1/-1) in which the variable should be moved
// If the given variable is a free variable, the derivative vector is
// simply a vector which is zero everywhere except for the optimized variable.
// At this variable, the derivative is the minus of the direction (since the
// error derivative indicates the direction of error increase).
// If the given variable is a bound variable, it must be a bound variable
// in a zero error equation (during the optimization step all equations
// are zero error). Therefore, the bound variable can only move if one of the
// free variables (in the equation in which the variable is bound) moves.
// Therefore, this function makes the derivative vector equal to that equation
// or the minus of that equation (depending on the direction of movement)
// except that the bound variable is assigned a zero derivative.
// While the vector described up to here is a correct error derivative
// vector, we can optimize by removing from it variable entries for
// variables which cannot be moved by moving any combination of variables
// with a resistance less than 'priority'. This includes variables
// whose own resistance is at least 'priority' in both directions and
// variables which are 'blocked' (see Positioning document) with a
// priority of at least 'priority'. The entries for these two types of
// variables are removed from the error derivative vector.
// If 'calcForVar' is given (not undefined), this function only recalculates
// the error derivative for that variable rather than re-calculating the
// whole vector.

PosEquations.prototype.calcOptimizationErrorDerivatives =
    posEquationsCalcOptimizationErrorDerivatives;

function posEquationsCalcOptimizationErrorDerivatives(variable, priority,
                                                      direction, calcForVar)
{
    if(calcForVar == undefined)
        this.errorDerivatives = {};
    else
        delete this.errorDerivatives[calcForVar];
    
    // equation in which this variable is bound (if any)
    var eqId = this.boundVars[variable];
    
    if(eqId) {
        
        // a bound variable
        
        var sign = (direction * this.equations.getValue(eqId, variable) > 0) ? 
            1 : -1;
        
        // If the equation is already blocked (does not happen often, but
        // is possible) get its suspension Id.
        
        var suspensionId;
        var eqEntry = this.optimizationSuspension.equations[eqId];
        if(eqEntry)
            suspensionId = eqEntry.suspensionId;
        

        if(calcForVar === undefined) {
            // the free variables for which the derivative is to be calculated
            var freeVars = this.equationVecs[eqId];
            for(var i = 0, l = freeVars.length ; i < l ; ++i) {
                
                var freeVar = freeVars[i].name;
                if(freeVar == variable)
                    continue;
            
                // check whether the variable is blocked
                if(this.isBlocked(freeVar, priority, suspensionId))
                    continue;
            
                this.errorDerivatives[freeVar] = sign * freeVars[i].value;
            }
        } else if(calcForVar != variable) {
            var calcForVarValue = this.equations.getValue(eqId, calcForVar);
            if(calcForVarValue != 0 && 
               !this.isBlocked(calcForVar, priority, suspensionId))
                this.errorDerivatives[calcForVar] = sign * calcForVarValue;
        }
        
    } else {
        // a free variable
        if((calcForVar == undefined || calcForVar == variable) && 
           !this.isBlocked(variable, priority))
            this.errorDerivatives[variable] = -direction;
    }
}

// This function checks whether the given variable is blocked with a
// priority greater or equal to the given priority. 'Blocked' means that
// no combination of variables movements with resistance less than
// blocking priority can result in movement of this variable (in either
// direction). This holds if either the variable's own resistance
// to movement in both directions is at least 'priority' (self blocked) or
// if the variable is blocked due to the suspension of bound violated
// variables ('blocked').
// If 'suspensionId' is not undefined, a variable is blocked only if
// it is self blocked or it is blocked in an equation whose suspensionId is
// smaller than 'suspensionId'.  
// See the Positioning document for more details.

PosEquations.prototype.isBlocked = posEquationsIsBlocked;

function posEquationsIsBlocked(variable, priority, suspensionId)
{
    // check whether the variable is blocked
    if(this.resistance.getMinResistance(variable) >= priority)
        return true;
    
    var blocked = this.optimizationSuspension.blocked[variable];
    
    if(!blocked || blocked.priority < priority)
        return false;
    
    // if there is a suspension ID given, check that blocking is by a 
    // lower suspension ID.
    if(suspensionId != undefined &&
       this.optimizationSuspension.equations[blocked.blocking].suspensionId >=
       suspensionId)
        return false;
    
    return true;
}

/////////////////////////////
// Optimization Suspension //
/////////////////////////////

// Remark: see the Positioning document for a full explanation of the
// optimization suspension algorithm.

///////////////////////////////////////////
// Adding/Removing Optimization Blocking //
///////////////////////////////////////////

// This function is called when the optimization of the value of 'variable'
// cannot continue anymore (but without having fully optimized the variable).
// This function then suspends the optimization of the variable and
// updates the optimizationSuspension tables using the error derivatives
// vector as the set of blocked free variables blocked by this
// violated variable.
// For more details, including an explanation of the arguments,
// in 'suspendOptimizationByBlocked()' which actually performs the operation.

PosEquations.prototype.suspendOptimization =
    posEquationsSuspendOptimization;

function posEquationsSuspendOptimization(variable, optimizationPriority,
                                         optimizationDirection)
{
    this.suspendOptimizationByBlocked(variable, optimizationPriority,
                                      optimizationDirection,
                                      this.errorDerivatives);
    
    this.errorDerivatives = {};
}

// This function is called when we have decided that th given 'variable'
// should be suspended (or re-suspended, as it may already be suspended).
// The function receives an object 'blockedVars' whose attributes (with
// non-zero values) are the free variables which could be blocked by this
// suspension (this object may be empty, but should not be null or undefined).
// This function then suspends the optimization of the variable by
// setting to true the 'suspended'
// field of the optimized variable's entry in the 'violatedVars'
// table. The variables with non-zero entries in this vector are the
// variables which may be blocked by the equation in which 'variable' is
// bound (if 'variable' is free, the vector is all zero).
// If the blockedVars vector is not all zeros, the corresponding
// equation (the one in which 'variable' is bound) is assigned a
// suspension ID and the variables appearing in the blockedVars
// vector which are determined to be blocked are stored in the
// optimizationSuspension table as blocked by this equation. A variable is
// blocked if the resistance offered by the bound variable to its movement
// in the direction opposite to the optimization direction of the bound
// variable is at least the optimization priority of the bound variable.
// This holds trivially if the bund variable does not belong to any
// violated or-group but needs to be checked in case the bound variable
// does belong to a violation or-group.
// The argument 'optimizationDirection' is a positiove number if
// optimization requires the value of the variable to be increased and
// negative if optimization requires the value of the variable to be
// decreased.

PosEquations.prototype.suspendOptimizationByBlocked =
    posEquationsSuspendOptimizationByBlocked;

function posEquationsSuspendOptimizationByBlocked(variable,
                                                  optimizationPriority,
                                                  optimizationDirection,
                                                  blockedVars)
{
    // suspend the entry of the variable in the violation table
    var violationEntry = this.violatedVars.getEntry(variable);
    violationEntry.suspended = true;

    var blocked = this.optimizationSuspension.blocked;
    var eqTable = this.optimizationSuspension.equations;
    var eqId = this.boundVars[variable];

    // eqId may be undefined, but then the suspended variable is free and
    // there is nothing to do here.
    if(eqId == undefined)
        return;

    var eqEntry = eqTable[eqId];
    if(!eqEntry) {
        eqEntry = eqTable[eqId] = {
            boundVar: variable,
            suspensionId: (++this.optimizationSuspension.nextSuspensionId),
            blocked: {},
            blocking: {},
            selfBlocked: {}
        };
    } else {
        // the equation is already blocked, so need to clear entries which
        // are no longer in the equation
        
        // remove blocked variables which are no longer blocked by this 
        // equation
        for(var blocked in eqEntry.blocked) {
            if(!blockedVars[blocked]) {
                delete eqEntry.blocked[blocked];
                this.removeBlockedVariable(blocked, true);
            }
        }
        
        // remove the equation from the entries of blocked variables which
        // blocked it before but no longer block it (because they do not 
        // appear in the equation or have too low a priority)
        for(var blocking in eqEntry.blocking) {
            if(this.equations.getValue(eqId, blocking) !== 0 && 
               !blockedVars[blocking])
                continue;
            
            var entry = this.optimizationSuspension.blocked[blocking];
            if(entry)
                entry.blockedEq.delete(eqId);
            delete eqEntry.blocking[blocking];
        }
        // remove self-blocked variables which no longer appear in the equation
        for(var selfBlocked in eqEntry.selfBlocked) {
            if(this.equations.getValue(eqId, selfBlocked) !== 0 && 
               (selfBlocked != variable))
                continue;
            this.removeSelfBlockedFromEquation(selfBlocked, eqId);
        }
    }
    
    eqEntry.optimizationPriority = optimizationPriority;
    eqEntry.optimizationDir = optimizationDirection;
    
    var blockingVars = {}; // blocked variables blocking this equation
    var equation = this.equationVecs[eqId];

    for(var i = 0, l = equation.length ; i < l ; ++i) {
        
        var freeVar = equation[i].name;
        if(freeVar == variable)
            continue; // the bound variable
        
        if(!blockedVars[freeVar]) {
            
            // this variable is already blocked and blocks this equation
            blockingVars[freeVar] = true;
            
        } else if(this.resistance.violatedBoundResistsFree(freeVar, variable,
                                                           eqId)) {
            // bound variable offers resistance to movement of the
            // free variable in the direction which increases the
            // violation of the bound variable, so the free variable
            // is blocked
            this.addBlockedVariable(freeVar, eqId);
        }
    }
    
    // record the blocking variable
    for(var v in blockingVars) {
        // record the fact that this variable blocks this equation
        var entry = this.optimizationSuspension.blocked[v];
        
        // if 'entry' is undefined, the variable is 'self blocking' -
        // has high resistance in both directions.
        if(entry) {
            entry.blockedEq.set(eqId, true);
            eqEntry.blocking[v] = true;
        } else {
            var selfBlocked = this.getSelfBlockedEntry(v);
            selfBlocked.equations[eqId] = true;
            eqEntry.selfBlocked[v] = true;
        }
    }
    
    if(this.doDebugging)
        this.debugRecord("suspended optimization of variable " +
                         this.debugGetVarStr(variable),
                         ["optimizationSuspension", "violations",
                          "variablesByResistance"]);
}

// This function adds the given 'freeVar' (free variable) as a blocked 
// variable blocked by the equation with ID 'eqId'.
// The variable may already be blocked or selfBlocked at this or a lower 
// priority. This function then also updates all previous registrations of 
// this variable.
// This function assumes that the calling function verified that this 
// variable should become blocked. It does not, for example, check 
// whether the blocked priority of the variable is indeed higher than 
// the self-blocking priority of the variable (which is a condition for
// it to be registered as blocked).

PosEquations.prototype.addBlockedVariable = posEquationsAddBlockedVariable;

function posEquationsAddBlockedVariable(freeVar, blockingEqId)
{
    if(this.optimizationSuspension.selfBlocked[freeVar])
        // variable was self-blocked, so the list of blocked equations will
        // be created automatically by the function, based on the list of
        // equations where the variable was self-blocked
        this.setBlockedVarEntry(freeVar, blockingEqId, undefined);
    else {
        // we assume here that the blocked variable is either already a blocked
        // variable fr this equation or was raised to a blocking
        // equation which precedes the previous blocking equation (if any).
        // Therefore, the list of blocked equations is the previous list
        // of blocked equations + (if the blocking equation changed) 
        // the previous blocking equation
        
        // the existing blocked variable entry, if exists
        var blockedEntry = this.optimizationSuspension.blocked[freeVar];
        
        if(!blockedEntry)
            this.setBlockedVarEntry(freeVar, blockingEqId, undefined);
        else {
            var blockedEq = new Map();
            
            if(blockedEntry.blocking != blockingEqId)
                blockedEq.set(blockedEntry.blocking, true);
            
            for(var eqId in blockedEntry.blockedEq)
                blockedEq.set(eqId, true);
            
            this.setBlockedVarEntry(freeVar, blockingEqId, blockedEq);
        }
    }
}

// This function is given a variable and it checks whether it appears in the
// violations table. If it does and if its optimization is suspended,
// that suspension is removed. This does not modify the entries in the
// optimizationSuspension table, as an equation can continue to block
// even if its bound variable is no longer suspended (temporarily, this
// state cannot remain for long, as the variable is either suspended again
// or optimized, in which case blocking may be removed).
// If the flag 'checkSelfBlocking' is set, the function first checks the
// resistance of the variable itself to movement. If this resistance 
// is higher or equal to its optimization priority, the variable remains
// suspended.
// If the flag 'checkBlocking' is set, the function first checks whether
// teh variable is blocked in an equation with priority at least as high
// as the variable's optimization priority. If this condition holds, the
// suspension is not removed.

PosEquations.prototype.removeOptimizationSuspension =
    posEquationsRemoveOptimizationSuspension;

function posEquationsRemoveOptimizationSuspension(optVar, checkSelfBlocking,
                                                  checkBlocking)
{
    if(optVar == undefined)
        return;
    
    var node = this.violatedVars.getNode(optVar, true);
    
    if(!node || !node.entry || !node.entry.suspended)
        return; // not an optimized variable or not suspended
    
    if(checkBlocking) {
        var blockedEntry = this.optimizationSuspension.blocked[optVar];
        
        if(blockedEntry && blockedEntry.priority >= node.sortVal)
            return; // variable is blocked
    }
    
    if(checkSelfBlocking && 
       this.resistance.getMinResistance(optVar) >= node.sortVal)
        return; // self-blocking, can remain suspended
    
    // remove the suspension
    delete node.entry.suspended;
    
    if(this.doDebugging)
        this.debugRecord("removing optimization suspension: ",
                         ["optimizationSuspension"],
                         "removing optimization suspension for variable ",
                         this.debugGetVarStr(optVar));
}

// Given an equation ID, this function removes any blocking due to
// this equation as recorded in the optimization suspension table.
// When removing the blocking of an equation, all free variables blocked
// by that equation are removed and, recursively, the blocking of
// all blocking equations whose blocking depends on those blocked variables
// is also removed.

PosEquations.prototype.removeBlockingEquation =
    posEquationsRemoveBlockingEquation;

function posEquationsRemoveBlockingEquation(eqId)
{
    var eqEntry = this.optimizationSuspension.equations[eqId];
    
    if(!eqEntry)
        return; // not a blocking equation
    
    // reactivate the optimization of the bound variable of this
    // equation.
    this.removeOptimizationSuspension(eqEntry.boundVar, true, false);
    
    // loop over the blocked variables and remove their blocking
    for(var blocked in eqEntry.blocked)
        this.removeBlockedVariable(blocked, true);
    
    // loop over the blocking variables and remove this equation from the
    // list of equations blocked by each of these variables
    for(var blocking in eqEntry.blocking) {
        var entry = this.optimizationSuspension.blocked[blocking];
        if(entry)
            entry.blockedEq.delete(eqId);
    }
    
    // clear the self-blocked variables registered for this equation
    for(var selfBlocked in eqEntry.selfBlocked) {
        var entry = this.optimizationSuspension.selfBlocked[selfBlocked];

        delete entry.equations[eqId];
        
        if(isEmptyObj(entry.equations))
            delete this.optimizationSuspension.selfBlocked[selfBlocked];
    }
    
    delete this.optimizationSuspension.equations[eqId];

    // clear any free variables for which the resistance module was
    // required to keep track of or-group resistance for this equation
    this.resistance.removeModuleFromFreeRequireOrGroup(eqId);
}

// Given a self blocked variable and an equation ID, this function removes
// the given self blocked variable from the list of self blocked variables
// registered for this equation. This may result in complete removal of the
// blocked variable from the list of selfBlocked variables if there remain
// no blocked equations in which the variable appears as self blocked.

PosEquations.prototype.removeSelfBlockedFromEquation =
    posEquationsRemoveSelfBlockedFromEquation;

function posEquationsRemoveSelfBlockedFromEquation(selfBlocked, eqId)
{
    var eqEntry = this.optimizationSuspension.equations[eqId];

    if(eqEntry)
        delete eqEntry.selfBlocked[selfBlocked];
    
    var entry = this.optimizationSuspension.selfBlocked[selfBlocked];

    if(!entry)
        return;

    delete entry.equations[eqId];
    
    if(isEmptyObj(entry.equations))
        delete this.optimizationSuspension.selfBlocked[selfBlocked];
}

// Given a variable, this function removes the variable from the list
// of blocked variables in the optimizationSuspension table.
// The blocking of all blocking equations whose blocking depends on this
// blocked variable is removed if the optimization of the equation's
// bound variable moves the blocked variable in a direction where
// its resistance is smaller than the optimization priority of that bound
// variable (specifically, if the self blocking of the variable is at least
// the optimization priority of the equation, the equation remains
// blocked). If any equations remain
// blocked by this variable due to its self blocking, the variable is added
// as a self blocking variable. If 'dontRemoveBlockingEq' is not set,
// the equation which blocked the variable is also removed.
// If the blocked variable is also suspended, the suspension of the variable
// is removed (unless its self-blocking is high enough to keep it suspended).
// When 'dontCheckForAlternativeBlockedEq' is set, the function does not
// search for another equation where this variable can be blocked
// (this is in case the calling function already knows that no such
// equation exists).

PosEquations.prototype.removeBlockedVariable =
    posEquationsRemoveBlockedVariable;

function posEquationsRemoveBlockedVariable(blockedVar, dontRemoveBlockingEq,
                                           dontCheckForAlternativeBlockedEq)
{
    var blockedEntry = this.optimizationSuspension.blocked[blockedVar];
    
    if(!blockedEntry)
        return;

    // remove blocking from the equation in which the variable was blocked
    this.refreshBlockedEqAfterBlockedRemoval(blockedEntry.blocking, blockedVar,
                                             !dontRemoveBlockingEq);

    // Of the equations for which this variable is blocking, check
    // whether there is any where the variable is blocked.
    var equationList = dontCheckForAlternativeBlockedEq ? undefined :
        this.splitByFirstEquationWhereBlocked(blockedVar,
                                              blockedEntry.blockedEq);
    
    if(equationList) {
        // set the new blocked equation on the blocked variable entry
        this.setBlockedVarEntry(blockedVar, equationList.blocked,
                                equationList.blocking);
        // remove the suspension of the variable (if any) unless the priority
        // of the new blocking equation in which this variable is blocked is
        // still high enough (since it is blocked, there is no need to check
        // self-blocking, which is necessarily of lower priority).
        this.removeOptimizationSuspension(blockedVar, false, true);
    } else {
        // remove the blocked variable from each of the blocked equations
        // (this may result in the removal of the blocked equation)
        var _self = this;
        blockedEntry.blockedEq.forEach(function(t,eqId) {
            _self.refreshBlockedEqAfterBlockedRemoval(eqId, blockedVar, true);
            blockedEntry.blockedEq.delete(eqId);
        });
        delete this.optimizationSuspension.blocked[blockedVar];
        this.resistance.removeFromRequireOrGroupResistance(blockedVar, 
                                                           "blocked");
        // remove the suspension of the variable (if any) unless the variable
        // is also self-blocking
        this.removeOptimizationSuspension(blockedVar, true, false);
    }
}

// Given a blocked variable and the equation where this variable should
// be blocked, this function creates the entry for the blocked variable
// in the optimizationSuspension table. If the entry already exists, this
// function can be used to modify it. 
// The function should also be given a list (Map object) 'blockedEq'
// of equations which are blocked by this variable. These equations
// will be set as the equations which are blocked by this variable. If
// any equations are already registered as blocked by this variable
// but do not appear in 'blockedEq' their blocking fo the equations
// will be removed (possibly leading to the equations becoming
// unblocked). If the given variable is currently registered as
// self-blocking, this self blocking will be converted to blocking. It
// is not checked that each equation where the variable is
// self-blocked also appears in 'blockedEq' because a variable is made
// blocked only if this provides more blocking than its self-blocking.
// In this case, the 'blockedEq' needs only list blocked equations
// which are added beyond those which are already self-blocked.
// If 'blockedEq' is not given, the existing 'blocked' equations list is
// not updated, except for the conversion of self-blocking to blocking,
// as described above.
// 
// The function returns the blocked entry.

PosEquations.prototype.setBlockedVarEntry = 
    posEquationsSetBlockedVarEntry;

function posEquationsSetBlockedVarEntry(blockedVar, blockingEq, blockedEq)
{
    var blockedEntry = this.optimizationSuspension.blocked[blockedVar];
    
    if(!blockedEntry) {
        blockedEntry =
            this.optimizationSuspension.blocked[blockedVar] = {
                blockedEq: new Map()
            };
    }
    
    // get the priority of the new equation where the variable is blocked
    var blockedEqEntry = 
        this.optimizationSuspension.equations[blockingEq];
    var blockedPriority = blockedEqEntry.optimizationPriority;

    var boundVar = this.boundVarsByEq[blockingEq];
    
    if(blockedEntry.blocking != undefined &&
       blockedEntry.blocking != blockingEq) {
        var prevEqEntry =
            this.optimizationSuspension.equations[blockedEntry.blocking];
        
        if(prevEqEntry)
            delete prevEqEntry.blocked[blockedVar];
    }
    
    // update the entry of the blocked variable
    blockedEntry.priority = blockedPriority;
    blockedEntry.blocking = blockingEq;
    blockedEntry.relativeSign = 
        this.equations.getValue(blockingEq, blockedVar) * 
        this.equations.getValue(blockingEq, boundVar);
    blockedEntry.resistanceDir =
        -blockedEqEntry.optimizationDir * blockedEntry.relativeSign;
    
    blockedEqEntry.blocked[blockedVar] = true;
    // variable may have been blocking for this equation until now
    delete blockedEqEntry.blocking[blockedVar];
    
    // if the resistance of the blocked variable to optimization depends
    // on satisfied or-group resistance, add a request to keep calculating
    // this resistance
    var direction = (blockedEntry.resistanceDir > 0) ? "up" : "down";
    if(this.resistance.getResistance(blockedVar, direction) < 
       blockedPriority) {
        if(this.resistance.getSatOrGroupResistance(blockedVar, direction) >= 
           blockedPriority)
            this.resistance.addToRequireOrGroupResistance(blockedVar,
                                                          "blocked");
        else
            mondriaInternalError("blocked variable's priority too low");
    }
    
    // equations from which blocking by this variable has been removed
    var blockingRemoved = {};
    
    // update the blocked equations
    
    if(this.optimizationSuspension.selfBlocked[blockedVar]) {
        
        // The variable is already registered as a self-blocked variable.
        // replace all registrations as self-blocked with registrations as
        // blocked/blocking
        
        for(var id in
                this.optimizationSuspension.selfBlocked[blockedVar].equations){
            
            // move the variable from the 'selfBlocked' to the 'blocked' list
            // of this equation
            
            var entry = this.optimizationSuspension.equations[id];
            delete entry.selfBlocked[blockedVar];
            
            // the variable is blocked if this is the blocking equation
            // and blocking otherwise
            if(id != blockingEq) {
                entry.blocking[blockedVar] = true;
                blockedEntry.blockedEq.set(id, true);
            } else
                entry.blocked[blockedVar] = true;
            
            // remove this from the list of equations to update
            if(blockedEq && blockedEq.has(id))
                blockedEq.delete(id);
        }
        
        delete this.optimizationSuspension.selfBlocked[blockedVar];
    } else if(blockedEq) {
        // Remove equations which are not the blocked anymore from the blocked
        // equation list. All these equations, except the new blocked equation 
        // are not blocked anymore. The list of equation which are no longer
        // blocked is created here, but blocking is only removed below - 
        // to avoide conflicting recursive calls.
        blockedEntry.blockedEq.forEach(function(t,eqId) {        
            if(!blockedEq.has(eqId)) {
                blockedEntry.blockedEq.delete(eqId);
                if(eqId != blockingEq)
                    blockingRemoved[eqId] = true;
            }
        });
    }
    
    // add equations appearing in 'blockedEq' but are not yet registered 
    // as blocked by this variable
    if(blockedEq) {
        var _self = this;
        blockedEq.forEach(function(t,eqId) {
        
            if(blockedEntry.blockedEq.has(eqId))
                return; // already registered
        
            blockedEntry.blockedEq.set(eqId, true);
            
            var eqEntry = _self.optimizationSuspension.equations[eqId];
            eqEntry.blocking[blockedVar] = true;
        });
    }
    
    // remove equations which are no longer blocked because the variable
    // no longer blocks them.
    for(var eqId in blockingRemoved)
        this.refreshBlockedEqAfterBlockedRemoval(eqId, blockedVar, true);
    
    return blockedEntry;
}

// This function is given a blocked equation and a variable
// which appears in the equation and used to be blocked but is no longer
// blocked. This function checks whether the equation remains blocked
// after this change. The equation remains blocked if when moving the
// bound variable in the direction of optimization the resistance of the
// given variable to that movement is at least the optimization priority
// of the equation. In case the equation is still blocked the variable
// may either be self blocking or not. If the variable is self blocking,
// it is recorded as such and added as a self-blocking variable to the
// equation entry.
// This equation removes the variable from the list of 'blocked' variables
// in the equation's entry. If the equation is no longer blocked
// and 'removeEquation' is set, the equation entry is removed from the list
// of blocked equations. The function returns true if the equation is still
// blocked and false otherwise.

PosEquations.prototype.refreshBlockedEqAfterBlockedRemoval =
    posEquationRefreshBlockedEqAfterBlockedRemoval;

function posEquationRefreshBlockedEqAfterBlockedRemoval(eqId, blockedVar,
                                                        removeEquation)
{
    if(!(eqId in this.equationVecs)) // equation was removed
        return false;
    
    var eqEntry = this.optimizationSuspension.equations[eqId];
    
    if(!eqEntry)
        return false;
    
    delete eqEntry.blocking[blockedVar];
    delete eqEntry.blocked[blockedVar];
    
    // find the resistance of the blocked variable in the direction
    // of optimization of the bound variable
    
    var dir = (this.equations.getValue(eqId, blockedVar) * 
               this.equations.getValue(eqId, this.boundVarsByEq[eqId]) *
               eqEntry.optimizationDir > 0) ? "down" : "up";
    var opDir = (dir == "up") ? "down" : "up";
    var varRes = this.resistance.variables[blockedVar];
    
    var stillBlocked = false;
    
    if(varRes) {
        stillBlocked = 
            (varRes.resistance[dir] >= eqEntry.optimizationPriority);
        
        if(stillBlocked &&
           varRes.resistance[opDir] >= eqEntry.optimizationPriority) {
            
            // self blocking
            
            var selfBlocked = this.getSelfBlockedEntry(blockedVar);
            selfBlocked.equations[eqId] = true;
            eqEntry.selfBlocked[blockedVar] = true;
        }
    }
    
    if(!stillBlocked && removeEquation)
        this.removeBlockingEquation(eqId);
    
    return stillBlocked;
}

// This function should be called to decrease the blocking priority
// of a blocked free variable when this priority is decreased as
// a result of a decrease in the optimization priority of the bound
// variable in the equation which blocked the variable. 
// If this priority is lower than the self-blocking priority of the
// variable, the blocked variable is made into a self-blocked variable.
// Whether it becomes a self-blocked variable or not, this change
// does not change the blocking of the equation in which the variable
// was blocked, but blocking is removed from any other equation which
// is blocked by this variable and has a higher priority than the new
// (reduced) priority of the (self-)blocked variable.

PosEquations.prototype.decreaseVariableBlockingPriority =
    posEquationsDecreaseVariableBlockingPriority;

function posEquationsDecreaseVariableBlockingPriority(blockedVar, priority)
{
    var blockedEntry = this.optimizationSuspension.blocked[blockedVar];

    if(!blockedEntry)
        return;
    
    if(priority >= blockedEntry.priority)
        return; // not a decrease in the priority
    
    // get the self-blocking priority of the variable
    var selfPriority = this.resistance.getMinResistance(blockedVar);
    
    if(selfPriority >= priority) {
        this.makeBlockedIntoSelfBlocked(blockedVar, selfPriority);
        return;
    }
    
    // set the new blocking priority
    blockedEntry.priority = priority;

    // loop over the equations blocked by this variable and remove their
    // blocking if their priority is higher than the new blocking priority.
    var _self = this;
    blockedEntry.blockedEq.forEach(function(t,eqId) {
        if(_self.optimizationSuspension.equations[eqId].optimizationPriority >
           priority)
            _self.removeBlockingEquation(eqId);
    });
}

// This function gets the 'sel blocked' entry for the given variable
// in the suspension optimization structure. If such an entry does not exist,
// it is created (empty).

PosEquations.prototype.getSelfBlockedEntry = posEquationsGetSelfBlockedEntry;

function posEquationsGetSelfBlockedEntry(variable)
{
    var selfBlocked = this.optimizationSuspension.selfBlocked[variable];
    
    if(!selfBlocked)
        selfBlocked =
            this.optimizationSuspension.selfBlocked[variable] = {
            resistance: this.resistance.getMinResistance(variable),
            equations: {}
	    };
    
    return selfBlocked;
}

// This function receives a variable which is blocked and makes it into
// a self-blocked variable with the given 'priority'. This priority is
// not necessarily the same as the previous blocked priority of the variable,
// but is not allowed to be any smaller than the blocked priority of the 
// variable. If this is not the case, the function exits without performing
// the change.

PosEquations.prototype.makeBlockedIntoSelfBlocked = 
    posEquationsMakeBlockedIntoSelfBlocked;

function posEquationsMakeBlockedIntoSelfBlocked(variable, priority)
{
    var blockedEntry = this.optimizationSuspension.blocked[variable];
    
    if(!blockedEntry)
        return; // not blocked
    
    if(blockedEntry.priority > priority)
        return; // self-blocking priority not high enough
    
    // create the self-blocked entry
    var varEntry = this.optimizationSuspension.selfBlocked[variable] = {
        resistance: priority,
        equations: {}
    };
    
    var equations = this.optimizationSuspension.equations;
    
    // update the equation in which this variable was blocked
    var blockingEq = equations[blockedEntry.blocking];
    delete blockingEq.blocked[variable];
    blockingEq.selfBlocked[variable] = true;
    varEntry.equations[blockedEntry.blocking] = true;
    
    // update the equations blocked by this variable
    blockedEntry.blockedEq.forEach(function(t,eqId) {
        
        var eqEntry = equations[eqId];
        
        delete eqEntry.blocking[variable];
        eqEntry.selfBlocked[variable] = true;
        varEntry.equations[eqId] = true;
    });
    
    // delete the entry for the blocked variable
    delete this.optimizationSuspension.blocked[variable];
    this.resistance.removeFromRequireOrGroupResistance(variable, "blocked");
}

// This function updates the minimal resistance of a self-blocking
// variable. If this resistance increased, there is nothing to do.
// If the resistance decreased, every blocking equation with higher
// priority in which the self-blocked variable appears is removed
// (and this may eventually result in the self-blocked variable being
// removed from the table). Moreover, if the the variable is suspended,
// that suspension is removed if the new self-blocking resistance is
// not sufficiently high.

PosEquations.prototype.changeSelfBlockingPriority =
    posEquationsChangeSelfBlockingPriority;

function posEquationsChangeSelfBlockingPriority(variable, resistance)
{
    var varEntry = this.optimizationSuspension.selfBlocked[variable];

    if(!varEntry)
        return; // not self blocking, nothing to do

    if(varEntry.resistance <= resistance) {
        varEntry.resistance = resistance;
        return;
    }

    // resistance decreased
    
    varEntry.resistance = resistance;
    
    // loop over the equations in which the variable appears and remove
    // those with a priority higher than the resistance for the variable

    var equations = this.optimizationSuspension.equations;
    
    for(var eqId in varEntry.equations) {
        if(equations[eqId].optimizationPriority > resistance)
            this.removeBlockingEquation(eqId);
    }

    // remove the suspension of the variable (if any) if the variable
    // self-resistance is no longer high enough
    this.removeOptimizationSuspension(variable, true, false);
}

// This function goes over the list of equations in 'equationList',
// which should be a Map object with equation IDs as keys. Of these
// equations, the function checks which equations are blocked. Among
// the equations which are blocked, the function finds the first
// (highest optimization priority and lowest suspensionId) such that
// the given variable is blocked in that equation. If no such equation is
// found, the function returns undefined, otherwise, the equation ID
// is returned.
// An equation cannot be blocking for the variable if the self-blocking
// of the variable is higher than the optimization priority of the
// equation.

PosEquations.prototype.findFirstEquationWhereBlocked =
    posEquationsFindFirstEquationWhereBlocked;

function posEquationsFindFirstEquationWhereBlocked(variable, equationList)
{
    if(this.boundVars[variable] != undefined)
        return undefined; // bound variable cannot be blocked
    
    // self blocking priority
    var selfBlocking = this.resistance.getMinResistance(variable);
    // first equation in which the variable is blocked
    var blocked;
    // optimization priority of the equation where variable is blocked
    var blockedPriority = -Infinity;
    // suspension ID of the equation where variable is blocked
    var suspensionId;

    var _self = this;
    equationList.forEach(function(t,eqId) {
        
        var eqEntry = _self.optimizationSuspension.equations[eqId]; 
        
        if(!eqEntry)
            return; // not a blocked equation
        
        if(eqEntry.optimizationPriority <= selfBlocking ||
           eqEntry.optimizationPriority < blockedPriority ||
           (eqEntry.optimizationPriority == blockedPriority &&
            eqEntry.suspensionId > suspensionId))
            return; // cannot be the first one
        
        // check whether the variable is blocked in the equation
        
        // first, check its resistance in the direction of equation 
        // optimization (perhaps the equation is not blocking anymore)
        if(!_self.stillBlocksOptimization(eqId, variable))
            return; // this equation no longer blocked
        
        if(_self.resistance.violatedBoundResistsFree(variable, eqEntry.boundVar,
                                                     eqId)) {
            // this is the new blocking equation
            blocked = eqId;
            blockedPriority = eqEntry.optimizationPriority;
            suspensionId = eqEntry.suspensionId;
        }
    });
    
    return blocked;
}

// This function goes over the list of equations in 'equationList',
// which should be a Map object with equation IDs as keys. Of these
// equations, the function checks which equations are blocked. Among
// the equations which are blocked, the function finds the first
// (highest optimization priority and lowest suspensionId) such that
// the given variable is blocked in that equation. If no such equation is
// found, the function returns undefined. Otherwise, the function
// returns an object as follows:
// {
//     blocked: <equation ID>,
//     blocking: <Map>{
//         <equation ID>: true
//         .....
//     }
// }
// The first equation in which the variable is blocked is recorded under
// 'blocked'. All equation which have a lower optimization priority than
// this equation or the same optimization priority but a higher
// suspension ID, are listed in 'blocking'.
//

PosEquations.prototype.splitByFirstEquationWhereBlocked =
    posEquationsSplitByFirstEquationWhereBlocked;

function posEquationsSplitByFirstEquationWhereBlocked(variable, equationList)
{
    var firstEq = this.findFirstEquationWhereBlocked(variable, equationList);

    if(firstEq == undefined)
        return undefined;

    var result = {
        blocked: firstEq,
        blocking: new Map()
    };
    
    // get the priority and suspension ID of this equation
    var firstEntry = this.optimizationSuspension.equations[firstEq];
    var blockedPriority = firstEntry.optimizationPriority;
    var suspensionId = firstEntry.suspensionId;

    var _self = this;
    equationList.forEach(function(t, eqId) {

        if(eqId == firstEq)
            return;
        
        var eqEntry = _self.optimizationSuspension.equations[eqId]; 
        
        if(!eqEntry)
            return; // not a blocked equation

        if(eqEntry.optimizationPriority < blockedPriority ||
           (eqEntry.optimizationPriority == blockedPriority &&
            eqEntry.suspensionId > suspensionId))
            result.blocking.set(eqId, true);
    });

    return result;
}

////////////////////////////////
// Blocking/Suspension Update //
////////////////////////////////

// This function is called after the resistance of the given variable
// has changed. The function checks whether this variable is a blocked
// or self-blocked free variable. If it is blocked, the function checks 
// whether the change in resistance requires the blocked free variable 
// to be removed (thus also reactivating the optimization of the bound
// variable in the equation). If the variable is self-blocked, the function
// updates the resistance of the variable (which may result in some
// blocked equations being removed). 

PosEquations.prototype.optimizationBlockingAfterResistanceChange =
    posEquationsOptimizationBlockingAfterResistanceChange;

function posEquationsOptimizationBlockingAfterResistanceChange(variable)
{
    var blockedEntry = this.optimizationSuspension.blocked[variable];
    
    if(!blockedEntry) {
        // not blocked, but may be self-blocking (that is, self-resistance
        // in both directions).
        if(this.optimizationSuspension.selfBlocked[variable]) {

            // self-blocked
            
            var resistance = this.resistance.getMinResistance(variable);
            this.changeSelfBlockingPriority(variable, resistance);
        }
        
        return;
    }
    
    // check whether the resistance increased so that this became self-blocking
    
    var resistance = this.resistance.getMinResistance(variable);
    
    if(resistance >= blockedEntry.priority) {
        // this is now self-blocking
        this.makeBlockedIntoSelfBlocked(variable, resistance);
        return;
    }
    
    // check whether the variable remains blocking
    
    // get the current resistance in the direction of resistance
    // of the blocked variable. This includes possible resistance 
    // by satisfied or-groups.
    var directionStr = blockedEntry.resistanceDir > 0 ? "up" : "down";
    resistance = 
        this.resistance.getResistanceWithSatOrGroups(variable, directionStr);
    
    if(resistance >= blockedEntry.priority)
        return; // resistance high enough, nothing to do
    
    // resistance too low, remove the blocking and the suspensions
    // implied by it
    this.removeBlockedVariable(variable);
}

// This function is called after the violation of the given variable has
// changed: violation priority changed including removal of the violation
// or the direction of the violation changed.
// If the variable is a free variable, this function checks whether the
// self-blocking or blocked priority of the variable (if blocked) are
// at least as high as the optimization priority of the variable. If not,
// its optimization suspension is removed.
// In case the violation direction changed, the suspension of the variable
// is removed and the blocking of the equation in which the variable is
// bound (if at all) is removed.
// If the direction of optimization did not change but the violation priority
// changed, the following actions are taken:
// 1. If the violation priority decreased, the suspension of the variable
//    remains unchanged but the priority of the blocked variables blocked
//    by the equation in which this variable is bound is decreased. As a
//    result, equations blocked by these variables which have a higher
//    priority than the new priority of the blocked variable are no longer
//    blocked (unless the blocked variable has high enough self-blocking).
// 2. If the violation priority increased, the suspension of the variable
//    is removed, but the blocking of the equation remains at its previous
//    priority (as long as this variable is not optimized, the equation
//    continues to block). This blocking will be updated after an attempt
//    is made to optimize the variable.

PosEquations.prototype.optimizationBlockingAfterViolationChange =
    posEquationsOptimizationBlockingAfterViolationChange;

function posEquationsOptimizationBlockingAfterViolationChange(variable)
{
    // the equation in which this variable is bound (if any)
    var eqId = this.boundVars[variable];

    if(eqId == undefined) {
        // a free variable, just remove its optimization suspension (if any)
        this.removeOptimizationSuspension(variable, true, true);
        return;
    }

    var eqEntry = this.optimizationSuspension.equations[eqId];

    if(!eqEntry)
        return; // not a blocked equation

    // get the violation entry of the variable
    var node = this.violatedVars.getNode(variable, true);

    if(!node) { // no violation anymore, equation cannot block
        this.removeBlockingEquation(eqId);
        return;
    }

    // current direction of optimization
    var optimizationDir = node.entry.target - this.solution[variable];

    if(optimizationDir * eqEntry.optimizationDir < 0) {
        // optimization direction changed
        this.removeBlockingEquation(eqId);
        return;
    }
    
    // Optimization direction did not change, check whether the optimization
    // priority increased or decreased
    
    var priority = node.sortVal;
        
    if(priority > eqEntry.optimizationPriority) {
        // increase in the priority, reactivate the optimization, but don't
        // change the blocking (the blocking will be remove when the 
        // variable is optimized (if possible)).
        if(this.doDebugging)
            this.debugMessage("violation priority of variable ", variable, 
                              " increased to ", priority, 
                              " while it is bound in a blocked equation ", 
                              eqId, " with priority ", 
                              eqEntry.optimizationPriority);
        this.removeOptimizationSuspension(variable, true, false);
    } else if(priority < eqEntry.optimizationPriority) {
        // decrease the blocking priority
        eqEntry.optimizationPriority = priority;
        for(var blocked in eqEntry.blocked)
            this.decreaseVariableBlockingPriority(blocked, priority);
    }
}

// This function goes over all equations listed in 'this.changedEquations'
// and updates the optimization blocking status of the equation
// (see details in 'optimizationBlockingAfterEquationChange' which actually
// does the work). This function should be called after the resistance
// of variables has been updated (as the blocking depends on the resistance).

PosEquations.prototype.updateOptimizationSuspensionOfChangedEquations = 
    posEquationsUpdateOptimizationSuspensionOfChangedEquations;

function posEquationsUpdateOptimizationSuspensionOfChangedEquations()
{
    for(var eqId in this.changedEquations)
        this.optimizationBlockingAfterEquationChange(eqId);
}

// This function is called when an equation changes. It checks whether
// the equation is a blocking equation. If it is, the function checks
// whether the equation is still blocking with the same priority and with
// the same bound variable. If the bound variable changed or the
// equation is no longer blocking, the blocking is removed and
// the optimization of the original bound variable with which the equation was
// blocked is reactivated. If the equation is still blocking and with the
// same bound variable, the function checks whether the variables blocked
// by the equation changed. The blocking of Variables which were blocked
// by the equation but do no longer appear is removed. New variables blocked
// by the equation are added as blocked variables.
// This function assumes that if the violation priority of the bound variable
// or the resistance of any of the blocked variables changed then this
// was already updated by calling the appropriate update function (above).
// Therefore, this function does not need to check the violation and
// resistance values but can work directly with the values stored in the
// suspensionOptimization tables.

PosEquations.prototype.optimizationBlockingAfterEquationChange =
    posEquationsOptimizationBlockingAfterEquationChange;

function posEquationsOptimizationBlockingAfterEquationChange(eqId)
{
    var eqEntry = this.optimizationSuspension.equations[eqId];

    if(!eqEntry)
        return; // not a blocked equation

    // check whether the bound variable is unchanged (it may also be
    // undefined, if it was not yet assigned or if the equation was
    // removed).

    var boundVar = this.boundVarsByEq[eqId];

    if(boundVar != eqEntry.boundVar) {
        // remove blocking of this equation
        this.removeBlockingEquation(eqId);
        return;
    }

    var boundVarValue = this.equations.getValue(eqId, boundVar);
    var priority = eqEntry.optimizationPriority;
    var blockedByEq = {}; // variables blocked by this equation (if blocking)
    var equation = this.equationVecs[eqId];
    var exceptions = {};

    for(var i = 0, l = equation.length ; i < l ; ++i) {
        
        var entry = equation[i];
        var freeVar = entry.name;
        var freeValue = entry.value; 
        
        exceptions[freeVar] = true; // is after this loop

        if(freeVar == eqEntry.boundVar)
            continue; // not a free variable

        // is this variable blocked? If blocked by another equation, this
        // needs to be an equation with a higher priority or a lower
        // suspension ID (to avoid equations blocking each other, back
        // and forth, which invalidates the blocking property).

         if(this.resistance.getMinResistance(freeVar) >= priority)
             continue; // blocked by its own resistance
         
         var blocked = this.optimizationSuspension.blocked[freeVar];
         
         if(blocked && blocked.blocking != eqId) {
             
             // blocked in another equation, does that equation block this one?
             
             if(blocked.priority > priority)
                 continue; // blocked
             
             if(blocked.priority == priority) {
                 var suspensionId = this.optimizationSuspension.
                     equations[blocked.blocking].suspensionId;
                 
                 if(suspensionId < eqEntry.suspensionId)
                     continue; // blocked
             }
         }
         
         // variable not blocked in another equation, check whether it could
         // be blocked by this equation (if it is blocking)
         
         if(!this.stillBlocksOptimization(eqId, freeVar)) {
             // no blocking, remove the blocking by this equation
             this.removeBlockingEquation(eqId);
             return;
         }
         
         var optDir = -eqEntry.optimizationDir * freeValue * boundVarValue;
         blockedByEq[freeVar] = optDir > 0 ? -freeValue : freeValue;
    }
    
    // if we reached this point, the eqaution is blocking, update its entry
    // (including he re-suspension of the bound variable)
    this.suspendOptimizationByBlocked(boundVar, priority,
                                      eqEntry.optimizationDir, blockedByEq);
    // clear any free variables which are no longer in the equation and
    // for which the resistance module was required to keep track of
    // or-group resistance for this equation
    this.resistance.removeModuleFromFreeRequireOrGroup(eqId, exceptions);
}

// This function is called when the contribution of a violated or-group
// to the total resistance of the given variable may have changed.
// The function checks whether this variable appears in any blocked equation
// and whether the equation in which it is blocked should change
// (this may result in the variable becoming blocked, changing the equation
// in which it is blocked or not being blocked in any equation).
// This function then carries out the required changes.

PosEquations.prototype.optimizationBlockingAfterViolatedOrGroupChange =
    posEquationsOptimizationBlockingAfterViolatedOrGroupChange;

function posEquationsOptimizationBlockingAfterViolatedOrGroupChange(variable)
{
    if(this.boundVars[variable] != undefined)
        return; // a bound variable cannot be blocked
    
    // list of equations where this variable appears
    var equations = this.equations.combinationComponentIndex(variable);

    if(!equations)
        return; // nothing to do

    // get the blocked variable entry for this variable (if any)
    var blockedEntry = this.optimizationSuspension.blocked[variable];

    // search for the equation where this variable should be blocked
    var equationList = this.splitByFirstEquationWhereBlocked(variable,
                                                             equations);

    if(!equationList) {
        
        if(!blockedEntry)
            return; // not blocked and should remain this way

        // is currently blocked, but should not be, remove it from the list
        // of blocked variables, but leave its equation blocking.
        this.removeBlockedVariable(variable, true, true);
        return;
    }

    if(blockedEntry && equationList.blocked == blockedEntry.blocking)
        return; // nothing changed
    
    // update or create the blocked entry of the variable
    blockedEntry = this.setBlockedVarEntry(variable, equationList.blocked,
                                           equationList.blocking);
    
    // if the blocked priority of the variable is smaller than its violation
    // priority, remove the variable's optimization suspension.
    this.removeOptimizationSuspension(variable, true, true);
}

// Given an equation ID and a free variable, this function checks whether
// the given equation is blocked, the free variable appears in it and if 
// these two hold, whether the free variable still blocks optimization of 
// the bound variable of the equation, that is, whether the resistance of
// the free variable to movement in the direction which optimizes the bound
// variable is greater or equal to the optimization priority of the equation.
// If all these hold, true is returned and otherwise, false. 

PosEquations.prototype.stillBlocksOptimization = 
    posEquationsStillBlocksOptimization;

function posEquationsStillBlocksOptimization(eqId, freeVar)
{
    var eqEntry = this.optimizationSuspension.equations[eqId];
    
    if(!eqEntry)
        return false;
    
    var freeValue = this.equations.getValue(eqId, freeVar);
    
    if(!freeValue)
        return false;
    
    var boundVar = this.boundVarsByEq[eqId];
    
    if(boundVar == undefined)
        return false;
    
    var optDir = -eqEntry.optimizationDir * freeValue * 
        this.equations.getValue(eqId, boundVar);
    var resistance = (optDir > 0) ?
        this.resistance.getUpResistance(freeVar) :
        this.resistance.getDownResistance(freeVar);
    
    return (resistance >= eqEntry.optimizationPriority);
}

//////////////////////////
// Resistance reduction //
//////////////////////////

// The last variable in the 'variablesByResistance'
// list is a variable with minimal resistance to movement
// in the error reducing direction. Among all the variable with the same
// resistance, this variable also has the minimal total resistance
// to this movement (that is, resistance including the resistance to the
// induced movement of bound variables in zero error equations).
//
// If the resistance of this variable is equal to its total
// resistance and there is no extra resistance due to satified or-groups
// (which are satisfied on that variable and at least one more variable)
// the variable can be moved to reduce the error. Otherwise, if the
// total resistance is higher than the variable's own resistance,
// the variable is exchanged with the bound variable with the highest
// induced resistance. If the total resistance and the resistance are equal
// but there is extra resistance due to satisfied or-group resistance
// where the or-group is satisfied both on the variable appearing in the 
// list and another variable then the first must be a free variable and the
// second a bound variable in a zero-error equation where the first variable
// appears. It may then be possible to reduce the minimal resistance by 
// exchanging these variables. If this results in reduced resistance, the
// exchange takes place. Otherwise, the variable is moved to a position
// in the list corresponding to its resistance including satisfied or-group
// resistance. See some additional details in 
// 'reduceResistanceWithSatisfiedOrGroupVariable' and the Positioning
// document.
// These exchanges are continued as long as they are possible. This is 
// a 'resistance reduction' cycle.
//
// It seems that the algorithm can get caught in an infinite exchange
// loop at least in the presence of satisfied or-constraints (see example 
// in the 'Positioning' document). For this reason, the function has a counter
// which counts the steps performed by the ressitance reduction algorithm.
// Each free-bound exchange performed is stored together with the last step
// number at which it was performed. When the function reaches an
// exchange which was already performed and a loop trace was not yet started,
// it starts a loop trace marking the given exchange as the beginning of the
// loop. In addition to storing the beginning of the loop, the function also
// records the difference between the current step number and the step at
// which the exchange was last performed. It then continues to the next
// exchange and if that exchange was also already performed and the difference
// between the current step counter and the step at which the exchange
// was last performed is the same as for the previous exchange, the loop
// trace continues. Otherwise, loop tracing is either terminated (if the
// exchange is new) or the start of the loop trace is moved to the current
// exchange. When the loop trace returns to the start of the loop, the
// function knows it has detected a loop. While tracing the loop, the
// function also records the exchange where before the exchange the
// least ressitance variable has the lowest total resistance. When a loop
// is detected, it is continued until that variable is reached and there
// the function returns (providing the calling function with a 
// variablesByResistance list where the least resistance variable has the
// smallest possible resistance among all possibilities within the loop.
// In this case returns false. If the function terminates without
// detecting a loop, true is returned.  
//
// At the end of the resistance reduction cycle, the last variable in the
// 'variablesByResistance' list can be moved in the direction of error 
// reduction (see 'error reduction' below for details on how this is done).

// This function applies the above resistance reduction algorithm. When
// the function terminates, the last variable in 'variablesByResistance'
// can be used to reduce the error.

PosEquations.prototype.reduceResistance = posEquationsReduceResistance;

function posEquationsReduceResistance()
{
    // get the last variable in 'variablesByResistance'
    var node = this.variablesByResistance.last;

    if(!node)
        return true;
    
    var counter = 1; // step counter

    // list of free variables exchanged in this resistance reduction cycle.
    var wereExchanged = {};
    // when tracing a loop, the step of the first exchange in the loop
    var loopStart = undefined;
    // when tracing a loop, the difference between the last and current
    // counter of an exchange
    var loopDiff;
    // minimal resistance in the loop
    var minLoopResistance = Infinity;
    
    // continue looping until the resistance reduction process cannot 
    // be continued (see 'continueResistanceReduction' for the exact 
    // conditions)
    while(this.continueResistanceReduction(wereExchanged)) {
        
        // get the current least resistance variable
        var node = this.variablesByResistance.last;
        var variable = node.entry.variable;
        
        var boundVar = this.getResistingVar(node.entry, wereExchanged);

        if(wereExchanged[variable] && wereExchanged[variable][boundVar]) {
            
            if(this.doDebugging)
                this.debugMessage("variables already exchanged: ", variable, 
                                  " (free) and ", boundVar, " (bound)");
            // current counter difference
            var diff = counter - wereExchanged[variable][boundVar];
            
            if(loopStart == undefined || loopDiff != diff) {
                // start a new loop trace
                loopStart = counter;
                loopDiff = diff;
                minLoopResistance = node.sortVal[1];
            } else {
                // continue existing loop trace
                if(loopStart <= wereExchanged[variable][boundVar] &&
                   minLoopResistance == node.sortVal[1])
                    // already seen in the loop, and has minimal resistance
                    return false; // terminate
                
                // update minimal resistance
                if(minLoopResistance > node.sortVal[1])
                    minLoopResistance = node.sortVal[1];
            }
        } else {
            // stop loop tracing
            loopStart = undefined;
            minLoopResistance = Infinity;
        }
        
        // exchange the variable with the bound variable
        this.exchangeFreeAndBound(variable, boundVar);
        
        if(!wereExchanged[variable])
            wereExchanged[variable] = {};
        wereExchanged[variable][boundVar] = counter;
    }
    
    return true;
}

// This function checks the 'variablesByResistance' list to determine
// whether the resistance reduction process should be terminated.
// The function returns true if the process should continued and
// false if it should be terminated.
// The function receives as an argument the list of variable pairs
// (free, bound) already exchanged (the free variable is the attribute
// and under it appears a list of bound variables with which it was 
// exchanged (typically it should be exchanged only once, but this format
// guarantees completeness).

PosEquations.prototype.continueResistanceReduction = 
    posEquationsContinueResistanceReduction;

function posEquationsContinueResistanceReduction(wereExchanged)
{
    var node = this.variablesByResistance.last;
    
    if(!node)
        return false;
    
    // when optimizing, there is no need to reduce the total resistance
    // when the resistance of the variables themselves is higher or
    // equal to that of the optimization priority
    if(this.optimizationPriority != undefined &&
       this.optimizationPriority <= node.sortVal[0])
        return false;
    
    // as long as the total resistance (without satisfied or-groups) is 
    // greater than the resistance, can continue reducing the resistance. 
    if(node.sortVal[0] < node.sortVal[1])
        return true;
    
    var variable = node.entry.variable;
    var dir = this.errorDerivatives[variable] > 0 ? "down" : "up";
    
    // get the satisfied or-group resistance (if any)
    var satOrGroupRes = this.resistance.getSatOrGroupResistance(variable, dir);

    // We are done unless the least resistance variable has satisfied
    // or-group resistance which is higher than the resistance
    // under which it is registered in the list
    if(satOrGroupRes <= node.sortVal[0])
        return false;
    
    // check whether exchanging or suspending this variable allows
    // for further reduction of resistance.
    if(this.reduceResistanceWithSatisfiedOrGroupVariable(wereExchanged))
        return true; // continue with the current least resistance node
    
    // perhaps new least resistance node, so call this function recursively, 
    // to deal with this new node
    return this.continueResistanceReduction(wereExchanged);
}

// This function should be called when the least resistance variable in
// the 'variablesByResistance' list is registered with total resistance 
// equal to its own resistance and these are smaller than the satisfied
// or-group resistance of the variable (the actual total resistance
// may, in this case, be larger than the variable's own resistance but
// as long as it is not larger than the satisfied or-group resistance,
// the entry is registered to the 'variablesByResistance' table with
// the total resistance equal to the variable's own resistance - the
// the Position document for an explanation of this).
// The function does not check these conditions to exist - it assumes 
// the calling function did. The function then checks whether by 
// exchanging this variable with one of the bound variables in its satisfied
// or-group the resistance of some other variable can be reduced below the
// resistance of the current second variable in 'variablesByResistance' 
// (if any) and below the resistance of the exchanged variable including the
// satisfied or-group resistance. If this can be done, the 'maxResistingVar'
// on the node entry of the least resistance variable is changed to be
// the bound variable in the equation which should be exchanged and 'true' 
// is returned. Otherwise, false is returned.
//
// Whether an exchange is scheduled or not, let x be the satisfied or-group 
// variable which will be free after this step (the input variable, 
// currently free, if no exchange takes place; the bound variable to be 
// exchanged, if an exchange will take place). The function places x in 
// the 'satOrGroupVariables' table. If x is currently free its position 
// in 'variableByResistance' is changed to that based on its resistance 
// including the satisfied or-group resistance.  
//
// The function only needs to consider resistance which is lower than
// the satisfied or-group resistance (of the variable being exchanged)
// the resistance of the next element in the 'variablesByResistance'
// list (if such a variable exists) and the optimization priority
// (if this is an optimization step).
//
// If the variable for which the resistance can be reduced by the exchange 
// is a blocked variable with a priority higher or equal the current 
// optimization priority (if in an optimization step) then there is no need
// to consider it as a possible reduced resistance variable. This is because
// its status as a blocked variable means that there is no sequence
// of exchanges which can allow it to be moved (in either direction)
// without violating a constraint of a priority at least equal to the
// blocking priority. 
//
// Finally if the variable was already exchanged once in the resistance
// reduction cycle, it will not be considered for resistance reduction
// (having been exchanged, we know it was already considered by the algorithm 
// with the lower resistance direction).

PosEquations.prototype.reduceResistanceWithSatisfiedOrGroupVariable = 
    posEquationsReduceResistanceWithSatisfiedOrGroupVariable;

function posEquationsReduceResistanceWithSatisfiedOrGroupVariable(exchanged)
{
    var node = this.variablesByResistance.last;
    var variable = node.entry.variable;
    
    // calculate an upper bound for the resistance which should be considered.
    
    var dir = this.errorDerivatives[variable] > 0 ? "down" : "up";
    var satOrGroupRes = this.resistance.getSatOrGroupResistance(variable, dir);
    var upperBound = satOrGroupRes;
    
    var prevNode = node.prev;
    
    if(prevNode && prevNode.sortVal[0] < upperBound)
        upperBound = prevNode.sortVal[0];
    
    if(this.optimizationVar != undefined && 
       this.optimizationPriority < upperBound)
        upperBound = this.optimizationPriority;
    
    // get the list of equations in which the bound variable satisfies the
    // same or-group as this variable. Under the assumptions of this function,
    // this list is not empty
    var equations = 
        this.resistance.getResistingEqsOfSatOrGroupsForVar(variable);
    
    // check for the minimal resistance reached on another free variable
    // when exchanging 'variable' in one of these equations. 
    
    var minResistance = Infinity;
    var minVar;
    var minEqId;
    
    for(var eqId in equations) {
        
        var boundVar = this.boundVarsByEq[eqId];
        var variableValue = this.equations.getValue(eqId, variable);
        var equation = this.equationVecs[eqId];

        // loop over the variables in the equation and check their resistance
        // after an exchange between the free variable ('variable') and the
        // bound variable.
        
        for(var i = 0, l = equation.length ; i < l ; ++i) {
            
            var entry = equation[i];
            var freeVar = entry.name;
            
            if(freeVar == variable || freeVar == boundVar)
                continue;
            
            if(exchanged[freeVar] != undefined)
                continue; // was already considered
            
            if(this.resistance.getMinResistance(freeVar) >= upperBound)
                continue;
            
            // In an optimization step, if the variable is blocked with a
            // priority higher or equal the optimization priority, there is no
            // need to consider it (see explanation above)
            if(this.optimizationVar != undefined &&
               this.isBlocked(freeVar, this.optimizationPriority))
                continue;
            
            var currentDerivative = this.errorDerivatives[freeVar];
            
            if(!currentDerivative)
                currentDerivative = 0; // may have been undefined
            
            // the derivative after the exchange (see Positioning document)
            var newDerivative = currentDerivative - 
                this.errorDerivatives[variable] * 
                entry.value / variableValue;
            
            // is the new derivative zero (after rounding)?
            if(currentDerivative && 
               Math.abs(newDerivative / currentDerivative) < this.zeroRounding)
                continue; // must be zero
            
            if(currentDerivative * newDerivative > 0)
                continue; // no direction change, resistance remains the same
            
            // check the resistance in the new direction
            var newResistance = this.resistance.
                getResistance(freeVar, newDerivative > 0 ? "down" : "up");
	
            if(newResistance < minResistance) {
                minResistance = newResistance;
                minEqId = eqId;
                minVar = freeVar;
            }
        }
    }
    
    if(minResistance >= upperBound) {
        // add the variable to 'satOrGroupVariables' and move its position
        // in 'variablesByResistance' to the position based on the resistance
        // including satisfied or-groups. If, as a result, the minimal
        // resistance in 'variablesByResistance' changes, we need to calculate
        // total resistance for the minimal resistance variables
        var prevResistance = this.resistance.getResistance(variable, dir);
        this.addToSatOrGroupVariables(variable);
        this.variablesByResistance.insert({ variable: variable }, [variable], 
                                          [satOrGroupRes, satOrGroupRes]); 
        if(this.variablesByResistance.last.sortVal[0] > prevResistance &&
           this.variablesByResistance.last.entry.variable != variable)
            this.refreshTotalForVariablesByResistance();
        return false;
    } else {
        // exchange the satisfied or-group variables. Set the bound variable of
        // the equation to be exchanged as the 'resistingVar' of the node entry
        node.entry.resistingVar = this.boundVarsByEq[minEqId];
        // add the bound variable to the 'satOrGroupVariables' table
        this.addToSatOrGroupVariables(this.boundVarsByEq[minEqId]);
        return true;
    }
}

// Given a node entry in the variablesByResistance and the list of variables
// already exchanged (the attribute is the free variable and the value is
// a list of bound variables with which it was exchanged) this function
// determines which resisting variable to use as the bound variable for 
// the exchange of the free variable represented by the given node entry.
// If the resistance is not due to a satisfied or-group, the variable recorded
// on the node entry as the resisting variable is used. If the resistance is
// due to a satisfied or-group, the function takes as the resisting variable
// one of the variables in the or-group which was not yet exchanged
// (if the variable was already exchanged, this means that it was already
// free and the system decided to make it bound, so it is better not to
// make it free again, to a void a possible infinte loop). If no such 
// variable can be found, one of the bound variables which satisfies
// the or-group is returned.

PosEquations.prototype.getResistingVar = posEquationsGetResistingVar;

function posEquationsGetResistingVar(varNodeEntry, exchanged)
{
    var group = varNodeEntry.resistingOrGroup;
    
    // is resistance due to a satisfied or-group?
    if(group == undefined ||
       this.posCalc.orGroups.getGroupStatus(group) != "satisfied")
        return varNodeEntry.resistingVar;
    
    // resistance is due to a satisfied or-group. Get a variable which
    // satisfies the or-group which is not free and does not appear in the
    // 'exchanged' list.
    
    var satisfied = this.posCalc.orGroups.getSatisfiedVariables(group);
    var first = undefined;
    
    for(var variable in satisfied) {
        
        if(this.boundVars[variable] == undefined)
            continue; // a free variable
        
        if(first == undefined)
            first = variable;
        
        if(!exchanged[variable])
            return variable;
    }
    
    return first;
}

// Given a free variable 'freeVar' and a bound variable 'boundVar'
// (which appear in the same equation) this function makes the free variable
// the bound variable in the equation in which the bound variable was
// previously bound (the bound variable becomes free).
// This function does not check that the bound variable is indeed bound or
// that the free variable indeed appears in the equation where the bound
// variable is bound. As this function is for internal use only, it is assumed
// that the calling function has already verified that the exchange is
// possible.

PosEquations.prototype.exchangeFreeAndBound =
    posEquationsExchangeFreeAndBound;

function posEquationsExchangeFreeAndBound(freeVar, boundVar)
{
    var eqId = this.boundVars[boundVar];

    // apply Gaussian elimination to the free variable, to make it
    // the bound variable in this equation. Update the bound variable.
    delete this.boundVars[boundVar];
    this.boundVars[freeVar] = eqId;
    this.boundVarsByEq[eqId] = freeVar;
    this.eliminate(freeVar, eqId);

    // refresh or-group and total resistance as a result of this exchange
    this.resistance.refreshAfterBoundVarChange(freeVar, boundVar);
    
    // refresh resistance after the exchange (before recalculating the
    // derivatives, as in an optimization step the derivative may depend
    // on resistance because blocked variables are excluded from the 
    // derivative).
    this.refreshResistanceAfterExchange(boundVar, freeVar);

    // adjust the error derivatives (in principle, whether in an
    // optimization step or not, the formula should be the same, but in
    // an optimization step we have a 'fake' error, so it is easier to
    // calculate the derivatives directly, moreover 'blocked' variables
    // are removed from the error derivative in the optimization step).
    if(this.optimizationVar != undefined)
        this.calcOptimizationErrorDerivatives(this.optimizationVar,
                                              this.optimizationPriority,
                                              this.optimizationDir);
    else
        // (see Positioning document for explanation of this formula).
        this.addEquationToErrorDerivatives(eqId,
                                           -this.errorDerivatives[freeVar]/
                                           this.equations.getValue(eqId, 
                                                                   freeVar));
    // force the new bound variable's derivative to be zero (it should
    // be zero, but because of real arithmetic inaccuracies may be
    // small and non-zero).
    delete this.errorDerivatives[freeVar];    
    
    // update the list of variables (with non-zero derivative) sorted 
    // by resistance.
    this.updateErrorReducingResistanceAfterExchange(freeVar);
    
    // after refreshing the error reducing resistance, can clear 
    // the resistance changes
    this.resistance.clearResistanceChanges();

    // since the bound variable changed, the equation should be considered 
    // changed for the purpose of optimization blocking refresh.
    this.changedEquations[eqId] = true;
    // refresh the optimization suspension of all equations which changed
    this.updateOptimizationSuspensionOfChangedEquations();
    this.changedEquations = {}; // clear the list of changed equations
    
    if(this.doDebugging) {
        this.debugIncCounter("free-bound exchange");
        this.debugMessage("exchanged free variable ",
                          this.debugGetVarStr(freeVar), " with bound ",
                          this.debugGetVarStr(boundVar), " in eq. ",
                          eqId);
        this.debugRecord("after free-bound exchange",
                         ["derivatives", "resistance",
                          "variablesByResistance",
                          "zero-error-equations"]);
    }
}

///////////////////////////////////
// Error reduction (single step) //
///////////////////////////////////

// This function performs a single error reduction step. First, it reduces
// the error reduction resistance (by calling 'reduceResistance'). It then
// moves the last variable in the 'variablesByResistance' list
// (this is the variable with least resistance and total resistance)
// in the error reduction direction. The variable is moved until the first
// of the following happens:
// 1. The variable hits a segment constraint.
// 2. One of the bound variables which moves with this variable hits
//    a segment constraints.
// 3. In one of the non-zero error equations the error is reduced to
//    zero.
// Having determined the size of the move, the move is performed and
// the resistance of the influenced variables is updated.
// The inner products of the solution and the equations are updated
// automatically when the solution is changed. However, because of
// fixed arithmetic inaccuracies, the inner product may not be zero
// even when it should have been zero. Therefore, this function also
// forces the inner product of zero error equations to be exactly zero.
//
// During an optimization step, the error reduction step will be carried
// out only if the resistance to the move is strictly smaller than the
// optimization priority.
//
// The function returns 'true' if the error was reduced, 0 if there was no
// error to reduce (this happens only in the case of an infinite optimization
// target), 'false' if the error could not be reduced (because
// of resistance priority or because there were no variables to move) and
// -1 if the resistance reduction process failed to reduce the resistance
// and as a result the error could not be reduced. 

PosEquations.prototype.reduceError = posEquationsReduceError;

function posEquationsReduceError()
{
    // did the resistance reduction process find the minimal resistance?
    var minimalResistance = true;
    
    if(!this.reduceResistance())
        minimalResistance = false;
    
    // get the variable to move
    var node = this.variablesByResistance.last;
    
    if(!node) {
        if(this.doDebugging)
            this.debugMessage("no more variables to move");
        return false; // no variable to move (all may be blocked)
    }
    
    // in an optimization step, only reduce the error if the move has
    // lower resistance than the priority of the optimization.
    if(this.optimizationPriority != undefined &&
       this.optimizationPriority <= node.sortVal[1]) {
        if(this.doDebugging) {
            this.debugIncCounter("failed optimization move");
            this.debugMessage("cannot move: optimization priority (",
                              this.optimizationPriority, ") ",
                              "smaller or equals least resistance variable (",
                              this.debugGetVarStr(node.entry.variable),
                              "): ", objToString(node.sortVal));
        }
        return minimalResistance ? false : -1;
    }
    
    var moveVar = node.entry.variable;
    var derivative = this.errorDerivatives[moveVar];
    var value = this.solution[moveVar];
    
    // value to move to based on the moved variable's own constraints
    var selfMoveTo = this.moveAllowedByVar(moveVar, derivative < 0);
    var selfMove = selfMoveTo - value; // may be infinite
    // the move size allowed by the equations in which the variable appears
    var inducedMove = this.inducedMaxMove(moveVar);
    var tightEq;
    var move;
    
    if(this.optimizationVar == undefined) {
        // Feasible solution step - correct the value of the error derivative. 
        if(derivative * inducedMove.exactDerivative <= 0) {
            if(this.doDebugging)
                this.debugMessage("Incorrect derivative (variable ", moveVar, 
                                  ": ", derivative, " should be ", 
                                  inducedMove.exactDerivative, 
                                  "). Correcting.");
            // incorrect derivative. Correct all derivatives and quit 
            // the error reduction step
            this.initializeErrorDerivatives();
            this.recalcAllErrorReducingResistance();
            return true;
        }
    }

    if(Math.abs(selfMove) < Math.abs(inducedMove.move))
        move = selfMove;
    else {
        move = inducedMove.move;
        tightEq = inducedMove.tightEq;
    }
    
    if(move == -Infinity || move == Infinity) {
        if(this.optimizationVar == undefined) {
            mondriaInternalError("unbound move in feasible solution step");
        } else if(Math.abs(this.optimizationTarget) == Infinity) {
            // in an optimization step where the target is infinite,
            // this means that the target was reached
            this.debugMessage("unbound optimium reached, not moving");
        } else {
            // bound optimization but move is unbound - an error
            mondriaInternalError("unbound move in bound optimization");
        }
        
        return 0;
    }
    
    if(this.doDebugging) {
        this.debugIncCounter("variable moved");
        this.debugMessage("moving variable ", this.debugGetVarStr(moveVar),
                          (this.boundVars[moveVar] ? " (bound)" : " (free)"),
                          " by ", move);
    }
    
    // apply the move
    this.applyMove(moveVar, move, move == selfMove ? selfMoveTo : undefined,
                   tightEq);
    
    return true;
}

// This function calculates the maximal move for the given variable ('moveVar')
// as dictated by the equations which the variable appears in. The equations
// can restrict the movement of the variable in the direction of error
// reduction in one of two ways:
// 1. If the equation has an error, the move must stop when the error
//    in the equation is reduced to zero.
// 2. If the equation has zero error, the move is restricted by the induced
//    move in the bound variable of the equation. This variable can move until
//    the bound variable hits a segment constraint.
// The total move allowed by the equations is the minimal move allowed
// by any of the equations. The function returns an object of the form:
// {
//    move: <the allowed move>
//    tightEq: {
//       <equation ID>: "no error" | <bound variable next value>
//    }
//    exactDerivative: <the exact derivative for this variable>
// }
// The 'move' field holds the move allowed by the equation. The 'tightEq'
// field holds an object whose attributes are the IDs of the equations
// which tightly bound this move. For equations which have an error the value
// under the equation ID is "no error" while for zero error equations
// the value is the value to which the bound variable should be moved
// as a result of the allowed move.
// As a by-product of this calculation, this function also returns the
// 'exactDerivative' which is the error derivative calculated for the 
// moved variable directly from the equations (the error derivative 
// stored on the errorDerivatives vector is the result of an incremental
// calculation and may be inaccurate).
// This function simply returns the exact derivative value, without taking
// any action if this does not agree with the currently stored value
// of the derivative (it is up to the calling function to decide what to
// do with this).

PosEquations.prototype.inducedMaxMove = posEquationsInducedMaxMove;

function posEquationsInducedMaxMove(moveVar)
{
    var derivative = this.errorDerivatives[moveVar];
    var exactDerivative = 0;

    var result = {
        tightEq: {},
        move: derivative > 0 ? -Infinity : Infinity
    };
    
    var componentIndex = this.equations.combinationComponentIndex(moveVar);
    var _self = this;
    componentIndex.forEach(function(e,eqId) {
        
        var eqMove;
        // value to insert into the 'tightEq' table for this equation
        var tightVal;
        
        var innerProduct = _self.innerProducts[eqId];
        var eqCoefficient = e.value;
        
        if(innerProduct) {
            // equation with error
            
            if(innerProduct > 0)
                exactDerivative += eqCoefficient;
            else
                exactDerivative -= eqCoefficient;
            
            eqMove = -innerProduct / eqCoefficient;
            if(eqMove * derivative > 0)
                // movement in direction opposite to the error reduction
                // direction of the variable (possible).
                return;
            tightVal = "no error";
        } else {
            var boundVar = _self.boundVarsByEq[eqId];
            var boundVarValue = _self.equations.getValue(eqId, boundVar);
            var increase =
                (eqCoefficient * boundVarValue * derivative) > 0;
            // equation without error, get the maximal move allowed by
            // the bound variable of the equation
            tightVal = _self.moveAllowedByVar(boundVar, increase);
            eqMove = - boundVarValue*(tightVal - _self.solution[boundVar]) /
                eqCoefficient;
        }
        
        if(eqMove == result.move) {
            result.tightEq[eqId] = tightVal;
        } else if(Math.abs(eqMove) < Math.abs(result.move)) {
            result.move = eqMove;
            result.tightEq = {};
            result.tightEq[eqId] = tightVal;
        }
    });
    
    result.exactDerivative = exactDerivative;
    
    return result;
}

// This function moves the value of 'moveVar', the variable selected for
// movement. It moves the value by 'move'. If the bound on movement was
// specified by the constraints on the variable itself, 'moveTo' is
// the value to which the value of the variable should be moved. Otherwise
// 'moveTo' is undefined (in principle, <current value> + move = moveTo
// but to avoid fixed point arithmetic errors, we set the value to
// 'moveTo' directly rather than by addition of 'move').
// If the bound on the movement was the result of one of the equations,
// the 'tightEq' object holds the information about these equations
// (as returned by the function 'inducedMaxMove()'). Otherwise,
// 'tightEq' is undefined. At least one of 'moveTo' and 'tightEq'
// should be defined and possibly both are defined.
// This function moves the variable 'moveBar' and any bound variables which
// should move together with it

PosEquations.prototype.applyMove = posEquationsApplyMove;

function posEquationsApplyMove(moveVar, move, moveTo, tightEq)
{
    // move the bound variables of the zero error equations. Record
    // this list of equations.
    var zeroErrorEqs = {};
    // list of equations where the error becomes zero as a result of this move.
    // Under each equation ID, record the error before the move.
    var errorBecameZero = {};
    var movedBound = {}; //bound variable which were moved
    
    var componentIndex = this.equations.combinationComponentIndex(moveVar);
    var _self = this;
    componentIndex.forEach(function(e, eqId) {
        
        if(_self.innerProducts[eqId]) {
            // may have become zero
            errorBecameZero[eqId] = _self.innerProducts[eqId];
            return;
        }

        zeroErrorEqs[eqId] = true;
        var boundVar = _self.boundVarsByEq[eqId];

        if(tightEq && tightEq[eqId] != undefined &&
           tightEq[eqId] != "no error")
            _self.setSolution(boundVar, tightEq[eqId]);
        else
            _self.addToSolution(boundVar,
                               -move * (e.value /
                                        _self.equations.getValue(eqId, 
                                                                boundVar)));

        movedBound[boundVar] = true;
    });

    // move the variable value itself
    if(moveTo != undefined)
        this.setSolution(moveVar, moveTo);
    else
        this.addToSolution(moveVar, move);

    // recalculate resistance and total resistance

    // first, update group resistance
    this.updateOrGroupSatisfaction(moveVar);
    for(var boundVar in movedBound)
        this.updateOrGroupSatisfaction(boundVar);
        
    // next, calculate the resistance itself (this will also handle
    // total resistance dependent on the resistance of these variables)
    this.resistance.calcResistance(moveVar, this.solution[moveVar]);
    // recalculate the resistance of the bound variables (this triggers
    // the calculation of the total resistance of other variables in the
    // same equation, if needed.
    for(var boundVar in movedBound)
        this.resistance.calcResistance(boundVar, this.solution[boundVar]);
    
    // make sure the error in zero error equations remains zero (this
    // corrects fixed point arithmetic errors).
    for(var eqId in zeroErrorEqs)
        this.innerProductObj.setToZero(eqId);
    
    // error derivative sign changes caused by the derivative vector update
    // below.
    var signChanges = {};
    
    // loop over equations whose error became zero
    for(var eqId in errorBecameZero) {

        if(this.innerProducts[eqId] &&
           (!tightEq || tightEq[eqId] != "no error") && 
           this.innerProducts[eqId] * errorBecameZero[eqId] > 0)
            continue; // did not actually become zero
        
        if(this.doDebugging)
            this.debugMessage("equation ", eqId, " error became 0");
        
        // just in case of fixed point arithmetic error
        this.innerProductObj.setToZero(eqId);
        // remove this equation from the error derivative sum
        this.addEquationToErrorDerivatives(eqId,
                                           errorBecameZero[eqId] > 0 ? -1 : 1,
                                           signChanges);
        // refresh or-group and total resistance
        this.resistance.refreshAfterBoundVarAdded(this.boundVarsByEq[eqId]);
    }
    
    // refresh resistance of variables whose total resistance may have changes
    // or whose error derivative changed sign.
    this.refreshResistanceAfterMove(signChanges);
}

// This function returns the maximal move allowed for the given variable
// beginning from its current value. If 'increase' is true, the movement
// increases the value of the variable and otherwise, decreases it.
// The movement is bound by the first of the three following bounds:
// 1. The next segment constraint hit by the value (in the direction of
//    movement).
// 2. If this is an optimization step and the variable moved is the
//    optimized variable and the optimization is for a segment constraint
//    violation, then the value of the violated constraint.
// The function returns the value to which the variable can be moved.
// This may be +/-Infinity.

PosEquations.prototype.moveAllowedByVar =
    posEquationsMoveAllowedByVar;

function posEquationsMoveAllowedByVar(variable, increase)
{
    var value = this.solution[variable];
    
    // calculate the size of the move

    var nextVal;
    
    // get the next segment constraint to be hit when moving in the given
    // direction
    var nextVal =
        this.segmentConstraints.nextValue(variable, value, !increase);

    // if optimizing for a violated constraint on this variable, then move
    // no further than the value of the violated constraint (if any)
    if(variable == this.optimizationVar &&
       ((increase && this.optimizationTarget < nextVal) ||
        (!increase && this.optimizationTarget > nextVal)))
        nextVal = this.optimizationTarget;
    
    return nextVal;
}

//////////////////////////////////
// Errors and Error Derivatives //
//////////////////////////////////

// This function updates the vector which defines the derivative of the
// total error (the sum of the absolute values of the equation errors)
// relative to each variable. The function adds the given equation vector
// multiplied by the given scalar to the derivative vector.
// If an object 'signChanges' is given, the function records in
// it those variables for which the sign of the error derivative changed.
// Changing from non-zero to zero or from zero to non-zero would also count
// as a sign change.
// As the 'signChanges' may be accumulated across several applications of
// this function, the 'signChanges' object is not necessarily empty
// when this function is called.

PosEquations.prototype.addEquationToErrorDerivatives =
    posEquationsAddEquationToErrorDerivatives;

function posEquationsAddEquationToErrorDerivatives(equationId, scalar,
                                                   signChanges)
{
    if(!scalar)
        return;

    var vector = this.equationVecs[equationId];

    for(var i = 0, l = vector.length ; i < l ; ++i) {

        var entry = vector[i];
        var variable = entry.name;

        var prevVal = this.errorDerivatives[variable];
        var value;
        
        if(!prevVal)
            value = this.errorDerivatives[variable] = entry.value * scalar;
        else {
            value = this.errorDerivatives[variable] += entry.value * scalar;
            
            // round to zero if necessary
            if(Math.abs(value/prevVal) < this.zeroRounding)
                value = 0;
        }
        
        if(!value) {
            delete this.errorDerivatives[variable];
            if(signChanges && prevVal)
                signChanges[variable] = true;
        } else if(signChanges &&
                  (prevVal == undefined || value * prevVal <= 0))
            signChanges[variable] = true;
    }
}

////////////////////////////
// Resistance Calculation //
////////////////////////////

// Perform all pending resistance calculations and update optimization
// suspension which is affected by violated or-group changes.

PosEquations.prototype.calcAllPendingResistance =
    posEquationsCalcAllPendingResistance;

function posEquationsCalcAllPendingResistance()
{
    // store the violated or group changes which may effect total resistance
    var violatedOrGroupChanges =
        this.resistance.needRecalcTotalForViolatedOrGroups;
    
    this.resistance.calcAllPending();

    for(var variable in violatedOrGroupChanges)
        this.optimizationBlockingAfterViolatedOrGroupChange(variable);
}

// Given a variable, this function checks whether any or-group constraints
// are defined on this variable and if yes, calculates the or-group
// satisfaction on the variable (the results are stored on the OrGroups
// object, to be used later).

PosEquations.prototype.updateOrGroupSatisfaction =
    posEquationsUpdateOrGroupSatisfaction;

function posEquationsUpdateOrGroupSatisfaction(variable, stableValue)
{
    if(!this.segmentConstraints.variableHasOrGroups(variable))
        return; // no or-groups

    if(stableValue == undefined)
        stableValue = this.resistance.getStableValue(variable);
    
    this.posCalc.orGroups.
        updateVariableSatisfaction(variable, this.solution[variable],
                                   stableValue);
}

// This function reads the list of resistance changes and violation
// changes from the Resistance objects and updates optimization
// suspension and violations which may be affected by these changes.
// This function does not clear the changes lists of the Resistance
// object.

PosEquations.prototype.updateViolationsAfterResistanceChanges =
    posEquationsUpdateViolationsAfterResistanceChanges;

function posEquationsUpdateViolationsAfterResistanceChanges()
{
    for(var variable in this.resistance.resistanceChanged)
        // check whether this resistance change has any effect on the
        // suspension of optimization
        this.optimizationBlockingAfterResistanceChange(variable);
    
    for(var variable in this.resistance.satOrGroupResistanceChanged) {
        
        if(this.resistance.resistanceChanged[variable])
            continue; // already checked above

        // check whether this resistance change has any effect on the
        // suspension of optimization
        this.optimizationBlockingAfterResistanceChange(variable);
    }
    
    for(var variable in this.resistance.violationChanged)
        // refresh the violations of this variable
        this.refreshViolation(variable);
}

// This function is given a variable and a direction and it calculates
// the resistance and total resistance values which should be used for 
// inserting the variable into the variablesByResistance table. 
// First, the function gets the total resistance for this variable.
// If 'recalc' is false, it uses whatever value was already calculated
// by the Resistance object. If 'recalc' is true, the total resistance
// is calculated (if necessary). This would also calculate the 
// resistance due to satisfied or-groups (if necessary).
// The function then modifies the returned total resistance object to 
// return an entry which gives the total resistance as should be used 
// for insertion into the 'variablesByResistance' table. The returned 
// object has the form (identical to the standard total resistance entry)
// {
//    resistance: <resistance>
//    total: {
//       resistance: <resistance>
//       resistingVar: <variable or undefined>
//    }
// }
// If the variable has satisfied or-group resistance and appears in the
// 'satOrGroupVariables' table, the maximum of its resistance and 
// satisfied or-group resistance is returned as the 'resistance'. Otherwise,
// the variable's own resistance is returned in 'resistance'.
// The 'total' fields return the total resistance to be used.
// If the total resistance entry is not defined (this happens if the variable 
// is bound) or if the total resistance is less or equal to the satisfied 
// or-group resistance, a total resistance equal to the 'resistance'
// field is returned. In this case, no resisting
// variable is assigned. Otherwise, the total resistance and resisting 
// variable as given by 'total' is returned.
// See the Positioning document for an explanation for this.

PosEquations.prototype.calcErrorReducingResistanceAndTotal =
    posEquationsCalcErrorReducingResistanceAndTotal;

function posEquationsCalcErrorReducingResistanceAndTotal(variable, dir, recalc)
{
    // get total resistance. This may return 'undefined' if 'variable' is bound
    // or if 'recalc' is false. This is treated as a total resistance equal 
    // to the variable's own resistance.
    var total = this.resistance.getTotalResistance(variable, 
                                                   recalc ? dir : undefined);

    // get the resistance, including satisfied or-group resistance
    var satResistance = 
        this.resistance.getResistanceWithSatOrGroups(variable, dir);
    
    // resistance to be used
    var resistance = 
        (this.satOrGroupVariables && this.satOrGroupVariables[variable]) ?
        satResistance : this.resistance.getResistance(variable, dir);
    
    var result = { resistance: resistance };
    
    if(total && total.resistance > satResistance) {
        result.total = total;
    } else
        result.total = { resistance: resistance };
    
    return result;
}

// This function creates/refreshes the entry of the given variable in
// the variablesByResistance table. It receives the variable and the
// direction ('dir') in which the resistance needs to be calculated.
// In addition, it optionally receives the 'sortVal' and 'entry' properties
// of the variable's current node in the variablesByResistance table.
// If these are given (they must both be given in that case) the function
// first checks whether there is any change to the node of the given variable.
// If there is no change, the function exits. Otherwise, the node (and its
// position in the list) is updated.
// If 'recalc' is false, the function does not recalculate total resistance
// and or-group resistance. If 'recalc' is true, these are recalculated
// (if necessary).
// The function returns the resistance with which the variable was inserted
// into the variablesByResistance list.

PosEquations.prototype.updateErrorReducingResistanceAndTotal = 
    posEquationsUpdateErrorReducingResistanceAndTotal;

function posEquationsUpdateErrorReducingResistanceAndTotal(variable, dir,
                                                           entry, sortVal, 
                                                           recalc)
{
    var resistances = 
        this.calcErrorReducingResistanceAndTotal(variable, dir, recalc);
    var total = resistances.total;
    
    if(entry && sortVal[0] == resistances.resistance && 
       sortVal[1] == total.resistance && 
       entry.resistingVar == total.resistingVar &&
       entry.resistingOrGroup == total.resistingOrGroup)
        return resistances.resistance; // nothing to do
    
    // construct a new entry
    
    entry = { variable: variable };
    
    if(total.resistingVar != undefined)
        entry.resistingVar = total.resistingVar;
    
    if(total.resistingOrGroup != undefined)
        entry.resistingOrGroup = total.resistingOrGroup;
    
    // add variable to list
    this.variablesByResistance.insert(entry, [variable],
                                      [resistances.resistance, 
                                       total.resistance]);
    
    return resistances.resistance;
}

// This function reads from the resistance tables the resistance and
// total resistance of the given variable in the direction of error reduction.
// It then inserts this result into the 'variablesByResistance' table
// (under the sort value (resistance, total resistance)).
// If the variable appears in the 'satOrGroupVariables' table then the variable
// is inserted with the resistance due to satisfied or-groups rather than
// with its own resistance and the total resistance. 

PosEquations.prototype.calcErrorReducingResistance =
    posEquationsCalcErrorReducingResistance;

function posEquationsCalcErrorReducingResistance(variable)
{
    if(!this.errorDerivatives[variable] && this.optimizationVar != undefined) {
        // If this is an optimization step then the variable might not appear
        // in the derivative vector because it was previously blocked. But
        // after resistance recalculation it may not be blocked anymore,
        // so we need to check whether it should be added to the derivative
        // again.
        this.calcOptimizationErrorDerivatives(this.optimizationVar,
                                              this.optimizationPriority,
                                              this.optimizationDir, variable);
    }

    var derivative = this.errorDerivatives[variable];

    if(!derivative) {
        // zero derivative - no error reduction movement
        this.removeErrorReducingResistance(variable);
        return;
    }

    var dir = this.errorDerivatives[variable] > 0 ? "down" : "up";
    
    // create/update the variable's node in the variablesByResistance list.
    // No recalculation of total and or-group resistance is required here
    // (this will happen later, for the least resistance variables).
    this.updateErrorReducingResistanceAndTotal(variable, dir,
                                               undefined, undefined, false);
}

// This function goes over the variables in the variablesByResistance
// list with the lowest resistance (the last variables in the list).
// For these variables, if the variables did not have their total
// resistance calculated yet (or if the total resistance needs to be
// calculated in the opposite direction than before), the function requests
// their total resistance to be calculated (the calculation is immediate)
// and then stores this resistance on the variables' entries
// in variablesByResistance (the variables then get sorted by this
// resistance). When the total resistance is calculated, the satisfied
// or-group resistance is also calculated. As a result, the resistance
// under which the variable appears in the variablesByResistance list
// may also increase. If as a result of this there are no more variables
// left at the minimal resistance level, the function is repeated (for
// the variables which are currently the least resistance variables).
// 
// After refreshing the variablesByResistance list, this function refreshes
// the list of variables for which the total resistance (and satisfied or-group
// resistance needs to be calculated). This includes all variables with
// minimal resistance in the list and all variables in the satOrGroupVariables
// table. For all other variables any request to calculate the total
// resistance is removed.

PosEquations.prototype.refreshTotalForVariablesByResistance =
    posEquationsRefreshTotalForVariablesByResistance;

function posEquationsRefreshTotalForVariablesByResistance()
{
    // list of variables with the least resistance in the list.
    var leastResVars = {};
    var minResistance = undefined;
    
    var node = this.variablesByResistance.last;
    
    if(node) {
        
        minResistance = node.sortVal[0];
        
        while(node) {
            
            if(node.sortVal[0] != minResistance)
                break;
            
            // store the entry and total resistance, to be used below
            leastResVars[node.entry.variable] = node;
            
            node = node.prev;
        }
    }
    
    if(minResistance == undefined)
        return; // empty list, nothing to do
    
    // calculate and set the total resistance of the variables with the
    // least resistance
    
    for(var variable in leastResVars) {
        
        var node = leastResVars[variable];
        var dir = this.errorDerivatives[variable] > 0 ? "down" : "up";
        
        var resistance =
            this.updateErrorReducingResistanceAndTotal(variable, dir,
                                                       node.entry,
                                                       node.sortVal, true);
        
        // if the resistance increased as a result of this step (can happen
        // only if the variable is in 'satOrGroupVariables') remove the
        // variable from 'leastResVars'.
        if(resistance > minResistance)
            delete leastResVars[variable];
    }
    
    if(isEmptyObj(leastResVars)) {
        // resistance of all variables was increased, repeat the function
        this.refreshTotalForVariablesByResistance();
        return;
    }

    // add variables in 'satOrGroupVariables' to the list of variable
    if(this.satOrGroupVariables)
        for(var variable in this.satOrGroupVariables)
            leastResVars[variable] = true;
    
    // remove total resistance calculation for all other variables
    this.resistance.removeAllTotalResistanceVariablesExcept(leastResVars);
}

// This function clears the 'variablesByResistance' list (and the 
// satOrGroupVariables table) and then adds all variables with a non-zero
// error derivative to the 'variablesByResistance' (using their 
// resistance without satisfied or-groups). This function also calculates
// the total resistance of all variables with the minimal resistance in 
// 'variablesByResistance'. 

PosEquations.prototype.recalcAllErrorReducingResistance = 
    posEquationsRecalcAllErrorReducingResistance;

function posEquationsRecalcAllErrorReducingResistance()
{
    this.variablesByResistance.clear();
    delete this.satOrGroupVariables;
    
    for(var freeVar in this.errorDerivatives)
        this.calcErrorReducingResistance(freeVar);
    
    this.refreshTotalForVariablesByResistance();
}

// This function should be called to remove the entry of the given variable
// from the 'variablesByResistance' table. It is then also removed from
// the 'satOrGroupVariables' table and if total resistance calculation was
// requested for it, this request is also removed.

PosEquations.prototype.removeErrorReducingResistance = 
    posEquationsRemoveErrorReducingResistance;

function posEquationsRemoveErrorReducingResistance(variable)
{
    this.variablesByResistance.remove(variable);
    this.deleteFromSatOrGroupVariables(variable);
    this.resistance.removeTotalResistanceVariable(variable);
}

// This function refreshes the resistance to movement in the resistance
// reducing direction after exchanging 'freeVar' with 'boundVar'
// (these are, respectively, free and bound when this function is called,
// that is, after the exchange).
// The function refreshes the resistance to movement in the error reducing
// direction for all variables which appear in the equation where the
// exchange took place (this is the equation where the bound variable is
// bound in).

PosEquations.prototype.refreshResistanceAfterExchange =
    posEquationsRefreshResistanceAfterExchange;

function posEquationsRefreshResistanceAfterExchange(freeVar, boundVar)
{
    // perform any pending total resistance calculations
    this.calcAllPendingResistance();

    // no violation could have changed by the exchange, but the function below
    // also takes care of optimization suspension, which may have changed
    // as a result of the exchange
    this.updateViolationsAfterResistanceChanges();
}    

// This function is called after a free-bound exchange and after the 
// resistance changes and error derivative changes have already been
// calculated. It then updates the 'variablesByResistance' list.

PosEquations.prototype.updateErrorReducingResistanceAfterExchange = 
    posEquationsUpdateErrorReducingResistanceAfterExchange;

function posEquationsUpdateErrorReducingResistanceAfterExchange(boundVar)
{
    // the equation where the exchange took place
    var exchangeEqId = this.boundVars[boundVar];
    var exchangeEq = this.equationVecs[exchangeEqId];
    
    // loop over all variable in the exchange equation and refresh their
    // resistance, if necessary
    
    for(var i = 0, l = exchangeEq.length ; i < l ; ++i) {

        var variable = exchangeEq[i].name;
        
        // If the derivative at this variable is zero, it should be
        // removed from the resistance list. In particular, this holds
        // for the bound variable.
        if(variable == boundVar || !this.errorDerivatives[variable]) {
            this.removeErrorReducingResistance(variable);
            continue;
        }
        
        this.calcErrorReducingResistance(variable);
    }
    
    this.refreshTotalForVariablesByResistance();
}

// This function executes all pending resistance calculations after
// a variable has been moved. It then updates the violation, optimization
// suspension and 'variableByResistance' tables. The function receives
// a list of variables for which the error derivative
// changed signs (this list of variables is given in the argument
// 'signChanges') For these variables, the entries in the
// 'variableByResistance' table need to be refreshed (in addition to
// the entries of variables for which the resistance changed).

PosEquations.prototype.refreshResistanceAfterMove =
    posEquationsRefreshResistanceAfterMove;

function posEquationsRefreshResistanceAfterMove(signChanges)
{
    // complete calculation of resistance
    this.calcAllPendingResistance();

    // remove all variables from the 'satOrGroupVariables' table
    // (they return to their standard position in variablesByResistance)
    this.clearSatOrGroupVariables();
    
    // Refresh the the list of variables with a non-zero error derivative.
    // This needs to be done for all variable for which the sign of
    // the error derivative changed or for which the resistance or total
    // resistance has changed.
    
    var refreshed = {};
    
    for(var variable in this.resistance.resistanceChanged) {
        this.calcErrorReducingResistance(variable);
        refreshed[variable] = true;
    }
    
    for(var variable in this.resistance.totalResistanceChanged) {
        
        if(refreshed[variable])
            continue;
        
        this.calcErrorReducingResistance(variable);
        refreshed[variable] = true;
    }
    
    for(var variable in signChanges) {
        if(refreshed[variable])
            continue;
        
        this.calcErrorReducingResistance(variable);
        refreshed[variable] = true;
    }
    
    this.refreshTotalForVariablesByResistance();
    
    // update the violation and optimization suspension tables
    this.updateViolationsAfterResistanceChanges();
    this.resistance.clearResistanceChanges();
}

// This function is called at the end of the calculation. For every
// variable whose value has changed, this function adds the stability
// resistance to that variable's resistance (in preparation for the next round
// of calculation). This includes all variables which were new in the current
// round. Variables which are not new and whose value did not change do not
// need to be updated because they still have the stability resistance from
// the previous round.
// This function also removes stability violations created in the previous
// round (since in every round the stability point is reset).

PosEquations.prototype.setResistanceForNextRound =
    posEquationsSetResistanceForNextRound;

function posEquationsSetResistanceForNextRound()
{
    for(var variable in this.solutionChanges) {
        if(this.resistance.setStableValue(variable)) {
            // refresh the violations of this variable
            this.refreshViolation(variable);
            // resistance changed as a result of this operation
            this.optimizationBlockingAfterResistanceChange(variable);
        }
    }
}

///////////////////////////////////
// Satisfied Or-Group Resistance //
///////////////////////////////////

// This function registers the given variable into the 'satOrGroupVariables'.

PosEquations.prototype.addToSatOrGroupVariables =
    posEquationsAddToSatOrGroupVariables;

function posEquationsAddToSatOrGroupVariables(freeVar)
{
    if(!this.satOrGroupVariables)
        this.satOrGroupVariables = {};
    
    if(this.doDebugging)
        this.debugMessage("adding variable ", this.debugGetVarStr(freeVar), 
                          " to satOrGroupVariables");
    
    this.satOrGroupVariables[freeVar] = true;
}

// This function deletes the given variable from the 'satOrGroupVariables'
// table. If this was the last variable in the table, the table is destroyed.
// This function does nto modify the corresponding entry in 
// variablesByResistance (see 'removeFromSatOrGroupVariables' for such
// functionality)

PosEquations.prototype.deleteFromSatOrGroupVariables =
    posEquationsDeleteFromSatOrGroupVariables;

function posEquationsDeleteFromSatOrGroupVariables(freeVar)
{
    if(!this.satOrGroupVariables)
        return; // empty table
    
    delete this.satOrGroupVariables[freeVar];
    if(isEmptyObj(this.satOrGroupVariables))
        delete this.satOrGroupVariables;
}

// This function removes the given variable from the 'satOrGroupVariables'
// table and then moves the variable to its 'standard' position 
// (based on own resistance and total resistance) in the 
// 'variablesByResistance' list.

PosEquations.prototype.removeFromSatOrGroupVariables =
    posEquationsRemoveFromSatOrGroupVariables;

function posEquationsRemoveFromSatOrGroupVariables(variable)
{
    if(!this.satOrGroupVariables || !this.satOrGroupVariables[variable])
        return; // not in table
    
    this.deleteFromSatOrGroupVariables(variable);
    this.calcErrorReducingResistance(variable);
}

// This function clears all variables from the satOrGroupVariables table.
// This then also moves them to their standard position in the 
// variablesByResistance list (this is the position based on their
// own resistance and total resistance, without satisfied or-group
// resistance.

PosEquations.prototype.clearSatOrGroupVariables =
    posEquationsClearSatOrGroupVariables;

function posEquationsClearSatOrGroupVariables()
{
    if(!this.satOrGroupVariables)
        return;
    
    for(var variable in this.satOrGroupVariables)
        this.removeFromSatOrGroupVariables(variable);
}

////////////////
// Violations //
////////////////

// This function refreshes the entry of the given variable in the
// resistance of the variable is calculated.
// If there is a previous violation for this variable and the direction
// of the violation changed or the priority of the violation increased,
// remove any existing violation suspension for this variable.
// This function returns the priority of the violation recorded for
// this variable. If no violation was recorded, the returned priority is
// -Infinity;

PosEquations.prototype.refreshViolation = posEquationsRefreshViolation;

function posEquationsRefreshViolation(variable)
{
    var resEntry = this.resistance.variables[variable];

    if(!resEntry) {
        // no violation
        this.removeFromViolationList(variable);
        return -Infinity;
    }

    if(resEntry.violation == undefined) {
        // no violation
        this.removeFromViolationList(variable);
        return -Infinity;
    }
    
    // get the violation values
    var priority = resEntry.violationPriority;
    var target = resEntry.violationTarget;
    var currentValue = this.solution[variable];

    if(!currentValue)
        currentValue = 0; // in case it is undefined

    // check whether there is an existing violation and treat its suspension
    // if needed
    
    var node = this.violatedVars.getNode(variable, true);
    var entry;
    
    if(node)
        entry = node.entry;
    else
        entry = { variable: variable };
    
    entry.target = target;
    
    // As this function may be called while the list is being processed,
    // add from end so that existing entries will not cross the position of
    // the currently being processed variable (see 'findOptimalSolution'
    // for more details on how entries move while processing).
    this.violatedVars.insert(entry, [variable], priority, true);
    
    if(entry.suspended)
        this.optimizationBlockingAfterViolationChange(variable);
    
    return priority;
}

// This function removes the given variable from the
// 'violatedVars' table. It also cleans this variable's entries
// in the 'optimizationSuspension' table.

PosEquations.prototype.removeFromViolationList =
    posEquationsRemoveFromViolationList;

function posEquationsRemoveFromViolationList(variable)
{
    this.violatedVars.remove(variable);
    this.optimizationBlockingAfterViolationChange(variable);
}

//////////////
// Clean-up //
//////////////

// Clear all changes in the 'input' to the solution calculation. The
// solution change list is not cleared (as it is up to the calling function
// to read those changes and then clear them).

PosEquations.prototype.clearAllInputChanges = posEquationsClearAllInputChanges;

function posEquationsClearAllInputChanges()
{
    this.equations.clearComponentChanges();
}

// This function clears the list of solution changes. This should be called
// by the parent PosCalc object after it has read the list of changes.

PosEquations.prototype.clearSolutionChanges =
    posEquationsClearSolutionChanges;

function posEquationsClearSolutionChanges()
{
    this.solutionChanges = {};
}
