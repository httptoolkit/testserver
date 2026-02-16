import { HttpHandler } from '../../http-index.js';
import { httpErrors } from '../../groups.js';

const matchPath = (path: string) => path === '/error/close';

const handle: HttpHandler = async (req) => {
    req.socket.end();
}

export const closeEndpoint = {
    matchPath,
    handle,
    meta: {
        path: '/error/close',
        description: 'Immediately closes the connection without sending a response.',
        examples: ['/error/close'],
        group: httpErrors
    }
};