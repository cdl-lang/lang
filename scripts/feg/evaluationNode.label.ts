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

/// <reference path="evaluationNode.ts" />

class EvaluationLabeler extends EvaluationFunctionApplication {

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.constant = true;
        this.result.value = constEmptyOS;
    }

    updateInput(i: any, result: Result): void {
        this.arguments[0] = result;
        this.markAsChanged();
    }

    resultIsTransient(): boolean {
        return false;
    }

    // querySourceId(): number {
    //     return this.inputs[0].querySourceId(this);
    // }

    multiQuerySourceIds(): number[] {
        return this.inputs[0].multiQuerySourceIds();
    }
}

class EvaluationAtomic extends EvaluationLabeler {

    eval(): boolean {
        this.result.copyLabels(this.arguments[0]);
        this.result.value = this.arguments[0].value;
        this.result.atomic = true;
        return true;
    }

    debugName(): string {
        return "internalAtomic";
    }

}
internalAtomic.classConstructor = EvaluationAtomic;

class EvaluationPush extends EvaluationLabeler {

    eval(): boolean {
        this.result.copyLabels(this.arguments[0]);
        this.result.value = this.arguments[0].value;
        this.result.push = true;
        return true;
    }

    debugName(): string {
        return "internalPush";
    }

}
internalPush.classConstructor = EvaluationPush;

class EvaluationDelete extends EvaluationLabeler {
    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.result.value = constEmptyOS;
        this.result.erase = true;
    }

    eval(): boolean {
        return false;
    }

    debugName(): string {
        return "internalDelete";
    }

}
internalDelete.classConstructor = EvaluationDelete;

class EvaluationAnonymize extends EvaluationLabeler {

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.dataSourceAware = true;
    }

    eval(): boolean {
        var oldResult: Result = this.result.clone();

        this.inputHasChanged = false;
        this.result.copy(this.arguments[0]);
        this.result.setIdentifiers(undefined);
        this.result.anonymize = true;
        return !this.result.equal(oldResult);
    }

    debugName(): string {
        return "internalAnonymize";
    }

}
anonymize.classConstructor = EvaluationAnonymize;
