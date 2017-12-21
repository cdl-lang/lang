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

// FEGReplaceableValueIndexer accepts FEG runtime values and can replace them
// with others, generating updates understood by Query.
// Objects are supposed to be small.

const enum FRVIDataElementType {
    terminal,
    attributeValue,
    range,
    negation
}

// Holds information about the data element id, type and children. Note that
// for ranges and negation the attribute is meaningless, and the children's path
// id is identical to their parent's path id.
interface FRVIDataElementIndex {
    dataElementId: number;
    type: FRVIDataElementType;
    originalType: string;
    originalValue: any;
    children?: {[attr: string]: {
        pathId: number;
        dataElements: FRVIDataElementIndex[];
    }};
}


/// An indexer that can be initialized and updated with a "FEG" value, i.e. a
/// Javascript object without nested arrays. 
class FEGReplaceableValueIndexer extends IdentityIndexer {

    /// Represents the data last stored via replaceAt.
    dataElementIndex: FRVIDataElementIndex[] = [];

    /// When true, give each node its own data element id in order to save the
    /// query mechanism a bit of work when replacing {a:"x"} by {a: o("x", "y")}.
    /// Set this to true for query indexers, false for others.
    alwaysUniqueDataElementId: boolean = false;
    /// When true, updating an os results in as little change to the data elements
    /// as possible, disregarding the ordering of the elements. E.g., changing
    /// o("a","b","c") into o("c","b") will result in deleting "a" (and the
    /// elements in the order o("b","c")).
    minimizeDataElementMovement: boolean = false;

    /// Replaces the content of this indexer with obj.
    /// TODO: c(); add elements with ascending data element ids in order of arguments.
    replaceRawObject(obj: any): void {
        var rootPathId: number = this.qcm.getRootPathId();
        var lastUpdate: number = this.replaceAt(rootPathId, undefined, obj,
                                                true, this.dataElementIndex, 0);

        if (lastUpdate < this.dataElementIndex.length) {
            this.removeDataElements(rootPathId, this.dataElementIndex,
                                    lastUpdate);
        }
    }

    // Replaces all objects in the given path stored under dataElementIndex
    // starting at pos, and returns the position of the next element in
    // dataElementIndex. If there are elements left in dataElementIndex, but
    // there is no data to replace it with, these elements have to be removed.
    replaceAt(pathId: number, parentId: number, obj: any, requiresOwnId: boolean, dataElementIndex: FRVIDataElementIndex[], pos: number): number {
        var lastUpdate: number;

        if (typeof(obj) != "object") {
            lastUpdate = this.replaceTerminalAt(pathId, parentId, obj,
                             typeof(obj), requiresOwnId, dataElementIndex, pos);
        } else if (obj instanceof Projector) {
            lastUpdate = this.replaceTerminalAt(pathId, parentId, 0,
                             "projector", requiresOwnId, dataElementIndex, pos);
        } else if (obj instanceof Array) {
            lastUpdate = this.replaceOrderedSetAt(pathId, parentId, obj,
                                                  dataElementIndex, pos, false);
        } else if (obj instanceof MoonOrderedSet) {
            lastUpdate = this.replaceOrderedSetAt(pathId, parentId, obj.os,
                                                  dataElementIndex, pos, false);
        } else if (obj instanceof RangeValue) {
            lastUpdate = this.replaceRangeAt(pathId, parentId, obj,
                                          requiresOwnId, dataElementIndex, pos);
        } else if (obj instanceof SubStringQuery) {
            lastUpdate = this.replaceStringMatchAt(pathId, parentId, obj,
                                          requiresOwnId, dataElementIndex, pos);
        } else if (obj instanceof Negation) {
            lastUpdate = this.replaceNegationAt(pathId, parentId, obj,
                                          requiresOwnId, dataElementIndex, pos);
        } else if (obj instanceof ElementReference) {
            lastUpdate = this.replaceTerminalAt(pathId, parentId, obj,
                      "elementReference", requiresOwnId, dataElementIndex, pos);
        } else {
            lastUpdate = this.replaceAttributeValueAt(pathId, parentId, obj,
                                          requiresOwnId, dataElementIndex, pos);
        }
        return lastUpdate;
    }

    terminalNodeIsEqual(pathNode: PathNode, elementId: number, type: string, key: any): boolean {
        if (pathNode.nodes.has(elementId)) {
            var nodeEntry = pathNode.nodes.get(elementId);
            return nodeEntry.type === type && nodeEntry.key === key;
        } else {
            return false;
        }
    }

