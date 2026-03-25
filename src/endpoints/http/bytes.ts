import * as crypto from 'crypto';
import { StatusError } from '@httptoolkit/util';
import { HttpEndpoint } from '../http-index.js';
import { httpDynamicData } from '../groups.js';

const MAX_BYTES = 102400; // 100KB

const parseN = (path: string): number => {
    const n = parseInt(path.slice('/bytes/'.length), 10);
    if (isNaN(n) || n < 0) throw new StatusError(400, `Invalid byte count in ${path}`);
    if (n > MAX_BYTES) throw new StatusError(400, `Byte count exceeds maximum of ${MAX_BYTES}`);
    return n;
};

export const bytesEndpoint: HttpEndpoint = {
    matchPath: (path) => {
        if (!path.match(/^\/bytes\/\d+$/)) return false;
        parseN(path);
        return true;
    },
    handle: (_req, res, { path, query }) => {
        const n = parseN(path);
        const seed = query.get('seed');

        let data: Buffer;
        if (seed !== null) {
            // Seeded: use seed to generate deterministic bytes via hash chaining
            const chunks: Buffer[] = [];
            let remaining = n;
            let counter = 0;
            while (remaining > 0) {
                const hash = crypto.createHash('sha256')
                    .update(`${seed}:${counter++}`)
                    .digest();
                chunks.push(hash.subarray(0, Math.min(remaining, hash.length)));
                remaining -= hash.length;
            }
            data = Buffer.concat(chunks, n);
        } else {
            data = crypto.randomBytes(n);
        }

        res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-length': n.toString()
        });
        res.end(data);
    },
    meta: {
        path: '/bytes/{n}',
        description: 'Returns n random bytes. Supports an optional "seed" query parameter for deterministic output.',
        examples: ['/bytes/1024'],
        group: httpDynamicData
    }
};
