import * as crypto from 'crypto';
import { StatusError } from '@httptoolkit/util';
import { HttpEndpoint } from '../http-index.js';
import { httpDynamicData } from '../groups.js';

const MAX_BYTES = 102400; // 100KB

const parseN = (path: string): number => {
    const n = parseInt(path.slice('/stream-bytes/'.length), 10);
    if (isNaN(n) || n < 0) throw new StatusError(400, `Invalid byte count in ${path}`);
    if (n > MAX_BYTES) throw new StatusError(400, `Byte count exceeds maximum of ${MAX_BYTES}`);
    return n;
};

export const streamBytesEndpoint: HttpEndpoint = {
    matchPath: (path) => {
        if (!path.match(/^\/stream-bytes\/\d+$/)) return false;
        parseN(path);
        return true;
    },
    handle: (_req, res, { path, query }) => {
        const n = parseN(path);
        const chunkSize = Math.max(1, parseInt(query.get('chunk_size') || '10240', 10));
        const seed = query.get('seed');

        res.writeHead(200, { 'content-type': 'application/octet-stream' });

        let remaining = n;
        let counter = 0;
        while (remaining > 0) {
            const size = Math.min(remaining, chunkSize);
            let chunk: Buffer;

            if (seed !== null) {
                const parts: Buffer[] = [];
                let partRemaining = size;
                while (partRemaining > 0) {
                    const hash = crypto.createHash('sha256')
                        .update(`${seed}:${counter++}`)
                        .digest();
                    parts.push(hash.subarray(0, Math.min(partRemaining, hash.length)));
                    partRemaining -= hash.length;
                }
                chunk = Buffer.concat(parts, size);
            } else {
                chunk = crypto.randomBytes(size);
            }

            (res as NodeJS.WritableStream).write(chunk);
            remaining -= size;
        }
        res.end();
    },
    meta: {
        path: '/stream-bytes/{n}',
        description: 'Streams n random bytes in chunks. Supports optional "chunk_size" (default 10240) and "seed" query parameters.',
        examples: ['/stream-bytes/1024'],
        group: httpDynamicData
    }
};
