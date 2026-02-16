import * as tls from 'tls';
import { CertOptions } from '../tls-certificates/cert-definitions.js';

import { EndpointMeta, EndpointGroup } from './groups.js';
export type { EndpointMeta, EndpointGroup };

export interface TlsEndpoint {
    sniPart: string;
    configureCertOptions?(): CertOptions;
    configureTlsOptions?(tlsOptions: tls.SecureContextOptions): tls.SecureContextOptions;
    configureAlpnPreferences?(preferences: string[]): string[];
    meta?: EndpointMeta;
}

export * from './tls/alpn-specifiers.js';
export * from './tls/cert-modes.js';
export * from './tls/example.js';
export * from './tls/no-tls.js';
export * from './tls/tls-versions.js';
