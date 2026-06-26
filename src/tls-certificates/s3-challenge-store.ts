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
        const now = Date.now();
        const entries = await this.listRecords(this.fqdnPrefix(fqdn));
        return entries
            .map((e) => e.record)
            .filter((r): r is StoredChallenge => !!r && r.expiry > now)
            .map((r) => r.value);
    }

    async reapExpired(): Promise<void> {
        const now = Date.now();
        const entries = await this.listRecords(this.prefix);
        await Promise.all(entries
            .filter(({ record }) => !record || record.expiry <= now)
            .map(({ key }) => this.client.send(new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: key
            })))
        );
    }

    private async listRecords(
        prefix: string
    ): Promise<Array<{ key: string, record: StoredChallenge | undefined }>> {
        const keys: string[] = [];
        for await (const page of paginateListObjectsV2(
            { client: this.client },
            { Bucket: this.bucket, Prefix: prefix }
        )) {
            for (const obj of page.Contents ?? []) {
                if (obj.Key) keys.push(obj.Key);
            }
        }

        return Promise.all(keys.map(async (key) => ({
            key,
            record: await this.readRecord(key)
        })));
    }

    private async readRecord(key: string): Promise<StoredChallenge | undefined> {
        let body: string | undefined;
        try {
            const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
            body = await res.Body?.transformToString();
        } catch (e) {
            if (httpStatus(e) === 404) return undefined; // Raced with a concurrent removal
            throw e;
        }
        if (!body) return undefined;
        try {
            return JSON.parse(body) as StoredChallenge;
        } catch {
            return undefined; // Corrupt - treat as absent, so reapExpired clears it
        }
    }
}
