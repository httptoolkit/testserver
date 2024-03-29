import * as tls from 'tls';

import { ConnectionProcessor } from './process-connection.js';

interface TlsHandlerConfig {
    key: string;
    cert: string;
    ca: string;
    generateCertificate: (domain: string) => {
        key: string,
        cert: string,
        ca?: string
    };
}

export async function createTlsHandler(
    tlsConfig: TlsHandlerConfig,
    connProcessor: ConnectionProcessor
) {
    const server = tls.createServer({
        key: tlsConfig.key,
        cert: tlsConfig.cert,
        ca: [tlsConfig.ca],
        SNICallback: (domain: string, cb: Function) => {
            try {
                const generatedCert = tlsConfig.generateCertificate(domain);
                cb(null, tls.createSecureContext({
                    key: generatedCert.key,
                    cert: generatedCert.cert,
                    ca: generatedCert.ca
                }));
            } catch (e) {
                console.error('Cert generation error', e);
                cb(e);
            }
        }
    });

    server.on('secureConnection', (socket) => {
        connProcessor.processConnection(socket);
    });

    return server;
}