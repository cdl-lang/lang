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


// This file implements an object which supports a set of vectors and
// their linear combinations. The object basically holds two sets of
// vectors - the original vectors and a set of vectors which are linear
// combinations of the original set of vectors.
//
// The object allows an external caller to modify the original vectors
// and these changes are then translated into the corresponding changes
// in the linear combinations of these vectors. An external caller is
// not allowed to directly modify the values of the vectors in the
// linear combinations except for changing the linear combinations themselves.
//
// The structure of this object is:
// {
//    baseSet: <a VectorSet object>,
//    combinationSet: <a VectorSet object>,
//    combinations: {
//       <orig vec ID 1>: {
//           <combination vector ID 1>: <scalar>
//           .....
//       }
//       .....
//    }
//    inverse: {
//       <combination vector ID 1>: {
//           <orig vec ID 1>:  <scalar>
//           ....
//       }
//       ....
//    }
// }
// The 'baseSet' is the set of original vectors (before linear combinations
// are applied). The 'combinationSet' is the set of vectors after the linear
// combinations are applied. The 'combinations' objects holds, for every
// vector in 'baseSet' the list of vectors in 'combinationSet' which it
// participates in and a scalar which is the multiple by which it participates
// in that vector. The 'inverse' object holds the same information as
// 'combinations' but with the reverse order of keys (first the combination
// vector and then the base vector).
//
// As the combinations are updated, the combination numbers (the number by
// which each vector in the base set is multiplied when added to a combination)
// may become too large or too small. If the combination numbers of
// a combination vector are all small or all large (in absolute value) then
// it may useful to 're-normalize' them (multiply by a scalar) to make them
// closer to 1 (if the numbers remain too large or too small, this may
// lead to inaccuracies when calculating the combination vector and when
// calculating inner products).
//
// It is therefore possible to set a 'normalizationThreshold' which should
// be a positive number. If, in the process of updating the combinations,
// it is detected that one of the combination number of a combination vector
// become larger (in absolute value) than normalizationThreshold or smaller
// (in absolute value) than 1/normalizationThreshold (but not zero) the
// combination vector is added to the list of 'normalizationCandidates'.
// It is then up to the external module which owns this CombinationVectors
// object to go over this list of candidates and decide which of the
// vectors in the list to normalize (this normalization may have consequences
// for the owner module and therefore cannot be decided on inside
// the CombinationVectors object).
//
// An external module has several functions at its disposal to help it
// decide whether to normalize and perform the normalization. See the
// 'normalization' section in the code.
//
// 'zeroRounding' is an optional parameter which should be a small positive
// number. This number is passed on to the vector sets owned by this object.

function CombinationVectors(zeroRounding, normalizationThreshold)
{
    this.zeroRounding = (zeroRounding && zeroRounding > 0) ? zeroRounding : 0;
    this.normalizationThreshold =
        normalizationThreshold ? normalizationThreshold : 0;
    this.baseSet = new VectorSet(this.zeroRounding);
    this.combinationSet = new VectorSet(this.zeroRounding);
    this.combinations = {};
    this.inverse = {};
    this.normalizationCandidates = {};
}

/////////////////////////
// Interface functions //
/////////////////////////

// These fuctions provide easy access to structures inside the various
// vector sets.

// This function returns the component change list of the base vector sets.

CombinationVectors.prototype.getComponentChanges =
    combinationVectorsGetComponentChanges;

function combinationVectorsGetComponentChanges()
{
    return this.baseSet.componentChanges;
}

// This function clears the component change list of the base and combination
// vector sets.

CombinationVectors.prototype.clearComponentChanges =
    combinationVectorsClearComponentChanges;

function combinationVectorsClearComponentChanges()
{
    this.baseSet.clearComponentChanges();
    this.combinationSet.clearComponentChanges();
}

// This function returns true iff the component with the given name has
// a non-zero value in one of the base vectors,

