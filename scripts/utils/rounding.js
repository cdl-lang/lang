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
// This file implements a few simple rounding functions
//

// This function rounds the number x after the given number of significant
// digits. For example, with 4 significant digits, 12546 
// is rounded to 12550, while 0.006785611 is rounded to 0.006786.

function significantDigitRounding(x, significantDigits)
{
    if (x === 0)
        return 0;

	var shift = Math.pow(10, -Math.floor(Math.log(x < 0? -x: x) / Math.LN10) +
						 significantDigits - 1);

	return Math.round(x * shift) / shift;
}

// This functions rounds the number x to a fixed number of digits
// after (or before) the decimal point. For example, if fixedPos is
// 2, this function will round numbers to 2 digits after the decimal point
// (23.567 will be rounded to 23.57) while if fixedPos is -2, this function
// will round numbers to 2 digits before the decimal point (123.56 will
// be rounded to 100).

function fixedRounding(x, fixedPos)
{
	var shift = Math.pow(10, fixedPos);

	return Math.round(x * shift) / shift;
}

// This function is the same as 'fixedRounding()' except that it is given
// the 'shift' (the amount by which the number should be multiplied
// before being rounded) instead of the number of digits to shift.
// This is in case the calling function needs to repeat this many times
// and does not wish to repeatedly calculate the shift.

function shiftRounding(x, shift)
{
	return Math.round(x * shift) / shift;
}
