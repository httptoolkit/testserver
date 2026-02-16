import { TlsEndpoint } from '../tls-index.js';
import { tlsProtocolNegotiation } from '../groups.js';

export const http2: TlsEndpoint = {
    sniPart: 'http2',
    configureAlpnPreferences(alpnList) {
        alpnList.push('h2');
        return alpnList;
    },
    meta: {
        path: 'http2',
        description: 'Forces HTTP/2 protocol via ALPN negotiation.',
        examples: ['https://http2.testserver.host/'],
        group: tlsProtocolNegotiation
    }
};

export const http1: TlsEndpoint = {
    sniPart: 'http1',
    configureAlpnPreferences(alpnList) {
        alpnList.push('http/1.1');
        return alpnList;
    },
    meta: {
        path: 'http1',
        description: 'Forces HTTP/1.1 protocol via ALPN negotiation.',
        examples: ['https://http1.testserver.host/'],
        group: tlsProtocolNegotiation
    }
};