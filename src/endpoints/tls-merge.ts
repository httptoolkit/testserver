import * as tls from 'tls';
import * as crypto from 'node:crypto';

const VERSION_ORDER: tls.SecureVersion[] = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];

const VERSION_DISABLE_FLAGS: Record<tls.SecureVersion, number> = {
    'TLSv1': crypto.constants.SSL_OP_NO_TLSv1,
    'TLSv1.1': crypto.constants.SSL_OP_NO_TLSv1_1,
    'TLSv1.2': crypto.constants.SSL_OP_NO_TLSv1_2,
    'TLSv1.3': crypto.constants.SSL_OP_NO_TLSv1_3
};

// Fields that combine across SNI parts rather than being mutually exclusive. Anything not
// listed here is exclusive: two parts setting it to different values is a conflict.
// enabledVersions accumulates; securityLevel takes the lowest (most permissive) value, so
// several weak-crypto endpoints that each need a lowered level can be combined. (Cert and TLS
// field names don't overlap, so one table serves both merges.) secureOptions/minVersion and the
// final ciphers @SECLEVEL suffix are derived afterwards, so they never go through the merge.
const FIELD_COMBINERS: Record<string, (existing: unknown, incoming: unknown) => unknown> = {
    enabledVersions: (a, b) => [...(a as string[]), ...(b as string[])],
    securityLevel: (a, b) => Math.min(a as number, b as number)
};

/**
 * Merge one endpoint's declared options into an accumulator, field by field. A combinable
 * field accumulates; any other field already set to a different value is a conflict.
 */
export function mergeContribution(
    acc: Record<string, unknown>,
    contribution: object | undefined
): void {
    if (!contribution) return;

    for (const [key, value] of Object.entries(contribution as Record<string, unknown>)) {
        if (value === undefined) continue;

        const combine = FIELD_COMBINERS[key];
        if (acc[key] === undefined) {
            acc[key] = value;
        } else if (combine) {
            acc[key] = combine(acc[key], value);
        } else if (acc[key] !== value) {
            throw new Error(
                `Conflicting endpoint options: '${key}' is set to both ` +
                `${JSON.stringify(acc[key])} and ${JSON.stringify(value)}`
            );
        }
    }
}

/**
 * Translate the accumulated `enabledVersions` list into the OpenSSL options that enforce it:
 * disable every non-enabled version, set the lowest as minVersion, and drop the cipher
 * security level for legacy versions (which OpenSSL filters out by default).
 */
export function resolveEnabledVersions(tlsOptions: Record<string, unknown>): void {
    const enabled = tlsOptions.enabledVersions as tls.SecureVersion[] | undefined;
    if (!enabled) return;
    delete tlsOptions.enabledVersions;

    let secureOptions = (tlsOptions.secureOptions as number | undefined) ?? 0;
    for (const version of VERSION_ORDER) {
        if (!enabled.includes(version)) secureOptions |= VERSION_DISABLE_FLAGS[version];
    }
    tlsOptions.secureOptions = secureOptions;

    const lowest = VERSION_ORDER.find((v) => enabled.includes(v));
    if (lowest) tlsOptions.minVersion = lowest;

    if (lowest === 'TLSv1' || lowest === 'TLSv1.1') {
        tlsOptions.securityLevel = Math.min((tlsOptions.securityLevel as number | undefined) ?? Infinity, 0);
    }
}

/**
 * Fold the merged security level into the `ciphers` string as OpenSSL's @SECLEVEL suffix (the
 * only way to set it via createSecureContext), then remove the marker field. Runs after
 * resolveEnabledVersions, which may itself request a level for legacy TLS versions.
 */
export function resolveSecurityLevel(tlsOptions: Record<string, unknown>): void {
    const level = tlsOptions.securityLevel as number | undefined;
    if (level === undefined) return;
    delete tlsOptions.securityLevel;

    const base = ((tlsOptions.ciphers as string | undefined) ?? 'DEFAULT').replace(/@SECLEVEL=\d+/g, '');
    tlsOptions.ciphers = `${base}@SECLEVEL=${level}`;
}
