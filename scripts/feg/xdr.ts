// Copyright 2017 Theo Vosse.
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

/// <reference path="remotePaidInterface.ts" />

// xdr (external data representation) converts a local data-structure to an
//  alternate format, appropriate to transmitting it over a connection 
//  to a peer.
//
// the conversion can be seen as containing two parts:
//
// 1. data-format conversion
// 2. table-indexing adaptation
//
// data-format conversion:
// ----------------------
// the 'xdr' format is as follows:
//  - strings and booleans - their json representation
//
//  - numbers - their json representation, with a couple of exceptions:
//              if 'num' is one of { Infinity, -Infinity, NaN }, the xdr
//              representation of 'num' is{ type: "number", value: String(num) }
//
//  - null - its json representation
//
//  - undefined - { type: "undefined" }
//
//  - o/s - { type: "orderedSet", os: <array of xdr-formatted elements> }
//
//  - range - { type: "range", os: <array of xdr-formatted elements> }
//
//  - comparisonFunction - { type: "comparisonFunction", elements: <array of xdr-formatted elements> }
//
//  - a/v - { type: "attributeValue", value: <object of xdr-formatted elements>
//
//  - projector - { type: "projector" }
//
//  - predefined function (built-in function) -
//          { type: "builtInFunction", name: , isLocalWithoutArguments,
//            dependingOnImplicitArguments: , transientResult: }
//
//  - negation - { type: "negation",
//                    queries: <array of xdr-formatted elements> }
//
//  - elementReference - { type: "elementReference", templateId: , indexId: }
//
//
// table-indexing adaptation:
// -------------------------
// this currently only pertains to elementReferences; the templateId and
//  indexId attributes of an elementReference have a value which is an index
//  into the local template and index tables, respectively. The associated
//  index at the peer may have a different integer value, or may be completely
//  missing from the peer's tables. Hence, xdr'ing of a templateId/indexId
//  in the 'Marshal' direction is done by making sure the current connection
//  provides a definition of the templateId/indexId by its local definition.
//  this definition should reach the peer prior to the peer stumbling upon an
//  actual use of this templateId/indexId.
//  The definition is done 'recursively'; as a templateId/indexId is defined
//   based on other templateIds/indexIds, the building blocks are defined
//   prior to using them in a definition.
//  The embrionic case are the screen-area template-id and index-id, which are
//   assumed to always be '1'.
//  On the receiving end, at the 'Unmarshal' direction, a templateId read from
//   a connection is used to look-up the local id associated with that
//   remote-id.
//
//
// On a standard agent, the internal format is quite different from the 'xdr'
//  format for many objects, e.g. o/ses, a/vs, element-references. The
//  internal representation of some of these objects supports the conversion
//  to/from xdr format.
//
// On the server, the internal representation is identical to the xdr format,
//  so that the only conversions required are 'table-indexing adaptation'.
//

// The implementation splits xdr'ing to two parts;
//  -- one part is thge part that implements the 'XDR' interface, which includes
//  all the basic data types. The implementation of the XDR interface depends
//  on the internal representation of the data, and is thus quite different
//  between agent (AgentXDR) and server (ServerXDR). The code common to agent
//  and server is implemented in BaseXDR.
//
//  -- the other part describes higher level data-structures as combinations
//  of the basic data types. This part does not depend on the internal
//  representation, as it rather takes an instance of an XDR interface, that
//  makes the correct conversions to/from internal representation.
//  For example, a structure with two members, a 'value:' which is a number and
//   a 'templateId:' which is a templateId could be described as follows:
//
//   interface ValueAndTemplateID { value: number; templateId: number }
//   function xdrValueAndTemplateId(vat: ValueAndTemplateID, xdr: XDR):
//                                                     ValueAndTemplateID {
//        var value: number = xdr.xdrNumber(var.value);
//        var templateId: number = xdr.xdrTemplateId(vat.templateId);
//
//        return { value: value, templateId: templateId };
//   }
//
//  this function, 'xdrValueAndTemplateId', can then be used for both
//   marshalling and unmarshalling the structure (based on the direction with
//   which the XDR implementation was constructed) and on both agent and server
//   (depending on whether the XDR implementation is AgentXDR or ServerXDR)
//   

/// <reference path="utilities.ts" />
/// <reference path="elementReference.ts" />

enum XDRDirection { Marshal, Unmarshal };

var xdrDeleteIdent: any = {
    type: "xdrDelete",
    typeName: function () { return "xdrDelete"; }
};

interface XDR {
    xdrString(val: string): any;
    xdrBoolean(val: boolean): any;
    xdrNumber(obj: any): any;
    xdrUndefined(): any;
    xdrNull(): any;

