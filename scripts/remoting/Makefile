TSC=tsc --noImplicitAny --noImplicitReturns -t es2015

TSSOURCES=authorize/authorization.ts authorize/authorizationUtil.ts \
	changeAppState/changeAppState.ts cmdClient/actionDBCmdClient.ts \
	cmdClient/appStateCmdClient.ts cmdClient/elementWriteCmdClient.ts \
	cmdClient/singleElementCmdClient.ts dbio/dbio.ts formatUpgrade.ts \
	memoryXdr.ts networkClient.ts networkConnection.ts \
	networkServer.ts persistenceServer/persistenceServer.ts \
	remoteMgr.ts remotingLog.ts \
	remotingServerConnection.ts resourceMgr.ts wsAuth.ts \
	externalDataSourceAPI.ts redshiftExternalDataSource.ts

COMPILED_TS = $(TSSOURCES:%.ts=%.js)

D_TS_FILES=mongojs.d.ts

.PHONY: tsc

tsc: $(COMPILED_TS)
	@:

$(COMPILED_TS): tsc_intermediate

.INTERMEDIATE: tsc_intermediate

tsc_intermediate: $(TSSOURCES) $(D_TS_FILES)
	$(TSC) $(TSSOURCES)

clean: force
	-rm $(COMPILED_TS)

force:
