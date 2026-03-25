import { serializeJson } from '../../util.js';
import { HttpEndpoint } from '../http-index.js';
import { httpAuthentication } from '../groups.js';
import { checkBasicAuth } from './basic-auth.js';

export const hiddenBasicAuth: HttpEndpoint = {
    matchPath: (path) =>
        !!path.match(/^\/hidden-basic-auth\/([^\/]+)\/([^\/]+)$/),
    handle: (req, res, { path }) => {
        const [username, password] = path.split('/').slice(2);

        if (checkBasicAuth(req, username, password)) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(serializeJson({
                authenticated: true,
                user: username
            }));
            return;
        }

        res.writeHead(404).end();
    },
    meta: {
        path: '/hidden-basic-auth/{username}/{password}',
        description: 'Like /basic-auth but returns 404 instead of 401 on authentication failure.',
        examples: ['/hidden-basic-auth/admin/secret'],
        group: httpAuthentication
    }
};
