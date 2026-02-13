import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { WebSocketServer } from 'ws';

import { wsEndpoints } from './endpoints/endpoint-index.js';

const wss = new WebSocketServer({ noServer: true });

export function handleWebSocketUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    options: { rootDomain: string }
) {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const path = url.pathname;

    const hostnamePrefix = url.hostname.endsWith(options.rootDomain)
        ? url.hostname.slice(0, -options.rootDomain.length - 1)
        : undefined;

    const endpoint = wsEndpoints.find(ep => ep.matchPath(path, hostnamePrefix));

    if (!endpoint) {
        console.log(`WebSocket upgrade to ${path} matched no endpoints`);
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
    }

    console.log(`WebSocket upgrade to ${path}${
        hostnamePrefix ? ` ('${hostnamePrefix}' prefix)` : ''
    } matched: ${endpoint.name}`);

    socket.on('error', (err) => {
        console.log('WebSocket upgrade socket error:', err.message);
    });

    wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('error', (err) => {
            console.log(`WebSocket error on ${path}:`, err.message);
        });

        try {
            endpoint.handle(ws, req, {
                path,
                query: url.searchParams
            });
        } catch (err) {
            console.log(`WebSocket handler error on ${path}:`, err);
            ws.close(1011, 'Internal error');
        }
    });
}
