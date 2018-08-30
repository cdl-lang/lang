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

/// <reference path="../utils/node.d.ts" />
/// <reference path="../feg/externalTypes.basic.d.ts" />
/// <reference path="../feg/utilities.ts" />
/// <reference path="../feg/systemEvents.ts" />
/// <reference path="remotingLog.ts" />


//
// a NetworkConnection is the common base-class for both NetworkClient and
//  NetworkServerConnection
// 
// A NetworkConnection allows its owner to define message callbacks for
//   various message types by calling 'addMessageHandler()'
//
// A NetworkConnection also allows its owner to define callbacks to receive
//   notifications of the progress of an inbound message. Since a single
//   message may be split into several buffers, this callback is called
//   with each buffer received to allow tracking the progress of the
//   transfer (even though, until the transfer is completed the message
//   itslef cannot be read).
//   The callback function can be set by calling setInboundProgressHandler().
//   The callback function is called with the following arguments:
//   <resource ID>, <sequenc number>, <length received>, <total length>
//   where <resource ID> is the ID of the resource, <sequence number> is the
//   sequence number assigned by the network layer to this message,
//   <length received> is the total number of bytes received for the message
//   so far and <total length> is the total length of the message.
// For tracking the progress of outbound messages, one should use the handler
//   set by setOutboundProgressHandler(). It is called when acknowledgements
//   are received form the other side for an outbound message. It is
//   called with the same arguments as the inbound progress handler
//   together with any reply object set by the client when sending the message.
//
// A NetworkConnection provides a 'sendMessage(msg)' method.
//
// Outgoing messages may be queued; there's a 'flush()' method to request
//  the message-queue to be flushed; otherwise, the queue is flushed when
//  queueDelay miliseconds have elapsed, or when queueSize message were
//  accumulated.
//
// A NetworkConnection owner may use 'sendReplyMessage()' rather than
//  'sendMessage()', quoting the message-id of the 'request' in the reply's
//  'inReplyTo:' attribute.
// A NetworkConnection owner may request a method to be called when a reply is
//  received for a specified request.
//
// All messages must be JSON objects. If a message starts with a [, + or ], it's
// understood to be a multi-part message, split up because of length reasons.
// '[' starts a multi-part message, '+' continues it, and ']' closes it. They
// need to be sent in order.

// Message Headers
// ---------------
//
// All modules making use of the NetworkConnection class send and receive
// full messages. Only when the full message has been received can the
// JSON object be parsed and passed on to the receiving module. Internally,
// however, the sending of a large JSON object (after being stringified)
// may be split into multiple buffers. To allow tracking the transfer of
// data (both on the receiving and the sending side) headers are added
// to each buffer sent. These headers identify the message and provide
// the total length of the message (as each buffer received may only
// store part of the total message). In addition, an acknowledgement
// mechanism is built into the network connection layer so that the
// sending client can track how much of the data it sent has already been
// received by the other side.
//
// We will refer to any message sent by some other module through the
// NetworkConnection class as a "data message" and to messages generated
// by the NetworkConnection class itself as "service messages". 
//
// Every message, whether a data message or a service message has a header.
// The header consists of several fields. Each field in the header
// is allocated a fixed number of characters. Header fields containing numbers
// are padded with zeros (on the left) to fill the required number of
// characters.
//
// The header fields are as follows (in the given order):
// <header version number>: the version number of the header protocol.
//   Two digits are reserved for this. If the buffer does nto start
//   with two digits, it is assumed to be of an older version (without
//   headers) and the connection is terminated.
// <segmentation indicator>: (1 character) "0", "[", "+" or "]"
//   "-": the whole message is contained in this buffer
//   "[": this is the first buffer in a message spanning multiple buffers.
//   "+": this is neither the first or the last buffer in a message
//        spanning multiple buffers.
//   "]": this is the last buffer in a message spanning multiple buffers.
// <resource ID>: this is the ID of the resource to which the message
//   belongs. This is a number. The number of digits allocated to
//   the resource ID is 'gNumResourceIdChars' (defined below). All buffers
//   sent must have a valid resource ID in this field.
// <sequence number>: every data message sent is assigned a sequence number
//   (sequentially, beginning with 1, for all messages sent by an application).
//   Service messages (acknowledgement messages and possibly other future
//   messages) generated by the NetworkConnection class itself are not assigned
//   a sequence number and are sent with 0 in this field.
//   The number of digits allocated to the sequence number is
//   'gNumSequenceNrChars' (defined below).
// <total message length>: this is the total length of the message (in
//   characters). This does not include the headers. For a message
//   split over multiple buffers, this is the total length of all these
//   buffers together (excluding the headers lengths). This is included with
//   every message (whether split over multiple buffers or not).
//   The number of digits allocated to the sequence number is
//   'gNumMessageLengthChars' (defined below).
//
// Received Length Acknowledgement Messages
// ----------------------------------------
//
// Whenever this module receives a buffer which is part of a data message
// (that is, sent by some higher level module through this class), it
// replies with a service message acknowledging the receipt of that message
// and the total number of characters received so far for this message
// (that is, including characters received in previous buffers for the same
// message).
//
// The acknowledgement message has the standard headers, with the resource ID
// of the message being acknowledged, a zero sequence number and the total
// length of the body of the acknowledgement message. The body of the
// acknowledgement message consists of the following fields (in order):
// <sequence number>: this is the seuqnece number of the message being
//    acknowledged. This has a fixed number of digits (with padding
//    zeros on the left). The number of digits allocated for this field is
//    'gNumSequenceNrChars' (same as in the header).
// <received length>: the total number of characters received so far for
//    this message. This has a fixed number of digits (with padding
//    zeros on the left). The number of digits allocated for this field is
//    'gNumMessageLengthChars'.
// <total length>: this is the total length of the message whose receipt
//    is being acknowledged. This is the length sent in the 'total length'
//    header field of that message.

