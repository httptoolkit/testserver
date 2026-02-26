import * as net from 'net';
import * as http from 'http';
import * as crypto from 'crypto';
import { expect } from 'chai';
import { WebSocket } from 'ws';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

// Raw WebSocket upgrade that skips the ws client's strict subprotocol validation
// (which rejects mismatched or missing server-selected protocols with an error)
function rawUpgrade(port: number, path: string, protocols?: string[]): Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
}> {
    return new Promise((resolve, reject) => {
        const key = crypto.randomBytes(16).toString('base64');
        const headers: Record<string, string> = {
            'Connection': 'Upgrade',
            'Upgrade': 'websocket',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': key,
        };
        if (protocols?.length) {
            headers['Sec-WebSocket-Protocol'] = protocols.join(', ');
        }

        const req = http.request({
            host: 'localhost',
            port,
            path,
            headers
        });

        req.on('upgrade', (res, socket) => {
            resolve({ statusCode: 101, headers: res.headers });
            socket.destroy();
        });
        req.on('response', (res) => {
            resolve({ statusCode: res.statusCode!, headers: res.headers });
        });
        req.on('error', reject);
        req.end();
    });
}

describe("WebSocket Subprotocol endpoints", () => {

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

    describe("/ws/subprotocol/{name}", () => {

        it("selects the specified subprotocol", async () => {
            const ws = new WebSocket(`ws://localhost:${serverPort}/ws/subprotocol/graphql-ws/echo`, ['graphql-ws']);

            await new Promise<void>((resolve, reject) => {
                ws.on('open', resolve);
                ws.on('error', reject);
            });

            expect(ws.protocol).to.equal('graphql-ws');
            ws.close();
        });

        it("forces the specified protocol even if client offered a different one", async () => {
            const result = await rawUpgrade(serverPort, '/ws/subprotocol/mqtt/echo', ['other-protocol']);

            expect(result.statusCode).to.equal(101);
            expect(result.headers['sec-websocket-protocol']).to.equal('mqtt');
        });

        it("forces the specified protocol even when client sends no protocols", async () => {
            const result = await rawUpgrade(serverPort, '/ws/subprotocol/mqtt/echo');

            expect(result.statusCode).to.equal(101);
            expect(result.headers['sec-websocket-protocol']).to.equal('mqtt');
        });

        it("works with chained endpoints", async () => {
            const ws = new WebSocket(`ws://localhost:${serverPort}/ws/subprotocol/test-proto/echo`, ['test-proto']);

            await new Promise<void>((resolve, reject) => {
                ws.on('open', resolve);
                ws.on('error', reject);
            });

            expect(ws.protocol).to.equal('test-proto');

            ws.send('hello');
            const msg = await new Promise<string>((resolve, reject) => {
                ws.on('message', (data) => resolve(data.toString()));
                ws.on('error', reject);
            });
            expect(msg).to.equal('hello');

            ws.close();
        });

    });

    describe("/ws/no-subprotocol", () => {

        it("omits subprotocol header even when client requests one", async () => {
            const result = await rawUpgrade(serverPort, '/ws/no-subprotocol/echo', ['graphql-ws']);

            expect(result.statusCode).to.equal(101);
            expect(result.headers['sec-websocket-protocol']).to.equal(undefined);
        });

    });

    describe("multiple subprotocol endpoints", () => {

        it("rejects multiple subprotocol endpoints in the same chain", async () => {
            const result = await rawUpgrade(
                serverPort,
                '/ws/subprotocol/proto-a/subprotocol/proto-b/echo'
            );

            expect(result.statusCode).to.equal(400);
        });

        it("rejects mixing subprotocol and no-subprotocol", async () => {
            const result = await rawUpgrade(
                serverPort,
                '/ws/no-subprotocol/subprotocol/mqtt/echo'
            );

            expect(result.statusCode).to.equal(400);
        });

    });

    describe("default behavior", () => {

        it("auto-selects first client protocol when no subprotocol endpoint is used", async () => {
            const ws = new WebSocket(`ws://localhost:${serverPort}/ws/echo`, ['proto-a', 'proto-b']);

            await new Promise<void>((resolve, reject) => {
                ws.on('open', resolve);
                ws.on('error', reject);
            });

            expect(ws.protocol).to.equal('proto-a');
            ws.close();
        });

        it("returns empty protocol when client sends none", async () => {
            const ws = new WebSocket(`ws://localhost:${serverPort}/ws/echo`);

            await new Promise<void>((resolve, reject) => {
                ws.on('open', resolve);
                ws.on('error', reject);
            });

            expect(ws.protocol).to.equal('');
            ws.close();
        });

    });

});
