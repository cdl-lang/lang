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

function buildQualifiers(sg: SingleQualifier[], local: EvaluationEnvironment): {value: EvaluationNode; match: any;}[] {
    var qualifier: {value: EvaluationNode; match: any;}[] = [];

    for (var i: number = 0; i !== sg.length; i++) {
        qualifier.push({
            value: getEvaluationNode(sg[i].functionNode, local),
            match: sg[i].value
        });
    }
    return qualifier;
}

function buildEvaluationNode(p: FunctionNode, local: EvaluationEnvironment): void
{
    var evalNode: EvaluationNode = p.makeEvaluationNode(local);

    evalNode.init();
    evalNode.isBeingInitialized = false;
}

function buildWriteTriggerNode(wrNode: WriteNode, local: EvaluationEnvironment, writeName: string): WriteTriggerNode {
    var trigger: WriteTriggerNode = new WriteTriggerNode(writeName, wrNode, local);

    trigger.initialize();
    return trigger;
}
