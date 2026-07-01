import { TlsEndpoint } from '../tls-index.js';
import { tlsCiphers } from '../groups.js';

// Each of these offers only a specific weak/legacy cipher, capped at TLS 1.2. The cap matters:
// none of these ciphers (static RSA, CBC, NULL, weak DH) exist in TLS 1.3, which only has AEAD
// suites with ephemeral key exchange. `@SECLEVEL=0` drops OpenSSL's security-level so the weak
// suites can be used. A client only connects if it's willing to negotiate the weak cipher.

// A deliberately weak 1024-bit DH group for the Logjam-style weak-DH test, pre-generated
// because generating one per process is slow. It's intentionally weak - nothing to protect.
const WEAK_DH_PARAMS = `-----BEGIN DH PARAMETERS-----
MIGHAoGBAPwIcVZU2Dt7WtCI8hhI8wECGgMidZpXASdKXwAQReA+739EGI4HUmM4
qkm2vyhAReLHc4UALQI8SKV5G7WDHKIAZi0sDofR3qitV2Z44aVk0u4Z3M8S1NA9
aSgcv6Iz0BQPADQkEq28bRT0i3/A+K6DuHbC98RtnhqF+OuaHXJ/AgEC
-----END DH PARAMETERS-----`;

export const staticRsa: TlsEndpoint = {
    sniPart: 'static-rsa',
    configureTlsOptions() {
        return {
            ciphers: 'AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA@SECLEVEL=0',
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
            ciphers: 'ECDHE-RSA-AES128-SHA:AES128-SHA@SECLEVEL=0',
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
            ciphers: 'NULL-SHA:NULL-SHA256@SECLEVEL=0',
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

export const weakDh: TlsEndpoint = {
    sniPart: 'weak-dh',
    configureTlsOptions() {
        return {
            ciphers: 'DHE-RSA-AES128-SHA:DHE-RSA-AES256-SHA@SECLEVEL=0',
            maxVersion: 'TLSv1.2',
            dhparam: WEAK_DH_PARAMS
        };
    },
    meta: {
        path: 'weak-dh',
        description: 'Uses ephemeral Diffie-Hellman key exchange with a weak 1024-bit group.',
        examples: ['https://weak-dh.testserver.host/'],
        group: tlsCiphers
    }
};
