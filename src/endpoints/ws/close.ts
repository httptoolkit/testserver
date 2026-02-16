import { StatusError } from '@httptoolkit/util';
import { WebSocketEndpoint } from '../ws-index.js';
import { wsConnection } from '../groups.js';

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
    },
    meta: {
        path: '/ws/close/{code}',
        description: 'Closes the WebSocket connection with the specified close code (1000-4999). Optional reason via query parameter.',
        examples: ['/ws/close', '/ws/close/1001', '/ws/close/4000?reason=custom'],
        group: wsConnection
    }
};
