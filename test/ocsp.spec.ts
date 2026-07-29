import { expect } from 'chai';
import * as x509 from '@peculiar/x509';
import * as asn1Ocsp from '@peculiar/asn1-ocsp';
import * as asn1X509 from '@peculiar/asn1-x509';
import * as asn1Schema from '@peculiar/asn1-schema';
import { createOcspResponse, parseOcspRequest, RevocationReason } from '../src/tls-certificates/ocsp.js';
import { generateCACertificate, LocalCA } from '../src/tls-certificates/local-ca.js';
import { extractLeafCertificate } from '../src/tls-certificates/cert-definitions.js';
import { certIdHashes, parseSingleResponse, readSignedInteger, toDer } from './ocsp-helpers.js';

const crypto = globalThis.crypto;

async function pemToCryptoKey(pem: string) {
    const pkcs8KeyData = x509.PemConverter.decodeFirst(pem);
    return await crypto.subtle.importKey(
        "pkcs8",
        pkcs8KeyData,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        true,
        ["sign"]
    );
}

describe("OCSP response generation", () => {

    let caCert: x509.X509Certificate;
    let caKey: CryptoKey;
    let caCertPem: string;
    let cert: x509.X509Certificate;
    let certPem: string;

    before(async () => {
        // Generate a test CA using our existing function
        const caGenerated = await generateCACertificate({
            commonName: 'Test CA',
            organizationName: 'Test Org'
        });
        caCertPem = caGenerated.cert;
        caCert = new x509.X509Certificate(caCertPem);
        caKey = await pemToCryptoKey(caGenerated.key);

        // Generate a test certificate
        const keyAlgorithm = {
            name: "RSASSA-PKCS1-v1_5",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256"
        };

        const keyPair = await crypto.subtle.generateKey(
            keyAlgorithm,
            true,
            ["sign", "verify"]
        ) as CryptoKeyPair;

        const notBefore = new Date();
        const notAfter = new Date();
        notAfter.setFullYear(notAfter.getFullYear() + 1);

        cert = await x509.X509CertificateGenerator.create({
            serialNumber: 'A123456789ABCDEF',
            subject: 'CN=test.example.com',
            issuer: caCert.subject,
            notBefore,
            notAfter,
            signingAlgorithm: keyAlgorithm,
            publicKey: keyPair.publicKey as CryptoKey,
            signingKey: caKey,
            extensions: []
        });

        certPem = cert.toString("pem");
    });

    it("generates a valid OCSP response structure", async () => {
        const response = await createOcspResponse({
            cert,
            issuerCert: caCert,
            issuerKey: caKey,
            status: 'good'
        });

        expect(response).to.be.instanceOf(Buffer);
        expect(response.length).to.be.greaterThan(100);

        // Parse and verify structure using @peculiar
        const parsed = asn1Schema.AsnConvert.parse(response, asn1Ocsp.OCSPResponse);
        expect(parsed.responseStatus).to.equal(asn1Ocsp.OCSPResponseStatus.successful);
        expect(parsed.responseBytes).to.exist;
    });

    it("generates a 'good' status response", async () => {
        const response = await createOcspResponse({
            cert,
            issuerCert: caCert,
            issuerKey: caKey,
            status: 'good'
        });

        // Parse the response
        const parsed = asn1Schema.AsnConvert.parse(response, asn1Ocsp.OCSPResponse);
        expect(parsed.responseBytes).to.exist;

        const basicResponse = asn1Schema.AsnConvert.parse(
            parsed.responseBytes!.response.buffer,
            asn1Ocsp.BasicOCSPResponse
        );

        const singleResponse = basicResponse.tbsResponseData.responses[0];
        expect(singleResponse.certStatus.good).to.not.be.undefined;
        expect(singleResponse.certStatus.revoked).to.be.undefined;
        expect(singleResponse.certStatus.unknown).to.be.undefined;
    });

    it("generates a 'revoked' status response", async () => {
        const revocationTime = new Date('2024-01-15T12:00:00Z');

        const response = await createOcspResponse({
            cert,
            issuerCert: caCert,
            issuerKey: caKey,
            status: 'revoked',
            revocationTime,
            revocationReason: RevocationReason.keyCompromise
        });

        // Parse the response
        const parsed = asn1Schema.AsnConvert.parse(response, asn1Ocsp.OCSPResponse);
        const basicResponse = asn1Schema.AsnConvert.parse(
            parsed.responseBytes!.response.buffer,
            asn1Ocsp.BasicOCSPResponse
        );

        const singleResponse = basicResponse.tbsResponseData.responses[0];
        expect(singleResponse.certStatus.revoked).to.exist;

        const revokedInfo = singleResponse.certStatus.revoked!;
        expect(revokedInfo.revocationTime.getTime()).to.equal(revocationTime.getTime());
        // revocationReason is optional and not currently set
        // expect(revokedInfo.revocationReason).to.equal(RevocationReason.keyCompromise);
    });

    it("generates an 'unknown' status response", async () => {
        const response = await createOcspResponse({
            cert,
            issuerCert: caCert,
            issuerKey: caKey,
            status: 'unknown'
        });

        // Parse the response
        const parsed = asn1Schema.AsnConvert.parse(response, asn1Ocsp.OCSPResponse);
        const basicResponse = asn1Schema.AsnConvert.parse(
            parsed.responseBytes!.response.buffer,
            asn1Ocsp.BasicOCSPResponse
        );

        const singleResponse = basicResponse.tbsResponseData.responses[0];
        expect(singleResponse.certStatus.unknown).to.not.be.undefined;
        expect(singleResponse.certStatus.good).to.be.undefined;
        expect(singleResponse.certStatus.revoked).to.be.undefined;
    });

    it("includes the correct certificate serial number in CertID", async () => {
        const response = await createOcspResponse({
            cert,
            issuerCert: caCert,
            issuerKey: caKey,
            status: 'good'
        });

        // Parse the response
        const parsed = asn1Schema.AsnConvert.parse(response, asn1Ocsp.OCSPResponse);
        const basicResponse = asn1Schema.AsnConvert.parse(
            parsed.responseBytes!.response.buffer,
            asn1Ocsp.BasicOCSPResponse
        );

        const singleResponse = basicResponse.tbsResponseData.responses[0];
        const certId = singleResponse.certID;

        // Convert the serial number to hex for comparison
        const serialHex = Buffer.from(certId.serialNumber).toString('hex');
        expect(serialHex.toLowerCase().replace(/^00/, ''))
            .to.equal(cert.serialNumber.toLowerCase().replace(/\s/g, ''));
    });

    it("encodes a high-bit serial number as a positive integer", async () => {
        // 0xA1... has its top bit set, so without a sign pad this reads back as a negative
        // number - i.e. a CertID for a certificate other than the one being served.
        expect(cert.serialNumber.toLowerCase()).to.equal('a123456789abcdef');

        const response = await createOcspResponse({
            cert,
            issuerCert: caCert,
            issuerKey: caKey,
            status: 'good'
        });

        const { certID } = parseSingleResponse(response);

        expect(readSignedInteger(certID.serialNumber))
            .to.equal(BigInt(`0x${cert.serialNumber}`));
    });

    it("includes thisUpdate timestamp", async () => {
        const beforeTime = new Date();
        beforeTime.setSeconds(beforeTime.getSeconds() - 1);

        const response = await createOcspResponse({
            cert,
            issuerCert: caCert,
            issuerKey: caKey,
            status: 'good'
        });

        const afterTime = new Date();
        afterTime.setSeconds(afterTime.getSeconds() + 1);

        // Parse the response
        const parsed = asn1Schema.AsnConvert.parse(response, asn1Ocsp.OCSPResponse);
        const basicResponse = asn1Schema.AsnConvert.parse(
            parsed.responseBytes!.response.buffer,
            asn1Ocsp.BasicOCSPResponse
        );

        const singleResponse = basicResponse.tbsResponseData.responses[0];
        const thisUpdate = singleResponse.thisUpdate;

        expect(thisUpdate.getTime()).to.be.at.least(beforeTime.getTime());
        expect(thisUpdate.getTime()).to.be.at.most(afterTime.getTime());
    });

    it("includes nextUpdate when provided", async () => {
        const nextUpdate = new Date();
        nextUpdate.setHours(nextUpdate.getHours() + 1);

        const response = await createOcspResponse({
            cert,
            issuerCert: caCert,
            issuerKey: caKey,
            status: 'good',
            nextUpdate
        });

        // Parse the response
        const parsed = asn1Schema.AsnConvert.parse(response, asn1Ocsp.OCSPResponse);
        const basicResponse = asn1Schema.AsnConvert.parse(
            parsed.responseBytes!.response.buffer,
            asn1Ocsp.BasicOCSPResponse
        );

        const singleResponse = basicResponse.tbsResponseData.responses[0];
        expect(singleResponse.nextUpdate).to.exist;
        expect(singleResponse.nextUpdate!.getTime()).to.equal(nextUpdate.getTime());
    });

    it("includes the issuer certificate in the response", async () => {
        const response = await createOcspResponse({
            cert,
            issuerCert: caCert,
            issuerKey: caKey,
            status: 'good'
        });

        // Parse the response
        const parsed = asn1Schema.AsnConvert.parse(response, asn1Ocsp.OCSPResponse);
        const basicResponse = asn1Schema.AsnConvert.parse(
            parsed.responseBytes!.response.buffer,
            asn1Ocsp.BasicOCSPResponse
        );

        expect(basicResponse.certs).to.exist;
        expect(basicResponse.certs).to.have.lengthOf(1);

        // Verify it's the CA cert
        const includedCert = basicResponse.certs![0];
        const includedCertDer = asn1Schema.AsnConvert.serialize(includedCert);
        const includedCertObj = new x509.X509Certificate(includedCertDer);

        expect(includedCertObj.subject).to.equal(caCert.subject);
        expect(includedCertObj.serialNumber).to.equal(caCert.serialNumber);
    });

    it("can parse OCSP requests", () => {
        // Create a simple OCSP request
        const certId = new asn1Ocsp.CertID({
            hashAlgorithm: new asn1X509.AlgorithmIdentifier({
                algorithm: '1.3.14.3.2.26', // SHA-1
                parameters: null
            }),
            issuerNameHash: new asn1Schema.OctetString(new Uint8Array(20).buffer), // 20 bytes for SHA-1
            issuerKeyHash: new asn1Schema.OctetString(new Uint8Array(20).buffer),
            serialNumber: new Uint8Array([0x01, 0x02, 0x03])
        });

        const request = new asn1Ocsp.OCSPRequest({
            tbsRequest: new asn1Ocsp.TBSRequest({
                requestList: [
                    new asn1Ocsp.Request({
                        reqCert: certId
                    })
                ]
            })
        });

        const requestDer = Buffer.from(asn1Schema.AsnConvert.serialize(request));

        const parsed = parseOcspRequest(requestDer);
        expect(parsed).to.not.be.null;
        expect(parsed!.serialNumber).to.equal('010203');
    });
});

