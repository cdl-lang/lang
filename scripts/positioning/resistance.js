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


// The object implemented in this file stores and updates the resistance
// of various variables. This object is initialized with the PosEquations
// object it belongs to. Based on the priorities stored in the segment
// constraints object, this object calculates the resistance of each
// variable registered to it at its current value. The object has the
// following structure:
//
// {
//    posEquations: <the PosEquations object this object belongs to>
//
//    // various fields out of the PosEquations object
//    segmentConstraints: <the segment constraints object out of posEquations>
//    equations: <the combination equations object>
//    boundVars: <bound variables>
//    boundVarsByEq: <bound variables indexed by equation ID>
//    innerProducts: <inner product of solution with the equations>
//    solution: <the current solution vector>
//    orGroups: <the OrGroups object from the parent PosCalc>
//
//    variables: {
//       <variable>: <resistance entry for this variable, see below>
//       .....
//    }
//
//    needRecalc: {
//       <variable>: true
//       .....
//    }
//
//    totalResistance: {
//        <variable>: {
//             dir: "up"|"down"   // direction of calculated resistance
//             resistance: <resistance value>
//             resistingVar: <bound variable>
//             resistingOrGroup: <or-group name>
//        }
//        ......
//    }
//
//    totalResistanceNum: <number of entries in 'totalResistance'>
//
//    resistingBoundVars: {
//       <bound variable>: {
//          <free variable>: true,
//          .....
//       }
//       ......
//    },
//    pendingRecalcTotal: {
//       <free variable>: true,
//       ...........
//    }
//
//    // or-groups
//
//    freeRequireOrGroupResistance: {
//        <free variable>: {
//            <requiring module name>: true
//            .....
//        }
//        .....
//    }
//
//    numFreeRequireOrGroupResistance: <number of entries in
//                                      'freeRequireOrGroupResistance'>
//
//    freeRequiredByModule: {
//        <module name>: {
//             <free variable>: true
//             .......
//        }
//    }
//
//    tightFreeVariablesCalculated: {
//        <variable>: true | {
//             <group ID>: true
//             .....
//        }
//        .....
//    }
//
//    tightVariables: {
//        <variable>: {
//            <group ID>: {
//                dir: -1|0|1,
//                varSatByGroup: true|false,
//                onlySatByGroup: true|false
//                representative: <a satisfied bound variable in the group>
//            }
//            .....
//        }
//        .....
//    }
//
//    tightGroups: {
//        <group ID>: {
//             <variable>: true,
//             .....
//        }
//        .....
//    }
//
//    violatedOrGroupVars: {
//        <variable>: {
//           <group ID>: {
//               target: <optimization target for this group and variable>
//               priority: <priority of this group>
//               freeVars: {
//                  <free variable>: -1|+1
//                  .....
//               }
//               boundVarOpt: {
//                   num: {
//                       up: <number of variables in 'up' list>
//                       down: <number of variables in 'down' list>
//                   }
//                   up: {
//                       <bound variable>: true
//                       ....
//                   }
//                   down: {
//                       <bound variable>: true,
//                       ....
//                   }
//               }
//           }
//           ......
//       }
//       ......
//    }
//
//    pendingRecalcTightOrGroups: {
//        <group ID>: true | {
//                              <variable>: true
//                              .......
//                           }
//    }
//
//    needRecalcForViolatedOrGroups: {
//        <variable>: {
//            <group>: <previous group priority>
//            .....
//        }
//        .....
//    }
//
//    needRecalcTotalForViolatedOrGroups: {
//        <variable>: {
//            <group>: <previous group priority>
//            .....
//        }
//        .....
//    }
//
//    needRecalcViolatedOrGroupResistance: {
//        <variable>: true
//        ......
//    }
//
//    resistanceChanged = {
//         <variable>: true
//         ......
//    }
//    satOrGroupResistanceChanged = {
//         <variable>: true
//         ......
//    }
//    tightOrGroupChanged = {
//         <group ID>: true
//         .......
//    }
//    violationChanged = {
//         <variable>: true
//         ......
//    }
//    totalResistanceChanged = {
//         <variable>: true,
//         ......
//    }
//
//    // direction names
//    dirs: {
//       down: true,
//       up: true
//    }
//    // the opposite direction for each direction
//    opDirs: {
//       down: "up",
//       up: "down"
//    }
//    sameDirs: {
//       down: "down",
//       up: "up"
//    }
// }
//
// For each variable in the 'variables' table, an object is stored, holding
// both the current resistance of the variable (in each direction) as well
// as information which allows quick recalculation of the resistance when
// the value of the variable changes. This resistance object has the following
// structure:
// {
//    stabilityResistance: <stability priority>
//    stableValue: <number>
//
//    min: <the minimal value allowed by constraints (of any priority)>
//    max: <the maximal value allowed by constraints (of any priority)>
//
//    // violations
//
//    // total violation, including or-groups (if any)
//    violation: "min"|"max" // type of violation
//    violationPriority: <highest priority of violated constraint>
//    violationTarget: <value at first violated constraint with
//                      priority == violationPriority>
//
//    // resistance excluding resistance due to violated or groups
//    withoutViolatedOrGroups: {
//        up: <up resistance not including violated or groups>
//        down: <down resistance not including violated or groups>
//    }
//
//    // resistance in each direction
//    resistance: {
//       up: <this variable's resistance to increasing the value>
//       down: <this variable's resistance to decreasing the value>
//    }
//    
//    // resistance due to satisfied or-groups (which are satisfied by 
//    // the or-group)
//    satOrGroupResistance: {
//        up: <resistance to increasing the variable value>
//        down: <resistance to increasing the variable value>
//    }
// }
//
// The 'stabilityResistance' simply records this value from the segment
// constraints object. This value does not change as the value
// of the variable changes. When 'stabilityResistance' is not defined,
// the corresponding resistance is -Infinity.
//
// 'stableValue' is the value against which the stability resistance is
// calculated. When the variable is first created, this value is undefined.
// Every time the solution is recalculated, the new value of the variable
// should be set on 'stableValue' using the function 'setStableValue'.
// The stability creates resistance to moving away from the stable value.
// This is like creating min and max constraints for the stable value
// with the priority given by the stability priority. A stability priority
// of -Infinity creates no resistance.
//
// 'min' and 'max' are the minimal and maximal values allowed by
// the segment constraints (of any priority). If the variable value is
// strictly inside this range, there is no need to check whether there is
// any tight segment constraint for the value.
//
// The violation fields track segment constraint violations by the current
// value. Because no conflicting constraints can be registered on a single
// variable, all violations on a variable must have the same direction.
// The field 'violation' has a value "min" if the violation is "min"
// constraint violation (that is, the value is smaller than allowed)
// and it is "max" if the violation is a "max" constraint violation
// (the value is larger than allowed). The violation need not be of a min/max
// constraint, it can also be a violation of a stability constraint,
// where the value being larger than the stable value is considered
// a "max" violation and the value being smaller than the stable value is
// considered a "min" violation. If there is no violation, this field is
// not defined.
//
// 'violationPriority' is the maximal priority of a constraint being
// violated. If this is not -Infinity then 'violationTarget' must be defined
// and is the first value of a violated constraint with priority
// 'violationPriority' ('first' in the direction of violation reduction -
// lowest value for "min" violations an highest value for "max" violations).
//
// 'resistance.up' and 'resistance.down' are the actual resistance to movement
// of the value to larger (up) or smaller (down) value. These are calculated
// based on the resistance of min/max constraints at the value and other
// stored resistances (violations and or-group resistance). Violated
// constraints produce a resistance to movement in the direction which 
// increases the violation (with the priority of the violation).
// These values do not include resistance due to or-groups satisfied
// on the variable unless this variable is the only variable which 
// satisfies the or-group (and therefore the or-group resistance is the 
// same as simple variable resistance).
//
// The 'satOrGroupResistance' sub-table is optional. It appear on 
// the entries of free variables which appear in the 
// 'freeRequireOrGroupResistance' table and for which there is an
// entry in the 'tightVariables' table.
// The resistance recorded here is that of or-groups which are satisfied
// (and tight) on this variable and are satisfied on at least one more
// variable (if the or-group is only satisfied on one variable its resistance
// is like standard constraint resistance and contributes directly to the
// main resistance entry). 
//
// The table 'needRecalc' holds a list of variables for which the resistance
// needs to be recalculated (this is separate from the list of variables
// for which total resistance needs to be recalculated - see below). The
// attributes in the table are the names of the variables for which
// the resistance needs to be recalculated and the value is always 'true'.
//
// The table 'resistanceChanged' holds a list of variables for which
// the resistance has changed (in one or both directions), the table 
// 'satOrGroupResistanceChanged' holds a list of variables for which
// the satisfied or-group resistance has changed in one or both directions,
// (this refers only to or-groups satisfied on the variable and at 
// least one more variable and is calculated only when needed). 
// The table 'tightOrGroupChanged' holds a list of or-groups which were
// tight (satisfied) before the last round of changes and are satisfied
// (but perhaps not tight) after this round of changes. Variables in these
// or-groups may (but do not necessarily need to) appear in 
// 'satOrGroupResistanceChanged'.
// The table 'violationChanged' holds the list of variables for which either
// the violation priority or the violation target changed and the table
// 'totalResistanceChanged' holds a list of variables for which the
// total resistance changed. These changes
// may be processed by an external module which needs to be aware of such
// changes (the equation solving module) and it is up to such a module to
// clear these tables. There is no need to go over resistance changes in order
// to schedule the calculation of total resistance which may be affected
// by such a change - this is done directly when the resistance changes.

// Total resistance calculation
// ----------------------------
//
// The total resistance to the movement of a variable is the maximum of
// the resistance of the variable itself and the resistance to movement
// of other variables which need to move together with this variable.
// Variables move together when a free variable in a zero error equation
// moves. In that case, the bound variable in the equation needs to move
// together with the free variable (to keep the error zero). This means
// that:
// 1. The total resistance differs from the resistance of the variable itself
//    only if the variable is a free variable in a zero error equation.
// 2. The total resistance depends on the resistance of the bound variables
//    (in the relevant equations) and on the signs of the coefficients of
//    the free and bound variables in those equations. In other words,
//    if the coefficients change but their signs do not change, the total
//    resistance cannot change.
//
// We only need to know the total resistance of variables which appear in
// the error derivative vector and of these variables we only need to know
// the total resistance of the variables which have the least resistance
// in the direction of error reduction. For this reason, the total resistance
// is not maintained continually for all variables but is only calculated
// as necessary for those variables for which the algorithm needs to
// know the total resistance (this means that the total resistance of
// a variable may be calculated over and over again, but this is more
// efficient than keeping the total resistance up to date for all variables
// all the time).
//
// Therefore, total resistance is calculated by request (the requests
// are issued by the PosEquations module). A request specifies both
// a variable and a direction in which the total resistance needs to be
// calculated. The variables for which the total resistance calculation
// was requested are stored in the 'totalResistance' table. The entry
// under each variable in this table holds the direction 'dir' ("up"|"down")
// for which the total resistance was requested, the current value of
// the total resistance ('resistance') and one of the bound variables which
// induces the total resistance, 'resistingVar' (if the total resistance
// is equal to the resistance of the variable itself, this field is dropped).
// If the total resistance is induced by an or-group, that or-group is
// recorded in the 'resistingOrGroup' field (if the or-group's resistance
// was already included in the variable's own resistance, the or-group is
// not registered as contributing to the total resistance, as that 
// contribution is already incorporated in the contribution to the variable's
// own resistance).
// For each variable which appears under the 'resistingVar' property
// there is an entry in the 'resistingBoundVars' table, which lists all
// variables which this variable is listed as their 'resistingVar'.
// 
// Resistance due to a satisfied or-group is no included in the total 
// resistance of a variable if the variable itself satisfies the or-group.
// If the variable is the only variable which satisfies the or-group then
// this resistance is already included in the variable's own resistance
// (this is the same as standard constraint resistance). A satisfied or-group
// can contribute to the total resistance of the variable if 
// the variable itself does not satisfy the or-group but when the variable
// moves it causes movement of all variables satisfying the or-group 
// (and would cause them to violate the or-group). Such resistance is included
// in the total resistance.
//
// Bound variables are not registered to the totalResistance table.
// Instead, if a module requests their total resistance, their 
// Once a variable is registered in the 'totalResistance' table, its
// total resistance will be updated when modifications to the equations
// or the resistance of variables causes it to change. Variables for
// which the total resistance has changed are stored in the
// 'totalResistanceChanged' table.
//
// In addition, we keep a table 'pendingRecalcTotal' which holds a list
// of variables for which the total resistance needs to be recalculated.
// When a total resistance refresh function is called, it sometimes detects
// that the total resistance of a variable needs to be recalculated
// (and can't simply be updated). In such cases, if several refresh functions
// are called (for example, when several equations change) and they require
// recalculation for the same variable, this recalculation is merely
// recorded in the 'pendingRecalcTotal' table and can be executed later
// (after all changes have been taken into account).
//

// Or-Groups
// ---------
//
// The resistance to variable movement due to an or-group depends on the
// satisfaction of the or-group on multiple variables. Let v be a variable
// (free or bound) and let b_1, ..., b_n be bound variables which move
// when v moves (that is, if v is free, these are the bound variables in
// the zero error equations in which v appears). A group G resists
// the movement v in direction d iff:
// 1. G has a constraint on at least one of the variables v, b_1, ..., b_n.
// 2. G is not satisfied on any other variable except v, b_1, ...,b_n.
// 3. G is either tight (in the direction of movement) or violated
//    on all variables among v, b_1, ...., b_n on which G has a constraint.
// 4. If G is violated, G resists the movement of v iff the violation
//    of G increases on all variables among v, b_1, ...., b_n
//       for which G has a constraint.
// 5. If G is not violated, this always resists the movement (because of
//    1 + 2 + 3 above).
// If the group resists a move then it resists it with the group priority.
// If the group has a constraint defined on v, this contributes to the
// (self) resistance of v. If G has no constraint defined on v, this
// contributes to the total resistance of v.
//
// Note that in the case where the group G has a constraint on exactly one
// variable these definitions are equivalent to the standard definitions
// of resistance.
//
// The consequences of these definition can be specified for various
// situations. 
//
// Violated Or-Groups
// ------------------
// The conclusion from these rules is that when a group is violated,
// we need to check for every variable which belongs to the group or
// which appears in a zero error equation whose bound variable belongs
// to the group whether moving the variable will cause all variables which 
// move with it and belong to the group to increase the violation.
// If this is the case, the group offers resistance to the movement of the
// variable. Notice that this can hold for at most one movement direction for
// each variable. If the variable itself belongs to the group, this
// results in resistance of the variable and if the variable does not
// belong to the group, this only contributes to the total resistance of the
// variable.
//
// When a variable belonging to a violated or-group is bound, its resistance
// due to a violated or-group may be higher than the total resistance 
// which the variable induces on other free variables in its equation
// when the equation has a zero error. This is because the resistance of
// the variable itself refers to the movement of the variable when the
// equation has a non-zero error and therefore the bound variable can be
// moved independently. In that case, no other variable in the or-group
// moves together with that bound variable and movement in the direction of
// increased violation on the bound variable will be resisted with
// the priority of the violated group. However, once the equation becomes
// a zero-error equation, the bound variable can no longer be moved
// independently and it is only its contribution to the total resistance
// of free variables which matters. This contribution depends on which
// other variables in the same group move when the free variable moves
// which may result in a resistance lower than the bound variable's own
// resistance. Moreover, the resistance such a bound variable induces
// on different variables in its equation can vary from variable to variable
// (because every free variable induces movement on different variables).
//
// To support this, the entry of every variable in the 'variables' table
// holds the 'withoutViolatedOrGroups' fields which store the resistance
// of the variable excluding any resistance due to violated or-groups.
// The 'resistance' fields in this entry hold the resistance of the variable
// including any resistance due to violated or-groups. To calculate the
// resistance and total resistance due to violated or-groups, the system
// uses the 'violatedOrGroupVars' table which stores the relevant 
// resistance information for variables whose resistance or total
// resistance may be affected by a violated or-group. In addition
// to the variables which belong to violated or-groups, this table also
// has entries for some free variables which appear in zero-error equations
// whose bound variable belongs to a violated or group (because the total
// resistance of these variables may be affected by the violated or-groups).
// Not all free variables which appear in these equations need to be
// considered. Only two types of variables need to be considered:
// 1. Variables for which the total resistance needs to be calculated.
// 2. Free variables which appear in a blocked equation with a bound variable
//    such that the bound variable's violation priority is higher than
//    its resistance without violated or-groups in the violation
//    increasing direction.
// These variables are listed in the 'freeRequireOrGroupResistance' table.
// (see explanation for the structure of this table below).
//
// The 'violatedOrGroupVars' table has an entry for each such variable
// (and for each variable in a violated or-group). The table has
// the following format:
//
// violatedOrGroupVars: {
//     <variable>: {
//         <group ID>: {
//             target: <optimization target for this group and variable>
//             priority: <priority of this group>
//             freeVars: {
//                  <free variable>: -1|+1
//                  .....
//             }
//             boundVarOpt: {
//                 num: {
//                     up: <number of variables in 'up' list>
//                     down: <number of variables in 'down' list>
//                 }
//                 up: {
//                     <bound variable>: true
//                     ....
//                 }
//                 down: {
//                     <bound variable>: true,
//                     ....
//                 }
//             }
//         }
//         ......
//     }
//     ......
// }
// This lists for the variable every violated or-group which the variable
// itself belongs to or such that the variable appears in appears in
// the 'freeRequireOrGroupResistance' table and in addition appears
// in a zero-error equation whose bound variable belongs to the group.
// When an or-group is added to a bound variable, it checks which of the
// free variables in the bound variable's equation appears in
// 'freeRequireOrGroupResistance'. For these variables, entries in
// the table are created. In addition, if the variable already has an entry
// in the table, the entry will be updated. When some external module (e.g. the
// optimization suspension mechanism) wants an entry for a certain variable
// to be created, it first needs to create this entry explicitly
// (by calling 'addVariableAndGroupToViolatedOrGroupVars'). Once the
// entry for a variable has been created, it will be maintained until
// no violated or-groups are defined on any of the bound variables in
// the equations in which it appears.
// The entry for each group in the violatedOrGroupVars table
// lists the priority of the group. If the variable itself belongs to the
// group, the group's optimization target on that variable is listed.
// If the variable is free, it has a 'freeVars' property and if the
// variable is a free variable, it has a 'boundVarsOpt'.
// The 'freeVars' entry list the free variables which appear in the
// equation of the bound variable and which have an entry for this group
// in the 'violatedOrGroupsVars' (these are the variable entries which
// need to be updated when the entry for the bound variable and group
// changes.
// Under each such free variable we store -1 or 1, which is the sign of
// the corresponding coefficient in the equation. 
// This way, when the equation changes, we know which free variables the bound 
// variable is registered on and update this registration.
// The 'boundVarOpt' table records bound variables which belong to the group
// and appear in a zero-error equation in which the variable appears
// (as a free variable). These bound variables are listed under the 'up'
// and 'down' sub-tables, where up/down is the direction in which the free
// variable needs to move to decrease the violation of the group on the bound
// variable. The 'num' sub-table holds the number of bound variables in the up
// and down tables. Given this entry, it is straightforward to calculate the 
// contribution of the violated or-groups to the resistance and total 
// resistance of a variable.
//
// Changes to the 'violatedOrGroupVars' table may require a refresh of
// variable violations, resistance and total resistance. Since various
// changes to the 'violatedOrGroupVars' table may influence the violation,
// resistance or total resistance of the same variable, we do not immediately
// perform the refresh when the change occurs. Instead, changes are stored
// in the 'needRecalcForViolatedOrGroups' and
// 'needRecalcTotalForViolatedOrGroups' tables. These tables store for each
// variable the groups for which a change has occurred and the previous
// priority (before the change) of that group (this is -Infinity if no
// previous entry existed). The first table is for changes which may
// influence the violation or resistance on the variable and the second
// table is for changes which may effect the total resistance of the
// variable. After all changes have been gathered, the system goes over
// all variables and groups and checks whether any refresh is necessary and
// if yes, whether a simple refresh is sufficient (in case the new violation
// results in higher resistance and stronger violation than the previous
// violation) or a partial or full recalculation of violations and/or
// resistance is necessary.
// One possibility is that only the contribution of the violated or-groups
// to the resistance of a variable needs to be recalculated (that is, the
// resistance without violated or-groups and the violation of the variable
// do not need to be recalculated). In this case, it is enough to start with
// the resistance without violated or-groups (which is stored in the resistance
// entry of the variable) and just add the resistance due to violated 
// or-groups. Variables for which such an update needs to take place are
// scheduled for this update by storing them in 
// 'needRecalcViolatedOrGroupResistance'. If a variable in this table also
// appears in 'needRecalc' then a full recalculation will take place.

// Satisfied Or-Groups
// -------------------
//
// When a group is satisfied on a variable which does not appear in
// the equations, the group offers no resistance.
//
// When the group is satisfied on exactly one variable, it offers
// unconditional resistance to the movement of that variable in the
// direction in which the group satisfaction is tight.
//
// When the group is satisfied and not tight (in both directions) on
// some variable, it offers no resistance.
//
// When a group is satisfied on more than one variable, it offers
// no resistance to movement if more than one of these variables
// is not a bound variable in a zero-error equation. 
//
// When a group is satisfied on more than one variable and all of
// these variables are bound in a zero error equation, the group
// contributes to the total resistance of free variables which move
// all these bound variables in the direction in which the group constraints
// are tight.

