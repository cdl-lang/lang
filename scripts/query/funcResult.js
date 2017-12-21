// Copyright 2017 Yoav Seginer.
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


// This object is the base class representing a function application.
// It is used to create chains of function applications.
// This object is connected to other FuncResult objects in the chain 
// in two ways: 
// 1. One or more data objects representing the input to this function result
//    calculation. These data function results may either represent the
//    result of another function application (in this case we have
//    function composition) or a data source (e.g. indexer + path +
//    set of data element IDs). There may be various implementations
//    of this data object. It only has to comply by the interface
//    described below.
//    It is up to the derived class to indicate how many such data objects
//    are required.
// 2. Composed function results: these are function result objects
//    which have this function result as their data object.
//    These function results do not need to represent actual function
//    applications. They may also represent, for example, 
//    the interface to the merge indexer.
//    This function result object simply forwards its result to 
//    the composed function result objects. It also updates them
//    when the indexer or path from which the result is extracted
//    change.
//    This function result object needs to be aware of whether these
//    objects support multiple projection paths. If any of the
//    composed function results do not support this and the function
//    is a multi-projection, an intermediate indexer must be created,
//    in which the result of the multi-projection needs to be stored.
//    It is then the root path of this indexer which represents the
//    result (for those function result objects which do not support
//    multi-paths).
//    This property is static. To change it, one need to remove the
//    composed function result and add it back again (with the new
//    property). This should rarely happen.
//
// It is assumed that at the bottom of every function application chain 
// there is a terminal function result node. This node does not
// take itself a function result object as its data source, but 
// defines such a data source. One such object is the DataResult 
// object (which defines an indexer as the source of the data). Often,
// a query (InternalQueryResult) is composed with this DataResult object 
// to extract the required subset out of that indexer. If this
// query result node is omitted, the DataResult object needs to take over
// its tasks and register on the indexer path node to receive updates.
// Therefore, each DataResult node needs to check what result nodes are composed
// with it. If any of them is not a query result node, the data node 
// needs to become active, register to indexer and receive and forward
// updates.
// See more in the documentation of DataResult.
//
// Chaining Interface
// ------------------
//
// To create and modify function result chains, one can use the following
// functions:
//
// setData(<FuncResult>, <number>): sets the data to which 
//    the function is to be applied. The second argument is a number
//    indicating which data object is being set, in case this FuncResult
//    object has multiple data objects. This sets the FuncResult object 
//    given as argument as the data source of the function result object 
//    on which this function is called. This FuncResult object on which 
//    this function is called then also
//    becomes a composed function of the function result given as argument.
//
// setTerminalData(<terminal function result>): this function takes
//    a terminal function result (such as DataResult) as its argument.
//    It then sets it as its data object for each data object which is
//    not defined (the derived class should create an array to hold the 
//    data objects and assign it the correct length). It also uses it 
//    to replace those existing data objects 
//    which are 'replaceable terminal data objects'. For data objects which 
//    are not terminal, it calls setTerminalData() on these data objects, 
//    with the same <terminal function result> object. For data objects 
//    which are terminal but not replaceable, no action takes place. This allows
//    one to set a common data source for a tree
//    of composed function results through the root of this tree
//    (while protecting terminal nodes which are 'nonreplaceable' and need
//    to be replaced explicitly through 'setData()'). 

// Derived Class Interface
// -----------------------
//
// The following function need to be implemented by a derived class of this
// class.
//
// Functions called by the data result object (or when it is changed):
//
// supportsMultiProj(): returns true if this result object can receive
//    multiple projections as input (e.g. if the result node represents
//    a merge indexer target). This is considered a static property
//    of the result node. If a result node changes this property, it needs
//    to detach itself as a composed result and then add itself again.
//    The default implementation below returns false.
//
// isActive(): indicate whether this node is active.
//
// isOrder(): indicate whether this node implemenets an ordering function
//     (function which depends on the ordering of the elements).
//
// getComposedSelectingNum(): this function should return the number of
//     active* selecting result nodes which are composed* with the data
//     object which called this function through 'this' result node.
//     If 'this' node is a selecting node, this is 1 and otherwise this
//     is 'this.composedSelectingNum' (for function results which are
//     not extracting, this will be 0). The default implementation of the
//     function returns this.composedSelectingNum.
//
// refreshIndexerAndPaths(<data object>):
//    this function is called every time either the indexer or the
//    projection path(s) of the data result object may have
//    changed. It receives the data object as argument in case there are
//    multiple data objects (FuncResult nodes which have a single data source
//    can ignore this). This is called after the new indexer and projection
//    path(s) have been set on the data result object. It may also be that
//    some or all of the existing matches received from the data object
//    were removed, but before new matches are added.
//    It is the responsibility of this function to remove any remaining
//    matches on the function result and call this function 
//    recursively on composed active* nodes (and therefore there is no need
//    to forward the match removals, since calling this function on the
//    composed active* functions will remove the matches). Since this
//    function is called after the dominated indexer and path
//    were replaced (at some lower data object) each object must make sure
//    it still has a pointer to the original indexer and path if these
//    are needed for the removal of the matches.
//    This function will not be called for result nodes which support 
//    multi-projection paths if the indexer did not change but the
//    projection paths did. In this case, the function 
//    refreshProjMappings(<path mappings>) will be called instead (see below).
//
// replaceIndexerAndPaths(<prev prefix path ID>, <prefix path ID>,
//                        <new indexer contained>, <data object>):
//    This function is called when the dominated indexer and paths change
//    but in such a way that the result does not change (for example,
//    this happens when a result indexer is added or removed at one
//    of the result nodes with which this result node is composed* and,
//    as a result, the indexer and paths on which this query is registered
//    need to change, but the full matches are unchanged).
//    Therefore, this function does not need to change the full matches, but
//    only replace the source of the function result from the previous indexer
//    (and projection path(s)) to the new indexer. As a result of this
//    change in source indexer, the dominated identification may also
//    change. However, the actual full matches should not change.
//    'prevPrefixPathId' and 'prefixPathId' indicate how the projection paths
//    of the data object before and after the change are related. For every
//    projection path, removing the prefix 'prevPrefixPathId' from the old
//    prefix path and adding 'prefixPathId' before it should result in the new
//    projection path. <new indexer contained> indicates the relationship
//    between the matches of the new indexer and the old indexer. If this is
//    1, the new indexer matches are contained in the old indexer matches.
//    If this is -1, the old indexer matches are contained in the new indexer
//    matches. If this is 0, the matches are the same. If this is undefined,
//    this is unknown.
//
// increaseMatchCount(<decrease in match count>, <data object matches>,
//                    <source>)
//    This function is called on a function result by its data object
//    when the dominated match count of the data object increases (this is
//    not called when the data object is replaced, as that happens
//    separately). The default behavior of this function is not to do
//    anything. However, function results which are dependent on the
//    dominated match count are given here a chance to update. Moreover,
//    function results whose dominated match count is not fixed and whose
//    dominated match count is affected by the match count they receive
//    from the data object need to propagate this call.
//    The caller of the function must provide its dominated matches,
//    in case these are needed by 'this' function result in order to update
//    its match count (this is probably only need by query result nodes).
//    Finally, the caller must provide itself as the last argument <source>
//    (in case the function result receiving the call has multiple data
//    objects).
// decreaseMatchCount(<decrease in match count>, <data object matches>,
//                    <source>)
//    This function is called on a function result by its data object
//    when the dominated match count of the data object decreases (this is
//    not called when the data object is replaced, as that happens
//    separately). The default behavior of this function is not to do
//    anything. However, function results which are dependent on the
//    dominated match count are given here a chance to update. Moreover,
//    function results whose dominated match count is not fixed and whose
//    dominated match count is affected by the match count they receive
//    from the data object need to propagate this call.
//    The caller of the function must provide its dominated matches,
//    in case these are needed by 'this' function result in order to update
//    its match count (this is probably only need by query result nodes).
//    Finally, the caller must provide itself as the last argument <source>
//    (in case the function result receiving the call has multiple data
//    objects).
//
// refreshProjMappings(<path mappings>): this function is called on 
//    result nodes which support data result objects with multiple projections
//    when the projection path mappings of the data result obejct change, 
//    but the indexer does not (if the indexer changed, refreshIndexerAndPaths()
//    is called). <path mappings> are the new path mappings for the data result
//    object. This is a Map object whose keys are the projection IDs
//    and where under each projection ID the mapping of that projection
//    is defined (the mapping is an array of target and source path IDs,
//    see the merge indexer for more details). Projections which were removed
//    carry an undefined value as their mapping.
//    It is currently assumed that result nodes which support multi-projections
//    have a single data object, so there is no need to indicate here which
//    data object has updated its projection matches.
//
// aboutToSetData(<new data object>, <number>): this function is called just
//    before the data object of this function result is set (which may replace
//    an existing data object). <new data object> is the new data object
//    about to be set and <number> identifies the data object if there are
//    several (same as in setData()).
//    The default implementation of this function does nothing and
//    this function needs only be implemented by derived classes
//    which wish to take some action before this operation begins
//    (for example, suspend match updates for uptes received during
//    the update).
//
// addDataObjMatches(<old data object>, <did the indexer or path change>, 
//                   <number>): 
//    this function is called after a new data object was set. <number>
//    identifies the data object if there are several (same as in setData()).
//    This function should pull the matches from the new data object.
//    To do so efficiently, it receives the old data object as well
//    as a flag indicating whether either the indexer
//    or the projection path of the data result changed as a result of
//    this update (in case of a multi-projection data result object, this
//    is always true). If this flag is true, refreshIndexerAndPaths() was
//    called before this function was called.
//    This function is not called if the node is not active*.
// removeDataObjMatches(<new data object>, <did the indexer or path change>,
//                      <number>): 
//    this is called when the data object is about to be removed or 
//    replaced. <number> identifies the data object if there are several 
//    (same as in setData()).The function should remove the matches due 
//    to the data object. It receives as extra information the 
//    new data object and a flag indicating whether either the indexer
//    or the projection path of the data result changed as a result of
//    this update (in case of a multi-projection data result object, this
//    is always true). If this flag is true, refreshIndexerAndPaths() will
//    be called after this function was called. This means that in this
//    case it is optional for removeDataObjMatches() to remove the matches,
//    because it is the responsibility of refreshIndexerAndPaths() to
//    remove any remaining matches on the object itself, so if the object's
//    removeDataObjMatches() did not perform this removal,
//    refreshIndexerAndPaths() will do so (refreshIndexerAndPaths() is called
//    after the data object has been replaced, so for some function result
//    nodes it may be better to perform the removal earlier). I any case,
//    since refreshIndexerAndPaths() is also called on all composed
//    active* functions, there is no need to propagate match removal, as
//    these functions will take care of it.
//    This function is not called if the node is not active*. 
//
// addMatches(<element IDs>, <source>): for result objects which do not support 
//    multiple projections, this is called by the data result object <source>
//    to notify of matches added to its result (the new matches are
//    provided as an array of element IDs).
// removeMatches(<element IDs>, <source>): for result objects which do 
//    not support multiple projections, this is called by the data result object
//    <source> to notify of matches removed from its result (the removed 
//    matches are provided as an array of element IDs).
// removeAllMatches(<source>): this function is similar to 'removeMatches()'
//    except that it does not specify the list of matches to be removed
//    but specifies that all matches added by the given source data object
//    should be removed. For some function result objects there may be
//    a way of implementing this which is more efficient than removing
//    the matches one by one. However, when this function is called, the
//    source data object should still be able to provide the full list of
//    matches which needs to be removed by a call to its getDominatedMatches()
//    function. Therefore, a module should always be able to implement
//    removeAllMatches(<source>) by:
//    removeMatches(<source>.getDominatedMaches(),<source>).
// addProjMatches(<element IDs>, <result ID>, <projection ID>): 
//    for result objects which support multiple projections, this is called 
//    by the data result object to notify of matches added to one of its
//    projections. The new matches are provided as an array of element IDs.
//    Since multiple projections are possible, the projection ID must
//    also be given. The result ID indicated from which data result object
//    this update was received.
// removeProjMatches(<element IDs>, <result ID>, <projection ID>):
//    for result objects which support multiple projections, this is called 
//    by the data result object to notify of matches removed from one of its
//    projections. The removed matches are provided as an array of element IDs.
//    Since multiple projections are possible, the projection ID must
//    also be given. The result ID indicated from which data result object
//    this update was received.
//
// refreshOrdering(): this function is called
//    when this node is an order* node (a node such as it or one of
//    its composed* node is an ordering function) and when the comparison
//    defining the ordering at this function result node has changed.

