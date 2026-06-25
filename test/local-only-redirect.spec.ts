import * as http from 'http';
import * as net from 'net';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createHttp1Handler, getLocalOnlyRedirectHost } from '../src/http-handler.js';

const ROOT = 'testserver.host';

describe("getLocalOnlyRedirectHost", () => {

    it("returns nothing when no public CA is in use", () => {
        // Without a public CA everything is already local/untrusted, so there's
        // nothing extra to make explicit.
        expect(getLocalOnlyRedirectHost(['no-common-name'], { usingPublicCA: false, rootDomain: ROOT }))
            .to.equal(undefined);
    });

    it("redirects a local-only endpoint to its explicit untrusted-root host", () => {
        expect(getLocalOnlyRedirectHost(['no-common-name'], { usingPublicCA: true, rootDomain: ROOT }))
            .to.equal('no-common-name--untrusted-root.testserver.host');
    });

    it("preserves other prefix parts when rewriting", () => {
        expect(getLocalOnlyRedirectHost(['http2', 'no-common-name'], { usingPublicCA: true, rootDomain: ROOT }))
            .to.equal('http2--no-common-name--untrusted-root.testserver.host');
    });

    it("leaves untrusted-root alone (already explicit)", () => {
        expect(getLocalOnlyRedirectHost(['untrusted-root'], { usingPublicCA: true, rootDomain: ROOT }))
            .to.equal(undefined);
    });

    it("leaves self-signed alone (already explicit)", () => {
        expect(getLocalOnlyRedirectHost(['self-signed'], { usingPublicCA: true, rootDomain: ROOT }))
            .to.equal(undefined);
    });

    it("does not redirect an endpoint that already includes untrusted-root", () => {
        expect(getLocalOnlyRedirectHost(['no-common-name', 'untrusted-root'], { usingPublicCA: true, rootDomain: ROOT }))
            .to.equal(undefined);
    });

    it("does not redirect non-local endpoints served by the public CA", () => {
        // expired/revoked go through ACME, so they remain publicly trusted aside
        // from the one property they exercise - no untrusted-root rewrite.
        expect(getLocalOnlyRedirectHost(['expired'], { usingPublicCA: true, rootDomain: ROOT }))
            .to.equal(undefined);
        expect(getLocalOnlyRedirectHost(['incomplete-chain'], { usingPublicCA: true, rootDomain: ROOT }))
            .to.equal(undefined);
    });

});

describe("local-only redirect over HTTP (public CA enabled)", () => {

    let server: DestroyableServer;
    let serverPort: number;

    beforeEach(async () => {
        // Build the HTTP handler directly so we can exercise the public-CA path without
        // standing up a real ACME setup.
        server = makeDestroyable(createHttp1Handler({
            acmeChallengeCallback: () => undefined,
            rootDomain: ROOT,
            usingPublicCA: true
        }));
        await new Promise<void>((resolve) => server.listen(0, resolve));
        serverPort = (server.address() as net.AddressInfo).port;
    });

    afterEach(async () => {
        await server.destroy();
    });

    const getLocation = (hostHeader: string) =>
        new Promise<{ status: number, location?: string }>((resolve, reject) => {
            const req = http.request(
                { host: 'localhost', port: serverPort, path: '/', headers: { host: hostHeader } },
                (res) => {
                    res.resume();
                    resolve({ status: res.statusCode!, location: res.headers.location });
                }
            );
            req.on('error', reject);
            req.end();
        });

    it("redirects the -- separated host to the explicit untrusted-root host", async () => {
        const { status, location } = await getLocation(`no-common-name.${ROOT}`);
        expect(status).to.equal(301);
        expect(location).to.equal(`https://no-common-name--untrusted-root.${ROOT}/`);
    });

    it("redirects a dot-separated host to the same explicit untrusted-root host", async () => {
        const { status, location } = await getLocation(`http2.no-common-name.${ROOT}`);
        expect(status).to.equal(301);
        expect(location).to.equal(`https://http2--no-common-name--untrusted-root.${ROOT}/`);
    });

    it("handles the -- separated combined host identically", async () => {
        const { status, location } = await getLocation(`http2--no-common-name.${ROOT}`);
        expect(status).to.equal(301);
        expect(location).to.equal(`https://http2--no-common-name--untrusted-root.${ROOT}/`);
    });

    it("does not loop once the host already includes untrusted-root", async () => {
        // Should still upgrade to HTTPS, but not append untrusted-root again.
        const { status, location } = await getLocation(`no-common-name--untrusted-root.${ROOT}`);
        expect(status).to.equal(301);
        expect(location).to.equal(`https://no-common-name--untrusted-root.${ROOT}/`);
    });

});
