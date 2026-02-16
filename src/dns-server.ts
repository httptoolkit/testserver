import * as dgram from 'dgram';
import * as dnsPacket from 'dns-packet';

/**
 * Minimal authoritative DNS server for ACME DNS-01 challenges.
 * Responds to TXT record queries with values set via setTxtRecord().
 * All other queries receive an empty authoritative response.
 */
export class DnsServer {
    private socket: dgram.Socket;
    private txtRecords = new Map<string, Set<string>>();

    constructor(private port = 53, private bindAddress = '0.0.0.0') {
        this.socket = dgram.createSocket('udp4');
        this.socket.on('message', (msg, rinfo) => this.handleQuery(msg, rinfo));
        this.socket.on('error', (err) => {
            console.error('DNS server error:', err);
        });
    }

    setTxtRecord(fqdn: string, value: string) {
        const key = fqdn.toLowerCase();
        if (!this.txtRecords.has(key)) this.txtRecords.set(key, new Set());
        this.txtRecords.get(key)!.add(value);
        console.log(`DNS: Set TXT record for ${fqdn} = ${value}`);
    }

    removeTxtRecord(fqdn: string, value: string) {
        const key = fqdn.toLowerCase();
        this.txtRecords.get(key)?.delete(value);
        if (this.txtRecords.get(key)?.size === 0) {
            this.txtRecords.delete(key);
        }
        console.log(`DNS: Removed TXT record for ${fqdn}`);
    }

    private handleQuery(msg: Buffer, rinfo: dgram.RemoteInfo) {
        try {
            const query = dnsPacket.decode(msg);
            const question = query.questions?.[0];
            if (!question) return;

            const name = question.name.toLowerCase();
            const values = this.txtRecords.get(name);

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

    listen(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.socket.once('error', reject);
            this.socket.bind(this.port, this.bindAddress, () => {
                this.socket.removeListener('error', reject);
                console.log(`DNS server listening on port ${this.port}`);
                resolve();
            });
        });
    }

    close(): Promise<void> {
        return new Promise<void>((resolve) => {
            this.socket.close(() => resolve());
        });
    }

}
