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

    it("returns documentation page for direct requests", async () => {
        const address = `http://localhost:${serverPort}/`;
        const response = await fetch(address);

        expect(response.status).to.equal(200);
        expect(response.headers.get('content-type')).to.include('text/html');
        const body = await response.text();
        expect(body).to.include('Testserver');
        expect(body).to.include('HTTP Endpoints');
        expect(body).to.include('WebSocket Endpoints');
        expect(body).to.include('TLS Endpoints');
    });

    it("returns documentation page for prefixed hostnames too", async () => {
        const address = `http://http1.localhost:${serverPort}/`;
        const response = await fetch(address);

        expect(response.status).to.equal(200);
        expect(response.headers.get('content-type')).to.include('text/html');
        const body = await response.text();
        expect(body).to.include('Testserver');
    });

});