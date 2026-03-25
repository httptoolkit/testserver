import {
    CIPHER_SUITES,
    EXTENSIONS,
    SUPPORTED_GROUPS,
    SIGNATURE_ALGORITHMS,
    EC_POINT_FORMATS,
    TLS_VERSIONS,
    COMPRESSION_METHODS,
    PSK_KEY_EXCHANGE_MODES,
    CERTIFICATE_COMPRESSION_ALGORITHMS,
    CERTIFICATE_STATUS_TYPES
} from 'read-tls-client-hello';

import { HttpEndpoint } from '../http-index.js';
import { httpTlsInspection } from '../groups.js';
import { getClientHello } from '../../tls-client-hello.js';

function annotateId(id: number, table: Record<number, string | undefined>) {
    return { id, name: table[id] ?? null };
}

function annotateIds(ids: number[], table: Record<number, string | undefined>) {
    return ids.map(id => annotateId(id, table));
}

function annotateExtensionData(
    extensionId: number,
    data: Record<string, unknown> | null
): unknown {
    if (data === null || Object.keys(data).length === 0) return data;

    switch (extensionId) {
        case 5: // status_request
            return {
                ...data,
                statusType: annotateId(data.statusType as number, CERTIFICATE_STATUS_TYPES)
            };
        case 10: // supported_groups
            return {
                groups: annotateIds(data.groups as number[], SUPPORTED_GROUPS)
            };
        case 11: // ec_point_formats
            return {
                formats: annotateIds(data.formats as number[], EC_POINT_FORMATS)
            };
        case 13: // signature_algorithms
        case 50: // signature_algorithms_cert
            return {
                algorithms: annotateIds(data.algorithms as number[], SIGNATURE_ALGORITHMS)
            };
        case 17: // status_request_v2
            return {
                statusTypes: annotateIds(data.statusTypes as number[], CERTIFICATE_STATUS_TYPES)
            };
        case 27: // compress_certificate
            return {
                algorithms: annotateIds(
                    data.algorithms as number[],
                    CERTIFICATE_COMPRESSION_ALGORITHMS
                )
            };
        case 43: // supported_versions
            return {
                versions: annotateIds(data.versions as number[], TLS_VERSIONS)
            };
        case 45: // psk_key_exchange_modes
            return {
                modes: annotateIds(data.modes as number[], PSK_KEY_EXCHANGE_MODES)
            };
        case 51: // key_share
            return {
                entries: (data.entries as Array<{ group: number; keyExchangeLength: number }>)
                    .map(entry => ({
                        group: annotateId(entry.group, SUPPORTED_GROUPS),
                        keyExchangeLength: entry.keyExchangeLength
                    }))
            };
        default:
            return data;
    }
}

export const tlsClientHello: HttpEndpoint = {
    matchPath: (path) => path === '/tls/client-hello',
    handle: (req, res) => {
        const helloData = getClientHello(req);

        if (!helloData) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not a TLS connection' }));
            return;
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            version: annotateId(helloData.version, TLS_VERSIONS),
            random: helloData.random.toString('hex'),
            sessionId: helloData.sessionId.length > 0
                ? helloData.sessionId.toString('hex')
                : null,
            cipherSuites: annotateIds(helloData.cipherSuites, CIPHER_SUITES),
            compressionMethods: annotateIds(helloData.compressionMethods, COMPRESSION_METHODS),
            extensions: helloData.extensions.map(ext => ({
                id: ext.id,
                name: EXTENSIONS[ext.id] ?? null,
                data: annotateExtensionData(ext.id, ext.data)
            }))
        }));
    },
    meta: {
        path: '/tls/client-hello',
        description: 'Returns the fully parsed TLS ClientHello. Requires HTTPS.',
        examples: ['/tls/client-hello'],
        group: httpTlsInspection
    }
};
