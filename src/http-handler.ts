import * as http from 'http';
import * as streamConsumers from 'stream/consumers';
import { delay } from '@httptoolkit/util';

import { clearArray } from './util.js';

import { anythingEndpoint } from './endpoints/anything.js';

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
    const handler = new http.Server(async (req, res) => {
        try {
            console.log(`Handling request to ${req.url}`);

            const url = new URL(req.url!, `http://${req.headers.host}`);
            const path = url.pathname;

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

            // Now we begin the various test endpoints themselves:
            allowCORS(req, res);

            if (path === '/echo') {
                await streamConsumers.buffer(req); // Wait for all request data
                const input = Buffer.concat(req.socket.receivedData ?? []);
                res.writeHead(200, {
                    'Content-Length': Buffer.byteLength(input)
                });
                res.end(input);
            }

            // --- Now we start on the httpbin.org endpoints ---
            else if (path.match(/^\/anything(\/|$)/)) {
                await anythingEndpoint(req, res);
            } else if (http.METHODS.includes(path.slice(1))) {
                const method = path.slice(1);
                await anythingEndpoint(req, res, {
                    requiredMethod: method,
                    fieldFilter: method === 'GET'
                        ? ["url", "args", "headers", "origin"]
                        : ["url", "args", "form", "data", "origin", "headers", "files", "json"]
                });
            } else if (path.startsWith('/status/')) {
                const statusCode = parseInt(path.slice('/status/'.length), 10);
                if (isNaN(statusCode)) {
                    res.writeHead(400);
                    res.end('Invalid status code');
                } else {
                    res.writeHead(statusCode);
                    res.end();
                }
            } else if (path === '/headers') {
                return anythingEndpoint(req, res, { fieldFilter: ["headers"] });
            } else if (path === '/ip') {
                return anythingEndpoint(req, res, { fieldFilter: ["origin"] });
            } else if (path === '/user-agent') {
                res.writeHead(200);
                res.end('');
            } else if (path.startsWith('/delay/')) {
                const delayMs = parseFloat(path.slice('/delay/'.length));

                if (isNaN(delayMs)) {
                    res.writeHead(400);
                    res.end('Invalid delay duration');
                }

                await delay(Math.min(delayMs, 10 * 1000)); // 10s max

                return anythingEndpoint(req, res, {
                    fieldFilter: ["url", "args", "form", "data", "origin", "headers", "files"]
                });

            }
            // --- Last httpbin org endpoint ---

            else {
                res.writeHead(404);
                res.end(`No handler for ${req.url}`);
            }

            // We have to clear this, as we might get multiple requests on the same
            // socket with keep-alive etc.
            clearArray(req.socket.receivedData);
        } catch (e) {
            console.error(e);

            res.writeHead(500);
            res.end('HTTP handler failed');
        }
    });

    handler.on('error', (err) => console.error('HTTP handler error', err));

    return handler;
}