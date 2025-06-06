import * as zlib from 'node:zlib';
import { serializeJson } from '../../../util.js';
import { HttpEndpoint, HttpHandler } from '../../http-index.js';

// We pre-decode the data. Note that this differs from HTTPBin which returns
// dynamic data here - for this reason, we use a subdirectory. Dynamic encoding
// is relatively expensive so we don't want that. Instead we just use the same
// static data every time, including only a 'deflate' field.
const data = zlib.deflateSync(serializeJson({
    deflate: true
}));

const matchPath = (path: string) => path === '/encoding/deflate';

const handle: HttpHandler = (req, res) => {
    res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'deflate'
    });

    res.end(data);
}

export const deflate: HttpEndpoint = {
    matchPath,
    handle
};