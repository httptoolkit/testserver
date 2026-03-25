import { StatusError } from '@httptoolkit/util';
import { HttpEndpoint, HttpRequest } from '../http-index.js';
import { httpRedirects } from '../groups.js';
import { TLSSocket } from 'tls';

const MAX_REDIRECTS = 100;

const getBaseUrl = (req: HttpRequest): string => {
    const isHTTPS = req.socket instanceof TLSSocket;
    const host = req.headers[':authority'] || req.headers.host;
    return `${isHTTPS ? 'https' : 'http'}://${host}`;
};

const parseN = (path: string, prefix: string): number => {
    const n = parseInt(path.slice(prefix.length), 10);
    if (isNaN(n) || n < 1) throw new StatusError(400, `Invalid redirect count in ${path}`);
    if (n > MAX_REDIRECTS) throw new StatusError(400, `Redirect count exceeds maximum of ${MAX_REDIRECTS}`);
    return n;
};

export const redirectTo: HttpEndpoint = {
    matchPath: (path) => path === '/redirect-to',
    handle: (req, res, { query }) => {
        const url = query.get('url');
        if (!url) {
            res.writeHead(400).end('Missing "url" query parameter');
            return;
        }

        const statusCode = parseInt(query.get('status_code') || '302', 10);
        res.writeHead(statusCode, { 'location': url }).end();
    },
    meta: {
        path: '/redirect-to',
        description: 'Redirects to the URL specified in the "url" query parameter, with an optional "status_code" (default 302).',
        examples: ['/redirect-to?url=/get', '/redirect-to?url=/get&status_code=301'],
        group: httpRedirects
    }
};

export const redirectN: HttpEndpoint = {
    matchPath: (path) => {
        if (!path.match(/^\/redirect\/\d+$/)) return false;
        parseN(path, '/redirect/');
        return true;
    },
    handle: (_req, res, { path }) => {
        const n = parseN(path, '/redirect/');
        const location = n <= 1 ? '/get' : `/relative-redirect/${n - 1}`;
        res.writeHead(302, { 'location': location }).end();
    },
    meta: {
        path: '/redirect/{n}',
        description: 'Redirects n times using relative URLs (via /relative-redirect), then returns /get.',
        examples: ['/redirect/3'],
        group: httpRedirects
    }
};

export const relativeRedirectN: HttpEndpoint = {
    matchPath: (path) => {
        if (!path.match(/^\/relative-redirect\/\d+$/)) return false;
        parseN(path, '/relative-redirect/');
        return true;
    },
    handle: (req, res, { path }) => {
        const n = parseN(path, '/relative-redirect/');
        const location = n <= 1 ? '/get' : `/relative-redirect/${n - 1}`;
        res.writeHead(302, { 'location': location }).end();
    },
    meta: {
        path: '/relative-redirect/{n}',
        description: 'Redirects n times using relative URLs, then returns /get.',
        examples: ['/relative-redirect/3'],
        group: httpRedirects
    }
};

export const absoluteRedirectN: HttpEndpoint = {
    matchPath: (path) => {
        if (!path.match(/^\/absolute-redirect\/\d+$/)) return false;
        parseN(path, '/absolute-redirect/');
        return true;
    },
    handle: (req, res, { path }) => {
        const n = parseN(path, '/absolute-redirect/');
        const base = getBaseUrl(req);
        const location = n <= 1 ? `${base}/get` : `${base}/absolute-redirect/${n - 1}`;
        res.writeHead(302, { 'location': location }).end();
    },
    meta: {
        path: '/absolute-redirect/{n}',
        description: 'Redirects n times using absolute URLs, then returns /get.',
        examples: ['/absolute-redirect/3'],
        group: httpRedirects
    }
};
