import * as net from 'net';

import {
    readTlsClientHello,
    calculateJa3,
    calculateJa4,
} from 'read-tls-client-hello';

import { createHttp1Handler, createHttp2Handler } from './http-handler.js';
import { createTlsHandler } from './tls-handler.js';
import { CertOptions } from './tls-certificates/cert-definitions.js';
import { ConnectionProcessor } from './process-connection.js';
import { PROXY_PROTOCOL, type ProxyProtocolData } from './proxy-protocol.js';
import { TLS_CLIENT_HELLO, type TlsClientHelloData } from './tls-client-hello.js';

import { AcmeCA, AcmeProvider } from './tls-certificates/acme.js';
import { LocalCA, generateCACertificate } from './tls-certificates/local-ca.js';
import { PersistentCertCache } from './tls-certificates/cert-cache.js';
import { FilesystemCertStore } from './tls-certificates/fs-cert-store.js';
import { S3CertStore, S3Config } from './tls-certificates/s3-cert-store.js';
import { S3ChallengeStore } from './tls-certificates/s3-challenge-store.js';
import { DnsServer } from './dns-server.js';
import { setDownloadableCertificates } from './endpoints/http/tls-certs.js';
import { startMetricsServer } from './metrics.js';

declare module 'stream' {
    interface Duplex {
        receivedData?: Buffer[];
        // Pipelining detection: tracks concurrent requests
        requestsInBatch?: number;
        pipelining?: boolean;
        // TLS fingerprint data (set for TLS connections)
        [TLS_CLIENT_HELLO]?: TlsClientHelloData;
        // PROXY protocol data (set when connection uses PROXY protocol)
        [PROXY_PROTOCOL]?: ProxyProtocolData;
    }
}

export interface ServerOptions {
    domain?: string;
    acmeProvider?: AcmeProvider;
    acmeAccountKey?: string;
    proactiveCertDomains?: string[];
    certCacheDir?: string;
    certStoreS3?: S3Config;
    localCaKey?: string;
    localCaCert?: string;
    dnsServer?: boolean;
    trustProxyProtocol?: boolean;
}

function isWildcardCoverable(domain: string, rootDomain: string): boolean {
    if (!domain.endsWith(`.${rootDomain}`)) return false;
    const prefix = domain.slice(0, -rootDomain.length - 1);
    return !prefix.includes('.'); // Single-level subdomain only
}

export function s3ConfigFromEnv(): S3Config | undefined {
    const bucket = process.env.CERT_STORE_S3_BUCKET;
    if (!bucket) return undefined;

    const endpoint = process.env.AWS_ENDPOINT_URL_S3 ?? process.env.AWS_ENDPOINT_URL;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (!endpoint || !accessKeyId || !secretAccessKey) {
        throw new Error(
            'CERT_STORE_S3_BUCKET is set but the S3 connection is incomplete - need ' +
            'AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY'
        );
    }

    return {
        bucket,
        endpoint,
        region: process.env.AWS_REGION ?? 'auto',
        accessKeyId,
        secretAccessKey,
        prefix: 'certs/'
    };
}

async function generateTlsConfig(options: ServerOptions) {
    const rootDomain = options.domain ?? 'localhost';

    if (options.certCacheDir && options.certStoreS3) {
        throw new Error(
            "Can't use both a local cert cache directory and an S3 cert store - " +
            "set only one of CERT_CACHE_DIR or CERT_STORE_S3_BUCKET"
        );
    }

    const certStoreBackend = options.certStoreS3
        ? new S3CertStore(options.certStoreS3)
        : options.certCacheDir
            ? new FilesystemCertStore(options.certCacheDir)
            : undefined;
    const certCache = certStoreBackend
        ? new PersistentCertCache(certStoreBackend)
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

    if (certCache) await certCache.loadCache();

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
    if (!certCache || !AcmeCA) {
        throw new Error(`Can't enable ACME without a cert store (via $CERT_CACHE_DIR or $CERT_STORE_S3_BUCKET)`);
    }
    if (!options.acmeAccountKey) {
        throw new Error(`Can't enable ACME without configuring an account key (via $ACME_ACCOUNT_KEY)`);
    }

    // Set up in-process DNS server for wildcard certs via DNS-01 (optional)
    let dnsServer: DnsServer | undefined;

    if (options.dnsServer) {
        // Fly.io requires UDP to bind to 'fly-global-services' instead of 0.0.0.0
        const dnsBindAddress = process.env.FLY_APP_NAME ? 'fly-global-services' : '0.0.0.0';
        // Share challenge records across servers so any machine can answer a DNS-01
        // validation, regardless of which machine is performing the issuance.
        const challengeStore = options.certStoreS3
            ? new S3ChallengeStore({ ...options.certStoreS3, prefix: 'acme-challenges/' })
            : undefined;
        dnsServer = new DnsServer(53, dnsBindAddress, challengeStore);
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
                conn[TLS_CLIENT_HELLO] = {
                    ...helloData,
                    ja3: calculateJa3(helloData),
                    ja4: calculateJa4(helloData)
                };
            } catch (e) {
                // Non-TLS traffic or malformed client hello - continue without fingerprint
            }
            conn.pause();
            tlsHandler.handleConnection(conn);
        },
        (conn) => httpHandler.emit('connection', conn),
        (conn) => http2Handler.emit('connection', conn),
        options.trustProxyProtocol ?? false
    );

    const tlsConfig = await generateTlsConfig(options);
    // Expose the local certs for download (see /tls/certs/*). Lazy, so we don't block
    // startup generating certs that may never be downloaded.
    setDownloadableCertificates({
        'untrusted-root': () => Promise.resolve(tlsConfig.ca),
        'intermediate': () => tlsConfig.localCA.getIntermediateCertificatePem(),
        'self-signed': () => tlsConfig.localCA
            .generateCertificate(tlsConfig.rootDomain, { selfSigned: true })
            .then((cert) => cert.cert)
    });
    const tlsHandler = await createTlsHandler(tlsConfig, connProcessor);

    const httpConfig = {
        acmeChallengeCallback: tlsConfig.acmeChallenge,
        rootDomain: options.domain ?? 'localhost',
        usingPublicCA: !!options.acmeProvider
    };

    const httpHandler = createHttp1Handler(httpConfig);
    const http2Handler = createHttp2Handler(httpConfig);

    return (conn: net.Socket) => {
        try {
            connProcessor.processInitialConnection(conn);
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

    const metricsPort = process.env.METRICS_PORT
        ? parseInt(process.env.METRICS_PORT)
        : undefined;

    if (metricsPort) {
        startMetricsServer(metricsPort);
    }

    createTcpHandler({
        domain: process.env.ROOT_DOMAIN,
        proactiveCertDomains: process.env.PROACTIVE_CERT_DOMAINS?.split(','),
        acmeProvider: process.env.ACME_PROVIDER as AcmeProvider | undefined,
        acmeAccountKey: process.env.ACME_ACCOUNT_KEY,
        certCacheDir: process.env.CERT_CACHE_DIR,
        certStoreS3: s3ConfigFromEnv(),
        localCaKey: process.env.LOCAL_CA_KEY,
        localCaCert: process.env.LOCAL_CA_CERT,
        dnsServer: process.env.DNS_SERVER === 'true',
        trustProxyProtocol: process.env.TRUST_PROXY_PROTOCOL === 'true'
    }).then((tcpHandler) => {
        ports.forEach((port) => {
            const server = createTcpServer(tcpHandler);
            server.listen(port, () => {
                console.log(`Testserver listening on port ${port}`);
            });
        });
    });
}