//
// Header definitions
//

// number of characters reserved for the version of the headers.
var gNumHeaderVersionChars = 2;
// number of characters reserved for the resource ID at the beginning of
// each message buffer sent
var gNumResourceIdChars = 8;
// number of characters reserved for the sequence number at the beginning of
// each message buffer sent
var gNumSequenceNrChars = 10;
// number of characters reserved for the message length at the beginning of
// each message buffer sent
var gNumMessageLengthChars = 12;
// at least as many zeros as the largest number of digits assigned to a field
var gNetworkPaddingZeros = "00000000000000000";
var gNetworkHeaderLength = 1 + gNumResourceIdChars + gNumSequenceNrChars +
    gNumMessageLengthChars;

var gHeaderVersion = 1; // current version

var networkConnectionId = 1;

var gMaxMessageSize = 16000 - gNetworkHeaderLength;

// Settings for delaying messages
var baseDelay = 0;
var sizeDependentDelay = 0;

type InboundProgressHandler = (resourceId: number, sequenceNr: number, messageBufferLength: number, msgLength: number) => void;
type OutboundProgressHandler = (resourceId: number, sequenceNr: number, replyArgs: any, receivedLen: number, totalLen: number) => void;

/**
 * Message that can be sent to another party
 * 
 * @interface NetworkMessage
 */
interface NetworkMessage {
    /**
     * The message type: "resourceUpdate", "subscribe", "unsubscribe", ...
     * 
     * @type {string}
     * @memberof NetworkMessage
     */
    type: string;

    /**
     * The id of the resource this message pertains to for messages of type
     * subscribe, unsubscribe, releaseResource, write, define, and
     * synchronizeResource
     * 
     * @type {number}
     * @memberof NetworkMessage
     */
    resourceId?: number;

    resourceSpec?: ResourceSpecification;
    sequenceNr?: number;
    inReplyTo?: number;
    description?: string;
    revision?: number;
    list?: any[];
    update?: any;
    /// When true, this is an error message
    error?: boolean;
    /// When error, this is the error explanation
    reason?: string;
    username?: string;
    password?: string;
    email?: string;
    /// Present on login status; true/false indicates success of authentication
    authenticated?: boolean;
    /// Only the reply with the same sequence number should be accepted, in
    /// order to prevent problems arising when the login response is so slow,
    /// the logs in a second time before it has arrived.
    loginSeqNr?: number;
};

type NetworkMessageHandler = (replyArg: any, x?: boolean, message?: NetworkMessage) => void;

interface ParsedMessageHeader {
    segmentIndicator: string;
    resourceId: number;
    sequenceNr: number;
    msgLength: number;
    buffer: string;
};

interface ReplyObject {
    handler: NetworkMessageHandler;
    arg: any;
    timeoutTime?: any;
};

class NetworkConnection {

    connection: WebSocket|WebSocketConnection|undefined;

    sequenceNr: number = 1;

    id: number = networkConnectionId++;

    // queue of outgoing messages, waiting to be flushed
    messageQueue: any[] = [];

    // Guard for flush()
    flushing: boolean = false;

    // this table is indexed by sequence-ids, holding the handlers that
    //  are awaiting reply, and an optional extra argument to pass:
    //    this.onReply[<seqId>] = { handler: <function>, arg: <any> }
    onReply: {[seqId: number]: ReplyObject} = {};

