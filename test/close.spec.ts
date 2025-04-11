import * as net from 'net';
import * as http from 'http';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("Close endpoint", () => {

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

    it("closes the connection", async () => {
        const address = `http://localhost:${serverPort}/error/close`;
        const request = http.request(address).end();
        const result = await new Promise<any>((resolve, reject) => {
            request.on('error', resolve);
            request.on('response', () => reject(new Error('Expected an error')));
        });

        expect(result.code).to.equal('ECONNRESET');
        expect(result.message).to.equal('socket hang up');
    });

});