    xdrDelete(obj: any): any;

    xdrCdlObj(obj: any): any;

    xdrTemplateId(templateId: any): any;
    xdrIndexId(indexId: any): any;
}

abstract class BaseXDR implements XDR {
    constructor(
        public dir: XDRDirection,
        public templateInfoChannel: TemplateIndexInformationChannel
    ) {
    }

    xdrString(val: string): any {
        return val;
    }
    
    xdrBoolean(val: boolean): any {
        return val;
    }

    xdrNull(): any {
        return null;
    }

    xdrUndefined(): any {
        if (this.dir === XDRDirection.Marshal) {
            return {
                type: "undefined"
            };
        } else {
            return undefined;
        }
    }


    xdrDelete(obj: any): any {
        if (this.dir === XDRDirection.Marshal) {
            return { type: "xdrDelete" };
        } else {
            return xdrDeleteIdent;
        }
    }

    xdrNumber(obj: any): any {
        if (this.dir === XDRDirection.Marshal) {
            if (obj === Infinity || obj === -Infinity || isNaN(obj)) {
                return {
                    type: "number",
                    value: String(obj)
                };
            }
        } else {
            if (obj instanceof Object) {
                return Number(obj.value);
            }
        }
        return obj;
    }

    xdrTemplateId(templateId: any): any {
        var xdrTemplateId = templateId;
        if (this.dir === XDRDirection.Marshal) {
            this.templateInfoChannel.defineTemplate(xdrTemplateId);
        }
        xdrTemplateId = this.xdrNumber(xdrTemplateId);
        if (this.dir === XDRDirection.Unmarshal) {
            xdrTemplateId =
                this.templateInfoChannel.translateTemplate(xdrTemplateId);
        }
        if (xdrTemplateId === undefined) {
            RemotingLog.log(1, "internal error: xdrTemplateId is undefined: " + JSON.stringify(templateId) + " " + XDRDirection[this.dir]);
        }
        return xdrTemplateId;
    }

    xdrIndexId(indexId: any): any {
        var xdrIndexId: any = indexId;
        if (this.dir === XDRDirection.Marshal) {
            this.templateInfoChannel.defineIndex(xdrIndexId);
        }
        var xdrIndexId = this.xdrNumber(xdrIndexId);
        if (this.dir === XDRDirection.Unmarshal) {
            xdrIndexId = this.templateInfoChannel.translateIndex(xdrIndexId);
        }
        if (xdrIndexId === undefined) {
            RemotingLog.log(1, "internal error: xdrIndexId is undefined: " + JSON.stringify(indexId));
        }
        return xdrIndexId;
    }

    xdrCdlObj(obj: any): any {
        var t = typeof(obj);

        switch (t) {
          case "string":
            return this.xdrString(obj);

          case "number":
            return this.xdrNumber(obj);

          case "boolean":
            return this.xdrBoolean(obj);

          case "undefined":
            return this.xdrUndefined();

          case "object":
            if (obj === null) {
                return this.xdrNull();
            } else if (obj instanceof Array) {
                return this.xdrOS(obj);
            } else {
                var type: string;
                if (this.dir === XDRDirection.Unmarshal) {
                    assert(("type" in obj) && (typeof(obj.type) === "string"),
                          "XDR.unmarshal: must have a string 'type'");
                    type = obj.type;
                } else {
                    type = this.xdrGetMarshalType(obj);
                }
                return this.xdrObjByType(obj, type);
            }

          default:
            Utilities.warn("XDR: unexpected type '" + t + "'");
            return undefined;
        }
    }

    abstract xdrOS(obj: any): any;

    abstract xdrRange(obj: any): any;

    abstract xdrComparisonFunction(obj: any): any;

    abstract xdrAV(obj: any): any;

    abstract xdrNegation(obj: any): any;

    abstract xdrElementReference(obj: any): any;

    xdrObjByType(obj: any, type: string): any {
        switch (type) {
          case "number":
            return this.xdrNumber(obj);

          case "undefined":
            return this.xdrUndefined();

          case "attributeValue":
            return this.xdrAV(obj);

          case "xdrDelete":
            return this.xdrDelete(obj);

          case "orderedSet":
            return this.xdrOS(obj);

          case "range":
            return this.xdrRange(obj);

          case "comparisonFunction":
            return this.xdrComparisonFunction(obj);

          case "negation":
            return this.xdrNegation(obj);

          case "elementReference":
            return this.xdrElementReference(obj);

          default:
            Utilities.warn("XDR: unexpected type '" + type + "'");
            return undefined;
        }
    }

