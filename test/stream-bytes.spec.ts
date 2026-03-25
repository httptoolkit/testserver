import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("Stream-bytes endpoint", () => {

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

    it("streams the specified number of bytes", async () => {
        const response = await fetch(`http://localhost:${serverPort}/stream-bytes/512`);
        expect(response.status).to.equal(200);
        expect(response.headers.get('content-type')).to.equal('application/octet-stream');
        const body = await response.arrayBuffer();
        expect(body.byteLength).to.equal(512);
    });

    it("returns zero bytes for /stream-bytes/0", async () => {
        const response = await fetch(`http://localhost:${serverPort}/stream-bytes/0`);
        expect(response.status).to.equal(200);
        const body = await response.arrayBuffer();
        expect(body.byteLength).to.equal(0);
    });

    it("returns deterministic output with seed", async () => {
        const r1 = await fetch(`http://localhost:${serverPort}/stream-bytes/128?seed=abc`);
        const r2 = await fetch(`http://localhost:${serverPort}/stream-bytes/128?seed=abc`);
        const b1 = Buffer.from(await r1.arrayBuffer());
        const b2 = Buffer.from(await r2.arrayBuffer());
        expect(b1.equals(b2)).to.be.true;
    });

    it("respects custom chunk_size", async () => {
        // Just verify it works — we can't easily inspect chunking from fetch,
        // but we can confirm the total byte count is correct
        const response = await fetch(
            `http://localhost:${serverPort}/stream-bytes/100?chunk_size=10`
        );
        expect(response.status).to.equal(200);
        const body = await response.arrayBuffer();
        expect(body.byteLength).to.equal(100);
    });

    it("rejects byte counts over the maximum", async () => {
        const response = await fetch(`http://localhost:${serverPort}/stream-bytes/200000`);
        expect(response.status).to.equal(400);
    });
});