    // if a reply timeout is set in the connection options:

    //this holds the time in which the first reply-timeout might occur
    replyTimeoutTime: number = undefined;

    // this holds the seq-nr of the message which would be the first to
    //  time-out waiting for a reply
    replyTimeoutSequenceNr: string = undefined;

    // this holds the timeout-id for the reply-timeout
    replyTimeoutId: any = undefined;

    // this holds the queue timeout-id, the timeout that would flush the
    //  message-queue once a message has been sitting there longer than
    //  this.poolDelay miliseconds; type differs between browser and nodejs.
    queueTimeoutId: any = undefined;

    // this stores event handlers for events such as 'error', 'open' and 'close'
    eventHandlerObj: {[event: string]: (evtData?: any) => void} = {};

    // this stores message handlers by message types
    //  (to be set by a derived class)
    messageHandlerObj: {[messageType: string]: NetworkMessageHandler} = {};

    // this stores an optional handler (to be set by a derived class) which
    //   handles notifications of the progress of inbound messages
    //   (see the documentation of setInboundProgressHandler() above for
    //   more details).
    inboundProgressHandler: InboundProgressHandler = undefined;

    // this stores an optional handler (to be set by a derived class) which
    //   handles notifications of the progress of outbound messages
    //   (based on network level acknowledgement messages received
    //   from the other side).
    //   The handler should be a function which receives the following
    //   arguments:
    //   ackMessageHandler(<resourceId>:number,
    //                     <sequence no. of acknowledged message>:number,
    //                     <number of bytes received so far>:number,
    //                     <total number of bytes in the message>:number)
    outboundProgressHandler: OutboundProgressHandler = undefined;
    
    // once 'poolSize' messages have accumulated in this.messageQueue, it
    //  is flushed
    poolSize: number;

    // once the oldest message in the queue has waited there 'poolDelay'
    //  miliseconds, the queue is flushed
    poolDelay: number;

    messageBuffer: string = undefined;
    delayedMessageQueue: { transmissionTime: number; message: string; }[] = [];
    delayedSendTaskId: any = undefined;

    // errorStatus is true when there is a connection error; used to send the
    // correct global system event
    errorStatus: boolean|undefined = undefined;

    static defaultPoolSize = 10;
    static defaultPoolDelay = 10;
    
    constructor(public options: any) {
        this.options = options;
        this.poolSize = (typeof(this.options.poolSize) === "number") ?
            options.poolSize : NetworkConnection.defaultPoolSize;
        this.poolDelay = (typeof(options.poolDelay) === "number") ?
            options.poolDelay : NetworkConnection.defaultPoolDelay;
    }
    
    // --------------------------------------------------------------------------
    // sendMessage
    //
    // send 'message' over the wire. 'message' should be a json object.
    //
    // if 'replyHandler' is defined, it should be a function that would be called
    //  when a reply to this message is accepted; if replyArg is also defined,
    //  replyHandler would get it as an extra argument
    //
    sendMessage(message: NetworkMessage, replyHandler?: NetworkMessageHandler, replyArg?: any): void {
        if (typeof(this.messageQueue) === "undefined") {
            // connection is currently shut-down
            this.dlog(1, "sendMessage: queue undefined");
            return;
        }
    
        message.sequenceNr = this.sequenceNr++;
        if (replyHandler !== undefined) {
            this.dlog(5, "sendMessage: waitForReply");
            this.waitForReply(replyHandler, replyArg, message.sequenceNr);
        }
    
        this.messageQueue.push(message);
        this.flushIfNeeded();
    }
    
    // --------------------------------------------------------------------------
    // sendReplyMessage
    //
    // send 'replyMessage' as a reply to the received message 'requestMessage'
    //
    sendReplyMessage(replyMessage: NetworkMessage, requestMessage: NetworkMessage): void {
        replyMessage.inReplyTo = requestMessage.sequenceNr;
        this.sendMessage(replyMessage);
    }
        
    // --------------------------------------------------------------------------
    // flushIfNeeded
    //
    // this private method tests if the connection should be flushed and/or if
    // the queue-timeout needs to be set
    //
    flushIfNeeded(): void {
        if (typeof(this.connection) === "undefined") {
            this.dlog(1, "flushIfNeeded: connection undefined");
            return;
        }
        if (this.getConnectionState() !== "open") {
            this.dlog(1, "flushIfNeeded: connection not open");
            return;
        }
    
        if (this.messageQueue.length > this.poolSize) {
            this.flush();
        }
    
        if (this.messageQueue.length > 0 && this.queueTimeoutId === undefined) {
            this.setQueueTimeout();
        }
    }
    
