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
OUTFILE=$2

function getSvnRev
{
    dir=${1}

    local SVNINFO=$(svn info ${dir} | grep Revision 2>/dev/null)
    local REV=${SVNINFO/Revision: /}

    if [ "x${REV}" == "x" ]; then
        REV=unknown
    fi

    echo ${REV}
}

ROOTVER="$(getSvnRev ${ROOTDIR})"
SCRIPTVER="$(getSvnRev ${ROOTDIR}/scripts)"
CDLVER="$(getSvnRev ${ROOTDIR}/cdl)"

if [[ "$PWD" == */bug[0-9]*  ]]
then
    echo -n "Specify cdl revision [${CDLVER}]: "
    read CDLVER2
    if [ "x${CDLVER2}" != "x" ]
    then
        CDLVER=$CDLVER2
    fi
fi

DATE="$(date)"
HOST="$(hostname)"

echo "\"use strict\";" > ${OUTFILE}
echo "var buildInfo = {" >> ${OUTFILE}
echo "  date: \"${DATE}\"," >> ${OUTFILE}
echo "  rootRevision: \"${ROOTVER}\"," >> ${OUTFILE}
echo "  scriptRevision: \"${SCRIPTVER}\"," >> ${OUTFILE}
echo "  cdlRevision: \"${CDLVER}\"," >> ${OUTFILE}
echo "  host: \"${HOST}\"" >> ${OUTFILE}
echo "};" >> ${OUTFILE}

exit 0
