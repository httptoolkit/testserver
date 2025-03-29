import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import * as streamConsumers from 'stream/consumers';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("HTTPS requests", () => {

    let server: DestroyableServer;
    let serverPort: number;

    beforeEach(async () => {
        server = makeDestroyable(await createServer());
        await new Promise<void>((resolve) => server.listen(resolve));
        serverPort = (server.address() as net.AddressInfo).port;
    });

    afterEach(async () => {
        await server.destroy();
    })

    it("can connect successfully", async () => {
        const address = `https://localhost:${serverPort}/echo`;
        const request = https.get(address, {
            headers: {
                'test-HEADER': 'abc'
            },
            rejectUnauthorized: false // Needed as it's untrusted
        });

        const response = await new Promise<http.IncomingMessage>((resolve) =>
            request.on('response', resolve)
        );

        expect(response.statusCode).to.equal(200);

        const rawBody = await streamConsumers.text(response);
        expect(rawBody).to.equal(
`GET /echo HTTP/1.1
test-HEADER: abc
Host: localhost:${serverPort}
Connection: keep-alive

`.replace(/\n/g, '\r\n')
        );
    });

});