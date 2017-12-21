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


"use strict";

// The object defined in this file is responsible for calculating a 
// compressed value for objects stored in the indexer. This compressed
// value (which is an integer) should be sufficient to determine equality
// of objects: two values or objects are considered equal iff they
// have the same compressed value.
//
// This is also used to compress the data stored in path nodes. Each
// data node (whether terminal or not) is assigned a compressed value
// and only that compressed value needs to be stored. For non-terminal values
// (values with attributes under them) there is, therefore, a distinction
// here between the compressed value of the individual data node and
// the compressed value of the data dominated by that node.
//
// It is the responsibility of the indexer to manage the compression
// of values stored in the indexer. Given a projection path
// (represented by a path ID) and a lowest data element d for the path
// (together defining a unique data node in the indexer), a compressed
// value for that data node can be calculated. For example, if the
// data element is the root of the object { a: 1, b: 3 } and the path
// ID represents the path [a], this returns a compressed value for '1'.
// The value compressed could be a simple value (stored completely
// at the given data node), such as a number, string or range, or it could
// be a compound value stored in the given node and all nodes dominated
// by it. An exception is made for the root path: a compressed value at
// the root path does not change.
//
// Every value which is compressed is first looked up among the existing 
// compressed values. If the value has already been compressed, then
// it has already been assigned a compression value and there is
// nothing to do. If, however, the value has not yet been compressed,
// it is assigned the next available number as its compressed value.
// The process in which it is determined whether a value has already been
// compressed and by which it is assigned a new compressed value is
// described in detail below. 
//
// The compressed values are all strictly positive integers. The value 0
// is reserved for 'unknown' compression values (the compression value
// before enough information is available in order to calculate the
// compressed value).
//
// The compression module is owned by the internal QCM (as it needs 
// to consistently compress values across the QCM).
//
// Compression of Simple Values
// ----------------------------
//
// Simple values are identified by their type (a string) and their
// value (either a string, a boolean or a number, depending on the type).
// The value may then be rounded in a way depending on the type
// (numeric values are rounded according to the required/expected 
// accuracy of their type and string values may be 'rounded' in various
// ways to collapse variant spellings into a single value).
// The pair <type, rounded value> is then looked up in a table of
// the format:
// <Map>{
//    <type>: <Map>{
//        <rounded value>: <compressed value (integer)>
//        ......
//    }
//    .....
// }
// If an entry already exists for this <type, rounded value> then the
// compressed value has been assigned already. Otherwise, the next
// available integer is assigned to the value and a new entry is 
// created in the table.
//
// Compression of Range Values
// ---------------------------
// A range is defined by a pair of simple values, both of which must be of
// the same type. A range always defines which of its two values is the smaller
// value and which is the larger. Compression of range values is then very 
// similar to that of simple values, except that it is based on two
// values instead of one.  Each of the values is first rounded, as in
// the case of simple value compression. The values are then looked up
// in a table of the format:
// {
//     <type>: <Map>{
//         <smaller rounded value>: <Map>{
//              <larger rounded value>: [<compressed values (integers)>]
//              .....
//         }
//         .....
//     }
//     ......
// }
//
// Since ranges can be open or closed on either end, there are potentially
// four different compressed values for each pair of range end point values.
// For this reason, [<compressed values (integers)>] in the table above
// is potentially an array of four elements, with a single position
// (fixed in advanced and the same for all entries) for each combination
// of open/closed ends. Not all four compressed values are created
// at once (but rather, only assigned when needed) but, once assigned,
// a compressed range value is only removed after all ranges with the same
// low and high value are removed (this reduces the amount of administration
// required to trace the reference count of each open/closed end point pair).
//
// If found, the existing compressed value is returned. If not found, the
// next available integer is assigned to the range value and stored in
// the table under the range end-points.
// If the two end points are identical (after rounding), the simple
// compression of that single value is used (that is, the compression
// of the number 15 is the same as that of the range r(15,15)).
//
// Compression of Node Values
// --------------------------
//
// If a data node stores a terminal value, its compressed value is identical
// to the simple compression described above. If the value is not a terminal
// value (e.g. an attribute value) then its node value compression is a
// special integer assigned as the compression of that value. Note that
// a data node may store a terminal value but still have attributes under it
// (thus making it the root of a compound object). The compression of
// the compound object rooted at this node is then different from the
// compression of the data node itself.
//
// Compression of Compound Values
// ------------------------------
// If the value to be compressed has attributes (e.g. an attribute-value
// object, but also terminal values with attributes under them)
// or an ordered set, its compressed value is 
// generated based on the compressed values of its components.
// To ensure that identical objects are assigned the same compressed
// value, the compressed value is calculated based on an ordered
// list of the compressed values of its components. 
//
// Much of the responsbility for calculating the compression
// value of a compound element lies with the CompressedValue
// object, which is allocated for the entry of each compound
// object which needs to be compressed. It is this object which is
// responsible for determining the sequence of elements which are 
// to determine the compressed value of the compound value. The only
// responsibility of the InternalQCMCompression class is to allocate
// the compression values to the sequences.
//
// These sequences are presented as sequences of compressed values (it
// is the responsibility of the CompressedValue object to
// generate this sequence). This object then generates a compression
// value for such a sequence. A sequence v1, v2, ..., vn of
// compression values is converted into a single compression value by
// an incremental method. First, the pair <v1, v2> is assigned a
// compression value V2 (in a manner similar to the assignment of 
// a compression value to a <type, simple value> pair, except that no
// rounding is required). Next, the pair <V2, v3> is assigned a compression
// value V3 and so the process goes on, each time assigning <Vi, vi+1>
// a compression value Vi+1. The value Vn assigned at the last step of
// this process is the compression value of the sequence v1,...,vn.
//
// It should be noted that the InternalQCMCompression is free to make use
// of any of the values V2,...,Vn generated in this process and
// is also free to terminate this process when it has reached the conclusion
// that the compression of a prefix of the sequence is sufficient. 
//
// Quick Compression of Compound Values
// ------------------------------------
// The CompressedValue object also implements a 'quick' compression for
// compound values. This compression is not guaranteed to be unique,
// but is highly likely to be so. It uses the same sequence v1,...,vn of
// compressed values which is used for the full compression of the object.
// However, instead of ordering this sequence and then compressing it in 
// the manner described above, it xor's the numbers in the sequence and
// then compresses the pair <n, xor(v1,..,vn)>. This means that two 
// objects with different number of elements or with  different xor
// of the compression values of the elements can immediately be deduced to
// be different (the assumption is that large objects are almost always
// different). Only in cases where the quick compression of two objects
// results in the same number, does the system need to calculate their
// full compression.
//
// To ensure that the xor's of different sequences are as unlikely as
// possible to be the same, the compression values v1,...,vn are not
// allocated sequentially but by using a linear congruence which spreads
// them out uniformly over the range of 32 bit numbers (these are the 
// numbers which can be xor'ed in JavaScript). While uniqueness is desireable
// for these compression values, it is not absolutely necessary.
// Therefore, we do not actually check whether the linear congruence 
// sequence has returned to a number already allocated (the cycle for the
// sequence actually chosen has been tested to be of length at least 10^9).
// 
// These compression values are assigned to pairs <path ID, compression value>
// and the compression of these pairs is only used in the calculation
// of the compression values of compound objects. Therefore, when requesting
// the compression of a pair <path ID, compression value> the compression
// module returns a pair: [quick compression value, compression value].
// The first value is a 32 bit integer which is not guaranteed to be unique
// but is very likely to be so and is distributed uniformly across the
// range of 32 bit numbers. The second number is generated sequentially
// can be larger than 32 bit and is guaranteed to be unique.
//
// The Interface
// =============
//
// The compression object must compress values uniformly across different
// indexers belonging to the same QCM.
//
// Rounding 
// --------
//
// The compression module of the internal QCM needs to be constructed
// with the rounding required for each numeric type (including default
// rounding for all numeric types where no explicit rounding was given).
// The rounding is given in terms of the number of significant digits
// after which to round and or fixed rounding position. Significant 
// digit rounding means that the number will be rounded after that number 
// of significant digits (for example, with 4 significant digits, 12546 
// is rounded to 12550, while 0.006785611 is rounded to 0.006786). 
// The fixed rounding position is given in terms of the number of digits 
// after the decimal point (for example, with fixed rounding position of 2, 
// rounding is to two digits after the decimal point, so 3.546 is rounded 
// to 3.55 while 3546.00 remains unchanged by roundng). The fixed rounding 
// position can also be given as a negative integer, so a fixed rounding 
// position of -2 means rounding to the nearest 100 (for example,
// 13465 is rounded to 13500).
// Rounding can be given either in terms of number of significant digits
// or as fixed rounding position. This can be specified for each type 
// and a default can be given for all numeric types not mentioned
// explicitly. The format of the rounding specification object is 
// as follows:
//
// {
//     default: { 
//        method: "significant digits"|"fixed" 
//        rounding: <integer>
//     }
//     byType: <Map>{
//        <type>: {
//            method: "significant digits"|"fixed" 
//            rounding: <integer>
//        }
//        ......
//     } 
// }
//
// Remark: at present, no string based 'rounding' (e.g. collapsing different
// spelling variations) is performed.
//
// Interface
// ---------
//
// The following function returns the compression value of the value with
// the given type (a string) and value (which should be either a range object
// RangeKey or ConstRangeKey or a simple javascript value: a string, number, 
// or a boolean). In case of a range object, 'type' should be equal to 
// the type returned by the getType() function of the (Const)RangeKey object
// (this is the common type of the elements in the range).
// If the value was already compressed, the existing compressed value is 
// returned and, otherwise, a new compressed value is allocated and returned:
//
// InternalQCMCompression.simple(<type>, <simple/range value>)
//
// The following function allows one to increase the refrence count 
// of a compressed value returned by simple(). This is equivalent to 
// calling simple() again with the same type and value, but is more
// efficient, as the compression does not have to be recalculated. It
// also allows one to perform the operation based on the compressed value 
// returned (in case where the original type and value are no longer easily
// accessible). This allows several objects to be the owner of the same 
// simple compressed value (with each of them releasing it when they no 
// longer need it without causing it to be discarded prematurely).
// This function can only be used for compressed values returned by 
// simple().
//
// InternalQCMCompression.reallocateSimple(<simple compressed value>)
//
// The next function returns the compressed value of 
// a compressed value at a given path. The path ID is an ID returned
// by the path ID allocator of the same QCM and the compressed value
// should be a compressed value already calculated for the node under
// the given path. <path ID> should not be equal to the root path ID 
// (as this is then a simple value compression and should be equal to the
// input compressed value, but this function does not check this, it 
// is the responsibility of the calling function).
// This function returns an array with two compression numbers:
//    [quick compressed value, compressed value]
// The use of these two numbers is explained in the section
// 'Quick Compression of Compound Values' above.
//
// InternalQCMCompression.path(<path ID>, <compressed value>)
//
// The following function is identical except that it does not take the
// compressed value but a type (string) and simple value (string, number or
// boolean) as input:
//
// InternalQCMCompression.pathAndValue(<path ID>, <type>, <simple value>)
//
// For the compression of sequences, one can the following function 
// which takes two arguments: the compression value already calculated 
// for a prefix of the sequence and the compressed value for the next 
// element in the sequence. The function returns the compression value 
// for the sequence which is the result of appending the element with
// the given compressed value to the prefix sequence with the given 
// compressed value. A value of 0 in the <prefix compression value>
// can be used to compress the prefix of length 1 of the sequence,
// which simply returns the <compressed value> given as a second argument
// (without increasing it reference count). This step can, therefore,
// be skipped.
//
// InternalQCMCompression.next(<prefix compression value>, 
//                             <compressed value>)
//
// Clean-up
// --------
// 
// Every time a compression is requested, its reference number is
// increased by 1. When the compressed value is no longer needed, it
// should be released by calling a release function corresponding to
// the function used to allocate the compression value and with the same
// values used to get the compression:
//
// InternalQCMCompression.releaseSimple(<type>, <simple value>)
// InternalQCMCompression.releaseSimpleCompressed(<compressed value>)
//   Remark: releaseSimple() releases the compressed value based on the value
//       that was compressed (type and value) while releaseSimpleCompressed()
//       releases the compressed value bsaed on the compressed value itself.
// InternalQCMCompression.releasePath(<path ID>, <compressed value>)
// InternalQCMCompression.releasePathAndValue(<path ID>, <type>, <simple value>)
//   Remark: the releasePathAndValue function decreases the count
//   of both the path compression and the simple value compression
//   (while the pathAndValue() function increases the coresponding counts).  
// InternalQCMCompression.releaseNext(<prefix compression value>, 
//                                    <compressed value>)
// The release functions return the compressed valeu they just released.
//
// Object Structure
// ----------------
//
// The InternalQCMCompression object stores the next compression value
// to allocate and four tables used to allocate the simple compressed
// values (type + simple value), the range compressed values (type + 
// two simple values, ordered), the path compressed values (path + 
// simple compressed value) and the sequence compression (prefix 
// compressed value + next compressed value).
//
// {
//    emptyRangeCompression: <fixed number>
//    nextCompressedValue: <strictly positive integer>
//    quickCompressedValue: <strictly positive 32 bit integer>
//
//    rounding: <Map>{
//       <type>: <rounding function>,
//       .......
//    },
//    defaultRounding: <rounding function>
//
//    simpleCompression: <Map>{
//        <type>: <Map>{
//             <rounded value>: <compressed value>
//             .....
//        }
//    }
//    numberTypeCompression: <pointer to entry "number" in 'simpleCompression'>
//    stringTypeCompression: <pointer to entry "string" in 'simpleCompression'>
//
//    rangeValues: <IntHashMap>{
//        <compressed value>: <Map>{
//             // one position for each open/closed combination for the range
//             // edges, in the following order:
//             //     cc, co, oc, oo (binary c == 0, o == 1)
//             <other rounded value>: [<compressed value>, <compressed value>,
//                                     <compressed value>, <compressed value>]
//        }
//        ......
//    }
//    simpleCompressedValues: <IntHashPairMapUint>{
//        <compressed value>: [
//             <count>,
//             {
//                 type: <type>,
//                 roundedValue: <rounded value>|<ConstRangeKey>,
//             }
//        ]
//        ......
//    }
//    pathCompression: <IntHashMap>{
//        <path ID>: <IntHashMap>{
//             <simple compressed value>: { 
//                   count: <ref count>, 
//                   value: [<quick compressed value>, <compressed value>]
//             },
//             ....... 
//        }
//        .......
//    },
//    sequenceCompression: <IntHashMap>{
//        <prefix compression value>: <IntHashMap>{
//             <compressed value>: { count: <ref count>, 
//                                   value: <compressed value> }
//             ......
//        }
//        .......
//    }
//
//    queuedSimpleRelease: <IntHashMapUint>{
//        <simple compressed value>: <count>
//        .....
//    }
// }
//
// emptyRangeCompression: this is the number reserved for the compression
//     of empty ranges. This number is smaller than the first number
//     allowed for allocation by 'nextCompressedValue'.
//     xxxxxxxxxxxxxxxxx this may have to be defined separately for each type
//     (an empty range of different types is not the same value) xxxxxxxxxxx
// nextCompressedValue: the next value to assign to a new compression
//     being requested (whether a simple compression, a path compression
//     or a sequence compression). This is never 0 or negative.
// quickCompressedValue: the last value assigned as a quick
//     compressed value. Each value in this sequence is generated 
//     by a linear congruence from the previous value.
// rounding: for each type, this table holds a function which performs
//     the rounding required for that type. This table is constructed
//     by the object constructor for the types explicitly specified in 
//     the rounding specification object passed to the constructor of this 
//     object.
//     Each type for which rounding is actually performed is added to
//     this table (with the default rounding function if the type does not
//     yet have an entry in the table).
// defaultRounding: this is a rounding function which should be used for
//     rounding all numeric types other than those explicitly specified
//     in the rounding specification object provided upon construction
//     of this object. Each type for which rounding is performed using 
//     this function is added to the 'rounding' table, with the default
//     rounding function.
//     If this field is undefined, no rounding is performed on types
//     which do not appear in the 'rounding' table. 
// simpleCompression: this table holds the compressed values already
//    assigned to types (strings) and simple or range values (rounded).
//    <rounded value> is the simple value being compressed (after rounding)
//    and, in case of ranges, the rounded value of the first value of the
//    range. The 'value' field directly under <rounded value> is the
//    compressed value of that simple value. The 'count' field holds
//    a reference count for all compression requests for that simple value
//    or for a range value for which this is the first (smaller) value.
//    For range values, an entry is created under 
//    <rounded value>.otherRoundedValue for the second (larger) value in 
//    the range. This entry is created under attribute <other rounded value>, 
//    which is the rounded value of the second (larger) value in the range. 
//    The value and count under this entry are for this range.
//    Whenever the reference count for a range entry or for the full 
//    simple value entry reaches zero, the entry is removed.
// numberTypeCompression:
// stringTypeCompression:
//    These are pointers to the two most commonly used entries in
//    'simpleCompression' to allow direct access without a Map.get() operation.
// simpleCompressedValues: this table is and index into the 
//    'simpleCompression' table based on the compressed value.
//    For every compressed value, this table holds the type and rounded
//    value(s) under which this compressed value appears in 
//    the simpleCompression table. This table is used for increasing 
//    and decreasing the reference count of a simple compressed value 
//    without having to go through the original value that was compressed.
//    It also allows access to the simple value from the compressed value.
// pathCompression: this table holds the compressed values assigned
//    to <path, simple compressed> value pairs. Here, each entry
//    holds an array of two compressed values: the quick compressed value
//    and the compressed value. See 'Quick Compression of Compound Values'
//    above for an explanation. 
//    Each entry also has a reference count. Every time the entry is requested,
//    its reference count is increased and every time it is released,
//    its refrence count is decreased. When the reference count reaches 0,
//    the entry is removed.
// sequenceCompression: this table holds all compressed values assigned
//    to a given sequence prefix (identified by the compressed value
//    assigned to it) and the next compressed value in the sequence. 
//    Each entry also has a reference count. Every time the entry is requested,
//    its reference count is increased and every time it is released,
//    its refrence count is decreased. When the reference count reaches 0,
//    the entry is removed.
// rootPathId: the id of the root path, []; when compressing a simple value
//    at the root path, the result of full compression and simple compression
//    are identical.
//
// queuedSimpleRelease: this stores the compressed values of all compressed
//   simple values which were released in the last update cycle together with
//   a count of the number fo times they were released. At the end of the
//   cycle, the reference count is decreased by this number and, if needed,
//   the entry is destroyed.

