import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("Example page endpoint", () => {

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

    it("returns the example.com HTML page", async () => {
        const address = `http://example.localhost:${serverPort}/`;
        const response = await fetch(address);

        expect(response.status).to.equal(200);

        const body = await response.text();
        expect(body).to.include('<title>Example Domain</title>');
        expect(body).to.include('<h1>Example Domain</h1>');
        expect(body).to.include('This domain is for use in illustrative examples in documents.');
    });

});