// When a group is satisfied on more than one variable and exactly 
// one of these variables is not bound in a zero error equation,
// the group contributes to the resistance of the free variable if
// moving it in the direction in which the group constraint is tight
// also moves all other satisfied variables in the direction in which
// the group constraint is tight.
//
// Because these decisions are often not local to a single variable,
// the resistance is not calculted separately for each variable, but
// for each group. The information is stored in the 'tightVariables'
// and 'tightGroups' tables.
//
// The 'tightVariables' table stores the list of variable for which some
// group is tight, that is, such that the group is satisfied but moving
// the value of the variable (at least in one direction) would result in
// the group being violated. It is important to note that such a variable
// need not itself have a constraint belonging to the group (it may be
// that the variable is free but the movement of bound variables induced
// by the movement of the variable results in a violation of the group).
// Unless a variable is the only variable satisfied by the or-group, the
// or-group only contributes to the total resistance of the variable, not
// to its own resistance.
//
// Variables which are not the only variables satisfied by the or-group
// only appear in this table if their inclusion in the table is required
// by an external module. Currently, there are two cases where this
// happens:
// 1. Variables for which total resistance needs to be calculated. These
//    are added automatically by the statisfied or-group calculation
//    functions. When a new variable needs to have its total resistance
//    calculated, the construction of the relevant entry in the tightVariables
//    table needs to be requested.
// 2. Free variables which appear in a blocked equation with a bound variable
//    such that the bound variable's violation priority is higher than
//    its resistance without violated or-groups in the violation
//    increasing direction. The inclusion of such variables in the
//    tightVariables table has to be requested by the optimization
//    suspension module.
// These variables are listed in the 'freeRequireOrGroupResistance' table
// (the entry in this table under each free variable lists the modules
// which required the calculation for this variable, so that the requirement
// could be removed once all modules removed their requirement).
// 
// The table has the variables as attributes. The entry for each variable
// has the form:
// {
//    <group ID>: {
//        dir: -1/0/1,
//        varSatByGroup: true|false
//        onlySatByGroup: true|false
//        representative: <a satisfied bound variable in the group>
//    }
//    .....
// }
// The 'dir' entry stores the direction in which the group resists the
// movement of the variable. -1 if there is only resistance to movement
// in the down direction (decrease in value) 1 if there is only resistance
// to movement in the up direction (increase in value) an 0 if there is
// resistance in both directions.
// The 'varSatByGroup' entry indicates whether the variable has itself
// constraints belonging to the group and the current value of the variable
// satisfies these constraints. 'onlySatByGroup' is true if 'varSatByGroup'
// is true and this variable is the only variable which is satisfied by
// the group. If the variable satisfies the group
// and it is the only variable satisfying the group, the or-group contributes
// to the resistance of the variable (in the indicated direction(s)).
// Otherwise, it only contributes to the total resistance of the variable.
// For variables which satisfy the group, we also need to calculate the
// total resistance without the tight or-groups. This is because exchanging
// a free variable with a bound variable which is in the same or-group
// would not result in reduction of resistance for other variables in the
// usual way. This is because the total resistance which is 'replaced'
// as a result of such an exchange never actually applied to other free
// variables, as these cannot belong to the same group (had they belonged
// to the same group there would have been at least two free variables in the
// group and the group could not be tight). However, if the total resistance
// of the variable without the tight or-group resistance is larger
// than the resistance of the variable, exchanging the free variable with
// a bound variable which contributes to this total resistance can
// reduce the resistance in the usual way.
//
// When the group is satisfied it may not be tight on any variable. In that
// case, it will not appear under any entry in the 'tightVariables' table.
// The two simplest cases where a group is satisfied but not tight on
// any variable is when an or-group is satisfied but at least one of
// its constraints is not tight (in either direction) or at least one of
// the variables on which the group is satisfied is not in the equations.
//
// The 'tightGroups' table is the inverse index to the 'tightVariables'
// table. For each group, it lists the variables under which that group
// appears in the 'tightVariables' table.
//
// Since the same refresh of these tables may be triggered by different
// changes and in order to reduce the number of repeated calculations,
// the calculation of tight groups and the variables they resist can
// be queued. The pending calculations are stored in
// 'pendingRecalcTightOrGroups'. The attributes in this table are group
// names. Under each attribute we either have 'true', which means that
// all tight variables have to be recalculated for the group, or have
// an object with a list of variables as its attributes. In this second case,
// the calculation only has to be performed for the group and the variables
// listed under it.
//
// The 'freeRequireOrGroupResistance' Table
// ----------------------------------------
//
// This table is used to keep track of those free variables for which
// violated and satisfied or-group resistance needs to be tracked even
// if the variable does not belong to those groups. When a variable does
// not belong to an or-group, that or-group cannot contribute to the
// variable's own resistance but only to the total resistance of the
// variable. The calculation of the total resistance is only required for
// some variables and therefore only these variables will appear in the
// 'freeRequireOrGroupResistance'. Sometimes the full total resistance of
// a variable needs to be calculated (meaning the contribution of all
// relevant or-groups to the total resistance of a variable) and sometimes
// only the contribution of certain or-groups to the total resistance
// is required (for example, when the optimization of a certain bound
// variable is suspended, in order to determine whether the free variables
// in the bound variable's equation are blocked, we need to know
// the contribution of that bound variable to the total resistance of the
// free variables and this may involve the or-groups defined on the
// bound variable). However, we do not ditinguish in the registration
// to the 'freeRequireOrGroupResistance' between the two cases. Once
// a variable appears in the 'freeRequireOrGroupResistance' table, its entries
// for all relevant or-groups (or groups on bound variables in whose
// equations the free variable appears) will be updated every time this is
// required. This registration does not, in itself, guarantee that the
// relevant entries will be created - they will be created automatically
// only if some change results in their calculation. To ensure the creation
// of these entries, one needs to create them explicitly (once the entry
// is in the or-group tables there is no need to repeat this).
//
// Under each variable entry in the 'freeRequireOrGroupResistance' table
// we store the list of modules which require the calculation of that
// variable's or-group table entries. This way, when the modules no longer
// require that calculation, it can be removed from the tables.
//
// The 'freeRequiredByModule' table provides an index by module name into the
// 'freeRequireOrGroupResistance' table. This allows all variables
// registered by a certain module to be de-registered at once.
//
// In the tightVariables table, having calculated the entry for a given
// variable and or-group, we may discover that no entry should be created
// for them in the table. To avoid repeated calculation, we record
// in the 'tightFreeVariablesCalculated' table every pair
// <variable, or-group> such that the variable is in
// 'freeRequireOrGroupResistance' and such that the tight or-group tests
// was carried out for the pair (regardless of whether this resulted in
// an entry being created for this pair). Only variables from
// the 'freeRequireOrGroupResistance' table may appear in the
// 'tightFreeVariablesCalculated' table.
// If the calculation takes place for all relevant or-groups, we may store
// 'true' under the entry for the variable in the
// 'tightFreeVariablesCalculated' rather than list all or-groups for which
// the calculation took place. Since the variable is in the
// freeRequireOrGroupResistance table, any subsequent changes will be
// automatically updated.
// 

//
//
// Constructor
//

// For calculating the total resistance, the calculation functions need
// access to the equations, the list of bound variables and the equation
// inner product list. This information is provided as arguments to
// the total resistance update functions.

function Resistance(posEquations)
{
    this.posEquations = posEquations;
    
    // extract objects from the parent PosEquations
    this.equations = posEquations.equations.combinationSet;
    this.boundVars = posEquations.boundVars;
    this.boundVarsByEq = posEquations.boundVarsByEq;
    this.innerProducts = posEquations.innerProducts;
    this.segmentConstraints = posEquations.segmentConstraints;
    this.solution = posEquations.solution;
    this.orGroups = posEquations.posCalc.orGroups;
    
    this.variables = {};
    this.needRecalc = {};

    this.totalResistance = {};
    this.totalResistanceNum = 0;
    this.resistingBoundVars = {};
    this.pendingRecalcTotal = {};
    
    // or-group resistance tables
    this.freeRequireOrGroupResistance = {};
    this.numFreeRequireOrGroupResistance = 0;
    this.freeRequiredByModule = {};
    this.tightFreeVariablesCalculated = {};
    this.tightVariables = {};
    this.tightGroups = {};
    this.violatedOrGroupVars = {};
    this.pendingRecalcTightOrGroups = {};
    this.needRecalcForViolatedOrGroups = {};
    this.needRecalcTotalForViolatedOrGroups = {};
    this.needRecalcViolatedOrGroupResistance = {};

    // changes
    this.resistanceChanged = {};
    this.satOrGroupResistanceChanged = {};
    this.tightOrGroupChanged = {};
    this.violationChanged = {};
    this.totalResistanceChanged = {};
    
    // static naming structures
    this.dirs = { down: true, up: true };
    this.opDirs = { down: "up", up: "down" };
    this.sameDirs = { down: "down", up: "up" };
}

// This function should be called when adding a new variable or when the
// segment constraints or stability requirements of a variable
// have changed. This function creates a new entry for the variable
// or refreshes the existing entry with the new constraints and requirements.
// This does not calculate the resistance for a specific value, but only
// prepares the parameters which are value independent (such as the 'min'
// and 'max').
// To calculate the resistance for a specific value, call 'calcResistance'.

Resistance.prototype.refreshEntry = resistanceRefreshEntry;

function resistanceRefreshEntry(variable)
{
    if(!this.variables[variable])
        this.variables[variable] = {};
    
    var entry = this.variables[variable];
    
    entry.min = this.segmentConstraints.getMin(variable);
    entry.max = this.segmentConstraints.getMax(variable);
    
    var stability = this.segmentConstraints.getStability(variable);
    
    if(stability != -Infinity)
        entry.stabilityResistance = stability;
    else
        delete entry.stabilityResistance;
    
    entry.resistance = {};
    entry.withoutViolatedOrGroups = {};
    entry.violationPriority = -Infinity;
    
    return entry;
}

////////////////////////////
// Resistance Calculation //
////////////////////////////

// This function calculates the resistance of the given variable for the
// given value. The resistance is based on the priorities already
// stored in the variable's entry.
// If there is a stable value defined and a stability priority (which is
// not -Infinity), the resistance is calculated as if there are constraints
// requiring a minimum and maximum offset of 0 from the stable value.
// The function returns true if the resistance of the variable, with or
// without violated or-groups changed and false otherwise.
// If the resistance (or the resistance without violated groups) changed,
// this function also calculates or queues for recalculation the total
// resistance of variables for which total resistance needs to be calculated
// whose total resistance may have been affected by this change.

Resistance.prototype.calcResistance = resistanceCalcResistance;

function resistanceCalcResistance(variable, value)
{
    if(!this.posEquations.hasVariable(variable))
        return false;

    var entry = this.variables[variable];
    
    if(!entry) // entry does not exist, create one
        entry = this.refreshEntry(variable);
    
    var prevResistance = entry.resistance;
    var prevWithoutViolatedOrGroups = entry.withoutViolatedOrGroups;
    var prevViolationPriority = entry.violationPriority;
    var prevViolationTarget = entry.violationTarget;
    
    entry.resistance = { up: -Infinity, down: -Infinity };
    
    delete entry.violation;
    delete entry.violationTarget;
    entry.violationPriority = -Infinity;
    entry.withoutViolatedOrGroups = {};
    
    // non-or-group min/max resistance and violation
    this.calcMinOrMaxResistance(variable, value, true);
    this.calcMinOrMaxResistance(variable, value, false);
    
    // stability
    
    this.calcStabilityResistance(variable, value);
    
    // or-group resistance
    
    if(this.segmentConstraints.variableHasOrGroups(variable)) {
        // add or-group tight-satisfaction resistance
        this.addSatisfiedOrGroupResistance(variable);
        // add or-group violations
        this.addAllOrGroupViolationResistance(variable, value);
    }

    // did the violation change?
    if(entry.violationPriority != prevViolationPriority ||
       entry.violationTarget != prevViolationTarget)
        this.violationChanged[variable] = true;
    
    // resistance changed?
    var changed = (prevResistance.up != entry.resistance.up ||
                   prevResistance.down != entry.resistance.down);
    
    if(changed ||
       prevWithoutViolatedOrGroups.up != entry.withoutViolatedOrGroups.up ||
       prevWithoutViolatedOrGroups.down != entry.withoutViolatedOrGroups.down)
        this.refreshTotalAfterResistanceChange(variable);
    
    if(changed)
        this.resistanceChanged[variable] = true;
    
    return changed;
}

// This function adds the given resistance to the resistance of the given
// variable in the given direction (which should be -1 for down, 1 for up
// and 0 for both directions). If the given resistance is smaller or equal
// to the already existing resistance, nothing is done. If the resistance
// is higher, the 'withoutViolatedOrGroups' and 'resistance' in the relevant
// directions are updated. If this resulted in a resistance increase, this
// function updates total resistance which may depend on this resistance.
// It also registers the variable to the 'resistanceChanged' table.
// This function should only be used for the incremental update of the 
// resistance and should not be used within the complete recalculation 
// of the resistance (calcResistance) because it is not efficient for that
// case (as it may considered as changed resistance which did not actually
// change because 'calcResistance' first clears the previous resistance).

Resistance.prototype.addToResistance = resistanceAddToResistance;

function resistanceAddToResistance(variable, resistance, direction)
{
    var entry = this.variables[variable];
    
    if(!entry)
        return; // no entry yet created, will be calculated later
    
    var refreshTotal = false;
    
    if(direction >= 0) {
        if(entry.withoutViolatedOrGroups.up < resistance) {
            entry.withoutViolatedOrGroups.up = resistance;
            refreshTotal = true;
            
            if(entry.resistance.up < resistance) {
                entry.resistance.up = resistance;
                this.resistanceChanged[variable] = true;
            }
        }
    }
    
    if(direction <= 0) {
        if(entry.withoutViolatedOrGroups.down < resistance) {
            entry.withoutViolatedOrGroups.down = resistance;
            refreshTotal = true;
            
            if(entry.resistance.down < resistance) {
                entry.resistance.down = resistance;
                this.resistanceChanged[variable] = true;
            }
        }
    }
    
    if(refreshTotal)
        this.refreshTotalAfterResistanceChange(variable);
}

// This function calculates the resistance due to min or max constraints
// (depending on the 'isMin' flag) for the given variable and value.
// The resistance calculated here does not include the resistance
// due to or-groups. The resistance of the constraints at the value
// is stored on 'resistance.down' (for min constraints) or 'resistance.up'
// (for max constraints) which violation resistance and target are
// stored on the violation variables of the resistance entry.
// The violation resistance is not yet included in the resistance
// stored in resistanceUp/resistanceDown (as we still need to wait
// for or-group resistance).

Resistance.prototype.calcMinOrMaxResistance =
    resistanceCalcMinOrMaxResistance;

function resistanceCalcMinOrMaxResistance(variable, value, isMin)
{
    var entry = this.variables[variable];

    if(!entry)
        return;
    
    var resistance = -Infinity;

    if((isMin && entry.min < value) || (!isMin && entry.max > value))
        return; // no min/max resistance or violation
    
    var atValue = // does not include or-group constraints
        this.segmentConstraints.priorityForValue(variable, value, isMin);
    if(atValue) {
        resistance = (atValue.violatedPriority > atValue.priorityAtVal) ?
            atValue.violatedPriority : atValue.priorityAtVal;
        if(atValue.violatedPriority != -Infinity) {
            entry.violation = isMin ? "min" : "max";
            entry.violationPriority = atValue.violatedPriority;
            entry.violationTarget = atValue.violatedValue;
        }
    }
    
    if(isMin)
        entry.withoutViolatedOrGroups.down =
            entry.resistance.down = resistance;
    else
        entry.withoutViolatedOrGroups.up =
            entry.resistance.up = resistance;
}

// This function adds the resistance due to stability requirements to
// the resistance of the given variable at the given value.
// This function assumes (as is indeed the case) that stability never
// appears on the same variable as min/max constraints. Therefore, this
// does not need to look at resistance values whose source is other
// constraints.
// Stability or-group constraints are handled separately.

Resistance.prototype.calcStabilityResistance =
    resistanceCalcStabilityResistance;

function resistanceCalcStabilityResistance(variable, value)
{
    var entry = this.variables[variable];

    if(!entry)
        return;
    
    if(entry.stabilityResistance != undefined &&
       entry.stabilityResistance > -Infinity &&
       entry.stableValue != undefined) {
        
        var stabilityRes = entry.stabilityResistance;
        
        if(value < entry.stableValue || value > entry.stableValue) {
            if(value > entry.stableValue) {
                entry.resistance.up = stabilityRes;
                entry.violation = "max";
            } else {
                entry.resistance.down = stabilityRes;
                entry.violation = "min";
            }
            entry.violationPriority = stabilityRes;
            entry.violationTarget = entry.stableValue; 
        } else {
            entry.resistance.up = stabilityRes;
            entry.resistance.down = stabilityRes;
        }
    }
    
    entry.withoutViolatedOrGroups.up = entry.resistance.up;
    entry.withoutViolatedOrGroups.down = entry.resistance.down;
}

// Given a variable, its current value and a violated or-group, this function 
// adds the resistance and violation which the or-group induces on the variable
// to the variable's resistance entry. If this results in the resistance
// increasing, the total resistance of the variable itself is also updated,
// if necessary (if this is a bound variable, this does not update the
// total resistance of the free variables in the same equation, as that is
// calculated separately). If 'recordChanges' is set and the
// addition of this or-group caused the violation and/or the resistance
// of the variable to change, then these changes are recorded into the
// relevant change tables. The function returns true if the resistance 
// of the variable changed as a result of adding this or-group and false
// otherwise.

Resistance.prototype.addOrGroupViolationResistance =
    resistanceAddOrGroupViolationResistance;

function resistanceAddOrGroupViolationResistance(variable, value, group,
                                                 recordChanges)
{
    // get the violation entry for the group 
    var groupEntry =
        this.getViolatedOrGroupVarsGroupEntry(variable, group, false);
    
    if(!groupEntry || groupEntry.target == undefined)
        return false; // violated or-group is not defined on this variable 
    
    var varEntry = this.variables[variable];
    
    if(!varEntry)
        return false;
    
    // do we need to update the violation of this variable?
    if(groupEntry.priority > varEntry.violationPriority) {
        varEntry.violation = (value > groupEntry.target) ? "max" : "min";
        varEntry.violationPriority = groupEntry.priority;
        varEntry.violationTarget = groupEntry.target;
        if(recordChanges)
            this.violationChanged[variable] = true;
    } else if(groupEntry.priority == varEntry.violationPriority &&
              Math.abs(groupEntry.target - value) > 
              Math.abs(varEntry.violationTarget - value)) {
        varEntry.violationTarget = groupEntry.target;
        if(recordChanges)
            this.violationChanged[variable] = true;
    }
    
    var changed = false;
    
    // do we need to update the resistance of this variable?
    // If the variable is bound, the violation always contributes to the
    // resistance, if it is a free variable, only if the bound variables which
    // move with the variable all move in the violation increasing direction.
    if(varEntry.violation == "max") {
        if(!groupEntry.boundVarOpt || !groupEntry.boundVarOpt.num.up) {
            // contributes to the 'up' resistance
            if(varEntry.resistance.up < groupEntry.priority) {
                varEntry.resistance.up = groupEntry.priority;
                changed = true;
                // update total resistance if necessary
                this.addOwnResistanceToTotal(variable, "up");
            }
        }
    } else if(!groupEntry.boundVarOpt || !groupEntry.boundVarOpt.num.down) {
        // contributes to the 'down' resistance
        if(varEntry.resistance.down < groupEntry.priority) {
            varEntry.resistance.down = groupEntry.priority;
            changed = true;
            // update total resistance if necessary
            this.addOwnResistanceToTotal(variable, "down");
        }
    }
    
    if(changed && recordChanges)
        this.resistanceChanged[variable] = true;
    
    return changed;
}

// Combine violated or-group resistance with non-or-group resistance
// (both already assumed to have been calculated) for the given variable.
// All or-groups violated on the variable are added.
// This function does not record changes to the resistanceChanged and
// violationChanged tables. This is assumed to be the responsibility of the
// calling function ('calcResistance') 

Resistance.prototype.addAllOrGroupViolationResistance =
    resistanceAddAllOrGroupViolationResistance;

function resistanceAddAllOrGroupViolationResistance(variable, value)
{
    var violated = this.violatedOrGroupVars[variable];
    
    if(!violated)
        return false; // no violated or-groups affect this variable
    
    for(var group in violated)
        this.addOrGroupViolationResistance(variable, value, group);
}

// This function recalculates the contribution of the or-groups to the
// resistance of the given variable at the given value. The function starts 
// by resetting the resistance to the resistance stored in 
// 'withoutViolatedOrGroups' and then adds the resistance of each or-group. 
// If this resulted in a change in the resistance, this is stored in 
// the resistance changes table. This function updates the violation of 
// the variable only if the or-group violations have a higher priority or 
// a further away target for the same priority as the current violation. 
// However, this fuction cannot update the violation when the change causes 
// the violation to be of lower priority or have a closer target.

Resistance.prototype.recalcViolatedOrGroupResistance =
    resistanceRecalcViolatedOrGroupResistance;

function resistanceRecalcViolatedOrGroupResistance(variable, value)
{
    var entry = this.variables[variable];

    if(!entry) { // complete recalculation
        this.calcResistance(variable, this.solution[variable]);
        return;
    }

    var prevViolationPriority = entry.violationPriority;
    var prevViolationTarget = entry.violationTarget;
    var prevResistance = entry.resistance;

    // reset the resistance to the resistance without violated or groups
    entry.resistance = {};
    entry.resistance.up = entry.withoutViolatedOrGroups.up;
    entry.resistance.down = entry.withoutViolatedOrGroups.down;

    this.addAllOrGroupViolationResistance(variable, value);

    if(entry.resistance.up != prevResistance.up ||
       entry.resistance.down != prevResistance.down)
        this.resistanceChanged[variable] = true;

    if(entry.violationPriority != prevViolationPriority ||
       entry.violationTarget != prevViolationTarget)
        this.violationChanged[variable] = true;
}

// This adds the resistance due to satified or-group resistance on
// the given variable to the resistance of the variable. Resistance 
// due to or-groups which are only satisfied on the given variable
// are stored directly on the main 'resistance' entry while
// resistance due to or-group satisfied on the given variable and
// other variables are stored on the 'satOrGroupResistance' entry.

Resistance.prototype.addSatisfiedOrGroupResistance =
    resistanceAddSatisfiedOrGroupResistance;

function resistanceAddSatisfiedOrGroupResistance(variable)
{
    var entry = this.variables[variable];
    
    if(!entry)
        return;
    
    var tightEntry = this.tightVariables[variable];
    
    if(!tightEntry)
        return;
    
    // resistance contributing to the variable's standard own resistance
    for(var group in tightEntry) {
        
        var groupEntry = tightEntry[group];
        
        if(!groupEntry.varSatByGroup || !groupEntry.onlySatByGroup)
            // affects either total resistance or the special satisfied
            // or-group resistance calculated at the end of the function
            continue;
        
        // get group priority
        var priority = this.segmentConstraints.getOrGroupPriority(group);
        
        if(groupEntry.dir >= 0 &&
           priority > entry.withoutViolatedOrGroups.up)
            entry.withoutViolatedOrGroups.up = priority;
        if(groupEntry.dir <= 0 &&
           priority > entry.withoutViolatedOrGroups.down)
            entry.withoutViolatedOrGroups.down = priority;
    }
    
    if(entry.withoutViolatedOrGroups.up > entry.resistance.up)
        entry.resistance.up = entry.withoutViolatedOrGroups.up;
    if(entry.withoutViolatedOrGroups.down > entry.resistance.down)
        entry.resistance.down = entry.withoutViolatedOrGroups.down;
    
    // similar calculation, but now only for or-group satisfied both on this
    // variable and other variables.
    this.calcMultiVariableSatisfiedOrGroupResistance(variable);
}

