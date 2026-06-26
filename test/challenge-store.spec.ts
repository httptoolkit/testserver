import * as dgram from 'node:dgram';
import * as dnsPacket from 'dns-packet';

import { expect } from 'chai';

import { S3ChallengeStore } from '../src/tls-certificates/s3-challenge-store.js';
import { DnsServer } from '../src/dns-server.js';
import { startS3Mock, S3Mock } from './s3-mock.js';

function txtValues(pkt: dnsPacket.Packet): string[] {
    const out: string[] = [];
    for (const answer of pkt.answers ?? []) {
        if (answer.type !== 'TXT') continue;
        const data = (answer as dnsPacket.TxtAnswer).data;
        const parts = Array.isArray(data) ? data : [data];
        for (const part of parts) out.push(Buffer.isBuffer(part) ? part.toString() : String(part));
    }
    return out;
}

function dnsTxtQuery(port: number, name: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const client = dgram.createSocket('udp4');
        const timer = setTimeout(() => { client.close(); reject(new Error('DNS query timed out')); }, 2000);
        client.on('message', (msg) => {
            clearTimeout(timer);
            client.close();
            resolve(txtValues(dnsPacket.decode(msg)));
        });
        client.on('error', (e) => { clearTimeout(timer); client.close(); reject(e); });
        client.send(dnsPacket.encode({
            type: 'query',
            id: 0x1234,
            flags: 0,
            questions: [{ type: 'TXT', name }]
        }), port, '127.0.0.1');
    });
}

describe("S3ChallengeStore", () => {

    let mock: S3Mock;
    let store: S3ChallengeStore;
    const challengeConfig = () => ({ ...mock.config, prefix: 'acme-challenges/' });

    beforeEach(async () => {
        mock = await startS3Mock();
        store = new S3ChallengeStore(challengeConfig());
    });
    afterEach(async () => { await mock.close(); });

    it("round-trips a challenge value", async () => {
        await store.set('_acme-challenge.example.com', 'token-1');
        expect(await store.get('_acme-challenge.example.com')).to.deep.equal(['token-1']);
    });

    it("keeps multiple concurrent values for the same name", async () => {
        await store.set('_acme-challenge.example.com', 'token-1');
        await store.set('_acme-challenge.example.com', 'token-2');
        expect((await store.get('_acme-challenge.example.com')).sort()).to.deep.equal(['token-1', 'token-2']);
    });

    it("returns nothing for an unknown name", async () => {
        expect(await store.get('_acme-challenge.missing.com')).to.deep.equal([]);
    });

    it("removes a value", async () => {
        await store.set('_acme-challenge.example.com', 'token-1');
        await store.remove('_acme-challenge.example.com', 'token-1');
        expect(await store.get('_acme-challenge.example.com')).to.deep.equal([]);
    });

    it("treats removing a missing value as a no-op", async () => {
        await store.remove('_acme-challenge.example.com', 'nope');
    });

    it("ignores expired records", async () => {
        const expiring = new S3ChallengeStore(challengeConfig(), -1); // Expired the instant it's written
        await expiring.set('_acme-challenge.example.com', 'token-1');
        expect(await store.get('_acme-challenge.example.com')).to.deep.equal([]);
    });
});

describe("DnsServer challenge coordination", () => {

    let mock: S3Mock;
    let store: S3ChallengeStore;
    let dns: DnsServer;
    let port: number;
    const challengeConfig = () => ({ ...mock.config, prefix: 'acme-challenges/' });

    beforeEach(async () => {
        mock = await startS3Mock();
        store = new S3ChallengeStore(challengeConfig());
        dns = new DnsServer(0, '127.0.0.1', store);
        port = await dns.listen();
    });
    afterEach(async () => {
        await dns.close();
        await mock.close();
    });

    it("answers a challenge another server wrote to the shared store", async () => {
        await store.set('_acme-challenge.shared.example', 'remote-token'); // 'another machine'
        expect(await dnsTxtQuery(port, '_acme-challenge.shared.example')).to.deep.equal(['remote-token']);
    });

    it("publishes locally-set challenges to the shared store", async () => {
        await dns.setTxtRecord('_acme-challenge.local.example', 'local-token');

        // A different server, sharing only the store, can now answer it:
        const otherDns = new DnsServer(0, '127.0.0.1', new S3ChallengeStore(challengeConfig()));
        const otherPort = await otherDns.listen();
        try {
            expect(await dnsTxtQuery(otherPort, '_acme-challenge.local.example')).to.deep.equal(['local-token']);
        } finally {
            await otherDns.close();
        }
    });

    it("removes locally-set challenges from the shared store", async () => {
        await dns.setTxtRecord('_acme-challenge.local.example', 'local-token');
        await dns.removeTxtRecord('_acme-challenge.local.example', 'local-token');
        expect(await dnsTxtQuery(port, '_acme-challenge.local.example')).to.deep.equal([]);
    });

    it("does not consult the shared store for non-challenge names", async () => {
        expect(await dnsTxtQuery(port, 'example.com')).to.deep.equal([]);
    });
});
