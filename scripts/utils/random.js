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


//
// Function for generating various random values.
//



function getRandomString(len)
{
    var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";
    var string_length = (Number(len) > 0) ? Number(len) : 8;
    var randomstring = '';
    for (var i=0; i<string_length; i++) {
    var rnum = Math.floor(Math.random() * chars.length);
    randomstring += chars.substring(rnum,rnum+1);
    }
    return randomstring;
}

function getRandomValue()
{
    var types = ["string", "number", "boolean", "undefined"];

    var type = types[Math.floor(Math.random() * types.length)];

    switch (type) {
      case "string":
        return getRandomString();
        break;

      case "number":
        return Math.random() * 2000 - 1000;
        break;

      case "boolean":
        return (Math.random() > 0.5) ? true : false;
        break;

      case "undefined":
        return undefined;
        break;

      default:
        assert(false, "should not be here");
        return undefined;
    }

}

function getRandInt(n)
{
    return Math.floor(Math.random() * n);
}

function getRandomPermutation(n)
{
    var perm = [];

    var i;
    var c;
    for (i = 0; i < n; i++) {
        perm[i] = i;
    }

    for (c = 0; c < 2; c++) {
        for (i = 0; i < n; i++) {
            var s = getRandInt(n);
            var t = perm[i];
            perm[i] = perm[s];
            perm[s] = t;
        }
    }

    return perm;
}

function getRandHexDigit() {
    return "0123456789ABCDEF".charAt(getRandInt(16));
}

function getRandomColor() {
    var rnd = Math.random();

    if (rnd < 0.4) {
        var colorNames = ["maroon", "red", "orange", "yellow", "olive",
                          "purple", "fuchsia", "white", "lime", "green", "navy",
                          "blue", "aqua", "teal", "black", "silver", "gray"];
        return colorNames[getRandInt(colorNames.length)];
    } else if (rnd < 0.6) {
        return "#" + getRandHexDigit() + getRandHexDigit() + getRandHexDigit();
    } else if (rnd < 0.8) {
        return "#" + getRandHexDigit() + getRandHexDigit() + getRandHexDigit() +
              getRandHexDigit() + getRandHexDigit() + getRandHexDigit();
    } else if (rnd < 0.9) {
        return "rgb(" + getRandInt(256) + "," + getRandInt(256) + "," +
              getRandInt(256) + ")";
    } else {
        return "rgb(" + getRandInt(101) + "%," + getRandInt(101) + "%," +
              getRandInt(101) + "%)";
    }
}