CombinationVectors.prototype.hasComponent =
    combinationVectorsHasComponent;

function combinationVectorsHasComponent(name)
{
    return this.baseSet.componentIndex.has(name);
}

// Get the list of combination set vectors which have a non-zero value at
// the given component. If no vector has a non-zero value at this component,
// undefined is returned.

CombinationVectors.prototype.combinationComponentIndex =
    combinationVectorsCombinationComponentIndex;

function combinationVectorsCombinationComponentIndex(name)
{
    return this.combinationSet.componentIndex.get(name);
}

// This function returns the size (number of vectors) of the base set

CombinationVectors.prototype.baseSetSize = combinationVectorsBaseSetSize;

function combinationVectorsBaseSetSize()
{
    return this.baseSet.setSize;
}

// This function returns the size (number of vectors) of the combination set

CombinationVectors.prototype.combinationSetSize =
    combinationVectorsCombinationSetSize;

function combinationVectorsCombinationSetSize()
{
    return this.combinationSet.setSize;
}

// This function returns the number non-zero vectors in the base set

CombinationVectors.prototype.baseNonZeroSize =
    combinationVectorsBaseNonZeroSize;

function combinationVectorsBaseNonZeroSize()
{
    return this.baseSet.nonZeroSize;
}

// This function returns the number non-zero vectors in the combination set

CombinationVectors.prototype.combinationNonZeroSize =
    combinationVectorsCombinationNonZeroSize;

function combinationVectorsCombinationNonZeroSize()
{
    return this.combinationSet.nonZeroSize;
}

// Get the value of the given component in the given vector in the 
// combination set.

CombinationVectors.prototype.getValue =
    combinationVectorsGetValue;

function combinationVectorsGetValue(vectorId, name)
{
    return this.combinationSet.getValue(vectorId, name);
}

////////////////////////
// Base Set Functions //
////////////////////////

// The following functions are the standard functions for manipulating
// vectors in a vector set. These functions apply to the base set and
// then propagate the required modifications to the combination set.

// This function adds the given value to the component with the given name
// in the vector with ID 'vectorId'. If no such vector exists in the
// base set, the function does nothing.

CombinationVectors.prototype.addValue = combinationVectorsAddValue;

function combinationVectorsAddValue(vectorId, name, value)
{
    var combinations = this.combinations[vectorId];

    for(var id in combinations) {

        var diff = value * combinations[id];
        
        this.combinationSet.addValue(id, name, diff);
    }
    
    this.baseSet.addValue(vectorId, name, value);
}

// This function 'transfers' weight from one component in a base vector
// to another. The vector is given by 'vectorId'. The 'prevName' and
// 'prevValue' are the name of the component and quantity which need to
// be removed while 'newName' and 'newValue' are the quanitity to be added.
// It may be that either 'prevName' or 'newName' are undefined.
// In this case there is no value to remove or add (respectively).
// It may also be that 'prevName' and 'newName' are the same.

CombinationVectors.prototype.transferValue = combinationVectorsTransferValue;

function combinationVectorsTransferValue(vectorId, prevName, prevValue,
                                         newName, newValue)
{
    if(prevName != undefined && newName != prevName)
        // remove the contribution from the previous component
        this.addValue(vectorId, prevName, -prevValue);
    
    if(newName != undefined) {
        // add the new Value
        if(newName == prevName) {
            
            var diff = newValue - prevValue;
	    
            // check whether the change is 0.
            // round to zero if the difference is relatively very small
            if(diff === 0 || 
               (this.zeroRounding !== 0 && prevValue && diff && 
                Math.abs(diff / prevValue) < this.zeroRounding))
                return;
            
            this.addValue(vectorId, newName, diff);
        } else
            this.addValue(vectorId, newName, newValue);
    }
}

