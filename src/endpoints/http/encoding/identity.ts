import { serializeJson } from '../../../util.js';
import { HttpEndpoint, HttpHandler } from '../../http-index.js';
import { httpContentEncoding } from '../../groups.js';

// We pre-decode the data. Note that this differs from HTTPBin which returns
// dynamic data here - for this reason, we use a subdirectory. Dynamic encoding
// is relatively expensive so we don't want that. Instead we just use the same
// static data every time, including only an 'identity' field.
const data = serializeJson({
    identity: true
});

const matchPath = (path: string) => path === '/encoding/identity';

const handle: HttpHandler = (req, res) => {
    res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'identity'
    });

    res.end(data);
}

export const identity: HttpEndpoint = {
    matchPath,
    handle,
    meta: {
        path: '/encoding/identity',
        description: 'Returns uncompressed JSON data with content-encoding: identity.',
        examples: ['/encoding/identity'],
        group: httpContentEncoding
    }
};