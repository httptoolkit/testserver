import { delay, StatusError } from '@httptoolkit/util';
import { HttpEndpoint, HttpHandler } from '../http-index.js';
import { buildHttpBinAnythingEndpoint } from '../../httpbin-compat.js';

const getRemainingPath = (path: string): string | undefined => {
    const idx = path.indexOf('/', '/delay/'.length);
    return idx !== -1 ? path.slice(idx) : undefined;
};

const parseDelaySeconds = (path: string): number => {
    const idx = path.indexOf('/', '/delay/'.length);
    const end = idx !== -1 ? idx : path.length;
    return parseFloat(path.slice('/delay/'.length, end));
};

const defaultAnythingEndpoint = buildHttpBinAnythingEndpoint({
    fieldFilter: ["url", "args", "form", "data", "origin", "headers", "files"]
});

const handle: HttpHandler = async (req, res, { path }) => {
    const delaySeconds = parseDelaySeconds(path);
    const cappedDelayMs = Math.min(delaySeconds, 10) * 1000;
    await delay(cappedDelayMs);

    if (getRemainingPath(path)) {
        return; // Handler continues to next endpoint in chain
    }

    return defaultAnythingEndpoint(req, res);
};

export const delayEndpoint: HttpEndpoint = {
    matchPath: (path) => {
        if (!path.startsWith('/delay/')) return false;
        const delaySeconds = parseDelaySeconds(path);
        if (isNaN(delaySeconds)) {
            throw new StatusError(400, `Invalid delay duration in ${path}`);
        }
        return true;
    },
    handle,
    getRemainingPath,
    meta: {
        path: '/delay/{seconds}',
        description: 'Delays the response by the specified number of seconds (max 10). Can be chained with other endpoints.',
        examples: ['/delay/1', '/delay/5', '/delay/2/status/200']
    }
};
