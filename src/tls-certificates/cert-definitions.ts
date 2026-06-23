export interface CertOptions {
    requiredType?: 'acme' | 'local'; // Some options are ACME/local only

    expired?: boolean;
    revoked?: boolean;
    selfSigned?: boolean;

    overridePrefix?: string;

    // This is a presentation difference only - cert is the same, we just don't
    // send the full chain with it.
    incompleteChain?: boolean;
}

export function calculateCertCacheKey(domain: string, options: CertOptions) {
    const parts: string[] = ([
        'expired',
        'revoked',
        'selfSigned',
    ] as const).filter((k) => options[k]);

    if (options.overridePrefix) {
        parts.push(`override=${options.overridePrefix}`);
    }

    return `${domain}+${parts.join('+')}`;
}

const CERT_PEM_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

export function extractLeafCertificate(certChainPem: string): string {
    const leaf = certChainPem.match(CERT_PEM_PATTERN)?.[0];
    if (!leaf) throw new Error('Could not find any certificate in chain PEM');
    return leaf + '\n';
}
