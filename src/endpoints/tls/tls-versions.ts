import { TlsEndpoint } from '../tls-index.js';
import { tlsVersions } from '../groups.js';

export const tlsV1: TlsEndpoint = {
    sniPart: 'tls-v1-0',
    configureTlsOptions() {
        return { enabledVersions: ['TLSv1'] };
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
    configureTlsOptions() {
        return { enabledVersions: ['TLSv1.1'] };
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
    configureTlsOptions() {
        return { enabledVersions: ['TLSv1.2'] };
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
    configureTlsOptions() {
        return { enabledVersions: ['TLSv1.3'] };
    },
    meta: {
        path: 'tls-v1-3',
        description: 'Accepts only TLS 1.3 connections.',
        examples: ['https://tls-v1-3.testserver.host/'],
        group: tlsVersions
    }
};
