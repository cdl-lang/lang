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

// This object is used to calculate the compressed value of compound
// data nodes. This object also correctly calculates the compression
// of simple values, though it does not do so very efficiently.
// Therefore, if it is known that the value being compressed is simple,
// it is better not to use this object, but if one does not bother to
// check or the value changes between a simple and non-simple value,
// this object will still produce the correct result. 

// Given a data element d and a path P such that d is a lowest data element
// on P (<P,d> defines a data node at path P) the compression function 
// of <P,d> is based on all pairs <Pi, di^j> such that:
// 1. Pi is a path which has P as a prefix.
// 2. di^j is a data element on the path Pi, is dominated by d 
//    (possibly d = di^j), di^j is a lowest data element on the path Pi
//    and the node defined by <Pi, di^j> has a simple value 
// These pairs define all the simple valued nodes dominated by the node <P,d>.
// Note: <P,d> is allowed to be a member of this set (thus allowing the 
// compression of compound structures with values at non-terminal nodes.
// 
// Since each such pair <Pi, di^j> defines a simple value, we can assume
// a compressed value ci^j has already been calculated for that node
// (or else, it should be calculated). For each pair <Pi, di^j> we then 
// have a triple <Pi - P, di^j, ci^j> where Pi-P identifies the query path 
// from P to Pi (the suffix of Pi beginning at P). We then need to group
// and order these tuples to compress the sequence. There is a
// 'quick' way to do this which is not guaranteed to produce a unique
// compressed value (but is often likely to do so) and there is
// 'full' compression which is guaranteed to produce a unique
// compression value for each compound structure (but is more
// expensive to calculate, especially for large structures).
//
// Quick Compressed Value
// ----------------------
//
// Given the sequence of triples <Pi - P, di^j, ci^j>, we can
// calculate a compression of it which is independent of its
// order. For each triple <Pi - P, di^j, ci^j> we calculate
// a compression value vij based on Pi-P and ci^j. We then generate
// a compressed value for the sequence based on <sequence length, xor(vij)>
// (the xor being of all vij's in the sequence). Whether this pair is the same 
// for two different sequences depends very much on the way the 
// compression values vij are generated (if they are generated
// sequentially the chance of having the same xor is high, but if they
// are spread more uniformly, the chance of uniqueness is much higher).
// For this reason, the InternalQCMCompression module (which assigns
// the compressed values vij) actually assigns two compressed values
// for each pair <Pi - P, ci^j>: one is guaranteed to be unique and
// is used for the full compression (see below)
// while the other is spread more uniformly across the range of 
// integers with 32 bits but is not, in principle, guaranteed to be 
// unique. This is used for the quick compression.
// 
// The string <sequence length> + ":" xor(v1,...,vn) is used as the quick 
// compressed value of the sequence. When two CompressedValue objects return 
// the same quick compressed value, the full compressed value can be requested.
//
// In the special case where the compression is of a single terminal value
// and this terminal value is at the root of the compressed sub-tree,
// the compressed value is a simple value. In this case, the quick compression
// is not represented by the above string, but by the number which is
// the compression of that simple value. In this way, this object can
// also be used to compress simple values (it is not a very efficient 
// way of doing so, but if the value changes from a compound value to 
// a simple value, this object will still compress it correctly).
//
// Full Compressed Value
// ---------------------
//
// To ensure that two sequences of triples <Pi - P, di^j, ci^j>
// are compressed into the same value iff they are considered
// identical, we need to group and order them in a way which is
// only dependent on the structure and not on the specific data element IDs,
// di^j.
//
// Recall that compression is being calculated at <P,d>. If there are
// two data element d1, d2 such that both are dominated by d and both
// have the same path Q which extends P then we first need to compress
// the strucure under d1 and d2 separately and then use this compression
// in calculating the compression of <P,d>. We will call this a 'grouping'
// operation. The reason this is needed is that if we have two structures:
//
// o({ a: 1, b: 1}, { a: 2, b: 2})
//
// and
//
// o({a: 1, b: 2 }, { a: 2, b: 1})
//
// then these two structure will both have the same pairs
// <P - Pi, ci^j> in their sequence, but should not be considered
// identical.
//
// Therefore, for every data element such as d1 above, we
// calculate the full compression for d1. We then remove all
// triples <Pi - P, di^j, ci^j> used in calculating of the compression
// for d1 (these are the triples whose di^j is dominated by d1) from the
// compression of the full value and replace it by <Q-P, d1, v> where
// Q is the path leading to d1 and v is the compression value calculated
// for d1.
//
// After performing this grouping, we are left with sequences
// which need to be compressed. These sequences have the property
// that if there are two <Pi - P, di^j, ci^j> in the sequence which have
// the same path Pi-P then di^j was compressed. There is then a single
// entry in the sequence with this di^j and the path Pi is the path leading
// to di^j. Therefore, we can sort the sequence by the paths Pi-P
// and where the same path appears, by the di^j's, which must fall
// under the same ordered set (if not, each of them would have been part
// of the compression of an intermediate data element and would not
// appear in this sequence). The di^j's could then be sorted based
// on th sorting description/key of the ordered set they fall
// under. This may be implemented in the future. For now, we sort
// the di^j's based on the compression value calculated for them.
// This means that ordered sets which contain the same elements but in
// a different order will be consider idential here.
//
// Having ordered the sequences, we calculate a compression value vi^j for
// each pair <Pi-P, ci^j> and then calculate a compression value for
// this sequence of vi^j's by calculating a compression value for every
// prefix of the sequence, with the compression value for the
// sequence v1,...,vi being Vi and the compression value for v1,...,vi+1
// being calculated from Vi and vi+1.
//
// Compressing the Sequence
// ------------------------
//
// The CompressedValue object receives notifications of simple values being
// added, removed or modified under it. The update is in the form of
// a path (of the simple value) a data element (the lowest data element
// above the value) and a compressed value for the simple value being 
// compressed:
// [Pi, dij, cij]
// The path Pi is converted to Pi-P (P being the path at which the
// compression takes place). The compressed value cij is then stored
// under the pair [Pi, dij] (in case dij = d, the lowest data element
// above the compressed node, this can be stored directly under Pi-P, 
// as there cannot be two differernt values stored under that path).
// 
// Given the pair <Pi-P, cij>, a quick compressed value and a full compressed 
// value are calculated for this pair. The quick compressed value can
// immediately be xored to update the quick compressed value of the object.
//
// When full compression of the compound value is requested, we determine
// under which data element each tuple [Pi, dij, cij] needs to be compressed.
// The tuple is then added to the approrpiate sequence and the sequence
// is sorted and compressed.
//
// Implementation
// ==============
//
// The CompressedValue object has the following structure:
//
// {
//    indexer: <the indexer in which the compression takes place>
//    compression: <compression module of the QCM>
//    pathId: <the path to the value to be compressed>,
//    dataElementId: <the ID of lowest data element above the compressed value>
//    numElements: <number of simple values being compressed>,
//    numRootElements: <number of simple values being compressed which are 
//                      at the root path of the sub-tree>
//    xor: <xor of simple compressed value for the path + elements>,
//    quickCompression: <string> or <number>
//    fullCompression: <undefined|integer>
//    fullCompressionNrRequests: <integer>
//    elements: {
//        <data element ID>: {
//             number: <number of paths under this data element>
//             <path ID>: {
//                  simple: <simple compressed value>,
//                  quick: <quick compressed value for this entry>,
//                  value: <full compressed value for this entry>,
//                  // the following fields only when full compression required
//                  pathSortKey: <number>,
//                  dataElementId: <data element ID>,
//                  sequenceId: <data element ID>,
//                  sequencePos: <integer>,
//                  prefix: <compression value>
//             }
//             .....
//        }
//        .....
//    },
//    // from here, only needed in case of full compression
//    compoundElements: {
//        <data element ID>: {
//             value: <full compressed value for this entry>,
//             pathSortKey: <number>,
//             dataElementId: <data element ID>,
//             sequenceId: <data element ID>,
//             parentId: <data element ID>,
//             pathId: <path to the data element>
//             sequencePos: <integer>,
//             prefix: <compression value>
//        }
//        .......
//    },
//    sequences: {
//       <data element ID>: [<sequence of entries from the 'elements' table>]
//       ......
//    },
//    sequenceParents: {
//       <parent data element ID>: {
//            number: <number of paths below>
//            <path ID>: true,
//            .....
//       },
//       .....
//    }
//    modifiedSequences: {
//        <data element ID>: {
//             compressPos: <where to start recalcualting compression>
//             resequencePos: <where to start reordering the sequence>
//             added: <array of new entries added to sequence (unsorted)>
//        }
//        .....
//    }
//    newModifiedSequences: [<array of data element IDs>]
// }
//
// indexer: the indexer inside which this CompressedValue was created.
// compression: the compression module of the QCM to which the indexer 
//     belongs.
// pathId: the path (from the root of the indexer) to the node 
//     being compressed. We will call this the 'compression path'
// dataElementId: the ID of the lowest data element above the node
//     being compressed. We will call this the 'compression data element'.
// numElements: the number of elements stored in the 'elements' table.
//    The number of elements is also used in generating the quick
//    compressed value.
// numRootElements: the number of elements stored in the 'elements' table
//    under the root path of this compressed value (that is, terminal
//    values at the root of the compressed sub-tree). When both this number
//    and 'numElements' are 1, the compressed value is a simple value.
// xor: the xor of the 'quick' compressed value of all elements appearing
//    in the 'elements' table.
// quickCompression: <numElements>+":"+<xor>; in case of a single simple
//    value at the root path, quickCompression is equal to the
//    simpleCompressedValue
// fullCompression: the compression value calculated based on the sorting
//    of the elements. This is undefined if no full compression is being 
//    calculated. It is 0 if the compressed value is empty and non-zero
//    otherwise.
// fullCompressionNrRequests: counter for the number of full compression
//    requests.
// elements: 
//    This table holds the "simple" entries, which consist of all simple
//    values under the compressed node. Each value is stored under the
//    ID of the lowest data element dominating it and the suffix path
//    leading to it (that is, the path leading to it from the compression
//    path, this.pathId).
//    The following fields are stored on an entry in the elements table:
//      simple: the compressed value of the simple value.
//      quick: the quick compressed value for the path + simple value.
//      value: this is the compressed value for the path + simple value.
//      pathSortKey: this is the sort key allocated by the path ID allocator
//         to the path under which this entry is stored in the table.
//         This is only used when full compression is required. In every
//         sequence (see below) the entries are first sorted by this
//         key.
//      dataElementId: the ID of the lowest data element above simple
//         value represented by this entry. This is the data element ID
//         under which this entry is stored in the 'elements' table.
//         This is used only when full compression is required. 
//      sequenceId: this is a data element ID. This entry appears in the
//         sequence in the 'sequences' table under this ID.
//         This is used only when full compression is required.
//      sequencePos: the position of this entry in the sequence whose
//         ID is given in sequenceId.
//         This is used only when full compression is required.
//      prefix: the compression value of the sequence up to this entry.
//         For the first element in the sequence this is equal to
//         'value' field. For the last value in the sequence, this is
//         the compressed value of the whole sequence.
//         This is used only when full compression is required.
// compoundElements:
//    The "compound" elements are only used when full compression is
//    required and when the 'sequences' table holds a data element which
//    is not the compression data element (this.dataElementId), that is,
//    when there are lower data elements which need to be compressed.
//    In this case, an entry is created for that data element in the
//    'compoundElements' table. This entry represents the result of
//    compressing the elements in the corresponding sequence in the
//    'sequences' table. This entry then appears in some sequence
//    of a data element dominating the entry's data element.
//    There are some similarities between the fields of these entries
//    and those in the 'elements' table. The fields in compound element
//    entries are the following:
//      value: this is the compressed value calculated for the full sequence
//         whose ID is the same as the data element ID of this entry.
//      pathSortKey: this is the sort key allocated by the path ID allocator
//         to the path leading from the compression data element
//         (this.dataElementId) to the data element of this entry. This
//         pathSortKey is used to sort the entried in the sequence in which
//         this entry appears. If two entries have the same path sort key,
//         they are sorted either by the data element (see next field)
//         or by the compression value calculated for this entry.
//      dataElementId: this is the data element ID under which this
//         entry is stored. This may be used in sorting the entries (it is
//         not strictly necessary in the current implementation but may be
//         used later if we need to sort by these IDs).
//      parentId: this is the ID of the data element which is the parent
//         of the data element in 'dataElementId'. This needs to be
//         recorded here because it may happen that when the sequence is
//         refreshed, the data element no longer exists and therefore
//         its parent cannot be found through the dataElements table of
//         the indexer (and this is needed for proper cleanup).
//         This is also used to mark this entry as a compound entry.
//      pathId: this is the path to the data element in 'dataElementId'.
//         This is the full path, not the suffix path beginning at the
//         compression path. This is needed for proper cleanup.
//      sequenceId: this is a data element ID (which dominates the data
//         element ID of this entry). This entry appears in the
//         sequence in the 'sequences' table under this ID.
//      sequencePos: the position of this entry in the sequence whose
//         ID is given in sequenceId.
//      prefix: the compression value of the sequence up to this entry.
//         For the first element in the sequence this is equal to
//         'value' field. For the last value in the sequence, this is
//         the compressed value of the whole sequence.
// sequences: This field is only used when full compression is required.
//    It always holds an entry for the compression data element ID
//    (this.dataElementId). In addition it may hold entries for additional
//    data elements under the compression data element. For every entry
//    in the 'elements' table, we consider the data element under
//    which the entry is stored and then all data elements dominating it
//    (but lower than the compression data element) for addition to the
//    'sequences' table. Given such a data element d, its path P and
//    its parent p(d), we add a sequence for d iff p(d) has more than one
//    child under the path P (this can easily be determined by looking
//    at the p(d)'s entry in the indexer's 'dataElements' table).
//    An entry in the 'elements' table is added to the sequence
//    of the lowest data element added in this way to the 'sequences'
//    table. This is set as the 'sequenceId' of the entry. An entry in
//    the 'compoundElements' table is then created for the data element ID
//    'sequenceId'. The process is then repeated with this compound element
//    entry (until the compression data element is reached - no compound
//    element entry is created for that data element).
//    Each sequence array then holds a sequence of entries from the
//    'elements' and 'compoundElements' tables. The position of each entry
//    in the sequence is recorded in the 'sequencePos' field of the entry.
// sequenceParents: for every data element ID in the sequences table,
//    except for the compression data element (this.dataElementId)
//    this table holds the ID of the parent data element of the sequence ID
//    and the path leading to that parent. By definition, all children
//    of this parent data element under the same path must have
//    sequences in the sequences table.
//    In the simplest case, this table is not used, as only the compression
//    data element has a sequence. When lower sequences are constructed,
//    this table helps keep track of which sequences need to be created
//    and destroyed when an update takes place.
// modifiedSequences: this table is used in an incremental update of the
//    full compression. For every sequence added or modified,
//    this table holds the following information:
//      resequencePos: this is the position where the reordering of
//         the elements in the sequence should begin. This is the smallest
//         between the first position where an element was deleted and the
//         the first position where an element is inserted.
//      compressPos: the recalculation of the compression should start
//         here. This is always smaller or equal the 'resequencePos'.
//      added: when elements are added to a sequence, they are first
//         pushed at the end of this array, without sorting.
// newModifiedSequences: this is a buffer of sequences added to the
//    'modifiedSequences' list after sorting an compression of these
//    sequences has already started (in the function
//    sortAndCompressModifiedSequences()). This field is undefined except
//    when the function sortAndCompressModifiedSequences() is active.
//    When this function is active, 'newModifiedSequences' holds an
//    array and any time a new modified sequence is created, its ID
//    is pushed on this array. The loop inside sortAndCompressModifiedSequences
//    then checks this array at every round and inserts the IDs of the
//    newly modified sequences into the appropriate place in the loop.
//    The list in newModifiedSequences is then cleared.
//    Note: a sequence may be modified only while processing sequences
//    which precede it in the ordering (higher sequence ID). 

