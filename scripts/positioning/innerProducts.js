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
// vectors in two vector sets, where one is considered to be the dual of
// the other. This object has several functions which allow
// the vector sets to update the inner products when the value of some
// component of some vector changes.

// Only inner products which are not zero are stored in the 'innerProducts'
// list of this object. This allows a quick lookup of those vector pairs with a
// non-zero inner product.

// The constructor may be given an optional 'zeroRounding' value, which
// should be a small positive number. If such a number is given, then
// when modifying the inner product by adding to it, if the ratio between 
// the result of adding the two numbers and the numbers added is less than 
// 'zeroRounding' (in absolute value) then this is considered an arithmetic 
// error and the result is rounded to zero.

function InnerProducts(vectorSet, dualSet, zeroRounding)
{
    this.zeroRounding = (zeroRounding && zeroRounding > 0) ? zeroRounding : 0;
    
    if(!vectorSet || !dualSet)
        return;
    
    // pointers to the vector sets
    this.vectorSet = vectorSet;
    this.dualSet = dualSet;
    
    // this table stores under the path <dual vector ID> <vector ID>
    // the inner product between the dual vector with the given ID and
    // the vector in the vector set with the given ID. 
    this.innerProducts = {};
    
    // register this inner product object on both vector sets
    this.vectorSet.registerInnerProducts(this);
    this.dualSet.registerInnerProducts(this);
    
    // Initialize an entry for every dual vector
    for(var dualId in this.dualSet.vectors)
        this.innerProducts[dualId] = {};
    
    // Initialize the inner products for vectors which are already in the sets
    // (it is enough to loop on one set, as inner product calculation loops
    // over the other set)
    for(var id in this.vectorSet.vectors)
        this.calcInnerProducts(this.vectorSet, id);
}

// The following function is called when a value in one of the vectors in
// one of the sets associated with this inner product object is modified.
// The input to the function includes a pointer to the vector set containing
// the vector, the id of the vector changed, the name of the component
// changed and the amount by which the value was increased.
// The function assumes that the inner product entries were up to date before
// this last change (if not defined, the inner product is zero).
// This function provides the same interface as in the class InnerProductsVec
// so that the vector set does not need to be aware whether its inner products
// are calculated with a dual set or a single dual vector.

InnerProducts.prototype.addToProducts = innerProductsAddToProducts;

function innerProductsAddToProducts(vectorSet, vecId, name, diff)
{
    if(vectorSet == this.vectorSet) {
        
        var duals = this.dualSet.componentIndex.get(name);
        var _self = this;
        
        duals.forEach(function(dualEntry, dualId) {
            
            var toAdd = dualEntry.value;
            var innerProducts = _self.innerProducts[dualId];
            var value;
            
            if(!(vecId in innerProducts))
                value = innerProducts[vecId] = toAdd * diff;
            else {
                var prevValue = innerProducts[vecId];
                value = prevValue + toAdd * diff;
                if(value && Math.abs(value / prevValue) < _self.zeroRounding)
                    value = 0;
                if(value)
                    innerProducts[vecId] = value;
            }
            
            if(!value)
                delete innerProducts[vecId];
        });
    } else if(vectorSet == this.dualSet) {

        var entries = this.vectorSet.componentIndex.get(name);
        var innerProducts = this.innerProducts[vecId];
        var _self = this;
        
        entries.forEach(function(entry,id) {
            
            var value;
            var toAdd = entry.value;
            
            if(!(id in innerProducts))
                value = innerProducts[id] = toAdd * diff;
            else {
                var prevValue = innerProducts[id];
                value = prevValue + toAdd * diff;
                if(value && 
                   Math.abs(value / prevValue) < _self.zeroRounding)
                    value = 0;
                if(value)
                    innerProducts[id] = value;
            }
            
            if(!value)
                delete innerProducts[id];
        });
    }
    // otherwise, this vector does not belong to this inner product
    // (this should not happen and is ignored here).
}

// This function (re-)caluclates the inner product for the given vector.
// The input to the function includes a pointer to the vector set containing
// the vector and the id of the vector.
// This function provides the same interface as in the class InnerProductsVec
// so that the vector set does not need to be aware whether its inner products
// are calculated with a dual set or a single dual vector.

InnerProducts.prototype.calcInnerProducts = innerProductsCalcInnerProducts;

function innerProductsCalcInnerProducts(vectorSet, vecId)
{
    vector = vectorSet.vectors[vecId];

    if(!vector)
        return; // the given vector does not exist
    
    // first, initialize the inner product entries for this vector
    this.initInnerProducts(vectorSet, vecId);

    // caluclate the inner products
    for(var i = 0, l = vector.length ; i < l ; ++i) {
        var entry = vector[i];
        this.addToProducts(vectorSet, vecId, entry.name, entry.value);
    }
}

