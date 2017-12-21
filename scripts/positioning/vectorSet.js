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


// This file implements the management of a set of vectors. Each
// component has a name and the component are referred to using these names.
// Only the non-zero components are actually stored.
// This object supports the addition of vectors and it also supports the lookup
// of vectors in which a given component is not zero. It also supports the
// merging of two such vector systems and the splitting of such a vector
// system into two independent vector systems.
//
// The implementation assumes that the vectors are sparse and therefore
// does not store the zeros in the vectors.
//
// A vector set can optionally be coupled with other vector sets which
// are considered to be in the dual space.
// The inner products between the vectors in the two sets are then
// maintained by an inner product object which is stored on the 'innerProduct'
// array of this vector set. The vector set then has to notify all inner
// product objects when the value in one of its vectors changed and when
// vectors are created and destroyed.
    
////////////////
// Vector Set //
////////////////

// Vector ID assignment

var vectorIdCounter = 1025; // Number of IDs already assigned

function nextVectorId()
{
    return "" + (++vectorIdCounter);
}

// The VectorSet object has the following structure:
// componentIndex -  For each component, this Map object holds a Map object
//                   with a list of vectors where the component has
//                   a non-zero value.
//                   Under each entry (for each vector) it stores the object
//                   representing the corresponding value in the vector array.
//                   This object has the form:
//                   {
//                      name: <component name>
//                      value: <value of this component at this vector>
//                      pos: <position of this object in the vector array>
//                   }
//                   There are, therefore, two pointer to this vector
//                   cell: from the vector array and from the component index.
// componentChanges - the list of changes (since the last time the changes
//           were cleared) to the list of components in the component index.
//           The attributes of this table are component names. The value
//           is either "added" or "removed":
//           "added": there was no vector with a non-zero value for this
//                    component but now there is one.
//           "removed": there was a vector with a non-zero value for this
//                      component, but there is no longer such a vector.
// vectors - the array of vectors (attribute: vector ID value: an array) 

// The constructor may be given an optional 'zeroRounding' value, which
// should be a small positive number. If such a number is given, then
// if the ratio between the result of adding two numbers and the
// numbers added is less than 'zeroRounding' (in absolute value) then 
// this is considered an arithmetic error and the result is rounded to zero.
// Zero rounding can be set to zero if there is no need to perform this test. 

function VectorSet(zeroRounding)
{
    this.zeroRounding = (zeroRounding && zeroRounding > 0) ? zeroRounding : 0;
    this.componentIndex = new Map();
    this.componentChanges = {};
    this.vectors = {};         // list of vectors
    this.setSize = 0; // number of vectors in the set
    this.nonZeroSize = 0; // number of non-zero vectors
    this.innerProducts = []; // array of inner product objects for this set
}

// This function removes the component with the given name from the equation
// set. This should only be called when the component is already zero in
// all equations.

VectorSet.prototype.removeComponent = vectorSetRemoveComponent;

function vectorSetRemoveComponent(name)
{
    this.componentIndex.delete(name);
    if(this.componentChanges[name] == "added")
        delete this.componentChanges[name];
    else
        this.componentChanges[name] = "removed";
}

// This function adds the component with the given name to the equation
// set. This should only be called when the component does not exist yet
// and is set to a non-zero value for the first time. It is the responsibility
// of the calling function to make sure this function is properly called.
// The function itself does not check this (for the sake of efficiency).
// The function returns the component's entry in the componentIndex.

VectorSet.prototype.addComponent = vectorSetAddComponent;

function vectorSetAddComponent(name)
{
    var c = new Map();
    this.componentIndex.set(name, c);
    if(this.componentChanges[name] == "removed")
        delete this.componentChanges[name];
    else
        this.componentChanges[name] = "added";

    return c;
}

// return the value of the component with the given name in the given 
// vector.

VectorSet.prototype.getValue = vectorGetValue;

function vectorGetValue(vectorId, name)
{
    var entry;

    if(!(entry = this.componentIndex.get(name)))
        return 0;
    if(!entry.has(vectorId))
        return 0;
    return entry.get(vectorId).value;
}

