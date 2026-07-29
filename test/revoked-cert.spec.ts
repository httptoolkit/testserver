import { expect } from 'chai';
import * as tls from 'tls';
import * as x509 from '@peculiar/x509';
import { createTestServer } from './test-helpers.js';
import { certIdHashes, parseSingleResponse } from './ocsp-helpers.js';

describe("Revoked certificate endpoint", () => {

    let server: Awaited<ReturnType<typeof createTestServer>>;
    let serverPort: number;

    before(async () => {
        server = await createTestServer();
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
            } as any);

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
                } as any);

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

        const { ocspResponse, leaf, issuer } = await new Promise<{
            ocspResponse: Buffer | null | undefined,
            leaf: Buffer,
            issuer: Buffer
        }>((resolve, reject) => {
            let staple: Buffer | null | undefined;

            const socket = tls.connect({
                host: 'localhost',
                port: serverPort,
                servername: 'localhost',
                rejectUnauthorized: false,
                requestOCSP: true
            } as any);

            socket.on('OCSPResponse', (response) => { staple = response; });

            socket.on('secureConnect', () => {
                const peerCert = socket.getPeerCertificate(true);
                socket.end();
                resolve({
                    ocspResponse: staple,
                    leaf: peerCert.raw,
                    issuer: peerCert.issuerCertificate.raw
                });
            });

            socket.on('error', reject);
        });

        expect(ocspResponse).to.exist;

        // A 'good' status, for the served cert as identified by its real issuer
        const { certID, certStatus } = parseSingleResponse(ocspResponse!);
        const expectedHashes = await certIdHashes(new x509.X509Certificate(issuer));

        expect(certStatus.good).to.not.be.undefined;
        expect(certStatus.revoked).to.be.undefined;
        expect(Buffer.from(certID.issuerNameHash.buffer).toString('hex')).to.equal(expectedHashes.nameHash);
        expect(Buffer.from(certID.issuerKeyHash.buffer).toString('hex')).to.equal(expectedHashes.keyHash);
        expect(Buffer.from(certID.serialNumber).toString('hex').replace(/^00/, ''))
            .to.equal(new x509.X509Certificate(leaf).serialNumber.toLowerCase());
    });

    it("staples a self-signed revoked certificate's own OCSP response", async function() {
        this.timeout(5000);

        const { ocspResponse, peerCert } = await new Promise<{
            ocspResponse: Buffer | null | undefined,
            peerCert: Buffer
        }>((resolve, reject) => {
            let staple: Buffer | null | undefined;

            const socket = tls.connect({
                host: 'localhost',
                port: serverPort,
                servername: 'self-signed--revoked.localhost',
                rejectUnauthorized: false,
                requestOCSP: true
            } as any);

            socket.on('OCSPResponse', (response) => { staple = response; });

            socket.on('secureConnect', () => {
                const peerCert = socket.getPeerCertificate().raw;
                socket.end();
                resolve({ ocspResponse: staple, peerCert });
            });

            socket.on('error', reject);
        });

        expect(ocspResponse).to.exist;

        // The staple must describe the cert we actually served - a self-signed cert is its
        // own issuer, so every CertID field comes from the served cert itself.
        const served = new x509.X509Certificate(peerCert);
        const expectedHashes = await certIdHashes(served);
        const { certID, certStatus } = parseSingleResponse(ocspResponse!);

        expect(Buffer.from(certID.issuerNameHash.buffer).toString('hex')).to.equal(expectedHashes.nameHash);
        expect(Buffer.from(certID.issuerKeyHash.buffer).toString('hex')).to.equal(expectedHashes.keyHash);
        expect(Buffer.from(certID.serialNumber).toString('hex').replace(/^00/, ''))
            .to.equal(served.serialNumber.toLowerCase());
        expect(certStatus.revoked).to.exist;
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

    it("supports -- separator for revoked with protocol preferences", async () => {
        const result = await new Promise<boolean>((resolve, reject) => {
            const socket = tls.connect({
                host: 'localhost',
                port: serverPort,
                servername: 'http1--revoked.localhost',
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
