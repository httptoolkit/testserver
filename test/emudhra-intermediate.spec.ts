import * as net from 'net';
import * as tls from 'tls';
import * as crypto from 'node:crypto';

import { expect } from 'chai';
import * as x509 from '@peculiar/x509';
import * as asn1Ocsp from '@peculiar/asn1-ocsp';
import * as asn1Schema from '@peculiar/asn1-schema';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createTestServer } from './test-helpers.js';
import { certIdHashes } from './ocsp-helpers.js';
import { validateEndpointParts } from '../src/endpoints/endpoint-config.js';
import { getLocalOnlyRedirectHost } from '../src/http-handler.js';
import { calculateCertCacheKey } from '../src/tls-certificates/cert-definitions.js';
import { getExternalIntermediate } from '../src/tls-certificates/external-intermediates.js';

// The real, publicly trusted root that the compromised intermediate chains to
const EMSIGN_ECC_ROOT_CA_G3 = `-----BEGIN CERTIFICATE-----
MIICTjCCAdOgAwIBAgIKPPYHqWhwDtqLhDAKBggqhkjOPQQDAzBrMQswCQYDVQQG
EwJJTjETMBEGA1UECxMKZW1TaWduIFBLSTElMCMGA1UEChMcZU11ZGhyYSBUZWNo
bm9sb2dpZXMgTGltaXRlZDEgMB4GA1UEAxMXZW1TaWduIEVDQyBSb290IENBIC0g
RzMwHhcNMTgwMjE4MTgzMDAwWhcNNDMwMjE4MTgzMDAwWjBrMQswCQYDVQQGEwJJ
TjETMBEGA1UECxMKZW1TaWduIFBLSTElMCMGA1UEChMcZU11ZGhyYSBUZWNobm9s
b2dpZXMgTGltaXRlZDEgMB4GA1UEAxMXZW1TaWduIEVDQyBSb290IENBIC0gRzMw
djAQBgcqhkjOPQIBBgUrgQQAIgNiAAQjpQy4LRL1KPOxst3iAhKAnjlfSU2fySU0
WXTsuwYc58Byr+iuL+FBVIcUqEqy6HyC5ltqtdyzdc6LBtCGI79G1Y4PPwT01xyS
fvalY8L1X44uT6EYGQIrMgqCZH0Wk9GjQjBAMB0GA1UdDgQWBBR8XQKEE9TMipuB
zhccLikenEhjQjAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0TAQH/BAUwAwEB/zAKBggq
hkjOPQQDAwNpADBmAjEAvvNhzwIQHWSVB7gYboiFBS+DCBeQyh+KTOgNG3qxrdWB
CUfvO6wIBHxcmbHtRwfSAjEAnbpV/KlK6O3t5nYBQnvI+GDZjVGLVTv7jHvrZQnD
+JbNR6iC8hZVdyR+EhCVBCyj
-----END CERTIFICATE-----
`;

