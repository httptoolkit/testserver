import { METHODS } from 'http';
import { HttpEndpoint, HttpHandler } from '../http-index.js';
import { buildHttpBinAnythingEndpoint } from '../../httpbin-compat.js';

const nonGetMethods = METHODS.filter(method => method !== 'GET');

const methodHandler: HttpHandler = (req, res, { path }) => {
    const requiredMethod = path.slice(1).toUpperCase();
    if (requiredMethod !== req.method) {
        res.writeHead(405);
        res.end('Method Not Allowed');
        return;
    }

    const fields = requiredMethod === 'GET'
        ? ["url", "args", "headers", "origin"]
        : ["url", "args", "form", "data", "origin", "headers", "files", "json"];

    return buildHttpBinAnythingEndpoint({ fieldFilter: fields })(req, res);
};

export const getMethodEndpoint: HttpEndpoint = {
    matchPath: (path: string) => path.slice(1).toUpperCase() === 'GET',
    handle: methodHandler
};

export const nonGetMethodEndpoint: HttpEndpoint = {
    matchPath: (path: string) => nonGetMethods.includes(path.slice(1).toUpperCase()),
    handle: methodHandler
}