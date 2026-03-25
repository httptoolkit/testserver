import { serializeJson } from '../../util.js';
import { HttpEndpoint } from '../http-index.js';
import { httpResponseInspection } from '../groups.js';

export const responseHeaders: HttpEndpoint = {
    matchPath: (path) => path === '/response-headers',
    handle: (_req, res, { query }) => {
        const headers: Record<string, string | string[]> = {};

        for (const key of new Set(query.keys())) {
            const values = query.getAll(key);
            if (values.length === 1) {
                headers[key] = values[0];
            } else {
                headers[key] = values;
            }
        }

        for (const [key, value] of Object.entries(headers)) {
            res.setHeader(key, value);
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(serializeJson(headers));
    },
    meta: {
        path: '/response-headers',
        description: 'Returns a response with headers set from the query parameters.',
        examples: ['/response-headers?X-Custom=value', '/response-headers?freeform=hello&freeform=world'],
        group: httpResponseInspection
    }
};
