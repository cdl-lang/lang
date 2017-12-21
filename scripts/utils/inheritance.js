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


// This file provides a simple mechanism for allowing one class to inherit from
// another.
//
//
// Members of A that are not defined in B will be copied to B's prototype,
//  so that they can be used directly: A.aMemberFunc() -> B.aMemberFunc()
//
// All members of A are also copied to B with a prefix of 'A_', like
//  this: A.aMemberFunc() -> B.A_aMemberFunc()
//
// As hinted above, the base constructor is also copied to the derived
//  class with the base name: A.constructor -> B.A

// some of this was inspired by http://mckoss.com/jscript/object.htm
// some more from http://www.golimojo.com/etc/js-subclass.html

// don't derive the same couple "<base>::<derived>" twice
var copiedPrototypeHash = {};

function getConstructorName(constructor) {
    function getFnName(fn) {
        var f = typeof fn == 'function';
        var s = f && ((fn.name && ['', fn.name]) ||
                      fn.toString().match(/function ([^\(]+)/));
        return (!f && 'not a function') || (s && s[1] || 'anonymous');
    }

    if (constructor.name === undefined) {
        return getFnName(constructor);
    } else {
        return constructor.name;
    }
}

function inherit(derived, base) {

    var baseConst;
    var baseName;

    var baseMemberName;

    baseName = getConstructorName(base.prototype.constructor);
    var derivedName = getConstructorName(derived.prototype.constructor);
    var hashStr = baseName + "::" + derivedName;

    // was this already done?
    if (hashStr in copiedPrototypeHash) {
        return;
    }
    copiedPrototypeHash[hashStr] = true;

    function BaseConstructor(){}
    BaseConstructor.prototype = base.prototype;
    var derivedPrototype = new BaseConstructor();
    derivedPrototype.constructor = derived;

    var derivedPrototypeCopy = derived.prototype;
    derived.prototype = derivedPrototype;

    var f;
    for (f in derivedPrototypeCopy) {
        derived.prototype[f] = derivedPrototypeCopy[f];
    }


    // derived may well have not been initialized yet, so we're not sure which
    //  methods it will eventually override; hence, we can no longer copy only
    //  the methods that were overridden, but rather must copy all
    // (in the past, prototype copying was executed after reading all javascript
    //  so that only the methods that were actually overridden could be
    //  copied)
    for (f in base.prototype) {
        // copy overridden method 'mthd' to derived.base_mthd()
        baseMemberName = baseName + '_' + f;
        derived.prototype[baseMemberName] = base.prototype[f];
    }
    derived.prototype[baseName] = base.prototype.constructor;
}
