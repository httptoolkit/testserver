import * as http from 'http';
import * as http2 from 'http2';
import { MaybePromise, StatusError } from '@httptoolkit/util';
import { getExtensionData } from 'read-tls-client-hello';

import { httpEndpoints, tlsEndpoints } from './endpoints/endpoint-index.js';
import { HttpRequest, HttpResponse } from './endpoints/http-index.js';
import { handleWebSocketUpgrade } from './ws-handler.js';
import { resolveEndpointChain } from './endpoint-chain.js';
import { getDocsHtml } from './docs-page.js';
import { getClientHello } from './tls-client-hello.js';
import { httpRequestsTotal } from './metrics.js';

function stopRawDataCapture(req: HttpRequest): void {
    if (req.httpVersion === '2.0') {
        const stream = (req as any).stream;
        const session = stream?.session;
        const capturingStream = session?.socket?.stream;
        const streamId = stream?.id as number | undefined;
        if (streamId !== undefined) {
            capturingStream?.stopCapturingStream?.(streamId);
        }
    } else {
        req.socket.receivedData = undefined;
    }
}

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
    acmeChallengeCallback: (token: string) => MaybePromise<string | undefined>,
    rootDomain: string
}): RequestHandler {
    return async function handleRequest(req, res) {
        let endpointLabel = 'unknown';

        res.on('finish', () => {
            const method = req.method || 'UNKNOWN';
            const statusCode = res.statusCode.toString();
            httpRequestsTotal.inc({ method, status_code: statusCode, endpoint: endpointLabel });
        });

        const socket = req.socket as any;
        const isHttps = socket.encrypted || socket.stream?.encrypted;
        const protocol = isHttps ? 'https' : 'http';

        if (!req.url!.startsWith('/')) {
            // Absolute URL. Block requests unless they're for us personally. We
            // don't accept proxying here (lots of attempted abuse load).
            const url = new URL(req.url!);
            if (!url.hostname.endsWith(options.rootDomain)) {
                console.log("Rejecting attempted proxy request to", req.url);
                endpointLabel = 'proxy_reject';
                res.writeHead(400, { connection: 'close' });
                res.end();
                return;
            }
        }

        // Reject H2 connection coalescing: if :authority doesn't match the TLS SNI,
        // return 421 so the browser opens a new connection with the correct SNI.
        if (isHttps && req.httpVersion === '2.0') {
            const authority = req.headers[':authority']?.toString();
            if (authority) {
                const hostWithoutPort = authority.replace(/:\d+$/, '').toLowerCase();
                const clientHello = getClientHello(req);
                const sni = (clientHello
                    ? getExtensionData(clientHello, 'sni')?.serverName
                    : undefined
                )?.toLowerCase();

                if (sni && sni !== hostWithoutPort) {
                    endpointLabel = 'misdirected';
                    res.writeHead(421, { 'content-type': 'text/plain' });
                    res.end(
                        `Misdirected Request: TLS connection was established for ${sni} but got a request for ${hostWithoutPort}`
                    );
                    return;
                }
            }
        }

        const url = new URL(req.url!, `${protocol}://${
            req.headers[':authority'] ?? req.headers['host']
        }`);
        const path = url.pathname;

        // --- A few initial administrative endpoints, that don't support CORS etc etc ---
        if (path.startsWith('/.well-known/acme-challenge/')) {
            endpointLabel = 'acme_challenge';
            console.log("Got ACME challenge request", path);
            const token = path.split('/')[3];
            const response = await options.acmeChallengeCallback(token);
            if (response) {
                res.writeHead(200);
                res.end(response);
            } else {
                res.writeHead(404);
                res.end('Unrecognized ACME challenge request');
            }

            req.socket.receivedData = [];
            return;
        }

        const hostnamePrefix = url.hostname.endsWith(options.rootDomain)
            ? url.hostname.slice(0, -options.rootDomain.length - 1)
            : undefined;

        // If this is a plain HTTP request to a TLS-configuring subdomain, redirect it with
        // a clear message — the TLS settings would be silently ignored over plain HTTP.
        if (protocol === 'http' && hostnamePrefix) {
            const prefixParts = hostnamePrefix.includes('--')
                ? hostnamePrefix.split('--')
                : hostnamePrefix.split('.');

            const tlsOnlyParts = prefixParts.filter(part => {
                const endpoint = tlsEndpoints.find(e => e.sniPart === part);
                return endpoint && !endpoint.plainTextAllowed;
            });

            if (tlsOnlyParts.length > 0) {
                endpointLabel = 'tls_redirect';
                const httpsUrl = url.href.replace(/^http:/, 'https:');
                res.writeHead(301, {
                    'location': httpsUrl,
                    'content-type': 'text/plain'
                });
                res.end(
                    `This endpoint requires HTTPS. Redirecting to ${httpsUrl}`
                );
                return;
            }
        }

        // Serve docs at root path for all prefixes except 'example' which has its own root handler
        const endpointPrefixes = ['example'];
        const isEndpointPrefix = hostnamePrefix && endpointPrefixes.includes(hostnamePrefix);

        if (path === '/' && !isEndpointPrefix) {
            endpointLabel = 'docs';
            console.log(`Request to root page at ${path} (${hostnamePrefix || options.rootDomain})`);
            const html = getDocsHtml();
            res.writeHead(200, {
                'content-type': 'text/html; charset=utf-8',
                'content-length': Buffer.byteLength(html)
            });
            res.end(html);
            return;
        }

        // Now we begin the various test endpoints themselves:

        allowCORS(req, res);

        if (req.method === 'OPTIONS') {
            // Handle preflight CORS requests for everything
            endpointLabel = 'cors_preflight';
            res.writeHead(200);
            res.end();
            return;
        }

        const entries = resolveEndpointChain(httpEndpoints, path, hostnamePrefix);
        const needsRawData = entries.some(e => e.endpoint.needsRawData);

        if (!needsRawData) {
            stopRawDataCapture(req);
        }

        const endpointNames = entries.map(e => e.endpoint.name).join(' → ');
        endpointLabel = endpointNames;
        console.log(`Request to ${path}${
            hostnamePrefix ? ` ('${hostnamePrefix}' prefix)` : ` (${options.rootDomain})`
        } matched: ${endpointNames}`);

        for (const { endpoint, path } of entries) {
            if (res.writableEnded) return;
            await endpoint.handle(req, res, { path, query: url.searchParams });
        }
    }
}

