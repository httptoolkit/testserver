import { serializeJson } from '../../util.js';
import { HttpEndpoint } from '../http-index.js';
import { httpAuthentication } from '../groups.js';

export const bearer: HttpEndpoint = {
    matchPath: (path) => path === '/bearer',
    handle: (req, res) => {
        const authHeader = req.headers['authorization'];

        const token = authHeader?.startsWith('Bearer ')
            ? authHeader.slice('Bearer '.length)
            : undefined;

        if (token) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(serializeJson({
                authenticated: true,
                token
            }));
            return;
        }

        res.writeHead(401, {
            'www-authenticate': 'Bearer'
        }).end();
    },
    meta: {
        path: '/bearer',
        description: 'Checks for a Bearer token in the Authorization header. Returns 200 with token info on success, 401 if missing.',
        examples: ['/bearer'],
        group: httpAuthentication
    }
};