// This function initializes the inner product entries for the given vector
// in the given vector set. All entries are initialized to zero.
// Since zero entries are not stored, this function deletes any inner product
// value already stored.

InnerProducts.prototype.initInnerProducts = innerProductsInitInnerProducts;

function innerProductsInitInnerProducts(vectorSet, vecId)
{
    if(vectorSet == this.vectorSet) {
        for(var dualId in this.dualSet.vectors) {
            if(!this.innerProducts[dualId])
                this.innerProducts[dualId] = {};
            else
                delete this.innerProducts[dualId][vecId];
        }
    } else if(vectorSet == this.dualSet)
        this.innerProducts[vecId] = {};
}

// This function should be called when a multiple ('scalar') of one vector
// ('toAddId') in the given set has just been added to another vector
// ('addToId') in the same set. The function updates the inner products
// accordingly
// This function provides the same interface as in the class InnerProductsVec
// so that the vector set does not need to be aware whether its inner products
// are calculated with a dual set or a single dual vector.

InnerProducts.prototype.addVectors = innerProductsAddVectors;

function innerProductsAddVectors(vectorSet, addToId, toAddId, scalar)
{
    if(!scalar)
        return;
    
    if(vectorSet == this.vectorSet) {

        for(var dualId in this.innerProducts) {

            var value;
            var innerProducts = this.innerProducts[dualId];

            if(!(toAddId in innerProducts))
                continue;

            if(!(addToId in innerProducts)) {
                value = innerProducts[addToId] =
                    scalar * innerProducts[toAddId];
            } else {
                var prevValue = innerProducts[addToId];
                value = prevValue + scalar * innerProducts[toAddId];
                if(value && Math.abs(value / prevValue) < this.zeroRounding)
                    value = 0;
                else if(value)
                    innerProducts[addToId] = value;
            }
            
            if(!value)
                delete innerProducts[addToId];
            
        }
    } else if(vectorSet == this.dualSet) {
        
        var toAddInnerProducts = this.innerProducts[toAddId];
        var addToInnerProducts = this.innerProducts[addToId];

        for(var id in this.vectorSet.vectors) {
            
            var value;
            
            if(!(id in toAddInnerProducts))
                continue;
            
            if(!addToInnerProducts[id])
                value = addToInnerProducts[id] =
                    scalar * toAddInnerProducts[id];
            else {
                var prevValue = addToInnerProducts[id];
                value = prevValue + scalar * toAddInnerProducts[id];
                if(value && Math.abs(value / prevValue) < this.zeroRounding)
                    value = 0;
                else if(value)
                    addToInnerProducts[id] = value;
            }
            
            // delete a zero value
            if(!value)
                delete addToInnerProducts[id];
        }
    }
}

// This function removes the given vector in the given vector set from
// the set of vectors for which inner products are being calculated.
// This function provides the same interface as in the class InnerProductsVec
// so that the vector set does not need to be aware whether its inner products
// are calculated with a dual set or a single dual vector.

InnerProducts.prototype.removeVector = innerProductsRemoveVector;

function innerProductsRemoveVector(vectorSet, vecId)
{
    if(vectorSet == this.vectorSet) {
        for(var dualId in this.innerProducts)
            delete this.innerProducts[dualId][vecId];
    } else if(vectorSet == this.dualSet)
        delete this.innerProducts[vecId];
}

// This function sets the inner product for the given vectors to zero.
// 'vecId' should be the ID of a vector in the vector set and 'dualId'
// should the ID of a vector in the dual set. 
// This should only be used when it is known that the inner product should
// have been zero but due to a fixed point arithmetic error the value
// is only a close approximation of zero.

InnerProducts.prototype.setToZero = innerProductsSetToZero;

function innerProductsSetToZero(vecId, dualId)
{
    if(!(dualId in this.innerProducts))
        return; // nothing to remove

    delete this.innerProducts[dualId][vecId];
}

// This function multiplies by a scalar all the inner products of
// the given vector (which is in the given vector set).
// This function provides the same interface as in the class InnerProductsVec
// so that the vector set does not need to be aware whether its inner products
// are calculated with a dual set or a single dual vector.

InnerProducts.prototype.multiplyVector = innerProductsMultiplyVector;

function innerProductsMultiplyVector(vectorSet, vecId, scalar)
{
    if(vectorSet == this.vectorSet) {
        for(var dualId in this.innerProducts) {
            if(scalar)
                this.innerProducts[dualId][vecId] *= scalar;
            else
                delete this.innerProducts[dualId][vecId];
        }
    } else if(vectorSet == this.dualSet) {
        
        var innerProducts = this.innerProducts[vecId];

        for(var id in innerProducts) {
            if(scalar)
                innerProducts[id] *= scalar;
            else
                delete innerProducts[id];
        }
    }
}