// This function calculates the resistance due to satisfied or groups
// which are satisfied on the given 'variable' but also on other variables. 
// This resistance is stored on the 'satOrGroupResistance' fields of the
// variable's resistance entry. When both the up and down resistance 
// becomes -Infinity, the 'satOrGroupResistance' entry is removed from 
// the resistance entry.
// If 'exceptGroup' is given, this calculation ignore the contribution
// of the group given in 'exceptGroup' to the resistance (this can be used
// when the resistance due to 'exceptGroup' is about to be removed. 

Resistance.prototype.calcMultiVariableSatisfiedOrGroupResistance = 
    resistanceCalcMultiVariableSatisfiedOrGroupResistance;

function resistanceCalcMultiVariableSatisfiedOrGroupResistance(variable,
                                                               exceptGroup)
{
    var entry = this.variables[variable];
    
    if(!entry)
        return;
    
    var tightEntry = this.tightVariables[variable];
    
    if(!tightEntry && !entry.satOrGroupResistance)
        return; // nothing to do (the most typical case)
    
    var satResistance = {
        up: -Infinity,
        down: -Infinity
    };
    
    for(var group in tightEntry) {
        
        if(group == exceptGroup)
            continue;
        
        var groupEntry = tightEntry[group];
        
        if(!groupEntry.varSatByGroup || groupEntry.onlySatByGroup)
            // does not contribute to this resistance
            continue;
        
        // get group priority
        var priority = this.segmentConstraints.getOrGroupPriority(group);
        
        if(groupEntry.dir >= 0 && priority > satResistance.up)
            satResistance.up = priority;
        if(groupEntry.dir <= 0 && priority > satResistance.down)
            satResistance.down = priority;
    }
    
    if(satResistance.up == -Infinity && satResistance.down == -Infinity) {
        if(entry.satOrGroupResistance) {
            this.satOrGroupResistanceChanged[variable] = true;
            delete entry.satOrGroupResistance;
        }
    } else if(!entry.satOrGroupResistance || 
              entry.satOrGroupResistance.up != satResistance.up ||
              entry.satOrGroupResistance.down != satResistance.down) {
        this.satOrGroupResistanceChanged[variable] = true;
        entry.satOrGroupResistance = satResistance;
    }
}

////////////////////////
// Resistance Refresh //
////////////////////////

// This function should be called when a bound variable 'boundVar'
// is no longer bound in a zero-error equation. If it later becomes bound
// in (the some/other) zero-error equation, this function should be called
// before that assignment takes place.

Resistance.prototype.refreshAfterBoundVarRemoved =
    resistanceRefreshAfterBoundVarRemoved;

function resistanceRefreshAfterBoundVarRemoved(boundVar)
{
    // calculate the effect of this removal on the total resistance
    this.removeBoundVarTotalResistance(boundVar, true);
    // calculate the effect on or-group resistance
    this.orGroupResistanceRemoveBoundVar(boundVar);
}

// This function should be called when a variable 'boundVar'
// becomes bound in a zero-error equation (before it may not have been
// bound in the equation or bound but the equation error was not zero).
// This function does not check that the variable is bound in a zero-error
// equation, it is up to the calling function to verify this.

Resistance.prototype.refreshAfterBoundVarAdded =
    resistanceRefreshAfterBoundVarAdded;

function resistanceRefreshAfterBoundVarAdded(boundVar)
{
    // calculate the effect of this removal on the total resistance
    this.refreshTotalAfterBoundVarChange(boundVar, undefined, true);
    // calculate the effect on or-group resistance
    this.orGroupResistanceAddBoundVar(boundVar);
}

// This function should be called after the given equation changed but its
// bound variable did not change (or at least, under the assumption that
// any bound variable change has been handled separately). The function then
// updates (or schedules for recalculation) the total and or-group
// resistance affected by this change.

Resistance.prototype.refreshAfterEquationChange =
    resistanceRefreshAfterEquationChange;

function resistanceRefreshAfterEquationChange(eqId)
{
    this.refreshTotalAfterEquationChange(eqId);
    this.orGroupResistanceAfterEquationChange(eqId);
}

// This function should be called after the bound variable of the given
// equation changed but the equation itself did not (e.g. after exchanging
// the booud variable in the equation with one of the free variables).
// The function then updates (or schedules for recalculation) the total
// and or-group resistance affected by this change.

Resistance.prototype.refreshAfterBoundVarChange =
    resistanceRefreshAfterBoundVarChange;

function resistanceRefreshAfterBoundVarChange(boundVar, prevBoundVar)
{
    this.refreshTotalAfterBoundVarChange(boundVar, prevBoundVar, true);
    this.orGroupResistanceAfterBoundVarChange(boundVar, prevBoundVar);
}

// This function performs all resistance calculation queued in the
// 'needRecalcViolatedOrGroupResistance' and 'needRecalc' tables. 
// For variables appearing only in 'needRecalcViolatedOrGroupResistance'
// (and not in 'needRecalc') neither the resistance without violated or-groups
// nor the violation is recalculated. For variable appearing in 'needRecalc',
// the full resistance calculation is carried out.
// Before exiting, the function clears the two tables.

Resistance.prototype.calcPendingResistance = resistanceCalcPendingResistance;

function resistanceCalcPendingResistance()
{
    for(var variable in this.needRecalcViolatedOrGroupResistance) {
        
        // the variable may no longer be in the equations
        if(!this.posEquations.hasVariable(variable))
            continue;
        
        if(this.needRecalc[variable])
            continue; // will be fully calculated below
        
        this.recalcViolatedOrGroupResistance(variable, 
                                             this.solution[variable]);
    }
    
    for(var variable in this.needRecalc)
        this.calcResistance(variable, this.solution[variable]);
    
    this.needRecalcViolatedOrGroupResistance = {};
    this.needRecalc = {};
}

Resistance.prototype.calcAllPending = resistanceCalcAllPending;

function resistanceCalcAllPending()
{
    this.processOrGroupChanges();
    this.calcPendingResistanceFromViolatedOrGroups();
    this.calcPendingTotalResistanceFromViolatedOrGroups();
    this.calcPendingTightOrGroups();
    this.calcPendingResistance();
    this.calcTotalOfAllPending();
}

///////////////////
// Stable Values //
///////////////////

// This function sets the current of the given variable as the new stable
// value of the variable. If the stability priority is not -Infinity, the
// resistance and violations may have to be recalculated.
// The function returns true if this changed the resistance of the variable.

Resistance.prototype.setStableValue = resistanceSetStableValue;

function resistanceSetStableValue(variable)
{
    var entry = this.variables[variable];
    var stableValue = this.solution[variable];

    if(!entry || stableValue == undefined)
        return false;
    
    if(entry.stableValue == stableValue)
        return false; // stable value did not change, nothing to do
    
    // set the new stable value
    entry.stableValue = stableValue;
    
    // get the stability resistance
    var stabilityRes = entry.stabilityResistance;
    
    
    if(stabilityRes == undefined || stabilityRes == -Infinity)
        return false; // no stability resistance
    
    // recalculate the resistance
    this.calcResistance(variable, stableValue);
    return true;
}

// This function returns the stable value as registered for the given
// variable. undefined is returned if this value is not known

Resistance.prototype.getStableValue = resistanceGetStableValue;

function resistanceGetStableValue(variable)
{
    if(!this.variables[variable])
        return undefined;
    
    return this.variables[variable].stableValue;
}

//////////////////////////////////
// External Interface Functions //
//////////////////////////////////

// Remove the given variable from the tables.

Resistance.prototype.remove = resistanceRemove;

function resistanceRemove(variable)
{
    delete this.variables[variable];
    delete this.needRecalc[variable];
    delete this.pendingRecalcTotal[variable];
    delete this.needRecalcViolatedOrGroupResistance[variable];
}

// This function returns the maximal resistance of the given variable
// (this is the maximum between resistanceUp and resistanceDown).
// If the variable does not yet appear in the resistance table, undefined
// is returned.

Resistance.prototype.getMaxResistance = resistanceGetMaxResistance;

function resistanceGetMaxResistance(variable)
{
    var entry = this.variables[variable];

    if(!entry)
        return undefined;

    return Math.max(entry.resistance.up, entry.resistance.down);
}

// This function returns the maximal resistance of the given variable
// (this is the maximum between resistanceUp and resistanceDown).
// If the variable does not yet appear in the resistance table, undefined
// is returned.

Resistance.prototype.getMinResistance = resistanceGetMinResistance;

function resistanceGetMinResistance(variable)
{
    var entry = this.variables[variable];

    if(!entry)
        return undefined;

    return Math.min(entry.resistance.up, entry.resistance.down);
}

// This function returns the 'up' resistance (resistance to increase in
// value) of the given variable.
// If the variable does not yet appear in the resistance table, undefined
// is returned.

Resistance.prototype.getUpResistance = resistanceGetUpResistance;

function resistanceGetUpResistance(variable)
{
    var entry = this.variables[variable];

    if(!entry)
        return undefined;

    return entry.resistance.up;
}

// This function returns the 'down' resistance (resistance to decrease in
// value) of the given variable.
// If the variable does not yet appear in the resistance table, undefined
// is returned.

Resistance.prototype.getDownResistance = resistanceGetDownResistance;

function resistanceGetDownResistance(variable)
{
    var entry = this.variables[variable];

    if(!entry)
        return undefined;

    return entry.resistance.down;
}

// This function returns the resistance for 'variable' in the direction 
// 'dir' (where 'dir' can be either 'up' or 'down').

Resistance.prototype.getResistance = resistanceGetResistance;

function resistanceGetResistance(variable, dir)
{
    var entry = this.variables[variable];
    
    if(!entry)
        return -Infinity;
    
    return entry.resistance[dir];
}

// This function returns the resistance to movement of 'variable' in 
// the given direction ("up" or "down") due to satisfied or groups 
// satisfied on this variable as well as at least one more variable.
// If the information is not recorded on the resistance entry of the 
// variable (or no such resisting group exists), -Infinity is returned.
// Note that even if there are such satisfied or-groups, their resistance
// is only calculated and stored on the variable's entry if this was requested
// by some module (typically, when the total resistance of the variable
// needs to be calculated or when the variable is blocked). 

Resistance.prototype.getSatOrGroupResistance = 
    resistanceGetSatOrGroupResistance;

function resistanceGetSatOrGroupResistance(variable, dir)
{
    var entry = this.variables[variable];
    
    if(!entry || !entry.satOrGroupResistance)
        return -Infinity;
    
    return entry.satOrGroupResistance[dir];
}

// This function returns the resistance to movement of 'variable' in 
// the given direction ("up" or "down") due either to standard resistance 
// or to satisfied or groups satisfied on this variable as well as at least 
// one more variable. This is the maximum of the values returned by 
// 'getResistance' and 'getSatOrGroupResistance' for this direction and
// value.

Resistance.prototype.getResistanceWithSatOrGroups = 
    resistanceGetResistanceWithSatOrGroups;

function resistanceGetResistanceWithSatOrGroups(variable, dir)
{
    var entry = this.variables[variable];
    
    if(!entry)
        return -Infinity;
    
    if(entry.satOrGroupResistance && 
       entry.satOrGroupResistance[dir] > entry.resistance[dir])
        return entry.satOrGroupResistance[dir];
    
    return entry.resistance[dir];
}

// Given a variable, this function returns true if, in some direction, the
// resistance of the function with violated or-groups is higher than its
// resistance without them. This can only happen if the variable has
// a violation and then the resistance difference is in the direction
// of increased violation. 

Resistance.prototype.violationIsOrGroup = resistanceViolationIsOrGroup;

function resistanceViolationIsOrGroup(variable)
{
    var entry = this.variables[variable];
    
    if(!entry || !entry.violation)
        // not a violated variable
        return false;
    
    // direction of increased violation
    var dir = (entry.violation == "max") ? "up" : "down";
    
    return (entry.withoutViolatedOrGroups[dir] < entry.resistance[dir]);
}

// Given a violated bound variable in a zero-error equation and
// a free variable in that equation, this function checks whether the
// resistance of the bound variable to movement of the free variable
// in the direction which increases the violation on the bound variable
// is at least as high as the violation priority. For violations which
// are non-or-group violations, this holds immediately. However, if
// the violation is an or-group violation, it may be that the movement
// of the free variable in the direction which increases the violation
// of the bound variable reduces the violation of the violated or-group on
// some other variable in the or-group. In this case, the resistance
// to the movement may be less than the violation priority. This function
// returns true if the resistance of the bound variable to movement is
// at least equal to the bound variable's violation priority and
// false otherwise.
// 'moduleName' is optional and may hold the name of the module which
// requested this calculation. If the module name is given and if or-group
// resistance has to be included in this calculation, the variable
// will be registered to the 'freeRequireOrGroupResistance' table for
// this module.
// Note: If moduleName is not given, this function does not register
// the variable to the 'freeRequireOrGroupResistance'. This means that
// unless the calling function registered the variable to the
// 'freeRequireOrGroupResistance' table, the variable's entry may
// disappear from the table (and then no notification will be generated
// when the resistance for these entries changes).
//
// This function does not check that the bound variable is indeed bound,
// that its' equation has zero error, that it is violated or that
// the free variable is in the bound variable's equation. It is assumed
// that the calling function already verified this.
// However, if one of these assumptions turns out to be wrong in the course
// of running this function, the function may return false.

Resistance.prototype.violatedBoundResistsFree =
    resistanceViolatedBoundResistsFree;

function resistanceViolatedBoundResistsFree(freeVar, boundVar, moduleName)
{
    var boundEntry = this.variables[boundVar];
    
    if(!boundEntry || !boundEntry.violation)
         // not a violated bound variable, an error
        return false;

    // direction of increased violation of bound variable
    var boundDir = (boundEntry.violation == "max") ? "up" : "down";
    
    if(boundEntry.withoutViolatedOrGroups[boundDir] ==
       boundEntry.resistance[boundDir])
        // the resistance of the bound variable includes the violation
        // of the variable, so this is sufficient
        return true;

    // check or-group resistance
    
    // add this free variable to the list of variable for which
    // or-group resistance needs to be tracked
    this.addToRequireOrGroupResistance(freeVar, moduleName);

    // do the violated or-groups on the bound variable provide sufficient
    // resistance in the violation increasing direction?
    if(this.violatedOrGroupsOfBoundResistFree(freeVar, boundVar))
        return true;

    // do the satisfied or-groups on the bound variable provide sufficient
    // resistance in the violation increasing direction?
    return this.satisfiedOrGroupsOfViolatedBoundResistFree(freeVar, boundVar);
}

// This function returns true if the given variable is registered in the
// variable list with a violation priority higher than -Infinity and
// false otherwise.

Resistance.prototype.hasViolation = resistanceHasViolation;

function resistanceHasViolation(variable)
{
    var entry = this.variables[variable];

    if(!entry)
        return false;

    return (entry.violationPriority > -Infinity);
}

// This function returns the violation priority of the given variable.
// -Infinity is return if the variable does not appear in the resistance
// tables or it has no violation.

Resistance.prototype.getViolationPriority = resistanceGetViolationPriority;

function resistanceGetViolationPriority(variable)
{
    var entry = this.variables[variable];
    
    if(!entry)
        return -Infinity;
    
    return entry.violationPriority;
}

// This function clears the lists of variables for which the resistance
// or total resistance changed.

Resistance.prototype.clearResistanceChanges = resistanceClearResistanceChanges;

function resistanceClearResistanceChanges()
{
    this.resistanceChanged = {};
    this.satOrGroupResistanceChanged = {};
    this.tightOrGroupChanged = {};
    this.violationChanged = {};
    this.totalResistanceChanged = {};
}

//////////////////////
// Total Resistance //
//////////////////////

// This function should be called to get the up-to-date total
// resistance entry of 'variable'. In addition to 'variable',
// this function also takes as an argument the direction ("up"|"down")
// in which the total resistance of the variable needs to be calculated.
// The function returns the total resistance entry for the variable
// (see the documentation of the 'totalResistance' table for a description
// of the object returned).
//
// For a free variable, if an entry for this variable and this direction
// are already present in the 'totalResistance' table, the entry is simply
// returned (it is assumed that it is up-to-date so this function should
// only be called after all pending resistance calculations have been carried
// out). If the variable does not appear in the totalResistance table or
// it appears but with the opposite direction, this function adds
// the variable to the 'totalResistance' and 'freeRequireOrGroupResistance'
// tables (if necessary) and if the variable is new in the totalResistance
// table, it also initializes the calculation of all or-group table entries
// relevant to the calculation. It then calls the total resistance
// calculation (which is carried out immediately).
// The total resistance entries added in this way will continue to be
// updated incrementally as the equations and the values of the variables
// change. When there is no need anymore to calculate the total resistance
// of a free variable, one should call 'removeTotalResistanceVariable'.
//
// For bound variables there is no need to calculate the total resistance,
// since this is always equal to the variable's own resistance in the
// corresponding direction. Therefore, if the variable is bound, this
// function simply returns an object of the form:
// {
//    dir: <the direction given to this function>
//    resistance: <the variable's own resistance in this direction>
// }
//
// If 'direction' is undefined, this function does not (re)calculate the
// total resistance but simply returns whatever value is already available
// (or returns undefined if no value is available). Specifically, for bound
// variables this will return undefined.

Resistance.prototype.getTotalResistance = resistanceGetTotalResistance;

function resistanceGetTotalResistance(variable, direction)
{
    if(direction == undefined)
        return this.totalResistance[variable]; // may be undefined
    
    if(this.boundVars[variable] != undefined) {
        
        // a bound variable, return the variable's own resistance
        
        var varEntry = this.variables[variable];
        return { dir: direction, resistance: varEntry.resistance[direction] };
    }
    
    if(!this.totalResistance[variable]) {

        this.totalResistance[variable] = {
            dir: direction,
            resistance: -Infinity
        };
        this.totalResistanceNum++;

        // or-groups
        this.addToRequireOrGroupResistance(variable, "total");
        this.calcAllOrGroupsForFreeVar(variable, false);
        
    } else if(this.totalResistance[variable].dir == direction)
        return this.totalResistance[variable]; // nothing to do
    else // change of direction
        this.totalResistance[variable] = {
            dir: direction,
            resistance: -Infinity
        };
    
    this.calcTotalResistance(variable, false);
    return this.totalResistance[variable];
}

// This function should be called when it is no longer necessary for the
// total resistance of 'freeVar' to be calculated. The function removes
// the entry for the variable from the totalResistance table and removes
// the requirement for or-groups entries to be calculated for this variable
// (if the variable does not belong to those or-groups).

Resistance.prototype.removeTotalResistanceVariable =
    resistanceRemoveTotalResistanceVariable;

function resistanceRemoveTotalResistanceVariable(freeVar)
{
    var total = this.totalResistance[freeVar];
    
    if(!total)
        return;
    
    // clear the corresponding entry in the 'resistingBoundVariables' table
    if(total.resistingVar != undefined)
        this.clearFreeFromBound(total.resistingVar, freeVar);
    
    delete this.totalResistance[freeVar];
    this.totalResistanceNum--;
    
    this.removeFromRequireOrGroupResistance(freeVar, "total");
}

// This function removes variables from the totalResistance list
// (when there is no longer need to calculate their total resistance).
// The function removes all variables in the totalResistance table
// except for those appearing in the 'exceptions' list (which is optional
// and, if give, should be an object whose attributes are the variables
// which should not be removed).

Resistance.prototype.removeAllTotalResistanceVariablesExcept =
    resistanceRemoveAllTotalResistanceVariablesExcept;

function resistanceRemoveAllTotalResistanceVariablesExcept(exceptions)
{
    for(var freeVar in this.totalResistance) {

        if(exceptions && exceptions[freeVar])
            continue;

        this.removeTotalResistanceVariable(freeVar);
    }
}

// This auxiliary function clears the given free variable from the
// entry of the bound variable in 'this.resistingBoundVars'. If this leaves the
// bound variable's entry empty, that entry is deleted.

Resistance.prototype.clearFreeFromBound = resistanceClearFreeFromBound;

function resistanceClearFreeFromBound(boundVar, freeVar)
{
    var boundEntry = this.resistingBoundVars[boundVar];
    
    if(!boundEntry)
        return;
    
    delete boundEntry[freeVar];
    
    if(isEmptyObj(boundEntry))
        delete this.resistingBoundVars[boundVar];
}

// This auxiliary function adds the given free variable to the
// entry of the bound variable in 'this.resistingBoundVars'.

Resistance.prototype.addFreeToBound = resistanceAddFreeToBound;

function resistanceAddFreeToBound(boundVar, freeVar)
{
    if(!this.resistingBoundVars[boundVar])
        this.resistingBoundVars[boundVar] = {};

    this.resistingBoundVars[boundVar][freeVar] = true;
}

