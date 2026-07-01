import { TlsEndpoint } from '../tls-index.js';
import { tlsClientAuth } from '../groups.js';

export const clientCert: TlsEndpoint = {
    sniPart: 'client-cert',
    configureTlsOptions() {
        return { requireClientCert: true };
    },
    meta: {
        path: 'client-cert',
        description: 'Requires the client to present a certificate (mutual TLS). The handshake ' +
            "is rejected unless the client presents a certificate issued by this server's " +
            'dedicated client-auth CA. Download one to use from /tls/certs/client-cert.',
        examples: ['https://client-cert.testserver.host/'],
        group: tlsClientAuth
    }
};
