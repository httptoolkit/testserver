import { WebSocketEndpoint } from '../ws-index.js';

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
    }
};
