import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("TLS-required endpoints over plain HTTP", () => {

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

    describe("redirects plain HTTP to HTTPS for TLS-configuring subdomains", () => {

        for (const subdomain of [
            'tls-v1-0',
            'tls-v1-1',
            'tls-v1-2',
            'tls-v1-3',
            'expired',
            'revoked',
            'self-signed',
            'untrusted-root',
            'wrong-host',
            'http2',
            'http1'
        ]) {
            it(`redirects http://${subdomain}.* to HTTPS`, async () => {
                const response = await fetch(
                    `http://${subdomain}.localhost:${serverPort}/status/200`,
                    { redirect: 'manual' }
                );

                expect(response.status).to.equal(301);
                expect(response.headers.get('location')).to.equal(
                    `https://${subdomain}.localhost:${serverPort}/status/200`
                );

                const body = await response.text();
                expect(body).to.include('requires HTTPS');
            });
        }

    });

    it("redirects combined TLS subdomains to HTTPS", async () => {
        const response = await fetch(
            `http://tls-v1-2--expired.localhost:${serverPort}/status/200`,
            { redirect: 'manual' }
        );

        expect(response.status).to.equal(301);
        expect(response.headers.get('location')).to.equal(
            `https://tls-v1-2--expired.localhost:${serverPort}/status/200`
        );
    });

    it("preserves the full path and query in the redirect", async () => {
        const response = await fetch(
            `http://tls-v1-2.localhost:${serverPort}/anything?foo=bar`,
            { redirect: 'manual' }
        );

        expect(response.status).to.equal(301);
        expect(response.headers.get('location')).to.equal(
            `https://tls-v1-2.localhost:${serverPort}/anything?foo=bar`
        );
    });

    describe("allows plain HTTP for plainTextAllowed subdomains", () => {

        it("allows http://example.* requests", async () => {
            const response = await fetch(
                `http://example.localhost:${serverPort}/`
            );

            expect(response.status).to.equal(200);
        });

        it("allows http://no-tls.* requests", async () => {
            const response = await fetch(
                `http://no-tls.localhost:${serverPort}/status/200`
            );

            expect(response.status).to.equal(200);
        });

    });

    it("allows plain HTTP for requests with no subdomain", async () => {
        const response = await fetch(
            `http://localhost:${serverPort}/status/200`
        );

        expect(response.status).to.equal(200);
    });

});
