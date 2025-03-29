import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import * as Cookie from 'cookie';

import { createServer } from '../src/server.js';

describe("Cookie endpoints", () => {

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

    it("returns cookies at /cookies", async () => {
        const cookieValue = 'test=value; another=cookie';
        const address = `http://localhost:${serverPort}/cookies`;
        const response = await fetch(address, {
            headers: {
                'Cookie': cookieValue
            }
        });

        expect(response.status).to.equal(200);

        const body = await response.json();
        expect(body.cookies).to.deep.equal(Cookie.parse(cookieValue));
    });

    it("sets cookies using path parameters at /cookies/set/name/value", async () => {
        const address = `http://localhost:${serverPort}/cookies/set/test/value`;
        const response = await fetch(address, {
            redirect: 'manual' // Prevent auto-following redirects
        });

        expect(response.status).to.equal(302);
        expect(response.headers.get('Location')).to.equal('/cookies');
        expect(response.headers.get('Set-Cookie')).to.equal('test=value; Path=/');
    });

    it("sets cookies using query parameters at /cookies/set", async () => {
        const address = `http://localhost:${serverPort}/cookies/set?test=value&test=value2&another=cookie`;
        const response = await fetch(address, {
            redirect: 'manual' // Prevent auto-following redirects
        });

        expect(response.status).to.equal(302);
        expect(response.headers.get('Location')).to.equal('/cookies');

        const setCookies = response.headers.getSetCookie();
        const parsedCookies = setCookies.map((c) => Cookie.parse(c));
        expect(parsedCookies).to.deep.equal([
            { test: 'value', Path: '/' },
            { another: 'cookie', Path: '/' }
        ]);
    });

    it('deletes cookies at /cookies/delete?cookie', async () => {
        const address = `http://localhost:${serverPort}/cookies/delete?hello=world&test`;
        const response = await fetch(address, {
            redirect: 'manual' // Prevent auto-following redirects
        });

        expect(response.status).to.equal(302);
        expect(response.headers.get('Location')).to.equal('/cookies');

        expect(response.headers.getSetCookie()).to.deep.equal([
            [
                'hello=',
                'Expires=Thu, 01-Jan-1970 00:00:00 GMT',
                'Max-Age=0',
                'Path=/'
            ].join('; '),
            [
                'test=',
                'Expires=Thu, 01-Jan-1970 00:00:00 GMT',
                'Max-Age=0',
                'Path=/'
            ].join('; ')
        ]);
    })
});
