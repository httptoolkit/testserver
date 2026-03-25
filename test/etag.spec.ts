import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("ETag endpoint", () => {

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

    it("returns 200 with ETag header when no conditional headers are present", async () => {
        const response = await fetch(`http://localhost:${serverPort}/etag/my-etag`);
        expect(response.status).to.equal(200);
        expect(response.headers.get('etag')).to.equal('my-etag');
        const body = await response.json();
        expect(body).to.have.property('url');
    });

    it("returns 304 when If-None-Match matches", async () => {
        const response = await fetch(`http://localhost:${serverPort}/etag/my-etag`, {
            headers: { 'If-None-Match': 'my-etag' }
        });
        expect(response.status).to.equal(304);
        expect(response.headers.get('etag')).to.equal('my-etag');
    });

    it("returns 200 when If-None-Match does not match", async () => {
        const response = await fetch(`http://localhost:${serverPort}/etag/my-etag`, {
            headers: { 'If-None-Match': '"other-etag"' }
        });
        expect(response.status).to.equal(200);
        expect(response.headers.get('etag')).to.equal('my-etag');
    });

    it("returns 200 when If-Match matches", async () => {
        const response = await fetch(`http://localhost:${serverPort}/etag/my-etag`, {
            headers: { 'If-Match': 'my-etag' }
        });
        expect(response.status).to.equal(200);
    });

    it("returns 412 when If-Match does not match", async () => {
        const response = await fetch(`http://localhost:${serverPort}/etag/my-etag`, {
            headers: { 'If-Match': '"other-etag"' }
        });
        expect(response.status).to.equal(412);
    });

    it("handles wildcard If-None-Match", async () => {
        const response = await fetch(`http://localhost:${serverPort}/etag/anything`, {
            headers: { 'If-None-Match': '*' }
        });
        expect(response.status).to.equal(304);
    });
});
