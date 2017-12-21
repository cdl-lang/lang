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

// Perform a topological sort on a given graph.
// Input is a graph, in the following format:
// G is an object with a set of keys K, such that for each k \in K,
// G[k] is a container whose values are elements of K. If m is in
// G[k], then there is an edge from k to m.
// Output is an array which contains K ordered topologically.
// Sample:
// G = { 7: ['11', '8'], 5: ['11'], 3: ['8','10'],
//      11: ['2','9', '10'], 8: ['9'],
//       2: [], 9: [], 10: [] };
// This is the example given on Wikipedia. The solution will be:
// ["3", "5", "7", "8", "11", "10", "9", "2"]
function topologicalSort(graph)
{
    function topologicalSortVisit(node)
    {
        if (!visitedSet[node])
        {
            visitedSet[node] = true;
            for (var i in graph[node])
                topologicalSortVisit(graph[node][i]);
            result.push(node);
        }
    }

    var visitedSet = {};
    var result = [];
    for (var n in graph)
        topologicalSortVisit(n);
    result.reverse();
    return result;
}
