import { Buffer } from 'buffer';
import { createOcspResponse } from './ocsp.js';

import * as x509 from '@peculiar/x509';
import * as asn1X509 from '@peculiar/asn1-x509';
import * as asn1Schema from '@peculiar/asn1-schema';
import { CertOptions } from './cert-definitions.js';

const crypto = globalThis.crypto;

// This is all approximately based on Mockttp's src/util/certificates.ts CA implementation

interface CAOptions {
    key: string;
    cert: string;

    /**
     * Minimum key length when generating certificates. Defaults to 2048.
     */
    keyLength?: number;

    /**
     * The countryName that will be used in the certificate for incoming TLS
     * connections.
     */
    countryName?: string;
}

type LocallyGeneratedCertificate = {
    key: string,
    cert: string,
    ca: string
};

function arrayBufferToPem(buffer: ArrayBuffer, label: string): string {
    const base64 = Buffer.from(buffer).toString('base64');
    const lines = base64.match(/.{1,64}/g) || [];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

async function pemToCryptoKey(pem: string) {
    // We only call this with our own generateCACertificate output,
    // which is always PKCS#8 format ("BEGIN PRIVATE KEY")
    const pkcs8KeyData = x509.PemConverter.decodeFirst(pem);

    return await crypto.subtle.importKey(
        "pkcs8",
        pkcs8KeyData,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        true, // Extractable
        ["sign"]
    );
}

/**
 * Generate a CA certificate for TLS.
 *
 * Returns a promise, for an object with key and cert properties,
 * containing the generated private key and certificate in PEM format.
 */
export async function generateCACertificate(options: {
    commonName?: string,
    organizationName?: string,
    countryName?: string,
    bits?: number
} = {}) {
    options = {
        commonName: 'Test Certificate Authority',
        organizationName: 'Testserver',
        countryName: 'XX', // ISO-3166-1 alpha-2 'unknown country' code
        bits: 2048,
        ...options
    };

    // We use RSA for now for maximum compatibility
    const keyAlgorithm = {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: options.bits,
        publicExponent: new Uint8Array([1, 0, 1]), // Standard 65537 fixed value
        hash: "SHA-256"
    };

    const keyPair = await crypto.subtle.generateKey(
        keyAlgorithm,
        true, // Key should be extractable to be exportable
        ["sign", "verify"]
    ) as CryptoKeyPair;

    // Baseline requirements set a specific order for CA subject fields
    const subjectNameParts: x509.JsonNameParams = [];
    if (options.countryName) {
        subjectNameParts.push({ C: [options.countryName] });
    }
    if (options.organizationName) {
        subjectNameParts.push({ O: [options.organizationName] });
    }
    if (options.commonName) {
        subjectNameParts.push({ CN: [options.commonName] });
    }
    const subjectDistinguishedName = new x509.Name(subjectNameParts).toString();

    const notBefore = new Date();
    // Make it valid for the last 24h - helps in cases where clocks slightly disagree
    notBefore.setDate(notBefore.getDate() - 1);

    const notAfter = new Date();
    // Valid for the next year by default.
    notAfter.setFullYear(notAfter.getFullYear() + 1);

    const extensions: x509.Extension[] = [
        new x509.BasicConstraintsExtension(
            true, // cA = true
            undefined, // We don't set any path length constraint
            true
        ),
        new x509.KeyUsagesExtension(
            x509.KeyUsageFlags.keyCertSign |
            x509.KeyUsageFlags.digitalSignature |
            x509.KeyUsageFlags.cRLSign,
            true
        ),
        await x509.SubjectKeyIdentifierExtension.create(keyPair.publicKey as CryptoKey, false)
    ];

    const certificate = await x509.X509CertificateGenerator.create({
        serialNumber: generateSerialNumber(),
        subject: subjectDistinguishedName,
        issuer: subjectDistinguishedName, // Self-signed
        notBefore,
        notAfter,
        signingAlgorithm: keyAlgorithm,
        publicKey: keyPair.publicKey as CryptoKey,
        signingKey: keyPair.privateKey as CryptoKey,
        extensions
    });

    const privateKeyBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey as CryptoKey);
    const privateKeyPem = arrayBufferToPem(privateKeyBuffer, "PRIVATE KEY");
    const certificatePem = certificate.toString("pem");

    return {
        key: privateKeyPem,
        cert: certificatePem
    };
}


