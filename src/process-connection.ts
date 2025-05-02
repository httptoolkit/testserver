import * as stream from 'stream';
import * as http from 'http';

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
        } else {
            connection.unshift(initialData);
        }

        // Buffer all input on this stream in case we need to e.g. echo it later:
        connection.receivedData = [];
        connection.once('readable', () => {
            connection.on('data', (data) => {
                connection.receivedData?.push(data);
            });
        });
        connection.pause();

        if (isTLS(initialData)) {
            this.tlsHandler(connection);
        } else if (isHTTP2(initialData)) {
            this.http2Handler(connection);
        } else if (couldBeHttp(initialData)) {
            this.httpHandler(connection);
        } else {
            console.error('Got unrecognized connection data:', initialData);
            connection.destroy();
        }
    }
}