// %%include%%: <scripts/utils/mergeArrays.js>

//
// Constructor
//

// The constructor takes as input the indexer which stores the compressed 
// value, the path to the compressed node and the lowest data element above
// the compressed node.

function CompressedValue(indexer, pathId, dataElementId)
{
	this.indexer = indexer;
	this.compression = indexer.qcm.compression;
	this.pathId = pathId;
	this.dataElementId = dataElementId;
	this.numElements = 0;
    this.numRootElements = 0;
    this.xor = 0;
	this.quickCompression = "";
	this.fullCompression = undefined;
    this.fullCompressionNrRequests = 0;
	this.elements = {};
}

// This is the destroy function for this object. It releases all the
// compressed values allocated by it.

CompressedValue.prototype.destroy = compressedValueDestroy;

function compressedValueDestroy()
{
    // if full compression is acivated, release the sequence compression
    this.destroySequences();
    
	// loop over the element table and release all allocated path
	// compressions.

	for(var elementId in this.elements) {
		var elementEntry = this.elements[elementId];
		for(var pathId in elementEntry) {
			if(pathId == "number")
				continue;
			this.compression.releasePath(pathId, 
										 elementEntry[pathId].simple);
		}
	}
}

// This function receives as input a path and the lowest data element
// ID above a simple value stored at this path. It also receives the
// type, the key and the compressed value calculated for the simple
// value stored under the given path and data element. If
// compressedValue is undefined or zero, this function removes an
// entry for this path and data element from the list of elements.
// Otherwise, it adds/modifies this entry for this path and data
// element.
// 'pathId' is the path of the simple element relative to the 
// root of the compressed value.
// remark: the 'type' and 'key' values are not used at the moment, 
// but are provided for future use.

