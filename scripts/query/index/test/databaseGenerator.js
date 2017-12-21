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


// The functions in this file can be used to generate a random database
// based on a template.

// The database is generated in moon format, so that it can be loaded
// into the content system.

// Define the template (as described below) in the following variable.
// Then run this file in node.js. The resulting database will be printed
// out (in moon format) to the standard output.

// For example, the following definition would generate an ordered set
// of 9 elements with each an object of the form { a: <number> } with
// the numbers distributed according to the given distribution (see below):
//
// var template = O(9, { a: D([1,5,0.5])});

var template = O(2000, 
                 {
                     name: D(["uniqueString"]),
                     price: D([[0.1, "a fortune"],
                               [0.5, 
                                {
                                    members: {
                                        cash: D([60,95, 5]), 
                                        points: D([100, 1000, 100])
                                    },
                                    nonMembers: {
                                        cash: D([90,125, 5]), 
                                        payments: D([1,5,1])
                                    }
                                }
                               ],
                               [0.5, D([80,115, 5])]]),
                     weight: D([3,6, 0.25]),
                     batteryLife: D([[0.1,1], [0.1,3], [0.2,6], [0.3,6.5], 
                                     [0.1,7]]),
                     vendor: D([[0.25, "Sony"],[0.35, "Samsung"],[0.1, "LG"],
                                [0.3, "HP"]]) 
                 });

// Templates
// ---------
//
// A template describes the elements in the database being
// generated. All elements in this database will have the structure
// specified by the template. The most basic template is simply an
// attribute-value object such as:
// {
//    a: 4,
//    b: {
//       c: "something"
//    }
// }
//
// Such a template will generate the same element over and over again.
// To allow for elements to differ, a template can also have alternatives
// defined for a node, with a distribution on these alternatives. When
// generating an element, such a node will generate an element based on
// the given distribution. The following distributions are currently supported:
//
// [<from>, <to>, <step>]: with all three arguments numbers, will generate
//    a number uniformly in the given range, with the given step size (that is,
//    [2, 5, 0.4] will generate numbers in the set { 2, 2.4, 2.8,
//    3.2, 3.6, 4.0, 4.4, 4.8 } with equal probabilities. If step is omitted,
//    a continuous range is generated.
// [[<prob>, <value>], [<prob>, <value>], ....]: this will generate a
//    discrete distribution of the values given. The probabilities are
//    normalized, so that they sum to 1.
// ["uniqueString"]: will generate a new string every time called (without
//    repetitions).
//
// At every point in the template, it is possible to indicate a distribution
// of the possibilities under that node by using the D(<distribution>)
// function. This function takes a distribution as its argument and will
// generate objects with the distribution defined. In case of a discrete
// distributions, the values appearing in the distribution may be any
// template, which allows for recursive generation of alternatives.
//
// For example:
//
// {
//    name: D(["uniqueString"]),
//    quantity: D([4, 7, 1]),
//    price: D([[0.5, { withVAT: D([10,20,0.01]) }],
//              [0.5, { withoutVAT: D([8,15,0.01]) }]])
// }
//
// This template generates a list of elements with different names and
// a 'quantity' which is a whole number distributed uniformly between
// 4 and 7. The price field can take the form of either { withVAT: <number> }
// or { withoutVAT: <number> } (with equal probabilities). For each
// option, a different range of prices is possible.
//
// Another example:
//
// {
//    name: D(["uniqueString"]),
//    quantity: D([4, 7, 1]),
//    price: D([[0.1, undefined], [0.9, D([8,15,0.01])]])
// }
//
// In this example, there is a probability of 0.1 that the price will
// be undefined and a probability of 0.9 that the price will be generated
// uniformly between 8 and 15.
//
// To output o() structures, the O() can be used in the template.
// This template function can be used in two formats:
//
// O([<template 1>,...,<template n>])
// O(<length or length distribution>, <template>)
//
// The first format simply creates an o(...) expression of the given length
// using the template specified for each position in the array.
// In the second format, the first argument defines the length of the array -
// this can either be a number or a distribution which generates a number.
// Each of the elements in the array is then generated based on the
// template given as the second argument of O(). Note that this is
// treated as a single template for all elements in the ordered set,
// so that the distribution "uniqueString", for example, will generate
// a unique string without repeating the string even among different
// elements of the ordered set.

