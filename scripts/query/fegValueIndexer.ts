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

/// <reference path="qcm.d.ts" />
/// <reference path="../feg/cdl.ts" />
/// <reference path="../feg/elementReference.ts" />

// Logic copied from: rawIndexer.js
// FEGValueIndexer accepts FEG runtime values.

interface IndexerDataSupplier {
    canFillPathNode(pathNode: PathNode): boolean;
    fillPathNode(pathNode: PathNode, ids: SupplierDataElementIdMappingRange[]): void;
    unloadPathNode(pathNode: PathNode): void;
    getRawDataDescription(): RawDataDescription;
}

class FEGValueIndexer extends IdentityIndexer {

    tracedPaths: Set<number> = new Set<number>();

    // This function is the main external interface of this class. It allows
    // for a moon object to be loaded into the indexer. Each moon object
    // loaded by this function is loaded at the root of the indexer, under
    // new data element IDs.
    // If 'identity' is not undefined, it is the base identity of all top
    // data elements added by this operation. It shoudl be a valid identity
    // value, that is, either a negative full compression number, a quick
    // compression string or an element ID allocated from the element ID pool.
    // It is not checked here that the identity given is valid and it is
    // the responsibility of the calling function to allocate this value
    // properly (from the compression module or the data element ID pool).

    destroy(): void {
        this.tracedPaths.forEach((pathId: number): void => {
            if (pathId in this.pathNodesById) {
                this.decPathNodeTracing(this.pathNodesById[pathId]);
            }
        });
        this.tracedPaths = undefined;
        super.destroy();
    }

    addRawObject(obj: any, identity: any): void {
        this.setAt(this.qcm.getRootPathId(), undefined, obj, true, identity);
    }

    // This function determines the type of the object and calls the specific
    // function which adds it to the indexer. 'obj' is then added to the 
    // indexer at the path with the given pathId and under the data element ID
    // 'parentId'. 'parentId' is allowed to be undefined when 'pathId'
    // is the ID of the root path. 'isDataElement' indicates whether
    // the node created should be a data element or not.
    // When 'isDataElement' is true, one may optionally also specify
    // 'identity'. If given, this is the base identity which is assigned
    // to this data element.
    // The function returns true if some node was created for the structure
    // defined by 'obj' and false otherwise ('obj' may be empty if
    // it does not contain any terminals, for example, an attribute-value 
    // structure whose every path ends with an empty attribute value).

    setAt(pathId: number, parentId: number, obj: any, isDataElement: boolean, identity: any): boolean {
        if (obj instanceof Array && obj.length === 1)
            obj = obj[0];
        if (obj instanceof MoonOrderedSet && obj.os.length === 1)
            obj = obj.os[0];

        if (typeof(obj) != "object")
            return this.setTerminalAt(pathId, parentId, obj, isDataElement, 
                                      identity);
        else if (obj instanceof Projector)
            return this.setProjectorAt(pathId, parentId, obj, isDataElement, 
                                       identity);
        else if (obj instanceof Array)
            return this.setOrderedSetAt(pathId, parentId, obj, isDataElement, 
                                        identity);
        else if (obj instanceof MoonOrderedSet)
            return this.setOrderedSetAt(pathId, parentId, obj.os, isDataElement, 
                                        identity);
        else if (obj instanceof RangeValue)
            return this.setRangeAt(pathId, parentId, obj, isDataElement,
                                   identity);
        else if (obj instanceof Negation)
            return this.setNegationAt(pathId, parentId, obj, isDataElement, 
                                      identity);
        else if (obj instanceof ElementReference)
            return this.setElementReference(pathId, parentId, obj, isDataElement, 
                                            identity);
        else
            return this.setAttributeValueAt(pathId, parentId, obj, isDataElement, 
                                            identity);
    }