// Given a vector ID and a component name, this function adds the 
// value given in 'value' to that component in the given vector.
// If 'dontCalcInnerProducts' is set, the function does not update
// the inner products. It is then the responsibility of the caller to do so
// (for example, when two vectors are added, it is better to add their
// inner products directly rather than update the inner product with
// every call to addValue()).

VectorSet.prototype.addValue = vectorAddValue;

function vectorAddValue(vectorId, name, value, dontCalcInnerProducts)
{
    if(value == 0)
        return;

    var componentEntry;

    if(!this.componentIndex.has(name)) {
        componentEntry = this.addComponent(name);
    } else
        componentEntry = this.componentIndex.get(name);

    if(componentEntry.has(vectorId)) {
        var entry = componentEntry.get(vectorId);
        var prevVal = entry.value;

        var newValue = entry.value = entry.value + value;

        if(this.zeroRounding !== 0) {
            // check for zero rounding 
            if(newValue !== 0 &&
               Math.abs(newValue / value) < this.zeroRounding) 
                newValue = 0;
        }

        if(newValue === 0) {
            // delete the entry from the vector
            var vector = this.vectors[vectorId];
            var lastPos = vector.length - 1;
            var pos = entry.pos;
            if(lastPos > entry.pos) {
                entry = vector[pos] = vector[lastPos];
                entry.pos = pos;
            }
            if(!--vector.length)
                --this.nonZeroSize;
            componentEntry.delete(vectorId);
            if(componentEntry.size == 0)
                this.removeComponent(name);
        }
    } else { // set the value to the given value
        var vector = this.vectors[vectorId];
        if(vector.length === 0)
            this.nonZeroSize++; // first non-zero entry about to be added
        var entry = { name: name, value: value, pos: vector.length };
        vector.push(entry);
        componentEntry.set(vectorId, entry); 
    }

    // update the inner products
    if(!dontCalcInnerProducts)
        for(var i = this.innerProducts.length - 1 ; i >= 0 ; --i)
            this.innerProducts[i].addToProducts(this, vectorId, name, value);
}

// Given a vector ID and a component name, this function sets the 
// value given in 'value' as the value of that component in the given vector.
// If 'dontCalcInnerProducts' is set, the function does not update
// the inner products. It is then the responsibility of the caller to do so.
// This function does not assume that the component already exists in the 
// vector set, so if it does not exist, it creates it.

VectorSet.prototype.setValue = vectorSetValue;

function vectorSetValue(vectorId, name, value, dontCalcInnerProducts)
{
    var componentEntry;

    if(!this.componentIndex.has(name)) {
        if(value == 0)
            return;
        componentEntry = this.addComponent(name);
    } else
        componentEntry = this.componentIndex.get(name);

    var diff;

    if(componentEntry.has(vectorId)) {
        if(!dontCalcInnerProducts)
            diff = value - componentEntry.get(vectorId).value;
        if(value == 0) {
            // remove this component from the vector
            var vector = this.vectors[vectorId];
            var entry = componentEntry.get(vectorId);
            var lastPos = vector.length - 1;
            var pos = entry.pos;
            if(lastPos > entry.pos) {
                entry = vector[pos] = vector[lastPos];
                entry.pos = pos;
            }
            if(!--vector.length)
                --this.nonZeroSize;
            componentEntry.delete(vectorId);
            if(componentEntry.size == 0)
                this.removeComponent(name);
        } else {
            // update the value
            componentEntry.get(vectorId).value = value;
        }
    } else {
        if(value == 0)
            return;
        diff = value;
        var vector = this.vectors[vectorId];
        if(vector.length === 0)
            this.nonZeroSize++; // first non-zero entry about to be added
        var entry = { name: name, value: value, pos: vector.length };
        vector.push(entry);
        componentEntry.set(vectorId, entry);
    }

    // update the inner products
    if(!dontCalcInnerProducts)
        for(var i = this.innerProducts.length - 1 ; i >= 0 ; --i)
            this.innerProducts[i].addToProducts(this, vectorId, name, diff);
}

