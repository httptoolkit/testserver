// PROXY protocol v1 and v2 parser
// Spec: https://www.haproxy.org/download/1.8/doc/proxy-protocol.txt

export const PROXY_PROTOCOL: unique symbol = Symbol('proxyProtocol');

export interface ProxyProtocolData {
    sourceAddress?: string;
    sourcePort?: number;
    destinationAddress?: string;
    destinationPort?: number;
}

export interface ProxyProtocolResult extends ProxyProtocolData {
    remainingData: Buffer;
}

// V1 signature: "PROXY " (ASCII)
const V1_SIGNATURE = Buffer.from('PROXY ');

// V2 signature: 12 bytes
const V2_SIGNATURE = Buffer.from([
    0x0D, 0x0A, 0x0D, 0x0A, 0x00, 0x0D, 0x0A, 0x51, 0x55, 0x49, 0x54, 0x0A
]);

// Max v1 header length (107 chars + CRLF = 109 bytes)
const V1_MAX_LENGTH = 109;

// V2 fixed header is 16 bytes, plus up to 216 bytes for addresses (Unix sockets)
// Plus potential TLV extensions - cap at reasonable limit
const V2_MIN_HEADER = 16;
const V2_MAX_ADDR_LENGTH = 216;

function startsWithSignature(data: Buffer, signature: Buffer): boolean {
    if (data.length < signature.length) return false;
    for (let i = 0; i < signature.length; i++) {
        if (data[i] !== signature[i]) return false;
    }
    return true;
}

function parseV1(data: Buffer): ProxyProtocolResult | null {
    // Find CRLF within max allowed length
    let crlfIndex = -1;
    const searchLimit = Math.min(data.length, V1_MAX_LENGTH);
    for (let i = 0; i < searchLimit - 1; i++) {
        if (data[i] === 0x0D && data[i + 1] === 0x0A) {
            crlfIndex = i;
            break;
        }
    }

    if (crlfIndex === -1) {
        // No CRLF found - if we have max bytes already, this is invalid
        if (data.length >= V1_MAX_LENGTH) {
            // Invalid header - treat as no PROXY protocol, pass through all data
            return { remainingData: data };
        }
        // Need more data - return null to indicate incomplete
        return null;
    }

    const headerLine = data.subarray(0, crlfIndex).toString('ascii');
    const parts = headerLine.split(' ');
    const remainingData = Buffer.from(data.subarray(crlfIndex + 2));

    // Format: PROXY <protocol> <src_addr> <dst_addr> <src_port> <dst_port>
    // Or: PROXY UNKNOWN [ignored...]
    if (parts.length < 2 || parts[0] !== 'PROXY') {
        // Malformed - return remaining data without proxy info
        return { remainingData };
    }

    const protocol = parts[1];

    if (protocol === 'UNKNOWN') {
        // UNKNOWN means no address info available
        return { remainingData };
    }

    if (protocol !== 'TCP4' && protocol !== 'TCP6') {
        // Unsupported protocol - treat as UNKNOWN
        return { remainingData };
    }

    if (parts.length !== 6) {
        // Malformed - return remaining data without proxy info
        return { remainingData };
    }

    const [, , srcAddr, dstAddr, srcPortStr, dstPortStr] = parts;

    // Validate ports
    const srcPort = parseInt(srcPortStr, 10);
    const dstPort = parseInt(dstPortStr, 10);
    if (isNaN(srcPort) || isNaN(dstPort) || srcPort < 0 || srcPort > 65535 || dstPort < 0 || dstPort > 65535) {
        // Invalid port - treat as UNKNOWN (no address info, but header consumed)
        return { remainingData };
    }

    // Basic address validation
    if (!isValidAddress(srcAddr, protocol) || !isValidAddress(dstAddr, protocol)) {
        // Invalid address - treat as UNKNOWN (no address info, but header consumed)
        return { remainingData };
    }

    return {
        sourceAddress: srcAddr,
        sourcePort: srcPort,
        destinationAddress: dstAddr,
        destinationPort: dstPort,
        remainingData
    };
}

function isValidAddress(addr: string, protocol: string): boolean {
    if (protocol === 'TCP4') {
        // IPv4: should be 4 decimal octets separated by dots
        const parts = addr.split('.');
        if (parts.length !== 4) return false;
        for (const part of parts) {
            const num = parseInt(part, 10);
            if (isNaN(num) || num < 0 || num > 255 || part !== String(num)) return false;
        }
        return true;
    } else if (protocol === 'TCP6') {
        // IPv6: basic check - contains colons, reasonable length
        // Full validation is complex; we do basic sanity check
        if (!addr.includes(':')) return false;
        if (addr.length > 45) return false; // Max IPv6 string length
        // Check for valid hex chars and colons only
        if (!/^[0-9a-fA-F:]+$/.test(addr)) return false;
        return true;
    }
    return false;
}

