import { HttpHandler } from '../../http-index.js';
const matchPath = (path: string) => path === '/error/close';

const handle: HttpHandler = async (req) => {
    req.socket.end();
}

export const closeEndpoint = {
    matchPath,
    handle
};