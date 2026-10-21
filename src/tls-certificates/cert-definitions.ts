import type { ExternalIntermediateName } from './external-intermediates.js';

// Who issues the leaf: itself, our local (untrusted) CA, or a real external intermediate.
export type CertIssuer = 'self' | 'local' | ExternalIntermediateName;

export interface CertOptions {
    requiredType?: 'acme' | 'local'; // Some options are ACME/local only

    expired?: boolean;
    revoked?: boolean;

    // Unset => the default CA: our public ACME CA where configured, or the local CA if not.
    // Exclusive, so endpoints that each pick a different issuer conflict automatically.
    issuer?: CertIssuer;

    overridePrefix?: string;

    noCommonName?: boolean;

    // RSA key size (bits) for the leaf, for the rsaXXXX key-size endpoints. Omitted => default shared key.
    keyBits?: number;

    // Sign the leaf with SHA-1
    sha1Signature?: boolean;

    // This is a presentation difference only - cert is the same, we just don't
    // send the full chain with it.
    incompleteChain?: boolean;
}

export function calculateCertCacheKey(domain: string, options: CertOptions) {
    const parts: string[] = ([
        'expired',
        'revoked',
        'noCommonName',
        'sha1Signature',
    ] as const).filter((k) => options[k]);

    if (options.overridePrefix) {
        parts.push(`override=${options.overridePrefix}`);
    }
    if (options.keyBits) {
        parts.push(`keyBits=${options.keyBits}`);
    }
    if (options.issuer) {
        parts.push(`issuer=${options.issuer}`);
    }

    return `${domain}+${parts.join('+')}`;
}

const CERT_PEM_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

export function extractLeafCertificate(certChainPem: string): string {
    const leaf = certChainPem.match(CERT_PEM_PATTERN)?.[0];
    if (!leaf) throw new Error('Could not find any certificate in chain PEM');
    return leaf + '\n';
}
