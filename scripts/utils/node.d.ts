// Declarations of some of the node namespace and modules. This should be
// installed via npm, but svn won't accept @types as a legal path name, so
// instead they are copied here.

declare namespace NodeJS {

    export interface Process {
        argv: string[];

        exit(status: number): never;

        env: {[variable: string]: string};

        on(event: string, handler: (err: any) => void): void;
    }

    // Node uses this interface for setTimeout, but the browser uses numbered
    // ids. The neatest solution seems to be to accept both types and cast the
    // result to <any> when calling clearTimeout().
    export interface Timer {
        ref(): void;
        unref(): void;
    }

    export interface ErrnoException extends Error {
        errno?: number;
        code?: string;
        path?: string;
        syscall?: string;
        stack?: string;
    }

    export module http {
        export interface RequestOptions {
            protocol?: string;
            host?: string;
            hostname?: string;
            family?: number;
            port?: number;
            localAddress?: string;
            socketPath?: string;
            method?: string;
            path?: string;
            headers?: { [key: string]: any };
            auth?: string;
            agent?: Agent | boolean;
        }

        export interface Server extends net.Server {
            setTimeout(msecs: number, callback: Function): void;
            maxHeadersCount: number;
            timeout: number;
            listening: boolean;
        }
        /**
         * @deprecated Use IncomingMessage
         */
        export interface ServerRequest extends IncomingMessage {
            connection: net.Socket;
        }
        export interface ServerResponse extends stream.Writable {
            // Extended base methods
            write(buffer: Buffer): boolean;
            write(buffer: Buffer, cb?: Function): boolean;
            write(str: string, cb?: Function): boolean;
            write(str: string, encoding?: string, cb?: Function): boolean;
            write(str: string, encoding?: string, fd?: string): boolean;

            writeContinue(): void;
            writeHead(statusCode: number, reasonPhrase?: string, headers?: any): void;
            writeHead(statusCode: number, headers?: any): void;
            statusCode: number;
            statusMessage: string;
            headersSent: boolean;
            setHeader(name: string, value: string | string[]): void;
            setTimeout(msecs: number, callback: Function): ServerResponse;
            sendDate: boolean;
            getHeader(name: string): string;
            removeHeader(name: string): void;
            write(chunk: any, encoding?: string): any;
            addTrailers(headers: any): void;
            finished: boolean;

            // Extended base methods
            end(): void;
            end(buffer: Buffer, cb?: Function): void;
            end(str: string, cb?: Function): void;
            end(str: string, encoding?: string, cb?: Function): void;
            end(data?: any, encoding?: string): void;
        }
        export interface ClientRequest extends stream.Writable {
            // Extended base methods
            write(buffer: Buffer): boolean;
            write(buffer: Buffer, cb?: Function): boolean;
            write(str: string, cb?: Function): boolean;
            write(str: string, encoding?: string, cb?: Function): boolean;
            write(str: string, encoding?: string, fd?: string): boolean;

            write(chunk: any, encoding?: string): void;
            abort(): void;
            setTimeout(timeout: number, callback?: Function): void;
            setNoDelay(noDelay?: boolean): void;
            setSocketKeepAlive(enable?: boolean, initialDelay?: number): void;

            setHeader(name: string, value: string | string[]): void;
            getHeader(name: string): string;
            removeHeader(name: string): void;
            addTrailers(headers: any): void;

