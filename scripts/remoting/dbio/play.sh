#!/bin/bash

set -u -e

PSERVER_ADDR="127.0.0.1:8080"
PSERVER_AUTH=""
PSERVER_USER=""
PSERVER_PASSWORD=""
CONF_OWNER=""

function Usage {
    echo "Usage: $0 [ options ] <conf-name> <scenario-file>"
    echo " "
    echo " "
    echo "Options:"
    echo "  -o <owner>,            defaults to <user> or 'anonymous'"
    echo "  -s <server>[:<port>],  defaults to '127.0.0.1:8080'"
    echo "  -u <user>"
    echo "  -p <password>"
    echo " "
    echo " "
    echo "For Example:"
    echo "% $0 myLeanTabletApp segmentByOS.scenario"
    exit 1
}

trim() {
    local var="$*"
    var="${var#"${var%%[![:space:]]*}"}"   # remove leading whitespace
    var="${var%"${var##*[![:space:]]}"}"   # remove trailing whitespace
    echo -n "$var"
}

function importElement
{
    local elem="${1}"

    local mdb="${elem#*:}"
    local name="${elem%:*}"

    echo "***************************************"
    echo "${name}"
    echo "***************************************"

    ./dbio.sh import -s "${PSERVER_ADDR}" -F \
              -o "${CONF_OWNER}" \
              ${PSERVER_AUTH} \
              -f "${TEMP_DIR}/${mdb}" \
              "${CONF_NAME}" > /dev/null
}

function findElement
{
    local searchFor="${1}"
    local i
    local elem
    local elemName

    for (( i=0; i < NELEMENT; i++))
    do
        elem="${SCENARIO[${i}]}"
        elemName="${elem%:*}"
        if [[ $elemName == *"${searchFor}"* ]]; then
            echo "${i}"
            return
        fi
    done
    return
}

function displayTOC
{
    echo " "
    echo "Table Of Contents - ${CONF_NAME}"
    echo "Scenario: ${TGZ_FILE}"
    echo "====================================================================="

    for (( i=0; i < NELEMENT; i++))
    do
        elem="${SCENARIO[${i}]}"
        elemName="${elem%:*}"
        echo "-  ${elemName}"
    done
    return    
}

while getopts ":s:u:p:o:" flag
do
    case "${flag}" in
        s)
            PSERVER_ADDR="${OPTARG}"
            ;;

        u)
            PSERVER_USER="${OPTARG}"
            ;;

        p)
            PSERVER_PASSWORD="${OPTARG}"
            ;;

        o)
            CONF_OWNER="${OPTARG}"
            ;;

        *)
            Usage
            ;;

    esac
done

shift $((OPTIND-1))

if [ $# -ne 2 ]; then
    Usage
fi

if [ "${CONF_OWNER}" == "" ]; then
    CONF_OWNER="${PSERVER_USER}"
    if [ "${CONF_OWNER}" == "" ]; then
        CONF_OWNER="anonymous"
    fi
fi

if [ "${PSERVER_USER}" == "" ]; then
    if [ "${PSERVER_PASSWORD}" != "" ]; then
        echo "$0: cannot specify password without user-name"
        exit 1
    fi
else
    if [ "${PSERVER_PASSWORD}" == "" ]; then
        echo "$0: cannot specify user-name without password"
        exit 1
    else
        PSERVER_AUTH="-u ${PSERVER_USER} -p ${PSERVER_PASSWORD}"
    fi
fi
    

    
CONF_NAME="${1}"
TGZ_FILE="${2}"

TEMP_DIR="/tmp/play_scenario.$(date +%Y_%m_%d_%H_%M_%S)"
mkdir "${TEMP_DIR}"

(cd "${TEMP_DIR}" ; tar xfz - ) < "${TGZ_FILE}"

SCENARIO_FILE="${TEMP_DIR}/scenario.conf"

SCENARIO_DESC_FILE="${TEMP_DIR}/__scenario_desc__.txt"

if [ -f "${SCENARIO_DESC_FILE}" ]; then
    echo "Scenario file '${TGZ_FILE}' has this description:"
    echo " "
    echo "----------------------------------------------------"
    cat "${SCENARIO_DESC_FILE}"
    echo "----------------------------------------------------"
    echo " "
fi

if [ ! -f "${SCENARIO_FILE}" ]; then
    echo "Error: cannot read scenario file '${SCENARIO_FILE}'"
    exit 1
fi

SAVED_IFS="${IFS}"

IFS=$'\r\n' GLOBIGNORE='*'

NELEMENT=0
SCENARIO=()
while read line
do
    ncline="${line%#*}"
    tline="$(trim ${ncline})"
    if [[ ! -z "${tline}" ]]; then
        SCENARIO+=("${tline}")
        NELEMENT=$((NELEMENT + 1))
    fi
done < "${SCENARIO_FILE}"

IFS="${SAVED_IFS}"
unset GLOBIGNORE

echo "Enter 'n' or  <Enter> for 'next'"
echo "      'p' for  'previous'"
echo "      'x' or 'q' to exit"
echo "      'toc' for 'table-of-contents'"
echo "Any other input is interpreted as a search on scenario elements"

ELID=-1

while true
do

    nextId=$((ELID + 1))
    if ((nextId >= NELEMENT)); then
        def="(--last--)"
    else
        nextElem="${SCENARIO[${nextId}]}"
        nextName="${nextElem%:*}"
        def="(next: ${nextName})"
    fi

    echo -n ">> ${def} "
    read cmd

    if [ "x${cmd}" == "x" ]; then
        cmd="n"
    fi

    case "${cmd}" in
        n)
            ELID=$((ELID + 1))
            if ((ELID >= NELEMENT)); then
                echo "No more elements in this scenario.."
                ELID=$((NELEMENT - 1))
            else
                importElement "${SCENARIO[${ELID}]}"
            fi
            ;;

        p)
            ELID=$((ELID - 1))
            if ((ELID < 0)); then
                echo "This is the first element.."
                ELID="0"
            else
                importElement "${SCENARIO[${ELID}]}"
            fi
            ;;

        x|q)
            echo "Bye"
            exit 0
            ;;

        toc)
            displayTOC
            ;;

        *)
            SELID="$(findElement ${cmd})"
            if [[ -z "${SELID}" ]]; then
                echo "Could not find '${cmd}' in this scenario"
            else
                ELID="${SELID}"
                importElement "${SCENARIO[${ELID}]}"
            fi
            ;;
    esac
        
done