// default line length in output files
var standardLineLength = 80;
var singleIndent = 4; // number of spaces in single indentation

////////////////////
// Template Nodes //
////////////////////

// A template node is an object with a next() function such that each
// time it is called, it generates an object in the format specified
// by the template. The exact format of the output of the next() function
// can be set by its argument(s). The first argument must be the format name
// and subsequent argument are given depending on the format. Currently,
// the following formats are supported:
// 1. "print": this format outputs the structure as a string which is
//    suitable for dumping into a file (in JSON format) later to be read
//    as input by the application.
//    The second argument to the "next" function is the indentation at which
//    the output should be produced (default zero), the third argument
//    is the length of the first line (which should not be indented) and
//    the fourth argument is the length of all other lines, which
//    should be indented.
// 2. "value": this returns the value,as is. Attribute-values are
//    JS objects, O() is an array, strings are strings and numbers are
//    numbers.
//
// There is one generic TemplateNode class which stores under it an
// object implementing the specific template node being created.

// This function is the generic template node generator. It is given as
// input an object which describes a template and may already have
// some template nodes embedded in it (e.g. something like
// { a: <template node>, b: <template node> }) and it creates a template node
// which matches the description. The input object may also already
// be a template node, in which case this function returns it as is.

function createTemplate(description)
{
    if(typeof(description) == "object") {
        if(description instanceof DiscreteDistribution)
            // description is already an implementation of a template
            return new TemplateNode(description);
        if(isNumericDistribution(description))
            return new TemplateNode(new SimpleValueTemplateNode(description));
        if(typeof(description.isTemplateNode) == "function" &&
           description.isTemplateNode())
            return description; // the description is already a template node
        if(isTemplateImplementationNode(description))
            return new TemplateNode(description);
        return new TemplateNode(new AttributeValueTemplateNode(description));
    } else { // simple value
        return new TemplateNode(new SimpleValueTemplateNode(description));
    }
}

// The constructor of the TemplateNode simply takes an object implementing
// the template node and stores it (it is just a wrapping)

function TemplateNode(templateNodeImplementation)
{
    this.implementation = templateNodeImplementation;
}

TemplateNode.prototype.isTemplateNode = templateNodeIsTemplateNode;

function templateNodeIsTemplateNode()
{
    return true;
}

TemplateNode.prototype.next = templateNodeNext;

function templateNodeNext()
{
    return this.implementation.next.apply(this.implementation, arguments);
}

// This is the implementation of a template node which stores attribute-value
// structures. It receives as input an attribute value structure.

function AttributeValueTemplateNode(description)
{
    this.template = {};

    // copy the input description and generate the sub-template-nodes

    for(var attr in description)
        this.template[attr] = createTemplate(description[attr]);
}

AttributeValueTemplateNode.prototype.next =
    attributeValueTemplateNodeNext;

function attributeValueTemplateNodeNext(format)
{
    if(format == "print") {
        var indent = arguments[1] ? arguments[1] : 0;
        var firstLineLength = arguments[2] ? arguments[2] : standardLineLength;
        var lineLength = arguments[3] ? arguments[3] : standardLineLength;
        
        var indentStr = makeIndentString(indent);
        var subIndent = indent + singleIndent;
        var subIndentStr = makeIndentString(subIndent);
         
        var output = "{";
        var first = true;

        for(var attr in this.template) {
            if(first)
                first = false;
            else
                output += ",";

            output += "\n" + subIndentStr + attr + ": ";
            output += this.template[attr].next("print", subIndent,
                                               lineLength - indent -
                                               (attr.length + 2),
                                               lineLength);
        }
        output += "\n" + indentStr + "}";

        return output;
        
    } else if(format == "value") {

        var newObj = {};
        
        for(var attr in this.template)
            newObj[attr] = this.template[attr].next("value");

        return newObj;
    } else
        return undefined; // no other format supported
}

// This is the implementation of a template node which stores simple values
// (number, string, boolean, etc.) or distributions of such values.
// It receives as input either a simple value or a Distribution object
// which generates such simple values.

function SimpleValueTemplateNode(description)
{
    if(isNumericDistribution(description))
        this.distribution = description;
    else
        this.value = description;
}

