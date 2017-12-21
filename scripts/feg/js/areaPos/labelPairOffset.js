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

"use strict";

// -------------------------------------------------------------------------
// 
// LabelPairOffset
// 
// given two positioning labels, arrange to call
//   consumer.updateOffset(consumerIdent, label1, label2, offset)
// upon any change to the offset between label1 and label2.
// 
// The LabelPairOffset object also has a 'get()' method, that provides the
//  current known offset between the two labels.
//
// -------------------------------------------------------------------------
function LabelPairOffset(consumer, consumerIdent, label1, label2)
{
    this.label1 = label1;
    this.label2 = label2;
    this.consumer = consumer;
    this.consumerIdent = consumerIdent;

    var offset;

    globalPos.addWatchedCalcPair(this.label1, this.label2, this,
                                 this.updateOffset);
}

// --------------------------------------------------------------------------
// destroy
//
LabelPairOffset.prototype.destroy = labelPairOffsetDestroy;
function labelPairOffsetDestroy()
{
    globalPos.removeWatchedCalcPair(this.label1, this.label2,
                                    this, this.updateOffset);
}

// --------------------------------------------------------------------------
// get
//
LabelPairOffset.prototype.get = labelPairOffsetGet;
function labelPairOffsetGet()
{
    return globalPos.getPairOffset(this.label1, this.label2);
}

// --------------------------------------------------------------------------
// updateOffset
//
LabelPairOffset.prototype.updateOffset = labelPairOffsetUpdateOffset;
function labelPairOffsetUpdateOffset(offset, pairId, dir) {
    var points = globalPos.getPairPoints(pairId);

    if (points) {
        if (points[0] == this.label1) {
            assert(points[1] == this.label2);
        } else {
            assert(points[1] == this.label1);
            assert(points[0] == this.label2);
        }
        this.consumer.updateOffset(this.consumerIdent,
                                   this.label1, this.label2, offset);
    }
}
