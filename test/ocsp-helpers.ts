import * as x509 from '@peculiar/x509';
import * as asn1Ocsp from '@peculiar/asn1-ocsp';
import * as asn1X509 from '@peculiar/asn1-x509';
import * as asn1Schema from '@peculiar/asn1-schema';

const crypto = globalThis.crypto;

// Read a CertID serial the way a client does: as a signed DER INTEGER, so that a missing
// sign pad shows up as the negative (i.e. wrong) serial that it is.
export function readSignedInteger(bytes: BufferSource): bigint {
    const buffer = Buffer.from(ArrayBuffer.isView(bytes)
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        : bytes
    );

    const magnitude = BigInt(`0x${buffer.toString('hex')}`);
    return (buffer[0]! & 0x80)
        ? magnitude - (1n << BigInt(buffer.length * 8))
        : magnitude;
}

export function parseSingleResponse(response: Buffer) {
    const parsed = asn1Schema.AsnConvert.parse(response, asn1Ocsp.OCSPResponse);
    const basicResponse = asn1Schema.AsnConvert.parse(
        parsed.responseBytes!.response.buffer,
        asn1Ocsp.BasicOCSPResponse
    );
    return basicResponse.tbsResponseData.responses[0]!;
}

// The CertID hashes a client would calculate for certs issued by this issuer
export async function certIdHashes(issuerCert: x509.X509Certificate) {
    const asn1 = asn1Schema.AsnConvert.parse(issuerCert.rawData, asn1X509.Certificate);
    const nameHash = await crypto.subtle.digest(
        'SHA-1',
        asn1Schema.AsnConvert.serialize(asn1.tbsCertificate.subject)
    );
    const keyHash = await crypto.subtle.digest(
        'SHA-1',
        new Uint8Array(asn1.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey)
    );
    return {
        nameHash: Buffer.from(nameHash).toString('hex'),
        keyHash: Buffer.from(keyHash).toString('hex')
    };
}

export function toDer(certPem: string) {
    return Buffer.from(new x509.X509Certificate(certPem).rawData);
}
