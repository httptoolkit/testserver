import { HttpEndpoint } from '../http-index.js';
import { buildHttpBinAnythingEndpoint } from '../../httpbin-compat.js';

export const anything: HttpEndpoint = {
    matchPath: (path) => path === '/anything' || path.startsWith('/anything/'),
    handle: buildHttpBinAnythingEndpoint({}),
    meta: {
        path: '/anything',
        description: 'Returns JSON containing the parsed details of the request, including method, url, headers, args, data, files, form, and origin.',
        examples: ['/anything', '/anything/subpath']
    }
};