import { delay } from '@httptoolkit/util';
import { HttpHandler, HttpEndpoint } from '../http-index.js';
import { buildHttpBinAnythingEndpoint } from '../../httpbin-compat.js';

const matchPath = (path: string) => path.startsWith('/delay/');

const defaultAnythingEndpoint = buildHttpBinAnythingEndpoint({
    fieldFilter: ["url", "args", "form", "data", "origin", "headers", "files"]
});

const handle: HttpHandler = async (req, res, { path }) => {
    const delayMs = parseFloat(path.slice('/delay/'.length));

    if (isNaN(delayMs)) {
        res.writeHead(400);
        res.end('Invalid delay duration');
    }

    await delay(Math.min(delayMs, 10 * 1000)); // 10s max

    return defaultAnythingEndpoint(req, res);
}

export const delayEndpoint = {
    matchPath,
    handle
};