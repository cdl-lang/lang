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

type SystemEventHandlerId = number;

class SystemEventHandler {
    id: SystemEventHandlerId;
    userInfo: any|undefined;
    handler: (id?: number, eventInfo?: any, userInfo?: any) => void;
}

/**
 * A dispatcher for events between unrelated modules.
 * 
 * If you are interested in event x, you register yourself as a handler via
 * addHandler(x, cb, userInfo?); cb is a callback function that will be called
 * every time event x occurs. It gets passed the handler's id, the optional user
 * info, and event info (if the event provides it). Unregistering is done via
 * removeHandler(x, id), using the id returned by addHandler.
 * 
 * The latest info of event x can be obtained via getLatestEventInfo(x), and the
 * number of times event x has been seen via getEventCount(x).
 * 
 * When an event occurs, notifyHandlers() should be called with a list of all
 * relevant event names. Having a list of events makes it a bit easier to
 * register a general "error" handler and more specialized handlers e.g. for
 * "connection error".
 * 
 * @class SystemEvents
 */
class SystemEvents {

    nextSystemEventHandlerId: SystemEventHandlerId = 0;

    eventHandlers = new Map<string, Map<SystemEventHandlerId, SystemEventHandler>>();

    lastEventInfo = new Map<string, { count: number; eventInfo: any;}>();

    addHandler(event: string, handler: (id?: number, eventInfo?: any, userInfo?: any) => void, userInfo?: any): SystemEventHandlerId {
        var id = this.nextSystemEventHandlerId++;

        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Map<SystemEventHandlerId, SystemEventHandler>());
        }
        this.eventHandlers.get(event).set(id, {
            id: id,
            handler: handler,
            userInfo: userInfo
        });
        return id;
    }

    removeHandler(event: string, id: SystemEventHandlerId): void {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).delete(id);
        }
    }

    /**
     * Notifies the handlers for the list of events.
     * 
     * @param {string[]} events 
     * @param {*} [eventInfo] 
     * 
     * @memberof SystemEvents
     */
    notifyHandlers(events: string[], eventInfo?: any[]): void {
        for (var i = 0; i < events.length; i++) {
            var event: string = events[i];
            if (this.eventHandlers.has(event)) {
                this.eventHandlers.get(event).forEach(
                    function(systemEventHandler: SystemEventHandler): void {
                        systemEventHandler.handler(
                            systemEventHandler.id,
                            eventInfo === undefined? undefined: eventInfo[i],
                            systemEventHandler.userInfo);
                    }
                );
            }
        }
        this.lastEventInfo.set(event, {
            count: this.getEventCount(event) + 1,
            eventInfo: eventInfo
        });
    }

    getEventCount(event: string): number {
        return this.lastEventInfo.has(event)? this.lastEventInfo.get(event).count: 0;
    }

    getLatestEventInfo(event: string): any|undefined {
        return this.lastEventInfo.has(event)?
               this.lastEventInfo.get(event).eventInfo: undefined;
    }
}

var globalSystemEvents = new SystemEvents();
