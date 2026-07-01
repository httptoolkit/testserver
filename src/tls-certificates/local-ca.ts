import { Buffer } from 'buffer';
import { createOcspResponse } from './ocsp.js';

import * as x509 from '@peculiar/x509';
import * as asn1X509 from '@peculiar/asn1-x509';
import * as asn1Schema from '@peculiar/asn1-schema';
import { CertOptions } from './cert-definitions.js';
import { CertStoreBackend, CachedCertificate, certObjectId } from './cert-cache.js';

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
 * Generate a CA certificate (root or intermediate). Self-signs unless `signWith`
 * (an issuing CA cert and key) is provided, in which case it issues a subordinate CA.
 */
async function buildCaCertificate(options: {
    subject: x509.JsonNameParams,
    bits: number,
    pathLenConstraint?: number, // undefined => no constraint
    lifespanYears?: number, // defaults to 1
    signWith?: { cert: x509.X509Certificate, key: CryptoKey } // omitted => self-signed
}): Promise<{ keyPair: CryptoKeyPair, certificate: x509.X509Certificate }> {
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

    const subjectDistinguishedName = new x509.Name(options.subject).toString();

    const notBefore = new Date();
    // Make it valid for the last 24h - helps in cases where clocks slightly disagree
    notBefore.setDate(notBefore.getDate() - 1);

    const notAfter = new Date();
    // Valid for the next year by default.
    notAfter.setFullYear(notAfter.getFullYear() + (options.lifespanYears ?? 1));

    const extensions: x509.Extension[] = [
        new x509.BasicConstraintsExtension(true, options.pathLenConstraint, true),
        new x509.KeyUsagesExtension(
            x509.KeyUsageFlags.keyCertSign |
            x509.KeyUsageFlags.digitalSignature |
            x509.KeyUsageFlags.cRLSign,
            true
        ),
        await x509.SubjectKeyIdentifierExtension.create(keyPair.publicKey as CryptoKey, false)
    ];

    if (options.signWith) {
        extensions.push(await x509.AuthorityKeyIdentifierExtension.create(options.signWith.cert, false));
    }

    const certificate = await x509.X509CertificateGenerator.create({
        serialNumber: generateSerialNumber(),
        subject: subjectDistinguishedName,
        issuer: options.signWith ? options.signWith.cert.subject : subjectDistinguishedName,
        notBefore,
        notAfter,
        signingAlgorithm: keyAlgorithm,
        publicKey: keyPair.publicKey as CryptoKey,
        signingKey: options.signWith ? options.signWith.key : keyPair.privateKey as CryptoKey,
        extensions
    });

    return { keyPair, certificate };
}