CompressedValue.prototype.updateSimpleElement = 
	compressedValueUpdateSimpleElement;

function compressedValueUpdateSimpleElement(pathId, elementId, type, key,
                                            compressedValue)
{
	if(!compressedValue) // remove the path + data element
		return this.removeSimpleElement(pathId, elementId);

	var elementEntry;

	if(!(elementEntry = this.elements[elementId]))
		elementEntry = this.elements[elementId] = {};

	var valueEntry;

	if(!(valueEntry = elementEntry[pathId])) {
		valueEntry = elementEntry[pathId] = {};
		if(!elementEntry.number)
			elementEntry.number = 1;
		else
			elementEntry.number++;
	}

	if(valueEntry.simple == compressedValue)
		return; // nothing changed

	if(!valueEntry.simple) { // new entry
		this.numElements++;
        if(pathId == this.compression.rootPathId)
            this.numRootElements++;
        // if full compression is used, queue for addition to a sequence
        if(this.fullCompression !== undefined)
            this.addToFullCompression(pathId, elementId, valueEntry);
	} else { // modified entry
		// release the old compression
		this.compression.releasePath(pathId, valueEntry.simple);
		// remove the element from the xor
		this.xor = this.xor ^ valueEntry.quick;
        
        if(this.fullCompression !== undefined && valueEntry.sequencePos >= 0)
            // compression sequence already assigned, mark as modified
            this.modifiedInSequence(valueEntry.sequenceId,
                                    valueEntry.sequencePos, false);
	}

	valueEntry.simple = compressedValue;

	// modified / new element
	var pathCompression = this.compression.path(pathId, compressedValue);
	valueEntry.quick = pathCompression[0];
	valueEntry.value = pathCompression[1];

	// update the quick compression
	this.xor = this.xor ^ valueEntry.quick;
    if (pathId === this.compression.rootPathId && this.numElements === 1) {
        this.quickCompression = valueEntry.value;
    } else {
	    this.quickCompression = this.numElements + ":" + this.xor;
    }
}

