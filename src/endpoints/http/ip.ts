import { HttpEndpoint } from '../http-index.js';
import { buildHttpBinAnythingEndpoint } from '../../httpbin-compat.js';

export const ip: HttpEndpoint = {
    matchPath: (path) => path === '/ip',
    handle: buildHttpBinAnythingEndpoint({ fieldFilter: ['origin'] }),
    meta: {
        path: '/ip',
        description: 'Returns the client\'s IP address.',
        examples: ['/ip']
    }
}