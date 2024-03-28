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

const createServer = async (options: ServerOptions = {}) => {
    const connProcessor = new ConnectionProcessor(
        (conn) => tlsHandler.emit('connection', conn),
        (conn) => httpHandler.emit('connection', conn)
    );

    const tcpServer = net.createServer();
    const httpHandler = createHttpHandler();

    const tlsConfig = await generateTlsConfig(options);
    const tlsHandler = await createTlsHandler(tlsConfig, connProcessor);

    tcpServer.on('connection', (conn) => connProcessor.processConnection(conn));
    tcpServer.on('error', (err) => console.error('TCP server error', err));

    return tcpServer;
};

export { createServer };

// This is not a perfect test (various odd cases) but good enough
const wasRunDirectly = import.meta.filename === process?.argv[1];
if (wasRunDirectly) {
    const port = process.env.PORT ?? 3000;

    const domain = process.env.ROOT_DOMAIN;

    createServer({ domain }).then((server) => {
        server.listen(port, () => {
            console.log(`Testserver listening on port ${port}`);
        });
    });
}