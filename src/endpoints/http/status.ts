import { StatusError } from '@httptoolkit/util';
import { HttpEndpoint, HttpHandler } from '../http-index.js';

const parseStatusCode = (path: string): number => {
    return parseInt(path.slice('/status/'.length), 10);
};

const handle: HttpHandler = (_req, res, { path }) => {
    const statusCode = parseStatusCode(path);
    res.writeHead(statusCode);
    res.end();
}

export const status: HttpEndpoint = {
    matchPath: (path) => {
        if (!path.startsWith('/status/')) return false;
        const statusCode = parseStatusCode(path);
        if (isNaN(statusCode)) {
            throw new StatusError(400, `Invalid status code in ${path}`);
        }
        return true;
    },
    handle
}