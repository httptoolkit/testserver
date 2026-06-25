import * as http from 'http';
import * as crypto from 'node:crypto';
import { AddressInfo } from 'net';

import { S3Config } from '../src/tls-certificates/s3-cert-store.js';

export interface S3Mock {
    config: S3Config;
    objects: Map<string, Buffer>;
    close: () => Promise<void>;
}

const xmlError = (code: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`;

/**
 * A tiny in-process, path-style S3 server: just the operations S3CertStore uses (GetObject,
 * PutObject incl. If-None-Match, DeleteObject, ListObjectsV2), over an in-memory map. It
 * speaks enough of the wire format (XML listings + S3 error bodies) for the AWS SDK client.
 */
export async function startS3Mock(): Promise<S3Mock> {
    const bucket = 'test-bucket';
    const objects = new Map<string, Buffer>();

    const server = http.createServer(async (req, res) => {
        try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const body = Buffer.concat(chunks);

            const url = new URL(req.url!, `http://${req.headers.host}`);
            const segments = url.pathname.split('/').filter(Boolean);
            if (segments[0] !== bucket) {
                res.writeHead(404); res.end(xmlError('NoSuchBucket')); return;
            }
            const key = segments.slice(1).join('/');

            // ListObjectsV2
            if (req.method === 'GET' && key === '' && url.searchParams.get('list-type') === '2') {
                const prefix = url.searchParams.get('prefix') ?? '';
                const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
                const xml = `<?xml version="1.0" encoding="UTF-8"?>` +
                    `<ListBucketResult>` +
                    keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('') +
                    `<IsTruncated>false</IsTruncated>` +
                    `</ListBucketResult>`;
                res.writeHead(200, { 'content-type': 'application/xml' });
                res.end(xml);
                return;
            }

            if (req.method === 'GET') {
                const obj = objects.get(key);
                if (!obj) { res.writeHead(404); res.end(xmlError('NoSuchKey')); return; }
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(obj);
                return;
            }

            if (req.method === 'PUT') {
                if (req.headers['if-none-match'] === '*' && objects.has(key)) {
                    res.writeHead(412); res.end(xmlError('PreconditionFailed')); return;
                }
                objects.set(key, body);
                res.writeHead(200, { etag: `"${crypto.createHash('md5').update(body).digest('hex')}"` });
                res.end();
                return;
            }

            if (req.method === 'DELETE') {
                objects.delete(key);
                res.writeHead(204); res.end();
                return;
            }

            res.writeHead(405); res.end();
        } catch (e) {
            res.writeHead(500); res.end(String(e));
        }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    return {
        config: {
            endpoint: `http://localhost:${port}`,
            region: 'auto',
            bucket,
            accessKeyId: 'test',
            secretAccessKey: 'test',
            prefix: 'certs/'
        },
        objects,
        close: () => new Promise<void>((resolve) => server.close(() => resolve()))
    };
}
