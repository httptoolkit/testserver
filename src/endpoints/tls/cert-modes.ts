import { TlsEndpoint } from '../tls-index.js';
import { tlsCertificateModes } from '../groups.js';

export const expired: TlsEndpoint = {
    sniPart: 'expired',
    configureCertOptions() {
        return {
            expired: true
        };
    },
    meta: {
        path: 'expired',
        description: 'Serves an expired TLS certificate.',
        examples: ['https://expired.testserver.host/'],
        group: tlsCertificateModes
    }
};

export const revoked: TlsEndpoint = {
    sniPart: 'revoked',
    configureCertOptions() {
        return {
            revoked: true
        };
    },
    meta: {
        path: 'revoked',
        description: 'Serves a revoked TLS certificate (reported via OCSP).',
        examples: ['https://revoked.testserver.host/'],
        group: tlsCertificateModes
    }
};

export const selfSigned: TlsEndpoint = {
    sniPart: 'self-signed',
    configureCertOptions() {
        return {
            requiredType: 'local',
            selfSigned: true
        };
    },
    meta: {
        path: 'self-signed',
        description: 'Serves a self-signed TLS certificate.',
        examples: ['https://self-signed.testserver.host/'],
        group: tlsCertificateModes
    }
};

export const untrustedRoot: TlsEndpoint = {
    sniPart: 'untrusted-root',
    configureCertOptions() {
        return {
            requiredType: 'local',
            selfSigned: false
        };
    },
    meta: {
        path: 'untrusted-root',
        description: 'Serves a TLS certificate signed by an untrusted root CA.',
        examples: ['https://untrusted-root.testserver.host/'],
        group: tlsCertificateModes
    }
};

export const noCommonName: TlsEndpoint = {
    sniPart: 'no-common-name',
    configureCertOptions() {
        return {
            // We can only control this for local CAs
            requiredType: 'local',
            noCommonName: true
        };
    },
    meta: {
        path: 'no-common-name',
        description: 'Serves a TLS certificate with no Common Name (Subject Alternative Name only). Local CA only.',
        examples: ['https://no-common-name.testserver.host/'],
        group: tlsCertificateModes
    }
};

export const incompleteChain: TlsEndpoint = {
    sniPart: 'incomplete-chain',
    configureCertOptions() {
        return {
            incompleteChain: true,
            selfSigned: false
        };
    },
    meta: {
        path: 'incomplete-chain',
        description: 'Serves a TLS certificate without the required intermediate certificate.',
        examples: ['https://incomplete-chain.testserver.host/'],
        group: tlsCertificateModes
    }
};

export const sha1Sig: TlsEndpoint = {
    sniPart: 'sha1-sig',
    configureCertOptions() {
        return {
            requiredType: 'local',
            sha1Signature: true
        };
    },
    configureTlsOptions() {
        // OpenSSL refuses to even load a SHA-1-signed cert at its default security level
        return { securityLevel: 0 };
    },
    meta: {
        path: 'sha1-sig',
        description: 'Serves a certificate signed with SHA-1 (insecure).',
        examples: ['https://sha1-sig.testserver.host/'],
        group: tlsCertificateModes
    }
};

export const wrongHost: TlsEndpoint = {
    sniPart: 'wrong-host',
    configureCertOptions() {
        return {
            overridePrefix: 'example'
        };
    },
    meta: {
        path: 'wrong-host',
        description: 'Serves a TLS certificate for a different hostname.',
        examples: ['https://wrong-host.testserver.host/'],
        group: tlsCertificateModes
    }
};