import * as crypto from 'node:crypto';
import * as ACME from 'acme-client';

import { PersistentCertCache } from './cert-cache.js';
import { CertOptions, calculateCertCacheKey } from './cert-definitions.js';

const ONE_MINUTE = 1000 * 60;
const ONE_DAY = ONE_MINUTE * 60 * 24;
const PROACTIVE_REFRESH_TIME = ONE_DAY * 14;

interface AcmeGeneratedCertificate {
    key: string;
    cert: string;
    expiry: number;
}

const SUPPORTED_ACME_PROVIDERS = [
    'letsencrypt',
    'zerossl',
    'google'
] as const;

export type AcmeProvider = typeof SUPPORTED_ACME_PROVIDERS[number];

export class AcmeCA {

    private readonly acmeClient: ACME.Client;

    constructor(
        private certCache: PersistentCertCache,
        private acmeProvider: AcmeProvider,
        accountKey: string
    ) {
        if (!SUPPORTED_ACME_PROVIDERS.includes(acmeProvider)) {
            throw new Error(`Unsupported ACME provider: ${acmeProvider}`);
        }

        this.acmeClient = new ACME.Client({
            directoryUrl: ACME.directory[this.acmeProvider].production,
            accountKey
        });
    }

    private pendingCertRenewals: { [cacheKey: string]: (Promise<AcmeGeneratedCertificate> & { id: string }) | undefined } = {};

    getChallengeResponse(token: string) {
        const challengeResponse = this.acmeClient.getChallengeKeyAuthorization({
            token,
            type: 'http-01',
            url: '',
            status: 'pending'
        });

        console.log(`Challenge response for ${token} is ${challengeResponse}`);

        return challengeResponse;
    }

    /**
     * Get a certificate, if one is available synchronously, or start creation and return
     * undefined if not. This also triggers a background refresh if close to expiry.
     */
    tryGetCertificateSync(domain: string, certOptions: CertOptions) {
        const cacheKey = calculateCertCacheKey(domain, certOptions);
        let cachedCert = this.certCache.getCert(cacheKey);

        if (cachedCert) {
            console.log(`Found cached cert for ${cacheKey} (hash:${crypto.hash('sha256', cachedCert.cert)}, expiry: ${new Date(cachedCert.expiry).toISOString()})`);
        
            if (certOptions.expired) {
                const isExpired = cachedCert.expiry <= Date.now();
                console.log(`Found cached expired-mode cert for ${cacheKey} (expiry: ${new Date(cachedCert.expiry).toISOString()}, actually expired: ${isExpired})`);

                if (!isExpired) {
                    // Not yet expired - caller should use LocalCA fallback
                    return undefined;
                }
            }
        }

        if (!cachedCert || (!certOptions.expired && cachedCert.expiry - Date.now() < PROACTIVE_REFRESH_TIME)) {
            const attemptId = Math.random().toString(16).slice(2);
            console.log(`Starting async cert update (${attemptId}) for domain ${cacheKey}`);

            // Trigger cert generation async
            this.getCertificate(domain, { attemptId, certOptions })
                .catch((e) => {
                    console.error(`Certificate generation failed: ${e}`);
                });
        }

        return cachedCert;
    }

    async waitForCertificate(domain: string, certOptions: CertOptions) {
        const attemptId = Math.random().toString(16).slice(2);
        return this.getCertificate(domain, { certOptions, attemptId });
    }

    private async getCertificate(
        domain: string,
        options: { forceRegenerate?: boolean, attemptId: string, certOptions: CertOptions }
    ): Promise<AcmeGeneratedCertificate> {
        const { certOptions, forceRegenerate, attemptId } = options;
        const cacheKey = calculateCertCacheKey(domain, certOptions)
        const cachedCert = this.certCache.getCert(cacheKey);

        if (cachedCert && !options.forceRegenerate) {
            // If we have this cert in the cache, we generally want to use that.

            // Cert already expired?
            if (cachedCert.expiry <= Date.now()) {
                if (certOptions.expired) {
                    return cachedCert;
                }

                // Expired - clear this data and get a new certificate somehow
                console.log(`Renewing totally expired certificate for ${cacheKey} (${attemptId})`);
                this.certCache.clearCache(cacheKey);
                return this.getCertificate(domain, { attemptId, certOptions });
            }

            // If the cert expires soon and needs refreshing
            if (!certOptions.expired && cachedCert.expiry - Date.now() < PROACTIVE_REFRESH_TIME) {
                if (!this.pendingCertRenewals[cacheKey]) {
                    // Not yet expired, but expiring soon - we want to refresh this certificate, but
                    // we're OK to do it async and keep using the current one for now.
                    console.log(`Renewing near-expiry certificate for ${cacheKey} (${attemptId})`);

                    // Trigger update in the background, catch any errors. This will add itself to pendingCertRenewals
                    // so no need to update that separately.
                    this.getCertificate(domain, { forceRegenerate: true, attemptId, certOptions })
                    .catch((e) => {
                        console.log(`Background <1 week refresh failed with ${e.message}`);
                    });
                } else {
                    console.log(`Certificate refresh already pending for ${cacheKey} (${attemptId}) from attempt ${
                        this.pendingCertRenewals[cacheKey]!.id
                    }`);
                }
            } else {
                console.log(`Cached cert still valid for ${cacheKey} (${attemptId})`);
            }

            return cachedCert;
        }

        if (!cachedCert) console.log(`No cached cert for ${cacheKey} (${attemptId})`);
        else if (forceRegenerate) console.log(`Force regenerating cert for ${cacheKey} (${attemptId})`);

        if (this.pendingCertRenewals[cacheKey] && !forceRegenerate) {
            console.log(`Certificate generation already pending for ${cacheKey} (${attemptId}) from attempt ${
                this.pendingCertRenewals[cacheKey]!.id
            }`);

            // Coalesce updates for pending certs into one
            return this.pendingCertRenewals[cacheKey]!;
        }

        const requestCert = certOptions.expired && this.acmeProvider === 'google'
            ? this.requestShortLivedCertificate.bind(this)
            : this.requestNewCertificate.bind(this);

        const refreshPromise = Object.assign(requestCert(domain, { attemptId })
        .then(async (certData): Promise<AcmeGeneratedCertificate> => {
            if (
                this.pendingCertRenewals[cacheKey] &&
                this.pendingCertRenewals[cacheKey] !== refreshPromise
            ) {
                console.log(`Certificate generation for ${cacheKey} (${attemptId}) superseded by another attempt ${
                    this.pendingCertRenewals[cacheKey]!.id
                }`);

                // Don't think this should happen, but if we're somehow ever not the current cert
                // update, delegate to the 'real' cert update instead.
                return this.pendingCertRenewals[cacheKey]!;
            }

            if (certOptions.revoked) {
                await this.acmeClient.revokeCertificate(certData.cert);
            }

            delete this.pendingCertRenewals[cacheKey];
            this.certCache.cacheCert({ ...certData, domain, cacheKey });
            console.log(`Cert generation completed for domain ${cacheKey} (${attemptId}), hash:${crypto.hash('sha256', certData.cert)}`);
            return certData;
        }).catch((e) => {
            console.log(`Cert generation failed (${attemptId})`, e);
            return this.getCertificate(domain, { forceRegenerate: true, attemptId, certOptions });
        }), { id: attemptId });

        this.pendingCertRenewals[cacheKey] = refreshPromise;
        console.log(`Started cert generation for domain ${cacheKey} (${attemptId})`);
        return refreshPromise;
    }