SimpleValueTemplateNode.prototype.next =
    simpleValueTemplateNodeNext;

function simpleValueTemplateNodeNext(format)
{
    var nextValue = this.distribution ? this.distribution.next() : this.value;
    
    if(format == "print") {
        if(typeof(nextValue) == "string")
            return "\"" + nextValue + "\"";
        return "" + nextValue;
    } else
        return nextValue;
}

// The array template node implements an array of nodes. It can take two
// types of inputs:
// 1  A single array of template descriptions.
// 2. Two arguments: the first is a number or a numeric distribution and
//    the second is a single template description. This generates
//    an array of the given length with elements all generated from the
//    same template node.

function ArrayTemplateNode()
{
    if(arguments.length == 2) {
        if(typeof(arguments[0]) != "number" &&
           !isNumericDistribution(arguments[0])) {
            this.length = 0;
            errorMsg("does not define length: ", objToString(arguments[0]));
        } else
            this.length = arguments[0];
        this.template = createTemplate(arguments[1]);
    } else if(arguments.length == 1) {
        this.templates = [];

        for(var i in arguments[0])
            this.templates[i] = createTemplate(arguments[0][i]);
    }
}

ArrayTemplateNode.prototype.next = ArrayTemplateNodeNext;

function ArrayTemplateNodeNext(format)
{
    // create a temporary array of template nodes (some may be identical)

    var templateNodes = [];

    if(this.templates) {
        for(var i in this.templates)
            templateNodes[i] = this.templates[i];
    } else if(this.length && this.template) {
        var length = (typeof(this.length) == "number") ?
            this.length : this.length.next("value");

        for(var i = 0 ; i < length ; i++) {
            templateNodes[i] = this.template; // the same template
        }
    }
    
    if(format == "print") {

        var indent = arguments[1] ? arguments[1] : 0;
        var firstLineLength = arguments[2] ? arguments[2] : standardLineLength;
        var lineLength = arguments[3] ? arguments[3] : standardLineLength;
        
        var indentStr = makeIndentString(indent);
        var subIndent = indent + singleIndent;
        var subIndentStr = makeIndentString(subIndent);
        
        var output = "o(";
        
        for(var i = 0 ; i < templateNodes.length ; i++) {
            output += "\n" + subIndentStr;
            output += templateNodes[i].next("print", subIndent,
                                            lineLength - subIndent,
                                            lineLength);
            if(i < templateNodes.length - 1)
                output += ",";
        }
        output += templateNodes.length ? ("\n" + indentStr + ")") : ")";

        return output;
        
    } else if(format == "value") {
        var array = [];

        for(var i = 0 ; i < templateNodes.length ; i++)
            array[i] = templateNodes[i].next("value");

        return array;
        
    } else
        return undefined;
}

// This function returns a Distribution node. It may be a distribution of
// one of several classes. These may be used differently by different
// template nodes (a discrete distribution returns a templeat node while
// anumeric distribution returns a number).

function D(distribution)
{
    // return the actual distribution implementation

    if(!isArray(distribution) || !distribution.length) {
        errorMsg("unknown distribution format: ", objToString(distribution));
        return undefined;
    }

    if(isArray(distribution[0]))
        return new DiscreteDistribution(distribution);
    if(distribution[0] == "uniqueString")
        return new UniqueStringDistribution(distribution);
    if(typeof(distribution[0]) == "number")
        return new UniformNumDistribution(distribution);
    
    errorMsg("unknown distribution format: ", objToString(distribution));

    return undefined;
}

// This function creates an array template node

function O()
{
    if(arguments.length == 1)
        return new ArrayTemplateNode(arguments[0]);
    else if(arguments.length == 2)
        return new ArrayTemplateNode(arguments[0], arguments[1]);
    else {
        errorMsg("unknown array format: ", objToString(distribution));
        return undefined;
    }
}

///////////////////
// Distributions //
///////////////////

//
// Specific Distributions
//

// discrete distribution

// The discrete distribution is a template node implementation.