// %%include%%: <scripts/utils/rounding.js>

//
// Constructor 
//
// The constructor is given an object describing the rounding to be performed
// for different types of simple values (see above for more information)

function InternalQCMCompression(roundingSpecs, rootPathId)
{
    this.rootPathId = rootPathId;
    this.emptyRangeCompression = 1;
	this.nextCompressedValue = 2; // start beyond values allocated above 
	this.quickCompressedValue = 1;

    this.rounding = undefined;
    this.defaultRounding = undefined;
    
	this.simpleCompression = new Map();
    this.rangeValues = new IntHashMap();

    // initialize the most commonly used types
    this.numberTypeCompression = new Map();
    this.simpleCompression.set("number", this.numberTypeCompression);
    this.stringTypeCompression = new Map();
    this.simpleCompression.set("string", this.stringTypeCompression);
    
    this.simpleCompressedValues = new IntHashPairMapUint();
    
	this.pathCompression = new IntHashMap();
	this.sequenceCompression = new IntHashMap();

    this.queuedSimpleRelease = new IntHashMapUint();
    
	this.initRounding(roundingSpecs);
}

//////////////
// Rounding //
//////////////

// This function is used to initialize the 'rounding' and 'defaultRounding'
// fields of this object based on the 'roundingSpecs' object, which has
// the following format:
// {
//     default: { 
//        method: "significant digits"|"fixed" 
//        rounding: <integer>
//     }
//     byType: <Map>{
//        <type>: {
//            method: "significant digits"|"fixed" 
//            rounding: <integer>
//        }
//        ......
//     }
// }
// For each type in the roundingSpecs this sets the appropriate rounding
// function for that type.

