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

/// <reference path="evaluationNode.apply.ts" />
/// <reference path="cdl.ts" />
/// <reference path="utilities.ts" />

abstract class ValueReference extends NonAV implements Compare<ValueReference> {
    abstract compare(v: ValueReference): number;
}

class ElementReference extends ValueReference {
    element: string;

    constructor(element: string) {
        super();
        this.element = element;
    }

    getElement(): string {
        return this.element;
    }

    match(v: any): boolean {
        return this.isEqual(v);
    }

    isEqual(v: any): boolean {
        if (v instanceof ElementReference) {
            var er = <ElementReference> v;
            return this.element === er.element;
        }
        return false;
    }

    copy(): ValueReference {
        return new ElementReference(this.element);
    }

    stringify(): string {
        return "@" + this.element;
    }

    toJSON(): string {
        return "new ElementReference(\"" + this.element + "\")";
    }

    toCdl(): any {
        return "@" + this.element;
    }

    typeName(): string {
        return "elementReference";
    }

    // an element-id is marshalled by specifying its templateId/indexId,
    //  as these are the components which can be translated from one agent to
    //  another
    marshalValue(xdr: XDR): any {
        var paidEntry = gPaidMgr.getAreaEntry(this.element);

        // this call ensures that 'templateId's definition is made
        //  available to the peer
        var templateId = xdr.xdrTemplateId(paidEntry.templateId);

        // this call ensures that 'indexId's definition is made
        //  available to the peer
        var indexId = xdr.xdrIndexId(paidEntry.indexId);

        return {
            type: "elementReference",
            templateId: templateId,
            indexId: indexId
        };
    }

    // craete a new ElementReference instance according to 'obj'
    static unmarshalValue(obj: any, xdr: XDR): any {

        // translate templateId to the local value
        var templateId = xdr.xdrTemplateId(obj.templateId);

        // translate indexId to the local value
        var indexId = xdr.xdrIndexId(obj.indexId);

        // create the area-id
        var areaId = gPaidMgr.getAreaId(templateId, indexId);

        return new ElementReference(areaId);
    }

    compare(v: ElementReference): number {
        return this.element === v.element? 0: this.element < v.element? -1: 1;
    }
}

class DefunReference extends ValueReference {
    defun: EvaluationDefun;

    constructor(defun: EvaluationDefun) {
        super();
        this.defun = defun;
    }

    typeName(): string {
        return "defunReference";
    }

    isEqual(v: any): boolean {
        if (v instanceof DefunReference) {
            return this.defun.isEqual(v.defun);
        }
        return false;
    }

    copy(): ValueReference {
        return new DefunReference(this.defun);
    }

    stringify(): string {
        return this.defun.prototype.toFullString();
    }

    toCdl(): any {
        return this;
    }

    toJSON(): string {
        return "defun(" + this.defun.prototype.idStr() + ")";
    }

    match(v: any): boolean {
        return this === v;
    }

    marshalValue(xdr: XDR): any {
        Utilities.error("marshalling a defun is not supported");
        return undefined;
    }

    static unmarshalValue(obj: any, xdr: XDR): any {
        Utilities.error("unmarshalling a defun is not supported");
        return undefined;
    }

    compare(v: ElementReference): number {
        return 0; // TODO
    }
}
