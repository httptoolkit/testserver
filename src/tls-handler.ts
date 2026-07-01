import * as tls from 'tls';
import * as net from 'net';
import * as crypto from 'node:crypto';
import * as stream from 'stream';
import { EventEmitter } from 'events';

import { ErrorLike } from '@httptoolkit/util';
import { getExtensionData } from 'read-tls-client-hello';

import { ConnectionProcessor } from './process-connection.js';
import { LocalCA } from './tls-certificates/local-ca.js';
import { CertOptions, calculateCertCacheKey, extractLeafCertificate } from './tls-certificates/cert-definitions.js';
import { SecureContextCache } from './tls-certificates/secure-context-cache.js';
import { getSNIPrefixParts, getEndpointConfig } from './endpoints/endpoint-config.js';
import { PROXY_PROTOCOL } from './proxy-protocol.js';
import { TLS_CLIENT_HELLO } from './tls-client-hello.js';
import { tlsConnectionsTotal } from './metrics.js';

const secureContextCache = new SecureContextCache();

function calculateContextCacheKey(
    domain: string,
    certOptions: CertOptions,
    tlsOptions: tls.SecureContextOptions
): string {
    const certKey = calculateCertCacheKey(domain, certOptions);
    const chainKey = certOptions.incompleteChain ? '|incomplete-chain' : '';
    const tlsKey = Object.keys(tlsOptions).length > 0
        ? '|' + JSON.stringify(tlsOptions, Object.keys(tlsOptions).sort())
        : '';
    return certKey + chainKey + tlsKey;
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
            const tlsClientHello = rawSocket[TLS_CLIENT_HELLO];
            const serverName = tlsClientHello
                ? getExtensionData(tlsClientHello, 'sni')?.serverName
                : undefined;
            const domain = serverName || this.tlsConfig.rootDomain;

            const serverNameParts = getSNIPrefixParts(domain, this.tlsConfig.rootDomain);

            // This validates the whole SNI combination & throws if invalid/unknown/etc
            const { certOptions, tlsOptions, alpnPreferences, rejectTls, requireClientCert } = getEndpointConfig(serverNameParts);

            // Endpoints like no-tls intentionally refuse the handshake.
            if (rejectTls) {
                rawSocket.destroy();
                return;
            }

            const certDomain = certOptions.overridePrefix
                ? `${certOptions.overridePrefix}.${this.tlsConfig.rootDomain}`
                : domain;

            const cacheKey = calculateContextCacheKey(certDomain, certOptions, tlsOptions)
                + (requireClientCert ? '|client-cert' : '');

            const secureContext = await secureContextCache.getOrCreate(cacheKey, async () => {
                const cert = await this.tlsConfig.generateCertificate(certDomain, certOptions);

                const servedCert = certOptions.incompleteChain
                    ? extractLeafCertificate(cert.cert)
                    : cert.cert;

                const clientAuthCa = requireClientCert
                    ? await this.tlsConfig.localCA.getClientAuthCaCertPem()
                    : undefined;

                return {
                    context: tls.createSecureContext({
                        key: cert.key,
                        cert: servedCert,
                        ...(requireClientCert ? { ca: clientAuthCa } : {}),
                        ...tlsOptions
                    }),
                    // Temporary certs (e.g. local CA fallback while ACME pending) get short cache
                    // to allow the real cert to be picked up once available
                    expiry: cert.isTemporary
                        ? Date.now() + 5000
                        : getCertExpiry(servedCert)
                };
            });

            const alpnProtocols = alpnPreferences.length > 0
                ? alpnPreferences
                : DEFAULT_ALPN_PROTOCOLS;

            // Check if client requested OCSP stapling (extension 5 = status_request)
            const clientRequestedOCSP = tlsClientHello
                ? !!getExtensionData(tlsClientHello, 'status_request')
                : false;

            const tlsSocket = new tls.TLSSocket(rawSocket, {
                isServer: true,
                secureContext,
                ALPNProtocols: alpnProtocols,
                ...(requireClientCert ? { requestCert: true, rejectUnauthorized: true } : {}),
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

            // Transfer metadata from raw socket to TLS socket
            if (rawSocket[TLS_CLIENT_HELLO]) {
                tlsSocket[TLS_CLIENT_HELLO] = rawSocket[TLS_CLIENT_HELLO];
            }
            if (rawSocket[PROXY_PROTOCOL]) {
                tlsSocket[PROXY_PROTOCOL] = rawSocket[PROXY_PROTOCOL];
            }
            tlsSocket.underlyingSocket = rawSocket instanceof net.Socket
                ? rawSocket
                : rawSocket.underlyingSocket;

            tlsSocket.on('secure', () => {
                const endpointLabel = serverNameParts.length > 0
                    ? serverNameParts.join('--')
                    : 'default';
                tlsConnectionsTotal.inc({ endpoint: endpointLabel });
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
