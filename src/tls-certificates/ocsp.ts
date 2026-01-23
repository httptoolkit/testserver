import * as x509 from '@peculiar/x509';
import * as asn1Ocsp from '@peculiar/asn1-ocsp';
import * as asn1X509 from '@peculiar/asn1-x509';
import * as asn1Schema from '@peculiar/asn1-schema';

const crypto = globalThis.crypto;

// OIDs
const OID_SHA1 = '1.3.14.3.2.26';
const OID_SHA256_WITH_RSA = '1.2.840.113549.1.1.11';

// CRL Reasons (RFC 5280)
export enum RevocationReason {
    unspecified = 0,
    keyCompromise = 1,
    cACompromise = 2,
    affiliationChanged = 3,
    superseded = 4,
    cessationOfOperation = 5,
    certificateHold = 6,
    removeFromCRL = 8,
    privilegeWithdrawn = 9,
    aACompromise = 10
}

interface OcspResponseOptions {
    cert: x509.X509Certificate;
    issuerCert: x509.X509Certificate;
    issuerKey: CryptoKey;
    status: 'good' | 'revoked' | 'unknown';
    revocationTime?: Date;
    revocationReason?: RevocationReason;
    thisUpdate?: Date;
    nextUpdate?: Date;
}

async function sha1Hash(data: BufferSource): Promise<ArrayBuffer> {
    return await crypto.subtle.digest('SHA-1', data);
}

function createCertId(
    cert: x509.X509Certificate,
    issuerCert: x509.X509Certificate,
    issuerNameHash: ArrayBuffer,
    issuerKeyHash: ArrayBuffer
): asn1Ocsp.CertID {
    // Get serial number as hex string and convert to bytes
    const serialHex = cert.serialNumber;
    // Remove any spaces and ensure even length
    const cleanSerial = serialHex.replace(/\s/g, '');
    const serialBytes = new Uint8Array(
        cleanSerial.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
    );

    return new asn1Ocsp.CertID({
        hashAlgorithm: new asn1X509.AlgorithmIdentifier({
            algorithm: OID_SHA1,
            parameters: null
        }),
        issuerNameHash: new asn1Schema.OctetString(issuerNameHash),
        issuerKeyHash: new asn1Schema.OctetString(issuerKeyHash),
        serialNumber: serialBytes
    });
}

function createCertStatus(
    status: 'good' | 'revoked' | 'unknown',
    revocationTime?: Date,
    revocationReason?: RevocationReason
): asn1Ocsp.CertStatus {
    if (status === 'good') {
        // For CHOICE types, pass the selected option in the constructor
        return new asn1Ocsp.CertStatus({ good: null });
    } else if (status === 'revoked') {
        // Don't set revocationReason for now - simplify to debug
        const revoked = new asn1Ocsp.RevokedInfo({
            revocationTime: revocationTime || new Date()
        });
        return new asn1Ocsp.CertStatus({ revoked });
    } else {
        return new asn1Ocsp.CertStatus({ unknown: null });
    }
}

async function createSingleResponse(
    options: OcspResponseOptions,
    issuerNameHash: ArrayBuffer,
    issuerKeyHash: ArrayBuffer
): Promise<asn1Ocsp.SingleResponse> {
    const thisUpdate = options.thisUpdate || new Date();

    const singleResponse = new asn1Ocsp.SingleResponse({
        certID: createCertId(options.cert, options.issuerCert, issuerNameHash, issuerKeyHash),
        certStatus: createCertStatus(options.status, options.revocationTime, options.revocationReason),
        thisUpdate
    });

    if (options.nextUpdate) {
        singleResponse.nextUpdate = options.nextUpdate;
    }

    return singleResponse;
}

async function createResponseData(
    issuerCert: x509.X509Certificate,
    responses: asn1Ocsp.SingleResponse[]
): Promise<asn1Ocsp.ResponseData> {
    // Parse the issuer's name from its certificate
    const issuerCertAsn1 = asn1Schema.AsnConvert.parse(issuerCert.rawData, asn1X509.Certificate);
    const issuerName = issuerCertAsn1.tbsCertificate.subject;

    return new asn1Ocsp.ResponseData({
        responderID: new asn1Ocsp.ResponderID({ byName: issuerName }),
        producedAt: new Date(),
        responses
    });
}

