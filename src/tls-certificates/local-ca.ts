import { randomUUID } from 'crypto';
import forge from 'node-forge';
import { PersistentCertCache } from './cert-cache.js';

const { pki, md } = forge;

// This is all approximately based on Mockttp's src/util/tls.ts CA implementation

export interface CAOptions {

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

    /**
     * The localityName that will be used in the certificate for incoming TLS
     * connections.
     */
    localityName?: string;

    /**
     * The organizationName that will be used in the certificate for incoming TLS
     * connections.
     */
    organizationName?: string;
}

export type PEM = string | string[] | Buffer | Buffer[];

type LocallyGeneratedCertificate = {
    key: string,
    cert: string,
    ca: string
};

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

    const keyPair = await new Promise<forge.pki.rsa.KeyPair>((resolve, reject) => {
        pki.rsa.generateKeyPair({ bits: options.bits }, (error, keyPair) => {
            if (error) reject(error);
            else resolve(keyPair);
        });
    });

    const cert = pki.createCertificate();
    cert.publicKey = keyPair.publicKey;
    cert.serialNumber = generateSerialNumber();

    cert.validity.notBefore = new Date();
    // Make it valid for the last 24h - helps in cases where clocks slightly disagree
    cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);

    cert.validity.notAfter = new Date();
    // Valid for the next year by default.
    cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

    cert.setSubject([
        // All of these are required for a fully valid CA cert that will be accepted when imported anywhere:
        { name: 'commonName', value: options.commonName },
        { name: 'countryName', value: options.countryName },
        { name: 'organizationName', value: options.organizationName }
    ]);

    cert.setExtensions([
        { name: 'basicConstraints', cA: true, critical: true },
        { name: 'keyUsage', keyCertSign: true, digitalSignature: true, nonRepudiation: true, cRLSign: true, critical: true },
        { name: 'subjectKeyIdentifier' }
    ]);

    // Self-issued too
    cert.setIssuer(cert.subject.attributes);

    // Self-sign the certificate - we're the root
    cert.sign(keyPair.privateKey, md.sha256.create());

    return {
        key: pki.privateKeyToPem(keyPair.privateKey),
        cert: pki.certificateToPem(cert)
    };
}


// Generates a unique serial number for a certificate as a hex string:
function generateSerialNumber() {
    return 'A' + randomUUID().replace(/-/g, '');
    // We add a leading 'A' to ensure it's always positive (not 'F') and always
    // valid (e.g. leading 000 is bad padding, and would be unparseable).
}

// We share a single keypair across all certificates in this process, and
// instantiate it once when the first CA is created, because it can be
// expensive (depending on the key length).
// This would be a terrible idea for a real server, but for a test server
// it's ok - if anybody can steal this, they can steal the CA cert anyway,
// and this is only used in self-signing CA scenarios that won't be
// trusted by clients by default anyway.
let KEY_PAIR: {
    publicKey: forge.pki.rsa.PublicKey,
    privateKey: forge.pki.rsa.PrivateKey,
    length: number
} | undefined;

export class LocalCA {
    private caCert: forge.pki.Certificate;
    private caKey: forge.pki.PrivateKey;
    private options: CAOptions;

    private certInMemoryCache: { [domain: string]: LocallyGeneratedCertificate | undefined } = {};

    constructor(
        caOptions: CAOptions,
        private certDiskCache?: PersistentCertCache
    ) {
        this.caKey = pki.privateKeyFromPem(caOptions.key.toString());
        this.caCert = pki.certificateFromPem(caOptions.cert.toString());
        this.options = caOptions ?? {};

        const keyLength = caOptions.keyLength || 2048;

        if (!KEY_PAIR || KEY_PAIR.length < keyLength) {
            // If we have no key, or not a long enough one, generate one.
            KEY_PAIR = Object.assign(
                pki.rsa.generateKeyPair(keyLength),
                { length: keyLength }
            );
        }
    }

    generateCertificate(domain: string) {
        const cachedCert = this.certDiskCache?.getCert(domain)
            ?? this.certInMemoryCache[domain];
        if (cachedCert) return cachedCert;

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

        let cert = pki.createCertificate();

        cert.publicKey = KEY_PAIR!.publicKey;
        cert.serialNumber = generateSerialNumber();

        cert.validity.notBefore = new Date();
        // Make it valid for the last 24h - helps in cases where clocks slightly disagree.
        cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);

