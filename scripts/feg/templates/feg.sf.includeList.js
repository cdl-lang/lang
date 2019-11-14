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

// %%include%%: <scripts/feg/minbuild/feg/systemEvents.js>
;
// %%include%%: <scripts/external/bower_components/dom-to-image/dist/dom-to-image.min.js>
// %%include%%: <scripts/external/bower_components/file-saver/FileSaver.js>
// %%include%%: <scripts/utils/inheritance.js>
// %%include%%: <scripts/feg/minbuild/feg/pathFunctions.js>
// %%include%%: <scripts/utils/environment.js>
// %%include%%: <scripts/utils/debugTracing.js>
// %%include%%: <scripts/utils/sortedList.js>
// %%include%%: <scripts/utils/argParse.js>
// %%include%%: <scripts/utils/idMgr.js>
// %%include%%: <scripts/utils/debug.js>
// %%include%%: <scripts/utils/binsearch.js>
// %%include%%: <scripts/utils/arrayUtils.js>
// %%include%%: <scripts/feg/js/utils/debugObj.js>
// %%include%%: <scripts/feg/js/utils/debugObjConstraint.js>
// %%include%%: <scripts/feg/js/utils/debug.js>
// %%include%%: <scripts/feg/js/utils/debugTime.js>
// %%include%%: <scripts/feg/js/utils/misc.js>

// %%include%%: <scripts/feg/minbuild/feg/remotePaidInterface.js>
// %%include%%: <scripts/feg/minbuild/feg/xdr.js>
// %%include%%: <scripts/feg/minbuild/remoting/remotingLog.js>
// %%include%%: <scripts/feg/minbuild/remoting/wsAuth.js>
// %%include%%: <scripts/feg/minbuild/remoting/networkConnection.js>
// %%include%%: <scripts/feg/minbuild/remoting/networkClient.js>
// %%include%%: <scripts/feg/minbuild/remoting/remoteMgr.js>

// %%include%%: <scripts/feg/js/display/display.js>
// %%include%%: <scripts/feg/js/display/element.js>
// %%include%%: <scripts/feg/js/area/screenArea.js>
// %%include%%: <scripts/feg/js/area/intersectionChain.js>
// %%include%%: <scripts/feg/js/areaPos/posConstraintManager.js>
// %%include%%: <scripts/feg/js/areaPos/allPosConstraints.js>
// %%include%%: <scripts/feg/js/areaPos/automaticPointConstraints.js>
// %%include%%: <scripts/feg/js/areaPos/posConstraint.js>
// %%include%%: <scripts/feg/minbuild/feg/posConstraintSynchronizer.js>
// %%include%%: <scripts/feg/js/areaPos/posPair.js>
// %%include%%: <scripts/feg/js/areaPos/absolutePosManager.js>
// %%include%%: <scripts/feg/js/areaPos/contentPosManager.js>
// %%include%%: <scripts/feg/js/areaPos/labelPairOffset.js>
// %%include%%: <scripts/feg/js/posPoint/posPoint.js>
// %%include%%: <scripts/feg/js/posPoint/pointLabels.js>
// %%include%%: <scripts/feg/js/posPoint/relativeVisibilityPoint.js>
// %%include%%: <scripts/feg/js/posPoint/suffixPoint.js>
// %%include%%: <scripts/feg/js/zindex/zRelationGraph.js>
// %%include%%: <scripts/feg/js/zindex/zIndex.js>
// %%include%%: <scripts/feg/js/zindex/zArea.js>
// %%include%%: <scripts/positioning/combinationVectors.js>
// %%include%%: <scripts/positioning/forest.js>
// %%include%%: <scripts/positioning/vectorSet.js>
// %%include%%: <scripts/positioning/cycles.js>
// %%include%%: <scripts/positioning/linearConstraints.js>
// %%include%%: <scripts/positioning/segmentConstraints.js>
// %%include%%: <scripts/positioning/orGroups.js>
// %%include%%: <scripts/positioning/vecInnerProducts.js>
// %%include%%: <scripts/positioning/resistance.js>
// %%include%%: <scripts/positioning/posEquations.js>
// %%include%%: <scripts/positioning/posCalc.js>
// %%include%%: <scripts/positioning/positioning.js>
// %%include%%: <scripts/positioning/globalPos.js>
// %%include%%: <scripts/positioning/innerProducts.js>
// %%include%%: <scripts/positioning/debugPosEquations.js>

