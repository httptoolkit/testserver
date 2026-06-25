import {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    paginateListObjectsV2
} from '@aws-sdk/client-s3';

import {
    CertStoreBackend,
    CachedCertificate,
    certObjectId,
    parseStoredCertificate
} from './cert-cache.js';

export interface S3Config {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    prefix?: string; // optional key prefix, e.g. 'certs/'
}

function httpStatus(e: unknown): number | undefined {
    return (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

export class S3CertStore implements CertStoreBackend {

    private readonly client: S3Client;
    private readonly bucket: string;
    private readonly prefix: string;

    constructor(config: S3Config) {
        this.bucket = config.bucket;
        this.prefix = config.prefix ?? '';
        this.client = new S3Client({
            endpoint: config.endpoint,
            region: config.region,
            credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
            forcePathStyle: true,
            // Don't add or require integrity checksums, for non-AWS compatibility
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED'
        });
    }

    private objectKey(cacheKey: string): string {
        return `${this.prefix}${certObjectId(cacheKey)}.json`;
    }

    async readAll(): Promise<CachedCertificate[]> {
        const keys: string[] = [];
        for await (const page of paginateListObjectsV2(
            { client: this.client },
            { Bucket: this.bucket, Prefix: this.prefix }
        )) {
            for (const obj of page.Contents ?? []) {
                if (obj.Key) keys.push(obj.Key);
            }
        }

        const certs = await Promise.all(keys.map(async (key) => {
            try {
                const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
                const body = await res.Body?.transformToString();
                return body ? parseStoredCertificate(body) : undefined;
            } catch (e) {
                console.log(`Could not load cert object ${key}:`, e);
                return undefined;
            }
        }));

        return certs.filter((c): c is CachedCertificate => !!c);
    }

    async read(cacheKey: string): Promise<CachedCertificate | undefined> {
        try {
            const res = await this.client.send(new GetObjectCommand({
                Bucket: this.bucket,
                Key: this.objectKey(cacheKey)
            }));
            const body = await res.Body?.transformToString();
            return body ? parseStoredCertificate(body) : undefined;
        } catch (e) {
            if (httpStatus(e) === 404) return undefined;
            throw e;
        }
    }

    async write(cert: CachedCertificate): Promise<void> {
        await this.put(cert, false);
    }

    writeIfAbsent(cert: CachedCertificate): Promise<boolean> {
        return this.put(cert, true);
    }

    private async put(cert: CachedCertificate, onlyIfAbsent: boolean): Promise<boolean> {
        try {
            await this.client.send(new PutObjectCommand({
                Bucket: this.bucket,
                Key: this.objectKey(cert.cacheKey),
                Body: JSON.stringify(cert),
                ContentType: 'application/json',
                ...(onlyIfAbsent ? { IfNoneMatch: '*' } : {})
            }));
            return true;
        } catch (e) {
            if (onlyIfAbsent && httpStatus(e) === 412) return false;
            throw e;
        }
    }

    async delete(cacheKey: string): Promise<void> {
        // DeleteObject is idempotent - a missing key still returns success.
        await this.client.send(new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: this.objectKey(cacheKey)
        }));
    }
}