    // --------------------------------------------------------------------------
    // setQueueTimeout
    //
    setQueueTimeout(): void {
        var self = this;
        function callQueueTimeoutHandler() {
            self.queueTimeoutHandler();
        }
    
        if (this.queueTimeoutId === undefined) {
            this.queueTimeoutId =
                setTimeout(callQueueTimeoutHandler, this.poolDelay);
        }
    }
    
    // --------------------------------------------------------------------------
    // queueTimeoutHandler
    //
    // called when queue-timeout was triggered, flushes messageQueue
    //
    queueTimeoutHandler(): void {
        this.queueTimeoutId = undefined;
        this.flush();
    }
    
    delayedSendTask(): void {
        this.delayedSendTaskId = undefined;
        while (this.delayedMessageQueue.length > 0 &&
               Date.now() >= this.delayedMessageQueue[0].transmissionTime) {
            this.connection.send(this.delayedMessageQueue.shift().message);
        }
        this.scheduleDelayedSendTask();
    }
    
    scheduleDelayedSendTask(): void {
        if (this.delayedSendTaskId === undefined && this.delayedMessageQueue.length > 0) {
            var delay = this.delayedMessageQueue[0].transmissionTime - Date.now();
            if (delay > 0) {
                var self = this;
                this.delayedSendTaskId = setTimeout(function() {
                    self.delayedSendTask();
                }, delay);
            } else {
                this.delayedSendTask();
            }
        }
    }
    
    queueSendBuffer(lastBufferTime: number, buf: string): number {
    
        var transmissionTime: number = lastBufferTime === undefined ?
            Date.now() : lastBufferTime;
    
        transmissionTime += baseDelay + sizeDependentDelay * buf.length / 1000000;
        
        this.delayedMessageQueue.push({
            transmissionTime: transmissionTime,
            message: buf
        });
        this.scheduleDelayedSendTask();
    
        return transmissionTime;
    }
    
    // --------------------------------------------------------------------------
    // flush
    //
    // send the queued messages to the connection
    //
    flush(): void {
        if (this.flushing) {
            return;
        }
        this.flushing = true;
        if (typeof(this.queueTimeoutId) !== "undefined") {
            clearTimeout(this.queueTimeoutId);
            this.queueTimeoutId = undefined;
        }
    
        if (this.connection === undefined || this.getConnectionState() !== "open") {
            return;
        }
    
        var debugLastBufferTime: number = undefined;
        
        try {
            for (var i = 0; i < this.messageQueue.length; i++) {
                var msg = this.messageQueue[i];
                var msgStr = JSON.stringify(msg);
                this.dlog(6, function(){return "sending '" + msgStr + "'"});
                if (msgStr.length <= gMaxMessageSize) {
                    // fits in single buffer
                    msgStr = this.addHeader("-", msg.resourceId, msg.sequenceNr,
                                            msgStr.length, msgStr);
                    if (baseDelay === 0 && sizeDependentDelay === 0) {
                        this.connection.send(msgStr);
                    } else {
                        debugLastBufferTime =
                            this.queueSendBuffer(debugLastBufferTime, msgStr);
                    }
                } else {
                    for (var j = 0; j < msgStr.length; j += gMaxMessageSize) {
                        // character to indicate which part of the message this is
                        var segmentIndicator =
                            j === 0? '[':
                            j + gMaxMessageSize >= msgStr.length? ']': '+';
                        var subMsg =
                            this.addHeader(segmentIndicator, msg.resourceId,
                                           msg.sequenceNr, msgStr.length,
                                           msgStr.slice(j, j+gMaxMessageSize));
                        if (baseDelay === 0 && sizeDependentDelay === 0) {
                            this.connection.send(subMsg);
                            if (j > 0 && j % (100 * gMaxMessageSize) === 0) {
                                this.dlog(4, function() {
                                    return "sent " + j + " bytes";
                                });
                            }
                        } else {
                            debugLastBufferTime =
                                this.queueSendBuffer(debugLastBufferTime, subMsg);
                        }
                    }
                }
            }
        } catch (ex) {
            this.dlog(0, "ERROR: flush " + ex.toString());
        }
        this.messageQueue = [];
        this.flushing = false;
    }
    
    
    // --------------------------------------------------------------------------
    // waitForReply
    //
    // call handler, adding 'arg' as an extra argument, when a reply to message
    //  with seq-nr 'sequenceNr' is received (or when reply-timeout has elapsed)
    //
    waitForReply(handler: NetworkMessageHandler, arg: any, sequenceNr: number): void {
        var onReplyObj: ReplyObject = { handler: handler, arg: arg };
    
        this.onReply[sequenceNr] = onReplyObj;
        if (this.options.replyTimeout > 0) {
            onReplyObj.timeoutTime = Date.now() + this.options.replyTimeout;
            this.setReplyTimeout();
        }
    }
    