// This adds a new vector to the base set, initialized with the given
// values. 'values' is an array holding objects of the form 
// { name: <component name>, value: <number> } describing the non-zero
// values in the vector. All other components are assigned zero.
// If the flag 'createInCombinations' is set, a copy of the vector
// is created (under a new vector ID) in the combination set.
// The function returns an array with two numbers - the first is the ID
// of the new vector created in the base set and the second is the ID of
// the new vector created in the combination set (if no such vector is
// created, undefined is returned for the second number).

CombinationVectors.prototype.newVector = combinationVectorsNewVector;

function combinationVectorsNewVector(values, createInCombinations)
{
    var vectorId = this.baseSet.newVector(values);

    this.combinations[vectorId] = {};

    var combinationVecId;
    
    if(createInCombinations)
        combinationVecId = this.newCombVector(vectorId, 1);

    return [vectorId, combinationVecId];
}

// This function sets the vector in the base set with the given ID
// to have the given 'values', where 'values' is an array of objects
// of the form { name: <component name>, value: <number> } describing
// the non-zero component of the vector. All other components are assigned 
// the value 0.
// If a vector with the given ID does not exist in the base set,
// the operation fails and false is returned. Otherwise, true is returned.

CombinationVectors.prototype.setVector = combinationVectorsSetVector;

function combinationVectorsSetVector(vectorId, values)
{
    var diffVector = [];

    if(!this.baseSet.setVector(vectorId, values, diffVector))
        return false; // vector does nto exist

    // the combinations which depend on this vector
    var combinations = this.combinations[vectorId];
    
    for(var id in combinations)
        this.combinationSet.addToVector(id, diffVector, undefined, 
                                        combinations[id]);

    return true;
}

// The following function removes the given vector from the base set.
// It therefore also removes it from all combinations.
// The function returns false if the vector does not exist (and therefore
// cannot be removed) and true otherwise.

CombinationVectors.prototype.removeVector = combinationVectorsRemoveVector;

function combinationVectorsRemoveVector(vectorId)
{
    var vector = this.baseSet.vectors[vectorId];

    if(!vector)
        return false;

    // the combinations which depend on this vector
    var combinations = this.combinations[vectorId];

    // remove this vector from the linear combinations which which include
    // this vector.
    if(combinations) {
        for(var id in combinations) {
            this.combinationSet.
                addToVector(id, undefined, vectorId, -combinations[id]);
        }

        for(var id in combinations)
            delete this.inverse[id][vectorId];
    
        delete this.combinations[vectorId];
    }

    this.baseSet.removeVector(vectorId);

    return true;
}

// This function receives a vector ID ('addToId') and a vector ('toAdd')
// and a real number ('scalar') and adds the second vector ('toAdd'),
// multiplied by the given 'scalar', to the vector with ID 'addToId'.
// The vector with ID 'addToId' has to be
// in the base set, otherwise the operation does not take place.

CombinationVectors.prototype.addToVector = combinationVectorsAddToVector;

function combinationVectorsAddToVector(addToId, toAdd, scalar)
{
    if(scalar == 0)
        return; // nothing to do
    
    this.baseSet.addToVector(addToId, toAdd, undefined, scalar);

    // the combinations which depend on this vector
    var combinations = this.combinations[addToId];

    // add this vector also to all combinations which depend on the base vector
    if(combinations) {
        for(var id in combinations) {
            this.combinationSet.
                addToVector(id, toAdd, undefined, scalar * combinations[id]);
        }
    }
}

////////////////////////////////////////
// Combination Manipulation Functions //
////////////////////////////////////////

// The following functions allow the manipulation of the combination set
// vectors.

// This function creates a new vector in the combination set and initializes
// it to 'scalar' times the given base set vector (if the given vector ID
// is not in the base set, the vector is initialized to zero).
// The function returns the ID of the new vector.

CombinationVectors.prototype.newCombVector = combinationVectorsNewCombVector;

