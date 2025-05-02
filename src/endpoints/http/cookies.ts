import * as Cookie from 'cookie';

import { HttpEndpoint } from '../http-index.js';
import { serializeJson } from '../../util.js';

export const getCookies: HttpEndpoint = {
    matchPath: (path) => path === '/cookies',
    handle: (req, res) => {
        const cookies = Cookie.parse(req.headers.cookie || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(serializeJson({ cookies }));
    }
}

export const setCookies: HttpEndpoint = {
    matchPath: (path) =>
        path === '/cookies/set' ||
        (path.startsWith('/cookies/set/') && path.split('/').length === 5),
    handle: (req, res, { path, query }) => {
        const cookiesToSet: Array<[string, string]> = [];

        const cookiePath = path.split('/').slice(3);

        if (cookiePath.length) {
            cookiesToSet.push([cookiePath[0], cookiePath[1]]);
        } else if (query.size) {
            for (const key of new Set(query.keys())) {
                cookiesToSet.push([
                    key,
                    query.get(key)! // For duplicates, we use the first only
                ]);
            }
        }

        res.writeHead(302, [
            'Location', '/cookies',
            ...cookiesToSet.map((([key, value]) => {
                return [
                    'set-cookie',
                    Cookie.serialize(key, value, {
                        path: '/'
                    })
                ];
            })).flat()
        ] as any).end(); // Any because H2 types don't include string array
    }
}

export const deleteCookies: HttpEndpoint = {
    matchPath: (path) => path === '/cookies/delete',
    handle: (req, res, { query }) => {
        const cookieKeys = [...new Set(query.keys())];

        res.writeHead(302, [
            'Location', '/cookies',
            ...cookieKeys.map((key) => [
                'set-cookie',
                `${key}=; Expires=Thu, 01-Jan-1970 00:00:00 GMT; Max-Age=0; Path=/`
            ]).flat()
        ] as any).end(); // Any because H2 types don't include string array
    }
}