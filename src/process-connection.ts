import * as stream from 'stream';

const TLS_HANDSHAKE_BYTE = 0x16; // SSLv3+ or TLS handshake
const isTLS = (initialData: Uint8Array) => initialData[0] === TLS_HANDSHAKE_BYTE;

export type ConnectionHandler = (connection: stream.Duplex) => void;

export class ConnectionProcessor {

    constructor(
        private tlsHandler: ConnectionHandler,
        private httpHandler: ConnectionHandler
    ) {}

    readonly processConnection = (connection: stream.Duplex) => {
        const initialData = connection.read();
        if (initialData === null) {
            // Wait until this is actually readable
            connection.once('readable', () => this.processConnection(connection));
            return;
        } else {
            connection.unshift(initialData);
        }

        // Buffer all input on this stream in case we need to e.g. echo it later:
        connection.receivedData = [];
        connection.on('data', (data) => {
            connection.receivedData?.push(data);
        });

        // Ignore all errors - we want to be _very_ cavalier about weird behaviour
        connection.on('error', (err) => console.error('TCP socket error', err));

        // This turns an abrupt-close into a clean shutdown from the POV of the duplex
        // stream on top, which avoids a ERR_STREAM_PREMATURE_CLOSE there.
        connection.on('close', () => {
            connection.end();
            connection.push(null);
        });

        // Wrap the connection in a duplex stream, so that we can read the receivedData
        // without draining the stream that's being read elsewhere, and to avoid native
        // socket short-circuit logic which seems to kick in and cause issues in some cases:
        const duplex = stream.Duplex.from({ writable: connection, readable: connection });
        duplex.receivedData = connection.receivedData;
        duplex.on('error', () => {}); // Still don't care - logged above

        if (isTLS(initialData)) {
            this.tlsHandler(duplex);
        } else {
            // Assume it's otherwise HTTP (for now)
            this.httpHandler(duplex);
        }
    }
}