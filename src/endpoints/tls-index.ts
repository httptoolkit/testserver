import * as tls from 'tls';
import { CertOptions } from '../tls-certificates/cert-definitions.js';

import { EndpointMeta, EndpointGroup } from './groups.js';
export type { EndpointMeta, EndpointGroup };

// Endpoints can configure TLS options directly, or change the accepted version range.
// See tls-merge for details, but generally multiple parts can't set the same options.
export interface TlsOptionContribution extends Partial<tls.SecureContextOptions> {
    enabledVersions?: tls.SecureVersion[];
    rejectTls?: boolean;
    requireClientCert?: boolean;
    securityLevel?: number;
}

export interface TlsEndpoint {
    sniPart: string;
    plainTextAllowed?: boolean;
    configureCertOptions?(): CertOptions;
    // The TLS options this part sets - merged field-by-field
    configureTlsOptions?(): TlsOptionContribution;
    configureAlpnPreferences?(preferences: string[]): string[];
    meta?: EndpointMeta;
}

export * from './tls/alpn-specifiers.js';
export * from './tls/cert-modes.js';
export * from './tls/ciphers.js';
export * from './tls/client-cert.js';
export * from './tls/example.js';
export * from './tls/key-sizes.js';
export * from './tls/no-tls.js';
export * from './tls/tls-versions.js';
