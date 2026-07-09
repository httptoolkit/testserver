import * as net from 'net';
import * as tls from 'tls';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("RSA key-size endpoints", function () {
    // 8192-bit key generation takes a couple of seconds, so allow generous time.
    this.timeout(30000);

    let server: DestroyableServer;
    let port: number;

    beforeEach(async () => {
        server = makeDestroyable(await createTestServer());
        await new Promise<void>((resolve) => server.listen(resolve));
        port = (server.address() as net.AddressInfo).port;
    });
    afterEach(async () => { await server.destroy(); });

    const servedKeyBits = (servername: string, extra: tls.ConnectionOptions = {}) =>
        new Promise<number>((resolve, reject) => {
            const conn = tls.connect({ port, host: '127.0.0.1', servername, rejectUnauthorized: false, ...extra });
            conn.on('secureConnect', () => {
                const bits = conn.getPeerCertificate().bits;
                conn.destroy();
                resolve(bits);
            });
            conn.on('error', reject);
        });

    // rsa512 is too small to sign in TLS 1.3, so the endpoint caps at TLS 1.2 + RSA key exchange;
    // the client must allow the weak cipher (SECLEVEL=0) to connect, which is the lax case a
    // security-level-1 client would reject as "ee key too small".
    it("rsa512 serves a 512-bit key over TLS 1.2", async () => {
        expect(await servedKeyBits('rsa512.localhost', { ciphers: 'AES128-SHA@SECLEVEL=0' })).to.equal(512);
    });

    for (const bits of [1024, 2048, 4096, 8192]) {
        it(`rsa${bits} serves a ${bits}-bit key`, async () => {
            expect(await servedKeyBits(`rsa${bits}.localhost`)).to.equal(bits);
        });
    }
});