    private async requestNewCertificate(domain: string, options: { attemptId: string }): Promise<AcmeGeneratedCertificate> {
        console.log(`Requesting new certificate for ${domain} (${options.attemptId})`);

        const [key, csr] = await ACME.crypto.createCsr({
            commonName: domain
        });

        const cert = await this.acmeClient.auto({
            csr,
            challengePriority: ['http-01'],
            termsOfServiceAgreed: true,
            email: 'contact@' + domain,
            skipChallengeVerification: true,
            challengeCreateFn: async () => {
                // Challenge responses are stateless - getChallengeResponse() computes
                // the key authorization directly from the token
            },
            challengeRemoveFn: async () => {}
        });

        console.log(`Successfully ACMEd new certificate for ${domain} (${options.attemptId})`);

        return {
            key: key.toString(),
            cert,
            expiry: (new Date(ACME.crypto.readCertificateInfo(cert).notAfter)).valueOf()
        };
    }

    /**
     * Request a short-lived certificate (1 day validity) using the lower-level ACME API.
     * Google Trust Services supports validity periods as short as 1 day.
     */
    private async requestShortLivedCertificate(domain: string, options: { attemptId: string }): Promise<AcmeGeneratedCertificate> {
        console.log(`Requesting short-lived certificate for ${domain} (${options.attemptId})`);

        const [key, csr] = await ACME.crypto.createCsr({
            commonName: domain
        });

        // Ensure account exists
        await this.acmeClient.createAccount({
            termsOfServiceAgreed: true,
            contact: [`mailto:contact@${domain}`]
        });

        // Create order with 1-day validity
        const notBefore = new Date();
        const notAfter = new Date(Date.now() + ONE_DAY);

        console.log(`Creating order with validity: ${notBefore.toISOString()} to ${notAfter.toISOString()} (${options.attemptId})`);

        const order = await this.acmeClient.createOrder({
            identifiers: [{ type: 'dns', value: domain }],
            notBefore: notBefore.toISOString(),
            notAfter: notAfter.toISOString()
        });

        // Get and complete authorizations
        const authorizations = await this.acmeClient.getAuthorizations(order);
        console.log(`Got ${authorizations.length} authorizations for ${domain} (${options.attemptId})`);

        for (const authz of authorizations) {
            if (authz.status === 'valid') {
                console.log(`Authorization already valid for ${authz.identifier.value} (${options.attemptId})`);
                continue;
            }

            // Find http-01 challenge
            const challenge = authz.challenges.find(c => c.type === 'http-01');
            if (!challenge) {
                throw new Error(`No http-01 challenge found for ${authz.identifier.value} (${options.attemptId})`);
            }

            // Complete challenge - response is stateless via getChallengeResponse()
            console.log(`Completing http-01 challenge for ${authz.identifier.value} (${options.attemptId})`);
            await this.acmeClient.completeChallenge(challenge);
            await this.acmeClient.waitForValidStatus(challenge);
        }

        // Finalize order and get certificate
        console.log(`Finalizing order for ${domain} (${options.attemptId})`);
        const finalized = await this.acmeClient.finalizeOrder(order, csr);
        const cert = await this.acmeClient.getCertificate(finalized);

        console.log(`Successfully issued short-lived certificate for ${domain} (${options.attemptId})`);

        return {
            key: key.toString(),
            cert,
            expiry: (new Date(ACME.crypto.readCertificateInfo(cert).notAfter)).valueOf()
        };
    }
}