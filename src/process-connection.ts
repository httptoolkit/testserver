import * as stream from 'stream';
import * as http from 'http';

const FRAME_HEADER_SIZE = 9;

interface ParsedFrameHeader {
    length: number;
    type: number;
    flags: number;
    streamId: number;
}

function parseFrameHeader(data: Buffer, offset: number): ParsedFrameHeader | null {
    if (offset + FRAME_HEADER_SIZE > data.length) return null;
    return {
        length: (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2],
        type: data[offset + 3],
        flags: data[offset + 4],
        streamId: ((data[offset + 5] & 0x7f) << 24) | (data[offset + 6] << 16) |
                  (data[offset + 7] << 8) | data[offset + 8]
    };
}

interface StreamState {
    callback: ((frame: Buffer) => void) | null;
    buffer: Buffer[];
    stopped: boolean;
}

class DataCapturingStream extends stream.Duplex {
    private readingStarted = false;
    private globalFrames: Buffer[] = [];
    private streams: Map<number, StreamState> = new Map();
    private partialData: Buffer = Buffer.alloc(0);
    private pendingInitialData: Buffer | null = null;

    readonly remoteAddress: string | undefined;
    readonly remotePort: number | undefined;
    readonly localAddress: string | undefined;
    readonly localPort: number | undefined;

    constructor(private wrapped: stream.Duplex, initialData?: Buffer) {
        super();

        this.remoteAddress = (wrapped as any).remoteAddress;
        this.remotePort = (wrapped as any).remotePort;
        this.localAddress = (wrapped as any).localAddress;
        this.localPort = (wrapped as any).localPort;

        wrapped.on('error', (err) => this.emit('error', err));
        wrapped.on('close', () => this.emit('close'));
        wrapped.on('end', () => this.push(null));

        if (initialData) {
            this.processIncomingData(initialData);
            this.pendingInitialData = initialData;
        }
    }

    private processIncomingData(data: Buffer) {
        const fullData = this.partialData.length > 0
            ? Buffer.concat([this.partialData, data])
            : data;

        let offset = 0;

        const HTTP2_PREFACE = 'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n';
        if (offset === 0 && this.globalFrames.length === 0 &&
            fullData.length >= HTTP2_PREFACE.length &&
            fullData.subarray(0, HTTP2_PREFACE.length).toString() === HTTP2_PREFACE) {
            offset = HTTP2_PREFACE.length;
        }

        while (offset < fullData.length) {
            const header = parseFrameHeader(fullData, offset);
            if (!header) break;

            const frameEnd = offset + FRAME_HEADER_SIZE + header.length;
            if (frameEnd > fullData.length) break;

            const frame = fullData.subarray(offset, frameEnd);
            this.routeFrame(header.streamId, Buffer.from(frame));

            offset = frameEnd;
        }

        this.partialData = offset < fullData.length
            ? Buffer.from(fullData.subarray(offset))
            : Buffer.alloc(0);
    }

    private routeFrame(streamId: number, frame: Buffer) {
        if (streamId === 0) {
            this.globalFrames.push(frame);
            for (const state of this.streams.values()) {
                if (state.callback) {
                    const cb = state.callback;
                    setImmediate(() => cb(frame));
                }
            }
        } else {
            let state = this.streams.get(streamId);
            if (!state) {
                state = { callback: null, buffer: [], stopped: false };
                this.streams.set(streamId, state);
            }

            if (state.callback) {
                const cb = state.callback;
                setImmediate(() => cb(frame));
            } else if (!state.stopped) {
                state.buffer.push(frame);
            }
        }
    }

    stopCapturingStream(streamId: number) {
        let state = this.streams.get(streamId);
        if (!state) {
            state = { callback: null, buffer: [], stopped: true };
            this.streams.set(streamId, state);
        } else {
            state.buffer.length = 0;
            state.callback = null;
            state.stopped = true;
        }
    }

    addStreamCallback(streamId: number, callback: (frame: Buffer) => void): {
        globalFrames: Buffer[],
        streamFrames: Buffer[]
    } {
        let state = this.streams.get(streamId);
        if (!state) {
            state = { callback: null, buffer: [], stopped: false };
            this.streams.set(streamId, state);
        }

        state.callback = callback;
        state.stopped = false;

        const result = {
            globalFrames: [...this.globalFrames],
            streamFrames: [...state.buffer]
        };

        state.buffer.length = 0;

        return result;
    }