// This function can be used to remove the entry for the given path ID and
// element ID. The path ID is relative to the root of the compressed 
// value.

CompressedValue.prototype.removeSimpleElement = 
	compressedValueRemoveSimpleElement;

function compressedValueRemoveSimpleElement(pathId, elementId)
{
	var elementEntry;

	if(!(elementEntry = this.elements[elementId]))
		return; // nothing to remove

	var valueEntry;

	if(!(valueEntry = elementEntry[pathId]))
		return; // nothing to remove

	// release the compression 
	this.compression.releasePath(pathId, valueEntry.simple);
	// remove the element from the xor
	this.xor = this.xor ^ valueEntry.quick;

    if(this.fullCompression !== undefined)
        // full compression active, remove for compression sequence
        this.removeFromSequence(valueEntry);
    
	// remove the entry
    delete elementEntry[pathId];
    if(!--elementEntry.number)
        delete this.elements[elementId];

	this.numElements--;
    if(pathId == this.compression.rootPathId)
        this.numRootElements--;

    if(this.numElements === 1 && this.numRootElements) {
        // there is a single remaining terminal and it is at the root of
        // the compressed tree: the compression is equal to the compressed
        // simple compression of the value.
        this.quickCompression = valueEntry.value;
    } else {
	    this.quickCompression = this.numElements + ":" + this.xor;
    }
}

// This function is called by the data source (the same module which calls
// updateSimpleElement() and removeSimpleElement()) to indicate that all 
// terminal modifications have been made and that any calculations needed
// to complete the calculation of the compressed value can be carried out
// now.
// If no full compression is being calculated, there is nothing to do here.
// If full compression is calculated, the calculation of modifies compression
// sequences is carried out here.

CompressedValue.prototype.completeUpdate = 
	compressedValueCompleteUpdate;

function compressedValueCompleteUpdate()
{
    if(this.fullCompression === undefined)
        return; // no full compression

    this.sortAndCompressModifiedSequences();
}

/////////////////////////////////
// Access to Compressed Values //
/////////////////////////////////

// This function returns an array of length 2, with the following fields:
// [<quick compression>, <full compression>]
// If the compressed value is simple (a tree with a single root node and no
// other terminal), both fields are defined and both are a number
// (even if the full compression is not being calculated).
// If the compressed value is not simple, the <quick compression> field
// is a string. If full compression has been requested, <full compression> is
// a number and, otherwise, undefined.

CompressedValue.prototype.getCompression = 
    compressedValueGetCompression;

function compressedValueGetCompression()
{
    if(typeof(this.quickCompression) == "number") // simple value
        return [this.quickCompression, this.quickCompression];
    else
        return [this.quickCompression, this.fullCompression];
}

// Returns the full compression of this compressed value. This is equal
// to the second element returned by getCompression().

CompressedValue.prototype.getFullCompression = 
    compressedValueGetFullCompression;

function compressedValueGetFullCompression()
{
    if(typeof(this.quickCompression) == "number") // simple value
        return this.quickCompression;
    else
        return this.fullCompression;
}

//////////////////////
// Full Compression //
//////////////////////

// returns true if full compression is being calculated and false 
// otherwise. 

CompressedValue.prototype.hasFullCompression =
    compressedValueHasFullCompression;

function compressedValueHasFullCompression()
{
    return (this.fullCompression !== undefined);
}

// This function activates the calculation of the full compression.
// It goes over all entries already in the 'elements' list, creates
// the compression sequences for these elements and then sorts the
// sequences and calculates their compression value. The sequences
// are sorted an compressed in decreasing order of ID, as a sequence
// under a smaller data element ID may need the compressed value of
// a sequence under a larger data element ID.
// This function returns the full compressed value as calculated based
// on the entries in the 'elements' table.
// If the full compression was already calculated this function does
// nothing and simply returns the full compressed value.

CompressedValue.prototype.requestFullCompression =
    compressedValueRequestFullCompression;

function compressedValueRequestFullCompression()
{
    this.fullCompressionNrRequests++;

    if(this.fullCompression !== undefined)
        return this.fullCompression; // already calculated

    this.sequences = {};
    this.sequences[this.dataElementId] = []; // this sequence always exists
    var pathAllocator = this.indexer.qcm;
    
    // loop over the entries in the 'elements' table and determine for
    // each one which sequence it belongs to. Push the entry at the end
    // of the sequence.

    for(var elementId in this.elements) {
        var elementEntry = this.elements[elementId];
        for(var pathId in elementEntry) {
            if(pathId == "number")
                continue;
            var entry = elementEntry[pathId];
            // set the suffix path on the entry
            entry.pathSortKey = pathAllocator.getPathSortKey(pathId);
            entry.dataElementId = elementId;
            // add the entry to the appropriate sequence
            this.addToSequences(entry);
        }
    }

    // sort and compress the sequences, this will also set the full compression
    // value on this.fullCompression
    this.sortAndCompressAllSequences();

    // prepare list of modifications for updates
    this.modifiedSequences = {};
    
    return this.fullCompression;
}

