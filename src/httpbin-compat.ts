import _ from 'lodash';
import * as stream from 'stream';
import * as streamConsumers from 'stream/consumers';

import * as querystring from 'querystring';
import * as multipart from 'parse-multipart-data';

import * as http2 from 'http2';
import { TLSSocket } from 'tls';
import { serializeJson } from './util.js';
import { HttpRequest, HttpResponse } from './endpoints/http-index.js';
import { PROXY_PROTOCOL, type ProxyProtocolData } from './proxy-protocol.js';

interface OriginSocket {
    remoteAddress?: string;
    [PROXY_PROTOCOL]?: ProxyProtocolData;
}

// Get the underlying connection socket for a request. For HTTP/1, req.socket is the real socket.
// For HTTP/2, Node wraps non-Socket streams (like our DataCapturingStream) in a JSStreamSocket.
// JSStreamSocket doesn't expose remoteAddress or custom symbol properties, but its .stream
// property points back to our original DataCapturingStream which has both.
function getConnectionSocket(req: HttpRequest): OriginSocket {
    if (req.httpVersion === '2.0') {
        const sessionSocket = (req as http2.Http2ServerRequest).stream?.session?.socket;
        // JSStreamSocket (internal Node class) stores the wrapped stream as .stream
        const innerStream = (sessionSocket as typeof sessionSocket & { stream?: stream.Duplex })?.stream;
        if (innerStream) return innerStream as stream.Duplex & OriginSocket;
        if (sessionSocket) return sessionSocket;
    }
    return req.socket;
}

const utf8Decoder = new TextDecoder('utf8', { fatal: true });

// Matches json_safe in httpbin
const asJsonSafeString = (data: Buffer, contentType: string = 'application/octet-stream') => {
    try {
        return utf8Decoder.decode(data);
    } catch (e) {
        return `data:${
            contentType
        };base64,${
            data.toString('base64')
        }`
    }
}

const entriesToMultidict = (entries: Array<[string, string]>) =>
    entries.reduce((result, [k, v]) => {
        const currentValue = result[k];
        if (currentValue === undefined) {
            result[k] = v;
        } else if (Array.isArray(currentValue)) {
            currentValue.push(v);
        } else {
            result[k] = [currentValue, v];
        }

        return result;
    }, {} as { [key: string]: string | Array<string> });

// Matches Flask's req.args multi-dict values
const getUrlArgs = (url: URL) => entriesToMultidict([...url.searchParams.entries()]);

const getFiles = (body: Buffer, req: HttpRequest) => {
    const contentType = req.headers["content-type"];
    if (!contentType?.includes("multipart/form-data")) return {};

    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type#boundary
    // `boundary` is required for multipart entities.
    const boundary = contentType.match(/;\s*boundary=(\S+)/);
    if (!boundary) return {};

    const fileParts = multipart.parse(body, boundary[1]);

    return entriesToMultidict(fileParts.map((part) => {
        const contentType = part.type;
        return [part.name ?? '', asJsonSafeString(part.data, contentType)];
    }));
}

// This endpoint returns the request details in a convenient JSON format for analysis. The format
// aims to exactly match the output of httpbin.org (https://github.com/postmanlabs/httpbin/) for
// interoperability since this is widely used (and it's generally a reasonable format for this).
export const buildHttpBinAnythingEndpoint = (options: {
    fieldFilter?: string[]
}) => async (req: HttpRequest, res: HttpResponse) => {
    const input = await streamConsumers.buffer(req); // Wait for all request data

    const isHTTPS = req.socket instanceof TLSSocket;
    const url = new URL(req.url as string, `${isHTTPS ? 'https' : 'http'}://${
        req.headers[':authority'] || req.headers.host
    }`);

    let jsonValue: any = null;
    try {
        jsonValue = JSON.parse(input.toString('utf8'));
    } catch (e) {}

    const contentType = req.headers['content-type'];

    // Get client IP - prefer PROXY protocol data if available, fall back to socket address.
    // The PROXY_PROTOCOL symbol is propagated through TLS and HTTP/2 wrapper layers.
    const socket = getConnectionSocket(req);
    const rawOrigin = socket[PROXY_PROTOCOL]?.sourceAddress
        ?? socket.remoteAddress;

    const origin = rawOrigin?.replace(/^::ffff:/, ''); // Drop IPv6 wrapper of IPv4 addresses

    let result: {} = {
        args: getUrlArgs(url),
        data: asJsonSafeString(input, contentType),
        files: getFiles(input, req),
        form: contentType?.startsWith('application/x-www-form-urlencoded')
            ? querystring.parse(input.toString('utf8'))
            : {},
        headers: _.fromPairs(Object.entries(req.headers).map(([k, v]) =>
            [k.split('-').map(kp =>
                kp[0].toUpperCase() + kp.slice(1)
            ).join('-'), v]
        ).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)),
        json: jsonValue,
        method: req.method,
        origin: origin,
        url: url.toString()
    };

    if (options.fieldFilter) {
        result = _.pick(result, options.fieldFilter)
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(serializeJson(result));
}