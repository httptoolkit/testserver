import * as crypto from 'node:crypto';
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

    async getChallengeResponse(token: string) {
        return (await this.acmeClient).getChallengeKeyAuthorization({
            token,
            type: 'http-01',
            url: '',
            status: 'pending'
        });
    }

    tryGetCertificateSync(domain: string) {
        const cachedCert = this.certCache.getCert(domain);

        if (cachedCert) {
            console.log(`Found cached cert for ${domain} (hash:${crypto.hash('sha256', cachedCert.cert)}, expiry: ${new Date(cachedCert.expiry).toISOString()})`);
        }

        if (!cachedCert || cachedCert.expiry - Date.now() < ONE_WEEK) {
            const attemptId = Math.random().toString(16).slice(2);
            console.log(`Starting async cert update (${attemptId}) for domain ${domain}`);
            this.getCertificate(domain, { attemptId }); // Trigger a cert refresh
        }

        return cachedCert;
    }

    private async getCertificate(
        domain: string,
        options: { forceRegenerate?: boolean, attemptId: string }
    ): Promise<AcmeGeneratedCertificate> {
        if (!options.attemptId) {
            options.attemptId = Math.random().toString(16).slice(2);
        }

        const cachedCert = this.certCache.getCert(domain);
        if (cachedCert && !options.forceRegenerate) {
            // If we have this cert in the cache, we generally want to use that.

            if (cachedCert.expiry <= Date.now() - ONE_MINUTE) {
                // Expired - clear this data and get a new certificate somehow
                console.log(`Renewing totally expired certificate for ${domain} (${options.attemptId})`);
                this.certCache.clearCache(domain);
                return this.getCertificate(domain, { attemptId: options.attemptId });
            }

            if (
                cachedCert.expiry - Date.now() < ONE_WEEK && // Expires soon
                !this.pendingCertRenewals[domain] // Not already updating
            ) {
                // Not yet expired, but expiring soon - we want to refresh this certificate, but
                // we're OK to do it async and keep using the current one for now.
                console.log(`Renewing near-expiry certificate for ${domain} (${options.attemptId})`);

                this.pendingCertRenewals[domain] = this.getCertificate(domain, {
                    forceRegenerate: true,
                    attemptId: options.attemptId
                });
            }

            return cachedCert;
        }

        if (!cachedCert) console.log(`No cached cert for ${domain} (${options.attemptId})`);
        else if (options.forceRegenerate) console.log(`Force regenerating cert for ${domain} (${options.attemptId})`);

        if (this.pendingCertRenewals[domain] && !options.forceRegenerate) {
            // Coalesce updates for pending certs into one
            return this.pendingCertRenewals[domain]!;
        }

        const refreshPromise: Promise<AcmeGeneratedCertificate> = this.requestNewCertificate(domain, {
            attemptId: options.attemptId
        }).then((certData) => {
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
            console.log(`Cert refresh completed for domain ${domain} (${options.attemptId}), hash:${crypto.hash('sha256', certData.cert)}`);
            return certData;
        }).catch((e) => {
            console.log(`Cert refresh failed (${options.attemptId})`, e);
            return this.getCertificate(domain, { forceRegenerate: true, attemptId: options.attemptId });
        });

        this.pendingCertRenewals[domain] = refreshPromise;
        return refreshPromise;
    }

    private async requestNewCertificate(domain: string, options: { attemptId: string }): Promise<AcmeGeneratedCertificate> {
        console.log(`Requesting new certificate for ${domain} (${options.attemptId})`);

        const [key, csr] = await ACME.crypto.createCsr({
            commonName: domain
        });

        const cert = await (await this.acmeClient).auto({
            csr,
            challengePriority: ['http-01'],
            termsOfServiceAgreed: true,
            skipChallengeVerification: true,
            challengeCreateFn: async (_authz, challenge, keyAuth) => {
                if (challenge.type !== 'http-01') {
                    throw new Error(`Unexpected ${challenge.type} challenge (${options.attemptId})`);
                }

                console.log(`Preparing for ${challenge.type} ACME challenge ${challenge.token} (${options.attemptId})`);

                this.pendingAcmeChallenges[challenge.token] = keyAuth;
            },
            challengeRemoveFn: async (_authz, challenge) => {
                if (challenge.type !== 'http-01') {
                    throw new Error(`Unexpected ${challenge.type} challenge (${options.attemptId})`);
                }

                console.log(`Removing ACME ${
                    challenge.status
                } ${
                    challenge.type
                } challenge ${
                    JSON.stringify(challenge)
                }) (${options.attemptId})`);

                delete this.pendingAcmeChallenges[challenge.token];
            }
        });

        console.log(`Successfully ACMEd new certificate for ${domain} (${options.attemptId})`);

        return {
            key: key.toString(),
            cert,
            expiry: (new Date(ACME.crypto.readCertificateInfo(cert).notAfter)).valueOf()
        };
    }
}