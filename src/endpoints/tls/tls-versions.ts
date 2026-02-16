import * as tls from 'tls';
import * as crypto from 'crypto';
import { TlsEndpoint } from '../tls-index.js';
import { tlsVersions } from '../groups.js';

const {
    SSL_OP_NO_TLSv1,
    SSL_OP_NO_TLSv1_1,
    SSL_OP_NO_TLSv1_2,
    SSL_OP_NO_TLSv1_3
} = crypto.constants;

const ALL_VERSIONS_DISABLED = SSL_OP_NO_TLSv1 | SSL_OP_NO_TLSv1_1 | SSL_OP_NO_TLSv1_2 | SSL_OP_NO_TLSv1_3;

const VERSION_FLAGS: Record<tls.SecureVersion, number> = {
    'TLSv1': SSL_OP_NO_TLSv1,
    'TLSv1.1': SSL_OP_NO_TLSv1_1,
    'TLSv1.2': SSL_OP_NO_TLSv1_2,
    'TLSv1.3': SSL_OP_NO_TLSv1_3,
};

const VERSION_ORDER: tls.SecureVersion[] = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];

function enableTlsVersion(opts: tls.SecureContextOptions, version: tls.SecureVersion) {
    // Start with all versions disabled if not set
    if (opts.secureOptions === undefined) {
        opts.secureOptions = ALL_VERSIONS_DISABLED;
    }

    // Remove the disable flag for this version (enable it)
    opts.secureOptions &= ~VERSION_FLAGS[version];

    // Set minVersion to the lowest enabled version (Node.js defaults to TLSv1.2)
    const versionIndex = VERSION_ORDER.indexOf(version);
    const currentMinIndex = opts.minVersion
        ? VERSION_ORDER.indexOf(opts.minVersion)
        : VERSION_ORDER.length;

    if (versionIndex < currentMinIndex) {
        opts.minVersion = version;
    }

    // Legacy TLS versions require lowered cipher security level
    if (versionIndex <= 1 && !opts.ciphers?.includes('@SECLEVEL=0')) {
        opts.ciphers = `${opts.ciphers || 'DEFAULT'}@SECLEVEL=0`;
    }
}

export const tlsV1: TlsEndpoint = {
    sniPart: 'tls-v1-0',
    configureTlsOptions(tlsOptions) {
        enableTlsVersion(tlsOptions, 'TLSv1');
        return tlsOptions;
    },
    meta: {
        path: 'tls-v1-0',
        description: 'Accepts only TLS 1.0 connections.',
        examples: ['https://tls-v1-0.testserver.host/'],
        group: tlsVersions
    }
};

export const tlsV1_1: TlsEndpoint = {
    sniPart: 'tls-v1-1',
    configureTlsOptions(tlsOptions) {
        enableTlsVersion(tlsOptions, 'TLSv1.1');
        return tlsOptions;
    },
    meta: {
        path: 'tls-v1-1',
        description: 'Accepts only TLS 1.1 connections.',
        examples: ['https://tls-v1-1.testserver.host/'],
        group: tlsVersions
    }
};

export const tlsV1_2: TlsEndpoint = {
    sniPart: 'tls-v1-2',
    configureTlsOptions(tlsOptions) {
        enableTlsVersion(tlsOptions, 'TLSv1.2');
        return tlsOptions;
    },
    meta: {
        path: 'tls-v1-2',
        description: 'Accepts only TLS 1.2 connections.',
        examples: ['https://tls-v1-2.testserver.host/'],
        group: tlsVersions
    }
};

export const tlsV1_3: TlsEndpoint = {
    sniPart: 'tls-v1-3',
    configureTlsOptions(tlsOptions) {
        enableTlsVersion(tlsOptions, 'TLSv1.3');
        return tlsOptions;
    },
    meta: {
        path: 'tls-v1-3',
        description: 'Accepts only TLS 1.3 connections.',
        examples: ['https://tls-v1-3.testserver.host/'],
        group: tlsVersions
    }
};