    replaceTerminalAt(pathId: number, parentId: number, obj: any, type: string, requiresOwnId: boolean, dataElementIndex: FRVIDataElementIndex[], pos: number): number {
        if (type !== "string" && type !== "number" && type !== "boolean" &&
              type !== "elementReference" && type !== "projector") {
            // probably undefined
            return pos;
        }

        var pathNode = this.addPath(pathId);
        var elementId: number;

        // make sure the path node is not destroyed if it becomes temporarily
        // empty
        this.keepPathNodeActive(pathNode);
        
        if (pos < dataElementIndex.length &&
              dataElementIndex[pos].type === FRVIDataElementType.terminal) {
            // We can directly replace the contents of dataElementIndex[pos],
            // which will be done on setKeyValue
            elementId = dataElementIndex[pos].dataElementId;
        } else {
            // Cannot replace, must add new element
            if (pos < dataElementIndex.length) {
                // First clean up nested structures
                this.removeSingleDataElement(pathId, dataElementIndex[pos]);
            }
            if (requiresOwnId || parentId === undefined ||
                this.alwaysUniqueDataElementId) {
                elementId = InternalQCMIndexer.getNextDataElementId();
                this.addDataElementNode(pathNode, elementId, parentId);
            } else {
                elementId = parentId;
                this.addNonDataElementNode(pathNode, elementId);
            }
            dataElementIndex[pos] = {
                // pathId: pathId,
                dataElementId: elementId,
                type: FRVIDataElementType.terminal,
                originalType: type,
                originalValue: obj
            };
        }
        if (!this.terminalNodeIsEqual(pathNode, elementId, type, obj)) {
            this.setKeyValue(pathNode, elementId, type, obj);
        }

        this.releaseKeepPathNodeActive(pathNode);
        
        return pos + 1;
    }

    replaceOrderedSetAt(pathId: number, parentId: number, elements: any[], dataElementIndex: FRVIDataElementIndex[], pos: number, requiresOwnId: boolean): number {
        var lastUpdate: number = pos;

        function rearrangeElementsAndDataElementIndex(): void {
            var elementStrings: string[] = elements.map(cdlifyNormalized);
            var deiValueStrings: string[] = dataElementIndex.map(function(dei: FRVIDataElementIndex): string {
                return cdlifyNormalized(dei.originalValue)
            });
            var elementToPos: Map<string, number[]> = new Map<string, number[]>();
            var matchedDataElementIndex: FRVIDataElementIndex[] = [];
            var unmatchedDataElementIndex: FRVIDataElementIndex[] = [];
            var matchedElements: any[] = [];
            var unmatchedElements: any[];
            var unmatchedElementPositions: boolean[] = elements.map(function(_: any): boolean {
                return true;
            });

            // Mark positions per value
            for (var i: number = 0; i < elementStrings.length; i++) {
                if (elementToPos.has(elementStrings[i])) {
                    elementToPos.get(elementStrings[i]).push(i);
                } else {
                    elementToPos.set(elementStrings[i], [i]);
                }
            }
            // Reorder elements and dataElementIndex to match
            for (var i: number = 0; i < dataElementIndex.length; i++) {
                var dei = dataElementIndex[i];
                var deiValueStr = deiValueStrings[i];
                if (elementToPos.has(deiValueStr)) {
                    var elementPoss: number[] = elementToPos.get(deiValueStr);
                    var elementPos: number = elementPoss.shift();
                    matchedDataElementIndex.push(dei);
                    matchedElements.push(elements[elementPos]);
                    unmatchedElementPositions[elementPos] = false;
                    if (elementPoss.length === 0) {
                        elementToPos.delete(deiValueStr);
                    }
                } else {
                    unmatchedDataElementIndex.push(dei);
                }
            }
            unmatchedElements = elements.filter(function(elt: any, i: number): any {
                return unmatchedElementPositions[i];
            });
            elements = matchedElements.concat(unmatchedElements);
            // dataElementIndex needs to be rearranged in place
            var reorderedDEI = matchedDataElementIndex.concat(unmatchedDataElementIndex);
            for (var i: number = 0; i < reorderedDEI.length; i++) {
                dataElementIndex[i] = reorderedDEI[i];
            }
            dataElementIndex.length = reorderedDEI.length;
        }

        if (elements.length > 1) {
            requiresOwnId = true;
        }
        if (requiresOwnId && dataElementIndex.length === 1 &&
              dataElementIndex[0].dataElementId === parentId) {
            // The element has to change id, so we delete it and pretend
            // there were no children
            this.removeSingleDataElement(pathId, dataElementIndex[0]);
            dataElementIndex.splice(0, 1);
        }
        if (this.minimizeDataElementMovement &&
              // No point in rearranging when there is nothing to choose
              (elements.length > 1 || dataElementIndex.length > 1) &&
              elements.length > 0 && dataElementIndex.length > 0) {
            rearrangeElementsAndDataElementIndex();
        }
        for (var i = 0, l = elements.length; i < l; ++i) {
            lastUpdate = this.replaceAt(pathId, parentId, elements[i],
                                   requiresOwnId, dataElementIndex, lastUpdate);
        }
        if (lastUpdate < dataElementIndex.length) {
            this.removeDataElements(pathId, dataElementIndex, lastUpdate);
        }
        return lastUpdate;
    }