// Functions called by composed function results (or when they are added):
//
// isTerminalResult(): return true if this is a terminal function 
//    result node which does not take a data result object but defines
//    its data directly (such as a DataResult object).
// isReplaceableTerminalResult(): for result nodes which are terminal
//    result nodes, this function should indicate whether when setting
//    a new terminal result through this function setTerminalData(),
//    these objects should be replaced by the new object or not
//    (some DataResult object may have thi return true while other false).
// aboutToAttachActiveComposed(): this function is called when a composed
//    active function is about to be attached. The function is called before
//    any attachment takes place, so all counters on this object are,
//    at the time this function is called, as before the attachement took
//    place (specifically, isActiveStar() still returns the value as
//    before the attachment).
// aboutToAddActiveComposed(<function result object>, <was active start>):
//    This function is called when an active* composed function has
//    already been attached and its addition is about to be completed.
//    This function is called after all counters are updated (e.g. number
//    of active composed functions) in the attchement phase, but before
//    the function result <function result object>
//    is added to the composedActive list. In this way, the derived class
//    can already determine the state of this node (base on the counters)
//    and can then deliver updates to existing active composed nodes
//    without delivering the same update to the new active composed
//    node (this is updated separately).
//    <was active start> is a flag indicating whether this node was active*
//    before this active* composed function was added to it.
// becameActiveStar(): this function is called after an active composed
//    function was added in case this node was previously not active*.
//    This gives the derived class a chance to perform proper initialization.

