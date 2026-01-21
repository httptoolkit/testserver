import * as net from 'net';

import { createHttp1Handler, createHttp2Handler } from './http-handler.js';
import { createTlsHandler, CertMode } from './tls-handler.js';
import { ConnectionProcessor } from './process-connection.js';

import { AcmeCA, AcmeProvider, ExternalAccessBindingConfig } from './tls-certificates/acme.js';
import { LocalCA, generateCACertificate } from './tls-certificates/local-ca.js';
import { PersistentCertCache } from './tls-certificates/cert-cache.js';

declare module 'stream' {
    interface Duplex {
        receivedData?: Buffer[];
    }
}

interface ServerOptions {
    domain?: string;
    acmeProvider?: AcmeProvider;
    proactiveCertDomains?: string[];
    certCacheDir?: string;
    eabConfig?: ExternalAccessBindingConfig;
}

async function generateTlsConfig(options: ServerOptions) {
    const rootDomain = options.domain ?? 'localhost';

    const certCache = options.certCacheDir
        ? new PersistentCertCache(options.certCacheDir)
        : undefined;
    const [
        caCert
    ] = await Promise.all([
        generateCACertificate(),
        certCache ? certCache.loadCache() : null
    ]);

    const ca = new LocalCA(caCert, certCache);
    const defaultCert = ca.generateCertificate(rootDomain);

    if (!options.acmeProvider) {
        console.log('Using self signed certificates');
        return {
            rootDomain,
            key: defaultCert.key,
            cert: defaultCert.cert,
            ca: caCert.cert,
            generateCertificate: (domain: string, mode?: CertMode) => {
                if (mode === 'self-signed') return ca.generateSelfSignedCertificate(domain);
                if (mode === 'expired') return ca.generateExpiredCertificate(domain);
                return ca.generateCertificate(domain);
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

    const acmeCA = new AcmeCA(certCache!, options.acmeProvider, options.eabConfig);
    acmeCA.tryGetCertificateSync(rootDomain); // Preload the root domain every time

    return {
        rootDomain,
        proactiveCertDomains: options.proactiveCertDomains,
        key: defaultCert.key,
        cert: defaultCert.cert,
        ca: caCert.cert,
        generateCertificate: (domain: string, mode?: CertMode) => {
            if (mode === 'self-signed') return ca.generateSelfSignedCertificate(domain);
            if (mode === 'expired') return ca.generateExpiredCertificate(domain);

            if (domain === rootDomain || domain.endsWith('.' + rootDomain)) {
                const cert = acmeCA.tryGetCertificateSync(domain);
                if (cert) return cert;
            }

            // If you use some other domain or the cert isn't immediately available, we fall back
            // to self-signed certs for now:
            return ca.generateCertificate(domain);
        },
        acmeChallenge: (token: string) => acmeCA.getChallengeResponse(token)
    }
}

const createTcpHandler = async (options: ServerOptions = {}) => {
    const connProcessor = new ConnectionProcessor(
        (conn) => {
            conn.pause();
            tlsHandler.emit('connection', conn);
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
        eabConfig: process.env.ACME_EAB_KID && process.env.ACME_EAB_HMAC
            ? { kid: process.env.ACME_EAB_KID, hmacKey: process.env.ACME_EAB_HMAC }
            : undefined,
        certCacheDir: process.env.CERT_CACHE_DIR
    }).then((tcpHandler) => {
        ports.forEach((port) => {
            const server = createTcpServer(tcpHandler);
            server.listen(port, () => {
                console.log(`Testserver listening on port ${port}`);
            });
        });
    });
}