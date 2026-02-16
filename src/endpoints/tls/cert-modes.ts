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
            requiredType: 'local'
        };
    },
    meta: {
        path: 'untrusted-root',
        description: 'Serves a TLS certificate signed by an untrusted root CA.',
        examples: ['https://untrusted-root.testserver.host/'],
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