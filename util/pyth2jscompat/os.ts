import * as ospath from "path";
import * as fs from "fs";

/* Imitates Python's os module, including os.path
   Note that this module uses / as a path separator on Windows too.
   That means / is not allowed in a file name.
*/

function win2unix(p: string): string {
    return p.replace(/\\/g, "/");
}

export const path = {
    basename: (p: string): string => {
        return ospath.basename(p);
    },

    splitext: (p: string): string[] => {
        const ext = ospath.extname(p);
        return [p.substring(0, p.length - ext.length), ext];
    },

    realpath: (p: string): string => {
        return win2unix(fs.realpathSync(p));
    },

    relpath: (p: string, reldir: string = process.cwd()): string => {
        return win2unix(ospath.relative(reldir, p));
    },

    join: (... args: string[]): string => {
        return win2unix(ospath.join.apply(undefined, args));
    },

    isdir: (p: string): boolean => {
        try {
            return fs.statSync(p).isDirectory();
        } catch (e) {
            return false;
        }
    },

    exists: (p: string): boolean => {
        try {
            return fs.statSync(p) !== undefined;
        } catch (e) {
            return false;
        }
    },
    
    isfile: (p: string): boolean => {
        try {
            return fs.statSync(p).isFile();
        } catch (e) {
            return false;
        }
    },

    dirname: (p: string): string => {
        return win2unix(ospath.dirname(p));
    },

    getmtime: (p: string): number => {
        return fs.statSync(p).mtime.getMilliseconds();
    }
};

export function getcwd(): string {
    return win2unix(process.cwd());
}

export function remove(p: string): void {
    fs.unlinkSync(p);
}

// TODO: This function does not create intermediate directories
export function makedirs(p: string): void {
    const pathComponents: string[] = p.split('/');

    for (let i = 1; i < pathComponents.length; i++) {
        const subPath_i = pathComponents.slice(0, i).join('/');
        if (!path.exists(subPath_i)) {
            fs.mkdirSync(subPath_i);
        }
    }
    fs.mkdirSync(p);
}
