import * as tls from 'tls';
import * as crypto from 'node:crypto';
import * as stream from 'stream';
import { EventEmitter } from 'events';

import { ConnectionProcessor } from './process-connection.js';
import { LocalCA } from './tls-certificates/local-ca.js';
import { CertOptions, calculateCertCacheKey } from './tls-certificates/cert-definitions.js';
import { SecureContextCache } from './tls-certificates/secure-context-cache.js';
import { tlsEndpoints } from './endpoints/endpoint-index.js';
import { ErrorLike } from '@httptoolkit/util';

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

export type GeneratedCertificate = {
    key: string,
    cert: string,
    ca?: string,
    /** If true, this is a temporary fallback cert, while ACME does its work */
    isTemporary?: boolean
};

export type CertGenerator = (domain: string, certOptions: CertOptions) => Promise<GeneratedCertificate>;

interface TlsHandlerConfig {
    rootDomain: string;
    proactiveCertDomains?: string[];

    key: string;
    cert: string;
    ca: string;
    generateCertificate: CertGenerator;
    localCA: LocalCA;
}

const DEFAULT_ALPN_PROTOCOLS = ['http/1.1', 'h2'];

const getSNIPrefixParts = (servername: string, rootDomain: string) => {
    const serverNamePrefix = servername.endsWith(rootDomain)
        ? servername.slice(0, -rootDomain.length - 1)
        : servername;

    if (serverNamePrefix === '') return [];

    // Support both -- (preferred, single-level subdomain) and . (legacy, multi-level)
    if (serverNamePrefix.includes('--')) {
        return serverNamePrefix.split('--');
    }
    return serverNamePrefix.split('.');
};

const MAX_SNI_PARTS = 4;

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

class TlsConnectionHandler {
    
    // To keep Node happy, we need a TLS server attached to our sockets in some cases
    // to enable some features (like OCSP). This'll do:
    private ocspServer = new EventEmitter();

    constructor(
        private tlsConfig: TlsHandlerConfig,
        private connProcessor: ConnectionProcessor
    ) {
        this.ocspServer.on('OCSPRequest', async (
            certificate: Buffer,
            _issuer: Buffer,
            callback: (err: Error | null, response: Buffer) => void
        ) => {
            try {
                const ocspResponse = await this.tlsConfig.localCA!.getOcspResponse(certificate);
                if (ocspResponse) {
                    callback(null, ocspResponse);
                } else {
                    callback(null, Buffer.alloc(0));
                }
            } catch (e) {
                console.error('OCSP response generation error', e);
                callback(null, Buffer.alloc(0));
            }
        });
    }

    async handleConnection(rawSocket: stream.Duplex) {
        try {
            const serverName = rawSocket.tlsClientHello?.serverName;
            const domain = serverName || this.tlsConfig.rootDomain;

            const serverNameParts = getSNIPrefixParts(domain, this.tlsConfig.rootDomain);

            if (serverNameParts.length > MAX_SNI_PARTS) {
                console.error(`Too many SNI parts (${serverNameParts.length})`);
                rawSocket.destroy();
                return;
            }

            const uniqueParts = new Set(serverNameParts);
            if (uniqueParts.size !== serverNameParts.length) {
                console.error(`Duplicate SNI parts in '${domain}'`);
                rawSocket.destroy();
                return;
            }

            const { certOptions, tlsOptions, alpnPreferences } = getEndpointConfig(serverNameParts);

            const certDomain = certOptions.overridePrefix
                ? `${certOptions.overridePrefix}.${this.tlsConfig.rootDomain}`
                : domain;

            const cacheKey = calculateContextCacheKey(certDomain, certOptions, tlsOptions);

            const secureContext = await secureContextCache.getOrCreate(cacheKey, async () => {
                const cert = await this.tlsConfig.generateCertificate(certDomain, certOptions);
                return {
                    context: tls.createSecureContext({
                        key: cert.key,
                        cert: cert.cert,
                        ca: cert.ca,
                        ...tlsOptions
                    }),
                    // Temporary certs (e.g. local CA fallback while ACME pending) get short cache
                    // to allow the real cert to be picked up once available
                    expiry: cert.isTemporary
                        ? Date.now() + 5000
                        : getCertExpiry(cert.cert)
                };
            });

            const alpnProtocols = alpnPreferences.length > 0
                ? alpnPreferences
                : DEFAULT_ALPN_PROTOCOLS;

            // Check if client requested OCSP stapling (extension 5 = status_request)
            const clientExtensions = rawSocket.tlsClientHello?.fingerprintData?.[2];
            const clientRequestedOCSP = clientExtensions?.includes(5) ?? false;

            const tlsSocket = new tls.TLSSocket(rawSocket, {
                isServer: true,
                secureContext,
                ALPNProtocols: alpnProtocols,
                // Only set up OCSP machinery if client requested it
                ...(clientRequestedOCSP ? {
                    server: this.ocspServer as tls.Server,
                    // Stub SNICallback to works around a Node limitation where non-server TLS
                    // sockets don't call OCSPRequest in most cases.
                    SNICallback: (
                        _servername: string,
                        callback: (err: Error | null, ctx?: tls.SecureContext) => void
                    ) => callback(null, secureContext)
                } : {})
            });

            // Transfer tlsClientHello metadata
            if (rawSocket.tlsClientHello) {
                tlsSocket.tlsClientHello = rawSocket.tlsClientHello;
            }

            tlsSocket.on('secure', () => {
                this.connProcessor.processConnection(tlsSocket);
            });

            tlsSocket.on('error', (err: ErrorLike) => {
                // Expected errors during handshake (version mismatch, etc.)
                if (err.code !== 'ECONNRESET') {
                    console.error('TLS socket error:', err.message);
                }
            });
        } catch (e) {
            console.error('TLS setup error', e);
            rawSocket.destroy();
        }
    }
}

export async function createTlsHandler(
    tlsConfig: TlsHandlerConfig,
    connProcessor: ConnectionProcessor
) {
    const handler = new TlsConnectionHandler(tlsConfig, connProcessor);
    proactivelyRefreshDomains(tlsConfig.rootDomain, tlsConfig.proactiveCertDomains ?? [], tlsConfig.generateCertificate);
    return handler;
}
