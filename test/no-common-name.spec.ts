import * as net from 'net';
import * as tls from 'tls';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';

describe("no-common-name certificates", () => {

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

    const connect = (servername: string, alpn?: string[]) =>
        new Promise<{ cert: tls.PeerCertificate, protocol: string | false | null }>((resolve, reject) => {
            const conn = tls.connect({
                port: serverPort,
                servername,
                ...(alpn ? { ALPNProtocols: alpn } : {}),
                rejectUnauthorized: false
            });
            conn.on('secureConnect', () => {
                resolve({ cert: conn.getPeerCertificate(), protocol: conn.alpnProtocol });
                conn.destroy();
            });
            conn.on('error', reject);
        });

    it("serves a certificate with no Common Name", async () => {
        const { cert } = await connect('no-common-name.localhost');

        expect(cert.subject.CN).to.equal(undefined);
    });

    it("still identifies the host via the Subject Alternative Name", async () => {
        const { cert } = await connect('no-common-name.localhost');

        expect(cert.subjectaltname).to.equal('DNS:no-common-name.localhost');
    });

    it("can combine no-common-name with protocol preferences", async () => {
        const { cert, protocol } = await connect(
            'http2--no-common-name.localhost',
            ['http/1.1', 'h2']
        );

        expect(cert.subject.CN).to.equal(undefined);
        expect(cert.subjectaltname).to.equal('DNS:http2--no-common-name.localhost');
        expect(protocol).to.equal('h2');
    });

});
