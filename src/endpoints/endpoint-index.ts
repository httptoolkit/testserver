import * as httpIndex from './http-index.js';
import * as tlsIndex from './tls-index.js';

export const httpEndpoints: Array<httpIndex.HttpEndpoint & { name: string }> = Object.entries(httpIndex)
    .map(([key, value]) => ({ ...value, name: key }));

export const tlsEndpoints: Array<tlsIndex.TlsEndpoint & { name: string }> = Object.entries(tlsIndex)
    .map(([key, value]) => ({ ...value, name: key }));