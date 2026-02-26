import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { WebSocketServer } from 'ws';
import { StatusError } from '@httptoolkit/util';

import { wsEndpoints } from './endpoints/endpoint-index.js';
import { resolveEndpointChain } from './endpoint-chain.js';

const FORCED_PROTOCOL = Symbol('ws-forced-protocol');

declare module 'http' {
    interface IncomingMessage {
        [FORCED_PROTOCOL]?: string | false;
    }
}

const wss = new WebSocketServer({
    noServer: true,
    handleProtocols(clientProtocols, req) {
        const forced = req[FORCED_PROTOCOL];
        if (forced === undefined) {
            // No subprotocol endpoint in chain — use default ws behavior
            return clientProtocols.values().next().value || false;
        }

        return forced;
    }
});

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

    let entries: typeof wsEndpoints extends Array<infer T> ? Array<{ endpoint: T; path: string }> : never;
    try {
        entries = resolveEndpointChain(wsEndpoints, path, hostnamePrefix);
    } catch (err) {
        if (err instanceof StatusError) {
            console.log(`WebSocket upgrade to ${path}: ${err.message}`);
            socket.write(`HTTP/1.1 ${err.statusCode} ${err.statusCode === 404 ? 'Not Found' : 'Bad Request'}\r\n\r\n`);
        } else {
            console.log(`WebSocket upgrade to ${path}: unexpected error`, err);
            socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        }
        socket.destroy();
        return;
    }

    const endpointNames = entries.map(e => e.endpoint.name).join(' → ');
    console.log(`WebSocket upgrade to ${path}${
        hostnamePrefix ? ` ('${hostnamePrefix}' prefix)` : ''
    } matched: ${endpointNames}`);

    socket.on('error', (err) => {
        console.log('WebSocket upgrade socket error:', err.message);
    });

    const protocolEntries = entries.filter(e => e.endpoint.getProtocol);
    if (protocolEntries.length > 1) {
        console.log(`WebSocket upgrade to ${path}: multiple subprotocol endpoints`);
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
    }
    if (protocolEntries.length === 1) {
        req[FORCED_PROTOCOL] = protocolEntries[0].endpoint.getProtocol!(protocolEntries[0].path);

        // ws only calls handleProtocols when the client sends Sec-WebSocket-Protocol.
        // Ensure the header exists so our handler always runs.
        if (!req.headers['sec-websocket-protocol']) {
            req.headers['sec-websocket-protocol'] = '_';
        }
    }

    wss.handleUpgrade(req, socket, head, async (ws) => {
        ws.on('error', (err) => {
            console.log(`WebSocket error on ${path}:`, err.message);
        });

        try {
            for (const { endpoint, path: entryPath } of entries) {
                if (ws.readyState !== ws.OPEN) return;
                await endpoint.handle(ws, req, {
                    path: entryPath,
                    query: url.searchParams
                });
            }
        } catch (err) {
            console.log(`WebSocket handler error on ${path}:`, err);
            if (ws.readyState === ws.OPEN) {
                ws.close(1011, 'Internal error');
            }
        }
    });
}
