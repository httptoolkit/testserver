import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("Method endpoints", () => {

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

    it("accepts GET requests at /get", async () => {
        const address = `http://localhost:${serverPort}/get?test=value`;
        const response = await fetch(address);
        expect(response.status).to.equal(200);
        const body = await response.json();
        expect(body.args).to.deep.equal({ test: "value" });
    });

    it("rejects non-GET requests at /get", async () => {
        const address = `http://localhost:${serverPort}/get`;
        const response = await fetch(address, { method: 'POST' });
        expect(response.status).to.equal(405);
    });

    it("accepts POST requests at /post", async () => {
        const address = `http://localhost:${serverPort}/post`;
        const response = await fetch(address, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ test: "value" })
        });
        expect(response.status).to.equal(200);
        const body = await response.json();
        expect(body.json).to.deep.equal({ test: "value" });
    });

    it("rejects non-POST requests at /post", async () => {
        const address = `http://localhost:${serverPort}/post`;
        const response = await fetch(address);
        expect(response.status).to.equal(405);
    });

});