    // Set a simple terminal value at this path and under the given parent.
    // If defunArgs is provided and the value is a string which is found in 
    // the argumet name list of defunArgs, either a "variableIndex" terminal is 
    // created or an object is substituted for the variable (this depends
    // on the information stored in the defunArgs object).
    // In all other cases, the type and value of the given 'obj' are queued
    // for addition.
    // If 'isDataElement' is true and 'identity' is not undefined, the value
    // of 'identity' is set as the base identity of the data element created
    // by this function.

    setTerminalAt(pathId: number, parentId: number, obj: any, isDataElement: boolean, identity: any) : boolean {
        var type = typeof(obj);

        if (type != "string" && type != "number" && type != "boolean")
            return false; // probably undefined

        var pathNode = this.addPath(pathId);
        var elementId: number;

        if (!this.tracedPaths.has(pathId)) {
            this.incPathNodeTracing(pathNode);
            this.tracedPaths.add(pathId);
        }

        if (isDataElement) {
            elementId = InternalQCMIndexer.getNextDataElementId();
            this.addDataElementNode(pathNode, elementId, parentId, identity);
        } else {
            elementId = parentId;
            this.addNonDataElementNode(pathNode, elementId);
        }

        this.setKeyValue(pathNode, elementId, type, obj);
        return true;
    }

    setElementReference(pathId: number, parentId: number, obj: ElementReference, isDataElement: boolean, identity: any): boolean {
        var pathNode = this.addPath(pathId);
        var elementId: number;

        if (isDataElement) {
            elementId = InternalQCMIndexer.getNextDataElementId();
            this.addDataElementNode(pathNode, elementId, parentId, identity);
        } else {
            elementId = parentId;
            this.addNonDataElementNode(pathNode, elementId);
        }

        this.setKeyValue(pathNode, elementId, "elementReference", obj);
        return true;
    }

    // Set a simple projector terminals at this path and under the given parent.
    // If 'isDataElement' is true and 'identity' is not undefined, the value
    // of 'identity' is set as the base identity of the data element created
    // by this function.

    setProjectorAt(pathId: number, parentId: number, obj: Projector, isDataElement: boolean, identity: any): boolean {
        var pathNode = this.addPath(pathId);
        var elementId: number;

        if (isDataElement) {
            elementId = InternalQCMIndexer.getNextDataElementId();
            this.addDataElementNode(pathNode, elementId, parentId, identity);
        } else {
            elementId = parentId;
            this.addNonDataElementNode(pathNode, elementId);
        }

        this.setKeyValue(pathNode, elementId, "projector", 0);
        return true;
    }

    // This function adds an ordered set at the given path under the given
    // parent node. The 'isDataElement' argument is ignored, since the
    // elements of the ordered set must anyway be added as data elements.
    // The function returns true if any elements were actually added to the
    // indexer and false if not.
    // If 'identity' is not undefined, the value of 'identity' is set as the
    // base identity of the data elements created by this function.

    setOrderedSetAt(pathId: number, parentId: number, obj: Array<any>, isDataElement: boolean, identity: any): boolean {
        var elements = obj;

        if (elements.length == 0)
            return false; // nothing to add

        var actuallyAdded = 0;

        for(var i = 0, l = elements.length ; i < l ; ++i) {
            if (this.setAt(pathId, parentId, elements[i], true, identity))
                actuallyAdded++;
        }

        return (actuallyAdded != 0);
    }

    // adds a range operator (with all the operands under it)
    // If 'isDataElement' is true and 'identity' is not undefined, the value
    // of 'identity' is set as the base identity of the data element created
    // by this function.

    setRangeAt(pathId: number, parentId: number, obj: RangeValue, isDataElement: boolean, identity: any): boolean {
        var pathNode = this.addPath(pathId);
        var elementId: number;

        if (isDataElement) {
            elementId = InternalQCMIndexer.getNextDataElementId();
            this.addDataElementNode(pathNode, elementId, parentId, identity);
        } else {
            elementId = parentId;
            this.addNonDataElementNode(pathNode, elementId);
        }

        this.setKeyValue(pathNode, elementId, "range",
                         [!obj.closedLower, !obj.closedUpper]);

        // TODO: internal storage of all values?
        this.setAt(pathId, elementId, obj.min, true, undefined);
        this.setAt(pathId, elementId, obj.max, true, undefined);

        return true;
    }

