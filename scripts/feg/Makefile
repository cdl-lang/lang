TSC=tsc --noImplicitAny --noImplicitReturns -t es2015 \
        --declaration --declarationDir include

# Keep intermediate files
.SECONDARY:

.PHONY: clean tsc

TSSOURCES=area.ts areaMonitor.ts areaTemplate.ts buildEvaluationNode.ts	 \
	buildFunctionNode.ts builtInFunctions.ts cdl.ts evaluationNode.ts    \
	evaluationQueue.ts externalTypes.ts valueType.ts functionExecute.ts  \
	functionGraph.ts functionNode.ts result.ts utilities.ts watcherProducer.ts \
	functionGraph.postlude.ts testRunner.ts testNode.ts taskScheduler.ts \
	elementReference.ts paidMgr.ts taskQueue.ts xdr.ts attributeDescription.ts \
	simpleQuery.ts cdlDebugger.ts predefinedFunctions.ts expression.ts   \
	appState.ts testElement.ts globals.ts dataSource.ts queryCompiler.ts \
	stringparser.ts debug.ts debugInterpret.ts pathFunctions.ts          \
	pathTreeNode.ts pointer.ts eventQueue.ts eventHandlers.ts            \
	evaluationNode.apply.ts evaluationNode.areaFunctions.ts              \
	evaluationNode.constructions.ts evaluationNode.cycleCheck.ts         \
	dataParsers.ts evaluationNode.database.ts evaluationNode.debugger.ts \
	evaluationNode.functions.ts evaluationNode.label.ts systemEvents.ts  \
	evaluationNode.state.ts evaluationNode.values.ts paidMgrInterface.ts \
	posConstraintSynchronizer.ts ../remoting/wsAuth.ts                   \
	../query/fegValueIndexer.ts  ../query/fegReplaceableValueIndexer.ts  \
	remotePaidInterface.ts foreignJavascriptFunctions.ts                 \

COMPILED_TS = $(TSSOURCES:%.ts=%.js)

MAIN=functionGraph.postlude.ts functionExecute.ts

%.codetest.js: %.codetest.ts
	tsc --noImplicitAny --out $@ $<

tsc: $(COMPILED_TS)
	@:

clean:
	-@rm $(COMPILED_TS) pathFunctions.d.ts

$(COMPILED_TS): tsc_intermediate

.INTERMEDIATE: tsc_intermediate

pathFunctions.d.ts: pathFunctions.ts
	$(TSC) $<

tsc_intermediate: $(TSSOURCES) pathFunctions.d.ts
	-npm update -g
	$(TSC) $(MAIN)

fegruntime:
	-tsc --lib es6,dom --target ES3 --outDir minbuild functionExecute.ts > /dev/null 2>&1
	-tsc --lib es6,dom --target ES3 --outDir minbuild/feg pathFunctions.ts