// Generates a unique serial number for a certificate as a hex string:
function generateSerialNumber() {
    // Use digit prefix (0-7) to ensure high bit is clear (naturally positive per RFC 5280).
    // Prefixes 0-7 have MSB=0: e.g. '1' = 0001, so '1x...' is naturally positive.
    return '1' + crypto.randomUUID().replace(/-/g, '');
}

// Check if a certificate's domain indicates it should be treated as revoked
function isRevokedCert(cert: x509.X509Certificate): boolean {
    const sanExt = cert.getExtension(x509.SubjectAlternativeNameExtension);
    if (!sanExt) return false;

    for (const name of sanExt.names.items) {
        if (name.type === 'dns') {
            const dnsName = name.value as string;
            const labels = dnsName.split('.');
            // Use -- within a single label, or . between labels, not both
            const parts = labels.some(l => l.includes('--'))
                ? labels.flatMap(l => l.split('--'))
                : labels;
            if (parts.includes('revoked')) return true;
        }
    }
    return false;
}

function calculateCacheKey(domain: string, options: CertOptions) {
    return `${domain}+${([
        'expired',
        'revoked',
        'selfSigned'
    ] as const).filter((k: keyof CertOptions) => options[k]).join('+')}`
}

// We share a single keypair across all certificates in this process, and
// instantiate it once when the first CA is created, because it can be
// expensive (depending on the key length).
// This would be a terrible idea for a real server, but for a test server
// it's ok - if anybody can steal this, they can steal the CA cert anyway,
// and this is only used in self-signing CA scenarios that won't be
// trusted by clients by default anyway.
let KEY_PAIR: {
    value: Promise<CryptoKeyPair>,
    length: number
} | undefined;
const KEY_PAIR_ALGO = {
    name: "RSASSA-PKCS1-v1_5",
    hash: "SHA-256",
    publicExponent: new Uint8Array([1, 0, 1])
};

interface CertGenerationOptions {
    selfSigned?: boolean;
    expired?: boolean;
}

export class LocalCA {
    private caCert: x509.X509Certificate;
    private caKey: CryptoKey;
    private options: CAOptions;

    private certInMemoryCache: { [domain: string]: LocallyGeneratedCertificate | undefined } = {};

    private constructor(
        private caCertPem: string,
        caCert: x509.X509Certificate,
        caKey: CryptoKey,
        caOptions: CAOptions
    ) {
        this.caCert = caCert;
        this.caKey = caKey;
        this.options = caOptions ?? {};
    }

    static async create(
        caOptions: CAOptions
    ): Promise<LocalCA> {
        // Parse the CA cert and key
        const caCert = new x509.X509Certificate(caOptions.cert.toString());
        const caKey = await pemToCryptoKey(caOptions.key.toString());

        const keyLength = caOptions.keyLength || 2048;

        if (!KEY_PAIR || KEY_PAIR.length < keyLength) {
            // If we have no key, or not a long enough one, generate one.
            KEY_PAIR = {
                length: keyLength,
                value: crypto.subtle.generateKey(
                    { ...KEY_PAIR_ALGO, modulusLength: keyLength },
                    true,
                    ["sign", "verify"]
                )
            };
        }

        return new LocalCA(caOptions.cert.toString(), caCert, caKey, caOptions);
    }
    
