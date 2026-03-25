import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("UUID endpoint", () => {

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

    it("returns a valid UUID v4", async () => {
        const response = await fetch(`http://localhost:${serverPort}/uuid`);
        expect(response.status).to.equal(200);
        expect(response.headers.get('content-type')).to.equal('application/json');

        const body = await response.json();
        expect(body).to.have.property('uuid');
        expect(body.uuid).to.match(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        );
    });

    it("returns a different UUID each time", async () => {
        const r1 = await fetch(`http://localhost:${serverPort}/uuid`);
        const r2 = await fetch(`http://localhost:${serverPort}/uuid`);
        const body1 = await r1.json();
        const body2 = await r2.json();
        expect(body1.uuid).to.not.equal(body2.uuid);
    });
});