// This function should be called on each new entry in the 'elements'
// table added after the full compression has been calculated. 'entry'
// is the entry in the 'elements' table and pathId and elementId
// are the path and data element ID under which it is stored. This function
// then completes the entry (as required for full compression) and adds
// this entry to the appropriate compression sequence.

CompressedValue.prototype.addToFullCompression =
    compressedValueAddToFullCompression;

function compressedValueAddToFullCompression(pathId, elementId, entry)
{
    // set the suffix path on the entry
    entry.pathSortKey = this.indexer.qcm.getPathSortKey(pathId);
    entry.dataElementId = elementId;
    // add the entry to the appropriate sequence
    this.addToSequences(entry);
}

//////////////////////////////////////////
// Full Compression Sequence Allocation //
//////////////////////////////////////////

// This function finds the lowest data element equal or dominating
// the given data element whose parent has multiple data elements under
// the path leading to this data element. If no such data element is found
// lower than the compression data element (this.dataElementId) then the
// compression data element is returned.

CompressedValue.prototype.getSequenceId =
    compressedValueGetSequenceId;

function compressedValueGetSequenceId(elementId)
{
    if(elementId == this.dataElementId)
        return elementId;

    return this.indexer.dataElements.
        getLowestParentWithSiblings(elementId, this.dataElementId);
}

// This function is used to add a single entry in the 'elements' table
// (simple) or 'compoundElements' table (compound) to a compression
// sequence.  This function is given the entry itself and it first determines
// into which sequence this entry should be inserted and then inserts
// it into the sequence. If this is the first entry inserted into the
// sequence and the sequence ID is not equal to the compressed data
// element (this.dataElementId), this function creates a compound
// entry (in the compoundElements table) for this sequence, that is,
// for the data element whose ID is equal to that of the sequence. The
// function is then applied recursively for this compound entry.
// This function can be called both at the initial calculation 
// of the full compression and when elements are incrementally added after
// the initial calculation of the full compression.

CompressedValue.prototype.addToSequences =
    compressedValueAddToSequences;

function compressedValueAddToSequences(entry)
{    
    // get the sequence in which this element needs to be compressed
    // for a compound entry (which has parentId field, tart looking from 
    // the parent).
    var sequenceId = this.getSequenceId(entry.parentId ? 
                                        entry.parentId : entry.dataElementId);
    
    // the entry should be compressed under sequenceId
    if(!this.sequences[sequenceId]) {
        
        // note: we never enter this section for a sequence ID equal
        // to the compression data element, as that sequence is always defined

        this.sequences[sequenceId] = [];
        
        var dataElementEntry = this.indexer.dataElements.getEntry(sequenceId);

        // add parent and path to sequenceParents table
        this.addToSequenceParents(dataElementEntry.parent,
                                  dataElementEntry.pathId);
        
        // create a compound entry for this sequence
        var compoundEntry = {
            dataElementId: sequenceId,
            parentId: dataElementEntry.parent,
            pathId: dataElementEntry.pathId
        };
        var pathId = 
            this.indexer.qcm.diffPathId(dataElementEntry.pathId, this.pathId);
        compoundEntry.pathSortKey = this.indexer.qcm.getPathSortKey(pathId);

        // find the sequence for this compound entry
        this.addToSequences(compoundEntry);

        // add the compound entry
        if(!this.compoundElements)
            this.compoundElements = {};
        this.compoundElements[sequenceId] = compoundEntry;

        
    }

    // add to sequence
    entry.sequenceId = sequenceId;

    if(this.fullCompression === undefined)
        // initial compression, store directly in sequence array
        // (no need to record position - no removal can take place
        // before sorting)
        this.sequences[sequenceId].push(entry);
    else { // incremental update, store in modification entry
        var modEntry = this.getSeqModEntry(sequenceId, true);
        modEntry.added.push(entry);
        // the position is 'negative' (beginning at -1) to indicate that
        // this entry is still in the 'added' list.
        entry.sequencePos = -modEntry.added.length;
    }
}

// This function is given the ID of a data element 'parentId' which
// is equal to the compression data element (this.dataElementId)
// or dominated by it and a path ID under which this parent data element
// has more than one direct child data element (this path must also
// be an extension of the compression path, this.pathId). This function
// then adds this pair to the 'sequenceParents' table.
// If this pair is new and full compression has already been calculated
// (that is, we are now in an incremental update of the compression)
// this function checks whether there are any elements which should now
// be compressed in a sequence of a data element under this parent and
// path ID but are now still compressed in a higher sequence. If there are
// such elements, they are extracted from the sequence in which they are
// currently compressed and added to the new sequence in which they should
// be compressed.
// Note: the path ID given here is for the path relative to the indexer
// root, not the suffix path beginning at the compression path (that is,
// the path relative to the compressed sub-tree root).

CompressedValue.prototype.addToSequenceParents =
    compressedValueAddToSequenceParents;

function compressedValueAddToSequenceParents(parentId, pathId)
{
    if(!this.sequenceParents)
        this.sequenceParents = {};

    var parentEntry;
    if(!(parentEntry = this.sequenceParents[parentId])) {
        parentEntry = this.sequenceParents[parentId] = { number: 1 };
        parentEntry[pathId] = true;
    } else if(!parentEntry[pathId]) {
        parentEntry[pathId] = true;
        parentEntry.number++;
    } else
        return; // no new path added, nothing more to do

    if(this.fullCompression === undefined) 
        // not yet compressed, nothing more to do
        return;
        
    // extract entries which should be compressed under this parent and path
    // but were previously compressed under a higher sequence
    var extracted = this.extractExistingSequenceEntries(parentId, pathId);

    // add these entries under the new sequence they should be compressed under
    for(var i = 0, length = extracted.length ; i < length ; ++i) {
        this.addToSequences(extracted[i]);
    }
}

