import * as net from 'net';

import { createHttpHandler } from './http-handler.js';
import { createTlsHandler } from './tls-handler.js';
import { ConnectionProcessor } from './process-connection.js';

import { AcmeCA } from './tls-certificates/acme.js';
import { LocalCA, generateCACertificate } from './tls-certificates/local-ca.js';
import { PersistentCertCache } from './tls-certificates/cert-cache.js';

declare module 'stream' {
    interface Duplex {
        receivedData?: Buffer[];
    }
}


interface ServerOptions {
    domain?: string;
    enableACME?: boolean;
    certCacheDir?: string;
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

    if (!options.enableACME) {
        return {
            key: defaultCert.key,
            cert: defaultCert.cert,
            ca: caCert.cert,
            generateCertificate: (domain: string) => ca.generateCertificate(domain),
            acmeChallenge: () => undefined // Not supported
        };
    }

    if (!options.domain) {
        throw new Error(`Can't enable ACME without configuring a domain (via $ROOT_DOMAIN)`);
    }
    if (!options.certCacheDir || !AcmeCA) {
        throw new Error(`Can't enable ACME without configuring a cert cache directory (via $CERT_CACHE_DIR)`);
    }

    const acmeCA = new AcmeCA(certCache!);
    acmeCA.tryGetCertificateSync(rootDomain); // Preload the root domain every time

    return {
        key: defaultCert.key,
        cert: defaultCert.cert,
        ca: caCert.cert,
        generateCertificate: (certDomain: string) => {
            if (certDomain === rootDomain || certDomain.endsWith('.' + rootDomain)) {
                const cert = acmeCA.tryGetCertificateSync(certDomain);
                if (cert) return cert;
            }

            // If you use some other domain or the cert isn't immediately available, we fall back
            // to self-signed certs for now:
            return ca.generateCertificate(certDomain);
        },
        acmeChallenge: (token: string) => acmeCA.getChallengeResponse(token)
    }
}

const createTcpHandler = async (options: ServerOptions = {}) => {
    const connProcessor = new ConnectionProcessor(
        (conn) => tlsHandler.emit('connection', conn),
        (conn) => httpHandler.emit('connection', conn)
    );

    const tlsConfig = await generateTlsConfig(options);
    const tlsHandler = await createTlsHandler(tlsConfig, connProcessor);

    const httpHandler = createHttpHandler({
        acmeChallengeCallback: tlsConfig.acmeChallenge
    });

    return (conn: net.Socket) => connProcessor.processConnection(conn);
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
        enableACME: process.env.ENABLE_ACME === 'true',
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