function combinationVectorsNewCombVector(vectorId, scalar)
{
    // create a new vector
    

    if(scalar == 0)
        return this.combinationSet.newVector([]);

    var baseVector = this.baseSet.vectors[vectorId];

    if(baseVector == undefined)
        return this.combinationSet.newVector([]);

    // initialize the combination vector to be equal to the base vector

    var combId = this.combinationSet.newVector(baseVector);

    if(scalar != 1)
        this.combinationSet.multiplyVector(combId, scalar);

    this.combinations[vectorId][combId] = scalar;
    this.inverse[combId] = {};
    this.inverse[combId][vectorId] = scalar;

    return combId;
}

// Remove the given combination vector

CombinationVectors.prototype.removeCombVector =
    combinationVectorsRemoveCombVector;

function combinationVectorsRemoveCombVector(vectorId)
{
    this.combinationSet.removeVector(vectorId);

    for(var id in this.inverse[vectorId])
        delete this.combinations[id][vectorId];
        
    delete this.inverse[vectorId];
}

// Add the given multiple of the given base vector to the specified combination
// vector. If either the base vector or the combination vector do not exist,
// false is returned and nothing is done. Otherwise, true is returned.

CombinationVectors.prototype.addBaseToCombVector =
    combinationVectorsAddBaseToCombVector;

function combinationVectorsAddBaseToCombVector(combId, baseId, scalar)
{
    var baseVec = this.baseSet.vectors[baseId];

    if(baseVec === undefined || !(combId in this.combinationSet.vectors))
        return false;
    
    if(combId in this.combinations[baseId]) {
        this.inverse[combId][baseId] = 
            (this.combinations[baseId][combId] += scalar);
    } else {
        this.combinations[baseId][combId] = scalar;
        this.inverse[combId][baseId] = scalar;
    }

    this.combinationSet.addToVector(combId, baseVec, undefined, scalar);
    return true;
}

// Add the 'scalar' multiple of the combination vector 'toAddId' to
// the combination vector 'addToId'. If either of the two vectors do not
// exist, false is returned and nothing is done. Otherwise true is returned.

CombinationVectors.prototype.addCombToCombVector =
    combinationVectorsAddCombToCombVector;

function combinationVectorsAddCombToCombVector(addToId, toAddId, scalar)
{
    if(!(addToId in this.combinationSet.vectors) || 
       !(toAddId in this.combinationSet.vectors))
        return false;

    if(!scalar)
        return true; // nothing to do
    
    var inverseAddTo = this.inverse[addToId];
    var inverseToAdd = this.inverse[toAddId];

    for(var baseId in inverseToAdd) {

        var origComb = (baseId in inverseAddTo) ? inverseAddTo[baseId] : 0;
        var newComb = origComb + inverseToAdd[baseId] * scalar;
        
        // should this be rounded to zero?
        if(this.zeroRounding != 0 && newComb != 0 && origComb != 0 && 
           Math.abs(newComb / origComb) < this.zeroRounding)
            newComb = 0;

        var absNewComb = Math.abs(newComb);
        
        if(absNewComb != 0) {
            // check whether there may be need to normalize this vector
            if(this.normalizationThreshold &&
               (absNewComb > this.normalizationThreshold ||
                1 / absNewComb > this.normalizationThreshold))
                this.normalizationCandidates[addToId] = true;
        }
        
        if(newComb != 0) {
            inverseAddTo[baseId] = newComb;
            this.combinations[baseId][addToId] = newComb;
        } else {
            delete inverseAddTo[baseId];
            delete this.combinations[baseId][addToId];
        }
    }
    
    this.combinationSet.addToVector(addToId, undefined, toAddId, scalar);
    return true;
}

// This function performs Gaussian elimination on the column of the given
// component name such that after the elimination, the only non-zero value
// for this component is at the given vector. If the value for the given
// component at the given vector is zero, the operation fails and false
// is returned. Otherwise, true is returned.

CombinationVectors.prototype.eliminate = combinationVectorsEliminate;

