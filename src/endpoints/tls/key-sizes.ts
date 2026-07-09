import { TlsEndpoint } from '../tls-index.js';
import { tlsKeySizes } from '../groups.js';

export const rsa512: TlsEndpoint = {
    sniPart: 'rsa512',
    configureCertOptions() {
        return { requiredType: 'local', keyBits: 512 };
    },
    configureTlsOptions() {
        // A 512-bit RSA key is too small to produce a TLS 1.3 (RSA-PSS) signature at all, so cap
        // at TLS 1.2 and offer an RSA-key-exchange suite where the small key is actually usable
        // (and securityLevel 0 so the server itself will load the key) - otherwise the handshake
        // would fail everywhere, not just at security level 1.
        return {
            ciphers: 'AES128-SHA',
            securityLevel: 0,
            maxVersion: 'TLSv1.2'
        };
    },
    meta: {
        path: 'rsa512',
        description: 'Serves a certificate with a 512-bit RSA key, below the 1024-bit floor.',
        examples: ['https://rsa512.testserver.host/'],
        group: tlsKeySizes
    }
};

export const rsa1024: TlsEndpoint = {
    sniPart: 'rsa1024',
    configureCertOptions() {
        return { requiredType: 'local', keyBits: 1024 };
    },
    configureTlsOptions() {
        // A 1024-bit key is below Node's default security level (2), so the server won't load it
        // without dropping to level 1. That still leaves it usable at all TLS versions - only a
        // client enforcing level 2+ should reject it.
        return { securityLevel: 1 };
    },
    meta: {
        path: 'rsa1024',
        description: 'Serves a certificate with a 1024-bit RSA key.',
        examples: ['https://rsa1024.testserver.host/'],
        group: tlsKeySizes
    }
};

export const rsa2048: TlsEndpoint = {
    sniPart: 'rsa2048',
    configureCertOptions() {
        return { requiredType: 'local', keyBits: 2048 };
    },
    meta: {
        path: 'rsa2048',
        description: 'Serves a certificate with a 2048-bit RSA key.',
        examples: ['https://rsa2048.testserver.host/'],
        group: tlsKeySizes
    }
};

export const rsa4096: TlsEndpoint = {
    sniPart: 'rsa4096',
    configureCertOptions() {
        return { requiredType: 'local', keyBits: 4096 };
    },
    meta: {
        path: 'rsa4096',
        description: 'Serves a certificate with a 4096-bit RSA key.',
        examples: ['https://rsa4096.testserver.host/'],
        group: tlsKeySizes
    }
};

export const rsa8192: TlsEndpoint = {
    sniPart: 'rsa8192',
    configureCertOptions() {
        return { requiredType: 'local', keyBits: 8192 };
    },
    meta: {
        path: 'rsa8192',
        description: 'Serves a certificate with an 8192-bit RSA key.',
        examples: ['https://rsa8192.testserver.host/'],
        group: tlsKeySizes
    }
};
