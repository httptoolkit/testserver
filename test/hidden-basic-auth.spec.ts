import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

const basicAuthHeader = (username: string, password: string) =>
    'Basic ' + Buffer.from(username + ':' + password).toString('base64');

describe("Hidden-basic-auth endpoint", () => {

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

    it("returns 404 if no auth is provided", async () => {
        const response = await fetch(`http://localhost:${serverPort}/hidden-basic-auth/user/pwd`);
        expect(response.status).to.equal(404);
        expect(response.headers.get('www-authenticate')).to.be.null;
    });

    it("returns 404 for incorrect credentials", async () => {
        const response = await fetch(`http://localhost:${serverPort}/hidden-basic-auth/user/pwd`, {
            headers: { 'Authorization': basicAuthHeader('wrong', 'credentials') }
        });
        expect(response.status).to.equal(404);
    });

    it("returns 200 with user info for correct credentials", async () => {
        const response = await fetch(`http://localhost:${serverPort}/hidden-basic-auth/user/pwd`, {
            headers: { 'Authorization': basicAuthHeader('user', 'pwd') }
        });
        expect(response.status).to.equal(200);
        expect(await response.json()).to.deep.equal({
            authenticated: true,
            user: 'user'
        });
    });
});