export function createHttp1Handler(options: {
    acmeChallengeCallback: (token: string) => MaybePromise<string | undefined>,
    rootDomain: string
}) {
    const handleRequest = createHttpRequestHandler(options);
    const handler = new http.Server(async (req, res) => {
        // Track concurrent requests on this socket to detect pipelining
        const socket = req.socket;
        socket.requestsInBatch = (socket.requestsInBatch || 0) + 1;
        if (socket.requestsInBatch > 1) {
            socket.pipelining = true;
        }

        try {
            console.log(`Handling H1 request to ${req.url}`);
            await handleRequest(req, res);
        } catch (e) {
            console.error(e);

            if (res.closed) return;
            else if (res.headersSent) {
                res.destroy();
            } else if (e instanceof StatusError) {
                res.writeHead(e.statusCode);
                res.end(e.message);
            } else {
                res.writeHead(500);
                res.end('HTTP handler failed');
            }
        } finally {
            // Reset for next request on keep-alive connections
            req.socket.receivedData = [];
            req.socket.requestsInBatch!--;
            if (req.socket.requestsInBatch === 0) {
                req.socket.pipelining = false;
            }
        }
    });

    handler.on('error', (err) => console.error('HTTP handler error', err));

    handler.on('upgrade', (req, socket, head) => {
        handleWebSocketUpgrade(req, socket, head, options);
    });

    return handler;
}

export function createHttp2Handler(options: {
    acmeChallengeCallback: (token: string) => MaybePromise<string | undefined>,
    rootDomain: string
}) {
    const handleRequest = createHttpRequestHandler(options);
    const handler = http2.createServer(
        { strictSingleValueFields: false } as http2.ServerOptions,
        async (req, res) => {
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
            }
        }
    );

    handler.on('error', (err) => console.error('HTTP handler error', err));

    return handler;
}