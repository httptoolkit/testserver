import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("Cache endpoints", () => {

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

    describe("/cache", () => {
        it("returns 200 with JSON when no conditional headers are present", async () => {
            const response = await fetch(`http://localhost:${serverPort}/cache`);
            expect(response.status).to.equal(200);
            const body = await response.json();
            expect(body).to.have.property('headers');
            expect(body).to.have.property('origin');
            expect(body).to.have.property('url');
        });

        it("returns 304 when If-Modified-Since is present", async () => {
            const response = await fetch(`http://localhost:${serverPort}/cache`, {
                headers: { 'If-Modified-Since': 'Thu, 01 Jan 2020 00:00:00 GMT' }
            });
            expect(response.status).to.equal(304);
        });

        it("returns 304 when If-None-Match is present", async () => {
            const response = await fetch(`http://localhost:${serverPort}/cache`, {
                headers: { 'If-None-Match': '"some-etag"' }
            });
            expect(response.status).to.equal(304);
        });
    });

    describe("/cache/{n}", () => {
        it("returns Cache-Control header with max-age", async () => {
            const response = await fetch(`http://localhost:${serverPort}/cache/60`);
            expect(response.status).to.equal(200);
            expect(response.headers.get('cache-control')).to.equal('public, max-age=60');
            const body = await response.json();
            expect(body).to.have.property('url');
        });
    });
});
