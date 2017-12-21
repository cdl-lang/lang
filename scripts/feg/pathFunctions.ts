// Copyright 2017 Theo Vosse.
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

abstract class ResourcePath {
    constructor(public hierarchy: string[],
                public baseName: string,
                public extension: string) {
    }

    abstract getResourceString(): string;

    abstract clone(): ResourcePath;

    abstract getURLResourcePath(): URLResourcePath;

    up(): ResourcePath {
        var resPath: ResourcePath = this.clone();

        resPath.hierarchy.pop();
        return resPath;
    }

    down(subHier: string): ResourcePath {
        var resPath: ResourcePath = this.clone();

        resPath.hierarchy = resPath.hierarchy.concat(subHier);
        return resPath;
    }

    replaceExtension(extension: string): ResourcePath {
        var resPath: ResourcePath = this.clone();

        resPath.extension = extension;
        return resPath;
    }
}

abstract class PathFunctions {
    abstract getPath(path: string): ResourcePath;
}

class URLResourcePath extends ResourcePath {
    constructor(public protocol: string,
                hierarchy: string[],
                baseName: string,
                extension: string,
                public args: string) {
        super(hierarchy, baseName, extension);
    }

    getResourceString(): string {
        return this.protocol + "://" +
               (this.hierarchy.length === 0? "": this.hierarchy.map(encodeURIComponent).join("/") + "/") +
               this.baseName + (this.extension === undefined? "": "." + this.extension) +
               (this.args === undefined? "": "?" + this.args);
    }

    clone(): URLResourcePath {
        return new URLResourcePath(this.protocol, this.hierarchy.map(decodeURIComponent),
                                   this.baseName, this.extension, this.args);
    }

    getURLResourcePath(): URLResourcePath {
        return this;
    }
}

class URLPathFunctions extends PathFunctions {
    getPath(path: string): URLResourcePath {
        var matches = path.match(/^[a-z]+:\/\//);
        var protocol: string;
        var hierarchy: string[];
        var baseName: string;
        var extension: string;
        var args: string;
        var qIndex: number;
        var dotIndex: number;

        if (matches === null) {
            return undefined;
        }
        protocol = matches[0].slice(0, -3)
        path = path.slice(matches[0].length);
        qIndex = path.indexOf("?");
        if (qIndex >= 0) {
            args = path.slice(qIndex + 1);
            path = path.slice(0, qIndex);
        }
        hierarchy = path.split("/");
        baseName = hierarchy.pop();
        dotIndex = baseName === undefined? -1: baseName.lastIndexOf(".");
        if (dotIndex >= 0) {
            extension = baseName.slice(dotIndex + 1);
            baseName = baseName.slice(0, dotIndex);
        }
        return new URLResourcePath(protocol, hierarchy, baseName, extension, args);
    }
}

class OSResourcePath extends ResourcePath {
    constructor(public isWindows: boolean,
                hierarchy: string[],
                baseName: string,
                extension: string) {
        super(hierarchy, baseName, extension);
    }

    getResourceString(): string {
        var sep: string = this.isWindows? "\\": "/";

        return (this.hierarchy.length === 0? "": this.hierarchy.join(sep) + sep) +
               this.baseName + (this.extension === undefined? "": "." + this.extension);
    }

    clone(): OSResourcePath {
        return new OSResourcePath(this.isWindows, this.hierarchy, this.baseName,
                                  this.extension);
    }

    getURLResourcePath(): URLResourcePath {
        return new URLResourcePath("file", this.hierarchy, this.baseName, this.extension, undefined);
    }
}

class OSPathFunctions extends PathFunctions {
    constructor(public isWindows: boolean) {
        super();
    }

    getPath(path: string): OSResourcePath {
        var hierarchy: string[];
        var baseName: string;
        var extension: string;

        hierarchy = path.split(this.isWindows? /\\\\|\//: /\//);
        baseName = hierarchy.pop();
        var dotIndex: number = baseName === undefined? -1: baseName.lastIndexOf(".");
        if (dotIndex >= 0) {
            extension = baseName.slice(dotIndex + 1);
            baseName = baseName.slice(0, dotIndex);
        }
        return new OSResourcePath(this.isWindows, hierarchy, baseName, extension);
    }
}