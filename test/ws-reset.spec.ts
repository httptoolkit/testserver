import * as net from 'net';
import { expect } from 'chai';
import { WebSocket } from 'ws';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("WebSocket Reset endpoint", () => {

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

    it("resets the connection abruptly", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/error/reset`);

        const result = await new Promise<{ event: string; code?: number }>((resolve) => {
            ws.on('open', () => {
                // Connection opened, reset should happen immediately
            });
            ws.on('close', (code) => {
                resolve({ event: 'close', code });
            });
            ws.on('error', () => {
                resolve({ event: 'error' });
            });
        });

        // Connection should be terminated abnormally
        expect(result.event).to.equal('close');
        expect(result.code).to.equal(1006); // Abnormal closure
    });

    it("works in a chain after delay", async () => {
        const startTime = Date.now();
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/delay/0.1/error/reset`);

        const result = await new Promise<{ code: number }>((resolve) => {
            ws.on('close', (code) => {
                resolve({ code });
            });
        });

        const elapsed = Date.now() - startTime;
        expect(elapsed).to.be.greaterThan(90);
        expect(result.code).to.equal(1006);
    });

});
