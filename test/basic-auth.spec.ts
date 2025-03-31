import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

const basicAuthHeader = (username: string, password: string) =>
     'Basic ' + Buffer.from(username + ':' + password).toString('base64');

describe("Basic-auth endpoint", () => {

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

    it("requests auth if none is provided", async () => {
        const address = `http://localhost:${serverPort}/basic-auth/user/pwd`;
        const response = await fetch(address);
        expect(response.status).to.equal(401);
        expect(response.headers.get('www-authenticate')).to.equal('Basic realm="Fake Realm"');
    });

    it("rejects incorrect auth", async () => {
        const address = `http://localhost:${serverPort}/basic-auth/user/pwd`;
        const response = await fetch(address, {
            headers: {
                'Authorization': basicAuthHeader('wrong', 'credentials')
            }
        });

        expect(response.status).to.equal(403);
    });

    it("accepts correct auth", async () => {
        const address = `http://localhost:${serverPort}/basic-auth/user/pwd`;
        const response = await fetch(address, {
            headers: {
                'Authorization': basicAuthHeader('user', 'pwd')
            }
        });

        expect(response.status).to.equal(200);
        expect(await response.json()).to.deep.equal({
            "authenticated": true,
            "user": "user"
        });
    });
});
