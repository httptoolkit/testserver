import * as net from 'net';
import * as tls from 'tls';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("TLS cipher endpoints", () => {

    let server: DestroyableServer;
    let port: number;

    beforeEach(async () => {
        server = makeDestroyable(await createTestServer());
        await new Promise<void>((resolve) => server.listen(resolve));
        port = (server.address() as net.AddressInfo).port;
    });
    afterEach(async () => { await server.destroy(); });

    // Offers the given legacy cipher (and, by not capping the version, TLS 1.3 too) so we can
    // check both that the endpoint negotiates the weak cipher AND that it caps at TLS 1.2.
    const negotiate = (servername: string, ciphers: string) =>
        new Promise<{ name: string, version: string | null }>((resolve, reject) => {
            const conn = tls.connect({
                port, host: '127.0.0.1', servername, rejectUnauthorized: false,
                ciphers: `${ciphers}@SECLEVEL=0`
            });
            conn.on('secureConnect', () => {
                const info = { name: conn.getCipher().name, version: conn.getProtocol() };
                conn.destroy();
                resolve(info);
            });
            conn.on('error', reject);
        });

    it("static-rsa negotiates an RSA-key-exchange suite over TLS 1.2", async () => {
        const { name, version } = await negotiate('static-rsa.localhost', 'AES128-GCM-SHA256:AES128-SHA');
        expect(version).to.equal('TLSv1.2');
        expect(name).to.match(/^AES(128|256)-/); // no ECDHE-/DHE- prefix => static RSA
    });

    it("cbc negotiates a CBC-mode suite over TLS 1.2", async () => {
        const { name, version } = await negotiate('cbc.localhost', 'ECDHE-RSA-AES128-SHA');
        expect(version).to.equal('TLSv1.2');
        expect(name).to.equal('ECDHE-RSA-AES128-SHA'); // -SHA (not -SHA256/-GCM) => CBC
    });

    it("null-cipher negotiates a NULL cipher over TLS 1.2", async () => {
        const { name, version } = await negotiate('null-cipher.localhost', 'NULL-SHA');
        expect(version).to.equal('TLSv1.2');
        expect(name).to.match(/NULL/);
    });

    it("weak-dh negotiates ephemeral DH over TLS 1.2", async () => {
        const { name, version } = await negotiate('weak-dh.localhost', 'DHE-RSA-AES128-SHA');
        expect(version).to.equal('TLSv1.2');
        expect(name).to.match(/^DHE-/);
    });

    it("refuses a client that won't offer the weak cipher", async () => {
        // A default modern client offers no NULL cipher, so it can't connect to null-cipher.
        const outcome = await new Promise<'connected' | 'failed'>((resolve) => {
            const conn = tls.connect({ port, host: '127.0.0.1', servername: 'null-cipher.localhost', rejectUnauthorized: false });
            conn.on('secureConnect', () => { conn.destroy(); resolve('connected'); });
            conn.on('error', () => resolve('failed'));
        });
        expect(outcome).to.equal('failed');
    });

    it("treats two cipher endpoints as a conflict", async () => {
        let rejected = false;
        await negotiate('static-rsa--null-cipher.localhost', 'AES128-SHA').catch(() => { rejected = true; });
        expect(rejected).to.equal(true);
    });
});
