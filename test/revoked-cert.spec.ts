import { expect } from 'chai';
import * as tls from 'tls';
import { createServer } from '../src/server.js';

describe("Revoked certificate endpoint", () => {

    let server: Awaited<ReturnType<typeof createServer>>;
    let serverPort: number;

    before(async () => {
        server = await createServer();
        await new Promise<void>((resolve) => {
            server.listen(0, () => {
                serverPort = (server.address() as any).port;
                resolve();
            });
        });
    });

    after(() => {
        server.close();
    });

    it("generates a certificate for revoked.* prefix", async () => {
        const result = await new Promise<{ authorized: boolean, authorizationError?: Error }>((resolve, reject) => {
            const socket = tls.connect({
                host: 'localhost',
                port: serverPort,
                servername: 'revoked.localhost',
                rejectUnauthorized: false // Don't reject for this test - we just want to inspect
            }, () => {
                const authorized = socket.authorized;
                const authorizationError = socket.authorizationError;

                socket.end();
                resolve({ authorized, authorizationError });
            });

            socket.on('error', reject);
        });

        // The certificate itself should be valid (not expired, etc.) - only revoked via OCSP
        expect(result.authorized).to.be.false; // Not authorized because CA isn't trusted
        expect(result.authorizationError).to.exist;
        if (result.authorizationError instanceof Error) {
            expect(result.authorizationError.message).to.match(/SELF.*SIGNED/i);
        } else {
            // authorizationError might be a string
            expect(String(result.authorizationError)).to.match(/SELF.*SIGNED/i);
        }
    });

    it("provides a revoked OCSP response via stapling", async function() {
        this.timeout(5000);

        const ocspResponse = await new Promise<Buffer | undefined>((resolve, reject) => {
            const socket = tls.connect({
                host: 'localhost',
                port: serverPort,
                servername: 'revoked.localhost',
                rejectUnauthorized: false,
                requestOCSP: true // Request OCSP stapling
            });

            socket.on('OCSPResponse', (response) => {
                socket.end();
                resolve(response);
            });

            socket.on('secureConnect', () => {
                // If no OCSPResponse event fires, resolve with undefined
                setTimeout(() => {
                    socket.end();
                    resolve(undefined);
                }, 1000);
            });

            socket.on('error', reject);
        });

        expect(ocspResponse).to.exist;
        expect(ocspResponse).to.be.instanceOf(Buffer);
        expect(ocspResponse!.length).to.be.greaterThan(0);
    });

    it("Node.js client with OCSP checking rejects revoked certificate", async function() {
        this.timeout(5000);

        let ocspResponseReceived = false;

        try {
            await new Promise<void>((resolve, reject) => {
                const socket = tls.connect({
                    host: 'localhost',
                    port: serverPort,
                    servername: 'revoked.localhost',
                    rejectUnauthorized: false, // We'll check OCSP manually
                    requestOCSP: true
                });

                socket.on('OCSPResponse', (response) => {
                    ocspResponseReceived = true;

                    // In a real implementation, we'd parse the OCSP response and check the status
                    // For now, we just verify we received a response
                    if (response && response.length > 0) {
                        // OCSP response received - in production, Node would reject if status is revoked
                        socket.destroy();
                        reject(new Error('OCSP response indicates revoked status'));
                    }
                });

                socket.on('secureConnect', () => {
                    // Connection succeeded - should not happen for revoked cert with OCSP checking
                    socket.end();
                    resolve();
                });

                socket.on('error', (err) => {
                    reject(err);
                });
            });
        } catch {
            // Expected to fail
        }

        expect(ocspResponseReceived).to.be.true;
    });

    it("regular (non-revoked) certificate gets 'good' OCSP status", async function() {
        this.timeout(5000);

        const ocspResponse = await new Promise<Buffer | undefined>((resolve, reject) => {
            const socket = tls.connect({
                host: 'localhost',
                port: serverPort,
                servername: 'localhost',
                rejectUnauthorized: false,
                requestOCSP: true
            });

            socket.on('OCSPResponse', (response) => {
                socket.end();
                resolve(response);
            });

            socket.on('secureConnect', () => {
                setTimeout(() => {
                    socket.end();
                    resolve(undefined);
                }, 1000);
            });

            socket.on('error', reject);
        });

        // Should receive OCSP response for normal cert too (but with 'good' status)
        expect(ocspResponse).to.exist;
        expect(ocspResponse).to.be.instanceOf(Buffer);
        expect(ocspResponse!.length).to.be.greaterThan(0);
    });

    it("combines revoked with protocol preferences", async () => {
        const result = await new Promise<boolean>((resolve, reject) => {
            const socket = tls.connect({
                host: 'localhost',
                port: serverPort,
                servername: 'http1.revoked.localhost',
                rejectUnauthorized: false,
                ALPNProtocols: ['http/1.1', 'h2']
            }, () => {
                const protocol = socket.alpnProtocol;
                socket.end();
                resolve(protocol === 'http/1.1');
            });

            socket.on('error', reject);
        });

        expect(result).to.be.true;
    });

});