    abstract xdrGetMarshalType(obj: any): string;
}

//
// the agent translates 'NonAV's between their xdr representation and its native
//  representation
//
class AgentXDR extends BaseXDR implements XDR {

    xdrOS(obj: any): any {
        if (this.dir === XDRDirection.Unmarshal) {
            return MoonOrderedSet.unmarshalValue(obj, this);
        } else {
            var arr: any[];
            if (obj instanceof Array) {
                arr = <any[]> obj;
                return MoonOrderedSet.marshalValue("orderedSet", arr, this);
            } else {
                assert(typeof(obj.marshalValue) === "function",
                       "XDR: object must have a 'marshalValue' method");
                return obj.marshalValue(this);
            }
        }
    }

    xdrRange(obj: any): any {
        if (this.dir === XDRDirection.Unmarshal) {
            return MoonRange.unmarshalValue(obj, this);
        } else {
            var arr: any[];
            if (obj instanceof Array) {
                arr = <any[]> obj;
                return MoonRange.marshalValue("range", arr, this);
            } else {
                assert(typeof(obj.marshalValue) === "function",
                       "XDR: object must have a 'marshalValue' method");
                return obj.marshalValue(this);
            }
        }
    }

    xdrComparisonFunction(obj: any): any {
        if (this.dir === XDRDirection.Marshal) {
            return obj.marshalValue(this);
        } else {
            return ComparisonFunctionValue.unmarshalValue(obj, this);
        }
    }

    xdrAV(obj: any): any {
        var iObj: any;
        var oObj: any = {};
        if (this.dir === XDRDirection.Marshal) {
            iObj = obj;
        } else {
            iObj = obj.value;
        }
        for (var attr in iObj) {
            var attrValue = this.xdrCdlObj(iObj[attr]);
            if (attrValue !== undefined) {
                oObj[attr] = attrValue;
            }
        }
        if (this.dir === XDRDirection.Marshal) {
            return { type: "attributeValue", value: oObj };
        } else {
            return oObj;
        }
    }

    xdrNegation(obj: any): any {
        if (this.dir === XDRDirection.Marshal) {
            return obj.marshalValue(this);
        } else {
            return Negation.unmarshalValue(obj, this);
        }
    }

    xdrElementReference(obj: any): any {
        if (this.dir === XDRDirection.Marshal) {
            return obj.marshalValue(this);
        } else {
            return ElementReference.unmarshalValue(obj, this);
        }
    }

    xdrGetMarshalType(obj: any): string {
        var type: string;

        if (typeof(obj.typeName) === "function") {
            type = obj.typeName();
        } else {
            type = "attributeValue";
        }
        return type;
    }

}

//
// in the server, the 'internal' representation is much the same as the xdr
//  representation;
// objects must still be traversed, mostly for element-reference translation,
//  and also for 'special values', such as xdrDelete, Infinity/NaN
//
class ServerXDR extends BaseXDR implements XDR {
    xdrOS(obj: any): any {
        return this.xdrOSorRange(obj, "orderedSet");
    }

    xdrRange(obj: any): any {
        return this.xdrOSorRange(obj, "range");
    }

    xdrComparisonFunction(obj: any): any {
        var queries = this.xdrCdlObj(obj.elements);

        return queries !== undefined?
               { type: "comparisonFunction", queries: queries }:
               undefined;
    }

    xdrOSorRange(obj: any, type: string) {
        var valueOS: any[] = [];

        for (var i = 0; i < obj.os.length; i++) {
            var elem = this.xdrCdlObj(obj.os[i]);
            if (elem !== undefined) {
                valueOS.push(elem);
            } 
        }
        return {
            type: type,
            os: valueOS
        };
    }

    xdrAV(obj: any): any {
        return {
            type: "attributeValue",
            value: this.xdrAllObjAttr(obj.value)
        };
    }

    xdrNegation(obj: any): any {
        return {
            type: "negation",
            queries: this.xdrCdlObj(obj.queries)
        }
    }

    xdrAllObjAttr(obj: any) {
        var xobj: any = {};
        for (var attr in obj) {
            var attrValue = this.xdrCdlObj(obj[attr]);
            if (attrValue !== undefined) {
                xobj[attr] = attrValue;
            }
        }

        return xobj;
    }

    xdrElementReference(obj: any): any {
        var templateId = this.xdrTemplateId(obj.templateId);
        var indexId = this.xdrIndexId(obj.indexId);

        return {
            type: "elementReference",
            templateId: templateId,
            indexId: indexId
        };
    }

    xdrGetMarshalType(obj: any): string {
        assert(obj instanceof Object && typeof(obj.type) === "string",
               "marshalled object must have a string type");
        return obj.type;
    }
}

