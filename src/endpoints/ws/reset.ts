import { WebSocketEndpoint } from '../ws-index.js';
import { wsErrors } from '../groups.js';

export const wsResetEndpoint: WebSocketEndpoint = {
    matchPath: (path) => path === '/ws/error/reset',
    handle: (ws) => {
        // @ts-ignore - accessing internal socket
        const socket = ws._socket;
        socket?.destroy();
    },
    meta: {
        path: '/ws/error/reset',
        description: 'Destroys the WebSocket connection abruptly without a proper close handshake.',
        examples: ['/ws/error/reset'],
        group: wsErrors
    }
};
