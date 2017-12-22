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
set -o pipefail

FLAGS=" "

while getopts "p:" OPT ; do
    case "$OPT" in
        p)  FLAGS="pickQualifiedExpressionStrategy=$OPTARG $FLAGS"
            ;;
        *)  echo unknown option "$OPT"
            exit 1
            ;;
    esac
done
shift $((OPTIND-1))

CURDIR=`dirname $0`
COMPFILE=$1
OUTFILE=$2
FEGDEBUGINFO=$3
FEGERRORSTATUS=$4

TEMPOUT=${OUTFILE}.temp

((node --max-old-space-size=4096 "${COMPFILE}" mode=js debugInfo=${FEGDEBUGINFO} "errors=$FEGERRORSTATUS" $FLAGS >| "${TEMPOUT}" ) 2>&1 ) |\
gawk -f "${CURDIR}/toSrc.awk" -v "jsfile=${COMPFILE}"
if ! egrep '^// error: ' "${TEMPOUT}"; then
    mv "${TEMPOUT}" "${OUTFILE}"
    exit 0
fi

exit 1
