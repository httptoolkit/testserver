import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { expect } from 'chai';

import { S3CertStore } from '../src/tls-certificates/s3-cert-store.js';
import { FilesystemCertStore } from '../src/tls-certificates/fs-cert-store.js';
import { CachedCertificate, CertStoreBackend, PersistentCertCache } from '../src/tls-certificates/cert-cache.js';
import { startS3Mock, S3Mock } from './s3-mock.js';
import { createTestServer } from './test-helpers.js';

const makeCert = (cacheKey: string, domain = cacheKey): CachedCertificate => ({
    cacheKey,
    domain,
    key: `key-${cacheKey}`,
    cert: `cert-${cacheKey}`,
    expiry: Date.now() + 1_000_000
});

async function until(check: () => Promise<boolean>, timeout = 2000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('Condition not met within timeout');
}

// The filesystem backend is entirely our own code, so it gets the full contract.
describe("FilesystemCertStore", () => {

    let dir: string;
    let backend: FilesystemCertStore;

    beforeEach(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), 'certstore-'));
        backend = new FilesystemCertStore(dir);
    });
    afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

    it("writes and reads back a certificate", async () => {
        await backend.write(makeCert('a.example'));
        expect((await backend.read('a.example'))?.cert).to.equal('cert-a.example');
    });

    it("returns undefined for a missing certificate", async () => {
        expect(await backend.read('missing.example')).to.equal(undefined);
    });

    it("overwrites on a plain write", async () => {
        await backend.write(makeCert('a.example'));
        await backend.write({ ...makeCert('a.example'), cert: 'updated' });
        expect((await backend.read('a.example'))?.cert).to.equal('updated');
    });

    it("writeIfAbsent only writes when absent", async () => {
        expect(await backend.writeIfAbsent(makeCert('a.example'))).to.equal(true);
        expect(await backend.writeIfAbsent({ ...makeCert('a.example'), cert: 'second' })).to.equal(false);
        expect((await backend.read('a.example'))?.cert).to.equal('cert-a.example');
    });

    it("deletes a certificate", async () => {
        await backend.write(makeCert('a.example'));
        await backend.delete('a.example');
        expect(await backend.read('a.example')).to.equal(undefined);
    });

    it("treats deleting a missing certificate as a no-op", async () => {
        await backend.delete('missing.example');
    });

    it("readAll returns every stored certificate", async () => {
        const keys = ['a', 'b', 'c'];
        for (const k of keys) await backend.write(makeCert(`${k}.example`));
        const all = await backend.readAll();
        expect(all.map((c) => c.cacheKey).sort()).to.deep.equal(keys.map((k) => `${k}.example`));
    });
});

// The S3 backend's PUT/GET/DELETE/LIST semantics belong to the SDK; here we only cover the
// logic we add on top: that the client config actually reaches the store, our key/JSON
// handling round-trips, and that we map a missing object / failed conditional write.
describe("S3CertStore", () => {

    let mock: S3Mock;
    let backend: S3CertStore;

    beforeEach(async () => {
        mock = await startS3Mock();
        backend = new S3CertStore(mock.config);
    });
    afterEach(async () => { await mock.close(); });

    it("round-trips a certificate through the SDK client", async () => {
        await backend.write(makeCert('a.example'));
        expect((await backend.read('a.example'))?.cert).to.equal('cert-a.example');
    });

    it("maps a missing object to undefined", async () => {
        expect(await backend.read('missing.example')).to.equal(undefined);
    });

    it("writeIfAbsent reports false when the object already exists", async () => {
        expect(await backend.writeIfAbsent(makeCert('a.example'))).to.equal(true);
        expect(await backend.writeIfAbsent({ ...makeCert('a.example'), cert: 'second' })).to.equal(false);
        expect((await backend.read('a.example'))?.cert).to.equal('cert-a.example');
    });

    it("readAll returns every stored certificate", async () => {
        const keys = ['a', 'b', 'c'];
        for (const k of keys) await backend.write(makeCert(`${k}.example`));
        const all = await backend.readAll();
        expect(all.map((c) => c.cacheKey).sort()).to.deep.equal(keys.map((k) => `${k}.example`));
    });
});

// Cache behaviour is backend-agnostic, so exercise it over the filesystem backend.
describe("PersistentCertCache", () => {

    let dir: string;
    let backend: FilesystemCertStore;

    beforeEach(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), 'certcache-'));
        backend = new FilesystemCertStore(dir);
    });
    afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

    it("serves getCert synchronously from memory and persists to the backend", async () => {
        const cache = new PersistentCertCache(backend);
        cache.cacheCert(makeCert('a.example'));

        expect(cache.getCert('a.example')?.cert).to.equal('cert-a.example'); // sync, in-memory
        await until(async () => !!(await backend.read('a.example'))); // persisted async

        const fresh = new PersistentCertCache(backend);
        await fresh.loadCache();
        expect(fresh.getCert('a.example')?.cert).to.equal('cert-a.example');
    });

    it("read-through fetchCert picks up a cert another server wrote", async () => {
        await backend.write(makeCert('shared.example')); // 'another server'
        const cache = new PersistentCertCache(backend);

        expect(cache.getCert('shared.example')).to.equal(undefined); // not warmed
        expect((await cache.fetchCert('shared.example'))?.cert).to.equal('cert-shared.example');
        expect(cache.getCert('shared.example')?.cert).to.equal('cert-shared.example'); // now cached
    });

    it("clearCache removes from memory and the backend", async () => {
        const cache = new PersistentCertCache(backend);
        cache.cacheCert(makeCert('a.example'));
        await until(async () => !!(await backend.read('a.example')));

        cache.clearCache('a.example');
        expect(cache.getCert('a.example')).to.equal(undefined);
        await until(async () => (await backend.read('a.example')) === undefined);
    });
});

describe("PersistentCertCache resilience to store failures", () => {

    const failingBackend = (): CertStoreBackend => {
        const fail = async (): Promise<never> => { throw new Error('store unavailable'); };
        return { readAll: fail, read: fail, write: fail, writeIfAbsent: fail, delete: fail };
    };

    it("propagates a backend read error from fetchCert (not masked as a cache miss)", async () => {
        const cache = new PersistentCertCache(failingBackend());

        let error: unknown;
        try { await cache.fetchCert('x.example'); } catch (e) { error = e; }
        expect(error).to.be.instanceOf(Error); // i.e. NOT silently undefined
    });

    it("starts with an empty cache when the store is unreadable, without throwing", async () => {
        const cache = new PersistentCertCache(failingBackend());

        await cache.loadCache(); // must not throw
        expect(cache.getCert('x.example')).to.equal(undefined);
    });
});

describe("cert store selection", () => {
    it("rejects configuring both a cache directory and an S3 store", async () => {
        let error: unknown;
        try {
            await createTestServer({
                certCacheDir: os.tmpdir(),
                certStoreS3: {
                    endpoint: 'http://s3.example', region: 'auto', bucket: 'b',
                    accessKeyId: 'k', secretAccessKey: 's'
                }
            });
        } catch (e) {
            error = e;
        }
        expect(String(error)).to.match(/both a local cert cache|only one of/i);
    });
});