    replaceWithChildrenAtSamePath(
        pathId: number, parentId: number, indexerType: string, keyValue: any,
        deiType: FRVIDataElementType, children: any[], requiresOwnId: boolean,
        dataElementIndex: FRVIDataElementIndex[], pos: number): number
    {
        var pathNode = this.addPath(pathId);
        var elementId: number;
        var dei: FRVIDataElementIndex;

        this.keepPathNodeActive(pathNode);
        
        // Get the element
        if (pos < dataElementIndex.length &&
              dataElementIndex[pos].type === deiType) {
            // We can replace the child elements
            dei = dataElementIndex[pos];
        } else {
            // Cannot replace, must add new element
            if (pos < dataElementIndex.length) {
                // First clean up anything else
                this.removeSingleDataElement(pathId, dataElementIndex[pos]);
            }
            if (requiresOwnId || parentId === undefined
                /* #triggers bug# || this.alwaysUniqueDataElementId */) {
                elementId = InternalQCMIndexer.getNextDataElementId();
                this.addDataElementNode(pathNode, elementId, parentId);
            } else {
                elementId = parentId;
                this.addNonDataElementNode(pathNode, elementId);
            }
            dei = dataElementIndex[pos] = {
                dataElementId: elementId,
                type: deiType,
                originalType: indexerType,
                originalValue: keyValue,
                children: {
                    "": {
                        pathId: pathId,
                        dataElements: []
                    }
                }
            };
            this.setKeyValue(pathNode, elementId, indexerType, keyValue);
        }

        this.releaseKeepPathNodeActive(pathNode);
        
        var lastUpdate: number = this.replaceOrderedSetAt(
            pathId, dei.dataElementId, children,
            dei.children[""].dataElements, 0, true);
        assert(lastUpdate === dei.children[""].dataElements.length,
               "replaceOrderedSetAt should have truncated the list");

        return pos + 1;
    }

    replaceRangeAt(pathId: number, parentId: number, obj: RangeValue, requiresOwnId: boolean, dataElementIndex: FRVIDataElementIndex[], pos: number): number {
        var keyValue: any[] = [!obj.closedLower, !obj.closedUpper];
        var elts: any[] = obj.min !== undefined && obj.max !== undefined?
                          [obj.min, obj.max]: [];

        return this.replaceWithChildrenAtSamePath(
            pathId, parentId, "range", keyValue, FRVIDataElementType.range,
            elts, requiresOwnId, dataElementIndex, pos);
    }

    replaceNegationAt(pathId: number, parentId: number, obj: Negation, requiresOwnId: boolean, dataElementIndex: FRVIDataElementIndex[], pos: number): number {
        return this.replaceWithChildrenAtSamePath(
            pathId, parentId, "negation", 0, FRVIDataElementType.negation, 
            obj.queries, requiresOwnId, dataElementIndex, pos);
    }

    replaceStringMatchAt(pathId: number, parentId: number, obj: SubStringQuery, requiresOwnId: boolean, dataElementIndex: FRVIDataElementIndex[], pos: number): number {
        var pathNode = this.addPath(pathId);
        var elementId: number;
        var type: string = "strMatch";
        var value: any = obj.strings[0];

        this.keepPathNodeActive(pathNode);
        
        if (value === undefined) {
            value = "";
        }
        if (pos < dataElementIndex.length &&
              dataElementIndex[pos].type === FRVIDataElementType.terminal) {
            // We can directly replace the contents of dataElementIndex[pos],
            // which will be done on setKeyValue
            elementId = dataElementIndex[pos].dataElementId;
        } else {
            // Cannot replace, must add new element
            if (pos < dataElementIndex.length) {
                // First clean up nested structures
                this.removeSingleDataElement(pathId, dataElementIndex[pos]);
            }
            if (requiresOwnId || parentId === undefined ||
                this.alwaysUniqueDataElementId) {
                elementId = InternalQCMIndexer.getNextDataElementId();
                this.addDataElementNode(pathNode, elementId, parentId);
            } else {
                elementId = parentId;
                this.addNonDataElementNode(pathNode, elementId);
            }
            dataElementIndex[pos] = {
                // pathId: pathId,
                dataElementId: elementId,
                type: FRVIDataElementType.terminal,
                originalType: type,
                originalValue: obj
            };
        }
        if (!this.terminalNodeIsEqual(pathNode, elementId, type, value)) {
            this.setKeyValue(pathNode, elementId, type, value);
        }

        this.releaseKeepPathNodeActive(pathNode);
        
        return pos + 1;
    }

