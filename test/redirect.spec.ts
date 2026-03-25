import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("Redirect endpoints", () => {

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

    describe("/redirect-to", () => {
        it("redirects to the specified URL", async () => {
            const response = await fetch(
                `http://localhost:${serverPort}/redirect-to?url=/get`,
                { redirect: 'manual' }
            );
            expect(response.status).to.equal(302);
            expect(response.headers.get('location')).to.equal('/get');
        });

        it("uses custom status code", async () => {
            const response = await fetch(
                `http://localhost:${serverPort}/redirect-to?url=/get&status_code=301`,
                { redirect: 'manual' }
            );
            expect(response.status).to.equal(301);
        });

        it("returns 400 if url param is missing", async () => {
            const response = await fetch(
                `http://localhost:${serverPort}/redirect-to`
            );
            expect(response.status).to.equal(400);
        });
    });

    describe("/redirect/{n}", () => {
        it("redirects to /get for n=1", async () => {
            const response = await fetch(
                `http://localhost:${serverPort}/redirect/1`,
                { redirect: 'manual' }
            );
            expect(response.status).to.equal(302);
            expect(response.headers.get('location')).to.include('/get');
        });

        it("chains through /relative-redirect for n>1", async () => {
            const response = await fetch(
                `http://localhost:${serverPort}/redirect/3`,
                { redirect: 'manual' }
            );
            expect(response.status).to.equal(302);
            expect(response.headers.get('location')).to.equal('/relative-redirect/2');
        });

        it("returns 400 for n=0", async () => {
            const response = await fetch(
                `http://localhost:${serverPort}/redirect/0`
            );
            expect(response.status).to.equal(400);
        });

        it("eventually reaches /get when following redirects", async () => {
            const response = await fetch(
                `http://localhost:${serverPort}/redirect/3`
            );
            expect(response.status).to.equal(200);
            const body = await response.json();
            expect(body).to.have.property('url');
        });
    });

    describe("/relative-redirect/{n}", () => {
        it("uses relative location headers", async () => {
            const response = await fetch(
                `http://localhost:${serverPort}/relative-redirect/3`,
                { redirect: 'manual' }
            );
            expect(response.status).to.equal(302);
            const location = response.headers.get('location')!;
            expect(location).to.equal('/relative-redirect/2');
        });

        it("redirects to /get for n=1", async () => {
            const response = await fetch(
                `http://localhost:${serverPort}/relative-redirect/1`,
                { redirect: 'manual' }
            );
            expect(response.headers.get('location')).to.equal('/get');
        });
    });

    describe("/absolute-redirect/{n}", () => {
        it("uses absolute location headers", async () => {
            const response = await fetch(
                `http://localhost:${serverPort}/absolute-redirect/3`,
                { redirect: 'manual' }
            );
            expect(response.status).to.equal(302);
            const location = response.headers.get('location')!;
            expect(location).to.match(/^http:\/\/localhost:\d+\/absolute-redirect\/2$/);
        });

        it("redirects to absolute /get for n=1", async () => {
            const response = await fetch(
                `http://localhost:${serverPort}/absolute-redirect/1`,
                { redirect: 'manual' }
            );
            const location = response.headers.get('location')!;
            expect(location).to.match(/^http:\/\/localhost:\d+\/get$/);
        });
    });
});