    removeStreamCallback(streamId: number) {
        this.streams.delete(streamId);
    }

    _read() {
        if (!this.readingStarted) {
            this.readingStarted = true;

            // Push any pending initial data first
            if (this.pendingInitialData) {
                this.push(this.pendingInitialData);
                this.pendingInitialData = null;
            }

            this.wrapped.on('readable', () => {
                let chunk;
                while ((chunk = this.wrapped.read()) !== null) {
                    this.processIncomingData(chunk);
                    this.push(chunk);
                }
            });

            this.wrapped.resume();
        }
    }

    _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        this.wrapped.write(chunk, encoding, callback);
    }

    _final(callback: (error?: Error | null) => void) {
        this.wrapped.end(callback);
    }

    _destroy(error: Error | null, callback: (error?: Error | null) => void) {
        this.wrapped.destroy(error ?? undefined);
        callback(error);
    }
}

// We can recognize TLS very reliably:
const TLS_HANDSHAKE_BYTE = 0x16; // SSLv3+ or TLS handshake
const isTLS = (initialData: Uint8Array) => initialData[0] === TLS_HANDSHAKE_BYTE;

const HTTP2_PREFACE = 'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n';
const HTTP2_PREFACE_BUFFER = Buffer.from(HTTP2_PREFACE);
const HTTP2_PREFACE_LENGTH = HTTP2_PREFACE_BUFFER.byteLength;
const isHTTP2 = (initialData: Uint8Array) => {
    const comparisonLength = Math.min(HTTP2_PREFACE_LENGTH, initialData.length);
    return Buffer.from(initialData.subarray(0, comparisonLength))
        .equals(HTTP2_PREFACE_BUFFER.subarray(0, comparisonLength));
};

// We guess at HTTP by checking the initial bytes match a known HTTP method + following space.
// Not super precise, but generally pretty good (rules out TLS, proxy protocol, etc).
const METHOD_PREFIXES = http.METHODS.map(m => m + ' ');
const LONGEST_PREFIX = Math.max(...METHOD_PREFIXES.map(m => m.length));
const couldBeHttp = (initialData: Buffer) => {
    const initialString = initialData.subarray(0, LONGEST_PREFIX).toString('utf8');
    for (let method of METHOD_PREFIXES) {
        const comparisonLength = Math.min(method.length, initialString.length);
        if (initialString.slice(0, comparisonLength) === method.slice(0, comparisonLength)) {
            return true;
        }
    }
    return false;
};

export type ConnectionHandler = (connection: stream.Duplex) => void;

const connErrorHandler = (err: any) => console.error('Socket error', err);

export class ConnectionProcessor {

    constructor(
        private tlsHandler: ConnectionHandler,
        private httpHandler: ConnectionHandler,
        private http2Handler: ConnectionHandler
    ) {}

    readonly processConnection = (connection: stream.Duplex) => {
        // Ignore all errors - we want to be _very_ cavalier about weird behaviour
        connection.removeListener('error', connErrorHandler); // But watch out for dupes
        connection.on('error', connErrorHandler);

        const initialData: Buffer | null = connection.read();
        if (initialData === null) {
            // Wait until we have more bytes available (at least 3 to differentiate H2 & H1):
            connection.once('readable', () => this.processConnection(connection));
            return;
        }

        if (isTLS(initialData)) {
            connection.unshift(initialData);
            this.tlsHandler(connection);
        } else if (isHTTP2(initialData)) {
            // For HTTP/2, wrap in a capturing stream because http2 module
            // consumes data directly without firing 'data' events
            const wrapper = new DataCapturingStream(connection, initialData);
            this.http2Handler(wrapper);
        } else if (couldBeHttp(initialData)) {
            connection.unshift(initialData);
            // For HTTP/1, set up data capturing on the raw connection
            connection.receivedData = [];
            connection.once('readable', () => {
                connection.on('data', (data) => {
                    connection.receivedData?.push(data);
                });
            });
            connection.pause();
            this.httpHandler(connection);
        } else {
            console.error('Got unrecognized connection data:', initialData);
            connection.destroy();
        }
    }
}