import * as http from 'http';
import * as http2 from 'http2';

import { clearArray } from './util.js';

import { httpEndpoints } from './endpoints/endpoint-index.js';
import { HttpRequest, HttpResponse } from './endpoints/http-index.js';

const allowCORS = (req: HttpRequest, res: HttpResponse) => {
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

type RequestHandler = (
    req: HttpRequest,
    res: HttpResponse
) => Promise<void>;

function createHttpRequestHandler(options: {
    acmeChallengeCallback: (token: string) => string | undefined,
    rootDomain: string
}): RequestHandler {
    return async function handleRequest(req, res) {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const path = url.pathname;

        // --- A few initial administrative endpoints, that don't support CORS etc etc ---
        if (path.startsWith('/.well-known/acme-challenge/')) {
            console.log("Got ACME challenge request", path);
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

        const hostnamePrefix = url.hostname.endsWith(options.rootDomain)
            ? url.hostname.slice(0, -options.rootDomain.length - 1)
            : undefined;

        if (path === '/' && !hostnamePrefix) {
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
            endpoint.matchPath(path, hostnamePrefix)
        );

        if (matchingEndpoint) {
            console.log(`Request to ${path} matched endpoint ${matchingEndpoint.name}`);
            await matchingEndpoint.handle(req, res, {
                path,
                query: url.searchParams,
                handleRequest
            });
        } else {
            console.log(`Request to ${path} matched no endpoints`);
            res.writeHead(404);
            res.end(`No handler for ${req.url}`);
        }
    }
}

export function createHttp1Handler(options: {
    acmeChallengeCallback: (token: string) => string | undefined,
    rootDomain: string
}) {
    const handleRequest = createHttpRequestHandler(options);
    const handler = new http.Server(async (req, res) => {
        try {
            console.log(`Handling H1 request to ${req.url}`);
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

export function createHttp2Handler(options: {
    acmeChallengeCallback: (token: string) => string | undefined,
    rootDomain: string
}) {
    const handleRequest = createHttpRequestHandler(options);
    const handler = http2.createServer(async (req, res) => {
        try {
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