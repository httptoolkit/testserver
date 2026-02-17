import type { TlsHelloData } from 'read-tls-client-hello';

export const TLS_CLIENT_HELLO: unique symbol = Symbol('tlsClientHello');

export interface TlsClientHelloData extends TlsHelloData {
    ja3: string;
    ja4: string;
}
