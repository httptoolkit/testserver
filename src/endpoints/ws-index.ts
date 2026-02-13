import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';

export interface WebSocketEndpoint {
    /** Return true to match, false to skip, or throw StatusError for invalid params. */
    matchPath: (path: string, hostnamePrefix?: string) => boolean;
    getRemainingPath?: (path: string) => string | undefined;
    handle: (ws: WebSocket, req: IncomingMessage, options: {
        path: string;
        query: URLSearchParams;
    }) => void | Promise<void>;
}

export * from './ws/echo.js';
export * from './ws/delay.js';
export * from './ws/close.js';
export * from './ws/message.js';
export * from './ws/reset.js';
export * from './ws/repeat.js';
