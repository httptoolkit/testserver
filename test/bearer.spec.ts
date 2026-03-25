import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("Bearer endpoint", () => {

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

    it("returns 401 if no auth header is provided", async () => {
        const response = await fetch(`http://localhost:${serverPort}/bearer`);
        expect(response.status).to.equal(401);
        expect(response.headers.get('www-authenticate')).to.equal('Bearer');
    });

    it("returns 401 if auth header is not Bearer type", async () => {
        const response = await fetch(`http://localhost:${serverPort}/bearer`, {
            headers: { 'Authorization': 'Basic abc123' }
        });
        expect(response.status).to.equal(401);
        expect(response.headers.get('www-authenticate')).to.equal('Bearer');
    });

    it("returns 401 if bearer token is empty", async () => {
        const response = await fetch(`http://localhost:${serverPort}/bearer`, {
            headers: { 'Authorization': 'Bearer ' }
        });
        expect(response.status).to.equal(401);
    });

    it("returns 200 with token info for valid bearer token", async () => {
        const response = await fetch(`http://localhost:${serverPort}/bearer`, {
            headers: { 'Authorization': 'Bearer my-secret-token' }
        });
        expect(response.status).to.equal(200);
        expect(await response.json()).to.deep.equal({
            authenticated: true,
            token: 'my-secret-token'
        });
    });
});
