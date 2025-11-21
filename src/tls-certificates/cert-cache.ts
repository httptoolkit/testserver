import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';

interface CachedCertificate {
    domain: string;
    key: string;
    cert: string;
    expiry: number;
}

export class PersistentCertCache {

    constructor(
        private certCacheDir: string
    ) {}

    cache: { [domain: string]: CachedCertificate | undefined } = {};

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

                console.log(`Loaded cached cert for ${data.domain}`);

                this.cache[data.domain] = data;
            } catch (e) {
                console.log(`Could not load cert from ${certName}:`, e);
            }
        }));
    }

    cacheCert(cert: CachedCertificate): CachedCertificate | undefined {
        const { domain } = cert;

        this.cache[domain] = cert;

        fs.writeFile(
            path.join(this.certCacheDir, `${domain}.cert.json`),
            JSON.stringify(cert)
        ).catch((e) => {
            console.warn(`Failed to cache to disk certificate data for ${domain}`);
        });

        console.log(`Cached cert for ${domain}, hash:${crypto.hash('sha256', cert.cert)}`);
        return this.cache[domain];
    }

    clearCache(domain: string) {
        delete this.cache[domain];
    }

    getCert(domain: string): CachedCertificate | undefined {
        const cert = this.cache[domain];

        console.log(cert
            ? `Found cached cert for ${domain}`
            : `No cert available for ${domain}`
        );

        return cert;
    }

}