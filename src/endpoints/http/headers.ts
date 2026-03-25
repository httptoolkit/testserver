import { HttpEndpoint } from '../http-index.js';
import { httpRequestInspection } from '../groups.js';
import { buildHttpBinAnythingEndpoint } from '../../httpbin-compat.js';

export const headers: HttpEndpoint = {
    matchPath: (path) => path === '/headers',
    handle: buildHttpBinAnythingEndpoint({ fieldFilter: ['headers'] }),
    meta: {
        path: '/headers',
        description: 'Returns the request headers as JSON.',
        examples: ['/headers'],
        group: httpRequestInspection
    }
};

