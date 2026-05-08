import { MaybePromise } from '@httptoolkit/util';
import * as http from 'http';
import * as http2 from 'http2';

import { EndpointMeta, EndpointGroup } from './groups.js';
export type { EndpointMeta, EndpointGroup };

export type HttpRequest = http.IncomingMessage | http2.Http2ServerRequest;
// The @types/node v24 writeHead overloads diverged between http and http2, breaking
// union-type calls. We intersect with a compatible signature so call sites can use it.
export type HttpResponse = (http.ServerResponse | http2.Http2ServerResponse) & {
    writeHead(statusCode: number, headers?: http.OutgoingHttpHeaders): HttpResponse;
    writeHead(statusCode: number, statusMessage: string, headers?: http.OutgoingHttpHeaders): HttpResponse;
};

export type HttpHandler = (
    req: HttpRequest,
    res: HttpResponse,
    options: {
        path: string;
        query: URLSearchParams;
    }
) => MaybePromise<void>;

export interface HttpEndpoint {
    matchPath: (path: string, hostnamePrefix: string | undefined) => boolean;
    handle: HttpHandler;
    needsRawData?: boolean;
    getRemainingPath?: (path: string) => string | undefined;
    meta?: EndpointMeta;
}

export * from './http/echo.js';
export * from './http/status.js';
export * from './http/anything.js';
export * from './http/ip.js';
export * from './http/methods.js';
export * from './http/headers.js';
export * from './http/user-agent.js';
export * from './http/robots.txt.js';
export * from './http/delay.js';
export * from './http/cookies.js'
export { basicAuth } from './http/basic-auth.js';
export * from './http/json.js';
export * from './http/xml.js';
export * from './http/trailers.js';
export * from './http/error/close.js';
export * from './http/error/reset.js';
export * from './http/example-page.js';
export * from './http/version.js';
export * from './http/encoding/gzip.js';
export * from './http/encoding/deflate.js';
export * from './http/encoding/zstd.js';
export * from './http/encoding/brotli.js';
export * from './http/encoding/identity.js';
export * from './http/tls-fingerprint.js';
export * from './http/tls-client-hello.js';
export * from './http/uuid.js';
export * from './http/deny.js';
export * from './http/html.js';
export * from './http/encoding/utf8.js';
export * from './http/bearer.js';
export * from './http/hidden-basic-auth.js';
export * from './http/response-headers.js';
export * from './http/base64.js';
export * from './http/cache.js';
export * from './http/etag.js';
export * from './http/redirect.js';
export * from './http/bytes.js';
export * from './http/stream.js';
export * from './http/stream-bytes.js';
export * from './http/informational.js';
