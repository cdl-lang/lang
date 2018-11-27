/// <reference path="cdl.ts" />

// Simple foreign interface functions

// How to add a new function?
//
// To add a plain JavaScript function, add the line
//     var x = new ForeignJavaScriptFunction("x", f);
// to this file.
//   The function name in cdl will be x, and it is important that the first
// argument to the constructor is the exact name of x as a string. The second
// argument is the function you want called.
//   When the cdl code contains [x, arg_1, arg_2, ..., arg_n], function f is
// called as f(v_1, v_2, ..., v_n).
//   f can return a number, string, boolean or an array of these types. Any
// other value is rejected.
//
// To add a function that must be called on an object, add the line
//     var x = new ForeignJavaScriptObjectFunction("x", f);
// When the cdl code contains [x, arg_1, arg_2, ..., arg_n], function f is
// called as v_1.f(v_2, ..., v_n). Since a CDL program cannot construct
// JavaScript objects, it only makes sense for type String, whose members have
// already been added below.
//
// NOTE: avoid using global names, such as parseInt, vectorAddValue,
// or allAreas.

var sin = new ForeignJavaScriptFunction("sin", Math.sin, numericValueType);
var cos = new ForeignJavaScriptFunction("cos", Math.cos, numericValueType);
var tan = new ForeignJavaScriptFunction("tan", Math.tan, numericValueType);
var asin = new ForeignJavaScriptFunction("asin", Math.asin, numericValueType);
var acos = new ForeignJavaScriptFunction("acos", Math.acos, numericValueType);
var atan2 = new ForeignJavaScriptFunction("atan2", Math.atan2, numericValueType);
var sinh = new ForeignJavaScriptFunction("sinh", Math.sinh, numericValueType);
var cosh = new ForeignJavaScriptFunction("cosh", Math.cosh, numericValueType);
var tanh = new ForeignJavaScriptFunction("tanh", Math.tanh, numericValueType);
var asinh = new ForeignJavaScriptFunction("asinh", Math.asinh, numericValueType);
var acosh = new ForeignJavaScriptFunction("acosh", Math.acosh, numericValueType);
var atanh = new ForeignJavaScriptFunction("atanh", Math.atanh, numericValueType);
var log10 = new ForeignJavaScriptFunction("log10", Math.log10, numericValueType);
var log2 = new ForeignJavaScriptFunction("log2", Math.log2, numericValueType);
var ln = new ForeignJavaScriptFunction("ln", Math.log, numericValueType);
var exp = new ForeignJavaScriptFunction("exp", Math.exp, numericValueType);
var stringToNumber = new ForeignJavaScriptFunction("stringToNumber", Number.parseFloat, numericValueType);
var stringToInteger = new ForeignJavaScriptFunction("stringToInteger", Number.parseInt, numericValueType);

var toLowerCase = new ForeignJavaScriptObjectFunction("toLowerCase", "".toLowerCase, stringValueType);
var toUpperCase = new ForeignJavaScriptObjectFunction("toUpperCase", "".toUpperCase, stringValueType);
var toLocaleLowerCase = new ForeignJavaScriptObjectFunction("toLocaleLowerCase", "".toLocaleLowerCase, stringValueType);
var toLocaleUpperCase = new ForeignJavaScriptObjectFunction("toLocaleUpperCase", "".toLocaleUpperCase, stringValueType);
var charAt = new ForeignJavaScriptObjectFunction("charAt", "".charAt, stringValueType);
var charCodeAt = new ForeignJavaScriptObjectFunction("charCodeAt", "".charCodeAt, stringValueType);
var codePointAt = new ForeignJavaScriptObjectFunction("codePointAt", "".codePointAt, stringValueType);
var endsWith = new ForeignJavaScriptObjectFunction("endsWith", "".endsWith, boolValueType);
var includes = new ForeignJavaScriptObjectFunction("includes", "".includes, boolValueType);
var indexOf = new ForeignJavaScriptObjectFunction("indexOf", "".indexOf, numericValueType);
var lastIndexOf = new ForeignJavaScriptObjectFunction("lastIndexOf", "".lastIndexOf, numericValueType);
var localeCompare = new ForeignJavaScriptFunction("localeCompare", function(s1: any, s2: any, locale?: any, options?: any): any {
        return typeof(s1) === "string"?
            s1.localeCompare(s2, locale === false? undefined: locale, options):
            undefined;
    }, numericValueType);
var normalize = new ForeignJavaScriptObjectFunction("normalize", "".normalize, stringValueType);
var repeat = new ForeignJavaScriptObjectFunction("repeat", "".repeat, stringValueType);
var replace = new ForeignJavaScriptObjectFunction("replace", "".replace, stringValueType);
var match = new ForeignJavaScriptObjectFunction("match", "".match, stringValueType);
var search = new ForeignJavaScriptObjectFunction("search", "".search, numericValueType);
var slice = new ForeignJavaScriptObjectFunction("slice", "".slice, stringValueType);
var split = new ForeignJavaScriptObjectFunction("split", "".split, stringValueType);
var startsWith = new ForeignJavaScriptObjectFunction("startsWith", "".startsWith, boolValueType);
var trim = new ForeignJavaScriptObjectFunction("trim", "".trim, stringValueType);
var stringLength = new ForeignJavaScriptFunction("stringLength", function(s: any): number {
        return typeof(s) === "string"? s.length: undefined;
    }, numericValueType);

var stringToHTML = new ForeignJavaScriptFunction("stringToHTML",
    function(a: any): string {
        return a.toString().replace(/[<>&]/g, function(match: string): string {
            switch (match) {
                case "<": return "&lt;";
                case ">": return "&gt;";
                case "&": return "&amp;";
                default: return match;
            }
        });
    },
    stringValueType
);