// activeComposedFuncRemoved(<function result object>):
//    This function is called by the base class when a composed function 
//    which was active* is no longer active* or is no longer composed with
//    this result node. This is called after this composed result node
//    was removed from the 'composedActive' table but before the data 
//    result object is notified that the active* property of this node
//    has changed (if it did).
//
// updateComposedSelectingNum(<number>, <non-final update>): this function
//    is used to update the 'composedSelectingNum' property of 'this'
//    function result. <number> (which may also be negative) is the count
//    by which 'this.composedSelectingNum' should be increased. The derived
//    class implemention of this function must also take care of all
//    consequences of this update, such as propagation of this update to its
//    content data object or updating of other properties of 'this' object
//    (e.g. whether a result indexer should be created). The caller can
//    indicate (by setting the argument <non-final update>) that this
//    function result may expect a second call to this function or a
//    call to completeComposedSelectingNumUpdate() to follow
//    immediately. In such cases, one can postpone dealing with the
//    consequences of this update until the next call to this function
//    or to completeComposedSelectingNumUpdate().
// completeComposedSelectingNumUpdate(): this function is called after
//    the composed selecting number may have been updated (by the
//    function updateComposedSelectingNum()). It is used in cases where
//    updateComposedSelectingNum() was called with a second argument
//    which was true (or in case of doubt). This function indicates that
//    the composed selecting number may have changed and the consequences
//    of this change may not have been handled. If this is indeed the
//    case, this as an opportunity for this function to handle these
//    consequences.
//
// getContentDataObj(): This function should return the data objects which
//    is the content input of this result node, which means that the
//    dominated matches of this result node are extracted from the
//    dominated matches of the content data object. Among other things,
//    the ordering on the dominated matches of a result node depends
//    on the ordering of the matches of the content data object.
//    Each result object must have exactly one content data object.
// isContentDataObj(<argument number>): this function is only to be used
//    on result nodes with multiple data objects. <argument number> is then
//    the argument number identifying one fo the data objects of the result
//    node. The returns true if the data object under that argument number
//    is the content data object of this result node (see getContentDataObj()
//    for a definition of the content data object) and false otherwise.
//
// getDominatedIndexer(): return the indexer which stores the result.
// getDominatedProjPathId(): returns the single projection path 
//    in the indexer returned by getDominatedIndexer() where the 
//    result of this function result object is stored. This may be 
//    undefined if the result object represents a multi-projection
//    on the indexer. Composed objects which cannot handle this situation
//    are protected from it by result objects of the multi-projections 
//    by creating a result indexer which then becomes the dominated 
//    indexer (the result is then stored at the root of this indexer). 
//    result nodes which can handle multi-projections can use 
//    getDominatedProjMappings() to retrieve the path information from their 
//    data object.
// getDominatedProjPathNum(): this is the number of projection paths
//    of this result node. This is always at least 1 (the path in the 
//    dominated indexer where the result is to be found). If this is more
//    than one, all active composed results must support multi-projections.
//    In this case, getDominatedProjPathId() returns undefined and the 
//    composed result node need to use getDominatedProjMappings().
// getDominatedProjMappings(): this function returns the path mappings of the 
//    projections of the function under this function result node.
//    This is returned as a Map object whose keys are the projection IDs
//    and whose value is an array: 
//    [<target path ID 1>, <source path ID 1>,....,
//                                     <target path ID n>, <source path ID n>]
//    where <source path ID i> are paths in the dominated indexer of 
//    the result, each a proper prefix (not necessarily the immediate prefix)
//    of the next source path ID in the list.
//    <target path ID i> are each the immediate prefix path of 
//    <target path ID i+1> and <target path ID 1> is the root path.
//    This array indicates to which path in the target nodes from a path 
//    in the source (dominated indexer) need to be mapped to.
// getTerminalProjMatches(<projection ID>): this function returns an array
//    with the element IDs which are the projection matches of the terminal
//    projection with the given projection ID. This projection ID must
//    be one of the projection IDs returned by getDominatedProjMappings().
//    This function should then return the matches of the
//    corresponding projection. Each function result can determine how
//    to implement this. These matches must agree with those matches
//    added minus those removed by calls to addProjMatches() and
//    removeProjMatches() by the result node for the given projection.
// filterTerminalProjMatches(<projection ID>, <element IDs>): this function
//    returns an array which is a subset of the input array <element IDs>
//    such that the returned array only contains those elements in
//    <element IDs> which are also in the array returned by
//    getTerminalProjMatches(<projection ID>).
// getDomMatchCount(): returns the contribution of this result node 
//    to the match count of composed queries. Usually, this is 1.
//    For selection queries, this is the match count of the result node.
//    For result nodes which represent the indexer without selection on
//    it, this is zero.
// getDominatedMatches(<projection ID>): this function must return an array 
//    with the data element IDs representing the matches of this result.
//    In case this function result is a multi-projection, the projection ID
//    needs to be given as argument to retrieve the matches for that
//    specific projection. 
// getDominatedMatchesAsObj(<projection ID>): same as getDominatedMatches() 
//    but with the data element IDs as keys of the returned Map object.
// filterDominatedMatches(<element IDs>): this function is given
//    an array of element IDs as input. The function checks which of these
//    element IDs belong to the set of dominated matches of the function
//    result node and returns an array containing the subset of
//    elements in the input array which are dominated matches.
// filterDominatedMatchPositions(<element IDs>): this function is given
//    an array of element IDs as input. The function checks which of these
//    element IDs belong to the set of dominated matches of the function
//    result node and returns an array which stores the positions in
//    the input array which hold element IDs which belong to the dominated
//    matches. For example, if the input array is [3,6,9,3,14,2] and
//    element IDs 2, 3 and 6 are in the set of dominated matches, this
//    function returns [0,1,3,5]. As in this example, the same element ID
//    may appear more than once in the input array and if it is in the
//    dominated matches, all its positions in the input array must appear in
//    the output array. The positions in the input array are returned in
//    increasing order.
//
// getDominatedIdentification(): this function should return an 
//    identification ID for an identification in the dominated indexer of
//    the result object (this identification ID may be undefined for the 
//    base identification).
// getDominatedComparison(): this function should return the CompInfo
//    object which consists of various comparison information for the
//    ordering defined on the dominated matches of this object, including
//    the CompResult object which defines the comparison function
//    which applies to the ordering of the dominated matches. The
//    CompInfo may be undefined. CompResult nodes return a CompInfo
//    object containing themselves in this function while some other result
//    nodes may modify the comparison information (e.g. whether
//    raising of elements is needed etc.). Most result nodes simply
//    forward the CompInfo node they receive from their data result.
//
// Object Structure
// ----------------
//
// {
//     id: <unique ID of this function result object>
//     qcm: <InternalQCM>
//     composedFuncs: {
//         <func result ID>: <composed function result object>,
//         .....
//     }
//     numComposedFuncs: <number of entries in above table>
//
//     composedActive: {
//         <function result ID>: <function result object>,
//         ................
//     }
//     composedActiveNum: <number of entries in 'composedActive'>
//     composedSupportMultiProjNum: <number of result nodes in 'composedActive'
//                                   which support multi-projection>
//     composedQueryResultNum: <number>
//     composedMatchTransparentNum: <number> 
//     composedOrderStar: <Map>{
//         <func result ID>: <function result object>,
//         .....
//     }
//
//     composedSelectingNum: <number>     
//
//     multipleDataObjs: <number of data objects>
//     dataObjs: <array of result objects representing the data>
//     dataObj: <pointer to dasvn commit taObjs[0]>
//
//     composedRemovalInProgress: undefined|<function result object>
//     composedAdditionInProgress: undefined|<function result object>
//     activeStarPending: true|false|undefined
//     destroyed: true|undefined        
// }
//
// id: unique ID of this function result. This is allocated form the central
//      InternalQCM ID pool.
// qcm: internal QCM object providing various global services (e.g. path IDs
//      and compression).
// composedFuncs: list of function result nodes compose with this
//      node.
// numComposedFuncs: number of entries in composedFuncs.
// composedActive: subset of 'composedFunc' which are active*, that is,
//      are either active themselves or have a composed function which 
//      is active.
// composedActiveNum: number of entries in the 'composedActive' table.
//      If this number is larger than zero, this function result is 
//      active*. This function result node may be active even if this
//      number is zero.
// composedSupportMultiProjNum: this number of result nodes in 'composedActive'
//      which support direct input from multiple projections (e.g. a result
//      node representing a merge indexer target).
// composedQueryResultNum: the number of active composed functions which 
//      represent a query (that is, are an InternalQueryResult object).
// composedMatchTransparentNum: the number of active composed functions which
//      inherently do not change the matches, that is, their own dominated
//      matches are equal to the dominataed matches of their content
//      data object. Examples of such function result nodes are the
//      comparison result nodes (which define an ordering but do not
//      change the matches) and the identity result node.
// composedOrderStar: this a table of all active composed functions which
///     are order*, that is, either are themselves an ordering function
//      or have some active composed* function which is an ordering function.
// composedSelectingNum: this is the number of active* composed* result
//    nodes for this result node which are 'selecting' result objects
//    and such that there is no intermediate 'selecting' result node
//    between that node and 'this' result node. A result node is 'selecting'
//    if it is a query and is not a pure projection query. It is up to each
//    node to determine whether it is a selecting result node and update its
//    data object accordingly. Nodes which have multiple data objects update
//    only their 'content data object' (see 'isContentDataObj()' and
//    'getContentDataObjs()' functions above).
//    The function used for updating this property (and must be
//    implemented by every function result) is 'updateComposedSelectingNum()'
//    (see above).
//
// dataObjs: this is an array holding the data objects which provide the
//      input data to this FuncResult node. This is used only in case
//      the function result object has multiple data objects. It is 
//      up to the derived class to create this array in its constructor
//      and assign it the correct length (it should has 'undefined'
//      entries at first).
// dataObj: result object representing the data of this function
//      application. If the derived class does not define the array 
//      'dataObjs', this is used to store the single data object.
//
// composedRemovalInProgress: the removal of a composed active* function
//      is performed in two steps: detaching the active* composed function
//      (which updates the various composed number counters and removes
//      the composed function from the list of active* composed) and the
//      completion of the removal, which includes the deactivation of
//      'this' node in case the removal of the active* composed function
//      implies such deactivation. The separation into two steps is needed,
//      for example, in the process of setting a new data object
//      on a function result R, where R is first removed from the old data
//      object and only then set on the new data object (so that if the old data
//      object is dominated by the new data object then updates from
//      the old data object as a result of this update will not go to R
//      through two different paths and so that all composed counters on the
//      old data object will reflect the situation at the end of the update).
//      The detach step stores the detached active* function under the
//      field 'composedRemovalInProgress' so that it remains accessible
//      until the final removal and also to indicate that the removal
//      has not been completed (this, for example, keeps 'this' function
//      result active* until the removal is completed).
// composedAdditionInProgress: the addition of an active* composed function
//      to a function result node takes place in two steps: attachment
//      (where the various composed active counters are increased) and
//      completion (when the active composed function is actually added to
//      the list of active composed functions and becomes available for
//      receiving match updates from its data object). When an active*
//      composed function is attached to a function result, it is stored
//      under the 'composedAdditionInProgress' field of its new data object
//      until the addition is completed.
//      
// activeStarPending: this flag is set to indicate that this function result
//      node is in the process of becoming active*. It is intended to manage
//      notifications received from lower nodes in the process of activation.
//      The flag is set to true at the beginning of the process of
//      adding an active composed function if this function result was
//      not previously active* (it will become active* as a result of
//      adding the active composed function). This flag is not set if
//      this function result is a terminal result node (because its
//      intention is to help handle notifications from lower nodes,
//      which do not exist if this is a terminal result node).
//      The flag is reset to 'undefined' just before calling
//      'becameActiveStar()'. A derived class may buffer notifications
//      it receives from lower nodes while the 'activeStarPending'
//      flag is set and process them when 'becameActiveStar()' is called
//      (this allows the node to complete its initialization before
//      processing the notifications).
//      While 'activeStarPending' is true, the function 'isActiveStar()'
//      returns 'false'.
// destroyed: indicate that this node was destroyed (this is set at the
//      beginning of the destroy function).

inherit(FuncResult, DebugTracing);

// inidicate that debugging should be turned on
var debugTracingFuncResult = false;

//
// Constructor
//

// takes the internal QCM object which provides it with different global
// services (path ID allocation, compression, etc.) as the only argument.

