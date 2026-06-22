export interface CertOptions {
    requiredType?: 'acme' | 'local'; // Some options are ACME/local only

    expired?: boolean;
    revoked?: boolean;
    selfSigned?: boolean;

    overridePrefix?: string;
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