import { HttpEndpoint } from '../http-index.js';
import { httpDynamicData } from '../groups.js';

export const base64Decode: HttpEndpoint = {
    matchPath: (path) => path.startsWith('/base64/') && path.length > '/base64/'.length,
    handle: (_req, res, { path }) => {
        const encoded = path.slice('/base64/'.length);

        const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');

        try {
            const decoded = Buffer.from(normalized, 'base64');

            // Verify validity by round-tripping, since Buffer.from silently ignores invalid chars
            if (decoded.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
                throw new Error('Invalid base64');
            }

            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(decoded);
        } catch {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end('Incorrect Base64 data try: SGVsbG8gd29ybGQ= which decodes to: Hello world');
        }
    },
    meta: {
        path: '/base64/{value}',
        description: 'Decodes a base64url-encoded string and returns the decoded value.',
        examples: ['/base64/SGVsbG8gd29ybGQ='],
        group: httpDynamicData
    }
};
