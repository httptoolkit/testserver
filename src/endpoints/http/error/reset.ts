import { HttpHandler } from '../../http-index.js';
import { httpErrors } from '../../groups.js';

const matchPath = (path: string) => path === '/error/reset';

const handle: HttpHandler = async (req) => {
    req.socket.resetAndDestroy();
}

export const resetEndpoint = {
    matchPath,
    handle,
    meta: {
        path: '/error/reset',
        description: 'Resets the connection (sends a TCP RST) without sending a response.',
        examples: ['/error/reset'],
        group: httpErrors
    }
};