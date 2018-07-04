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

// %%include%%: <scripts/feg/systemEvents.js>

// %%include%%: <scripts/external/bower_components/dom-to-image/src/dom-to-image.js>
// %%include%%: <scripts/external/bower_components/file-saver/FileSaver.min.js>
// %%include%%: <scripts/utils/inheritance.js>
// %%include%%: <scripts/feg/pathFunctions.js>
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

// %%include%%: <scripts/feg/remotePaidInterface.js>
// %%include%%: <scripts/feg/xdr.js>
// %%include%%: <scripts/remoting/remotingLog.js>
// %%include%%: <scripts/remoting/wsAuth.js>
// %%include%%: <scripts/remoting/networkConnection.js>
// %%include%%: <scripts/remoting/networkClient.js>
// %%include%%: <scripts/remoting/remoteMgr.js>

// %%include%%: <scripts/feg/js/display/display.js>
// %%include%%: <scripts/feg/js/display/element.js>
// %%include%%: <scripts/feg/js/area/screenArea.js>
// %%include%%: <scripts/feg/js/area/intersectionChain.js>
// %%include%%: <scripts/feg/js/areaPos/posConstraintManager.js>
// %%include%%: <scripts/feg/js/areaPos/allPosConstraints.js>
// %%include%%: <scripts/feg/js/areaPos/automaticPointConstraints.js>
// %%include%%: <scripts/feg/js/areaPos/posConstraint.js>
// %%include%%: <scripts/feg/posConstraintSynchronizer.js>
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
// %%include%%: <scripts/query/fegValueIndexer.js>
// %%include%%: <scripts/query/fegReplaceableValueIndexer.js>
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

// %%include%%: <scripts/feg/globals.js>
// %%include%%: <scripts/feg/result.js>
// %%include%%: <scripts/feg/cdl.js>
// %%include%%: <scripts/feg/utilities.js>
// %%include%%: <scripts/feg/taskQueue.js>
// %%include%%: <scripts/feg/taskScheduler.js>
// %%include%%: <scripts/feg/watcherProducer.js>
// %%include%%: <scripts/feg/testNode.js>
// %%include%%: <scripts/feg/pointer.js>
// %%include%%: <scripts/feg/eventQueue.js>
// %%include%%: <scripts/feg/testRunner.js>
// %%include%%: <scripts/feg/elementReference.js>
// %%include%%: <scripts/feg/valueType.js>
// %%include%%: <scripts/feg/predefinedFunctions.js>
// %%include%%: <scripts/feg/paidMgr.js>
// %%include%%: <scripts/feg/area.js>
// %%include%%: <scripts/feg/areaMonitor.js>
// %%include%%: <scripts/feg/areaTemplate.js>
// %%include%%: <scripts/feg/stringparser.js>
// %%include%%: <scripts/feg/appState.js>
// %%include%%: <scripts/feg/dataSource.js>
// %%include%%: <scripts/feg/debug.js>
// %%include%%: <scripts/feg/evaluationNode.js>
// %%include%%: <scripts/feg/evaluationNode.values.js>
// %%include%%: <scripts/feg/evaluationNode.constructions.js>
// %%include%%: <scripts/feg/evaluationNode.functions.js>
// %%include%%: <scripts/feg/evaluationNode.state.js>
// %%include%%: <scripts/feg/evaluationNode.apply.js>
// %%include%%: <scripts/feg/evaluationNode.areaFunctions.js>
// %%include%%: <scripts/feg/evaluationNode.database.js>
// %%include%%: <scripts/feg/evaluationNode.debugger.js>
// %%include%%: <scripts/feg/evaluationNode.label.js>
// %%include%%: <scripts/feg/evaluationNode.cycleCheck.js>
// %%include%%: <scripts/feg/stringparser.js>
// %%include%%: <scripts/feg/builtInFunctions.js>
// %%include%%: <scripts/feg/buildEvaluationNode.js>
// %%include%%: <scripts/feg/simpleQuery.js>
// %%include%%: <scripts/feg/evaluationQueue.js>
// %%include%%: <scripts/feg/externalTypes.js>
// %%include%%: <scripts/feg/functionNode.js>
// %%include%%: <scripts/feg/eventHandlers.js>
// %%include%%: <scripts/feg/functionExecute.js>
// %%include%%: <scripts/feg/cdlDebugger.js>
// %%include%%: <scripts/feg/debugInterpret.js>
// %%include%%: <scripts/feg/foreignJavascriptFunctions.js>

// %%include%%: <scripts/feg/js/event/replayEventHistory.js>
