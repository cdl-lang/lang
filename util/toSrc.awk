#! gawk -f

# Copyright 2017 Yoav Seginer, Theo Vosse, Gil Harari, and Uri Kolodny.

# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

BEGIN {
    createLineMapping();
    FS="[ ,]";
    jsFileWithLineNumber = jsfile ":[0-9]+";
}


function createLineMapping() {
    inputLine=0;
    while ((getline line < jsfile) > 0) {
        inputLine++;
        if (line ~ /^\/\/# .*:[0-9]+$/) {
            split(line, srcFile, "[ :]");
            srcFileName=srcFile[2];
            srcFileLine=srcFile[3] - 1;
        } else {
            srcFileLine++;
        }
        line2file[inputLine]=srcFileName;
        line2line[inputLine]=srcFileLine;
    }
}

/^.*: line [0-9]+,/ {
    inp = $0;
    if (line2file[$3] == "") {
        print $0;
    } else {
        sub(/^[^,]*,/, ",", inp);
        print line2file[$3] ": line " line2line[$3] inp;
    }
}

$0 ~ jsFileWithLineNumber {
    inp = $0;
    line = $0;
    jsFileWithColon = "^.*" jsfile ":";
    sub(jsFileWithColon, "", line);

    sub(/[^0-9]+.*$/, "", line);

    if (line2file[line] == "") {
        print $0;
    } else {
        sub(jsfile, line2file[line], inp);
        sub(line, line2line[line], inp);
        print inp;
    }

    next;
}


/^[^ ]*[.]comp[.]js:[0-9]*/ {
    inp = $0;
    line = $1;
    sub(/^[^ ]*[.]comp[.]js:/, "", line);
    sub(/[^0-9]*$/, "", line);

    if (line2file[line] == "") {
        print $0;
    } else {
        print line2file[line] ": line " line2line[line];
    }

    next;
}

{ print $0; }