        cert.validity.notAfter = new Date();
        // Valid for the next year by default.
        cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

        cert.setSubject([
            ...(domain[0] === '*'
                ? [] // We skip the CN (deprecated, rarely used) for wildcards, since they can't be used here.
                : [{ name: 'commonName', value: domain }]
            ),
            { name: 'countryName', value: this.options?.countryName ?? 'XX' }, // ISO-3166-1 alpha-2 'unknown country' code
            { name: 'localityName', value: this.options?.localityName ?? 'Unknown' },
            { name: 'organizationName', value: this.options?.organizationName ?? 'Testserver Test Cert' }
        ]);
        cert.setIssuer(this.caCert.subject.attributes);

        const policyList = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
            forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
                forge.asn1.create(
                    forge.asn1.Class.UNIVERSAL,
                    forge.asn1.Type.OID,
                    false,
                    forge.asn1.oidToDer('2.5.29.32.0').getBytes() // Mark all as Domain Verified
                )
            ])
        ]);

        cert.setExtensions([
            { name: 'basicConstraints', cA: false, critical: true },
            { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
            { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
            {
                name: 'subjectAltName',
                altNames: [{
                    type: 2,
                    value: domain
                }]
            },
            { name: 'certificatePolicies', value: policyList },
            { name: 'subjectKeyIdentifier' },
            {
                name: 'authorityKeyIdentifier',
                // We have to calculate this ourselves due to
                // https://github.com/digitalbazaar/forge/issues/462
                keyIdentifier: (
                    this.caCert as any // generateSubjectKeyIdentifier is missing from node-forge types
                ).generateSubjectKeyIdentifier().getBytes()
            }
        ]);

        cert.sign(this.caKey, md.sha256.create());

        const generatedCertificate = {
            key: pki.privateKeyToPem(KEY_PAIR!.privateKey),
            cert: pki.certificateToPem(cert),
            ca: pki.certificateToPem(this.caCert)
        };

        // We cache in memory only - no need to persist these (unlike ACME etc)
        this.certInMemoryCache[domain] = generatedCertificate;

        // Make sure this gets regenerated in 24 hours, in case this server is running persistently
        setTimeout(() => {
            delete this.certInMemoryCache[domain];
        }, 1000 * 60 * 60 * 24).unref();

        return generatedCertificate;
    }

    generateSelfSignedCertificate(domain: string) {
        const cacheKey = `${domain}:self-signed`;

        const cachedCert = this.certInMemoryCache[cacheKey];
        if (cachedCert) return cachedCert;

        const cert = pki.createCertificate();

        cert.publicKey = KEY_PAIR!.publicKey;
        cert.serialNumber = generateSerialNumber();

        cert.validity.notBefore = new Date();
        cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);

        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

        const subject = [
            { name: 'commonName', value: domain },
            { name: 'countryName', value: this.options?.countryName ?? 'XX' },
            { name: 'localityName', value: this.options?.localityName ?? 'Unknown' },
            { name: 'organizationName', value: this.options?.organizationName ?? 'Testserver Test Cert' }
        ];

        cert.setSubject(subject);
        cert.setIssuer(subject); // Self-signed: issuer = subject

        cert.setExtensions([
            { name: 'basicConstraints', cA: false, critical: true },
            { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
            { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
            {
                name: 'subjectAltName',
                altNames: [{ type: 2, value: domain }]
            },
            { name: 'subjectKeyIdentifier' }
        ]);

        cert.sign(KEY_PAIR!.privateKey, md.sha256.create()); // Self-signed: sign with own key

        const certPem = pki.certificateToPem(cert);
        const generatedCertificate = {
            key: pki.privateKeyToPem(KEY_PAIR!.privateKey),
            cert: certPem,
            ca: certPem // Self-signed: cert is its own CA
        };

        this.certInMemoryCache[cacheKey] = generatedCertificate;

        setTimeout(() => {
            delete this.certInMemoryCache[cacheKey];
        }, 1000 * 60 * 60 * 24).unref();

        return generatedCertificate;
    }
}