InternalQCMCompression.prototype.initRounding = 
	internalQCMCompressionInitRounding;

function internalQCMCompressionInitRounding(roundingSpecs)
{
    if(!roundingSpecs)
		return;
    
	this.rounding = new Map();

	if(roundingSpecs.default) {
		this.defaultRounding = 
			this.createRoundingFunction(roundingSpecs.default);
	}

    var _self = this;
    
	if(roundingSpecs.byType)
		roundingSpecs.byType.forEach(function(rounding, type) {
			var roundingFunc = _self.createRoundingFunction(rounding);
			if(roundingFunc)
				_self.rounding.set(type, roundingFunc);
		});

    if(this.defaultRounding === undefined && this.rounding.size == 0)
        this.rounding = undefined; // no rounding specified
}

// This is an auxiliary function. Given the specification of rounding
// in the form:
// {
//     method: "significant digits"|"fixed" 
//     rounding: <integer>
// }
// This function returns a function which performs the appropriate rounding.
// This may return undefined if the specifications are incomplete
// or malformed.

InternalQCMCompression.prototype.createRoundingFunction = 
	internalQCMCompressionCreateRoundingFunction;

function internalQCMCompressionCreateRoundingFunction(roundingSpec)
{
	if(!roundingSpec)
		return undefined;

	var rounding = roundingSpec.rounding;

	if(rounding === undefined)
		return undefined;

	if(roundingSpec.method == "significant digits") {
		if(rounding < 1)
			return undefined;

		return function(x) { return significantDigitRounding(x, rounding); };
	}

	if(roundingSpec.method == "fixed") {
		var shift = Math.pow(10, roundingSpec.rounding);
		return function(x) { return Math.round(x * shift) / shift; };
	}

	return undefined;
}