// This function 'transfers' weight from one component of a vector
// to another. The vector is given by 'vectorId'. The 'prevName' and
// 'prevValue' are the name of the component and quantity which need to
// be removed while 'newName' and 'newValue' are the quanitity to be added.
// It may be that either 'prevName' or 'newName' are undefined.
// In this case there is no value to remove or add (respectively).
// It may also be that 'prevName' and 'newName' are the same.

VectorSet.prototype.transferValue = vectorSetTransferValue;

function vectorSetTransferValue(vectorId, prevName, prevValue, newName,
                                newValue)
{
    if(prevName != undefined && newName != prevName)
        this.addValue(vectorId, prevName, -prevValue);

    if(newName === undefined)
        return;

    // add the new Value
    var addedValue = (newName == prevName ? newValue - prevValue : newValue);
    this.addValue(vectorId, newName, addedValue);
}

// This function multiplies the given vector by the given scalar. It also
// updates the inner products, if necessary.

VectorSet.prototype.multiplyVector = vectorSetMultiplyVector;

function vectorSetMultiplyVector(vectorId, scalar)
{
    if(!(vectorId in this.vectors))
        return;

    var vector = this.vectors[vectorId];

    if(vector.length == 0)
        return; // zero vector

    if(scalar == 0) {
        // remove all entries from the vector (but the vector itself is
        // not removed).
        for(var i = 0, l = vector.length ; i < l ; ++i) {
            var name = vector[i].name;
            var componentEntry = this.componentIndex.get(name);
            componentEntry.delete(vectorId);
            if(componentEntry.size == 0)
                this.removeComponent(name);
        }
        --this.nonZeroSize; // vector became zero vector
    } else {
        for(var i = 0, l = vector.length ; i < l ; ++i)
            vector[i].value *= scalar;
    }

    // update the inner products
    for(var i = this.innerProducts.length - 1 ; i >= 0 ; --i)
        this.innerProducts[i].multiplyVector(this, vectorId, scalar);
}

// This function adds a new vector to the list. The input to this function is
// an array of objects of the form { name: <component name>, value: <number> }
// specifying the non-zero components of the vector.
// The ID of the new vector is returned by the function (if no new vector is
// created, undefined is returned).

VectorSet.prototype.newVector = vectorSetNewVector;

function vectorSetNewVector(values)
{
    // create a new array
    var newVector = new Array(values.length);
    var newId = nextVectorId();
    this.vectors[newId] = newVector;

    // fill the vector with the values given
    for(var i = 0, l = values.length ; i < l ; ++i) {
        var value = values[i];
        var name = value.name;
        var entry = { name: name, value: value.value, pos: i };
        newVector[i] = entry;

        if(!this.componentIndex.has(name)) {
            var componentEntry = this.addComponent(name);
            componentEntry.set(newId, entry);
        } else
            this.componentIndex.get(name).set(newId, entry);
    }

    // increment the set size
    ++this.setSize;
    if(newVector.length > 0)
        this.nonZeroSize++;
    
    // add to the inner products
    for(var i = this.innerProducts.length - 1 ; i >= 0 ; --i)
        this.innerProducts[i].calcInnerProducts(this, newId);
    
    return newId;
}

// This function sets the vector with the given ID to have the given 'values',
// where 'values' is vector of objects of the form 
// { name: <component name>, value: <number> } specifying the non-zero 
// components of the vector. All other components of the vector are set
// to the value 0.
// If a vector with the given ID does not exist, the operation fails and false
// is returned. Otherwise, true is returned.
// If 'diffVector' is not undefined, it should be an array. This function
// then pushes onto this array objects of the form 
// { name: <component name>, value: <number> } indicating the difference 
// between the new vector and the original vector (that is 
// <new vector> - <original vector>).

VectorSet.prototype.setVector = vectorSetSetVector;

