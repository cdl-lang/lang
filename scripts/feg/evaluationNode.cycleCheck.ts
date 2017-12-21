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

var gCycleCheckNr: number = 0;
var gCycleCheckQueue: EvaluationNode[] = new Array<EvaluationNode>(30000);
var gCycleCheckUp: number[] = new Array<number>(30000);

// Call only with active node
function checkForCycles(startNode: EvaluationNode): EvaluationNode[] {
    var queue: EvaluationNode[] = gCycleCheckQueue;
    var up: number[] = gCycleCheckUp;
    var qi: number = 0, qEnd: number = 0;
    var cycleNr: number = ++gCycleCheckNr;

    function getCycle(): EvaluationNode[] {
        var i: number = qi;
        var cycle: EvaluationNode[] = [];

        while (i >= 0) {
            cycle.push(queue[i]);
            i = up[i];
        }
        return cycle.reverse();
    }

    up[qEnd] = -1;
    queue[qEnd++] = startNode;
    while (qi < qEnd) {
        var en: EvaluationNode = queue[qi];
        if (en.lastSeenInCycleCheck !== cycleNr) {
            var res: EvaluationNode[] = undefined;
            en.lastSeenInCycleCheck = cycleNr;
            en.watchers.forEach(function(watcher): void {
                var w = watcher.watcher;
                if (w instanceof EvaluationNode && w.nrActiveWatchers > 0) {
                    if (w === en) {
                        // Can't break out of forEach, and TypeScript doesn't
                        // support iterators, for ... of, etc.
                        res = getCycle();
                    } else {
                        up[qEnd] = qi;
                        queue[qEnd++] = w;
                    }
                }
            });
            if (res !== undefined) {
                return res;
            }
        }
        qi++;
    }
    return undefined;
}

function checkAllExpressionsForCycles(): void {
    function allExpr(nodes: EvaluationNode[], tAreaId: string): void {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i] !== undefined && nodes[i].nrActiveWatchers > 0) {
                var cycle: EvaluationNode[] = checkForCycles(nodes[i]);
                if (cycle !== undefined) {
                    console.log("cycle found in " + tAreaId + ": " +
                                cycle.map(function(e: EvaluationNode): string {
                                    return e.prototype.idStr();
                                }).join(" -> "));
                }
            }
        }
    }

    allExpr(globalEvaluationNodes, "global");
    for (var areaId in allAreaMonitor.allAreas) {
        var area: CoreArea = allAreaMonitor.allAreas[areaId];
        allExpr(area.evaluationNodes[0], area.tAreaId);
    }
}

function singleChangeCycleCheck(en: EvaluationNode): void {
    var cycle: EvaluationNode[] = checkForCycles(en);

    if (cycle !== undefined) {
        console.log("cycle found: " +
                    cycle.map(function(e: EvaluationNode): string {
                        return e.prototype.idStr();
                    }).join(" -> "));
    }
}

type AreaEN = { areaId: string; evaluationNode: EvaluationNode; };

function trackAllExpressions(areaId: string, exprId: number): void {
    var area = allAreaMonitor.allAreas[areaId];
    var areaIds = [areaId];
    var exprs = [area.evaluationNodes[0][exprId]];
    var exprTo: {[watcherId: number]: AreaEN[]} = {};
    var exprFrom: {[watcherId: number]: AreaEN} = {};
    var visited: {[watcherId: number]: boolean} = {};

    function getCycle(id: number, path: AreaEN[]): void {
        if (id in visited) {
            if (visited[id]) {
                console.log("LOOP");
                for (var i: number = 0; i < path.length; i++) {
                    console.log(path[i].areaId, path[i].evaluationNode.prototype.idStr(), path[i].evaluationNode.toString());
                }
            }
        } else {
            var inp: AreaEN[] = exprTo[id];
            if (inp === undefined) {
                console.log("UNDEFINED!!!", path);
            } else {
                visited[id] = true;
                for (var i: number = 0; i < inp.length; i++) {
                    var nextId: number = inp[i].evaluationNode.watcherId;
                    getCycle(nextId, path.concat(inp[i]));
                }
            }
            visited[id] = false;
        }
    }

    exprTo[exprs[0].watcherId] = [];
    for (var i: number = 0; i < exprs.length; i++) {
        var expr = exprs[i];
        var inputs: EvaluationNode[];
        var areas: string[] = undefined;
        if (expr instanceof EvaluationAreaProjection) {
            inputs = expr.inputs.slice(0);
            areas = expr.inputs.map(function(x: EvaluationNode): string {
                return undefined;
            });
            for (var watcherId in expr.activeProducers) {
                var producer: Producer = expr.watchedProducers[watcherId];
                if (producer instanceof EvaluationNode) {
                    inputs.push(producer);
                }
                areas.push(expr.activeProducers[watcherId]);
            }
        } else {
            inputs = expr.allInputs();
        }
        if (inputs !== undefined) {
            for (var j: number = 0; j < inputs.length; j++) {
                var inp: EvaluationNode = inputs[j];
                var inpAreaId: string = areas === undefined || areas[j] === undefined?
                    areaIds[i]: areas[j];
                var from: AreaEN = { areaId: areaIds[i], evaluationNode: expr };
                if (inp !== undefined && !(inp.watcherId in exprTo)) {
                    exprs.push(inp);
                    areaIds.push(inpAreaId);
                    exprTo[expr.watcherId].push({
                        areaId: inpAreaId,
                        evaluationNode: inp
                    });
                    exprTo[inp.watcherId] = [];
                    exprFrom[inp.watcherId] = from;
                }
                console.log('"' + from.areaId + ' ' + from.evaluationNode.prototype.idStr() + '" -> "' +
                            inpAreaId + ' ' + inp.prototype.idStr() + '";');
            }
        }
    }
    getCycle(exprs[0].watcherId, [{areaId: areaId, evaluationNode: exprs[0]}]);
}
