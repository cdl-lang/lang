import * as fs from "fs";
import * as zlib from "zlib";
import * as sys from "./sys";

export function objectEqual(q1: any, q2: any): boolean {
    if (q1 === q2)
        return true;
    var t1: string = typeof(q1), t2: string = typeof(q2);
    if (t1 !== t2)
        return false;
    if (t1 !== "object")
        return false; // q1 and q2 aren't objects and q1 !== q2
    if (q1 instanceof RegExp || q2 instanceof RegExp)
        return q1 instanceof RegExp && q2 instanceof RegExp &&
               q1.toString() === q2.toString();
    if (q1 instanceof Array) {
        if (!(q2 instanceof Array))
            return false;
        if (q1.length !== q2.length)
            return false;
        for (var i = 0; i !== q1.length; i++)
            if (!objectEqual(q1[i], q2[i]))
                return false;
    } else if (q2 instanceof Array) {
        return false;
    } else {
        if (q1 === null || q2 === null)
            return q1 === q2;
        for (var attr in q1)
            if (!(attr in q2) || !objectEqual(q1[attr], q2[attr]))
                return false;
        for (var attr in q2)
            if (!(attr in q1))
                return false;
    }
    return true;
}

export function gzipFile(from: string, to: string): void {
    fs.writeFileSync(to,
        zlib.gzipSync(fs.readFileSync(from)),
        {encoding: null, mode: 0o644, flag: "w"});
}

export function readTextFile(fn: string): string {
    try {
        return fs.readFileSync(fn).toString();
    } catch (e) {
        console.log(sys.argv[0] + ": " + e.toString());
        return process.exit(1);
    }
}

export function readTextFileLines(fn: string): string[] {
    try {
        const strs = fs.readFileSync(fn).toString().split(/\r?\n/);
        return strs.length > 0 && strs[strs.length - 1] === ""? strs.slice(0, -1): strs;
    } catch (e) {
        console.log(sys.argv[0] + ": " + e.toString());
        return process.exit(1);
    }
}