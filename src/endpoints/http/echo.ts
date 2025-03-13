import * as http from 'http';
import * as streamConsumers from 'stream/consumers';

import { HttpEndpoint } from '../http-index.js';

const matchPath = ((path: string) => path === '/echo');

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    await streamConsumers.buffer(req); // Wait for all request data
    const input = Buffer.concat(req.socket.receivedData ?? []);
    res.writeHead(200, {
        'Content-Length': Buffer.byteLength(input)
    });
    res.end(input);
}

export const echo: HttpEndpoint = {
    matchPath,
    handle
}