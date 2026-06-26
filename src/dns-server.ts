import * as dgram from 'dgram';
import * as dnsPacket from 'dns-packet';

const ACME_CHALLENGE_PREFIX = '_acme-challenge.';

export interface ChallengeStore {
    set(fqdn: string, value: string): Promise<void>;
    remove(fqdn: string, value: string): Promise<void>;
    get(fqdn: string): Promise<string[]>;
}

/**
 * Minimal authoritative DNS server for ACME DNS-01 challenges.
 * Responds to TXT record queries with values set via setTxtRecord().
 * All other queries receive an empty authoritative response.
 *
 * When a ChallengeStore is provided, challenge records are also shared through it so
 * that any machine in the fleet can answer a challenge another machine is performing.
 */
export class DnsServer {
    private socket: dgram.Socket;
    private txtRecords = new Map<string, Set<string>>();

    constructor(
        private port = 53,
        private bindAddress = '0.0.0.0',
        private challengeStore?: ChallengeStore
    ) {
        this.socket = dgram.createSocket('udp4');
        this.socket.on('message', (msg, rinfo) => this.handleQuery(msg, rinfo));
        this.socket.on('error', (err) => {
            console.error('DNS server error:', err);
        });
    }

    async setTxtRecord(fqdn: string, value: string) {
        const key = fqdn.toLowerCase();
        if (!this.txtRecords.has(key)) this.txtRecords.set(key, new Set());
        this.txtRecords.get(key)!.add(value);
        console.log(`DNS: Set TXT record for ${fqdn} = ${value}`);

        if (this.challengeStore) await this.challengeStore.set(key, value);
    }

    async removeTxtRecord(fqdn: string, value: string) {
        const key = fqdn.toLowerCase();
        this.txtRecords.get(key)?.delete(value);
        if (this.txtRecords.get(key)?.size === 0) {
            this.txtRecords.delete(key);
        }
        console.log(`DNS: Removed TXT record for ${fqdn}`);

        if (this.challengeStore) await this.challengeStore.remove(key, value);
    }

    private async handleQuery(msg: Buffer, rinfo: dgram.RemoteInfo) {
        try {
            const query = dnsPacket.decode(msg);
            const question = query.questions?.[0];
            if (!question) return;

            const name = question.name.toLowerCase();
            let values = this.txtRecords.get(name);

            // Challenge records may have been set on another machine, so for ACME
            // challenge names fall back to the shared store on a local miss. Other
            // queries stay purely in-memory, off the shared store entirely.
            if (
                question.type === 'TXT' &&
                !values?.size &&
                this.challengeStore &&
                name.startsWith(ACME_CHALLENGE_PREFIX)
            ) {
                try {
                    const shared = await this.challengeStore.get(name);
                    if (shared.length) values = new Set(shared);
                } catch (e) {
                    console.error('DNS: Failed to read challenge store:', e);
                }
            }

            const answers: dnsPacket.TxtAnswer[] =
                (question.type === 'TXT' && values?.size)
                    ? [...values].map(v => ({
                        type: 'TXT' as const,
                        class: 'IN' as const,
                        name: question.name,
                        ttl: 60,
                        data: v
                    }))
                    : [];

            const response = dnsPacket.encode({
                type: 'response',
                id: query.id,
                flags: dnsPacket.AUTHORITATIVE_ANSWER,
                questions: query.questions,
                answers
            });

            this.socket.send(response, rinfo.port, rinfo.address);
        } catch (err) {
            console.error('DNS: Failed to handle query:', err);
        }
    }

    listen(): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            this.socket.once('error', reject);
            this.socket.bind(this.port, this.bindAddress, () => {
                this.socket.removeListener('error', reject);
                const port = this.socket.address().port;
                console.log(`DNS server listening on port ${port}`);
                resolve(port);
            });
        });
    }

    close(): Promise<void> {
        return new Promise<void>((resolve) => {
            this.socket.close(() => resolve());
        });
    }

}