/////////////////////////////
// Quick Compressed Values //
/////////////////////////////

InternalQCMCompression.prototype.nextQuick = 
	internalQCMCompressionNextQuick;

function internalQCMCompressionNextQuick()
{
	return (this.quickCompressedValue = 
			(16807 * this.quickCompressedValue) % 2147483647);
}

 
///////////////////////////////////
// Compression Request Functions //
///////////////////////////////////

// This function takes a type (string) and a simple value which can 
// either be a range object (RangeKey or ConstRangeKey) or a simple
// JS value (string, number or boolean) as input. If the simple value is
// a range object, 'type' must be the same as returned by the range object's
// getType() function. The function returns 
// the compression value (an integer) for this pair. If the value is numeric, 
// it is rounded according to the rounding specifications for the type
// (if it is a numeric range, both end points of the range are rounded). 
// If the value was not previously compressed, an entry is created for it 
// in the simpleCompression table. Otherwise, 
// the reference count for the entry of this value is increased by 1.
// For range values, after the function identifies the two range endpoints,
// the first (lower) range value is added in exactly the same way 
// as if it was the simple value to be compressed. The second (larger)
// range value is then added under its entry.

InternalQCMCompression.prototype.simple = 
	internalQCMCompressionSimple;

function internalQCMCompressionSimple(type, simpleValue)
{
    var otherValue;
    var isMinOpen;
    var isMaxOpen;

    if(typeof(simpleValue) == "object") { // a range key object
        if(simpleValue.isEmpty())
            return this.emptyRangeCompression; // empty range
        isMinOpen = simpleValue.getMinOpen();
        isMaxOpen = simpleValue.getMaxOpen();
        otherValue = simpleValue.getMaxKey();
        simpleValue = simpleValue.getMinKey();
    }

	// rounding 
	if(this.rounding !== undefined && typeof(simpleValue) == "number") {
        var roundingFunc = this.rounding.get(type);
        if(roundingFunc === undefined && this.defaultRounding) {
            roundingFunc = this.defaultRounding;
            this.rounding.set(type, roundingFunc);
        }

        if(roundingFunc !== undefined) {
		    simpleValue = roundingFunc(simpleValue);
            if(otherValue !== undefined)
                otherValue = roundingFunc(otherValue);
        }
        
        if(otherValue === simpleValue) { // range endpoints equal
            if(isMinOpen || isMaxOpen)
                return this.emptyRangeCompression; // empty range
            otherValue = undefined; // handle as a simple value, not a range
        }
    } else if(otherValue === simpleValue) { // range endpoints equal
        if(isMinOpen || isMaxOpen)
            return this.emptyRangeCompression; // empty range
        otherValue = undefined; // handle this as a simple value, not a range
    }
        
	var typeEntry;

    if(type == "number")
        typeEntry = this.numberTypeCompression;
    else if(type == "string")
        typeEntry = this.stringTypeCompression;
	else if(!(typeEntry = this.simpleCompression.get(type))) {
        typeEntry = new Map();
		this.simpleCompression.set(type, typeEntry);
    }
	
	var valueEntry;
    var compressedValue;

    if(!typeEntry.has(simpleValue)) {
        compressedValue = this.nextCompressedValue++;
        typeEntry.set(simpleValue, compressedValue); 
        this.simpleCompressedValues.setPair(compressedValue, 1, 
                                            { type: type,
                                              roundedValue: simpleValue });
	} else {
        compressedValue = typeEntry.get(simpleValue);
        if(otherValue === undefined)
            this.simpleCompressedValues.inc(compressedValue, 1);
    }

    if(otherValue === undefined)
	    return compressedValue;

    var rangeLowEntry;
    if((rangeLowEntry = this.rangeValues.get(compressedValue)) === undefined) {
        rangeLowEntry = new Map();
        this.rangeValues.set(compressedValue, rangeLowEntry);
    }
    
    var otherValueEntry;
    // code for open/closed edges of range (cc: 0, co: 1, oc: 2, oo: 3) 
    var openClose = (isMinOpen ? 1 : 0) + (isMaxOpen ? 2 : 0);

    if((otherValueEntry = rangeLowEntry.get(otherValue)) === undefined) {
        otherValueEntry = [];
        otherValueEntry[4] = 0; // count of entries in array
        rangeLowEntry.set(otherValue, otherValueEntry);
    }

    var rangeCompressedValue = otherValueEntry[openClose];
    if(rangeCompressedValue === undefined) {
        
        rangeCompressedValue = 
            (otherValueEntry[openClose] = this.nextCompressedValue++);
        otherValueEntry[4]++; // count of defined entries in array

        this.simpleCompressedValues.setPair(rangeCompressedValue, 1, {
            type: type,
            roundedValue: new ConstRangeKey(undefined, type, simpleValue,
                                            otherValue, isMinOpen, isMaxOpen)
        });
        // also increase the refrence count of the first value
        this.simpleCompressedValues.inc(compressedValue, 1);
    } else
        this.simpleCompressedValues.inc(rangeCompressedValue, 1);
    
    return rangeCompressedValue;
}