// %%include%%: <scripts/utils/heap.js>
// %%include%%: <scripts/query/internalQCMPathIdAllocator.js>
// %%include%%: <scripts/query/internalQCMCompression.js>
// %%include%%: <scripts/query/indexerQueue.js>
// %%include%%: <scripts/query/internalQCM.js>
// %%include%%: <scripts/query/internalQCMIndexer.js>
// %%include%%: <scripts/query/identityIndexer.js>
// %%include%%: <scripts/query/funcResult.js>
// %%include%%: <scripts/query/resultToMerge.js>
// %%include%%: <scripts/query/internalQueryResult.js>
// %%include%%: <scripts/query/dataResult.js>
// %%include%%: <scripts/feg/minbuild/query/fegValueIndexer.js>
// %%include%%: <scripts/feg/minbuild/query/fegReplaceableValueIndexer.js>
// %%include%%: <scripts/query/query.js>
// %%include%%: <scripts/query/idQuery.js>
// %%include%%: <scripts/query/compCalc.js>
// %%include%%: <scripts/query/compCalcKeys.js>
// %%include%%: <scripts/query/compValueQueryCalc.js>
// %%include%%: <scripts/query/internalQueryResult.js>
// %%include%%: <scripts/query/partitionCompResult.js>
// %%include%%: <scripts/query/partitionCompCalc.js>
// %%include%%: <scripts/query/comparison.js>
// %%include%%: <scripts/query/compResult.js>
// %%include%%: <scripts/query/mergeIndexer.js>
// %%include%%: <scripts/query/orderResult.js>
// %%include%%: <scripts/utils/trees/orderRequirements.js>
// %%include%%: <scripts/utils/trees/partialOrder.js>
// %%include%%: <scripts/query/orderService.js>

// %%include%%: <scripts/feg/minbuild/feg/globals.js>
// %%include%%: <scripts/feg/minbuild/feg/result.js>
// %%include%%: <scripts/feg/minbuild/feg/cdl.js>
// %%include%%: <scripts/feg/minbuild/feg/utilities.js>
// %%include%%: <scripts/feg/minbuild/feg/taskQueue.js>
// %%include%%: <scripts/feg/minbuild/feg/taskScheduler.js>
// %%include%%: <scripts/feg/minbuild/feg/watcherProducer.js>
// %%include%%: <scripts/feg/minbuild/feg/testNode.js>
// %%include%%: <scripts/feg/minbuild/feg/pointer.js>
// %%include%%: <scripts/feg/minbuild/feg/eventQueue.js>
// %%include%%: <scripts/feg/minbuild/feg/testRunner.js>
// %%include%%: <scripts/feg/minbuild/feg/elementReference.js>
// %%include%%: <scripts/feg/minbuild/feg/valueType.js>
// %%include%%: <scripts/feg/minbuild/feg/predefinedFunctions.js>
// %%include%%: <scripts/feg/minbuild/feg/paidMgr.js>
// %%include%%: <scripts/feg/minbuild/feg/area.js>
// %%include%%: <scripts/feg/minbuild/feg/areaMonitor.js>
// %%include%%: <scripts/feg/minbuild/feg/areaTemplate.js>
// %%include%%: <scripts/feg/minbuild/feg/stringparser.js>
// %%include%%: <scripts/feg/minbuild/feg/appState.js>
// %%include%%: <scripts/feg/minbuild/feg/dataSource.js>
// %%include%%: <scripts/feg/minbuild/feg/debug.js>
// %%include%%: <scripts/feg/minbuild/feg/evaluationNode.js>
// %%include%%: <scripts/feg/minbuild/feg/evaluationNode.values.js>
// %%include%%: <scripts/feg/minbuild/feg/evaluationNode.constructions.js>
// %%include%%: <scripts/feg/minbuild/feg/evaluationNode.apply.js>
// %%include%%: <scripts/feg/minbuild/feg/evaluationNode.functions.js>
// %%include%%: <scripts/feg/minbuild/feg/evaluationNode.state.js>
// %%include%%: <scripts/feg/minbuild/feg/evaluationNode.areaFunctions.js>
// %%include%%: <scripts/feg/minbuild/feg/evaluationNode.database.js>
// %%include%%: <scripts/feg/minbuild/feg/dataParsers.js>
// %%include%%: <scripts/feg/minbuild/feg/evaluationNode.debugger.js>
// %%include%%: <scripts/feg/minbuild/feg/evaluationNode.label.js>
// %%include%%: <scripts/feg/minbuild/feg/evaluationNode.cycleCheck.js>
// %%include%%: <scripts/feg/minbuild/feg/stringparser.js>
// %%include%%: <scripts/feg/minbuild/feg/builtInFunctions.js>
// %%include%%: <scripts/feg/minbuild/feg/foreignJavascriptFunctions.js>
// %%include%%: <scripts/feg/minbuild/feg/buildEvaluationNode.js>
// %%include%%: <scripts/feg/minbuild/feg/simpleQuery.js>
// %%include%%: <scripts/feg/minbuild/feg/evaluationQueue.js>
// %%include%%: <scripts/feg/minbuild/feg/externalTypes.js>
// %%include%%: <scripts/feg/minbuild/feg/functionNode.js>
// %%include%%: <scripts/feg/minbuild/feg/eventHandlers.js>
// %%include%%: <scripts/feg/minbuild/feg/functionExecute.js>
// %%include%%: <scripts/feg/minbuild/feg/cdlDebugger.js>
// %%include%%: <scripts/feg/minbuild/feg/debugInterpret.js>
// %%include%%: <scripts/feg/js/event/replayEventHistory.js>
// %%include%%: <scripts/feg/js/utils/interactiveMode.js>
