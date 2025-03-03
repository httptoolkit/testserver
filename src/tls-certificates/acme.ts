import * as ACME from 'acme-client';
import { PersistentCertCache } from './cert-cache.js';

const ONE_MINUTE = 1000 * 60;
const ONE_DAY = ONE_MINUTE * 60 * 24;
const ONE_WEEK = ONE_DAY * 7;

interface AcmeGeneratedCertificate {
    key: string;
    cert: string;
    expiry: number;
}

const SUPPORTED_ACME_PROVIDERS = ['letsencrypt', 'zerossl'] as const;

export type AcmeProvider = typeof SUPPORTED_ACME_PROVIDERS[number];

export interface ExternalAccessBindingConfig {
    kid: string;
    hmacKey: string;
}

export class AcmeCA {

    constructor(
        private certCache: PersistentCertCache,
        private acmeProvider: AcmeProvider,
        private eabConfig: ExternalAccessBindingConfig | undefined
    ) {
        if (!SUPPORTED_ACME_PROVIDERS.includes(acmeProvider)) {
            throw new Error(`Unsupported ACME provider: ${acmeProvider}`);
        }
    }

    private pendingAcmeChallenges: { [token: string]: string | undefined } = {}
    private pendingCertRenewals: { [domain: string]: Promise<AcmeGeneratedCertificate> | undefined } = {};

    private readonly acmeClient = ACME.crypto.createPrivateKey().then(
        (accountKey) => new ACME.Client({
            directoryUrl: ACME.directory[this.acmeProvider].production,
            accountKey,
            externalAccountBinding: this.eabConfig
        })
    );

    getChallengeResponse(token: string) {
        return this.pendingAcmeChallenges[token];
    }

    tryGetCertificateSync(domain: string) {
        const cachedCert = this.certCache.getCert(domain);

        if (!cachedCert || cachedCert.expiry - Date.now() < ONE_WEEK) {
            this.getCertificate(domain); // Trigger a cert refresh
        }

        return cachedCert;
    }

    private async getCertificate(
        domain: string,
        options: { forceRegenerate?: boolean } = {}
    ): Promise<AcmeGeneratedCertificate> {
        const cachedCert = this.certCache.getCert(domain);
        if (cachedCert && !options.forceRegenerate) {
            // If we have this cert in the cache, we generally want to use that.

            if (cachedCert.expiry <= Date.now() - ONE_MINUTE) {
                // Expired - clear this data and get a new certificate somehow
                console.log(`Renewing totally expired certificate for ${domain}`);
                this.certCache.clearCache(domain);
                return this.getCertificate(domain);
            }

            if (
                cachedCert.expiry - Date.now() < ONE_WEEK && // Expires soon
                !this.pendingCertRenewals[domain] // Not already updating
            ) {
                // Not yet expired, but expiring soon - we want to refresh this certificate, but
                // we're OK to do it async and keep using the current one for now.
                console.log(`Renewing near-expiry certificate for ${domain}`);

                this.pendingCertRenewals[domain] = this.getCertificate(domain, {
                    forceRegenerate: true
                });
            }

            return cachedCert;
        }

        if (!cachedCert) console.log(`No cached cert for ${domain}`);
        else if (options.forceRegenerate) console.log(`Force regenerating cert for ${domain}`);

        if (this.pendingCertRenewals[domain] && !options.forceRegenerate) {
            // Coalesce updates for pending certs into one
            return this.pendingCertRenewals[domain]!;
        }

        const refreshPromise: Promise<AcmeGeneratedCertificate> = this.requestNewCertificate(domain)
            .then((certData) => {
                if (
                    this.pendingCertRenewals[domain] &&
                    this.pendingCertRenewals[domain] !== refreshPromise
                ) {
                    // Don't think this should happen, but if we're somehow ever not the current cert
                    // update, delegate to the 'real' cert update instead.
                    return this.pendingCertRenewals[domain]!;
                }

                delete this.pendingCertRenewals[domain];
                this.certCache.cacheCert({ ...certData, domain });
                return certData;
            })
            .catch((e) => {
                console.log('Cert request failed', e);
                return this.getCertificate(domain, { forceRegenerate: true });
            })

        this.pendingCertRenewals[domain] = refreshPromise;
        return refreshPromise;
    }

    private async requestNewCertificate(domain: string): Promise<AcmeGeneratedCertificate> {
        console.log(`Requesting new certificate for ${domain}`);

        const [key, csr] = await ACME.crypto.createCsr({
            commonName: domain
        });

        const cert = await (await this.acmeClient).auto({
            csr,
            challengePriority: ['http-01'],
            termsOfServiceAgreed: true,
            challengeCreateFn: async (_authz, challenge, keyAuth) => {
                if (challenge.type !== 'http-01') {
                    throw new Error(`Unexpected ${challenge.type} challenge`);
                }

                console.log(`Preparing for ${challenge.type} ACME challenge`);

                this.pendingAcmeChallenges[challenge.token] = keyAuth;
            },
            challengeRemoveFn: async (_authz, challenge) => {
                if (challenge.type !== 'http-01') {
                    throw new Error(`Unexpected ${challenge.type} challenge`);
                }

                console.log(`Removing ACME ${
                    challenge.status
                } ${
                    challenge.type
                } challenge (validated: ${
                    challenge.validated
                }, error: ${
                    JSON.stringify(challenge.error)
                })`)

                this.pendingAcmeChallenges[challenge.token];
            }
        });

        console.log(`Successfully ACMEd new certificate for ${domain}`);

        return {
            key: key.toString(),
            cert,
            expiry: (new Date(ACME.crypto.readCertificateInfo(cert).notAfter)).valueOf()
        };
    }
}