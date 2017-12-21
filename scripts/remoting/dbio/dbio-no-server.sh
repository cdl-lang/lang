#!/bin/bash

# a utility to facilitate import/export of app-state from mongodb to a file

set -u -e

# Defaults

USERNAME=anonymous
TGZFILE=mdb.tgz
DATABASENAME=cdlpersistence
DATABASENAMESET=0

MONGOEXPORT=mongoexport
MONGOIMPORT=mongoimport
MONGOSH=mongo

function usage {
    echo "Usage: $0 import/export/clear/nuke [ -u <username> ] [ -f <tgzfile> ] [-d profile/database] <application-name>"
    echo " "
    echo " "
    echo "  <username> defaults to '${USERNAME}'"
    echo "  <profile/database> defaults to '${DATABASENAME}'"
    echo "  <tgzfile> defaults to '${TGZFILE}'"
    echo " "
    echo " "
    echo " For example:"
    echo "  $0 import myLeanFSApp"
    echo "  $0 import -u ben -f fat.tgz myFatFSApp"
    echo "  $0 export myLeanFSApp"
    echo "  $0 export -u ben -f fat.tgz myFatFSApp"
    echo "  $0 clear -u uri -d cdlp_Tenzing_12549 myLeanZCApp"
    echo "  $0 nuke cdlp_Tenzing_12549"
    exit 1
}

function control_c {
    echo ""
    echo "interrupted"
    rm -rf "${TEMPDIR}"
    exit 1
}

function mdbexport {
    local COLTN="${1}"
    local FILE="${2}"

    "${MONGOEXPORT}" -d "${DATABASENAME}" -c "${COLTN}" > "${FILE}"
}

function mdbimport {
    local COLTN="${1}"
    local FILE="${2}"

    # delete the collection before importing into it
    "${MONGOSH}" ${DATABASENAME} --eval "db['${COLTN}'].drop();"

    "${MONGOIMPORT}" -d "${DATABASENAME}" -c "${COLTN}" < "${FILE}"
}

function mdbclear() {
    "${MONGOSH}" "${DATABASENAME}" --eval "db.$1.drop(); db.$2.drop(); db.$3.drop();"
}

function mdbnuke() {
    if [ $DATABASENAMESET == 1 ]; then
        echo "database name cannot be set with -d"
        exit 1
    fi
    "${MONGOSH}" "$1" --eval "db.dropDatabase();"
}

if [ $# -eq 0 ]; then
	usage
fi

if [ "${1}" == "import" ]; then
    IMEX=import
elif [ "${1}" == "export" ]; then
    IMEX=export
elif [ "${1}" == "clear" ]; then
    IMEX=clear
elif [ "${1}" == "nuke" ]; then
    IMEX=nuke
else
    usage
fi
shift 1

while getopts ":u:f:d:" flag
do
    case "${flag}" in
        u)
            USERNAME="${OPTARG}"
            ;;
        d)
            DATABASENAME="${OPTARG}"
            DATABASENAMESET=1
            ;;
        f)
            TGZFILE="${OPTARG}"
            ;;
        *)
            usage
            ;;
    esac
done

shift $((OPTIND-1))

if [ $# -ne 1 ]; then
    usage
fi

APPNAME="${1}"

echo "========================================================================="
echo "========================================================================="
echo "$0 ${IMEX}:"
echo "   database=${DATABASENAME}"
echo "   user=${USERNAME}"
echo "   appName=${APPNAME}"
echo "   file=${TGZFILE}"
echo "========================================================================="
echo "========================================================================="

if [ "${IMEX}" == "export" -o "${IMEX}" == "import" ]; then
    TEMPDIR=$(mktemp -d 2>/dev/null || mktemp -d -t 'dbexporttmp')
    mkdir "${TEMPDIR}/extract"
    INDEX_FILE="${TEMPDIR}"/extract/index.json
    TEMPLATE_FILE="${TEMPDIR}"/extract/template.json
    DATA_FILE="${TEMPDIR}"/extract/data.json
fi

# trap keyboard interrupt (control-c)
trap control_c SIGINT

INDEX_COLTN="rrm.appState.index.${USERNAME}.${APPNAME}"
TEMPLATE_COLTN="rrm.appState.template.${USERNAME}.${APPNAME}"
DATA_COLTN="rrm.appState.${USERNAME}.${APPNAME}"

if [ "${IMEX}" == "export" ]; then
    mdbexport "${INDEX_COLTN}" "${INDEX_FILE}"
    mdbexport "${TEMPLATE_COLTN}" "${TEMPLATE_FILE}"
    mdbexport "${DATA_COLTN}" "${DATA_FILE}"

    tar cfz "${TGZFILE}" -C "${TEMPDIR}/extract" .
elif [ "${IMEX}" == "import" ]; then
    tar xfz "${TGZFILE}" -C "${TEMPDIR}/extract"

    mdbimport "${INDEX_COLTN}" "${INDEX_FILE}"
    mdbimport "${TEMPLATE_COLTN}" "${TEMPLATE_FILE}"
    mdbimport "${DATA_COLTN}" "${DATA_FILE}"
elif [ "${IMEX}" == "nuke" ]; then
     mdbnuke "$1"
else
    mdbclear "${DATA_COLTN}" "${TEMPLATE_COLTN}" "${INDEX_COLTN}"
fi

if [ "${IMEX}" == "export" -o "${IMEX}" == "import" ]; then
    rm -rf "${TEMPDIR}/extract"
fi