// This function should be called to add the contribution of the 'resistingVar'
// and 'resistingOrGroup' (if the resistance is due to an or-group)
// to the total resistance of 'variable'. 'resistance' is the resistance
// contributed by 'resistingVar'. 'resistingVar' may be equal to 'variable',
// in which case the 'resistance' is the variable's own resistance in 
// the relevant direction (in this case 'resistingOrGroup' should be 
// undefined). In case the resistance is due to an or-group,
// 'resistingOrGroup' should be the name of that group (otherwise, it 
// should be undefined). The 'resistingOrGroup' should also be undefined
// if the resistance of the or-group is already included in the variable's
// own resistance.
// This function should be called for resistance due to satisfied or-groups 
// only if the variable itself does not satisfy the or-group. 
// This function checks whether the given resistance is greater than the
// currently registered total resistance. If it is, the total resistance
// is set to the given resistance and the 'resistingVar' and 
// 'resistingOrGroup' are set as the resisting variable and or-group for 
// the total resistance entry. If the 'resistance'
// is equal to the current total resistance and 'resistingVar' is equal 
// to 'variable' (own resistance) then any other resisting variable registered
// on the total resistance entry is removed. Similarly, if the 'resistance'
// is equal to the current total resistance and 'resistingOrGroup' is undefined
// while the current total resistance entry has a defined 'resistingOrGroup'
// (which also implies it has a 'resistingVar') the new resisting variable
// is set on the total resistance entry and the resisting or-group is removed.
// The 'incrementOnly' flag determines what to do when the given resistance
// is smaller than the total resistance already registered for the variable.
// If 'incrementOnly' is true, then in case the given resistance is smaller
// than the total resistance already registered for the variable, nothing 
// is done. If 'incrementOnly' is false, the function checks whether the
// given 'resistingVar' or 'resistingOrGroup' is already registered as 
// the resisting variable for the current total resistance. If it is, then, 
// since the resistance contributed by that variable has decreased, 
// the total resistance needs to be completely recalculated. The function 
// queues this recalculation and exits (therefore, always use 
// incrementOnly == true when this function is called from within the total 
// resistance calculation function and only use incrementOnly == false when 
// calling the function from an incremental update function). 
// If 'refreshBoundVarList' is true,
// the resisting (bound) variable is recorded to the 'resistingBoundVars' 
// table. The previous resistingVar is cleared (if necessary) from 
// the resistingBoundVars table whether the refreshBoundVarList flag is set 
// or not. Call this function with a false value for refreshBoundVarList
// if this is a part of a sequence of changes and the bound variable
// assigned here may still change. It is then up to the calling function
// to update the resistingBoundVars table.
// If 'recordChanges' is set and this operation resulted in a change to
// the total resistance, the function records this change to the change tables.
//
// This function does not check whether the resisting variable indeed 
// produces the given resistance in the required direction - this is
// the responsibility of the calling function. 

Resistance.prototype.addToTotalResistance = resistanceAddToTotalResistance;

function resistanceAddToTotalResistance(variable, resistance, resistingVar,
                                        resistingOrGroup, incrementOnly,
                                        refreshBoundVarList, recordChanges)
{
    // get the total resistance entry
    var total = this.totalResistance[variable];
    
    if(!total)
        return;
    
    // inside the total resistance object we use an 'undefined' resisting
    // variable to indicate resistance by the variable itself
    if(resistingVar == variable)
        resistingVar = undefined;
    
    if(resistance >= total.resistance) {
        // check whether the resisting variable/or-group need to be updated
        // Even if the resistance did not change, we prefer an 'undefined' 
        // resisting variable (own variable resistance) and an 'undefined'
        // resisting or-group (a resisting or-group is only possible when 
        // resistingVar is not undefined)
        if(resistance > total.resistance || resistingVar == undefined ||
           (total.resistingOrGroup != undefined &&
            resistingOrGroup == undefined))
            this.setTotalResistingVarAndGroup(total, variable, 
                                              resistingVar, resistingOrGroup, 
                                              refreshBoundVarList);
        
        if(recordChanges && resistance > total.resistance)
            this.totalResistanceChanged[variable] = true;
        
        total.resistance = resistance;
        
    } else if(!incrementOnly &&
              ((resistingOrGroup != undefined && 
                total.resistingOrGroup == resistingOrGroup) ||
               (resistingOrGroup == undefined && 
                total.resistingVar == resistingVar))) {
        // total resistance is due to this variable/or-group and the
        // resistance of this variable/or-group decreased - need to recalculate
        this.pendingRecalcTotal[variable] = true;
    }
}

// This function sets the given resisting variable (resistingVar) and 
// resisting or-group (if given) as the 'resistingVar' and 'resistingOrGroup' 
// on the given total resistance 'entry'.
// If refreshBoundVarList is true,
// the resisting variable is recorded to the 'resistingBoundVars' table.
// The previous resistingVar is cleared from the resistingBoundVars
// table whether the refreshBoundVarList flag is set or not.
// Call this function with a false value for refreshBoundVarList
// if this is a part of a sequence of changes and the bound variable
// assigned here may still change. It is then up to the calling function
// to update the resistingBoundVars table.
// If 'resistingVar' is undefined, this only clears the existing
// resisting variable.

Resistance.prototype.setTotalResistingVarAndGroup = 
    resistanceSetTotalResistingVarAndGroup;

function resistanceSetTotalResistingVarAndGroup(entry, freeVar, resistingVar, 
                                                resistingOrGroup,
                                                refreshBoundVarList)
{
    // update the resisting or-group
    entry.resistingOrGroup = resistingOrGroup;
    
    // update the resisting variable
    
    if(entry.resistingVar == resistingVar)
        return; // nothing to do
    
    if(entry.resistingVar != undefined) {
        // need to remove the previous resisting variable
        this.clearFreeFromBound(entry.resistingVar, freeVar);
    }
    
    // set the new resisting variable
    if(resistingVar == undefined)
        delete entry.resistingVar;
    else {
        entry.resistingVar = resistingVar;
        if(refreshBoundVarList)
            this.addFreeToBound(resistingVar, freeVar);
    }
}

// Given a variable and a direction ("up" or "down"), this function
// checks whether the total resistance of the given variable and direction
// needs to be calculated and whether it is currently smaller or equal
// the variable's own resistance. If this holds, the total resistance
// is updated to equal the variable's own resistance.

Resistance.prototype.addOwnResistanceToTotal =
    resistanceAddOwnResistanceToTotal;

function resistanceAddOwnResistanceToTotal(variable, dir)
{
    var total = this.totalResistance[variable];

    if(!total || total.dir != dir)
        return;

    var varEntry = this.variables[variable];

    if(!varEntry)
        return;

    this.addToTotalResistance(variable, varEntry.resistance[dir], variable, 
                              undefined, true, true, true);
}

// This function is called with the entries of a free variable and a bound
// variable which appear in the same equation. 'relativeMovementDir' is
// -1 or +1 and represents the relative movement direction of the free and
// bound variable. Given this, if the resistance of the bound variable
// is greater than the currently registered total resistance of the free
// variable (in the corresponding direction) this function increases the
// total resistance of the free variable and registers the bound variable
// as the variable which determines the total resistance.
// All this will take place only if the free variable has an entry
// in the 'totalResistance' table.
//
// This function ignores the resistance due to or-groups (which is 
// added to the total resistance by other functions). For this reason,
// the function only looks at the 'withoutViolatedOrGroups' resistance
// of the bound variable. 
//
// This function clears the previous entry in 'resistingBoundVars' if it
// was overwritten. It records the new resisting bound variable
// only if 'refreshBoundVarList' is set.
// This function is for internal use only.

Resistance.prototype.increaseTotalResistanceByBound =
    resistanceIncreaseTotalResistanceByBound;

function resistanceIncreaseTotalResistanceByBound(freeVar, boundVar,
                                                  boundEntry,
                                                  relativeMovementDir,
                                                  refreshBoundVarList)
{
    // get the total resistance entry for the free variable
    var freeEntry = this.totalResistance[freeVar];

    if(!freeEntry)
        return;
    
    // determine direction of movement of the bound variable
    var boundDir =
        (relativeMovementDir < 0 ? this.opDirs : this.sameDirs)[freeEntry.dir];
    
    var resistance = boundEntry.withoutViolatedOrGroups[boundDir];
        
    this.addToTotalResistance(freeVar, resistance, boundVar, undefined, 
                              true, refreshBoundVarList, true);
}

// This function calculates the total resistance of the given variable.
// The total resistance is calculated only if the variable already has an entry
// in the 'totalResistance' table.
// The function assumes that the variable's own resistance has already
// been calculated.
// If the flag 'queueRecalc' is set, this function does not recalculate
// the total resistance but simply queues this recalculation, to be
// carried out later.

Resistance.prototype.calcTotalResistance =
    resistanceCalcTotalResistance;

function resistanceCalcTotalResistance(variable, queueRecalc)
{
    var total = this.totalResistance[variable];

    if(!total)
        return; // no need to calculate total resistance for this variable
    
    if(queueRecalc) {
        this.pendingRecalcTotal[variable] = true;
        return;
    }
    
    delete this.pendingRecalcTotal[variable];

    // the variable's resistance entry
    var varEntry = this.variables[variable];

    if(!varEntry)
        return; // own resistance not yet calculated

    // store the previous total resistance
    var prevTotal = total.resistance;
    
    // initialize the total resistance to be equal to the variable's own
    // resistance (clear any previous total resistance calculation).
    total.resistance = varEntry.resistance[total.dir];
    if(total.resistingVar != undefined) {
        this.clearFreeFromBound(total.resistingVar, variable);
        delete total.resistingVar;
    }

    // clear the fields holding the total resistance without the contribution
    // of satisfied or groups which are satisfied on this variable (this
    // is only relevant if such groups exist).
    delete total.withoutOwnSatOrGroups;
    
    // if this is a bound variable, we are done (register a change, if any)
    if(this.boundVars[variable] != undefined) {
        if(prevTotal != total.resistance)
            this.totalResistanceChanged[variable] = true;
        return;
    }
    
    // loop over the equations in which this variable appears
    var nonZeroEq = this.equations.componentIndex.get(variable);
    var _self = this;    
    nonZeroEq.forEach(function(e, eqId) {

        // check whether the equation has a zero error
        if(eqId in _self.innerProducts)
            return; // not a zero error equation

        // get the bound variable of the equation
        var boundVar = _self.boundVarsByEq[eqId];

        if(boundVar == undefined)
            return;
        
        // get the bound variable's resistance entry
        var boundEntry = _self.variables[boundVar];

        if(!boundEntry)
            return;
        
        var variableValue = e.value;
        var boundVarValue = _self.equations.getValue(eqId, boundVar);

        // if this bound variable increases the total resistance of the free
        // variable, increase it.
        _self.increaseTotalResistanceByBound(variable, boundVar, boundEntry,
                                             -variableValue*boundVarValue,
                                             false);
    });

    // add total resistance due to or-groups (both satisfied and violated)
    this.addOrGroupTotalResistance(variable, false);

    // add entries to the resistingBoundVars table
    if(total.resistingVar != undefined)
        this.addFreeToBound(total.resistingVar, variable);

    if(prevTotal != total.resistance) // register the change
        this.totalResistanceChanged[variable] = true;
}

// This function adds total resistance induced by or-groups on the given
// variable. The function updates the variable's total resistance entry.
// If this function assigns a new 'resistingVar' variable, that variable 
// is recorded to the 'resistingBoundVars' table only if refreshBoundVarList
// is set. The previous resistingVar is cleared from the 
// resistingBoundVars table whether the refreshBoundVarList flag is set or not.

Resistance.prototype.addOrGroupTotalResistance = 
    resistanceAddOrGroupTotalResistance;

function resistanceAddOrGroupTotalResistance(variable, refreshBoundVarList)
{
    this.addViolatedOrGroupTotalResistance(variable, refreshBoundVarList,
                                           false);
    this.addSatisfiedOrGroupTotalResistance(variable, refreshBoundVarList);
}

// This function adds total resistance induced by satisfied or-groups on 
// the given variable. The function updates the variable's total resistance
// entry. If this function assigns a new 'resistingVar' variable, that 
// variable is recorded to the 'resistingBoundVars' table only if 
// refreshBoundVarList is set. The previous resistingVar is cleared from the 
// resistingBoundVars table whether the refreshBoundVarList flag is set or not.

Resistance.prototype.addSatisfiedOrGroupTotalResistance = 
    resistanceAddSatisfiedOrGroupTotalResistance;

function resistanceAddSatisfiedOrGroupTotalResistance(variable, 
                                                      refreshBoundVarList)
{
    if(!this.tightVariables[variable])
        return;
    
    var total = this.totalResistance[variable];
    
    if(!total)
        return;
    
    // add total resistance due to satisfied or-groups
    for(var group in this.tightVariables[variable]) {
        
        var groupEntry = this.tightVariables[variable][group];
        
        // the or-group contributes to the total resistance only if the
        // variable does not satisfy the group
        if(groupEntry.varSatByGroup)
            continue;

        if(!((total.dir == "up" && groupEntry.dir >= 0) ||
             (total.dir == "down" && groupEntry.dir <= 0)))
            continue;

        // get the group resistance
        var priority = this.segmentConstraints.getOrGroupPriority(group);
	
        this.addToTotalResistance(variable, priority, 
                                  groupEntry.representative, group, 
                                  true, refreshBoundVarList, true);
    }
}

// This function adds total resistance induced by violated or-groups on 
// the given variable. The function updates the variable's resistance entry 
// If this function assigns a new 'resistingVar' variable, that variable 
// is recorded to the 'resistingBoundVars' table only if refreshBoundVarList
// is set. The previous resistingVar is cleared from the 
// resistingBoundVars table whether the refreshBoundVarList flag is set or not.
// If 'recordChanges' is set and this operation resulted in a change to
// the total resistance, the function records this change to the change tables.

Resistance.prototype.addViolatedOrGroupTotalResistance = 
    resistanceAddViolatedOrGroupTotalResistance;

function resistanceAddViolatedOrGroupTotalResistance(variable, 
                                                     refreshBoundVarList,
                                                     recordChanges)
{
    var violationEntry = this.violatedOrGroupVars[variable];
    
    if(!violationEntry)
        return;
    
    // loop over the violated groups
    for(var group in violationEntry)
        this.addSingleViolatedOrGroupTotalResistance(variable, group,
                                                     refreshBoundVarList,
                                                     recordChanges);
}

// This function adds total resistance induced by the given violated or-group
// on the given variable. The function updates the variable's resistance entry 
// If this function assigns a new 'totalResistanceVar' variable, that variable 
// is recorded to the 'resistingBoundVars' table only if refreshBoundVarList
// is set. The previous totalResistanceVar is cleared from the 
// resistingBoundVars table whether the refreshBoundVarList flag is set or not.
// If 'recordChanges' is set and this operation resulted in a change to
// the total resistance, the function records this change to the change tables.

Resistance.prototype.addSingleViolatedOrGroupTotalResistance =
    resistanceAddSingleViolatedOrGroupTotalResistance;

function resistanceAddSingleViolatedOrGroupTotalResistance(variable, group,
                                                           refreshBoundVarList,
                                                           recordChanges)
{
    var groupEntry = this.getViolatedOrGroupVarsGroupEntry(variable, group);

    if(!groupEntry)
        return; // not a violated group on this variable

    var total = this.totalResistance[variable];

    if(!total)
        return; // total resistance not required for this variable    
    
    if(groupEntry.target !== undefined)
        // this variable belongs to the group, so any total resistance
        // induced by the group would already be included in the resistance
        // of the variable.
        return;

    var boundVarOpt = groupEntry.boundVarOpt;
        
    if(boundVarOpt && boundVarOpt.num[total.dir] == 0 && 
       boundVarOpt.num[this.opDirs[total.dir]] > 0) {
        
        var representative = 
            objFirstProp(boundVarOpt[this.opDirs[total.dir]]);
        
        this.addToTotalResistance(variable, groupEntry.priority, 
                                  representative, group, true, 
                                  refreshBoundVarList, recordChanges);
    }
}

// This function loops over all variables in the 'pendingRecalcTotal'
// list and calculates their total resistance. The list is then cleared.

Resistance.prototype.calcTotalOfAllPending = resistanceCalcTotalOfAllPending;

function resistanceCalcTotalOfAllPending()
{
    for(var variable in this.pendingRecalcTotal)
        this.calcTotalResistance(variable, false);
    
    this.pendingRecalcTotal = {};
}

// This function is called when the given bound variable is no longer
// a bound variable. This can happen if the bound variable becomes free
// or is completely removed. This function can also be called when the
// equation in which the bound variable appears becomes a non-zero error
// equation (in this case the bound variable no longer resists movement of
// the free variables).
// This function goes over all variables whose
// total resistance was determined by the resistance of this bound variable.
// If 'queueRecalc' is true, the total resistance of these variables
// is scheduled for recalculation. Otherwise, the total resistance is
// recalculated immediately.

Resistance.prototype.removeBoundVarTotalResistance =
    resistanceRemoveBoundVarTotalResistance;

function resistanceRemoveBoundVarTotalResistance(boundVar, queueRecalc)
{
    if(boundVar == undefined)
        return;
    
    var freeVars = this.resistingBoundVars[boundVar];
    
    if(!freeVars)
        return;
    
    for(var freeVar in freeVars) {
        // need to recalculate, 
        this.calcTotalResistance(freeVar, queueRecalc);
    }
    
    delete this.resistingBoundVars[boundVar];
}

//
// Total Resistance Refresh Functions
//

// This function is called to update the total resistance when a new
// bound variable is assigned to an equation. If another variable was
// previously assigned as the bound variable for this equation, this
// variable is given as an argument to this function (the resistance
// due to that old bound variable needs to be removed).
// This function can also be called when an equation becomes a zero-error
// equation (before that, the bound variable did not move with the free
// variables and therefore could not resist their movement).
// The function only considers variables which have an entry in
// the 'totalResistance' table.
// If the bound variable appears in a non-zero error equation, no resistance
// is added.
// This function only updates the resistance due to constraints which do 
// not belong to or-groups.

Resistance.prototype.refreshTotalAfterBoundVarChange =
    resistanceRefreshTotalAfterBoundVarChange;

function resistanceRefreshTotalAfterBoundVarChange(newBoundVar, prevBoundVar,
                                                   queueRecalc)
{
    if(!this.totalResistanceNum)
        return; // no variables for which to calculate total resistance
    
    // get the resistance entry of the bound variable (it should have already
    // been created/refreshed).
    var boundEntry = this.variables[newBoundVar];
    
    // get the equation
    var eqId = this.boundVars[newBoundVar];

    if(eqId == undefined)
        return;
    
    if((boundEntry.withoutViolatedOrGroups.up == -Infinity &&
        boundEntry.withoutViolatedOrGroups.down == -Infinity) || 
       this.innerProducts[eqId]) {
        // new bound variable does not add resistance, only remove resistance
        // due to the old bound variable
        if(prevBoundVar != undefined)
            this.removeBoundVarTotalResistance(prevBoundVar, queueRecalc);
        return;
    }
    
    // go over the free variables in this equation. For those variables where
    // the resistance of the bound variable is greater than the previous
    // resistance, increase the total resistance. Otherwise, do nothing.

    var equation = this.equations.vectors[eqId];
    var newBoundVarValue = this.equations.getValue(eqId, newBoundVar);

    for(var i = 0, l = equation.length ; i < l ; ++i) {
        
        var entry = equation[i];
        var freeVar = entry.name;
        if(freeVar == newBoundVar || !(freeVar in this.totalResistance))
            continue;

        this.increaseTotalResistanceByBound(freeVar, newBoundVar, boundEntry,
                                            -entry.value * newBoundVarValue,
                                            true);
    }
    
    // remove resistance due to the old bound variable
    if(prevBoundVar != undefined)
        this.removeBoundVarTotalResistance(prevBoundVar, queueRecalc);
}

// this function should be called when the given equation changes, but its
// bound variable remains the same. The function then updates the total
// resistance of the variables affected by this change.
// If the bound variable changed (or if the equation is new) the function
// 'refreshTotalAfterBoundVarChange' should be called instead.
// In case the total resistance of a free variable needs to be recalculated
// as a result of this change, the 'queueRecalc' flag indicates whether
// this recalculation should be carried out at once (queueRecalc == false)
// or should be queued for later.
// This function only updates resistance due to constraints which do not
// belong to any or-group.

Resistance.prototype.refreshTotalAfterEquationChange =
    resistanceRefreshTotalAfterEquationChange;

function resistanceRefreshTotalAfterEquationChange(eqId, queueRecalc)
{
    if(!this.totalResistanceNum)
        return; // no variables for which to calculate total resistance
    
    var boundVar = this.boundVarsByEq[eqId];
    
    if(boundVar == undefined)
        return; // no bound variable assigned, will need to wait for it

    if(!this.equations.getValue(eqId, boundVar) || this.innerProducts[eqId]) {
        // The bound variable does not appear in the equation anymore or
        // a non-zero error equation, so remove the resistance due to the
        // bound variable
        this.removeBoundVarTotalResistance(boundVar, queueRecalc);
        return;
    }
    
    // loop over the free variables which the bound variable resisted to
    // detect those which are no longer in the equation (and therefore cannot
    // be resisted by this bound variable)
    for(var freeVar in this.resistingBoundVars[boundVar]) {
        
        if(!this.equations.getValue(eqId, freeVar)) {
            this.calcTotalResistance(freeVar, queueRecalc);
            this.clearFreeFromBound(boundVar, freeVar);
        }
    }

    // from now on, this is the same as if the resistance of the bound variable
    // has changed.
    this.refreshTotalAfterBoundResistanceChange(boundVar, queueRecalc);
}

// This function is called when the resistance of the given bound variable
// has changed. The function goes over the free variables which appear in
// the bound variable's equation and for which total resistance needs to
// be calculated. It then adjusts the total resistance of these variables.
// If 'queueRecalc' is true, a complete recalculation of the total resistance
// of a variable (if necessary) will be queued and performed later
// (after additional changes have benn processed).
// This function does not add the total resistance due to or groups. This
// resistance is handled by other functions, called separately.

Resistance.prototype.refreshTotalAfterBoundResistanceChange =
    resistanceRefreshTotalAfterBoundResistanceChange;

function resistanceRefreshTotalAfterBoundResistanceChange(boundVar,
                                                          queueRecalc)
{
    if(!this.totalResistanceNum)
        return; // no variables for which to calculate total resistance
    
    var eqId = this.boundVars[boundVar];

    if(eqId == undefined)
        return; // not a bound variable

    if(this.innerProducts[eqId]) {
        // a non-zero error equation, remove the resistance due to the
        // bound variable
        this.removeBoundVarTotalResistance(boundVar, queueRecalc);
        return;
    }
    
    var boundEntry = this.variables[boundVar];

    if(!boundEntry)
        return;

    var equation = this.equations.vectors[eqId];
    var boundVarValue = this.equations.getValue(eqId, boundVar);

    for(var i = 0, l = equation.length ; i < l ; ++i) {
        
        var entry = equation[i];
        var freeVar = entry.name;
        if(freeVar == boundVar || !(freeVar in this.totalResistance))
            continue;

        var total = this.totalResistance[freeVar];

        // determine direction of bound var resistance
        var dir = (entry.value * boundVarValue > 0) ?
            this.opDirs[total.dir] :  total.dir;

        // the bound variable's contribution to the total resistance
        // of the free variable does not include resistance due to
        // violated or groups (this resistance is handled separately)
        this.addToTotalResistance(freeVar, 
                                  boundEntry.withoutViolatedOrGroups[dir], 
                                  boundVar, undefined, false, true, true);
    }
}

