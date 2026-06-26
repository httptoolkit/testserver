import * as crypto from 'node:crypto';

import {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    paginateListObjectsV2
} from '@aws-sdk/client-s3';

import { ChallengeStore } from '../dns-server.js';
import { S3Config, createS3Client, httpStatus } from './s3-cert-store.js';

// Validation windows are seconds long; the TTL only exists to self-clean records left
// behind by an issuance that failed before it could remove its own challenge.
const CHALLENGE_TTL_MS = 1000 * 60 * 10;

interface StoredChallenge {
    fqdn: string;
    value: string;
    expiry: number;
}

function hash(value: string): string {
    return crypto.hash('sha256', value, 'hex').slice(0, 32);
}

/**
 * Shares pending ACME DNS-01 challenge records across servers via S3, so a validation
 * query that the proxy load-balances to any machine can be answered regardless of which
 * machine is performing the issuance. One object per (fqdn, value) pair, so concurrent
 * issuances of the same name keep their own records instead of clobbering each other.
 */
export class S3ChallengeStore implements ChallengeStore {

    private readonly client: S3Client;
    private readonly bucket: string;
    private readonly prefix: string;

    constructor(config: S3Config, private ttlMs: number = CHALLENGE_TTL_MS) {
        this.bucket = config.bucket;
        this.prefix = config.prefix ?? 'acme-challenges/';
        this.client = createS3Client(config);
    }

    private fqdnPrefix(fqdn: string): string {
        return `${this.prefix}${hash(fqdn.toLowerCase())}/`;
    }

    private objectKey(fqdn: string, value: string): string {
        return `${this.fqdnPrefix(fqdn)}${hash(value)}.json`;
    }

    async set(fqdn: string, value: string): Promise<void> {
        const record: StoredChallenge = { fqdn, value, expiry: Date.now() + this.ttlMs };
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: this.objectKey(fqdn, value),
            Body: JSON.stringify(record),
            ContentType: 'application/json'
        }));
    }

    async remove(fqdn: string, value: string): Promise<void> {
        // DeleteObject is idempotent - a missing key still returns success.
        await this.client.send(new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: this.objectKey(fqdn, value)
        }));
    }

    async get(fqdn: string): Promise<string[]> {
        const keys: string[] = [];
        for await (const page of paginateListObjectsV2(
            { client: this.client },
            { Bucket: this.bucket, Prefix: this.fqdnPrefix(fqdn) }
        )) {
            for (const obj of page.Contents ?? []) {
                if (obj.Key) keys.push(obj.Key);
            }
        }

        const records = await Promise.all(keys.map(async (key) => {
            try {
                const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
                const body = await res.Body?.transformToString();
                return body ? JSON.parse(body) as StoredChallenge : undefined;
            } catch (e) {
                if (httpStatus(e) === 404) return undefined; // Raced with a concurrent removal
                throw e;
            }
        }));

        const now = Date.now();
        return records
            .filter((r): r is StoredChallenge => !!r && r.expiry > now)
            .map((r) => r.value);
    }
}
