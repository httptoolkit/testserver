import * as tls from 'tls';

import { tlsEndpoints } from './endpoint-index.js';
import { CertOptions } from '../tls-certificates/cert-definitions.js';
import {
    mergeContribution,
    resolveEnabledVersions
} from './tls-merge.js';

const MAX_SNI_PARTS = 4;

export const getSNIPrefixParts = (servername: string, rootDomain: string) => {
    const serverNamePrefix = servername.endsWith(rootDomain)
        ? servername.slice(0, -rootDomain.length - 1)
        : servername;

    if (serverNamePrefix === '') return [];

    // Support both -- (preferred, single-level subdomain) and . (legacy, multi-level)
    if (serverNamePrefix.includes('--')) {
        return serverNamePrefix.split('--');
    }
    return serverNamePrefix.split('.');
};

/**
 * Resolve the cert/TLS/ALPN config for a hostname's endpoint parts, validating the whole
 * combination: too many parts, duplicates, unknown parts, and field conflicts all throw.
 * Shared by the TLS handler (which rejects the handshake on error) and the HTTP handler
 * (which returns a 400).
 */
export function getEndpointConfig(serverNameParts: string[]) {
    if (serverNameParts.length > MAX_SNI_PARTS) {
        throw new Error(`Too many endpoint parts (${serverNameParts.length}, max ${MAX_SNI_PARTS})`);
    }
    if (new Set(serverNameParts).size !== serverNameParts.length) {
        throw new Error(`Duplicate endpoint parts in '${serverNameParts.join('--')}'`);
    }

    const certOptions: Record<string, unknown> = {};
    const tlsOptions: Record<string, unknown> = {};
    let alpnPreferences: string[] = [];

    for (const part of serverNameParts) {
        const endpoint = tlsEndpoints.find(e => e.sniPart === part);
        if (!endpoint) {
            throw new Error(`Unknown endpoint '${part}'`);
        }

        // Merge field-by-field: combinable fields (e.g. TLS versions) accumulate, everything
        // else is mutually exclusive, so two parts setting it differently is a conflict.
        mergeContribution(certOptions, endpoint.configureCertOptions?.());
        mergeContribution(tlsOptions, endpoint.configureTlsOptions?.());
        alpnPreferences = endpoint.configureAlpnPreferences?.(alpnPreferences) ?? alpnPreferences;
    }

    resolveEnabledVersions(tlsOptions);

    // Pull out our non-OpenSSL markers so what's left is a clean SecureContextOptions.
    const rejectTls = tlsOptions.rejectTls === true;
    delete tlsOptions.rejectTls;
    const requireClientCert = tlsOptions.requireClientCert === true;
    delete tlsOptions.requireClientCert;

    if (rejectTls && serverNameParts.length > 1) {
        throw new Error(`'no-tls' can't be combined with other endpoints in '${serverNameParts.join('--')}'`);
    }

    return {
        certOptions: certOptions as CertOptions,
        tlsOptions: tlsOptions as tls.SecureContextOptions,
        alpnPreferences,
        rejectTls,
        requireClientCert
    };
}

/**
 * Returns a descriptive error message if the endpoint is invalid, or undefined if not.
 */
export function validateEndpointParts(serverNameParts: string[]): string | undefined {
    try {
        getEndpointConfig(serverNameParts);
        return undefined;
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}