async function signResponseData(
    responseData: asn1Ocsp.ResponseData,
    issuerKey: CryptoKey
): Promise<ArrayBuffer> {
    // Serialize the response data
    const responseDataDer = asn1Schema.AsnConvert.serialize(responseData);

    // Sign with SHA-256 + RSA
    const signature = await crypto.subtle.sign(
        {
            name: "RSASSA-PKCS1-v1_5",
            hash: "SHA-256"
        },
        issuerKey,
        responseDataDer
    );

    return signature;
}

async function createBasicOcspResponse(
    responseData: asn1Ocsp.ResponseData,
    issuerKey: CryptoKey,
    issuerCert: x509.X509Certificate
): Promise<asn1Ocsp.BasicOCSPResponse> {
    const signature = await signResponseData(responseData, issuerKey);

    // Create bit string from signature ArrayBuffer
    const signatureBitString = new Uint8Array(signature);

    const basicResponse = new asn1Ocsp.BasicOCSPResponse({
        tbsResponseData: responseData,
        signatureAlgorithm: new asn1X509.AlgorithmIdentifier({
            algorithm: OID_SHA256_WITH_RSA,
            parameters: null
        }),
        signature: signatureBitString
    });

    // Include the issuer certificate in the response
    const issuerCertDer = issuerCert.rawData;
    basicResponse.certs = [asn1Schema.AsnConvert.parse(issuerCertDer, asn1X509.Certificate)];

    return basicResponse;
}

export async function createOcspResponse(options: OcspResponseOptions): Promise<Buffer> {
    // Hash the issuer's distinguished name
    const issuerCertAsn1 = asn1Schema.AsnConvert.parse(options.issuerCert.rawData, asn1X509.Certificate);
    const issuerNameDer = asn1Schema.AsnConvert.serialize(issuerCertAsn1.tbsCertificate.subject);
    const issuerNameHash = await sha1Hash(issuerNameDer);

    // Hash the issuer's public key
    const issuerPublicKeyInfo = issuerCertAsn1.tbsCertificate.subjectPublicKeyInfo;
    const issuerKeyBytes = new Uint8Array(issuerPublicKeyInfo.subjectPublicKey);
    const issuerKeyHash = await sha1Hash(issuerKeyBytes);

    const singleResponse = await createSingleResponse(options, issuerNameHash, issuerKeyHash);
    const responseData = await createResponseData(options.issuerCert, [singleResponse]);
    const basicResponse = await createBasicOcspResponse(responseData, options.issuerKey, options.issuerCert);

    // Wrap in OCSPResponse
    const basicResponseDer = asn1Schema.AsnConvert.serialize(basicResponse);
    const ocspResponse = new asn1Ocsp.OCSPResponse({
        responseStatus: asn1Ocsp.OCSPResponseStatus.successful,
        responseBytes: new asn1Ocsp.ResponseBytes({
            responseType: asn1Ocsp.id_pkix_ocsp_basic,
            response: new asn1Schema.OctetString(basicResponseDer)
        })
    });

    const der = asn1Schema.AsnConvert.serialize(ocspResponse);
    return Buffer.from(der);
}

// Parse an OCSP request to extract the CertID
export function parseOcspRequest(requestDer: Buffer): {
    issuerNameHash: string;
    issuerKeyHash: string;
    serialNumber: string;
} | null {
    try {
        const request = asn1Schema.AsnConvert.parse(requestDer, asn1Ocsp.OCSPRequest);
        const firstRequest = request.tbsRequest.requestList[0];
        const certId = firstRequest.reqCert;

        // OctetString has a buffer property that contains the actual data
        const issuerNameHash = Buffer.from(certId.issuerNameHash.buffer).toString('hex');
        const issuerKeyHash = Buffer.from(certId.issuerKeyHash.buffer).toString('hex');
        const serialNumber = Buffer.from(certId.serialNumber).toString('hex');

        return { issuerNameHash, issuerKeyHash, serialNumber };
    } catch (e) {
        console.error('Failed to parse OCSP request:', e);
        return null;
    }
}
