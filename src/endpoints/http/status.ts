import { HttpEndpoint, HttpHandler } from '../http-index.js';

const matchPath = (path: string) => path.startsWith('/status/');

const handle: HttpHandler = (_req, res, { path }) => {
    const statusCode = parseInt(path.slice('/status/'.length), 10);
    if (isNaN(statusCode)) {
        res.writeHead(400);
        res.end('Invalid status code');
    } else {
        res.writeHead(statusCode);
        res.end();
    }
}

export const status: HttpEndpoint = {
    matchPath,
    handle
}