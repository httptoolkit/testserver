import { HttpEndpoint } from '../http-index.js';
import { buildHttpBinAnythingEndpoint } from '../../httpbin-compat.js';

export const headers: HttpEndpoint = {
    matchPath: (path) => path === '/headers',
    handle: buildHttpBinAnythingEndpoint({ fieldFilter: ['headers'] })
};