    // adds a negation operator (with all the operands under it)
    // If 'isDataElement' is true and 'identity' is not undefined, the value
    // of 'identity' is set as the base identity of the data element created
    // by this function.

    setNegationAt(pathId: number, parentId: number, obj: Negation, isDataElement: boolean, identity: any): boolean {
        var pathNode = this.addPath(pathId);
        var elementId: number;

        if (isDataElement) {
            elementId = InternalQCMIndexer.getNextDataElementId();
            this.addDataElementNode(pathNode, elementId, parentId, identity);
        } else {
            elementId = parentId;
            this.addNonDataElementNode(pathNode, elementId);
        }

        this.setKeyValue(pathNode, elementId, "negation", 0);

        var negated = obj.queries;

        for(var i = 0, l = negated.length ; i < l ; ++i)
            this.setAt(pathId, elementId, negated[i], true, undefined);

        return true;
    }

    // this sets an attribute value structure.
    // If 'isDataElement' is true and 'identity' is not undefined, the value
    // of 'identity' is set as the base identity of the data element created
    // by this function.

    setAttributeValueAt(pathId: number, parentId: number, obj: any, isDataElement: boolean, identity: any): boolean {
        var numAttrs = 0; // number of attributes actually added.

        var pathNode = this.addPath(pathId);
        var elementId: number;

        if (isDataElement) {
            elementId = InternalQCMIndexer.getNextDataElementId();
            this.addDataElementNode(pathNode, elementId, parentId, identity);
        } else {
            elementId = parentId;
            this.addNonDataElementNode(pathNode, elementId);
        }

        for(var attr in obj) {

            var writable = (attr[0] == '^'); 
            if (writable) // the caret is not part of the attribute name
                attr = attr.substr(1);

            // check whether the addition of this path implies potentially
            // new identified paths.
            // TODO: this.checkForNewIdentifiedPaths(pathId, attr);

            var attrPathId = this.qcm.allocatePathId(pathId, attr);

            if (this.setAt(attrPathId, elementId, obj[attr], false, undefined))
                numAttrs++;

            this.qcm.releasePathId(attrPathId); // stays allocated in the path node
        }

        if (!numAttrs) {
            this.removeNode(pathNode, elementId);
            return false;
        }

        // set the type to attributeValue, but with an undefined key.
        this.setKeyValue(pathNode, elementId, "attributeValue", undefined);
        this.setKeyValue(pathNode, elementId, "attribute", true);
        var nodeEntry = pathNode.nodes.get(elementId);
        nodeEntry.objectValue = obj;

        return true;
    }

    setTopLevelAttributeValue(obj: any, identity: any): number {
        var rootPathId: number = this.qcm.getRootPathId();
        var pathNode = this.addPath(rootPathId);
        var elementId: number = InternalQCMIndexer.getNextDataElementId();

        this.addDataElementNode(pathNode, elementId, undefined, identity);
        this.setAttributeValueAt(rootPathId, elementId, obj, false, identity);
        return elementId;
    }

    // This function is to be used when a syntax error is detected. 
    // pathId and parentId indicate the place at which the error has occurred
    // and 'obj' is the raw object in which the error was found. 'message'
    // is a string with and error message. 

    syntaxError(pathId: number, parentId: number, obj: any, message: string) {
        var pathAttrs = this.qcm.getPathStrings(pathId);
        var pathStr = "";

        for(var i = 0, l = pathAttrs.length ; i < l ; ++i) {
            if (i !== 0)
                pathStr += ":" + pathAttrs[i];
            else
                pathStr = pathAttrs[0];
        }

        console.log("syntax error at path <", pathStr, ">: ", obj);
    }

