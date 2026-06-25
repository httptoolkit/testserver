import * as net from 'net';
import * as tls from 'tls';
import * as crypto from 'node:crypto';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("TLS certificate downloads", () => {

    let server: DestroyableServer;
    let serverPort: number;

    beforeEach(async () => {
        server = makeDestroyable(await createTestServer());
        await new Promise<void>((resolve) => server.listen(resolve));
        serverPort = (server.address() as net.AddressInfo).port;
    });

    afterEach(async () => {
        await server.destroy();
    });

    const download = (name: string) => fetch(`http://localhost:${serverPort}/tls/certs/${name}`);

    it("serves the untrusted root CA as a single-format PEM download", async () => {
        const res = await download('untrusted-root');

        expect(res.status).to.equal(200);
        expect(res.headers.get('content-type')).to.equal('application/x-x509-ca-cert');
        expect(res.headers.get('content-disposition')).to.equal('attachment; filename="testserver-untrusted-root.pem"');

        const cert = new crypto.X509Certificate(await res.text());
        expect(cert.ca).to.equal(true);
    });

    it("serves the intermediate CA, issued by the root", async () => {
        const root = new crypto.X509Certificate(await (await download('untrusted-root')).text());
        const intermediate = new crypto.X509Certificate(await (await download('intermediate')).text());

        expect(intermediate.ca).to.equal(true);
        expect(intermediate.issuer).to.equal(root.subject);
        expect(intermediate.subject).to.not.equal(root.subject);
    });

    it("serves a self-signed certificate (issuer equals subject, not a CA)", async () => {
        const cert = new crypto.X509Certificate(await (await download('self-signed')).text());

        expect(cert.subject).to.equal(cert.issuer);
        expect(cert.ca).to.equal(false);
    });

    it("404s for unknown certificate names", async () => {
        const res = await download('does-not-exist');
        expect(res.status).to.equal(404);
    });

    it("serves the root that actually anchors the served chain", async () => {
        const downloadedRoot = new crypto.X509Certificate(await (await download('untrusted-root')).text());

        const chain = await new Promise<string[]>((resolve, reject) => {
            const conn = tls.connect({ port: serverPort, servername: 'localhost', rejectUnauthorized: false });
            conn.on('secureConnect', () => {
                const fingerprints: string[] = [];
                let cert = conn.getPeerCertificate(true);
                const seen = new Set<string>();
                while (cert?.fingerprint256 && !seen.has(cert.fingerprint256)) {
                    seen.add(cert.fingerprint256);
                    fingerprints.push(cert.fingerprint256);
                    if (!cert.issuerCertificate || seen.has(cert.issuerCertificate.fingerprint256)) break;
                    cert = cert.issuerCertificate;
                }
                resolve(fingerprints);
                conn.destroy();
            });
            conn.on('error', reject);
        });

        expect(chain).to.include(downloadedRoot.fingerprint256); // root anchors the chain
    });

});
