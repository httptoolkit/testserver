import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("HTML endpoint", () => {

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

    it("returns an HTML page", async () => {
        const response = await fetch(`http://localhost:${serverPort}/html`);
        expect(response.status).to.equal(200);
        expect(response.headers.get('content-type')).to.equal('text/html; charset=utf-8');

        const body = await response.text();
        expect(body).to.include('<h1>Herman Melville - Moby-Dick</h1>');
        expect(body).to.include('<!DOCTYPE html>');
    });
});