// This function should be called after the resistance of the given variable
// changed. This function updates the total resistance of the variable
// itself and if the variable is a bound variable, also updates the
// total resistance of variables for which total resistance needs to be
// calculated and which could be affected by this change of
// resistance.
// This function only refreshes the total resistance due to constraints
// which do not belong to any or-group.

Resistance.prototype.refreshTotalAfterResistanceChange =
    resistanceRefreshTotalAfterResistanceChange;

function resistanceRefreshTotalAfterResistanceChange(variable)
{
    if(!this.totalResistanceNum)
        return; // no variables for which to calculate total resistance
    
    var entry = this.variables[variable];
    
    if(!entry || entry.resistance.up == undefined)
        return; // resistance not yet calculated
    
    var total = this.totalResistance[variable];
    
    if(total)
        this.addToTotalResistance(variable, entry.resistance[total.dir], 
                                  variable, undefined, false, true, true);
    
    // if this is a bound variable, update the total resistance of free
    // variables which appear in the equation of this bound variable
    // and for which total resistance needs to be calculated.
    if(this.boundVars[variable] != undefined)
        this.refreshTotalAfterBoundResistanceChange(variable, true);
}

/////////////////////////
// Or-Group Resistance //
/////////////////////////

// The following function goes over all group changes stored in the 'changes'
// table or the OrGroups object and updates the consequences of these
// changes on the resistance of the various variables.
// The function then clears the change list on the 'or-group' object.

Resistance.prototype.processOrGroupChanges = resistanceProcessOrGroupChanges;

function resistanceProcessOrGroupChanges()
{
    for(var group in this.orGroups.changes) {

        var changeEntry = this.orGroups.changes[group];
        var status = this.orGroups.getGroupStatus(group);
        
        // did the status change?
        if(changeEntry.status && changeEntry.status != status) {
            this.applyOrGroupStatusChange(group, changeEntry.status, status);
            continue; // continue to next group
        }

        // mark that this tight or-group changed (it is still satified
        // but may no longer be tight).
        if(this.tightGroups[group])
            this.tightOrGroupChanged[group] = true;
        
        // status did not change, calculate the influence of variable
        // satisfaction/violation changes on the resistance
        
        if(this.orGroups.getGroupStatus(group) == "satisfied")
            this.processSatisfiedOrGroupChanges(group);
        else // must be a violated group
            this.processViolatedOrGroupChanges(group);
    }
    
    this.orGroups.clearChanges();
}

// Given an or-group, its previous status and the current (new) status, this
// function updates the resistance related to this group. This may modify
// the 'tightVariables' or 'violatedOrGroupVars' tables and/or modify 
// the resistance entries of the variables involved.

Resistance.prototype.applyOrGroupStatusChange =
    resistanceApplyOrGroupStatusChange;

function resistanceApplyOrGroupStatusChange(group, prevStatus, status)
{
    if(prevStatus == status)
        return;

    // get the change entry for this group
    var changeEntry = this.orGroups.changes[group];

    // clear the resistance due to the previous status
    
    if(prevStatus == "satisfied")
        this.removeSatisfiedOrGroupResistance(group);
    else if(prevStatus == "violated")
        this.removeViolatedOrGroupResistance(group);

    // set the resistance due to the new status

    if(status == "satisfied")
        this.calcSatisfiedResistanceOfOrGroup(group, true);    
    else if(status == "violated")
        this.addViolatedOrGroupResisance(group);
}

// This function is called to update the or-group resistance when
// a new bound variable is assigned to an equation. If another variable was
// previously assigned as the bound variable for this equation, this
// variable is given as an argument to this function (the resistance
// due to that old bound variable needs to be removed).
// This function can also be called when an equation becomes a zero-error
// equation (before that, the bound variable did not move with the free
// variables and therefore could not resist their movement).
// The function removes any or-group resistance due to the old
// bound variable and adds any or-group resistance due to the
// new bound variable. In case the equation changed but the bound variable 
// did not, one should call 'orGroupResistanceAfterEquationChange()'.

Resistance.prototype.orGroupResistanceAfterBoundVarChange =
    resistanceOrGroupResistanceAfterBoundVarChange;

function resistanceOrGroupResistanceAfterBoundVarChange(boundVar,
                                                        prevBoundVar)
{
    this.satisfiedOrGroupResistanceAfterBoundVarChange(boundVar, prevBoundVar);
    this.violatedOrGroupResistanceAfterBoundVarChange(boundVar, prevBoundVar);
}

// This function should be called when an equation changes but its bound
// variable did not change. The function then updates the or-group resistance
// which is induced on the free variables in the equation. The appropriate
// resistance entries are updated. The function receives as argument the
// equation ID. 
//
// If the equation is not a zero-error equation or the bound variable does not
// appear in the equation (this may temporarily be the case after equations
// change but bound variables have not yet been reassigned), any
// or-group resistance due to the or-groups defined on the bound
// variable is removed.

Resistance.prototype.orGroupResistanceAfterEquationChange =
    resistanceOrGroupResistanceAfterEquationChange;

function resistanceOrGroupResistanceAfterEquationChange(eqId)
{
    this.satisfiedOrGroupResistanceAfterEquationChange(eqId);
    this.violatedOrGroupResistanceAfterEquationChange(eqId);
}

// This function should be called when the given variable has just become
// bound in some zero-error equation. For every or-group which is defined
// on this variable, this function recalculates or schedules the recalculation 
// of the resistance this induces on free variables.

Resistance.prototype.orGroupResistanceAddBoundVar =
    resistanceOrGroupResistanceAddBoundVar;

function resistanceOrGroupResistanceAddBoundVar(boundVar)
{
    this.satisfiedOrGroupResistanceAddBoundVar(boundVar);
    this.violatedOrGroupResistanceAddBoundVar(boundVar);
}

// This function should be called when a variable ceases to be bound in a
// zero-error equation. This function then goes over all or-groups which are
// defined on the variable and removes any or-group resistance
// (satisfied or violated) induced by this group on free variables.
// If the variable is made bound in another equation, this function should
// be called before the or-group is calculated for that new bound variable
// assignment.

Resistance.prototype.orGroupResistanceRemoveBoundVar =
    resistanceOrGroupResistanceRemoveBoundVar;

function resistanceOrGroupResistanceRemoveBoundVar(boundVar)
{
    this.satisfiedOrGroupResistanceRemoveBoundVar(boundVar);
    this.violatedOrGroupResistanceRemoveBoundVar(boundVar);
}

// This function adds the given variable to the 'freeRequireOrGroupResistance'
// table under the given module name. If no module name is given, no
// registration takes place.

Resistance.prototype.addToRequireOrGroupResistance =
    resistanceAddToRequireOrGroupResistance;

function resistanceAddToRequireOrGroupResistance(variable, moduleName)
{
    if(moduleName == undefined)
        return;

    var varEntry = this.freeRequireOrGroupResistance[variable];
    
    if(!varEntry) {
        varEntry = this.freeRequireOrGroupResistance[variable] = {};
        this.numFreeRequireOrGroupResistance++;
    }

    varEntry[moduleName] = true;

    if(!this.freeRequiredByModule[moduleName])
        this.freeRequiredByModule[moduleName] = {};
    this.freeRequiredByModule[moduleName][variable] = true;
}

// This function removes the given variable from
// the 'freeRequireOrGroupResistance' table under the given module name.

Resistance.prototype.removeFromRequireOrGroupResistance =
    resistanceRemoveFromRequireOrGroupResistance;

function resistanceRemoveFromRequireOrGroupResistance(variable, moduleName)
{
    if(moduleName == undefined)
        return;
    
    var varEntry = this.freeRequireOrGroupResistance[variable];
    
    if(!varEntry)
        return;

    if(this.freeRequiredByModule[moduleName]) {
        delete this.freeRequiredByModule[moduleName][variable];
        if(isEmptyObj(this.freeRequiredByModule[moduleName]))
            delete this.freeRequiredByModule[moduleName];
    }
    
    delete varEntry[moduleName];
    
    if(!isEmptyObj(varEntry))
        return; // some modules still require this variable
    
    delete this.freeRequireOrGroupResistance[variable];
    this.numFreeRequireOrGroupResistance--;
    
    delete this.tightFreeVariablesCalculated[variable];
    
    // remove the entry from the violate group tables for groups the
    // variable does not belong to.
    this.violatedOrGroupsRemoveNonGroupFree(variable);
    this.satisfiedOrGroupsRemoveFree(variable);
}

// This function removes all registrations of the given module from
// the 'freeRequireOrGroupResistance' table. It uses the
// 'freeRequiredByModule' to find these entries.
// If 'exceptions' is given, it should be an object whose attributes
// are variables. The entries for the given module will be removed
// except for those variables which appear in the exceptions list.

Resistance.prototype.removeModuleFromFreeRequireOrGroup =
    resistanceRemoveModuleFromFreeRequireOrGroup;

function resistanceRemoveModuleFromFreeRequireOrGroup(moduleName,
                                                      exceptions)
{
    var freeVars = this.freeRequiredByModule[moduleName];

    if(!freeVars)
        return;

    // If there are no exceptions, delete this entry from the index before
    // removing the variables as this saves the called functions the trouble
    // of removing the entries one by one.
    if(!exceptions)
        delete this.freeRequiredByModule[moduleName];
    
    for(var freeVar in freeVars) {

        if(exceptions && exceptions[freeVar])
            continue; // don't remove

        this.removeFromRequireOrGroupResistance(freeVar, moduleName);
    }
}

// this function takes a free variable as input. It then calculates
// all the entries in the or-group resistance tables (violatedOrGroupVars
// and tightVariables) for this variable and all relevant or-groups.
// Entries which were already calculated are not recalculated. Specifically,
// this function only needs to consider or-groups defined on bound variables
// in zero-error equations where the free variable appears (other entries
// would have been calculated automatically).
// If the 'queueRecalc' flag is true, the actual recalculation may be
// queued and performed later.
// If the given variable is not a free variable, nothing is calculated.

Resistance.prototype.calcAllOrGroupsForFreeVar =
    resistanceCalcAllOrGroupsForFreeVar;

function resistanceCalcAllOrGroupsForFreeVar(freeVar, queueRecalc)
{
    if(this.boundVars[freeVar] != undefined)
        return; // not a free variable

    // construct the list of or-groups for which the entries need to be
    // calculated.
    
    var nonZeroEq = this.equations.componentIndex.get(freeVar);
    var orGroups = {}; // all or-groups to consider

    // loop over the bound variables in zero-error equations in which the
    // free variable appears
    var _self = this;
    nonZeroEq.forEach(function(e, eqId) {

        if(_self.innerProducts[eqId])
            return; // not a zero error equation

        // get the bound variable of the equation
        var boundVar = _self.boundVarsByEq[eqId];

        if(boundVar == undefined)
            return;

        // get or-groups defined on the bound variable
        for(var group in _self.segmentConstraints.getVariableOrGroups(boundVar))
            orGroups[group] = true;
    });

    // add the entries for all or-groups which were not calculated yet.
    for(var group in orGroups) {

        if(this.orGroups.getGroupStatus(group) == "violated")
            this.addVariableAndGroupToViolatedOrGroupVars(freeVar, group);
        else {
            
            if(this.freeRequireOrGroupResistance[freeVar] &&
               (this.freeRequireOrGroupResistance[freeVar] === true ||
                this.freeRequireOrGroupResistance[freeVar][group]))
                continue; // already calculated
            
            this.checkAndSetTightOrGroupOnFreeVar(group, freeVar, queueRecalc);
        }
    }
    
    // all or-groups were calculated
    if(this.freeRequireOrGroupResistance[freeVar])
        this.tightFreeVariablesCalculated[freeVar] = true;
}

///////////////////////////////////
// Satisfied Or-Group Resistance //
///////////////////////////////////

//
// Equation refresh functions
//

// This function is called to update the satisfied or-group resistance when
// a new bound variable is assigned to an equation. If another variable was
// previously assigned as the bound variable for this equation, this
// variable is given as an argument to this function (the resistance
// due to that old bound variable needs to be removed).
// This function can also be called when an equation becomes a zero-error
// equation (before that, the bound variable did not move with the free
// variables and therefore could not resist their movement).
// The function removes any satisfied or-group resistance due to the old
// bound variable and adds any satisfied or-group resistance due to the
// new bound variable. This resistance is completely recalculated so
// one could, but should not, call this function in case the equation
// changed but the bound variable did not. In that case, it is better
// to call 'orGroupResistanceAfterEquationChange()'.

Resistance.prototype.satisfiedOrGroupResistanceAfterBoundVarChange =
    resistanceSatisfiedOrGroupResistanceAfterBoundVarChange;

function resistanceSatisfiedOrGroupResistanceAfterBoundVarChange(boundVar,
								 prevBoundVar)
{
    // remove any resistance due to the old bound variable
    this.satisfiedOrGroupResistanceRemoveBoundVar(prevBoundVar);

    if(boundVar == undefined || this.innerProducts[this.boundVars[boundVar]])
        return; // not a zero-error equation
    
    // get the or-groups defined on the new bound variable
    var orGroups = this.segmentConstraints.getVariableOrGroups(boundVar);
    
    for(var group in orGroups)
        this.calcSatisfiedResistanceOfOrGroup(group, true);
}

// This function should be called when an equation changes but its bound
// variable did not change. The function then updates the satisfied or-group 
// resistance which is induced on the free variables in the equation. 
// The appropriate resistance entries are updated. The function receives 
// as argument the equation ID. 
//
// To refresh the satisfied or-group resistance, the function only looks
// at satisfied or groups which the bound variable belongs to.
// All other groups can be ignored.
//
// If the equation is not a zero-error equation or the bound variable does not
// appear in the equation (this may temporarily be the case after equations
// change but bound variables have not yet been reassigned), any satisfied
// or-group resistance due to the satisfied or-groups defined on the bound
// variable is removed.
//
// Otherwise, For every satisfied or-group the bound variable belongs to, the
// function updates the resistance as follows:
// 1. Every variable which is resisted by the group but does not appear
//    in the equation of the bound variable must be removed from the
//    list of resisted variables.
// 2. For every variable which is in the equation but not resisted by the
//    group, the group resistance should be recalculated.
// 3. For every variable resisted by the group and appearing in the equation
//    check whether on this equation the group still resists the variable
//    in the direction recorded. If yes, there is nothing more to do.
//    If not, the resistance of the group on the variable needs to be
//    recalculated.

Resistance.prototype.satisfiedOrGroupResistanceAfterEquationChange =
    resistanceSatisfiedOrGroupResistanceAfterEquationChange;

function resistanceSatisfiedOrGroupResistanceAfterEquationChange(eqId)
{
    var boundVar = this.boundVarsByEq[eqId];

    if(boundVar == undefined)
        return;
    
    // get the or-groups defined on the bound variables
    var orGroups = this.segmentConstraints.getVariableOrGroups(boundVar);
    
    if(!orGroups)
        return; // no or-groups, nothing to do

    var boundVarValue = this.equations.getValue(eqId, boundVar);
    
    // if the equation is no longer zero-error or the bound variable does not
    // appear in the equation, remove any satisfied or-group
    // resistance due to the satisfied or-groups on the bound variable. 
    if(this.innerProducts[eqId] || !boundVarValue) {
        this.satisfiedOrGroupResistanceRemoveBoundVar(boundVar);
        return;
    }

    // refresh the satisfied or-groups defined on the bound variable
    
    var equation = this.equations.vectors[eqId];

    for(var group in orGroups) {

        var groupEntry = this.tightGroups[group];
        var groupSatisfied = this.orGroups.orGroups[group].satisfied;
        var satisfaction = groupSatisfied[boundVar];

        if(!satisfaction || satisfaction == "()")
            // not satisfied on this variable, or no satisfied resistance
            continue;
        
        // loop over the free variables in the equation
        for(var i = 0, l = equation.length ; i < l ; ++i) {
            
            var entry = equation[i];
            var freeVar = entry.name;

            if(freeVar == boundVar ||
               (groupEntry && groupEntry[freeVar]) ||
               (!this.freeRequireOrGroupResistance[freeVar] &&
                !this.orGroups.orGroupSatisfiedOnVariableOnly(group,
                                                              freeVar)))
               // not a free variable we are interested in or will be
               // checked below
                continue;

            // recalculate resistance for this variable
            this.checkAndSetTightOrGroupOnFreeVar(group, freeVar, true);
        }
        
        // loop over the variables resisted by this group
        for(var tight in groupEntry) {

            var tightValue = this.equations.getValue(eqId, tight);

            // since the resisted variable is not in the equation, the group
            // cannot resist it (because the bound variable in the equation
            // satisfies the group constraint and does not move with the
            // resisted variable).
            if(!tightValue) {
                this.setTightOrGroupOnVariable(group, tight, false, false);
                continue;
            }

            // since this function handles changes due to equation changes
            // and the variable is still in the equation, the only change
            // which can influence the resistance is a relative sign change
            // between the free and bound variable. If the satisfaction is
            // tight in both directions, this does not matter.
            if(satisfaction == "[]")
                continue;

            // if the satisfaction is tight only in one direction, check
            // whether the resistance is still in the right direction and
            // otherwise recalculate,
            
            var varEntry = this.tightVariables[tight];

            // the current resistance of the variable (-1 down, 1 up, 0 both)
            var resistance = varEntry[group].dir;
            // relaive direction of movement of the free and bound variables
            var relativeDir = -tightValue * boundVarValue; 

            if((resistance * relativeDir >= 0 && satisfaction[1] == ")") ||
               (resistance * relativeDir <= 0 && satisfaction[0] == "("))
               // current resistance does not agree with tight direction of
               // the bound variable, so need to recalculate
                this.checkAndSetTightOrGroupOnFreeVar(group, tight, true);
        }
    }
}

// This function should be called when the given variable has just become
// bound in some zero-error equation. For every or-group which is satisfied
// on this variable, this function schedules the recalculation of the satisfied
// resistance this induces on free variables.

Resistance.prototype.satisfiedOrGroupResistanceAddBoundVar =
    resistanceSatisfiedOrGroupResistanceAddBoundVar;

function resistanceSatisfiedOrGroupResistanceAddBoundVar(boundVar)
{
    var orGroups = (boundVar == undefined) ?
        undefined : this.segmentConstraints.getVariableOrGroups(boundVar);

    if(!orGroups)
        return; // nothing to do
    
    for(var group in orGroups)
        this.calcSatisfiedResistanceOfOrGroup(group, true);
}

// This function should be called when a variable ceases to be bound in a
// zero-error equation. This function then goes over all or-groups which are
// satisfied on the variable and removes any satified or-group resistance
// for this group (from all variable except the bound variable itself).
// If the variable is made bound in another equation, this function should
// be called before the or-group is calculated for that new bound variable
// assignment.

Resistance.prototype.satisfiedOrGroupResistanceRemoveBoundVar =
    resistanceSatisfiedOrGroupResistanceRemoveBoundVar;

function resistanceSatisfiedOrGroupResistanceRemoveBoundVar(boundVar)
{
    if(boundVar == undefined)
        return;
    
    // get the or-groups defined on the bound variables
    var orGroups = (boundVar == undefined) ?
        undefined : this.segmentConstraints.getVariableOrGroups(boundVar);
    
    if(!orGroups)
        return; // no or-groups, nothing to do

    // remove the resistance of the groups satisfied on the bound variable
    // from all variables.
    for(var group in orGroups) {

        // is this group satisfied on the bound variable?
        if(!this.orGroups.isOrGroupSatisfiedOnVariable(group, boundVar))
                continue; // no satisfied resistance to remove
            
        for(var variable in this.tightGroups[group]) {
            if(variable == boundVar)
                continue; // resistance on the bound variable itself remains
            // remove resistance for this group from this variable
            this.setTightOrGroupOnVariable(group, variable, false, false);
        }
    }
}

//
// Variable resistance refresh functions
//

// Given a satisfied or-group and a variable, this function adds 
// the priority of this group to the resistance or total resistance of 
// the variable. If the variable satisfies the or-group and is the only
// variable satifying the group, the resistance of the or-group is added
// to the resistance of the variable. If the variable does not satisfy the 
// or-group, the resistance is added to the total resistance of the variable.
// In case the variable satisfies the or-group but is not the only variable
// which satisfies the or-group, the resistance is added to the 
// 'satOrGroupResistance' of the variable. The direction in which the 
// resistance is added depends on the direction defined on the tightVariables
// entry for the variable and or-group.

Resistance.prototype.addSatOrGroupToVarRes =
    resistanceAddSatOrGroupToVarRes;

function resistanceAddSatOrGroupToVarRes(group, variable)
{
    if(!this.tightVariables[variable])
        return;

    var groupEntry = this.tightVariables[variable][group];
    
    if(!groupEntry)
        return;
    
    var priority = this.segmentConstraints.getOrGroupPriority(group);
    
    if(!groupEntry.varSatByGroup) {
        // add to total resistance (if resistance is in the required direction)
        var total = this.totalResistance[variable];
        if(total && ((total.dir == "up" && groupEntry.dir >= 0) || 
                     (total.dir == "down" && groupEntry.dir <= 0)))
            this.addToTotalResistance(variable, priority,
                                      groupEntry.representative, group, true,
                                      true, true);
    } else if(groupEntry.onlySatByGroup) {
        // add to normal resistance
        this.addToResistance(variable, priority, groupEntry.dir);
    } else {
        // add to 'satOrGroupResistance' (this actually recalculates for all
        // or-groups on this variable, but this is not very expensive)
        this.calcMultiVariableSatisfiedOrGroupResistance(variable);
    }
}

// Given a group and a variable, this function removes the given 'priority' 
// for this group from the resistance and/or total resistance of the variable.
// The 'satOrGroupResistance' resistance of the variable is handled
// by this function only if it is called with the 'calcSatOrGroupResistance' 
// argument set to true. Which type of resistance to remove and in which 
// direction depends on the entry for the given variable and 
// or-group in the tightVariables table. If the variable satisfies the 
// or-group and is the only variable satifying the group, the resistance 
// of the or-group is removed from the resistance of the variable. If 
// the variable does not satisfy the or-group, the resistance is removed from
// the total resistance of the variable. In case the variable satisfies the 
// or-group but is not the only variable which satisfies the or-group, 
// the resistance is removed from the 'satOrGroupResistance' of the variable.
// Since the decision depends on the tightVariables entry for the given
// variable and or-group, this function must be called before that entry
// is changed.
// If 'priority' is undefined, the function gets the priority from the
// information stored in the SegmentConstraints tables (this can be used
// in cases the resistance has not changed).