            // Extended base methods
            end(): void;
            end(buffer: Buffer, cb?: Function): void;
            end(str: string, cb?: Function): void;
            end(str: string, encoding?: string, cb?: Function): void;
            end(data?: any, encoding?: string): void;
        }
        export interface IncomingMessage extends stream.Readable {
            httpVersion: string;
            httpVersionMajor: number;
            httpVersionMinor: number;
            connection: net.Socket;
            headers: IncomingHttpHeaders;
            rawHeaders: string[];
            trailers: any;
            rawTrailers: any;
            setTimeout(msecs: number, callback: Function): NodeJS.Timer;
            /**
             * Only valid for request obtained from http.Server.
             */
            method?: string;
            /**
             * Only valid for request obtained from http.Server.
             */
            url?: string;
            /**
             * Only valid for response obtained from http.ClientRequest.
             */
            statusCode?: number;
            /**
             * Only valid for response obtained from http.ClientRequest.
             */
            statusMessage?: string;
            socket: net.Socket;
            destroy(error?: Error): void;
        }
        // incoming headers will never contain number
        export interface IncomingHttpHeaders {
            'accept'?: string;
            'access-control-allow-origin'?: string;
            'access-control-allow-credentials'?: string;
            'access-control-expose-headers'?: string;
            'access-control-max-age'?: string;
            'access-control-allow-methods'?: string;
            'access-control-allow-headers'?: string;
            'accept-patch'?: string;
            'accept-ranges'?: string;
            'age'?: string;
            'allow'?: string;
            'alt-svc'?: string;
            'cache-control'?: string;
            'connection'?: string;
            'content-disposition'?: string;
            'content-encoding'?: string;
            'content-language'?: string;
            'content-length'?: string;
            'content-location'?: string;
            'content-range'?: string;
            'content-type'?: string;
            'date'?: string;
            'expires'?: string;
            'host'?: string;
            'last-modified'?: string;
            'location'?: string;
            'pragma'?: string;
            'proxy-authenticate'?: string;
            'public-key-pins'?: string;
            'retry-after'?: string;
            'set-cookie'?: string[];
            'strict-transport-security'?: string;
            'trailer'?: string;
            'transfer-encoding'?: string;
            'tk'?: string;
            'upgrade'?: string;
            'vary'?: string;
            'via'?: string;
            'warning'?: string;
            'www-authenticate'?: string;
            [header: string]: string | string[] | undefined;
        }
        /**
         * @deprecated Use IncomingMessage
         */
        export interface ClientResponse extends IncomingMessage { }

        export interface AgentOptions {
            /**
             * Keep sockets around in a pool to be used by other requests in the future. Default = false
             */
            keepAlive?: boolean;
            /**
             * When using HTTP KeepAlive, how often to send TCP KeepAlive packets over sockets being kept alive. Default = 1000.
             * Only relevant if keepAlive is set to true.
             */
            keepAliveMsecs?: number;
            /**
             * Maximum number of sockets to allow per host. Default for Node 0.10 is 5, default for Node 0.12 is Infinity
             */
            maxSockets?: number;
            /**
             * Maximum number of sockets to leave open in a free state. Only relevant if keepAlive is set to true. Default = 256.
             */
            maxFreeSockets?: number;
        }

        export class Agent {
            maxSockets: number;
            sockets: any;
            requests: any;

            constructor(opts?: AgentOptions);

            /**
             * Destroy any sockets that are currently in use by the agent.
             * It is usually not necessary to do this. However, if you are using an agent with KeepAlive enabled,
             * then it is best to explicitly shut down the agent when you know that it will no longer be used. Otherwise,
             * sockets may hang open for quite a long time before the server terminates them.
             */
            destroy(): void;
        }

        export var METHODS: string[];

        export var STATUS_CODES: {
            [errorCode: number]: string;
            [errorCode: string]: string;
        };
        export function createServer(requestListener?: (request: IncomingMessage, response: ServerResponse) => void): Server;
        export function createClient(port?: number, host?: string): any;
        export function request(options: RequestOptions, callback?: (res: IncomingMessage) => void): ClientRequest;
        export function get(options: any, callback?: (res: IncomingMessage) => void): ClientRequest;
    }

    export module https {
        export interface ServerOptions {
            pfx?: any;
            key?: any;
            passphrase?: string;
            cert?: any;
            ca?: any;
            crl?: any;
            ciphers?: string;
            honorCipherOrder?: boolean;
            requestCert?: boolean;
            rejectUnauthorized?: boolean;
            NPNProtocols?: any;
            SNICallback?: (servername: string, cb: (err: Error, ctx: any) => any) => any;
        }

        export interface RequestOptions extends http.RequestOptions {
            pfx?: any;
            key?: any;
            passphrase?: string;
            cert?: any;
            ca?: any;
            ciphers?: string;
            rejectUnauthorized?: boolean;
            secureProtocol?: string;
        }

        export interface Agent extends http.Agent { }

        export interface AgentOptions extends http.AgentOptions {
            pfx?: any;
            key?: any;
            passphrase?: string;
            cert?: any;
            ca?: any;
            ciphers?: string;
            rejectUnauthorized?: boolean;
            secureProtocol?: string;
            maxCachedSessions?: number;
        }

