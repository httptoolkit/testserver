import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("Root page endpoint", () => {

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

    it("redirects to the source for direct requests", async () => {
        const address = `http://localhost:${serverPort}/`;
        const response = await fetch(address, {
            redirect: 'manual'
        });

        expect(response.status).to.equal(307);
        expect(response.headers.get('location')).to.equal('https://github.com/httptoolkit/testserver/');
    });

    it("just returns a 404 for any other hostnames", async () => {
        const address = `http://http1.localhost:${serverPort}/`;
        const response = await fetch(address, {
            redirect: 'manual'
        });

        expect(response.status).to.equal(404);
        expect(await response.text()).to.equal('Could not match endpoint for / (http1)');
    });

});