import { StatusError } from '@httptoolkit/util';
import { HttpEndpoint } from '../http-index.js';
import { httpDynamicData } from '../groups.js';
import { buildHttpBinAnythingData } from '../../httpbin-compat.js';

const MAX_LINES = 100;

const parseN = (path: string): number => {
    const n = parseInt(path.slice('/stream/'.length), 10);
    if (isNaN(n) || n < 0) throw new StatusError(400, `Invalid stream count in ${path}`);
    if (n > MAX_LINES) throw new StatusError(400, `Stream count exceeds maximum of ${MAX_LINES}`);
    return n;
};

export const streamEndpoint: HttpEndpoint = {
    matchPath: (path) => {
        if (!path.match(/^\/stream\/\d+$/)) return false;
        parseN(path);
        return true;
    },
    handle: async (req, res) => {
        const n = parseN(req.url!.split('?')[0]);
        const data = await buildHttpBinAnythingData(req, {
            fieldFilter: ["url", "args", "headers", "origin"]
        });

        res.writeHead(200, { 'content-type': 'application/json' });

        for (let i = 0; i < n; i++) {
            (res as NodeJS.WritableStream).write(JSON.stringify({ id: i, ...data as object }) + '\n');
        }
        res.end();
    },
    meta: {
        path: '/stream/{n}',
        description: 'Streams n newline-delimited JSON objects, each containing request data with an incrementing id.',
        examples: ['/stream/5'],
        group: httpDynamicData
    }
};
