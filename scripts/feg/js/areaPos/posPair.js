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


// This file defines a positioning pair. A pair consists of two points.
// This object takes a pair description object and constructs two PosPoint
// objects representing that pair. The description is assumed to contain
// at least the two following fields:
// {
//     point1: <point description>
//     point2: <point description>
// }
// Having constructed the PosPoint objects based on the two point descriptions,
// each of these objects holds a set of labels representing the points
// defined by the point description. Any pair of labels, one from the first
// point and the other from the second point is considered to be a label
// pair in this pair. Label pairs where both labels are identical are
// not considered valid pairs (and are simply ignored).
//
// Handlers can be registered to this pair object. The pair object calls
// these handlers to report changes to the pair list. These changes are
// stored in the 'changes' field and the handlers should access this field
// to process these changes. After all handlers were called, the changes
// list is cleared. The changes are cleared by replacing the changes
// object with an empty object. This means that if some external module
// holds a pointer to the original changes list, this list is not cleared
// and can be used after the changes on this PosPair object are cleared.
// There is no need for the handler called to duplicate the changes object.
//
// Thes handlers are stored in the object 'handlers', each handler under
// an ID assigned to it at registration. This ID is returned by the
// handler registration function, so this ID can be used to remove the handler.
// The handler should be an object X which is notified of a change
// by X.call(null, <point object>). The 'null' argument is intended to
// allow this to work when X is a standard JavaScript function.
//
// The flag 'dontCallHandlers' can be set to true when we do not want that
// the handlers registered to the PosPair object will be immediately called
// when the handlers regitered to the underlying PosPoint object return.
// This, for example, is used when we update the description of the pair.
// Since we have to update the description of both points, there is no point
// in calling the the handlers after the first point is updated and instead
// we can wait for the second point to be updated first. The 'changes'
// is updated whatever the state of the dontCallHandlers flag is.
//
// The full structure of the PosPair object is as follows:
//
// {
//    paid: paid,
//    points: [<PosPoint object>,<PosPoint object>],
//    labels: {
//       <label 1>: {
//          <label 2>: true,  // <label1,label2> is a label of this pair
//          .....
//       }
//       ....
//    }
//    changes: {
//       <label 1>: {
//          <label 2>: "added"/"removed" 
//          .....
//       }
//       ....
//    }
//    nextHandlerId: <number - next ID to be assigned to a handler>
//    handlers: {
//        <handler ID>: <handler object>
//        ....
//    },
//    dontCallHandlers: <true/false>
// }

// The pair object is constructed based on a base area paid and an (optional)
// pair description. If no pair description is provided, an empty pair is
// created (this can later be updated with a new desscription).

function PosPair(areaId, cm, pairDesc, name)
{
    this.areaId = areaId;
    this.name = name;
    // initialize with empty point objects 
    this.points = [new PosPoint(areaId, cm, name, 0),
                   new PosPoint(areaId, cm, name, 1)];
    this.changes = {};
    this.nextHandlerId = 1;
    this.labels = {};
    this.handlers = {};
    this.dontCallHandlers = false;

    // register handlers to receive changes from the points
    this.points[0].registerHandler(new PairPointHandler(this, 0));
    this.points[1].registerHandler(new PairPointHandler(this, 1));
    
    // completely refresh this object based on the given pair description
    if(pairDesc)
        this.newDescription(pairDesc);
}

// This function should be called just before the pair object is destroyed.
// It destroys the two underlying points and returns. It does not notify
// the handlers of the resulting changes, as it is assumed that this
// pair object is destroyed when the constraint object it belongs to is
// also destroyed.

PosPair.prototype.destroyPair = posPairDestroyPair;

function posPairDestroyPair()
{
    this.points[0].destroyPoint();
    this.points[1].destroyPoint();
}

// This function updates the pair with a new pair description. 

PosPair.prototype.newDescription = posPairNewDescription;

function posPairNewDescription(pairDesc)
{
    this.dontCallHandlers = true;
    if(!pairDesc) {
        this.points[0].newDescription(undefined);
        this.points[1].newDescription(undefined);
    } else {
        this.points[0].newDescription(pairDesc.point1);
        this.points[1].newDescription(pairDesc.point2);
    }
    this.dontCallHandlers = false;

    this.callHandlers();
}

/******************************************************************************/

// Another version of the previous function that takes as input the
//  descriptions of the two points
PosPair.prototype.updatePointsDescription = PosPair_updatePointsDescription;
function PosPair_updatePointsDescription(pointDesc1, pointDesc2)
{
    this.points[0].newDescription(pointDesc1);
    this.points[1].newDescription(pointDesc2);
}

/******************************************************************************/

// this function is called when the point object 'posPoint' whose index
// under 'this.points' is 'pointNum' has changes to report.
// The function updates the pair changes list and calls its own handlers.

PosPair.prototype.pointHandler = posPairPointHandler;

