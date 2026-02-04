import { TlsEndpoint } from '../tls-index.js';

export const noTls: TlsEndpoint = {
    sniPart: 'no-tls',
    configureTlsOptions() {
        throw new Error('Intentionally rejecting TLS connection');
    },
};