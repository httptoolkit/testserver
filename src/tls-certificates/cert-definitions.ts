export interface CertOptions {
    requiredType?: 'acme' | 'local'; // Some options are ACME/local only

    expired?: boolean;
    revoked?: boolean;
    selfSigned?: boolean;

    overridePrefix?: string;
}

export function calculateCertCacheKey(domain: string, options: CertOptions) {
    return `${domain}+${
        ([
            'expired',
            'revoked',
            'selfSigned',
        ] as const)
        .filter((k: keyof CertOptions) => options[k])
        .join('+')
    }`;
}