import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';

export interface WebSocketEndpoint {
    matchPath: (path: string, hostnamePrefix?: string) => boolean;
    handle: (ws: WebSocket, req: IncomingMessage, options: {
        path: string;
        query: URLSearchParams;
    }) => void;
}

export * from './ws/echo.js';
