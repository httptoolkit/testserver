import * as tls from 'tls';

import { ConnectionProcessor } from './process-connection.js';

type CertGenerator = (domain: string) => {
    key: string,
    cert: string,
    ca?: string
};

interface TlsHandlerConfig {
    rootDomain: string;
    proactiveCertDomains?: string[];

    key: string;
    cert: string;
    ca: string;
    generateCertificate: CertGenerator;
}

const DEFAULT_ALPN_PROTOCOLS = ['http/1.1', 'h2'];
const SNI_PROTOCOL_FILTERS: { [key: string]: string } = {
    'http2': 'h2',
    'http1': 'http/1.1'
};

const getSNIPrefixParts = (servername: string, rootDomain: string) => {
    const serverNamePrefix = servername.endsWith(rootDomain)
        ? servername.slice(0, -rootDomain.length - 1)
        : servername;
    return serverNamePrefix.split('.');
};

const PROACTIVE_DOMAIN_REFRESH_INTERVAL = 1000 * 60 * 60 * 24; // Daily cert check for proactive domains

function proactivelyRefreshDomains(domains: string[], certGenerator: CertGenerator) {
    domains.forEach(domain => {
        console.log(`Proactively checking cert at startup for ${domain}`);
        certGenerator(domain);

        setInterval(() => {
            console.log(`Proactively checking cert for ${domain}`);
            certGenerator(domain);
        }, PROACTIVE_DOMAIN_REFRESH_INTERVAL);
    });
}

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
                SNI_PROTOCOL_FILTERS[protocol]
            );
            const serverProtocols = protocolFilterNames.length > 0
                ? protocolFilterNames.map(protocol => SNI_PROTOCOL_FILTERS[protocol])
                : DEFAULT_ALPN_PROTOCOLS;

            // Enforce our own protocol preference over the client's (they can
            // specify a preference via SNI, if they so choose). This also means
            // we accept a preference order in our SNI as well e.g. http2.http1.*.
            return serverProtocols.find(protocol => clientProtocols.includes(protocol));
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

    proactivelyRefreshDomains(tlsConfig.proactiveCertDomains ?? [], tlsConfig.generateCertificate);

    server.on('secureConnection', (socket) => {
        connProcessor.processConnection(socket);
    });

    return server;
}