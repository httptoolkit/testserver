import * as net from 'net';
import * as tls from 'tls';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { extractLeafCertificate } from '../src/tls-certificates/cert-definitions.js';
import { createTestServer } from './test-helpers.js';

const fakeCert = (body: string) =>
    `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;

describe("extractLeafCertificate", () => {

    it("returns only the leaf from a leaf+intermediates bundle", () => {
        const bundle = [fakeCert('LEAF'), fakeCert('INTERMEDIATE'), fakeCert('ROOT')].join('\n');

        const leaf = extractLeafCertificate(bundle);

        expect(leaf).to.include('LEAF');
        expect(leaf).to.not.include('INTERMEDIATE');
        expect(leaf).to.not.include('ROOT');
    });

    it("returns the single certificate when there is no intermediate", () => {
        const leaf = extractLeafCertificate(fakeCert('LEAF'));
        expect(leaf).to.include('LEAF');
    });

    it("throws when no certificate is present", () => {
        expect(() => extractLeafCertificate('not a certificate')).to.throw();
    });

});

describe("incomplete-chain certificates", () => {

    let server: DestroyableServer;
    let serverPort: number;

    beforeEach(async () => {
        server = makeDestroyable(await createTestServer());
        await new Promise<void>((resolve) => server.listen(resolve));
        serverPort = (server.address() as net.AddressInfo).port;
    });

    afterEach(async () => {
        await server.destroy();
    });

    const connectAndGetChain = (servername: string, alpn?: string[]) =>
        new Promise<{ cert: tls.DetailedPeerCertificate, protocol: string | false | null }>((resolve, reject) => {
            const conn = tls.connect({
                port: serverPort,
                servername,
                ...(alpn ? { ALPNProtocols: alpn } : {}),
                rejectUnauthorized: false
            });
            conn.on('secureConnect', () => {
                resolve({ cert: conn.getPeerCertificate(true), protocol: conn.alpnProtocol });
                conn.destroy();
            });
            conn.on('error', reject);
        });

    // Walk the chain the server actually presented, counting distinct certificates.
    const presentedChainLength = (leaf: tls.DetailedPeerCertificate) => {
        const seen = new Set<string>();
        let cert: tls.DetailedPeerCertificate | undefined = leaf;
        while (cert?.fingerprint256 && !seen.has(cert.fingerprint256)) {
            seen.add(cert.fingerprint256);
            cert = cert.issuerCertificate;
        }
        return seen.size;
    };

    it("serves the leaf certificate for the requested domain", async () => {
        const { cert } = await connectAndGetChain('incomplete-chain.localhost');

        expect(cert.subject.CN).to.equal('incomplete-chain.localhost');
        expect(cert.subjectaltname).to.equal('DNS:incomplete-chain.localhost');
    });

    it("issues the leaf via a genuine intermediate CA", async () => {
        const { cert } = await connectAndGetChain('incomplete-chain.localhost');

        expect(cert.issuer.CN).to.equal('Test Intermediate CA');
        expect(cert.issuer.CN).to.not.equal(cert.subject.CN);
    });

    it("presents no intermediate certificates alongside the leaf", async () => {
        const { cert } = await connectAndGetChain('incomplete-chain.localhost');

        // The intermediate is omitted, so the client receives a single certificate
        // and cannot build a complete chain even if it trusts the root.
        expect(presentedChainLength(cert)).to.equal(1);
    });

    it("can combine incomplete-chain with protocol preferences", async () => {
        const { cert, protocol } = await connectAndGetChain(
            'http2--incomplete-chain.localhost',
            ['http/1.1', 'h2']
        );

        expect(cert.subject.CN).to.equal('http2--incomplete-chain.localhost');
        expect(protocol).to.equal('h2');
    });

});