    // --------------------------------------------------------------------------
    // setReplyTimeout
    //
    // set reply-timeout according to the first message awaiting reply;
    // this is linear in the number of such messages, as the assumption is that
    // waiting for a reply would be rare
    //
    setReplyTimeout(): void {
        var self = this;
        function callTimeoutHandler() {
            self.replyTimeoutHandler();
        }
    
        var minSequenceNr: string = undefined;
        var minTime: number = undefined;
        for (var sequenceNr in this.onReply) {
            var onReplyObj = this.onReply[sequenceNr];
            var curTT = onReplyObj.timeoutTime;
            if (typeof(curTT) === "undefined") {
                continue;
            }
            if (minTime === undefined || minTime > curTT) {
                minTime = curTT;
                minSequenceNr = sequenceNr;
            }
        }
    
        if (minTime < Date.now()) {
            // XXX TBD: should call reply handler of those waiting too long, rather
            // XXX  than shutdown..
            this.shutdown("setReplyTimeout: min time has passed", true);
            return;
        }
    
        if (minTime === undefined || minTime < this.replyTimeoutTime) {
            this.clearReplyTimeout();
        }
    
        if (typeof(minTime) === "number" && this.replyTimeoutTime === undefined) {
            this.replyTimeoutTime = minTime;
            this.replyTimeoutSequenceNr = minSequenceNr;
    
            var tmo = Math.max(1, minTime - Date.now());
            this.replyTimeoutId = setTimeout(callTimeoutHandler, tmo);
        }
    }
    
    // --------------------------------------------------------------------------
    // clearReplyTimeout
    //
    clearReplyTimeout(): void {
        if (this.replyTimeoutId !== undefined) {
            clearTimeout(this.replyTimeoutId);
            this.replyTimeoutId = undefined;
            this.replyTimeoutTime = undefined;
            this.replyTimeoutSequenceNr = undefined;
        }
    }
    
    // --------------------------------------------------------------------------
    // replyTimeoutHandler
    //
    // called when the reply timeout was triggered
    // it is enough to call 'setReplyTimeout' as this method both sets the
    //  timeout for the next reply-message, and calls reply-handlers for those
    //  waiters whose wait-time has elapsed
    //
    replyTimeoutHandler(): void {
        this.setReplyTimeout();
    }
    
    // --------------------------------------------------------------------------
    // errorHandler
    //
    errorHandler(error: any): void {
        if (this.eventHandlerObj["error"] !== undefined) {
            this.eventHandlerObj["error"].call(this, error);
        }
        if (!this.errorStatus) {
            globalSystemEvents.notifyHandlers(["error", "connection error"]);
            this.errorStatus = true;
        }
    
        this.shutdown("errorHandler: error=" + error, true);
    }
    
    // --------------------------------------------------------------------------
    // closeHandler
    //
    closeHandler(error: any): void {
        if (this.eventHandlerObj["close"] !== undefined) {
            this.eventHandlerObj["close"].call(this, error);
        }
        if (this.errorStatus === undefined) {
            globalSystemEvents.notifyHandlers(["connection closed"]);
        }
    
        this.shutdown("closeHandler", true);
    }
    
    // --------------------------------------------------------------------------
    // openHandler
    //
    openHandler(): void {
        this.messageBuffer = undefined;
        if (this.eventHandlerObj["open"] !== undefined) {
            this.eventHandlerObj["open"].call(this);
        }
        if (this.errorStatus === undefined) {
            globalSystemEvents.notifyHandlers(["connection opened"]);
        }
        this.flushIfNeeded();
    }
    
