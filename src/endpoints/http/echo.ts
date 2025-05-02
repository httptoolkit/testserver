import * as streamConsumers from 'stream/consumers';

import {
    HttpEndpoint,
    HttpRequest,
    HttpResponse
} from '../http-index.js';

const matchPath = ((path: string) => path === '/echo');

async function handle(req: HttpRequest, res: HttpResponse) {
    if (req.httpVersion === '2.0') {
        res.writeHead(400);
        res.end('Echo endpoint does not yet support HTTP/2');
        return;
    }
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