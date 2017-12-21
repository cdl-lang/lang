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

/// <reference path="utilities.ts" />
/// <reference path="externalTypes.ts" />

class MondriaPointer {

    static nextPointerId: number = 1;

    pointerID: number = MondriaPointer.nextPointerId++;
    id: number;
    position = {
        top: 0,
        left: 0
    };
    display = {
        image: "default"
    };
    button = {left: false, middle: false, right: false};
    modifier = {shift: false, control: false, meta: false, alt: false};
    image: string = "default";
    dragging: any[]|FileList = [];

    leftConstraintId: string;
    topConstraintId: string;
    myLeft: string;
    myTop: string;

    constructor(public leftAnchor: string, public topAnchor: string) {
        this.id = this.pointerID;
        this.leftConstraintId = "PointerLeft" + this.pointerID;
        this.topConstraintId = "PointerTop" + this.pointerID;
        addPointer(this);
        this.myLeft = labelBySuffix(getPointerRef(this.pointerID).getElement(),
                                    leftSuffix(undefined, false, false));
        this.myTop = labelBySuffix(getPointerRef(this.pointerID).getElement(),
                                    topSuffix(undefined, false, false));
    }
        
    destroy(): void {
        removePointer(this);
        // TODO: do we have to remove the segment added in .setPos()?
    // globalPos.removeSegment(this.leftAnchor, this.myLeft, this.leftConstraintId);
    // globalPos.removeSegment(this.topAnchor, this.myTop, this.topConstraintId);
    }
    
    setPos(x: number, y: number): boolean {
        var change = false;
    
        // Connect the position with the positioning constraints when changed
        if (this.position.top !== y) {
            this.position.top = y;
            globalPos.addSegment(this.topAnchor, this.myTop, this.topConstraintId,
                                 strongAutoPosPriority, y, y);
            change = true;
        }
        if (this.position.left !== x) {
            this.position.left = x;
            globalPos.addSegment(this.leftAnchor, this.myLeft, this.leftConstraintId,
                                 strongAutoPosPriority, x, x);
            change = true;
        }
        if (change) {
            this.flushUpdate();
        }
        return change;
    }
    
    setImage(img: string): void {
        if (typeof(img) !== "string") {
            Utilities.warn("pointer image should be a string");
            return;
        }
        if (this.display.image !== img) {
            this.display.image = img;
            this.flushUpdate();
        }
    }
    
    setDragState(dragState: any[]|FileList): void {
        if (!valueEqual(<any[]>this.dragging, <any[]>dragState)) {
            this.dragging = dragState;
            this.flushUpdate();
        }
    }
    
    
    setModifierState(isShift: boolean, isMeta: boolean, isAlt: boolean, isControl: boolean): void
    {
        if (this.modifier.shift !== isShift || this.modifier.control !== isControl ||
              this.modifier.alt !== isAlt || this.modifier.meta !== isMeta) {
            this.modifier.shift = isShift;
            this.modifier.meta = isMeta;
            this.modifier.alt = isAlt;
            this.modifier.control = isControl;
            this.flushUpdate();
        }
    }
    
    /// map the various attributes of the pointer to a single, feg-normalized
    /// data-item
    getFegValue() {
        var fegValue = [{
            position: [
                {
                    top: [this.position.top],
                    left: [this.position.left]
                }
            ],
            display: [
                {
                    image: [this.display.image]
                }
            ],
            button: [
                {
                    left: this.button.left? constTrueOS : constEmptyOS,
                    middle: this.button.middle? constTrueOS : constEmptyOS,
                    right: this.button.right? constTrueOS : constEmptyOS
                }
            ],
            modifier: [
                {
                    shift: this.modifier.shift? constTrueOS: constEmptyOS,
                    control: this.modifier.control? constTrueOS: constEmptyOS,
                    meta: this.modifier.meta? constTrueOS: constEmptyOS,
                    alt: this.modifier.alt? constTrueOS: constEmptyOS
                }
            ],
            id: [this.id],
            dragging: this.dragging
        }];
    
        return fegValue;
    }
    
    /// flush changes to the various pointer data attributes - modifiers, buttons,
    ///  position, image - to [pointer] so that they are available to cdl queries
    flushUpdate() {
        var pointerNode = <EvaluationPointerStore> globalEvaluationNodes[pointerNodeIndex];
    
        pointerNode.set(new Result(this.getFegValue()));
    }
    
    setButtonState(buttonId: number, value: string) {
        var state: boolean = value === "down";

        switch (buttonId) {
          case 0:
            if (this.button.left !== state) {
                this.button.left = state;
                this.flushUpdate();            
            }
            break;
          case 1:
            if (this.button.middle !== state) {
                this.button.middle = state;
                this.flushUpdate();            
            }
            break;
          case 2:
            if (this.button.right !== state) {
                this.button.right = state;
                this.flushUpdate();            
            }
            break;
        }
    }
}

var gPointerById: {[pointerId: string]: { pointer: MondriaPointer; elementRef: ElementReference; }} = {};

function addPointer(pointer: MondriaPointer) {
    gPointerById[pointer.pointerID] = {
        pointer: pointer,
        elementRef: new ElementReference("p" + pointer.pointerID)
    };
}
    
function removePointer(pointer: MondriaPointer): void {
    delete gPointerById[pointer.pointerID];
}

function getPointerRef(pointerID: number): ElementReference {
    return pointerID in gPointerById?
           gPointerById[pointerID].elementRef: undefined;
}

/// The global pointer object
var gPointer: MondriaPointer;