    // --------------------------------------------------------------------------
    // messageHandler
    //
    messageHandler(messageString: string): void {
        var headersAndBody = this.readHeader(messageString);
    
        if(headersAndBody === undefined) {
            // indication of message with different header version, this was
            // already handled when the headers were read and there is nothing
            // more to do.
            return;
        }
        
        this.dlog(6, "received " + headersAndBody.buffer.length +
                  " characters of " + headersAndBody.msgLength +
                  " for resource " + headersAndBody.resourceId +
                  " sequence nr. " + headersAndBody.sequenceNr);
    
        if(headersAndBody.sequenceNr === 0) {
            // this is an acknowledgement message
            this.handleAcknowledgement(headersAndBody);
            return;
        }
        
        // First check if it's a split message
        switch (headersAndBody.segmentIndicator) {
          case '[':
            if (this.messageBuffer !== undefined) {
                this.dlog(0, "message out of order");
            }
            this.messageBuffer = headersAndBody.buffer;
            break;
          case '+':
            if (this.messageBuffer === undefined) {
                this.dlog(0, "message out of order");
                return;
            }
            this.messageBuffer += headersAndBody.buffer;
            break;
          case ']':
            if (this.messageBuffer === undefined) {
                this.dlog(0, "message out of order");
                return;
            } else {
                messageString = this.messageBuffer + headersAndBody.buffer;
                this.messageBuffer = undefined;
            }
            break;
          default: // full message in single buffer
            if (this.messageBuffer !== undefined) {
                this.dlog(0, "message out of order");
                this.messageBuffer = undefined;
            }
            messageString = headersAndBody.buffer;
            break;
        }
    
        // notify of message progress
        if(this.inboundProgressHandler !== undefined) {
            var legnthReceived = this.messageBuffer !== undefined ?
                this.messageBuffer.length : messageString.length;
            this.inboundProgressHandler(headersAndBody.resourceId,
                                        headersAndBody.sequenceNr, legnthReceived,
                                        headersAndBody.msgLength);
        }
        
        if(this.messageBuffer !== undefined) { // incomplete message
            this.sendAcknowledgement(headersAndBody.resourceId,
                                     headersAndBody.sequenceNr,
                                     this.messageBuffer.length,
                                     headersAndBody.msgLength);
            return;
        } else {
            this.sendAcknowledgement(headersAndBody.resourceId,
                                     headersAndBody.sequenceNr,
                                     messageString.length,
                                     headersAndBody.msgLength);
        }
        
        try {
            var message = JSON.parse(messageString);
    
            this.dlog(6, function() {
                return "got message " + messageString;
            });
    
            if (typeof(message.inReplyTo) !== "undefined") {
                this.handleReply(message);
                return;
            }
    
            var messageType = this.getMessageType(message);
            var handler = this.messageHandlerObj[messageType];
    
            this.dlog(5, "message of type " + messageType + " for resource " +
                      headersAndBody.resourceId +
                      (message.revision ? " with revision " + message.revision :
                       " without revision"));
            
            if (typeof(handler) !== "function" && messageType !== "error") {
                this.dlog(1, function() {
                    return "NetworkConnection: no handler for '" + messageType + "'"
                });
                this.sendReplyMessage({
                    type: "error",
                    description: "no handler for message type '" + messageType + "'"
                }, message);
                return;
            }
            handler.call(this, message);
    
            if (this.errorStatus !== undefined) {
                globalSystemEvents.notifyHandlers(["connection error cleared"]);
                this.errorStatus = undefined;
            }
    
        } catch (ex) {
            this.dlog(0, "ERROR: messageHandler " + ex.toString());
            console.error(ex);
            this.sendReplyMessage({
                type: "error",
                description: "exception while handling message"
            }, message);
            this.sendMessage({
                type: "reloadApplication",
                reason: "exception: " + ex.toString()
            });
            this.flush();
            this.shutdown("exception: " + ex.toString(), false);
        }
    }
    
    // --------------------------------------------------------------------------
    // handleReply
    //
    handleReply(message: NetworkMessage): void {
        var inReplyTo = message.inReplyTo;
        var onReplyObj = this.onReply[inReplyTo];
    
        if (onReplyObj === undefined) {
            this.dlog(0, "handleReply: reply not found");
            return;
        }
        delete this.onReply[inReplyTo];
        this.setReplyTimeout();
        onReplyObj.handler.call(this, onReplyObj.arg, true, message);
    }
    
    // --------------------------------------------------------------------------
    // addMessageHandler
    //
    addMessageHandler(type: string, handler: NetworkMessageHandler): void {
        this.messageHandlerObj[type] = handler;
    }
    
    // --------------------------------------------------------------------------
    // setInboundProgressHandler
    //
    setInboundProgressHandler(handler: InboundProgressHandler): void {
        this.inboundProgressHandler = handler;
    }
    
    // --------------------------------------------------------------------------
    // setOutboundProgressHandler
    //
    setOutboundProgressHandler(handler: OutboundProgressHandler): void {
        this.outboundProgressHandler = handler;
    }
    
    // --------------------------------------------------------------------------
    // addEventHandler
    //
    addEventHandler(type: string, handler: (evtData?: any) => void): void {
        switch (type) {
          case "open":
          case "close":
          case "error":
            this.eventHandlerObj[type] = handler;
            break;
          default:
            cdlInternalError("NetworkConnection.addEventHandler: " +
                                 "unknown event type '" + type + "'");
            break;
        }
    }
    
