import * as httpIndex from './http-index.js';

export const httpEndpoints: Array<httpIndex.HttpEndpoint & { name: string }> = Object.entries(httpIndex)
    .map(([key, value]) => ({ ...value, name: key }));
