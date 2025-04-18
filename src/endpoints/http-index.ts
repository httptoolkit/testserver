import { MaybePromise } from '@httptoolkit/util';
import * as http from 'http';

export type HttpHandler = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    options: {
        path: string;
        query: URLSearchParams;
        handleRequest: (req: http.IncomingMessage, res: http.ServerResponse) => void;
    }
) => MaybePromise<void>;

export interface HttpEndpoint {
    matchPath: (path: string) => boolean;
    handle: HttpHandler;
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
export * from './http/basic-auth.js';
export * from './http/json.js';
export * from './http/trailers.js';
export * from './http/error/close.js';
export * from './http/error/reset.js';