import { HttpHandler } from '../../http-index.js';

const matchPath = (path: string) => path === '/error/reset';

const handle: HttpHandler = async (req) => {
    req.socket.resetAndDestroy();
}

export const resetEndpoint = {
    matchPath,
    handle
};