function parseV2(data: Buffer): ProxyProtocolResult | null {
    if (data.length < V2_MIN_HEADER) {
        return null; // Need more data
    }

    // Byte 12: version (high nibble) and command (low nibble)
    const verCmd = data[12];
    const version = (verCmd & 0xF0) >> 4;
    const command = verCmd & 0x0F;

    if (version !== 2) {
        return null; // Not v2
    }

    // Byte 13: address family (high nibble) and protocol (low nibble)
    const famProto = data[13];
    const family = (famProto & 0xF0) >> 4;
    const proto = famProto & 0x0F;

    // Bytes 14-15: address length (big endian)
    const addrLen = (data[14] << 8) | data[15];

    // Sanity check address length
    if (addrLen > V2_MAX_ADDR_LENGTH) {
        return null;
    }

    const totalHeaderLen = V2_MIN_HEADER + addrLen;
    if (data.length < totalHeaderLen) {
        return null; // Need more data
    }

    const remainingData = Buffer.from(data.subarray(totalHeaderLen));

    // Command 0 = LOCAL (health check, no real address)
    // Command 1 = PROXY (real connection info)
    if (command === 0) {
        return { remainingData };
    }

    if (command !== 1) {
        // Unknown command
        return { remainingData };
    }

    // Only handle STREAM (TCP) - proto 1
    if (proto !== 1) {
        return { remainingData };
    }

    const addrData = data.subarray(V2_MIN_HEADER, totalHeaderLen);

    // Family 1 = AF_INET (IPv4), Family 2 = AF_INET6
    if (family === 1) {
        // IPv4: 4 + 4 + 2 + 2 = 12 bytes
        if (addrLen < 12) return { remainingData };

        const srcAddr = `${addrData[0]}.${addrData[1]}.${addrData[2]}.${addrData[3]}`;
        const dstAddr = `${addrData[4]}.${addrData[5]}.${addrData[6]}.${addrData[7]}`;
        const srcPort = (addrData[8] << 8) | addrData[9];
        const dstPort = (addrData[10] << 8) | addrData[11];

        return {
            sourceAddress: srcAddr,
            sourcePort: srcPort,
            destinationAddress: dstAddr,
            destinationPort: dstPort,
            remainingData
        };
    } else if (family === 2) {
        // IPv6: 16 + 16 + 2 + 2 = 36 bytes
        if (addrLen < 36) return { remainingData };

        const srcAddr = formatIPv6(addrData.subarray(0, 16));
        const dstAddr = formatIPv6(addrData.subarray(16, 32));
        const srcPort = (addrData[32] << 8) | addrData[33];
        const dstPort = (addrData[34] << 8) | addrData[35];

        return {
            sourceAddress: srcAddr,
            sourcePort: srcPort,
            destinationAddress: dstAddr,
            destinationPort: dstPort,
            remainingData
        };
    }

    // Unknown family
    return { remainingData };
}

function formatIPv6(bytes: Buffer): string {
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) {
        const val = (bytes[i] << 8) | bytes[i + 1];
        groups.push(val.toString(16));
    }
    return groups.join(':');
}

export type ProxyProtocolType = 'v1' | 'v2' | 'none' | 'incomplete';

export function detectProxyProtocol(data: Buffer): ProxyProtocolType {
    if (data.length === 0) return 'incomplete';

    // Check for v2 signature first (it's more specific)
    if (data.length >= V2_SIGNATURE.length) {
        if (startsWithSignature(data, V2_SIGNATURE)) {
            return 'v2';
        }
    } else {
        // Could still be v2 if we get more data
        if (startsWithSignature(data, V2_SIGNATURE.subarray(0, data.length))) {
            return 'incomplete';
        }
    }

    if (data.length >= V1_SIGNATURE.length) {
        if (startsWithSignature(data, V1_SIGNATURE)) {
            return 'v1';
        }
    } else {
        if (startsWithSignature(data, V1_SIGNATURE.subarray(0, data.length))) {
            return 'incomplete';
        }
    }

    return 'none';
}

export function parseProxyProtocol(data: Buffer): ProxyProtocolResult | null {
    const type = detectProxyProtocol(data);

    switch (type) {
        case 'v1':
            return parseV1(data);
        case 'v2':
            return parseV2(data);
        case 'none':
            return { remainingData: data };
        case 'incomplete':
            return null;
    }
}

