import { HttpEndpoint } from '../http-index.js';
import { httpResponseInspection } from '../groups.js';
import { buildHttpBinAnythingData } from '../../httpbin-compat.js';
import { serializeJson } from '../../util.js';

const GET_FIELDS = ["url", "args", "headers", "origin"];

// Parse a comma-separated list of etag values, handling both quoted and unquoted forms
const parseEtagList = (header: string): string[] =>
    header.split(',').map(s => s.trim().replace(/^"(.*)"$/, '$1'));

export const etag: HttpEndpoint = {
    matchPath: (path) => path.startsWith('/etag/') && path.length > '/etag/'.length,
    handle: async (req, res) => {
        const etagValue = req.url!.split('?')[0].slice('/etag/'.length);

        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch) {
            const tags = parseEtagList(ifNoneMatch);
            if (tags.includes(etagValue) || tags.includes('*')) {
                res.writeHead(304, { 'etag': etagValue }).end();
                return;
            }
        }

        const ifMatch = req.headers['if-match'];
        if (ifMatch) {
            const tags = parseEtagList(ifMatch);
            if (!tags.includes(etagValue) && !tags.includes('*')) {
                res.writeHead(412, { 'etag': etagValue }).end();
                return;
            }
        }

        const data = await buildHttpBinAnythingData(req, { fieldFilter: GET_FIELDS });
        res.writeHead(200, {
            'content-type': 'application/json',
            'etag': etagValue
        });
        res.end(serializeJson(data));
    },
    meta: {
        path: '/etag/{etag}',
        description: 'Assumes the given etag for the resource and responds according to If-None-Match and If-Match request headers.',
        examples: ['/etag/my-etag'],
        group: httpResponseInspection
    }
};
