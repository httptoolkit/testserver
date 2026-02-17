import * as net from 'net';
import * as http from 'http';
import * as streamConsumers from 'stream/consumers';

export function buildProxyV1Header(
    srcAddr: string,
    dstAddr: string,
    srcPort: number,
    dstPort: number,
    protocol: 'TCP4' | 'TCP6' = 'TCP4'
): Buffer {
    return Buffer.from(`PROXY ${protocol} ${srcAddr} ${dstAddr} ${srcPort} ${dstPort}\r\n`);
}

export function buildProxyV2Header(
    srcAddr: string,
    dstAddr: string,
    srcPort: number,
    dstPort: number,
    isIPv6: boolean = false
): Buffer {
    const signature = Buffer.from([0x0D, 0x0A, 0x0D, 0x0A, 0x00, 0x0D, 0x0A, 0x51, 0x55, 0x49, 0x54, 0x0A]);
    const verCmd = 0x21; // Version 2, PROXY command
    const famProto = isIPv6 ? 0x21 : 0x11; // AF_INET6/AF_INET + STREAM

    if (isIPv6) {
        const addrLen = 36; // 16 + 16 + 2 + 2
        const header = Buffer.alloc(16 + addrLen);
        signature.copy(header, 0);
        header[12] = verCmd;
        header[13] = famProto;
        header.writeUInt16BE(addrLen, 14);

        const srcParts = srcAddr.split(':').map(p => parseInt(p, 16));
        const dstParts = dstAddr.split(':').map(p => parseInt(p, 16));
        for (let i = 0; i < 8; i++) {
            header.writeUInt16BE(srcParts[i] || 0, 16 + i * 2);
            header.writeUInt16BE(dstParts[i] || 0, 32 + i * 2);
        }
        header.writeUInt16BE(srcPort, 48);
        header.writeUInt16BE(dstPort, 50);
        return header;
    } else {
        const addrLen = 12; // 4 + 4 + 2 + 2
        const header = Buffer.alloc(16 + addrLen);
        signature.copy(header, 0);
        header[12] = verCmd;
        header[13] = famProto;
        header.writeUInt16BE(addrLen, 14);

        const srcParts = srcAddr.split('.').map(p => parseInt(p, 10));
        const dstParts = dstAddr.split('.').map(p => parseInt(p, 10));
        for (let i = 0; i < 4; i++) {
            header[16 + i] = srcParts[i];
            header[20 + i] = dstParts[i];
        }
        header.writeUInt16BE(srcPort, 24);
        header.writeUInt16BE(dstPort, 26);
        return header;
    }
}

export async function createProxySocket(port: number, proxyHeader: Buffer): Promise<net.Socket> {
    const socket = net.connect(port, 'localhost');
    await new Promise<void>((resolve) => socket.on('connect', resolve));
    socket.write(proxyHeader);
    return socket;
}

export async function httpGetJson(options: http.RequestOptions): Promise<any> {
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request(options, resolve);
        req.on('error', reject);
        req.end();
    });
    return streamConsumers.json(res);
}