    // this sets an attribute value structure.
    // If 'isDataElement' is true and 'identity' is not undefined, the value
    // of 'identity' is set as the base identity of the data element created
    // by this function.

    replaceAttributeValueAt(pathId: number, parentId: number, obj: any, requiresOwnId: boolean, dataElementIndex: FRVIDataElementIndex[], pos: number): number {
        var pathNode = this.addPath(pathId);
        var elementId: number;
        var numAttrs = 0; // number of attributes actually added.
        var dei: FRVIDataElementIndex;

        this.keepPathNodeActive(pathNode);
        
        if (pos < dataElementIndex.length &&
            dataElementIndex[pos].type === FRVIDataElementType.attributeValue) {
            // We will attempt to replace the elements attribute by attribute.
            // Adding/replacing will be done below, here we only delete no
            // longer existing paths
            dei = dataElementIndex[pos];
            for (var attr in dataElementIndex[pos].children) {
                if (!(attr in obj)) {
                    var chld = dei.children[attr];
                    this.removeDataElements(chld.pathId, chld.dataElements, 0);
                    delete dei.children[attr];
                }
            }
            elementId = dei.dataElementId;
        } else {
            // Cannot replace, must add new element
            if (pos < dataElementIndex.length) {
                // First clean up anything else
                this.removeSingleDataElement(pathId, dataElementIndex[pos]);
            }
            if (requiresOwnId || parentId === undefined ||
                this.alwaysUniqueDataElementId) {
                elementId = InternalQCMIndexer.getNextDataElementId();
                this.addDataElementNode(pathNode, elementId, parentId);
            } else {
                elementId = parentId;
                this.addNonDataElementNode(pathNode, elementId);
            }
            dei = dataElementIndex[pos] = {
                dataElementId: elementId,
                type: FRVIDataElementType.attributeValue,
                originalType: "object",
                originalValue: obj,
                children: {}
            };
        }

        this.releaseKeepPathNodeActive(pathNode);
        
        for (var attr in obj) {

            var writable = (attr[0] == '^'); 
            if (writable) // the caret is not part of the attribute name
                attr = attr.substr(1);

            // check whether the addition of this path implies potentially
            // new identified paths.
            // TODO: this.checkForNewIdentifiedPaths(pathId, attr);

            var attrPathId = this.qcm.allocatePathId(pathId, attr);

            if (!(attr in dei.children)) {
                dei.children[attr] = {
                    pathId: attrPathId,
                    dataElements: []
                };
            }
            var lastUpdate: number = this.replaceAt(attrPathId, elementId,
                          obj[attr], false, dei.children[attr].dataElements, 0);
            if (lastUpdate !== 0) {
                numAttrs++;
            }
            if (lastUpdate < dei.children[attr].dataElements.length) {
                this.removeDataElements(attrPathId,
                                   dei.children[attr].dataElements, lastUpdate);
            }

            this.qcm.releasePathId(attrPathId); // stays allocated in the path node
        }

        if (numAttrs === 0) {
            this.removeNode(pathNode, elementId);
            dataElementIndex.splice(pos,1);
            return pos;
        } else {
            // set the type to attributeValue, but with an undefined key.
            this.setKeyValue(pathNode, elementId, "attributeValue", undefined);
            this.setKeyValue(pathNode, elementId, "attribute", true);
            return pos + 1;
        }
    }

    removeDataElements(pathId: number, dataElementIndex: FRVIDataElementIndex[], pos: number): void {
        for (var i: number = pos; i < dataElementIndex.length; i++) {
            this.removeSingleDataElement(pathId, dataElementIndex[i]);
        }
        dataElementIndex.length = pos;
    }

    removeSingleDataElement(pathId: number, dataElementIndex: FRVIDataElementIndex): void {
        for (var attr in dataElementIndex.children) {
            var dei = dataElementIndex.children[attr];
            this.removeDataElements(dei.pathId, dei.dataElements, 0);
        }
        this.removeNode(this.pathNodesById[pathId], dataElementIndex.dataElementId);
    }

    // Activation / deactivation

    pathNodeActivated(pathNode: PathNode) {
        // nothing to do here
    }

    pathNodeDeactivated(pathNode: PathNode) {
        this.removePathNode(pathNode); // base class function
    }
    
    //
    // Tracing and sub-tree monitoring interface 
    //
    
    // There is no need to do anything here, so all these functions, which need
    // to be defined in the derived class do nto need ot do anything.

    pathNodeTracingActivated(pathNode: PathNode) {
    }

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