    // This function takes one object with equally sized os'es (arrays) of
    // simple values and adds them to the indexer as if they were attribute-
    // value objects per row, i.e. {a:o(1,2), b:o("x","y")} is added as if it
    // were o({a:1,b:"x"}, {a:2,b:"y"}). For large, tabular data sets, this is
    // much more efficient.

    addColumnObjects(obj: {[attr: string]: any[]}): void {
        var rootPathId: number = this.qcm.getRootPathId()
        var rootPath: PathNode = this.addPath(rootPathId);
        var firstDataElementId: number;
        var nrDataElements: number;
        var firstAttr: string = Object.keys(obj)[0];

        if (firstAttr === undefined) {
            return;
        }
        nrDataElements = obj[firstAttr].length;
        if (nrDataElements === 0) {
            return;
        }
        firstDataElementId = InternalQCMIndexer.getDataElementIdRange(nrDataElements);
        for (var i: number = 0; i < nrDataElements; i++) {
            this.addDataElementNode(rootPath, firstDataElementId + i, undefined, undefined);
        }
        for (var attr in obj) {
            var pathId: number = this.qcm.allocatePathId(rootPathId, attr);
            var pathNode: PathNode = this.addPath(pathId);
            var values: any[] = obj[attr];
            this.qcm.releasePathId(pathId);
            if  (values !== undefined) {
                for (var i: number = 0; i < nrDataElements; i++) {
                    var value_i: any = values[i];
                    if (value_i !== undefined) {
                        var type_i = typeof(value_i);
                        var elementId: number = firstDataElementId + i;
                        this.addNonDataElementNode(pathNode, elementId);
                        this.setKeyValue(pathNode, elementId, type_i, value_i,
                                         true);
                    }
                }
            }
        }
    }

    // Dynamic data loading interface

    // When set, the object that can fill path nodes on request
    dataSupplier: IndexerDataSupplier;

    // The ranges of reserved data element ids, corresponding to the order of
    // the data in the dataSupplier.
    reservedRanges: SupplierDataElementIdMappingRange[];

    // Sum of all range sizes in reservedRanges
    totalNrReservedDataElementIds: number;

    // Tracks unloaded data element ids per path node id. If a path node id is 
    // not in the map, it must load new data elements immediately.
    unloadedDataElementIds: Map<number, SupplierDataElementIdMappingRange[]>;

    setDataSupplier(dataSupplier: IndexerDataSupplier): void {
        this.dataSupplier = dataSupplier;
        this.reservedRanges = [];
        this.totalNrReservedDataElementIds = 0;
        this.unloadedDataElementIds = new Map<number, SupplierDataElementIdMappingRange[]>();
    }

    announceNewDataElements(firstNewRowNr: number, nrDataElements: number): void {
        var rootPathId: number = this.qcm.getRootPathId();

        this.announceNewDataElementsForPathId(rootPathId, undefined, firstNewRowNr, nrDataElements);
    }

    announceNewDataElementsForPathId(pathId: number, parentDataElementId: number, firstNewRowNr: number, nrDataElements: number): void {
        var path: PathNode = this.addPath(pathId);
        var firstDataElementId: number =
            InternalQCMIndexer.getDataElementIdRange(nrDataElements);
        var newMappingRange: SupplierDataElementIdMappingRange = {
            rowNr: firstNewRowNr,
            nrDataElements: nrDataElements,
            firstDataElementId: firstDataElementId,
            paths: undefined
        };

        // It could be slightly more efficient to join ranges, but that would
        // just be code that won't be used and tested for a long time.
        this.reservedRanges.push(newMappingRange);
        this.totalNrReservedDataElementIds += nrDataElements;
        this.expectAdditionalDataElementNum(nrDataElements);
        this.expectNodeNum(path, this.totalNrReservedDataElementIds);
        for (var i: number = 0; i < nrDataElements; i++) {
            this.addDataElementNode(path, firstDataElementId + i,
                                    parentDataElementId, undefined);
        }
        for (var pathIdStr in this.pathNodesById) {
            var pathId: number = Number(pathIdStr);
            if (this.unloadedDataElementIds.has(pathId)) {
                this.unloadedDataElementIds.get(pathId).push(newMappingRange);
            } else if (pathId !== globalInternalQCM.getRootPathId()) {
                this.dataSupplier.fillPathNode(this.pathNodesById[pathId],
                                               [newMappingRange]);
            }
        }
    }

