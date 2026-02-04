import * as tls from 'tls';
import { CertOptions } from '../tls-certificates/cert-definitions.js';

export interface TlsEndpoint {
    sniPart: string;
    configureCertOptions?(): CertOptions;
    configureTlsOptions?(tlsOptions: tls.SecureContextOptions): tls.SecureContextOptions;
    configureAlpnPreferences?(preferences: string[]): string[];
}

export * from './tls/alpn-specifiers.js';
export * from './tls/cert-modes.js';
export * from './tls/example.js';
export * from './tls/no-tls.js';