function combinationVectorsEliminate(name, combId)
{
    var nonZeros = this.combinationSet.componentIndex.get(name);

    if(!nonZeros.has(combId))
        return false; // unknown vector ID or value is zero

    // eliminate all other non-zeros

    var value = nonZeros.get(combId).value;
    var inverseToAdd = this.inverse[combId];
    // IDs of the base vector which contribute to the combination vector combId
    var baseIdsInToAdd = Object.keys(inverseToAdd);

    var _self = this;
    nonZeros.forEach(function(entry, addToId) {
        
        if(addToId == combId)
            return;

        var scalar = -entry.value / value;
        var inverseAddTo = _self.inverse[addToId];

        for(var i = 0, l = baseIdsInToAdd.length ; i < l ; ++i) {
            var baseId = baseIdsInToAdd[i];

            var origComb = (baseId in inverseAddTo) ? inverseAddTo[baseId] : 0;
            var newComb = origComb + inverseToAdd[baseId] * scalar;
        
            // should this be rounded to zero?
            if(_self.zeroRounding != 0 && newComb != 0 && origComb != 0 && 
               Math.abs(newComb / origComb) < _self.zeroRounding)
                newComb = 0;

            var absNewComb = Math.abs(newComb);
        
            if(absNewComb != 0) {
                // check whether there may be need to normalize this vector
                if(_self.normalizationThreshold &&
                   (absNewComb > _self.normalizationThreshold ||
                    1 / absNewComb > _self.normalizationThreshold))
                    _self.normalizationCandidates[addToId] = true;
            }
        
            if(newComb != 0) {
                inverseAddTo[baseId] = newComb;
                _self.combinations[baseId][addToId] = newComb;
            } else {
                delete inverseAddTo[baseId];
                delete _self.combinations[baseId][addToId];
            }
        }
        
        _self.combinationSet.addToVector(addToId, undefined, combId, 
                                         scalar);

        // make sure that the eliminated variable is indeed exactly zero
        // as a result of this operation (in case of rounding errors).
        _self.combinationSet.setValue(addToId, name, 0);
    });
    
    return true;
}

// Because the combinations are updated incrementally with changes made to
// the base set, errors due to inaccuracies in the fixed arithmetic can
// accumulate. This function fixes the most important of these:
// when a component does not longer appear in the base set (all its
// coefficients are zero) it should also no longer appear in the combination
// set (the incremental update may sometimes leave in the combinations
// a small 'almost zero' coefficient for such a component). To repair such
// errors, this function goes over the list of components which are listed
// as 'removed' in the base set's component change list and checks whether
// these component are still in the combination set. If they are, they
// are removed.

CombinationVectors.prototype.repairCombinations =
    combinationVectorsRepairCombinations;

function combinationVectorsRepairCombinations()
{
    var changes = this.baseSet.componentChanges;
    
    for(var component in changes) {

        if(changes[component] != "removed")
            continue;

        if(!this.combinationSet.componentIndex.has(component))
            continue; // does not appear in the combinations either

        // remove the variable from all combinations it appears in
        this.combinationSet.setToZeroInAllVectors(component);
    }
}

/////////////////////////////////////
// Normalization and Zero Rounding //
/////////////////////////////////////

// Given a combination vector, this function calculates the normalization
// constant for that vector. The normalization constant is the reciprocal
// of the smallest absolute value combination number if the absolute
// value of all combination numbers is > 1 and is the reciprocal of the
// largest absolute value combination number if the absolute value of
// all combination numbers is < 1. If some absolute values of combination
// numbers are larger than 1 and some smaller, the normalization constant
// returned is 1 (which means 'no need to normalize').
// If 'this.zeroRounding' is non-zero, combination numbers whose
// ratio with the largest absolute value combination number is smaller
// (in absolute value) than this.zeroRounding are considered to be zero
// for the purpose of this calculation.
// If the given ID is no the ID of a combination vector, this function
// returns 'undefined'.

