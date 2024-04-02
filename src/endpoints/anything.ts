import _ from 'lodash';
import * as http from 'http';
import * as streamConsumers from 'stream/consumers';

import * as querystring from 'querystring';
import * as multipart from 'parse-multipart-data';
import { TLSSocket } from 'tls';

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

const getFiles = (body: Buffer, req: http.IncomingMessage) => {
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
export async function anythingEndpoint(req: http.IncomingMessage, res: http.ServerResponse) {
    const input = await streamConsumers.buffer(req); // Wait for all request data

    const isHTTPS = req.socket instanceof TLSSocket;
    const url = new URL(req.url as string, `${isHTTPS ? 'https' : 'http'}://${req.headers.host}`);

    let jsonValue: any = null;
    try {
        jsonValue = JSON.parse(input.toString('utf8'));
    } catch (e) {}

    const contentType = req.headers['content-type'];

    const result = {
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
        origin: req.socket.remoteAddress,
        url: url.toString()
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
}