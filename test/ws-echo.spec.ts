import * as net from 'net';
import { expect } from 'chai';
import { WebSocket } from 'ws';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("WebSocket Echo endpoint", () => {

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

    it("echoes text messages", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/echo`);

        await new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        ws.send('Hello, WebSocket!');

        const receivedMessage = await new Promise<string>((resolve, reject) => {
            ws.on('message', (data, isBinary) => {
                expect(isBinary).to.equal(false);
                resolve(data.toString());
            });
            ws.on('error', reject);
        });

        expect(receivedMessage).to.equal('Hello, WebSocket!');
        ws.close();
    });

    it("echoes binary messages", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/echo`);

        await new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        const testData = Buffer.from([0x01, 0x02, 0x03, 0xFF, 0xFE, 0x00]);
        ws.send(testData);

        const receivedData = await new Promise<{ data: Buffer; isBinary: boolean }>((resolve, reject) => {
            ws.on('message', (data, isBinary) => {
                resolve({ data: data as Buffer, isBinary });
            });
            ws.on('error', reject);
        });

        expect(receivedData.isBinary).to.equal(true);
        expect(Buffer.compare(receivedData.data, testData)).to.equal(0);
        ws.close();
    });

    it("echoes multiple messages in sequence", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/echo`);

        await new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        const messages = ['first', 'second', 'third'];
        const received: string[] = [];

        for (const msg of messages) {
            ws.send(msg);
        }

        await new Promise<void>((resolve, reject) => {
            ws.on('message', (data) => {
                received.push(data.toString());
                if (received.length === messages.length) {
                    resolve();
                }
            });
            ws.on('error', reject);
        });

        expect(received).to.deep.equal(messages);
        ws.close();
    });

    it("returns 404 for unknown WebSocket paths", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/unknown`);

        const result = await new Promise<{ statusCode: number }>((resolve, reject) => {
            ws.on('open', () => {
                reject(new Error('Should not have connected'));
            });
            ws.on('unexpected-response', (req, res) => {
                resolve({ statusCode: res.statusCode! });
            });
            ws.on('error', reject);
        });

        expect(result.statusCode).to.equal(404);
    });

    it("returns 404 for non-WebSocket paths", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/status/200`);

        const result = await new Promise<{ statusCode: number }>((resolve, reject) => {
            ws.on('open', () => {
                reject(new Error('Should not have connected'));
            });
            ws.on('unexpected-response', (req, res) => {
                resolve({ statusCode: res.statusCode! });
            });
            ws.on('error', reject);
        });

        expect(result.statusCode).to.equal(404);
    });

    it("works over HTTPS (wss://)", async () => {
        const ws = new WebSocket(`wss://localhost:${serverPort}/ws/echo`, {
            rejectUnauthorized: false
        });

        await new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        ws.send('Secure WebSocket!');

        const receivedMessage = await new Promise<string>((resolve, reject) => {
            ws.on('message', (data) => {
                resolve(data.toString());
            });
            ws.on('error', reject);
        });

        expect(receivedMessage).to.equal('Secure WebSocket!');
        ws.close();
    });

    it("handles empty messages", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/echo`);

        await new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        ws.send('');

        const receivedMessage = await new Promise<string>((resolve, reject) => {
            ws.on('message', (data) => {
                resolve(data.toString());
            });
            ws.on('error', reject);
        });

        expect(receivedMessage).to.equal('');
        ws.close();
    });

    it("handles large messages", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/echo`);

        await new Promise<void>((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        const largeMessage = 'x'.repeat(100000);
        ws.send(largeMessage);

        const receivedMessage = await new Promise<string>((resolve, reject) => {
            ws.on('message', (data) => {
                resolve(data.toString());
            });
            ws.on('error', reject);
        });

        expect(receivedMessage).to.equal(largeMessage);
        expect(receivedMessage.length).to.equal(100000);
        ws.close();
    });

});
