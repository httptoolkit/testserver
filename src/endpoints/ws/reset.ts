import { WebSocketEndpoint } from '../ws-index.js';

export const wsResetEndpoint: WebSocketEndpoint = {
    matchPath: (path) => path === '/ws/error/reset',
    handle: (ws) => {
        // @ts-ignore - accessing internal socket
        const socket = ws._socket;
        socket?.destroy();
    }
};
