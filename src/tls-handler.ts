import * as tls from 'tls';
import * as crypto from 'node:crypto';

import { ConnectionProcessor } from './process-connection.js';
import { LocalCA } from './tls-certificates/local-ca.js';
import { CertOptions, calculateCertCacheKey } from './tls-certificates/cert-definitions.js';
import { SecureContextCache } from './tls-certificates/secure-context-cache.js';
import { tlsEndpoints } from './endpoints/endpoint-index.js';

const secureContextCache = new SecureContextCache();

function calculateContextCacheKey(
    domain: string,
    certOptions: CertOptions,
    tlsOptions: tls.SecureContextOptions
): string {
    const certKey = calculateCertCacheKey(domain, certOptions);
    const tlsKey = Object.keys(tlsOptions).length > 0
        ? '|' + JSON.stringify(tlsOptions, Object.keys(tlsOptions).sort())
        : '';
    return certKey + tlsKey;
}

function getCertExpiry(certPem: string): number {
    const cert = new crypto.X509Certificate(certPem);
    return new Date(cert.validTo).getTime();
}

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
    for (const domain of domains) {
        const { certOptions } = getEndpointConfig(getSNIPrefixParts(domain, rootDomain));

        const refresh = () => {
            console.log(`Proactively checking cert for ${domain}`);
            certGenerator(domain, certOptions).catch(e =>
                console.error(`Failed to generate cert for ${domain}:`, e)
            );
        };

        refresh();
        setInterval(refresh, PROACTIVE_DOMAIN_REFRESH_INTERVAL);
    }
}

function getEndpointConfig(serverNameParts: string[]) {
    let certOptions: CertOptions = {};
    let tlsOptions: tls.SecureContextOptions = {};
    let alpnPreferences: string[] = [];

    for (const part of serverNameParts) {
        const endpoint = tlsEndpoints.find(e => e.sniPart === part);
        if (!endpoint) {
            throw new Error(`Unknown SNI part ${part}`);
        }
        certOptions = Object.assign(certOptions, endpoint.configureCertOptions?.());
        tlsOptions = endpoint.configureTlsOptions?.(tlsOptions) ?? tlsOptions;
        alpnPreferences = endpoint.configureAlpnPreferences?.(alpnPreferences) ?? alpnPreferences;
    }

    return { certOptions, tlsOptions, alpnPreferences };
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
            const { alpnPreferences } = getEndpointConfig(getSNIPrefixParts(servername, tlsConfig.rootDomain));
            const protocols = alpnPreferences.length > 0 ? alpnPreferences : DEFAULT_ALPN_PROTOCOLS;
            // Enforce our own preference order (client can specify via SNI e.g. http2.http1.*)
            return protocols.find(p => clientProtocols.includes(p));
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

                const { certOptions, tlsOptions } = getEndpointConfig(serverNameParts);

                const certDomain = certOptions.overridePrefix
                    ? `${certOptions.overridePrefix}.${tlsConfig.rootDomain}`
                    : domain;

                const cacheKey = calculateContextCacheKey(certDomain, certOptions, tlsOptions);

                const secureContext = await secureContextCache.getOrCreate(cacheKey, async () => {
                    const cert = await tlsConfig.generateCertificate(certDomain, certOptions);
                    return {
                        context: tls.createSecureContext({
                            key: cert.key,
                            cert: cert.cert,
                            ca: cert.ca,
                            ...tlsOptions
                        }),
                        expiry: getCertExpiry(cert.cert)
                    };
                });

                cb(null, secureContext);
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