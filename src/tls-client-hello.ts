import type { TlsClientHelloMessage } from 'read-tls-client-hello';

export const TLS_CLIENT_HELLO: unique symbol = Symbol('tlsClientHello');

export interface TlsClientHelloData extends TlsClientHelloMessage {
    ja3: string;
    ja4: string;
}
