import * as tls from 'tls';

interface CacheEntry {
    context: tls.SecureContext;
    expiry: number;
}

const DEFAULT_MAX_SIZE = 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

export class SecureContextCache {
    private cache = new Map<string, CacheEntry>();

    constructor(private maxSize: number = DEFAULT_MAX_SIZE) {}

    async getOrCreate(
        key: string,
        factory: () => Promise<{ context: tls.SecureContext; expiry: number }>
    ): Promise<tls.SecureContext> {
        const cached = this.cache.get(key);
        const now = Date.now();

        if (cached && cached.expiry > now) {
            // Move to end for LRU
            this.cache.delete(key);
            this.cache.set(key, cached);
            return cached.context;
        }

        // Remove expired entry if present
        if (cached) {
            this.cache.delete(key);
        }

        // Create new context
        const { context, expiry } = await factory();

        // Cap at 1 day, but don't exceed cert's actual expiry (unless already expired)
        const maxExpiry = expiry <= now
            ? now + ONE_DAY                     // Already expired: cache for 1 day anyway
            : Math.min(expiry, now + ONE_DAY); // Non-expired: don't exceed cert expiry

        // Evict oldest entries if full
        while (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) this.cache.delete(oldestKey);
        }

        this.cache.set(key, { context, expiry: maxExpiry });
        return context;
    }

    get size(): number {
        return this.cache.size;
    }
}
