import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("Bytes endpoint", () => {

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

    it("returns the specified number of random bytes", async () => {
        const response = await fetch(`http://localhost:${serverPort}/bytes/256`);
        expect(response.status).to.equal(200);
        expect(response.headers.get('content-type')).to.equal('application/octet-stream');
        expect(response.headers.get('content-length')).to.equal('256');
        const body = await response.arrayBuffer();
        expect(body.byteLength).to.equal(256);
    });

    it("returns zero bytes for /bytes/0", async () => {
        const response = await fetch(`http://localhost:${serverPort}/bytes/0`);
        expect(response.status).to.equal(200);
        const body = await response.arrayBuffer();
        expect(body.byteLength).to.equal(0);
    });

    it("returns deterministic output with seed", async () => {
        const r1 = await fetch(`http://localhost:${serverPort}/bytes/64?seed=42`);
        const r2 = await fetch(`http://localhost:${serverPort}/bytes/64?seed=42`);
        const b1 = Buffer.from(await r1.arrayBuffer());
        const b2 = Buffer.from(await r2.arrayBuffer());
        expect(b1.equals(b2)).to.be.true;
    });

    it("returns different output with different seeds", async () => {
        const r1 = await fetch(`http://localhost:${serverPort}/bytes/64?seed=1`);
        const r2 = await fetch(`http://localhost:${serverPort}/bytes/64?seed=2`);
        const b1 = Buffer.from(await r1.arrayBuffer());
        const b2 = Buffer.from(await r2.arrayBuffer());
        expect(b1.equals(b2)).to.be.false;
    });

    it("rejects byte counts over the maximum", async () => {
        const response = await fetch(`http://localhost:${serverPort}/bytes/200000`);
        expect(response.status).to.equal(400);
    });
});
