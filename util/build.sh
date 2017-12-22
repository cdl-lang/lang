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

# File must be called via source from app directory

if [ -z "$ROOTDIR" -o -z "$CDLDIR" ]; then
    echo not all variables set
    exit 1
fi

LANGDIR="$ROOTDIR/lang"
SCRIPTSDIR="$LANGDIR/scripts"
FEGDIR="$SCRIPTSDIR/feg"
TEMPLATEDIR="$FEGDIR/templates"
UTIL="$LANGDIR/util"
OPTIMIZE=true
VERBOSE=0
FORCE=0
CHECK_WARNINGS=0

# Check if the scripts have to be recompiled
make -C "$FEGDIR" tsc
if [ $? -ne 0 ]; then
    exit
fi

trap 'exit 1' INT

function make_comp_file()
{
    if [ -f lib.conf ]; then
        "$UTIL/genIncJS.py" \
            "--langdir=$LANGDIR" \
            "--cdldir=$CDLDIR" \
            "--libConf=lib.conf" \
            "--resourceOutFile=intermediate/$APP.res" \
            "--out_file=$COMPJS.tmp" \
            "--template=$TEMPLATEDIR/compile.template.js" \
            "--mode=js" \
            "$APP.js"
    else
        "$UTIL/genIncJS.py" \
            "--langdir=$LANGDIR" \
            "--cdldir=$CDLDIR" \
            "--resourceOutFile=intermediate/$APP.res" \
            "--out_file=$COMPJS.tmp" \
            "--template=$TEMPLATEDIR/compile.template.js" \
            "--mode=js" \
            "$APP.js"
    fi
    if [ $? -ne 0 ]; then
        exit 1
    fi
    bash "$UTIL/buildInfo.sh" "$ROOTDIR" > "$COMPJS"
    cat "$COMPJS.tmp" >> "$COMPJS"
    /bin/rm "$COMPJS.tmp"
}

# Rebuild comp file when one of the cdl files is newer
function check_compjs()
{
    local REBUILD=0
    local DEPS="$FEGDIR/compile.version $CDL_FILES"

    # Is any cdl file or the compiler version newer than the comp.js target?
    if [ "$FORCE" == 1 ]; then
        REBUILD=1
    else
        for f in $DEPS; do
            if [ "$f" -nt "$COMPJS" ]; then
                if [ "$VERBOSE" == 1 ]; then
                    echo $f newer than $COMPJS
                fi
                REBUILD=1
                break
            fi
        done
    fi
    if [ "$REBUILD" -eq 1 ]; then
        echo build "$COMPJS"
        make_comp_file
    else
        echo "$COMPJS" up-to-date
    fi
}

# Recompile cdl when comp file newer than run file
function check_runjs()
{
    if [ "$COMPJS" -nt "$RUNJS" ]; then
        echo build "$RUNJS"
        # Compile with default debugInfo = 1

        set -e
        set -o pipefail

        time \
            (node --max-old-space-size=4000 ${COMPJS} mode=js debugInfo=${FEGDEBUGINFO-1} "errors=${FEGERRORSTATUS-}" optimize=${OPTIMIZE} >| "$RUNJS.tmp") 2>&1 | \
            gawk -f "$UTIL/toSrc.awk" -v jsfile=${COMPJS}
        if [ $? -ne 0 ]; then
            exit 1
        fi
        if egrep '^// error: ' "$RUNJS.tmp"; then
            exit 1
        fi
        /bin/mv "$RUNJS.tmp" "$RUNJS"
        if [ $CHECK_WARNINGS -ne 0 ]; then
            egrep '^// warning: ' "$RUNJS"
        fi
    else
        echo "$RUNJS" up-to-date
    fi
}

HTMLTEMPLATE="$TEMPLATEDIR/runtemplate.html"
RUNJSTEMPLATE="$TEMPLATEDIR/feg.includeList.js"
NODEJSTEMPLATE="$TEMPLATEDIR/node.template.js"
MINHTMLTEMPLATE="$TEMPLATEDIR/sftemplate.html"

# If any of the template files are newer than the target, rebuild the target.
# TEMPLATEFILES must be set before calling
function check_template() # $1=target $2=input template $3=source file $4=mode
{
    local REBUILD=0

    if [ "$FORCE" == 1 ]; then
        REBUILD=1
    else
        for f in ${TEMPLATEFILES}; do
            if [ "$f" -nt "$1" ]; then
                if [ "$VERBOSE" == 1 ]; then
                    echo $f newer than $1
                fi
                REBUILD=1
                break
            fi
        done
    fi

    if [ "$REBUILD" -eq 1 ]; then
        echo building $1
        "$UTIL/genIncJS.py" \
	    "--out_file=$1.tmp" \
	    "--resourceUseFile=intermediate/$APP.res" \
        "--langdir=$LANGDIR" \
        "--cdldir=$CDLDIR" \
	    "--template=$2" \
	    "--title=$APP" \
	    "--mode=$4" \
            "$3"
            if [ $? -ne 0 ]; then
                exit 1
            fi
        /bin/mv "$1.tmp" "$1"
    else
        echo "$1" up-to-date
    fi
}

