import * as zlib from 'node:zlib';
import { serializeJson } from '../../../util.js';
import { HttpEndpoint, HttpHandler } from '../../http-index.js';

// We pre-decode the data. Note that this differs from HTTPBin which returns
// dynamic data here - for this reason, we use a subdirectory. Dynamic encoding
// is relatively expensive so we don't want that. Instead we just use the same
// static data every time, including only a 'zstd' field.
const data = zlib.zstdCompressSync(serializeJson({
    zstd: true
}));

const matchPath = (path: string) => path === '/encoding/zstd';

const handle: HttpHandler = (req, res) => {
    res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'zstd'
    });

    res.end(data);
}

export const zstd: HttpEndpoint = {
    matchPath,
    handle
};