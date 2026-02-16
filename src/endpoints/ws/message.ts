import { WebSocketEndpoint } from '../ws-index.js';
import { wsMessaging } from '../groups.js';

const matchPath = (path: string) => path.startsWith('/ws/message/');

const getRemainingPath = (path: string): string | undefined => {
    const idx = path.indexOf('/', '/ws/message/'.length);
    return idx !== -1 ? '/ws' + path.slice(idx) : undefined;
};

const parseMessage = (path: string): string => {
    const idx = path.indexOf('/', '/ws/message/'.length);
    const end = idx !== -1 ? idx : path.length;
    return decodeURIComponent(path.slice('/ws/message/'.length, end));
};

export const wsMessageEndpoint: WebSocketEndpoint = {
    matchPath,
    getRemainingPath,
    handle: (ws, req, { path }) => {
        const message = parseMessage(path);
        if (ws.readyState === ws.OPEN) {
            ws.send(message);
        }
    },
    meta: {
        path: '/ws/message/{text}',
        description: 'Sends the specified message to the client upon connection. Can be chained with other WS endpoints.',
        examples: ['/ws/message/hello', '/ws/message/hello/echo'],
        group: wsMessaging
    }
};
