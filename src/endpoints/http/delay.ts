import { delay } from '@httptoolkit/util';
import { HttpHandler } from '../http-index.js';
import { buildHttpBinAnythingEndpoint } from '../../httpbin-compat.js';

const matchPath = (path: string) => path.startsWith('/delay/');

const defaultAnythingEndpoint = buildHttpBinAnythingEndpoint({
    fieldFilter: ["url", "args", "form", "data", "origin", "headers", "files"]
});

const handle: HttpHandler = async (req, res, { path, handleRequest }) => {
    const followingSlashIndex = path.indexOf('/', '/delay/'.length);
    const followingUrl = followingSlashIndex !== -1 ? path.slice(followingSlashIndex) : '';
    const endOfDelay = followingSlashIndex === -1 ? path.length : followingSlashIndex;
    const delayMs = parseFloat(path.slice('/delay/'.length, endOfDelay));

    if (isNaN(delayMs)) {
        res.writeHead(400);
        res.end('Invalid delay duration');
    }

    await delay(Math.min(delayMs, 10) * 1000); // 10s max

    if (followingUrl) {
        req.url = followingUrl;
        handleRequest(req, res);
        return;
    } else {
        return defaultAnythingEndpoint(req, res);
    }
}

export const delayEndpoint = {
    matchPath,
    handle
};