Resistance.prototype.removeSatOrGroupFromVarRes =
    resistanceRemoveSatOrGroupFromVarRes;

function resistanceRemoveSatOrGroupFromVarRes(group, variable, priority,
                                              calcSatOrGroupResistance)
{
    if(!this.tightVariables[variable])
        return;
    
    var groupEntry = this.tightVariables[variable][group];
    
    if(!groupEntry)
        return;
    
    if(priority == undefined)
        priority = this.segmentConstraints.getOrGroupPriority(group);
    
    if(!groupEntry.varSatByGroup) {
        // remove from total resistance (depending on direction)
        var total = this.totalResistance[variable];
        if(total && ((total.dir == "up" && groupEntry.dir >= 0) || 
                     (total.dir == "down" && groupEntry.dir <= 0)))
            // adding a priority of -Infinity removes the total resistance
            this.addToTotalResistance(variable, -Infinity,
                                      groupEntry.representative,
                                      group, false, true, true);
    } else if(groupEntry.onlySatByGroup) {
        // remove from normal resistance
        var varEntry = this.variables[variable];
        if(!varEntry)
            return; // already removed
        if((groupEntry.dir >= 0 && varEntry.resistance.up == priority) || 
           (groupEntry.dir <= 0 && varEntry.resistance.down == priority))
            // this or-group may have determined the resistance, need to
            // recalculate
            this.needRecalc[variable] = true;
    } else if(calcSatOrGroupResistance)
        // remove from 'satOrGroupResistance' (this actually recalculates for
        // all or-groups on this variable, except for 'group')
        this.calcMultiVariableSatisfiedOrGroupResistance(variable, group);
}

// Given a satified or-group whose priority has changed, this function
// refreshes the resistance of all variables affected by this change.

Resistance.prototype.refreshAfterSatisfiedOrGroupPriorityChange =
    resistanceRefreshAfterSatisfiedOrGroupPriorityChange;

function resistanceRefreshAfterSatisfiedOrGroupPriorityChange(group,
                                                              prevPriority,
                                                              newPriority)
{
    if(prevPriority == newPriority)
        return;
    
    var tightGroup = this.tightGroups[group];
    
    // go over all variables whose movement is resisted by this group
    for(var freeVar in tightGroup) {
        
        // if the priority decreased, need to remove the previous contribution 
        // of this or-group
        if(prevPriority > newPriority)
            this.removeSatOrGroupFromVarRes(group, freeVar, prevPriority,
                                            false);
        
        // add the new contribution of the or-group
        this.addSatOrGroupToVarRes(group, freeVar);
    }
}

//
// Refresh Functions for Variables Resisted by Satisfied Or-Groups
//

// This function performs the calculations queued in the
// 'pendingRecalcTightOrGroups'. These include complete recalculation of the
// variables resisted by a satisfied or-group or partial recalculation
// for specific variables. Upon completion, the function clears the
// 'pendingRecalcTightOrGroups' queue.

Resistance.prototype.calcPendingTightOrGroups =
    resistanceCalcPendingTightOrGroups;

function resistanceCalcPendingTightOrGroups()
{
    for(var group in this.pendingRecalcTightOrGroups) {
        
        if(typeof(this.pendingRecalcTightOrGroups[group]) == "object") {
            // loop over the variables listed under the group
            for(var variable in this.pendingRecalcTightOrGroups[group])
                this.checkAndSetTightOrGroupOnFreeVar(group, variable);
        } else // recalculate for all variables
            this.calcSatisfiedResistanceOfOrGroup(group, false);
    }
    
    // clear the table
    this.pendingRecalcTightOrGroups = {};
}

// This function is called when the given group ceases to be satisfied.
// It removes any resistance due to tight satisfaction of the group.
// It then also queues all affected variables for recalculation of their
// resistance and/or total resistance.

Resistance.prototype.removeSatisfiedOrGroupResistance =
    resistanceRemoveSatisfiedOrGroupResistance;

function resistanceRemoveSatisfiedOrGroupResistance(group)
{
    var tightGroupEntry = this.tightGroups[group]; // may be empty
    
    if(!tightGroupEntry)
        return;
    
    for(var variable in tightGroupEntry) {
        
        var varEntry = this.tightVariables[variable];
        
        // update the resistance of the variable
        this.removeSatOrGroupFromVarRes(group, variable, undefined, true);
        
        delete varEntry[group];
        
        if(isEmptyObj(varEntry))
            delete this.tightVariables[variable];
    }
    
    delete this.tightGroups[group];
}

// This function is called to recalculate the contribution of the given
// satisified group to the resistance of variables.
// If 'queueRecalc' is true, this function does not actually perform the
// calculation but simply queues it, to be performed later
// (this way, repeated calculation for the same group is
// avoided in cases where several changes apply to the same group)

Resistance.prototype.calcSatisfiedResistanceOfOrGroup =
    resistanceCalcSatisfiedResistanceOfOrGroup;

function resistanceCalcSatisfiedResistanceOfOrGroup(group, queueRecalc)
{
    if(queueRecalc) {
        this.pendingRecalcTightOrGroups[group] = true;
        return;
    }
    
    // remove any existing staisfied resistance of this group
    this.removeSatisfiedOrGroupResistance(group);
    
    var groupEntry = this.orGroups.orGroups[group];
    
    if(!groupEntry || groupEntry.numSatisfied == 0)
        return; // not a satisfied group
    
    var tight = this.satisfiedOrGroupMayBeTight(group);
    
    if(!tight)
        return; // group is not tight, does not resist any movement
    
    // If there is a single satisfied variable, that variable is resisted
    // no matter whether it is free or bound and whether the error of 
    // the equation is zero or not.
    if(groupEntry.numSatisfied == 1) {
        var satisfiedVar = objFirstProp(groupEntry.satisfied);
        var satisfaction = groupEntry.satisfied[satisfiedVar];
        this.setTightOrGroupOnVariable(group, satisfiedVar,
                                       satisfaction[0] == "[",
                                       satisfaction[1] == "]");
    }
    
    if(tight !== true) {
        // possibly single resisted variable. The case of a single satisfied
        // variable was already handled above
        if(groupEntry.numSatisfied > 1)
            this.checkAndSetTightOrGroupOnFreeVar(group, tight, false);
        return;
    }
    
    // group is only satisfied on bound variables in zero-error equations
    // and all are tight in at least one direction. Find free variables
    // common to all their equations and in the right direction of movement.
    
    var candidates = {};
    var firstBound = true;
    
    for(var boundVar in groupEntry.satisfied) {
        
        var eqId = this.boundVars[boundVar];
        var boundVarValue = this.equations.getValue(eqId, boundVar);
        var satisfaction = groupEntry.satisfied[boundVar];
        
        // the tight direction of movement (0 = both directions)
        var direction =
            (satisfaction[0] == "(") ? 1 : (satisfaction[1] == ")" ? -1 : 0);
        
        // the direction of movement 
        direction *= boundVarValue;
        
        // If this is the first bound variable, add free variables
        // in the equation as candidates for resistance (each with the
        // direction of resistance: negative/positive or 0 for both
        // directions). Only variables which appear
        // in the freeRequireOrGroupResistance table need to be considered.

        if(firstBound) {
            var equation = this.equations.vectors[eqId];
            for(var i = 0, l = equation.length ; i < l ; ++i) {

                var entry = equation[i];
                var freeVar = entry.name;

                if(freeVar == boundVar)
                    continue; // the bound variable

                if(!this.freeRequireOrGroupResistance[freeVar])
                    continue;
                
                candidates[freeVar] = -entry.value * direction;
            }

            firstBound = false;
            
        } else {
            // check which of the candidates appears in this equation
            // and check whether the direction of resistance still agrees

            for(var freeVar in candidates) {

                var freeVarValue = this.equations.getValue(eqId, freeVar);
                if(!freeVarValue ||
                   -freeVarValue * direction * candidates[freeVar] < 0)
                    delete candidates[freeVar];
            }
        }
    }

    // the variables remaining in the candidate list are those which are
    // resisted by this gorup
    for(var freeVar in candidates)
        this.setTightOrGroupOnVariable(group, freeVar,
                                       candidates[freeVar] <= 0,
                                       candidates[freeVar] >= 0);
}

// This function checks whether the given group is satisfied and may be tight
// on the variables on which it is satisfied. A group may be tight if:
// 1. On every variable on which it is satisfied, it is tight in at least
//    one direction.
// 2. Every variable the group is satisfied on is in the equations.
// 3. All variable on which the group is satisfied (except at most one)
//    are bound variables in zero-error equations.
// 4. If the group is satisfied on a variable which is not bound in a
//    zero error equation then either of the following holds:
//    a. The variable is free
//    b. The variable is the only satisfied variable in the group
// The function returns false if the these conditions do not hold. If there
// is a satisfied variable for the group which is not bound in a
// zero-error equation, this is the only variable which can be resisted
// by the group and the function returns that variable. In all other cases
// (the conditions above hold and all satisfied variables are bound
// in zero error equations) the function returns true.

Resistance.prototype.satisfiedOrGroupMayBeTight =
    resistanceSatisfiedOrGroupMayBeTight;

function resistanceSatisfiedOrGroupMayBeTight(group)
{
    var groupEntry = this.orGroups.orGroups[group];

    if(!groupEntry || !groupEntry.numSatisfied)
        return false;
    
    var numNotBound = 0;
    // if there is a single satisfied free variable, store it here
    var freeVar;
    
    for(var variable in groupEntry.satisfied) {

        if(!this.posEquations.hasVariable(variable))
            // non-equation variable satisfied, group is not tight
            return false;
        
        if(groupEntry.satisfied[variable] == "()")
            return false; // not tight satisfaction, group is not tight
        
        if(!this.boundVars[variable]) {
            if(++numNotBound > 1)
                return false; // more than one non-bound variable
            freeVar = variable; 
        } else if(this.innerProducts[this.boundVars[variable]]) {
            // bound variable in a non-zero error equation, the group
            // is tight only if this is the only satisfied variable
            if(groupEntry.numSatisfied > 1)
                return false;
            return variable;
        }
    }

    if(numNotBound)
        return freeVar;
    
    return true;
}

// This function sets the given or-group as having tight satisfied resistance
// on the given variable. If 'down' is true, this resistance holds in the
// down resistance and if 'up' is true, this resistance holds in the up
// direction.
// This function also updates or schedules for recalculation the resistance
// or total resistance of variables which are affected by this change. 

Resistance.prototype.setTightOrGroupOnVariable =
    resistanceSetTightOrGroupOnVariable;

function resistanceSetTightOrGroupOnVariable(group, variable, down, up)
{    
    if(!down && !up) {
        this.removeTightOrGroupFromVariable(group, variable);
        return;
    }

    var varEntry = this.tightVariables[variable];
    var groupEntry = this.tightGroups[group];
    
    if(!groupEntry)
        groupEntry = this.tightGroups[group] = {};

    groupEntry[variable] = true;

    if(!varEntry)
        varEntry = this.tightVariables[variable] = {};

    var oldEntry = varEntry[group];
    var newEntry = {};

    // create the new entry
    
    newEntry.dir = (down ? -1 : 0) + (up ? 1 : 0);
    newEntry.varSatByGroup =
        !!this.orGroups.orGroups[group].satisfied[variable];
    newEntry.onlySatByGroup =
        !!this.orGroups.orGroupSatisfiedOnVariableOnly(group, variable);

    if(!newEntry.onlySatByGroup) {
        // need to decide on a representative, should try to leave this 
        // unchanged, if possible 
        if(!oldEntry || oldEntry.representative == undefined ||
           !this.orGroups.
           isOrGroupSatisfiedOnVariable(group, oldEntry.representative))
            newEntry.representative = this.orGroups.
                getFirstSatisfiedVariable(group, (newEntry.varSatByGroup ?
                                                  variable : undefined));
        else
            newEntry.representative = oldEntry.representative;
    }
    
    //did the entry actually change? If not, we are done
    if(oldEntry && newEntry.dir == oldEntry.dir && 
       newEntry.varSatByGroup == oldEntry.varSatByGroup &&
       newEntry.onlySatByGroup == oldEntry.onlySatByGroup &&
       newEntry.representative == oldEntry.representative)
        return;
    
    // remove the current resistance
    this.removeSatOrGroupFromVarRes(group, variable, undefined, true);
    
    // set the new entry
    varEntry[group] = newEntry;
    
    // add the resistance of the new entry
    this.addSatOrGroupToVarRes(group, variable);
}

// This function removes the given or-group from the set of groups which
// have tight satisfied resistance on the given variable.
// This function also updates or schedules for recalculation the resistance
// or total resistance of variables which are affected by this change. 

Resistance.prototype.removeTightOrGroupFromVariable =
    resistanceRemoveTightOrGroupFromVariable;

function resistanceRemoveTightOrGroupFromVariable(group, variable)
{
    var varEntry = this.tightVariables[variable];
    
    if(!varEntry)
        return;
    
    if(group in varEntry) {
        this.removeSatOrGroupFromVarRes(group, variable, undefined, true);
        delete varEntry[group];
        if(isEmptyObj(varEntry))
            delete this.tightVariables[variable];
    }
    
    var groupEntry = this.tightGroups[group];
    
    if(groupEntry && groupEntry[variable]) {
        delete groupEntry[variable];
        if(isEmptyObj(groupEntry))
            delete this.tightGroups[group]; 
    }
}

// This function removes from this variable's entry in tightVariables
// all group entries for or-groups which the variable is not the only
// variable which satisfies the group.
// If the variable's entry becomes empty, the variable's entry is removed.
// 'tightGroups' is modified correspondingly.
// This function does not update the total resistance of the variable.
// It is assumed the function is called when this information
// is no longer interesting.
// If the free variable still appears in the 'freeRequireOrGroupResistance'
// table, the entries will not be removed.

Resistance.prototype.satisfiedOrGroupsRemoveFree =
    resistanceSatisfiedOrGroupsRemoveFree;

function resistanceSatisfiedOrGroupsRemoveFree(variable)
{
    if(this.freeRequireOrGroupResistance[variable])
        return; // entries still required
    
    var varEntry = this.tightVariables[variable];

    if(!varEntry)
        return;

    for(var group in varEntry) {

        if(varEntry[group].onlySatByGroup)
            continue; // only variable satisfying or-group 

        // remove this group
        delete varEntry[group];

        var groupEntry = this.tightGroups[group];
    
        if(groupEntry && groupEntry[variable]) {
            delete groupEntry[variable];
            if(isEmptyObj(groupEntry))
                delete this.tightGroups[group]; 
        }
    }

    if(isEmptyObj(varEntry))
        delete this.tightVariables[variable];
    
    // calculate the effect on the 'satOGroupResistance' fields
    // (this is complete recalculation, as the calculation is cheap)
    this.calcMultiVariableSatisfiedOrGroupResistance(variable);
}

// This function gets the entry for the given or-group and variable
// from the 'tightVariables' table. 'freeVar' is assumed to be a free variable
// (if it is not, undefined is returned). If the entry exists in the
// tightVariables table, it is returned as is. If no entry exists and it
// is indicated in the tightFreeVariablesCalculated table that this entry
// was already calculated, undefined is returned. Otherwise, the entry
// is calculated (this calculation takes place immediately, without queueing).
// The result of this calculation is then returned (it may be undefined
// if no entry was created). If the variable appears in
// 'freeRequireOrGroupResistance', the variable and group are added to
// the tightFreeVariablesCalculated table.

Resistance.prototype.getTightOrGroupOnFreeVar =
    resistanceGetTightOrGroupOnFreeVar;

function resistanceGetTightOrGroupOnFreeVar(group, freeVar)
{
    if(this.boundVars[freeVar] != undefined)
        return undefined; // not a free variable
    
    var calculate = true;
    
    if(this.freeRequireOrGroupResistance[freeVar]) {
        if(!this.tightFreeVariablesCalculated[freeVar])
            this.tightFreeVariablesCalculated[freeVar] = {};
        
        if(this.tightFreeVariablesCalculated[freeVar] === true ||
           this.tightFreeVariablesCalculated[freeVar][group])
            calculate = false;
        else // will be calculated below
            this.tightFreeVariablesCalculated[freeVar][group] = true;
    }
    
    if(calculate)
        this.checkAndSetTightOrGroupOnFreeVar(group, freeVar, false);
    
    return this.tightVariables[freeVar] ?
        this.tightVariables[freeVar][group] : undefined;    
}

// This function is given a satisfied group and a free variable.
// The function then checks whether the group offers any resistance to
// the movement of the given free
// variable and then updates the tightVariables and tightGroups
// tables accordingly.
// If 'queueRecalc' is true, this function does not actually perform the
// calculation but simply queues it, to be performed later
// (this way, repeated calculation for the same group and variable is
// avoided in cases where several changes apply to the same group and
// variable)

Resistance.prototype.checkAndSetTightOrGroupOnFreeVar =
    resistanceCheckAndSetTightOrGroupOnFreeVar;

function resistanceCheckAndSetTightOrGroupOnFreeVar(group, freeVar,
                                                    queueRecalc)
{
    if(queueRecalc) {
        if(!this.pendingRecalcTightOrGroups[group])
            this.pendingRecalcTightOrGroups[group] = {};
        else if(typeof(this.pendingRecalcTightOrGroups[group]) == "boolean")
            return; // recalculation already scheduled for the whole group
        // schedule recalculation for this group and variable
        this.pendingRecalcTightOrGroups[group][freeVar] = true;
        return;
    }
    
    var resistance = this.checkTightOrGroupOnFreeVar(group, freeVar);

    this.setTightOrGroupOnVariable(group, freeVar, resistance[0] == "[",
                                   resistance[1] == "]");
}

// This function is given a satisfied group and a free variable.
// The function then checks what resistance the group offers to
// the movement of the given free. It returns "()" if the group
// offers no resistance, "[]" if the group offers resistance in
// both direction, "(]" if the group offers resistance in the up
// direction and "[)" if the group offers resistance in the down
// direction.

Resistance.prototype.checkTightOrGroupOnFreeVar =
    resistanceCheckTightOrGroupOnFreeVar;

function resistanceCheckTightOrGroupOnFreeVar(group, freeVar)
{
    var groupEntry = this.orGroups.orGroups[group];

    if(!groupEntry || !groupEntry.numSatisfied)
        return "()"; // no resistance

    // is the free variable satisfied by this group? 
    var satisfaction = groupEntry.satisfied[freeVar];

    if(satisfaction == "()")
        return "()"; // no resistance
    
    if(satisfaction) {
        if(groupEntry.numSatisfied == 1)
            return satisfaction; // the variable is the only satisfied variable
    } else
        // An initial 'maximal' tightness. There are some additional 
        // satisfied variables, so this will be corrected below
        satisfaction = "[]";

    // loop over all the satisfied variables in the group. Each
    // variable (except 'freeVar') should be bound in a zero-error
    // equation. Check which direction of movement of the free variable
    // agrees with the tight direction of all the group variables.

    for(var boundVar in groupEntry.satisfied) {
        
        if(boundVar == freeVar)
            continue;

        var eqId = this.boundVars[boundVar];
        
        if(!eqId || this.innerProducts[eqId])
            // not bound in a zero error equation: no resistance
            return "()";        

        var freeVarValue = this.equations.getValue(eqId, freeVar);

        if(!freeVarValue)
            return "()"; // no resistance

        var boundVarSat = groupEntry.satisfied[boundVar];
        var boundVarValue = this.equations.getValue(eqId, boundVar);
        
        if(freeVarValue * boundVarValue > 0) {
            // free and bound variable move in opposite directions
            if(boundVarSat[0] == "(")
                satisfaction = satisfaction[0] + ")";
            if(boundVarSat[1] == ")")
                satisfaction = "(" + satisfaction[1];
        } else { // free and bound variable move in the same directions
            if(boundVarSat[0] == "(")
                satisfaction = "(" + satisfaction[1];
            if(boundVarSat[1] == ")")
                satisfaction = satisfaction[0] + ")";
        }
        
        if(satisfaction == "()")
            return "()";
    }
    
    return satisfaction;
}

//
// Resistance For Specific Variable
//

// Given a violated bound variable in a zero-error equation and
// a free variable in that equation, this function checks whether the
// resistance of satisfied or-groups defined on the bound variable
// to the movement of the free variable in the direction which increases
// the violation of the bound variable is greater or equal to the
// priority of the violation of the bound variable. While typically
// a violated variable does not have satisfied or-groups defined on it,
// this is no impossible (a more restrictive constraint may be violated
// while a less restrictive constraint may still be satisfied).
//
// This function checks whether there are any satisfied or groups defined
// on the bound variable. If there are, it checks whether they offer any
// resistance to the movement of the free variable in the direction in
// which the violation of the bound variable increases. It also creates
// the corresponding entry in the tightVariables and tightGroups tables,
// if necessary.
//
// This function does not check that the bound variable is indeed bound,
// that its equation has zero error, that it is violated or that
// the free variable is in the bound variable's equation. It is assumed
// that the calling function already verified this.
// However, if one of these assumptions turns out to be wrong in the course
// of running this function, the function may return false.

Resistance.prototype.satisfiedOrGroupsOfViolatedBoundResistFree =
    resistanceSatisfiedOrGroupsOfViolatedBoundResistFree;

function resistanceSatisfiedOrGroupsOfViolatedBoundResistFree(freeVar,
                                                              boundVar)
{
    // Get the violation priority of the bound variable and the direction
    // in which the free variable moves to increase the violation.
    
    var eqId = this.boundVars[boundVar];
    
    if(eqId == undefined)
        return false;
    
    var boundEntry = this.variables[boundVar];
    
    if(!boundEntry || !boundEntry.violation)
        return false;
    
    var violationDir = -this.equations.getValue(eqId, freeVar) * 
        this.equations.getValue(eqId, boundVar) *
        (boundEntry.violation == "max" ? 1 : -1);
    
    // get or-groups defined on the bound variable
    var orGroups = this.segmentConstraints.getVariableOrGroups(boundVar);
    
    for(var group in orGroups) {

        if(!this.orGroups.isOrGroupSatisfiedOnVariable(group, boundVar))
            continue;
        
        var groupEntry = this.getTightOrGroupOnFreeVar(group, freeVar);

        if(!groupEntry)
            continue;
        
        if(groupEntry.dir * violationDir < 0) // opposite direction
            continue;

        if(this.segmentConstraints.getOrGroupPriority(group) >=
           boundEntry.violationPriority)
            return true;
    }

    return false;
}

//
// Or-Group Changes
//

