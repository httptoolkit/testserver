import * as net from 'net';

import {
    readTlsClientHello,
    calculateJa3FromFingerprintData,
    calculateJa4FromHelloData,
    TlsHelloData
} from 'read-tls-client-hello';

import { createHttp1Handler, createHttp2Handler } from './http-handler.js';
import { createTlsHandler } from './tls-handler.js';
import { CertOptions } from './tls-certificates/cert-definitions.js';
import { ConnectionProcessor } from './process-connection.js';

import { AcmeCA, AcmeProvider } from './tls-certificates/acme.js';
import { LocalCA, generateCACertificate } from './tls-certificates/local-ca.js';
import { PersistentCertCache } from './tls-certificates/cert-cache.js';
import { DnsServer } from './dns-server.js';
import { tlsEndpoints } from './endpoints/endpoint-index.js';

declare module 'stream' {
    interface Duplex {
        receivedData?: Buffer[];
        // Pipelining detection: tracks concurrent requests
        requestsInBatch?: number;
        pipelining?: boolean;
        // TLS fingerprint data (set for TLS connections)
        tlsClientHello?: TlsHelloData & {
            ja3: string;
            ja4: string;
        };
    }
}

interface ServerOptions {
    domain?: string;
    acmeProvider?: AcmeProvider;
    acmeAccountKey?: string;
    proactiveCertDomains?: string[];
    certCacheDir?: string;
    localCaKey?: string;
    localCaCert?: string;
    dnsServer?: boolean;
}

function isWildcardCoverable(domain: string, rootDomain: string): boolean {
    if (!domain.endsWith(`.${rootDomain}`)) return false;
    const prefix = domain.slice(0, -rootDomain.length - 1);
    return !prefix.includes('.'); // Single-level subdomain only
}

async function generateTlsConfig(options: ServerOptions) {
    const rootDomain = options.domain ?? 'localhost';

    const certCache = options.certCacheDir
        ? new PersistentCertCache(options.certCacheDir)
        : undefined;

    // Use provided CA key/cert if available, otherwise generate a fresh one
    let caCert: { key: string; cert: string };
    if (options.localCaKey && options.localCaCert) {
        console.log('Using provided local CA certificate');
        caCert = { key: options.localCaKey, cert: options.localCaCert };
    } else {
        console.log('Generating fresh local CA certificate');
        caCert = await generateCACertificate();
    }

    if (certCache) {
        const validSniParts = new Set(tlsEndpoints.map(e => e.sniPart));
        await certCache.loadCache((domain) => { // Temp logic to clean up old cached certs
            // Root domain and wildcard are always valid
            if (domain === rootDomain || domain === `*.${rootDomain}`) return true;

            // Strip root domain suffix to get the prefix
            if (!domain.endsWith(`.${rootDomain}`)) return false;
            const prefix = domain.slice(0, -rootDomain.length - 1);
            if (!prefix) return false;

            // Split by -- or . (same logic as getSNIPrefixParts)
            const parts = prefix.includes('--') ? prefix.split('--') : prefix.split('.');
            return parts.every(part => validSniParts.has(part));
        });
    }

    const localCA = await LocalCA.create(caCert);
    const defaultCert = await localCA.generateCertificate(rootDomain, {});

    if (!options.acmeProvider) {
        console.log('Using self signed certificates');
        return {
            rootDomain,
            key: defaultCert.key,
            cert: defaultCert.cert,
            ca: caCert.cert,
            localCA,
            generateCertificate: async (domain: string, options: CertOptions) => {
                if (options.requiredType === 'acme') {
                    throw new Error(`Can't generate cert for ${domain} without ACME`);
                }

                return await localCA.generateCertificate(domain, options);
            },
            acmeChallenge: () => undefined // Not supported
        };
    }

    console.log(`Using ACME with ${options.acmeProvider} for certificates`);

    if (!options.domain) {
        throw new Error(`Can't enable ACME without configuring a domain (via $ROOT_DOMAIN)`);
    }
    if (!options.certCacheDir || !AcmeCA) {
        throw new Error(`Can't enable ACME without configuring a cert cache directory (via $CERT_CACHE_DIR)`);
    }
    if (!options.acmeAccountKey) {
        throw new Error(`Can't enable ACME without configuring an account key (via $ACME_ACCOUNT_KEY)`);
    }

    // Set up in-process DNS server for wildcard certs via DNS-01 (optional)
    let dnsServer: DnsServer | undefined;

    if (options.dnsServer) {
        // Fly.io requires UDP to bind to 'fly-global-services' instead of 0.0.0.0
        const dnsBindAddress = process.env.FLY_APP_NAME ? 'fly-global-services' : '0.0.0.0';
        dnsServer = new DnsServer(53, dnsBindAddress);
        await dnsServer.listen();
    }

    const acmeCA = new AcmeCA(certCache!, options.acmeProvider, options.acmeAccountKey, dnsServer);
    acmeCA.tryGetCertificateSync(rootDomain, {}); // Preload the root domain every time

    return {
        rootDomain,
        proactiveCertDomains: options.proactiveCertDomains,
        key: defaultCert.key,
        cert: defaultCert.cert,
        ca: caCert.cert,
        localCA,
        generateCertificate: async (domain: string, certOptions: CertOptions) => {
            if (certOptions.requiredType === 'local') {
                return await localCA.generateCertificate(domain, certOptions);
            }

            // Use wildcard when: DNS server available, single-level subdomain, no overridePrefix
            const useWildcard = dnsServer
                && isWildcardCoverable(domain, rootDomain)
                && !certOptions.overridePrefix;

            const effectiveDomain = useWildcard ? `*.${rootDomain}` : domain;

            const cert = acmeCA.tryGetCertificateSync(effectiveDomain, certOptions);

            if (cert) {
                return cert;
            } else {
                if (certOptions.requiredType === 'acme') {
                    return await acmeCA.waitForCertificate(effectiveDomain, certOptions);
                }
                // Local CA fallback while ACME cert is pending - mark as temporary
                // so it gets a short cache time and ACME cert is used once available
                const fallbackCert = await localCA.generateCertificate(domain, certOptions);
                return { ...fallbackCert, isTemporary: true };
            }
        },
        acmeChallenge: (token: string) => acmeCA.getChallengeResponse(token)
    }
}

