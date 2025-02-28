import * as path from 'path';
import * as fs from 'fs/promises';

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

        await Promise.all(certFiles.map(async (certPath) => {
            if (!certPath.endsWith('.cert.json')) {
                console.log(`Unexpected file in cert dir: ${certPath}`);
                return;
            }

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
                console.log(`Could not load cert from ${certPath}:`, e);
            }
        }));
    }

    cacheCert(cert: CachedCertificate): CachedCertificate | undefined {
        const { domain } = cert;
        fs.writeFile(
            path.join(this.certCacheDir, `${domain}.cert.json`),
            JSON.stringify(cert)
        ).catch((e) => {
            console.warn(`Failed to cache to disk certificate data for ${domain}`);
        })

        return this.cache[domain];
    }

    clearCache(domain: string) {
        delete this.cache[domain];
    }

    getCert(domain: string): CachedCertificate | undefined {
        return this.cache[domain];
    }

}