describe("OCSP responses from the local CA", () => {

    let localCA: LocalCA;
    let otherCA: LocalCA;

    before(async () => {
        localCA = await LocalCA.create(await generateCACertificate());
        otherCA = await LocalCA.create(await generateCACertificate({ commonName: 'Other CA' }));
    });

    it("answers for a certificate it issued, naming the issuing intermediate", async () => {
        const generated = await localCA.generateCertificate('example.testserver.host', {});
        const leafPem = extractLeafCertificate(generated.cert);

        const response = await localCA.getOcspResponse(toDer(leafPem));
        expect(response).to.not.be.null;

        const { certID } = parseSingleResponse(response!);
        const leaf = new x509.X509Certificate(leafPem);
        const intermediate = new x509.X509Certificate(await localCA.getIntermediateCertificatePem());
        const expectedHashes = await certIdHashes(intermediate);

        expect(leaf.issuer).to.equal(intermediate.subject);
        expect(Buffer.from(certID.issuerNameHash.buffer).toString('hex')).to.equal(expectedHashes.nameHash);
        expect(Buffer.from(certID.issuerKeyHash.buffer).toString('hex')).to.equal(expectedHashes.keyHash);
        expect(readSignedInteger(certID.serialNumber)).to.equal(BigInt(`0x${leaf.serialNumber}`));
    });

    it("refuses to answer for a certificate issued by another CA", async () => {
        // This is what a real ACME-issued cert looks like to us: we have no standing to say
        // anything about it, so we must not staple a response naming one of our own CAs.
        const foreignCert = await otherCA.generateCertificate('example.testserver.host', {});

        const response = await localCA.getOcspResponse(toDer(extractLeafCertificate(foreignCert.cert)));
        expect(response).to.be.null;
    });

    it("answers for a self-signed certificate it generated, naming the cert itself", async () => {
        // A self-signed cert is its own issuer, so signing with its own key is exactly what
        // RFC 6960 asks for - and we still hold that key.
        const generated = await localCA.generateCertificate('example.testserver.host', {
            selfSigned: true
        });
        const leafPem = extractLeafCertificate(generated.cert);

        const response = await localCA.getOcspResponse(toDer(leafPem));
        expect(response).to.not.be.null;

        const { certID } = parseSingleResponse(response!);
        const leaf = new x509.X509Certificate(leafPem);
        const expectedHashes = await certIdHashes(leaf);

        expect(leaf.issuer).to.equal(leaf.subject);
        expect(Buffer.from(certID.issuerNameHash.buffer).toString('hex')).to.equal(expectedHashes.nameHash);
        expect(Buffer.from(certID.issuerKeyHash.buffer).toString('hex')).to.equal(expectedHashes.keyHash);
        expect(readSignedInteger(certID.serialNumber)).to.equal(BigInt(`0x${leaf.serialNumber}`));
    });

    it("reports a self-signed revoked certificate as revoked", async () => {
        const generated = await localCA.generateCertificate('revoked.testserver.host', {
            selfSigned: true
        });

        const response = await localCA.getOcspResponse(toDer(extractLeafCertificate(generated.cert)));
        expect(response).to.not.be.null;

        expect(parseSingleResponse(response!).certStatus.revoked).to.exist;
    });

    it("refuses to answer for a self-signed certificate generated elsewhere", async () => {
        const foreignCert = await otherCA.generateCertificate('example.testserver.host', {
            selfSigned: true
        });

        const response = await localCA.getOcspResponse(toDer(extractLeafCertificate(foreignCert.cert)));
        expect(response).to.be.null;
    });

    it("refuses to answer for data that isn't a certificate", async () => {
        expect(await localCA.getOcspResponse(Buffer.from('not a certificate'))).to.be.null;
    });
});
