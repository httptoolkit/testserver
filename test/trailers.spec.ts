import * as net from 'net';
import * as http from 'http';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';
import * as streamConsumers from 'stream/consumers';

import { createServer } from '../src/server.js';
import { delay } from '@httptoolkit/util';

describe("Trailers endpoint", () => {

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

    it("sends no trailers or metadata for a plain request", async () => {
        const address = `http://localhost:${serverPort}/trailers`;
        const response = await fetch(address);

        expect(response.status).to.equal(200);

        const body = await response.json();
        expect(body).to.deep.equal({
            'will-send-trailers': false,
            'received-trailers': []
        });
    });

    it("sends no trailers given a plain request", async () => {
        const address = `http://localhost:${serverPort}/trailers`;
        const request = http.request(address).end();

        const response: http.IncomingMessage = await new Promise((resolve, reject) => {
            request.on('response', resolve);
            request.on('error', reject);
        });

        const responseData = await streamConsumers.json(response);

        expect(response.statusCode).to.equal(200);
        expect(responseData).to.deep.equal({
            'will-send-trailers': false,
            'received-trailers': []
        });

        expect(response.rawTrailers).to.deep.equal([]);
    });

    it("sends trailers given TE: trailers", async () => {
        const address = `http://localhost:${serverPort}/trailers`;
        const request = http.request(address, {
            headers: {
                'TE': 'trailers'
            }
        }).end();

        const response: http.IncomingMessage = await new Promise((resolve, reject) => {
            request.on('response', resolve);
            request.on('error', reject);
        });

        const responseData = await streamConsumers.json(response);

        expect(response.statusCode).to.equal(200);
        expect(responseData).to.deep.equal({
            'will-send-trailers': true,
            'received-trailers': []
        });

        expect(response.rawTrailers).to.deep.equal([
            'example-trailer', 'example value'
        ]);
    });

    it("logs the received trailers if provided", async () => {
        const address = `http://localhost:${serverPort}/trailers`;
        const request = http.request(address, {
            method: 'POST'
        });

        request.flushHeaders();
        await delay(50); // Make sure it handles slow requests

        request.addTrailers([
            ['request-TRAILER', 'Request value'],
        ]);
        request.end('hello');

        const response: http.IncomingMessage = await new Promise((resolve, reject) => {
            request.on('response', resolve);
            request.on('error', reject);
        });

        const responseData = await streamConsumers.json(response);

        expect(response.statusCode).to.equal(200);
        expect(responseData).to.deep.equal({
            'will-send-trailers': false,
            'received-trailers': ['request-TRAILER', 'Request value']
        });
    });

});