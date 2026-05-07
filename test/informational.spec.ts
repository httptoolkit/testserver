import * as net from 'net';
import * as http from 'http';
import * as http2 from 'http2';
import * as streamConsumers from 'stream/consumers';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

interface Informational {
    statusCode: number;
    headers: http.IncomingHttpHeaders;
}

async function h1Request(port: number, path: string): Promise<{
    informationals: Informational[];
    finalStatusCode: number;
    body: string;
}> {
    return new Promise((resolve, reject) => {
        const informationals: Informational[] = [];

        const req = http.request({ port, path, method: 'GET' }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                resolve({
                    informationals,
                    finalStatusCode: res.statusCode!,
                    body: Buffer.concat(chunks).toString('utf8')
                });
            });
            res.on('error', reject);
        });

        req.on('information', (info) => {
            informationals.push({ statusCode: info.statusCode, headers: info.headers });
        });
        req.on('error', reject);
        req.end();
    });
}

describe("Informational endpoint", () => {

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

    it("sends a 103 Early Hints with a link header, then a 200", async () => {
        const result = await h1Request(serverPort,
            '/info/103?link=%3C/style.css%3E%3Brel%3Dpreload%3Bas%3Dstyle'
        );

        expect(result.informationals).to.have.length(1);
        expect(result.informationals[0].statusCode).to.equal(103);
        expect(result.informationals[0].headers['link']).to.equal(
            '</style.css>;rel=preload;as=style'
        );

        expect(result.finalStatusCode).to.equal(200);
        const body = JSON.parse(result.body);
        expect(body.sent.code).to.equal(103);
    });

    it("sends multiple link headers in a single 103", async () => {
        const result = await h1Request(serverPort,
            '/info/103?link=%3C/a.css%3E&link=%3C/b.js%3E'
        );

        // Node folds repeated Link headers into a comma-separated string.
        expect(result.informationals[0].headers['link']).to.equal(
            '</a.css>, </b.js>'
        );
    });

    it("supports non-standard 1xx codes such as 199", async () => {
        const result = await h1Request(serverPort, '/info/199');
        expect(result.informationals.map(i => i.statusCode)).to.deep.equal([199]);
        expect(result.finalStatusCode).to.equal(200);
    });

    it("chains multiple /info hops to send multiple informationals", async () => {
        const result = await h1Request(serverPort, '/info/103/info/103/info/100/anything');
        expect(result.informationals.map(i => i.statusCode)).to.deep.equal([103, 103, 100]);
        expect(result.finalStatusCode).to.equal(200);
    });

    it("chains: /info/103/anything sends 103 then runs /anything", async () => {
        const result = await h1Request(serverPort, '/info/103/anything');
        expect(result.informationals.map(i => i.statusCode)).to.deep.equal([103]);
        expect(result.finalStatusCode).to.equal(200);
        const body = JSON.parse(result.body);
        expect(body.url).to.match(/\/anything$/);
    });

    it("chains: /info/103/status/418 sends 103 then a 418", async () => {
        const result = await h1Request(serverPort, '/info/103/status/418');
        expect(result.informationals.map(i => i.statusCode)).to.deep.equal([103]);
        expect(result.finalStatusCode).to.equal(418);
    });

    it("rejects 101 with a 400 (reserved for upgrades)", async () => {
        const response = await fetch(`http://localhost:${serverPort}/info/101`);
        expect(response.status).to.equal(400);
    });

    it("rejects non-1xx codes with a 400", async () => {
        const response = await fetch(`http://localhost:${serverPort}/info/200`);
        expect(response.status).to.equal(400);
    });

    it("rejects non-numeric codes with a 400", async () => {
        const response = await fetch(`http://localhost:${serverPort}/info/abc`);
        expect(response.status).to.equal(400);
    });

});

describe("Status endpoint with 1xx codes", () => {

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

    it("rejects /status/100 with a 400 pointing to /info", async () => {
        const response = await fetch(`http://localhost:${serverPort}/status/100`);
        expect(response.status).to.equal(400);
        const body = await response.text();
        expect(body).to.include('/info/100');
    });

});

describe("Informational endpoint over HTTP/2", () => {

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

    async function h2Request(path: string): Promise<{
        informationals: Array<{ statusCode: number; headers: http2.IncomingHttpHeaders }>;
        finalStatusCode: number;
        body: string;
    }> {
        const client = http2.connect(`http://localhost:${serverPort}`);
        try {
            const request = client.request({ ':path': path, ':method': 'GET' });
            const informationals: Array<{ statusCode: number; headers: http2.IncomingHttpHeaders }> = [];
            let finalHeaders: http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader | undefined;

            await new Promise<void>((resolve, reject) => {
                request.on('headers', (headers) => {
                    informationals.push({
                        statusCode: headers[':status'] as number,
                        headers
                    });
                });
                request.on('response', (headers) => {
                    finalHeaders = headers;
                    resolve();
                });
                request.on('error', reject);
            });

            const body = await streamConsumers.text(request);
            return {
                informationals,
                finalStatusCode: finalHeaders![':status']!,
                body
            };
        } finally {
            client.close();
        }
    }

    it("sends a 103 with a Link header before the final response", async () => {
        const result = await h2Request('/info/103?link=%3C/style.css%3E');

        expect(result.informationals.map(i => i.statusCode)).to.deep.equal([103]);
        expect(result.informationals[0].headers['link']).to.equal('</style.css>');
        expect(result.finalStatusCode).to.equal(200);
    });

    it("chains 1xx with /anything as the final response", async () => {
        const result = await h2Request('/info/103/anything');

        expect(result.informationals.map(i => i.statusCode)).to.deep.equal([103]);
        expect(result.finalStatusCode).to.equal(200);
        const body = JSON.parse(result.body);
        expect(body.url).to.match(/\/anything$/);
    });

});
