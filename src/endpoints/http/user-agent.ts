import { HttpEndpoint, HttpHandler } from '../http-index.js';

const matchPath = (path: string) => path === '/user-agent';

const handle: HttpHandler = (req, res) => {
    const userAgent = req.headers['user-agent'] ?? null;
    res.writeHead(200, {
        'content-type': 'application/json'
    });
    res.end(JSON.stringify({ 'user-agent': userAgent }));
}

export const userAgent: HttpEndpoint = {
    matchPath,
    handle
};