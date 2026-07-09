import { TlsEndpoint } from '../tls-index.js';
import { tlsCiphers } from '../groups.js';

// Each of these offers only a specific weak/legacy cipher, capped at TLS 1.2. The cap matters:
// none of these ciphers (static RSA, CBC, NULL, weak DH) exist in TLS 1.3, which only has AEAD
// suites with ephemeral key exchange. `securityLevel: 0` drops OpenSSL's security level (folded
// into the ciphers @SECLEVEL suffix on merge) so the weak suites can be used. A client only
// connects if it's willing to negotiate the weak cipher.

// Pre-generated weak DH groups for the Logjam-style weak-DH tests, since generating one per
// process is slow. They're intentionally weak - nothing to protect. (Node refuses to load DH
// params below 1024 bits, so 1024 is as low as this can go.)
const DH_1024_PARAMS = `-----BEGIN DH PARAMETERS-----
MIGHAoGBAPwIcVZU2Dt7WtCI8hhI8wECGgMidZpXASdKXwAQReA+739EGI4HUmM4
qkm2vyhAReLHc4UALQI8SKV5G7WDHKIAZi0sDofR3qitV2Z44aVk0u4Z3M8S1NA9
aSgcv6Iz0BQPADQkEq28bRT0i3/A+K6DuHbC98RtnhqF+OuaHXJ/AgEC
-----END DH PARAMETERS-----`;

const DH_2048_PARAMS = `-----BEGIN DH PARAMETERS-----
MIIBCAKCAQEAhEM9PY7cnvVzkOwE37JFRQCwoEa3sXoxbvLy5sHkPPwpu8/jM4wZ
C0v7T1EOf6Kk94NZDAnghUC8t0PGV9Dfel/QOG7F/fBiiGyqyMHg99+aLxsbY5i3
Y6eIwZj7JeuEIgrIS2NQ67Pn8tPEr7yDZHscJruyY+97K56h3h16Oyjgp8YLeglJ
iMLZxVVqLNY0bI9is9Prhf9+QRgepuGK3eBaSybJYpdXv3ztWF5l8wgy+GxkZJB9
aI/FRfUQi5FLOLv7p8v2LOvHVsoZZoMZh4DcH7BbNfyf2SYbz/tPcSDm2sZd57WK
oBMuASJHcaqiTS7Al86HkBdup48Xe4jGjwIBAg==
-----END DH PARAMETERS-----`;

export const staticRsa: TlsEndpoint = {
    sniPart: 'static-rsa',
    configureTlsOptions() {
        return {
            ciphers: 'AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA',
            securityLevel: 0,
            maxVersion: 'TLSv1.2'
        };
    },
    meta: {
        path: 'static-rsa',
        description: 'Uses RSA key exchange only, so the connection has no forward secrecy.',
        examples: ['https://static-rsa.testserver.host/'],
        group: tlsCiphers
    }
};

export const cbc: TlsEndpoint = {
    sniPart: 'cbc',
    configureTlsOptions() {
        return {
            ciphers: 'ECDHE-RSA-AES128-SHA:AES128-SHA',
            securityLevel: 0,
            maxVersion: 'TLSv1.2'
        };
    },
    meta: {
        path: 'cbc',
        description: 'Uses a CBC-mode cipher suite.',
        examples: ['https://cbc.testserver.host/'],
        group: tlsCiphers
    }
};

export const nullCipher: TlsEndpoint = {
    sniPart: 'null-cipher',
    configureTlsOptions() {
        return {
            ciphers: 'NULL-SHA:NULL-SHA256',
            securityLevel: 0,
            maxVersion: 'TLSv1.2'
        };
    },
    meta: {
        path: 'null-cipher',
        description: 'Uses a NULL cipher: the handshake is authenticated but application data is unencrypted.',
        examples: ['https://null-cipher.testserver.host/'],
        group: tlsCiphers
    }
};

export const dh1024: TlsEndpoint = {
    sniPart: 'dh1024',
    configureTlsOptions() {
        return {
            ciphers: 'DHE-RSA-AES128-SHA:DHE-RSA-AES256-SHA',
            securityLevel: 0,
            maxVersion: 'TLSv1.2',
            dhparam: DH_1024_PARAMS
        };
    },
    meta: {
        path: 'dh1024',
        description: 'Uses ephemeral Diffie-Hellman key exchange with a weak 1024-bit group.',
        examples: ['https://dh1024.testserver.host/'],
        group: tlsCiphers
    }
};

export const dh2048: TlsEndpoint = {
    sniPart: 'dh2048',
    configureTlsOptions() {
        return {
            ciphers: 'DHE-RSA-AES128-SHA:DHE-RSA-AES256-SHA',
            securityLevel: 0,
            maxVersion: 'TLSv1.2',
            dhparam: DH_2048_PARAMS
        };
    },
    meta: {
        path: 'dh2048',
        description: 'Uses ephemeral Diffie-Hellman key exchange with a 2048-bit group.',
        examples: ['https://dh2048.testserver.host/'],
        group: tlsCiphers
    }
};
