import * as net from 'net';
import { expect } from 'chai';
import { WebSocket } from 'ws';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("WebSocket Repeat endpoint", () => {

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

    it("sends repeated messages at specified interval", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/repeat/ping/50`);

        const messages: { text: string; time: number }[] = [];
        const startTime = Date.now();

        ws.on('message', (data) => {
            messages.push({ text: data.toString(), time: Date.now() - startTime });
        });

        await new Promise<void>((resolve) => {
            ws.on('open', () => {
                setTimeout(() => {
                    ws.close();
                    resolve();
                }, 180);
            });
        });

        // Should have received ~3-4 messages in 180ms at 50ms intervals
        expect(messages.length).to.be.greaterThanOrEqual(3);
        expect(messages.length).to.be.lessThanOrEqual(4);
        expect(messages.every(m => m.text === 'ping')).to.be.true;
    });

    it("decodes URL-encoded messages", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/repeat/hello%20world/50`);

        const message = await new Promise<string>((resolve) => {
            ws.on('message', (data) => {
                resolve(data.toString());
                ws.close();
            });
        });

        expect(message).to.equal('hello world');
    });

    it("rejects invalid frequency", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/repeat/msg/notanumber`);

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

    it("rejects zero frequency", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/repeat/msg/0`);

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

    it("chains with close", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/repeat/tick/30/delay/0.1/close/1000`);

        const messages: string[] = [];
        ws.on('message', (data) => {
            messages.push(data.toString());
        });

        const result = await new Promise<{ code: number }>((resolve) => {
            ws.on('close', (code) => {
                resolve({ code });
            });
        });

        // Should have received messages during the 100ms delay
        expect(messages.length).to.be.greaterThanOrEqual(2);
        expect(messages.every(m => m === 'tick')).to.be.true;
        expect(result.code).to.equal(1000);
    });

});
