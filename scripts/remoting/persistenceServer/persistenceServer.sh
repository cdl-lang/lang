#!/bin/bash

# When called with the parameter "start", this script starts the persistence
# server in a forked sub-shell; the PID that is stored in persistenceServer.pid
# is actually the PID of that sub-shell.
# When called with the parameter "stop", this scripts kills the children of 
# the sub-shell (so the persistence server).
# The sub-shell executes two commands in succession: first the persistence
# server, then a check on the existence of the file persistenceServer.stop.
# If that file doesn't exist, an error message is sent by email. If the file
# does exist, it is removed. The file gets created by the "stop" command, so
# the email is not sent when the server is terminated in an expected manner.
#   The email message text is generated before starting the server, and contains
# machine, port and directory. The message is sent to the addresses in
# /var/www/data/beta/alert-email-addresses.txt. It's different on testing and
# www, due to inavailability of SES in Frankfurt, where www is located.

# Do not break on error: it will exit the shell immediately on a crash and
# not execute the sendmail command.
set -u

CURDIR="$( cd $( dirname ${BASH_SOURCE[0]} ) && pwd )"

NODE="node"

#export HOME="!WWWDATA_BASE!/pserver"

SERVER_NAME="persistenceServer.js"
SERVER_JS="${CURDIR}/${SERVER_NAME}"
DATE=`date +%Y-%m-%d-%H.%M.%S`

LOG_FILE="${CURDIR}/${SERVER_NAME%.js}.${DATE}.log"
PID_FILE="${CURDIR}/${SERVER_NAME%.js}.pid"
CRASHMAIL="${CURDIR}/crashmail.txt"
STOPSIGNAL="${CURDIR}/persistenceServer.stop"

function Usage
{
    echo "Usage: $0 start/stop"
    exit 1
}

ME="$(whoami)"

RUN_AS_USER="!PROCESS_USER!"

PPORT="!PERSISTENCE_SERVER_PORT!"
# Remove optional leading @
PPORT=${PPORT#@}

MONGO_DB="!MONGO_DB!"

ADDED_LOCAL_PORT="!ADDED_LOCAL_PORT!"

DEBUGREMOTE="4"

# Set addLocalPort to specified value (only for the profileMgmtAgent's
# persistence server), or make it 80000 - PORT for locally exporting data via
# dbio.
if [[ "${ADDED_LOCAL_PORT}" =~ ^[1-9][0-9]*$ ]]; then
    add_local_arg="addLocalPort=${ADDED_LOCAL_PORT}"
else
    add_local_arg="addLocalPort=$((80000 - ${PPORT}))"
fi

BASE_AUTH_DIR="!WWWDATA_BASE!"

if [ "${ME}" != "${RUN_AS_USER}" ]; then
    if [ "${1:-}" == "nosudo" ]; then
        echo "$0: must be run as '${RUN_AS_USER}'"
        exit 1
    fi
    exec sudo -u "${RUN_AS_USER}" "${0}" nosudo ${@}
fi

if [ "$1" == "nosudo" ]; then
    shift
fi

if [ "$#" != "1" ]; then
    Usage
fi

if [ "$1" == "start" ]; then
    # Clean up logs older than 2 weeks first
    find "${CURDIR}" -maxdepth 1 -name "${SERVER_NAME%.js}*.log" -mtime +14 -exec rm \{\} \;
    # Create new log file
    touch "${LOG_FILE}"
    echo "----------------------------------------------------" >> "${LOG_FILE}"
    echo "$0: Starting" >> "${LOG_FILE}"
    date >> "${LOG_FILE}"
    echo "----------------------------------------------------" >> "${LOG_FILE}"
    # Generate (short) email sent when nodejs halts without stop signal file present
    echo "Subject: persistence server ${PPORT} crashed" > "${CRASHMAIL}"
    echo "X-Priority: 1"                               >> "${CRASHMAIL}"
    echo                                               >> "${CRASHMAIL}"
    echo "Persistence server crashed"                  >> "${CRASHMAIL}"
    echo -n "host: "                                   >> "${CRASHMAIL}"
    echo `hostname`                                    >> "${CRASHMAIL}"
    echo "directory: ${CURDIR}"                        >> "${CRASHMAIL}"
    echo "port: ${PPORT}"                              >> "${CRASHMAIL}"
    # Remove stop signal file
    if [ -f "${STOPSIGNAL}" ]
    then
        rm "${STOPSIGNAL}"
    fi
    # Start process in a subshell and send an email if it exits without the
    # stopsignal file being present.
    ( \
        ${NODE} "${SERVER_JS}" "port=${PPORT}" "${add_local_arg}" \
                "baseAuthDir=${BASE_AUTH_DIR}" \
                "mongodb=${MONGO_DB}" \
                "debugRemote=${DEBUGREMOTE}" \
                >> "${LOG_FILE}" 2>&1 ; \
        if [ -f "${STOPSIGNAL}" ]; \
        then \
            rm "${STOPSIGNAL}"; \
        else \
            cat "${CRASHMAIL}" | sendmail `< /var/www/data/beta/alert-email-addresses.txt`
        fi \
    ) &
    SJS_PID=$!
    echo "${SJS_PID}" > "${PID_FILE}"

elif [ "$1" == "stop" ]; then
    touch "${STOPSIGNAL}"
    process_id="$(< ${PID_FILE})"
    if ! pkill -HUP -P "${process_id}"
    then
        echo "Could not kill persistence server ${process_id}"
    fi

else
    Usage
fi

exit 0
