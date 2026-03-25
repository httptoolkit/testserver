import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("Deny endpoint", () => {

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

    it("returns plain text with denied message", async () => {
        const response = await fetch(`http://localhost:${serverPort}/deny`);
        expect(response.status).to.equal(200);
        expect(response.headers.get('content-type')).to.equal('text/plain');

        const body = await response.text();
        expect(body).to.include("YOU SHOULDN'T BE HERE");
    });
});
