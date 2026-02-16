import * as zlib from 'node:zlib';
import { serializeJson } from '../../../util.js';
import { HttpEndpoint, HttpHandler } from '../../http-index.js';
import { httpContentEncoding } from '../../groups.js';

// We pre-decode the data. Note that this differs from HTTPBin which returns
// dynamic data here - for this reason, we use a subdirectory. Dynamic encoding
// is relatively expensive so we don't want that. Instead we just use the same
// static data every time, including only a 'brotli' field (which does match
// HTTPBin at least, for that one field).
const data = zlib.brotliCompressSync(serializeJson({
    brotli: true
}));

const matchPath = (path: string) => path === '/encoding/brotli';

const handle: HttpHandler = (req, res) => {
    res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'br'
    });

    res.end(data);
}

export const brotli: HttpEndpoint = {
    matchPath,
    handle,
    meta: {
        path: '/encoding/brotli',
        description: 'Returns brotli-encoded JSON data.',
        examples: ['/encoding/brotli'],
        group: httpContentEncoding
    }
};