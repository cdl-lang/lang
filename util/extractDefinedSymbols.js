const fs = require("fs");
const re = /^var +([$a-zA-Z_][$a-zA-Z_0-9]+)/;

console.log("export const cdlBuiltInFunctions: {[funcName: string]: boolean} = {");
for (let i = 2; i < process.argv.length; i++) {
    const fileName = process.argv[i];
    const fileContent = fs.readFileSync(fileName).toString().split(/\r?\n/);
    for (let i = 0; i < fileContent.length; i++) {
        const line = fileContent[i];
        const m = line.match(re);
        if (m) {
            console.log(m[1] + ": true,");
        }
    }
}
console.log("};");
