import { expect } from 'chai';

import { s3ConfigFromEnv } from '../src/server.js';

const S3_ENV = [
    'CERT_STORE_S3_BUCKET',
    'AWS_ENDPOINT_URL_S3',
    'AWS_ENDPOINT_URL',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY'
];

describe("s3ConfigFromEnv", () => {

    let saved: Record<string, string | undefined>;

    beforeEach(() => {
        saved = {};
        for (const key of S3_ENV) {
            saved[key] = process.env[key];
            delete process.env[key];
        }
    });

    afterEach(() => {
        for (const key of S3_ENV) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    it("returns undefined when the bucket isn't set", () => {
        expect(s3ConfigFromEnv()).to.equal(undefined);
    });

    it("builds config from the standard AWS variables", () => {
        process.env.CERT_STORE_S3_BUCKET = 'my-bucket';
        process.env.AWS_ENDPOINT_URL_S3 = 'https://fly.storage.tigris.dev';
        process.env.AWS_ACCESS_KEY_ID = 'key';
        process.env.AWS_SECRET_ACCESS_KEY = 'secret';

        expect(s3ConfigFromEnv()).to.deep.equal({
            bucket: 'my-bucket',
            endpoint: 'https://fly.storage.tigris.dev',
            region: 'auto', // Defaulted
            accessKeyId: 'key',
            secretAccessKey: 'secret',
            prefix: 'certs/'
        });
    });

    it("throws when the bucket is set but the connection is incomplete", () => {
        process.env.CERT_STORE_S3_BUCKET = 'my-bucket';
        // No endpoint / credentials
        expect(() => s3ConfigFromEnv()).to.throw(/S3 connection is incomplete/i);
    });

});
