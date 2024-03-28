import * as stream from 'stream';

const TLS_HANDSHAKE_BYTE = 0x16; // SSLv3+ or TLS handshake
const isTLS = (initialData: Uint8Array) => initialData[0] === TLS_HANDSHAKE_BYTE;

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
        connection.once('readable', () => {
            connection.on('data', (data) => {
                connection.receivedData?.push(data);
            });
        });
        connection.pause();

        if (isTLS(initialData)) {
            this.tlsHandler(connection);
        } else {
            // Assume it's otherwise HTTP (for now)
            this.httpHandler(connection);
        }
    }
}