class AppStateIdentifier {
    templateId: number;
    indexId: number;
    path: string;

    constructor(templateId: number, indexId: number, path: string) {
        this.templateId = templateId;
        this.indexId = indexId;
        this.path = path;
    }

    toString(): string {
        return AppStateIdentifier.getHashStr(this);
    }

    static getHashStr(appSId: AppStateIdentifier): string {
        return appSId.templateId + ":" + appSId.indexId + ":" + appSId.path;
    }
}

class AppStateElement {
    ident: AppStateIdentifier;
    revision?: number;
    value: any;
}

// metadata entries are similar to app state entries except for the identifier
// (which is app state refers to the area to which the app state belongs,
// while for the metadata this is a string storing the table ID (metadata
// is identified by the server, not the client).

class MetadataElement {
    ident: string;
    revision?: number;
    value: any;
}


module XDR {
    export function xdrAppStateIdentifier(appStateIdent: AppStateIdentifier,
                                          xdr: XDR): AppStateIdentifier
    {
        var templateId: number = xdr.xdrTemplateId(appStateIdent.templateId);
        var indexId: number = xdr.xdrIndexId(appStateIdent.indexId);
        var path: string = xdr.xdrString(appStateIdent.path);

        return {
            templateId: templateId,
            indexId: indexId,
            path: path
        };
    }

    export function xdrCdlValue(cdlValue: any, xdr: XDR): any {
        return xdr.xdrCdlObj(cdlValue);
    }

    export function xdrAppStateElement(appStateElem: AppStateElement,
                                       xdr: XDR): AppStateElement
    {
        var ident: AppStateIdentifier =
            xdrAppStateIdentifier(appStateElem.ident, xdr);
        var revision: number = appStateElem.revision;
        var value: any = xdrCdlValue(appStateElem.value, xdr);

        return (revision === undefined || revision === null) ?
            { ident: ident, value: value } :
            { ident: ident, revision: revision, value: value };
    }

    export function xdrMetadataElement(metadataElem: MetadataElement,
                                       xdr: XDR): MetadataElement
    {
        var ident: string = metadataElem.ident;
        var revision: number = metadataElem.revision;
        var value: any = xdrCdlValue(metadataElem.value, xdr);

        return (revision === undefined || revision === null) ?
            { ident: ident, value: value } :
            { ident: ident, revision: revision, value: value };
    }

    
    // Table data is not xdr'ed: it's no cdl, just JSON.
    export function xdrTableElement(tableElem: any, xdr: XDR): any {
        return tableElem;
    }

    // Test if an xdr represents an empty os.
    export function isEmptyOS(data: any): boolean {
        return data instanceof Object && data.type === "orderedSet" &&
               (data.os === undefined || data.os.length === 0);
    }

    // Test if an xdr value represents false: undefined, false or an os that
    // does not contain any true value.
    export function isFalse(data: any): boolean {
        return data === undefined || data === false ||
               (data instanceof Object && data.type === "orderedSet" &&
                (data.os === undefined || data.os.every(isFalse)));
    }

    export function isTrue(data: any): boolean {
        return !isFalse(data);
    }

    export function mergeXDRValues(a: any, b: any, changes?: {changed: boolean;}): any {
        var a0: any = a;
        var b0: any = b;

        if (a === undefined) {
            if (b !== undefined && changes !== undefined)
                changes.changed = true;
            return b;
        }
        if (b === undefined) {
            return a;
        }
        if (a instanceof Object && a.type === "orderedSet") {
            if (a.os.length !== 1) {
                return a;
            }
            a0 = a.os[0];
        }
        if (b instanceof Object && b.type === "orderedSet") {
            if (b.os.length !== 1) {
                return a;
            }
            b0 = b.os[0];
        }
        // Simple values cannot be merged
        if (!(a0 instanceof Object) || a0.type !== "attributeValue" ||
              !(b0 instanceof Object) || b0.type !== "attributeValue") {
            return a;
        }
        // Left with two attribute value objects
        var merge: any = { type: "attributeValue", value: {} };
        for (var attr in a0.value) {
            merge.value[attr] = mergeXDRValues(a0.value[attr], b0.value[attr], changes);
        }
        for (var attr in b0.value) {
            if (!(attr in a0.value)) {
                if (changes !== undefined)
                    changes.changed = true;
                merge.value[attr] = b0.value[attr];
            }
        }
        return a.type === "orderedSet"?
               { type: "orderedSet", os: [merge] }: merge;
    }
}

type XDRFunc = (elem: any, xdr: XDR) => any;
type IdentFunc = (elem: any) => string;