    async generateCertificate(
        domain: string,
        options: CertGenerationOptions
    ): Promise<LocallyGeneratedCertificate> {
        if (domain.includes('_')) {
            // TLS certificates cannot cover domains with underscores, bizarrely. More info:
            // https://www.digicert.com/kb/ssl-support/underscores-not-allowed-in-fqdns.htm
            // To fix this, we use wildcards instead. This is only possible for one level of
            // certificate, and only for subdomains, so our options are a little limited, but
            // this should be very rare (because it's not supported elsewhere either).
            const [ , ...otherParts] = domain.split('.');
            if (
                otherParts.length <= 1 || // *.com is never valid
                otherParts.some(p => p.includes('_'))
            ) {
                throw new Error(`Cannot generate certificate for domain due to underscores: ${domain}`);
            }

            // Replace the first part with a wildcard to solve the problem:
            domain = `*.${otherParts.join('.')}`;
        }

        const cacheKey = calculateCacheKey(domain, options);

        const cachedCert = this.certInMemoryCache[cacheKey];
        if (cachedCert) return cachedCert;

        const leafKeyPair = await KEY_PAIR!.value;

        // Build subject DN with only the fields allowed by BR for DV certs
        const subjectJsonNameParams: x509.JsonNameParams = [];

        // Apply BR-required order: countryName, then commonName
        subjectJsonNameParams.push({ C: [this.options.countryName ?? 'XX'] });
        if (domain[0] !== '*') { // Skip CN for wildcards as they cannot use them
            subjectJsonNameParams.push({ CN: [domain] });
        }

        const subjectDistinguishedName = new x509.Name(subjectJsonNameParams).toString();
        const issuerDistinguishedName = options.selfSigned
            ? subjectDistinguishedName
            : this.caCert.subject;

        const notBefore = new Date();
        const notAfter = new Date();

        if (options.expired) {
            notBefore.setDate(notBefore.getDate() - 2);
            notAfter.setDate(notAfter.getDate() - 1);
        } else {
            notBefore.setDate(notBefore.getDate() - 1); // Valid from 24 hours ago
            notAfter.setFullYear(notAfter.getFullYear() + 1); // Valid for 1 year
        }

        const extensions: x509.Extension[] = [];
        extensions.push(new x509.BasicConstraintsExtension(false, undefined, true));
        extensions.push(new x509.KeyUsagesExtension(
            x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
            true
        ));
        extensions.push(new x509.ExtendedKeyUsageExtension(
            [asn1X509.id_kp_serverAuth, asn1X509.id_kp_clientAuth],
            false
        ));

        extensions.push(new x509.SubjectAlternativeNameExtension(
            [{ type: "dns", value: domain }],
            false
        ));

        const policyInfo = new asn1X509.PolicyInformation({
            policyIdentifier: '2.23.140.1.2.1' // Domain validated
        });
        const certificatePoliciesValue = new asn1X509.CertificatePolicies([policyInfo]);
        extensions.push(new x509.Extension(
            asn1X509.id_ce_certificatePolicies,
            false,
            asn1Schema.AsnConvert.serialize(certificatePoliciesValue)
        ));

        // We don't include SubjectKeyIdentifierExtension as that's no longer recommended
        if (!options.selfSigned) {
            extensions.push(await x509.AuthorityKeyIdentifierExtension.create(this.caCert, false));
        }

        const certificate = await x509.X509CertificateGenerator.create({
            serialNumber: generateSerialNumber(),
            subject: subjectDistinguishedName,
            issuer: issuerDistinguishedName,
            notBefore,
            notAfter,
            signingAlgorithm: KEY_PAIR_ALGO,
            publicKey: leafKeyPair.publicKey,
            signingKey: options.selfSigned ? leafKeyPair.privateKey as CryptoKey : this.caKey,
            extensions
        });

        const certPem = certificate.toString("pem");
        const generatedCertificate = {
            key: arrayBufferToPem(
                await crypto.subtle.exportKey("pkcs8", leafKeyPair.privateKey as CryptoKey),
                "PRIVATE KEY"
            ),
            cert: certPem,
            ca: options.selfSigned ? certPem : this.caCertPem // Use cached CA cert PEM
        };

        this.certInMemoryCache[cacheKey] = generatedCertificate;

        setTimeout(() => {
            delete this.certInMemoryCache[cacheKey];
        }, 1000 * 60 * 60 * 24).unref();

        return generatedCertificate;
    }

    async getOcspResponse(certDer: Buffer): Promise<Buffer | null> {
        // Parse the certificate to get its serial number
        const certPem = `-----BEGIN CERTIFICATE-----\n${certDer.toString('base64')}\n-----END CERTIFICATE-----`;
        let cert: x509.X509Certificate;
        try {
            cert = new x509.X509Certificate(certPem);
        } catch {
            return null;
        }

        if (isRevokedCert(cert)) {
            // Certificate is revoked - return revoked OCSP response
            return await createOcspResponse({
                cert,
                issuerCert: this.caCert,
                issuerKey: this.caKey,
                status: 'revoked',
                revocationTime: new Date(), // Use current time as approximation
                revocationReason: 1 // keyCompromise
            });
        }

        // Certificate not revoked - return good status
        return await createOcspResponse({
            cert,
            issuerCert: this.caCert,
            issuerKey: this.caKey,
            status: 'good'
        });
    }
}