function vectorSetSetVector(vectorId, values, diffVector)
{
    var vector = this.vectors[vectorId];

    if(!vector)
        return false;

    var newLength = values.length;
    var length = vector.length;

    if(length === 0) {
        if(newLength !== 0)
            this.nonZeroSize++;
    } else if(newLength === 0)
        this.nonZeroSize--;
    
    for(var i = 0 ; i < newLength ; ++i) {
        var value = values[i];
        var name = value.name;
        var componentEntry;
        if(this.componentIndex.has(name)) {
            componentEntry = this.componentIndex.get(name);
            if(componentEntry.has(vectorId)) {
                var entry = componentEntry.get(vectorId);
                if(diffVector !== undefined) {
                    var diff = value.value - entry.value;
                    if(diff !== 0 && 
                       (this.zeroRounding === 0 || 
                        Math.abs(diff / entry.value) >= this.zeroRounding))
                        diffVector.push({ name: name, value: diff });
                }
                entry.value = value.value;
                // move the entry to the i'th position
                var pos = entry.pos;
                if(pos > i) {
                    var iEntry = vector[pos] = vector[i];
                    iEntry.pos = pos;
                    vector[i] = entry;
                    entry.pos = i;
                }
                // otherwise, pos == i
                continue;
            }
        } else
            componentEntry = this.addComponent(name);
        
        // this is a new component in this vector
        
        if(length > i) { // move the existing entry to the end of the vector
            var entry;
            vector[length] = (entry = vector[i]);
            entry.pos = length;
            length++;
        }
        var entry = { name: name, value: value.value, pos: i };
        vector[i] = entry;
        componentEntry.set(vectorId, entry); 

        if(diffVector !== undefined)
            diffVector.push({ name: name, value: value.value });
    }

    if(length > newLength) {
        // components of the original vector which are not included in 
        // the new vector were moved to the end. Remove them
        for(var i = newLength ; i < length ; ++i) {
            // remove this component
            var name = vector[i].name;
            var componentEntry = this.componentIndex.get(name);
            componentEntry.delete(vectorId);
            if(componentEntry.size == 0)
                this.removeComponent(name);
            if(diffVector !== undefined)
                diffVector.push({ name: name, value: -vector[i].value });
        }
        vector.length = newLength;
    }
    
    // update the inner products
    for(var i = this.innerProducts.length - 1 ; i >= 0 ; --i)
        this.innerProducts[i].calcInnerProducts(this, vectorId);
    
    return true;
}

// The following function removes the given vector from the set. It updates
// the component index wih this change. If the vector does not exist,
// it returns false and true otherwise.

VectorSet.prototype.removeVector = vectorSetRemoveVector;

function vectorSetRemoveVector(vectorId)
{
    var vector = this.vectors[vectorId];

    if(!vector)
        return false;

    if(vector.length !== 0)
        --this.nonZeroSize;

    for(var i = 0, l = vector.length ; i < l ; ++i) {
        
        var name = vector[i].name;

        // remove the vector from the component's index
        var componentEntry = this.componentIndex.get(name);
        componentEntry.delete(vectorId);
        if(componentEntry.size == 0)
            this.removeComponent(name);
    }

    delete this.vectors[vectorId];

    // decrease the set size
    --this.setSize;

    // update the inner product objects
    for(var i = this.innerProducts.length - 1 ; i >= 0 ; --i)
        this.innerProducts[i].removeVector(this, vectorId);
    
    return true;
}

// This function receives a vector ID ('addToId') and either a vector ('toAdd')
// or a second vector ID ('toAddId') and a real number ('scalar') and adds
// the second vector ('toAdd' or the vector with ID 'toAddId'),
// multiplied by the given 'scalar', to the vector with ID 'addToId'.
// The vector with ID 'addToId' has to be
// in the set, otherwise the operation does not take place.
// If 'toAddId' is not undefined, this ID will be used to find the
// corresponding vector (which must be in the vector set) and this
// vector is added, even if 'toAdd' is specified. If 'toAddId' is undefined,
// the 'toAdd' vector is added. In this case, the 'toAdd' vector does not
// need to be a vector in the vector set. The advantage of providing
// the 'toAddId' (rather than providing the 'toAdd' vector directly)
// is that inner products are calculated directly as an operation on the
// previous inner products for the two vectors, rather than updating
// the inner product with every update of value in the 'addTo' vector.
// This is both more efficient and more accurate.
//
// If as a result of this operation a component value becomes zero, this
// is updated in the component index.

