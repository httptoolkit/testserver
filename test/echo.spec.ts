import * as net from 'net';
import * as tls from 'tls';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server';

describe("Echo endpoint", () => {

    let server: DestroyableServer;
    let serverPort: number;

    beforeEach(async () => {
        server = makeDestroyable(await createServer({
            domain: 'localhost'
        }));
        await new Promise<void>((resolve) => server.listen(resolve));
        serverPort = (server.address() as net.AddressInfo).port;
    });

    afterEach(async () => {
        await server.destroy();
    });

    it("echoes an HTTP request", async () => {
        const address = `http://localhost:${serverPort}/echo`;
        const response = await fetch(address, {
            headers: {
                'test-HEADER': 'abc'
            }
        });

        expect(response.status).to.equal(200);

        const rawBody = await response.text();
        expect(rawBody).to.equal(
`GET /echo HTTP/1.1
host: localhost:${serverPort}
connection: keep-alive
test-HEADER: abc
accept: */*
accept-language: *
sec-fetch-mode: cors
user-agent: node
accept-encoding: gzip, deflate

`.replace(/\n/g, '\r\n')
        );
    });

});