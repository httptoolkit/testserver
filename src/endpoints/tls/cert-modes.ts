import { TlsEndpoint } from '../tls-index.js';

export const expired: TlsEndpoint = {
    sniPart: 'expired',
    configureCertOptions() {
        return {
            expired: true
        };
    }
};

export const revoked: TlsEndpoint = {
    sniPart: 'revoked',
    configureCertOptions() {
        return {
            revoked: true
        };
    }
};

export const selfSigned: TlsEndpoint = {
    sniPart: 'self-signed',
    configureCertOptions() {
        return {
            requiredType: 'local',
            selfSigned: true
        };
    }
};

export const untrustedRoot: TlsEndpoint = {
    sniPart: 'untrusted-root',
    configureCertOptions() {
        return {
            requiredType: 'local'
        };
    }
};

export const wrongHost: TlsEndpoint = {
    sniPart: 'wrong-host',
    configureCertOptions() {
        return {
            overridePrefix: 'example'
        };
    }
};