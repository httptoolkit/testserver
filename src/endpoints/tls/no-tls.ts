import { TlsEndpoint } from '../tls-index.js';

export const noTls: TlsEndpoint = {
    sniPart: 'no-tls',
    configureTlsOptions() {
        throw new Error('Intentionally rejecting TLS connection');
    },
    meta: {
        path: 'no-tls',
        description: 'Rejects the TLS handshake with a connection reset, simulating a server that does not support TLS.',
        examples: ['https://no-tls.testserver.host/'],
    }
};