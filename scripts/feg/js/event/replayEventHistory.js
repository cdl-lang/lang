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

// Slightly limited event replay functionality. You can dump an application's
// event history by calling dumpEventHistory(), and replay it by using the
// output as an argument to replayEventHistory() after reloading. For
// limitations, see FakeDomEvent() and replayNextEvent().

var replayStartTime = undefined;
var replayEventTime = undefined;
var replayHistory = undefined;
var replayTimeoutId = undefined;
var replayProgress = undefined;
var replayPosition = undefined;

// Prints the event history as a JSON string to the console. The string
// representation (without the quotes) can be used as the argument to
// replayEventHistory.
function dumpEventHistory() {
    console.log(JSON.stringify(gDomEvent.eventHistory));
}

// Creates an object with stubs for preventDefault, stopPropagation, and
// stopImmediatePropagation, so it can be passed as an argument to the
// MondriaDomEvent event handlers. Unfortunately, default event handling is
// not possible, so e.g. text input or clicking a link cannot be replayed.
function FakeDomEvent(obj) {
    for (var attr in obj) {
        this[attr] = obj[attr];
    }
}

FakeDomEvent.prototype.preventDefault = fakeDomEventPreventDefault;
function fakeDomEventPreventDefault() {
}

FakeDomEvent.prototype.stopPropagation = fakeDomEventStopPropagation;
function fakeDomEventStopPropagation() {
}

FakeDomEvent.prototype.stopImmediatePropagation =
      fakeDomEventStopImmediatePropagation;
function fakeDomEventStopImmediatePropagation() {
}

// Repeats the events in event history, more or less in in real time. This
// function only triggers playback via a timer mechanism that calls
// replayNextEvent.
function replayEventHistory(eventHistory) {
    replayHistory = eventHistory;
    replayProgress = 0;
    replayPosition = 0;
    if (replayHistory instanceof Array && replayHistory.length > 0) {
        replayTimeoutId = setTimeout(replayNextEvent, 1, 0);
    }
}

// Emulates the next event in replayHistory, with a number of changes and
// restrictions.
// 1. There is a certain amount of randomness in timing, and there are large
//    differences between computers, so it is very well possible that the queue
//    is still runnning when the next event is supposed to be executed. If this
//    is the case, replayNextEvent reschedules itself 500ms later.
// 2. Real time events have large, meaningless pauses. These are reduced to at
//    most 10ms when there is no queue activity after posting the event, and to
//    1000ms when there is.

// 3. Windows resize functions can't be replayed, since Chrome simply forbids
//    it. Consequently, a resize event is met with an error message, if the
//    window size is wrong. The first event is always a resize event, so
//    replaying will fail immediately if the window isn't of the correct size,
//    but resize events can also happen mid-stream. If that happens, the
//    debugger is invoked. This gives you the opportunity to resize the window
//    manually.
function replayNextEvent() {
    if (tasksInQueue()) {
        console.log("queue running");
        replayTimeoutId = setTimeout(replayNextEvent, 500);
        return;
    }
    replayProgress = replayPosition / replayHistory.length;
    if (Math.floor((replayPosition - 1) / (replayHistory.length / 10)) !==
          Math.floor(replayPosition / (replayHistory.length / 10))) {
        console.log("progress", (replayProgress * 100).toFixed(0) + "%");
    }
    replaySingleEvent(replayHistory[replayPosition]);
    replayPosition++;
    if (replayPosition < replayHistory.length) {
        // First event happens before load is complete, so has already happened
        var delayUntilNextEvent = replayPosition === 0? 0:
              replayHistory[replayPosition].time -
              replayHistory[replayPosition - 1].time;
        if (delayUntilNextEvent > 500) {
            console.log("wait", delayUntilNextEvent);
        }
        if (tasksInQueue()) {
            delayUntilNextEvent = Math.min(delayUntilNextEvent, 1000);
        } else {
            delayUntilNextEvent = Math.min(delayUntilNextEvent, 10);
        }
        replayTimeoutId = setTimeout(replayNextEvent, delayUntilNextEvent);
    } else {
        console.log("replay done");
    }
}

function replaySingleEvent(evt) {
    switch (evt.type) {
      case "mousemove":
        gDomEvent.mouseMoveHandler(new FakeDomEvent({
            type: "mousemove",
            clientX: evt.absX,
            clientY: evt.absY,
            time: evt.time,
            shiftKey: evt.shiftKey,
            metaKey: evt.metaKey,
            altKey: evt.altKey,
            ctrlKey: evt.ctrlKey
        }));
        break;
      case "MouseUp": case "MouseDown":
        console.log(evt.type);
        gDomEvent.mouseEventHandler(new FakeDomEvent({
            type: evt.type.toLowerCase(),
            clientX: evt.absX,
            clientY: evt.absY,
            shiftKey: evt.modifier.indexOf("shift") >= 0,
            altKey: evt.modifier.indexOf("alt") >= 0,
            ctrlKey: evt.modifier.indexOf("control") >= 0,
            time: evt.time
        }), evt.type);
        break;
      case "wheel":
        console.log(evt.type);
        gDomEvent.wheelEventHandler(new FakeDomEvent({
            type: evt.type,
            absX: absX,
            absY: absY,
            deltaX: evt.deltaX,
            deltaY: evt.deltaY,
            deltaZ: evt.deltaZ,
            deltaMode: deltaMode,
            shiftKey: evt.modifier.indexOf("shift") >= 0,
            altKey: evt.modifier.indexOf("alt") >= 0,
            ctrlKey: evt.modifier.indexOf("control") >= 0,
            time: evt.time
        }));
        break;
      case "KeyUp": case "KeyDown": case "KeyPress":
        console.log(evt.type);
        gDomEvent.keyEventHandler(new FakeDomEvent({
            type: evt.type.toLowerCase(),
            key: evt.key,
            char: evt.char,
            which: evt.which,
            charCode: evt.charCode,
            location: evt.location,
            repeat: evt.repeat,
            shiftKey: evt.modifier.indexOf("shift") >= 0,
            altKey: evt.modifier.indexOf("alt") >= 0,
            ctrlKey: evt.modifier.indexOf("control") >= 0,
            time: evt.time
        }), evt.type, evt.type === "KeyPress"? "char": "key", "global");
        break;
      case "resizeScreenArea":
        console.log(evt.type);
        while (window.innerWidth !== evt.width ||
               window.innerHeight !== evt.height) {
            var success = true;
            console.log("Window size is wrong; change to", evt.width,
                        "wide and", evt.height, "high, or set success to",
                        "false to abort");
            debugger;
            if (!success)
                return false;
        }
        break;
      case "comment":
        // doesn't generate events
        break;
      default:
        console.log("error: unknown event type " + evt.type);
        return false;
    }
    return true;
}
