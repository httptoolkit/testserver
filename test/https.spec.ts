import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';
import * as streamConsumers from 'stream/consumers';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("HTTPS requests", () => {

    let server: DestroyableServer;
    let serverPort: number;

    beforeEach(async () => {
        server = makeDestroyable(await createServer());
        await new Promise<void>((resolve) => server.listen(resolve));
        serverPort = (server.address() as net.AddressInfo).port;
    });

    afterEach(async () => {
        await server.destroy();
    });

    it("can connect successfully", async () => {
        const address = `https://localhost:${serverPort}/echo`;
        const request = https.get(address, {
            headers: {
                'test-HEADER': 'abc'
            },
            rejectUnauthorized: false // Needed as it's untrusted
        });

        const response = await new Promise<http.IncomingMessage>((resolve) =>
            request.on('response', resolve)
        );

        expect(response.statusCode).to.equal(200);

        const rawBody = await streamConsumers.text(response);
        expect(rawBody).to.equal(
`GET /echo HTTP/1.1
test-HEADER: abc
Host: localhost:${serverPort}
Connection: keep-alive

`.replace(/\n/g, '\r\n')
        );
    });

    it("cannot connect to no-tls.* connect successfully", async () => {
        const conn = tls.connect({
            port: serverPort,
            servername: 'no-tls.localhost',
            rejectUnauthorized: false // Needed as it's untrusted
        });

        const result = await new Promise<string>((resolve, reject) => {
            conn.on('secureConnect', () => resolve('Connected'));
            conn.on('error', (err) => resolve(`Failed: ${err.message}`));
        });
        conn.destroy();

        expect(result).to.equal('Failed: Client network socket disconnected before secure TLS connection was established');
    });

    it("negotiate http2 for http2.*", async () => {
        const conn = tls.connect({
            port: serverPort,
            servername: 'http2.localhost',
            ALPNProtocols: ['http/1.1', 'h2'],
            rejectUnauthorized: false // Needed as it's untrusted
        });

        const selectedProtocol = await new Promise<any>((resolve, reject) => {
            conn.on('secureConnect', () => resolve(conn.alpnProtocol));
            conn.on('error', reject);
        });
        conn.destroy();

        expect(selectedProtocol).to.equal('h2');
    });

    it("negotiate http1.1 for http1.*", async () => {
        const conn = tls.connect({
            port: serverPort,
            servername: 'http1.localhost',
            ALPNProtocols: ['h2', 'http/1.1'],
            rejectUnauthorized: false // Needed as it's untrusted
        });

        const selectedProtocol = await new Promise<any>((resolve, reject) => {
            conn.on('secureConnect', () => resolve(conn.alpnProtocol));
            conn.on('error', reject);
        });
        conn.destroy();

        expect(selectedProtocol).to.equal('http/1.1');
    });

    it("can use multiple SNI parts to control ALPN preference order", async () => {
        const conn = tls.connect({
            port: serverPort,
            servername: 'http2.http1.localhost',
            ALPNProtocols: ['http/1.1', 'h2'],
            rejectUnauthorized: false // Needed as it's untrusted
        });

        const selectedProtocol = await new Promise<any>((resolve, reject) => {
            conn.on('secureConnect', () => resolve(conn.alpnProtocol));
            conn.on('error', reject);
        });
        conn.destroy();

        expect(selectedProtocol).to.equal('h2');
    });

    it("overrides client ALPN preference if no preference is shown, unless forced", async () => {
        await Promise.all([
            { protocols: ['h2', 'http/1.1'], expected: 'http/1.1' },
            { protocols: ['http/1.1', 'h2'], expected: 'http/1.1' },
            { protocols: ['h2'], expected: 'h2' }
        ].map(async ({ protocols, expected }) => {
            const conn = tls.connect({
                port: serverPort,
                servername: 'localhost',
                ALPNProtocols: protocols,
                rejectUnauthorized: false // Needed as it's untrusted
            });

            const selectedProtocol = await new Promise<any>((resolve, reject) => {
                conn.on('secureConnect', () => resolve(conn.alpnProtocol));
                conn.on('error', reject);
            });
            conn.destroy();
            expect(selectedProtocol).to.equal(expected);
        }));
    });


});