    createPathNode(pathId: number): PathNode {
        if (this.pathNodesById[pathId] !== undefined)
            return this.pathNodesById[pathId]; // already created
        // Make sure tracing triggers loading
        if (this.unloadedDataElementIds !== undefined) {
            this.unloadedDataElementIds.set(pathId, this.reservedRanges.slice(0));
        }
        // And create the path node
        return super.createPathNode(pathId);
    }

    // this function removes the path node when no longer needed. When the
    // path is again activated, data will be loaded back into the path node.
    removePathNode(pathNode: PathNode): void {
        if (this.unloadedDataElementIds !== undefined) {
            this.unloadedDataElementIds.delete(pathNode.pathId);
        }
        super.removePathNode(pathNode);
    }

    // Adds simple values to a pathnode, starting at firstDataElementId.
    addColumnRange(pathNode: PathNode, values: any[], firstDataElementId: number): void {
        var firstDataElementId: number;
        var nrDataElements: number = values.length;

        this.expectNodeNum(pathNode, this.totalNrReservedDataElementIds);
        
        for (var i: number = 0; i < nrDataElements; i++) {
            var value_i: any = values[i];
            if (value_i !== undefined && value_i !== null && typeof(value_i) !== "object") {
                var type_i = typeof(value_i);
                var elementId: number = firstDataElementId + i;
                this.addNonDataElementNode(pathNode, elementId);
                this.setKeyValue(pathNode, elementId, type_i, value_i, true);
            }
        }
    }

    getRawDataDescription(): RawDataDescription {
        return this.dataSupplier !== undefined? this.dataSupplier.getRawDataDescription(): [];
    }

    //
    // Activation, Tracing and sub-tree monitoring interface 
    //

    pathNodeActivated(pathNode: PathNode) {
        if (this.unloadedDataElementIds !== undefined &&
              this.unloadedDataElementIds.has(pathNode.pathId) &&
              this.dataSupplier !== undefined &&
              this.dataSupplier.canFillPathNode(pathNode)) {
            var rangeMaps = this.unloadedDataElementIds.get(pathNode.pathId);
            this.dataSupplier.fillPathNode(pathNode, rangeMaps);
            this.unloadedDataElementIds.delete(pathNode.pathId);
        }
    }

    // when deactivated, remove the path node
    pathNodeDeactivated(pathNode: PathNode) {
        if (this.dataSupplier !== undefined) {
            this.dataSupplier.unloadPathNode(pathNode);
        }
        this.removePathNode(pathNode);
    }
    
    // nothing to do here, as the element are loaded upon first activation
    // (whether due to tracing or monitoring) and this function is only called
    // when tracing is activated when monitoring is already active
    pathNodeTracingActivated(pathNode: PathNode) {
    }

    // nothing to do here, as the element are cleared upon path deactivation
    // and this function is only called when tracing is deactivated when
    // monitoring (and therefore also the path) is still active
    pathNodeTracingDeactivated(pathNode: PathNode) {
    }

    subTreeMonitoringActivated(pathNode: PathNode) {
    }

    subTreeMonitoringDeactivated(pathNode: PathNode) {
    }

    inSubTreeActivated(pathNode: PathNode, elementId: number) {
    }

    inSubTreeDeactivated(pathNode: PathNode, elementId: number) {
    }

    inSubTreeOnlyAsRootActivated(pathNode: PathNode, elementId: number) {
    }

    inSubTreeOnlyAsRootDeactivated(pathNode: PathNode, elementId: number) {
    }

    inSubTreeWithAttrActivated(pathNode: PathNode, elementId: number) {
    }

    inSubTreeWithAttrDeactivated(pathNode: PathNode, elementId: number) {
    }

}