describe("emudhra-intermediate endpoint", () => {

    let server: DestroyableServer;
    let port: number;

    beforeEach(async () => {
        server = makeDestroyable(await createTestServer());
        await new Promise<void>((resolve) => server.listen(resolve));
        port = (server.address() as net.AddressInfo).port;
    });
    afterEach(async () => { await server.destroy(); });

    const connect = (servername: string, extra: tls.ConnectionOptions = {}) =>
        new Promise<tls.TLSSocket>((resolve, reject) => {
            const conn = tls.connect({
                port,
                host: '127.0.0.1',
                servername,
                ca: [EMSIGN_ECC_ROOT_CA_G3],
                ...extra
            });
            conn.on('secureConnect', () => resolve(conn));
            conn.on('error', reject);
        });

    it("serves a certificate that validates against the real emSign root", async () => {
        const conn = await connect('emudhra-intermediate.localhost');
        const leaf = conn.getPeerX509Certificate()!;
        conn.destroy();

        expect(leaf.subjectAltName).to.equal('DNS:emudhra-intermediate.localhost');
        expect(leaf.issuer).to.equal('C=US\nO=eMudhra Inc\nCN=EM OV TLS CA - G3C');
        expect(leaf.ca).to.equal(false);
    });

    it("copies the intermediate's exact subject encoding as the leaf's issuer", async () => {
        // Go (amongst others) only chains certs whose names match byte for byte
        const conn = await connect('emudhra-intermediate.localhost');
        const leaf = new x509.X509Certificate(conn.getPeerX509Certificate()!.raw);
        conn.destroy();

        const intermediate = await getExternalIntermediate('emudhra-ov-tls-g3c');
        expect(Buffer.from(leaf.issuerName.toArrayBuffer()))
            .to.deep.equal(Buffer.from(intermediate.cert.subjectName.toArrayBuffer()));
    });

    it("signs the leaf with the intermediate's private key of 4", async () => {
        const conn = await connect('emudhra-intermediate.localhost');
        const leaf = conn.getPeerX509Certificate()!;
        conn.destroy();

        const ecdh = crypto.createECDH('secp384r1');
        ecdh.setPrivateKey(Buffer.alloc(48).fill(4, 47));
        const fourG = crypto.createPublicKey({
            key: {
                kty: 'EC',
                crv: 'P-384',
                x: ecdh.getPublicKey().subarray(1, 49).toString('base64url'),
                y: ecdh.getPublicKey().subarray(49).toString('base64url')
            },
            format: 'jwk'
        });

        expect(leaf.verify(fourG)).to.equal(true);
    });

    it("can serve the leaf without its chain", async () => {
        const result = await connect('emudhra-intermediate--incomplete-chain.localhost')
            .then((conn) => { conn.destroy(); return 'connected'; })
            .catch((e: NodeJS.ErrnoException) => e.code);

        expect(result).to.equal('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    });

    it("rejects combinations that pick a different issuer", () => {
        for (const other of ['self-signed', 'untrusted-root']) {
            expect(validateEndpointParts(['emudhra-intermediate', other]))
                .to.match(/Conflicting endpoint options: 'issuer'/);
        }
    });

    it("allows combinations with other certificate properties", () => {
        for (const other of ['expired', 'revoked', 'sha1-sig', 'wrong-host', 'incomplete-chain']) {
            expect(validateEndpointParts(['emudhra-intermediate', other])).to.equal(undefined);
        }
    });

    it("staples a revoked OCSP response, signed by the intermediate", async () => {
        const ocspResponse = await new Promise<Buffer>((resolve, reject) => {
            const conn = tls.connect({
                port,
                host: '127.0.0.1',
                servername: 'emudhra-intermediate--revoked.localhost',
                ca: [EMSIGN_ECC_ROOT_CA_G3],
                requestOCSP: true
            });
            conn.on('OCSPResponse', (response) => { conn.destroy(); resolve(response); });
            conn.on('error', reject);
        });

        const basicResponse = asn1Schema.AsnConvert.parse(
            asn1Schema.AsnConvert.parse(ocspResponse, asn1Ocsp.OCSPResponse).responseBytes!.response.buffer,
            asn1Ocsp.BasicOCSPResponse
        );
        const singleResponse = basicResponse.tbsResponseData.responses[0]!;
        expect(singleResponse.certStatus.revoked).to.exist;

        const intermediate = await getExternalIntermediate('emudhra-ov-tls-g3c');
        const expectedHashes = await certIdHashes(intermediate.cert);
        expect(Buffer.from(singleResponse.certID.issuerNameHash.buffer).toString('hex'))
            .to.equal(expectedHashes.nameHash);
        expect(Buffer.from(singleResponse.certID.issuerKeyHash.buffer).toString('hex'))
            .to.equal(expectedHashes.keyHash);

        expect(basicResponse.signatureAlgorithm.algorithm).to.equal('1.2.840.10045.4.3.3'); // ecdsa-with-SHA384
        const signatureValid = crypto.verify(
            'sha384',
            Buffer.from(asn1Schema.AsnConvert.serialize(basicResponse.tbsResponseData)),
            crypto.createPublicKey(intermediate.cert.toString('pem')),
            Buffer.from(basicResponse.signature)
        );
        expect(signatureValid).to.equal(true);
    });

    it("can sign the leaf with SHA-1", async () => {
        const conn = await connect('emudhra-intermediate--sha1-sig.localhost', {
            ciphers: 'DEFAULT@SECLEVEL=0'
        });
        const leaf = new x509.X509Certificate(conn.getPeerX509Certificate()!.raw);
        conn.destroy();

        expect(leaf.signatureAlgorithm).to.deep.equal({ name: 'ECDSA', hash: { name: 'SHA-1' } });
    });

    it("isn't redirected to untrusted-root when a public CA is in use", () => {
        expect(getLocalOnlyRedirectHost(['emudhra-intermediate'], {
            usingPublicCA: true,
            rootDomain: 'testserver.host'
        })).to.equal(undefined);
    });

    it("caches its certificates separately from our own CA's", () => {
        const domain = 'emudhra-intermediate.testserver.host';
        expect(calculateCertCacheKey(domain, { issuer: 'emudhra-ov-tls-g3c' }))
            .to.not.equal(calculateCertCacheKey(domain, {}));
    });
});