// This function is given a compressed value returned by the simple()
// function (above). It increases the reference count (in the 
// simpleCompressionValues table) for this compressed value.
// This function returns false if the given compressed value could not be
// found and true otherwise. 

InternalQCMCompression.prototype.reallocateSimple = 
	internalQCMCompressionReallocateSimple;

function internalQCMCompressionReallocateSimple(simpleCompressedValue)
{
    if(simpleCompressedValue == this.emptyRangeCompression)
        return true; // constant, not allocated

    var entry =
        this.simpleCompressedValues.incAndGetSecond(simpleCompressedValue, 1);

    if(!entry) { // 0 or undefined
        // the previous operation created an entry for this compressed value
        this.simpleCompressedValues.delete(simpleCompressedValue);
        return false;
    }

    return true;
}

// This function takes a path ID and a compressed value (of a simple value)
// as input and returns an array with two compression numbers for this pair:
//    [quick compressed value, compressed value]
// with the exception of the root path (see introduction for explanation)
// If this pair was not previously compressed, an entry is created for
// it in the pathCompression table. Otherwise, the reference count for
// the entry of this pair is increased by 1.

InternalQCMCompression.prototype.path = 
	internalQCMCompressionPath;

function internalQCMCompressionPath(pathId, compressedValue)
{
	var pathEntry;

	if(!(pathEntry = this.pathCompression.get(pathId))) {
		pathEntry = new IntHashMap();
        this.pathCompression.set(pathId, pathEntry);
    }
	
	var valueEntry;

	if(!(valueEntry = pathEntry.get(compressedValue))) {
		valueEntry = {
			count: 1,
			value: [this.nextQuick(), 
                    pathId === this.rootPathId? compressedValue:
                                                this.nextCompressedValue++]
		};
        pathEntry.set(compressedValue, valueEntry);
	} else
		valueEntry.count++;

	return valueEntry.value;
}

