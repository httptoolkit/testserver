import { serializeJson } from '../../util.js';
import { HttpEndpoint, HttpHandler } from '../http-index.js';

const matchPath = (path: string) => path === '/trailers';

const handle: HttpHandler = async (req, res) => {
    const teHeader = Array.isArray(req.headers['te'])
        ? req.headers['te'].join(', ')
        : req.headers['te'] ?? '';
    const willSendTrailers = teHeader
        .split(',')
        .map(s => s.trim())
        .includes('trailers');

    if (!req.readableEnded) {
        await new Promise((resolve, reject) => {
            req.on('end', resolve);
            req.on('error', reject);
            req.resume();
        });
    }

    const rawTrailers = req.rawTrailers;

    res.writeHead(200, {
        'trailer': 'example-trailer',
        'content-type': 'application/json'
    });

    if (willSendTrailers) {
        res.addTrailers({
            'example-trailer': 'example value'
        });
    }

    res.end(serializeJson({
        "received-trailers": rawTrailers,
        "will-send-trailers": willSendTrailers
    }));
}

export const trailers: HttpEndpoint = {
    matchPath,
    handle
};