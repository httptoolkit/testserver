import * as net from 'net';
import * as http2 from 'http2';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("Delay endpoint", () => {

    let server: DestroyableServer;
    let serverPort: number;

    beforeEach(async () => {
        server = makeDestroyable(await createServer({
            domain: 'localhost'
        }));
        await new Promise<void>((resolve) => server.listen(resolve));
        serverPort = (server.address() as net.AddressInfo).port;
    });

    afterEach(async () => {
        await server.destroy();
    });

    it("delays then returns httpbin-style response", async () => {
        const start = Date.now();
        const response = await fetch(`http://localhost:${serverPort}/delay/0.1`);
        const elapsed = Date.now() - start;

        expect(response.status).to.equal(200);
        expect(elapsed).to.be.greaterThan(90);

        const body = await response.json();
        expect(body).to.have.property('url');
        expect(body).to.have.property('headers');
    });

    it("rejects invalid delay values", async () => {
        const response = await fetch(`http://localhost:${serverPort}/delay/notanumber`);
        expect(response.status).to.equal(400);
    });

    it("forwards to /status endpoint", async () => {
        const response = await fetch(`http://localhost:${serverPort}/delay/0.05/status/201`);
        expect(response.status).to.equal(201);
    });

    it("rejects excessively deep chains", async () => {
            const deepPath = '/delay/0.001'.repeat(15) + '/status/200';
            const response = await fetch(`http://localhost:${serverPort}${deepPath}`);
            expect(response.status).to.equal(400);
        });

    describe("forwarding to /echo", () => {

        it("echoes HTTP/1 request data after delay", async () => {
            const response = await fetch(`http://localhost:${serverPort}/delay/0.05/echo`, {
                headers: { 'test-header': 'test-value' }
            });

            expect(response.status).to.equal(200);

            const rawBody = await response.text();
            // Raw data reflects what was actually sent by the client
            expect(rawBody).to.include('GET /delay/0.05/echo HTTP/1.1');
            expect(rawBody).to.include('test-header: test-value');
        });

        it("echoes HTTP/2 request data after delay", async () => {
            const client = http2.connect(`http://localhost:${serverPort}`);

            const req = client.request({
                ':path': '/delay/0.05/echo',
                ':method': 'GET',
                'test-header': 'test-value'
            });

            const [headers, body] = await new Promise<[http2.IncomingHttpHeaders, string]>((resolve, reject) => {
                let headers: http2.IncomingHttpHeaders;
                const chunks: Buffer[] = [];

                req.on('response', (h) => { headers = h; });
                req.on('data', (chunk) => chunks.push(chunk));
                req.on('end', () => resolve([headers, Buffer.concat(chunks).toString()]));
                req.on('error', reject);
            });

            client.close();

            expect(headers[':status']).to.equal(200);

            const lines = body.trim().split('\n');
            const frames = lines.map(line => JSON.parse(line));

            const headersFrames = frames.filter((f: any) => f.type === 'HEADERS' && f.decoded_headers);
            expect(headersFrames.length).to.be.greaterThan(0);
            expect(headersFrames[0].decoded_headers).to.have.property('test-header', 'test-value');
        });

        it("chains multiple delays before /echo with raw data preserved", async () => {
            const start = Date.now();

            const response = await fetch(`http://localhost:${serverPort}/delay/0.1/delay/0.1/echo`, {
                headers: { 'chain-test': 'multi-delay' }
            });

            expect(response.status).to.equal(200);
            expect(Date.now() - start).to.be.greaterThan(200);

            const rawBody = await response.text();
            // Raw data reflects what was actually sent by the client
            expect(rawBody).to.include('GET /delay/0.1/delay/0.1/echo HTTP/1.1');
            expect(rawBody).to.include('chain-test: multi-delay');
        });

    });

});
