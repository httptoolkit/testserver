import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("Stream endpoint", () => {

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

    it("streams n JSON lines", async () => {
        const response = await fetch(`http://localhost:${serverPort}/stream/3`);
        expect(response.status).to.equal(200);
        expect(response.headers.get('content-type')).to.equal('application/json');

        const body = await response.text();
        const lines = body.trim().split('\n');
        expect(lines).to.have.length(3);

        const parsed = lines.map(l => JSON.parse(l));
        expect(parsed[0].id).to.equal(0);
        expect(parsed[1].id).to.equal(1);
        expect(parsed[2].id).to.equal(2);
    });

    it("includes request data fields in each line", async () => {
        const response = await fetch(`http://localhost:${serverPort}/stream/1`);
        const body = await response.text();
        const obj = JSON.parse(body.trim());

        expect(obj).to.have.property('id', 0);
        expect(obj).to.have.property('url');
        expect(obj).to.have.property('headers');
        expect(obj).to.have.property('origin');
    });

    it("returns empty body for n=0", async () => {
        const response = await fetch(`http://localhost:${serverPort}/stream/0`);
        expect(response.status).to.equal(200);
        const body = await response.text();
        expect(body).to.equal('');
    });

    it("rejects n over maximum", async () => {
        const response = await fetch(`http://localhost:${serverPort}/stream/200`);
        expect(response.status).to.equal(400);
    });
});
