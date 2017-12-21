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

// This file implements an object which tracks the inner products between
// vectors in a vector set and a dual vector. The dual vector is 
// represented as an object whose attributes are the component names
// of the non-zero components and the values under these attributes are
// the corresponding values in the vector. Note that this is different from 
// the array representation of a vector in a vector set (which is 
// represented as an array of objects 
// { name: <component name>, value: <number> }).
// This object has several functions which allow the vector set or the
// dual vector to update the inner products when the value of some
// component of some vector changes.

// Many of the functions in this class provide the same interface as the
// equivalent function in the class InnerProducts. This allows vector
// sets to be ignorant of the question whether their inner products
// are calculated with a dual set or a single dual vector.
// As a result, some functions have redundant arguments (such as the pointer
// to the vector set).

// Only inner products which are not zero are stored in the 'innerProducts'
// list of this object (this list stores the inner product for each vector
// in the vector set). This allows a quick lookup of those vectors with a
// non-zero inner product.

// The constructor may be given an optional 'zeroRounding' value, which
// should be a small positive number. If such a number is given, then
// when modifying the inner product by adding to it, if the ratio between 
// the result of adding the two numbers and the numbers added is less than 
// 'zeroRounding' (in absolute value) then this is considered an arithmetic 
// error and the result is rounded to zero.

function VecInnerProducts(vectorSet, dualVector, zeroRounding)
{
    this.zeroRounding = (zeroRounding && zeroRounding > 0) ? zeroRounding : 0;

    if(!vectorSet || !dualVector)
        return;
    
    // pointers to the vector sets
    this.vectorSet = vectorSet;
    this.dualVector = dualVector;
    
    // this table stores under the attribute <vector ID>
    // the inner product between the dual vector and the vector in the vector
    // set with the given ID. 
    this.innerProducts = {};
    
    // register this inner product object on the vector set
    this.vectorSet.registerInnerProducts(this);

    // Initialize the inner products for vectors which are already in the set
    this.calcDualInnerProducts();
}

// The following function is called when a value in one of the vectors in
// the vector set associated with this inner product object is modified.
// The input to the function includes a pointer to the vector set containing
// the vector, the id of the vector changed, the name of the component
// changed and the amount by which the value was increased.
// The function assumes that the inner product entries were already created
// for this vector and were up to date before this last change.
// This function provides the same interface as in the class InnerProducts
// so that the vector set does not need to be aware whether its inner products
// are calculated with a dual set or a single dual vector.

VecInnerProducts.prototype.addToProducts = vecInnerProductsAddToProducts;

function vecInnerProductsAddToProducts(vectorSet, vecId, name, diff)
{
    var value;
    
    if(this.dualVector[name]) {
        
        if(!(vecId in this.innerProducts))
            value = this.innerProducts[vecId] = this.dualVector[name] * diff;
        else {
            var prevValue = this.innerProducts[vecId];
            value = prevValue + this.dualVector[name] * diff;
            if(this.zeroRounding !== 0 && value != 0 &&
               Math.abs(value / prevValue) < this.zeroRounding)
                value = 0;
            else if(value)
                this.innerProducts[vecId] = value;
        }
        
        if(!value)
            delete this.innerProducts[vecId];
    }
}

// The following function should be called when a value in the dual vector
// is modified. The input to the function includes the name of the component
// modified and the amount by which the value was increased.
// The function assumes that the inner product entries were already created
// for this vector and were up to date before this last change.

VecInnerProducts.prototype.addDualToProducts =
    vecInnerProductsAddDualToProducts;

function vecInnerProductsAddDualToProducts(name, diff)
{
    if(!this.vectorSet.componentIndex.has(name))
        return;
    
    var componentIndex = this.vectorSet.componentIndex.get(name);
    
    var _self = this;
    componentIndex.forEach(function(e,vecId) {

        var vectorValue = e.value
        var value;
        
        if(!(vecId in _self.innerProducts))
            value = _self.innerProducts[vecId] = vectorValue * diff;
        else {
            var prevValue = _self.innerProducts[vecId];
            value = prevValue + vectorValue * diff;
            if(_self.zeroRounding !== 0 && value != 0 &&
               Math.abs(value / prevValue) < _self.zeroRounding)
                value = 0;
            else if(value)
                _self.innerProducts[vecId] = value;
        }
        
        if(!value)
            delete _self.innerProducts[vecId];
    });
}