        export var Agent: {
            new (options?: AgentOptions): Agent;
        };
        export interface Server extends net.Server { }
        export function createServer(options: ServerOptions, requestListener?: Function): Server;
        export function request(options: RequestOptions, callback?: (res: http.IncomingMessage) => void): http.ClientRequest;
        export function get(options: RequestOptions, callback?: (res: http.IncomingMessage) => void): http.ClientRequest;
        export var globalAgent: Agent;
    }

    export module url {
        export interface UrlObject {
            auth?: string;
            hash?: string;
            host?: string;
            hostname?: string;
            href?: string;
            path?: string;
            pathname?: string;
            port?: string | number;
            protocol?: string;
            query?: string | { [key: string]: any; };
            search?: string;
            slashes?: boolean;
        }

        export interface Url extends UrlObject {
            port?: string;
            query?: any;
        }

        export function parse(urlStr: string, parseQueryString?: boolean, slashesDenoteHost?: boolean): Url;
    }
}

declare module stream {
    export interface Writable {
    }
    export interface Readable {
        on(event: string, listener: Function): void;
    }
}

declare module net {
    export interface Socket {
        remoteAddress: string;
    }
    export interface ListenOptions {
        port?: number;
        host?: string;
        backlog?: number;
        path?: string;
        exclusive?: boolean;
    }
    export interface Server {
        listen(port: number, hostname?: string, backlog?: number, listeningListener?: Function): Server;
        listen(port: number, hostname?: string, listeningListener?: Function): Server;
        listen(port: number, backlog?: number, listeningListener?: Function): Server;
        listen(port: number, listeningListener?: Function): Server;
        listen(path: string, backlog?: number, listeningListener?: Function): Server;
        listen(path: string, listeningListener?: Function): Server;
        listen(options: ListenOptions, listeningListener?: Function): Server;
        listen(handle: any, backlog?: number, listeningListener?: Function): Server;
        listen(handle: any, listeningListener?: Function): Server;
        close(callback?: Function): Server;
        address(): { port: number; family: string; address: string; };
        getConnections(cb: (error: Error, count: number) => void): void;
        ref(): Server;
        unref(): Server;
        maxConnections: number;
        connections: number;

        /**
         * events.EventEmitter
         *   1. close
         *   2. connection
         *   3. error
         *   4. listening
         */
        addListener(event: string, listener: Function): this;
        addListener(event: "close", listener: () => void): this;
        addListener(event: "connection", listener: (socket: Socket) => void): this;
        addListener(event: "error", listener: (err: Error) => void): this;
        addListener(event: "listening", listener: () => void): this;

        emit(event: string, ...args: any[]): boolean;
        emit(event: "close"): boolean;
        emit(event: "connection", socket: Socket): boolean;
        emit(event: "error", err: Error): boolean;
        emit(event: "listening"): boolean;

        on(event: string, listener: Function): this;
        on(event: "close", listener: () => void): this;
        on(event: "connection", listener: (socket: Socket) => void): this;
        on(event: "error", listener: (err: Error) => void): this;
        on(event: "listening", listener: () => void): this;

        once(event: string, listener: Function): this;
        once(event: "close", listener: () => void): this;
        once(event: "connection", listener: (socket: Socket) => void): this;
        once(event: "error", listener: (err: Error) => void): this;
        once(event: "listening", listener: () => void): this;

        prependListener(event: string, listener: Function): this;
        prependListener(event: "close", listener: () => void): this;
        prependListener(event: "connection", listener: (socket: Socket) => void): this;
        prependListener(event: "error", listener: (err: Error) => void): this;
        prependListener(event: "listening", listener: () => void): this;

        prependOnceListener(event: string, listener: Function): this;
        prependOnceListener(event: "close", listener: () => void): this;
        prependOnceListener(event: "connection", listener: (socket: Socket) => void): this;
        prependOnceListener(event: "error", listener: (err: Error) => void): this;
        prependOnceListener(event: "listening", listener: () => void): this;
    }
}

declare module ChildProcess {

    export interface ChildProcess {
        stdin: stream.Writable;
        stdout: stream.Readable;
        stderr: stream.Readable;
        stdio: [stream.Writable, stream.Readable, stream.Readable];
        pid: number;
        kill(signal?: string): void;
        send(message: any, sendHandle?: any): boolean;
        connected: boolean;
        disconnect(): void;
        unref(): void;
        ref(): void;

