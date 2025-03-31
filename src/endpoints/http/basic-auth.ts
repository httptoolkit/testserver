import { HttpEndpoint, HttpHandler } from '../http-index.js';

const matchPath = (path: string) =>
    !!path.match(/^\/basic-auth\/([^\/]+)\/([^\/]+)$/);

const handle: HttpHandler = (req, res, { path }) => {
    const [username, password] = path.split('/').slice(2);
    const authHeader = req.headers['authorization'];

    if (authHeader === undefined) {
        res.writeHead(401, {
            'www-authenticate': 'Basic realm="Fake Realm"'
        }).end();
        return;
    }

    const expectedAuth = Buffer.from(`${username}:${password}`).toString('base64');
    const [authType, authValue] = authHeader.split(' ');
    if (authType === 'Basic' && authValue === expectedAuth) {
        res.writeHead(200, {
            'content-type': 'application/json'
        });
        res.end(JSON.stringify({
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
    handle
};