    // --------------------------------------------------------------------------
    // getMessageType
    //
    getMessageType(message: NetworkMessage): string {
        return message.type;
    }
    
    
    // --------------------------------------------------------------------------
    // shutdown
    //
    shutdown(msg: string, attemptReconnect: boolean): void {
        if (this.messageQueue === undefined) {
            // already done
            return;
        }
    
        this.dlog(1, "Shutting down connection: " + msg);
    
        this.clearMessageQueue();
    
        this.clearReplyTimeout();
    
        if (typeof(this.connection) !== "undefined") {
            this.connection.close();
            this.connection = undefined;
        }
    
        if (attemptReconnect) {
            this.clearReplyQueue();
        }
    }
    
    // --------------------------------------------------------------------------
    // clearMessageQueue
    //
    clearMessageQueue(): void {
        this.messageQueue = undefined;
    }
    
    // --------------------------------------------------------------------------
    // clearReplyQueue
    //
    clearReplyQueue(): void {
    
        for (var sequenceNr in this.onReply) {
            var onReplyObj = this.onReply[sequenceNr];
            delete this.onReply[sequenceNr];
            onReplyObj.handler.call(this, onReplyObj.arg, false);
        }
    
        this.setReplyTimeout();
    }
    
    // --------------------------------------------------------------------------
    // getConnectionState
    //
    getConnectionState(): string {
        if (typeof(this.connection) === "undefined") {
            return "error";
        }
    
        var readyState = (<WebSocket>this.connection).readyState;
        assert(typeof(readyState) === "number", "typecheck");
    
        var state = ["connecting", "open", "closing", "closed"][readyState];
        if (typeof(state) === "undefined") {
            state = "error";
        }
    
        assert(typeof(state) === "string", "getConnectionState");
    
        return state;
    }
    
    // --------------------------------------------------------------------------
    // getMessageSequenceNr
    //
    getMessageSequenceNr(message: NetworkMessage): number {
        return message.sequenceNr;
    }
    
    
    // --------------------------------------------------------------------------
    // dlog
    //
    dlog(severity: number, msg: string|(()=>string)): void {
        if (RemotingLog.shouldLog(severity)) {
            if (typeof(msg) === "function") {
                // msg should then be a parameterless function that returns a string
                msg = msg();
            }
            var connDesc = "(cid:" + String(this.id) + ")";
            if (this.connection && this.connection.url) {
                connDesc += "(" + this.connection.url + ":" +
                    this.getConnectionState() + ")";
            }
    
            RemotingLog.log(severity, String(msg) + connDesc);
        }
    }
    
    // Given the string of a buffer to be sent, together with the resource ID,
    // sequence number and total length of the message (the buffer may be
    // just part of the message) this function adds the headers for this buffer
    // and returns a string for the headers + buffer.
    // 'segmentIndicator' should be the character which should appear in the
    // <segmentation indicator> header field (see introduction).
    
    
    addHeader(segmentIndicator: string, resourceId: number, sequenceNr: number,
              msgLength: number, buffer: string): string
    {
        var headerVersion =
            (gNetworkPaddingZeros + gHeaderVersion).slice(-gNumHeaderVersionChars);
        var resourceIdStr =
            (gNetworkPaddingZeros + resourceId).slice(-gNumResourceIdChars);
        var sequenceNrStr =
            (gNetworkPaddingZeros + sequenceNr).slice(-gNumSequenceNrChars);
        var msgLengthStr =
            (gNetworkPaddingZeros + msgLength).slice(-gNumMessageLengthChars);
        
        return headerVersion + segmentIndicator + resourceIdStr + sequenceNrStr +
            msgLengthStr + buffer;
    }
    
    // Given the string of buffer just received, this function strips the
    // headers off this buffer. It returns an object of the form:
    // {
    //     segmentIndicator: "-" | "[" | "+" | "]" // value of segmentation header
    //     resourceId: <number>  // value of resource ID header
    //     sequenceNr: <number>  // value of resource ID header
    //     msgLength: <number> // value of message length header
    //     buffer: <string>  // message buffer without the headers
    // }
    //
    // If no revision number is detected at the beginning of the buffer, it is
    // assumed the other side is of an older version and this function
    // returns undefined.
    
    
    readHeader(buffer: string): ParsedMessageHeader {
        var pos = 0; // position of current header being read
        
        // get the header version
        var headerVersion = Number(buffer.substr(pos, gNumHeaderVersionChars));
        if(isNaN(headerVersion)) {
            this.signalTerminationToNoHeader();
            return undefined;
        } else if(headerVersion !== gHeaderVersion) {
            this.signalTerminationOtherHeaderVersion(headerVersion);
            return undefined;
        }
        pos += gNumHeaderVersionChars;
        
        var segmentIndicator = buffer.charAt(pos);
    
        pos += 1;
        
        var resourceId = Number(buffer.substr(pos, gNumResourceIdChars));
        pos += gNumResourceIdChars;
        
        var sequenceNr = Number(buffer.substr(pos, gNumSequenceNrChars));
        pos += gNumSequenceNrChars;
        
        var msgLength = Number(buffer.substr(pos, gNumMessageLengthChars));
        pos += gNumMessageLengthChars;
    
        return {
            segmentIndicator: segmentIndicator,
            resourceId: resourceId,
            sequenceNr: sequenceNr,
            msgLength: msgLength,
            buffer: buffer.slice(pos)
        };
    }
    
