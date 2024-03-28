import * as net from 'net';

import { createHttpHandler } from './http-handler.js';
import { createTlsHandler } from './tls-handler.js';
import { LocalCA, generateCACertificate } from './local-ca.js';
import { ConnectionProcessor } from './process-connection.js';

declare module 'stream' {
    interface Duplex {
        receivedData?: Buffer[];
    }
}


interface ServerOptions {
    domain?: string;
}

async function generateTlsConfig(options: ServerOptions) {
    const caCert = await generateCACertificate();

    const ca = new LocalCA(caCert);

    const defaultCert = ca.generateCertificate(options.domain ?? 'localhost');

    return {
        key: defaultCert.key,
        cert: defaultCert.cert,
        ca: caCert.cert,
        generateCertificate: (domain: string) => ca.generateCertificate(domain)
    };
}

const createTcpHandler = async (options: ServerOptions = {}) => {
    const connProcessor = new ConnectionProcessor(
        (conn) => tlsHandler.emit('connection', conn),
        (conn) => httpHandler.emit('connection', conn)
    );

    const tcpServer = net.createServer();
    const httpHandler = createHttpHandler();

    const tlsConfig = await generateTlsConfig(options);
    const tlsHandler = await createTlsHandler(tlsConfig, connProcessor);

    return (conn: net.Socket) => connProcessor.processConnection(conn);
};

function createTcpServer(handler: (conn: net.Socket) => void) {
    const server = net.createServer(handler);
    server.on('error', (err) => console.log('TCP server error', err));
    return server;
}

export async function createServer(options: ServerOptions = {}) {
    const tcpHandler = await createTcpHandler(options as ServerOptions);
    return createTcpServer(tcpHandler);
}

// This is not a perfect test (various odd cases) but good enough
const wasRunDirectly = import.meta.filename === process?.argv[1];
if (wasRunDirectly) {
    const ports = process.env.PORTS?.split(',') ?? [3000];

    const domain = process.env.ROOT_DOMAIN;

    createTcpHandler({ domain }).then((tcpHandler) => {
        ports.forEach((port) => {
            const server = createTcpServer(tcpHandler);
            server.listen(port, () => {
                console.log(`Testserver listening on port ${port}`);
            });
        });
    });
}