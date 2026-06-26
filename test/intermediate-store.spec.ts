import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { expect } from 'chai';

import { LocalCA, generateCACertificate } from '../src/tls-certificates/local-ca.js';
import { FilesystemCertStore } from '../src/tls-certificates/fs-cert-store.js';

describe("LocalCA intermediate persistence", () => {

    let ca: { key: string, cert: string };
    let dir: string;

    before(async () => { ca = await generateCACertificate(); });

    beforeEach(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), 'intermediate-'));
    });
    afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

    it("generates a fresh intermediate each time without a store", async () => {
        const a = await LocalCA.create(ca);
        const b = await LocalCA.create(ca);
        expect(await a.getIntermediateCertificatePem())
            .to.not.equal(await b.getIntermediateCertificatePem());
    });

    it("reuses the stored intermediate across separate instances", async () => {
        const first = await LocalCA.create(ca, new FilesystemCertStore(dir));
        const pem = await first.getIntermediateCertificatePem();

        // A separate instance + backend over the same store loads the same intermediate:
        const second = await LocalCA.create(ca, new FilesystemCertStore(dir));
        expect(await second.getIntermediateCertificatePem()).to.equal(pem);
    });

    it("signs leaf certs with the shared intermediate", async () => {
        const store = new FilesystemCertStore(dir);
        const first = await LocalCA.create(ca, store);
        const pem = await first.getIntermediateCertificatePem();

        const second = await LocalCA.create(ca, new FilesystemCertStore(dir));
        const leaf = await second.generateCertificate('example.com', {});

        // The served chain (leaf -> intermediate -> root) carries the shared intermediate:
        expect(leaf.cert).to.include(pem.trimEnd());
    });

    it("keeps a distinct intermediate per root CA", async () => {
        const store = new FilesystemCertStore(dir);
        const forFirstRoot = await LocalCA.create(ca, store);
        const firstPem = await forFirstRoot.getIntermediateCertificatePem();

        const otherCa = await generateCACertificate();
        const forOtherRoot = await LocalCA.create(otherCa, store);
        expect(await forOtherRoot.getIntermediateCertificatePem()).to.not.equal(firstPem);
    });
});
