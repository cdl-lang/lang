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


// This file implements a special query calculation node which implements
// the 'true' terminal query. This is implemented as n(false) and
// is also constructed that way: the TrueQueryCalc object inherits the
// negation query calculation node and upon construction creates
// a simple query calculation node under it which holds the single value
// 'false'. This object is also responsible for destroying its sub-node
// (the simple query with value false) when it is destroyed.

// %%include%%: "negationQueryCalc.js"

inherit(TrueQueryCalc, NegationQueryCalc);

// The constructor is similar to the constructor of the standard negation
// query calculation node (and most other query calculation nodes) and
// requires as input the root query calculation node to which this
// query calculation node belongs and the path ID at which the query
// should be registered. In addition, it requires a 'valueId' to be
// assigned to the 'false' value under it. This should be allocated in
// the same way as the value IDs for values added to a simple query
// (often, this is based on the dominating element ID).

function TrueQueryCalc(rootQueryCalc, pathId, valueId) 
{
    this.NegationQueryCalc(rootQueryCalc, pathId);

    // create a simple query for the value 'false' and insert it as the
    // only sub-node of this negation query.
    var falseQueryCalc = new SimpleQueryCalc(rootQueryCalc, pathId);
    falseQueryCalc.addValue(valueId, "boolean", false);
    this.addSubNode(falseQueryCalc);
}

// The destroy function is first responsible for destroying the dominated
// 'false' query and then continues with the standard destroy of the
// negation node.

TrueQueryCalc.prototype.destroy = trueQueryCalcDestroy;

function trueQueryCalcDestroy()
{
    // store the sub-node
    var subNode;
    for(var id in this.subNodes)
        subNode = this.subNodes[id];

    this.NegationQueryCalc_destroy();

    subNode.destroy();
}