function FuncResult(internalQCM)
{
    this.id = InternalQCM.newId();
    this.qcm = internalQCM;
    this.composedFuncs = {};
    this.numComposedFuncs = 0;
    this.composedActive = {};
    this.composedActiveNum = 0;
    this.composedSupportMultiProjNum = 0;
    this.composedQueryResultNum = 0;
    this.composedMatchTransparentNum = 0;
    this.composedOrderStar = undefined; // may often remain empty
    this.composedSelectingNum = 0;

    if(this.DebugTracing !== undefined)
        this.DebugTracing(0, debugTracingFuncResult);
}

// Destructor

FuncResult.prototype.destroy = funcResultDestroy;

function funcResultDestroy()
{
    this.destroyed = true;
    if(this.dataObjs) {
        for(var i = 0, l = this.dataObjs.length ; i < l ; ++i)
            if(this.dataObjs[i])
                this.dataObjs[i].removeComposedFunc(this.getId(), i);
        this.dataObjs = undefined;
    } else if(this.dataObj) {
        this.dataObj.removeComposedFunc(this.getId());
        this.dataObj = undefined;
    }
}

//////////////////////
// Access Functions //
//////////////////////

FuncResult.prototype.getId = funcResultGetId;

function funcResultGetId()
{
    return this.id;
}

// This function returns true if this function result node has active*
// composed functions which are not query result nodes.

FuncResult.prototype.hasNonQueryActiveComposed =
    functionResultHasNonQueryActiveComposed;

function functionResultHasNonQueryActiveComposed()
{
    return this.composedQueryResultNum < this.composedActiveNum;
}

// This function returns the number of composed functions (whether active*
// or not).

FuncResult.prototype.getNumComposedFuncs =
    functionResultGetNumComposedFuncs;

function functionResultGetNumComposedFuncs()
{
    return this.numComposedFuncs;
}

// This function returns the number of active* selecting composed* functions
// of this node which are also active* selecting composed* for the content
// data object. The default implementation simpy returns
// this.composedSelectingNum (which should be 0 for non-extracting functions).
// This default should be modified by selecting function results to return 1.

FuncResult.prototype.getComposedSelectingNum =
    functionResultGetComposedSelectingNum;

function functionResultGetComposedSelectingNum()
{
    return this.composedSelectingNum;
}

////////////////////////////////
// Modifying the Result Chain //
////////////////////////////////

// set a new data object. If this FuncResult has multiple data objects,
// 'argNum' should be given, to indicate which one it is ('argNum' should 
// be 0, 1, 2, ...).
// This consists of three basic steps: removal of the matches due to
// the old data object, refresh of the indexer and prefix projection path
// (if needed) and addition of the matches of the new data object.

FuncResult.prototype.setData = funcResultSetData;

function funcResultSetData(dataObj, argNum)
{
    var oldObj = this.dataObjs ? this.dataObjs[argNum] : this.dataObj; 
    if(oldObj == dataObj)
        return; // nothing changed

    if(this.doDebugging) {
        this.debugMessage("setting new data under result ",
                          this.debugPrintDesc() + ":");
        this.debugMessage("     was ",
                          oldObj ? oldObj.debugPrintDesc() : "<undefined>");
        this.debugMessage("     is now ",
                          dataObj ? dataObj.debugPrintDesc() : "<undefined>");
    }
    
    var oldCompInfo;
    if(this.isOrderStar() && oldObj !== undefined)
        oldCompInfo = oldObj.getDominatedComparison();
    
    // allow the derived class to take necessary actions before the
    // operation takes place.
    this.aboutToSetData(dataObj, argNum);

    if(oldObj) {
        // indicate that this function result is about to be removed
        // as a composed function result of the old data object
        // (this only detaches the composed function, but the removal
        // is only completed below).
        if(this.id in oldObj.composedActive)
            oldObj.removeComposedFunc(this.getId(), argNum, true);
    }
    
    if(dataObj)
        dataObj.addComposedFunc(this, argNum);

    var indexerOrPathChanged = 
        (!oldObj || !dataObj || 
         oldObj.getDominatedIndexer() != dataObj.getDominatedIndexer() ||
         oldObj.getDominatedProjPathId() != dataObj.getDominatedProjPathId() || 
         dataObj.getDominatedProjPathNum() > 1);

    // remove the matches of the original data object
    if(this.isActiveStar())
        this.removeDataObjMatches(dataObj, indexerOrPathChanged, argNum);

    if(oldObj) {
        oldObj.completeActiveComposedFuncRemoval(this, argNum);
        oldObj.completeComposedSelectingNumUpdate();
    }
    
    if(this.dataObjs) {
        this.dataObjs[argNum] = dataObj;
    } else {
        this.dataObj = dataObj;
    }
    
    if(this.isActiveStar()) {
        if(indexerOrPathChanged)
            this.refreshIndexerAndPaths(dataObj);
        this.addDataObjMatches(oldObj, indexerOrPathChanged, argNum);
        if(this.isOrderStar() &&
           (this.dataObjs === undefined || this.isContentDataObj(argNum))) {
            var compInfo = dataObj.getDominatedComparison();
            if(oldCompInfo !== compInfo &&
               (oldCompInfo === undefined || compInfo === undefined ||
                oldCompInfo.compResult !== compInfo.compResult))
                this.refreshOrdering();
        }
    }
}

// This is a default implementation of this function, which does nothing.
// A derived class which wishes to take some action before the replacement
// of the data object begins should implement this function.

FuncResult.prototype.aboutToSetData = funcResultAboutToSetData;

function funcResultAboutToSetData(dataObj, argNum)
{
    // does nothing
}

// This is a default implementation for this function. Many derived classes
// may modify or extend this function.
// This function is called just after either one of the data result objects 
// was set or replaced. 'indexerAndPathChanged' indicates whether either
// the indexer or the projection path of the new data object differ
// from those of the old data object. This default implementation
// calls 'addMatches()' with the appropriate list of matches.
// If 'indexerAndPathChanged' is true, these are all matches (which are
// fetched from the new data object). If 'indexerAndPathChanged' is false,
// the old matches are first compared with the new matches and
// addMatches() is called with the difference between the two sets.

FuncResult.prototype.addDataObjMatches =
    funcResultAddDataObjMatches;

function funcResultAddDataObjMatches(oldDataObj, indexerAndPathChanged,
                                     argNum)
{
    var newDataObj = (this.dataObjs === undefined) ?
        this.dataObj : this.dataObjs[argNum];
    
    if(newDataObj === undefined)
        return; // nothing to add
    
    if(indexerAndPathChanged)
        this.addMatches(newDataObj.getDominatedMatches(), newDataObj);
    else {
        var newMatches = newDataObj.getDominatedMatches();
        var oldMatches = oldDataObj.getDominatedMatchesAsObj();
        var addedMatches = [];

        for(var i = 0, l = newMatches.length ; i < l ; ++i) {
            var elementId = newMatches[i];
            if(!oldMatches.has(elementId))
                addedMatches.push(elementId);
        }

        this.addMatches(addedMatches, newDataObj);
    }
}

// This is a default implementation for this function. Many derived classes
// may modify or extend this function.
// This function is called just before one of the data result objects is 
// about to be set or replaced. This default implementation
// calls 'removeMatches()' with the appropriate list of matches.
// If 'indexerAndPathChanged' is true, these are all matches (which are
// fetched from the old data object). If 'indexerAndPathChanged' is false,
// the old matches are first compared with the new matches and
// removeMatches() is called with the difference between the two sets.

FuncResult.prototype.removeDataObjMatches =
    funcResultRemoveDataObjMatches;

function funcResultRemoveDataObjMatches(newDataObj, indexerAndPathChanged,
                                        argNum)
{
    var oldDataObj = (this.dataObjs === undefined) ?
        this.dataObj : this.dataObjs[argNum];
    
    if(oldDataObj === undefined)
        return; // nothing to remove
    
    if(indexerAndPathChanged || newDataObj === undefined) {
        this.removeMatches(oldDataObj.getDominatedMatches(), oldDataObj);
    } else {
        var oldMatches = oldDataObj.getDominatedMatches();
        var newMatches = newDataObj.getDominatedMatchesAsObj();
        var removedMatches = [];

        for(var i = 0, l = oldMatches.length ; i < l ; ++i) {
            var elementId = oldMatches[i];
            if(!newMatches.has(elementId))
                removedMatches.push(elementId);
        }

        this.removeMatches(removedMatches, oldDataObj);
    }
}

