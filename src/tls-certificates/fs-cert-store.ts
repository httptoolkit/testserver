import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import {
    CertStoreBackend,
    CachedCertificate,
    certObjectId,
    parseStoredCertificate
} from './cert-cache.js';

const errno = (e: unknown) => (e as NodeJS.ErrnoException).code;

export class FilesystemCertStore implements CertStoreBackend {

    constructor(private dir: string) {}

    private filePath(cacheKey: string): string {
        return path.join(this.dir, `${certObjectId(cacheKey)}.cert.json`);
    }

    async readAll(): Promise<CachedCertificate[]> {
        const names = await fs.readdir(this.dir).catch(async (e): Promise<string[]> => {
            if (errno(e) === 'ENOENT') {
                await fs.mkdir(this.dir, { recursive: true });
                return [];
            }
            throw e;
        });

        const certs = await Promise.all(names.map(async (name): Promise<CachedCertificate | undefined> => {
            if (!name.endsWith('.cert.json')) {
                // Linux volumes often have a root lost+found directory; ignore it.
                if (name !== 'lost+found') console.log(`Unexpected file in cert dir: ${name}`);
                return undefined;
            }

            try {
                return parseStoredCertificate((await fs.readFile(path.join(this.dir, name))).toString('utf8'));
            } catch (e) {
                console.log(`Could not load cert from ${name}:`, e);
                return undefined;
            }
        }));

        return certs.filter((c): c is CachedCertificate => !!c);
    }

    async read(cacheKey: string): Promise<CachedCertificate | undefined> {
        try {
            return parseStoredCertificate((await fs.readFile(this.filePath(cacheKey))).toString('utf8'));
        } catch (e) {
            if (errno(e) === 'ENOENT') return undefined;
            throw e;
        }
    }

    async write(cert: CachedCertificate): Promise<void> {
        await this.put(cert, false);
    }

    writeIfAbsent(cert: CachedCertificate): Promise<boolean> {
        return this.put(cert, true);
    }

    private async put(cert: CachedCertificate, onlyIfAbsent: boolean): Promise<boolean> {
        await fs.mkdir(this.dir, { recursive: true });
        try {
            // 'wx' fails atomically if the file already exists.
            await fs.writeFile(
                this.filePath(cert.cacheKey),
                JSON.stringify(cert),
                onlyIfAbsent ? { flag: 'wx' } : {}
            );
            return true;
        } catch (e) {
            if (onlyIfAbsent && errno(e) === 'EEXIST') return false;
            throw e;
        }
    }

    async delete(cacheKey: string): Promise<void> {
        await fs.unlink(this.filePath(cacheKey)).catch((e) => {
            if (errno(e) !== 'ENOENT') throw e;
        });
    }
}