// Given a data element ID and a path ID, this function finds the first
// existing sequence dominating this data element (possibly the sequence
// for that data element itself) and extracts from it all entries
// whose path is equal to or extends the given path ID. These entries
// are removed from that sequence and returned by this function in an
// array.
// In the sorted part of the sequence, it is easy to find these entries,
// since the sequence is sorted by path. In the unsorted part of the
// sequence (new entries which were not yet sorted) we simply need
// to search through the whole list.
// Note: the path ID given here is for the path relative to the indexer
// root, not the suffix path beginning at the compression path (that is,
// the path relative to the compressed sub-tree root). In the process of 
// looking for the entries in the sequence it is converted to the suffix path.

CompressedValue.prototype.extractExistingSequenceEntries =
    compressedValueExtractExistingSequenceEntries;

function compressedValueExtractExistingSequenceEntries(elementId, pathId)
{
    var dataElements = this.indexer.getDataElements();
    
    // find the dominating sequence (result will be in elementId)
    while(!this.sequences[elementId])
        elementId = dataElements.getParentId(elementId);
    
    // get the (already sorted) sequence array
    var sequence = this.sequences[elementId];
    var length = sequence.length;
    
    // convert the path to the suffix of the path beginning at the path 
    // of the compressed value node.
    pathId = this.indexer.qcm.diffPathId(pathId, this.pathId);
    // range of sort keys which represent path equal or extending this path
    var pathSortKeyRange = this.indexer.qcm.extensionSortKeyRange(pathId);
    var lowKey = pathSortKeyRange[0];
    // first position where to extract
    var pos = binarySearch2(sequence, lowKey,
                            function(a, k) { return a.pathSortKey - k; },
                            0, length-1);
    
    // extract the elements beginning at this position until a position is
    // reached where the path sort key is greater than the  
    var extracted = [];
    var highKey = pathSortKeyRange[1];
    
    if(pos < length && sequence[pos] !== undefined &&
       sequence[pos].pathSortKey <= highKey) {

        // mark that there are removals from this point on
        this.modifiedInSequence(elementId, pos, true);
        
        do {
            var entry;
            extracted.push((entry = sequence[pos]));
            entry.sequenceId = undefined;
            sequence[pos] = undefined;
            pos++;
        } while(pos < length && (sequence[pos] === undefined ||
                                 sequence[pos].pathSortKey <= highKey));
    }

    // modification entry for this sequence (if any)
    var modEntry = this.getSeqModEntry(elementId);
    
    if(!modEntry || !modEntry.added.length)
        return extracted; // no unsorted entries for this sequence, done

    // scan the unordered entries and extract those with a path in the
    // required range.
    for(pos = 0, length = modEntry.added.length; pos < length ; ++pos) {
        var entry = modEntry.added[pos];
        if(entry.pathSortKey >= lowKey && entry.pathSortKey <= highKey) {
            extracted.push(entry);
            entry.sequenceId = undefined;
            sequence[pos] = undefined;
        }
    }
    
    return extracted;
}

// This function is given a parent data element ID and the ID of a path
// which until now had multiple children of the parent data element under it.
// This function first checks in the indexer's data element table whether
// there are still multiple children of the parent data element under this
// path. If yes, then nothing is done. If not, the parent and path are
// removed from the sequenceParents table. If there is exactly one
// child remaining at this path under the parent, the elements in
// the sequence for this data element are extracted from the sequence
// and inserted into some higher sequence.
// The compound entry of the sequence is removed and deleted from
// the sequence in which it appeared.

CompressedValue.prototype.checkMultipleChildren =
    compressedValueCheckMultipleChildren;

function compressedValueCheckMultipleChildren(parentId, pathId)
{
    var dataElements = this.indexer.getDataElements();
    if(dataElements.getNumDirectChildDataElements(parentId, pathId) > 1)
        return; // still has multiple children at this path

    // not a multi-child path under this parent anymore
    var parentEntry;

    if(!this.sequenceParents ||
       !(parentEntry = this.sequenceParents[parentId]) ||
       !parentEntry[pathId])
        return; // already removed

    delete parentEntry[pathId];
    if(!--parentEntry.number)
        delete this.sequenceParents[parentId];

    if(!children)
        // all children were removed - the sequences will be removed
        return;

    // there is one child remaining, we need to remove its sequence here
    var singleChildId;

    children.ids.forEach(function(t,id) { // iterates once
        singleChildId = id;
    });

    var elements = this.removeSequence(singleChildId);
    
    if(elements.length) {
        for(var i = 0, l = elements.length ; i < l ; ++i)
            this.addToSequences(elements[i]);
    }
}

// This function receives an 'entry' which should either be an entry
// in the 'elements' or the 'compoundElements' table. This function then
// removes it from the current sequence it belongs to. This can be
// used either when the entry is about to be removed or when the
// entry needs to be transferred from one sequence to another.
// This function sets an 'undefined' value in the corresponding
// position in the sequence, releases the compression values in the
// sequence from that point on and records the fact that compression
// should be recalculated at least from this place.
// This does not change the entry itself.

CompressedValue.prototype.removeFromSequence =
    compressedValueRemoveFromSequence;

function compressedValueRemoveFromSequence(entry)
{
    if(!entry.sequenceId)
        return; // not (yet) assigned a sequence
    
    if(entry.sequencePos < 0) {
        // entry was not yet sorted
        var modEntry = this.getSeqModEntry(entry.sequenceId);
        modEntry.added[-entry.sequencePos - 1] = undefined;
    } else {
        var sequence = this.sequences[entry.sequenceId];
        this.modifiedInSequence(entry.sequenceId, entry.sequencePos, true);
        sequence[entry.sequencePos] = undefined;
    }
}

// This function should be called when the entry in the given position
// of the given sequence is about to be changed or removed. This function
// then updates the modification entry of the sequence to record
// that recalculation of the sequence compression should begin at
// this position or earlier and releases all compression values assigned
// to this sequence from this position onward (until we reach a position
// which was already released).
// If 'resequence' is set then this also records the fact that the
// sequence should be reordered at least from this point on.
// This function should be called before the entry is removed or updated
// (as its value is needed in releasing the compression value).

CompressedValue.prototype.modifiedInSequence =
    compressedValueModifiedInSequence;

