import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import * as streamConsumers from 'stream/consumers';

import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe("TLS client hello endpoint", () => {

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

    it("returns the full annotated client hello", async () => {
        const response = await new Promise<any>((resolve, reject) => {
            https.get(`https://localhost:${serverPort}/tls/client-hello`, {
                rejectUnauthorized: false
            }, async (res) => {
                try {
                    const body = await streamConsumers.text(res);
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            }).on('error', reject);
        });

        // Top-level structure
        expect(response).to.have.keys([
            'version', 'random', 'sessionId',
            'cipherSuites', 'compressionMethods', 'extensions'
        ]);

        // Version is annotated with id and name
        expect(response.version).to.deep.equal({ id: 0x0303, name: 'TLS 1.2' });

        // Random is a 32-byte hex string
        expect(response.random).to.be.a('string').with.lengthOf(64);

        // SessionId is a hex string or null
        expect(response.sessionId).to.satisfy(
            (v: any) => typeof v === 'string' || v === null
        );

        // Cipher suites are annotated
        expect(response.cipherSuites).to.be.an('array').that.is.not.empty;
        for (const cipher of response.cipherSuites) {
            expect(cipher).to.have.property('id').that.is.a('number');
            expect(cipher).to.have.property('name');
        }

        // Compression methods — modern TLS only sends null (0)
        expect(response.compressionMethods).to.deep.include({ id: 0, name: 'null' });

        // Extensions are annotated
        expect(response.extensions).to.be.an('array').that.is.not.empty;
        for (const ext of response.extensions) {
            expect(ext).to.have.property('id').that.is.a('number');
            expect(ext).to.have.property('name');
            expect(ext).to.have.property('data');
        }
    });

    it("includes server_name extension with correct hostname", async () => {
        const response = await new Promise<any>((resolve, reject) => {
            https.get(`https://localhost:${serverPort}/tls/client-hello`, {
                rejectUnauthorized: false
            }, async (res) => {
                try {
                    const body = await streamConsumers.text(res);
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            }).on('error', reject);
        });

        const sniExt = response.extensions.find((e: any) => e.id === 0);
        expect(sniExt).to.exist;
        expect(sniExt.name).to.equal('server_name');
        expect(sniExt.data).to.deep.equal({ serverName: 'localhost' });
    });

    it("annotates IDs within extension data", async () => {
        const response = await new Promise<any>((resolve, reject) => {
            https.get(`https://localhost:${serverPort}/tls/client-hello`, {
                rejectUnauthorized: false
            }, async (res) => {
                try {
                    const body = await streamConsumers.text(res);
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            }).on('error', reject);
        });

        // supported_versions should have annotated version objects
        const versionsExt = response.extensions.find((e: any) => e.id === 43);
        expect(versionsExt).to.exist;
        expect(versionsExt.name).to.equal('supported_versions');
        expect(versionsExt.data.versions).to.be.an('array').that.is.not.empty;
        for (const v of versionsExt.data.versions) {
            expect(v).to.have.property('id').that.is.a('number');
            expect(v).to.have.property('name');
        }

        // supported_groups should have annotated group objects
        const groupsExt = response.extensions.find((e: any) => e.id === 10);
        expect(groupsExt).to.exist;
        expect(groupsExt.data.groups).to.be.an('array').that.is.not.empty;
        for (const g of groupsExt.data.groups) {
            expect(g).to.have.property('id').that.is.a('number');
            expect(g).to.have.property('name');
        }

        // signature_algorithms should have annotated algorithm objects
        const sigAlgsExt = response.extensions.find((e: any) => e.id === 13);
        expect(sigAlgsExt).to.exist;
        expect(sigAlgsExt.data.algorithms).to.be.an('array').that.is.not.empty;
        for (const a of sigAlgsExt.data.algorithms) {
            expect(a).to.have.property('id').that.is.a('number');
            expect(a).to.have.property('name');
        }
    });

    it("returns 400 for non-TLS connections", async () => {
        const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
            http.get(`http://localhost:${serverPort}/tls/client-hello`, async (res) => {
                try {
                    const body = await streamConsumers.text(res);
                    resolve({ status: res.statusCode!, body: JSON.parse(body) });
                } catch (e) {
                    reject(e);
                }
            }).on('error', reject);
        });

        expect(response.status).to.equal(400);
        expect(response.body.error).to.equal('Not a TLS connection');
    });

});
