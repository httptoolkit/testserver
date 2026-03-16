import { TlsEndpoint } from '../tls-index.js';

export const example: TlsEndpoint = {
    sniPart: 'example',
    plainTextAllowed: true,
    meta: {
        path: 'example',
        description: 'An example subdomain that serves an exact copy of the classic example.com page as the root page (instead of these docs).',
        examples: ['https://example.testserver.host/']
    }
};