VectorSet.prototype.addToVector = vectorSetAddToVector;

function vectorSetAddToVector(addToId, toAdd, toAddId, scalar)
{
    if(addToId == undefined)
        return;
    
    if(toAddId != undefined)
        toAdd = this.vectors[toAddId];
    
    if(toAdd === undefined || scalar === 0)
        return; // nothing to do

    // loop over the non-zero values of the vector to be added. The inner
    // product is not updated here.
    for(var i = 0, l = toAdd.length ; i < l ; ++i) {
        var value = toAdd[i];
        this.addValue(addToId, value.name, value.value * scalar, 
                      toAddId !== undefined);
    }

    if(toAddId != undefined)
        // update the inner product
        for(var i = this.innerProducts.length - 1 ; i >= 0 ; --i)
            this.innerProducts[i].addVectors(this, addToId, toAddId, scalar);
}

// Given a component name, this function sets the value of this component to
// zero in all vectors. This is more efficient than setting the value to
// zero in each vector separately.

VectorSet.prototype.setToZeroInAllVectors =
    vectorSetSetToZeroInAllVectors;

function vectorSetSetToZeroInAllVectors(name)
{
    if(!this.componentIndex.has(name))
        return; // does not appear in any vector
    
    var vectors = this.componentIndex.get(name);

    var _self = this;
    
    vectors.forEach(function(entry, vectorId) {

        for(var i = _self.innerProducts.length - 1 ; i >= 0 ; --i)
            _self.innerProducts[i].addToProducts(_self, vectorId, name,
                                                 -entry.value);

        // remove the entry from the vector, by replacing it with the 
        // last entry (unless it is itself the last entry) and make the
        // vector shorter.
        var vector = _self.vectors[vectorId];
        var last = vector.length - 1;
        if(entry.pos < last) {
            var lastEntry = (vector[entry.pos] = vector[last]);
            lastEntry.pos = entry.pos;
        }
        if(!--vector.length)
            --_self.nonZeroSize;
    });

    this.removeComponent(name);
}

//
// Merge vector sets
//

// The following function merges the given vector set into 'this' vector set.
// The input vector set remains unchanged.
// For each vector in the input set, a new vector is created in 'this' set. 
// This function does not copy the inner product objects from the merged
// vector set to this vector set.

VectorSet.prototype.merge = vectorSetMerge;

function vectorSetMerge(vectorSet)
{
    if(!vectorSet)
        return;

    // add the new vectors
    for(var id in vectorSet.vectors)
        this.newVector(vectorSet.vectors[id]);
}

// This function returns a vector set which is a duplicate of 'this'
// vector set. The vectors are assigned new IDs.
// The new vector set is created without the inner products of
// the original vector set (these need to be registered separately).

VectorSet.prototype.duplicate = vectorSetDuplicate;

function vectorSetDuplicate()
{
    var newSet = new VectorSet(this.zeroRounding);

    // copy the vectors, assigning them new IDs
    for(var id in this.vectors)
        newSet.newVector(this.vectors[id]);

    return newSet;
}

//
// Inner product functions
//

// This function registers the given inner product object

VectorSet.prototype.registerInnerProducts = vectorSetRegisterInnerProducts;

function vectorSetRegisterInnerProducts(innerProducts)
{
    if(!innerProducts)
        return;
    
    this.innerProducts.push(innerProducts);
}

// This function de-registers the given inner products object

VectorSet.prototype.deregisterInnerProducts = vectorSetDeregisterInnerProducts;

function vectorSetDeregisterInnerProducts(innerProducts)
{
    if(!innerProducts)
        return;

    for(var i = this.innerProducts.length - 1 ; i >= 0 ; --i)
        if(this.innerProducts[i] == innerProducts) {
            this.innerProducts.splice(i, 1);
            break;
        }
}

//
// Component changes
//

// Clear the list of component changes

VectorSet.prototype.clearComponentChanges = vectorSetClearComponentChanges;

function vectorSetClearComponentChanges()
{
    this.componentChanges = {};
}