function DiscreteDistribution(distribution)
{
    // the cummulative distribution of all values up to and including
    // the value at this position
    this.cummulativeProb = [];
    // the templates to be returned with the given distribution
    this.subTemplates = [];

    var totalProb = 0;
    
    for(var i in distribution) {
        if(!isArray(distribution[i])) {
            errorMsg("not a valid discrete distribution point: ",
                     objToString(distribution[i]));
            continue;
        }
        var prob = distribution[i][0];
        var template = createTemplate(distribution[i][1]);

        if(typeof(prob) !=  "number" || prob < 0) {
            errorMsg("not a valid probability: ", prob);
            prob = 0;
        }

        totalProb += prob;
        this.cummulativeProb.push(totalProb);
        this.subTemplates.push(template);
    }

    // normalize

    if(totalProb > 0) {
        for(var i in this.cummulativeProb)
            this.cummulativeProb[i] = this.cummulativeProb[i] / totalProb;
    }
}

// This function generates the next element in the sample. To do so, it
// first generates a random number between 0 and 1, finds the first
// position in cummulativeProb which has a probability greater or equal
// to the generated number and then generates the next element from the
// corresponding template.
// This is a template node implementation, so it must pass the format
// argument to the template nodes it stores under it.

DiscreteDistribution.prototype.next = discreteDistributionNext;

function discreteDistributionNext()
{
    if(!this.subTemplates.length)
        return undefined;
    
    var val = Math.random();

    for(var i in this.cummulativeProb) {
        if(val <= this.cummulativeProb[i]) {
            // this is the selected item
            return this.subTemplates[i].next.apply(this.subTemplates[i],
                                                   arguments);
        }
    }

    // not found, return the last element
    var subTemplate = this.subTemplates[this.subTemplates.length-1];
    
    return subTemplate.next.apply(subTemplate, arguments);
}

//
// Unique String Distribution
//

// To make the strings somewhat easier to read, they are composed of
// alternating consonants and vowels (beginning and ending with a consonant).
// At each step, the distribution generates the next string (in alphabetic
// order) which follows this simple rule.

function UniqueStringDistribution(distribution)
{
    this.syllables = []; // last string returned, broken into syllables
}

UniqueStringDistribution.prototype.nextVowel = {
    a: "e",
    e: "i",
    i: "o",
    o: "u",
    u: "y",
    y: undefined
};

UniqueStringDistribution.prototype.firstVowel = "a";

// Receives a string holding a single letter as input. Returns the consonant
// following the given letter. Returns "b" for an undefined input and
// undefined if the input was "z".

UniqueStringDistribution.prototype.nextConsonant =
    uniqueStringDistributionNextConsonant;

function uniqueStringDistributionNextConsonant(consonant)
{
    if(!consonant)
        return "b";
    
    if(consonant == "z")
        return undefined;
    while(1) {
        consonant = String.fromCharCode(consonant.charCodeAt(0)+1);

        if(!(consonant in this.nextVowel))
            return consonant;
    }
}

// Given a string containing a single syllable
// (<consonant> <vowel> <consonant>) this function returns the next syllable.
// undefined is returned if the syllable is the last one. An undefined
// input results in the first syllable ("bab") being returned.

UniqueStringDistribution.prototype.nextSyllable =
    uniqueStringDistributionNextSyllable;

function uniqueStringDistributionNextSyllable(syllable)
{
    if(!syllable)
        return this.nextConsonant() + this.firstVowel + this.nextConsonant();

    var c = this.nextConsonant(syllable[2]);

    if(c)
        return syllable[0] + syllable[1] + c;

    c = this.nextVowel[syllable[1]];

    if(c)
        return syllable[0] + c + this.nextConsonant();

    var c = this.nextConsonant(syllable[0]);

    if(!c)
        return undefined;

    return c + this.firstVowel + this.nextConsonant();
}

// To generate the next string, advance the last syllable. If this
// has reached the last possible value, advance the previous syllable, etc.
// If it is no longer possible to advance any syllable, add a syllable
// to the word.

UniqueStringDistribution.prototype.next = uniqueStringDistributionNext;

function uniqueStringDistributionNext()
{
    var result = "";
    advanced = false;
    
    for(var i = this.syllables.length - 1 ; i >= 0 ; i--) {

        if(!advanced) {
            var syllable = this.nextSyllable(this.syllables[i]);

            if(syllable)
                advanced = true;
            else
                syllable = this.nextSyllable(undefined);
            this.syllables[i] = syllable;
        }
        result = this.syllables[i] + result;
    }

    if(!advanced) {
        var newSyllable = this.nextSyllable(undefined);
        this.syllables.push(newSyllable);
        result = result + newSyllable;
    }

    return result;
}

