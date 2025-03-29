import * as net from 'net';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("Anything endpoint", () => {

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

    it("returns parsed JSON request details", async () => {
        const address = `http://localhost:${serverPort}/anything?a=b&a=c&x=y`;
        const response = await fetch(address, {
            method: 'PUT',
            headers: {
                'test-HEADER': 'abc'
            },
            body: JSON.stringify({ "hello": "world" })
        });

        expect(response.status).to.equal(200);

        const body = await response.json();
        expect(body).to.deep.equal({
            args: {
                a: ["b", "c"],
                "x": "y"
            },
            data: "{\"hello\":\"world\"}",
            files: {},
            form: {},
            headers: {
                "Accept": "*/*",
                "Accept-Encoding": "gzip, deflate",
                "Accept-Language": "*",
                "Connection": "keep-alive",
                "Content-Length": "17",
                "Content-Type": "text/plain;charset=UTF-8",
                "Host": `localhost:${serverPort}`,
                "Sec-Fetch-Mode": "cors",
                "Test-Header": "abc",
                "User-Agent": "node"
            },
            json: {
                "hello": "world"
            },
            method: "PUT",
            origin: body.origin ?? 'fail', // Skip testing the exact value since it varies a lot
            url: `http://localhost:${serverPort}/anything?a=b&a=c&x=y`
        });
    });

    it("returns parsed binary data request details", async () => {
        const address = `http://localhost:${serverPort}/anything?&&&&`;
        const response = await fetch(address, {
            method: 'POST',
            body: Buffer.from([200, 200, 200, 200])
        });

        expect(response.status).to.equal(200);

        const body = await response.json();
        expect(body).to.deep.equal({
            args: {},
            data: "data:application/octet-stream;base64,yMjIyA==",
            files: {},
            form: {},
            headers: {
                "Accept": "*/*",
                "Accept-Encoding": "gzip, deflate",
                "Accept-Language": "*",
                "Connection": "keep-alive",
                "Content-Length": "4",
                "Host": `localhost:${serverPort}`,
                "Sec-Fetch-Mode": "cors",
                "User-Agent": "node"
            },
            json: null,
            method: "POST",
            origin: body.origin ?? 'fail', // Skip testing the exact value since it varies a lot
            url: `http://localhost:${serverPort}/anything?&&&&`
        });
    });

});