# Rebuild the HTML file when the template, include list or one of the sources
# that includes other sources via %%include%% directives has changed
function check_html()
{
    TEMPLATEFILES=`echo $HTMLTEMPLATE $RUNJSTEMPLATE $SCRIPTSDIR/{positioning,query,utils,utils/trees}/*.js`
    check_template "$HTML" "$HTMLTEMPLATE" "$RUNJS" html
}

UGLIFY="uglifyjs --max-old-space-size=4000 --stack_size=4000"

# First build the html file, then derive the min.html
function check_minhtml()
{
    HTML="$APP.html"

    # Make sure the javascript directory exists
    if [ ! -d javascript ]; then mkdir javascript; fi
    # Path to (single) javascript file
    MINJS="javascript/$APP.min.js"

    # Make the normal html and run.js
    check_html
    # Recreate runtime in a single file
    make intermediate/common_runtime.js
    # Uglify it and make it the start of the min.js file
    $UGLIFY intermediate/common_runtime.js -c -m > "$MINJS"
    # Concat the .run.js file
    egrep -v '^// ' "$RUNJS" >> "$MINJS"
    # Concat the uglified postlude
    $UGLIFY "$FEGDIR/minbuild/feg/functionExecute.postlude.js" -c -m >> "$MINJS"
    # Generate the .min.html file
    "$UTIL/genIncJS.py" \
        "--out_file=$MINHTML" \
        "--langdir=$LANGDIR" \
        "--cdldir=$CDLDIR" \
        "--resourceUseFile=intermediate/$APP.res" \
        "--commonImageDir=image" \
        "--title=$APP" \
        "--template=$MINHTMLTEMPLATE" \
        "--mode=html" \
        "$MINJS"
}

# Rebuild the node.js file when the template, include list or any source file
# was changed
function check_nodejs()
{
    TEMPLATEFILES=`echo $RUNJS $NODEJSTEMPLATE $RUNJSTEMPLATE $SCRIPTSDIR/{feg,positioning,query,remoting,feg/js/*,utils,utils/trees}/*.js`
    check_template "$NODEJS" "$NODEJSTEMPLATE" "$RUNJS" js
}

function build()
{
    APP="$1"
    FORMAT="$2"

    if [ ! -d intermediate ]
    then
        mkdir intermediate
    fi

    # Get all cdl files the app depends on
    CDL_FILES=`"$UTIL/genIncJS.py" --template="$TEMPLATEDIR/compile.check.js" --mode=incl --out_file=/dev/null --langdir="$LANGDIR" --cdldir="$CDLDIR" --libConf=lib.conf "$APP.js"`

    # Build .comp.js file
    COMPJS=intermediate/"$APP.comp.js"
    check_compjs

    # Build .run.js file
    RUNJS=intermediate/"$APP.run.js"
    check_runjs

    # Check if the container is up to date
    case "$FORMAT" in
        html)
            HTML="$APP.html"
            check_html
            ;;
        minhtml)
            MINHTML="$APP.min.html"
            check_minhtml
            ;;
        nodejs)
            NODEJS="$APP.node.js"
            check_nodejs
            ;;
    esac
}

# Parse command line arguments
DEFAULTFORMAT=html
while getopts F:d:o:vfw OPT ; do
    case "$OPT" in
        F)
            DEFAULTFORMAT="$OPTARG"
            ;;
        d)
            FEGDEBUGINFO="$OPTARG"
            ;;
        o)
            if [ "_$OPTARG" == "_0" ]
            then
                OPTIMIZE=false
            fi
            ;;
        v)
            VERBOSE=1
            ;;
        w)
            CHECK_WARNINGS=1
            ;;
        f)
            FORCE=1
            ;;
        *)
            echo unknown option "$OPT"
            exit 1
            ;;
    esac
done
shift $((OPTIND-1))

if [[ $# < 1 ]]; then
    echo usage: $0 [-d debuglevel] [-F format] [-v] [-f] target ...
    exit 1
fi

for app in $*; do
    case "$app" in
        *.min.html)
            build ${1%.min.html} minhtml
            ;;
        *.html)
            build ${1%.html} html
            ;;
        *.node.js)
            build ${1%.node.js} nodejs
            ;;
        *.js)
            build ${1%.js} "$DEFAULTFORMAT"
            ;;
        *)
            echo unknown target: "$app"
            exit 1
            ;;
    esac
done
