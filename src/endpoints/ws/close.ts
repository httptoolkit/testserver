import { StatusError } from '@httptoolkit/util';
import { WebSocketEndpoint } from '../ws-index.js';

const parseCloseCode = (path: string): number => {
    if (path === '/ws/close') return 1000;
    return parseInt(path.slice('/ws/close/'.length), 10);
};

export const wsCloseEndpoint: WebSocketEndpoint = {
    matchPath: (path) => {
        if (!path.startsWith('/ws/close/') && path !== '/ws/close') return false;
        const code = parseCloseCode(path);
        if (isNaN(code) || code < 1000 || code > 4999) {
            throw new StatusError(400, `Invalid WebSocket close code: ${code}`);
        }
        return true;
    },
    handle: (ws, req, { path, query }) => {
        const code = parseCloseCode(path);
        const reason = query.get('reason') ?? undefined;
        ws.close(code, reason);
    }
};