// This function is called in the process of updating the matches as a
// result of splicing out result nodes in the chain under this function
// result node. It is called iff the dominated match count of this result node
// after the splicing is zero (which means that it and all its data object
// chain do not perform any selection over the data in the indexer it
// dominates) but its match count before the splicing was not zero (which
// means it must have been 1). 'matches' are the existing dominated matches
// of the data object of this node. These reflects the already existing
// matches (which should not be added again). 'matches' are the matches as
// an array of element IDs and 'matchesAsObj' are the same matches but
// as attributes of an object). The matches retrieved fro the indexer
// minus the existing matches ('matches') need to be added explicitly to
// composed function result nodes which normally get their matches directly
// from the indexer when the dominated match count of the data object
// (this node) has dominated match count 0 (these nodes expect an update from
// the indexer, but the data stored in the indexer has not actually changed,
// so the indexer does nto push these updates). This function goes over
// the composed functions and updates those that need to be updated
// (query result nodes and match transparent nodes).
// The InternalQueryResult class overrides this function.

FuncResult.prototype.removeRestrictionsFromNoSelection =
    funcResultRemoveRestrictionsFromNoSelection;

function funcResultRemoveRestrictionsFromNoSelection(matches, matchesAsObj)
{
    if(this.composedQueryResultNum == 0 &&
       this.composedMatchTransparentNum == 0)
        return; // no composed nodes to update

    for(var resultId in this.composedActive) {
        var composedResult = this.composedActive[resultId];
        if(composedResult instanceof InternalQueryResult)
            // dominated match count of 'this' (a projection) was previously
            // 1 and now 0, so the decrease in match count is 1.
            composedResult.removePrefixResultRestrictions(matches,
                                                          matchesAsObj, 1);
        else if(composedResult.isMatchTransparent())
            // match transparent result nodes pass this update to their
            // composed functions.
            composedResult.removeRestrictionsFromNoSelection(matches,
                                                             matchesAsObj);
        // for all other composed functions, handled later    
    }
}

// This function takes a terminal function result (such as DataResult)
// as its argument.  It then sets it as its data object for each data
// object which is not defined (the derived class should create an
// array to hold the data objects and assign it the correct
// length). It also uses it to replace those existing data objects
// which are 'replaceable terminal data objects'. For data objects
// which are not terminal, it calls setTerminalData() on these data
// objects, with the same <terminal function result> object. For data
// objects which are terminal but not replaceable, no action takes
// place. This allows one to set a common data source for a tree of
// composed function results through the root of this tree (while
// protecting terminal nodes which are 'nonreplaceable' and need to be
// replaced explicitly through 'setData()').
// If this object has multiple data objects, 'argNum' can be used to
// resitrct the application of this function to a single data object
// (if this is left undefined, the function will apply to all data objects). 

FuncResult.prototype.setTerminalData = funcResultSetTerminalData;

function funcResultSetTerminalData(dataObj, argNum)
{
    if(this == dataObj)
        return; // avoid loops
    
    if(this.dataObjs && argNum === undefined) {
        for(var i = 0, l = this.dataObjs.length ; i < l ; ++i)
            this.setTerminalData(dataObj, i);
        return;
    }

    var existingDataObj = this.dataObjs ? this.dataObjs[argNum] : this.dataObj;
    if(existingDataObj === undefined) {
        this.setData(dataObj, argNum);
        return;
    }

    if(!existingDataObj.isTerminalResult())
        existingDataObj.setTerminalData(dataObj);
    else if(existingDataObj.isReplaceableTerminalResult())
        this.setData(dataObj, argNum);
}

/////////////////
// Composition //
/////////////////

// Add a new function composed with this function result. 'argNum' is an
// optional argument. It has to be provided only if the composed function
// has multiple data objects. In that case, 'argNum' indicates which
// of these data objects 'this' object is. For composed functions which
// have only one data object, this may be undefined.

FuncResult.prototype.addComposedFunc = funcResultAddComposedFunc;

function funcResultAddComposedFunc(composedFunc, argNum)
{
    if(!composedFunc)
		return;

    var id = composedFunc.getId();

    if(id in this.composedFuncs)
        return; // nothing changed (no two objects with the same ID allowed)

    this.composedFuncs[id] = composedFunc;
    this.numComposedFuncs++;
    // take required actions in the derived class
    if(composedFunc.isActiveStar())
        this.addActiveComposedFunc(composedFunc, false, argNum);
}

// This function is called as the first step in adding 'composedFunc' as
// and active* composed function to 'this' function result (the composed
// function may have already been composed with 'this' but only now become
// active* or it could be already active* but only now composed with
// 'this' function result).
// 'argNum' is an optional argument. It should be used if 'composedFunc'
// is a result node which multiple data objects. In that case, 'argNum'
// indicates which of these data objects 'this' object is (note that this
// function si called before the result node is actually set as a data
// object of the composed function). If 'composedFunc' has only one data
// object, this may be undefined.
// This function updates all counters of active* composed functions
// and their types. It does not yet add the composed function to the
// table of composed functions. In this way, while the new structure is
// already coded in the updated counter, the new active* composed function
// is still not available for match updates until the addition is completed.

FuncResult.prototype.attachActiveComposedFunc =
    funcResultAttachActiveComposedFunc;

function funcResultAttachActiveComposedFunc(composedFunc, argNum)
{
    var composedFuncId = composedFunc.getId();

    if(composedFuncId in this.composedActive)
        return; // already added

    if(this.composedAdditionInProgress === composedFunc)
        return; // already attached (though addition not completed)

    // is this active* before the attachment begins?
    var wasActiveStar = this.isActiveStar();
    
    this.aboutToAttachActiveComposed();
    
    this.composedAdditionInProgress = composedFunc;
    this.composedActiveNum++;
    
    if(composedFunc.supportsMultiProj())
        this.composedSupportMultiProjNum++;
    
    if(composedFunc instanceof InternalQueryResult)
        this.composedQueryResultNum++;
    else if(composedFunc.isMatchTransparent())
        this.composedMatchTransparentNum++;

    if(composedFunc === this.composedRemovalInProgress)
        // this was was already detached and is now added back. So this
        // cancels the removal process.
        this.composedRemovalInProgress = undefined;

    // if this was just (re-)activated, attach to data objects
    if(this.dataObjs !== undefined) {
        for(var i = 0, l = this.dataObjs.length ; i < l ; ++i) {
            var dataObj = this.dataObjs[i];
            if(dataObj &&
               (!wasActiveStar || dataObj.composedRemovalInProgress == this))
                dataObj.attachActiveComposedFunc(this, i);
        }
    } else if(this.dataObj !== undefined &&
              (!wasActiveStar ||
               this.dataObj.composedRemovalInProgress == this))
        this.dataObj.attachActiveComposedFunc(this);

    if(composedFunc.isContentDataObj(argNum)) {
        // this is the content data object of the composed function
        var selectingNum = composedFunc.getComposedSelectingNum();
        // this updates the count, but does not yet perform any actions
        // implied by this change of count (in case an additional change
        // of count takes place within the same update operation).
        this.updateComposedSelectingNum(selectingNum, true);
    }
}

// This is called when the given composed function becomes active star
// (or if the composed function is active* already when first added).
// This function completes he process of adding this composed function
// (the fist step in the process was carried out by
// 'attachActiveComposedFunc()'). The completion of the adition consists
// of storing the active* composed function in the table of active composed
// functions, notifying the data object of this change and notifying the derived
// class of this change.
// 'needsMatchUpdate' indicates whether in case this function result
// was already active* before this registration, the composed function
// needs a match update (if it was not active*, such an update is always
// sent, a this node is also updated). 'needsMatchUpdate' should be set to
// false if this registration is part of an AddComposedFunc() operation
// since it is then part of a setData() operation and the matches will be
// updated as part of that operation. It is also possible to use false here
// for composed function which do not wish to receive updates for whatever
// reason. In all other cases, this should be set to true.
// 'argNum' is an optional argument. It should be used if 'composedFunc'
// is a result node which multiple data objects. In that case, 'argNum'
// indicates which of these data objects 'this' object is (note that this
// function si called before the result node is actually set as a data
// object of the composed function). If 'composedFunc' has only one data
// object, this may be undefined.

FuncResult.prototype.completeActiveComposedFuncAddition =
    funcResultCompleteActiveComposedFuncAddition;