// This function takes a path ID, a type (string) and a simple value
// (string, number or boolean) and returns an array with two compression 
// numbers for this pair:
//    [quick compressed value, compressed value]
// (see introduction for explanation)
// The function first calls the function simple() on the
// type and the simple value and then calls path() with the path ID
// and the compression value which is the output of the call to
// simple().
// This function increases the reference count both for the 
// <type, simple value> pair and for the <path ID, compressed value> pair.

InternalQCMCompression.prototype.pathAndValue = 
	internalQCMCompressionPathAndValue;

function internalQCMCompressionPathAndValue(pathId, type, simpleValue)
{
	return this.path(pathId, this.simple(type, simpleValue));
}

// This function takes a compressed value for a prefix sequence (possibly 0
// if this prefix is empty) and the compressed value for the next 
// element in the sequence. The function then returns the compressed value 
// for the sequence produced by appending the element with the given
// compressed value to the prefix sequence whose compressed value is given.
// This function updates the sequenceCompression table.
// When the prefixCompression is 0, this function simply returns
// compressedValue and does not update the sequenceCompression table.

InternalQCMCompression.prototype.next = 
	internalQCMCompressionNext;

function internalQCMCompressionNext(prefixCompression, compressedValue)
{
    if(!prefixCompression)
        return compressedValue;
    
	var prefixEntry;

	if(!(prefixEntry = this.sequenceCompression.get(prefixCompression))) {
		prefixEntry = new IntHashMap();
        this.sequenceCompression.set(prefixCompression, prefixEntry);
    }
	
	var seqEntry;

	if(!(seqEntry = prefixEntry.get(compressedValue))) {
		seqEntry = {
			count: 1,
			value: this.nextCompressedValue++
		};
        prefixEntry.set(compressedValue, seqEntry);
	} else
		seqEntry.count++;

	return seqEntry.value;
}

