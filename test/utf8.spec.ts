import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("UTF-8 encoding endpoint", () => {

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

    it("returns an HTML page with UTF-8 characters", async () => {
        const response = await fetch(`http://localhost:${serverPort}/encoding/utf8`);
        expect(response.status).to.equal(200);
        expect(response.headers.get('content-type')).to.equal('text/html; charset=utf-8');

        const body = await response.text();
        expect(body).to.include('Unicode Demo');
        expect(body).to.include('Markus Kuhn');
        expect(body).to.include('∮ E⋅da = Q');
        expect(body).to.include('コンニチハ');
    });
});
