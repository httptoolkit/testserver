import * as tls from 'tls';

import { ConnectionProcessor } from './process-connection.js';

interface TlsHandlerConfig {
    rootDomain: string;
    key: string;
    cert: string;
    ca: string;
    generateCertificate: (domain: string) => {
        key: string,
        cert: string,
        ca?: string
    };
}

const supportedProtocolFilters: { [key: string]: string } = {
    'http2': 'h2',
    'http1': 'http/1.1'
};

const getSNIPrefixParts = (servername: string, rootDomain: string) => {
    const serverNamePrefix = servername.endsWith(rootDomain)
        ? servername.slice(0, -rootDomain.length - 1)
        : servername;
    return serverNamePrefix.split('.');
};

export async function createTlsHandler(
    tlsConfig: TlsHandlerConfig,
    connProcessor: ConnectionProcessor
) {
    const server = tls.createServer({
        key: tlsConfig.key,
        cert: tlsConfig.cert,
        ca: [tlsConfig.ca],

        ALPNCallback: ({ servername, protocols: clientProtocols }) => {
            // If specific protocol(s) are provided as part of the server name,
            // only negotiate those via ALPN.
            const serverNameParts = getSNIPrefixParts(servername, tlsConfig.rootDomain);

            let protocolFilterNames = serverNameParts.filter(protocol =>
                supportedProtocolFilters[protocol]
            );
            const serverProtocols = protocolFilterNames.length > 0
                ? protocolFilterNames.map(protocol => supportedProtocolFilters[protocol])
                : Object.values(supportedProtocolFilters);

            // Follow the clients preferences, within the protocols we support:
            return clientProtocols.find(protocol => serverProtocols.includes(protocol));
        },
        SNICallback: (domain: string, cb: Function) => {
            const serverNameParts = getSNIPrefixParts(domain, tlsConfig.rootDomain);
            if (serverNameParts.includes('no-tls')) {
                // This closes the unwanted TLS connection without response
                return cb(new Error('Intentionally rejecting TLS connection'), null);
            }

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