function funcResultCompleteActiveComposedFuncAddition(composedFunc,
                                                      needsMatchUpdate,
                                                      argNum)
{
    var composedFuncId = composedFunc.getId();

    if(composedFuncId in this.composedActive)
        return; // already added (perhaps de- and re-activated in same cycle)

    if(this.composedAdditionInProgress === composedFunc)
        this.composedAdditionInProgress = undefined;

    // was this active* before the the attachment took place?
    var wasActiveStar = this.wasActiveStarBeforeRecomposition(); 
    this.activeStarPending = (!wasActiveStar && !this.isTerminalResult());

    this.aboutToAddActiveComposed(composedFunc, wasActiveStar);
    
    this.composedActive[composedFuncId] = composedFunc;
    
    // if this was just (re-)activated, complete the attachment to data objects
    if(this.dataObjs) {
        for(var i = 0, l = this.dataObjs.length ; i < l ; ++i) {
            var dataObj = this.dataObjs[i];
            if(dataObj !== undefined &&
               (!wasActiveStar || dataObj.composedAdditionInProgress == this))
                dataObj.completeActiveComposedFuncAddition(this,
                                                           !wasActiveStar, i);
        }
    } else if(this.dataObj !== undefined &&
              (!wasActiveStar ||
               this.dataObj.composedAdditionInProgress == this))
        this.dataObj.completeActiveComposedFuncAddition(this, !wasActiveStar);

    if(this.activeStarPending) {
        if(composedFunc.isContentDataObj(argNum))
            // apply consequences of updated composed selecting numbers
            this.completeComposedSelectingNumUpdate();
        
        // complete activation
        
        this.activeStarPending = undefined;

        this.becameActiveStar();
        
        if(this.isOrder()) { // just became order*
            if(this.dataObjs) {
                var dataObj = this.getContentDataObj();
                if(dataObj)
                    dataObj.addOrderStarFunc(this);
            } else if(this.dataObj)
                this.dataObj.addOrderStarFunc(this);
        }

    } else if(needsMatchUpdate) {

        if(composedFunc.isContentDataObj(argNum))
            // apply consequences of updated composed selecting numbers
            this.completeComposedSelectingNumUpdate();
        
        // refresh the indexer and the path of the composed function (as this
        // composed function would not have received updates from this function
        // result when it was not active).
        composedFunc.refreshIndexerAndPaths(this);
        // push matches to the new active composed function. There is no
        // need to do so if this node was not previously composed, as
        // it would then pull these matches by itself. It is also not
        // necessary to do so if the dominated match count is zero and
        // the composed function is a an internal query result.
        if(!(composedFunc instanceof InternalQueryResult) ||
           this.getDomMatchCount() != 0)
            composedFunc.addMatches(this.getDominatedMatches(), this,
                                    this.getDomMatchCount());
    }

    if(composedFunc.isContentDataObj(argNum) && composedFunc.isOrderStar())
        // this is the content data object of the composed function
        this.addOrderStarFunc(composedFunc);
}

// This function combines the two steps of adding an active* composed
// function (attachment and completion) into a single function. Note that
// each of the two functions called may recursively call themselves on their
// data object(s) which may produce first a sequence of attachments and
// then a sequence of completions.

FuncResult.prototype.addActiveComposedFunc = funcResultAddActiveComposedFunc;

function funcResultAddActiveComposedFunc(composedFunc, needsMatchUpdate,
                                         argNum)
{
    this.attachActiveComposedFunc(composedFunc, argNum);
    this.completeActiveComposedFuncAddition(composedFunc, needsMatchUpdate,
                                            argNum);
}

// base version of this function. To be overridden by derived classes
// if need.

FuncResult.prototype.aboutToAttachActiveComposed = 
    funcResultAboutToAttachActiveComposed;

function funcResultAboutToAttachActiveComposed()
{
    // does nothing 
}

// base version of this function. To be overridden by derived classes
// if need.

FuncResult.prototype.aboutToAddActiveComposed = 
    funcResultAboutToAddActiveComposed;

function funcResultAboutToAddActiveComposed()
{
    // does nothing 
}

// base version of this function. To be overridden by derived classes
// if need.

FuncResult.prototype.becameActiveStar = 
    funcResultBecameActiveStar;

function funcResultBecameActiveStar()
{
    // does nothing 
}

// Remove a function composed with this function result. Only the ID
// of this composed function needs to be given (the object itself should
// be stored here). 'argNum' is an optional argument. It has to be
// provided only if the composed function has multiple data
// objects. In that case, 'argNum' indicates which of these data
// objects 'this' object is. For composed functions which have only
// one data object, this may be undefined.
// The argument 'detachOnly' may be set to true if, in case the removed
// composed function is active*, one wishes only the 'detach' part of the
// removal of the active* function to take place (the completion of this
// active* removal would then be the responsibility of the calling function).

FuncResult.prototype.removeComposedFunc = funcResultRemoveComposedFunc;

function funcResultRemoveComposedFunc(composedFuncId, argNum, detachOnly)
{
    if(!(composedFuncId in this.composedFuncs))
        return;

    if(composedFuncId in this.composedActive)
        this.removeActiveComposedFunc(composedFuncId, argNum, detachOnly);

    delete this.composedFuncs[composedFuncId];
    this.numComposedFuncs--;
}

// This function is called to remove the registration of the result function
// with ID 'composedFuncId' as an active* composed function of this function
// result. If this composed function has multiple data objects, 'argNum'
// indicates which one of them this object was before this removal.
// This function removes the registration and updates the various counters
// on this node, but doe not handle consequences of this removal
// (e.g. deactivation of this node).

FuncResult.prototype.detachActiveComposedFunc = 
    funcResultDetachActiveComposedFunc;

function funcResultDetachActiveComposedFunc(composedFuncId, argNum)
{
    if(!(composedFuncId in this.composedActive))
        return undefined;

    var composedFunc = this.composedActive[composedFuncId];

    delete this.composedActive[composedFuncId];
    this.composedActiveNum--;

    if(composedFunc.supportsMultiProj())
        this.composedSupportMultiProjNum--;

    if(composedFunc instanceof InternalQueryResult)
        this.composedQueryResultNum--;    
    else if(composedFunc.isMatchTransparent())
        this.composedMatchTransparentNum--;

    
    if(composedFunc.isContentDataObj(argNum)) {
        this.updateComposedSelectingNum(-1 *
                                        composedFunc.getComposedSelectingNum(),
                                        true);
    }
    
    if(!this.isActiveStar()) {

        if(this.dataObjs) {
            for(var i = 0, l = this.dataObjs.length ; i < l ; ++i)
                if(this.dataObjs[i])
                    this.dataObjs[i].detachActiveComposedFunc(this.getId(), i);
        } else if(this.dataObj)
            this.dataObj.detachActiveComposedFunc(this.getId());
    }

    // indicate that the removal was not yet completed (and store the
    // removed composed function for use by subsequent functions)
    this.composedRemovalInProgress = composedFunc;
    
    return composedFunc;
}

// This function is called after 'composedFunc' was removed as an active*
// composed function of this function result (if 'composedFunc' has multiple
// data objects, 'argNum' indicates which of these 'this' function result
// was before the removal). This function then handles the consequences of
// this removal (e.g. deactivation).

FuncResult.prototype.completeActiveComposedFuncRemoval =
    funcResultCompleteActiveComposedFuncRemoval;

function funcResultCompleteActiveComposedFuncRemoval(composedFunc, argNum)
{
    if(this.composedRemovalInProgress !== composedFunc)
        return;
    
    this.composedRemovalInProgress = undefined;

    // if selection numbers have changed but the consequences of these
    // changes were not yet applied, do so now.
    this.completeComposedSelectingNumUpdate();
    
    // notify the derived class of this change
    this.activeComposedFuncRemoved(composedFunc);

    if(composedFunc.isContentDataObj(argNum))
        this.removeOrderStarFunc(composedFunc.getId());
    
    if(!this.isActiveStar())
        this.deactivated(); // the function result was just deactivated
}

// This is called when the given composed function stops being active star
// (or if when this composed function is removed).
// This removes this function from the table of active composed functions,
// notifies the data object of this change and notifies the derived
// class of this change.
// 'argNum' is an optional argument. It has to be provided only if the
// composed function has multiple data objects. In that case, 'argNum'
// indicates which of these data objects 'this' object is. For
// composed functions which have only one data object, this may be
// undefined.
// The function may potentially perform both the 'detach' part of the removal
// operation and the completion of the removal operation. If a function
// with ID 'composedFuncId' is already stored in 'composedRemovalInProgress'
// then the detach step already took place and only the completion needs
// to be performed. If 'detachOnly' is true, only the detach step will take
// place (if it did not yet take place) and it is the responsibility fo
// the calling function to perform the completion of the removal. 

FuncResult.prototype.removeActiveComposedFunc = 
    funcResultRemoveActiveComposedFunc;

function funcResultRemoveActiveComposedFunc(composedFuncId, argNum, detachOnly)
{
    var composedFunc; 
    if(this.composedRemovalInProgress === undefined ||
       this.composedRemovalInProgress.getId() !== composedFuncId) {
        // not yet detached
        composedFunc = this.detachActiveComposedFunc(composedFuncId, argNum);
    } else
        composedFunc = this.composedRemovalInProgress;

    if(composedFunc === undefined)
        return; // was not registered as an active composed function 

    if(detachOnly)
        return; // removal will be completed later
    
    // removal has been completed
    this.completeActiveComposedFuncRemoval(composedFunc, argNum);
}

// base version of this function. To be overridden by derived classes
// if needed.

FuncResult.prototype.activeComposedFuncRemoved =
    funcResultActiveComposedFuncRemoved;

function funcResultActiveComposedFuncRemoved(composedFunc)
{
}

