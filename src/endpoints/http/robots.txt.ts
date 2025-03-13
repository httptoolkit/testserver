import { HttpEndpoint, HttpHandler } from '../http-index.js';

const matchPath = (path: string) => path === '/robots.txt';

const handle: HttpHandler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    // Only allow access to the root page:
    res.end('User-agent: *\nAllow: /$\nDisallow: /\n')
}

export const robotsTxt: HttpEndpoint = {
    matchPath,
    handle
};