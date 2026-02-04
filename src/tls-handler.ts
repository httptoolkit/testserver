import * as tls from 'tls';

import { ConnectionProcessor } from './process-connection.js';
import { LocalCA } from './tls-certificates/local-ca.js';
import { CertOptions } from './tls-certificates/cert-definitions.js';
import { tlsEndpoints } from './endpoints/endpoint-index.js';

export type CertGenerator = (domain: string, certOptions: CertOptions) => Promise<{
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

const getSNIPrefixParts = (servername: string, rootDomain: string) => {
    const serverNamePrefix = servername.endsWith(rootDomain)
        ? servername.slice(0, -rootDomain.length - 1)
        : servername;

    if (serverNamePrefix === '') return [];
    return serverNamePrefix.split('.');
};

const MAX_SNI_PARTS = 3;

const PROACTIVE_DOMAIN_REFRESH_INTERVAL = 1000 * 60 * 60 * 24; // Daily cert check for proactive domains

function proactivelyRefreshDomains(rootDomain: string, domains: string[], certGenerator: CertGenerator) {
    domains.forEach(domain => {
        const serverNameParts = getSNIPrefixParts(domain, rootDomain);

        const endpoints = getEndpoints(serverNameParts);
        let certOptions: CertOptions = {};
        for (let endpoint of endpoints) {
            certOptions = Object.assign(certOptions, endpoint.configureCertOptions?.());
        }

        console.log(`Proactively checking cert at startup for ${domain}`);
        certGenerator(domain, certOptions).catch(e => console.error(`Failed to generate cert for ${domain}:`, e));

        setInterval(() => {
            console.log(`Proactively checking cert for ${domain}`);
            certGenerator(domain, certOptions).catch(e => console.error(`Failed to generate cert for ${domain}:`, e));
        }, PROACTIVE_DOMAIN_REFRESH_INTERVAL);
    });
}

function getEndpoints(serverNameParts: string[]) {
    return serverNameParts.map((part) => {
        const endpoint = tlsEndpoints.find(e => e.sniPart === part)
        if (!endpoint) {
            throw new Error(`Unknown SNI part ${part}`);
        }
        return endpoint;
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
            const endpoints = getEndpoints(serverNameParts);

            let alpnPreferences: string[] = [];
            for (let endpoint of endpoints) {
                alpnPreferences = endpoint.configureAlpnPreferences?.(alpnPreferences) ?? alpnPreferences;
            }

            if (alpnPreferences.length === 0) {
                alpnPreferences = DEFAULT_ALPN_PROTOCOLS;
            }

            // Enforce our own protocol preference over the client's (they can
            // specify a preference via SNI, if they so choose). This also means
            // we accept a preference order in our SNI as well e.g. http2.http1.*.
            return alpnPreferences.find(protocol => clientProtocols.includes(protocol));
        },
        SNICallback: async (domain: string, cb: Function) => {
            try {
                const serverNameParts = getSNIPrefixParts(domain, tlsConfig.rootDomain);

                if (serverNameParts.length > MAX_SNI_PARTS) {
                    return cb(new Error(`Too many SNI parts (${serverNameParts.length})`), null);
                }

                const uniqueParts = new Set(serverNameParts);
                if (uniqueParts.size !== serverNameParts.length) {
                    return cb(new Error(`Duplicate SNI parts in '${domain}'`), null);
                }

                const endpoints = getEndpoints(serverNameParts);

                let certOptions: CertOptions = {};
                let tlsOptions: tls.SecureContextOptions = {};
                for (let endpoint of endpoints) {
                    // Cert options are merged together directly:
                    certOptions = Object.assign(certOptions, endpoint.configureCertOptions?.());

                    // TLS options may be combined in more clever ways:
                    tlsOptions = endpoint.configureTlsOptions?.(tlsOptions) ?? tlsOptions;
                }

                const certDomain = (certOptions.overridePrefix)
                    ? `${certOptions.overridePrefix}.${tlsConfig.rootDomain}`
                    : domain;

                const generatedCert = await tlsConfig.generateCertificate(certDomain, certOptions);

                cb(null, tls.createSecureContext({
                    key: generatedCert.key,
                    cert: generatedCert.cert,
                    ca: generatedCert.ca,
                    ...tlsOptions
                }));
            } catch (e) {
                console.error('TLS setup error', e);
                cb(e);
            }
        }
    });

    proactivelyRefreshDomains(tlsConfig.rootDomain, tlsConfig.proactiveCertDomains ?? [], tlsConfig.generateCertificate);

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