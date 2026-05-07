import { STATUS_CODES } from 'http';
import { StatusError } from '@httptoolkit/util';
import { HttpEndpoint, HttpHandler, HttpResponse } from '../http-index.js';
import { httpCustomResponses } from '../groups.js';

const PREFIX = '/info/';

// 101 is reserved for protocol upgrades and isn't meaningful as a standalone
// informational response, so we exclude it.
const isSupportedInformationalCode = (code: number): boolean =>
    code >= 100 && code < 200 && code !== 101;

const parseCode = (path: string): number => {
    const rest = path.slice(PREFIX.length);
    const end = rest.indexOf('/');
    const codeStr = end === -1 ? rest : rest.slice(0, end);
    return parseInt(codeStr, 10);
};

const getRemainingPath = (path: string): string | undefined => {
    const idx = path.indexOf('/', PREFIX.length);
    return idx !== -1 ? path.slice(idx) : undefined;
};

const sendInformational = (
    res: HttpResponse,
    code: number,
    headers: Record<string, string | string[]>
): void => {
    const writeRaw = (res as { _writeRaw?: (chunk: string, encoding: string) => void })._writeRaw;
    if (typeof writeRaw === 'function') {
        let raw = `HTTP/1.1 ${code} ${STATUS_CODES[code] ?? ''}\r\n`;
        for (const [name, value] of Object.entries(headers)) {
            for (const v of Array.isArray(value) ? value : [value]) {
                raw += `${name}: ${v}\r\n`;
            }
        }
        raw += '\r\n';
        writeRaw.call(res, raw, 'latin1');
        return;
    }

    const stream = (res as { stream?: { additionalHeaders?: (h: object) => void } }).stream;
    if (stream?.additionalHeaders) {
        stream.additionalHeaders({ ':status': code, ...headers });
        return;
    }

    throw new StatusError(500, 'No mechanism available to send informational response');
};

const handle: HttpHandler = (_req, res, { path, query }) => {
    const code = parseCode(path);

    const headers: Record<string, string | string[]> = {};
    const links = query.getAll('link');
    if (links.length > 0) headers['link'] = links;

    sendInformational(res, code, headers);

    if (getRemainingPath(path)) {
        return; // Chain continues to the next endpoint as the final response
    }

    const body = JSON.stringify({
        sent: { code, headers }
    }, null, 2);
    res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
    });
    res.end(body);
};

export const informational: HttpEndpoint = {
    matchPath: (path) => {
        if (!path.startsWith(PREFIX)) return false;
        const code = parseCode(path);
        if (isNaN(code)) {
            throw new StatusError(400, `Invalid status code in ${path}`);
        }
        if (!isSupportedInformationalCode(code)) {
            throw new StatusError(400,
                `${code} is not a 1xx informational status code. ` +
                `Use any code in 100-199 except 101 (which is reserved for protocol upgrades).`
            );
        }
        return true;
    },
    handle,
    getRemainingPath,
    meta: {
        path: '/info/{code}',
        description:
            'Sends a 1xx informational response (100, 102, or 103) before the final response. ' +
            'Supports all codes except 101 which is reserved for protocol upgrades (e.g. websockets). ' +
            'Use `?link=...` (repeatable) to attach Link headers for testing 103 Early Hints. ' +
            'Chains with other endpoints: e.g. /info/103/status/404 sends 103 then 404.',
        examples: [
            '/info/102',
            '/info/103?link=%3C/style.css%3E;rel=preload;as=style',
            '/info/110/info/199/echo'
        ],
        group: httpCustomResponses
    }
};
