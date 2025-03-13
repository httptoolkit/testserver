import * as http from 'http';

import { clearArray } from './util.js';

import { httpEndpoints } from './endpoints/endpoint-index.js';

const allowCORS = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const origin = req.headers['origin'];
    if (!origin) return;

    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-credentials', 'true');

    if (req.headers['access-control-request-method']) {
        res.setHeader('access-control-allow-method', req.headers['access-control-request-method']);
    }

    if (req.headers['access-control-request-headers']) {
        res.setHeader('access-control-allow-headers', req.headers['access-control-request-headers']);
    }

    if (req.headers['access-control-request-private-network']) {
        res.setHeader('access-control-allow-private-network', 'true');
    }
}

export function createHttpHandler(options: {
    acmeChallengeCallback: (token: string) => string | undefined
}) {
    async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const path = url.pathname;

        // --- A few initial administrative endpoints, that don't support CORS etc etc ---
        if (path.startsWith('/.well-known/acme-challenge/')) {
            const token = path.split('/')[3];
            const response = options.acmeChallengeCallback(token);
            if (response) {
                res.writeHead(200);
                res.end(response);
            } else {
                res.writeHead(404);
                res.end('Unrecognized ACME challenge request');
            }

            // We have to clear this, as we might get multiple requests on the same
            // socket with keep-alive etc.
            clearArray(req.socket.receivedData);
            return;
        }

        if (path === '/') {
            res.writeHead(307, {
                location: 'https://github.com/httptoolkit/testserver/'
            });
            res.end();
            return;
        }

        // Now we begin the various test endpoints themselves:
        allowCORS(req, res);

        if (req.method === 'OPTIONS') {
            // Handle preflight CORS requests for everything
            res.writeHead(200);
            res.end();
        }

        const matchingEndpoint = httpEndpoints.find((endpoint) =>
            endpoint.matchPath(path)
        );

        if (matchingEndpoint) {
            console.log(`Request to ${path} matched endpoint ${matchingEndpoint.name}`);
            await matchingEndpoint.handle(req, res, { path });
        } else {
            console.log(`Request to ${path} matched no endpoints`);
            res.writeHead(404);
            res.end(`No handler for ${req.url}`);
        }
    }

    const handler = new http.Server(async (req, res) => {
        try {
            console.log(`Handling request to ${req.url}`);
            await handleRequest(req, res);
        } catch (e) {
            console.error(e);

            if (res.closed) return;
            else if (res.headersSent) {
                res.destroy();
            } else {
                res.writeHead(500);
                res.end('HTTP handler failed');
            }
        } finally {
            // We have to clear this, as we might get multiple requests on the same
            // socket with keep-alive etc.
            clearArray(req.socket.receivedData);
        }
    });

    handler.on('error', (err) => console.error('HTTP handler error', err));

    return handler;
}