import * as tls from 'tls';

import { ConnectionProcessor } from './process-connection.js';
import { LocalCA } from './tls-certificates/local-ca.js';

export const CERT_MODES = ['wrong-host', 'self-signed', 'expired', 'revoked'] as const;
export type CertMode = typeof CERT_MODES[number];

// Modes that require special certificate generation (vs just domain remapping)
const CERT_GENERATION_MODES = new Set<CertMode>(['self-signed', 'expired', 'revoked']);

export type CertGenerator = (domain: string, mode?: CertMode) => Promise<{
    key: string,
    cert: string,
    ca?: string
}>;

interface TlsHandlerConfig {
    rootDomain: string;
    proactiveCertDomains?: string[];

    key: string;
    cert: string;
    ca: string;
    generateCertificate: CertGenerator;
    localCA?: LocalCA;
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

    if (serverNamePrefix === '') return [];
    return serverNamePrefix.split('.');
};

const CERT_MODE_SET = new Set<string>(CERT_MODES);

const VALID_SNI_PARTS = new Set([
    ...Object.keys(SNI_PROTOCOL_FILTERS),
    'no-tls',
    'example',
    ...CERT_MODES
]);

const MAX_SNI_PARTS = 3;

const PROACTIVE_DOMAIN_REFRESH_INTERVAL = 1000 * 60 * 60 * 24; // Daily cert check for proactive domains

function proactivelyRefreshDomains(domains: string[], certGenerator: CertGenerator) {
    domains.forEach(domain => {
        console.log(`Proactively checking cert at startup for ${domain}`);
        certGenerator(domain).catch(e => console.error(`Failed to generate cert for ${domain}:`, e));

        setInterval(() => {
            console.log(`Proactively checking cert for ${domain}`);
            certGenerator(domain).catch(e => console.error(`Failed to generate cert for ${domain}:`, e));
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
        SNICallback: async (domain: string, cb: Function) => {
            try {
                const serverNameParts = getSNIPrefixParts(domain, tlsConfig.rootDomain);

                if (serverNameParts.length > MAX_SNI_PARTS) {
                    return cb(new Error(`Too many SNI parts (${serverNameParts.length})`), null);
                }

                if (serverNameParts.some(part => !VALID_SNI_PARTS.has(part))) {
                    return cb(new Error(`Invalid SNI part in '${domain}'`), null);
                }

                const uniqueParts = new Set(serverNameParts);
                if (uniqueParts.size !== serverNameParts.length) {
                    return cb(new Error(`Duplicate SNI parts in '${domain}'`), null);
                }

                if (serverNameParts.includes('no-tls')) {
                    return cb(new Error('Intentionally rejecting TLS connection'), null);
                }

                const certModeParts = serverNameParts.filter(part => CERT_MODE_SET.has(part)) as CertMode[];
                if (certModeParts.length > 1) {
                    return cb(new Error(`Multiple cert modes not yet supported: ${certModeParts.join(', ')}`), null);
                }

                let certDomain = domain;
                if (certModeParts.includes('wrong-host')) {
                    certDomain = `example.${tlsConfig.rootDomain}`;
                }

                const generationMode = certModeParts.find(mode => CERT_GENERATION_MODES.has(mode));

                const generatedCert = await tlsConfig.generateCertificate(certDomain, generationMode);
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

    // Copy TLS fingerprint from underlying socket to TLS socket
    server.prependListener('secureConnection', (tlsSocket) => {
        const parent = (tlsSocket as any)._parent;
        if (parent?.tlsClientHello) {
            (tlsSocket as any).tlsClientHello = parent.tlsClientHello;
        }
    });
    
    // Handle OCSP stapling requests
    if (tlsConfig.localCA) {
        server.on('OCSPRequest', async (cert, issuer, callback) => {
            try {
                const ocspResponse = await tlsConfig.localCA!.getOcspResponse(cert);
                if (ocspResponse) {
                    callback(null, ocspResponse);
                } else {
                    // No OCSP response available - don't staple anything
                    callback(null, Buffer.alloc(0));
                }
            } catch (e) {
                console.error('OCSP response generation error', e);
                callback(null, Buffer.alloc(0));
            }
        });
    }

    server.on('secureConnection', (socket) => {
        connProcessor.processConnection(socket);
    });

    return server;
}