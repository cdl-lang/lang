function scheduleRemotingTask() {
    setImmediate(() => { gRemoteMgr.flush(); });
}

var gErrContext = {
    getErrorContext: function() { return undefined; }
}

var fs = require("fs");
