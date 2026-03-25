import { StatusError } from '@httptoolkit/util';
import { HttpEndpoint } from '../http-index.js';
import { httpResponseInspection } from '../groups.js';
import { buildHttpBinAnythingData } from '../../httpbin-compat.js';
import { serializeJson } from '../../util.js';

const GET_FIELDS = ["url", "args", "headers", "origin"];

export const cache: HttpEndpoint = {
    matchPath: (path) => path === '/cache',
    handle: async (req, res) => {
        if (req.headers['if-modified-since'] || req.headers['if-none-match']) {
            res.writeHead(304).end();
            return;
        }

        const data = await buildHttpBinAnythingData(req, { fieldFilter: GET_FIELDS });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(serializeJson(data));
    },
    meta: {
        path: '/cache',
        description: 'Returns 304 Not Modified if an If-Modified-Since or If-None-Match header is present, otherwise returns the same response as /get.',
        examples: ['/cache'],
        group: httpResponseInspection
    }
};

export const cacheWithAge: HttpEndpoint = {
    matchPath: (path) => {
        if (!path.startsWith('/cache/')) return false;
        const n = parseInt(path.slice('/cache/'.length), 10);
        if (isNaN(n)) throw new StatusError(400, `Invalid cache duration in ${path}`);
        return true;
    },
    handle: async (req, res) => {
        const n = parseInt(req.url!.split('?')[0].slice('/cache/'.length), 10);
        const data = await buildHttpBinAnythingData(req, { fieldFilter: GET_FIELDS });
        res.writeHead(200, {
            'content-type': 'application/json',
            'cache-control': `public, max-age=${n}`
        });
        res.end(serializeJson(data));
    },
    meta: {
        path: '/cache/{n}',
        description: 'Sets a Cache-Control header for n seconds, then returns the same response as /get.',
        examples: ['/cache/60'],
        group: httpResponseInspection
    }
};
