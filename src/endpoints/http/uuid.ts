import * as crypto from 'crypto';

import { serializeJson } from '../../util.js';
import { HttpEndpoint } from '../http-index.js';
import { httpDynamicData } from '../groups.js';

export const uuid: HttpEndpoint = {
    matchPath: (path) => path === '/uuid',
    handle: (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(serializeJson({ uuid: crypto.randomUUID() }));
    },
    meta: {
        path: '/uuid',
        description: 'Returns a randomly generated UUID v4.',
        examples: ['/uuid'],
        group: httpDynamicData
    }
};
