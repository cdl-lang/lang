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


// The modules in this file implement the upgrade of the format of the
// data stored in the database. When reading the entries, they are passed
// through the 'upgradeFormat()' function of the relevant module
// (depending on the resource). If needed, the format is corrected and
// the function outputs a modified object with the corrected format.
// This can then be further used as if it was received from the database. 
// The entries in the database are not modified.

//
// Upgrade of app state format
//

module AppStateFormatUpgrade {

    // this function takes an object retrieved from the database and
    // returns a corrected version on this object in cases where the
    // format of the object found in the database is no longer up to date.
    // The original object is never modified.

    export function upgradeFormat(elementObj: any): any
    {
        if(!elementObj) // empty entry
            return elementObj;
        
        var repairFunctions: Array<(elem: any) => any> = [
            // place here the repair functions
        ];

        if(repairFunctions.length === 0)
            return elementObj;
        
        for(var i = 0, l = repairFunctions.length ; i < l ; ++i)
            elementObj = repairFunctions[i](elementObj);

        return elementObj;
    }
    
}

//
// Upgrade of database metadata format 
//

module MetadataFormatUpgrade {

    // this function takes an object retrieved from the database and
    // returns a corrected version on this object in cases where the
    // format of the object found in the database is no longer up to date.
    // The original object is never modified.
    
    export function upgradeFormat(elementObj: any): any
    {
        if(!elementObj) // empty entry
            return elementObj;
        
        var repairFunctions: Array<(elem: any) => any> = [
            addTopMissingValueType
        ];

        for(var i = 0, l = repairFunctions.length ; i < l ; ++i)
            elementObj = repairFunctions[i](elementObj);

        return elementObj;
    }

    // In older versions of the metadata, the "type: attributeValue"
    // was missing at the top level of the value field. If needed,
    // this is added by this function.
    
    function addTopMissingValueType(elementObj: any): any
    {
        if(!elementObj.value || elementObj.value.type)
            return elementObj;

        var newElementObj = shallowDupObj(elementObj);
        newElementObj.value = {
            type: "attributeValue",
            value: elementObj.value
        };

        return newElementObj;
    }

    // duplicate a single level of the object
    function shallowDupObj(obj: any): any
    {
        var newObj:any = {};
        for(var attr in obj)
            newObj[attr] = obj[attr];
        return newObj;
    }
}