    // This function is called when 'receivedLength' characters were received
    // for a message of resource 'resouceId' (a number) with sequence number
    // 'sequenceNr' (this must be a data message, so 'sequenceNr' should not
    // be zero). 'totalLength' is the total length of the message
    // (as read from the headers of the last buffer received for this message).
    // This function sends an acknowledgement message for the receipt of
    // 'receivedLength' charcter for this message. For the structure of this
    // message, see the introduction.
    
    
    sendAcknowledgement(resourceId: number, sequenceNr: number,
                        receivedLength: number, totalLength: number): void {
        // construct the message
    
        var sequenceNrStr =
            (gNetworkPaddingZeros + sequenceNr).slice(-gNumSequenceNrChars);
        var receivedLengthStr =
            (gNetworkPaddingZeros + receivedLength).slice(-gNumMessageLengthChars);
        var totalLengthStr =
            (gNetworkPaddingZeros + totalLength).slice(-gNumMessageLengthChars);
    
        var ackMessage = sequenceNrStr + receivedLengthStr + totalLengthStr;
        var ackMessageWithHeader = this.addHeader("-", resourceId, 0,
                                                  ackMessage.length, ackMessage);
    
        try {
            this.connection.send(ackMessageWithHeader);
        } catch (ex) {
            this.dlog(0, "ERROR: send ack " + ex.toString());
        }
    }
    
    // This function receives an object describing a message buffer received, as
    // returned by the function readHeader. It is assumed this function is
    // called only if this message was an acknowledgement message. This function
    // then handles this acknowledgement (currently, this only prints a log
    // message).
    
    
    handleAcknowledgement(headersAndBody: ParsedMessageHeader): void {
        var pos = 0; // position inside message body 
        var sequenceNr =
            Number(headersAndBody.buffer.substr(pos, gNumSequenceNrChars));
        pos += gNumSequenceNrChars;
        
        var receivedLen =
            Number(headersAndBody.buffer.substr(pos, gNumMessageLengthChars));
        pos += gNumMessageLengthChars;
        
        var totalLen =
            Number(headersAndBody.buffer.substr(pos, gNumMessageLengthChars));
        pos += gNumMessageLengthChars;
    
        this.dlog(6, "received acknowledgement for " + receivedLen +
                  " characters of " + totalLen + " for message nr. " +
                  sequenceNr + " for resource " + headersAndBody.resourceId);
    
        // get the (optional) arguments stored by the client when the message
        // was sent (this can allow the consumer identify the message for which
        // this is an acknowledgement).
        var replyArgs;
        
        if (sequenceNr in this.onReply) {
            replyArgs = this.onReply[sequenceNr].arg;
        }
        if (this.outboundProgressHandler !== undefined) {
            this.outboundProgressHandler(headersAndBody.resourceId, sequenceNr,
                                         replyArgs, receivedLen, totalLen);
        }
    }
    
    /// This function is used to signal termination in case the message received
    /// from the other side has no headers. In this case, the standard send
    /// functions cannot be used, as they add headers. Therefore, this function
    /// directly implements the old protocol.
        
    signalTerminationToNoHeader(): void {
        if (this.connection === undefined || this.getConnectionState() !== "open") {
            return;
        }
    
        try {
            var msgStr = JSON.stringify({
                type: "terminate",
                reason: "incompatible version (reload application)"
            });
            this.connection.send(msgStr);
        } catch (ex) {
            this.dlog(0, "ERROR: signalTerminationToNoHeader " + ex.toString());
        }
    }
    
    // This function is used to signal termination when a message is received
    // from the other side with a different header version than the one
    // used by this client. Currently, this does nothing, as no other version
    // is possible. 'version' is the version of the headers received.
    
    
    signalTerminationOtherHeaderVersion(version: number): void {
        this.dlog(0, "message with header version " + version + " received");
    }
}