// This function should be called when the given 'group' remains satisfied,
// but changes may have taken place in the way the various variables
// in the group are satisfied: satisfaction may become tight/not-tight;
// a variable may become violated (without making the whole group violated);
// a variable which was previously violated may become satisfied;
// a new variable may be added to the group; a variable may be removed
// from the group. In addition, the priority of the group may have
// changed.
// Most changes (such the addition of a tight satisfaction or the removal
// of a satisfied variable) the function needs to recalculate the
// resistance of the group from the beginning (because such changes
// may result in more variables being resisted by the group and searching
// for those variables is equivalent to calculating everything afresh).
// There are several cases where full recalculation is not necessary:
// 1. If no variable became satisfied, stopped being satisfied or changed
//    its type of satisfaction (all changes are violation changes).
//    In this case there is nothing to do.
// 2. If the satisfaction of one of the variables became "()" or a
//    non-equation variable became satisfied: in this case no resistance
//    can exist anymore.
// 3. If a variable which is not bound in a zero-error equation became
//    satisfied, this is the only variable which still could be resisted -
//    we can clear all other resistance for this group and calculate only
//    for that variable.
// 4. if all changes are of one of two types:
//    a. the variable was previously violated or not in the group and has
//       now become satisfied.
//    b. The variable's satisfaction was "[]" and now became "(]" or "[)".
//    If these are the only changes that occurred then any resistance
//    the group offers also existed before the change, and there is only
//    need to remove resistance where this does not longer hold.
//    (in case (a) we may also need to update the 'onlySatOnGroup' flag of
//    the remaining variables).

Resistance.prototype.processSatisfiedOrGroupChanges =
    resistanceProcessSatisfiedOrGroupChanges;

function resistanceProcessSatisfiedOrGroupChanges(group)
{
    if(this.recalcAfterSatisfiedOrGroupChanges(group))
        return; // done

    // need to check whether the variables which were previously resisted
    // by the group are also resisted by the variables that changed.

    var changes = this.orGroups.changes[group];
    var groupEntry = this.orGroups.orGroups[group];
    var tightGroup = this.tightGroups[group];

    // group priority change
    if("priority" in changes) {
        var newPriority = this.segmentConstraints.getOrGroupPriority(group);
        if(newPriority != changes.priority)
            this.refreshAfterSatisfiedOrGroupPriorityChange(group,
                                                            changes.priority,
                                                            newPriority);
    }
    
    for(var freeVar in tightGroup) {

        var freeVarEntry = this.tightVariables[freeVar][group];
        
        for(var variable in changes.variables) {
            
            var satisfaction = groupEntry.satisfied[variable];
            
            if(!satisfaction)
                continue; // not relevant
            
            // since recalcAfterSatisfiedOrGroupChanges returned false,
            // we know that the satisfaction must be "[]" or "[)" or "(]".
            
            // get the coefficient of the free and bound variables in the
            // equation in which this variable is bound (must be bound
            // in a zero-error equation, otherwise we would not have
            // arrived here).
            var eqId = this.boundVars[variable];
            var freeVarValue = this.equations.getValue(eqId, freeVar);
            
            if(!freeVarValue) {
                // remove group resistance from this free variable
                this.setTightOrGroupOnVariable(group, freeVar, false, false);
                freeVarEntry = undefined;
                break;
            }
            
            if(satisfaction == "[]")
                continue; // group continues to resist variable
            
            // satisfaction can be "(]" or "[)" and we remove resistance
            // in the non-tight direction
            var dir = (satisfaction == "(]" ? 1 : -1) *
                (freeVarValue * 
                 this.equations.getValue(eqId, variable) > 0 ? -1 : 1);  
            
            if(!freeVarEntry.dir)
                freeVarEntry.dir = dir;
            else if(freeVarEntry.dir * dir < 0) {
                // no resistance left
                this.removeSatOrGroupFromVarRes(group, freeVar, undefined,
                                                true);
                delete this.tightVariables[freeVar][group];
                if(isEmptyObj(this.tightVariables[freeVar]))
                    delete this.tightVariables[freeVar];
                delete tightGroup[freeVar];
                freeVarEntry = undefined; // will be checked below
                break; // no need to check more entries
            }
        }
        
        // if the entry still exists, update the 'onlySatByGroup' flag and
        // if this falg has changed, update the resistance.
        if(freeVarEntry){
            var onlySatByGroup = 
                !!this.orGroups.orGroupSatisfiedOnVariableOnly(group, freeVar);
            if(onlySatByGroup != freeVarEntry.onlySatByGroup) {
                // remove the existing resistance
                this.removeSatOrGroupFromVarRes(group, freeVar, undefined,
                                                true);
                // modify the flag and add the new resistance
                freeVarEntry.onlySatByGroup = onlySatByGroup;
                this.addSatOrGroupToVarRes(group, freeVar);
            }
        }
    }
    
    if(isEmptyObj(tightGroup))
        delete this.tightGroups[group];
}

// This function should be called when the given 'group' remains satisfied,
// but changes may have taken place in the way the various variables
// in the group are satisfied: satisfaction may become tight/not-tight;
// a variable may become violated (without making the whole group violated);
// a variable which was previously violated may become satisfied;
// a new variable may be added to the group; a variable may be removed
// from the group. In addition, the priority of the group may have
// changed.
// This function checks whether the resistance of the group requires
// complete recalculation. If it does, the function recalculates the
// resistance and returns true. Otherwise, the function returns false.
// The function also handles the recalculation in the following cases:
// 1. If no variable became satified, stopped being satisfied or changed
//    its type of satisfaction (all changes are violation changes).
//    In this case there is nothing to do.
// 2. If the satisfaction of one of the variables became "()" or a
//    non-equation variable became satisfied: in this case no resistance
//    can exist anymore.
// 3. If a variable which is not bound in a zero-error equation became
//    satisfied, this is the only variable which still could be resisted -
//    we can clear all other resistance for this group and calculate only
//    for that variable.
// In all these cases this function recalculates the resistance and returns
// true.
// When the function returns false it means that:
// 1. The changes to the group satisfaction is such that all changes are
//    of one of two types:
//    a. the variable was previously violated or not in the group and has
//       now become satisfied and tight on at least one side.
//    b. The variable's satisfaction was "[]" and now became "(]" or "[)".
//    If these are the only changes that occurred then any resistance
//    the group offers also existed before the change, and there is only
//    need to remove resistance where this does not longer hold.
// 2. All variables whose satisfaction changed to being satisfied are
//    bound variables in zero-error equations.

Resistance.prototype.recalcAfterSatisfiedOrGroupChanges =
    resistancerecalcAfterSatisfiedOrGroupChanges;

function resistancerecalcAfterSatisfiedOrGroupChanges(group)
{
    // get the list of group changes
    var changes = this.orGroups.changes[group];
    // get the current group entry
    var groupEntry = this.orGroups.orGroups[group];

    if(!changes)
        return true; // nothing to do

    // number of changed variables which are satisfied after the change
    var numSatisfied = 0;
    
    // check whether there is need for complete recalculation.
    for(var variable in changes.variables) {
        
        if(groupEntry.satisfied[variable]) {

            if(groupEntry.satisfied[variable] == "()" ||
               !this.posEquations.hasVariable(variable)) {
                this.removeSatisfiedOrGroupResistance(group);
                return true; // no resistance
            }

            if(!this.boundVars[variable] ||
               this.innerProducts[this.boundVars[variable]]) {
                // this is the only variable which can be resisted
                this.removeSatisfiedOrGroupResistance(group);
                this.checkAndSetTightOrGroupOnFreeVar(group, variable, true);
                return true;
            }
            
            numSatisfied++;
        }
        
        if(typeof(changes.variables[variable]) != "string")
            continue; // may not need to completely recalculate

        if(changes.variables[variable] == "[]" &&
           (groupEntry.satisfied[variable] == "(]" ||
            groupEntry.satisfied[variable] == "[)"))
            continue;
        
        // need to recalculate
        this.calcSatisfiedResistanceOfOrGroup(group, true);
        return true;
    }
    
    return !numSatisfied; // true if only violations changed
}

//
// Interface functions
//

// Given a free variable, this function finds all satisfied or-groups 
// which resist the movement of that free variable and such that the 
// or-groups are each satisfied on the free variable and at least one
// more variable. The function then finds all other variables satisfied
// by these or-groups. Since the or-groups resist the movement of the variable,
// all these variables must be bound variables in zero-error equations
// in which the free variable appears. The function then returns the list
// of equations in which these bound variables appear (an object with
// the equation IDs of these equations as attributes and value 'true').
// If the variable does not belong to any such or-group, undefined 
// is returned.
// This function assumes the entry for this variable in the 'tightVariables'
// table has already been calculated (this is optional, so this function
// should only be used in contexts where this is know to have taken place). 

Resistance.prototype.getResistingEqsOfSatOrGroupsForVar = 
    resistanceGetResistingEqsOfSatOrGroupsForVar;

function resistanceGetResistingEqsOfSatOrGroupsForVar(freeVar)
{
    if(this.boundVars[freeVar] != undefined)
        return undefined; // not a free variable
    
    var tightVarEntry = this.tightVariables[freeVar];
    
    if(!tightVarEntry)
        return undefined; // no satisfied or-groups resist this variable
    
    var eqs;
    
    for(var group in tightVarEntry) {
        var groupEntry = tightVarEntry[group];
        
        if(!groupEntry.varSatByGroup || groupEntry.onlySatByGroup)
            continue; // not satisfied both by this and other variables
        
        for(var satisfied in this.orGroups.getSatisfiedVariables(group)) {
            
            if(satisfied == freeVar)
                continue; // the only satisfied variable which is not bound
            
            var eqId = this.boundVars[satisfied];
            
            if(!eqs)
                eqs = {};
            
            eqs[eqId] = true;
        }
    }
    
    return eqs;
}

//////////////////////////////////
// Violated Or-Group Resistance //
//////////////////////////////////

//
// Equation refresh functions
//

// This function is called to update the violated or-group resistance when
// a new bound variable is assigned to an equation. If another variable was
// previously assigned as the bound variable for this equation, this
// variable is given as an argument to this function (the resistance
// due to that old bound variable needs to be removed).
// This function can also be called when an equation becomes a zero-error
// equation (before that, the bound variable did not move with the free
// variables and therefore could not resist their movement).
// The function removes any violated or-group resistance due to the old
// bound variable and adds any violated or-group resistance due to the
// new bound variable.

Resistance.prototype.violatedOrGroupResistanceAfterBoundVarChange =
    resistanceViolatedOrGroupResistanceAfterBoundVarChange;

function resistanceViolatedOrGroupResistanceAfterBoundVarChange(boundVar,
                                                                prevBoundVar)
{
    // remove any resistance due to the old bound variable
    if(prevBoundVar != undefined)
        this.violatedOrGroupResistanceRemoveBoundVar(prevBoundVar);
    
    if(boundVar == undefined || this.innerProducts[this.boundVars[boundVar]])
        return; // not a zero-error equation
    
    this.violatedOrGroupResistanceAddBoundVar(boundVar);
}

// This function should be called when an equation changes but its bound
// variable did not change. The function then updates the violated or-group 
// resistance which is induced on the free variables in the equation.
// This only needs to be done for free variables in the equation which
// appear in freeRequireOrGroupResistance or already have an entry in
// the violatedOrGroupVars table (for the relevant group). These are
// the variables for which this calculation was requested or belong
// themselves to the same group.
// The appropriate resistance entries are updated. The function receives 
// as argument the equation ID. 
//
// To refresh the violated or-group resistance, the function only looks
// at violated or-groups which the bound variable belongs to.
// All other groups can be ignored.
//
// If the equation is not a zero-error equation or the bound variable does not
// appear in the equation (this may temporarily be the case after equations
// change but bound variables have not yet been reassigned), any violated
// or-group resistance due to the violated or-groups defined on the bound
// variable is removed.

Resistance.prototype.violatedOrGroupResistanceAfterEquationChange =
    resistanceViolatedOrGroupResistanceAfterEquationChange;

function resistanceViolatedOrGroupResistanceAfterEquationChange(eqId)
{
    var boundVar = this.boundVarsByEq[eqId];

    if(boundVar == undefined)
        return;

    var varEntry = this.violatedOrGroupVars[boundVar];

    if(!varEntry) // no violated or-group on this variable
        return;

    // if the equation is no longer zero-error or the bound variable does not
    // appear in the equation, remove the bound variable's induced resistance
    if(this.innerProducts[eqId] || !this.equations.getValue(eqId, boundVar)) {
        this.violatedOrGroupResistanceRemoveBoundVar(boundVar);
        return;
    }

    // loop over the violated groups to which this variable belongs
    for(var group in varEntry) {

        var entry = varEntry[group];

        // remove the contribution of this variable from variables which
        // used to be in the equation but aren't anymore
        for(var freeVar in entry.freeVars) {
            
            if(this.equations.getValue(eqId, freeVar))
                continue;
            
            this.removeBoundViolatedOrGroupVarFromFreeVar(boundVar, freeVar,
                                                          group);
            delete entry.freeVars[freeVar];
        }

        this.addBoundViolatedOrGroupVarToFree(boundVar, group,
                                              entry.priority,
                                              entry.target);
    }
}

// This function should be called when the given variable has just become
// bound in some zero-error equation. For every or-group which is violated
// on this variable, this function updates the 'violatedOrGroupVars' 
// and recalculates resistance when required.

Resistance.prototype.violatedOrGroupResistanceAddBoundVar =
    resistanceViolatedOrGroupResistanceAddBoundVar;

function resistanceViolatedOrGroupResistanceAddBoundVar(boundVar)
{
    var varEntry = this.violatedOrGroupVars[boundVar];

    if(!varEntry) // no violated or-group on this variable
        return; 
    
    // loop over the groups violated on this variable
    for(var group in varEntry) {

        var groupEntry = varEntry[group];
        
        if(groupEntry.target == undefined) {
            // no constraint for this group defined on the variable, clear the
            // entry.
            delete varEntry[group];
            if(isEmptyObj(varEntry)) {
                delete this.violatedOrGroupVars[boundVar];
                return;
            }
            continue;
        }

        // the variable changed its type from free to bound, so reset
        // the dependency fields
        this.resetViolatedOrGroupVarsGroupEntry(boundVar, group);
        
        // Since the variable is now bound, its or-group violation
        // produces resistance to its movement.
        this.addOrGroupViolationResistance(boundVar, this.solution[boundVar],
                                           group, true);

        // add the effect on free variables in the equation
        this.addBoundViolatedOrGroupVarToFree(boundVar, group,
                                              groupEntry.priority,
                                              groupEntry.target);
    }
}

// This function should be called when a variable ceases to be bound in a
// zero-error equation. This function then goes over all or-groups which are
// violated on the variable and removes any violated or-group resistance
// for this group (from all variables except the bound variable itself).
// In addition, the function checks whether the resistance induced by
// the violated or-groups on the bound variable needs to be updated
// (now that the variable is no longer bound, it may move together with
// other variables in the group and therefore the resistance of a
// violated or group may be lower).
// If the variable is made bound in another equation, this function should
// be called before the or-group is calculated for that new bound variable
// assignment.

Resistance.prototype.violatedOrGroupResistanceRemoveBoundVar =
    resistanceViolatedOrGroupResistanceRemoveBoundVar;

function resistanceViolatedOrGroupResistanceRemoveBoundVar(boundVar)
{
    this.removeBoundViolatedOrGroupVarFromFree(boundVar);

    // the variable changed its type from bound to free, so reset
    // the dependency fields
    var violatedVarEntry = this.violatedOrGroupVars[boundVar];
    
    // Since this was a bound variable until now, it has an entry iff it
    // belongs to a violated or-group. If it doesn't, there is nothing to do
    // below.
    if(!violatedVarEntry)
        return;
    
    for(var group in violatedVarEntry) // loop may be empty 
        this.resetViolatedOrGroupVarsGroupEntry(boundVar, group);
    
    // schedule the variable for recalculation of the contribution of 
    // violated or-groups to its resistance.
    this.needRecalcViolatedOrGroupResistance[boundVar] = true;
}

//
// Violated or-group removal
//

// This function should be called when the given or-group ceases to be violated
// (either becomes satisfied or is removed). This function then removes
// the violations recorded for this group in the 'violatedOrGroupVars' table
// and updates the variable resistance and total resistance induced by
// the group (the actual calculation of the resistance and total
// resistance are queued).

Resistance.prototype.removeViolatedOrGroupResistance =
    resistanceRemoveViolatedOrGroupResistance;

function resistanceRemoveViolatedOrGroupResistance(group)
{
    // go over the list of changes for this group to see which variables
    // were violated before the change.

    var groupChangedVariables = this.orGroups.changes[group] ?
        this.orGroups.changes[group].variables : undefined;
    
    if(groupChangedVariables)
        for(var variable in groupChangedVariables) {
        
            // since the group was violated, every variable must either have
            // been violated or did not exist. We skip here the variables which
            // did not exist before the change.

            if(groupChangedVariables[variable] == undefined)
                continue;

            // remove from variable resistance entry
            this.removeViolatedOrGroupResistanceFromVariable(group, variable);
        }
    
    // we also need to remove the violation resistance for all variables
    // which were violated and remain violated after the change

    var groupEntry = this.orGroups.orGroups[group];

    if(groupEntry && groupEntry.violated)
        for(var variable in groupEntry.violated) {
            // check whether this variable existed before the change
            // (it could not be satisfied because the whole group was violated)
            if(groupChangedVariables && (variable in groupChangedVariables))
                continue;
            
            // remove from variable resistance entry
            this.removeViolatedOrGroupResistanceFromVariable(group, variable);
        }
}

// Given an or-group and a variable, this function removes the violation
// for this group from this variable on all related entries in 
// 'violatedOrGroupVars'. If these changes require recalculation of
// resistance or total resistance for some variables, these 
// calculations are either carried out immediately or scheduled.

Resistance.prototype.removeViolatedOrGroupResistanceFromVariable =
    resistanceRemoveViolatedOrGroupResistanceFromVariable;

function resistanceRemoveViolatedOrGroupResistanceFromVariable(group, variable)
{
    var varGroupEntry = // variable, group entry from violatedOrGroupVars
        this.getViolatedOrGroupVarsGroupEntry(variable, group);
    
    if(!varGroupEntry)
        return;
    
    if(varGroupEntry.target != undefined) {
        delete varGroupEntry.target;

        // may influence resistance/violations or total resistance of
        // the variable. It may happen that the resistance is not influenced
        // but the total resistance is.
        this.queueRecalcForViolatedOrGroups(variable, group,
                                            varGroupEntry.priority);
        this.queueRecalcTotalForViolatedOrGroups(variable, group,
                                                 varGroupEntry.priority);
    }

    this.removeBoundViolatedOrGroupVarFromFree(variable, group);
    
    if(!varGroupEntry.boundVarOpt ||
       (!varGroupEntry.boundVarOpt.num.up &&
        !varGroupEntry.boundVarOpt.num.down)) {
        delete this.violatedOrGroupVars[variable][group];
        if(isEmptyObj(this.violatedOrGroupVars[variable]))
            delete this.violatedOrGroupVars[variable];
    }
}

// This function is given a 'variable' which was bound in an zero-error 
// equation and had constraints in the violated or-group 'groupName'.
// The function then removes the registration of the group and variable 
// from every free variable appearing in the 'freeVars' entry 
// of the variable and group. If 'group' is not given, this is carried out
// for every group appearing in the 'violatedOrGroupVars' entry of the 
// variable (this should be used when the variable is no longer 
// bound in the equation or the equation is no longer a zero error equation).
// This function clears the 'freeVars' list for the group entry of 'variable'
// for every group processed here.

Resistance.prototype.removeBoundViolatedOrGroupVarFromFree = 
    resistanceRemoveBoundViolatedOrGroupVarFromFree;

function resistanceRemoveBoundViolatedOrGroupVarFromFree(variable, groupName)
{
    var violations = this.violatedOrGroupVars[variable];
    
    if(!violations)
        return;
    
    var groups = (groupName == undefined) ? violations : {};

    if(groupName != undefined)
        groups[groupName] = true;

    for(var group in groups) {

        var entry = violations[group];

        if(!entry)
            continue;
        
        for(var freeVar in entry.freeVars)
            this.removeBoundViolatedOrGroupVarFromFreeVar(variable, freeVar,
                                                          group);
        entry.freeVars = {};
    }
}

// This function removes the entry of 'boundVar' from the entry for
// the given 'group' and 'freeVar' in the 'violatedOrGroupVars' table.

Resistance.prototype.removeBoundViolatedOrGroupVarFromFreeVar =
    resistanceRemoveBoundViolatedOrGroupVarFromFreeVar;

function resistanceRemoveBoundViolatedOrGroupVarFromFreeVar(boundVar, freeVar,
                                                            group)
{
    var freeVarEntry = 
        this.getViolatedOrGroupVarsGroupEntry(freeVar, group);
    
    if(!freeVarEntry || !freeVarEntry.boundVarOpt)
        return;
    
    for(var dir in this.dirs)
        if(freeVarEntry.boundVarOpt[dir][boundVar]) {
            delete freeVarEntry.boundVarOpt[dir][boundVar];
            freeVarEntry.boundVarOpt.num[dir]--;
            // can this affect resistance or total resistance?
            if(!freeVarEntry.boundVarOpt.num[dir]) {
                if(freeVarEntry.target != undefined)
                    this.queueRecalcForViolatedOrGroups(freeVar, group,
                                                        freeVarEntry.
                                                        priority);
                else
                    this.queueRecalcTotalForViolatedOrGroups(freeVar,
                                                             group,
                                                             freeVarEntry.
                                                             priority);
            }
        }
    
    if(freeVarEntry.target == undefined && 
       !freeVarEntry.boundVarOpt.num.up && 
       !freeVarEntry.boundVarOpt.num.down)
        delete this.violatedOrGroupVars[freeVar][group];

    if(isEmptyObj(this.violatedOrGroupVars[freeVar]))
        delete this.violatedOrGroupVars[freeVar];
}

// This function removes from this variable's entry in violatedOrGroupVars
// all group entries for or-groups which the variable does not belong to.
// If the variable's entry becomes empty, the variable's entry is removed.
// This function does not update the total resistance of the variable.
// It is assumed the function is called when this information
// is no longer interesting.
// If the free variable still appears in the 'freeRequireOrGroupResistance'
// table, the entries will not be removed

Resistance.prototype.violatedOrGroupsRemoveNonGroupFree =
    resistanceViolatedOrGroupsRemoveNonGroupFree;

