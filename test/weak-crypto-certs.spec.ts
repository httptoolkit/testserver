import * as net from 'net';
import * as tls from 'tls';

import { expect } from 'chai';
import * as x509 from '@peculiar/x509';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("Weak-crypto certificate endpoints", () => {

    let server: DestroyableServer;
    let port: number;

    beforeEach(async () => {
        server = makeDestroyable(await createTestServer());
        await new Promise<void>((resolve) => server.listen(resolve));
        port = (server.address() as net.AddressInfo).port;
    });
    afterEach(async () => { await server.destroy(); });

    const connect = (servername: string, extra: tls.ConnectionOptions = {}) =>
        new Promise<tls.TLSSocket>((resolve, reject) => {
            const conn = tls.connect({ port, host: '127.0.0.1', servername, rejectUnauthorized: false, ...extra });
            conn.on('secureConnect', () => resolve(conn));
            conn.on('error', reject);
        });

    it("sha1-sig serves a certificate signed with SHA-1", async () => {
        // A client enforcing security level 1 rejects this as too weak a signature digest.
        const conn = await connect('sha1-sig.localhost');
        const raw = conn.getPeerCertificate(true).raw;
        conn.destroy();

        const cert = new x509.X509Certificate(raw);
        expect(cert.signatureAlgorithm.hash.name).to.equal('SHA-1');
    });

    it("combines sha1-sig with a cipher endpoint that also needs a lowered security level", async () => {
        // Both need security level 0; previously their two @SECLEVEL=0 cipher strings conflicted.
        const conn = await connect('sha1-sig--cbc.localhost', {
            ciphers: 'ECDHE-RSA-AES128-SHA:AES128-SHA@SECLEVEL=0'
        });
        const raw = conn.getPeerCertificate(true).raw;
        const cipher = conn.getCipher().name;
        conn.destroy();

        const cert = new x509.X509Certificate(raw);
        expect(cert.signatureAlgorithm.hash.name).to.equal('SHA-1');
        expect(cipher).to.equal('ECDHE-RSA-AES128-SHA');
    });
});
