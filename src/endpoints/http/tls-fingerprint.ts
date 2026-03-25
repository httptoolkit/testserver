import { HttpEndpoint } from '../http-index.js';
import { getClientHello } from '../../tls-client-hello.js';

export const tlsFingerprint: HttpEndpoint = {
    matchPath: (path) => path === '/tls/fingerprint',
    handle: (req, res) => {
        const helloData = getClientHello(req);

        if (!helloData) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not a TLS connection' }));
            return;
        }

        if (!helloData.ja3 || !helloData.ja4) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'TLS fingerprint not available' }));
            return;
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            ja3: helloData.ja3,
            ja4: helloData.ja4
        }));
    },
    meta: {
        path: '/tls/fingerprint',
        description: 'Returns the TLS fingerprint (JA3 and JA4) of the client connection. Requires HTTPS.',
        examples: ['/tls/fingerprint']
    }
};