function resistanceViolatedOrGroupsRemoveNonGroupFree(variable)
{
    if(this.freeRequireOrGroupResistance[variable])
        return; // entries still required
    
    var varEntry = this.violatedOrGroupVars[variable];

    if(!varEntry)
        return;

    for(var group in varEntry)
        if(varEntry[group].target === undefined)
            delete varEntry[group];

    if(isEmptyObj(varEntry))
        delete this.violatedOrGroupVars[variable];
}

//
// Addition of violated or-groups
//

// This function is called to recalculate the contribution of the given
// violated group to the resistance of variables when the group becomes
// violated.

Resistance.prototype.addViolatedOrGroupResisance =
    resistanceAddViolatedOrGroupResisance;

function resistanceAddViolatedOrGroupResisance(group)
{
    var groupEntry = this.orGroups.orGroups[group];
    
    if(!groupEntry || groupEntry.numSatisfied > 0)
        return; // not a violated group

    // loop over the violated variables and add the group to the resistance of
    // the variable

    for(var variable in groupEntry.violated)
        this.addViolatedOrGroupResistanceToVariable(group, variable);
}

// Given a violated or-group and a variable on which the group is violated,
// this function updates the 'violatedOrGroupVars' entries dependent
// on this violation. If these changes require recalculation of the resistance
// or total resistance of some variables, these calculations are either
// carried out immediately or scheduled.

Resistance.prototype.addViolatedOrGroupResistanceToVariable =
    resistanceAddViolatedOrGroupResistanceToVariable;

function resistanceAddViolatedOrGroupResistanceToVariable(group, variable)
{
    var groupEntry = this.orGroups.orGroups[group];
    
    if(!groupEntry || !groupEntry.violated)
        return;
    
    // violation
    var target = groupEntry.violated[variable];
    var priority = this.segmentConstraints.getOrGroupPriority(group);
    
    if(target == undefined || priority == -Infinity)
        return;
    
    var varGroupEntry = // variable, group entry from violatedOrGroupVars
        this.getViolatedOrGroupVarsGroupEntry(variable, group, true);

    if(varGroupEntry.target == target && varGroupEntry.priority == priority)
        return; // nothing new

    this.queueRecalcForViolatedOrGroups(variable, group,
                                        varGroupEntry.priority);
    // if this variable did not previously have a target, the changes
    // may affect the total resistance independently of the resistance
    if(target == undefined)
        this.queueRecalcTotalForViolatedOrGroups(variable, group,
                                                 varGroupEntry.priority);
    
    varGroupEntry.target = target;
    varGroupEntry.priority = priority;

    // if this is a bound variable in a zero-error equation, update
    // the entries of free variables in the equation in which the variable
    // is bound.
    this.addBoundViolatedOrGroupVarToFree(variable, group, priority, target);
}

// This function is given a variable and a violated or-group which has 
// constraints on the variable. The function is also given the target
// and priority of the violated or group on the given variable.
// The function then checks whether the variable is bound in a
// zero-error equation and if it is, adds this variable to the entries
// in violatedOrGroupVars of all free variables in the bound variable's 
// equation which either belong to the same violated or-group or appear in
// freeRequireOrGroupResistance. If a corresponding entry does not
// appear in the violatedOrGroupVars table, it is created.
// If as a result of this operation the resistance or total
// resistance of some of these variables needs to be refreshed, this is
// carried out or scheduled by this function. 

Resistance.prototype.addBoundViolatedOrGroupVarToFree = 
    resistanceAddBoundViolatedOrGroupVarToFree;

function resistanceAddBoundViolatedOrGroupVarToFree(variable, group,
                                                    priority, target)
{
    var varEntry = this.getViolatedOrGroupVarsGroupEntry(variable, group);
    
    if(!varEntry)
        return;
    
    var eqId = this.boundVars[variable];
    if(eqId == undefined || this.innerProducts[eqId])
        return; // not a bound variable in a zero error equation
    
    // direction of violation reduction (optimization)
    var optDir = target > this.solution[variable] ? 1 : -1;
    // coefficient of 'variable' in the equation
    var variableValue = this.equations.getValue(eqId, variable);
    
    var equation = this.equations.vectors[eqId];
    
    for(var i = 0, l = equation.length ; i < l ; ++i) {

        var entry = equation[i];
        var freeVar = entry.name;

        if(freeVar == variable)
            continue; // not a free variable

        // if not an existing entry and the variable does not appear in the
        // list for which this calculation is required, skip this variable.
        if(!this.violatedOrGroupVars[freeVar] &&
           !this.freeRequireOrGroupResistance[freeVar])
            continue; // no need to calculate

        var freeVarEntry =
            this.getViolatedOrGroupVarsGroupEntry(freeVar, group, true);

        if(!varEntry.freeVars)
            varEntry.freeVars = {};
        
        varEntry.freeVars[freeVar] = entry.value > 0 ? 1 : -1;

        var prevPriority = freeVarEntry.priority;
        var changed = (prevPriority != priority);
        freeVarEntry.priority = priority;

        if(!freeVarEntry.boundVarOpt)
            this.resetViolatedOrGroupVarsGroupEntry(freeVar, group);
        
        // direction of movement of free variable for violation reduction
        // on the bound variable.
        var freeDir = entry.value * variableValue * optDir > 0 ?
            "down" : "up";
        
        // clear any entry in the opposite direction
        var opDir = this.opDirs[freeDir];
        if(freeVarEntry.boundVarOpt[opDir][variable]) {
            delete freeVarEntry.boundVarOpt[opDir][variable];
            freeVarEntry.boundVarOpt.num[opDir]--;
            if(!freeVarEntry.boundVarOpt.num[opDir])
                changed = true;
        }
        
        if(!freeVarEntry.boundVarOpt[freeDir][variable]) {
            // not yet registered
            freeVarEntry.boundVarOpt[freeDir][variable] = true;
            freeVarEntry.boundVarOpt.num[freeDir]++;
            
            if(freeVarEntry.boundVarOpt.num[freeDir] == 1)
                changed = true;
        }
        
        if(changed) {
            if(freeVarEntry.target != undefined)
                this.queueRecalcForViolatedOrGroups(freeVar, group,
                                                    prevPriority);
            else
                this.queueRecalcTotalForViolatedOrGroups(freeVar, group,
                                                         prevPriority);
        }
    }
}

// Given a variable and an or-group, this function adds an entry
// for the variable and the group to the 'violatedOrGroupVars'
// table. An entry will be added only if the group is violated and
// either the variable belongs to the group or the variable is a free
// variable appears in at least one zero-error equation whose bound variable
// belong to the or-group.
// The function returns the entry for the variable and the group,
// if any is created and undefined otherwise.

Resistance.prototype.addVariableAndGroupToViolatedOrGroupVars = 
    resistanceAddVariableAndGroupToViolatedOrGroupVars;

function resistanceAddVariableAndGroupToViolatedOrGroupVars(variable, group)
{   
    // check whether the group is violated
    
    var groupEntry = this.orGroups.orGroups[group];
    if(!groupEntry || groupEntry.numSatisfied > 0)
        return undefined; // not a violated group

    // if there is already an entry for this variable and group,
    // just return it (we assume it is up to date)
    if(this.violatedOrGroupVars[variable] &&
       this.violatedOrGroupVars[variable][group])
        return this.violatedOrGroupVars[variable][group];

    var varEntry = undefined; // the entry to be created

    // priority of the or-group
    var priority = this.segmentConstraints.getOrGroupPriority(group);
    
    if(groupEntry.violated[variable]) {
        varEntry =
            this.getViolatedOrGroupVarsGroupEntry(variable, group, true);
        varEntry.priority = priority;
        varEntry.target = groupEntry.violated[variable];
    }

    if(this.boundVars[variable] != undefined)
        return varEntry;

    // loop over the equations in which the free variable appears and find the
    // zero-error equations whose bound variable belongs to the or-group.
    var componentIndex = this.equations.componentIndex.get(variable);
    var _self = this;
    componentIndex.forEach(function(e,eqId) {
        
        if(_self.innerProducts[eqId])
            return; // not a zero error equation
        
        // get the bound variable and check whether it belongs to
        // the group and if yes, get its entry
        var boundVar = _self.boundVarsByEq[eqId];
        
        if(!boundVar || groupEntry.violated[boundVar] == undefined)
            return; // not in the group
        
        if(!varEntry) {
            varEntry =
                _self.getViolatedOrGroupVarsGroupEntry(variable, group, true);
            varEntry.priority = priority;
        }
        
        // add the bound variable to this entry
        
        var variableValue = e.value;
        var boundVarValue = _self.equations.getValue(eqId, boundVar);
        
        // the entry of the bound variable in the table (if the entry does
        // not yet exist, it is created)
         var boundVarEntry =
             _self.getViolatedOrGroupVarsGroupEntry(boundVar, group, true);
         if(!boundVarEntry.freeVars)
             boundVarEntry.freeVars = {};
         boundVarEntry.freeVars[variable] = variableValue > 0 ? 1 : -1;

         // should probably already be updated, but just in case
         boundVarEntry.priority = priority;
         var target = boundVarEntry.target = groupEntry.violated[boundVar];

         // direction of violation reduction (optimization)
         var optDir = target > _self.solution[boundVar] ? 1 : -1;
         // direction of movement of the free variable for violation reduction
         // on the bound variable.
         var freeDir = variableValue * boundVarValue * optDir > 0 ?
             "down" : "up";
         
         if(!varEntry.boundVarOpt)
             _self.resetViolatedOrGroupVarsGroupEntry(variable, group);
         
         varEntry.boundVarOpt[freeDir][boundVar] = true;
         varEntry.boundVarOpt.num[freeDir]++;
    });
    
    return varEntry;
}

// This function gets the entry for the given variable and group from the
// violatedOrGroupVars table. If 'create' is set and the entry does not
// exist, a new (empty) entry is created and returned.

Resistance.prototype.getViolatedOrGroupVarsGroupEntry = 
    resistanceGetViolatedOrGroupVarsGroupEntry;

function resistanceGetViolatedOrGroupVarsGroupEntry(variable, group, create)
{
    if(!this.violatedOrGroupVars[variable]) {
        if(!create)
            return undefined;
        this.violatedOrGroupVars[variable] = {};
    }
    
    if(!this.violatedOrGroupVars[variable][group]) {
        
        if(!create)
            return undefined;
        
        this.violatedOrGroupVars[variable][group] = { 
            priority: -Infinity,
        };

        // reset the dependency fields of the entry 
        this.resetViolatedOrGroupVarsGroupEntry(variable, group);
    }
    
    return this.violatedOrGroupVars[variable][group];
}

// This function resets the violated or-group variable entry dependency
// fields. These are the 'freeVars' and 'boundVarOpt' which describe
// the dependency of the violated or-group resistance of free variables
// on that of bound variables. Bound variable should have a 'freeVars'
// field while free variables should have a 'boundVarOpt'. This function
// initializes these fields, based on whether the variable is bound or not,
// deleting the field which is not required (if it existed) and creating
// the required dependency field. If the required field already exists,
// it will be cleared only if the 'clearFields' flag is set.
// If the entry for the given variable and group does not exist, the function
// does nothing.

Resistance.prototype.resetViolatedOrGroupVarsGroupEntry = 
    resistanceResetViolatedOrGroupVarsGroupEntry;

function resistanceResetViolatedOrGroupVarsGroupEntry(variable, group,
                                                      clearFields)

{
    // get the entry
    if(!this.violatedOrGroupVars[variable])
        return;

    var entry = this.violatedOrGroupVars[variable][group];

    if(!entry)
        return;
    
    if(this.boundVars[variable]) {
        delete entry.boundVarOpt;
        if(!entry.freeVars || clearFields)
            entry.freeVars = {};
    } else {
        delete entry.freeVars;
        if(!entry.boundVarOpt || clearFields)
            entry.boundVarOpt = { 
                up: {}, 
                down: {}, 
                num: { 
                    up: 0, 
                    down: 0 
                }
            };
    }
}

//
// Violated Or-Group Resistance and Resistance Refresh
//

// Given a bound variable which belongs to one or more violated or-groups
// and whose equation has a zero error and a free variable which appears
// in this equation, this function checks whether the highest priority
// violated or-groups defined on the bound variable resist the movement
// of the free variable (since all violations must be in the same direction,
// such resistance must be in the direction which increases the violation
// on the bound variable). If at least one of the maximum priority or-groups
// resists the free variable, true is returned. Otherwise, false is returned.
// This function may create an entry for the free variable in the
// violatedOrGroupVars table if such an entry does not already exist.
//
// The function does not check that bound variable is indeed bound, that
// its equation is zero error or that the free variable appears in that
// equation. This is considered the responsibility of the caller.
// However, if one of these assumptions is false, the function may return
// false.


Resistance.prototype.violatedOrGroupsOfBoundResistFree =
    resistanceViolatedOrGroupsOfBoundResistFree;

function resistanceViolatedOrGroupsOfBoundResistFree(freeVar, boundVar)
{
    var boundEntry = this.violatedOrGroupVars[boundVar];
    var maxPriority = -Infinity; // max group priority
    // max priority at which resistance was found
    var maxResistance = -Infinity;
    
    // loop over the or-groups
    for(var group in boundEntry) { 
        
        // get/create an entry for the free variable and the or-group.
        var freeEntry =
            this.addVariableAndGroupToViolatedOrGroupVars(freeVar, group);

        if(!freeEntry)
            // can happen only if the function was called for variables
            // which did not satisfy the assumptions listed above.
            return false;

        var priority = boundEntry[group].priority;
        
        if(priority <= maxResistance)
            continue; // this resistance level has already been checked

        if(priority < maxPriority)
            maxPriority = priority;
        
        if(!freeEntry.boundVarOpt)
            return false; // not a free variable, function called incorrectly

        // check whether movement is resisted (verify that this includes
        // resistance of the bound variable).
        if((!freeEntry.boundVarOpt.num.up &&
            freeEntry.boundVarOpt.num.down > 0 &&
            freeEntry.boundVarOpt.down[boundVar])
           ||
           (!freeEntry.boundVarOpt.num.down &&
            freeEntry.boundVarOpt.num.up > 0 &&
            freeEntry.boundVarOpt.up[boundVar]))
            maxResistance = priority;
    }

    return (maxPriority > -Infinity && maxPriority == maxResistance);
}
    

// This function adds an entry for the given variable, group and priority
// to the 'needRecalcForViolatedOrGroups' table. If the table already
// holds an entry for the given variable and group, this will not override
// this entry (since the priority is the previous priority before the
// change, we want to keep storing the priority before the first change).
// Undefined priority is converted to -Infinity.

Resistance.prototype.queueRecalcForViolatedOrGroups =
    resistanceQueueRecalcForViolatedOrGroups;

function resistanceQueueRecalcForViolatedOrGroups(variable, group,
                                                  priority)
{
    if(!this.needRecalcForViolatedOrGroups[variable])
        this.needRecalcForViolatedOrGroups[variable] = {};

    if(!(group in this.needRecalcForViolatedOrGroups[variable]))
        this.needRecalcForViolatedOrGroups[variable][group] = priority;
}

// This function adds an entry for the given variable, group and priority
// to the 'needRecalcTotalForViolatedOrGroups' table. If the table already
// holds an entry for the given variable and group, this will not override
// this entry (since the priority is the previous priority before the
// change, we want to keep storing the priority before the first change).
// Undefined priority is converted to -Infinity.

Resistance.prototype.queueRecalcTotalForViolatedOrGroups =
    resistanceQueueRecalcTotalForViolatedOrGroups;

function resistanceQueueRecalcTotalForViolatedOrGroups(variable, group,
                                                       priority)
{
    if(!this.needRecalcTotalForViolatedOrGroups[variable])
        this.needRecalcTotalForViolatedOrGroups[variable] = {};

    if(!(group in this.needRecalcTotalForViolatedOrGroups[variable]))
        this.needRecalcTotalForViolatedOrGroups[variable][group] = priority;
}

// This function updates the violation and resistance of variables
// for which changes in the 'violatedOrGroupVars' may result in
// a change of violation or resistance. This function
// should run before processing all variables which need a complete
// recalculation of their resistance, so that in case
// this is needed, this function (and its sub-functions) can schedule the
// relevant full resistance calculations. Similarly,
// variables for which a complete recalculation of resistance has already
// been scheduled are skipped by this function.

Resistance.prototype.calcPendingResistanceFromViolatedOrGroups =
    resistanceCalcPendingResistanceFromViolatedOrGroups;

function resistanceCalcPendingResistanceFromViolatedOrGroups()
{
    for(var variable in this.needRecalcForViolatedOrGroups) {

        // if the variable is scheduled for complete recalculation, skip it
        if(this.needRecalc[variable])
            continue;

        // Loop over the groups for which there has been a change
        for(var group in this.needRecalcForViolatedOrGroups[variable]) {

            var prevPriority = // priority before the change
                this.needRecalcForViolatedOrGroups[variable][group];

            var groupEntry =
                this.getViolatedOrGroupVarsGroupEntry(variable, group, true);
            var varEntry = this.variables[variable];
            
            if(!varEntry) {
                this.needRecalc[variable] = true;
                break;
            }
            
            // true if this group could have been the source of resistance
            var mayHaveBeenMaxResistance =
                (varEntry.resistance.up > varEntry.withoutViolatedOrGroups.up
                 && varEntry.resistance.up == prevPriority) ||
                (varEntry.resistance.down >
                 varEntry.withoutViolatedOrGroups.down &&
                 varEntry.resistance.down == prevPriority);

            if(mayHaveBeenMaxResistance &&
               groupEntry.boundVarOpt &&
               groupEntry.boundVarOpt.num.up > 0 &&
               groupEntry.boundVarOpt.num.down > 0) {
                this.needRecalc[variable] = true;
                break;
            }
            
            if(groupEntry && groupEntry.target != undefined &&
               groupEntry.priority >= prevPriority) {
                
                // has a violation and priority did not decrease
                if(groupEntry.priority == prevPriority) {
                    // the target may have changed, but we can only find out
                    // by completely recalculating
                    this.needRecalc[variable] = true;
                    break;
                } else if(mayHaveBeenMaxResistance &&
                          groupEntry.boundVarOpt &&
                          groupEntry.boundVarOpt.num.up > 0 &&
                          groupEntry.boundVarOpt.num.down > 0)
                    // enough to recalculate the violated or-groups
                    this.needRecalcViolatedOrGroupResistance[variable] = true;
                else // enough to add this or-group
                    this.addOrGroupViolationResistance(variable,
                                                       this.solution[variable],
                                                       group, true);
                continue;
            }

            // the group violation has been removed or its priority
            // decreased

            if(varEntry.violationPriority == prevPriority) {
                // this may have been the maximal violation, so complete
                // recalculation is necessary to determine the violation
                this.needRecalc[variable] = true;
                break;
            } else if(mayHaveBeenMaxResistance)
                this.needRecalcViolatedOrGroupResistance[variable] = true;
        }
    }
    
    // clear the table
    this.needRecalcForViolatedOrGroups = {};
}

// This function updates the total resistance of variables
// for which changes in the 'violatedOrGroupVars' may result in
// a change of total resistance. This function
// should run before processing all variables which need a complete
// recalculation of their total resistance, so that in case
// this is needed, this function (and its sub-functions) can schedule the
// relevant full total resistance calculations. Similarly,
// variables for which a complete recalculation of total resistance has already
// been scheduled are skipped by this function.

Resistance.prototype.calcPendingTotalResistanceFromViolatedOrGroups =
    resistanceCalcPendingTotalResistanceFromViolatedOrGroups;

function resistanceCalcPendingTotalResistanceFromViolatedOrGroups()
{
    for(var variable in this.needRecalcTotalForViolatedOrGroups) {
        
        // if the variable is scheduled for complete recalculation, skip it
        if(this.pendingRecalcTotal[variable])
            continue;
        
        var total = this.totalResistance[variable];
        
        if(!total)
            continue; // total resistance is not required for this variable
        
        for(var group in this.needRecalcTotalForViolatedOrGroups[variable]) {
            
            var groupEntry =
                this.getViolatedOrGroupVarsGroupEntry(variable, group);
            // resistance -Infinity in case the group does not resist movement
            var resistance = -Infinity;
            var representative = undefined;
            
            if(groupEntry) {
                
                var boundVarOpt = groupEntry.boundVarOpt;
                
                if(boundVarOpt &&
                   (boundVarOpt.num.up || boundVarOpt.num.down) &&
                   boundVarOpt.num[total.dir] == 0) {
                    // group contributes to the total resistance
                    resistance = groupEntry.priority;
                    representative = 
                        objFirstProp(boundVarOpt[this.opDirs[total.dir]]);
                }
            }
            
            this.addToTotalResistance(variable, resistance, representative,
                                      group, false, true, true);
        }
    }
    
    // clear the table
    this.needRecalcTotalForViolatedOrGroups = {};
}

//
// Changes
//

// This function should be called when the given 'group' remains violated,
// but changes may have taken place in the way the various variables
// in the group are violated: the target may have changed, variables may have
// been removed or added to the group and the priority of the group may have
// changed.

Resistance.prototype.processViolatedOrGroupChanges =
    resistanceProcessViolatedOrGroupChanges;

function resistanceProcessViolatedOrGroupChanges(group)
{
    // get the list of group changes
    var changes = this.orGroups.changes[group];

    if(!changes)
        return;

    var groupEntry = this.orGroups.orGroups[group];
    
    if(!groupEntry || groupEntry.satisfied > 0)
        return; // not a violated group

    // did the priority change? (and by how much)
    var priorityChanged = ("priority" in changes) ?
        this.segmentConstraints.getOrGroupPriority(group) - changes.priority :
        0;
    
    for(var variable in changes.variables) {
        
        var prevTarget =  changes.variables[variable];
        var target = groupEntry.violated[variable];

        // update the group violation on the variable entry if either the
        // variable was removed or the target changed (including new variable)
        // but the priority did not change (if the priority changed,
        // all violated variables will be updated below)
        
        if(target != prevTarget) {
            if(target == undefined)
                this.removeViolatedOrGroupResistanceFromVariable(group,
                                                                 variable);
            else if(!priorityChanged)
                this.addViolatedOrGroupResistanceToVariable(group, variable);
        }
    }

    if(priorityChanged) // update all violated variables
        for(var variable in groupEntry.violated) {
            if(priorityChanged < 0)
                this.removeViolatedOrGroupResistanceFromVariable(group,
                                                                 variable);
            this.addViolatedOrGroupResistanceToVariable(group, variable);
        }
}