function compressedValueModifiedInSequence(sequenceId, pos, resequence)
{
    var modEntry = this.getSeqModEntry(sequenceId, true);

    if(resequence && modEntry.resequencePos > pos)
        modEntry.resequencePos = pos;
    
    if(pos >= modEntry.compressPos)
        return; // nothing more to do

    // release compression values from this point on

    var sequence = this.sequences[sequenceId];
    for(var i = modEntry.compressPos - 1 ; i >= pos ; --i)
        this.compression.releaseNext(i ? sequence[i-1].prefix : 0,
                                     sequence[i].value);
    
    modEntry.compressPos = pos;
}

// This function returns the entry in the 'modifiedSequences' table
// for the sequence with the given ID. If no such entry exists and
// 'create' is true, it is created (the sequence itself does not
// necessarily have to exist).

CompressedValue.prototype.getSeqModEntry = compressedValueGetSeqModEntry;

function compressedValueGetSeqModEntry(sequenceId, create)
{
    var modEntry;
    
    if((modEntry = this.modifiedSequences[sequenceId]) || !create)
        return modEntry;
    
    // create a new entry
    modEntry = this.modifiedSequences[sequenceId] = { added: [] };
    modEntry.resequencePos = modEntry.compressPos =
        this.sequences[sequenceId] ? this.sequences[sequenceId].length : 0;

    if(this.newModifiedSequences)
        this.newModifiedSequences.push(sequenceId);
        
    return modEntry;
}

// This function is used to release all sequences. It releases all compression
// values assigned to the sequences (but not to any of the elements). This
// should be called when full compression is turned-off or when the object
// is being destroyed.
// This function deletes all sequences, sequence parents and sequence
// modification entries and destroys the compoundElements table.

CompressedValue.prototype.destroySequences = compressedValueDestroySequences;

function compressedValueDestroySequences()
{
    if(this.fullCompression === undefined)
        return; // full compression not activated

    // loop over all sequences and release them
    for(var sequenceId in this.sequences)
        this.releaseSequence(sequenceId);

    delete this.sequences;
    delete this.sequenceParents;
    delete this.modifiedSequences;
    delete this.compoundElements;
}

// Given a sequence ID, this function releases the compression values
// allocated for this sequence.

CompressedValue.prototype.releaseSequence = compressedValueReleaseSequence; 

function compressedValueReleaseSequence(sequenceId)
{
    // get the modification entry (if exists) to see whether part
    // of the sequence was already released
    var mod = this.getSeqModEntry(sequenceId);
    var sequence = this.sequences[sequenceId];
            
    for(var i = (mod ? mod.compressPos : sequence.length) - 1 ;
        i >= 0 ; --i)
        this.compression.releaseNext(i ? sequence[i-1].prefix : 0,
                                     sequence[i].value);
}

// This function should be called when full compression is no longer needed
// (but one does not wish to destroy the compressed value object).
// In addition to destroying the sequences, it also removes all
// full-compression information from the entries of the elements table
// an sets the full compression to zero.

CompressedValue.prototype.deactivateFullCompression =
    compressedValueDeactivateFullCompression;

function compressedValueDeactivateFullCompression()
{
    if(this.fullCompression === undefined)
        return;

    if (--this.fullCompressionNrRequests === 0) {
        this.destroySequences();
        for(var elementId in this.elements) {
            var entry = this.elements[elementId];
            delete entry.sequenceId;
            delete entry.sequencePos;
            delete entry.prefix;
            delete entry.dataElementId;
            delete entry.pathSortKey;
        }
        this.fullCompression = undefined;
    }
}

// This function is called when the given sequence should be removed.
// If the sequence is not empty, its compression values are first released.
// In that case, this function returns an array with all elements which
// still remain in the sequence (otherwise, it returns an empty array).
// The sequence is removed from the list of sequences and its compound entry
// is removed.

CompressedValue.prototype.removeSequence = compressedValueRemoveSequence;

function compressedValueRemoveSequence(sequenceId)
{
    var sequence = this.sequences[sequenceId];
    var entries = [];
    
    if(!sequence) 
        // sequence does not exist (possibly never created)
        return entries;

    if(sequence.length) {
        // release any values still in the sequence
        this.releaseSequence(sequenceId);
        // extract remaining entries (to be returned to the caller)
        for(var i = 0, l = sequence.length ; i < l ; ++i) {
            if(sequence[i])
                entries.push(sequence[i]);
        }
    }

    var modEntry = this.getSeqModEntry(sequenceId);

    if(modEntry) {
        var added;
        if((added = modEntry.added).length) {
            // extract these entries to be returned to the caller
            for(var i = 0, l = added.length ; i < l ; ++i) {
                if(added[i])
                    entries.push(added[i]);
            }
        }
    }
    
    delete this.sequences[sequenceId];

    if (sequenceId === this.dataElementId) { // this is the top sequence
        assert(this.compoundElements === undefined ||
               !(sequenceId in this.compoundElements));
        // Everything has been deleted
        this.fullCompression = 0;        
        return entries;
    }

    // find the compound entry for this sequence
    var compoundEntry = this.compoundElements[sequenceId];

    // remove compound entry from the sequence in which it is compressed
    this.removeFromSequence(compoundEntry);

    // check whether there is more than one sibling of this sequence
    // still remaining under the same parent and path (and if not, take
    // appropriate actions).
    this.checkMultipleChildren(compoundEntry.parentId, compoundEntry.pathId);

    // delete the compound entry
    delete this.compoundElements[sequenceId];

    return entries;
}



//////////////////////////////////////
// Sequence Sorting and Compression //
//////////////////////////////////////

// this is the comparison function to be used in sorting the elements in
// a sequence if we want the comparison of two elements with the same
// path sort key (necessarily compound elements) to be based on the
// compressed value of these elements.
// Undefined entries are placed at the end of the ordering. 

CompressedValue.prototype.entryCompFuncByValue =
    compressedValueEntryCompFuncByValue;

function compressedValueEntryCompFuncByValue(entry1, entry2)
{
    if(!entry1)
        return -1;

    if(!entry2)
        return 1;
    
    var comp;
    
    if(comp = (entry1.pathSortKey - entry2.pathSortKey))
        return comp;

    return entry1.value - entry2.value;
}

