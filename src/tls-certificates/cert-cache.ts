import * as crypto from 'node:crypto';

export interface CachedCertificate {
    cacheKey: string;
    domain: string;
    key: string;
    cert: string;
    expiry: number;
}

export interface CertStoreBackend {
    readAll(): Promise<CachedCertificate[]>;
    read(cacheKey: string): Promise<CachedCertificate | undefined>;
    write(cert: CachedCertificate): Promise<void>;
    /** Store only if absent. Returns true if written, false if it already existed. */
    writeIfAbsent(cert: CachedCertificate): Promise<boolean>;
    delete(cacheKey: string): Promise<void>;
}

export function certObjectId(cacheKey: string): string {
    return crypto.hash('sha256', cacheKey, 'hex').slice(0, 16);
}

export function parseStoredCertificate(raw: string): CachedCertificate {
    const data = JSON.parse(raw) as CachedCertificate;
    if (!data.cacheKey) throw new Error('No cacheKey in cert');
    if (!data.domain) throw new Error('No domain in cert');
    if (!data.key) throw new Error('No key in cert');
    if (!data.cert) throw new Error('No cert in cert');
    if (!data.expiry) throw new Error('No expiry in cert');
    return data;
}

/**
 * An in-memory cache of issued certificates, warmed at startup and kept durable via a
 * pluggable backend. getCert stays synchronous (the hot path); fetchCert additionally
 * consults the (possibly shared) backend on a miss.
 */
export class PersistentCertCache {

    constructor(private backend: CertStoreBackend) {}

    cache: { [cacheKey: string]: CachedCertificate | undefined } = {};

    async loadCache() {
        let certs: CachedCertificate[];
        try {
            certs = await this.backend.readAll();
        } catch (e) {
            // A store outage at startup shouldn't block boot - start cold and recover later.
            console.error('Failed to load cert cache from store; starting with an empty cache:', e);
            return;
        }

        console.log(`Starting up with ${certs.length} certificates cached`);
        for (const cert of certs) {
            console.log(`Loaded cached cert for ${cert.cacheKey}`);
            this.cache[cert.cacheKey] = cert;
        }
    }

    cacheCert(cert: CachedCertificate): CachedCertificate | undefined {
        this.cache[cert.cacheKey] = cert;

        this.backend.write(cert).catch((e) =>
            console.warn(`Failed to persist certificate ${cert.cacheKey} to store:`, e)
        );

        console.log(`Cached cert for ${cert.cacheKey}, hash:${crypto.hash('sha256', cert.cert)}`);
        return this.cache[cert.cacheKey];
    }

    clearCache(cacheKey: string) {
        delete this.cache[cacheKey];
        this.backend.delete(cacheKey).catch((e) =>
            console.warn(`Failed to delete cached cert for ${cacheKey}:`, e)
        );
    }

    getCert(cacheKey: string): CachedCertificate | undefined {
        const cert = this.cache[cacheKey];
        console.log(cert ? `Found cached cert for ${cacheKey}` : `No cert available for ${cacheKey}`);
        return cert;
    }

    /**
     * Like getCert, but on a local miss it consults the shared backend (so a cert issued
     * by another server is picked up without a restart), caching any hit locally.
     */
    async fetchCert(cacheKey: string): Promise<CachedCertificate | undefined> {
        if (this.cache[cacheKey]) return this.cache[cacheKey];

        const stored = await this.backend.read(cacheKey);
        if (stored) {
            console.log(`Fetched cert for ${cacheKey} from shared store`);
            this.cache[cacheKey] = stored;
        }
        return stored;
    }

}
