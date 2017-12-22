#!/bin/bash

# Copyright 2017 Yoav Seginer, Theo Vosse, Gil Harari, and Uri Kolodny.

# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at

#     http://www.apache.org/licenses/LICENSE-2.0

# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -u -e

ROOTDIR=$1

function getRev {
    local REV

    pushd "$1" > /dev/null
    REV=$(git rev-parse HEAD)
    if [ "x${REV}" == "x" ]; then
        REV=unknown
    fi
    popd > /dev/null
    echo ${REV}
}

SCRIPTVER=$(getRev "${ROOTDIR}/lang")
CDLVER=$(getRev "${ROOTDIR}/cdl-classes-and-applications")

DATE="$(date)"
HOST="$(hostname)"

echo "var buildInfo = {"
echo "  date: \"${DATE}\","
echo "  scriptRevision: \"${SCRIPTVER}\","
echo "  cdlRevision: \"${CDLVER}\","
echo "  host: \"${HOST}\""
echo "};"

exit 0