// This object implements the uniform number generator as defined at the
// top of the file.

function UniformNumDistribution(distribution)
{
    if(!isArray(distribution) || distribution.length < 2 ||
       distribution.length > 3 || typeof(distribution[0]) != "number" ||
       typeof(distribution[1]) != "number" ||
       typeof(distribution[2]) != "number") {
        this.disabled = true;
        errorMsg("not a valid uniform numerical distribution: ",
                 objToString(distribution));
    }

    this.min = distribution[0];
    this.max = distribution[1];
    this.step = distribution[2];

    if(this.min > this.max || this.step < 0) {
        this.disabled = true;
        errorMsg("incorrectly defined uniform numerical distribution: ",
                 objToString(distribution));
        return;
    }

    // numSteps is the number of possible values in the distribution,
    // (one needs to randomly generate a whole number in the
    // range [0,numStep)).
    this.numSteps = this.step ? 
        Math.floor((this.max-this.min) / this.step) + 1 : Infinity;
}

UniformNumDistribution.prototype.next = uniformNumDistributionNext;

function uniformNumDistributionNext()
{
    if(this.disabled)
        return undefined;

    if(!this.numSteps)
        return this.min;

    if(this.numSteps == Infinity)
        return this.min + (Math.random() * (this.max - this.min));

    return this.min + this.step * Math.floor(Math.random() * this.numSteps) 
}

function isNumericDistribution(obj)
{
    return (obj instanceof UniqueStringDistribution ||
            obj instanceof UniformNumDistribution);
}

function isTemplateImplementationNode(obj)
{
    return (obj instanceof AttributeValueTemplateNode ||
            obj instanceof SimpleValueTemplateNode ||
            obj instanceof ArrayTemplateNode);
}

//
// Distribution generation
//

// Box-Muller transform for generating a normal distribution (copied from
// http://www.protonfish.com/jslib/boxmuller.shtml).

function rnd_bmt() {
    
    var x = 0, y = 0, rds, c;

    // Get two random numbers from -1 to 1.
    // If the radius is zero or greater than 1, throw them out and pick two
    // new ones Rejection sampling throws away about 20% of the pairs.
    do {
    x = Math.random()*2-1;
    y = Math.random()*2-1;
    rds = x*x + y*y;
    }
    while (rds == 0 || rds > 1)

    // This magic is the Box-Muller Transform
    c = Math.sqrt(-2*Math.log(rds)/rds);

    // It always creates a pair of numbers. I'll return them in an array.
    // This function is quite efficient so don't be afraid to throw one away if you don't need both.
    return [x*c, y*c];
}

///////////////////////
// Various Utilities //
///////////////////////

function isArray(obj)
{
    return (obj instanceof Array);
}

function objToString(obj, skipFunctions, depth)
{
    if(!obj || typeof(obj) != "object") {
        return typeof(obj) == "function" ? "<function>" : String(obj);
    }

    if(typeof(depth) != "undefined") {
        if(depth <= 0)
            return isArray(obj) ? "<array>" : "<object>";
        depth--;
    }
    
    var conv;
    
    if(isArray(obj)) {

        conv = "[";
        
        for(var i = 0, len = obj.length ; i < len ; i++) {
            if(i)
                conv += ", ";
            conv += objToString(obj[i], skipFunctions, depth);
        }

        conv += "]";

        return conv;
    }

    conv = "{";
    
    for(var p in obj) {
        if(skipFunctions && typeof(obj[p]) == "function")
            continue;
        conv += (conv.length > 1) ? ", " : " ";
        conv += p + ": " + objToString(obj[p], skipFunctions, depth);
    }
    
    conv += (conv.length > 1) ? " }" : "}";
    
    return conv;
}

function errorMsg()
{
    console.log(arguments);
}

// this function returns a string providing the indentation specified in
// 'indent'.

function makeIndentString(indent)
{
    var indentStr ="";
    
    for(var i = 0 ; i < indent ; i++)
        indentStr += " ";

    return indentStr;
}

var generator = createTemplate(template);
console.log(generator.next("print"));
