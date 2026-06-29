import * as net from 'net';

import { HttpHandler } from '../../http-index.js';
import { httpErrors } from '../../groups.js';

const matchPath = (path: string) => path === '/error/reset';

const handle: HttpHandler = async (req) => {
    // resetAndDestroy() only sends a TCP RST on a raw TCP socket. req.socket isn't that:
    // - TLS / cleartext HTTP/1: a (TLS)Socket exposing our raw socket as `underlyingSocket`.
    // - HTTP/2: a restricted proxy over a JSStreamSocket that Node interposes around our
    //   frame-capturing wrapper, reachable as `.stream`, with the raw socket beneath it.
    // Reach the raw socket via either hop; fall back to a plain destroy so this never 500s.
    const socket = req.socket;
    const wrapped = (socket as unknown as { stream?: { underlyingSocket?: net.Socket } })?.stream;
    const target = socket?.underlyingSocket ?? wrapped?.underlyingSocket ?? socket;
    try {
        target?.resetAndDestroy();
    } catch {
        try { target?.destroy(); } catch {}
    }
}

export const resetEndpoint = {
    matchPath,
    handle,
    meta: {
        path: '/error/reset',
        description: 'Resets the connection (sends a TCP RST) without sending a response.',
        examples: ['/error/reset'],
        group: httpErrors
    }
};