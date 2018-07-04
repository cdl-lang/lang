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

/// <reference path="externalTypes.ts" />

// We store the constraints in a buffer, and execute all buffered constraints
// when we're told to. We do this to avoid the problems when the geometry task
// runs between updates to areas, and we don't want to make the geometry task
// dependent on them.

// The global synchronizer object

function initPosConstraintSynchronizer() {
    globalPosConstraintSynchronizer = new PosConstraintSynchronizer();
    if (gArgParser.getArg("keepPosBuffer", false)) {
        globalPosConstraintSynchronizer.logBuffers();
    }
}

class PosConstraintSynchronizer {
    buffer: any[][] = [];
    count: number = 0;
    log?: any[][][];

    addSegment(point1: string, point2: string, constraintId: string,
               priority: number, extremum1: number, extremum2: number,
               stability?: boolean, preference?: string, orGroups?: any): void {
        // globalPos.addSegment(point1, point2, constraintId, priority, extremum1, extremum2, stability, preference, orGroups);
        this.buffer.push([0, point1, point2, constraintId, priority, extremum1,
                          extremum2, stability, preference, orGroups
                         ]);
    }
    
    removeSegment(point1: string, point2: string, constraintId: string): void {
        // globalPos.removeSegment(point1, point2, constraintId);
        this.buffer.push([1, point1, point2, constraintId]);
    }
    
    addLinear(p1point1: string, p1point2: string, p2point1: string, p2point2: string,
              scalar: number, priority: number, id: number): void {
        // globalPos.addLinear(p1point1, p1point2, p2point1, p2point2, scalar, priority, id);
        this.buffer.push([2, p1point1, p1point2, p2point1, p2point2, scalar, priority, id]);
    }
    
    removeLinearById(constraintId: string): void {
        // globalPos.removeLinearById(constraintId);
        this.buffer.push([3, constraintId]);
    }
    
    flushBuffer(): void {
        this.count += this.buffer.length;
        for (var i = 0; i !== this.buffer.length; i++) {
            var b = this.buffer[i];
            switch (b[0]) {
              case 0:
                globalPos.addSegment(b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9]);
                break;
              case 1:
                globalPos.removeSegment(b[1], b[2], b[3]);
                break;
              case 2:
                globalPos.addLinear(b[1], b[2], b[3], b[4], b[5], b[6], b[7]);
                break;
              case 3:
                globalPos.removeLinearById(b[1]);
                break;
            }
        }
        if ("log" in this) {
            this.log.push(this.buffer);
            this.buffer = [];
        } else {
            this.buffer.length = 0;
        }
    }
    
    isEmpty(): boolean {
        return this.buffer.length === 0;
    }
    
    logBuffers(): void {
        this.log = [];
    }
    
    stopLogging(): void {
        delete this.log;
    }
    
    logToStr(): string {
        return this.log.map(function(buffer): string {
            return buffer.map(function(pc): string {
                switch (pc[0]) {
                  case 0:
                    return "adds " + pc[1] + "," + pc[2];
                  case 1:
                    return "rems " + pc[1] + "," + pc[2];
                  case 2:
                    return "addl " + pc[1] + "," + pc[2] + "," + pc[3] + "," + pc[4] + "," + pc[5];
                  case 3:
                    return "reml " + pc[1];
                  default:
                    return "unknown";
                }
            }).join("\n");
        }).join("\n");
    }
}

var globalPosConstraintSynchronizer: PosConstraintSynchronizer;
