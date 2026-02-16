import { WebSocketEndpoint } from '../ws-index.js';
import { wsMessaging } from '../groups.js';

export const wsEchoEndpoint: WebSocketEndpoint = {
    matchPath: (path) => path === '/ws/echo',
    handle: (ws) => {
        ws.on('message', (data, isBinary) => {
            if (ws.readyState === ws.OPEN) {
                ws.send(data, { binary: isBinary });
            }
        });
    },
    meta: {
        path: '/ws/echo',
        description: 'Echoes back any messages received.',
        examples: ['/ws/echo'],
        group: wsMessaging
    }
};
