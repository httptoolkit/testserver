import { HttpEndpoint } from '../http-index.js';
import { buildHttpBinAnythingEndpoint } from '../../httpbin-compat.js';

export const anything: HttpEndpoint = {
    matchPath: (path) => path === '/anything' || path.startsWith('/anything/'),
    handle: buildHttpBinAnythingEndpoint({}),
};