        on(event: string, listener: Function): this;
        on(event: "close", listener: (code: number, signal: string) => void): this;
        on(event: "disconnect", listener: () => void): this;
        on(event: "error", listener: (err: Error) => void): this;
        on(event: "exit", listener: (code: number, signal: string) => void): this;
        on(event: "message", listener: (message: any, sendHandle: net.Socket | net.Server) => void): this;
    }

    export interface SpawnOptions {
        cwd?: string;
        env?: any;
        stdio?: any;
        detached?: boolean;
        uid?: number;
        gid?: number;
        shell?: boolean | string;
    }

    export function spawn(command: string, args?: string[], options?: SpawnOptions): ChildProcess;

    export interface ExecOptions {
        cwd?: string;
        env?: any;
        shell?: string;
        timeout?: number;
        maxBuffer?: number;
        killSignal?: string;
        uid?: number;
        gid?: number;
    }
    export interface ExecOptionsWithStringEncoding extends ExecOptions {
        encoding: any;
    }
    export interface ExecOptionsWithBufferEncoding extends ExecOptions {
        encoding: string; // specify `null`.
    }
    export function exec(command: string, callback?: (error: Error, stdout: string, stderr: string) => void): ChildProcess;
    export function exec(command: string, options: ExecOptionsWithStringEncoding, callback?: (error: Error, stdout: string, stderr: string) => void): ChildProcess;
    export function exec(command: string, options: ExecOptionsWithBufferEncoding, callback?: (error: Error, stdout: Buffer, stderr: Buffer) => void): ChildProcess;
    export function exec(command: string, options: ExecOptions, callback?: (error: Error, stdout: string, stderr: string) => void): ChildProcess;
}

declare module Path {

    export interface ParsedPath {
        root: string;
        dir: string;
        base: string;
        ext: string;
        name: string;
    }

    export function normalize(p: string): string;
    export function join(...paths: string[]): string;
    export function resolve(...pathSegments: any[]): string;
    export function isAbsolute(path: string): boolean;
    export function relative(from: string, to: string): string;
    export function dirname(p: string): string;
    export function basename(p: string, ext?: string): string;
    export function extname(p: string): string;
    export var sep: string;
    export var delimiter: string;
    export function parse(pathString: string): ParsedPath;
    export function format(pathObject: ParsedPath): string;

    export module posix {
        export function normalize(p: string): string;
        export function join(...paths: any[]): string;
        export function resolve(...pathSegments: any[]): string;
        export function isAbsolute(p: string): boolean;
        export function relative(from: string, to: string): string;
        export function dirname(p: string): string;
        export function basename(p: string, ext?: string): string;
        export function extname(p: string): string;
        export var sep: string;
        export var delimiter: string;
        export function parse(p: string): ParsedPath;
        export function format(pP: ParsedPath): string;
    }

    export module win32 {
        export function normalize(p: string): string;
        export function join(...paths: any[]): string;
        export function resolve(...pathSegments: any[]): string;
        export function isAbsolute(p: string): boolean;
        export function relative(from: string, to: string): string;
        export function dirname(p: string): string;
        export function basename(p: string, ext?: string): string;
        export function extname(p: string): string;
        export var sep: string;
        export var delimiter: string;
        export function parse(p: string): ParsedPath;
        export function format(pP: ParsedPath): string;
    }
}

interface NodeBuffer extends Uint8Array { }
interface Buffer extends NodeBuffer { }

declare module FS {
 
    interface Stats {
        isFile(): boolean;
        isDirectory(): boolean;
        isBlockDevice(): boolean;
        isCharacterDevice(): boolean;
        isSymbolicLink(): boolean;
        isFIFO(): boolean;
        isSocket(): boolean;
        dev: number;
        ino: number;
        mode: number;
        nlink: number;
        uid: number;
        gid: number;
        rdev: number;
        size: number;
        blksize: number;
        blocks: number;
        atime: Date;
        mtime: Date;
        ctime: Date;
        birthtime: Date;
    }

