import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("Base64 endpoint", () => {

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

    it("decodes standard base64", async () => {
        const response = await fetch(
            `http://localhost:${serverPort}/base64/SGVsbG8gd29ybGQ=`
        );
        expect(response.status).to.equal(200);
        expect(await response.text()).to.equal('Hello world');
    });

    it("decodes base64 with padding", async () => {
        // "Hi" = "SGk=" in base64
        const response = await fetch(
            `http://localhost:${serverPort}/base64/SGk=`
        );
        expect(response.status).to.equal(200);
        expect(await response.text()).to.equal('Hi');
    });

    it("decodes base64url encoding", async () => {
        const value = Buffer.from('test+value/here').toString('base64url');
        const response = await fetch(
            `http://localhost:${serverPort}/base64/${value}`
        );
        expect(response.status).to.equal(200);
        expect(await response.text()).to.equal('test+value/here');
    });

    it("returns error message for invalid base64", async () => {
        const response = await fetch(
            `http://localhost:${serverPort}/base64/!!!invalid!!!`
        );
        expect(response.status).to.equal(200);
        const body = await response.text();
        expect(body).to.include('Incorrect Base64 data');
        expect(body).to.include('SGVsbG8gd29ybGQ=');
    });
});
