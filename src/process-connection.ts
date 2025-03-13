import * as stream from 'stream';
import * as http from 'http';

// We can recognize TLS very reliably:
const TLS_HANDSHAKE_BYTE = 0x16; // SSLv3+ or TLS handshake
const isTLS = (initialData: Uint8Array) => initialData[0] === TLS_HANDSHAKE_BYTE;

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
        private httpHandler: ConnectionHandler
    ) {}

    readonly processConnection = (connection: stream.Duplex) => {
        // Ignore all errors - we want to be _very_ cavalier about weird behaviour
        connection.removeListener('error', connErrorHandler); // But watch out for dupes
        connection.on('error', connErrorHandler);

        const initialData: Buffer | null = connection.read();
        if (initialData === null) {
            // Wait until this is actually readable
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
        } else if (couldBeHttp(initialData)) {
            // Assume it's otherwise HTTP (for now)
            this.httpHandler(connection);
        } else {
            console.error('Got unrecognized connection data:', initialData);
            connection.destroy();
        }
    }
}