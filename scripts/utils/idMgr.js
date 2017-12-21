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

// this file implements id allocation
// ids are allocated as increasing integers, unless an id was freed.

function IdMgr()
{
    this.nextMax = 0;
    this.freeIds = [];
    this.idCount = 0;
}

IdMgr.prototype.allocate = idMgrAllocate;
function idMgrAllocate()
{
    this.idCount++;
    if (this.freeIds.length)
	return this.freeIds.pop();
    return this.nextMax++;
}

IdMgr.prototype.free = idMgrFree;
function idMgrFree(id)
{
    this.idCount--;
    this.freeIds.push(id);
}

IdMgr.prototype.count = idMgrCount;
function idMgrCount()
{
    return this.idCount;
}
