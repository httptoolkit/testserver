import * as net from 'net';
import * as tls from 'tls';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("Client certificate (mTLS) endpoint", () => {

    let server: DestroyableServer;
    let port: number;

    beforeEach(async () => {
        server = makeDestroyable(await createTestServer());
        await new Promise<void>((resolve) => server.listen(resolve));
        port = (server.address() as net.AddressInfo).port;
    });
    afterEach(async () => { await server.destroy(); });

    // In TLS 1.3 the client finishes its side (and fires 'secureConnect') before the server
    // rejects a missing/untrusted client cert, so we confirm the connection by actually
    // exchanging data: a real request gets a response; a rejected one errors first.
    const tlsOutcome = (servername: string, extra: tls.ConnectionOptions = {}) =>
        new Promise<'connected' | 'rejected'>((resolve) => {
            const conn = tls.connect({ port, host: '127.0.0.1', servername, rejectUnauthorized: false, ...extra });
            conn.on('secureConnect', () => conn.write(`GET / HTTP/1.1\r\nHost: ${servername}\r\nConnection: close\r\n\r\n`));
            conn.on('data', () => { conn.destroy(); resolve('connected'); });
            conn.on('error', () => resolve('rejected'));
        });

    it("rejects a connection with no client certificate", async () => {
        expect(await tlsOutcome('client-cert.localhost')).to.equal('rejected');
    });

    it("does not require a client certificate on other endpoints", async () => {
        expect(await tlsOutcome('localhost')).to.equal('connected');
    });

    it("serves a downloadable client identity as PEM", async () => {
        const res = await fetch(`http://127.0.0.1:${port}/tls/certs/client-cert`);
        expect(res.status).to.equal(200);
        expect(res.headers.get('content-type')).to.equal('application/x-pem-file');
        const pem = await res.text();
        expect(pem).to.include('BEGIN CERTIFICATE');
        expect(pem).to.include('PRIVATE KEY');
    });

    it("accepts a connection presenting the downloadable client certificate", async () => {
        const pem = await (await fetch(`http://127.0.0.1:${port}/tls/certs/client-cert`)).text();
        const cert = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)![0];
        const key = pem.match(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/)![0];

        expect(await tlsOutcome('client-cert.localhost', { cert, key })).to.equal('connected');
    });
});
