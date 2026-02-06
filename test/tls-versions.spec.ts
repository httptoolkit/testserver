import * as net from 'net';
import * as tls from 'tls';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("TLS version endpoints", () => {

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

    it("accepts TLS 1.2 client connecting to tls-v1-2.*", async () => {
        const conn = tls.connect({
            host: '127.0.0.1',
            port: serverPort,
            servername: 'tls-v1-2.localhost',
            maxVersion: 'TLSv1.2',
            rejectUnauthorized: false
        });

        const result = await new Promise<{ version: string } | { error: string }>((resolve) => {
            conn.on('secureConnect', () => resolve({ version: conn.getProtocol()! }));
            conn.on('error', (err) => resolve({ error: err.message }));
        });
        conn.destroy();

        expect(result).to.have.property('version', 'TLSv1.2');
    });

    it("accepts TLS 1.3 client connecting to tls-v1-3.*", async () => {
        const conn = tls.connect({
            host: '127.0.0.1',
            port: serverPort,
            servername: 'tls-v1-3.localhost',
            minVersion: 'TLSv1.3',
            rejectUnauthorized: false
        });

        const result = await new Promise<{ version: string } | { error: string }>((resolve) => {
            conn.on('secureConnect', () => resolve({ version: conn.getProtocol()! }));
            conn.on('error', (err) => resolve({ error: err.message }));
        });
        conn.destroy();

        expect(result).to.have.property('version', 'TLSv1.3');
    });

    it("rejects TLS 1.3 client connecting to tls-v1-2.*", async () => {
        const conn = tls.connect({
            host: '127.0.0.1',
            port: serverPort,
            servername: 'tls-v1-2.localhost',
            minVersion: 'TLSv1.3',
            maxVersion: 'TLSv1.3',
            rejectUnauthorized: false
        });

        const result = await new Promise<string>((resolve) => {
            conn.on('secureConnect', () => resolve('connected'));
            conn.on('error', () => resolve('rejected'));
            conn.on('close', () => resolve('closed'));
        });
        conn.destroy();

        expect(result).to.be.oneOf(['rejected', 'closed']);
    });

    it("rejects TLS 1.2 client connecting to tls-v1-3.*", async () => {
        const conn = tls.connect({
            host: '127.0.0.1',
            port: serverPort,
            servername: 'tls-v1-3.localhost',
            minVersion: 'TLSv1.2',
            maxVersion: 'TLSv1.2',
            rejectUnauthorized: false
        });

        const result = await new Promise<string>((resolve) => {
            conn.on('secureConnect', () => resolve('connected'));
            conn.on('error', () => resolve('rejected'));
            conn.on('close', () => resolve('closed'));
        });
        conn.destroy();

        expect(result).to.be.oneOf(['rejected', 'closed']);
    });

    it("negotiates TLS 1.2 when client supports 1.2+ but server requires 1.2", async () => {
        // Client supports both TLS 1.2 and 1.3, server requires specifically TLS 1.2
        // Server enforces version during negotiation, so connection succeeds at TLS 1.2
        const conn = tls.connect({
            host: '127.0.0.1',
            port: serverPort,
            servername: 'tls-v1-2.localhost',
            // Client supports 1.2 and 1.3
            minVersion: 'TLSv1.2',
            rejectUnauthorized: false
        });

        const result = await new Promise<{ version: string } | { error: string }>((resolve) => {
            conn.on('secureConnect', () => resolve({ version: conn.getProtocol()! }));
            conn.on('error', (err) => resolve({ error: err.message }));
        });
        conn.destroy();

        // Server enforces TLS 1.2, so connection succeeds with TLS 1.2
        expect(result).to.have.property('version', 'TLSv1.2');
    });

    it("accepts TLS 1.0 client connecting to tls-v1-0.*", async () => {
        const conn = tls.connect({
            host: '127.0.0.1',
            port: serverPort,
            servername: 'tls-v1-0.localhost',
            minVersion: 'TLSv1' as tls.SecureVersion,
            maxVersion: 'TLSv1' as tls.SecureVersion,
            ciphers: 'DEFAULT@SECLEVEL=0',
            rejectUnauthorized: false
        });

        const result = await new Promise<{ version: string } | { error: string }>((resolve) => {
            conn.on('secureConnect', () => resolve({ version: conn.getProtocol()! }));
            conn.on('error', (err) => resolve({ error: err.message }));
        });
        conn.destroy();

        expect(result).to.have.property('version', 'TLSv1');
    });

    it("accepts TLS 1.1 client connecting to tls-v1-1.*", async () => {
        const conn = tls.connect({
            host: '127.0.0.1',
            port: serverPort,
            servername: 'tls-v1-1.localhost',
            minVersion: 'TLSv1.1' as tls.SecureVersion,
            maxVersion: 'TLSv1.1' as tls.SecureVersion,
            ciphers: 'DEFAULT@SECLEVEL=0',
            rejectUnauthorized: false
        });

        const result = await new Promise<{ version: string } | { error: string }>((resolve) => {
            conn.on('secureConnect', () => resolve({ version: conn.getProtocol()! }));
            conn.on('error', (err) => resolve({ error: err.message }));
        });
        conn.destroy();

        expect(result).to.have.property('version', 'TLSv1.1');
    });

    it("can combine TLS version with other SNI parts", async () => {
        const conn = tls.connect({
            host: '127.0.0.1',
            port: serverPort,
            servername: 'http2.tls-v1-2.localhost',
            maxVersion: 'TLSv1.2',
            ALPNProtocols: ['h2', 'http/1.1'],
            rejectUnauthorized: false
        });

        const result = await new Promise<{ version: string, alpn: string | false | null } | { error: string }>((resolve) => {
            conn.on('secureConnect', () => resolve({
                version: conn.getProtocol()!,
                alpn: conn.alpnProtocol
            }));
            conn.on('error', (err) => resolve({ error: err.message }));
        });
        conn.destroy();

        expect(result).to.have.property('version', 'TLSv1.2');
        expect(result).to.have.property('alpn', 'h2');
    });

    describe("version ranges", () => {

        it("accepts TLS 1.2 on tls-v1-2.tls-v1-3.* (contiguous range)", async () => {
            const conn = tls.connect({
                host: '127.0.0.1',
                port: serverPort,
                servername: 'tls-v1-2.tls-v1-3.localhost',
                minVersion: 'TLSv1.2',
                maxVersion: 'TLSv1.2',
                rejectUnauthorized: false
            });

            const result = await new Promise<{ version: string } | { error: string }>((resolve) => {
                conn.on('secureConnect', () => resolve({ version: conn.getProtocol()! }));
                conn.on('error', (err) => resolve({ error: err.message }));
            });
            conn.destroy();

            expect(result).to.have.property('version', 'TLSv1.2');
        });

        it("accepts TLS 1.3 on tls-v1-2.tls-v1-3.* (contiguous range)", async () => {
            const conn = tls.connect({
                host: '127.0.0.1',
                port: serverPort,
                servername: 'tls-v1-2.tls-v1-3.localhost',
                minVersion: 'TLSv1.3',
                maxVersion: 'TLSv1.3',
                rejectUnauthorized: false
            });

            const result = await new Promise<{ version: string } | { error: string }>((resolve) => {
                conn.on('secureConnect', () => resolve({ version: conn.getProtocol()! }));
                conn.on('error', (err) => resolve({ error: err.message }));
            });
            conn.destroy();

            expect(result).to.have.property('version', 'TLSv1.3');
        });

        it("accepts TLS 1.3 on tls-v1-0.tls-v1-3.* (non-contiguous)", async () => {
            const conn = tls.connect({
                host: '127.0.0.1',
                port: serverPort,
                servername: 'tls-v1-0.tls-v1-3.localhost',
                minVersion: 'TLSv1.3',
                maxVersion: 'TLSv1.3',
                rejectUnauthorized: false
            });

            const result = await new Promise<{ version: string } | { error: string }>((resolve) => {
                conn.on('secureConnect', () => resolve({ version: conn.getProtocol()! }));
                conn.on('error', (err) => resolve({ error: err.message }));
            });
            conn.destroy();

            expect(result).to.have.property('version', 'TLSv1.3');
        });

        it("rejects TLS 1.2 on tls-v1-0.tls-v1-3.* (non-contiguous)", async () => {
            // tls-v1-0.tls-v1-3 allows ONLY 1.0 and 1.3, not 1.1 or 1.2
            const conn = tls.connect({
                host: '127.0.0.1',
                port: serverPort,
                servername: 'tls-v1-0.tls-v1-3.localhost',
                minVersion: 'TLSv1.2',
                maxVersion: 'TLSv1.2',
                rejectUnauthorized: false
            });

            const result = await new Promise<string>((resolve) => {
                conn.on('secureConnect', () => resolve('connected'));
                conn.on('error', () => resolve('rejected'));
                conn.on('close', () => resolve('closed'));
            });
            conn.destroy();

            expect(result).to.be.oneOf(['rejected', 'closed']);
        });

        it("rejects TLS 1.1 on tls-v1-0.tls-v1-3.* (non-contiguous)", async () => {
            // tls-v1-0.tls-v1-3 allows ONLY 1.0 and 1.3, not 1.1 or 1.2
            const conn = tls.connect({
                host: '127.0.0.1',
                port: serverPort,
                servername: 'tls-v1-0.tls-v1-3.localhost',
                minVersion: 'TLSv1.1',
                maxVersion: 'TLSv1.1',
                ciphers: 'DEFAULT@SECLEVEL=0',
                rejectUnauthorized: false
            });

            const result = await new Promise<string>((resolve) => {
                conn.on('secureConnect', () => resolve('connected'));
                conn.on('error', () => resolve('rejected'));
                conn.on('close', () => resolve('closed'));
            });
            conn.destroy();

            expect(result).to.be.oneOf(['rejected', 'closed']);
        });

        it("accepts TLS 1.0 on tls-v1-0.tls-v1-3.* (non-contiguous)", async () => {
            const conn = tls.connect({
                host: '127.0.0.1',
                port: serverPort,
                servername: 'tls-v1-0.tls-v1-3.localhost',
                minVersion: 'TLSv1' as tls.SecureVersion,
                maxVersion: 'TLSv1' as tls.SecureVersion,
                ciphers: 'DEFAULT@SECLEVEL=0',
                rejectUnauthorized: false
            });

            const result = await new Promise<{ version: string } | { error: string }>((resolve) => {
                conn.on('secureConnect', () => resolve({ version: conn.getProtocol()! }));
                conn.on('error', (err) => resolve({ error: err.message }));
            });
            conn.destroy();

            expect(result).to.have.property('version', 'TLSv1');
        });

        it("version order in SNI doesn't matter", async () => {
            // tls-v1-3.tls-v1-2 should behave same as tls-v1-2.tls-v1-3
            const conn = tls.connect({
                host: '127.0.0.1',
                port: serverPort,
                servername: 'tls-v1-3.tls-v1-2.localhost',
                minVersion: 'TLSv1.2',
                maxVersion: 'TLSv1.2',
                rejectUnauthorized: false
            });

            const result = await new Promise<{ version: string } | { error: string }>((resolve) => {
                conn.on('secureConnect', () => resolve({ version: conn.getProtocol()! }));
                conn.on('error', (err) => resolve({ error: err.message }));
            });
            conn.destroy();

            expect(result).to.have.property('version', 'TLSv1.2');
        });

    });

});
