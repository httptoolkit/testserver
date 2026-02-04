import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';

interface CachedCertificate {
    cacheKey: string;
    domain: string;
    key: string;
    cert: string;
    expiry: number;
}

export class PersistentCertCache {

    constructor(
        private certCacheDir: string
    ) {}

    cache: { [cacheKey: string]: CachedCertificate | undefined } = {};

    async loadCache() {
        const certFiles = await fs.readdir(this.certCacheDir)
            .catch(async (err): Promise<string[]> => {
                if (err.code === 'ENOENT') {
                    await fs.mkdir(this.certCacheDir);
                    return [];
                } else {
                    throw err;
                }
            });

        console.log(`Starting up with ${certFiles.length} certificates cached: ${
            certFiles.map(f => `'${f}'`).join(', ')
        }`);

        await Promise.all(certFiles.map(async (certName) => {
            if (!certName.endsWith('.cert.json')) {
                // Linux volumes often have a root lost+found directory, we can just
                // ignore that.
                if (certName !== 'lost+found') {
                    console.log(`Unexpected file in cert dir: ${certName}`);
                }

                return;
            }

            const certPath = path.join(this.certCacheDir, certName);

            try {
                const data = JSON.parse(
                    (await fs.readFile(certPath)).toString('utf8')
                ) as CachedCertificate;

                if (!data.domain) throw new Error('No domain in cert');
                if (!data.key) throw new Error('No key in cert file');
                if (!data.cert) throw new Error('No cert in cert file');
                if (!data.expiry) throw new Error('No expiry in cert file');

                // Older cached certs don't explicitly include the key (but they only
                // support the domain as the key anyway, so that's OK).
                const cacheKey = data.cacheKey || data.domain;

                console.log(`Loaded cached cert for ${cacheKey}`);

                this.cache[cacheKey] = data;
            } catch (e) {
                console.log(`Could not load cert from ${certName}:`, e);
            }
        }));
    }

    cacheCert(cert: CachedCertificate): CachedCertificate | undefined {
        this.cache[cert.cacheKey] = cert;

        fs.writeFile(
            path.join(this.certCacheDir, `${cert.cacheKey}.cert.json`),
            JSON.stringify(cert)
        ).catch((e) => {
            console.warn(`Failed to cache to disk certificate data for ${cert.cacheKey}`);
        });

        console.log(`Cached cert for ${cert.cacheKey}, hash:${crypto.hash('sha256', cert.cert)}`);
        return this.cache[cert.cacheKey];
    }

    clearCache(cacheKey: string) {
        delete this.cache[cacheKey];
    }

    getCert(cacheKey: string): CachedCertificate | undefined {
        const cert = this.cache[cacheKey];

        console.log(cert
            ? `Found cached cert for ${cacheKey}`
            : `No cert available for ${cacheKey}`
        );

        return cert;
    }

}