///////////////////////
// Release Functions //
///////////////////////

// There is a 'release' function corresponsing to each of the compression
// request function above (simple(), path(), pathAndValue() and next()).
// The release function decreases the reference count for the entries 
// created by the corresponding request function. The release functions
// return the compression value which the corresponding request function
// has returned. They return 0 if the compressed value was not found.

// see description at beginning of section

InternalQCMCompression.prototype.releaseSimple = 
	internalQCMCompressionReleaseSimple;

function internalQCMCompressionReleaseSimple(type, simpleValue)
{
    var otherValue;
    var isMinOpen;
    var isMaxOpen;
    
    if(typeof(simpleValue) == "object") { // a range object
        if(simpleValue.isEmpty())
            return this.emptyRangeCompression; // empty range
        isMinOpen = simpleValue.getMinOpen();
        isMaxOpen = simpleValue.getMaxOpen();
        otherValue = simpleValue.getMaxKey();
        simpleValue = simpleValue.getMinKey();
    }

	// rounding
	if(this.rounding !== undefined && this.rounding.size > 0 &&
       typeof(simpleValue) == "number") {
        var roundingFunc = this.rounding.get(type);
        if(roundingFunc !== undefined) {
		    simpleValue = roundingFunc(simpleValue);
            if(otherValue !== undefined)
                otherValue = roundingFunc(otherValue);
        }
        
        if(otherValue === simpleValue) { // range endpoints equal
            if(isMinOpen || isMaxOpen)
                return this.emptyRangeCompression; // empty range
            otherValue = undefined; // handle as a simple value, not a range
        }
    } else if(otherValue === simpleValue) { // range endpoints equal
        if(isMinOpen || isMaxOpen)
            return this.emptyRangeCompression; // empty range, not in table
        otherValue = undefined; // handle as a simple value, not a range
    }

	var typeEntry;

    if(type == "number")
        typeEntry = this.numberTypeCompression;
    else if(type == "string")
        typeEntry = this.stringTypeCompression;
	else if(!(typeEntry = this.simpleCompression.get(type)))
		return 0;
	
	var compressedValue;

	if(!(compressedValue = typeEntry.get(simpleValue)))
		return 0;

    if(otherValue === undefined) { // not a range value
        // queue this release
        this.queuedSimpleRelease.inc(compressedValue, 1);
        return compressedValue;
    }

    // range value
    
    var rangeCompressedValue;
    var rangeLowEntry = this.rangeValues.get(compressedValue);
        
    if(rangeLowEntry === undefined)
        return 0; // not found

    // code for open/closed edges of range (cc: 0, co: 1, oc: 2, oo: 3) 
    var openClose = (isMinOpen ? 1 : 0) + (isMaxOpen ? 2 : 0);
    var otherValueEntry = rangeLowEntry.get(otherValue);
    if(otherValueEntry === undefined)
        return 0;
    rangeCompressedValue = otherValueEntry[openClose];
    if(rangeCompressedValue === undefined)
        return 0;

    // queue for removal
    this.queuedSimpleRelease.inc(rangeCompressedValue, 1);
    
    return rangeCompressedValue;
}

// This releases (decreases the reference count by 1) of a compressed value
// allocated for a simple value, based on the compressed value (and not
// on the simple value itself, as done by releaseSimple()). This function
// is somewhat faster than 'releaseSimple' and can also be used where the
// original simple value is no longer known. 

InternalQCMCompression.prototype.releaseSimpleCompressed = 
	internalQCMCompressionReleaseSimpleCompressed;