// This function (re-)calculates the inner product for the given vector.
// in the vector set. The input to the function includes a pointer to the
// vector set and the id of the vector.
// This function provides the same interface as in the class InnerProducts
// so that the vector set does not need to know whether its inner products
// are calculated with a dual set or a single dual vector.

VecInnerProducts.prototype.calcInnerProducts =
    vecInnerProductsCalcInnerProducts;

function vecInnerProductsCalcInnerProducts(vectorSet, vecId)
{
    var vector = vectorSet.vectors[vecId];

    if(!vector)
        return; // the given vector does not exist
    
    // calculate the new value of the inner product 

    var value = 0;

    // caluclate the inner products
    for(var i = 0, l = vector.length ; i < l ; ++i) {
        var entry = vector[i];
        var name = entry.name;
        var vecValue = entry.value;

        if(!this.dualVector[name])
            continue;
        var prevValue = value;
        value += this.dualVector[name] * vecValue;

        if(this.zeroRounding !== 0 && value != 0 &&
           Math.abs(value / prevValue) < this.zeroRounding)
            value = 0;  
    }

    // set the inner product value

    if(value !== 0)
        this.innerProducts[vecId] = value;
    else if(vecId in this.innerProducts)
        delete this.innerProducts[vecId];
}

// This function (re-)caluclates the inner products for the dual vector.

VecInnerProducts.prototype.calcDualInnerProducts =
    vecInnerProductsCalcDualInnerProducts;

function vecInnerProductsCalcDualInnerProducts()
{
    // first, clear any existing inner product entries
    this.innerProducts = {};

    // calcualte the inner products
    for(var vecId in this.vectorSet.vectors)
        this.calcInnerProducts(this.vectorSet, vecId);
}

// This function should be called when a multiple ('scalar') of one vector
// ('toAddId') in the vector set has just been added to another vector
// ('addToId') in the vector set. The function updates the inner products
// accordingly.
// This function provides the same interface as in the class InnerProducts
// so that the vector set does not need to be aware whether its inner products
// are calculated with a dual set or a single dual vector.

VecInnerProducts.prototype.addVectors = vecInnerProductsAddVectors;

function vecInnerProductsAddVectors(vectorSet, addToId, toAddId, scalar)
{
    if(!(toAddId in this.innerProducts) || scalar == 0)
        return;

    var value;
    
    if(!(addToId in this.innerProducts))
        value = this.innerProducts[addToId] =
            scalar * this.innerProducts[toAddId];
    else {
        var prevValue = this.innerProducts[addToId];
        value = prevValue + scalar * this.innerProducts[toAddId];
        if(this.zeroRounding != 0 && value != 0 &&
           Math.abs(value / prevValue) < this.zeroRounding)
            value = 0;
        if(value)
            this.innerProducts[addToId] = value;
    }
    
    // delete a zero value
    if(!value)
        delete this.innerProducts[addToId];
}

// This function removes the given vector from the vector set.
// This function provides the same interface as in the class InnerProducts
// so that the vector set does not need to be aware whether its inner products
// are calculated with a dual set or a single dual vector.

VecInnerProducts.prototype.removeVector = vecInnerProductsRemoveVector;

function vecInnerProductsRemoveVector(vectorSet, vecId)
{
    delete this.innerProducts[vecId];
}

// This function sets the inner product for the given vector to zero
// (which means deleting the entry).
// This should only be used when it is known that the inner product should
// have been zero but due to a fixed point arithmetic error the value
// is only a close approximation of zero.

VecInnerProducts.prototype.setToZero = vecInnerProductsSetToZero;

function vecInnerProductsSetToZero(vecId)
{
    delete this.innerProducts[vecId];
}

// This function multiplies by a scalar the inner product of the given vector
// in the vector set.
// This function provides the same interface as in the class ProductsVec
// so that the vector set does not need to be aware whether its inner products
// are calculated with a dual set or a single dual vector.

VecInnerProducts.prototype.multiplyVector = vecInnerProductsMultiplyVector;

function vecInnerProductsMultiplyVector(vectorSet, vecId, scalar)
{
    if(!scalar)
        delete this.innerProducts[vecId];
    else if(vecId in this.innerProducts[vecId])
        this.innerProducts[vecId] *= scalar;
}
