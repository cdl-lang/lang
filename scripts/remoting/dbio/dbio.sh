#!/bin/bash

# a utility to facilitate import/export of app-state from mongodb to a file
#

set -u -e

PDIR=$(dirname $0)

NODE=node
DBIO_NJS="${PDIR}/dbio.node.js"

#if [ "$(uname -o 2> /dev/null)" == "Cygwin" ]; then
#else
#fi

OWNER=anonymous
PSERVERPORT=127.0.0.1:8080
MDBFILE=
USERNAME=
PASSWORD=
FORCEOVERRIDE=
PROTOCOL=

function usage {
    echo "Usage: $0 import/export/clear/print [ options ] <application-name>"
    echo " "
    echo " "
    echo "Options:"
    echo "  -o <owner>,    defaults to 'anonymous'"
    echo "  -f <file>,    defaults to '<application-name>.mdb"
    echo "  -s <server>[:<port>],   defaults to '127.0.0.1:8080'"
    echo "  -P <protocol>, defaults to wss"
    echo " "
    echo " -F, Force import over an existing configuration"
    echo " "
    echo "  -u <user>"
    echo "  -p <password>"
    echo " "
    echo " "
    echo " "
    echo " For example:"
    echo "  $0 print -s ben-pc myLeanFSApp"
    echo "  $0 clear -s ben-pc myLeanFSApp"
    echo "  $0 export -s ben-pc:8888 myLeanFSApp"
    echo "  $0 export -u ben -f fat2.mdb myFatFSApp"
    echo "  $0 import myLeanFSApp"
    echo "  $0 import -s ben-pc:8888 -u ben -f fat2.mdb myFatFSApp"
    exit 1
}

if [ $# -eq 0 ]; then
	usage
fi

if [ ${1} == "import" ]; then
    CMD=import
elif [ ${1} == "export" ]; then
    CMD=export
elif [ ${1} == "print" ]; then
    CMD=print
elif [ ${1} == "clear" ]; then
    CMD=clear
else
    usage
fi
shift 1

while getopts ":o:f:s:u:p:P:F" flag
do
    case "${flag}" in
        o)
            OWNER=${OPTARG}
            ;;

        f)
            MDBFILE=${OPTARG}
            ;;

        s)
            PSERVERPORT=${OPTARG}
            ;;

        u)
            USERNAME=${OPTARG}
            ;;

        p)
            PASSWORD=${OPTARG}
            ;;

        P)
            PROTOCOL=${OPTARG}
            ;;

        F)
            FORCEOVERRIDE="override=true"
            ;;

        *)
            Usage
            ;;

    esac
done

shift $((OPTIND-1))

if [ $# -ne 1 ]; then
    usage
fi

##########################################################################
#
#  cygwin -> window path handling
#
# node.js requires windows names, so cygwin paths must be converted before
#  being handed over to node
#
if [ "$(uname -o 2> /dev/null)" == "Cygwin" ]; then
    DO_CYGPATH=true
else
    DO_CYGPATH=false
fi

fixPath() {
    if [ "${DO_CYGPATH}" == "true" ]; then
        echo "$(cygpath -w ${1})"
    else
        echo "${1}"
    fi
}
##########################################################################


APPNAME=${1}

PSERVER="${PSERVERPORT/:*/}"
PPORT="${PSERVERPORT/*:/}"
if [ "${PPORT}" == "${PSERVER}" ]; then
	PPORT=8080
fi

PSERVER="${PSERVER:-127.0.0.1}"
PPORT="${PPORT:-8080}"
MDBFILE="${MDBFILE:-${APPNAME}.mdb}"
OWNER="${OWNER:-anonymous}"
CERTDIR="${PDIR}/../certutil/rootCA.pem"

NCMD="${NODE} ${DBIO_NJS}"
NCMD="${NCMD} server=${PSERVER} port=${PPORT}"
NCMD="${NCMD} owner=${OWNER} appName=${APPNAME}"
NCMD="${NCMD} cacert=${CERTDIR}"

if [ -n "${USERNAME}" ]; then
    NCMD="${NCMD} user=${USERNAME}"
fi

if [ -n "${PASSWORD}" ]; then
    NCMD="${NCMD} password=${PASSWORD}"
fi

if [ -n "${PROTOCOL}" ]; then
    NCMD="${NCMD} protocol=${PROTOCOL}"
fi

FILEOPT="path=$(fixPath ${MDBFILE})"

if [ "${CMD}" == "print" ]; then
    NCMD="${NCMD} print"

elif [ "${CMD}" == "clear" ]; then
    NCMD="${NCMD} clear"

elif [ "${CMD}" == "import" ]; then
    NCMD="${NCMD} import ${FILEOPT} ${FORCEOVERRIDE}"
    
elif [ "${CMD}" == "export" ]; then
    NCMD="${NCMD} export ${FILEOPT}"

else
    Usage
fi

${NCMD}

exit 0
