import * as net from 'net';
import { expect } from 'chai';
import { WebSocket } from 'ws';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("WebSocket Close endpoint", () => {

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

    it("closes with default code 1000", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/close`);

        await new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        const result = await new Promise<{ code: number; reason: string }>((resolve) => {
            ws.on('close', (code, reason) => {
                resolve({ code, reason: reason.toString() });
            });
        });

        expect(result.code).to.equal(1000);
        expect(result.reason).to.equal('');
    });

    it("closes with specified code", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/close/1001`);

        await new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        const result = await new Promise<{ code: number }>((resolve) => {
            ws.on('close', (code) => {
                resolve({ code });
            });
        });

        expect(result.code).to.equal(1001);
    });

    it("closes with code and reason", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/close/1008?reason=Policy%20violation`);

        await new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        const result = await new Promise<{ code: number; reason: string }>((resolve) => {
            ws.on('close', (code, reason) => {
                resolve({ code, reason: reason.toString() });
            });
        });

        expect(result.code).to.equal(1008);
        expect(result.reason).to.equal('Policy violation');
    });

    it("rejects invalid close codes with HTTP 400", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/close/999`);

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

    it("supports custom close codes (4000-4999)", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/close/4567`);

        await new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        const result = await new Promise<{ code: number }>((resolve) => {
            ws.on('close', (code) => {
                resolve({ code });
            });
        });

        expect(result.code).to.equal(4567);
    });

});