function internalQCMCompressionReleaseSimpleCompressed(simpleCompressedValue)
{
    if(simpleCompressedValue == this.emptyRangeCompression)
        return; // constant, not allocated

    this.queuedSimpleRelease.inc(simpleCompressedValue, 1);
}

// This function is called at the end of the update cycle to perform the
// release of the simple compressed values which were released during
// the update cycle. If needed, this removes the compressed values from
// the compression tables.

InternalQCMCompression.prototype.applyQueuedSimpleRelease =
	internalQCMCompressionApplyQueuedSimpleRelease;

function internalQCMCompressionApplyQueuedSimpleRelease()
{
    var _self = this;
    
    this.queuedSimpleRelease.forEach(function(count, simpleCompressedValue) {
        
        // decrease the reference count (returns entry if it dropped to zero)
        var entry = _self.simpleCompressedValues.
            decAndGetSecond(simpleCompressedValue, count, false, true);

        if(entry === undefined)
            return;
    
        var typeEntry = _self.simpleCompression.get(entry.type);
        
        if(typeof(entry.roundedValue) != "object") {
            // simple value, just remove the entry
            typeEntry.delete(entry.roundedValue);
            return;
        }
    
        var roundedValue = entry.roundedValue.getMinKey();
        // the compressed value for the low end of the range
        var lowCompressedValue = typeEntry.get(roundedValue);
        var lowRangeEntry = _self.rangeValues.get(lowCompressedValue);
        var otherValue = entry.roundedValue.getMaxKey();
        var rangeEntry = lowRangeEntry.get(otherValue);
        
        var openClose = ((entry.roundedValue.getMinOpen() ? 1 : 0) +
                         (entry.roundedValue.getMaxOpen() ? 2 : 0));
        
        if(--rangeEntry[4] == 0) {
            if(lowRangeEntry.size == 1)
                _self.rangeValues.delete(lowCompressedValue);
            else
                lowRangeEntry.delete(otherValue);
        }
        
        // decrease the reference count of the low value
        if(_self.simpleCompressedValues.dec(lowCompressedValue, count) === 0)
            typeEntry.delete(roundedValue);
    });

    this.queuedSimpleRelease.clear();
}

// see description at beginning of section

InternalQCMCompression.prototype.releasePath = 
	internalQCMCompressionReleasePath;

function internalQCMCompressionReleasePath(pathId, compressedValue)
{
	var pathEntry;
	
	if(!(pathEntry = this.pathCompression.get(pathId)))
		return 0;
	
	var valueEntry;

	if(!(valueEntry = pathEntry.get(compressedValue)))
		return 0;

	if(!--valueEntry.count) {
        if(pathEntry.size == 1) // about to become 0
			this.pathCompression.delete(pathId);
        else
		    pathEntry.delete(compressedValue);
	}

	return valueEntry.value;
}

// see description at beginning of section

InternalQCMCompression.prototype.releasePathAndValue = 
	internalQCMCompressionReleasePathAndValue;

function internalQCMCompressionReleasePathAndValue(pathId, type, simpleValue)
{
	return this.releasePath(pathId, this.releaseSimple(type, simpleValue));
}

// see description at beginning of section

InternalQCMCompression.prototype.releaseNext = 
	internalQCMCompressionReleaseNext;

function internalQCMCompressionReleaseNext(prefixCompression, compressedValue)
{
    if(!prefixCompression)
        // does nothing, since in this case the 'next' function doesn't
        // do anything either.
        return compressedValue;
    
	var prefixEntry;

	if(!(prefixEntry = this.sequenceCompression.get(prefixCompression)))
		return 0;
	
	var seqEntry;

	if(!(seqEntry = prefixEntry.get(compressedValue)))
		return 0;

	if(!--seqEntry.count) {
		prefixEntry.delete(compressedValue);

	    // since the count for this sequence is zero, it cannot be a prefix 
	    // of any compressed sequence.
	    this.sequenceCompression.delete(seqEntry.value);
    }

	return seqEntry.value;
}

////////////////////////////////////////
// Access to Simple Compressed Values //
////////////////////////////////////////

// Given the compression of a simple value, this function returns the
// value which is compressed. If this is not the compression of a
// simple value, undefined is returned.
// The simple value is returned in an object in the format used in
// the simpleCompressedValues table:
// {
//     type: <type>,
//     roundedValue: <rounded value>,
// }
// 'roundedValue' is either a simple value or a ConstRangeKey object.
// All numeric values returned may be rounded, based on the rounding
// specifications of the compression.
// In case of an empty range value, 'type' is "range".

InternalQCMCompression.prototype.getSimpleValue = 
	internalQCMCompressionGetSimpleValue;

function internalQCMCompressionGetSimpleValue(compressedValue)
{
    if(compressedValue == this.emptyRangeCompression) {
        return { type: "range",
                 roundedValue:  new ConstRangeKey() } // empty range object
    }
    
    return this.simpleCompressedValues.getSecond(compressedValue);
}

