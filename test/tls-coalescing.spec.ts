import * as net from 'net';
import * as http2 from 'http2';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("TLS connection coalescing prevention", () => {

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

    async function h2Request(servername: string, authority: string): Promise<number | undefined> {
        const client = http2.connect(`https://localhost:${serverPort}`, {
            rejectUnauthorized: false,
            servername
        });

        const status = await new Promise<number | undefined>((resolve, reject) => {
            const req = client.request({ ':authority': authority, ':path': '/status/200' });
            req.on('response', (headers) => resolve(headers[':status']));
            req.on('error', reject);
            req.end();
        });
        client.close();

        return status;
    }

    it("allows requests where :authority matches the SNI", async () => {
        expect(await h2Request('http2.localhost', 'http2.localhost')).to.equal(200);
    });

    it("returns 421 when :authority does not match SNI", async () => {
        expect(await h2Request('http2.localhost', 'http2--expired.localhost')).to.equal(421);
    });

    it("returns 421 when :authority includes a port but hostname doesn't match SNI", async () => {
        expect(await h2Request('http2.localhost', `localhost:${serverPort}`)).to.equal(421);
    });

});
