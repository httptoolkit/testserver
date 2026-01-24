import * as crypto from 'node:crypto';
import * as ACME from 'acme-client';
import { MaybePromise } from '@httptoolkit/util';

import { PersistentCertCache } from './cert-cache.js';

const ONE_MINUTE = 1000 * 60;
const ONE_DAY = ONE_MINUTE * 60 * 24;
const ONE_WEEK = ONE_DAY * 7;

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

    private pendingAcmeChallenges: { [token: string]: string | undefined } = {}
    private pendingCertRenewals: { [domain: string]: (Promise<AcmeGeneratedCertificate> & { id: string }) | undefined } = {};

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

    // Returns an ACME cert that has been revoked. Issues once, revokes, never renews.
    // Returns undefined if no revoked ACME cert is available yet (caller should use LocalCA fallback).
    tryGetRevokedCertificateSync(domain: string) {
        const cacheKey = `${domain}:revoked`;
        const cachedCert = this.certCache.getCert(cacheKey);

        if (cachedCert) {
            console.log(`Found cached revoked cert for ${domain}`);
            return cachedCert;
        }

        // No cached cert - issue and revoke one in the background
        const attemptId = Math.random().toString(16).slice(2);
        console.log(`No revoked cert cached for ${domain}, issuing and revoking new one (${attemptId})`);
        this.issueRevokedCertificate(domain, cacheKey, attemptId);

        return undefined;
    }

    private async issueRevokedCertificate(domain: string, cacheKey: string, attemptId: string) {
        if (this.pendingCertRenewals[cacheKey]) {
            console.log(`Revoked cert already being issued for ${domain} (${attemptId})`);
            return;
        }

        const refreshPromise = Object.assign(
            this.requestAndRevokeCertificate(domain, { attemptId }).then((certData) => {
                delete this.pendingCertRenewals[cacheKey];
                this.certCache.cacheCert({ ...certData, domain: cacheKey });
                console.log(`Revoked cert issued and cached for ${domain} (${attemptId})`);
                return certData;
            }).catch((e) => {
                delete this.pendingCertRenewals[cacheKey];
                console.log(`Revoked cert generation failed for ${domain} (${attemptId}):`, e.message);
                throw e;
            }),
            { id: attemptId }
        );

        this.pendingCertRenewals[cacheKey] = refreshPromise;
    }

    private async requestAndRevokeCertificate(domain: string, options: { attemptId: string }): Promise<AcmeGeneratedCertificate> {
        console.log(`Requesting certificate to revoke for ${domain} (${options.attemptId})`);

        const certData = await this.requestNewCertificate(domain, options);

        console.log(`Revoking certificate for ${domain} (${options.attemptId})`);
        await this.acmeClient.revokeCertificate(certData.cert);
        console.log(`Certificate revoked for ${domain} (${options.attemptId})`);

        return certData;
    }

    // Returns an ACME cert only if it has actually expired. Issues once, never renews.
    // Returns undefined if no expired ACME cert is available (caller should use LocalCA fallback).
    tryGetExpiredCertificateSync(domain: string) {
        const cacheKey = `${domain}:expired`;
        const cachedCert = this.certCache.getCert(cacheKey);

        if (cachedCert) {
            const isExpired = cachedCert.expiry <= Date.now();
            console.log(`Found cached expired-mode cert for ${domain} (expiry: ${new Date(cachedCert.expiry).toISOString()}, actually expired: ${isExpired})`);

            if (isExpired) {
                return cachedCert;
            }
            // Not yet expired - caller should use LocalCA fallback
            return undefined;
        }

        // No cached cert - issue one in the background (will be expired eventually)
        const attemptId = Math.random().toString(16).slice(2);
        console.log(`No expired-mode cert cached for ${domain}, issuing new one (${attemptId})`);
        this.issueExpiredModeCertificate(domain, cacheKey, attemptId);

        return undefined;
    }

    private async issueExpiredModeCertificate(domain: string, cacheKey: string, attemptId: string) {
        if (this.pendingCertRenewals[cacheKey]) {
            console.log(`Expired-mode cert already being issued for ${domain} (${attemptId})`);
            return;
        }

        const refreshPromise = Object.assign(
            this.requestNewCertificate(domain, { attemptId }).then((certData) => {
                delete this.pendingCertRenewals[cacheKey];
                this.certCache.cacheCert({ ...certData, domain: cacheKey });
                console.log(`Expired-mode cert issued for ${domain} (${attemptId}), will expire: ${new Date(certData.expiry).toISOString()}`);
                return certData;
            }).catch((e) => {
                delete this.pendingCertRenewals[cacheKey];
                console.log(`Expired-mode cert generation failed for ${domain} (${attemptId}):`, e.message);
                throw e;
            }),
            { id: attemptId }
        );

        this.pendingCertRenewals[cacheKey] = refreshPromise;
    }

    private async getCertificate(
        domain: string,
        options: { forceRegenerate?: boolean, attemptId: string }
    ): Promise<AcmeGeneratedCertificate> {
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
                cachedCert.expiry - Date.now() < ONE_WEEK // Expires soon
            ) {
                if (!this.pendingCertRenewals[domain]) {
                    // Not yet expired, but expiring soon - we want to refresh this certificate, but
                    // we're OK to do it async and keep using the current one for now.
                    console.log(`Renewing near-expiry certificate for ${domain} (${options.attemptId})`);

                    // Trigger update in the background, catch any errors. This will add itself to pendingCertRenewals
                    // so no need to update that separately.
                    this.getCertificate(domain, { forceRegenerate: true, attemptId: options.attemptId }).catch((e) => {
                        console.log(`Background <1 week refresh failed with ${e.message}`);
                    });
                } else {
                    console.log(`Certificate refresh already pending for ${domain} (${options.attemptId}) from attempt ${
                        this.pendingCertRenewals[domain]!.id
                    }`);
                }
            } else {
                console.log(`Cached cert still valid for ${domain} (${options.attemptId})`);
            }

            return cachedCert;
        }

        if (!cachedCert) console.log(`No cached cert for ${domain} (${options.attemptId})`);
        else if (options.forceRegenerate) console.log(`Force regenerating cert for ${domain} (${options.attemptId})`);

        if (this.pendingCertRenewals[domain] && !options.forceRegenerate) {
            console.log(`Certificate generation already pending for ${domain} (${options.attemptId}) from attempt ${
                this.pendingCertRenewals[domain]!.id
            }`);

            // Coalesce updates for pending certs into one
            return this.pendingCertRenewals[domain]!;
        }

        const refreshPromise = Object.assign(this.requestNewCertificate(domain, {
            attemptId: options.attemptId
        }).then((certData): MaybePromise<AcmeGeneratedCertificate> => {
            if (
                this.pendingCertRenewals[domain] &&
                this.pendingCertRenewals[domain] !== refreshPromise
            ) {
                console.log(`Certificate generation for ${domain} (${options.attemptId}) superseded by another attempt ${
                    this.pendingCertRenewals[domain]!.id
                }`);

                // Don't think this should happen, but if we're somehow ever not the current cert
                // update, delegate to the 'real' cert update instead.
                return this.pendingCertRenewals[domain]!;
            }

            delete this.pendingCertRenewals[domain];
            this.certCache.cacheCert({ ...certData, domain });
            console.log(`Cert generation completed for domain ${domain} (${options.attemptId}), hash:${crypto.hash('sha256', certData.cert)}`);
            return certData;
        }).catch((e) => {
            console.log(`Cert generation failed (${options.attemptId})`, e);
            return this.getCertificate(domain, { forceRegenerate: true, attemptId: options.attemptId });
        }), { id: options.attemptId });

        this.pendingCertRenewals[domain] = refreshPromise;
        console.log(`Started cert generation for domain ${domain} (${options.attemptId})`);
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