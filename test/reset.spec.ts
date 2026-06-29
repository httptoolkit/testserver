import * as net from 'net';
import * as http from 'http';
import * as tls from 'tls';
import * as http2 from 'http2';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("Reset endpoint", () => {

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

    it("resets the connection", async () => {
        const address = `http://localhost:${serverPort}/error/reset`;
        const request = http.request(address).end();
        const result = await new Promise<any>((resolve, reject) => {
            request.on('error', resolve);
            request.on('response', () => reject(new Error('Expected an error')));
        });

        expect(result.code).to.equal('ECONNRESET');
        expect(result.message).to.equal('read ECONNRESET');
    });

    it("resets the connection over TLS (HTTP/1.1)", async () => {
        const socket = tls.connect({
            port: serverPort,
            host: 'localhost',
            servername: 'localhost',
            rejectUnauthorized: false,
            ALPNProtocols: ['http/1.1']
        });
        await new Promise<void>((resolve, reject) => {
            socket.once('secureConnect', resolve);
            socket.once('error', reject);
        });
        socket.write('GET /error/reset HTTP/1.1\r\nHost: localhost\r\n\r\n');

        const result = await new Promise<NodeJS.ErrnoException>((resolve, reject) => {
            socket.on('error', resolve);
            socket.on('data', () => reject(new Error('Expected a reset, got a response')));
        });

        expect(result.code).to.equal('ECONNRESET');
    });

    const http2ResetOutcome = async (
        origin: string,
        options: http2.SecureClientSessionOptions = {}
    ): Promise<'reset' | 'response'> => {
        const client = http2.connect(origin, options);
        try {
            return await new Promise<'reset' | 'response'>((resolve) => {
                const reset = () => resolve('reset');
                client.on('error', reset);
                client.on('close', reset);
                const req = client.request({ ':path': '/error/reset' });
                req.on('response', () => resolve('response'));
                req.on('error', reset);
                req.on('close', reset);
                req.end();
            });
        } finally {
            client.destroy();
        }
    };

    it("resets the connection over HTTP/2 (cleartext)", async () => {
        expect(await http2ResetOutcome(`http://localhost:${serverPort}`)).to.equal('reset');
    });

    it("resets the connection over HTTP/2 (TLS)", async () => {
        expect(await http2ResetOutcome(`https://localhost:${serverPort}`, {
            rejectUnauthorized: false,
            servername: 'localhost',
            ALPNProtocols: ['h2']
        })).to.equal('reset');
    });

});
