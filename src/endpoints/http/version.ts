import { HttpEndpoint, HttpHandler } from '../http-index.js';

const versionHash = process.env.VERSION_HASH || 'unknown';

const matchPath = (path: string) => path === '/version';

const handle: HttpHandler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
        versionHash
    }));
}

export const versionJson: HttpEndpoint = {
    matchPath,
    handle
};