import { TLSSocket } from 'tls';
import { HttpEndpoint, HttpRequest } from '../http-index.js';

function getTlsSocket(req: HttpRequest): TLSSocket | undefined {
    // HTTP/1: socket is directly available
    if (req.socket instanceof TLSSocket) {
        return req.socket;
    }

    // HTTP/2: socket is on the session
    const stream = (req as any).stream;
    const session = stream?.session;
    const socket = session?.socket;
    if (socket instanceof TLSSocket) {
        return socket;
    }

    return undefined;
}

export const tlsFingerprint: HttpEndpoint = {
    matchPath: (path) => path === '/tls/fingerprint',
    handle: (req, res) => {
        const tlsSocket = getTlsSocket(req);

        if (!tlsSocket) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not a TLS connection' }));
            return;
        }

        const tlsClientHello = (tlsSocket as any).tlsClientHello;

        if (!tlsClientHello?.ja3 || !tlsClientHello?.ja4) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'TLS fingerprint not available' }));
            return;
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            ja3: tlsClientHello.ja3,
            ja4: tlsClientHello.ja4
        }));
    },
    meta: {
        path: '/tls/fingerprint',
        description: 'Returns the TLS fingerprint (JA3 and JA4) of the client connection. Requires HTTPS.',
        examples: ['/tls/fingerprint']
    }
};
