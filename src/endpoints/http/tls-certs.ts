import { HttpEndpoint } from '../http-index.js';
import { httpTls } from '../groups.js';

const PREFIX = '/tls/certs/';

const CERT_NAMES = ['untrusted-root', 'intermediate', 'self-signed', 'client-cert'] as const;
type CertName = typeof CERT_NAMES[number];

// The downloadable certificates, keyed by name. Registered as lazy providers at server
// startup (so we don't block startup generating certs nobody may download) and memoized
// on first request. Exposed so clients can trust them and exercise the local-only
// certificate endpoints (such as untrusted-root and no-common-name) against an
// otherwise-trusted baseline.
type CertProvider = () => Promise<string>;
const providers: Partial<Record<CertName, CertProvider>> = {};
const resolved: Partial<Record<CertName, Promise<string>>> = {};

export function setDownloadableCertificates(certs: Record<CertName, CertProvider>) {
    Object.assign(providers, certs);
}

export const tlsCertificates: HttpEndpoint = {
    matchPath: (path) =>
        path.startsWith(PREFIX) &&
        (CERT_NAMES as readonly string[]).includes(path.slice(PREFIX.length)),
    handle: async (_req, res, { path }) => {
        const name = path.slice(PREFIX.length) as CertName;
        const provider = providers[name];

        if (!provider) {
            res.writeHead(503, { 'content-type': 'text/plain' });
            res.end('Certificate is not available');
            return;
        }

        const pem = await (resolved[name] ??= provider());

        // client-cert is a certificate + private key bundle, not a bare CA cert.
        const contentType = name === 'client-cert'
            ? 'application/x-pem-file'
            : 'application/x-x509-ca-cert';

        res.writeHead(200, {
            'content-type': contentType,
            'content-disposition': `attachment; filename="testserver-${name}.pem"`
        });
        res.end(pem);
    },
    meta: {
        path: '/tls/certs/{name}',
        description: 'Download the TLS certificates used by the local CA configuration, in PEM ' +
            'format. client-cert is a certificate + key bundle for the mTLS client-cert endpoint.',
        examples: CERT_NAMES.map(name => `${PREFIX}${name}`),
        group: httpTls
    }
};