CombinationVectors.prototype.calcNormalizationConstant =
    combinationVectorsCalcNormalizationConstant;

function combinationVectorsCalcNormalizationConstant(combId)
{
    if(!(combId in this.inverse))
        return undefined;

    var max = 0;
    var min = Infinity;
    var inverseCombId = this.inverse[combId];
    
    while(1) {
        for(var id in inverseCombId) {
            var a = Math.abs(inverseCombId[id]);

            if(!a)
                continue;

            if(a > max)
                max = a;
            else if(a / max < this.zeroRounding)
                continue; // value is too small, round to zero 
            
            if(a < min)
                min = a;
        }

        if(min / max >= this.zeroRounding)
            break;
        min = Infinity;
    }

    if(min > 1)
        return 1/min;

    if(max < 1)
        return 1/max;
    
    return 1;
}

// Given a combination vector and a normalization constant, this
// function multiplies the combination vector by the normalization
// constant. 
//
// If the flag 'recalculate' is set then this function completely
// recalculates the combination vector from the base vectors. Otherwise,
// the combination vector is simply calculated by multiplying the
// vector by the normalization constant.

CombinationVectors.prototype.normalize = combinationVectorsNormalize;

function combinationVectorsNormalize(combId, normalizationConstant,
                                     recalculate)
{
    if(!(combId in this.inverse))
        return; // nothing to do
    
    var inverseCombId = this.inverse[combId];
    
    // recalculate the combination numbers
    for(var id in inverseCombId) {
        
        var comb = inverseCombId[id] * normalizationConstant;

        inverseCombId[id] = comb;
        this.combinations[id][combId] = comb;
    }

    // update the vector
    
    if(!recalculate) {
        this.combinationSet.multiplyVector(combId, normalizationConstant);
        return;
    }
    
    this.recalculateCombination(combId);
}

// This function completely recalculates the given combination vector (and
// its inner product(s)) based on the combination numbers and the base
// vectors. To facilitate rounding of arithmetic errors, the function first 
// adds all the positive contributions to the value of a specific component
// separately from all negative contributions and then adds them together.
// If the sum is considerably smaller than the positive and negative parts,
// this difference is considered an arithmetic error and the value is 
// rounded to zero.

CombinationVectors.prototype.recalculateCombination =
    combinationVectorsRecalculateCombination;

function combinationVectorsRecalculateCombination(combId)
{
    var positives = {}; // positive parts of the values 
    var negatives = {}; // negative parts of the values
    var values = [];

    var inverseCombId = this.inverse[combId];

    for(var id in inverseCombId) {
        
        var comb = inverseCombId[id];
        var vector = this.baseSet.vectors[id];
        
        for(var i = 0, l = vector.length ; i < l ; ++i) {
            var element = vector[i];
            var name = element.name;
            
            var prod = element.value * comb;
            
            if(!prod)
                continue;
            
            if(!(name in positives)) {
                positives[name] = 0;
                negatives[name] = 0;
            }
            
            if(prod > 0)
                positives[name] += prod;
            else
                negatives[name] += prod;
        }
    }
    
    for(var name in positives) {
        
        var positive = positives[name];
        var value = positive + negatives[name];
        
        if(positive && Math.abs(value / positive) < this.zeroRounding)
            continue;
        
        values.push({ name: name, value: value });
    }

    for(var name in negatives) {
        if(!(name in positives)) // not handled by the previous loop
            values.push({ name: name, value: negatives[name] });
    }
    
    this.combinationSet.setVector(combId, values);
}

// This function clears the list of normalization candidates (should be called
// by the module which requests the normalization after having normalized
// the vectors which need to be normalized).

CombinationVectors.prototype.clearNormalizationCandidates =
    combinationVectorsClearNormalizationCandidates;

function combinationVectorsClearNormalizationCandidates()
{
    this.normalizationCandidates = {};
}