function posPairPointHandler(posPoint, pointNum)
{
    var otherPoint = pointNum ? this.points[0] : this.points[1];
    var otherLabel;

    // loop over the changes
    for(var label in posPoint.changes) {
        if(posPoint.changes[label] == "removed") {
            // remove all pairs which consist of this label and any of the
            // labels of the other point
            for(otherLabel in otherPoint.getLabels()) {
                if(!pointNum)
                    this.removePair(label, otherLabel);
                else
                    this.removePair(otherLabel, label);
            }
        } else {
            // add all pairs which consist of this label and any of the
            // labels of the other point
            for(otherLabel in otherPoint.getLabels()) {
                if(!pointNum)
                    this.addPair(label, otherLabel);
                else
                    this.addPair(otherLabel, label);
            }
        }
    }

    if(!this.dontCallHandlers)
        this.callHandlers();
}

// This function adds the pair (label1, label2) to the 'labels' list
// and registers it as "added" in the change list. If label1 and label2
// are equal, this pair is discarded. If the pair is already registered
// as "removed" in the change list, its entry in the change list is simply
// removed.

PosPair.prototype.addPair = posPairAddPair;

function posPairAddPair(label1, label2)
{
    if(!this.labels[label1])
        this.labels[label1] = {};
    this.labels[label1][label2] = true;
    
    // add the pair as "added" to the changes
    if(!this.changes[label1])
        this.changes[label1] = {};
    if(this.changes[label1][label2] == "removed")
        delete this.changes[label1][label2];
    else
        this.changes[label1][label2] = "added";
}

// This function removes the pair (label1, label2) from 'labels' and also
// registers it as "removed" in the change list. If label1 and label2
// are equal, this pair is ignored. If the pair is already registered
// as "added" in the change list, its entry in the change list is
// simply removed.

PosPair.prototype.removePair = posPairRemovePair;

function posPairRemovePair(label1, label2)
{
    if(this.labels[label1]) {
        delete this.labels[label1][label2];
        if(isEmptyObj(this.labels[label1]))
            delete this.labels[label1];
    }
    
    // add the pair as "removed" to the changes
    if(!this.changes[label1])
        this.changes[label1] = {};
    if(this.changes[label1][label2] == "added")
        delete this.changes[label1][label2];
    else
        this.changes[label1][label2] = "removed";
}

//////////////////////////////////
// Change Notification Handlers //
//////////////////////////////////

// The 'PosPair' object allows handlers to be registered. These handlers
// are called when there are changes in the label pairs for this pair.
// Each handler X is assumed to be an object which supports the member
// function X.call(null, <point pair object>). The 'null' argument is intended
// to allow this to work when X is a standard JavaScript function.
//
// It is up to the handler object to store any context information it will
// need when called.

// This function registers a new handler to the PosPair object. It is not
// verified that this handler was not registered before. The function
// returns an ID which can later be used to remove the handler.

PosPair.prototype.registerHandler = posPairRegisterHandler;

function posPairRegisterHandler(handler)
{
    if(!handler || typeof(handler.call) != "function") {
        mondriaInternalError("registering improper handler object: ", handler);
        return;
    }
    
    var id = this.handlers[this.nextHandlerId] = handler;

    ++this.nextHandlerId;

    return id;
}

// This function removes the handler with the given ID (if it is found)

PosPair.prototype.removeHandlerById = posPairRemoveHandlerById;

function posPairRemoveHandlerById(handlerId)
{
    delete this.handlers[handlerId];
}

// This function removes the given handler from the list of handlers.

PosPair.prototype.removeHandler = posPairRemoveHandler;

function posPairRemoveHandler(handler)
{
    for(var h in this.handlers) {
        if(this.handlers[h] == handler)
            delete this.handlers[h];
        // continue even if already deleted, since we do not want to assume
        // that each handler is only registered once.
    }
}

// This function calls all registered handlers. After calling the handlers,
// the changes list is cleared.

PosPair.prototype.callHandlers = posPairCallHandlers;

function posPairCallHandlers()
{
    // call handlers
    for(var h in this.handlers)
        this.handlers[h].call(null, this, this.name);

    // clear changes. By replacing the changes object we allow any module
    // still holding a copy of the changes object to keep using that copy.
    this.changes = {};
}

//////////////////////////
// Point Handler Object //
//////////////////////////

// This object provides a handler which can be registered to the underlying
// point objects. The 'call' function of this object is called by the point
// when it wants to notify the pair of changes in the labels of the point.
// The handler object registers which point it was constructed for
// (point1/point2: 0/1) and the PosPair object is was registered by.

function PairPointHandler(posPair, pointNum)
{
    this.posPair = posPair;
    this.pointNum = pointNum;
}

// The first argument to the call function is ignored. The second argument
// is the point object by which it was called.

PairPointHandler.prototype.call = pairPointHandlerCall;

function pairPointHandlerCall(unused, posPoint)
{
    if(this.posPair)
        this.posPair.pointHandler(posPoint, this.pointNum);
}
