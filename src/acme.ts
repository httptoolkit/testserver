import * as path from 'path';
import * as fs from 'fs/promises';

import * as ACME from 'acme-client';

const ONE_MINUTE = 1000 * 60;
const ONE_DAY = ONE_MINUTE * 60 * 24;
const ONE_WEEK = ONE_DAY * 7;

interface GeneratedCertificate {
    key: string;
    cert: string;
    expiry: number;
};

interface SerializedCertificate extends GeneratedCertificate {
    domain: string;
}

export async function buildAcmeCA(certCacheDir: string) {
    const certFiles = await fs.readdir(certCacheDir);

    const certs = (await Promise.all(certFiles.map(async (certPath) => {
        if (!certPath.endsWith('.cert.json')) {
            console.log(`Unexpected file in cert dir: ${certPath}`);
            return;
        }

        try {
            const data = JSON.parse(
                (await fs.readFile(certPath)).toString('utf8')
            ) as SerializedCertificate;

            if (!data.domain) throw new Error('No domain in cert');
            if (!data.key) throw new Error('No key in cert file');
            if (!data.cert) throw new Error('No cert in cert file');
            if (!data.expiry) throw new Error('No expiry in cert file');

            return [
                data.domain,
                { key: data.key, cert: data.cert, expiry: data.expiry }
            ];
        } catch (e) {
            console.log(`Could not load cert from ${certPath}:`, e);
        }
    }).filter(x => !!x))) as Array<[string, GeneratedCertificate]>;

    const certCache = Object.fromEntries(certs);

    return new AcmeCA(certCacheDir, certCache);
}

export class AcmeCA {

    constructor(
        private readonly certCacheDir: string,
        private certCache: { [domain: string]: GeneratedCertificate | undefined }
    ) {}

    private pendingAcmeChallenges: { [token: string]: string | undefined } = {}
    private pendingCertRenewals: { [domain: string]: Promise<GeneratedCertificate> | undefined } = {};

    private readonly acmeClient = ACME.crypto.createPrivateKey().then(
        (accountKey) => new ACME.Client({
            directoryUrl: ACME.directory.letsencrypt.staging,
            accountKey
        })
    );

    getChallengeResponse(token: string) {
        return this.pendingAcmeChallenges[token];
    }

    tryGetCertificateSync(domain: string) {
        const cachedCert = this.certCache[domain];

        if (!cachedCert || cachedCert.expiry - Date.now() < ONE_WEEK) {
            this.getCertificate(domain); // Trigger a cert refresh
        }

        return cachedCert;
    }

    private async getCertificate(
        domain: string,
        options: { forceRegenerate?: boolean } = {}
    ): Promise<GeneratedCertificate> {
        if (this.certCache[domain] && !options.forceRegenerate) {
            // If we have this cert in the cache, we generally want to use that.
            const cachedCert = this.certCache[domain]!;

            if (cachedCert.expiry <= Date.now() - ONE_MINUTE) {
                // Expired - clear this data and get a new certificate somehow
                console.log(`Renewing totally expired certificate for ${domain}`);
                delete this.certCache[domain];
                return this.getCertificate(domain);
            }

            if (
                cachedCert.expiry - Date.now() < ONE_WEEK && // Expires soon
                !this.pendingCertRenewals[domain] // Not already updating
            ) {
                // Not yet expired, but expiring soon - we want to refresh this certificate, but we're OK
                // to do it async and keep using the current one for now.
                console.log(`Renewing near-expiry certificate for ${domain}`);

                this.pendingCertRenewals[domain] = this.getCertificate(domain, { forceRegenerate: true });
            }

            return cachedCert;
        }

        if (this.pendingCertRenewals[domain] && !options.forceRegenerate) {
            // Coalesce updates for pending certs into one
            return this.pendingCertRenewals[domain]!;
        }

        const refreshPromise = this.requestNewCertificate(domain)
            .then((certData) => {
                if (
                    this.pendingCertRenewals[domain] &&
                    this.pendingCertRenewals[domain] !== refreshPromise
                ) {
                    // Don't think this should happen, but if we're somehow ever not the current cert update,
                    // delegate to the 'real' cert update instead.
                    return this.pendingCertRenewals[domain]!;
                }

                delete this.pendingCertRenewals[domain];
                this.certCache[domain] = certData;

                fs.writeFile(path.join(this.certCacheDir, `${domain}.json.pem`), JSON.stringify({
                    ...certData,
                    domain
                })).catch((e) => {
                    console.warn(`Failed to cache to disk certificate data for ${domain}`);
                })

                return certData;
            })
            .catch((e) => {
                return this.getCertificate(domain, { forceRegenerate: true });
            })

        this.pendingCertRenewals[domain] = refreshPromise

        return await refreshPromise;
    }

    private async requestNewCertificate(domain: string): Promise<GeneratedCertificate> {
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

                this.pendingAcmeChallenges[challenge.token] = keyAuth;
            },
            challengeRemoveFn: async (_authz, challenge) => {
                if (challenge.type !== 'http-01') {
                    throw new Error(`Unexpected ${challenge.type} challenge`);
                }

                this.pendingAcmeChallenges[challenge.token];
            }
        });

        return {
            key: key.toString(),
            cert,
            expiry: (new Date(ACME.crypto.readCertificateInfo(cert).notAfter)).valueOf()
        };
    }
}