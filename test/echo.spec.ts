import * as net from 'net';
import * as tls from 'tls';
import * as http2 from 'http2';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("Echo endpoint", () => {

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

    it("echoes an HTTP request", async () => {
        const address = `http://localhost:${serverPort}/echo`;
        const response = await fetch(address, {
            headers: {
                'test-HEADER': 'abc'
            }
        });

        expect(response.status).to.equal(200);

        const rawBody = await response.text();
        expect(rawBody).to.equal(
`GET /echo HTTP/1.1
host: localhost:${serverPort}
connection: keep-alive
test-HEADER: abc
accept: */*
accept-language: *
sec-fetch-mode: cors
user-agent: node
accept-encoding: gzip, deflate

`.replace(/\n/g, '\r\n')
        );
    });

    describe("HTTP/2", () => {

        it("returns NDJSON with frame data for HTTP/2 requests", async () => {
            const client = http2.connect(`http://localhost:${serverPort}`);

            const req = client.request({
                ':path': '/echo',
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
            expect(headers['content-type']).to.equal('text/plain');

            const lines = body.trim().split('\n');
            const frames = lines.map(line => JSON.parse(line));

            // Should have at least one SETTINGS frame (global) and HEADERS frame (stream)
            const settingsFrames = frames.filter((f: any) => f.type === 'SETTINGS');
            const headersFrames = frames.filter((f: any) => f.type === 'HEADERS');

            expect(settingsFrames.length).to.be.greaterThan(0);
            expect(headersFrames.length).to.be.greaterThan(0);

            // Check SETTINGS frame structure
            const settingsFrame = settingsFrames[0];
            expect(settingsFrame.stream_id).to.equal(0);
            expect(settingsFrame).to.have.property('flags');
            expect(settingsFrame).to.have.property('length');
            expect(settingsFrame).to.have.property('payload_hex');

            // Check HEADERS frame has decoded headers
            const headersFrame = headersFrames.find((f: any) => f.decoded_headers);
            expect(headersFrame).to.exist;
            expect(headersFrame.stream_id).to.be.greaterThan(0);
            expect(headersFrame.decoded_headers).to.have.property(':path', '/echo');
            expect(headersFrame.decoded_headers).to.have.property('test-header', 'test-value');
        });

        it("includes DATA frames for POST requests with body", async () => {
            const client = http2.connect(`http://localhost:${serverPort}`);

            const req = client.request({
                ':path': '/echo',
                ':method': 'POST',
                'content-type': 'text/plain'
            });

            req.write('Hello, HTTP/2!');
            req.end();

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

            // Should have DATA frames
            const dataFrames = frames.filter((f: any) => f.type === 'DATA');
            expect(dataFrames.length).to.be.greaterThan(0);

            // DATA frame should have payload
            const dataFrame = dataFrames[0];
            expect(dataFrame.stream_id).to.be.greaterThan(0);
            expect(dataFrame.payload_hex).to.equal(Buffer.from('Hello, HTTP/2!').toString('hex'));
        });

    });

    describe("HTTP/1.1 pipelining", () => {

        it("rejects pipelined echo request when it's the second request", async () => {
            const host = `localhost:${serverPort}`;
            const request1 = `GET /status/200 HTTP/1.1\r\nHost: ${host}\r\n\r\n`;
            const request2 = `GET /echo HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;

            const socket = tls.connect({
                host: 'localhost',
                port: serverPort,
                servername: 'http1.localhost',
                rejectUnauthorized: false
            });

            await new Promise<void>((resolve) => socket.on('secureConnect', resolve));

            // Send both requests at once (pipelined)
            socket.write(request1 + request2);

            const response = await new Promise<string>((resolve) => {
                const chunks: Buffer[] = [];
                socket.on('data', (chunk) => chunks.push(chunk));
                socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
            });

            socket.destroy();

            // Parse the two responses (filter empty strings from split)
            const responses = response.split(/(?=HTTP\/1\.1)/).filter(r => r.length > 0);
            expect(responses.length).to.equal(2);

            // First response should be 200 from /status/200
            expect(responses[0]).to.include('HTTP/1.1 200');

            // Second response (echo) should be 400 because pipelining is detected
            const echoResponse = responses[1];
            expect(echoResponse).to.include('HTTP/1.1 400');
            expect(echoResponse).to.include('pipelining');
        });

        it("rejects pipelined echo request when it's the first request", async () => {
            const host = `localhost:${serverPort}`;
            const request1 = `GET /echo HTTP/1.1\r\nHost: ${host}\r\n\r\n`;
            const request2 = `GET /status/200 HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;

            const socket = tls.connect({
                host: 'localhost',
                port: serverPort,
                servername: 'http1.localhost',
                rejectUnauthorized: false
            });

            await new Promise<void>((resolve) => socket.on('secureConnect', resolve));

            // Send both requests at once (pipelined)
            socket.write(request1 + request2);

            const response = await new Promise<string>((resolve) => {
                const chunks: Buffer[] = [];
                socket.on('data', (chunk) => chunks.push(chunk));
                socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
            });

            socket.destroy();

            // First response (echo) should be 400 because pipelining is detected
            expect(response).to.include('HTTP/1.1 400');
            expect(response).to.include('pipelining');
        });

        it("rejects both pipelined echo requests", async () => {
            const host = `localhost:${serverPort}`;
            const request1 = `GET /echo HTTP/1.1\r\nHost: ${host}\r\n\r\n`;
            const request2 = `GET /echo HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;

            const socket = tls.connect({
                host: 'localhost',
                port: serverPort,
                servername: 'http1.localhost',
                rejectUnauthorized: false
            });

            await new Promise<void>((resolve) => socket.on('secureConnect', resolve));
            socket.write(request1 + request2);

            const response = await new Promise<string>((resolve) => {
                const chunks: Buffer[] = [];
                socket.on('data', (chunk) => chunks.push(chunk));
                socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
            });

            socket.destroy();

            // Both echo requests should return 400 due to pipelining
            const responses = response.split(/(?=HTTP\/1\.1)/).filter(r => r.length > 0);
            expect(responses.length).to.equal(2);
            expect(responses[0]).to.include('HTTP/1.1 400');
            expect(responses[0]).to.include('pipelining');
            expect(responses[1]).to.include('HTTP/1.1 400');
            expect(responses[1]).to.include('pipelining');
        });

        it("works correctly with sequential requests on keep-alive connection", async () => {
            const host = `localhost:${serverPort}`;

            const socket = tls.connect({
                host: 'localhost',
                port: serverPort,
                servername: 'http1.localhost',
                rejectUnauthorized: false
            });

            await new Promise<void>((resolve) => socket.on('secureConnect', resolve));

            // Send first request and wait for response
            const request1 = `GET /status/200 HTTP/1.1\r\nHost: ${host}\r\n\r\n`;
            socket.write(request1);

            // Wait for first response
            const response1 = await new Promise<string>((resolve) => {
                let data = '';
                const onData = (chunk: Buffer) => {
                    data += chunk.toString();
                    // Check if we have a complete response (ends with \r\n\r\n for no body)
                    if (data.includes('\r\n\r\n')) {
                        socket.removeListener('data', onData);
                        resolve(data);
                    }
                };
                socket.on('data', onData);
            });

            expect(response1).to.include('HTTP/1.1 200');

            // Now send second request (echo)
            const request2 = `GET /echo HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;
            socket.write(request2);

            const response2 = await new Promise<string>((resolve) => {
                const chunks: Buffer[] = [];
                socket.on('data', (chunk) => chunks.push(chunk));
                socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
            });

            socket.destroy();

            // Echo should work and return the raw request
            expect(response2).to.include('HTTP/1.1 200');
            expect(response2).to.include('GET /echo HTTP/1.1');
        });

    });

});