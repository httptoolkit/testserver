import * as http from 'http';
import * as streamConsumers from 'stream/consumers';

import { clearArray } from './util.js';

import { anythingEndpoint } from './endpoints/anything.js';

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
            } else if (path === '/echo') {
                await streamConsumers.buffer(req); // Wait for all request data
                const input = Buffer.concat(req.socket.receivedData ?? []);
                res.writeHead(200, {
                    'Content-Length': Buffer.byteLength(input)
                });
                res.end(input);
            } else if (path === '/anything') {
                await anythingEndpoint(req, res);
            } else {
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