import * as net from 'net';
import { expect } from 'chai';
import { WebSocket } from 'ws';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("WebSocket Delay endpoint", () => {

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

    it("delays before continuing to next endpoint", async () => {
        const startTime = Date.now();
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/delay/0.1/close/1000`);

        await new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        await new Promise<void>((resolve) => {
            ws.on('close', () => resolve());
        });

        const elapsed = Date.now() - startTime;
        expect(elapsed).to.be.greaterThan(90);
    });

    it("chains delay with echo", async () => {
        const startTime = Date.now();
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/delay/0.1/echo`);

        await new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        // Wait for delay to complete before sending (echo handler needs to be registered)
        await new Promise(resolve => setTimeout(resolve, 150));

        ws.send('test');

        const receivedMessage = await new Promise<string>((resolve, reject) => {
            ws.on('message', (data) => {
                resolve(data.toString());
            });
            ws.on('error', reject);
        });

        const messageElapsed = Date.now() - startTime;
        expect(messageElapsed).to.be.greaterThan(150);
        expect(receivedMessage).to.equal('test');
        ws.close();
    });

    it("rejects invalid delay values with HTTP 400", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/delay/notanumber/echo`);

        const result = await new Promise<{ statusCode: number }>((resolve, reject) => {
            ws.on('open', () => {
                reject(new Error('Should not have connected'));
            });
            ws.on('unexpected-response', (req, res) => {
                resolve({ statusCode: res.statusCode! });
            });
            ws.on('error', reject);
        });

        expect(result.statusCode).to.equal(400);
    });

    it("supports multiple delays in chain", async () => {
        const startTime = Date.now();
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/delay/0.05/delay/0.05/close/1000`);

        await new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        await new Promise<void>((resolve) => {
            ws.on('close', () => resolve());
        });

        const elapsed = Date.now() - startTime;
        expect(elapsed).to.be.greaterThan(90);
    });

});