// This function should be called when this function result becomes
// active (not just active*). This function then checks whether the
// node is already active* as a result of an active* composed result.
// If it isn't and the object has a data object, this function notifies
// the data result object that this composed function became active*. 

FuncResult.prototype.activated = funcResultActivated;

function funcResultActivated()
{
    if(this.composedActiveNum > 0)
        return;

    if(this.dataObjs) {
        for(var i = 0, l = this.dataObjs.length ; i < l ; ++i)
            if(this.dataObjs[i])
                this.dataObjs[i].addActiveComposedFunc(this, true, i);
    } else if(this.dataObj)
        this.dataObj.addActiveComposedFunc(this, true);
}

// This function should be called when this function result becomes
// inactive (but may still be active*). This function then checks whether the
// node is active* as a result of an active* composed result. If it is,
// there is nothing to do. If it isn't, then this node is no longer active*.
// If it has a data object, this function notifies
// the data result object that this composed function is no longer active*. 

FuncResult.prototype.deactivated = funcResultDeactivated;

function funcResultDeactivated()
{
    if(this.composedActiveNum > 0)
        return;

    if(this.dataObjs) {
        for(var i = 0, l = this.dataObjs.length ; i < l ; ++i)
            if(this.dataObjs[i])
                this.dataObjs[i].removeActiveComposedFunc(this.getId(), i);
    } else if(this.dataObj)
        this.dataObj.removeActiveComposedFunc(this.getId());
}

// This function is called by an active* composed function when the number
// of selecting composed* active* nodes which it connects to 'this' node
// changes by 'numDiff' (which may be either positive or negative).
// This function then updates its own 'this.composedSelectingNum' property
// and handles the consequences of this update. The default behavior is
// to propagate this update to the content data object.
// We only count composed selecting functions which are active. Therefore,
// this function is only called if there is some active composed function.
// However, this may also happen during the activation of this function
// result. At that time, if the activation of this function is still pending,
// it should not push the change in the number of selecting composed
// function to its data object, since this number will be pulled by the
// data object during the activation process.
// The 'nonFinalUpdate' argument is simply passed through to lower nodes
// (see documentation at the head of the file).
// Selecting function results should override this implementation.

FuncResult.prototype.updateComposedSelectingNum =
    functionResultUpdateComposedSelectingNum;

function functionResultUpdateComposedSelectingNum(numDiff, nonFinalUpdate)
{
    if (numDiff === 0)
        return;
    
    this.composedSelectingNum += numDiff;

    // default: propagate to content data object

    if(this.activeStarPending)
        return; // do not propagate (see introduction)
    
    var dataObj = this.getContentDataObj();
    if(dataObj !== undefined)
        dataObj.updateComposedSelectingNum(numDiff, nonFinalUpdate);
}

// Default implementation: propagate the call to the content data object.

FuncResult.prototype.completeComposedSelectingNumUpdate =
    functionResultCompleteComposedSelectingNumUpdate;

function functionResultCompleteComposedSelectingNumUpdate()
{
    var dataObj = this.getContentDataObj();
    if(dataObj !== undefined)
        dataObj.completeComposedSelectingNumUpdate();
}

////////////////
// Properties //
////////////////

// This function is active* if either any of its composed functions
// is active* or it is itself active. the function 'isActive()' should
// be defined in the derived class.
// One of the composed functions is considered active* if either
// this.composedActiveNum > 0 or this.composedRemovalInProgress is set,
// which means that we are in the process of removing a composed active
// function (and this node should remain active* until the end of this
// process, even if this.composedActiveNum already dropped to zero).
// However, if 'activeStarPending' is set (indicating that the node is
// in the process of becoming active*) one of its composed functions
// may already be registered as active, but this function continues to
// return false (indicating that the node is not yet active*).

FuncResult.prototype.isActiveStar = funcResultIsActiveStar;

function funcResultIsActiveStar()
{
    return (!this.activeStarPending &&
            (this.composedActiveNum > 0 ||
             this.composedRemovalInProgress !== undefined ||
             this.isActive()));
}

// This function may be called within an operation which changes the
// active* composition of 'this' function result. This operation may
// consist of adding a new active* composed function, removing an
// active* composed function or both adding an active* composed function
// and removing an active* composed function. In case a removal takes
// place, this function must be called before the removal is completed.
// If the same active* composed function is removed and immediately added back,
// this function cannot be used.

FuncResult.prototype.wasActiveStarBeforeRecomposition =
    funcResultWasActiveStarBeforeRecomposition;

function funcResultWasActiveStarBeforeRecomposition()
{
    return (this.composedActiveNum > 1 ||
            this.composedRemovalInProgress !== undefined ||
            this.isActive());
}

// Default implementation of this function. A derived class which does
// support a multi-projection data result object should override this
// function.

FuncResult.prototype.supportsMultiProj = funcResultSupportsMultiProj;

function funcResultSupportsMultiProj()
{
    return false;
}

// This function returns true if this is a match transparent function result
// object, that is, one whose dominated matches are inherently always
// equal to the dominated matches of its content data object. Exmaples
// of match transparent function result objects are the CompResult object
// (which defined an ordering, but does not change the matches) and the
// identity result object (which defines identities but does not change
// the matches).
// The implementation below is the default implementation (for
// non-match-transparent result nodes) and match transparent result objects
// need to override it.

FuncResult.prototype.isMatchTransparent = funcResultIsMatchTransparent;

function funcResultIsMatchTransparent()
{
    return false;
}


// This function returns true if this is a terminal result object, that
// is, a result object which does not take a data result object as its source
// of data but defines this source directly (such as the DataResult object).
// The implementation below is the default implementation (for non-terminal
// result nodes) and terminal result objects need to override it.

FuncResult.prototype.isTerminalResult = funcResultIsTerminalResult;

function funcResultIsTerminalResult()
{
    return false;
}

// This function returns the first function result node in the function result
// node chain which ends at this node. The first function result node in
// the chain is the one which is the source of the data for the rest of
// the chain. This reflects the structure of the chain at the moment
// this function was called, so the first function result node does not
// necessarily need to be a terminal function result node.
// The function simply checks whether this function result node has a data
// object. If it does not, this object itself is returned. If it does,
// the function is called recursively on the data object.
// In case the object has multiple data objects, the test for the existence
// of the data object and the recursive call apply to the first data object
// position (argument 0). A derived class may override this choice by
// implementing its own version of this function.

FuncResult.prototype.getFirstResult = funcResultGetFirstResult;

function funcResultGetFirstResult()
{
    if(this.dataObjs !== undefined) {
        if(this.dataObjs[0] === undefined)
            return this;
        return this.dataObjs[0].getFirstResult();
    } else {
        if(this.dataObj === undefined)
            return this;
        return this.dataObj.getFirstResult();
    }
}

// The default implementation of this function returns an object of the
// form:
// <Map>{
//    0: [<the root path ID>, <dominated projection path ID>] 
// }

FuncResult.prototype.getDominatedProjMappings = 
    funcResultGetDominatedProjMappings;

function funcResultGetDominatedProjMappings()
{
    var projPathId = this.getDominatedProjPathId();

    if(projPathId === undefined) // no yet initialized
        return undefined;
    
    var mapping = new Map();
    mapping.set(0, [this.qcm.getRootPathId(), projPathId]); 
    return mapping;
}

// Return the identification ID which applies to this result. This must 
// be an identification which is defined on the dominated indexer of this
// result object. For most result objects, this is simply the 
// identification defined by their data result object, if exists, and
// otherwise undefined (the base identification). For FuncResult nodes
// with multiple data objects, this is defined, by default, as 
// the identification of the first data object. The function below
// implements this default behavior. Derived classes which wish to modify
// this need to override this function.

FuncResult.prototype.getDominatedIdentification = 
    funcResultGetDominatedIdentification;

function funcResultGetDominatedIdentification()
{
    if(this.dataObjs) {
        return this.dataObjs[0] ? 
        this.dataObjs[0].getDominatedIdentification() : undefined;
    } else { 
        return this.dataObj ? 
            this.dataObj.getDominatedIdentification() : undefined;
    }
}

// Return the CompInfo object which defines the ordering of the matches
// of this result. For most result objects, this is simply the 
// comparison defined by their data result object, if exists, and
// otherwise undefined. For FuncResult nodes with multiple data objects,
// this is defined, by default, as the comparison of the first data
// object. The function below implements this default behavior. Derived
// classes which wish to modify this need to override this function.

FuncResult.prototype.getDominatedComparison = 
    funcResultGetDominatedComparison;

function funcResultGetDominatedComparison()
{
    if(this.dataObjs) {
        return this.dataObjs[0] ? 
        this.dataObjs[0].getDominatedComparison() : undefined;
    } else { 
        return this.dataObj ? 
            this.dataObj.getDominatedComparison() : undefined;
    }
}