    export function rename(oldPath: string, newPath: string, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function renameSync(oldPath: string, newPath: string): void;
    export function truncate(path: string | Buffer, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function truncate(path: string | Buffer, len: number, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function truncateSync(path: string | Buffer, len?: number): void;
    export function ftruncate(fd: number, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function ftruncate(fd: number, len: number, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function ftruncateSync(fd: number, len?: number): void;
    export function chown(path: string | Buffer, uid: number, gid: number, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function chownSync(path: string | Buffer, uid: number, gid: number): void;
    export function fchown(fd: number, uid: number, gid: number, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function fchownSync(fd: number, uid: number, gid: number): void;
    export function lchown(path: string | Buffer, uid: number, gid: number, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function lchownSync(path: string | Buffer, uid: number, gid: number): void;
    export function chmod(path: string | Buffer, mode: number, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function chmod(path: string | Buffer, mode: string, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function chmodSync(path: string | Buffer, mode: number): void;
    export function chmodSync(path: string | Buffer, mode: string): void;
    export function fchmod(fd: number, mode: number, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function fchmod(fd: number, mode: string, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function fchmodSync(fd: number, mode: number): void;
    export function fchmodSync(fd: number, mode: string): void;
    export function lchmod(path: string | Buffer, mode: number, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function lchmod(path: string | Buffer, mode: string, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function lchmodSync(path: string | Buffer, mode: number): void;
    export function lchmodSync(path: string | Buffer, mode: string): void;
    export function stat(path: string | Buffer, callback?: (err: NodeJS.ErrnoException, stats: Stats) => any): void;
    export function lstat(path: string | Buffer, callback?: (err: NodeJS.ErrnoException, stats: Stats) => any): void;
    export function fstat(fd: number, callback?: (err: NodeJS.ErrnoException, stats: Stats) => any): void;
    export function statSync(path: string | Buffer): Stats;
    export function lstatSync(path: string | Buffer): Stats;
    export function fstatSync(fd: number): Stats;
    export function link(srcpath: string | Buffer, dstpath: string | Buffer, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function linkSync(srcpath: string | Buffer, dstpath: string | Buffer): void;
    export function symlink(srcpath: string | Buffer, dstpath: string | Buffer, type?: string, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function symlinkSync(srcpath: string | Buffer, dstpath: string | Buffer, type?: string): void;
    export function readlink(path: string | Buffer, callback?: (err: NodeJS.ErrnoException, linkString: string) => any): void;
    export function readlinkSync(path: string | Buffer): string;
    export function realpath(path: string | Buffer, callback?: (err: NodeJS.ErrnoException, resolvedPath: string) => any): void;
    export function realpath(path: string | Buffer, cache: { [path: string]: string }, callback: (err: NodeJS.ErrnoException, resolvedPath: string) => any): void;
    export function realpathSync(path: string | Buffer, cache?: { [path: string]: string }): string;
    export function unlink(path: string | Buffer, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function unlinkSync(path: string | Buffer): void;
    export function rmdir(path: string | Buffer, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function rmdirSync(path: string | Buffer): void;
    export function mkdir(path: string | Buffer, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function mkdir(path: string | Buffer, mode: number, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function mkdir(path: string | Buffer, mode: string, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function mkdirSync(path: string | Buffer, mode?: number): void;
    export function mkdirSync(path: string | Buffer, mode?: string): void;
    export function mkdtemp(prefix: string, callback?: (err: NodeJS.ErrnoException, folder: string) => void): void;
    export function mkdtempSync(prefix: string): string;
    export function readdir(path: string | Buffer, callback?: (err: NodeJS.ErrnoException, files: string[]) => void): void;
    export function readdirSync(path: string | Buffer): string[];
    export function close(fd: number, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function closeSync(fd: number): void;
    export function open(path: string | Buffer, flags: string | number, callback: (err: NodeJS.ErrnoException, fd: number) => void): void;
    export function open(path: string | Buffer, flags: string | number, mode: number, callback: (err: NodeJS.ErrnoException, fd: number) => void): void;
    export function openSync(path: string | Buffer, flags: string | number, mode?: number): number;
    export function utimes(path: string | Buffer, atime: number, mtime: number, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function utimes(path: string | Buffer, atime: Date, mtime: Date, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function utimesSync(path: string | Buffer, atime: number, mtime: number): void;
    export function utimesSync(path: string | Buffer, atime: Date, mtime: Date): void;
    export function futimes(fd: number, atime: number, mtime: number, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function futimes(fd: number, atime: Date, mtime: Date, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function futimesSync(fd: number, atime: number, mtime: number): void;
    export function futimesSync(fd: number, atime: Date, mtime: Date): void;
    export function fsync(fd: number, callback?: (err?: NodeJS.ErrnoException) => void): void;
    export function fsyncSync(fd: number): void;
    export function write(fd: number, buffer: Buffer, offset: number, length: number, position: number | null, callback?: (err: NodeJS.ErrnoException, written: number, buffer: Buffer) => void): void;
    export function write(fd: number, buffer: Buffer, offset: number, length: number, callback?: (err: NodeJS.ErrnoException, written: number, buffer: Buffer) => void): void;
    export function write(fd: number, data: any, callback?: (err: NodeJS.ErrnoException, written: number, str: string) => void): void;
    export function write(fd: number, data: any, offset: number, callback?: (err: NodeJS.ErrnoException, written: number, str: string) => void): void;
    export function write(fd: number, data: any, offset: number, encoding: string, callback?: (err: NodeJS.ErrnoException, written: number, str: string) => void): void;
    export function writeSync(fd: number, buffer: Buffer, offset: number, length: number, position?: number | null): number;
    export function writeSync(fd: number, data: any, position?: number | null, enconding?: string): number;
    export function read(fd: number, buffer: Buffer, offset: number, length: number, position: number | null, callback?: (err: NodeJS.ErrnoException, bytesRead: number, buffer: Buffer) => void): void;
    export function readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number | null): number;
    export function readFile(filename: string, encoding: string, callback: (err: NodeJS.ErrnoException, data: string) => void): void;
    export function readFile(filename: string, options: { encoding: string; flag?: string; }, callback: (err: NodeJS.ErrnoException, data: string) => void): void;
    export function readFile(filename: string, options: { flag?: string; }, callback: (err: NodeJS.ErrnoException, data: Buffer) => void): void;
    export function readFile(filename: string, callback: (err: NodeJS.ErrnoException, data: Buffer) => void): void;
    export function readFileSync(filename: string, encoding: string): string;
    export function readFileSync(filename: string, options: { encoding: string; flag?: string; }): string;
    export function readFileSync(filename: string, options?: { flag?: string; }): Buffer;
    export function writeFile(filename: string, data: any, callback?: (err: NodeJS.ErrnoException) => void): void;
    export function writeFile(filename: string, data: any, options: { encoding?: string; mode?: number; flag?: string; }, callback?: (err: NodeJS.ErrnoException) => void): void;
    export function writeFile(filename: string, data: any, options: { encoding?: string; mode?: string; flag?: string; }, callback?: (err: NodeJS.ErrnoException) => void): void;
    export function writeFileSync(filename: string, data: any, options?: { encoding?: string; mode?: number; flag?: string; }): void;
    export function writeFileSync(filename: string, data: any, options?: { encoding?: string; mode?: string; flag?: string; }): void;
    export function appendFile(filename: string, data: any, options: { encoding?: string; mode?: number; flag?: string; }, callback?: (err: NodeJS.ErrnoException) => void): void;
    export function appendFile(filename: string, data: any, options: { encoding?: string; mode?: string; flag?: string; }, callback?: (err: NodeJS.ErrnoException) => void): void;
    export function appendFile(filename: string, data: any, callback?: (err: NodeJS.ErrnoException) => void): void;
    export function appendFileSync(filename: string, data: any, options?: { encoding?: string; mode?: number; flag?: string; }): void;
    export function appendFileSync(filename: string, data: any, options?: { encoding?: string; mode?: string; flag?: string; }): void;
    export function watchFile(filename: string, listener: (curr: Stats, prev: Stats) => void): void;
    export function watchFile(filename: string, options: { persistent?: boolean; interval?: number; }, listener: (curr: Stats, prev: Stats) => void): void;
    export function unwatchFile(filename: string, listener?: (curr: Stats, prev: Stats) => void): void;
    export function exists(path: string | Buffer, callback?: (exists: boolean) => void): void;
    export function existsSync(path: string | Buffer): boolean;

    export namespace constants {
        // File Access Constants

        /** Constant for fs.access(). File is visible to the calling process. */
        export const F_OK: number;

        /** Constant for fs.access(). File can be read by the calling process. */
        export const R_OK: number;

        /** Constant for fs.access(). File can be written by the calling process. */
        export const W_OK: number;

        /** Constant for fs.access(). File can be executed by the calling process. */
        export const X_OK: number;

        // File Open Constants

        /** Constant for fs.open(). Flag indicating to open a file for read-only access. */
        export const O_RDONLY: number;

        /** Constant for fs.open(). Flag indicating to open a file for write-only access. */
        export const O_WRONLY: number;

        /** Constant for fs.open(). Flag indicating to open a file for read-write access. */
        export const O_RDWR: number;

        /** Constant for fs.open(). Flag indicating to create the file if it does not already exist. */
        export const O_CREAT: number;

        /** Constant for fs.open(). Flag indicating that opening a file should fail if the O_CREAT flag is set and the file already exists. */
        export const O_EXCL: number;

        /** Constant for fs.open(). Flag indicating that if path identifies a terminal device, opening the path shall not cause that terminal to become the controlling terminal for the process (if the process does not already have one). */
        export const O_NOCTTY: number;

        /** Constant for fs.open(). Flag indicating that if the file exists and is a regular file, and the file is opened successfully for write access, its length shall be truncated to zero. */
        export const O_TRUNC: number;

        /** Constant for fs.open(). Flag indicating that data will be appended to the end of the file. */
        export const O_APPEND: number;

        /** Constant for fs.open(). Flag indicating that the open should fail if the path is not a directory. */
        export const O_DIRECTORY: number;

        /** Constant for fs.open(). Flag indicating reading accesses to the file system will no longer result in an update to the atime information associated with the file. This flag is available on Linux operating systems only. */
        export const O_NOATIME: number;

        /** Constant for fs.open(). Flag indicating that the open should fail if the path is a symbolic link. */
        export const O_NOFOLLOW: number;

        /** Constant for fs.open(). Flag indicating that the file is opened for synchronous I/O. */
        export const O_SYNC: number;

        /** Constant for fs.open(). Flag indicating to open the symbolic link itself rather than the resource it is pointing to. */
        export const O_SYMLINK: number;

        /** Constant for fs.open(). When set, an attempt will be made to minimize caching effects of file I/O. */
        export const O_DIRECT: number;

        /** Constant for fs.open(). Flag indicating to open the file in nonblocking mode when possible. */
        export const O_NONBLOCK: number;

        // File Type Constants

        /** Constant for fs.Stats mode property for determining a file's type. Bit mask used to extract the file type code. */
        export const S_IFMT: number;

        /** Constant for fs.Stats mode property for determining a file's type. File type constant for a regular file. */
        export const S_IFREG: number;

        /** Constant for fs.Stats mode property for determining a file's type. File type constant for a directory. */
        export const S_IFDIR: number;

        /** Constant for fs.Stats mode property for determining a file's type. File type constant for a character-oriented device file. */
        export const S_IFCHR: number;

        /** Constant for fs.Stats mode property for determining a file's type. File type constant for a block-oriented device file. */
        export const S_IFBLK: number;

        /** Constant for fs.Stats mode property for determining a file's type. File type constant for a FIFO/pipe. */
        export const S_IFIFO: number;

        /** Constant for fs.Stats mode property for determining a file's type. File type constant for a symbolic link. */
        export const S_IFLNK: number;

        /** Constant for fs.Stats mode property for determining a file's type. File type constant for a socket. */
        export const S_IFSOCK: number;

        // File Mode Constants

        /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by owner. */
        export const S_IRWXU: number;

        /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by owner. */
        export const S_IRUSR: number;

        /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by owner. */
        export const S_IWUSR: number;

        /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by owner. */
        export const S_IXUSR: number;

        /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by group. */
        export const S_IRWXG: number;

        /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by group. */
        export const S_IRGRP: number;

        /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by group. */
        export const S_IWGRP: number;

        /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by group. */
        export const S_IXGRP: number;

        /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by others. */
        export const S_IRWXO: number;

        /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by others. */
        export const S_IROTH: number;

        /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by others. */
        export const S_IWOTH: number;

        /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by others. */
        export const S_IXOTH: number;
    }

    /** Tests a user's permissions for the file specified by path. */
    export function access(path: string | Buffer, callback: (err: NodeJS.ErrnoException) => void): void;
    export function access(path: string | Buffer, mode: number, callback: (err: NodeJS.ErrnoException) => void): void;
    /** Synchronous version of fs.access. This throws if any accessibility checks fail, and does nothing otherwise. */
    export function accessSync(path: string | Buffer, mode?: number): void;
    export function fdatasync(fd: number, callback: Function): void;
    export function fdatasyncSync(fd: number): void;
}

declare var process: NodeJS.Process;

declare function require(moduleName: string): any;

declare var __dirname: string;

declare module OS {
    export function hostname(): string;
}

declare interface WebSocketConnection {
    url: string;
    state: string;
    remoteAddress: string;

    send(data: any): void;
    close(): void;
    on(event: string, handler: any): void;
}
