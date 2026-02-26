import * as net from 'net';
import * as tls from 'tls';
import * as http2 from 'http2';
import * as streamConsumers from 'stream/consumers';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';
import {
    buildProxyV1Header,
    buildProxyV2Header,
    createProxySocket,
    httpGetJson
} from './test-helpers.js';

describe("IP endpoint", () => {

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

    it("returns the client origin IP", async () => {
        const response = await fetch(`http://localhost:${serverPort}/ip`);

        expect(response.status).to.equal(200);

        const body = await response.json();
        expect(body.origin).to.be.oneOf(['127.0.0.1', '::1']);
        expect(Object.keys(body)).to.deep.equal(['origin']);
    });

    describe("PROXY protocol", () => {

        // These tests need their own server with trustProxyProtocol enabled
        let proxyServer: DestroyableServer;
        let proxyServerPort: number;

        beforeEach(async () => {
            proxyServer = makeDestroyable(await createServer({ trustProxyProtocol: true }));
            await new Promise<void>((resolve) => proxyServer.listen(resolve));
            proxyServerPort = (proxyServer.address() as net.AddressInfo).port;
        });

        afterEach(async () => {
            await proxyServer.destroy();
        });

        it("extracts origin from PROXY v1 header", async () => {
            const socket = await createProxySocket(proxyServerPort,
                buildProxyV1Header('203.0.113.42', '10.0.0.1', 54321, 80)
            );

            const body = await httpGetJson({
                createConnection: () => socket,
                hostname: 'localhost',
                port: proxyServerPort,
                path: '/ip',
                headers: { 'Connection': 'close' }
            });

            expect(body.origin).to.equal('203.0.113.42');
        });

        it("extracts origin from PROXY v2 header", async () => {
            const socket = await createProxySocket(proxyServerPort,
                buildProxyV2Header('198.51.100.99', '10.0.0.1', 12345, 80)
            );

            const body = await httpGetJson({
                createConnection: () => socket,
                hostname: 'localhost',
                port: proxyServerPort,
                path: '/ip',
                headers: { 'Connection': 'close' }
            });

            expect(body.origin).to.equal('198.51.100.99');
        });

        it("extracts origin from PROXY v1 header with IPv6", async () => {
            const socket = await createProxySocket(proxyServerPort,
                buildProxyV1Header('2001:db8::1', '2001:db8::2', 54321, 80, 'TCP6')
            );

            const body = await httpGetJson({
                createConnection: () => socket,
                hostname: 'localhost',
                port: proxyServerPort,
                path: '/ip',
                headers: { 'Connection': 'close' }
            });

            expect(body.origin).to.equal('2001:db8::1');
        });

        it("handles PROXY v1 UNKNOWN protocol gracefully", async () => {
            const socket = await createProxySocket(proxyServerPort,
                Buffer.from('PROXY UNKNOWN\r\n')
            );

            const body = await httpGetJson({
                createConnection: () => socket,
                hostname: 'localhost',
                port: proxyServerPort,
                path: '/ip',
                headers: { 'Connection': 'close' }
            });

            // Should fall back to socket address (localhost variants)
            expect(body.origin).to.be.oneOf(['127.0.0.1', '::1']);
        });

        it("handles connections without PROXY protocol", async () => {
            const body = await httpGetJson({
                hostname: 'localhost',
                port: proxyServerPort,
                path: '/ip',
                headers: { 'Connection': 'close' }
            });

            // Should use socket address (localhost variants)
            expect(body.origin).to.be.oneOf(['127.0.0.1', '::1']);
        });

        it("ignores PROXY protocol when trustProxyProtocol is disabled", async () => {
            // Use the main server (trustProxyProtocol=false) - PROXY header should be
            // treated as raw data, not parsed, so the connection should fail or return
            // the socket address, not the spoofed IP
            const socket = await createProxySocket(serverPort,
                buildProxyV1Header('203.0.113.42', '10.0.0.1', 54321, 80)
            );

            const result = await httpGetJson({
                createConnection: () => socket,
                hostname: 'localhost',
                port: serverPort,
                path: '/ip',
                headers: { 'Connection': 'close' }
            }).catch((e) => e);

            // Connection fails
            expect(result).to.be.instanceOf(Error);
            expect(result.message).to.equal('socket hang up');
        });

        it("extracts origin from PROXY v1 header with TLS", async () => {
            const socket = await createProxySocket(proxyServerPort,
                buildProxyV1Header('192.0.2.123', '10.0.0.1', 44444, 443)
            );

            // Wait for server to process PROXY header before TLS handshake
            await new Promise(resolve => setTimeout(resolve, 10));

            const tlsSocket = tls.connect({
                socket,
                servername: 'localhost',
                rejectUnauthorized: false
            });
            await new Promise<void>((resolve) => tlsSocket.on('secureConnect', resolve));

            const body = await httpGetJson({
                createConnection: () => tlsSocket as any,
                hostname: 'localhost',
                port: proxyServerPort,
                path: '/ip',
                headers: { 'Connection': 'close' }
            });

            expect(body.origin).to.equal('192.0.2.123');
        });

        it("extracts origin from PROXY v2 header with TLS", async () => {
            const socket = await createProxySocket(proxyServerPort,
                buildProxyV2Header('192.0.2.200', '10.0.0.1', 55555, 443)
            );

            await new Promise(resolve => setTimeout(resolve, 10));

            const tlsSocket = tls.connect({
                socket,
                servername: 'localhost',
                rejectUnauthorized: false
            });
            await new Promise<void>((resolve) => tlsSocket.on('secureConnect', resolve));

            const body = await httpGetJson({
                createConnection: () => tlsSocket as any,
                hostname: 'localhost',
                port: proxyServerPort,
                path: '/ip',
                headers: { 'Connection': 'close' }
            });

            expect(body.origin).to.equal('192.0.2.200');
        });

        it("extracts origin from PROXY v1 header with HTTP/2", async () => {
            const socket = await createProxySocket(proxyServerPort,
                buildProxyV1Header('198.18.0.42', '10.0.0.1', 33333, 80)
            );

            const client = http2.connect(`http://localhost:${proxyServerPort}`, {
                createConnection: () => socket as any
            });

            const request = client.request({
                ':path': '/ip',
                ':method': 'GET'
            });

            const body: any = await streamConsumers.json(request);
            client.close();

            expect(body.origin).to.equal('198.18.0.42');
        });

        it("extracts origin from PROXY v1 header with TLS + HTTP/2", async () => {
            const socket = await createProxySocket(proxyServerPort,
                buildProxyV1Header('203.0.113.99', '10.0.0.1', 22222, 443)
            );

            // Wait for server to process PROXY header before TLS handshake
            await new Promise(resolve => setTimeout(resolve, 10));

            const tlsSocket = tls.connect({
                socket,
                servername: 'localhost',
                rejectUnauthorized: false,
                ALPNProtocols: ['h2']
            });
            await new Promise<void>((resolve) => tlsSocket.on('secureConnect', resolve));

            expect(tlsSocket.alpnProtocol).to.equal('h2');

            const client = http2.connect('https://localhost', {
                createConnection: () => tlsSocket as any
            });

            const request = client.request({
                ':path': '/ip',
                ':method': 'GET'
            });

            const body: any = await streamConsumers.json(request);
            client.close();

            expect(body.origin).to.equal('203.0.113.99');
        });

        it("handles malformed PROXY v1 with invalid port gracefully", async () => {
            const socket = await createProxySocket(proxyServerPort,
                Buffer.from('PROXY TCP4 1.2.3.4 5.6.7.8 99999 80\r\n')
            );

            const body = await httpGetJson({
                createConnection: () => socket,
                hostname: 'localhost',
                port: proxyServerPort,
                path: '/ip',
                headers: { 'Connection': 'close' }
            });

            // Should fall back to socket address
            expect(body.origin).to.be.oneOf(['127.0.0.1', '::1']);
        });

        it("handles malformed PROXY v1 with invalid IP gracefully", async () => {
            const socket = await createProxySocket(proxyServerPort,
                Buffer.from('PROXY TCP4 999.999.999.999 5.6.7.8 1234 80\r\n')
            );

            const body = await httpGetJson({
                createConnection: () => socket,
                hostname: 'localhost',
                port: proxyServerPort,
                path: '/ip',
                headers: { 'Connection': 'close' }
            });

            // Should fall back to socket address
            expect(body.origin).to.be.oneOf(['127.0.0.1', '::1']);
        });

        it("handles PROXY v1 header split across multiple packets", async () => {
            const proxyHeader = buildProxyV1Header('203.0.113.77', '10.0.0.1', 11111, 80);

            const socket = net.connect(proxyServerPort, 'localhost');
            await new Promise<void>((resolve) => socket.on('connect', resolve));

            // Send PROXY header in small chunks
            for (let i = 0; i < proxyHeader.length; i += 5) {
                socket.write(proxyHeader.subarray(i, Math.min(i + 5, proxyHeader.length)));
                await new Promise(resolve => setTimeout(resolve, 1));
            }

            const body = await httpGetJson({
                createConnection: () => socket,
                hostname: 'localhost',
                port: proxyServerPort,
                path: '/ip',
                headers: { 'Connection': 'close' }
            });

            expect(body.origin).to.equal('203.0.113.77');
        });

    });

});