// This function is used when full compression is first activated and
// after all elements were inserted into their respective sequences.
// This function goes over all sequences in the 'sequences' table, in
// decreasing order of data element ID. It sorts each sequence based on the
// pathSortKey of the entries. If two entries in the sequence have the same
// path sort key then they must be compound entries. These entries are then
// ordered based on either:
// 1. The compression value stored under the 'value' field of the entry.
// 2. The ordering of the data elements in the ordered set to which they
//    belong (this is not yet supported, as sorting is not yet implemented).
// After sorting the sequence, this function calculates the compression
// of this sequence (and, at the same time, sets the 'sequencePos' on each
// entry in the sequence). The compressed value of the sequence is then set
// on teh compound entry for the data element of the sequence (if the
// data element of the sequence is lower than the compression data element)
// or on the 'fullCompression' field if the sequence is the sequence
// for the compression data element (this.dataElementId).
// Remark: because sorting and compressing takes place in decreasing order
// of sequence ID, the compression of each compound entry is calculated
// before it has to be used in the sorting and compression of the sequence
// in which the compound entry appears.

CompressedValue.prototype.sortAndCompressAllSequences =
    compressedValueSortAndCompressAllSequences;

function compressedValueSortAndCompressAllSequences()
{
    // get the list of sequences to sort and sort it in decreasing order
    var sequenceList = Object.keys(this.sequences);
    var length;
    
    if((length = sequenceList.length) > 1)
        sequenceList.sort(function(a,b) { return b - a; });

    for(var i = 0 ; i < length ; ++i) {
        var sequenceId = sequenceList[i];
        var sequence = this.sequences[sequenceId];

        if(sequence.length > 1)
            // sort the sequence
            sequence.sort(this.entryCompFuncByValue);
        
        // compress the sequence (and assign positions)
        this.compressSequence(sequenceId, 0);
    }
}

// This function should be called after modifications have been accumulated
// in the sequences used in calculating the full compression. This function
// then reorders these sequences and re-compresses them, as needed.
// This takes place in decreasing order of sequence ID, as modifications
// to one sequence may influence a sequence with a lower sequence number.

CompressedValue.prototype.sortAndCompressModifiedSequences =
    compressedValueSortAndCompressModifiedSequences;

function compressedValueSortAndCompressModifiedSequences()
{
    // get the list of sequences which were modified
    var modSequenceList = Object.keys(this.modifiedSequences);
    var modSeqLen;
    
    if((modSeqLen = modSequenceList.length) > 1)
        modSequenceList.sort(function(a,b) { return b - a; });
    
    for(var modSeqPos = 0 ; modSeqPos < modSeqLen ; ++modSeqPos) {
        
        this.newModifiedSequences = [];
        var sequenceId = modSequenceList[modSeqPos];
        var modEntry = this.modifiedSequences[sequenceId];
        var added = modEntry.added;
        
        // sort the added entries (if any)
        if(added.length > 1)
            added.sort(this.entryCompFuncByValue);

        // merge modifications into sequence and compress
        var sequence = this.sequences[sequenceId];
        
        if(added[0]) {
            // determine where re-ordering of the sequence needs to begin
            this.modifiedInSequence(sequenceId,
                                    binarySearch2(sequence, added[0],
                                                  this.entryCompFuncByValue, 0,
                                                  modEntry.resequencePos-1),
                                    true);
        }

        mergeArrays(sequence, added, this.entryCompFuncByValue,
                    modEntry.resequencePos);
        
        if(!sequence.length) // if the sequence is now empty, delete it
            this.removeSequence(sequenceId);
        else // re-compress the sequence
            this.compressSequence(sequenceId, modEntry.compressPos);
        
        if(!this.newModifiedSequences.length)
            continue;

        // insert new modified sequences added by the operation above
        // (should usually be at most one)
        var compFunc = function(x,y) { return y - x;};
        for(var i = 0, l = this.newModifiedSequences.length ; i < l ; ++i){
            var modifiedSequenceId = this.newModifiedSequences[i];
            modSequenceList.splice(binarySearch2(modSequenceList, 
                                                 modifiedSequenceId,
                                                 compFunc,
                                                 modSeqPos),
                                   0, modifiedSequenceId);
            modSeqLen++;
        }
    }

    this.modifiedSequences = {};
    this.newModifiedSequences = undefined;
}

// This function compresses the sequence with the given ID beginning
// at position 'fromPos'. It is assumed that the sequence is already
// compressed up to that point. This function also records the
// position of each compressed entry on the entry. This function does
// not release any existing compressed values (this should have happened
// before).
// This function also stores the compressed value for the sequence
// (the compressed value of the last element in the sequence)
// on the compound element representing this sequence or (if this is
// the top sequence) as the full compression of this compressed value object.
// If a compound element which is already compressed in a sequence is
// modified, it is removed from its current position in the sequence
// and inserted as a new element to be added to that sequence.

CompressedValue.prototype.compressSequence = compressedValueCompressSequence;

function compressedValueCompressSequence(sequenceId, fromPos)
{
    var sequence = this.sequences[sequenceId];

    if(fromPos >= sequence.length)
        return; // nothing to do
    
    // compress the sequence (and assign positions)
    var prefix = fromPos ? sequence[fromPos-1].prefix : 0;
    for(var j = fromPos, l = sequence.length ; j < l ; ++j) {
        var entry = sequence[j];
        prefix = entry.prefix = this.compression.next(prefix, entry.value);
        entry.sequencePos = j;
    }

    // set the compression value on the last element in the sequence
    // as the compression value for the compound entry for this sequence
    // (or for the whole compressed value object, if this is the top
    // sequence).
    if(sequenceId == this.dataElementId)
        this.fullCompression = prefix;
    else {
        var compoundEntry = this.compoundElements[sequenceId];
        if(compoundEntry.value == prefix)
            return; // didn't change

        compoundEntry.value = prefix;
        
        if(this.fullCompression !== undefined && 
           compoundEntry.sequencePos >= 0) {

            // the position of the compound in its sequence may have changed,
            // extract from the sequence and add to the 'added' list
            this.removeFromSequence(compoundEntry);
            var modEntry = this.getSeqModEntry(compoundEntry.sequenceId);
            modEntry.added.push(compoundEntry);
        }
    }
}
