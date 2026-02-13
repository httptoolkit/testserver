import { WebSocketEndpoint } from '../ws-index.js';

export const wsEchoEndpoint: WebSocketEndpoint = {
    matchPath: (path) => path === '/ws/echo',
    handle: (ws) => {
        ws.on('message', (data, isBinary) => {
            if (ws.readyState === ws.OPEN) {
                ws.send(data, { binary: isBinary });
            }
        });
    }
};
