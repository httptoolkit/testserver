import { serializeJson } from '../../util.js';
import { HttpEndpoint, HttpHandler, HttpRequest } from '../http-index.js';
import { httpAuthentication } from '../groups.js';

export const checkBasicAuth = (req: HttpRequest, username: string, password: string): boolean => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return false;

    const expectedAuth = Buffer.from(`${username}:${password}`).toString('base64');
    const [authType, authValue] = authHeader.split(' ');
    return authType === 'Basic' && authValue === expectedAuth;
};

const matchPath = (path: string) =>
    !!path.match(/^\/basic-auth\/([^\/]+)\/([^\/]+)$/);

const handle: HttpHandler = (req, res, { path }) => {
    const [username, password] = path.split('/').slice(2);

    if (!req.headers['authorization']) {
        res.writeHead(401, {
            'www-authenticate': 'Basic realm="Fake Realm"'
        }).end();
        return;
    }

    if (checkBasicAuth(req, username, password)) {
        res.writeHead(200, {
            'content-type': 'application/json'
        });
        res.end(serializeJson({
            "authenticated": true,
            "user": username
        }));
        return;
    }

    res.writeHead(403).end();
    return;
}

export const basicAuth: HttpEndpoint = {
    matchPath,
    handle,
    meta: {
        path: '/basic-auth/{username}/{password}',
        description: 'Challenges with HTTP Basic Auth, expecting the username & password from the URL. Returns 200 with user info on success, 401 if unauthenticated, 403 if wrong credentials.',
        examples: ['/basic-auth/admin/secret'],
        group: httpAuthentication
    }
};
