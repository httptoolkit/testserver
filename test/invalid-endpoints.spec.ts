import * as net from 'net';
import * as tls from 'tls';
import * as http from 'http';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("Invalid endpoint hostnames", () => {

    let server: DestroyableServer;
    let port: number;

    beforeEach(async () => {
        server = makeDestroyable(await createTestServer());
        await new Promise<void>((resolve) => server.listen(resolve));
        port = (server.address() as net.AddressInfo).port;
    });
    afterEach(async () => { await server.destroy(); });

    const tlsOutcome = (servername: string) => new Promise<'connected' | 'rejected'>((resolve) => {
        const conn = tls.connect({ port, host: '127.0.0.1', servername, rejectUnauthorized: false });
        conn.on('secureConnect', () => { conn.destroy(); resolve('connected'); });
        conn.on('error', () => { conn.destroy(); resolve('rejected'); });
        conn.on('close', () => resolve('rejected'));
    });

    const httpStatus = (host: string, path = '/') => new Promise<number>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
            res.resume();
            resolve(res.statusCode!);
        });
        req.on('error', reject);
        req.end();
    });

    const wsUpgradeStatus = (host: string) => new Promise<number>((resolve, reject) => {
        const sock = net.connect(port, '127.0.0.1');
        let buf = '';
        sock.on('connect', () => sock.write(
            `GET /ws/echo HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`
        ));
        sock.on('data', (d) => {
            buf += d.toString();
            const match = buf.match(/^HTTP\/1\.1 (\d+)/);
            if (match) { sock.destroy(); resolve(Number(match[1])); }
        });
        sock.on('error', reject);
    });

    // An unknown subdomain and a duplicate/conflicting combination are both unservable, and
    // are rejected identically: TLS resets the handshake, plain HTTP and WebSocket get a 400.
    for (const host of ['not-a-real-endpoint', 'expired--expired']) {
        it(`hard-closes the TLS handshake for '${host}.*'`, async () => {
            expect(await tlsOutcome(`${host}.localhost`)).to.equal('rejected');
        });

        it(`returns a 400 for plain HTTP to '${host}.*'`, async () => {
            expect(await httpStatus(`${host}.localhost`)).to.equal(400);
        });

        it(`returns a 400 for a WebSocket upgrade to '${host}.*'`, async () => {
            expect(await wsUpgradeStatus(`${host}.localhost`)).to.equal(400);
        });
    }

    it("still redirects a valid TLS-only endpoint over plain HTTP (not a 400)", async () => {
        expect(await httpStatus('expired.localhost')).to.equal(301);
    });

    it("accepts a WebSocket upgrade to a valid endpoint hostname", async () => {
        expect(await wsUpgradeStatus('http1.localhost')).to.equal(101);
    });
});
