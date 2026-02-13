import * as net from 'net';
import { expect } from 'chai';
import { WebSocket } from 'ws';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("WebSocket Message endpoint", () => {

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

    it("sends a message then closes", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/message/hello/close/1000`);

        const messages: string[] = [];
        ws.on('message', (data) => {
            messages.push(data.toString());
        });

        await new Promise<void>((resolve, reject) => {
            ws.on('close', () => resolve());
            ws.on('error', reject);
        });

        expect(messages).to.deep.equal(['hello']);
    });

    it("sends multiple messages in chain", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/message/first/message/second/close/1000`);

        const messages: string[] = [];
        ws.on('message', (data) => {
            messages.push(data.toString());
        });

        await new Promise<void>((resolve, reject) => {
            ws.on('close', () => resolve());
            ws.on('error', reject);
        });

        expect(messages).to.deep.equal(['first', 'second']);
    });

    it("decodes URL-encoded messages", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/message/hello%20world/close/1000`);

        const messages: string[] = [];
        ws.on('message', (data) => {
            messages.push(data.toString());
        });

        await new Promise<void>((resolve, reject) => {
            ws.on('close', () => resolve());
            ws.on('error', reject);
        });

        expect(messages).to.deep.equal(['hello world']);
    });

    it("works with delay", async () => {
        const startTime = Date.now();
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/message/before/delay/0.1/message/after/close/1000`);

        const messages: { text: string; time: number }[] = [];
        ws.on('message', (data) => {
            messages.push({ text: data.toString(), time: Date.now() - startTime });
        });

        await new Promise<void>((resolve, reject) => {
            ws.on('close', () => resolve());
            ws.on('error', reject);
        });

        expect(messages.length).to.equal(2);
        expect(messages[0].text).to.equal('before');
        expect(messages[1].text).to.equal('after');
        expect(messages[1].time - messages[0].time).to.be.greaterThan(90);
    });

    it("handles empty message", async () => {
        const ws = new WebSocket(`ws://localhost:${serverPort}/ws/message//close/1000`);

        const messages: string[] = [];
        ws.on('message', (data) => {
            messages.push(data.toString());
        });

        await new Promise<void>((resolve, reject) => {
            ws.on('close', () => resolve());
            ws.on('error', reject);
        });

        expect(messages).to.deep.equal(['']);
    });

});
