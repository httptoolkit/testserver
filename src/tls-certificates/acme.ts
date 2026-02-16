import * as crypto from 'node:crypto';
import * as ACME from 'acme-client';

import { PersistentCertCache } from './cert-cache.js';
import { CertOptions, calculateCertCacheKey } from './cert-definitions.js';
import { DnsServer } from '../dns-server.js';

const ONE_DAY = 1000 * 60 * 60 * 24;
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
        accountKey: string,
        private dnsServer?: DnsServer
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

        const shortLived = certOptions.expired && this.acmeProvider === 'google';

        const refreshPromise = Object.assign(this.requestCertificate(domain, { attemptId, shortLived })
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

    /**
     * Request a certificate from ACME. Handles all combinations:
     * - Normal or wildcard (*.domain) via HTTP-01 or DNS-01 challenges
     * - Normal or short-lived validity (1-day, for Google Trust Services `expired` mode)
     */
    private async requestCertificate(
        domain: string,
        options: { attemptId: string, shortLived?: boolean }
    ): Promise<AcmeGeneratedCertificate> {
        const { attemptId, shortLived } = options;
        const isWildcard = domain.startsWith('*.') && !!this.dnsServer;
        const rootDomain = isWildcard ? domain.slice(2) : domain;
        const contactEmail = `contact@${rootDomain}`;
        const label = `${shortLived ? 'short-lived ' : ''}${isWildcard ? 'wildcard ' : ''}`;

        console.log(`Requesting ${label}certificate for ${domain} (${attemptId})`);

        const [key, csr] = await ACME.crypto.createCsr(isWildcard
            ? { commonName: rootDomain, altNames: [domain, rootDomain] }
            : { commonName: domain }
        );

        let cert: string;

        if (shortLived) {
            // Short-lived: use lower-level API to set custom notBefore/notAfter
            await this.acmeClient.createAccount({
                termsOfServiceAgreed: true,
                contact: [`mailto:${contactEmail}`]
            });

            const notBefore = new Date();
            const notAfter = new Date(Date.now() + ONE_DAY);
            console.log(`Creating order with validity: ${notBefore.toISOString()} to ${notAfter.toISOString()} (${attemptId})`);

            const identifiers = isWildcard
                ? [{ type: 'dns' as const, value: domain }, { type: 'dns' as const, value: rootDomain }]
                : [{ type: 'dns' as const, value: domain }];

            const order = await this.acmeClient.createOrder({
                identifiers,
                notBefore: notBefore.toISOString(),
                notAfter: notAfter.toISOString()
            });

            const authorizations = await this.acmeClient.getAuthorizations(order);
            console.log(`Got ${authorizations.length} authorizations for ${domain} (${attemptId})`);

            for (const authz of authorizations) {
                if (authz.status === 'valid') {
                    console.log(`Authorization already valid for ${authz.identifier.value} (${attemptId})`);
                    continue;
                }

                if (isWildcard) {
                    const challenge = authz.challenges.find(c => c.type === 'dns-01');
                    if (!challenge) throw new Error(`No dns-01 challenge found for ${authz.identifier.value} (${attemptId})`);

                    const keyAuthorization = await this.acmeClient.getChallengeKeyAuthorization(challenge);
                    const fqdn = `_acme-challenge.${authz.identifier.value}`;

                    console.log(`Completing dns-01 challenge for ${authz.identifier.value} (${attemptId})`);
                    this.dnsServer!.setTxtRecord(fqdn, keyAuthorization);
                    await this.acmeClient.completeChallenge(challenge);
                    await this.acmeClient.waitForValidStatus(challenge);
                    this.dnsServer!.removeTxtRecord(fqdn, keyAuthorization);
                } else {
                    const challenge = authz.challenges.find(c => c.type === 'http-01');
                    if (!challenge) throw new Error(`No http-01 challenge found for ${authz.identifier.value} (${attemptId})`);

                    console.log(`Completing http-01 challenge for ${authz.identifier.value} (${attemptId})`);
                    await this.acmeClient.completeChallenge(challenge);
                    await this.acmeClient.waitForValidStatus(challenge);
                }
            }

            console.log(`Finalizing order for ${domain} (${attemptId})`);
            const finalized = await this.acmeClient.finalizeOrder(order, csr);
            cert = await this.acmeClient.getCertificate(finalized);
        } else {
            // Normal validity: use auto() which handles the full ACME flow
            cert = await this.acmeClient.auto({
                csr,
                challengePriority: [isWildcard ? 'dns-01' : 'http-01'],
                termsOfServiceAgreed: true,
                email: contactEmail,
                skipChallengeVerification: true,
                challengeCreateFn: isWildcard
                    ? async (_authz, _challenge, keyAuthorization) => {
                        this.dnsServer!.setTxtRecord(`_acme-challenge.${rootDomain}`, keyAuthorization);
                    }
                    : async () => {
                        // HTTP-01 challenge responses are stateless - getChallengeResponse()
                        // computes the key authorization directly from the token
                    },
                challengeRemoveFn: isWildcard
                    ? async (_authz, _challenge, keyAuthorization) => {
                        this.dnsServer!.removeTxtRecord(`_acme-challenge.${rootDomain}`, keyAuthorization);
                    }
                    : async () => {}
            });
        }

        console.log(`Successfully issued ${label}certificate for ${domain} (${attemptId})`);

        return {
            key: key.toString(),
            cert,
            expiry: (new Date(ACME.crypto.readCertificateInfo(cert).notAfter)).valueOf()
        };
    }
}