/**
 * Generate a self-signed root CA certificate for TLS.
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
    const {
        commonName = 'Test Certificate Authority',
        organizationName = 'Testserver',
        countryName = 'XX', // ISO-3166-1 alpha-2 'unknown country' code
        bits = 2048
    } = options;

    // Baseline requirements set a specific order for CA subject fields
    const subject: x509.JsonNameParams = [];
    if (countryName) subject.push({ C: [countryName] });
    if (organizationName) subject.push({ O: [organizationName] });
    if (commonName) subject.push({ CN: [commonName] });

    const { keyPair, certificate } = await buildCaCertificate({ subject, bits });

    const privateKeyBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey as CryptoKey);
    return {
        key: arrayBufferToPem(privateKeyBuffer, "PRIVATE KEY"),
        cert: certificate.toString("pem")
    };
}


// Generates a unique serial number for a certificate as a hex string:
function generateSerialNumber() {
    // Use digit prefix (0-7) to ensure high bit is clear (naturally positive per RFC 5280).
    // Prefixes 0-7 have MSB=0: e.g. '1' = 0001, so '1x...' is naturally positive.
    return '1' + crypto.randomUUID().replace(/-/g, '');
}

// A certificate must not outlive its issuer, otherwise the chain stops validating once the
// issuer expires (even while the leaf itself is still in date). Cap the leaf accordingly.
export function clampNotAfter(notAfter: Date, issuerNotAfter: Date): Date {
    return notAfter.getTime() > issuerNotAfter.getTime()
        ? new Date(issuerNotAfter.getTime())
        : notAfter;
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
        'selfSigned',
        'noCommonName'
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
    noCommonName?: boolean;
}

// Key + cert material for a CA we operate (the server intermediate, or the separate
// client-auth CA). Persisted and shared across the fleet via the cert store.
type CaMaterial = {
    cert: x509.X509Certificate,
    key: CryptoKey,
    pem: string
};

// Regenerate a persisted CA or client cert once it's within this margin of expiry.
const RENEWAL_MARGIN_MS = 1000 * 60 * 60 * 24 * 30;

// Persisted CAs are long-lived (rather than the 1-year default) to avoid unnecessary
// rotation, but well within their issuer's lifetime where they have one.
const INTERMEDIATE_LIFESPAN_YEARS = 6;
const INTERMEDIATE_CACHE_DOMAIN = 'intermediate-ca';

const CLIENT_AUTH_CA_LIFESPAN_YEARS = 10;
const CLIENT_AUTH_CA_CACHE_DOMAIN = 'client-auth-ca';

const CLIENT_CERT_LIFESPAN_YEARS = 2;

export class LocalCA {
    private caCert: x509.X509Certificate;
    private caKey: CryptoKey;
    private options: CAOptions;

    private certInMemoryCache: { [domain: string]: LocallyGeneratedCertificate | undefined } = {};

    private intermediateCA?: Promise<CaMaterial>;

    private clientAuthCA?: Promise<CaMaterial>;

    private clientCertificate?: Promise<{ cert: LocallyGeneratedCertificate, expiry: number }>;

    private constructor(
        private caCertPem: string,
        caCert: x509.X509Certificate,
        caKey: CryptoKey,
        caOptions: CAOptions,
        private certStore?: CertStoreBackend
    ) {
        this.caCert = caCert;
        this.caKey = caKey;
        this.options = caOptions ?? {};
    }

    static async create(
        caOptions: CAOptions,
        certStore?: CertStoreBackend
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

        return new LocalCA(caOptions.cert.toString(), caCert, caKey, caOptions, certStore);
    }
    
    private getIntermediateCA(): Promise<CaMaterial> {
        return this.intermediateCA ??= this.loadOrCreatePersistedCA(
            this.intermediateCacheKey(),
            INTERMEDIATE_CACHE_DOMAIN,
            () => this.buildManagedCA('Test Intermediate CA', INTERMEDIATE_LIFESPAN_YEARS, {
                cert: this.caCert,
                key: this.caKey
            })
        );
    }

    async getIntermediateCertificatePem(): Promise<string> {
        return (await this.getIntermediateCA()).pem;
    }

    private getClientAuthCA(): Promise<CaMaterial> {
        return this.clientAuthCA ??= this.loadOrCreatePersistedCA(
            CLIENT_AUTH_CA_CACHE_DOMAIN,
            CLIENT_AUTH_CA_CACHE_DOMAIN,
            () => this.buildManagedCA('Testserver Client Authentication CA', CLIENT_AUTH_CA_LIFESPAN_YEARS)
        );
    }

    async getClientAuthCaCertPem(): Promise<string> {
        return (await this.getClientAuthCA()).pem;
    }

    // The intermediate is keyed by the root that signs it, so a different root gets its
    // own intermediate and a stored one is never paired with the wrong root.
    private intermediateCacheKey(): string {
        return `intermediate+${certObjectId(this.caCertPem)}`;
    }

    // Load a persisted CA (server intermediate or client-auth CA) from the shared store,
    // creating & storing it if absent, renewing it if within its renewal margin, and adopting
    // one created concurrently by another server so the whole fleet converges on a single CA.
    private async loadOrCreatePersistedCA(
        cacheKey: string,
        cacheDomain: string,
        create: () => Promise<CaMaterial>
    ): Promise<CaMaterial> {
        if (!this.certStore) return create();

        const stored = await this.certStore.read(cacheKey);
        if (stored && this.isCaUsable(stored)) {
            const parsed = await this.tryParseStoredCA(stored);
            if (parsed) return parsed;
        }

        const generated = await create();
        const record = await this.caToRecord(generated, cacheKey, cacheDomain);

        if (stored) {
            // The stored CA is expired or unusable - replace it.
            await this.certStore.write(record);
            console.log(`Renewed ${cacheDomain} in the shared cert store`);
            return generated;
        }

        // Nothing stored yet - create it race-safely. If another server beat us to it,
        // adopt theirs so the whole fleet converges on a single CA.
        if (await this.certStore.writeIfAbsent(record)) {
            console.log(`Stored newly generated ${cacheDomain} in the shared cert store`);
            return generated;
        }

        const winner = await this.certStore.read(cacheKey);
        if (winner && this.isCaUsable(winner)) {
            const parsed = await this.tryParseStoredCA(winner);
            if (parsed) {
                console.log(`Adopted ${cacheDomain} created concurrently by another server`);
                return parsed;
            }
        }
        return generated;
    }

    private isCaUsable(stored: CachedCertificate): boolean {
        return stored.expiry - Date.now() > RENEWAL_MARGIN_MS;
    }

    private async tryParseStoredCA(stored: CachedCertificate): Promise<CaMaterial | undefined> {
        try {
            return {
                cert: new x509.X509Certificate(stored.cert),
                key: await pemToCryptoKey(stored.key),
                pem: stored.cert
            };
        } catch (e) {
            console.warn('Stored CA could not be loaded, regenerating:', e);
            return undefined;
        }
    }

    private async caToRecord(ca: CaMaterial, cacheKey: string, domain: string): Promise<CachedCertificate> {
        const keyPkcs8 = await crypto.subtle.exportKey("pkcs8", ca.key);
        return {
            cacheKey,
            domain,
            key: arrayBufferToPem(keyPkcs8, "PRIVATE KEY"),
            cert: ca.pem,
            expiry: ca.cert.notAfter.getTime()
        };
    }

    // Build a CA we operate: the server intermediate (pass signWith to chain it under the root)
    // or the self-signed client-auth CA (omit signWith).
    private async buildManagedCA(
        commonName: string,
        lifespanYears: number,
        signWith?: { cert: x509.X509Certificate, key: CryptoKey }
    ): Promise<CaMaterial> {
        const { keyPair, certificate } = await buildCaCertificate({
            subject: [
                { C: [this.options.countryName ?? 'XX'] },
                { O: ['Testserver'] },
                { CN: [commonName] }
            ],
            bits: this.options.keyLength || 2048,
            pathLenConstraint: 0,
            lifespanYears,
            signWith
        });

        return {
            cert: certificate,
            key: keyPair.privateKey as CryptoKey,
            pem: certificate.toString('pem')
        };
    }

    // A downloadable client certificate for the mTLS (client-cert) endpoint, signed by the
    // separate client-auth CA (never the server TLS root). The endpoint accepts any cert signed
    // by that CA, so a previously-downloaded one keeps working across restarts/machines, and
    // renewals overlap automatically: old copies stay valid until their own expiry.
    async getClientCertificate(): Promise<LocallyGeneratedCertificate> {
        const existing = this.clientCertificate;
        if (existing) {
            try {
                const { cert, expiry } = await existing;
                if (expiry - Date.now() >= RENEWAL_MARGIN_MS) return cert;
            } catch {
                // A failed generation shouldn't poison the cache - fall through and retry.
            }
        }
        this.clientCertificate = this.createClientCertificate();
        return (await this.clientCertificate).cert;
    }

    private async createClientCertificate(): Promise<{ cert: LocallyGeneratedCertificate, expiry: number }> {
        const clientAuthCA = await this.getClientAuthCA();

        const keyPair = await crypto.subtle.generateKey(
            { ...KEY_PAIR_ALGO, modulusLength: this.options.keyLength || 2048 },
            true,
            ['sign', 'verify']
        ) as CryptoKeyPair;

        const subject = new x509.Name([
            { C: [this.options.countryName ?? 'XX'] },
            { O: ['Testserver'] },
            { CN: ['Testserver Client Certificate'] }
        ]).toString();

        const notBefore = new Date();
        notBefore.setDate(notBefore.getDate() - 1);
        const notAfter = new Date();
        notAfter.setFullYear(notAfter.getFullYear() + CLIENT_CERT_LIFESPAN_YEARS);
        const effectiveNotAfter = clampNotAfter(notAfter, clientAuthCA.cert.notAfter);

        const certificate = await x509.X509CertificateGenerator.create({
            serialNumber: generateSerialNumber(),
            subject,
            issuer: clientAuthCA.cert.subject,
            notBefore,
            notAfter: effectiveNotAfter,
            signingAlgorithm: KEY_PAIR_ALGO,
            publicKey: keyPair.publicKey as CryptoKey,
            signingKey: clientAuthCA.key,
            extensions: [
                new x509.BasicConstraintsExtension(false, undefined, true),
                new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
                new x509.ExtendedKeyUsageExtension([asn1X509.id_kp_clientAuth], false),
                await x509.AuthorityKeyIdentifierExtension.create(clientAuthCA.cert, false)
            ]
        });

        return {
            cert: {
                key: arrayBufferToPem(
                    await crypto.subtle.exportKey('pkcs8', keyPair.privateKey as CryptoKey),
                    'PRIVATE KEY'
                ),
                cert: certificate.toString('pem'),
                ca: clientAuthCA.pem
            },
            expiry: effectiveNotAfter.getTime()
        };
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
        // Skip CN for wildcards (they cannot use it) and no-common-name certs
        if (domain[0] !== '*' && !options.noCommonName) {
            subjectJsonNameParams.push({ CN: [domain] });
        }

        const subjectDistinguishedName = new x509.Name(subjectJsonNameParams).toString();

        const intermediate = options.selfSigned
            ? undefined
            : await this.getIntermediateCA();

        const issuerDistinguishedName = intermediate
            ? intermediate.cert.subject
            : subjectDistinguishedName;

        const notBefore = new Date();
        const notAfter = new Date();

        if (options.expired) {
            notBefore.setDate(notBefore.getDate() - 2);
            notAfter.setDate(notAfter.getDate() - 1);
        } else {
            notBefore.setDate(notBefore.getDate() - 1); // Valid from 24 hours ago
            notAfter.setFullYear(notAfter.getFullYear() + 1); // Valid for 1 year
        }

        const effectiveNotAfter = intermediate
            ? clampNotAfter(notAfter, intermediate.cert.notAfter)
            : notAfter;

        const extensions: x509.Extension[] = [];
        extensions.push(new x509.BasicConstraintsExtension(false, undefined, true));
        extensions.push(new x509.KeyUsagesExtension(
            x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
            true
        ));
        extensions.push(new x509.ExtendedKeyUsageExtension(
            [asn1X509.id_kp_serverAuth],
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
        if (intermediate) {
            extensions.push(await x509.AuthorityKeyIdentifierExtension.create(intermediate.cert, false));
        }

        const certificate = await x509.X509CertificateGenerator.create({
            serialNumber: generateSerialNumber(),
            subject: subjectDistinguishedName,
            issuer: issuerDistinguishedName,
            notBefore,
            notAfter: effectiveNotAfter,
            signingAlgorithm: KEY_PAIR_ALGO,
            publicKey: leafKeyPair.publicKey,
            signingKey: intermediate
                ? intermediate.key
                : leafKeyPair.privateKey as CryptoKey,
            extensions
        });

        const certPem = certificate.toString("pem");
        const generatedCertificate = {
            key: arrayBufferToPem(
                await crypto.subtle.exportKey("pkcs8", leafKeyPair.privateKey as CryptoKey),
                "PRIVATE KEY"
            ),
            // Serve the full chain leaf -> intermediate -> root (matching production,
            // which sends the root too). incomplete-chain later strips back to the leaf.
            cert: intermediate
                ? `${certPem.trimEnd()}\n${intermediate.pem.trimEnd()}\n${this.caCertPem.trimEnd()}\n`
                : certPem,
            ca: options.selfSigned ? certPem : this.caCertPem // Use cached CA cert PEM
        };

        this.certInMemoryCache[cacheKey] = generatedCertificate;

        setTimeout(() => {
            delete this.certInMemoryCache[cacheKey];
        }, 1000 * 60 * 60 * 24).unref();

        return generatedCertificate;
    }

    // An OCSP response must be signed by (and its CertID derived from) the cert's actual
    // issuer. Non-self-signed leaves are issued by the intermediate, so resolve that;
    // fall back to the root for anything else.
    private async resolveOcspIssuer(
        cert: x509.X509Certificate
    ): Promise<{ cert: x509.X509Certificate, key: CryptoKey }> {
        if (this.intermediateCA) {
            const intermediate = await this.intermediateCA;
            if (cert.issuer === intermediate.cert.subject) {
                return { cert: intermediate.cert, key: intermediate.key };
            }
        }
        return { cert: this.caCert, key: this.caKey };
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

        const { cert: issuerCert, key: issuerKey } = await this.resolveOcspIssuer(cert);

        if (isRevokedCert(cert)) {
            // Certificate is revoked - return revoked OCSP response
            return await createOcspResponse({
                cert,
                issuerCert,
                issuerKey,
                status: 'revoked',
                revocationTime: new Date(), // Use current time as approximation
                revocationReason: 1 // keyCompromise
            });
        }

        // Certificate not revoked - return good status
        return await createOcspResponse({
            cert,
            issuerCert,
            issuerKey,
            status: 'good'
        });
    }
}
