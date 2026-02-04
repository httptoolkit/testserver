import { TlsEndpoint } from '../tls-index.js';

export const http2: TlsEndpoint = {
    sniPart: 'http2',
    configureAlpnPreferences(alpnList) {
        alpnList.push('h2');
        return alpnList;
    }
};

export const http1: TlsEndpoint = {
    sniPart: 'http1',
    configureAlpnPreferences(alpnList) {
        alpnList.push('http/1.1');
        return alpnList;
    }
};