// Create the list of added and removed matches, based on the difference
// between to FuncResults. Could be implemented more efficiently in derived
// classes.
// oldFuncResult: the previous dataObj
// added: must be an empty array; matches in the current result but not in
//        oldFuncResult will be added to it
// removed: must be an empty array; matches in oldFuncResult but not in
//          the current result will be added to it

FuncResult.prototype.getDifference = funcResultGetDifference;
function funcResultGetDifference(oldFuncResult, added, removed) {
    var newMatches = this.getDominatedMatchesAsObj();
    var oldMatches = oldFuncResult.getDominatedMatchesAsObj();

    oldMatches.forEach(function(value, elementId) {
        if (!newMatches.has(elementId)) {
            removed.push(elementId);
        }
    });
    newMatches.forEach(function(value, elementId) {
        if (!oldMatches.has(elementId)) {
            added.push(elementId);
        }
    });
}

/////////////////////////
// Match Count Updates //
/////////////////////////

// The default implementation of this function does nothing

FuncResult.prototype.increaseMatchCount = funcResultIncreaseMatchCount;

function funcResultIncreaseMatchCount(decMatchCount, dataResultMatches, source)
{
    return;
}

// The default implementation of this function does nothing

FuncResult.prototype.decreaseMatchCount = funcResultDecreaseMatchCount;

function funcResultDecreaseMatchCount(decMatchCount, dataResultMatches, source)
{
    return;
}

///////////////////////////
// Comparison (Ordering) //
///////////////////////////

// Most function result nodes do not implement ordering functions, so
// the default implementation of the following function is to return 'false'.
// FuncResult nodes which implement an ordering function should re-define
// this function to return 'true'.
// It is assumed that this is a fixed property of a function result node. 

FuncResult.prototype.isOrder = funcResultIsOrder;

function funcResultIsOrder()
{
    return false;
}

// This function returns true if this function result node is order*,
// which means that the comparison function nodes dominated by it need to
// be active. A node is order* if it is an active* ordering function
// or if any of its composed functions are order*.

FuncResult.prototype.isOrderStar = funcResultIsOrderStar;

function funcResultIsOrderStar()
{
    return ((this.isOrder() && this.isActiveStar())  ||
            (this.composedOrderStar !== undefined &&
             this.composedOrderStar.size > 0));
}

// This function returns the data object of this result node which is
// the content data object (this is the object such that the dominated matches
// of this result node are extracted out of the dominated matches of that
// data object). The default implementation is to return the single data
// object if only one data object exists and otherwise to return the first
// data object (argument number 0). This default behavior could be overridden
// by specific result object.

FuncResult.prototype.getContentDataObj = funcResultGetContentDataObj;

function funcResultGetContentDataObj()
{
    if(this.dataObj !== undefined)
        return this.dataObj;

    if(this.dataObjs !== undefined)
        return this.dataObjs[0];
}

// This function is used only for function result nodes with multiple
// data objects (using this.dataObjs). This function should return 'true'
// if the data object with the given argument number is one which determines
// the content on this function result node (see introduction for more details).
// The default is to return true only for argument number 0, but this
// function can be overridden by derived classes.
// To also support the case of a result node with a single data object,
// this function also returns true if 'argNum' is undefined (it is assumed
// that this is the argument number for operations of data object with
// a single data object).

FuncResult.prototype.isContentDataObj = funcResultIsContentDataObj;

function funcResultIsContentDataObj(argNum)
{
    return !argNum;
}

// This function is called to add 'composedFunc' as a composed function
// of this result function node which is order*. When this function is
// called, 'composedFunc' is already registered as a active* composed
// function of this node.
// This function adds 'composedFunc' to the 'composedOrderStar' and
// if this has just turned this node into an order* node, notifies its
// data object(s) to add this node as an order* composed node. 

FuncResult.prototype.addOrderStarFunc = funcResultAddOrderStarFunc;

function funcResultAddOrderStarFunc(composedFunc)
{
    var wasOrderStar = this.isOrderStar();
    
    if(this.composedOrderStar === undefined)
        this.composedOrderStar = new Map();
    
    this.composedOrderStar.set(composedFunc.getId(), composedFunc);

    if(!wasOrderStar) { // this node just became order*.
        
        // notify the result nodes it is composed with.
        
        if(this.dataObjs) {
            var dataObj = this.getContentDataObj();
            if(dataObj)
                dataObj.addOrderStarFunc(this);
        } else if(this.dataObj) {
            this.dataObj.addOrderStarFunc(this);
        } else if(this.orderService !== undefined) {
            this.orderService.addOrderStarFunc(this);
        }

        // If this is a comparison function, also activates it.

        if(this instanceof CompResult)
            this.comparisonActivated();
    }
}

// This function is called to remove 'composedFunc' as a composed function
// of this result function node which is order*. This function may be called
// either because 'composedFunc' was just removed as an active* composed
// function or because it stopped being an order* function (though it
// continues to be an active* composed function). When this function is
// also remvoed as composed active*, it is first removed as composed active*
// (including notifying the doinated function result nodes) and only then is
// this function called.
// Except for removing 'composedFunc' from the list of order* composed
// functions, this function also checks whether this node is still
// an order* node after this operation. If it isn't, it remove itself as
// order* from its data object(s).

FuncResult.prototype.removeOrderStarFunc = funcResultRemoveOrderStarFunc;

function funcResultRemoveOrderStarFunc(composedFuncId)
{
    if(this.composedOrderStar === undefined ||
       !this.composedOrderStar.has(composedFuncId))
        return; // not an order* function
    
    this.composedOrderStar.delete(composedFuncId);

    if(!this.isOrderStar()) {

        // If this is a comparison function, also de-activates it.
        if(this instanceof CompResult)
            this.comparisonDeactivated();
        
        if(this.dataObjs) {
            var dataObj = this.getContentDataObj();
            if(dataObj)
                dataObj.removeOrderStarFunc(this.id);
        } else if(this.dataObj)
            this.dataObj.removeOrderStarFunc(this.id);
        else if(this.orderService !== undefined)
            this.orderService.removeOrderStarFunc(this.id);
    }
}

// This function is called when this node is an order* node (a node such as
// it or one of its composed* node is an ordering function) and when the
// comparison defining the ordering at this function result node has changed.
// The default implementation of this function (below), which applies to
// nodes which ignore ordering, simply forwards this notification to
// all order* composed function results.

FuncResult.prototype.refreshOrdering = funcResultRefreshOrdering;

function funcResultRefreshOrdering()
{
    if(this.composedOrderStar === undefined)
        return;

    this.composedOrderStar.forEach(function(funcResult, id) {

        funcResult.refreshOrdering();
        
    });
}

////////////////////
// Result Indexer //
////////////////////

// This function is called by the query calculation node registered to
// the root of the result indexer (if the result indexer and such a
// query calculation node exist) when elements are added to the root
// of the result indexer. These are new matches of the function
// result.  These added matches need to be forwarded to active
// composed function result nodes which are not queries (composed
// queries register directly to the result indexer).

FuncResult.prototype.forwardResultIndexerAddMatches =
    funcResultForwardResultIndexerAddMatches;

function funcResultForwardResultIndexerAddMatches(elementIds)
{
    // matches received from the root of the result indexer, forward
    // to non-query-result active composed results.
    for(var resultId in this.composedActive) {
        var composed = this.composedActive[resultId];
        if(composed instanceof InternalQueryResult)
            continue;
        composed.addMatches(elementIds, this);
    }
}

// This function is called by the query calculation node registered
// to the root of the result indexer (if the result indexer and such
// a query calculation node exist) when elements are removed from the root
// of the result indexer. These are matches removed from the matches
// of the function result. These removed matches need to be forwarded to
// active composed function result nodes which are not queries
// (composed queries register directly to the result indexer).

FuncResult.prototype.forwardResultIndexerRemoveMatches =
    funcResultForwardResultIndexerRemoveMatches;

function funcResultForwardResultIndexerRemoveMatches(elementIds)
{
    // matches removed from the root of the result indexer, forward
    // to non-query-result active composed results.
    for(var resultId in this.composedActive) {
        var composed = this.composedActive[resultId];
        if(composed instanceof InternalQueryResult)
            continue;
        composed.removeMatches(elementIds, this);
    }
}

////////////////
// Debuggging //
////////////////

// return a string with the description of this funciton result
// (by default, just the type and ID)

FuncResult.prototype.debugPrintDesc = funcResultDebugPrintDesc;

function funcResultDebugPrintDesc()
{
    return "" + this.getId() + "<" + this.constructor.name + ">";
}

// initialize debug tracing for FuncResult objects

function debugInitFuncResultTracing()
{
    debugTracingFuncResult = true;

    if(globalDebugTracingLog === undefined)
        initializeDebugTracingLog();

    // set 'doDebugging' on all existing objects
    for(var id in debugAllQueryResults) {
        var queryResult = debugAllQueryResults[id];
        queryResult.doDebugging = true;
        if(queryResult.query instanceof Query)
            queryResult.query.doDebugging = true;
    }
}
