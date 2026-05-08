import * as net from 'net';
import * as http2 from 'http2';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("Response-headers endpoint", () => {

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

    it("sets response headers from query params", async () => {
        const response = await fetch(
            `http://localhost:${serverPort}/response-headers?X-Custom=hello`
        );
        expect(response.status).to.equal(200);
        expect(response.headers.get('x-custom')).to.equal('hello');

        const body = await response.json();
        expect(body).to.deep.equal({ 'X-Custom': 'hello' });
    });

    it("sets multiple different headers", async () => {
        const response = await fetch(
            `http://localhost:${serverPort}/response-headers?X-One=1&X-Two=2`
        );
        expect(response.status).to.equal(200);
        expect(response.headers.get('x-one')).to.equal('1');
        expect(response.headers.get('x-two')).to.equal('2');
    });

    it("handles repeated query params as multi-value headers", async () => {
        const response = await fetch(
            `http://localhost:${serverPort}/response-headers?X-Multi=a&X-Multi=b`
        );
        expect(response.status).to.equal(200);
        // HTTP headers with multiple values are typically joined by comma
        const header = response.headers.get('x-multi');
        expect(header).to.include('a');
        expect(header).to.include('b');
    });

    it("returns empty object with no query params", async () => {
        const response = await fetch(
            `http://localhost:${serverPort}/response-headers`
        );
        expect(response.status).to.equal(200);
        expect(await response.json()).to.deep.equal({});
    });

    it("returns duplicate single-value headers over HTTP/2", async () => {
        const client = http2.connect(`http://localhost:${serverPort}`, { strictSingleValueFields: false });
        try {
            const request = client.request({
                ':path': '/response-headers?X-Content-Type-Options=b&X-Content-Type-Options=c',
                ':method': 'GET'
            });
            request.end();

            const { status, rawHeaders } = await new Promise<{
                status: number,
                rawHeaders: string[]
            }>((resolve) =>
                request.on('response', (headers, _flags, rawHeaders) => resolve({
                    status: headers[':status'] as number,
                    rawHeaders
                }))
            );

            expect(status).to.equal(200);
            expect(rawHeaders).to.include.members(['x-content-type-options', 'b']);
            expect(rawHeaders).to.include.members(['x-content-type-options', 'c']);
        } finally {
            client.close();
        }
    });
});
