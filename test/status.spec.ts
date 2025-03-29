import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("Status endpoint", () => {

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

    it("returns a 200", async () => {
        const address = `http://localhost:${serverPort}/status/200`;
        const response = await fetch(address);
        expect(response.status).to.equal(200);
    });

    it("returns a 500", async () => {
        const address = `http://localhost:${serverPort}/status/500`;
        const response = await fetch(address);
        expect(response.status).to.equal(500);
    });

    it("returns a 499", async () => {
        const address = `http://localhost:${serverPort}/status/499`;
        const response = await fetch(address);
        expect(response.status).to.equal(499);
    });

    it("returns a 999", async () => {
        const address = `http://localhost:${serverPort}/status/499`;
        const response = await fetch(address);
        expect(response.status).to.equal(499);
    });

    it("fails given a non-numeric code", async () => {
        const address = `http://localhost:${serverPort}/status/wow`;
        const response = await fetch(address);
        expect(response.status).to.equal(400);
    });

});