import * as net from 'net';
import * as https from 'https';
import * as streamConsumers from 'stream/consumers';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("TLS fingerprint endpoint", () => {

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

    it("returns ja3 and ja4 fingerprints for TLS connections", async () => {
        const response = await new Promise<{ ja3: string; ja4: string }>((resolve, reject) => {
            https.get(`https://localhost:${serverPort}/tls/fingerprint`, {
                rejectUnauthorized: false
            }, async (res) => {
                try {
                    const body = await streamConsumers.text(res);
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            }).on('error', reject);
        });

        // Expected fingerprints for Node 24's TLS client
        expect(response.ja3).to.equal('944d1e1858cd278718f8a46b65d3212f');
        expect(response.ja4).to.equal('t13d521100_b262b3658495_8e6e362c5eac');
    });

});