const createTcpHandler = async (options: ServerOptions = {}) => {
    const connProcessor = new ConnectionProcessor(
        async (conn) => {
            // Read and store TLS fingerprint before TLS handshake
            try {
                const helloData = await readTlsClientHello(conn);
                conn.tlsClientHello = {
                    ...helloData,
                    ja3: calculateJa3FromFingerprintData(helloData.fingerprintData),
                    ja4: calculateJa4FromHelloData(helloData)
                };
            } catch (e) {
                // Non-TLS traffic or malformed client hello - continue without fingerprint
            }
            conn.pause();
            tlsHandler.handleConnection(conn);
        },
        (conn) => httpHandler.emit('connection', conn),
        (conn) => http2Handler.emit('connection', conn)
    );

    const tlsConfig = await generateTlsConfig(options);
    const tlsHandler = await createTlsHandler(tlsConfig, connProcessor);

    const httpConfig = {
        acmeChallengeCallback: tlsConfig.acmeChallenge,
        rootDomain: options.domain ?? 'localhost'
    };

    const httpHandler = createHttp1Handler(httpConfig);
    const http2Handler = createHttp2Handler(httpConfig);

    return (conn: net.Socket) => {
        try {
            connProcessor.processConnection(conn);
        } catch (e: any) {
            console.error(e);
            conn.destroy();
        }
    };
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

    createTcpHandler({
        domain: process.env.ROOT_DOMAIN,
        proactiveCertDomains: process.env.PROACTIVE_CERT_DOMAINS?.split(','),
        acmeProvider: process.env.ACME_PROVIDER as AcmeProvider | undefined,
        acmeAccountKey: process.env.ACME_ACCOUNT_KEY,
        certCacheDir: process.env.CERT_CACHE_DIR,
        localCaKey: process.env.LOCAL_CA_KEY,
        localCaCert: process.env.LOCAL_CA_CERT,
        dnsServer: process.env.DNS_SERVER === 'true'
    }).then((tcpHandler) => {
        ports.forEach((port) => {
            const server = createTcpServer(tcpHandler);
            server.listen(port, () => {
                console.log(`Testserver listening on port ${port}`);
            });
        });
    });
}