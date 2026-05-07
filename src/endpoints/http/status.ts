import { StatusError } from '@httptoolkit/util';
import { HttpEndpoint, HttpHandler } from '../http-index.js';
import { httpCustomResponses } from '../groups.js';

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
        if (statusCode >= 100 && statusCode < 200) {
            throw new StatusError(400,
                `1xx codes are informational and cannot be used as a final response. ` +
                `Use /info/${statusCode} instead.`
            );
        }
        return true;
    },
    handle,
    meta: {
        path: '/status/{code}',
        description: 'Returns a response with the specified HTTP status code.',
        examples: ['/status/200', '/status/404', '/status/500'],
        group: httpCustomResponses
    }
}